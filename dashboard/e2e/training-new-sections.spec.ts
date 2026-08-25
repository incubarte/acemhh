import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// How the redesigned screen reads at a glance: what each section says about
// the rows in it, what the debtors list spells out, and the gesture that
// decides whether the PRESENTE/AUSENTE word appears at all.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// The jue 22hs slot (cat-a + cat-b). August holds three of its trainings,
// September four — so an August debt is still "last month" from September.
const SESSION = "2026-08-20-22";
const SESSION_STR = "2026-08-20 22hs";
const NEXT_MONTH_SESSION = "2026-09-24-22";
const LAST = "Secciones";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function cleanup() {
  const s = admin();
  const { data } = await s.from("players").select("id").eq("last_name", LAST);
  const pids = (data ?? []).map((p) => p.id);
  if (pids.length === 0) return;
  await s.from("payments").delete().in("player_id", pids);
  await s.from("attendances").delete().in("player_id", pids);
  await s.from("players").delete().in("id", pids);
}

const ids = new Map<string, string>();

async function seed() {
  const s = admin();
  const mk = (name: string, dni: string) => ({
    name,
    last_name: LAST,
    dni,
    categories: ["cat-b"],
    player_type: "player",
    trains: true,
    invitee: false,
  });

  const { data: players, error } = await s.from("players")
    .insert([mk("Moroso", "99000601"), mk("Alcorriente", "99000602")])
    .select("id,name");
  if (error) throw new Error(JSON.stringify(error));
  for (const p of players!) ids.set(p.name, p.id);

  const { error: attError } = await s.from("attendances").insert(
    ["Moroso", "Alcorriente"].map((name) => ({
      player_id: ids.get(name)!,
      session: SESSION_STR,
      attended: true,
    })),
  );
  if (attError) throw new Error(JSON.stringify(attError));

  // Alcorriente paid the session they attended; Moroso paid nothing.
  const { error: payError } = await s.from("payments").insert([{
    id: crypto.randomUUID(),
    player_id: ids.get("Alcorriente")!,
    registered_by: "__test",
    concept: "session",
    session: SESSION_STR,
    month: "2026-08",
    amount: 30000,
    is_cash: true,
  }]);
  if (payError) throw new Error(JSON.stringify(payError));
}

