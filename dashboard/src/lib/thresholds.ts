// DEPRECATED: do not add new entries. These ad-hoc overrides patched the
// S1-2026 schedule restructurings, where some slots owed players credit for an
// extra session charged the month before. The month's real price now derives
// from the database (trainings in training_sessions x the prepaid rate in
// prices), and over/under-charging is handled by the carryover ledger
// (the shared ledger in supabase/functions/_shared): an extra session paid one
// month becomes credit for the next, so no future override should be needed.

// Key format: "YYYY-MM|<generic slot>", e.g. "2026-05|jue 22hs".
const PAYMENT_THRESHOLDS: Record<string, number> = {
  "2026-05|jue 22hs": 50000,
  "2026-05|jue 23hs": 50000,
  "2026-06|jue 22hs": 75000,
  "2026-06|jue 23hs": 75000,
  "2026-07|jue 22hs": 50000,
  "2026-07|jue 23hs": 50000,
};

/** The legacy override for a session's month, or null when the derived month
 * price should be used. */
export function paymentThresholdOverride(isoDate: string, hour: number): number | null {
  const month = isoDate.substring(0, 7);
  const slot = `jue ${hour}hs`;
  return PAYMENT_THRESHOLDS[`${month}|${slot}`] ?? null;
}
