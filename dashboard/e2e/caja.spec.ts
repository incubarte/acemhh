import crypto from "crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// End-to-end money flow over the three caja screens: the dev admin registers
// an expense (hitting the low-amount check on the way) and hands cash to a
// second admin (no Telegram, magic-link login), who confirms it from the
// resumen. Balances only move after the confirmation.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RECEIVER_NAME = "__test-cajero";
const EXPENSE_NOTES = "__test-egreso";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function cleanup() {
  const s = admin();
  await s.from("expenses").delete().eq("notes", EXPENSE_NOTES);
  const { data } = await s.from("users").select("id").eq("first_name", RECEIVER_NAME);
  const ids = (data ?? []).map((u) => u.id);
  if (ids.length === 0) return;
  await s.from("cash_handoffs").delete().or(
    `from_user.in.(${ids.join(",")}),to_user.in.(${ids.join(",")})`,
  );
  await s.from("whatsapp_login_tokens").delete().in("user_id", ids);
  await s.from("users").delete().in("id", ids);
}

async function createReceiver(): Promise<string> {
  const { data, error } = await admin().from("users")
    .insert({ first_name: RECEIVER_NAME, groups: ["WHEEL"] })
    .select("id")
    .single();
  if (error) throw new Error(JSON.stringify(error));
  return data.id;
}

async function loginAsReceiver(page: Page, userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const { error } = await admin().from("whatsapp_login_tokens").insert({
    token_hash: crypto.createHash("sha256").update(token).digest("hex"),
    user_id: userId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(JSON.stringify(error));
  await page.goto(`/api/auth/whatsapp?token=${token}`);
  await page.waitForURL("/");
}

test.beforeEach(cleanup);
test.afterEach(cleanup);

test("egreso con chequeo de monto bajo, y entrega de caja confirmada por el receptor", async ({ page, browser }) => {
  const receiverId = await createReceiver();

  await page.request.post("/api/auth/dev");
  await page.goto("/caja");
  await expect(page.getByText("Cajas del club")).toBeVisible();

  // --- Expense, tripping the low-amount dialog first.
  await page.getByRole("button", { name: "Registrar egreso" }).click();
  await page.waitForURL("**/caja/egreso");

  await page.getByLabel("Monto").fill("500");
  await page.getByLabel("Concepto").selectOption("otros");
  await page.getByLabel(/Notas/).fill(EXPENSE_NOTES);
  await page.getByRole("button", { name: "Guardar" }).click();

  // A sub-$1000 amount asks for confirmation; fix it instead.
  await expect(page.getByText("¿El monto es $500?")).toBeVisible();
  await page.getByRole("button", { name: "Corregir" }).click();
  await expect(page.getByText("¿El monto es $500?")).toHaveCount(0);

  await page.getByLabel("Monto").fill("1500");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL("**/caja");

  const { data: expense } = await admin().from("expenses")
    .select("amount,concept,is_cash")
    .eq("notes", EXPENSE_NOTES)
    .single();
  expect(Number(expense!.amount)).toBe(1500);
  expect(expense!.concept).toBe("otros");
  expect(expense!.is_cash).toBe(true);

  // The expense shows up in the movements history.
  await expect(page.getByText(`pagó otros — ${EXPENSE_NOTES}`)).toBeVisible();

  // --- Handoff to the receiver.
  await page.getByRole("button", { name: "Entregar caja" }).click();
  await page.waitForURL("**/caja/handoff");
  await page.getByLabel("Monto").fill("1000");
  await page.getByLabel("A quién").selectOption({ label: RECEIVER_NAME });
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL("**/caja");
  await expect(page.getByText("Entregas pendientes de confirmación")).toBeVisible();
  await expect(page.getByText("pendiente", { exact: true })).toBeVisible();

  // Pending handoffs move no balances yet.
  const before = await (await page.request.get("/api/caja")).json();
  expect(before.users.find((u: { id: string }) => u.id === receiverId).balance).toBe(0);

  // --- Receiver confirms from their resumen.
  const ctx = await browser.newContext();
  const pageB = await ctx.newPage();
  await loginAsReceiver(pageB, receiverId);
  await pageB.goto("/caja");
  await expect(pageB.getByText(/→ vos/)).toBeVisible();
  await pageB.getByRole("button", { name: "Confirmar" }).click();
  await expect(pageB.getByText(/→ vos/)).toHaveCount(0);

  // Now the receiver holds club money and appears in "Cajas del club".
  const after = await (await pageB.request.get("/api/caja")).json();
  expect(after.users.find((u: { id: string }) => u.id === receiverId).balance).toBe(1000);
  await ctx.close();
});

test("el egreso con concepto 'otros' exige notas", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto("/caja/egreso");

  await page.getByLabel("Monto").fill("5000");
  await page.getByLabel("Concepto").selectOption("otros");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByText(/contá en las notas/)).toBeVisible();
});

