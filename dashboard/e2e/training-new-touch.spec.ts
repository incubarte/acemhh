import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Real-touch regression for the attendance wheel. Mouse events skip the
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

const ids = new Map<string, string>();

async function cleanup() {
  const s = admin();
  const { data } = await s.from("players").select("id").eq("last_name", LAST);
  const found = (data ?? []).map((p) => p.id);
  if (found.length === 0) return;
  await s.from("attendances").delete().in("player_id", found);
  await s.from("players").delete().in("id", found);
}

async function openPage(page: Page) {
  await page.request.post("/api/auth/dev");
  await page.goto(`/training-sessions-beta/${SESSION}`);
  await expect(page.getByTestId("section-presentes")).toBeVisible();
}

test.describe("ruedita táctil real", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 664 } });
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await cleanup();
    const s = admin();
    const { data: players, error } = await s.from("players")
      .insert(["Lento", "Rapido", "Quieto"].map((name, i) => ({
        name,
        last_name: LAST,
        dni: `9900070${i + 1}`,
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

  test("swipe lento pasando la mitad marca presente", async ({ page }) => {
    await openPage(page);

    // Deudores renders first, so the last copy is the one in the player's own
    // section — the copy in Deben takes no gesture at all.
    const row = page.locator(`[data-player-row="${ids.get("Lento")}"]`).last();
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
    await page.waitForTimeout(250); // release with ~zero velocity
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await written;

    await expect(page.getByTestId("section-presentes").locator("[data-player-row]")).toHaveCount(1);
    await expect(
      page.getByTestId("section-presentes").getByText(`${LAST}, Lento`),
    ).toBeVisible();
  });

  test("flick corto y veloz encastra en el imán y marca presente", async ({ page }) => {
    await openPage(page);

    // Deudores renders first, so the last copy is the one in the player's own
    // section — the copy in Deben takes no gesture at all.
    const row = page.locator(`[data-player-row="${ids.get("Rapido")}"]`).last();
    // Centred, and settled: near the bottom-left corner the dev-tools badge
    // swallows the touch, and the header's compaction shifts the row after a
    // scroll — either one makes a measured box wrong.
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const box = (await row.boundingBox())!;
    const startX = box.x + 20;
    const y = box.y + box.height / 2;

    // The row moves optimistically; without waiting for the write the test
    // would end and the closing context would cancel the request.
    const written = page.waitForResponse((r) =>
      r.url().includes("/attendance") && r.request().method() === "POST");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y }],
    });
    // ~110px in ~64ms: far short of half the row, but fast — the magnet
    // must carry it into the PRESENTE detent.
    for (let i = 1; i <= 4; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX + i * 28, y }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await written;

    await expect(page.getByTestId("section-presentes").locator("[data-player-row]")).toHaveCount(2);
  });

  test("swipe vertical scrollea sin despertar la ruedita", async ({ page }) => {
    await openPage(page);

    // Deudores renders first, so the last copy is the one in the player's own
    // section — the copy in Deben takes no gesture at all.
    const row = page.locator(`[data-player-row="${ids.get("Quieto")}"]`).last();
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
    for (let i = 0; i < 8; i++) {
      y -= 20;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect(page.getByTestId("attendance-wheel")).toHaveCount(0);
    // Quieto stays absent.
    await expect(
      page.getByTestId("section-ausentes").getByText(`${LAST}, Quieto`),
    ).toBeVisible();
  });
});
