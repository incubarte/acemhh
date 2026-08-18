import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The redesigned attendance & payments screen: presence expressed by
// sections, toggled by long-press + drag to the goal bar.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// 2026-08-20 22hs: seeded slot (cat-a + cat-b). Its previous slot-group date
// in the local DB is 2026-08-06.
const SESSION = "2026-08-20-22";
const SESSION_STR = "2026-08-20 22hs";
const PREV_SESSION_STR = "2026-08-06 22hs";
const LAST = "Newscreen"; // shared test last name

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

// name -> id
const ids = new Map<string, string>();

async function seed() {
  const s = admin();
  const mk = (name: string, dni: string) => ({
    name,
    last_name: LAST,
    dni,
    categories: ["cat-b"],
    player_type: "player",
    // trains=false everywhere: the new screen must ignore the flag.
    trains: false,
    invitee: false,
  });

  const { data: players, error } = await s.from("players")
    .insert([
      mk("Mensual", "99000501"),
      mk("Sesionista", "99000502"),
      mk("Deudor", "99000503"),
      mk("Reciente", "99000504"),
      mk("Fantasma", "99000505"),
      // cat-c: does NOT qualify for this cat-a/cat-b slot.
      { ...mk("Otracategoria", "99000506"), categories: ["cat-c"] },
      { ...mk("Visitante", "99000507"), categories: ["cat-c"] },
      // Qualifies, no attendance history, but bought this slot's bundle.
      mk("Abonado", "99000508"),
    ])
    .select("id,name");
  if (error) throw new Error(JSON.stringify(error));
  for (const p of players!) ids.set(p.name, p.id);

  const att = (name: string, session: string) => ({
    player_id: ids.get(name)!,
    session,
    attended: true,
  });
  const { error: attError } = await s.from("attendances").insert([
    att("Mensual", SESSION_STR),
    att("Sesionista", SESSION_STR),
    att("Deudor", SESSION_STR),
    att("Reciente", PREV_SESSION_STR),
  ]);
  if (attError) throw new Error(JSON.stringify(attError));

  const { error: payError } = await s.from("payments").insert([
    {
      id: crypto.randomUUID(),
      player_id: ids.get("Mensual")!,
      registered_by: "__test",
      concept: "monthly",
      month: "2026-08",
      slot: "jue 22hs",
      amount: 75000,
      is_cash: true,
    },
    {
      id: crypto.randomUUID(),
      player_id: ids.get("Sesionista")!,
      registered_by: "__test",
      concept: "session",
      session: SESSION_STR,
      month: "2026-08",
      amount: 30000,
      is_cash: true,
    },
    // Otracategoria paid their OWN slot's month bundle: that belongs to
    // their own slot's screen, not this one.
    {
      id: crypto.randomUUID(),
      player_id: ids.get("Otracategoria")!,
      registered_by: "__test",
      concept: "monthly",
      month: "2026-08",
      slot: "jue 23hs",
      amount: 75000,
      is_cash: true,
    },
    // Abonado bought the bundle FOR this slot: a legit absentee even with no
    // attendance history.
    {
      id: crypto.randomUUID(),
      player_id: ids.get("Abonado")!,
      registered_by: "__test",
      concept: "monthly",
      month: "2026-08",
      slot: "jue 22hs",
      amount: 75000,
      is_cash: true,
    },
    // Visitante paid THIS session: must show even without qualifying.
    {
      id: crypto.randomUUID(),
      player_id: ids.get("Visitante")!,
      registered_by: "__test",
      concept: "session",
      session: SESSION_STR,
      month: "2026-08",
      amount: 30000,
      is_cash: true,
    },
  ]);
  if (payError) throw new Error(JSON.stringify(payError));
}

