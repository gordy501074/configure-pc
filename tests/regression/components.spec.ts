// @group regression
// Component dictionary (vendor) management and unavailability flow:
// seller/admin create component -> appears in configurator; deactivation marks
// it unavailable in saved configs; admin can re-initialize the catalog.

import { test, expect } from "@playwright/test";
import type { Page, APIRequestContext } from "@playwright/test";
import { APP_BASE } from "../helpers/testDb";

async function login(
  page: Page,
  request: APIRequestContext,
  email: string,
  name: string,
): Promise<{ id: string; sessionId: string }> {
  const res = await request.post("/api/session", { data: { email, name } });
  expect(res.ok()).toBeTruthy();
  const { user, sessionId } = await res.json();
  await page.context().addCookies([
    { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
  ]);
  return { id: (user as { id: string }).id, sessionId: sessionId as string };
}

test.describe("regression: components & vendors", () => {
  test("seller can create a component that appears in the configurator", async ({ page, request }) => {
    await login(page, request, "user@company.com", "Продавец Confi");
    await page.goto("/profile/components");
    await expect(page.getByRole("heading", { name: "Справочник компонентов" })).toBeVisible();

    await page.getByRole("button", { name: "Создать компонент" }).click();
    await page.getByLabel("Модель / линейка").fill("Demo CPU 9000");
    await page.getByLabel("Вендор (торговая марка)").fill("DemoBrand");
    await page.getByLabel("Цена, ₽").fill("42000");
    await page.getByLabel("Сокет").fill("LGA1700");
    await page.getByRole("button", { name: "Добавить" }).click();

    // Name is composed from vendor + model.
    await expect(page.getByText("DemoBrand Demo CPU 9000")).toBeVisible();
  });

  test("customer cannot create a component (403)", async ({ request }) => {
    const res = await request.post("/api/session", { data: { email: "customer@example.com", name: "Клиент" } });
    const { sessionId } = await res.json();
    const create = await request.post("/api/components", {
      headers: { cookie: `confi_session=${sessionId}` },
      data: { category: "cpu", name: "X", brand: "X", vendor: "X", price: 1, tdp: 10 },
    });
    expect(create.status()).toBe(403);
  });

  test("deactivated component no longer selectable and saved config shows unavailable", async ({ page, request }) => {
    // Get a seller session (API only).
    const seller = await request.post("/api/session", { data: { email: "user@company.com", name: "Продавец Confi" } });
    const sellerInfo = await seller.json();
    const sellerCookie = `confi_session=${sellerInfo.sessionId}`;
    await login(page, request, "user@company.com", "Продавец Confi");

    const deact = await request.post("/api/components/gpu-rx-7600/deactivate", {
      headers: { cookie: sellerCookie },
    });
    expect(deact.ok()).toBeTruthy();

    // A customer with a saved config that included the deactivated part sees it as unavailable.
    const cust = await login(page, request, "cfg2@example.com", "Владелец2");
    const saved = await request.put(`/api/configs/cfg-unavail?userId=${encodeURIComponent(cust.id)}`, {
      headers: { cookie: `confi_session=${cust.sessionId}` },
      data: {
        name: "Сборка с недоступным",
        source: "custom",
        parts: [
          { category: "cpu", part_id: "cpu-r5-5600" },
          { category: "gpu", part_id: "gpu-rx-7600" },
        ],
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto("/profile");
    await expect(page.getByText("Компонент более недоступен для заказа")).toBeVisible();
  });

  test("admin can re-initialize the catalog", async ({ page, request }) => {
    const admin = await request.post("/api/session", { data: { email: "avgordeev@alfabank.ru", name: "Администратор" } });
    const adminInfo = await admin.json();
    const adminCookie = `confi_session=${adminInfo.sessionId}`;
    const init = await request.post("/api/catalog/initialize", {
      headers: { cookie: adminCookie },
    });
    expect(init.ok()).toBeTruthy();
    const body = await init.json();
    expect(typeof body.inserted).toBe("number");
    // Catalog still serves parts afterwards.
    const parts = await request.get("/api/parts");
    expect(parts.ok()).toBeTruthy();
    const list = await parts.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});