test("los movimientos arrancan en agosto, pero el saldo cuenta todo", async ({ page }) => {
  const receiverId = await createReceiver();
  const s = admin();

  // A player to hang the payments on.
  await s.from("players").delete().eq("dni", "99001101");
  const { data: player } = await s.from("players").insert({
    name: "__test-caja", last_name: RECEIVER_NAME, dni: "99001101",
    categories: ["cat-b"], player_type: "player", trains: true, invitee: false,
  }).select("id").single();

  const pay = (createdAt: string, amount: number) => ({
    id: crypto.randomUUID(),
    player_id: player!.id,
    registered_by: "__test",
    registered_by_user_id: receiverId,
    concept: "session",
    session: "2026-05-07 22hs",
    month: createdAt.slice(0, 7),
    amount,
    is_cash: true,
    created_at: createdAt,
  });
  // One pre-caja collection and one after the cutoff.
  const { error } = await s.from("payments").insert([
    pay("2026-05-07T23:10:00Z", 500000),
    pay("2026-08-13T23:10:00Z", 30000),
  ]);
  if (error) throw new Error(JSON.stringify(error));

  await page.request.post("/api/auth/dev");
  const caja = await (await page.request.get("/api/caja")).json();

  // The balance counts both payments...
  const balance = caja.users.find((u: { id: string }) => u.id === receiverId).balance;
  expect(balance).toBe(530000);

  // ...but only the August one shows among the movements.
  const incomes = caja.history.filter((h: { kind: string }) => h.kind === "income");
  expect(incomes).toHaveLength(1);
  expect(incomes[0].amount).toBe(30000);
  expect(incomes[0].at >= "2026-08-01").toBe(true);

  await s.from("payments").delete().eq("player_id", player!.id);
  await s.from("players").delete().eq("id", player!.id);
});

test("saldo inicial, balance corrido y filtro por persona", async ({ page }) => {
  const receiverId = await createReceiver();
  const s = admin();

  await s.from("players").delete().eq("dni", "99001102");
  const { data: player } = await s.from("players").insert({
    name: "__test-ledger", last_name: RECEIVER_NAME, dni: "99001102",
    categories: ["cat-b"], player_type: "player", trains: true, invitee: false,
  }).select("id").single();

  const pay = (createdAt: string, amount: number) => ({
    id: crypto.randomUUID(),
    player_id: player!.id,
    registered_by: "__test",
    registered_by_user_id: receiverId,
    concept: "session",
    session: "2026-05-07 22hs",
    month: createdAt.slice(0, 7),
    amount,
    is_cash: true,
    created_at: createdAt,
  });
  const { error } = await s.from("payments").insert([
    // Pre-August: folded into the opening balance.
    pay("2026-05-07T23:10:00Z", 100000),
    // One training night, split across midnight BA: a single entry of 50k.
    pay("2026-08-14T00:10:00Z", 30000),
    pay("2026-08-14T03:40:00Z", 20000),
  ]);
  if (error) throw new Error(JSON.stringify(error));

  const { error: expError } = await s.from("expenses").insert({
    amount: 20000, concept: "hora de pista", paid_by: receiverId, is_cash: true,
    created_at: "2026-08-15T14:00:00Z",
  });
  if (expError) throw new Error(JSON.stringify(expError));

  await page.request.post("/api/auth/dev");
  const caja = await (await page.request.get(`/api/caja?user=${receiverId}`)).json();

  // Opening carries the pre-cutoff collection; the ledger runs from there.
  expect(caja.opening).toBe(100000);
  expect(caja.history).toHaveLength(2);

  const [income, expense] = caja.history;
  expect(income.kind).toBe("income");
  expect(income.count).toBe(2); // both payments of that night, one entry
  expect(income.delta).toBe(50000);
  expect(income.balanceAfter).toBe(150000);

  expect(expense.kind).toBe("expense");
  expect(expense.delta).toBe(-20000);
  expect(expense.balanceAfter).toBe(130000);

  // The running balance lands exactly on the admin's caja.
  const balance = caja.users.find((u: { id: string }) => u.id === receiverId).balance;
  expect(balance).toBe(130000);

  // Another admin's caja shows none of it.
  const meScoped = await (await page.request.get(`/api/caja?user=${caja.me}`)).json();
  expect(meScoped.history.every((h: { name?: string }) => h.name !== RECEIVER_NAME)).toBe(true);

  await s.from("expenses").delete().eq("paid_by", receiverId);
  await s.from("payments").delete().eq("player_id", player!.id);
  await s.from("players").delete().eq("id", player!.id);
});

