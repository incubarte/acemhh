// Cash-flow history helpers. Pure: imported by the API route and unit-tested
// directly (dashboard/e2e/cashflow.spec.ts).

import { slotLabel } from "@shared/slot";

export const BuenosAires = "America/Argentina/Buenos_Aires";

/** A collection day runs 5am → 5am (Buenos Aires), so a training night's
 * payments — 21hs, 22hs, and the ones registered past midnight — stay in the
 * same entry instead of splitting at an arbitrary calendar boundary. */
export const CollectionDayStartHour = 5;

/** The collection day a timestamp belongs to, as YYYY-MM-DD. */
export function collectionDay(iso: string): string {
  const shifted = new Date(
    new Date(iso).getTime() - CollectionDayStartHour * 60 * 60 * 1000,
  );
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BuenosAires,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

export type IncomePayment = {
  user_id: string;
  amount: number;
  created_at: string;
  /** The slot the money was collected at. Membership dues belong to no slot
   * and never reach the caja anyway (they go to the bank). */
  slot_weekday: number | null;
  slot_hour: number | null;
  /** What was paid for: decides the kind of income, whether it is cash and,
   * for money outside training, what the entry is called. */
  concept?: string;
  /** For the group's breakdown: which payment, whose, and what the collector
   * wrote on it. */
  id?: string;
  player?: string;
  notes?: string | null;
};

/** Membership dues are paid straight to the bank account; everything else is
 * collected in hand and enters the caja of whoever registered it. */
export function isCashConcept(concept: string | undefined): boolean {
  return concept !== "membership dues";
}

/** The kinds of money that come in: training (sessions, months, debt), the
 * annual membership dues, tournament fees, and "other" — money with no player
 * behind it (a colecta), which lives in its own table and is never grouped. */
export type IncomeKind = "training" | "dues" | "tournament" | "other";

export const IncomeKinds: readonly IncomeKind[] = ["training", "dues", "tournament", "other"];

export function incomeKind(concept: string | undefined): IncomeKind {
  if (concept === "membership dues") return "dues";
  if (concept === "tournament" || concept === "tournament upfront") return "tournament";
  return "training";
}

/** What a group without a slot is called on screen. */
export const NoSlotLabel = "sin slot";

/** What tournament fee income is called on screen. */
export const TournamentLabel = "torneo";

/** What membership dues income is called on screen. */
export const DuesLabel = "cuota social";

/** One payment inside a group, for the breakdown the caja opens on demand. */
export type IncomeItem = {
  id: string;
  player: string;
  concept: string;
  amount: number;
  notes: string | null;
  at: string;
};

export type IncomeGroup = {
  user_id: string;
  /** created_at of the first payment of the group; the entry sorts by it. */
  start: string;
  /** The collection day (YYYY-MM-DD, 5am-anchored) this group belongs to. */
  day: string;
  slot: string;
  kind: IncomeKind;
  is_cash: boolean;
  amount: number;
  count: number;
  /** The payments behind the group, oldest first. */
  items: IncomeItem[];
};

/** One entry per collector per collection day per slot. A single night runs
 * three trainings back to back, and one collector takes money at all of them,
 * so the day alone lumps together takings that belong to different groups. */
export function groupIncomeByDay(payments: IncomePayment[]): IncomeGroup[] {
  const groups = new Map<string, IncomeGroup>();

  for (const p of [...payments].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const day = collectionDay(p.created_at);
    const kind = incomeKind(p.concept);
    const isCash = isCashConcept(p.concept);
    const slot = kind === "tournament"
      ? TournamentLabel
      : kind === "dues"
      ? DuesLabel
      : p.slot_weekday !== null && p.slot_hour !== null
      ? slotLabel(p.slot_weekday, p.slot_hour)
      : NoSlotLabel;
    const key = `${p.user_id}|${day}|${slot}|${isCash}`;
    const item: IncomeItem = {
      id: p.id ?? "",
      player: p.player ?? "?",
      concept: p.concept ?? "",
      amount: p.amount,
      notes: p.notes ?? null,
      at: p.created_at,
    };
    const existing = groups.get(key);
    if (existing) {
      existing.amount += p.amount;
      existing.count += 1;
      existing.items.push(item);
    } else {
      groups.set(key, {
        user_id: p.user_id,
        start: p.created_at,
        day,
        slot,
        kind,
        is_cash: isCash,
        amount: p.amount,
        count: 1,
        items: [item],
      });
    }
  }

  return [...groups.values()];
}
