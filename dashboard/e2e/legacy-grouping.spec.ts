import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The legacy attendance screen splits Jugadores in two, separated by an
// orange rule. The bottom group is "came this month and owes nothing" —
// a player who never showed up and never paid is NOT settled and belongs
// up top, next to those who owe.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SESSION = "2026-08-20-22";
const SESSION_STR = "2026-08-20 22hs";
const PREV_STR = "2026-08-06 22hs";
const LAST = "Grouptest";

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
    trains: true,
    invitee: false,
  });
  const { data: players, error } = await s.from("players")
    .insert([
      mk("Adeuda", "99001201"),   // attended, did not pay
      mk("Alpedo", "99001202"),   // never came, never paid
      mk("Zpagado", "99001203"),  // attended and paid
    ])
    .select("id,name");
  if (error) throw new Error(JSON.stringify(error));
  for (const p of players!) ids.set(p.name, p.id);

  await s.from("attendances").insert([
    { player_id: ids.get("Adeuda")!, session: PREV_STR, attended: true },
    { player_id: ids.get("Zpagado")!, session: PREV_STR, attended: true },
  ]);
  const { error: payError } = await s.from("payments").insert([{
    id: crypto.randomUUID(),
    player_id: ids.get("Zpagado")!,
    registered_by: "__test",
    concept: "session",
    session: PREV_STR,
    month: "2026-08",
    amount: 30000,
    is_cash: true,
  }]);
  if (payError) throw new Error(JSON.stringify(payError));
});
test.afterAll(cleanup);

test("quien no vino ni pagó este mes va arriba, con los que deben", async ({ page }) => {
  await page.request.post("/api/auth/dev");

  const roster = await (await page.request.get(`/api/training-sessions/${SESSION}`)).json();
  const byId = new Map(roster.players.map((p: { id: string }) => [p.id, p]));
  const of = (name: string) => byId.get(ids.get(name)!) as {
    owes_now: boolean; attended_this_month: number; paid_this_month: number;
  };

  // The player who never showed up owes nothing — that is exactly why the
  // plain "owes" test used to sort them among the settled.
  expect(of("Alpedo").owes_now).toBe(false);
  expect(of("Alpedo").attended_this_month).toBe(0);
  expect(of("Alpedo").paid_this_month).toBe(0);
  expect(of("Zpagado").attended_this_month).toBeGreaterThan(0);

  await page.goto(`/training-sessions/${SESSION}`);
  const rows = page.locator('[style*="grid-template-columns"] >> text=/Grouptest,/');
  await expect(rows.first()).toBeVisible();

  // Order on screen: both pending ones first, the settled one last.
  const order = await page.locator(`text=/${LAST}, /`).allTextContents();
  const pos = (name: string) => order.findIndex((t) => t.includes(name));
  expect(pos("Zpagado")).toBeGreaterThan(pos("Adeuda"));
  expect(pos("Zpagado")).toBeGreaterThan(pos("Alpedo"));
});
