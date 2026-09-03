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
  /** The club's own goalkeepers pay this either way — their month is just
   * this times the sessions of their slot, with no discount to give. */
  goalkeeper_session_price: number;
  /** A guest goalkeeper pays more. */
  goalkeeper_invitee_session_price: number;
  /** What each sibling after the first takes off a PREPAID session. A fixed
   * amount, not a percentage: 4 x (27.500 - 5.000) is the round 90.000 the
   * club wants to charge, and no whole percentage of 110.000 is. */
  sibling_session_discount: number;
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

export type PaymentConcept =
  | "monthly"
  | "session"
  /** The sessions left of a month, for somebody starting the period late. */
  | "half month"
  | "debt settlement";

export type MonthPayment = {
  concept: PaymentConcept;
  amount: number;
  /** Where the money was taken. Only the monthly family is bound by it. */
  slot: SlotKey;
  /** For a half month: how many sessions of that slot were still to come when
   * it was sold. That is what it bought, and what the club owes against it. */
  coversSessions?: number;
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

/** The rates a player actually pays. A goalkeeper has one price that serves as
 * both, so the promotional month gives them no discount — just the convenience
 * of paying once — and a guest goalkeeper's is higher than a member's.
 *
 * The sibling discount only touches the prepaid rate: a second sibling pays
 * the month cheaper, but a session bought on its own costs the same as
 * anyone's. Goalkeepers have no prepaid rate, so it does not reach them. */
export function ratesFor(price: Rates, player: PlayerBilling): {
  individual: number;
  promo: number;
} {
  const k = (100 - player.scholarship) / 100;
  if (player.goalkeeper) {
    const gk = Math.round(
      (player.invitee
        ? price.goalkeeper_invitee_session_price
        : price.goalkeeper_session_price) * k,
    );
    return { individual: gk, promo: gk };
  }
  const siblingsBefore = Math.max(0, (player.siblingRank ?? 1) - 1);
  const prepaid = Math.max(
    0,
    price.prepaid_session_price - siblingsBefore * price.sibling_session_discount,
  );
  return {
    individual: Math.round(price.session_price * k),
    promo: Math.round(prepaid * k),
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
  player: PlayerBilling,
): MonthResult {
  const { individual, promo } = ratesFor(price, player);

  // --- What each slot's monthly payments bought.
  //
  // A partial monthly is an ANTICIPO, not a proportional purchase: it grants
  // the whole month's sessions and leaves the rest as an obligation in pesos.
  // Paying for MORE sessions than the slot held is the other direction — the
  // club charged for a training it did not give — and that surplus is the only
  // promotional carryover there is.
  const promoBySlot = new Map<SlotKey, {
    /** Tokens the slot's promotional payments made available. */
    granted: number;
    /** A full-month payment: what was paid, and what the month costs. */
    monthlyPaid: number;
    monthlyHeld: number;
    /** A half month: what was paid, and how many sessions it was sold for. */
    halfPaid: number;
    halfHeld: number;
  }>();
  const entry = (slot: SlotKey) => {
    const found = promoBySlot.get(slot) ?? {
      granted: 0,
      monthlyPaid: 0,
      monthlyHeld: input.sessionsPerSlot.get(slot) ?? 0,
      halfPaid: 0,
      halfHeld: 0,
    };
    promoBySlot.set(slot, found);
    return found;
  };

  for (const p of input.payments) {
    if (p.concept === "monthly") {
      entry(p.slot).monthlyPaid += p.amount;
    } else if (p.concept === "half month") {
      const e = entry(p.slot);
      e.halfPaid += p.amount;
      e.halfHeld += p.coversSessions ?? 0;
    }
  }

  const tokensOf = (pesos: number) => (promo > 0 ? pesos / promo : 0);
  for (const [, e] of promoBySlot) {
    // A full month is an ANTICIPO: it grants the whole month whatever was
    // paid. A half month is a plain purchase: it grants what it bought.
    const fromMonthly = e.monthlyPaid > 0
      ? Math.max(e.monthlyHeld, tokensOf(e.monthlyPaid))
      : 0;
    e.granted = fromMonthly + tokensOf(e.halfPaid);
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
    // Only a full month can fall short: a half month bought exactly what it
    // paid for, so it owes nothing and has nothing to forgive.
    if (e.monthlyPaid === 0) continue;
    const full = Math.round(e.monthlyHeld * promo);
    if (e.monthlyPaid >= full) continue;
    const short = full - e.monthlyPaid;
    pending += short;
    // Closing the month forgives that shortfall — but only for someone who
    // barely used the month: what they paid has to cover the sessions they
    // did attend at the individual rate.
    const attended = attendancesBySlot.get(slot) ?? 0;
    if (e.monthlyPaid >= Math.round(attended * individual)) forgivable += short;
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
    // Each promotional purchase is measured against what it was sold for: the
    // whole month, or the sessions that were still to come.
    const clubShortfall = Math.max(0, tokensOf(e.monthlyPaid) - e.monthlyHeld) +
      Math.max(0, tokensOf(e.halfPaid) - e.halfHeld);
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

/** Everything about a player that changes what they are charged. */
export type PlayerBilling = {
  goalkeeper: boolean;
  /** A guest, not a member of the club. Only changes a goalkeeper's rate. */
  invitee: boolean;
  scholarship: number;
  /** Which sibling of the family this is: 1 pays in full, 2 gets the sibling
   * discount once, 3 twice, and so on. Absent means 1. */
  siblingRank?: number;
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
  /** Whether the youth slot's month is paid: that is what buys the bonus. */
  bonusPaid = false,
): { slot: SlotKey }[] {
  // The admin's call wins over everything.
  let kept = rows.filter((r) => !r.bonified);

  // A goalkeeper pays for their own slot and nothing else: showing up at 22hs
  // or 23hs costs them nothing.
  if (player.goalkeeper) {
    return kept.filter((r) => r.goalies).map((r) => ({ slot: r.slot }));
  }

  if (player.categories.includes(BonusCategory)) {
    // Going to the youth session buys one ADDITIONAL session that same day.
    // The youth one is the anchor and always stays; what is free is the extra.
    //
    // Which one goes matters, and this used to get it wrong. A youth who is
    // also cat-c anchors on either session if you only ask "does this slot
    // match one of my categories" — and dropping the youth one leaves the
    // cat-c session standing, uncovered, while the month they bought for the
    // youth slot goes unused. Monthly tokens are locked to their slot, so the
    // choice is worth real money.
    const byDate = new Map<string, AttendanceRow[]>();
    for (const r of kept) {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date)!.push(r);
    }
    const free = new Set<AttendanceRow>();
    for (const [, sameDay] of byDate) {
      const anchor = sameDay.find((r) => r.categories.includes(BonusCategory));
      if (!anchor && !bonusPaid) continue;
      const extra = sameDay
        .filter((r) => r !== anchor)
        .sort((a, b) => a.slot.localeCompare(b.slot))[0];
      if (extra) free.add(extra);
    }
    kept = kept.filter((r) => !free.has(r));
  }

  return kept.map((r) => ({ slot: r.slot }));
}

// ////////////////////////////////////
// WHAT MAY BE WRITTEN, AND WHEN
// ////////////////////////////////////

/** The smallest partial a monthly payment may be. */
export const MinPartialMonthly = 40000;

/** Monday of the week a YYYY-MM-DD date falls in. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (iso - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Attendance and money may be written for the current week and the previous
 * one; anything older takes direct access to the database.
 *
 * Monday to Sunday, so a Thursday training and the cash counted at 1am on
 * Friday always fall in the same week — the two never split.
 */
export function withinWriteWindow(date: string, today: string): boolean {
  const thisWeek = weekStart(today);
  const previous = weekStart(
    new Date(new Date(`${thisWeek}T12:00:00Z`).getTime() - 7 * 86400000)
      .toISOString().slice(0, 10),
  );
  return date >= previous;
}

export type PaymentIntent = {
  concept: PaymentConcept;
  amount: number;
  slot: SlotKey;
};

export type PaymentGuard = {
  /** Pesos owed from months that already closed. */
  closedDebt: number;
  /** Whether the player has yet to pay anything in this period. Membership
   * dues do not count: they are a separate, orthogonal payment. */
  firstOfPeriod: boolean;
  /** For a half month: what the sessions still to come cost. 0 when there are
   * none left. */
  halfMonthPrice: number;
  /** Slots of this month that already took a monthly payment. */
  monthlySlots: Set<SlotKey>;
  /** Slots of this month that already took an individual one. */
  individualSlots: Set<SlotKey>;
  /** What the whole month costs at this slot; 0 when it holds no sessions. */
  monthPrice: number;
  /** Already paid towards that month. */
  monthlyPaid: number;
  /** Whether the window to buy this month has passed — it closes one day
   * after the slot's second session. */
  monthlyClosed: boolean;
};

/**
 * Whether a payment may be registered at all, and why not.
 *
 * This lives in the service and not only in the screen. It is a money rule: a
 * retry, a stale tab or a direct call would walk straight past a check that
 * only existed in the UI.
 *
 * Returns null when the payment is fine, or the reason to show the admin.
 */
export function checkPayment(intent: PaymentIntent, ctx: PaymentGuard): string | null {
  if (!(intent.amount > 0)) return "El monto tiene que ser mayor a cero";

  // Closed debt blocks everything else: the money on the table settles it
  // first, and it does so through its own concept so it can never be read as
  // buying sessions.
  if (ctx.closedDebt > 0 && intent.concept !== "debt settlement") {
    return "Hay deuda de meses anteriores: primero hay que saldarla";
  }

  if (intent.concept === "debt settlement") {
    if (ctx.closedDebt === 0) return "No hay deuda para saldar";
    if (intent.amount > ctx.closedDebt) {
      return "El pago de deuda no puede superar la deuda";
    }
    return null;
  }

  // A half month is what somebody starting the period late buys: the sessions
  // that are still to come, at the promotional rate, with no obligation for
  // the ones that already happened without them.
  if (intent.concept === "half month") {
    if (!ctx.firstOfPeriod) {
      return "Medio mes es sólo para el primer pago del jugador en el período";
    }
    if (ctx.halfMonthPrice <= 0) {
      return "No quedan sesiones de este horario en el mes";
    }
    return null;
  }

  // One concept per (month, slot). From the first payment the decision is
  // taken, so promotional and normal prices never mix in the same month.
  const promotional = intent.concept === "monthly";
  if (promotional && ctx.individualSlots.has(intent.slot)) {
    return "Ya hay un pago de sesión para este mes y horario";
  }
  if (intent.concept === "session" && ctx.monthlySlots.has(intent.slot)) {
    return "Ya hay un pago mensual para este mes y horario";
  }

  if (intent.concept === "monthly") {
    if (ctx.monthPrice <= 0) return "Este horario no tiene entrenamientos este mes";
    if (ctx.monthlyPaid > 0) {
      // A partial is completed, never extended: no third instalment.
      if (ctx.monthlyPaid + intent.amount !== ctx.monthPrice) {
        return "El segundo pago tiene que completar el mes";
      }
      return null;
    }
    if (ctx.monthlyClosed) {
      return "El pago mensual se registra hasta la segunda sesión del mes";
    }
    if (intent.amount < ctx.monthPrice && intent.amount < MinPartialMonthly) {
      return `Un pago parcial del mes no puede ser menor a $${MinPartialMonthly / 1000}k`;
    }
  }

  return null;
}
