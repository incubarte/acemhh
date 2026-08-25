import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { futureSession, writableSession, type Fixture } from "./fixtures";

// The rules that say what may be registered, enforced by the SERVICE. They are
// money rules: a stale tab, a retry or a direct call has to hit the same wall
// the screen shows. The rules themselves are unit-tested in
// supabase/functions/tests/tokens.test.ts — what this checks is that the route
// actually applies them.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const LAST = "Reglas";
let fx: Fixture;
/** A month still open for a monthly payment. */
let ahead: { session: string; month: string };
let playerId: string;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function cleanup() {
  const s = admin();
  const { data } = await s.from("players").select("id").eq("last_name", LAST);
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return;
  await s.from("payments").delete().in("player_id", ids);
  await s.from("attendances").delete().in("player_id", ids);
  await s.from("players").delete().in("id", ids);
}

/** Clears this player's money, leaving the roster untouched. */
async function clearPayments() {
  await admin().from("payments").delete().eq("player_id", playerId);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fx = await writableSession(22);
  ahead = await futureSession(22);
  await cleanup();
  const { data, error } = await admin().from("players").insert({
    name: "Cobrado", last_name: LAST, dni: "99000701",
    categories: ["cat-b"], player_type: "player", trains: true, invitee: false,
  }).select("id").single();
  if (error) throw new Error(JSON.stringify(error));
  playerId = data.id;
});
test.afterAll(cleanup);
test.beforeEach(clearPayments);

async function pay(
  page: import("@playwright/test").Page,
  concept: "session" | "monthly" | "half month" | "debt settlement",
  amount: number,
  session = fx.session,
) {
  return await page.request.post(`/api/training-sessions/${session}/payment`, {
    data: { player_id: playerId, amount, concept },
  });
}

test("el concepto lo decide el admin, no el monto", async ({ page }) => {
  await page.request.post("/api/auth/dev");

  // 30k as a session and 30k as a partial month are different things now, and
  // the amount alone no longer decides which.
  const res = await pay(page, "session", 30000);
  expect(res.status(), await res.text()).toBe(200);

  const { data } = await admin().from("payments")
    .select("concept,session,slot_weekday,slot_hour").eq("player_id", playerId).single();
  expect(data!.concept).toBe("session");
  expect(data!.session).toBe(fx.sessionStr);
  expect(data!.slot_hour).toBe(22);
});

test("no se mezcla mensual con individual en el mismo mes y horario", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  expect((await pay(page, "session", 30000)).status()).toBe(200);

  const res = await pay(page, "monthly", 100000);
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("pago de sesión");
});

test("pasada la segunda sesión del mes ya no se compra el mes", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  // fx is the latest training already held, so its month is well under way.
  const late = await pay(page, "monthly", 100000);
  expect(late.status()).toBe(409);
  expect(await late.text()).toContain("segunda sesión");
});

test("un parcial mensual tiene mínimo, y el segundo pago completa el mes", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  // A month still ahead: pre-paying it is what the monthly is for.
  // Bounded by the first of the NEXT month: "YYYY-09-32" is not a date, and
  // Postgres rejects the whole query rather than clamping it.
  const [y, m] = ahead.month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const { data: held, error: heldError } = await admin().from("training_sessions")
    .select("date").eq("hour", 22)
    .gte("date", `${ahead.month}-01`).lt("date", nextMonth);
  if (heldError) throw new Error(JSON.stringify(heldError));
  const monthPrice = (held ?? []).length * 25000;
  expect(monthPrice).toBeGreaterThan(40000);

  const tooLittle = await pay(page, "monthly", 39999, ahead.session);
  expect(tooLittle.status(), await tooLittle.text()).toBe(409);
  expect(await tooLittle.text()).toContain("parcial");

  expect((await pay(page, "monthly", 40000, ahead.session)).status()).toBe(200);

  // A third instalment is not a thing: the second one completes it.
  const third = await pay(page, "monthly", 10000, ahead.session);
  expect(third.status()).toBe(409);
  expect(await third.text()).toContain("completar");

  const completing = await pay(page, "monthly", monthPrice - 40000, ahead.session);
  expect(completing.status(), await completing.text()).toBe(200);
});

