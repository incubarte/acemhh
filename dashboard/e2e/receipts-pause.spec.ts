import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Pausing the WhatsApp payment receipts: ROOT sets it from /avisos, it ends
// on its own, and nobody else can touch it.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await admin().from("app_settings").delete().eq("key", "payment_receipts_pause");
});

test("pausar desde la pantalla deja la hora de fin, y reanudar la borra", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto("/avisos");
  const state = page.getByTestId("receipts-state");
  await expect(state).toContainText("Activos");

  await page.getByRole("button", { name: "Pausar 30 min" }).click();
  await expect(state).toContainText("Pausados");
  await expect(state).toContainText(/faltan (29|30) min/);
  const { data } = await admin().from("app_settings").select("value").eq("key", "payment_receipts_pause").single();
  const left = new Date(data!.value.until).getTime() - Date.now();
  expect(left).toBeGreaterThan(29 * 60_000);
  expect(left).toBeLessThanOrEqual(30 * 60_000);

  await page.getByRole("button", { name: "Reanudar ya" }).click();
  await expect(state).toContainText("Activos");
  const { data: after } = await admin().from("app_settings").select("value").eq("key", "payment_receipts_pause").single();
  expect(after!.value.until).toBeNull();
});

test("una pausa vencida se muestra como activos", async ({ page }) => {
  await admin().from("app_settings").upsert({
    key: "payment_receipts_pause",
    value: { until: new Date(Date.now() - 60_000).toISOString() },
  });
  await page.request.post("/api/auth/dev");
  const res = await page.request.get("/api/receipts-pause");
  expect((await res.json()).until).toBeNull();
});

test("quien no es ROOT no puede pausar", async ({ page }) => {
  const s = admin();
  await page.request.post("/api/auth/dev");
  const me = await (await page.request.get("/api/me")).json();
  const { data: dev } = await s.from("users").select("id,groups").eq("id", me.id).single();
  await s.from("users").update({ groups: ["WHEEL"] }).eq("id", dev!.id);
  try {
    await page.request.post("/api/auth/dev");
    const res = await page.request.post("/api/receipts-pause", { data: { minutes: 30 } });
    expect(res.status()).toBe(403);
  } finally {
    await s.from("users").update({ groups: dev!.groups }).eq("id", dev!.id);
  }
});
