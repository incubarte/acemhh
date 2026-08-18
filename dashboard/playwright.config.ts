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
    baseURL: "http://localhost:3111",
  },
  webServer: {
    // A dedicated port: 3000 is often taken by another project's dev server,
    // and reuseExistingServer would happily point the suite at the wrong app.
    command: "npm run dev -- -p 3111",
    url: "http://localhost:3111",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
