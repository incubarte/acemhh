import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Sessions for specs that WRITE. Payments and attendance may only be recorded
// for the current week and the previous one, so a spec pinned to a fixed date
// passes today and fails on its own next week. These pick from the agenda
// instead, relative to now.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Buenos Aires "today", the reference the server uses. */
export function todayBA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export type Fixture = {
  /** YYYY-MM-DD-HH, as the routes take it. */
  session: string;
  /** "YYYY-MM-DD HHhs", as attendances and payments store it. */
  sessionStr: string;
  /** The same slot's previous training. */
  prevStr: string;
  date: string;
  month: string;
  /** The month after the session's, and the one after that. */
  nextMonth: string;
  monthAfterNext: string;
  /** What a session bought on its own costs on that date. Read from the
   * tariff table, so a price change does not leave the specs paying last
   * season's money. */
  sessionPrice: number;
};

/** The tariff in force on `date`: the newest row at or before it. */
export async function tariffAt(date: string): Promise<{ session: number; prepaid: number }> {
  const { data, error } = await admin().from("prices")
    .select("session_price,prepaid_session_price")
    .lte("valid_from", date).order("valid_from", { ascending: false }).limit(1).single();
  if (error) throw new Error(JSON.stringify(error));
  return { session: Number(data.session_price), prepaid: Number(data.prepaid_session_price) };
}

export async function sessionPriceAt(date: string): Promise<number> {
  return (await tariffAt(date)).session;
}

/** Pesos the way the screens abbreviate them: 30000 reads "30k". */
export function k(amount: number): string {
  if (amount >= 1000 && amount % 1000 === 0) return `${amount / 1000}k`;
  return new Intl.NumberFormat("es-AR").format(amount);
}

/** One day after `date` (YYYY-MM-DD). */
export function dayAfter(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * The most recent training of a slot that is still writable — at most six days
 * back with weekly trainings, so always inside the window — plus the one
 * before it.
 */
export async function writableSession(hour = 22): Promise<Fixture> {
  const { data, error } = await admin().from("training_sessions")
    .select("date").eq("hour", hour).lte("date", todayBA())
    .order("date", { ascending: false }).limit(2);
  if (error) throw new Error(JSON.stringify(error));
  if ((data ?? []).length < 2) {
    throw new Error(`La agenda no tiene dos entrenamientos de ${hour}hs hasta hoy`);
  }
  const date = String(data![0].date);
  const prev = String(data![1].date);
  const month = date.slice(0, 7);
  return {
    session: `${date}-${hour}`,
    sessionStr: `${date} ${hour}hs`,
    prevStr: `${prev} ${hour}hs`,
    date,
    month,
    nextMonth: shiftMonth(month, 1),
    monthAfterNext: shiftMonth(month, 2),
    sessionPrice: await sessionPriceAt(date),
  };
}

/** A session of `month` at `hour`, for read-only assertions about later
 * months. Falls back to the first of the month when the agenda has none. */
export async function sessionIn(month: string, hour = 22): Promise<string> {
  const { data } = await admin().from("training_sessions")
    .select("date").eq("hour", hour)
    .gte("date", `${month}-01`).lt("date", `${shiftMonth(month, 1)}-01`)
    .order("date").limit(1);
  const date = data?.[0]?.date ? String(data[0].date) : `${month}-01`;
  return `${date}-${hour}`;
}

/**
 * A session far enough ahead that its month is still open for a monthly
 * payment — the window closes a day after the slot's second session. Pre-paying
 * a coming month is exactly what it is for.
 */
export async function futureSession(
  hour = 22,
  /** Earliest month (YYYY-MM) to consider. Early in a month the coming
   * sessions are this month's own; a spec that needs a LATER month says so. */
  fromMonth?: string,
): Promise<{ session: string; month: string }> {
  const from = fromMonth && `${fromMonth}-01` > todayBA() ? `${fromMonth}-01` : todayBA();
  const { data } = await admin().from("training_sessions")
    .select("date").eq("hour", hour).gt("date", from)
    .order("date").limit(20);
  const dates = (data ?? []).map((r) => String(r.date));
  // The first date of a month that still has at least two trainings ahead.
  for (const date of dates) {
    const month = date.slice(0, 7);
    const inMonth = dates.filter((d) => d.startsWith(month));
    if (inMonth.length >= 2 && inMonth[0] === date) return { session: `${date}-${hour}`, month };
  }
  throw new Error(`La agenda no tiene un mes futuro con dos entrenamientos de ${hour}hs`);
}

/**
 * Marking somebody present who owes money asks first. Confirms it when it
 * shows, and does nothing when it does not — most players owe nothing.
 */
export async function confirmDebtWarning(page: import("@playwright/test").Page) {
  const anyway = page.getByTestId("debt-warning-anyway");
  // It appears when the wheel finishes settling, not at finger-up, so a bare
  // isVisible() checks too early.
  await anyway.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
}