async function openPage(page: Page) {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-new/${SESSION}`);
  await expect(page.getByText(/Presentes — total/)).toBeVisible();
}

function row(page: Page, name: string) {
  return page.locator(`[data-player-row="${ids.get(name)}"]`);
}

/** Slides the attendance wheel by `fraction` of the row width — negative
 * fraction slides left — slow (release velocity ~0), so the majority-area
 * rule decides. */
async function slideWheel(page: Page, name: string, fraction: number) {
  const box = (await row(page, name).boundingBox())!;
  const startX = fraction >= 0 ? box.x + 20 : box.x + box.width - 20;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  // The state word shows from the finger-down, before any movement.
  await expect(page.getByTestId("attendance-wheel")).toBeVisible();
  const distance = box.width * fraction;
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX + (distance * i) / 10, y);
    await page.waitForTimeout(30);
  }
  // Pause so the release velocity is ~zero.
  await page.waitForTimeout(250);
  await page.mouse.up();
  // Wait for the spring (and the commit collapse) to finish.
  await expect(page.getByTestId("attendance-wheel")).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanup();
  await seed();
});
test.afterAll(cleanup);

test("clasifica presentes por pago y ausentes por historial, ignorando trains", async ({ page }) => {
  await openPage(page);

  const presentes = page.getByTestId("section-presentes");
  const ausentes = page.getByTestId("section-ausentes");

  // Three present players (trains=false, still listed).
  await expect(page.getByText("Presentes — total: 3")).toBeVisible();
  await expect(presentes.getByText(`${LAST}, Mensual`)).toBeVisible();
  await expect(presentes.getByText(`${LAST}, Sesionista`)).toBeVisible();
  await expect(presentes.getByText(`${LAST}, Deudor`)).toBeVisible();

  // Absent with recent attendance shows up; never-seen player stays hidden
  // until "Más jugadores...".
  await expect(ausentes.getByText(`${LAST}, Reciente`)).toBeVisible();
  await expect(ausentes.getByText(`${LAST}, Fantasma`)).toHaveCount(0);
  // A player from another category who paid THIS session is a legit absentee,
  // and so is one who bought the month bundle for this very slot...
  await expect(ausentes.getByText(`${LAST}, Visitante`)).toBeVisible();
  await expect(ausentes.getByText(`${LAST}, Abonado`)).toBeVisible();
  // ...but one whose month bundle belongs to another slot is not linked to
  // this one and must not appear at all.
  await expect(ausentes.getByText(`${LAST}, Otracategoria`)).toHaveCount(0);

  await page.getByRole("button", { name: "Más jugadores..." }).click();
  await expect(ausentes.getByText(`${LAST}, Fantasma`)).toBeVisible();
  // Not even in the expanded list: cat-c does not qualify for this slot.
  await expect(ausentes.getByText(`${LAST}, Otracategoria`)).toHaveCount(0);
});

test("deslizar la ruedita más de la mitad marca presente", async ({ page }) => {
  await openPage(page);

  await slideWheel(page, "Reciente", 0.8);

  await expect(page.getByText("Presentes — total: 4")).toBeVisible();
  await expect(
    page.getByTestId("section-presentes").getByText(`${LAST}, Reciente`),
  ).toBeVisible();
});

test("un deslizamiento corto vuelve atrás sin cambiar nada", async ({ page }) => {
  await openPage(page);

  await slideWheel(page, "Mensual", 0.3);

  // Still present: the wheel snapped back to its detent.
  await expect(page.getByText("Presentes — total: 4")).toBeVisible();
  await expect(
    page.getByTestId("section-presentes").getByText(`${LAST}, Mensual`),
  ).toBeVisible();
});

test("la ruedita también gira a la izquierda: presente pasa a ausente", async ({ page }) => {
  await openPage(page);

  await slideWheel(page, "Mensual", -0.8);

  await expect(page.getByText("Presentes — total: 3")).toBeVisible();
  await expect(
    page.getByTestId("section-ausentes").getByText(`${LAST}, Mensual`),
  ).toBeVisible();
});

test("toggles rápidos encadenados durante el refresh", async ({ page }) => {
  await openPage(page);

  // First toggle: Mensual (absent) slides right — a black slot is reserved
  // under "Pagó mes completo" while the refresh runs.
  await slideWheel(page, "Mensual", 0.8);
  await expect(page.getByTestId("reserved-black")).toBeVisible();

  // Without waiting for any refresh, second toggle: Sesionista slides left to
  // absent, and their reserved row shows among Ausentes immediately.
  await slideWheel(page, "Sesionista", -0.8);
  await expect(
    page.getByTestId("section-ausentes").getByText(`${LAST}, Sesionista`),
  ).toBeVisible();

  // After the 3s quiet window the LAST refresh renders the real diff.
  await expect(page.getByTestId("reserved-black")).toHaveCount(0, { timeout: 8000 });
  await expect(
    page.getByTestId("section-presentes").getByText(`${LAST}, Mensual`),
  ).toBeVisible();
  await expect(
    page.getByTestId("section-ausentes").getByText(`${LAST}, Sesionista`),
  ).toBeVisible();
  await expect(page.getByText("Presentes — total: 3")).toBeVisible();
});

test("buscar jugador lo marca presente", async ({ page }) => {
  await openPage(page);

  await page.getByRole("button", { name: /Buscar jugador/ }).click();
  await page.getByPlaceholder("Nombre o apellido").fill("Fantasma");
  await page.getByRole("button", { name: `${LAST}, Fantasma` }).click();

  await expect(page.getByText("Presentes — total: 4")).toBeVisible();
});
