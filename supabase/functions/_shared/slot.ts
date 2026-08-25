// A slot is a weekday plus an hour ("jue 22hs"): stable over time, and the key
// of training_slot_features. Sessions and payments both point at one.
//
// Kept free of imports so both the Next dashboard and the Deno webhook can
// consume it unchanged, same as the ledger.

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

const WEEKDAY_ES = ["", "lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** How a slot reads on screen. The database stores the pair, never this. */
export function slotLabel(weekday: number, hour: number): string {
  return `${WEEKDAY_ES[weekday] ?? "?"} ${hour}hs`;
}

export type SlotRef = { slot_weekday: number; slot_hour: number };

/** Whether two slot references are the same slot. */
export function sameSlot(a: SlotRef, b: SlotRef): boolean {
  return a.slot_weekday === b.slot_weekday && a.slot_hour === b.slot_hour;
}
