import { test, expect } from "@playwright/test";
import { ExperienceKey } from "../src/lib/experience";

// The experience switch: it lives on the attendance screens themselves, so
// either version is one tap from the other, and the session list opens
// whichever one was last picked — the new one until told otherwise.

const SESSION = "2026-08-20-22";
const LegacyBetaKey = "acemhh:training-beta";

const stored = (page: import("@playwright/test").Page) =>
  page.evaluate((k) => localStorage.getItem(k), ExperienceKey);

test("el switch cruza entre las dos pantallas y la elección persiste", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto("/training-sessions?date=2026-08-20");

  // The switch is gone from the session list: it belongs to the screens it
  // picks between.
  await expect(page.getByTestId("beta-toggle")).toHaveCount(0);
  await expect(page.getByTestId("experience-toggle")).toHaveCount(0);

  // New by default, with nothing stored.
  await page.getByRole("button", { name: /22:00hs/ }).click();
  await page.waitForURL(`**/training-sessions-beta/${SESSION}`);

  const toggle = page.getByTestId("experience-toggle");
  await expect(toggle).toHaveAttribute("data-experience", "nueva");
  await expect(toggle.locator("input")).toBeChecked();
  await expect(toggle).toContainText("experiencia vieja");
  await expect(toggle).toContainText("experiencia nueva");

  // Flipping it lands on the same session of the old screen, without going
  // back through the list.
  await toggle.click();
  await page.waitForURL(`**/training-sessions/${SESSION}`);
  await expect(page.getByTestId("experience-toggle"))
    .toHaveAttribute("data-experience", "vieja");
  await expect(page.getByTestId("experience-toggle").locator("input")).not.toBeChecked();
  expect(await stored(page)).toBe("vieja");

  // And the list now opens the old screen.
  await page.goto("/training-sessions?date=2026-08-20");
  await page.getByRole("button", { name: /22:00hs/ }).click();
  await page.waitForURL(`**/training-sessions/${SESSION}`);

  // Back again, from the old screen.
  await page.getByTestId("experience-toggle").click();
  await page.waitForURL(`**/training-sessions-beta/${SESSION}`);
  expect(await stored(page)).toBe("nueva");

  // Survives a logout/login on the same device.
  await page.context().clearCookies();
  await page.request.post("/api/auth/dev");
  await page.goto("/training-sessions?date=2026-08-20");
  await page.getByRole("button", { name: /22:00hs/ }).click();
  await page.waitForURL(`**/training-sessions-beta/${SESSION}`);
});

test("el switch queda entre el header y el cartel de sesión, a todo el ancho", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.setViewportSize({ width: 390, height: 640 });
  // A past session, so the warning is up and the order can be checked.
  await page.goto("/training-sessions-beta/2026-08-06-22");

  const header = page.getByTestId("app-header");
  const toggle = page.getByTestId("experience-toggle");
  const warning = page.getByTestId("session-date-warning");
  await expect(warning).toBeVisible();

  const headerBox = (await header.boundingBox())!;
  const toggleBox = (await toggle.boundingBox())!;
  const warnBox = (await warning.boundingBox())!;

  expect(toggleBox.x).toBe(0);
  expect(toggleBox.width).toBe(390);
  expect(Math.round(toggleBox.y)).toBe(Math.round(headerBox.y + headerBox.height));
  expect(Math.round(warnBox.y)).toBe(Math.round(toggleBox.y + toggleBox.height));

  // Pinned: it stays put while the page scrolls.
  // scrollTo, not the wheel: the wheel needs the pointer over the
  // scroller, and where it happens to be has made this flaky.
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(300);
  expect((await toggle.boundingBox())!.y).toBeLessThan(headerBox.height + 40);
});

test("la preferencia vieja del beta se limpia sola", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto("/training-sessions?date=2026-08-20");
  await page.evaluate((k) => localStorage.setItem(k, "1"), LegacyBetaKey);

  await page.reload();
  // Reading the preference drops the old key on the way.
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), LegacyBetaKey))
    .toBe(null);

  // And having had it makes no difference: the new screen is the default.
  await page.getByRole("button", { name: /22:00hs/ }).click();
  await page.waitForURL(`**/training-sessions-beta/${SESSION}`);
});
