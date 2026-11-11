// Thursday-morning debt reminders over WhatsApp.
//
// pg_cron calls this at 8am Buenos Aires every Thursday (see the migration
// that schedules it). On a Thursday with training, every player who owes
// anything — closed months of the period, the current month, or both — gets
// a template message on their phone and on their guardian's.
//
// Business-initiated messages outside the 24h window must be approved
// templates, and Meta charges for each one. See docs/whatsapp-setup.md.
//
// Env vars:
//   DEBT_REMINDERS_SECRET     - shared with pg_cron through the vault; the
//                               request must carry it in x-reminders-secret
//   WHATSAPP_ACCESS_TOKEN     - same as the webhook
//   WHATSAPP_PHONE_NUMBER_ID  - same as the webhook
//   WHATSAPP_GRAPH_VERSION    - optional
//   WHATSAPP_REMINDER_TEMPLATE  - optional, defaults to "recordatorio_deuda"
//   WHATSAPP_REMINDER_LANGUAGE  - optional, defaults to "es_AR"
//
// Body (optional JSON):
//   { "dry": true }                  - compute and return, send nothing
//   { "dry": true, "date": "YYYY-MM-DD" } - as if it were that day

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
    activeMonths,
    type AttendanceDbRow,
    buildMonthStatuses,
    computeLedger,
    fetchPrices,
    fetchTrainingSlots,
    indexAgenda,
    LedgerConcepts,
    type PaymentRow,
    periodActiveMonths,
} from "../whatsapp-webhook/status.ts";
import { isReminderDay, type Reminder, remindersFor, templatePayload, todayBA } from "./reminders.ts";
import { reminderSummary, type SummaryRow } from "../whatsapp-webhook/inbox.ts";
import { telegramCall, telegramTruncate } from "../_lib/telegram.ts";
import { sendWhatsapp } from "../_lib/whatsapp.ts";

const PageSize = 1000;

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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

    const body = await req.json().catch(() => ({})) as { dry?: boolean; date?: string };
    const dry = body.dry === true;
    // Pretending to be another day is only for looking: a real send on the
    // wrong day is exactly what the schedule exists to prevent.
    const date = dry && /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") ? body.date! : todayBA();

    try {
        const result = await run(supabaseAdmin, date, dry);
        return Response.json(result);
    } catch (e) {
        console.error("Debt reminders failed:", e);
        return new Response(String(e), { status: 500 });
    }
});

async function run(s: SupabaseClient, date: string, dry: boolean) {
    const slots = await fetchTrainingSlots(s);
    if (!isReminderDay(date, new Set(slots.map((r) => r.date)))) {
        return { date, skipped: "no es un jueves con entrenamiento" };
    }

    const month = date.slice(0, 7);
    const months = periodActiveMonths(month, activeMonths(slots));
    if (months.length === 0) return { date, skipped: "el período no tiene meses activos" };

    const [prices, players, payments, attendances] = await Promise.all([
        fetchPrices(s),
        fetchAll<PlayerRow>((from, to) =>
            s.from("players")
                .select("id,name,last_name,categories,invitee,player_type,scholarship,sibling_rank,phone,guardian_phone")
                .or("phone.not.is.null,guardian_phone.not.is.null")
                .order("id")
                .range(from, to)
        ),
        fetchAll<PaymentRow & { player_id: string }>((from, to) =>
            s.from("payments")
                .select("player_id,month,concept,amount,slot_weekday,slot_hour,session")
                .in("month", months)
                .in("concept", LedgerConcepts)
                .order("id")
                .range(from, to)
        ),
        fetchAll<AttendanceDbRow & { player_id: string }>((from, to) =>
            s.from("attendances")
                .select("player_id,session,bonified")
                .eq("attended", true)
                .gte("session", `${months[0]}-01`)
                .order("id")
                .range(from, to)
        ),
    ]);

    const agenda = indexAgenda(slots);
    const byPlayer = <T extends { player_id: string }>(rows: T[]) => {
        const out = new Map<string, T[]>();
        for (const r of rows) {
            if (!out.has(r.player_id)) out.set(r.player_id, []);
            out.get(r.player_id)!.push(r);
        }
        return out;
    };
    const payMap = byPlayer(payments);
    const attMap = byPlayer(attendances);

    const reminders: Reminder[] = [];
    for (const p of players) {
        const billing = {
            goalkeeper: p.player_type === "goalkeeper",
            invitee: Boolean(p.invitee),
            categories: p.categories ?? [],
            scholarship: Number(p.scholarship) || 0,
            siblingRank: Number(p.sibling_rank) || 1,
        };
        const statuses = buildMonthStatuses(
            payMap.get(p.id) ?? [],
            attMap.get(p.id) ?? [],
            months,
            prices,
            agenda,
            billing,
        );
        reminders.push(...remindersFor(
            { ...p, scholarship: billing.scholarship },
            computeLedger(statuses, prices, billing),
        ));
    }

    const names = new Map(players.map((p) => [p.id, `${p.name} ${p.last_name}`.trim()]));
    if (dry) {
        return {
            date,
            dry,
            count: reminders.length,
            reminders: reminders.map((r) => ({ player: names.get(r.playerId) ?? null, ...r })),
        };
    }

    const template = {
        name: Deno.env.get("WHATSAPP_REMINDER_TEMPLATE") ?? "recordatorio_deuda",
        language: Deno.env.get("WHATSAPP_REMINDER_LANGUAGE") ?? "es_AR",
    };
    const summary: SummaryRow[] = [];
    let sent = 0, failed = 0, skipped = 0;
    for (const r of reminders) {
        if (!await claim(s, date, r)) {
            skipped++;
            continue;
        }
        const { messaging_product: _, ...payload } = templatePayload(r, template);
        const outcome = await sendWhatsapp(payload);
        summary.push({
            player: names.get(r.playerId) ?? r.playerId,
            relation: r.relation,
            detail: r.params[1],
            ok: outcome.ok,
            error: "error" in outcome ? outcome.error : undefined,
        });
        // strict is off, so `ok` alone does not narrow the union.
        const { error } = await s.from("whatsapp_reminders")
            .update("error" in outcome
                ? { status: "failed", error: outcome.error }
                : { status: "sent", wamid: outcome.wamid, error: null })
            .eq("sent_on", date).eq("player_id", r.playerId).eq("wa_id", r.waId);
        if (error) console.error("Reminder log update failed:", error);
        if (outcome.ok) sent++;
        else failed++;
    }
    if (summary.length > 0) await postSummary(date, summary);
    return { date, count: reminders.length, sent, failed, skipped };
}

