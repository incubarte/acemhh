import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { todayBA } from "./fixtures";

// Torneos: la lista de equipos, los puntos por cuota de cada jugador, el
// detalle y el registro de pagos. Siembra su propio torneo con dos categorías
// — una que arranca este mes y otra que arrancó el mes pasado — así los
// estados de los puntos no dependen del calendario.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const LAST = "Torneotest";
const TOURNAMENT = "Torneo Test";
const TEAM_NEW = "Equipo Nuevo Test";
const TEAM_OLD = "Equipo Viejo Test";
const UPFRONT = 178000;
const AMOUNTS = [60000, 55000, 55000, 25000];

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

const players = new Map<string, string>();
const teams = new Map<string, string>();
let tournamentId: string;

async function cleanup() {
  const s = admin();
  const { data: ts } = await s.from("tournaments").select("id").eq("name", TOURNAMENT);
  const tIds = (ts ?? []).map((t) => t.id);
  if (tIds.length > 0) {
    const { data: tm } = await s.from("teams").select("id").in("tournament_id", tIds);
    const teamIds = (tm ?? []).map((t) => t.id);
    if (teamIds.length > 0) await s.from("payments").delete().in("team_id", teamIds);
    await s.from("tournaments").delete().in("id", tIds);
  }
  const { data: ps } = await s.from("players").select("id").eq("last_name", LAST);
  const pIds = (ps ?? []).map((p) => p.id);
  if (pIds.length > 0) {
    await s.from("payments").delete().in("player_id", pIds);
    await s.from("players").delete().in("id", pIds);
  }
}

test.beforeAll(async () => {
  await cleanup();
  const s = admin();
  const month = todayBA().slice(0, 7);

  const mk = (name: string, dni: string) => ({
    name, last_name: LAST, dni, categories: ["cat-a"], player_type: "player", trains: false, invitee: false,
  });
  const { data: ps, error: pErr } = await s.from("players").insert([
    mk("Nada", "99002001"),
    mk("Parcial", "99002002"),
    mk("Adelantado", "99002003"),
    mk("Suplente", "99002004"),
    mk("Moroso", "99002005"),
    mk("Mitad", "99002006"),
  ]).select("id,name");
  if (pErr) throw new Error(JSON.stringify(pErr));
  for (const p of ps!) players.set(p.name, p.id);

  const { data: t, error: tErr } = await s.from("tournaments")
    .insert({ name: TOURNAMENT }).select("id").single();
  if (tErr) throw new Error(JSON.stringify(tErr));
  tournamentId = t.id;

  const { data: cats, error: cErr } = await s.from("tournament_categories").insert([
    { tournament_id: tournamentId, name: "Nueva", position: 1, upfront_price: UPFRONT },
    { tournament_id: tournamentId, name: "Vieja", position: 2, upfront_price: UPFRONT },
  ]).select("id,name");
  if (cErr) throw new Error(JSON.stringify(cErr));
  const cat = new Map(cats!.map((c) => [c.name, c.id]));

  // "Nueva" arranca este mes; "Vieja" arrancó el mes pasado.
  const installments = (catId: string, from: number) =>
    AMOUNTS.map((amount, i) => ({ category_id: catId, month: shiftMonth(month, from + i), amount }));
  const { error: iErr } = await s.from("tournament_installments").insert([
    ...installments(cat.get("Nueva")!, 0),
    ...installments(cat.get("Vieja")!, -1),
  ]);
  if (iErr) throw new Error(JSON.stringify(iErr));

  const { data: tm, error: tmErr } = await s.from("teams").insert([
    { tournament_id: tournamentId, category_id: cat.get("Nueva"), name: TEAM_NEW },
    { tournament_id: tournamentId, category_id: cat.get("Vieja"), name: TEAM_OLD },
  ]).select("id,name");
  if (tmErr) throw new Error(JSON.stringify(tmErr));
  for (const x of tm!) teams.set(x.name, x.id);

  const member = (team: string, name: string, role: string) =>
    ({ team_id: teams.get(team)!, player_id: players.get(name)!, role });
  const { error: mErr } = await s.from("team_players").insert([
    member(TEAM_NEW, "Nada", "starter"),
    member(TEAM_NEW, "Parcial", "starter"),
    member(TEAM_NEW, "Adelantado", "starter"),
    member(TEAM_NEW, "Suplente", "substitute"),
    member(TEAM_OLD, "Moroso", "starter"),
    member(TEAM_OLD, "Mitad", "starter"),
  ]);
  if (mErr) throw new Error(JSON.stringify(mErr));

  const pay = (team: string, name: string, amount: number) => ({
    id: crypto.randomUUID(),
    player_id: players.get(name)!,
    team_id: teams.get(team)!,
    registered_by: "__test",
    concept: "tournament",
    month,
    amount,
    is_cash: true,
  });
  const { error: payErr } = await s.from("payments").insert([
    pay(TEAM_NEW, "Parcial", 30000),
    // El ejemplo del pedido: el mes pasado entero y el 40% de éste.
    pay(TEAM_OLD, "Mitad", 60000),
    pay(TEAM_OLD, "Mitad", 22000),
  ]);
  if (payErr) throw new Error(JSON.stringify(payErr));
});
test.afterAll(cleanup);

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/dev");
});

