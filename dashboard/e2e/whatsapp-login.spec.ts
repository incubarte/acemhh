import crypto from "crypto";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Exercises /api/auth/whatsapp: the dashboard half of the WhatsApp magic-link
// login. Tokens are minted straight into the table here, standing in for the
// whatsapp-webhook.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// 14 digits: clear of any real ~10-digit Telegram id.
const TEST_USER_ID = 99000000000099;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function cleanup() {
  const s = admin();
  // Tokens reference users, so they go first.
  await s.from("whatsapp_login_tokens").delete().eq("user_id", TEST_USER_ID);
  await s.from("users").delete().eq("id", TEST_USER_ID);
}

/** Inserts a token row the way the webhook does and returns the raw token. */
async function mintToken(expiresInMs: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const { error } = await admin().from("whatsapp_login_tokens").insert({
    token_hash: crypto.createHash("sha256").update(token).digest("hex"),
    user_id: TEST_USER_ID,
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
  });
  if (error) throw new Error("Token insert failed: " + JSON.stringify(error));
  return token;
}

test.beforeEach(async () => {
  await cleanup();
  const { error } = await admin().from("users").insert({
    id: TEST_USER_ID,
    first_name: "__test-wa-admin",
  });
  if (error) throw new Error("User insert failed: " + JSON.stringify(error));
});

test.afterEach(cleanup);

test("un link válido loguea al admin y es de un solo uso", async ({ page, browser }) => {
  const token = await mintToken(10 * 60 * 1000);

  await page.goto(`/api/auth/whatsapp?token=${token}`);
  await page.waitForURL("/");

  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).id).toBe(TEST_USER_ID);

  // The same link in a fresh browser must not log in again.
  const second = await browser.newContext();
  const reuse = await second.request.get(`/api/auth/whatsapp?token=${token}`, {
    maxRedirects: 0,
  });
  expect(reuse.status()).toBe(401);
  await second.close();
});

test("un link vencido es rechazado", async ({ page }) => {
  const token = await mintToken(-1000);

  const res = await page.request.get(`/api/auth/whatsapp?token=${token}`, {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);

  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(401);
});

test("un token con formato inválido es rechazado sin consultar la base", async ({ page }) => {
  const res = await page.request.get("/api/auth/whatsapp?token=not-a-token", {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(400);
});
