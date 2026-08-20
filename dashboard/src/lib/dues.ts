// Annual membership dues (cuota social). A player is up to date only when
// their membership-dues payments for the year SUM to the full amount — one
// payment of 70k or several installments reaching it; anything less shows red.
export const ANNUAL_DUES = 70000;

/** Sums per-player amounts and returns the ids that reached the full dues. */
export function fullyPaidDuesIds(
  rows: { player_id: string; amount: number | string }[],
): Set<string> {
  const sums = new Map<string, number>();
  for (const r of rows) {
    sums.set(r.player_id, (sums.get(r.player_id) ?? 0) + Number(r.amount));
  }
  return new Set([...sums].filter(([, sum]) => sum >= ANNUAL_DUES).map(([id]) => id));
}
