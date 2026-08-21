import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Which session the app considers "current": today's, else yesterday's (a
// training night is settled the next morning), else the next one up. The
// sessions list opens on it, and both attendance screens warn when a
// different one is open.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Buenos Aires "today", the same reference the server uses. */
function todayBA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const today = todayBA();
const yesterday = shiftDays(today, -1);
const future = shiftDays(today, 21);

const probeDates = [today, yesterday, future];

async function clearProbeSlots() {
  await admin().from("training_slots").delete().in("date", probeDates);
}

async function addSlot(date: string) {
  const { error } = await admin().from("training_slots").insert({
    date, hour: 22, categories: ["cat-a", "cat-b"], goalies: false,
  });
  if (error) throw new Error(JSON.stringify(error));
}

test.describe.configure({ mode: "serial" });

// These tests need full control over what exists on today/yesterday, but the
// seeded agenda may well have a real training there (and other specs depend
// on it). Take those rows out for the duration and put them back after.
let savedSlots: Record<string, unknown>[] = [];

test.beforeAll(async () => {
  const { data } = await admin().from("training_slots").select("*").in("date", probeDates);
  savedSlots = data ?? [];
  await clearProbeSlots();
});
test.beforeEach(clearProbeSlots);
test.afterAll(async () => {
  await clearProbeSlots();
  if (savedSlots.length > 0) {
    const { error } = await admin().from("training_slots").insert(savedSlots);
    if (error) throw new Error("Failed to restore slots: " + JSON.stringify(error));
  }
});

test("con entrenamiento hoy, abre el de hoy", async ({ page }) => {
  await addSlot(today);
  await addSlot(future);

  await page.request.post("/api/auth/dev");
  const body = await (await page.request.get("/api/training-slots")).json();
  expect(body.day.date).toBe(today);
  expect(body.day.current).toBe(today);
});

test("sin entrenamiento hoy pero sí ayer, abre el de ayer", async ({ page }) => {
  await addSlot(yesterday);
  await addSlot(future);

  await page.request.post("/api/auth/dev");
  const body = await (await page.request.get("/api/training-slots")).json();
  expect(body.day.date).toBe(yesterday);
});

test("sin hoy ni ayer, abre el próximo", async ({ page }) => {
  await addSlot(future);

  // Whatever the seeded agenda holds, the pick is the earliest date ahead.
  const { data } = await admin().from("training_slots")
    .select("date").gt("date", today).order("date").limit(1);
  const nextUp = String(data![0].date);

  await page.request.post("/api/auth/dev");
  const body = await (await page.request.get("/api/training-slots")).json();
  expect(body.day.date).toBe(nextUp);
});

test("el cartel avisa cuando la sesión abierta no es la actual", async ({ page }) => {
  await addSlot(today);
  await addSlot(future);
  await page.request.post("/api/auth/dev");

  // The current session: no warning.
  for (const base of ["training-sessions", "training-sessions-beta"]) {
    await page.goto(`/${base}/${today}-22`);
    await expect(page.getByTestId("session-date-warning")).toHaveCount(0);
  }

  // A future one: warned, and offered a way back.
  for (const base of ["training-sessions", "training-sessions-beta"]) {
    await page.goto(`/${base}/${future}-22`);
    const warning = page.getByTestId("session-date-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Estás en una sesión futura");
  }

  await page.getByRole("link", { name: "Ir a la actual" }).click();
  await page.waitForURL(`**/training-sessions?date=${today}`);
});

test("el cartel queda fijo arriba y a todo el ancho", async ({ page }) => {
  await addSlot(today);
  await addSlot(future);
  await page.request.post("/api/auth/dev");
  await page.setViewportSize({ width: 390, height: 640 });

  for (const base of ["training-sessions", "training-sessions-beta"]) {
    await page.goto(`/${base}/${future}-22`);
    const warning = page.getByTestId("session-date-warning");
    await expect(warning).toBeVisible();

    const box = (await warning.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390); // edge to edge, not inside the shell
    expect(box.y).toBe(0);

    // It must not cover the app header: the page is pushed down by its height.
    const header = page.getByRole("heading", { name: "Asistencia y Pagos" });
    const headerBox = (await header.boundingBox())!;
    expect(headerBox.y).toBeGreaterThanOrEqual(box.height);

    // And it stays put while scrolling.
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(warning).toBeInViewport({ ratio: 0.95 });
    expect((await warning.boundingBox())!.y).toBe(0);
  }
});

test("el ledger funciona en meses de 30 días", async ({ page }) => {
  // Regression: the roster query bounded training_slots with `${month}-31`,
  // which Postgres rejects outright in 30-day months, silently dropping every
  // ledger figure (debt, presets, bonified sessions) for that session.
  const september = "2026-09-24"; // a seeded Thursday
  await page.request.post("/api/auth/dev");

  for (const base of ["training-sessions", "training-sessions-beta"]) {
    const res = await page.request.get(`/api/${base}/${september}-22`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // session_preset is only present when the ledger actually ran.
    expect(body.players.some((p: { session_preset: number | null }) => p.session_preset)).toBe(true);
  }
});
