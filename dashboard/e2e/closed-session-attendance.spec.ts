import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { closedSession, writableSession } from "./fixtures";

// Attendance on a session already closed. The roster says the session is
// closed and whether the admin may change it anyway, so the screen settles it
// before writing: ROOT is asked, anybody else told, and nothing is sent until
// ROOT confirms. The service enforces the same rule: only ROOT, and only with
// confirm_closed. And any write that fails says, by name, the state the player
// was left in.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const LAST = "Cerrada";
const NAME = "Tardío";
let playerId: string;
let closed: { session: string; sessionStr: string };
let open: { session: string; sessionStr: string };

const admin = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function cleanup() {
  const s = admin();
  const { data } = await s.from("players").select("id").eq("last_name", LAST);
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return;
  await s.from("attendances").delete().in("player_id", ids);
  await s.from("players").delete().in("id", ids);
}

async function attended(sessionStr: string): Promise<boolean | null> {
  const { data } = await admin().from("attendances").select("attended")
    .eq("player_id", playerId).eq("session", sessionStr).maybeSingle();
  return data?.attended ?? null;
}

/** Runs `fn` with the dev admin in WHEEL, putting their groups back after. */
async function asWheel(page: Page, fn: () => Promise<void>) {
  await page.request.post("/api/auth/dev");
  const me = await (await page.request.get("/api/me")).json();
  const s = admin();
  await s.from("users").update({ groups: ["WHEEL"] }).eq("id", me.id);
  try {
    await fn();
  } finally {
    await s.from("users").update({ groups: me.groups }).eq("id", me.id);
  }
}

/** Every attendance write the page sends. */
function attendanceWrites(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/attendance")) sent.push(r.postData() ?? "");
  });
  return sent;
}

/** Slides an absent player's row all the way across: marks them present. */
async function swipePresent(page: Page) {
  const section = page.getByTestId("section-ausentes");
  const row = section.locator(`[data-player-row="${playerId}"]`);
  // Without recent trainings the player is among the "more players" only.
  const more = section.getByRole("button", { name: "Más jugadores..." });
  if (await more.isVisible()) await more.click();
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + (box.width * 0.9 * i) / 12, y);
  await page.mouse.up();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  closed = await closedSession(22);
  open = await writableSession(22);
  await cleanup();
  const { data, error } = await admin().from("players").insert({
    name: NAME, last_name: LAST, dni: "99000901",
    categories: ["cat-b"], player_type: "player", trains: true, invitee: false,
  }).select("id").single();
  if (error) throw new Error(JSON.stringify(error));
  playerId = data.id;
});
test.afterAll(cleanup);
test.afterEach(async () => {
  await admin().from("attendances").delete().eq("player_id", playerId);
});

test("el roster dice si la sesión está cerrada y si quien mira puede cambiarla igual", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  for (const api of ["training-sessions", "training-sessions-beta"]) {
    const c = await (await page.request.get(`/api/${api}/${closed.session}`)).json();
    expect([api, c.closed, c.can_write_closed]).toEqual([api, true, true]);
    const o = await (await page.request.get(`/api/${api}/${open.session}`)).json();
    expect([api, o.closed]).toEqual([api, false]);
  }
  await asWheel(page, async () => {
    const c = await (await page.request.get(`/api/training-sessions-beta/${closed.session}`)).json();
    expect([c.closed, c.can_write_closed]).toEqual([true, false]);
  });
});

test("el servicio: en una sesión cerrada sólo ROOT, y sólo confirmando", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  const mark = (extra: object = {}) => page.request.post(
    `/api/training-sessions/${closed.session}/attendance`,
    { data: { player_id: playerId, attended: true, ...extra } },
  );
  expect((await mark()).status()).toBe(409);
  expect(await attended(closed.sessionStr)).toBeNull();

  await asWheel(page, async () => {
    expect((await mark({ confirm_closed: true })).status()).toBe(409);
  });
  expect(await attended(closed.sessionStr)).toBeNull();

  expect((await mark({ confirm_closed: true })).status()).toBe(200);
  expect(await attended(closed.sessionStr)).toBe(true);
});

