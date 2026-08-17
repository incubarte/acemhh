// Cash-flow history helpers. Pure: imported by the API route and unit-tested
// directly (dashboard/e2e/cashflow.spec.ts).

export const IncomeWindowHours = 5;

export type IncomePayment = {
  user_id: string;
  amount: number;
  created_at: string;
};

export type IncomeWindow = {
  user_id: string;
  /** created_at of the first payment in the window; the whole entry sorts by it. */
  start: string;
  amount: number;
  count: number;
};

// A collector registering payments at 21, 22 and 01 the next day produces ONE
// history entry: windows are anchored at the collector's first payment and
// span IncomeWindowHours from there; the next payment beyond that opens a new
// window.
export function groupIncomeWindows(payments: IncomePayment[]): IncomeWindow[] {
  const byUser = new Map<string, IncomePayment[]>();
  for (const p of payments) {
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
    byUser.get(p.user_id)!.push(p);
  }

  const windows: IncomeWindow[] = [];
  const spanMs = IncomeWindowHours * 60 * 60 * 1000;

  for (const [userId, userPayments] of byUser) {
    const sorted = [...userPayments].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );

    let current: IncomeWindow | null = null;
    let windowEnd = 0;
    for (const p of sorted) {
      const t = new Date(p.created_at).getTime();
      if (!current || t >= windowEnd) {
        current = { user_id: userId, start: p.created_at, amount: 0, count: 0 };
        windows.push(current);
        windowEnd = t + spanMs;
      }
      current.amount += p.amount;
      current.count += 1;
    }
  }

  return windows;
}
