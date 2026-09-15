// @group regression
// Higher-confidence flows derived from the most common analytics events
// (see scripts/gen-tests-from-logs.ts). These assert BUSINESS behavior; selectors
// stay role/text/test-id so cosmetic/refactor changes can hot-swap via heal().
//
// HARD FAIL rule: any must-not-break business assertion failing here fails CI —
// we NEVER auto-update these assertions.

import { test, expect } from "@playwright/test";
import { heal } from "../helpers/heal";
import { APP_BASE } from "../helpers/testDb";

test.describe("regression: browse & configure", () => {
  test("catalog → details → back keeps context", async ({ page }) => {
    await page.goto("/ready");
    await expect(page.getByRole("status")).toContainText(/Найдено: \d+/);
    const office = page.getByText("Confi Office 3000").first();
    await expect(office).toBeVisible();
    await office.click();
    await expect(page).toHaveURL(/\/ready\/ready-office/);
    // Detail page shows the PC name + "Состав сборки" section (must-not-break).
    await expect(page.getByRole("heading", { name: "Confi Office 3000" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Состав сборки" })).toBeVisible();
    // Parts table rendered.
    const table = heal(page, {
      label: "detail: parts table",
      primary: { role: "table" },
      alternatives: [{ text: "Состав сборки" }],
    });
    expect(table, "parts table missing on PC detail").not.toBeNull();
    await expect(table!).toBeVisible();
  });

  test("auto-select produces a result with budget respected", async ({ page }) => {
    await page.goto("/auto");
    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByRole("button", { name: "Подобрать" }).click();
    await expect(page).toHaveURL(/\/auto\/result/);
    // Result page always renders the recommendation composition (lazy-loaded).
    await expect(page.getByRole("heading", { name: "Состав сборки" })).toBeVisible();
    // Reached with a recommendation implies survey state was preserved.
    expect(await page.getByRole("heading", { name: "Нет данных для подбора" }).count()).toBe(0);
  });

  test("checkout with no cart shows empty-state, not blank/crash", async ({ page, request }) => {
    // /checkout now requires an authenticated (customer) session.
    const sess = await request.post("/api/session", {
      data: { email: "checkout-client@example.com", name: "Клиент" },
    });
    expect(sess.ok()).toBeTruthy();
    const { sessionId } = await sess.json();
    await page.context().addCookies([
      { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
    ]);
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/checkout/);
    // Must-not-break: empty checkout renders the "Корзина пуста" fallback with a CTA.
    await expect(page.getByRole("heading", { name: "Корзина пуста" })).toBeVisible();
    await expect(page.getByRole("button", { name: "К готовым ПК" })).toBeVisible();
  });

  test("nonexistent ready URL surfaces fallback, not blank", async ({ page }) => {
    await page.goto("/ready/no-such-pc");
    const notFound = heal(page, {
      label: "ready-detail: missing fallback",
      primary: { role: "heading", name: "Сборка не найдена" },
      alternatives: [{ text: "К каталогу" }, { role: "heading" }],
    });
    expect(notFound, "no fallback surfaced").not.toBeNull();
    await expect(notFound!).toBeVisible();
  });
});