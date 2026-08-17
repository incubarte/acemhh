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
