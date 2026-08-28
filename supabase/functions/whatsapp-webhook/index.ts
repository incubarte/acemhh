// WhatsApp Cloud API webhook.
//
// Single-response bot: any inbound message gets one reply built from the
// sender's identity (resolved by phone) — players see their recent payment and
// attendance status, admins get a magic link into the dashboard, unknown
// numbers get a shrug. No menu, no flows, no conversation state.
//
// Required env vars (supabase/functions/.env):
//   WHATSAPP_APP_SECRET      - Meta app secret, used to verify X-Hub-Signature-256
//   WHATSAPP_VERIFY_TOKEN    - arbitrary string, echoed during the GET handshake
//   WHATSAPP_ACCESS_TOKEN    - System User permanent token (not the 24h dev token)
//   WHATSAPP_PHONE_NUMBER_ID - from the WhatsApp > API Setup panel
//   WHATSAPP_GRAPH_VERSION   - optional, defaults to GraphVersionDefault below

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    activeMonths,
    buildPlayerSection,
    computeLedger,
    currentMonthBA,
    fetchMonthStatuses,
    fetchPrices,
    fetchTrainingSlots,
    periodActiveMonths,
    trainingsFor,
} from "./status.ts";

const GraphVersionDefault = "v23.0";

// WhatsApp rejects the whole message if the body exceeds this, so we truncate
// rather than risk a 400.
const LimitTextBody = 4096;

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ////////////////////////////////////
// TYPES
// ////////////////////////////////////

type Incoming = {
    waId: string;
    messageId: string;
    profileName: string | null;
    /** Body of a plain text message, trimmed. */
    text: string | null;
    /** id payload of an interactive button or list reply — WhatsApp's callback_data. */
    replyId: string | null;
};

/** A dashboard admin, resolved from the sender's phone. id is the users.id uuid. */
type Admin = {
    id: string;
    first_name: string;
};

/** A player linked to the sender's phone, with how the phone relates to them. */
type PlayerLink = {
    id: string;
    name: string;
    last_name: string;
    categories: string[];
    invitee: boolean;
    goalkeeper: boolean;
    /** 0-100; at 100 the player pays nothing and only attendance is reported. */
    scholarship: number;
    /** "self" when it is the player's own phone, "guardian" when it is their tutor's. */
    relation: "self" | "guardian";
};

// ////////////////////////////////////
// SERVER
// ////////////////////////////////////

