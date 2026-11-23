import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writableSession } from "./fixtures";
import { formatArs, monthNameEs } from "../src/lib/tournamentFees";

// A monthly payment started in one slot is completed from that slot's
// session. Taking the rest from another session the player also trains in is
// refused, and the refusal says where the incomplete month is and how much is
// left, instead of only that the amount is too small.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const LAST = "OtroHorario";
let playerId: string;

const admin = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function cleanup() {
  const s = admin();
  const { data } = await s.from("players").select("id").eq("last_name", LAST);
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return;
  await s.from("payments").delete().in("player_id", ids);
  await s.from("players").delete().in("id", ids);
}

test.beforeAll(async () => {
  await cleanup();
  // Trains at 22 (cat-b) and at 23 (cat-c), like a player in two categories.
  const { data, error } = await admin().from("players").insert({
    name: "Doble", last_name: LAST, dni: "99000801",
    categories: ["cat-b", "cat-c"], player_type: "player", trains: true, invitee: false,
  }).select("id").single();
  if (error) throw new Error(JSON.stringify(error));
  playerId = data.id;
});
test.afterAll(cleanup);

async function monthPrice(page: Page, session: string): Promise<number> {
  const r = await (await page.request.get(`/api/training-sessions/${session}`)).json();
  return r.players.find((p: { id: string }) => p.id === playerId).month_preset;
}

const pay = (page: Page, session: string, amount: number) =>
  page.request.post(`/api/training-sessions/${session}/payment`, {
    data: { player_id: playerId, amount, concept: "monthly" },
  });

test("el resto de un mensual cobrado desde otro horario dice dónde está el mes", async ({ page }) => {
  const at22 = (await writableSession(22)).session;
  const at23 = at22.replace(/-22$/, "-23");
  await page.request.post("/api/auth/dev");

  const price = await monthPrice(page, at22);
  expect(price).toBeGreaterThan(42500);
  const firstPart = price - 2500;
  expect((await pay(page, at22, firstPart)).status()).toBe(200);

  // Desde la sesión de las 23: el mensual de este mes es de las 22.
  const wrong = await pay(page, at23, 2500);
  expect(wrong.status()).toBe(409);
  const month = monthNameEs(at22.slice(0, 7)).toLowerCase();
  expect(await wrong.text()).toBe(
    `El mensual de ${month} de este jugador es del jue 22hs (le faltan $${formatArs(2500)}): cobralo desde esa sesión`,
  );

  // Desde la de las 22 se completa.
  expect((await pay(page, at22, 2500)).status()).toBe(200);

  // Con el mes completo, el mismo rechazo vuelve a ser el de siempre.
  const again = await pay(page, at23, 2500);
  expect(again.status()).toBe(409);
  expect(await again.text()).toContain("no puede ser menor a $40k");
});
