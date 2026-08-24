import type { SupabaseClient } from "@supabase/supabase-js";
import { requireFeatures } from "./slotFeatures";
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
  /** Would this month be unpaid with the player marked present at this
   * session? And absent? Both are precomputed so the screen can move a row
   * between sections — and in or out of Deudores — without a round trip. */
  owes_if_present: boolean;
  owes_if_absent: boolean;
  /** Pesos still owed for this month right now — what a fresh payment has to
   * cover for the row to stop counting as a debtor. */
  owed_now: number;
  /** Last month only: what was left unpaid, plus the attendance and payments
   * behind it. Debt older than that is not what this screen is chasing. */
  prev_owed: number;
  prev_attended: number;
  prev_paid: number;
  cur_attended: number;
  cur_paid: number;
};

/** The month before `month` (YYYY-MM). */
function monthBefore(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 1
    ? `${year - 1}-12`
    : `${year}-${String(m - 1).padStart(2, "0")}`;
}

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
  owes_if_present: false,
  owes_if_absent: false,
  owed_now: 0,
  prev_owed: 0,
  prev_attended: 0,
  prev_paid: 0,
  cur_attended: 0,
  cur_paid: 0,
};

type RosterPlayer = {
  id: string;
  categories?: string[] | null;
  player_type?: string | null;
  scholarship?: number | null;
  /** Whether they are currently marked present at the session being viewed. */
  attendedThisSession?: boolean;
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
    s.from("training_sessions_resolved")
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
  // A session whose slot has no features would silently count as belonging to
  // no category, shrinking every month it falls in. Refuse instead.
  const slotDays = (slotsRes.data ?? []).map((r) => {
    const f = requireFeatures(r, String(r.date));
    return { date: String(r.date), categories: f.categories, goalies: f.goalies };
  });

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

    // The same month with this session's attendance forced on and off. The
    // screen flips between them the instant a row is toggled.
    const owesWith = (attended: number) => {
      const step = ledgerStep(state, { ...activityNow, attended }, price, nMonth, scholarship);
      return step.charge > activityNow.totalPaid;
    };
    const here = player.attendedThisSession ? 1 : 0;
    const owesIfPresent = owesWith(activityNow.attended - here + 1);
    const owesIfAbsent = owesWith(Math.max(0, activityNow.attended - here));

    const prevMonth = monthBefore(selectedMonth);
    const prevRow = rows.find((r) => r.month === prevMonth);
    const prevActivity = byMonth.get(prevMonth) ??
      { attended: 0, paidMonthly: false, totalPaid: 0 };

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
      owes_if_present: owesIfPresent,
      owes_if_absent: owesIfAbsent,
      owed_now: Math.max(0, now.charge - activityNow.totalPaid),
      prev_owed: prevRow ? Math.max(0, prevRow.charge - prevRow.paid) : 0,
      prev_attended: prevActivity.attended,
      prev_paid: prevActivity.totalPaid,
      cur_attended: activityNow.attended,
      cur_paid: activityNow.totalPaid,
    });
  }

  return extras;
}
