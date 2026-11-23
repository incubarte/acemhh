import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { isoWeekday, slotLabel } from "@shared/slot";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkPayment,
  type PaymentConcept,
  slotKey,
  withinWriteWindow,
} from "@shared/tokens";
import { ledgerExtrasFor } from "@/lib/rosterLedger";
import { formatArs, monthNameEs } from "@/lib/tournamentFees";
import { todayBA } from "@/lib/trainingDay";
import { cleanNotes, closedSessionResponse, duplicateResponse, recentDuplicate } from "@/lib/moneyWrites";

export const POST = withPermission('api', '/api/training-sessions/payment', 'POST', async (sess, req) => {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const session = pathParts[pathParts.length - 2]; // YYYY-MM-DD-HH

    // Parse session format: YYYY-MM-DD-HH
    const parts = session.split('-');
    if (parts.length !== 4) {
      return new NextResponse("Invalid session format", { status: 400 });
    }

    const isoDate = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const hour = parts[3];
    const selectedMonth = isoDate.substring(0, 7);

    const body = await req.json() as {
      player_id: string;
      amount: number;
      concept?: PaymentConcept;
      notes?: string | null;
      /** Paid by transfer to the club's account: it enters no caja. */
      transfer?: boolean;
      confirm_duplicate?: boolean;
      /** ROOT only: register it although the session is already closed. */
      confirm_closed?: boolean;
    };

    if (!body?.player_id || !body?.amount) {
      return new NextResponse("Missing fields", { status: 400 });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return new NextResponse("Invalid amount", { status: 400 });
    }

    const concept: PaymentConcept = body.concept ?? "session";
    if (!["session", "monthly", "half month", "debt settlement"].includes(concept)) {
      return new NextResponse("Concepto inválido", { status: 400 });
    }

    // Rewriting a settled week takes direct access to the database, not a
    // stale tab.
    if (!withinWriteWindow(isoDate, todayBA())) {
      // ROOT may still register it, once they confirm they mean that closed
      // session: a payment that was taken and never loaded has to go in.
      if (!sess.groups.includes("ROOT")) {
        return new NextResponse(
          "Esa sesión ya está cerrada: se puede cobrar en la semana actual y la anterior",
          { status: 409 },
        );
      }
      if (body.confirm_closed !== true) {
        return closedSessionResponse(isoDate, hour);
      }
    }

    const paymentId = crypto.randomUUID();

    const registeredBy = `${sess.first_name}${sess.last_name ? ` ${sess.last_name}` : ''} ${sess.username ? `(@${sess.username})` : ''} [id=${sess.id}]`.trim();

    const s = supabaseAdmin();

    // What may be registered depends on the player's standing, so the ledger
    // has to run first. The guard lives here and not only in the screen: it is
    // a money rule, and a retry or a direct call would walk past a check that
    // only existed in the UI.
    const { data: player, error: playerError } = await s
      .from("players")
      .select("id,categories,player_type,scholarship,sibling_rank,invitee")
      .eq("id", body.player_id)
      .maybeSingle();
    if (playerError || !player) {
      return new NextResponse("Jugador inexistente", { status: 400 });
    }

    const extras = (await ledgerExtrasFor(s, [player], session)).get(body.player_id);

    const slot = slotKey(isoWeekday(isoDate), Number(hour));
    const { data: sameMonth } = await s
      .from("payments")
      .select("concept,amount,slot_weekday,slot_hour")
      .eq("player_id", body.player_id)
      .eq("month", selectedMonth)
      .in("concept", ["monthly", "session", "half month"]);

    const monthlySlots = new Set<string>();
    const individualSlots = new Set<string>();
    let monthlyPaid = 0;
    const monthlyElsewhere = new Map<string, OtherMonthly>();
    for (const p of sameMonth ?? []) {
      if (p.slot_weekday === null || p.slot_hour === null) continue;
      const k = slotKey(Number(p.slot_weekday), Number(p.slot_hour));
      if (p.concept === "monthly" || p.concept === "half month") {
        monthlySlots.add(k);
        if (p.concept === "monthly" && k === slot) monthlyPaid += Number(p.amount);
        if (p.concept === "monthly" && k !== slot) {
          const other = monthlyElsewhere.get(k) ??
            { weekday: Number(p.slot_weekday), hour: Number(p.slot_hour), paid: 0 };
          other.paid += Number(p.amount);
          monthlyElsewhere.set(k, other);
        }
      } else individualSlots.add(k);
    }

    const refusal = checkPayment(
      { concept, amount, slot },
      {
        // What is still outstanding, not what the month opened with: a debt
        // payment made today has to unblock the rest of today.
        closedDebt: extras?.debt_outstanding ?? 0,
        monthlySlots,
        individualSlots,
        monthPrice: extras?.month_preset ?? 0,
        monthlyPaid,
        // Half month is the first thing a late starter pays. The ledger has
        // already worked out whether that is the case and what it costs.
        firstOfPeriod: extras?.half_month_preset !== null &&
          extras?.half_month_preset !== undefined,
        halfMonthPrice: extras?.half_month_preset ?? 0,
      },
    );
    if (refusal) {
      // A small monthly payment refused here is usually the rest of a month
      // started in another slot, taken from the wrong session: say where it
      // belongs instead of only that it is too small.
      const elsewhere = concept === "monthly" && monthlyPaid === 0
        ? await incompleteMonthlyElsewhere(s, player, selectedMonth, [...monthlyElsewhere.values()])
        : null;
      return new NextResponse(elsewhere ?? refusal, { status: 409 });
    }

    // A session payment names its session: paying today's and a missed one
    // back to back is two payments, not one typed twice.
    const paidSession = concept === "session" || concept === "half month"
      ? `${isoDate} ${hour}hs`
      : null;
    if (!body.confirm_duplicate && await recentDuplicate(s, "payments", {
      player_id: body.player_id,
      concept,
      amount,
      slot_weekday: isoWeekday(isoDate),
      slot_hour: Number(hour),
      session: paidSession,
    })) {
      return duplicateResponse("un cobro");
    }

    const { error } = await s
      .from("payments")
      .insert([{
        id: paymentId,
        player_id: body.player_id,
        registered_by: registeredBy,
        registered_by_user_id: sess.id,
        // The slot this pays for, as the pair that identifies it — the same
        // key training_slot_features uses.
        slot_weekday: isoWeekday(isoDate),
        slot_hour: Number(hour),
        concept,
        month: selectedMonth,
        // A half month names its session too: that is what says how many
        // sessions it bought.
        session: paidSession,
        amount,
        is_cash: body.transfer !== true,
        notes: cleanNotes(body.notes),
      }]);

    if (error) {
      if (error.code === "23505") {
        return new NextResponse("Payment already registered", { status: 409 });
      }
      console.error(error);
      return new NextResponse("Error registering payment", { status: 500 });
    }

    return NextResponse.json({ ok: true, payment_id: paymentId });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal server error", { status: 500 });
  }
});