/** La lista, parada en el torneo de prueba (hay otro activo, el real). */
async function openTournaments(page: Page) {
  await page.goto("/torneos");
  // La lista llega por fetch: esperar a que haya algo antes de mirar las pestañas.
  await expect(
    page.getByTestId("tournament-tab").or(page.getByTestId("tournament-name")).first(),
  ).toBeVisible();
  const tab = page.getByTestId("tournament-tab").filter({ hasText: TOURNAMENT });
  if (await tab.count()) await tab.click();
}

const dotsOf = (page: Page, name: string) =>
  page.locator(`[data-player-row="${players.get(name)}"]`).getByTestId("fee-dot");
const standingOf = (page: Page, name: string) =>
  page.locator(`[data-player-row="${players.get(name)}"]`).getByTestId("player-standing");

async function expectStatuses(page: Page, name: string, expected: string[]) {
  const dots = dotsOf(page, name);
  await expect(dots).toHaveCount(expected.length);
  for (let i = 0; i < expected.length; i++) {
    await expect(dots.nth(i)).toHaveAttribute("data-status", expected[i]);
  }
}

test("la lista agrupa los equipos por categoría y dice cuántos deben", async ({ page }) => {
  await openTournaments(page);

  const nueva = page.locator('[data-testid="category-section"][data-category="Nueva"]');
  const cardNew = nueva.getByTestId("team-card").filter({ hasText: TEAM_NEW });
  await expect(cardNew).toBeVisible();
  await expect(cardNew).toContainText("3 titulares · 1 suplente");
  // Nadie completó la cuota de este mes todavía.
  await expect(cardNew.getByTestId("team-up-to-date")).toHaveText("4 deben");
  await expect(cardNew).toContainText("$30k de $240k");

  const vieja = page.locator('[data-testid="category-section"][data-category="Vieja"]');
  const cardOld = vieja.getByTestId("team-card").filter({ hasText: TEAM_OLD });
  await expect(cardOld.getByTestId("team-up-to-date")).toHaveText("2 deben");

  await cardNew.click();
  await expect(page).toHaveURL(new RegExp(`/torneos/equipos/${teams.get(TEAM_NEW)}$`));
  await expect(page.getByTestId("team-context")).toHaveText(`${TOURNAMENT} · Nueva`);
});

test("los puntos: un mes entero y el 40% del siguiente es verde, amarillo, gris, gris", async ({ page }) => {
  await page.goto(`/torneos/equipos/${teams.get(TEAM_OLD)}`);
  await expectStatuses(page, "Mitad", ["paid", "partial", "upcoming", "upcoming"]);
  await expect(standingOf(page, "Mitad")).toHaveText("debe $33k");
  // Sin pagar nada, con el torneo ya empezado: dos vencidas.
  await expectStatuses(page, "Moroso", ["due", "due", "upcoming", "upcoming"]);
  await expect(standingOf(page, "Moroso")).toHaveText("debe $115k");
  await expect(page.getByTestId("team-summary")).toContainText("0 al día");
});

test("titulares y suplentes van en secciones distintas", async ({ page }) => {
  await page.goto(`/torneos/equipos/${teams.get(TEAM_NEW)}`);
  await expect(page.getByTestId("section-titulares").getByTestId("player-row")).toHaveCount(3);
  const subs = page.getByTestId("section-suplentes").getByTestId("player-row");
  await expect(subs).toHaveCount(1);
  await expect(subs.first()).toContainText(`${LAST}, Suplente`);
  await expectStatuses(page, "Nada", ["due", "upcoming", "upcoming", "upcoming"]);
  await expectStatuses(page, "Parcial", ["partial", "upcoming", "upcoming", "upcoming"]);
});

