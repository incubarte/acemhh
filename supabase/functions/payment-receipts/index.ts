// WhatsApp receipt for every payment registered.
//
// A trigger on payments (see the migration) calls this through pg_net with
// the new payment's id, whoever registered it — dashboard or bot. The player
// and their guardian get a template message: what was registered, and what
// is still owed for training after it.
//
// Business-initiated messages outside the 24h window must be approved
// templates, and Meta charges for each one. See docs/whatsapp-setup.md.
//
// Env vars:
//   DEBT_REMINDERS_SECRET     - the same secret the reminders' cron sends; the
//                               request must carry it in x-reminders-secret
//   WHATSAPP_ACCESS_TOKEN     - same as the webhook
//   WHATSAPP_PHONE_NUMBER_ID  - same as the webhook
//   WHATSAPP_GRAPH_VERSION    - optional
//   WHATSAPP_RECEIPT_TEMPLATE - optional, defaults to "pago_registrado"
//   WHATSAPP_RECEIPT_LANGUAGE - optional, defaults to "es_AR"
//
// Body (JSON):
//   { "payment_id": "<uuid>" }               - send its receipt
//   { "payment_id": "<uuid>", "dry": true }  - compute and return, send nothing

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
    activeMonths,
    computeLedger,
    currentMonthBA,
    fetchMonthStatuses,
    fetchPrices,
    fetchTrainingSlots,
    type LedgerMonth,
    periodActiveMonths,
} from "../whatsapp-webhook/status.ts";
import { type Receipt, receiptPayload, receiptsFor } from "./receipts.ts";
import { sendWhatsapp } from "../_lib/whatsapp.ts";

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const Uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const secret = Deno.env.get("DEBT_REMINDERS_SECRET");
    if (!secret) {
        console.error("DEBT_REMINDERS_SECRET not configured");
        return new Response("Server not configured", { status: 500 });
    }
    if (req.headers.get("x-reminders-secret") !== secret) {
        return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as { payment_id?: string; dry?: boolean };
    if (!Uuid.test(body.payment_id ?? "")) return new Response("payment_id missing", { status: 400 });

    try {
        return Response.json(await run(supabaseAdmin, body.payment_id!, body.dry === true));
    } catch (e) {
        console.error("Payment receipt failed:", e);
        return new Response(String(e), { status: 500 });
    }
});

type PaymentRow = {
    id: string;
    player_id: string;
    concept: string;
    amount: number;
    month: string;
    slot_hour: number | null;
    session: string | null;
    teams: { tournaments: { name: string } | null } | null;
};

type PlayerRow = {
    id: string;
    name: string;
    last_name: string;
    categories: string[] | null;
    invitee: boolean | null;
    player_type: string | null;
    scholarship: number | null;
    sibling_rank: number | null;
    phone: string | null;
    guardian_phone: string | null;
};

async function run(s: SupabaseClient, paymentId: string, dry: boolean) {
    const { data: payment, error: payErr } = await s.from("payments")
        .select("id,player_id,concept,amount,month,slot_hour,session,teams(tournaments(name))")
        .eq("id", paymentId)
        .maybeSingle<PaymentRow>();
    if (payErr) throw new Error("payments: " + payErr.message);
    // Deleted before the call got here: a correction, nothing to tell.
    if (!payment) return { paymentId, skipped: "el pago no existe" };

    const { data: player, error: playerErr } = await s.from("players")
        .select("id,name,last_name,categories,invitee,player_type,scholarship,sibling_rank,phone,guardian_phone")
        .eq("id", payment.player_id)
        .maybeSingle<PlayerRow>();
    if (playerErr) throw new Error("players: " + playerErr.message);
    if (!player || (!player.phone && !player.guardian_phone)) {
        return { paymentId, skipped: "el jugador no tiene teléfono" };
    }

    const billing = {
        goalkeeper: player.player_type === "goalkeeper",
        invitee: Boolean(player.invitee),
        categories: player.categories ?? [],
        scholarship: Number(player.scholarship) || 0,
        siblingRank: Number(player.sibling_rank) || 1,
    };
    const ledger = await ledgerFor(s, player.id, billing);
    const receipts = receiptsFor(
        { ...player, scholarship: billing.scholarship },
        { ...payment, amount: Number(payment.amount), slot_hour: payment.slot_hour === null ? null : Number(payment.slot_hour) },
        ledger,
        payment.teams?.tournaments?.name ?? null,
    );

    const name = `${player.name} ${player.last_name}`.trim();
    if (dry) return { paymentId, dry, player: name, receipts };

    const template = {
        name: Deno.env.get("WHATSAPP_RECEIPT_TEMPLATE") ?? "pago_registrado",
        language: Deno.env.get("WHATSAPP_RECEIPT_LANGUAGE") ?? "es_AR",
    };
    let sent = 0, failed = 0, skipped = 0;
    for (const r of receipts) {
        if (!await claim(s, r)) {
            skipped++;
            continue;
        }
        const outcome = await sendWhatsapp(receiptPayload(r, template));
        const { error } = await s.from("whatsapp_receipts")
            .update("error" in outcome
                ? { status: "failed", error: outcome.error }
                : { status: "sent", wamid: outcome.wamid, error: null })
            .eq("payment_id", r.paymentId).eq("wa_id", r.waId);
        if (error) console.error("Receipt log update failed:", error);
        if (outcome.ok) sent++;
        else {
            failed++;
            console.error(`Receipt to ${name} (${r.relation}) failed:`, "error" in outcome ? outcome.error : "");
        }
    }
    return { paymentId, player: name, count: receipts.length, sent, failed, skipped };
}

/** The player's period up to the current month, as the reminders compute it. */
async function ledgerFor(
    s: SupabaseClient,
    playerId: string,
    billing: Parameters<typeof computeLedger>[2],
): Promise<LedgerMonth[]> {
    const slots = await fetchTrainingSlots(s);
    const months = periodActiveMonths(currentMonthBA(), activeMonths(slots));
    if (months.length === 0) return [];
    const prices = await fetchPrices(s);
    const statuses = await fetchMonthStatuses(s, playerId, months, prices, slots, billing);
    return computeLedger(statuses, prices, billing);
}

/**
 * Takes the (payment, phone) slot in the log. False when it was already sent
 * or is in flight, so a repeated call never messages anyone twice; a failed
 * send is taken again.
 */
async function claim(s: SupabaseClient, r: Receipt): Promise<boolean> {
    const row = {
        payment_id: r.paymentId,
        player_id: r.playerId,
        wa_id: r.waId,
        relation: r.relation,
        params: r.params,
        status: "pending",
    };
    const inserted = await s.from("whatsapp_receipts")
        .upsert(row, { onConflict: "payment_id,wa_id", ignoreDuplicates: true })
        .select("id");
    if (inserted.error) throw new Error("whatsapp_receipts: " + inserted.error.message);
    if ((inserted.data ?? []).length > 0) return true;

    const retried = await s.from("whatsapp_receipts")
        .update({ ...row, error: null })
        .eq("payment_id", r.paymentId).eq("wa_id", r.waId)
        .eq("status", "failed")
        .select("id");
    if (retried.error) throw new Error("whatsapp_receipts: " + retried.error.message);
    return (retried.data ?? []).length > 0;
}

/* To try it (sends nothing with "dry"):

  curl -s -X POST "$PROJECT_URL/functions/v1/payment-receipts" \
    -H "x-reminders-secret: $SECRET" \
    -H 'content-type: application/json' \
    -d '{"payment_id": "<uuid>", "dry": true}'

*/
