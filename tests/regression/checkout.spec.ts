// @group regression
// Checkout: full order placement via ready-PC line and via config, validation.

import { test, expect } from "@playwright/test";
import { APP_BASE } from "../helpers/testDb";

async function loginAs(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, email: string, name: string) {
  const res = await request.post("/api/session", { data: { email, name } });
  expect(res.ok()).toBeTruthy();
  const { sessionId } = await res.json();
  await page.context().addCookies([
    { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
  ]);
}

test.describe("regression: checkout", () => {
  test("checkout requires fields and places an order", async ({ page, request }) => {
    await loginAs(page, request, "checkout-full@example.com", "Покупатель");
    // Reach checkout from a ready PC card (passes a line item in router state).
    await page.goto("/ready/ready-office");
    await expect(page.getByRole("heading", { name: "Confi Office 3000" })).toBeVisible();
    await page.getByRole("button", { name: "Оформить заказ" }).click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByRole("heading", { name: "Оформление заказа" })).toBeVisible();

    // Empty submit triggers validation errors (name is pre-filled from the
    // account, so clear it first).
    await page.locator("#ord-name").fill("");
    await page.locator("#ord-phone").fill("");
    await page.locator("#ord-address").fill("");
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(page.getByText("Укажите имя (минимум 2 символа).")).toBeVisible();
    await expect(page.getByText("Укажите полный адрес доставки.")).toBeVisible();
    await expect(page.getByText("Укажите корректный телефон.")).toBeVisible();

    // Fill valid data.
    await page.locator("#ord-name").fill("Покупатель");
    await page.locator("#ord-phone").fill("+7 900 123 45 67");
    await page.locator("#ord-address").fill("Москва, ул. Ленина, 1, кв. 5");
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();

    // Success screen.
    await expect(page.getByRole("heading", { name: "Заказ оформлен" })).toBeVisible();
    await expect(page.getByText("Номер заказа:")).toBeVisible();
  });

  test("checkout empty state shows 'Корзина пуста'", async ({ page, request }) => {
    await loginAs(page, request, "checkout-empty@example.com", "Пусто");
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Корзина пуста" })).toBeVisible();
    await expect(page.getByRole("button", { name: "К готовым ПК" })).toBeVisible();
  });
});