test("el detalle lista los pagos y completar lo vencido deja el mes en verde", async ({ page }) => {
  await page.goto(`/torneos/equipos/${teams.get(TEAM_NEW)}`);
  await page.locator(`[data-player-row="${players.get("Parcial")}"]`).click();

  const sheet = page.getByTestId("player-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("payment-list")).toContainText("$30k");
  await expect(sheet).toContainText("Pagó$30k de $195k");
  await expect(sheet).toContainText("Debe a la fecha$30k");

  await sheet.getByTestId("register-payment").click();
  const modal = page.getByTestId("payment-modal");
  // Ya pagó algo: el anticipado no se ofrece.
  await expect(modal.getByTestId("pay-upfront")).toHaveCount(0);
  await expect(modal.getByTestId("pay-suggested")).toContainText("Completar lo vencido");
  await expect(modal.getByTestId("pay-suggested")).toContainText("$30k");
  await modal.getByTestId("pay-suggested").click();
  await modal.getByTestId("confirm-payment").click();

  await expect(page.getByTestId("payment-toast")).toContainText("$30k");
  // El detalle sigue abierto, ya con el pago nuevo.
  await expect(sheet.getByTestId("payment-list")).toContainText("$30k");
  await sheet.getByRole("button", { name: "Cerrar" }).click();

  await expectStatuses(page, "Parcial", ["paid", "upcoming", "upcoming", "upcoming"]);
  await expect(standingOf(page, "Parcial")).toHaveText("al día · pagó $60k");
});

test("un monto libre se registra tal cual, y 45 quiere decir 45k", async ({ page }) => {
  await page.goto(`/torneos/equipos/${teams.get(TEAM_NEW)}`);
  await page.locator(`[data-player-row="${players.get("Nada")}"]`).click();
  await page.getByTestId("register-payment").click();
  const modal = page.getByTestId("payment-modal");
  await modal.getByTestId("custom-amount").fill("45");
  await modal.getByTestId("custom-ok").click();
  await expect(modal).toContainText("$45k");
  await modal.getByTestId("confirm-payment").click();
  await expect(page.getByTestId("payment-toast")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();

  await expectStatuses(page, "Nada", ["partial", "upcoming", "upcoming", "upcoming"]);
  await expect(standingOf(page, "Nada")).toHaveText("debe $15k");
});

test("el torneo anticipado deja todo en verde y queda como transferencia", async ({ page }) => {
  await page.goto(`/torneos/equipos/${teams.get(TEAM_NEW)}`);
  await page.locator(`[data-player-row="${players.get("Adelantado")}"]`).click();
  await page.getByTestId("register-payment").click();
  const modal = page.getByTestId("payment-modal");
  await expect(modal.getByTestId("pay-upfront")).toContainText("$178k");
  await modal.getByTestId("pay-upfront").click();
  await modal.getByTestId("pay-bank").click();
  await modal.getByTestId("confirm-payment").click();
  await expect(page.getByTestId("payment-toast")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();

  await expectStatuses(page, "Adelantado", ["paid", "paid", "paid", "paid"]);
  await expect(standingOf(page, "Adelantado")).toHaveText("torneo pago por anticipado");

  const { data } = await admin().from("payments")
    .select("concept,amount,is_cash,team_id,slot_weekday,session")
    .eq("player_id", players.get("Adelantado")!);
  expect(data).toHaveLength(1);
  expect({ ...data![0], amount: Number(data![0].amount) }).toEqual({
    concept: "tournament upfront",
    amount: UPFRONT,
    is_cash: false,
    team_id: teams.get(TEAM_NEW),
    slot_weekday: null,
    session: null,
  });
});

test("el servicio no deja pasar un anticipado fuera de regla", async ({ page }) => {
  const post = (team: string, body: Record<string, unknown>) =>
    page.request.post(`/api/torneos/equipos/${teams.get(team)}/pago`, { data: body });

  // Ya pagó algo.
  let res = await post(TEAM_NEW, {
    player_id: players.get("Parcial"), amount: UPFRONT, concept: "tournament upfront",
  });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("no pagó nada");

  // Menos que el precio anticipado.
  res = await post(TEAM_NEW, {
    player_id: players.get("Suplente"), amount: UPFRONT - 1000, concept: "tournament upfront",
  });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("no admite pagos parciales");

  // La primera cuota ya venció.
  res = await post(TEAM_OLD, {
    player_id: players.get("Moroso"), amount: UPFRONT, concept: "tournament upfront",
  });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("antes de que venza");

  // No es del equipo.
  res = await post(TEAM_OLD, { player_id: players.get("Nada"), amount: 10000 });
  expect(res.status()).toBe(400);

  // Nada de eso quedó registrado.
  const { count } = await admin().from("payments")
    .select("id", { count: "exact", head: true })
    .in("player_id", [players.get("Suplente")!, players.get("Moroso")!]);
  expect(count).toBe(0);
});

test("la plata del torneo llega a la caja como torneo, no como sin slot", async ({ page }) => {
  const res = await page.request.get("/api/caja");
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain('"slot":"torneo"');
});
