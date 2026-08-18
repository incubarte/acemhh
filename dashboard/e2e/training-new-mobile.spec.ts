import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Regression: overlays (the goal bar) must anchor to the VIEWPORT. The app
// shell has backdrop-filter, which turns it into the containing block for
// position:fixed descendants — with a long scrolled list on a phone, a goal
// rendered inside it lands off-screen.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SESSION = "2026-08-20-22";
const PREV_SESSION_STR = "2026-08-06 22hs";
const LAST = "Mobiletest";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function cleanup() {
  const s = admin();
  const { data } = await s.from("players").select("id").eq("last_name", LAST);
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return;
  await s.from("attendances").delete().in("player_id", ids);
  await s.from("players").delete().in("id", ids);
}

test.describe("viewport movil", () => {
test.use({ viewport: { width: 390, height: 664 } });

test.beforeAll(async () => {
  await cleanup();
  const s = admin();
  // Enough absentees (with recent attendance) to make the page scroll on a
  // phone viewport.
  const { data: players, error } = await s.from("players")
    .insert(Array.from({ length: 18 }, (_, i) => ({
      name: `Jugador${String(i).padStart(2, "0")}`,
      last_name: LAST,
      dni: `990006${String(i).padStart(2, "0")}`,
      categories: ["cat-b"],
      player_type: "player",
      trains: false,
      invitee: false,
    })))
    .select("id");
  if (error) throw new Error(JSON.stringify(error));

  const { error: attError } = await s.from("attendances").insert(
    players!.map((p) => ({ player_id: p.id, session: PREV_SESSION_STR, attended: true })),
  );
  if (attError) throw new Error(JSON.stringify(attError));
});
test.afterAll(cleanup);

test("el arco aparece dentro del viewport aunque la página esté scrolleada", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-new/${SESSION}`);
  await expect(page.getByText(/Presentes — total/)).toBeVisible();

  // Long-press the LAST row, far down the scrolled page.
  const lastRow = page.getByText(`${LAST}, Jugador17`);
  await lastRow.scrollIntoViewIfNeeded();
  const box = (await lastRow.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1200);

  const goal = page.getByText(/Cambiar a PRESENTE/);
  await expect(goal).toBeVisible();
  await expect(goal).toBeInViewport({ ratio: 0.9 });

  // The screen dims behind the gesture.
  await expect(page.getByTestId("drag-backdrop")).toBeVisible();

  // The pressed row sits in the lower half, so the goal centers midway into
  // the upper half (~25% of the viewport), not glued to the edge.
  const goalBox = (await goal.boundingBox())!;
  const centerRatio = (goalBox.y + goalBox.height / 2) / 664;
  expect(centerRatio).toBeGreaterThan(0.15);
  expect(centerRatio).toBeLessThan(0.4);

  await page.mouse.up();
});

});
