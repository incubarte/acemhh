// The month's money, read the way the club reasons about it: what a month
// took in and what it is still owed, pivoted by month. Pure: the API route
// fetches, this file only adds up, so the arithmetic is unit-tested directly
// (dashboard/e2e/analysis.spec.ts).
//
// Two things are kept apart on purpose. A month's collections and shortfall
// are that month's business. Debt from earlier months, and the debt payments
// taken this month, belong to the months that generated them — they are
// shown alongside, never folded into the month's figures, so a month never
// looks better for having collected what an earlier one failed to.

import { slotLabel } from "@shared/slot";
import { slotKey } from "@shared/tokens";
import type { LedgerExtras } from "./rosterLedger";

export type AnalysisPayment = {
  player_id: string;
  concept: string;
  amount: number;
  slot_weekday: number | null;
  slot_hour: number | null;
  /** YYYY-MM the payment is for. */
  month: string;
  /** Who took the money, as shown on screen. */
  collector: string;
};

export type AnalysisAttendance = {
  player_id: string;
  /** "YYYY-MM-DD HHhs". */
  session: string;
};

export type AnalysisPlayer = { id: string; name: string; last_name: string };

/** A slot the month held trainings at. */
export type MonthSlot = { key: string; label: string };

export type Line = { label: string; amount: number };

/** Somebody the month is still waiting on. */
export type Owing = {
  player: string;
  attended: number;
  paid: number;
  /** They pay only what they already consumed. */
  pessimistic: number;
  /** They buy the month, when nothing they did rules that out. */
  optimistic: number;
  kind: "unpaid" | "partial" | "session";
};

export type SlotCollections = {
  slot: string;
  collected: number;
  byCollector: Line[];
  pessimistic: number;
  optimistic: number;
  owing: Owing[];
};

export type Debtor = { player: string; month: string; amount: number };

export type SlotDebt = {
  slot: string;
  outstanding: number;
  debtors: Debtor[];
  /** Debt payments taken this month at this slot. */
  settled: number;
  settledByCollector: Line[];
};

export type Analysis = {
  month: string;
  collections: {
    total: number;
    pessimistic: number;
    optimistic: number;
    byCollector: Line[];
    slots: SlotCollections[];
  };
  debt: {
    outstanding: number;
    settled: number;
    settledByCollector: Line[];
    slots: SlotDebt[];
  };
};

export const NoSlot = "sin horario";
const CollectionConcepts = new Set(["monthly", "session", "half month"]);
const Settlement = "debt settlement";

function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addLine(lines: Map<string, number>, label: string, amount: number) {
  lines.set(label, (lines.get(label) ?? 0) + amount);
}