async function openPage(page: Page, session = SESSION) {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-beta/${session}`);
  await expect(page.getByTestId("section-presentes")).toBeVisible();
}

/** A row inside a given section — a debtor renders in two of them. */
function rowIn(page: Page, section: string, name: string) {
  return page.getByTestId(section).locator(`[data-player-row="${ids.get(name)}"]`);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanup();
  await seed();
});
test.afterAll(cleanup);

test("un scroll que arranca sobre una fila no cambia la palabra, una pulsación sí", async ({ page }) => {
  await openPage(page);
  const wheel = page.getByTestId("attendance-wheel");
  // Centred and settled: with the club's real roster loaded the row sits well
  // down the page, and near the bottom-left corner the dev-tools badge eats
  // the press.
  const target = rowIn(page, "section-presentes", "Alcorriente");
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const box = (await target.boundingBox())!;
  const x = box.x + 20;
  const y = box.y + box.height / 2;

  // Straight down off the row: the scroller's gesture. The word must never
  // flash — that flicker is the whole reason the reveal waits.
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(x, y - i * 12);
    await expect(wheel).toHaveCount(0);
  }
  await page.mouse.up();
  await expect(wheel).toHaveCount(0);

  // A finger that rests on the row first meant to be there: the word shows,
  // and scrolling after that is still just scrolling.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(wheel.first()).toBeVisible();
  // Stepped, so every move lands on a row and reaches the handler — a single
  // jump can clear the list entirely and be delivered nowhere.
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y - i * 12);
  await expect(wheel).toHaveCount(0);
  await page.mouse.up();

  // Sideways is unambiguous, so it does not wait out the dwell: the word is
  // up well before the delay could have elapsed.
  await page.mouse.move(x, y);
  await page.mouse.down();
  const t0 = Date.now();
  await page.mouse.move(x + 40, y);
  await expect(wheel.first()).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(170);

  // Back to the detent and release: nothing committed.
  await page.mouse.move(x, y);
  await page.mouse.up();
  await expect(wheel).toHaveCount(0);
  await expect(rowIn(page, "section-presentes", "Alcorriente")).toBeVisible();
});

test("el deudor lleva sus cifras del mes, alineado a la izquierda; el resto va centrado", async ({ page }) => {
  await openPage(page);

  // Alcorriente paid the session they attended: nothing owed, not chased.
  await expect(rowIn(page, "section-deudores", "Alcorriente")).toHaveCount(0);

  // Moroso trained once this month and paid nothing. August is the ledger's
  // first month, so there is no previous one to spell out — the current
  // month's figures stand alone.
  await expect(rowIn(page, "section-deudores", "Moroso").getByTestId("debtor-stats"))
    .toHaveText("1/0");

  // Only the debtors keep their names left-aligned and carry figures; the
  // other sections centre the name, under where the wheel puts its word.
  const nameIn = (section: string, name: string) =>
    rowIn(page, section, name).getByTestId("player-name");
  await expect(nameIn("section-deudores", "Moroso")).toHaveCSS("text-align", "left");
  await expect(nameIn("section-presentes", "Alcorriente")).toHaveCSS("text-align", "center");
  await expect(rowIn(page, "section-presentes", "Alcorriente").getByTestId("debtor-stats"))
    .toHaveCount(0);
});

test("desde septiembre se ve la deuda de agosto, y el mes corriente es un guión", async ({ page }) => {
  // Moroso's August attendance went unpaid. Seen from September that is last
  // month's debt — shown as attendance/payments — while September itself owes
  // nothing yet, so it collapses to a dash.
  await openPage(page, NEXT_MONTH_SESSION);
  await expect(rowIn(page, "section-deudores", "Moroso").getByTestId("debtor-stats"))
    .toHaveText("1/0 -");
});

test("la deuda no se arrastra dos meses: en octubre ya no figura", async ({ page }) => {
  // October's previous month is September, which owes nothing. The August
  // debt is two months back — deliberately out of this screen's reach.
  await openPage(page, "2026-10-01-22");
  await expect(rowIn(page, "section-deudores", "Moroso")).toHaveCount(0);
});

test("la fila de Deben no toma el gesto: ni desliza ni cambia de color", async ({ page }) => {
  await openPage(page);
  const debtRow = rowIn(page, "section-deudores", "Moroso");
  const wheel = page.getByTestId("attendance-wheel");
  const box = (await debtRow.boundingBox())!;
  const y = box.y + box.height / 2;

  // A full sideways slide across the row: on any other section this commits
  // the toggle. Here nothing appears and nothing moves.
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + 20 + (box.width * 0.8 * i) / 10, y);
    await expect(wheel).toHaveCount(0);
  }
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect(wheel).toHaveCount(0);

  // Moroso is present (they trained and did not pay), and stayed present:
  // the slide changed nothing at all.
  await expect(rowIn(page, "section-presentes", "Moroso")).toBeVisible();
  await expect(rowIn(page, "section-ausentes", "Moroso")).toHaveCount(0);
  await expect(debtRow.getByTestId("debtor-stats")).toHaveText("1/0");

  // And the row paints nothing of its own, so a present debtor reads exactly
  // like an absent one — in Deben the section's colour is the whole story.
  const bg = await debtRow.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgba(0, 0, 0, 0)");
});

test("el refresh no reordena las filas mientras el dedo sigue marcando", async ({ page }) => {
  await openPage(page);
  const presentes = page.getByTestId("section-presentes");
  const ausentes = page.getByTestId("section-ausentes");
  const row = (name: string) => `[data-player-row="${ids.get(name)}"]`;

  // The server is told Alcorriente is absent, but its answer is held at the
  // route until we let it through — so the moment it lands is ours to pick.
  let releaseRefresh: () => void = () => {};
  let served = 0;
  await page.route("**/api/training-sessions-beta/**", async (route) => {
    served += 1;
    await new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await route.continue();
  });

  await admin().from("attendances")
    .update({ attended: false })
    .eq("player_id", ids.get("Alcorriente")!)
    .eq("session", SESSION_STR);

  /** Turns the wheel by `fraction` of the row width and lets go. */
  const slide = async (name: string, fraction: number) => {
    const target = rowIn(page, "section-presentes", name);
    await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const box = (await target.boundingBox())!;
    const from = box.x + box.width - 70;
    const y = box.y + box.height / 2;
    await page.mouse.move(from, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(from + (box.width * fraction * i) / 10, y);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(250); // release with ~zero velocity
    await page.mouse.up();
  };

  // Marking Moroso absent fires its refresh, which the route now holds.
  await slide("Moroso", -0.8);
  await expect(presentes.locator(row("Moroso"))).toHaveCount(0);
  await expect.poll(() => served).toBeGreaterThan(0);

  // Now put a finger down on another row and keep it there. Only once it is
  // down do we let the answer through, so it necessarily lands mid-gesture.
  const box = (await rowIn(page, "section-presentes", "Alcorriente").boundingBox())!;
  const from = box.x + box.width - 70;
  const y = box.y + box.height / 2;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(from - 40, y);
  await expect(page.getByTestId("attendance-wheel").first()).toBeVisible();

  releaseRefresh();
  await page.waitForTimeout(600);

  // Held: the row under the thumb has not been pulled out from under it.
  await expect(presentes.locator(row("Alcorriente"))).toBeVisible();
  await expect(ausentes.locator(row("Alcorriente"))).toHaveCount(0);

  // Let go — snapping back, so nothing is toggled — and the quiet window
  // finally lets the answer land.
  await page.mouse.move(from, y);
  await page.mouse.up();
  await expect(ausentes.locator(row("Alcorriente"))).toBeVisible({ timeout: 4000 });
  await expect(presentes.locator(row("Alcorriente"))).toHaveCount(0);

  await admin().from("attendances")
    .update({ attended: true })
    .eq("player_id", ids.get("Alcorriente")!)
    .eq("session", SESSION_STR);
});

test("una respuesta vieja no pisa un cambio que ya está en pantalla", async ({ page }) => {
  // Moroso is left absent by the previous test; this one needs them present.
  await admin().from("attendances")
    .update({ attended: true })
    .eq("player_id", ids.get("Moroso")!)
    .eq("session", SESSION_STR);
  await openPage(page);

  // Each refresh reaches the server — so its body is a real snapshot of that
  // moment — but the answer is parked until we let it through, in order.
  const gates: Array<() => void> = [];
  await page.route("**/api/training-sessions-beta/**", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await new Promise<void>((resolve) => gates.push(resolve));
    await route.fulfill({ status: response.status(), headers: response.headers(), body });
  });

  const pay = async (name: string) => {
    await rowIn(page, "section-presentes", name).getByRole("button", { name: "+" }).click();
    const modal = page.getByTestId("payment-modal");
    await modal.getByText(/Sesión individual/).click();
    await modal.getByRole("button", { name: "Confirmar" }).click();
    await expect(modal).toHaveCount(0);
  };

  // Alcorriente first: its refresh snapshots a server that knows nothing of
  // the payment Moroso is about to make.
  await pay("Alcorriente");
  await expect(rowIn(page, "section-presentes", "Alcorriente").getByText(/\(30k, 30k\)/))
    .toBeVisible();

  await pay("Moroso");
  const moroso = rowIn(page, "section-presentes", "Moroso");
  await expect(moroso.getByText(/\(30k\)/)).toBeVisible();

  await expect.poll(() => gates.length).toBe(2);

  // Letting the FIRST one through: it is a snapshot from before Moroso paid,
  // and a later refresh is already in flight, so it must be thrown away
  // rather than applied — otherwise the payment vanishes from the row.
  gates[0]();
  await page.waitForTimeout(600);
  await expect(moroso.getByText(/\(30k\)/)).toBeVisible();

  // The up-to-date one only confirms what is already on screen.
  gates[1]();
  await expect(moroso.getByText(/\(30k\)/)).toBeVisible();
});
