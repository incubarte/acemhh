import { test, expect, devices, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The drag gesture under Playwright's Pixel 7 descriptor: mobile viewport,
// isMobile viewport-meta handling, device scale factor and touch on Blink —
// the same engine Android Chrome runs, driven through real CDP touch events.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SESSION = "2026-08-20-22";
const PREV_SESSION_STR = "2026-08-06 22hs";
const LAST = "Androidtest";

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
  await s.from("attendances").delete().in("player_id", found);
  await s.from("players").delete().in("id", found);
}

test.use({ ...devices["Pixel 7"] });

/** Rows of the seeded players only. The database carries the club's real
 * roster, so counting a whole section would count strangers. */
function seeded(page: Page, section: string) {
  const sel = [...ids.values()].map((id) => `[data-player-row="${id}"]`).join(", ");
  return page.getByTestId(section).locator(sel);
}

test.describe("Pixel 7 (Blink, como Android Chrome)", () => {
  test.beforeAll(async () => {
    await cleanup();
    const s = admin();
    // Enough absentees to make the page scrollable on a phone.
    const { data: players, error } = await s.from("players")
      .insert(Array.from({ length: 15 }, (_, i) => ({
        name: `Androide${String(i).padStart(2, "0")}`,
        last_name: LAST,
        dni: `990009${String(i).padStart(2, "0")}`,
        categories: ["cat-b"],
        player_type: "player",
        trains: false,
        invitee: false,
      })))
      .select("id,name");
    if (error) throw new Error(JSON.stringify(error));
    for (const p of players!) ids.set(p.name, p.id);

    const { error: attError } = await s.from("attendances").insert(
      players!.map((p) => ({ player_id: p.id, session: PREV_SESSION_STR, attended: true })),
    );
    if (attError) throw new Error(JSON.stringify(attError));
  });
  test.afterAll(cleanup);

  test("deslizar la ruedita marca presente", async ({ page }) => {
    await page.request.post("/api/auth/dev");
    await page.goto(`/training-sessions-beta/${SESSION}`);
    await expect(page.getByTestId("section-presentes")).toBeVisible();

    // Deudores renders first, so the last copy is the one in the player's own
    // section — the copy in Deben takes no gesture at all.
    const row = page.locator(`[data-player-row="${ids.get("Androide03")}"]`).last();
    // Centred, and settled: near the bottom-left corner the dev-tools badge
    // swallows the touch, and the header's compaction shifts the row after a
    // scroll — either one makes a measured box wrong.
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const box = (await row.boundingBox())!;
    const startX = box.x + 20;
    const y = box.y + box.height / 2;
    const distance = box.width * 0.8;

    // The row moves optimistically; without waiting for the write the test
    // would end and the closing context would cancel the request.
    const written = page.waitForResponse((r) =>
      r.url().includes("/attendance") && r.request().method() === "POST");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y }],
    });
    for (let i = 1; i <= 14; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX + (distance * i) / 14, y }],
      });
      await page.waitForTimeout(40);
    }
    await expect(page.getByTestId("attendance-wheel").first()).toBeVisible();
    await page.waitForTimeout(250);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await written;

    await expect(seeded(page, "section-presentes")).toHaveCount(1);
  });

  test("un swipe inmediato sobre una fila scrollea de verdad", async ({ page }) => {
    await page.request.post("/api/auth/dev");
    await page.goto(`/training-sessions-beta/${SESSION}`);
    await expect(page.getByTestId("section-presentes")).toBeVisible();

    // Deudores renders first, so the last copy is the one in the player's own
    // section — the copy in Deben takes no gesture at all.
    const row = page.locator(`[data-player-row="${ids.get("Androide05")}"]`).last();
    // Centred, and settled: near the bottom-left corner the dev-tools badge
    // swallows the touch, and the header's compaction shifts the row after a
    // scroll — either one makes a measured box wrong.
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const box = (await row.boundingBox())!;
    const x = box.x + box.width / 2;
    let y = box.y + box.height / 2;

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 0; i < 10; i++) {
      y -= 25;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    // The permanent non-passive blocker must not kill normal scrolling: the
    // page really moved, and the wheel never woke up.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
    await expect(page.getByTestId("attendance-wheel")).toHaveCount(0);
  });
});
