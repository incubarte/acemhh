import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEDGER_FROM,
  ledgerStep,
  MinBundleTrainings,
  priceFor,
  runLedger,
  trainingsFor,
  type MonthActivity,
} from "@/lib/ledger";

export type LedgerExtras = {
  /** Bonified sessions from last month (club's fault), usable this month. */
  carryover_sessions: number;
  /** Accumulated unpaid pesos from earlier months. */
  debt: number;
  debt_months: { month: string; charge: number; paid: number }[];
  /** This month's bundle for the player, carryover-adjusted; null = no bundle. */
  month_preset: number | null;
  session_preset: number | null;
  /** Whether this month's charge is currently unpaid; null on pre-ledger sessions. */
  owes_now: boolean | null;
  /** The player bought this month's bundle (fully). */
  bought_month: boolean;
  /** Trainings attended in the session's month — a player with none has
   * nothing settled, they simply have not shown up. */
  attended_this_month: number;
  /** Pesos paid for the session's month. */
  paid_this_month: number;
};

/** First day of the month after `month` (YYYY-MM), as YYYY-MM-DD. */
function monthAfter(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

export const LEDGER_DEFAULTS: LedgerExtras = {
  carryover_sessions: 0,
  debt: 0,
  debt_months: [],
  month_preset: null,
  session_preset: null,
  owes_now: null,
  bought_month: false,
  attended_this_month: 0,
  paid_this_month: 0,
};

type RosterPlayer = {
  id: string;
  categories?: string[] | null;
  player_type?: string | null;
  scholarship?: number | null;
};

/** Each roster player's ledger enrichment for a session month: debt, bonified
 * sessions, presets and whether this month is settled. Sessions older than
 * LEDGER_FROM get no enrichment (legacy threshold logic applies client-side). */
export async function ledgerExtrasFor(
  s: SupabaseClient,
  players: RosterPlayer[],
  selectedMonth: string,
): Promise<Map<string, LedgerExtras>> {
  const extras = new Map<string, LedgerExtras>();
  if (selectedMonth < LEDGER_FROM || players.length === 0) return extras;

  const [year, mm] = [selectedMonth.slice(0, 4), selectedMonth.slice(5, 7)];
  const semStart = Number(mm) <= 6 ? `${year}-01` : `${year}-07`;
  const carryFrom = semStart > LEDGER_FROM ? semStart : LEDGER_FROM;
  const ids = players.map((p) => p.id);

  const [pricesRes, slotsRes, payRes, attRes] = await Promise.all([
    s.from("prices")
      .select("valid_from,session_price,prepaid_session_price")
      .order("valid_from"),
    s.from("training_slots")
      .select("date,categories,goalies")
      .gte("date", `${carryFrom}-01`)
      // Bounded by the first of the NEXT month: "YYYY-09-31" is not a date,
      // and Postgres rejects the whole query rather than clamping it.
      .lt("date", monthAfter(selectedMonth)),
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
    return extras;
  }

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

  for (const player of players) {
    const scholarship = Number(player.scholarship) || 0;
    const trainings = trainingsFor(
      slotDays,
      (player.categories ?? []) as string[],
      player.player_type === "goalkeeper",
    );
    const byMonth = byPlayer.get(player.id) ?? new Map<string, MonthActivity>();
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
    extras.set(player.id, {
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
      bought_month: now.bought,
      attended_this_month: activityNow.attended,
      paid_this_month: activityNow.totalPaid,
    });
  }

  return extras;
}
