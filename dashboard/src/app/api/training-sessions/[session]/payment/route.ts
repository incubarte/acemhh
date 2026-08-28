import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { isoWeekday } from "@shared/slot";
import {
  checkPayment,
  type PaymentConcept,
  slotKey,
  withinWriteWindow,
} from "@shared/tokens";
import { ledgerExtrasFor } from "@/lib/rosterLedger";
import { todayBA } from "@/lib/trainingDay";

/** `date` shifted by `days`, as YYYY-MM-DD. */
function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
      return new NextResponse(
        "Esa sesión ya está cerrada: se puede cobrar en la semana actual y la anterior",
        { status: 409 },
      );
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
      .select("id,categories,player_type,scholarship,invitee")
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
    for (const p of sameMonth ?? []) {
      if (p.slot_weekday === null || p.slot_hour === null) continue;
      const k = slotKey(Number(p.slot_weekday), Number(p.slot_hour));
      if (p.concept === "monthly" || p.concept === "half month") {
        monthlySlots.add(k);
        if (p.concept === "monthly" && k === slot) monthlyPaid += Number(p.amount);
      } else individualSlots.add(k);
    }

    // The month closes one day after the slot's second session.
    const { data: slotSessions } = await s
      .from("training_sessions")
      .select("date")
      .eq("hour", Number(hour))
      .gte("date", `${selectedMonth}-01`)
      .lte("date", `${selectedMonth}-31`)
      .order("date");
    const sameWeekday = (slotSessions ?? [])
      .map((r) => String(r.date))
      .filter((d) => isoWeekday(d) === isoWeekday(isoDate));
    const second = sameWeekday[1];
    const monthlyClosed = second !== undefined && todayBA() > shiftDay(second, 1);

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
        monthlyClosed,
        // Half month is the first thing a late starter pays. The ledger has
        // already worked out whether that is the case and what it costs.
        firstOfPeriod: extras?.half_month_preset !== null &&
          extras?.half_month_preset !== undefined,
        halfMonthPrice: extras?.half_month_preset ?? 0,
      },
    );
    if (refusal) return new NextResponse(refusal, { status: 409 });

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
        session: concept === "session" || concept === "half month"
          ? `${isoDate} ${hour}hs`
          : null,
        amount,
        is_cash: true,
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
