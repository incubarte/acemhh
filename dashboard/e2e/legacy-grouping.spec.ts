import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The legacy attendance screen splits Jugadores in two, separated by an
// orange rule. Only one thing sends a player to the bottom group: having
// paid this month's bundle or this very session. Attendance never does, and
// neither does a payment for an earlier session of the month.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SESSION = "2026-08-20-22";
const SESSION_STR = "2026-08-20 22hs";
const PREV_STR = "2026-08-06 22hs";
const SLOT_HOUR = 22;
const LAST = "Grouptest";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const ids = new Map<string, string>();

/** The seven cases, in the order the user enumerated them. Names are
 * prefixed so alphabetical order cannot accidentally satisfy the assertion. */
const CASES = [
  { name: "Cnovinonopago", top: true, attended: null, pay: null },
  { name: "Avinoantesnopago", top: true, attended: PREV_STR, pay: null },
  { name: "Bvinoantespagoesa", top: true, attended: PREV_STR, pay: "prev-session" },
  { name: "Dvinoactualnopago", top: true, attended: SESSION_STR, pay: null },
  { name: "Anovinopagomes", top: false, attended: null, pay: "month" },
  { name: "Bvinopagomes", top: false, attended: PREV_STR, pay: "month" },
  { name: "Cvinoactualpagosesion", top: false, attended: SESSION_STR, pay: "session" },
] as const;

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

  const { data: players, error } = await s.from("players")
    .insert(CASES.map((c, i) => ({
      name: c.name,
      last_name: LAST,
      dni: `9900130${i}`,
      categories: ["cat-b"],
      player_type: "player",
      trains: true,
      invitee: false,
    })))
    .select("id,name");
  if (error) throw new Error(JSON.stringify(error));
  for (const p of players!) ids.set(p.name, p.id);

  const attendances = CASES.filter((c) => c.attended).map((c) => ({
    player_id: ids.get(c.name)!,
    session: c.attended!,
    attended: true,
  }));
  if (attendances.length) await s.from("attendances").insert(attendances);

  const payment = (c: typeof CASES[number]) => {
    const base = {
      id: crypto.randomUUID(),
      player_id: ids.get(c.name)!,
      registered_by: "__test",
      month: "2026-08",
      // Every training payment names the slot it was taken at.
      slot_weekday: 4,
      slot_hour: SLOT_HOUR,
      is_cash: true,
    };
    if (c.pay === "month") {
      return { ...base, concept: "monthly", amount: 100000 };
    }
    if (c.pay === "session") {
      return { ...base, concept: "session", session: SESSION_STR, amount: 30000 };
    }
    // An earlier session of the same month: does NOT settle this one.
    return { ...base, concept: "session", session: PREV_STR, amount: 30000 };
  };

  const payments = CASES.filter((c) => c.pay).map(payment);
  const { error: payError } = await s.from("payments").insert(payments);
  if (payError) throw new Error(JSON.stringify(payError));
});
test.afterAll(cleanup);

test("abajo van sólo los que pagaron el mes o esta sesión", async ({ page }) => {
  await page.request.post("/api/auth/dev");

  // The API flag the grouping rests on, case by case.
  const roster = await (await page.request.get(`/api/training-sessions/${SESSION}`)).json();
  const byId = new Map(roster.players.map((p: { id: string }) => [p.id, p]));
  for (const c of CASES) {
    const p = byId.get(ids.get(c.name)!) as { hasSessionPayment: boolean };
    expect(p.hasSessionPayment, `${c.name} debería ir ${c.top ? "arriba" : "abajo"}`)
      .toBe(!c.top);
  }

  // And the order on screen: every pending player above every settled one.
  await page.goto(`/training-sessions/${SESSION}`);
  await expect(page.getByText(`${LAST}, Cnovinonopago`)).toBeVisible();

  const order = await page.locator(`text=/${LAST}, /`).allTextContents();
  const pos = (name: string) => order.findIndex((t) => t.includes(name));
  const lastTop = Math.max(...CASES.filter((c) => c.top).map((c) => pos(c.name)));
  const firstBottom = Math.min(...CASES.filter((c) => !c.top).map((c) => pos(c.name)));
  expect(firstBottom).toBeGreaterThan(lastTop);
});
