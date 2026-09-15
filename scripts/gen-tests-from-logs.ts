// Generate draft regression tests from real usage logs.
//
// Reads most-frequent user flows from analytics_events (db/confi.db) and emits
// draft Playwright specs into tests/drafts/. Every generated test carries a
// HUMAN-APPROVE-REQUIRED marker; drafts are never auto-run in CI until approved
// (moved out of tests/drafts/ by a human).
//
// The generator maps event sequences to a best-effort Playwright skeleton. It is
// DECLARATIVE only: it uses stable role/test-id selectors and asserts nothing about
// business values — that part stays for human review.
//
// Usage: npm run test:gen:from-logs [-- --db <path>]

import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const argvIndex = process.argv.findIndex((a) => a === "--db");
const dbPath =
  argvIndex >= 0
    ? process.argv[argvIndex + 1]
    : process.env.ANALYTICS_DB ?? join(root, "db", "confi.db");
const DRAFTS_DIR = join(root, "tests", "drafts");

interface Flow {
  event: string;
  count: number;
}

function readFlows(limit: number): Flow[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT event, COUNT(*) AS count FROM analytics_events
       WHERE level != 'debug'
       GROUP BY event ORDER BY count DESC LIMIT ?`,
    )
    .all(limit) as { event: string; count: number }[];
  db.close();
  return rows;
}

// Map an event name to a (route, locator hint) skeleton.
const SCENARIOS: Record<string, { route: string; hint: string; action?: string }> = {
  "page:view": { route: "/", hint: "home loads" },
  "route:change": { route: "/", hint: "route change fires" },
  "ui:click": { route: "/ready", hint: "catalog interaction", action: "click" },
  "ui:submit": { route: "/auto", hint: "survey submit", action: "submit" },
  "fetch:call": { route: "/ready", hint: "catalog fetch succeeds" },
  "fetch:error": { route: "/ready", hint: "catalog fetch fails gracefully" },
  "session:signin": { route: "/auth", hint: "sign in flow" },
  "session:signout": { route: "/profile", hint: "sign out" },
  "checkout:start": { route: "/checkout", hint: "start checkout" },
  "checkout:complete": { route: "/checkout", hint: "complete checkout" },
  "app:error": { route: "/", hint: "known app error path" },
};

function buildSpec(scenario: { route: string; hint: string; action?: string }, count: number): string {
  const name = sanitize(scenario.hint);
  const submitClick = scenario.action === "submit"
    ? `  await page.getByRole("button", { name: "Подобрать" }).click();\n`
    : "";
  return `// @draft
// GENERATED from analytics logs — ${count} occurrences.
// ===== HUMAN APPROVE REQUIRED =====
// This test is a DRAFT. Review business assertions, then move it into
// tests/regression/ and remove this marker. Do NOT auto-merge drafts.
// ============================== =====
import { test, expect } from "@playwright/test";

test.describe("draft: ${name}", () => {
  test("${scenario.hint} (route ${scenario.route})", async ({ page }) => {
    await page.goto("${scenario.route}");
    await expect(page).toHaveURL(/\\${scenario.route}/);
${submitClick}    // TODO(draft): assert the core business outcome for this flow.
    await expect(page.locator("body")).toContainText(/.+/);
  });
});
`;
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function main(): Promise<void> {
  mkdirSync(DRAFTS_DIR, { recursive: true });
  const flows = readFlows(50);
  const engaged = flows.filter((f) => f.count >= 3 && SCENARIOS[f.event]);
  if (engaged.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`No draftable flows in ${dbPath} (need >=3 occurrences of a known event).`);
    return;
  }
  let written = 0;
  for (const f of engaged) {
    const scenario = SCENARIOS[f.event];
    const fname = `${sanitize(scenario.hint)}.spec.ts`;
    const out = join(DRAFTS_DIR, fname);
    writeFileSync(out, buildSpec(scenario, f.count), "utf8");
    written++;
    // eslint-disable-next-line no-console
    console.log(`  draft: ${out} (${f.count}× ${f.event})`);
  }
  // eslint-disable-next-line no-console
  console.log(`Generated ${written} draft(s) into ${DRAFTS_DIR}.`);
}

void main();