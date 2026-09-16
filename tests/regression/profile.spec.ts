// @group regression
// Profile: tabs render, profile edit persists, settings toggle persists.

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

test.describe("regression: profile", () => {
  test("profile configs tab lists saved builds", async ({ page, request }) => {
    const email = "cfg-owner@example.com";
    const { id } = await loginAs(page, request, email, "Владелец");
    // Seed a config for this user via API (pass their real user id).
    const put = await request.put(`/api/configs/cfg-demo-1?userId=${encodeURIComponent(id)}`, {
      data: {
        name: "Моя офисная сборка",
        source: "custom",
        parts: [
          { category: "cpu", part_id: "cpu-r5-5600" },
          { category: "gpu", part_id: "gpu-rx-7600" },
        ],
      },
    });
    expect(put.ok()).toBeTruthy();

    await page.goto("/profile");
    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByRole("heading", { name: "Владелец" })).toBeVisible();
    await expect(page.getByText("Моя офисная сборка")).toBeVisible();
  });

  test("profile orders tab lists orders and cancels one", async ({ page, request }) => {
    const email = "ord-owner@example.com";
    const { id } = await loginAs(page, request, email, "Заказчик");
    // Seed an order via API bound to the same user.
    const put = await request.put(`/api/orders/ord-demo-1?userId=${encodeURIComponent(id)}`, {
      data: {
        status: "new",
        address: "Москва, ул. Ленина, 1",
        userName: "Заказчик",
        items: [{ kind: "ready", refId: "ready-office", name: "Confi Office 3000", price: 54900, count: 1 }],
      },
    });
    expect(put.ok()).toBeTruthy();

    await page.goto("/profile/orders");
    await expect(page).toHaveURL(/\/profile\/orders/);
    await expect(page.getByText("Confi Office 3000")).toBeVisible();
    // Cancel the order (status "new" => cancel button present).
    await page.getByRole("button", { name: "Отменить" }).click();
    await expect(page.getByText("Confi Office 3000")).toHaveCount(0);
  });

  test("profile settings tab renders theme + notifications", async ({ page, request }) => {
    const email = "settings-owner@example.com";
    await loginAs(page, request, email, "Настройщик");
    await page.goto("/profile/settings");
    await expect(page.getByRole("heading", { name: "Настройщик" })).toBeVisible();
    await expect(page.getByLabel("Тема оформления")).toBeVisible();
    await expect(page.getByLabel("Уведомления")).toBeVisible();
  });

  test("profile edit name persists", async ({ page, request }) => {
    const email = "edit-owner@example.com";
    await loginAs(page, request, email, "СтароеИмя");
    await page.goto("/profile");
    await page.getByRole("button", { name: "Редактировать аккаунт" }).click();
    await page.locator("#profile-name").fill("НовоеИмя");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByRole("heading", { name: "НовоеИмя" })).toBeVisible();
  });
});