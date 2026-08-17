import crypto from "crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// End-to-end money flow: the dev admin registers a cash expense and hands
// cash to a second admin (who has no Telegram and logs in via the WhatsApp
// magic link), and the handoff only moves balances once the receiver confirms.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RECEIVER_NAME = "__test-cajero";
const EXPENSE_CONCEPT = "__test-egreso";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function cleanup() {
  const s = admin();
  await s.from("expenses").delete().eq("concept", EXPENSE_CONCEPT);
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

test("egreso y entrega de caja con confirmación del receptor", async ({ page, browser }) => {
  const receiverId = await createReceiver();

  // Admin A (dev login) registers a cash expense and a handoff.
  await page.request.post("/api/auth/dev");
  await page.goto("/caja");
  await expect(page.getByText("Mi caja", { exact: true })).toBeVisible();

  await page.getByLabel("Monto").first().fill("1500");
  await page.getByLabel("Concepto").fill(EXPENSE_CONCEPT);
  await page.getByRole("button", { name: "Registrar egreso" }).click();

  // On success the form clears (the button goes back to disabled), so the
  // expense row itself is the completion signal.
  await expect.poll(async () => {
    const { data } = await admin().from("expenses")
      .select("amount,is_cash")
      .eq("concept", EXPENSE_CONCEPT)
      .maybeSingle();
    return data ? { amount: Number(data.amount), is_cash: data.is_cash } : null;
  }).toEqual({ amount: 1500, is_cash: true });

  await page.getByLabel("Monto").nth(1).fill("1000");
  await page.getByLabel("A quién").selectOption({ label: RECEIVER_NAME });
  await page.getByRole("button", { name: "Registrar entrega" }).click();
  await expect(page.getByText("pendiente")).toBeVisible();

  // Pending handoffs move no balances yet.
  const before = await (await page.request.get("/api/caja")).json();
  expect(before.users.find((u: { id: string }) => u.id === receiverId).balance).toBe(0);

  // Admin B (no Telegram, magic-link login) confirms the handoff.
  const ctx = await browser.newContext();
  const pageB = await ctx.newPage();
  await loginAsReceiver(pageB, receiverId);
  await pageB.goto("/caja");
  await expect(pageB.getByText(/te entregó/)).toBeVisible();
  await pageB.getByRole("button", { name: "Confirmar" }).click();
  await expect(pageB.getByText(/te entregó/)).toHaveCount(0);

  const after = await (await pageB.request.get("/api/caja")).json();
  expect(after.users.find((u: { id: string }) => u.id === receiverId).balance).toBe(1000);
  await ctx.close();
});
