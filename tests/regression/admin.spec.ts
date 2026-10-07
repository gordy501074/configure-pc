// @group regression
// Admin: role-gated screen, user list, create/delete/role-change.

import { test, expect } from "@playwright/test";
import { APP_BASE } from "../helpers/testDb";

async function adminSession(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/session", {
    data: { email: "avgordeev@alfabank.ru", name: "Администратор" },
  });
  expect(res.ok()).toBeTruthy();
  const { sessionId } = await res.json();
  await page.context().addCookies([
    { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
  ]);
}

test.describe("regression: admin", () => {
  test("non-admin is redirected away from /admin", async ({ page, request }) => {
    const res = await request.post("/api/session", {
      data: { email: "seller@example.com", name: "Продавец" },
    });
    expect(res.ok()).toBeTruthy();
    const { sessionId } = await res.json();
    await page.context().addCookies([
      { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
    ]);
    await page.goto("/admin");
    // RequireRole redirects non-admin to "/".
    await expect(page).toHaveURL(/\/$/);
  });

  test("admin can open /admin and manage users", async ({ page, request }) => {
    await adminSession(page, request);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: "Администрирование" })).toBeVisible();

    const row = page.getByRole("cell", { name: "Администратор" });
    await expect(row).toBeVisible();
  });

  test("admin sees the fake-door CTR block", async ({ page, request }) => {
    await adminSession(page, request);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "CTR по fake door" })).toBeVisible();
    // The profile tab is renamed to «Администрирование» (no longer «…пользователей»).
    await page.goto("/profile");
    const profileNav = page.getByRole("navigation", { name: "Разделы профиля" });
    await expect(profileNav.getByRole("link", { name: "Администрирование" })).toBeVisible();
    await expect(
      profileNav.getByRole("link", { name: "Администрирование пользователей" }),
    ).toHaveCount(0);
  });

  test("admin creates a user that appears in the table", async ({ page, request }) => {
    await adminSession(page, request);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Добавить пользователя" }).click();
    await page.getByLabel("Имя").fill("Тестовый Клиент");
    await page.getByLabel("E-mail").fill("test-customer@example.com");
    await page.getByRole("button", { name: "Создать" }).click();
    // The table should show the new user.
    await expect(page.getByRole("cell", { name: "Тестовый Клиент" })).toBeVisible();
  });

  test("admin create user fails on duplicate email", async ({ page, request }) => {
    await adminSession(page, request);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Добавить пользователя" }).click();
    await page.getByLabel("Имя").fill("Лжеадмин");
    // Seeded admin email already exists.
    await page.getByLabel("E-mail").fill("avgordeev@alfabank.ru");
    await page.getByRole("button", { name: "Создать" }).click();
    await expect(page.getByText("Пользователь с таким e-mail уже существует")).toBeVisible();
  });

  test("admin cannot delete a seller with attached data", async ({ page, request }) => {
    await adminSession(page, request);
    await page.goto("/admin");
    const row = page.getByRole("row", { name: /Продавец Confi/ });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Удалить" }).click();
    // The toast surfaces the detailed reason and the row stays.
    await expect(page.getByText(/Нельзя удалить пользователя/)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Продавец Confi" })).toHaveCount(1);
  });

  test("admin can delete a non-self user", async ({ page, request }) => {
    // Pre-create a disposable user via API.
    const sess = await request.post("/api/session", { data: { email: "avgordeev@alfabank.ru", name: "Администратор" } });
    const { sessionId } = await sess.json();
    await request.post("/api/users", {
      headers: { cookie: `confi_session=${sessionId}` },
      data: { name: "Удаляемый", email: "delete-me@example.com", role: "customer" },
    });
    await adminSession(page, request);
    await page.goto("/admin");
    const row = page.getByRole("row", { name: /Удаляемый/ });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByRole("cell", { name: "Удаляемый" })).toHaveCount(0);
  });
});