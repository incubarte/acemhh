import { defineConfig } from "@playwright/test";

// UI tests run against the local stack: `supabase start` first, then
// `npm run test:e2e`. The dev server is started automatically (and reused if
// already running). Login happens per-test via POST /api/auth/dev, which needs
// DEV_AUTH_ID in .env.local pointing at a user present in the users table.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
