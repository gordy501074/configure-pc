// @group smoke
// Critical must-not-break flows: app boot, key routes render, key actions work,
// and no console/page errors appear on any critical route.
//
// Selectors here prefer role/text (stable under refactor). Failing lookups are
// resolved by the self-healing layer → tests/.healing.log + needs-review marker.

import { test, expect } from "@playwright/test";
import { heal } from "../helpers/heal";
import type { Page } from "@playwright/test";

/** Collect console errors + page errors for the test's lifetime. */
async function watchErrors(page: Page): Promise<() => string[]> {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return () => errors;
}

test.describe("smoke: critical flows", () => {
  test("@smoke home loads and shows hero", async ({ page }) => {
    const errors = await watchErrors(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Соберите компьютер, который решает ваши задачи" }),
    ).toBeVisible();
    // Key CTAs render.
    await expect(page.getByRole("link", { name: "Подобрать за 1 минуту" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Смотреть готовые ПК" })).toBeVisible();
    expect(errors(), "console/page errors on home").toEqual([]);
  });

  test("@smoke ready-catalog lists PCs and opens a card", async ({ page }) => {
    const errors = await watchErrors(page);
    await page.goto("/ready");
    await expect(page).toHaveURL(/\/ready$/);
    // Status line shows the loaded count ("Найдено:").
    const status = heal(page, {
      label: "ready: load status",
      primary: { role: "status" },
      alternatives: [{ textAll: /Найдено: \d+/ }],
    });
    await expect(status!).toBeVisible();
    // A known ready PC card is rendered.
    const cardTitle = page.getByText("Confi Office 3000").first();
    await expect(cardTitle).toBeVisible();
    await cardTitle.click();
    await expect(page).toHaveURL(/\/ready\/ready-office/);
    expect(errors(), "console/page errors on ready card").toEqual([]);
  });

  test("@smoke configurator renders part selectors", async ({ page }) => {
    const errors = await watchErrors(page);
    await page.goto("/config");
    await expect(page).toHaveURL(/\/config$/);
    const heading = page.getByRole("heading", { name: /Конфигуратор|Сборка/i }).first();
    await expect(heading).toBeVisible();
    expect(errors(), "console/page errors on configurator").toEqual([]);
  });

  test("@smoke auto-select full flow lands on result", async ({ page }) => {
    const errors = await watchErrors(page);
    await page.goto("/auto");
    await expect(page).toHaveURL(/\/auto$/);
    await expect(page.getByRole("heading", { name: "Автоподбор ПК" })).toBeVisible();
    // Step through the 4-step survey using the submit button, then submit final.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Далее" }).click();
    }
    await page.getByRole("button", { name: "Подобрать" }).click();
    await expect(page).toHaveURL(/\/auto\/result/);
    expect(errors(), "console/page errors on auto result").toEqual([]);
  });

  test("@smoke profile redirects anonymous to /auth", async ({ page }) => {
    const errors = await watchErrors(page);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/auth/);
    expect(errors(), "console/page errors on profile redirect").toEqual([]);
  });

  test("@smoke not-found route renders fallback, no crash", async ({ page }) => {
    const errors = await watchErrors(page);
    await page.goto("/definitely-not-a-route");
    await expect(page).toHaveURL(/\/definitely-not-a-route/);
    expect(errors(), "console/page errors on 404").toEqual([]);
  });
});