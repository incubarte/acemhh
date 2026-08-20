import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Annual dues criterion: up to date ONLY with the full 70k for the year —
// one payment or installments summing to it. A player with just the first
// 35k installment still shows as owing everywhere.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SESSION = "2026-08-20-22";
const SESSION_STR = "2026-08-20 22hs";
const LAST = "Duestest";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const ids = new Map<string, string>();

async function cleanup() {
  const s = admin();
  const { data } = await s.from("players").select("id").eq("last_name", LAST);
  const found = (data ?? []).map((p) => p.id);
  if (found.length === 0) return;
  await s.from("payments").delete().in("player_id", found);
  await s.from("attendances").delete().in("player_id", found);
  await s.from("players").delete().in("id", found);
}

test.beforeAll(async () => {
  await cleanup();
  const s = admin();
  const mk = (name: string, dni: string) => ({
    name,
    last_name: LAST,
    dni,
    categories: ["cat-b"],
    player_type: "player",
    trains: false,
    invitee: false,
  });
  const { data: players, error } = await s.from("players")
    .insert([mk("Parcial", "99001001"), mk("Completo", "99001002")])
    .select("id,name");
  if (error) throw new Error(JSON.stringify(error));
  for (const p of players!) ids.set(p.name, p.id);

  // Both present in the session so the beta roster lists them.
  await s.from("attendances").insert(
    players!.map((p) => ({ player_id: p.id, session: SESSION_STR, attended: true })),
  );

  const dues = (name: string, month: string, amount: number) => ({
    id: crypto.randomUUID(),
    player_id: ids.get(name)!,
    registered_by: "__test",
    concept: "membership dues",
    month,
    amount,
    is_cash: false,
  });
  const { error: payError } = await s.from("payments").insert([
    // Parcial: only the first installment.
    dues("Parcial", "2026-03", 35000),
    // Completo: two installments summing the full annual.
    dues("Completo", "2026-03", 35000),
    dues("Completo", "2026-06", 35000),
  ]);
  if (payError) throw new Error(JSON.stringify(payError));
});
test.afterAll(cleanup);

test("solo la cuota anual completa cuenta como al día", async ({ page }) => {
  await page.request.post("/api/auth/dev");

  // Credencial: 35k is not up to date, 70k in installments is.
  const parcial = await (await page.request.get(
    `/api/credencial/check?player_id=${ids.get("Parcial")}`,
  )).json();
  expect(parcial.upToDate).toBe(false);
  expect(parcial.totalPaid).toBe(35000);

  const completo = await (await page.request.get(
    `/api/credencial/check?player_id=${ids.get("Completo")}`,
  )).json();
  expect(completo.upToDate).toBe(true);

  // Both rosters carry the same verdict.
  for (const api of ["training-sessions", "training-sessions-beta"]) {
    const roster = await (await page.request.get(`/api/${api}/${SESSION}`)).json();
    const byId = new Map(roster.players.map((p: { id: string }) => [p.id, p]));
    expect(
      (byId.get(ids.get("Parcial")!) as { paidMembershipDues: boolean }).paidMembershipDues,
    ).toBe(false);
    expect(
      (byId.get(ids.get("Completo")!) as { paidMembershipDues: boolean }).paidMembershipDues,
    ).toBe(true);
  }

  // And the beta screen paints the partial payer red (dues band) while the
  // fully paid one stays clean.
  await page.goto(`/training-sessions-beta/${SESSION}`);
  await expect(page.getByText(/Presentes — total/)).toBeVisible();
  const rowOf = (name: string) => page.locator(`[data-player-row="${ids.get(name)}"]`);
  await expect(rowOf("Parcial").locator("div").first()).toBeVisible(); // band present
  expect(await rowOf("Parcial").locator("div").count()).toBeGreaterThan(0);
  expect(await rowOf("Completo").locator("div").count()).toBe(0);
});

test("la credencial del pagador parcial muestra sus cuotas y el saldo faltante", async ({ page }) => {
  await page.goto("/credencial");
  await page.getByPlaceholder("Nombre o apellido").fill("Parcial");
  await page.getByRole("button", { name: `${LAST}, Parcial` }).click();

  // The installment is listed — never "no payments registered" — and the
  // remaining balance is spelled out.
  await expect(page.getByText("Pagos registrados · $35.000 total")).toBeVisible();
  await expect(page.getByText("Falta abonar $35.000 de la cuota social 2026")).toBeVisible();
  await expect(page.getByText(/No se registran pagos/)).toHaveCount(0);
});
