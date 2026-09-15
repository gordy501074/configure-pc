/**
 * Full-stack Playwright config. webServer boots both the Vite dev server and the
 * SQLite API against a dedicated throwaway test DB so smoke/regression run are
 * isolated from the real dev database.
 *
 * Concurrency note: tests share a single SQLite test DB (onboarding flag, cart,
 * seeded catalog). The onboarding smoke mutates the global onboarded flag, so
 * parallel workers would race it. We run single-threaded for deterministic,
 * dependency-free smoke/regression gates (still fast: ~30–40s).
 */
import { defineConfig, devices } from "@playwright/test";
import { API_PORT, APP_PORT, APP_BASE, TEST_DB_PATH } from "./tests/helpers/testDb.ts";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["tests/smoke/**/*.spec.ts", "tests/regression/**/*.spec.ts"],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: APP_BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: /regression\//,
    },
  ],
  webServer: [
    {
      command:
        `node --experimental-strip-types src/server/index.ts`,
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env, DB_PATH: TEST_DB_PATH, PORT: String(API_PORT) } as Record<string, string>,
      timeout: 30_000,
    },
    {
      command: `node node_modules/vite/bin/vite.js --port ${APP_PORT}`,
      url: APP_BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});