/** Thursday's report, in the inbox group's General topic. Nobody's topic
 * opens for a reminder: that waits until they answer. */
async function postSummary(date: string, rows: SummaryRow[]) {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("WHATSAPP_INBOX_TELEGRAM_CHAT_ID");
    if (!token || !chatId) {
        console.error("TELEGRAM_BOT_TOKEN or WHATSAPP_INBOX_TELEGRAM_CHAT_ID not configured: no summary");
        return;
    }
    const res = await telegramCall(token, "sendMessage", {
        chat_id: chatId,
        text: telegramTruncate(reminderSummary(date, rows)),
    });
    if (!res.ok) console.error("Reminder summary failed:", res.description);
}

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

/** PostgREST caps a response at 1000 rows; a period's attendances pass that. */
async function fetchAll<T>(
    page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0;; from += PageSize) {
        const { data, error } = await page(from, from + PageSize - 1);
        if (error) throw new Error(error.message);
        out.push(...(data ?? []) as T[]);
        if ((data ?? []).length < PageSize) return out;
    }
}

/**
 * Takes the (day, player, phone) slot in the log. False when it was already
 * sent or is in flight, so a retried run never messages anyone twice; a
 * failed send is taken again, so a retry does reach them.
 */
async function claim(s: SupabaseClient, date: string, r: Reminder): Promise<boolean> {
    const row = {
        sent_on: date,
        player_id: r.playerId,
        wa_id: r.waId,
        relation: r.relation,
        closed_debt: r.closedDebt,
        month_debt: r.monthDebt,
        params: r.params,
        status: "pending",
    };
    const inserted = await s.from("whatsapp_reminders")
        .upsert(row, { onConflict: "sent_on,player_id,wa_id", ignoreDuplicates: true })
        .select("id");
    if (inserted.error) throw new Error("whatsapp_reminders: " + inserted.error.message);
    if ((inserted.data ?? []).length > 0) return true;

    const retried = await s.from("whatsapp_reminders")
        .update({ ...row, error: null })
        .eq("sent_on", date).eq("player_id", r.playerId).eq("wa_id", r.waId)
        .eq("status", "failed")
        .select("id");
    if (retried.error) throw new Error("whatsapp_reminders: " + retried.error.message);
    return (retried.data ?? []).length > 0;
}

/* To invoke locally (sends nothing with "dry"):

  curl -s -X POST 'http://127.0.0.1:54321/functions/v1/debt-reminders' \
    -H "x-reminders-secret: $DEBT_REMINDERS_SECRET" \
    -H 'content-type: application/json' \
    -d '{"dry": true, "date": "2026-11-12"}'

*/
