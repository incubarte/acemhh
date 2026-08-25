import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The ledger over the club's real 2026 season. Not a rule test — those live in
// supabase/functions/tests/tokens.test.ts — but a smoke test over data nobody
// designed for it: 108 players, five slot configurations across two eras, a
// winter break, and payments in every shape the admins actually used.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type Row = {
  name: string;
  last_name: string;
  debt: number;
  owed_now: number;
  carryover_sessions: number;
  month_preset: number | null;
  session_preset: number | null;
};

test("el ledger corre sobre toda la temporada real sin números imposibles", async ({ page }) => {
  await page.request.post("/api/auth/dev");

  // Every session of the ledger's period, in the order an admin would open
  // them.
  const { data: sessions } = await admin().from("training_sessions")
    .select("date,hour").gte("date", "2026-08-01").order("date").order("hour");
  expect((sessions ?? []).length).toBeGreaterThan(20);

  let rows = 0;
  // Keyed by player, so the same debtor seen at 20 sessions counts once.
  const debtors = new Map<string, Row>();
  for (const s of sessions ?? []) {
    const session = `${s.date}-${String(s.hour).padStart(2, "0")}`;
    const res = await page.request.get(`/api/training-sessions-beta/${session}`);
    expect(res.status(), `${session} devolvió ${res.status()}`).toBe(200);
    const body = await res.json();

    for (const p of body.players as Row[]) {
      rows += 1;
      // Nothing here may be negative, NaN or a fraction of a peso: those are
      // the shapes a broken ledger takes.
      for (const [field, value] of Object.entries({
        debt: p.debt,
        owed_now: p.owed_now,
        carryover: p.carryover_sessions,
      })) {
        expect(Number.isFinite(value), `${session} ${p.last_name}: ${field}=${value}`).toBe(true);
        expect(value, `${session} ${p.last_name}: ${field}`).toBeGreaterThanOrEqual(0);
      }
      expect(Number.isInteger(p.debt), `${session} ${p.last_name}: deuda con centavos`).toBe(true);
      expect(Number.isInteger(p.owed_now)).toBe(true);
      if (p.month_preset !== null) expect(p.month_preset).toBeGreaterThan(0);
      if (p.session_preset !== null) expect(p.session_preset).toBeGreaterThan(0);

      // A season's debt for one player cannot plausibly pass this.
      expect(p.debt, `${session} ${p.last_name} debe ${p.debt}`).toBeLessThan(2_000_000);
      if (p.debt > 0) debtors.set(`${p.last_name}|${p.name}`, p);
    }
  }

  expect(rows).toBeGreaterThan(500);
  const list = [...debtors.values()].sort((a, b) => b.debt - a.debt);
  const total = list.reduce((sum, d) => sum + d.debt, 0);
  console.log(`[ledger] ${rows} filas sobre ${sessions!.length} sesiones`);
  console.log(`[ledger] ${list.length} deudores, $${total.toLocaleString("es-AR")} en total`);
  for (const d of list) {
    console.log(`[ledger]   ${d.last_name}, ${d.name}: $${d.debt.toLocaleString("es-AR")}`);
  }
});