test("ROOT en una sesión cerrada: pregunta antes de mandar nada", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-beta/${closed.session}`);
  await expect(page.getByTestId("section-ausentes")).toBeVisible();
  const sent = attendanceWrites(page);

  // Dice que no: no se manda nada y sigue ausente.
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    // La pregunta llega sin un intento previo rechazado.
    expect(sent).toHaveLength(0);
    d.dismiss();
  });
  await swipePresent(page);
  await expect.poll(() => asked).toMatch(
    new RegExp(`^La sesión del jue \\d+/\\d+ 22hs ya está cerrada\\. ¿Marcar a ${NAME} ${LAST} como presente igual\\?$`),
  );
  await page.waitForTimeout(500);
  expect(sent).toHaveLength(0);
  expect(await attended(closed.sessionStr)).toBeNull();
  await expect(page.getByTestId("section-ausentes").locator(`[data-player-row="${playerId}"]`)).toBeVisible();

  // Dice que sí: se manda una vez, confirmado, y queda presente.
  page.once("dialog", (d) => d.accept());
  await swipePresent(page);
  await expect.poll(() => sent.length).toBe(1);
  expect(JSON.parse(sent[0])).toMatchObject({ player_id: playerId, attended: true, confirm_closed: true });
  await expect.poll(() => attended(closed.sessionStr)).toBe(true);
  await expect(page.getByTestId("section-presentes").locator(`[data-player-row="${playerId}"]`)).toBeVisible();
});

test("WHEEL en una sesión cerrada: avisa que no se puede, sin mandar nada", async ({ page }) => {
  await asWheel(page, async () => {
    await page.goto(`/training-sessions-beta/${closed.session}`);
    await expect(page.getByTestId("section-ausentes")).toBeVisible();
    const sent = attendanceWrites(page);
    let told = "";
    page.once("dialog", (d) => { told = d.message(); d.accept(); });
    await swipePresent(page);
    await expect.poll(() => told).toMatch(
      new RegExp(`ya está cerrada: no se puede cambiar el presente de ${NAME} ${LAST}\\. Sigue ausente\\.$`),
    );
    await page.waitForTimeout(500);
    expect(sent).toHaveLength(0);
    expect(await attended(closed.sessionStr)).toBeNull();
  });
});

test("si marcar falla, avisa con el nombre y cómo quedó el jugador", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-beta/${open.session}`);
  await expect(page.getByTestId("section-ausentes")).toBeVisible();
  await page.route("**/attendance", (r) => r.fulfill({ status: 500, body: "Se cayó la base" }));

  let told = "";
  page.once("dialog", (d) => { told = d.message(); d.accept(); });
  await swipePresent(page);
  await expect.poll(() => told).toBe(`No se pudo marcar a ${NAME} ${LAST} como presente: quedó ausente.\n\nSe cayó la base`);
  // La fila vuelve a donde estaba.
  await expect(page.getByTestId("section-ausentes").locator(`[data-player-row="${playerId}"]`)).toBeVisible();
  expect(await attended(open.sessionStr)).toBeNull();
});

test("la pantalla clásica hace lo mismo: ROOT confirma una sesión cerrada antes de mandar", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions/${closed.session}`);
  const toggle = page.locator(`[data-testid="attendance-toggle"][data-player="${playerId}"]`);
  await expect(toggle).toHaveAttribute("data-attended", "false");
  const sent = attendanceWrites(page);

  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await toggle.click();
  await expect.poll(() => asked).toContain(`¿Marcar a ${NAME} ${LAST} como presente igual?`);
  await expect(toggle).toHaveAttribute("data-attended", "true");
  await expect.poll(() => sent.length).toBe(1);
  expect(JSON.parse(sent[0])).toMatchObject({ confirm_closed: true });
  await expect.poll(() => attended(closed.sessionStr)).toBe(true);

  // Y si falla, lo dice y vuelve atrás.
  await page.route("**/attendance", (r) => r.fulfill({ status: 500, body: "Se cayó la base" }));
  let told = "";
  page.on("dialog", (d) => {
    if (d.type() === "confirm") d.accept();
    else { told = d.message(); d.accept(); }
  });
  await toggle.click();
  await expect.poll(() => told).toBe(`No se pudo marcar a ${NAME} ${LAST} como ausente: quedó presente.\n\nSe cayó la base`);
  await expect(toggle).toHaveAttribute("data-attended", "true");
});
