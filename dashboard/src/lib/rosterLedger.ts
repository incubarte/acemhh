import type { SupabaseClient } from "@supabase/supabase-js";
import { requireFeatures } from "./slotFeatures";
import { isoWeekday } from "@shared/slot";
import {
  billableAttendances,
  EMPTY_STATE,
  type AttendanceRow,
  type LedgerPrice,
  type LedgerState,
  ledgerMonth,
  type MonthInput,
  type MonthPayment,
  LEDGER_FROM,
  periodStart,
  priceFor,
  ratesFor,
  type SlotKey,
  slotKey,
} from "@shared/tokens";

/** What the attendance screens add to each roster row, on top of the player. */
export type LedgerExtras = {
  /** Tokens this month opened with, inherited from the last one. */
  carryover_sessions: number;
  /** Pesos owed from months that already closed. */
  debt: number;
  /** Of that, what is still outstanding once this month's debt payments are
   * taken off. `debt` is the figure ENTERING the month, so on its own it never
   * moves however much the player settles today. */
  debt_outstanding: number;
  /** Which closed months are behind that debt. */
  debt_months: { month: string; charge: number; paid: number }[];
  /** What this screen's slot costs for the whole month, at the promotional
   * rate. Null when the slot holds no sessions this month. */
  month_preset: number | null;
  /** What one session costs this player on its own. */
  session_preset: number | null;
  /** What the sessions still to come cost — this session included. Only for
   * somebody starting the period late. Null when there is nothing left, or
   * when they have already paid something this period. */
  half_month_preset: number | null;
  /** Pesos this month is still waiting for. Shown as debt while the month
   * runs, even though closing it may forgive part. */
  owed_now: number;
  owes_now: boolean | null;
  /** A monthly payment covers this screen's slot for the month. */
  bought_month: boolean;
  /** The same month with this session's attendance forced on and off, so the
   * screen can flip the instant a row is toggled. */
  owes_if_present: boolean;
  owes_if_absent: boolean;
  prev_owed: number;
  prev_attended: number;
  prev_paid: number;
  cur_attended: number;
  cur_paid: number;
};

