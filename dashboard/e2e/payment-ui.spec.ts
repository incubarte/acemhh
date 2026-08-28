import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sessionIn, writableSession, type Fixture } from "./fixtures";

// The two things the screen has to get right about money: the admin declares
// what a payment IS, and marking somebody present who owes is worth a word.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const LAST = "Cobros";
let fx: Fixture;
let debtorId: string;
let clearId: string;

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
  const s = admin();
  const mk = (name: string, dni: string) => ({
    name, last_name: LAST, dni, categories: ["cat-b"],
    player_type: "player", trains: true, invitee: false,
  });
  const { data, error } = await s.from("players")
    .insert([mk("Debe", "99000801"), mk("Aldia", "99000802")])
    .select("id,name");
  if (error) throw new Error(JSON.stringify(error));
  debtorId = data!.find((p) => p.name === "Debe")!.id;
  clearId = data!.find((p) => p.name === "Aldia")!.id;

  // The debtor attended and never paid; the other one is simply absent.
  await s.from("attendances")
    .insert({ player_id: debtorId, session: fx.sessionStr, attended: true });
});
test.afterAll(cleanup);

async function open(page: import("@playwright/test").Page) {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-beta/${fx.session}`);
  await expect(page.getByTestId("section-presentes")).toBeVisible();
  // Someone absent with no recent training sits behind "Más jugadores...".
  const more = page.getByRole("button", { name: /Más jugadores/ });
  if (await more.isVisible().catch(() => false)) await more.click();
}

function row(page: import("@playwright/test").Page, id: string) {
  return page.locator(`[data-player-row="${id}"]`).last();
}

test("el modal pide el concepto: el monto ya no lo decide", async ({ page }) => {
  await open(page);
  await row(page, clearId).getByRole("button", { name: "+" }).click();

  const modal = page.getByTestId("payment-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId("pay-session")).toBeVisible();
  // "Otro..." has to say what it is.
  await expect(modal.getByTestId("custom-concept")).toBeVisible();

  await modal.getByTestId("pay-session").click();
  await expect(modal.getByText(/Sesión del/)).toBeVisible();
  await modal.getByRole("button", { name: "Confirmar" }).click();
  await expect(modal).toHaveCount(0);

  const { data } = await admin().from("payments")
    .select("concept,amount").eq("player_id", clearId).single();
  expect(data!.concept).toBe("session");
});

test("con deuda cerrada, lo único que se ofrece es saldarla", async ({ page }) => {
  // Closed debt means a month that already ended, so this has to be read from
  // a later month of the same period — the unpaid session is this month's.
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-beta/${await sessionIn(fx.nextMonth)}`);
  await expect(page.getByTestId("section-presentes")).toBeVisible();
  const more = page.getByRole("button", { name: /Más jugadores/ });
  if (await more.isVisible().catch(() => false)) await more.click();

  await row(page, debtorId).getByRole("button", { name: "+" }).click();

  const modal = page.getByTestId("payment-modal");
  await expect(modal.getByTestId("pay-debt")).toBeVisible();
  await expect(modal.getByTestId("pay-session")).toHaveCount(0);
  await expect(modal.getByTestId("pay-month")).toHaveCount(0);
});

test("marcar presente a alguien que debe avisa, pero nunca impide", async ({ page }) => {
  // From the following month, this month's unpaid session is closed debt —
  // exactly the case the warning exists for.
  const later = await sessionIn(fx.nextMonth);
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-beta/${later}`);
  await expect(page.getByTestId("section-presentes")).toBeVisible();
  const more = page.getByRole("button", { name: /Más jugadores/ });
  if (await more.isVisible().catch(() => false)) await more.click();

  const target = page.locator(`[data-player-row="${debtorId}"]`).last();
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const box = (await target.boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + 20;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from + (box.width * 0.08 * i), y);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(250);
  await page.mouse.up();

  const warning = page.getByTestId("debt-warning");
  await expect(warning).toBeVisible({ timeout: 4000 });
  await expect(warning).toContainText("Debe");

  // It warns and lets through: the attendance is what we must not lose.
  // The row moves optimistically, so the write has to be awaited or the query
  // below runs first.
  const written = page.waitForResponse((r) =>
    r.url().includes("/attendance") && r.request().method() === "POST");
  await page.getByTestId("debt-warning-anyway").click();
  await written;
  await expect(
    page.getByTestId("section-presentes").locator(`[data-player-row="${debtorId}"]`),
  ).toBeVisible();

  const { data } = await admin().from("attendances")
    .select("attended").eq("player_id", debtorId)
    .eq("session", `${later.slice(0, 10)} ${later.slice(11)}hs`).single();
  expect(data!.attended).toBe(true);
});

test("cada sección busca lo suyo: arqueros por un lado, jugadores por el otro", async ({ page }) => {
  const s = admin();
  // A goalkeeper and a field player who share a surname, so the only thing
  // separating them in the results is which search asked.
  await s.from("players").delete().in("dni", ["99000803", "99000804"]);
  const { data, error } = await s.from("players").insert([
    {
      name: "Arquero", last_name: LAST, dni: "99000803", categories: ["cat-b"],
      player_type: "goalkeeper", trains: true, invitee: false,
    },
    {
      name: "Campo", last_name: LAST, dni: "99000804", categories: ["cat-b"],
      player_type: "player", trains: true, invitee: false,
    },
  ]).select("id,name");
  if (error) throw new Error(JSON.stringify(error));
  const gkId = data!.find((p) => p.name === "Arquero")!.id;

  await open(page);

  // The players search does not turn up the goalkeeper...
  await page.getByTestId("search-player").click();
  await page.getByPlaceholder("Nombre o apellido").fill(LAST);
  await expect(page.getByRole("button", { name: `${LAST}, Campo` })).toBeVisible();
  await expect(page.getByRole("button", { name: `${LAST}, Arquero` })).toHaveCount(0);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(5, 5);

  // ...and the goalkeepers search does not turn up the field player.
  await page.getByTestId("search-goalkeeper").click();
  await page.getByPlaceholder("Nombre o apellido").fill(LAST);
  await expect(page.getByRole("button", { name: `${LAST}, Arquero` })).toBeVisible();
  await expect(page.getByRole("button", { name: `${LAST}, Campo` })).toHaveCount(0);

  // Picking one marks them present, in the goalkeepers section.
  const written = page.waitForResponse((r) =>
    r.url().includes("/attendance") && r.request().method() === "POST");
  await page.getByRole("button", { name: `${LAST}, Arquero` }).click();
  await written;
  await expect(
    page.getByTestId("section-arqueros-presentes").locator(`[data-player-row="${gkId}"]`),
  ).toBeVisible();
});
