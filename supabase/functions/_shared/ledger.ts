// Pure ledger math for player balances. THE single implementation: imported by
// the Next dashboard (as @shared/ledger) and by the WhatsApp webhook (as a
// relative path). It was written twice before, and two copies of money rules
// drift — the bot would tell a player one number and the admin see another.
//
// Nothing here touches the database. Fetching legitimately differs between the
// two runtimes; the arithmetic does not. Keep it free of imports so both
// module systems can consume it unchanged.
//
// The rules:
// - The month's bundle costs (trainings - carryover) x prepaid rate, and only
//   exists for months with at least MinBundleTrainings trainings. A bought
//   month is use-it-or-lose-it: absences earn nothing.
// - Not bought, each attendance beyond the bonified ones costs the single
//   rate; what goes unpaid accumulates as debt (in single-rate pesos).
// - Payments cover this month first, then old debt.
// - Carryover exists only when the club fell short: money paid beyond the
//   month's worth (a holiday miscount, a cancelled training) becomes whole
//   bonified sessions for the NEXT month only — never while debt remains, and
//   never as a peso balance.

/** The two tariffs in force, already resolved for some month. */
export type Rates = {
  session_price: number;
  prepaid_session_price: number;
};

export type LedgerPrice = Rates & {
  valid_from: string; // YYYY-MM-DD
};

// Carryover/debt accounting starts with the 2026 second semester. Earlier
// months were settled through the ad-hoc overrides in lib/thresholds.ts
// (deprecated); computing them with current tariffs would invent debts that
// never existed.
export const LEDGER_FROM = "2026-08";

/** The month admits a prepaid bundle only with at least 2 trainings. */
export const MinBundleTrainings = 2;

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

export type MonthActivity = {
  attended: number;
  paidMonthly: boolean;
  totalPaid: number;
};

export type LedgerState = {
  /** Accumulated unpaid pesos. */
  debt: number;
  /** Bonified sessions usable in the coming month only. */
  carryoverIn: number;
};

export type LedgerStepResult = {
  next: LedgerState;
  charge: number;
  bought: boolean;
};

export function ledgerStep(
  state: LedgerState,
  a: MonthActivity,
  price: Rates,
  trainings: number,
  scholarship: number,
): LedgerStepResult {
  const k = (100 - scholarship) / 100;
  const prepaidUnit = Math.round(price.prepaid_session_price * k);
  const bundleSessions = Math.max(0, trainings - state.carryoverIn);
  const bundle = bundleSessions * prepaidUnit;
  const hasBundle = trainings >= MinBundleTrainings && bundle > 0;
  const bought = hasBundle && (a.paidMonthly || a.totalPaid >= bundle);

  const bonifiedUsed = Math.min(state.carryoverIn, a.attended);
  const attEff = a.attended - bonifiedUsed;
  const singles = Math.round(attEff * price.session_price * k);

  // A payment at most one prepaid session short of the bundle reads as an
  // incomplete bundle purchase: the whole bundle is owed and the rest becomes
  // debt — but never worse than paying singles.
  const partialBundle = !bought && hasBundle && a.totalPaid > 0 &&
    a.totalPaid >= (bundleSessions - 1) * prepaidUnit;

  const charge = bought ? bundle : partialBundle ? Math.min(singles, bundle) : singles;

  let debt = state.debt;
  let carryoverOut = 0;
  if (a.totalPaid >= charge) {
    let excess = a.totalPaid - charge;
    const payingDebt = Math.min(debt, excess);
    debt -= payingDebt;
    excess -= payingDebt;
    if (bought && debt === 0 && excess > 0 && prepaidUnit > 0) {
      carryoverOut = Math.floor(excess / prepaidUnit);
    }
  } else {
    debt += charge - a.totalPaid;
  }

  return { next: { debt, carryoverIn: carryoverOut }, charge, bought };
}

export type LedgerRow = {
  month: string;
  charge: number;
  paid: number;
  debtAfter: number;
};

/** Runs the ledger over months in order; returns the state entering the month
 * AFTER the last one, plus per-month rows for debt detail displays. */
export function runLedger(
  months: string[],
  byMonth: Map<string, MonthActivity>,
  trainingsByMonth: Map<string, number>,
  prices: LedgerPrice[],
  scholarship: number,
): { state: LedgerState; rows: LedgerRow[] } {
  let state: LedgerState = { debt: 0, carryoverIn: 0 };
  const rows: LedgerRow[] = [];
  for (const month of months) {
    const a = byMonth.get(month) ?? { attended: 0, paidMonthly: false, totalPaid: 0 };
    const step = ledgerStep(
      state,
      a,
      priceFor(prices, month),
      trainingsByMonth.get(month) ?? 0,
      scholarship,
    );
    rows.push({ month, charge: step.charge, paid: a.totalPaid, debtAfter: step.next.debt });
    state = step.next;
  }
  return { state, rows };
}
