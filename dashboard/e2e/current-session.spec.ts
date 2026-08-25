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
  await admin().from("training_sessions").delete().in("date", probeDates);
}

/** The probe dates land on whatever weekday today happens to be, so addSlot
 * has to invent a configuration for that slot. Left behind, it turns every
 * later count of "trainings this month" into a wrong number for whoever else
 * is looking. */
async function clearProbeFeatures() {
  const weekdays = [...new Set(probeDates.map(isoWeekday))];
  await admin().from("training_slot_features").delete()
    .in("weekday", weekdays).eq("hour", 22).eq("valid_from", "2026-01-01");
}

/** ISO weekday (1 = Monday .. 7 = Sunday), the key of training_slot_features. */
function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * A session plus the features of its slot. These probe dates land on whatever
 * weekday today happens to be, so the slot they belong to usually has no
 * configuration — creating one is part of adding an off-schedule training.
 */
async function addSlot(date: string) {
  const { error: featError } = await admin().from("training_slot_features")
    .upsert({
      weekday: isoWeekday(date),
      hour: 22,
      valid_from: "2026-01-01",
      categories: ["cat-a", "cat-b"],
      goalies: false,
    }, { onConflict: "weekday,hour,valid_from" });
  if (featError) throw new Error(JSON.stringify(featError));

  const { error } = await admin().from("training_sessions").insert({ date, hour: 22 });
  if (error) throw new Error(JSON.stringify(error));
}

test.describe.configure({ mode: "serial" });

// These tests need full control over what exists on today/yesterday, but the
// seeded agenda may well have a real training there (and other specs depend
// on it). Take those rows out for the duration and put them back after.
let savedSlots: Record<string, unknown>[] = [];

test.beforeAll(async () => {
  const { data } = await admin().from("training_sessions").select("*").in("date", probeDates);
  savedSlots = data ?? [];
  await clearProbeSlots();
});
test.beforeEach(clearProbeSlots);
test.afterAll(async () => {
  await clearProbeSlots();
  await clearProbeFeatures();
  if (savedSlots.length > 0) {
    const { error } = await admin().from("training_sessions").insert(savedSlots);
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
  const { data } = await admin().from("training_sessions")
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

test("header y cartel quedan fijos arriba, a todo el ancho y en orden", async ({ page }) => {
  await addSlot(today);
  await addSlot(future);
  await page.request.post("/api/auth/dev");
  await page.setViewportSize({ width: 390, height: 640 });

  for (const base of ["training-sessions", "training-sessions-beta"]) {
    await page.goto(`/${base}/${future}-22`);
    const header = page.getByTestId("app-header");
    const warning = page.getByTestId("session-date-warning");
    await expect(warning).toBeVisible();

    // Header first, then the experience switch, then the warning — stacked
    // with no gaps, all edge to edge.
    const headerBox = (await header.boundingBox())!;
    const switchBox = (await page.getByTestId("experience-toggle").boundingBox())!;
    const warnBox = (await warning.boundingBox())!;
    expect(headerBox.y).toBe(0);
    expect(headerBox.width).toBe(390);
    expect(warnBox.x).toBe(0);
    expect(warnBox.width).toBe(390);
    expect(Math.round(switchBox.y)).toBe(Math.round(headerBox.y + headerBox.height));
    expect(Math.round(warnBox.y)).toBe(Math.round(switchBox.y + switchBox.height));

    // Page content starts below the whole stack.
    const firstContent = page.locator(".appShell");
    expect((await firstContent.boundingBox())!.y)
      .toBeGreaterThanOrEqual(warnBox.y + warnBox.height);

    // Both stay put while scrolling, and the header shrinks.
    // scrollTo, not the wheel: the wheel needs the pointer over the
    // scroller, and where it happens to be has made this flaky.
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(header).toHaveAttribute("data-compact", "true");
    await expect(warning).toBeInViewport({ ratio: 0.95 });

    const scrolledHeader = (await header.boundingBox())!;
    expect(scrolledHeader.y).toBe(0);
    expect(scrolledHeader.height).toBeLessThan(headerBox.height);

    // The back arrow survives the shrink and keeps a thumb-sized hit area.
    const back = page.getByRole("button", { name: "Volver" });
    await expect(back).toBeVisible();
    const backBox = (await back.boundingBox())!;
    expect(backBox.height).toBeGreaterThanOrEqual(40);
    expect(backBox.width).toBeGreaterThanOrEqual(40);
  }
});

test("el ledger funciona en meses de 30 días", async ({ page }) => {
  // Regression: the roster query bounded training_sessions with `${month}-31`,
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

test("el logo del header lleva al inicio, también con el header achicado", async ({ page }) => {
  await addSlot(today);
  await addSlot(future);
  await page.request.post("/api/auth/dev");
  await page.setViewportSize({ width: 390, height: 640 });

  // A session that is not the current one: its warning bar is what makes the
  // page tall enough to scroll at all. On today's, with an empty roster and no
  // warning, there is nothing to scroll and the header never shrinks.
  await page.goto(`/training-sessions-beta/${future}-22`);
  // The roster is fetched after mount, so goto() returning is not enough: the
  // page is still "Cargando...", nothing is tall enough to scroll, and the
  // header never shrinks. This is what made the test flaky.
  await expect(page.getByTestId("section-presentes")).toBeVisible();
  const logo = page.getByTestId("header-home");

  // Thumb-sized even once the header has shrunk the logo itself.
  // scrollTo, not the wheel: the wheel needs the pointer over the
  // scroller, and where it happens to be has made this flaky.
  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect(page.getByTestId("app-header")).toHaveAttribute("data-compact", "true");
  const box = (await logo.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(40);
  expect(box.width).toBeGreaterThanOrEqual(40);

  await logo.click();
  await page.waitForURL("/");
});
