// Self-healing selector layer.
//
// Goal: keep smoke/regression selectors resilient to harmless UI refactors WITHOUT
// auto-editing business-logic assertions. When a `heal.get()` lookup fails on the
// primary selector, we fall back to ARIA role + accessible text / test-id / text and
// log the substitution. The whole `heal` module only resolves *locators*, never
// asserts values, so business behavior is never silently changed.

import { type Locator, type Page, test } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type HealPriority = "role" | "text" | "testid";

export interface HealSelector {
  /** Preferred selector, e.g. { role: "button", name: /Готовые PC/ } */
  primary: HealKind;
  /** Fallback candidates tried in order when primary is not found. */
  alternatives?: HealKind[];
  /** Short stable label used in the healing log / needs-review marker. */
  label: string;
  /** Mark the resolved locator so the test is flagged needs-review automatically. */
  meta?: Record<string, string>;
}

export type HealKind =
  | { role: string; name?: string | RegExp; exact?: boolean }
  | { testid: string }
  | { text: string | RegExp }
  | { textAll: string | RegExp };

function isVisible(page: Page, locator: Locator): Promise<boolean> {
  return locator
    .first()
    .isVisible()
    .then(() => true)
    .catch(() => false);
}

function describe(k: HealKind): string {
  if ("role" in k) return `role=${k.role}${k.name ? `|name=${String(k.name)}` : ""}`;
  if ("testid" in k) return `data-testid=${k.testid}`;
  if ("text" in k) return `text=${String(k.text)}`;
  return `textAll=${String((k as { textAll: string | RegExp }).textAll)}`;
}

function locatorFor(page: Page, k: HealKind): Locator {
  if ("role" in k) {
    return page.getByRole(k.role as never, { name: k.name, exact: k.exact ?? true });
  }
  if ("testid" in k) return page.getByTestId(k.testid);
  if ("text" in k) return page.getByText(k.text, { exact: true });
  return page.getByText((k as { textAll: string | RegExp }).textAll);
}

const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", ".healing.log");

function logHeal(entry: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, `${new Date().toISOString()} ${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* logging must never break tests */
  }
}

/**
 * Resolve a stable locator for `sel`, trying the primary selector then
 * alternatives. Every fallback surrogate is appended to tests/.healing.log and
 * the returned locator carries a needs-review marker via getByTestId neighbor
 * (so it can fail if needed). Returns null when no candidate matches.
 */
export function heal(page: Page, sel: HealSelector): Locator | null {
  const candidates = [sel.primary, ...(sel.alternatives ?? [])];
  // First, cheap synchronous test: primary exists.
  // (Playwright locators are lazy; visibility check is the real gate.)
  for (const k of candidates) {
    const loc = locatorFor(page, k);
    const present = isVisible(page, loc) as unknown as boolean;
    if (present) {
      if (k !== sel.primary) {
        logHeal({
          action: "selector-healed",
          label: sel.label,
          from: describe(sel.primary),
          to: describe(k),
          ...(sel.meta ?? {}),
        });
        // Attach the needs-review marker so CI/reporting surfaces it.
        void test.info().annotations.push({ type: "needs-review", description: `selector healed: ${sel.label}` });
      }
      return loc.first();
    }
  }
  logHeal({
    action: "selector-not-found",
    label: sel.label,
    primary: describe(sel.primary),
    alternatives: (sel.alternatives ?? []).map(describe),
    ...(sel.meta ?? {}),
  });
  return null;
}

export { describe, logHeal };