export const LEDGER_DEFAULTS: LedgerExtras = {
  carryover_sessions: 0,
  debt: 0,
  debt_outstanding: 0,
  debt_months: [],
  month_preset: null,
  session_preset: null,
  half_month_preset: null,
  owed_now: 0,
  owes_now: null,
  bought_month: false,
  owes_if_present: false,
  owes_if_absent: false,
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

/** attendances.session is "YYYY-MM-DD HHhs". */
function parseSession(session: string): { date: string; hour: number } {
  return { date: session.slice(0, 10), hour: Number(session.slice(11).replace(/\D/g, "")) };
}

/**
 * Each roster player's ledger enrichment for the session being viewed: what
 * closed months left owing, what this month is still waiting for, and the
 * amounts the payment modal offers.
 *
 * Sessions older than LEDGER_FROM get no enrichment — computing them with
 * today's tariffs would invent debts that never existed.
 */
export async function ledgerExtrasFor(
  s: SupabaseClient,
  players: RosterPlayer[],
  session: string,
): Promise<Map<string, LedgerExtras>> {
  const extras = new Map<string, LedgerExtras>();
  const isoDate = session.slice(0, 10);
  const selectedMonth = isoDate.slice(0, 7);
  const screenSlot = slotKey(isoWeekday(isoDate), Number(session.slice(11)));
  if (selectedMonth < LEDGER_FROM || players.length === 0) return extras;

  // Debt and carryover accumulate inside a period and never cross into the
  // next one.
  const start = periodStart(selectedMonth);
  const carryFrom = start > LEDGER_FROM ? start : LEDGER_FROM;
  const ids = players.map((p) => p.id);

  const [pricesRes, sessionsRes, payRes, attRes] = await Promise.all([
    s.from("prices")
      .select("valid_from,session_price,prepaid_session_price,goalkeeper_session_price")
      .order("valid_from"),
    s.from("training_sessions_resolved")
      .select("date,hour,categories,goalies")
      .gte("date", `${carryFrom}-01`)
      // Bounded by the first of the NEXT month: "YYYY-09-31" is not a date,
      // and Postgres rejects the whole query rather than clamping it.
      .lt("date", monthAfter(selectedMonth)),
    s.from("payments")
      .select("player_id,month,concept,amount,slot_weekday,slot_hour,session")
      .in("player_id", ids)
      .gte("month", carryFrom)
      .lte("month", selectedMonth)
      .in("concept", ["monthly", "session", "half month", "debt settlement"]),
    s.from("attendances")
      .select("player_id,session,bonified")
      .in("player_id", ids)
      .eq("attended", true)
      .gte("session", `${carryFrom}-01`),
  ]);

  const ledgerError = pricesRes.error ?? sessionsRes.error ?? payRes.error ?? attRes.error;
  if (ledgerError || (pricesRes.data ?? []).length === 0) {
    // The roster is useful without the ledger; log and move on.
    console.error("Ledger lookup failed:", ledgerError);
    return extras;
  }

  const prices: LedgerPrice[] = (pricesRes.data ?? []).map((p) => ({
    valid_from: String(p.valid_from),
    session_price: Number(p.session_price),
    prepaid_session_price: Number(p.prepaid_session_price),
    goalkeeper_session_price: Number(p.goalkeeper_session_price),
  }));

  // The agenda, indexed two ways: what each session was, and how many sessions
  // each slot held each month.
  const featuresAt = new Map<string, { categories: string[]; goalies: boolean; slot: string }>();
  const sessionsPerSlot = new Map<string, Map<string, number>>();
  for (const r of sessionsRes.data ?? []) {
    const date = String(r.date);
    const f = requireFeatures(r, `${date} ${r.hour}hs`);
    const slot = slotKey(isoWeekday(date), Number(r.hour));
    featuresAt.set(`${date}|${r.hour}`, { ...f, slot });

    const month = date.slice(0, 7);
    if (!sessionsPerSlot.has(month)) sessionsPerSlot.set(month, new Map());
    const perSlot = sessionsPerSlot.get(month)!;
    perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1);
  }

  // Per player, per month: what they attended and what they paid.
  const attByPlayer = new Map<string, Map<string, AttendanceRow[]>>();
  for (const a of attRes.data ?? []) {
    const { date, hour } = parseSession(String(a.session));
    const month = date.slice(0, 7);
    if (month < carryFrom || month > selectedMonth) continue;
    const f = featuresAt.get(`${date}|${hour}`);
    // An attendance at a session the agenda no longer has cannot be priced —
    // there is no slot to charge it to. Leaving it out is the honest read.
    if (!f) continue;
    if (!attByPlayer.has(a.player_id)) attByPlayer.set(a.player_id, new Map());
    const months = attByPlayer.get(a.player_id)!;
    if (!months.has(month)) months.set(month, []);
    months.get(month)!.push({
      date,
      slot: f.slot,
      categories: f.categories,
      goalies: f.goalies,
      bonified: Boolean(a.bonified),
    });
  }

  const payByPlayer = new Map<string, Map<string, MonthPayment[]>>();
  for (const p of payRes.data ?? []) {
    if (p.slot_weekday === null || p.slot_hour === null) continue;
    if (!payByPlayer.has(p.player_id)) payByPlayer.set(p.player_id, new Map());
    const months = payByPlayer.get(p.player_id)!;
    if (!months.has(p.month)) months.set(p.month, []);
    months.get(p.month)!.push({
      concept: p.concept as MonthPayment["concept"],
      amount: Number(p.amount),
      slot: slotKey(Number(p.slot_weekday), Number(p.slot_hour)),
      // A half month bought the sessions that were still to come when it was
      // sold, which is what its own session marks.
      ...(p.concept === "half month" && p.session
        ? { coversSessions: sessionsFrom(String(p.session).slice(0, 10),
              slotKey(Number(p.slot_weekday), Number(p.slot_hour))) }
        : {}),
    });
  }

  /** Sessions of a slot in their month from `date` onward, that one included.
   * What a half month sold on that date is entitled to. */
  function sessionsFrom(date: string, slot: SlotKey): number {
    return [...featuresAt.entries()].filter(([key, f]) =>
      f.slot === slot &&
      key.slice(0, 10) >= date &&
      key.slice(0, 7) === date.slice(0, 7)
    ).length;
  }

  const monthsUpTo = (last: string) => {
    const out: string[] = [];
    let m = carryFrom;
    while (m <= last) {
      out.push(m);
      const [y, mm] = m.split("-").map(Number);
      m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
    }
    return out;
  };
  const history = monthsUpTo(monthBefore(selectedMonth));

  for (const player of players) {
    const scholarship = Number(player.scholarship) || 0;
    const goalkeeper = player.player_type === "goalkeeper";
    const billing = {
      goalkeeper,
      categories: (player.categories ?? []) as string[],
    };
    const attMonths = attByPlayer.get(player.id) ?? new Map<string, AttendanceRow[]>();
    const payMonths = payByPlayer.get(player.id) ?? new Map<string, MonthPayment[]>();

    /** The youth slot's month is paid: that is what buys the bonus. */
    const bonusPaid = (month: string) =>
      (payMonths.get(month) ?? []).some((p) =>
        (p.concept === "monthly" || p.concept === "half month") &&
        [...featuresAt.values()].some((f) =>
          f.slot === p.slot && f.categories.includes("youth")
        )
      );

    const inputFor = (month: string, attendances: AttendanceRow[]): MonthInput => ({
      attendances: billableAttendances(attendances, billing, bonusPaid(month)),
      payments: payMonths.get(month) ?? [],
      sessionsPerSlot: sessionsPerSlot.get(month) ?? new Map(),
    });

    // Closed months, in order: they are what "debt" means.
    let state: LedgerState = EMPTY_STATE;
    const debtMonths: LedgerExtras["debt_months"] = [];
    for (const month of history) {
      const before = state.debt;
      const r = ledgerMonth(
        state,
        inputFor(month, attMonths.get(month) ?? []),
        priceFor(prices, month),
        goalkeeper,
        scholarship,
      );
      const added = r.next.debt - before;
      if (added > 0) {
        const paid = (payMonths.get(month) ?? []).reduce((sum, p) => sum + p.amount, 0);
        debtMonths.push({ month, charge: added + paid, paid });
      }
      state = r.next;
    }

    const price = priceFor(prices, selectedMonth);
    const rates = ratesFor(price, goalkeeper, scholarship);
    const nowAttendances = attMonths.get(selectedMonth) ?? [];
    const now = ledgerMonth(
      state, inputFor(selectedMonth, nowAttendances), price, goalkeeper, scholarship,
    );

    // The same month with this session's attendance forced on and off.
    const withoutThis = nowAttendances.filter(
      (a) => !(a.date === isoDate && a.slot === screenSlot),
    );
    const thisOne: AttendanceRow = {
      date: isoDate,
      slot: screenSlot,
      categories: featuresAt.get(`${isoDate}|${Number(session.slice(11))}`)?.categories ?? [],
      goalies: featuresAt.get(`${isoDate}|${Number(session.slice(11))}`)?.goalies ?? false,
      bonified: false,
    };
    const owesWith = (attendances: AttendanceRow[]) =>
      ledgerMonth(state, inputFor(selectedMonth, attendances), price, goalkeeper, scholarship)
        .pending > 0;

    const prevMonth = monthBefore(selectedMonth);
    const prevBillable = billableAttendances(
      attMonths.get(prevMonth) ?? [], billing, bonusPaid(prevMonth),
    );
    const prevPaid = (payMonths.get(prevMonth) ?? []).reduce((s, p) => s + p.amount, 0);
    const prevRow = debtMonths.find((d) => d.month === prevMonth);

    const heldThisMonth = sessionsPerSlot.get(selectedMonth)?.get(screenSlot) ?? 0;
    // Half month is for the player's FIRST payment of the period. Membership
    // dues are orthogonal and never counted here.
    const paidSomethingThisPeriod = [...payMonths.values()].some((ps) => ps.length > 0);
    const stillToCome = sessionsFrom(isoDate, screenSlot);
    const monthlyPaid = (payMonths.get(selectedMonth) ?? [])
      .filter((p) => p.concept === "monthly" && p.slot === screenSlot)
      .reduce((sum, p) => sum + p.amount, 0);

    const settledThisMonth = (payMonths.get(selectedMonth) ?? [])
      .filter((p) => p.concept === "debt settlement")
      .reduce((sum, p) => sum + p.amount, 0);

    extras.set(player.id, {
      carryover_sessions: state.carryover,
      debt: state.debt,
      debt_outstanding: Math.max(0, state.debt - settledThisMonth),
      debt_months: debtMonths,
      // A full scholarship has nothing to charge: no preset, rather than a
      // button offering to collect $0.
      month_preset: heldThisMonth > 0 && rates.promo > 0
        ? Math.round(heldThisMonth * rates.promo)
        : null,
      session_preset: rates.individual > 0 ? rates.individual : null,
      half_month_preset:
        !paidSomethingThisPeriod && stillToCome > 0 && stillToCome < heldThisMonth &&
          rates.promo > 0
          ? Math.round(stillToCome * rates.promo)
          : null,
      owed_now: now.pending,
      owes_now: now.pending > 0,
      bought_month: heldThisMonth > 0 && monthlyPaid >= Math.round(heldThisMonth * rates.promo),
      owes_if_present: owesWith([...withoutThis, thisOne]),
      owes_if_absent: owesWith(withoutThis),
      prev_owed: prevRow ? prevRow.charge - prevRow.paid : 0,
      prev_attended: prevBillable.length,
      prev_paid: prevPaid,
      cur_attended: billableAttendances(nowAttendances, billing, bonusPaid(selectedMonth)).length,
      cur_paid: (payMonths.get(selectedMonth) ?? []).reduce((s, p) => s + p.amount, 0),
    });
  }

  return extras;
}
