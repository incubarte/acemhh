import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Slot features are versioned by date, and a session resolves against the
// configuration in force at ITS OWN date. This is the whole point of splitting
// the table: changing a slot's categories must not rewrite what a closed month
// looked like, because the trainings of a month are an input to its debts.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// An hour no real slot uses, in a year with no seeded agenda, so these probes
// cannot collide with the club's actual schedule.
const HOUR = 19;
const EARLY = "2027-02-04";
const LATE = "2027-04-08"; // nine weeks later: same weekday as EARLY
const ORPHAN = "2027-02-05"; // next day, so a weekday with no features at all

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** ISO weekday (1 = Monday .. 7 = Sunday), the key of training_slot_features. */
function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

async function cleanup() {
  const s = admin();
  await s.from("training_sessions").delete().in("date", [EARLY, LATE, ORPHAN]);
  await s.from("training_slot_features").delete()
    .in("weekday", [isoWeekday(EARLY), isoWeekday(ORPHAN)])
    .eq("hour", HOUR);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(cleanup);
test.afterAll(cleanup);

test("una sesión resuelve las features vigentes a su propia fecha", async ({ page }) => {
  const s = admin();
  expect(isoWeekday(EARLY)).toBe(isoWeekday(LATE));

  // One slot, two eras: cat-a first, cat-c from March onwards.
  const { error: featError } = await s.from("training_slot_features").insert([
    {
      weekday: isoWeekday(EARLY), hour: HOUR, valid_from: "2027-01-01",
      categories: ["cat-a"], goalies: false,
    },
    {
      weekday: isoWeekday(EARLY), hour: HOUR, valid_from: "2027-03-01",
      categories: ["cat-c"], goalies: true,
    },
  ]);
  if (featError) throw new Error(JSON.stringify(featError));

  const { error: sessError } = await s.from("training_sessions")
    .insert([{ date: EARLY, hour: HOUR }, { date: LATE, hour: HOUR }]);
  if (sessError) throw new Error(JSON.stringify(sessError));

  await page.request.post("/api/auth/dev");

  // February reads the old era...
  const early = await (await page.request.get(`/api/training-slots?date=${EARLY}`)).json();
  expect(early.day.slots).toEqual([{ hour: HOUR, categories: ["cat-a"], goalies: false }]);

  // ...April the new one, from the same slot.
  const late = await (await page.request.get(`/api/training-slots?date=${LATE}`)).json();
  expect(late.day.slots).toEqual([{ hour: HOUR, categories: ["cat-c"], goalies: true }]);
});

test("cambiar las features de un slot no reescribe el pasado", async ({ page }) => {
  const s = admin();
  await page.request.post("/api/auth/dev");

  // A category joins the slot today. Everything from here on has it...
  const { error } = await s.from("training_slot_features").insert({
    weekday: isoWeekday(EARLY), hour: HOUR, valid_from: "2027-06-01",
    categories: ["cat-c", "youth"], goalies: true,
  });
  if (error) throw new Error(JSON.stringify(error));

  // ...and February still reads exactly what it read before. Were features a
  // column on the session, or resolved against "the config of today", this is
  // where a closed month would silently gain a training — and with it, debts
  // that were never owed.
  const early = await (await page.request.get(`/api/training-slots?date=${EARLY}`)).json();
  expect(early.day.slots).toEqual([{ hour: HOUR, categories: ["cat-a"], goalies: false }]);
});

test("una sesión sin features configuradas hace fallar la consulta", async ({ page }) => {
  const s = admin();
  expect(isoWeekday(ORPHAN)).not.toBe(isoWeekday(EARLY));

  const { error } = await s.from("training_sessions")
    .insert({ date: ORPHAN, hour: HOUR });
  if (error) throw new Error(JSON.stringify(error));

  await page.request.post("/api/auth/dev");
  const res = await page.request.get(`/api/training-slots?date=${ORPHAN}`);

  // Loud on purpose: defaulting to "no categories" would quietly shrink the
  // month, and guessing them would charge the wrong people.
  expect(res.status()).toBeGreaterThanOrEqual(500);
});
