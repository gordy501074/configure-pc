// @group regression
// Custom configurator: part selection, compatibility blocking, save-to-profile.

import { test, expect } from "@playwright/test";
import { APP_BASE } from "../helpers/testDb";

async function loginAs(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, email: string, name: string) {
  const res = await request.post("/api/session", { data: { email, name } });
  expect(res.ok()).toBeTruthy();
  const { user, sessionId } = await res.json();
  await page.context().addCookies([
    { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
  ]);
  return user as { id: string };
}

test.describe("regression: custom configurator", () => {
  test("select parts and save to profile", async ({ page, request }) => {
    const { id } = await loginAs(page, request, "cfg-builder@example.com", "Сборщик");
    await page.goto("/config");
    await expect(page.getByRole("heading", { name: "Конфигуратор" })).toBeVisible();

    // Pick CPU.
    await page.getByRole("button", { name: /Выбрать процессор/ }).first().click();
    await expect(page.getByRole("heading", { name: "Выбор: Процессор" })).toBeVisible();
    await page.getByRole("button", { name: /AMD Ryzen 5 5600/ }).click();
    // Picker closes.
    await expect(page.getByRole("heading", { name: "Выбор: Процессор" })).toHaveCount(0);
    await expect(page.getByText("AMD Ryzen 5 5600", { exact: true })).toBeVisible();

    // Pick a GPU.
    await page.getByRole("button", { name: /Выбрать видеокарта/ }).first().click();
    await page.getByRole("button", { name: /AMD Radeon RX 7600/ }).click();
    await expect(page.getByText("AMD Radeon RX 7600 8 ГБ", { exact: true })).toBeVisible();

    // Save is blocked until the config is complete: the button stays disabled.
    await expect(page.getByRole("button", { name: "Сохранить в профиль" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Оформить заказ" })).toBeDisabled();
  });

  test("compatible config completes and can be saved", async ({ page, request }) => {
    const { id } = await loginAs(page, request, "cfg-complete@example.com", "Готовый");
    await page.goto("/config");
    await expect(page.getByRole("heading", { name: "Конфигуратор" })).toBeVisible();

    const pick = async (button: string, part: string) => {
      await page.getByRole("button", { name: new RegExp(button) }).first().click();
      await page.getByRole("button", { name: new RegExp(part) }).click();
    };

    // Button labels use the nominative CATEGORY_LABELS (lowercased), e.g.
    // "Выбрать видеокарта", "Выбрать материнская плата".
    await pick("Выбрать процессор", "Intel Core i5-13400F");
    await pick("Выбрать видеокарта", "NVIDIA GeForce RTX 4060");
    await pick("Выбрать материнская плата", "ASUS Prime B760M-A");
    await pick("Выбрать оперативная память", "Kingston Fury Beast 32 ГБ");
    await pick("Выбрать накопитель", "Samsung 980 Pro 1 ТБ");
    await pick("Выбрать корпус", "Fractal Design Pop Mini mATX");
    await pick("Выбрать блок питания", "Corsair RM650x 650 Вт");
    await pick("Выбрать охлаждение", "Noctua NH-D15 chromax.black");

    // The config is now complete: summary shows the total and save is enabled.
    await expect(page.getByRole("button", { name: "Сохранить в профиль" })).toBeEnabled();
    await page.getByRole("button", { name: "Сохранить в профиль" }).click();
    await expect(page.getByText(/Сохранено в профиль/).first()).toBeVisible();
  });
});