type OtherMonthly = { weekday: number; hour: number; paid: number };

/**
 * Where this month's monthly payment was started and left incomplete, as the
 * refusal should say it; null when there is no such slot. Each slot's price is
 * the ledger's, worked out from one of its sessions this month.
 */
async function incompleteMonthlyElsewhere(
  s: SupabaseClient,
  player: Parameters<typeof ledgerExtrasFor>[1][number],
  month: string,
  slots: OtherMonthly[],
): Promise<string | null> {
  if (slots.length === 0) return null;
  // Bounded by the first of the next month: "YYYY-11-31" is not a date, and
  // Postgres rejects the whole query rather than clamping it.
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const { data: sessions } = await s
    .from("training_sessions_resolved")
    .select("date,hour")
    .gte("date", `${month}-01`)
    .lt("date", `${next}-01`);
  const missing: string[] = [];
  for (const slot of slots) {
    const one = (sessions ?? []).find((t) =>
      Number(t.hour) === slot.hour && isoWeekday(String(t.date)) === slot.weekday
    );
    if (!one) continue;
    const session = `${one.date}-${String(slot.hour).padStart(2, "0")}`;
    const price = (await ledgerExtrasFor(s, [player], session)).get(player.id)?.month_preset ?? 0;
    const left = price - slot.paid;
    if (left > 0) missing.push(`${slotLabel(slot.weekday, slot.hour)} (le faltan $${formatArs(left)})`);
  }
  if (missing.length === 0) return null;
  const name = monthNameEs(month).toLowerCase();
  return missing.length === 1
    ? `El mensual de ${name} de este jugador es del ${missing[0]}: cobralo desde esa sesión`
    : `Este jugador tiene mensuales de ${name} sin completar en ${missing.join(" y ")}: cobralos desde esas sesiones`;
}
