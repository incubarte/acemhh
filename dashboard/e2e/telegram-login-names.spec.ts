import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// A Telegram login refreshes the identity Telegram owns, but the name in
// users is ours: it gets filled from the profile only while it is empty.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const TG_ID = 990000771;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** The dev server reads .env.local; this process does not, and signing the
 * payload needs the very same bot token the route verifies against. */
function botToken(): string {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("TELEGRAM_BOT_TOKEN="));
  if (!line) throw new Error("TELEGRAM_BOT_TOKEN missing from .env.local");
  return line.slice("TELEGRAM_BOT_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
}

/** Signs a login payload exactly as Telegram's widget does. */
function signed(fields: Record<string, string | number>) {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = crypto.createHash("sha256").update(botToken()).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return { ...fields, hash };
}

async function row() {
  const { data } = await admin().from("users")
    .select("first_name,last_name,tg_username").eq("tg_id", TG_ID).maybeSingle();
  return data;
}

async function login(
  page: import("@playwright/test").Page,
  names: { first_name: string; last_name?: string; username?: string },
) {
  const res = await page.request.post("/api/auth/telegram", {
    data: signed({ id: TG_ID, auth_date: Math.floor(Date.now() / 1000), ...names }),
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe.configure({ mode: "serial" });

async function cleanup() {
  await admin().from("users").delete().eq("tg_id", TG_ID);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

test("el primer login crea la row con el nombre de Telegram", async ({ page }) => {
  await login(page, { first_name: "Tele", last_name: "Grama", username: "tele" });

  expect(await row()).toMatchObject({
    first_name: "Tele",
    last_name: "Grama",
    tg_username: "tele",
  });
});

test("un nombre ya cargado no se pisa, aunque Telegram traiga otro", async ({ page }) => {
  await admin().from("users")
    .update({ first_name: "Editado", last_name: "AMano" }).eq("tg_id", TG_ID);

  await login(page, { first_name: "Tele", last_name: "Grama", username: "tele2" });

  const after = await row();
  expect(after).toMatchObject({ first_name: "Editado", last_name: "AMano" });
  // The identity Telegram does own is still refreshed.
  expect(after!.tg_username).toBe("tele2");
});

test("un perfil sin apellido ya no borra el que tenemos", async ({ page }) => {
  // The regression: `last_name: tg.last_name || null` blanked the column on
  // every login by someone whose Telegram profile carries no surname.
  await login(page, { first_name: "Tele", username: "tele3" });

  expect(await row()).toMatchObject({ first_name: "Editado", last_name: "AMano" });
});

test("un apellido vacío sí se completa con el de Telegram", async ({ page }) => {
  await admin().from("users").update({ last_name: null }).eq("tg_id", TG_ID);

  await login(page, { first_name: "Tele", last_name: "Grama", username: "tele4" });

  expect(await row()).toMatchObject({ first_name: "Editado", last_name: "Grama" });
});
