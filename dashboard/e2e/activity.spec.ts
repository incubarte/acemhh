import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writableSession, type Fixture } from "./fixtures";

// The activity log: a payment leaves a chain of lines tied by one trace — the
// tap that sent it (UI), what the service answered (API), the row it wrote
// (DB) — and a line that could not be sent arrives later, saying so.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const LAST = "Actividad";
let fx: Fixture;
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

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fx = await writableSession(22);
  await cleanup();
  const { data, error } = await admin().from("players").insert({
    name: "Traza", last_name: LAST, dni: "99000901", categories: ["cat-b"],
    player_type: "player", trains: true, invitee: false,
  }).select("id").single();
  if (error) throw new Error(JSON.stringify(error));
  playerId = data!.id;
});
test.afterAll(cleanup);

async function open(page: Page) {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-beta/${fx.session}`);
  await expect(page.getByTestId("section-presentes")).toBeVisible();
  const more = page.getByRole("button", { name: /Más jugadores/ });
  if (await more.isVisible().catch(() => false)) await more.click();
}

type Row = {
  source: string; action: string; actor_id: string | null; actor: string | null;
  trace: string | null; detail: Record<string, unknown>; status: number | null;
  attempts: number | null; after_close: boolean | null; delay_ms: number | null; screen: string | null;
};

async function linesSince(since: string): Promise<Row[]> {
  const { data, error } = await admin().from("activity_log")
    .select("source,action,actor_id,actor,trace,detail,status,attempts,after_close,delay_ms,screen")
    .gte("received_at", since).order("at");
  if (error) throw new Error(JSON.stringify(error));
  return (data ?? []) as Row[];
}

test("un cobro deja tap, envío, respuesta y fila, atados por un trace", async ({ page }) => {
  const since = new Date().toISOString();
  await open(page);
  await page.locator(`[data-player-row="${playerId}"]`).last().getByRole("button", { name: "+" }).click();
  const modal = page.getByTestId("payment-modal");
  await modal.getByTestId("pay-session").click();
  await modal.getByRole("button", { name: "Confirmar" }).click();
  await expect(modal).toHaveCount(0);

  await expect.poll(async () => {
    const rows = await linesSince(since);
    const submit = rows.find((r) => r.source === "UI" && r.action === "submit" &&
      String(r.detail.api).endsWith("/payment"));
    if (!submit?.trace) return "sin submit";
    const chain = rows.filter((r) => r.trace === submit.trace).map((r) => `${r.source} ${r.action}`);
    return chain.sort().join(" | ");
  }, { timeout: 10_000 }).toBe(
    `API POST /api/training-sessions/${fx.session}/payment | DB insert payments | UI submit`,
  );

  const rows = await linesSince(since);
  const submit = rows.find((r) => r.source === "UI" && r.action === "submit" && String(r.detail.api).endsWith("/payment"))!;
  expect(submit.attempts).toBe(1);
  expect(submit.after_close).toBe(false);
  expect((submit.detail.body as Record<string, unknown>).player_id).toBe(playerId);

  const api = rows.find((r) => r.source === "API" && r.trace === submit.trace)!;
  expect(api.status).toBe(200);
  const db = rows.find((r) => r.source === "DB" && r.trace === submit.trace)!;
  // Who wrote it reaches the trigger, not only the API line.
  expect(db.actor_id).toBe(api.actor_id);
  expect(db.actor_id).not.toBeNull();

  // The tap that opened the modal says which player it was for.
  const tap = rows.find((r) => r.source === "UI" && r.action === "tap" && r.detail.label === "+");
  expect(tap?.detail.player_id).toBe(playerId);
  // And the screen it happened on.
  expect(tap?.screen).toBe(`/training-sessions-beta/${fx.session}`);
});

test("si el envío falla, la línea llega después con sus reintentos", async ({ page }) => {
  const since = new Date().toISOString();
  await open(page);
  let blocked = true;
  await page.route("**/api/activity", (route) => blocked ? route.abort("internetdisconnected") : route.continue());
  await page.getByRole("button", { name: /Buscar jugador/ }).first().click().catch(() => {});
  await page.evaluate(() => (window as unknown as { __mark?: number }).__mark = 1);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.waitForTimeout(1_000);
  blocked = false;

  await expect.poll(async () => {
    const rows = await linesSince(since);
    return rows.some((r) => r.source === "UI" && (r.attempts ?? 0) >= 2 && r.after_close === false);
  }, { timeout: 20_000 }).toBe(true);
});

test("lo que no salió antes de cerrar lo manda la próxima pantalla, y lo dice", async ({ browser }) => {
  const since = new Date().toISOString();
  const context = await browser.newContext();
  const first = await context.newPage();
  await open(first);
  // No signal from here on: nothing the page does reaches the server, the
  // send it makes as it closes included.
  await context.setOffline(true);
  await first.getByRole("button", { name: /Buscar jugador/ }).first().click();
  await first.waitForTimeout(300);
  // A blank tab keeps the browser's context alive once the first one closes.
  const second = await context.newPage();
  await first.close({ runBeforeUnload: true });
  await second.waitForTimeout(500);

  await context.setOffline(false);
  await second.request.post("/api/auth/dev");
  await second.goto("/");

  await expect.poll(async () => {
    const rows = await linesSince(since);
    return rows.some((r) => r.source === "UI" && r.action === "tap" && r.after_close === true &&
      (r.attempts ?? 0) >= 2 && r.screen === `/training-sessions-beta/${fx.session}`);
  }, { timeout: 15_000 }).toBe(true);
  await context.close();
});

test("una edición directa en la base queda como manual", async () => {
  // Through PostgREST without the dashboard's headers it is "servicio"; the
  // trigger tells manual edits by their direct connection, which this spec
  // cannot open, so it checks the service case and that nothing is lost.
  const since = new Date().toISOString();
  await admin().from("players").update({ scholarship: 3 }).eq("id", playerId);
  await admin().from("players").update({ scholarship: 0 }).eq("id", playerId);
  const rows = (await linesSince(since)).filter((r) => r.source === "DB" && r.action === "update players");
  expect(rows.length).toBe(2);
  expect(rows[0].actor).toBe("servicio");
  expect(rows[0].detail.new).toEqual({ scholarship: 3 });
  expect(rows[0].detail.old).toEqual({ scholarship: 0 });
});

test("la pantalla Actividad muestra el cobro, y tocarlo deja solo su cadena", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto("/actividad");
  const lines = page.getByTestId("activity-line");
  const submit = lines.filter({ hasText: "submit cobro" }).filter({ hasText: 'j:"Traza Actividad"' }).first();
  await expect(submit).toBeVisible({ timeout: 10_000 });
  await expect(submit).toContainText("en vivo");
  await submit.click();
  await expect(lines).toHaveCount(3);
  await expect(lines.filter({ hasText: "recibió cobro → 200" })).toHaveCount(1);
  await expect(lines.filter({ hasText: "insert payments" })).toHaveCount(1);
  await page.screenshot({ path: "test-results/actividad.png", fullPage: false });
});
