const DEFAULT_PAYMENT_THRESHOLD = 100000;

// Override the monthly payment threshold for a specific (month, slot) combination.
// Key format: "YYYY-MM|<generic slot>", e.g. "2026-05|jue 22hs".
const PAYMENT_THRESHOLDS: Record<string, number> = {
  "2026-05|jue 22hs": 50000,
  "2026-05|jue 23hs": 50000,
};

export function paymentThresholdForSession(isoDate: string, hour: number): number {
  const month = isoDate.substring(0, 7);
  const slot = `jue ${hour}hs`;
  return PAYMENT_THRESHOLDS[`${month}|${slot}`] ?? DEFAULT_PAYMENT_THRESHOLD;
}
