// The token ledger. THE single implementation: imported by the Next dashboard
// (as @shared/tokens) and by the WhatsApp webhook (relative path). Kept free of
// imports so both module systems consume it unchanged.
//
// See docs/modelo-de-cobros.md for the model this encodes.
//
// In one paragraph: a payment does not buy a month or a session, it buys
// TOKENS, each of which is the right to attend one session. What a token cost
// depends on how the admin sold it — promotional (monthly) or normal
// (individual) — and is frozen at the sale. Attendances consume tokens.
// Whatever the month leaves unused may become the next month's opening
// balance, which is all "carryover" means.

export type Rates = {
  /** A session bought on its own. */
  session_price: number;
  /** A session bought as part of a month, paid upfront. */
  prepaid_session_price: number;
  /** Goalkeepers pay this either way — their month is just this times the
   * sessions of their slot, with no discount to give. */
  goalkeeper_session_price: number;
};

export type LedgerPrice = Rates & { valid_from: string };

// Carryover/debt accounting starts with the 2026 second semester. Earlier
// months were settled through the ad-hoc overrides in lib/thresholds.ts
// (deprecated); computing them with current tariffs would invent debts that
// never existed.
export const LEDGER_FROM = "2026-08";

/**
 * The club's activity periods, and the window every calculation is clamped to:
 * debt and carryover accumulate inside a period and do not cross into the next
 * one. Anything spanning periods is a discretionary, manual analysis.
 *
 * They are NOT calendar semesters: the club trains March through July, and
 * August through December. January and February are the summer break — no
 * training happens, so they get a period of their own that is always empty.
 */