Deno.serve(async (req: Request) => {
    const url = new URL(req.url);

    // Meta's subscription handshake.
    if (req.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

        if (!expected) {
            console.error("WHATSAPP_VERIFY_TOKEN not configured");
            return new Response("Server not configured", { status: 500 });
        }
        if (mode === "subscribe" && token === expected && challenge) {
            return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
    }

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
    if (!appSecret) {
        console.error("WHATSAPP_APP_SECRET not configured");
        return new Response("Server not configured", { status: 500 });
    }

    // The signature covers the raw bytes, so read the body as text before parsing.
    const raw = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    if (!await isValidSignature(raw, signature, appSecret)) {
        console.error("Rejected webhook with invalid signature");
        return new Response("Unauthorized", { status: 401 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(raw);
    } catch {
        return new Response("Bad Request", { status: 400 });
    }

    // Meta retries anything that isn't a prompt 2xx, so acknowledge first and do the
    // work after the response is sent.
    waitUntil(processPayload(payload).catch((e) => console.error("Processing failed:", e)));

    return new Response("OK", { status: 200 });
});

function waitUntil(promise: Promise<unknown>) {
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
        .EdgeRuntime;
    if (runtime?.waitUntil) {
        runtime.waitUntil(promise);
    } else {
        // Local `deno run` has no EdgeRuntime; the promise still resolves.
        promise.catch((e) => console.error(e));
    }
}

// ////////////////////////////////////
// SIGNATURE
// ////////////////////////////////////

async function isValidSignature(
    raw: string,
    header: string | null,
    secret: string,
): Promise<boolean> {
    if (!header?.startsWith("sha256=")) return false;
    const received = header.slice("sha256=".length);
    const expected = await hmacSha256Hex(secret, raw);
    return timingSafeEqualHex(received, expected);
}

async function sha256Hex(payload: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

// ////////////////////////////////////
// WEBHOOK PARSING
// ////////////////////////////////////

// deno-lint-ignore no-explicit-any
async function processPayload(payload: any) {
    const entries = payload?.entry ?? [];
    for (const entry of entries) {
        for (const change of entry?.changes ?? []) {
            const value = change?.value;
            if (!value) continue;

            // Delivery/read receipts and errors arrive on the same webhook. We only
            // care about inbound messages here.
            if (value.statuses) {
                for (const status of value.statuses) {
                    if (status?.errors?.length) {
                        console.error("Message status error:", JSON.stringify(status.errors));
                    }
                }
            }

            const contacts = value.contacts ?? [];
            for (const message of value.messages ?? []) {
                const incoming = toIncoming(message, contacts);
                if (!incoming) continue;

                if (!await claimMessage(incoming)) {
                    console.log(`Skipping already-processed message ${incoming.messageId}`);
                    continue;
                }

                try {
                    await handleIncoming(incoming);
                } catch (e) {
                    console.error(`Handler failed for ${incoming.messageId}:`, e);
                    await sendText(
                        incoming.waId,
                        "Ocurrió un error procesando tu mensaje. Escribí *menu* para volver a empezar.",
                    ).catch(() => {});
                }
            }
        }
    }
}

// deno-lint-ignore no-explicit-any
function toIncoming(message: any, contacts: any[]): Incoming | null {
    const waId = message?.from;
    const messageId = message?.id;
    if (!waId || !messageId) return null;

    const profileName = contacts.find((c) => c?.wa_id === waId)?.profile?.name ?? null;

    let text: string | null = null;
    let replyId: string | null = null;

    if (message.type === "text") {
        text = (message.text?.body ?? "").trim() || null;
    } else if (message.type === "interactive") {
        const interactive = message.interactive;
        replyId = interactive?.button_reply?.id ?? interactive?.list_reply?.id ?? null;
    } else if (message.type === "button") {
        // Reply from a template quick-reply button.
        replyId = message.button?.payload ?? null;
        text = message.button?.text ?? null;
    }

    return { waId, messageId, profileName, text, replyId };
}

/** Returns false if this message id was already handled. */
async function claimMessage(incoming: Incoming): Promise<boolean> {
    const { error } = await supabaseAdmin
        .from("whatsapp_processed_messages")
        .insert({ message_id: incoming.messageId, wa_id: incoming.waId });

    if (!error) return true;
    if (error.code === "23505") return false; // unique_violation — a redelivery

    // Don't drop the message because bookkeeping failed.
    console.error("Dedup insert failed, processing anyway:", error);
    return true;
}

// ////////////////////////////////////
// SENDER IDENTITY
// ////////////////////////////////////

// wa_id arrives in a Meta-signed webhook, so matching it against the curated
// users.phone column identifies the sender as strongly as their Telegram login.
async function lookupAdmin(waId: string): Promise<Admin | null> {
    const { data, error } = await supabaseAdmin
        .from("users")
        .select("id,first_name")
        .eq("phone", waId)
        .maybeSingle();

    if (error) {
        console.error("Admin lookup failed:", error);
        return null;
    }
    return data;
}

async function lookupPlayers(waId: string): Promise<PlayerLink[]> {
    // waId is all digits (Meta strips the +), so it is safe inside the filter.
    const { data, error } = await supabaseAdmin
        .from("players")
        .select("id,name,last_name,categories,invitee,player_type,scholarship,phone,guardian_phone")
        .or(`phone.eq.${waId},guardian_phone.eq.${waId}`);

    if (error) {
        console.error("Player lookup failed:", error);
        return [];
    }

    return (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        last_name: p.last_name,
        categories: p.categories,
        invitee: p.invitee,
        goalkeeper: p.player_type === "goalkeeper",
        scholarship: p.scholarship ?? 0,
        relation: p.phone === waId ? "self" as const : "guardian" as const,
    }));
}

const LoginTokenTtlMinutes = 15;

// Dashboard access for admins without Telegram: the wa_id in a Meta-signed
// webhook proves who is talking, so a short-lived single-use token can carry
// that identity to the dashboard, which exchanges it for a session cookie.
// Returns the login line for the reply, or null when minting failed (the rest
// of the reply is still useful on its own).
async function mintLoginSection(admin: Admin): Promise<string | null> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const { error } = await supabaseAdmin
        .from("whatsapp_login_tokens")
        .insert({
            token_hash: await sha256Hex(token),
            user_id: admin.id,
            expires_at: new Date(Date.now() + LoginTokenTtlMinutes * 60 * 1000).toISOString(),
        });

    if (error) {
        console.error("Login token insert failed:", error);
        return null;
    }

    const base = Deno.env.get("DASHBOARD_URL") ?? "https://acemhh-delta.vercel.app";
    return `🔑 Entrá al dashboard con este link (un solo uso, vale ${LoginTokenTtlMinutes} minutos):\n${base}/api/auth/whatsapp?token=${token}`;
}

// ////////////////////////////////////
// REPLY
// ////////////////////////////////////

// Whatever the message says, the reply is the same: a status tailored to who
// is talking. Players get their recent payment/attendance record, guardians
// get one section per player in their care, admins get a dashboard login
// link, unknown numbers get a shrug.
async function handleIncoming(incoming: Incoming) {
    const [admin, players] = await Promise.all([
        lookupAdmin(incoming.waId),
        lookupPlayers(incoming.waId),
    ]);
    const self = players.find((p) => p.relation === "self") ?? null;

    if (!admin && players.length === 0) {
        await sendText(incoming.waId, "Hola! Te conozco?");
        return;
    }

    // Names come from our own tables, never from the sender-controlled
    // WhatsApp profile name. A pure guardian has no name of their own here.
    const name = admin?.first_name ?? self?.name ?? null;
    const sections: string[] = [name ? `Hola ${name}!` : "Hola!"];

    // Agenda and tariffs live in the database (training_sessions, prices). The
    // ledger runs over the semester: debt accumulates, and last month's
    // bonified sessions apply to the current one; the reply displays the last
    // three months plus the balance lines.
    const slots = players.length > 0 ? await fetchTrainingSlots(supabaseAdmin) : [];
    const months = periodActiveMonths(currentMonthBA(), activeMonths(slots));
    if (months.length > 0) {
        const prices = await fetchPrices(supabaseAdmin);
        const reportFor = async (player: PlayerLink): Promise<string | null> => {
            // The ledger prices each month from the agenda itself: how many
            // sessions each slot held, what the player attended of them, and
            // what they paid at which slot.
            const billing = {
                goalkeeper: player.goalkeeper,
                invitee: player.invitee,
                categories: player.categories,
                scholarship: player.scholarship,
            };
            const statuses = await fetchMonthStatuses(
                supabaseAdmin,
                player.id,
                months,
                prices,
                slots,
                billing,
            );
            const ledger = computeLedger(statuses, prices, billing);
            const isSelf = player.relation === "self";
            return buildPlayerSection(
                ledger,
                isSelf
                    ? "Registro de tus pagos en los últimos meses:"
                    : `Registro de pagos de ${player.name}:`,
                { voice: isSelf ? "vos" : "el", fullScholarship: player.scholarship === 100 },
            );
        };

        const ordered = [
            ...(self ? [self] : []),
            ...players.filter((p) => p.relation === "guardian"),
        ];
        const reports = await Promise.all(ordered.map(reportFor));
        sections.push(...reports.filter((r): r is string => r !== null));
    }

    if (admin) {
        const loginSection = await mintLoginSection(admin);
        if (loginSection) sections.push(loginSection);
    }

    await sendText(incoming.waId, sections.join("\n\n"));
}

// ////////////////////////////////////
// SENDING
// ////////////////////////////////////

// deno-lint-ignore no-explicit-any
async function sendMessage(payload: Record<string, any>) {
    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const version = (Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? GraphVersionDefault).trim();

    if (!token || !phoneNumberId) {
        console.error("WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured");
        return;
    }

    const res = await fetch(
        `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
        {
            method: "POST",
            headers: {
                "authorization": `Bearer ${token}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
        },
    );

    if (!res.ok) {
        console.error(`Send failed (${res.status}):`, await res.text().catch(() => ""));
    }
}

function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function sendText(to: string, body: string) {
    return sendMessage({
        to,
        type: "text",
        text: { body: truncate(body, LimitTextBody), preview_url: false },
    });
}

/* To invoke locally:

  1. Run `supabase start`
  2. Simulate an inbound text message (signature check runs against WHATSAPP_APP_SECRET):

  BODY='{"entry":[{"changes":[{"value":{"contacts":[{"wa_id":"5491100000000","profile":{"name":"Test"}}],"messages":[{"from":"5491100000000","id":"wamid.test1","type":"text","text":{"body":"hola"}}]}}]}]}'
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" | sed 's/^.* //')

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/whatsapp-webhook' \
    --header "x-hub-signature-256: sha256=$SIG" \
    --header 'Content-Type: application/json' \
    --data "$BODY"

*/