test("los cobros se discriminan por slot, y la entrega dice cuánto fue", async ({ page }) => {
  const receiverId = await createReceiver();
  const s = admin();

  await s.from("players").delete().eq("dni", "99001103");
  const { data: player } = await s.from("players").insert({
    name: "__test-slots", last_name: RECEIVER_NAME, dni: "99001103",
    categories: ["cat-b"], player_type: "player", trains: true, invitee: false,
  }).select("id").single();

  const pay = (createdAt: string, amount: number, slot: string) => ({
    id: crypto.randomUUID(),
    player_id: player!.id,
    registered_by: "__test",
    registered_by_user_id: receiverId,
    concept: "session",
    session: "2026-08-13 22hs",
    month: "2026-08",
    slot,
    amount,
    is_cash: true,
    created_at: createdAt,
  });
  // One night, two trainings: the 21hs takings must not be lumped in with
  // the 22hs ones just because the same person collected both.
  const { error } = await s.from("payments").insert([
    pay("2026-08-14T00:10:00Z", 30000, "jue 21hs"),
    pay("2026-08-14T01:10:00Z", 30000, "jue 22hs"),
    pay("2026-08-14T01:20:00Z", 45000, "jue 22hs"),
  ]);
  if (error) throw new Error(JSON.stringify(error));

  await page.request.post("/api/auth/dev");
  const me = (await (await page.request.get("/api/caja")).json()).me;

  // An accepted handoff, so it lands among the movements instead of pending.
  const { error: handoffError } = await s.from("cash_handoffs").insert({
    from_user: me,
    to_user: receiverId,
    amount: 12345,
    created_at: "2026-08-14T02:00:00Z",
    accepted_at: "2026-08-14T02:05:00Z",
  });
  if (handoffError) throw new Error(JSON.stringify(handoffError));

  await page.goto("/caja");
  await expect(page.getByText("Cajas del club")).toBeVisible();

  // One income entry per slot, each with its own takings.
  await expect(page.getByText(/cobró 1 pago en jue 21hs/)).toBeVisible();
  await expect(page.getByText(/cobró 2 pagos en jue 22hs/)).toBeVisible();

  const caja = await (await page.request.get("/api/caja")).json();
  const incomes = caja.history.filter((h: { kind: string }) => h.kind === "income");
  expect(incomes.map((i: { slot: string; amount: number }) => [i.slot, i.amount]))
    .toEqual([["jue 21hs", 30000], ["jue 22hs", 75000]]);

  // Seen from the club's caja a handoff moves nothing, so the delta column
  // reads "—": the amount has to be in the text or it is nowhere.
  const handoff = page.getByText(/le entregó \$12\.345 a/);
  await expect(handoff).toBeVisible();
  expect(caja.history.find((h: { kind: string }) => h.kind === "handoff").delta).toBe(0);

  await s.from("payments").delete().eq("player_id", player!.id);
  await s.from("players").delete().eq("id", player!.id);
});
