import type { SupabaseClient } from "@supabase/supabase-js";
import { BuenosAires } from "@/lib/cashflow";

/** Today's date in Buenos Aires, YYYY-MM-DD — not the server's timezone. */
export function todayBA(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BuenosAires,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The calendar day before a YYYY-MM-DD date. Anchored at noon UTC so no
 * offset or DST shift can land it on the wrong day. */
export function previousDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The training date the app should be working on: today's if there is one,
 * else yesterday's — a training night is often settled the next morning —
 * else the next one coming up, else the last one on record.
 */
export async function currentTrainingDate(
  s: SupabaseClient,
  now: Date = new Date(),
): Promise<string | null> {
  const today = todayBA(now);
  const yesterday = previousDay(today);

  const { data: recent, error } = await s
    .from("training_slots")
    .select("date")
    .in("date", [yesterday, today]);
  if (error) throw new Error("training_slots: " + error.message);

  const dates = new Set((recent ?? []).map((r) => String(r.date)));
  if (dates.has(today)) return today;
  if (dates.has(yesterday)) return yesterday;

  const { data: upcoming } = await s
    .from("training_slots")
    .select("date")
    .gt("date", today)
    .order("date")
    .limit(1);
  if (upcoming?.length) return String(upcoming[0].date);

  const { data: last } = await s
    .from("training_slots")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);
  return last?.length ? String(last[0].date) : null;
}
