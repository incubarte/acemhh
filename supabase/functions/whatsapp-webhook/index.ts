// WhatsApp Cloud API webhook.
//
// Public entrypoint for members: anyone messages the club number and gets a menu.
// Admin operations stay on the Telegram bot.
//
// Required env vars (supabase/functions/.env):
//   WHATSAPP_APP_SECRET      - Meta app secret, used to verify X-Hub-Signature-256
//   WHATSAPP_VERIFY_TOKEN    - arbitrary string, echoed during the GET handshake
//   WHATSAPP_ACCESS_TOKEN    - System User permanent token (not the 24h dev token)
//   WHATSAPP_PHONE_NUMBER_ID - from the WhatsApp > API Setup panel
//   WHATSAPP_GRAPH_VERSION   - optional, defaults to GraphVersionDefault below

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GraphVersionDefault = "v23.0";

// WhatsApp rejects the whole message if any of these are exceeded, so we truncate
// rather than risk a 400 on a long player name.
const LimitTextBody = 4096;
const LimitInteractiveBody = 1024;
const LimitButtonTitle = 20;
const LimitRowTitle = 24;
const LimitRowDescription = 72;
const MaxButtons = 3;
const MaxRows = 10;

const SessionTtlHours = 24;

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

type Session = {
    wa_id: string;
    flow: string | null;
    step: string | null;
    data: Record<string, unknown>;
};

type FlowContext = {
    incoming: Incoming;
    session: Session;
    /** Whatever the user just sent, normalized: reply id if interactive, else text. */
    input: string;
};