function toLines(lines: Map<string, number>): Line[] {
  return [...lines.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

/**
 * The slot each player belongs to in each month: where they trained first
 * that month (a youth who also trains at 23hs anchors on the youth slot, so
 * the earlier hour wins on a same-day double), or failing any training, where
 * they paid.
 */
export function slotsByMonth(
  attendances: AnalysisAttendance[],
  payments: AnalysisPayment[],
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const put = (month: string, player: string, slot: string) => {
    if (!out.has(month)) out.set(month, new Map());
    const m = out.get(month)!;
    if (!m.has(player)) m.set(player, slot);
  };
  for (const a of [...attendances].sort((x, y) => x.session.localeCompare(y.session))) {
    const date = a.session.slice(0, 10);
    put(date.slice(0, 7), a.player_id, slotKey(isoWeekday(date), Number(a.session.slice(11, 13))));
  }
  for (const p of payments) {
    if (p.slot_weekday === null || p.slot_hour === null) continue;
    put(p.month, p.player_id, slotKey(p.slot_weekday, p.slot_hour));
  }
  return out;
}

export function slotLabelOf(key: string): string {
  const [weekday, hour] = key.split("-").map(Number);
  return slotLabel(weekday, hour);
}

export function buildAnalysis(input: {
  month: string;
  /** Payments from the period's start through `month`. */
  payments: AnalysisPayment[];
  /** Attendances (attended only) over the same span. */
  attendances: AnalysisAttendance[];
  players: AnalysisPlayer[];
  /** The ledger for `month`, per player. A player's month_preset must be the
   * one of the slot they belong to this month. */
  extras: Map<string, LedgerExtras>;
  /** Slots the month held trainings at, in screen order. */
  monthSlots: MonthSlot[];
}): Analysis {
  const { month } = input;
  const nameOf = new Map(input.players.map((p) => [p.id, `${p.last_name}, ${p.name}`]));
  const name = (id: string) => nameOf.get(id) ?? id;
  const slotOf = slotsByMonth(input.attendances, input.payments);
  const thisMonth = slotOf.get(month) ?? new Map<string, string>();
  const monthPayments = input.payments.filter((p) => p.month === month);
  const slotOfPayment = (p: AnalysisPayment) =>
    p.slot_weekday !== null && p.slot_hour !== null ? slotKey(p.slot_weekday, p.slot_hour) : NoSlot;

  // Every slot that shows up anywhere this month, agenda first.
  const slotKeys = [...input.monthSlots.map((s) => s.key)];
  const labelOf = new Map(input.monthSlots.map((s) => [s.key, s.label]));
  const ensureSlot = (key: string) => {
    if (!slotKeys.includes(key)) slotKeys.push(key);
    if (!labelOf.has(key)) labelOf.set(key, key === NoSlot ? NoSlot : slotLabelOf(key));
  };
  for (const p of monthPayments) ensureSlot(slotOfPayment(p));
  for (const s of thisMonth.values()) ensureSlot(s);

  // ---- The month's collections and what it still waits for.
  const collectedBySlot = new Map<string, number>();
  const collectorsBySlot = new Map<string, Map<string, number>>();
  const collectors = new Map<string, number>();
  for (const p of monthPayments) {
    if (!CollectionConcepts.has(p.concept)) continue;
    const slot = slotOfPayment(p);
    addLine(collectedBySlot, slot, p.amount);
    if (!collectorsBySlot.has(slot)) collectorsBySlot.set(slot, new Map());
    addLine(collectorsBySlot.get(slot)!, p.collector, p.amount);
    addLine(collectors, p.collector, p.amount);
  }

  const owingBySlot = new Map<string, Owing[]>();
  for (const [playerId, slot] of thisMonth) {
    const e = input.extras.get(playerId);
    if (!e || e.owed_now <= 0) continue;
    const mine = monthPayments.filter((p) =>
      p.player_id === playerId && CollectionConcepts.has(p.concept)
    );
    const paid = mine.reduce((s, p) => s + p.amount, 0);
    const kind: Owing["kind"] = mine.some((p) => p.concept !== "session")
      ? "partial"
      : mine.length > 0
      ? "session"
      : "unpaid";
    // A partial can only be completed and a session payer cannot switch to
    // the month, so only somebody who paid nothing yet can still buy it.
    const optimistic = kind === "unpaid" && e.month_preset !== null
      ? Math.max(e.owed_now, e.month_preset)
      : e.owed_now;
    if (!owingBySlot.has(slot)) owingBySlot.set(slot, []);
    owingBySlot.get(slot)!.push({
      player: name(playerId),
      attended: e.cur_attended,
      paid,
      pessimistic: e.owed_now,
      optimistic,
      kind,
    });
  }

  const slots: SlotCollections[] = slotKeys.map((key) => {
    const owing = (owingBySlot.get(key) ?? []).sort((a, b) => a.player.localeCompare(b.player));
    return {
      slot: labelOf.get(key)!,
      collected: collectedBySlot.get(key) ?? 0,
      byCollector: toLines(collectorsBySlot.get(key) ?? new Map()),
      pessimistic: owing.reduce((s, o) => s + o.pessimistic, 0),
      optimistic: owing.reduce((s, o) => s + o.optimistic, 0),
      owing,
    };
  }).filter((s) => s.collected > 0 || s.owing.length > 0 || input.monthSlots.some((m) => m.label === s.slot));

  // ---- Earlier months: what they are still owed, and what of it was paid
  // this month. Each debt is attributed to the slot the player belonged to
  // in the month that generated it.
  const outstandingBySlot = new Map<string, number>();
  const debtorsBySlot = new Map<string, Debtor[]>();
  for (const [playerId, e] of input.extras) {
    for (const d of e.debt_months) {
      if (d.outstanding <= 0) continue;
      const slot = slotOf.get(d.month)?.get(playerId) ?? NoSlot;
      ensureSlot(slot);
      addLine(outstandingBySlot, slot, d.outstanding);
      if (!debtorsBySlot.has(slot)) debtorsBySlot.set(slot, []);
      debtorsBySlot.get(slot)!.push({ player: name(playerId), month: d.month, amount: d.outstanding });
    }
  }

  const settledBySlot = new Map<string, number>();
  const settledCollectorsBySlot = new Map<string, Map<string, number>>();
  const settledCollectors = new Map<string, number>();
  for (const p of monthPayments) {
    if (p.concept !== Settlement) continue;
    const slot = slotOfPayment(p);
    ensureSlot(slot);
    addLine(settledBySlot, slot, p.amount);
    if (!settledCollectorsBySlot.has(slot)) settledCollectorsBySlot.set(slot, new Map());
    addLine(settledCollectorsBySlot.get(slot)!, p.collector, p.amount);
    addLine(settledCollectors, p.collector, p.amount);
  }

  const debtSlots: SlotDebt[] = slotKeys.map((key) => ({
    slot: labelOf.get(key)!,
    outstanding: outstandingBySlot.get(key) ?? 0,
    debtors: (debtorsBySlot.get(key) ?? []).sort((a, b) =>
      a.month.localeCompare(b.month) || a.player.localeCompare(b.player)
    ),
    settled: settledBySlot.get(key) ?? 0,
    settledByCollector: toLines(settledCollectorsBySlot.get(key) ?? new Map()),
  })).filter((s) => s.outstanding > 0 || s.settled > 0);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    month,
    collections: {
      total: sum(slots.map((s) => s.collected)),
      pessimistic: sum(slots.map((s) => s.pessimistic)),
      optimistic: sum(slots.map((s) => s.optimistic)),
      byCollector: toLines(collectors),
      slots,
    },
    debt: {
      outstanding: sum(debtSlots.map((s) => s.outstanding)),
      settled: sum(debtSlots.map((s) => s.settled)),
      settledByCollector: toLines(settledCollectors),
      slots: debtSlots,
    },
  };
}
