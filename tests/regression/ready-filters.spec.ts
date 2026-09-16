// @group regression
// Ready PC catalog: filters, sorting, empty-result reset.

import { test, expect } from "@playwright/test";

test.describe("regression: ready catalog filters", () => {
  test("usage + brand filters narrow results and show status", async ({ page }) => {
    await page.goto("/ready");
    await expect(page.getByRole("status")).toContainText(/Найдено: \d+/);

    // Filter by usage "Игры".
    await page.locator("#filter-usage").click();
    await page.getByRole("option", { name: "Игры" }).click();
    await expect(page.getByRole("status")).toContainText(/Найдено: 1/);

    // The gaming PC appears.
    await expect(page.getByText("Confi Gaming X")).toBeVisible();
  });

  test("price max filters out higher-priced builds and empty state present", async ({ page }) => {
    await page.goto("/ready");
    await expect(page.getByRole("status")).toContainText(/Найдено: \d+/);
    await page.getByLabel("Цена до").fill("60000");
    await expect(page.getByRole("status")).toContainText(/Найдено: 1/);
    await expect(page.getByText("Confi Office 3000")).toBeVisible();
  });

  test("reset clears filters back to full result", async ({ page }) => {
    await page.goto("/ready");
    await page.getByLabel("Цена до").fill("5000");
    await expect(page.getByRole("status")).toContainText(/Найдено: 0/);
    await expect(page.getByRole("heading", { name: "Ничего не найдено" })).toBeVisible();
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(/Найдено: 4/);
  });
});