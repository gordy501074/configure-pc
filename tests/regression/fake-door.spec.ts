// @group regression
// Fake doors: compare stub in the client profile and the installment scheme stub
// in the configurator. Both open a «Скоро» modal; the installment schemes are A/B.

import { test, expect } from "@playwright/test";
import { APP_BASE } from "../helpers/testDb";

async function loginAs(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  email: string,
  name: string,
) {
  const res = await request.post("/api/session", { data: { email, name } });
  expect(res.ok()).toBeTruthy();
  const { user, sessionId } = await res.json();
  await page.context().addCookies([
    { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
  ]);
  return { ...(user as { id: string }), sessionId } as { id: string; sessionId: string };
}

test.describe("regression: fake doors", () => {
  test("compare stub opens a coming-soon modal from the configs tab", async ({ page, request }) => {
    const { id, sessionId } = await loginAs(page, request, "fd-compare@example.com", "Сравниватель");
    const put = await request.put(`/api/configs/cfg-compare-1?userId=${encodeURIComponent(id)}`, {
      headers: { cookie: `confi_session=${sessionId}` },
      data: { name: "Сборка для сравнения", source: "custom", parts: [{ category: "cpu", part_id: "cpu-r5-5600" }] },
    });
    expect(put.ok()).toBeTruthy();

    await page.goto("/profile/configs");
    await page.getByRole("button", { name: "Добавить к сравнению" }).first().click();
    await expect(page.getByText(/Выбрано для сравнения: 1 из 3/)).toBeVisible();
    await page.getByRole("button", { name: "Сравнить" }).click();
    await expect(page.getByRole("heading", { name: "Сравнение скоро появится" })).toBeVisible();
    await page.getByRole("button", { name: "Понятно" }).click();
  });

  test("customer sees exactly one installment scheme stub and it opens a modal", async ({ page, request }) => {
    await loginAs(page, request, "fd-installment@example.com", "Плательщик");
    await page.goto("/config");
    await expect(page.getByRole("heading", { name: "Конфигуратор" })).toBeVisible();

    const stub = page.getByText(/от Альфа-Банка · (20|50)% предоплаты, 0 переплат/);
    await expect(stub).toHaveCount(1);
    await stub.click();
    await expect(page.getByRole("heading", { name: "Схема рассрочки скоро появится" })).toBeVisible();
  });

  test("guest sees no installment fake door", async ({ page }) => {
    await page.goto("/config");
    await expect(page.getByRole("heading", { name: "Конфигуратор" })).toBeVisible();
    await expect(page.getByText(/от Альфа-Банка · (20|50)% предоплаты, 0 переплат/)).toHaveCount(0);
  });
});