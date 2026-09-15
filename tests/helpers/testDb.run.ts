// CLI runner for the test database. Usage:
//   node --experimental-strip-types tests/helpers/testDb.run.ts
// Initializes (schema + seed) the isolated throwaway DB used by Playwright.
import { initTestDb, TEST_DB_PATH, resetAnalytics, setOnboardedTrue } from "./testDb.ts";

initTestDb();
resetAnalytics();
// Route-gate tests (catalog/config/etc.) target app flows, not onboarding itself,
// so the test DB is pre-onboarded. A dedicated test covers the onboarding flow.
setOnboardedTrue();
// eslint-disable-next-line no-console
console.log(`[test-db] ready: ${TEST_DB_PATH}`);