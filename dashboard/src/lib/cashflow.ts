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
};

/** What a group without a slot is called on screen. */
export const NoSlotLabel = "sin slot";

export type IncomeGroup = {
  user_id: string;
  /** created_at of the first payment of the group; the entry sorts by it. */
  start: string;
  /** The collection day (YYYY-MM-DD, 5am-anchored) this group belongs to. */
  day: string;
  slot: string;
  amount: number;
  count: number;
};

/** One entry per collector per collection day per slot. A single night runs
 * three trainings back to back, and one collector takes money at all of them,
 * so the day alone lumps together takings that belong to different groups. */
export function groupIncomeByDay(payments: IncomePayment[]): IncomeGroup[] {
  const groups = new Map<string, IncomeGroup>();

  for (const p of [...payments].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const day = collectionDay(p.created_at);
    const slot = p.slot_weekday !== null && p.slot_hour !== null
      ? slotLabel(p.slot_weekday, p.slot_hour)
      : NoSlotLabel;
    const key = `${p.user_id}|${day}|${slot}`;
    const existing = groups.get(key);
    if (existing) {
      existing.amount += p.amount;
      existing.count += 1;
    } else {
      groups.set(key, {
        user_id: p.user_id,
        start: p.created_at,
        day,
        slot,
        amount: p.amount,
        count: 1,
      });
    }
  }

  return [...groups.values()];
}
