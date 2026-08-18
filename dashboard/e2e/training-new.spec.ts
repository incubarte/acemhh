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

async function longPressAndDrag(page: Page, name: string, dropOnGoal: boolean) {
  const box = (await row(page, name).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // The goal bar appears after the 1s long-press.
  await page.waitForTimeout(1200);
  await expect(page.getByText(/Cambiar a/)).toBeVisible();

  const goal = (await page.getByText(/Cambiar a/).boundingBox())!;
  if (dropOnGoal) {
    await page.mouse.move(goal.x + goal.width / 2, goal.y + goal.height / 2, { steps: 5 });
  } else {
    // Anywhere clearly outside the goal bar.
    await page.mouse.move(goal.x + goal.width / 2, goal.y - 150, { steps: 5 });
  }
  await page.mouse.up();
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
  await page.getByRole("button", { name: "Más jugadores..." }).click();
  await expect(ausentes.getByText(`${LAST}, Fantasma`)).toBeVisible();
});

test("long-press y drag al arco marca presente", async ({ page }) => {
  await openPage(page);

  await longPressAndDrag(page, "Reciente", true);

  await expect(page.getByText("Presentes — total: 4")).toBeVisible();
  await expect(
    page.getByTestId("section-presentes").getByText(`${LAST}, Reciente`),
  ).toBeVisible();
});

test("soltar fuera del arco no cambia nada", async ({ page }) => {
  await openPage(page);

  await longPressAndDrag(page, "Mensual", false);

  // Still present: the drop landed outside the goal.
  await expect(page.getByText("Presentes — total: 4")).toBeVisible();
  await expect(
    page.getByTestId("section-presentes").getByText(`${LAST}, Mensual`),
  ).toBeVisible();
});

test("buscar jugador lo marca presente", async ({ page }) => {
  await openPage(page);

  await page.getByRole("button", { name: /Buscar jugador/ }).click();
  await page.getByPlaceholder("Nombre o apellido").fill("Fantasma");
  await page.getByRole("button", { name: `${LAST}, Fantasma` }).click();

  await expect(page.getByText("Presentes — total: 5")).toBeVisible();
});
