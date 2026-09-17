// @group regression
// Roles admin/seller: purchase/save/review forbidden, role-based profile tabs,
// seller brand CRUD, header settings gear (auth only).

import { test, expect } from "@playwright/test";
import type { Page, APIRequestContext } from "@playwright/test";
import { APP_BASE } from "../helpers/testDb";

async function loginByEmail(
  page: Page,
  request: APIRequestContext,
  email: string,
  name: string,
): Promise<{ id: string }> {
  const res = await request.post("/api/session", { data: { email, name } });
  expect(res.ok()).toBeTruthy();
  const { user, sessionId } = await res.json();
  await page.context().addCookies([
    { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
  ]);
  return user as { id: string };
}

async function withSession(request: APIRequestContext, email: string, name: string): Promise<string> {
  const res = await request.post("/api/session", { data: { email, name } });
  expect(res.ok()).toBeTruthy();
  const { sessionId } = await res.json();
  return sessionId as string;
}

test.describe("regression: role restrictions", () => {
  test("seller sees no purchase/save/review actions on a ready PC", async ({ page, request }) => {
    await loginByEmail(page, request, "user@company.com", "Продавец Confi");
    await page.goto("/ready/ready-gaming");
    await expect(page.getByRole("heading", { name: "Confi Gaming X" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Оформить заказ" })).toHaveCount(0);
    await expect(page.getByText("Купить в рассрочку на 4 месяца")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Сохранить" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Отзыв" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Оставить отзыв" })).toHaveCount(0);
  });

  test("admin sees no purchase actions on a ready PC", async ({ page, request }) => {
    await loginByEmail(page, request, "avgordeev@alfabank.ru", "Администратор");
    await page.goto("/ready/ready-gaming");
    await expect(page.getByRole("heading", { name: "Confi Gaming X" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Оформить заказ" })).toHaveCount(0);
    await expect(page.getByText("Купить в рассрочку на 4 месяца")).toHaveCount(0);
  });

  test("seller is redirected away from /checkout and /alpha", async ({ page, request }) => {
    await loginByEmail(page, request, "user@company.com", "Продавец Confi");
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/alpha");
    await expect(page).toHaveURL(/\/$/);
  });

  test("server rejects seller writes on configs/orders/reviews", async ({ request }) => {
    const sid = await withSession(request, "user@company.com", "Продавец Confi");
    const cookie = { cookie: `confi_session=${sid}` };
    const cfg = await request.put("/api/configs/cfg-seller?userId=usr-seller", {
      ...cookie,
      data: { name: "X", source: "custom", parts: [] },
    });
    expect(cfg.status()).toBe(403);
    const order = await request.put("/api/orders/ord-seller?userId=usr-seller", {
      ...cookie,
      data: { status: "new", address: "A", userName: "Продавец Confi", items: [] },
    });
    expect(order.status()).toBe(403);
    const review = await request.put("/api/reviews/rev-seller", {
      ...cookie,
      data: { entityId: "ready-office", author: "Продавец Confi", rating: 5, text: "ок" },
    });
    expect(review.status()).toBe(403);
  });

  test("admin profile has 'Администрирование пользователей' tab", async ({ page, request }) => {
    await loginByEmail(page, request, "avgordeev@alfabank.ru", "Администратор");
    await page.goto("/profile");
    await expect(page.getByRole("link", { name: "Администрирование пользователей" })).toBeVisible();
    await page.getByRole("link", { name: "Администрирование пользователей" }).click();
    await expect(page).toHaveURL(/\/profile\/admin-users/);
    await expect(page.getByRole("heading", { name: "Администрирование" })).toBeVisible();
  });

  test("seller profile has 'Бренды' tab and shows Confi with description", async ({ page, request }) => {
    await loginByEmail(page, request, "user@company.com", "Продавец Confi");
    await page.goto("/profile");
    await expect(page.getByRole("link", { name: "Бренды" })).toBeVisible();
    await page.getByRole("link", { name: "Бренды" }).click();
    await expect(page).toHaveURL(/\/profile\/brands/);
    await expect(page.getByText("Confi", { exact: true })).toBeVisible();
    await expect(page.getByText("Собственные сборки Confi")).toBeVisible();
  });

  test("seller can add, edit and delete a brand", async ({ page, request }) => {
    await loginByEmail(page, request, "user@company.com", "Продавец Confi");
    await page.goto("/profile/brands");
    await expect(page.getByRole("heading", { name: "Бренды продавца" })).toBeVisible();

    // Add
    await page.getByRole("button", { name: "Добавить бренд" }).click();
    await page.getByLabel("Название бренда").fill("ASUS");
    await page.getByLabel("Описание бренда").fill("Компоненты ASUS");
    await page.getByRole("button", { name: "Добавить" }).click();
    const asusCard = page.locator("div").filter({ hasText: "ASUS" }).filter({ has: page.getByRole("button", { name: "Редактировать" }) }).last();
    await expect(asusCard).toBeVisible();

    // Edit (change description + rename)
    await asusCard.getByRole("button", { name: "Редактировать" }).click();
    await page.getByLabel("Название бренда").fill("ASUS ROG");
    await page.getByLabel("Описание бренда").fill("Игровые компоненты");
    await page.getByRole("button", { name: "Сохранить" }).click();
    const rogCard = page.locator("div").filter({ hasText: "ASUS ROG" }).filter({ has: page.getByRole("button", { name: "Удалить" }) }).last();
    await expect(rogCard).toBeVisible();

    // Delete
    await rogCard.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("ASUS ROG")).toHaveCount(0);
  });
});

test.describe("regression: header settings", () => {
  test("authenticated customer sees settings gear with theme + notifications", async ({ page, request }) => {
    await loginByEmail(page, request, "gear@example.com", "НастройщикГир");
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Настройки" })).toBeVisible();
    await page.getByRole("button", { name: "Настройки" }).click();
    await expect(page.getByLabel("Тема оформления")).toBeVisible();
    await expect(page.getByLabel("Уведомления")).toBeVisible();
  });

  test("guest has no settings gear", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Настройки" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Войти" })).toBeVisible();
    // Sun/Moon quick toggle remains.
    await expect(page.getByRole("button", { name: /Включить (светлую|тёмную) тему/ })).toBeVisible();
  });
});