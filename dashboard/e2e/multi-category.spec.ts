import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Falls back to the well-known local dev credentials so the suite works out of
// the box against `supabase start`; env vars still win if set.
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// A distinctive identity so the duplicate-detection screen never triggers and
// cleanup by DNI cannot touch real rows.
const TEST_PLAYER = { name: "Plwtest", last_name: "Multicat", dni: "99000101" };

// A Thursday seeded in training_slots by the prices_and_training_slots
// migration: 21hs = youth (goalies), 22hs = cat-a + cat-b, 23hs = cat-c.
const THURSDAY = "2026-08-20";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function deleteTestPlayer() {
  await admin().from("players").delete().eq("dni", TEST_PLAYER.dni);
}

async function insertTestPlayer(categories: string[]) {
  const { error } = await admin().from("players").insert([{
    ...TEST_PLAYER,
    categories,
    player_type: "player",
    trains: true,
    invitee: false,
  }]);
  if (error) throw new Error("Insert failed: " + JSON.stringify(error));
}

async function login(page: Page) {
  const res = await page.request.post("/api/auth/dev");
  if (!res.ok()) {
    throw new Error(
      "Dev login failed: " + res.status() + " " + (await res.text()) +
        " — check DEV_AUTH_ID in .env.local and the users table",
    );
  }
}

test.beforeEach(deleteTestPlayer);
test.afterEach(deleteTestPlayer);

test("crear un jugador eligiendo categorías en orden de prioridad", async ({ page }) => {
  await login(page);
  await page.goto("/players/new?invitee=false");

  await page.getByLabel("Nombre", { exact: true }).fill(TEST_PLAYER.name);
  await page.getByLabel("Apellido", { exact: true }).fill(TEST_PLAYER.last_name);
  await page.getByLabel("DNI", { exact: true }).fill(TEST_PLAYER.dni);

  // Click order defines priority: cat-b first, cat-c second.
  await page.getByRole("button", { name: "Categoría B" }).click();
  await page.getByRole("button", { name: "Categoría C" }).click();

  await expect(page.getByRole("button", { name: "1. Categoría B" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2. Categoría C" })).toBeVisible();

  await page.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL(/player=/);

  const { data, error } = await admin().from("players")
    .select("categories")
    .eq("dni", TEST_PLAYER.dni)
    .single();

  expect(error).toBeNull();
  expect(data!.categories).toEqual(["cat-b", "cat-c"]);
});

test("el jugador aparece una vez en el horario de cada una de sus categorías", async ({ page }) => {
  await insertTestPlayer(["cat-b", "cat-c"]);
  await login(page);

  const fullName = `${TEST_PLAYER.last_name}, ${TEST_PLAYER.name}`;

  // jue 22hs (cat-a + cat-b): must appear, and only once even though the slot
  // queries two categories.
  await page.goto(`/training-sessions/${THURSDAY}-22`);
  await expect(page.getByText(fullName)).toHaveCount(1);

  // jue 23hs (cat-c): his second category also gets him on the list.
  await page.goto(`/training-sessions/${THURSDAY}-23`);
  await expect(page.getByText(fullName)).toHaveCount(1);

  // jue 21hs (youth): not his category, must not be listed.
  await page.goto(`/training-sessions/${THURSDAY}-21`);
  await expect(page.getByText("21:00")).toBeVisible();
  await expect(page.getByText(fullName)).toHaveCount(0);
});

test("la credencial muestra las categorías en orden de prioridad", async ({ page }) => {
  await insertTestPlayer(["cat-b", "cat-c"]);

  // /credencial is a public page, no login needed.
  await page.goto("/credencial");
  await page.getByPlaceholder("Nombre o apellido").fill(TEST_PLAYER.last_name);
  await page.getByRole("button", { name: `${TEST_PLAYER.last_name}, ${TEST_PLAYER.name}` }).click();

  await expect(page.getByText("Cat. B, Cat. C")).toBeVisible();
});
