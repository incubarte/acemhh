// Annual membership dues (cuota social). A player is up to date only when
// their membership-dues payments for the year SUM to the full amount — one
// payment of 70k or several installments reaching it.
export const ANNUAL_DUES = 70000;

/** full = settled, partial = something paid but short (35k, even 69k),
 * none = nothing paid this year. Attendance screens paint each differently. */
export type DuesStatus = "full" | "partial" | "none";

export function duesTotalsByPlayer(
  rows: { player_id: string; amount: number | string }[],
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const r of rows) {
    sums.set(r.player_id, (sums.get(r.player_id) ?? 0) + Number(r.amount));
  }
  return sums;
}

export function duesStatusFor(total: number): DuesStatus {
  if (total >= ANNUAL_DUES) return "full";
  return total > 0 ? "partial" : "none";
}
