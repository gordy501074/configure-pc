// @group regression
// Installment (0-0-4 / Альфа-Банк) flow at /alpha.

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

test.describe("regression: installment", () => {
  test("installment empty state (no order payload)", async ({ page, request }) => {
    await loginAs(page, request, "inst-empty@example.com", "Пусто");
    await page.goto("/alpha");
    await expect(page.getByRole("heading", { name: "Нет данных для рассрочки" })).toBeVisible();
  });

  test("installment form validates and submits an alpha order", async ({ page, request }) => {
    await loginAs(page, request, "inst-full@example.com", "Рассрочка");
    // Land on /alpha via the ready card's InstallmentPlan (navigates with state).
    await page.goto("/ready/ready-gaming");
    await expect(page.getByRole("heading", { name: "Confi Gaming X" })).toBeVisible();
    const plan = page.getByText("Купить в рассрочку на 4 месяца");
    await expect(plan).toBeVisible();
    await plan.click();
    await expect(page).toHaveURL(/\/alpha/);
    await expect(page.getByRole("heading", { name: "Покупка в рассрочку от Альфа-Банка" })).toBeVisible();

    // Invalid submit shows errors.
    await page.getByRole("button", { name: /Отправить заявку на покупку в рассрочку/ }).click();
    await expect(page.getByText("Укажите корректный e-mail.")).toBeVisible();

    // Fill valid data.
    await page.locator("#inst-name").fill("Рассрочка");
    await page.locator("#inst-phone").fill("+7 900 123 45 67");
    await page.locator("#inst-email").fill("inst@example.com");
    await page.getByRole("button", { name: /Отправить заявку на покупку в рассрочку/ }).click();

    // Success screen.
    await expect(page.getByRole("heading", { name: "Заявка отправлена" })).toBeVisible();
  });
});