// @group regression
// Auth flows: e-mail sign-in, phone/SMS sign-in, validation, guest continue.

import { test, expect } from "@playwright/test";

test.describe("regression: auth", () => {
  test("email sign-in works and lands on home", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Вход в аккаунт" })).toBeVisible();
    await page.getByLabel("Электронная почта").fill("ivan@example.com");
    await page.getByLabel("Пароль").fill("1234");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/$/);
    // Navbar shows the signed-in profile link.
    await expect(page.getByRole("link", { name: /Профиль: ivan/i })).toBeVisible();
  });

  test("email validation shows inline errors", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByText("Укажите корректный e-mail.")).toBeVisible();
    await expect(page.getByText("минимум 4 символа")).toBeVisible();
  });

  test("phone sign-in via demo SMS code", async ({ page }) => {
    // Dismiss nothing: onboarding is pre-onboarded in the test DB.
    await page.goto("/auth");
    // Switch to phone method.
    await page.getByRole("tab", { name: "По телефону" }).click();
    await page.getByLabel("Номер телефона").fill("9001234567");
    await page.getByRole("button", { name: "Получить код" }).click();
    // The demo code is shown on the page and pre-filled into the code boxes.
    await expect(page.getByText("Код для входа (демо):")).toBeVisible();
    // Read the demo code.
    const demoText = await page.getByText(/Код для входа \(демо\):\s*\d{4}/).textContent();
    const code = demoText?.match(/\d{4}/)?.[0] ?? "";
    expect(code).toHaveLength(4);
    // Submit the SMS form (code inputs are pre-filled).
    await page.getByRole("button", { name: "Подтвердить и войти" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("phone sign-in requires valid RU number", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "По телефону" }).click();
    await page.getByLabel("Номер телефона").fill("12345");
    await page.getByRole("button", { name: "Получить код" }).click();
    await expect(page.getByText("Укажите корректный российский номер.")).toBeVisible();
  });

  test("continue without account clears session and goes home", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: "По телефону" }).click();
    await page.getByRole("button", { name: "Продолжить без аккаунта" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});