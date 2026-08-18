import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import {
  LEDGER_FROM,
  ledgerStep,
  MinBundleTrainings,
  priceFor,
  runLedger,
  trainingsFor,
  type MonthActivity,
} from "@/lib/ledger";

function toSpecificSlot(isoDate: string, hour: string): string {
  return `${isoDate} ${hour}hs`;
}

function toGenericSlot(isoDate: string, hour: string): string {
  const date = new Date(`${isoDate}T${hour}:00`);
  return date.toLocaleString("es-AR", {
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).replace(",", "") + "hs";
}

type Section = "jugadores" | "invitados" | "arqueros";

export const GET = withPermission('api', '/api/training-sessions', 'GET', async (sess, req) => {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const session = pathParts[pathParts.length - 1]; // YYYY-MM-DD-HH

    // Parse session format: YYYY-MM-DD-HH
    const parts = session.split('-');
    if (parts.length !== 4) {
      return new NextResponse("Invalid session format", { status: 400 });
    }

    const isoDate = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const hour = parts[3];

    const specificSlot = toSpecificSlot(isoDate, hour);
    const genericSlot = toGenericSlot(isoDate, hour);
    const selectedMonth = isoDate.substring(0, 7);

    const s = supabaseAdmin();

    // The agenda lives in training_slots; a date/hour without a row (e.g. a
    // holiday) is not a valid session.
    const { data: slot, error: slotError } = await s
      .from("training_slots")
      .select("categories,goalies")
      .eq("date", isoDate)
      .eq("hour", Number(hour))
      .maybeSingle();

    if (slotError) {
      console.error(slotError);
      return new NextResponse("Error fetching slot", { status: 500 });
    }
    if (!slot) {
      return new NextResponse("Invalid slot", { status: 400 });
    }
    const cats = slot.categories;

    // Fetch A: all players that belong to any of the slot's categories and train.
    // A player appears in the sessions of every category they belong to.
    const { data: categoryPlayers, error: playersError } = await s
      .from("players")
      .select("*")
      .overlaps("categories", cats)
      .eq("trains", true)
      .order("last_name")
      .order("name");

    if (playersError) {
      console.error(playersError);
      return new NextResponse("Error fetching players", { status: 500 });
    }

    // Fetch B: all attendances for current session
    const { data: attendances, error: attendanceError } = await s
      .from("attendances")
      .select("*")
      .eq("session", specificSlot);

    if (attendanceError) {
      console.error(attendanceError);
      return new NextResponse("Error fetching attendances", { status: 500 });
    }

    // Fetch C: all payments for current session or monthly slot, plus annual dues for the session year
    const sessionYear = parts[0];
    const [
      { data: monthlyPayments, error: monthlyError },
      { data: sessionPayments, error: sessionError },
      { data: duesPayments, error: duesError },
    ] = await Promise.all([
      s.from("payments")
        .select("player_id, amount")
        .eq("concept", "monthly")
        .eq("month", selectedMonth)
        .eq("slot", genericSlot),
      s.from("payments")
        .select("player_id, amount")
        .eq("concept", "session")
        .eq("session", specificSlot),
      s.from("payments")
        .select("player_id")
        .eq("concept", "membership dues")
        .gte("month", `${sessionYear}-01`)
        .lte("month", `${sessionYear}-12`),
    ]);

    if (monthlyError) {
      console.error(monthlyError);
      return new NextResponse("Error fetching monthly payments", { status: 500 });
    }
    if (sessionError) {
      console.error(sessionError);
      return new NextResponse("Error fetching session payments", { status: 500 });
    }
    if (duesError) {
      console.error(duesError);
      return new NextResponse("Error fetching dues payments", { status: 500 });
    }

    const paidDuesIds = new Set((duesPayments || []).map(d => d.player_id));

    // Build attendance and payment maps
    const attendanceMap = new Map(
      (attendances || []).map(a => [a.player_id, a.attended])
    );

    const paymentMap = new Map<string, number>();
    const hasPaymentMap = new Map<string, boolean>();
    for (const p of (monthlyPayments || [])) {
      paymentMap.set(p.player_id, (paymentMap.get(p.player_id) || 0) + p.amount);
      hasPaymentMap.set(p.player_id, true);
    }
    for (const p of (sessionPayments || [])) {
      paymentMap.set(p.player_id, (paymentMap.get(p.player_id) || 0) + p.amount);
      hasPaymentMap.set(p.player_id, true);
    }

    // Assign category players to sections
    const knownIds = new Set<string>();
    const result: Array<Record<string, unknown> & { section: Section }> = [];

    for (const player of (categoryPlayers || [])) {
      knownIds.add(player.id);
      const section: Section =
        player.player_type === "goalkeeper" ? "arqueros" :
        player.invitee ? "invitados" :
        "jugadores";

      result.push({
        ...player,
        attended: attendanceMap.get(player.id) || false,
        payments: paymentMap.get(player.id) || 0,
        hasSessionPayment: hasPaymentMap.get(player.id) || false,
        paidMembershipDues: paidDuesIds.has(player.id),
        section,
      });
    }

    // On goalkeeper-friendly slots, every goalkeeper shows up in the arqueros
    // section regardless of their category.
    if (slot.goalies) {
      const { data: allGoalkeepers, error: gkError } = await s
        .from("players")
        .select("*")
        .eq("player_type", "goalkeeper")
        .order("last_name")
        .order("name");

      if (gkError) {
        console.error(gkError);
        return new NextResponse("Error fetching goalkeepers", { status: 500 });
      }

      for (const player of (allGoalkeepers || [])) {
        if (knownIds.has(player.id)) continue;
        knownIds.add(player.id);
        result.push({
          ...player,
          attended: attendanceMap.get(player.id) || false,
          payments: paymentMap.get(player.id) || 0,
          hasSessionPayment: hasPaymentMap.get(player.id) || false,
          paidMembershipDues: paidDuesIds.has(player.id),
          section: "arqueros",
        });
      }
    }

    // Collect extra player IDs from attendances and payments (not already in category+trains)
    const extraIds = new Set<string>();
    for (const a of (attendances || [])) {
      if (a.attended && !knownIds.has(a.player_id)) extraIds.add(a.player_id);
    }
    for (const p of (sessionPayments || [])) {
      if (!knownIds.has(p.player_id)) extraIds.add(p.player_id);
    }
    for (const p of (monthlyPayments || [])) {
      if (!knownIds.has(p.player_id)) extraIds.add(p.player_id);
    }

    // Fetch extra players
    if (extraIds.size > 0) {
      const { data: extraPlayers } = await s
        .from("players")
        .select("*")
        .in("id", Array.from(extraIds))
        .order("last_name")
        .order("name");

      for (const player of (extraPlayers || [])) {
        knownIds.add(player.id);
        const section: Section =
          player.player_type === "goalkeeper" ? "arqueros" : "invitados";

        result.push({
          ...player,
          attended: attendanceMap.get(player.id) || false,
          payments: paymentMap.get(player.id) || 0,
          hasSessionPayment: hasPaymentMap.get(player.id) || false,
          paidMembershipDues: paidDuesIds.has(player.id),
          section,
        });
      }
    }

    // Ledger enrichment (lib/ledger.ts): each player's debt, bonified
    // sessions and this month's payment presets, from their history since
    // LEDGER_FROM. Sessions older than that keep the legacy threshold logic
    // client-side.
    const semStart = Number(parts[1]) <= 6 ? `${parts[0]}-01` : `${parts[0]}-07`;
    const carryFrom = semStart > LEDGER_FROM ? semStart : LEDGER_FROM;
    const extras = new Map<string, Record<string, unknown>>();

    if (selectedMonth >= LEDGER_FROM && result.length > 0) {
      const ids = Array.from(knownIds);
      const [pricesRes, slotsRes, payRes, attRes] = await Promise.all([
        s.from("prices")
          .select("valid_from,session_price,prepaid_session_price")
          .order("valid_from"),
        s.from("training_slots")
          .select("date,categories,goalies")
          .gte("date", `${carryFrom}-01`)
          .lte("date", `${selectedMonth}-31`),
        s.from("payments")
          .select("player_id,month,concept,amount")
          .in("player_id", ids)
          .gte("month", carryFrom)
          .lte("month", selectedMonth)
          .in("concept", ["monthly", "session"]),
        s.from("attendances")
          .select("player_id,session")
          .in("player_id", ids)
          .eq("attended", true)
          .gte("session", `${carryFrom}-01`),
      ]);

      const ledgerError = pricesRes.error ?? slotsRes.error ?? payRes.error ?? attRes.error;
      if (ledgerError || (pricesRes.data ?? []).length === 0) {
        // The roster is useful without the ledger; log and move on.
        console.error("Ledger lookup failed:", ledgerError);
      } else {
        const prices = (pricesRes.data ?? []).map((p) => ({
          valid_from: String(p.valid_from),
          session_price: Number(p.session_price),
          prepaid_session_price: Number(p.prepaid_session_price),
        }));
        const slotDays = (slotsRes.data ?? []).map((r) => ({
          date: String(r.date),
          categories: (r.categories ?? []) as string[],
          goalies: Boolean(r.goalies),
        }));

        const byPlayer = new Map<string, Map<string, MonthActivity>>();
        const activityOf = (playerId: string, month: string): MonthActivity => {
          if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Map());
          const months = byPlayer.get(playerId)!;
          if (!months.has(month)) {
            months.set(month, { attended: 0, paidMonthly: false, totalPaid: 0 });
          }
          return months.get(month)!;
        };

        for (const p of payRes.data ?? []) {
          const a = activityOf(p.player_id, p.month);
          a.totalPaid += Number(p.amount);
          if (p.concept === "monthly") a.paidMonthly = true;
        }
        for (const a of attRes.data ?? []) {
          const month = String(a.session).slice(0, 7);
          if (month <= selectedMonth) activityOf(a.player_id, month).attended += 1;
        }

        for (const player of result) {
          const playerId = player.id as string;
          const scholarship = Number(player.scholarship) || 0;
          const trainings = trainingsFor(
            slotDays,
            (player.categories ?? []) as string[],
            player.player_type === "goalkeeper",
          );
          const byMonth = byPlayer.get(playerId) ?? new Map<string, MonthActivity>();
          const historyMonths = [...new Set([...trainings.keys(), ...byMonth.keys()])]
            .filter((m) => m >= carryFrom && m < selectedMonth)
            .sort();

          const { state, rows } = runLedger(historyMonths, byMonth, trainings, prices, scholarship);

          const price = priceFor(prices, selectedMonth);
          const nMonth = trainings.get(selectedMonth) ?? 0;
          const activityNow = byMonth.get(selectedMonth) ??
            { attended: 0, paidMonthly: false, totalPaid: 0 };
          const now = ledgerStep(state, activityNow, price, nMonth, scholarship);

          const k = (100 - scholarship) / 100;
          const prepaidUnit = Math.round(price.prepaid_session_price * k);
          extras.set(playerId, {
            carryover_sessions: state.carryoverIn,
            debt: state.debt,
            debt_months: rows
              .filter((r) => r.charge > r.paid)
              .map((r) => ({ month: r.month, charge: r.charge, paid: r.paid })),
            month_preset: nMonth >= MinBundleTrainings
              ? Math.max(0, nMonth - state.carryoverIn) * prepaidUnit
              : null,
            session_preset: Math.round(price.session_price * k),
            owes_now: now.charge > activityNow.totalPaid,
          });
        }
      }
    }

    const ledgerDefaults = {
      carryover_sessions: 0,
      debt: 0,
      debt_months: [],
      month_preset: null,
      session_preset: null,
      owes_now: null,
    };

    return NextResponse.json({
      players: result.map((p) => ({
        ...p,
        ...(extras.get(p.id as string) ?? ledgerDefaults),
      })),
      slot: { categories: cats, goalies: slot.goalies },
    });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
