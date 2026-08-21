import { test, expect } from "@playwright/test";

// The "beta" switch on the sessions list: off by default routing to the
// legacy screen, on routing to /training-sessions-beta, and persisted in
// localStorage so it survives re-logins on the device.

test("el switch beta rutea a la pantalla nueva y persiste", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto("/training-sessions?date=2026-08-20");
  const slot22 = page.getByRole("button", { name: /22:00hs/ });
  await expect(slot22).toBeVisible();

  // Off by default: the legacy screen.
  await slot22.click();
  await page.waitForURL("**/training-sessions/2026-08-20-22");

  // On: the beta screen.
  await page.goto("/training-sessions?date=2026-08-20");
  await page.getByTestId("beta-toggle").click();
  await page.getByRole("button", { name: /22:00hs/ }).click();
  await page.waitForURL("**/training-sessions-beta/2026-08-20-22");
  await expect(page.getByTestId("section-presentes")).toBeVisible();

  // Persists across a logout/login on the same device (localStorage).
  await page.context().clearCookies();
  await page.request.post("/api/auth/dev");
  await page.goto("/training-sessions?date=2026-08-20");
  await expect(page.getByTestId("beta-toggle").locator("input")).toBeChecked();
  await page.getByRole("button", { name: /22:00hs/ }).click();
  await page.waitForURL("**/training-sessions-beta/2026-08-20-22");

  // And can be turned back off.
  await page.goto("/training-sessions?date=2026-08-20");
  await page.getByTestId("beta-toggle").click();
  await page.getByRole("button", { name: /22:00hs/ }).click();
  await page.waitForURL("**/training-sessions/2026-08-20-22");
});