test("la deuda cerrada bloquea cobrar cualquier otra cosa", async ({ page }) => {
  await page.request.post("/api/auth/dev");

  // Attend this month and never pay: seen from a LATER month, that is closed
  // debt. It has to be a later month of the same period — debt does not cross
  // from one period into the next.
  await admin().from("attendances")
    .insert({ player_id: playerId, session: fx.sessionStr, attended: true });

  const blocked = await pay(page, "session", 30000, ahead.session);
  expect(blocked.status(), await blocked.text()).toBe(409);
  expect(await blocked.text()).toContain("deuda de meses anteriores");

  // Even the monthly, whose own window is still open for that month.
  const monthly = await pay(page, "monthly", 100000, ahead.session);
  expect(monthly.status()).toBe(409);

  // The debt payment is capped at the debt itself.
  const tooMuch = await pay(page, "debt settlement", 999999, ahead.session);
  expect(tooMuch.status()).toBe(409);
  expect(await tooMuch.text()).toContain("superar");

  // Settling it unblocks the rest.
  expect((await pay(page, "debt settlement", 30000, ahead.session)).status()).toBe(200);
  const after = await pay(page, "session", 30000, ahead.session);
  expect(after.status(), await after.text()).toBe(200);

  await admin().from("attendances").delete().eq("player_id", playerId);
});

test("no se cobra ni se marca presente en una sesión ya cerrada", async ({ page }) => {
  await page.request.post("/api/auth/dev");

  // Three weeks back is outside the window whatever day it is today.
  const old = new Date(`${fx.date}T12:00:00Z`);
  old.setUTCDate(old.getUTCDate() - 21);
  const oldSession = `${old.toISOString().slice(0, 10)}-22`;

  const payment = await pay(page, "session", 30000, oldSession);
  expect(payment.status()).toBe(409);
  expect(await payment.text()).toContain("cerrada");

  const attendance = await page.request.post(
    `/api/training-sessions/${oldSession}/attendance`,
    { data: { player_id: playerId, attended: true } },
  );
  expect(attendance.status()).toBe(409);
  expect(await attendance.text()).toContain("cerrada");
});

test("medio mes cobra lo que queda, y sólo como primer pago del período", async ({ page }) => {
  await page.request.post("/api/auth/dev");

  // A month still ahead, so its sessions are all still to come.
  const { data: monthSessions } = await admin().from("training_sessions")
    .select("date").eq("hour", 22)
    .gte("date", `${ahead.month}-01`)
    .lt("date", `${ahead.month}-99`.replace("-99", "-01").replace(
      ahead.month,
      ((): string => {
        const [y, m] = ahead.month.split("-").map(Number);
        return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
      })(),
    ))
    .order("date");
  const dates = (monthSessions ?? []).map((r) => String(r.date));
  expect(dates.length).toBeGreaterThanOrEqual(3);

  // Registered at the SECOND session: it buys that one and everything after,
  // never the one already gone.
  const second = `${dates[1]}-22`;
  const expected = (dates.length - 1) * 25000;

  const roster = await (await page.request.get(`/api/training-sessions-beta/${second}`)).json();
  const row = roster.players.find((p: { id: string }) => p.id === playerId);
  expect(row.half_month_preset, `${dates.length} sesiones, arranca en la 2a`).toBe(expected);

  const res = await pay(page, "half month", expected, second);
  expect(res.status(), await res.text()).toBe(200);

  const { data: saved } = await admin().from("payments")
    .select("concept,amount,session").eq("player_id", playerId).single();
  expect(saved!.concept).toBe("half month");
  // It names its own session: that is what says how many it bought.
  expect(saved!.session).toBe(`${dates[1]} 22hs`);

  // And it is a first-payment-only thing: now that they have paid, no more.
  const again = await pay(page, "half month", expected, second);
  expect(again.status()).toBe(409);
  expect(await again.text()).toContain("primer pago");
});