type Flow = {
    id: string;
    /** Shown as the menu row. Kept short — WhatsApp truncates hard. */
    title: string;
    description: string;
    start: (ctx: FlowContext) => Promise<void>;
    steps: Record<string, (ctx: FlowContext) => Promise<void>>;
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
// SESSION
// ////////////////////////////////////

async function loadSession(waId: string): Promise<Session> {
    const { data, error } = await supabaseAdmin
        .from("whatsapp_sessions")
        .select("wa_id,flow,step,data")
        .eq("wa_id", waId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (error) console.error("Session load failed:", error);

    return data
        ? { ...data, data: (data.data ?? {}) as Record<string, unknown> }
        : { wa_id: waId, flow: null, step: null, data: {} };
}

async function saveSession(
    waId: string,
    flow: string,
    step: string,
    data: Record<string, unknown>,
) {
    const now = new Date();
    const expires = new Date(now.getTime() + SessionTtlHours * 60 * 60 * 1000);

    const { error } = await supabaseAdmin
        .from("whatsapp_sessions")
        .upsert({
            wa_id: waId,
            flow,
            step,
            data,
            updated_at: now.toISOString(),
            expires_at: expires.toISOString(),
        }, { onConflict: "wa_id" });

    if (error) console.error("Session save failed:", error);
}

async function clearSession(waId: string) {
    const { error } = await supabaseAdmin
        .from("whatsapp_sessions")
        .delete()
        .eq("wa_id", waId);
    if (error) console.error("Session clear failed:", error);
}

// ////////////////////////////////////
// ROUTER
// ////////////////////////////////////

const MenuKeywords = ["menu", "menú", "hola", "start", "inicio", "ayuda"];
const CancelKeywords = ["cancelar", "salir", "cancel"];

async function handleIncoming(incoming: Incoming) {
    const session = await loadSession(incoming.waId);
    const input = incoming.replyId ?? incoming.text ?? "";
    const normalized = normalize(input);

    if (CancelKeywords.includes(normalized)) {
        await clearSession(incoming.waId);
        await sendText(incoming.waId, "Listo, cancelado.");
        await sendMainMenu(incoming);
        return;
    }

    if (MenuKeywords.includes(normalized)) {
        await clearSession(incoming.waId);
        await sendMainMenu(incoming);
        return;
    }

    const ctx: FlowContext = { incoming, session, input };

    // A menu selection (or a keyword matching a flow id) starts that flow.
    const selected = FLOWS[input] ?? FLOWS[normalized];
    if (selected) {
        await selected.start(ctx);
        return;
    }

    // Otherwise continue whatever flow is in progress.
    if (session.flow && session.step) {
        const flow = FLOWS[session.flow];
        const handler = flow?.steps[session.step];
        if (handler) {
            await handler(ctx);
            return;
        }
        console.error(`Unknown flow/step ${session.flow}/${session.step}, resetting`);
        await clearSession(incoming.waId);
    }

    await sendMainMenu(incoming);
}

function normalize(value: string): string {
    return value.trim().toLowerCase();
}

async function sendMainMenu(incoming: Incoming) {
    const greeting = incoming.profileName ? `Hola ${incoming.profileName}! ` : "Hola! ";
    await sendList(
        incoming.waId,
        `${greeting}Soy el asistente de ACEMHH. ¿Qué necesitás?`,
        "Ver opciones",
        Object.values(FLOWS).map((f) => ({
            id: f.id,
            title: f.title,
            description: f.description,
        })),
    );
}

// ////////////////////////////////////
// FLOWS
// ////////////////////////////////////

// Add a flow by declaring it here — it shows up in the main menu automatically.
// Each step handler is responsible for advancing (saveSession) or ending
// (clearSession) the conversation.

const FlowConsultaSocio: Flow = {
    id: "consulta_socio",
    title: "Consultar socio",
    description: "Verificá que tus datos estén registrados",
    start: async ({ incoming }) => {
        await saveSession(incoming.waId, FlowConsultaSocio.id, "ask_dni", {});
        await sendText(
            incoming.waId,
            "Decime el *DNI* del socio (solo números).\n\nEscribí *cancelar* para salir.",
        );
    },
    steps: {
        ask_dni: async ({ incoming, input }) => {
            const dni = input.replace(/\D/g, "");
            if (dni.length < 7) {
                await sendText(
                    incoming.waId,
                    "Ese DNI no parece válido. Mandame solo los números, sin puntos.",
                );
                return; // stay on this step
            }

            const { data, error } = await supabaseAdmin
                .from("players")
                .select("name,last_name,categories")
                .eq("dni", dni)
                .maybeSingle();

            if (error) {
                console.error("Player lookup failed:", error);
                await sendText(incoming.waId, "No pude consultar ahora. Probá de nuevo en un rato.");
                await clearSession(incoming.waId);
                return;
            }

            // NOTE: deliberately does not disclose payment or attendance data. The
            // sender's number is not verified against the member, and there is no
            // phone -> player mapping in the schema yet. Decide that policy before
            // adding any flow that reveals personal or financial information.
            await sendText(
                incoming.waId,
                data
                    ? `✅ ${data.name} ${data.last_name} está registrado en ${
                        data.categories.length > 1 ? "las categorías" : "la categoría"
                    } *${data.categories.join(", ")}*.`
                    : "No encontré a nadie con ese DNI. Consultá con la comisión.",
            );

            // No follow-up step needed: both button ids route through handleIncoming
            // on their own — "consulta_socio" restarts the flow, "menu" is a keyword.
            await clearSession(incoming.waId);
            await sendButtons(incoming.waId, "¿Querés hacer algo más?", [
                { id: FlowConsultaSocio.id, title: "Consultar otro" },
                { id: "menu", title: "Menú principal" },
            ]);
        },
    },
};

const FlowContacto: Flow = {
    id: "contacto",
    title: "Dejar un mensaje",
    description: "Te respondemos apenas podamos",
    start: async ({ incoming }) => {
        await saveSession(incoming.waId, FlowContacto.id, "ask_message", {});
        await sendText(
            incoming.waId,
            "Contame tu consulta y se la paso a la comisión.\n\nEscribí *cancelar* para salir.",
        );
    },
    steps: {
        ask_message: async ({ incoming, input }) => {
            // TODO: persist to a table (or relay to the Telegram admin chat) once you
            // decide where these should land.
            console.log(`Consulta de ${incoming.waId} (${incoming.profileName}): ${input}`);
            await sendText(incoming.waId, "¡Gracias! Recibimos tu mensaje.");
            await clearSession(incoming.waId);
            await sendMainMenu(incoming);
        },
    },
};

const FLOWS: Record<string, Flow> = {
    [FlowConsultaSocio.id]: FlowConsultaSocio,
    [FlowContacto.id]: FlowContacto,
};

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

/**
 * Reply buttons. WhatsApp allows at most 3 — for anything longer use sendList,
 * and for more than 10 options you need pagination or a Flow.
 */
function sendButtons(
    to: string,
    body: string,
    buttons: { id: string; title: string }[],
) {
    if (buttons.length > MaxButtons) {
        console.error(`Dropping ${buttons.length - MaxButtons} button(s): WhatsApp allows ${MaxButtons}`);
    }
    return sendMessage({
        to,
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: truncate(body, LimitInteractiveBody) },
            action: {
                buttons: buttons.slice(0, MaxButtons).map((b) => ({
                    type: "reply",
                    reply: { id: b.id, title: truncate(b.title, LimitButtonTitle) },
                })),
            },
        },
    });
}

/** List message. Max 10 rows total across all sections. */
function sendList(
    to: string,
    body: string,
    buttonLabel: string,
    rows: { id: string; title: string; description?: string }[],
) {
    if (rows.length > MaxRows) {
        console.error(`Dropping ${rows.length - MaxRows} row(s): WhatsApp allows ${MaxRows}`);
    }
    return sendMessage({
        to,
        type: "interactive",
        interactive: {
            type: "list",
            body: { text: truncate(body, LimitInteractiveBody) },
            action: {
                button: truncate(buttonLabel, LimitButtonTitle),
                sections: [{
                    rows: rows.slice(0, MaxRows).map((r) => ({
                        id: r.id,
                        title: truncate(r.title, LimitRowTitle),
                        ...(r.description
                            ? { description: truncate(r.description, LimitRowDescription) }
                            : {}),
                    })),
                }],
            },
        },
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