export function periodMonths(month: string): string[] {
  const year = month.slice(0, 4);
  const m = Number(month.slice(5, 7));
  const [from, to] = m >= 8 ? [8, 12] : m >= 3 ? [3, 7] : [1, 2];
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${year}-${String(i).padStart(2, "0")}`);
  return out;
}

/** First month of the period `month` belongs to, as YYYY-MM. */
export function periodStart(month: string): string {
  return periodMonths(month)[0];
}

/** The tariff in force at the start of a month: the newest price whose
 * valid_from is not after it, falling back to the oldest known one. */
export function priceFor(prices: LedgerPrice[], month: string): LedgerPrice {
  if (prices.length === 0) throw new Error("No prices configured");
  const applicable = prices.filter((p) => p.valid_from <= `${month}-01`);
  return applicable[applicable.length - 1] ?? prices[0];
}

export type SlotDay = {
  date: string; // YYYY-MM-DD
  categories: string[];
  goalies: boolean;
};

/** Trainings per month for one slot-group: distinct dates with a slot for any
 * of the given categories (or any goalie-friendly slot, for goalkeepers).
 * Every player of a category shares the same n — the month's price follows;
 * carryover is the only per-player variable. */
export function trainingsFor(
  slots: SlotDay[],
  categories: string[],
  goalkeeper: boolean,
): Map<string, number> {
  const byMonth = new Map<string, Set<string>>();
  for (const s of slots) {
    const matches = goalkeeper
      ? s.goalies
      : s.categories.some((c) => categories.includes(c));
    if (!matches) continue;
    const month = s.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, new Set());
    byMonth.get(month)!.add(s.date);
  }
  return new Map([...byMonth].map(([m, dates]) => [m, dates.size]));
}


/** A slot, as the pair that identifies it: `${weekday}-${hour}`. */
export type SlotKey = string;

export function slotKey(weekday: number, hour: number): SlotKey {
  return `${weekday}-${hour}`;
}

export type PaymentConcept = "monthly" | "session" | "debt settlement";

export type MonthPayment = {
  concept: PaymentConcept;
  amount: number;
  /** Where the money was taken. Only a monthly payment is bound by it. */
  slot: SlotKey;
};

export type MonthInput = {
  /** Attendances the club actually charges for — goalkeepers outside their
   * slot, youth second sessions and discretionary bonifications are already
   * filtered out by billableAttendances(). */
  attendances: { slot: SlotKey }[];
  payments: MonthPayment[];
  /** How many sessions each slot really held this month. */
  sessionsPerSlot: Map<SlotKey, number>;
};

export type LedgerState = {
  /** Pesos owed from months that already closed. */
  debt: number;
  /** Tokens inherited from last month. Usable at any slot, and they die at the
   * end of this one — there is no second hop. */
  carryover: number;
};

export const EMPTY_STATE: LedgerState = { debt: 0, carryover: 0 };

export type MonthResult = {
  next: LedgerState;
  /** Pesos the month is still waiting for, right now: what unsettled partial
   * months owe plus attendances no token covered. Shown as debt while the
   * month runs, even though closing may forgive part of it. */
  pending: number;
  /** Tokens the month's payments made available, opening balance aside. */
  granted: number;
  /** Tokens the attendances consumed. */
  used: number;
  /** Tokens handed to the next month. */
  carryoverOut: number;
};

/** The rates a player actually pays. Goalkeepers have one price that serves as
 * both, so the promotional month gives them no discount — just the convenience
 * of paying once. */
export function ratesFor(price: Rates, goalkeeper: boolean, scholarship: number): {
  individual: number;
  promo: number;
} {
  const k = (100 - scholarship) / 100;
  const gk = Math.round(price.goalkeeper_session_price * k);
  return goalkeeper
    ? { individual: gk, promo: gk }
    : {
      individual: Math.round(price.session_price * k),
      promo: Math.round(price.prepaid_session_price * k),
    };
}

/**
 * One month of the ledger.
 *
 * Tokens are burned in the order of what expires soonest, so the player keeps
 * the most flexible ones: the opening balance first (it dies at month end with
 * no recourse), then the promotional tokens of the slot being attended (they
 * die too, unless the club failed to hold the sessions they paid for), and the
 * individual ones last (those carry freely).
 */
export function ledgerMonth(
  state: LedgerState,
  input: MonthInput,
  price: Rates,
  goalkeeper: boolean,
  scholarship: number,
): MonthResult {
  const { individual, promo } = ratesFor(price, goalkeeper, scholarship);

  // --- What each slot's monthly payments bought.
  //
  // A partial monthly is an ANTICIPO, not a proportional purchase: it grants
  // the whole month's sessions and leaves the rest as an obligation in pesos.
  // Paying for MORE sessions than the slot held is the other direction — the
  // club charged for a training it did not give — and that surplus is the only
  // promotional carryover there is.
  const promoBySlot = new Map<SlotKey, { granted: number; paid: number; held: number }>();
  for (const p of input.payments) {
    if (p.concept !== "monthly") continue;
    const held = input.sessionsPerSlot.get(p.slot) ?? 0;
    const entry = promoBySlot.get(p.slot) ?? { granted: 0, paid: 0, held };
    entry.paid += p.amount;
    promoBySlot.set(p.slot, entry);
  }
  for (const [, e] of promoBySlot) {
    const paidTokens = promo > 0 ? e.paid / promo : 0;
    e.granted = Math.max(e.held, paidTokens);
  }

  // --- Individual tokens: what the money bought, at the normal rate, usable
  // anywhere.
  const individualPaid = input.payments
    .filter((p) => p.concept === "session")
    .reduce((sum, p) => sum + p.amount, 0);
  let individualLeft = individual > 0 ? individualPaid / individual : 0;

  // --- Consumption.
  let carryLeft = state.carryover;
  const promoLeft = new Map<SlotKey, number>(
    [...promoBySlot].map(([k, e]) => [k, e.granted]),
  );
  let uncovered = 0;
  let used = 0;

  for (const a of input.attendances) {
    // Cheapest to lose first, and fractions pay their part: half a token
    // covers half a session and the rest stays owed.
    let need = 1;

    const fromCarry = Math.min(carryLeft, need);
    carryLeft -= fromCarry;
    need -= fromCarry;

    const availPromo = promoLeft.get(a.slot) ?? 0;
    const fromPromo = Math.min(availPromo, need);
    if (fromPromo > 0) promoLeft.set(a.slot, availPromo - fromPromo);
    need -= fromPromo;

    const fromIndividual = Math.min(individualLeft, need);
    individualLeft -= fromIndividual;
    need -= fromIndividual;

    uncovered += need;
    used += 1;
  }

  // --- What the month is still waiting for.
  //
  // An attendance nobody's token covered is owed at the individual rate: the
  // discount is earned by paying ahead, not by training a lot.
  let pending = Math.round(uncovered * individual);

  // A monthly that never reached the month's price owes the difference. The
  // attendances at that slot do NOT also owe individually — they were settled
  // through the month.
  const attendancesBySlot = new Map<SlotKey, number>();
  for (const a of input.attendances) {
    attendancesBySlot.set(a.slot, (attendancesBySlot.get(a.slot) ?? 0) + 1);
  }
  let forgivable = 0;
  for (const [slot, e] of promoBySlot) {
    const full = Math.round(e.held * promo);
    if (e.paid >= full) continue;
    const short = full - e.paid;
    pending += short;
    // Closing the month forgives that shortfall — but only for someone who
    // barely used the month: what they paid has to cover the sessions they
    // did attend at the individual rate.
    const attended = attendancesBySlot.get(slot) ?? 0;
    if (e.paid >= Math.round(attended * individual)) forgivable += short;
  }

  // --- Debt settlements pay down what closed months left.
  const settled = input.payments
    .filter((p) => p.concept === "debt settlement")
    .reduce((sum, p) => sum + p.amount, 0);
  const debt = Math.max(0, state.debt - settled) + (pending - forgivable);

  // --- What the next month opens with.
  //
  // Promotional tokens only come back to the extent the club did not hold the
  // sessions it charged for; individual ones come back whatever the reason.
  // The opening balance itself never hops twice.
  let carryoverOut = individualLeft;
  for (const [slot, e] of promoBySlot) {
    const paidTokens = promo > 0 ? e.paid / promo : 0;
    const clubShortfall = Math.max(0, paidTokens - e.held);
    carryoverOut += Math.min(promoLeft.get(slot) ?? 0, clubShortfall);
  }

  return {
    next: { debt, carryover: carryoverOut },
    pending,
    granted: [...promoBySlot.values()].reduce((s, e) => s + e.granted, 0) +
      (individual > 0 ? individualPaid / individual : 0),
    used,
    carryoverOut,
  };
}

// ////////////////////////////////////
// WHICH ATTENDANCES ARE CHARGED
// ////////////////////////////////////

/** The category whose players get a second session of the same day for free. */
export const BonusCategory = "youth";

export type AttendanceRow = {
  /** YYYY-MM-DD of the session. */
  date: string;
  slot: SlotKey;
  /** The slot's categories AS OF that date. */
  categories: string[];
  /** Whether that slot is the goalkeepers' one. */
  goalies: boolean;
  /** The admin decided not to charge this one — a make-up in another slot, or
   * any one-off arrangement. A decision, not a rule, which is why it is data. */
  bonified: boolean;
};

export type PlayerBilling = {
  goalkeeper: boolean;
  categories: string[];
};

/**
 * The attendances a player is actually charged for.
 *
 * Everything here is DERIVED, on purpose. The one exception is the admin's
 * discretionary bonification, which is a human decision and therefore an
 * input. The youth bonus in particular must not be stored: marking the 22hs
 * attendance before the 21hs one, or unmarking the 21hs one afterwards, would
 * leave a stored flag saying the opposite of the truth — and with the wheel,
 * marking and unmarking is the easiest thing on the screen.
 */
export function billableAttendances(
  rows: AttendanceRow[],
  player: PlayerBilling,
): { slot: SlotKey }[] {
  // The admin's call wins over everything.
  let kept = rows.filter((r) => !r.bonified);

  // A goalkeeper pays for their own slot and nothing else: showing up at 22hs
  // or 23hs costs them nothing.
  if (player.goalkeeper) {
    return kept.filter((r) => r.goalies).map((r) => ({ slot: r.slot }));
  }

  if (player.categories.includes(BonusCategory)) {
    // Attending the session of their own category buys one other session that
    // same day. Which one is dropped does not change the money — every
    // session costs the same — so the earliest slot goes, deterministically.
    const byDate = new Map<string, AttendanceRow[]>();
    for (const r of kept) {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date)!.push(r);
    }
    const free = new Set<AttendanceRow>();
    for (const [, sameDay] of byDate) {
      const own = sameDay.find((r) =>
        r.categories.some((c) => player.categories.includes(c))
      );
      if (!own) continue;
      const other = sameDay
        .filter((r) => r !== own)
        .sort((a, b) => a.slot.localeCompare(b.slot))[0];
      if (other) free.add(other);
    }
    kept = kept.filter((r) => !free.has(r));
  }

  return kept.map((r) => ({ slot: r.slot }));
}
