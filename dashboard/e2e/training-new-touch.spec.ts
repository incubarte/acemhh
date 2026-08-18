import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Real-touch regression for the drag-to-goal gesture. Mouse events skip the
// browser's touch pipeline entirely (touch-action, scroll intent,
// pointercancel), so this suite drives Chromium through CDP touch events —
// the same path a finger takes on a phone.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SESSION = "2026-08-20-22";
const PREV_SESSION_STR = "2026-08-06 22hs";
const LAST = "Touchtest";

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let targetId = "";

async function cleanup() {
  const s = admin();
  const { data } = await s.from("players").select("id").eq("last_name", LAST);
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return;
  await s.from("attendances").delete().in("player_id", ids);
  await s.from("players").delete().in("id", ids);
}

test.describe("gesto táctil real", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 664 } });

  test.beforeAll(async () => {
    await cleanup();
    const s = admin();
    const { data, error } = await s.from("players")
      .insert([{
        name: "Objetivo",
        last_name: LAST,
        dni: "99000701",
        categories: ["cat-b"],
        player_type: "player",
        trains: false,
        invitee: false,
      }])
      .select("id")
      .single();
    if (error) throw new Error(JSON.stringify(error));
    targetId = data.id;

    const { error: attError } = await s.from("attendances").insert([
      { player_id: targetId, session: PREV_SESSION_STR, attended: true },
    ]);
    if (attError) throw new Error(JSON.stringify(attError));
  });
  test.afterAll(cleanup);

  test("long-press táctil y drag al arco marca presente", async ({ page }) => {
    await page.request.post("/api/auth/dev");
    await page.goto(`/training-sessions-new/${SESSION}`);
    await expect(page.getByText("Presentes — total: 0")).toBeVisible();

    const row = page.locator(`[data-player-row="${targetId}"]`);
    const box = (await row.boundingBox())!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    });

    // A real finger jitters a few px during the hold. On iOS Safari, if these
    // sub-slop touchmoves go unprevented the whole gesture gets committed to
    // native scrolling and the later drag dies with a pointercancel — so the
    // blocker must be preventing from the very first move.
    const jitter = [2, -1, 3, -2, 1];
    for (const d of jitter) {
      await page.waitForTimeout(180);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX + d, y: startY + d }],
      });
    }
    await page.waitForTimeout(400);
    const goal = page.getByText(/Cambiar a PRESENTE/);
    await expect(goal).toBeVisible();

    // Drag toward the goal in small steps, like a finger would.
    const goalBox = (await goal.boundingBox())!;
    const endX = goalBox.x + goalBox.width / 2;
    const endY = goalBox.y + goalBox.height / 2;
    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{
          x: startX + ((endX - startX) * i) / steps,
          y: startY + ((endY - startY) * i) / steps,
        }],
      });
      await page.waitForTimeout(16);
    }

    // The gesture must have survived the whole move (no pointercancel).
    await expect(goal).toBeVisible();

    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect(page.getByText("Presentes — total: 1")).toBeVisible();
    await expect(
      page.getByTestId("section-presentes").getByText(`${LAST}, Objetivo`),
    ).toBeVisible();
  });

  test("mover el dedo enseguida scrollea y no dispara el arco", async ({ page }) => {
    await page.request.post("/api/auth/dev");
    await page.goto(`/training-sessions-new/${SESSION}`);
    await expect(page.getByText(/Presentes — total/)).toBeVisible();

    const row = page.locator(`[data-player-row="${targetId}"]`);
    const box = (await row.boundingBox())!;
    const x = box.x + box.width / 2;
    let y = box.y + box.height / 2;

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    // Immediate vertical movement = scroll intent.
    for (let i = 0; i < 8; i++) {
      y -= 20;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await page.waitForTimeout(1300);
    await expect(page.getByText(/Cambiar a/)).toHaveCount(0);
  });
});
