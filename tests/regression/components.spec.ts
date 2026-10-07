// @group regression
// Component dictionary (vendor) management and unavailability flow:
// seller/admin create component -> appears in configurator; deactivation marks
// it unavailable in saved configs; admin can re-initialize the catalog.

import { test, expect } from "@playwright/test";
import type { Page, APIRequestContext } from "@playwright/test";
import { APP_BASE } from "../helpers/testDb";

// 1x1 transparent PNG (valid magic bytes).
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

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

  test("seller uploads an image, attaches it to a component, sees it in the configurator", async ({ page, request }) => {
    const seller = await request.post("/api/session", { data: { email: "user@company.com", name: "Продавец Confi" } });
    const { sessionId } = await seller.json();
    const cookie = `confi_session=${sessionId}`;
    await page.context().addCookies([
      { name: "confi_session", value: sessionId, url: APP_BASE.replace(/\/$/, "") },
    ]);

    // Upload via the API (seller).
    const up = await request.post("/api/uploads", { headers: { cookie }, data: { dataUrl: PNG_DATA_URL } });
    expect(up.status()).toBe(201);
    const { url } = await up.json();
    expect(url).toMatch(/^\/api\/uploads\/upload-[\w-]+\.png$/);

    // The stored file is served statically.
    const served = await request.get(url);
    expect(served.ok()).toBeTruthy();

    // Attach the image to a seeded, priced component (no new catalog entries).
    const pinned = await request.patch("/api/components/cpu-r5-5600", {
      headers: { cookie },
      data: { image: url },
    });
    expect(pinned.ok()).toBeTruthy();
    expect((await pinned.json()).image).toBe(url);

    // The image renders in the configurator: picker row + selected slot card.
    await page.goto("/config");
    await page.getByRole("button", { name: /Выбрать процессор/i }).click();
    await expect(page.locator(`img[src="${url}"]`).first()).toBeVisible();
    await page.getByRole("button", { name: /AMD Ryzen 5 5600/ }).click();
    await expect(page.locator(`img[src="${url}"]`)).toHaveCount(1);

    // Restore the seeded part so later tests are unaffected.
    await request.patch("/api/components/cpu-r5-5600", { headers: { cookie }, data: { image: "" } });
  });

  test("PATCH clears a component image", async ({ request }) => {
    const seller = await request.post("/api/session", { data: { email: "user@company.com", name: "Продавец Confi" } });
    const cookie = `confi_session=${(await seller.json()).sessionId}`;
    const up = await (await request.post("/api/uploads", { headers: { cookie }, data: { dataUrl: PNG_DATA_URL } })).json();
    await request.patch("/api/components/cpu-r5-5600", { headers: { cookie }, data: { image: up.url } });
    const cleared = await request.patch("/api/components/cpu-r5-5600", { headers: { cookie }, data: { image: "" } });
    expect(cleared.ok()).toBeTruthy();
    expect((await cleared.json()).image).toBeUndefined();
  });

  test("clearing one part keeps an upload still referenced by another part", async ({ request }) => {
    const seller = await request.post("/api/session", { data: { email: "user@company.com", name: "Продавец Confi" } });
    const cookie = `confi_session=${(await seller.json()).sessionId}`;
    const up = await (await request.post("/api/uploads", { headers: { cookie }, data: { dataUrl: PNG_DATA_URL } })).json();

    // Two seeded parts share the same upload.
    await request.patch("/api/components/cpu-r5-5600", { headers: { cookie }, data: { image: up.url } });
    await request.patch("/api/components/gpu-rx-7600", { headers: { cookie }, data: { image: up.url } });

    // Clearing one must NOT delete the shared file while the other still uses it.
    await request.patch("/api/components/cpu-r5-5600", { headers: { cookie }, data: { image: "" } });
    expect((await request.get(up.url)).ok()).toBeTruthy();

    // Clean up: detach the second reference so prune can reclaim the file.
    await request.patch("/api/components/gpu-rx-7600", { headers: { cookie }, data: { image: "" } });
    expect((await request.get(up.url)).ok()).toBe(false);
  });

  test("customer cannot upload an image (403)", async ({ request }) => {
    const res = await request.post("/api/session", { data: { email: "customer@example.com", name: "Клиент" } });
    const { sessionId } = await res.json();
    const up = await request.post("/api/uploads", {
      headers: { cookie: `confi_session=${sessionId}` },
      data: { dataUrl: PNG_DATA_URL },
    });
    expect(up.status()).toBe(403);
  });

  test("upload rejects non-images and disguised files", async ({ request }) => {
    const seller = await request.post("/api/session", { data: { email: "user@company.com", name: "Продавец Confi" } });
    const cookie = `confi_session=${(await seller.json()).sessionId}`;
    const bad = await request.post("/api/uploads", { headers: { cookie }, data: { dataUrl: "data:text/plain;base64,aGVsbG8=" } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe("invalid_file_type");

    // A PNG MIME prefix with non-PNG bytes fails the magic-byte check.
    const fake = await request.post("/api/uploads", { headers: { cookie }, data: { dataUrl: "data:image/png;base64,aGVsbG8=" } });
    expect(fake.status()).toBe(400);
    expect((await fake.json()).error).toBe("invalid_file");
  });

  test("customer cannot access AI endpoints (403)", async ({ request }) => {
    const res = await request.post("/api/session", { data: { email: "customer@example.com", name: "Клиент" } });
    const { sessionId } = await res.json();
    const cookie = `confi_session=${sessionId}`;
    for (const path of ["/api/ai/component-description", "/api/ai/component-image"]) {
      const r = await request.post(path, { headers: { cookie }, data: { name: "Ryzen 5 5600", brand: "AMD" } });
      expect(r.status()).toBe(403);
    }
  });

  test("AI endpoints return 503 without an API key and validate the body", async ({ request }) => {
    const seller = await request.post("/api/session", { data: { email: "user@company.com", name: "Продавец Confi" } });
    const cookie = `confi_session=${(await seller.json()).sessionId}`;

    // The test environment has no OPENROUTER_API_KEY.
    const desc = await request.post("/api/ai/component-description", {
      headers: { cookie },
      data: { name: "Ryzen 5 5600", brand: "AMD" },
    });
    expect(desc.status()).toBe(503);
    expect((await desc.json()).error).toBe("ai_not_configured");

    const img = await request.post("/api/ai/component-image", {
      headers: { cookie },
      data: { name: "Ryzen 5 5600", brand: "AMD" },
    });
    expect(img.status()).toBe(503);
    expect((await img.json()).error).toBe("ai_not_configured");

    // Missing name/brand is rejected before the config check.
    const bad = await request.post("/api/ai/component-description", {
      headers: { cookie },
      data: {},
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe("invalid_input");
  });

  test("POST/PATCH components persists description", async ({ request }) => {
    const seller = await request.post("/api/session", { data: { email: "user@company.com", name: "Продавец Confi" } });
    const cookie = `confi_session=${(await seller.json()).sessionId}`;

    // POST: outer whitespace is trimmed; the value is returned on the created part.
    const created = await request.post("/api/components", {
      headers: { cookie },
      data: {
        category: "cpu",
        brand: "Desc CPU 7000",
        vendor: "DescBrand",
        price: 10000,
        tdp: 65,
        compat: { socket: "AM5" },
        description: "  Краткое описание компонента  ",
      },
    });
    expect(created.ok()).toBeTruthy();
    const part = await created.json();
    expect(part.description).toBe("Краткое описание компонента");

    try {
      const patched = await request.patch(`/api/components/${part.id}`, {
        headers: { cookie },
        data: { description: "Обновлённое описание" },
      });
      expect(patched.ok()).toBeTruthy();
      expect((await patched.json()).description).toBe("Обновлённое описание");

      // An empty string clears the description (null on the wire -> undefined in DTO).
      const cleared = await request.patch(`/api/components/${part.id}`, {
        headers: { cookie },
        data: { description: "" },
      });
      expect(cleared.ok()).toBeTruthy();
      expect((await cleared.json()).description).toBeUndefined();
    } finally {
      // Purge the throwaway part so it never affects catalog-count tests
      // (the "add all" dialog includes inactive parts, so deactivation is not enough).
      const admin = await request.post("/api/session", { data: { email: "avgordeev@alfabank.ru", name: "Администратор" } });
      const adminCookie = `confi_session=${(await admin.json()).sessionId}`;
      await request.post("/api/catalog/initialize", { headers: { cookie: adminCookie } });
    }
  });

  test("admin uploads management: list, 409 in use, prune, 403 for seller", async ({ request }) => {
    const seller = await request.post("/api/session", { data: { email: "user@company.com", name: "Продавец Confi" } });
    const sellerCookie = `confi_session=${(await seller.json()).sessionId}`;
    const admin = await request.post("/api/session", { data: { email: "avgordeev@alfabank.ru", name: "Администратор" } });
    const adminCookie = `confi_session=${(await admin.json()).sessionId}`;

    // Seller uploads two files: one referenced by a seeded part, one orphaned.
    const used = await (await request.post("/api/uploads", {
      headers: { cookie: sellerCookie },
      data: { dataUrl: PNG_DATA_URL },
    })).json();
    const orphan = await (await request.post("/api/uploads", {
      headers: { cookie: sellerCookie },
      data: { dataUrl: PNG_DATA_URL },
    })).json();

    const partId = "cpu-r5-5600";
    await request.patch(`/api/components/${partId}`, {
      headers: { cookie: sellerCookie },
      data: { image: used.url },
    });

    // Seller cannot access admin routes.
    expect((await request.get("/api/admin/uploads", { headers: { cookie: sellerCookie } })).status()).toBe(403);
    expect((await request.post("/api/admin/uploads/prune", { headers: { cookie: sellerCookie } })).status()).toBe(403);

    const list = await request.get("/api/admin/uploads", { headers: { cookie: adminCookie } });
    expect(list.ok()).toBeTruthy();
    const entries = await list.json() as { file: string; url: string; used: boolean; partId?: string }[];
    const usedEntry = entries.find((e) => e.url === used.url);
    expect(usedEntry?.used).toBe(true);
    expect(usedEntry?.partId).toBe(partId);

    // Deleting a used file is rejected.
    const usedName = used.url.split("/").pop();
    expect((await request.delete(`/api/admin/uploads/${usedName}`, { headers: { cookie: adminCookie } })).status()).toBe(409);

    // Deleting the orphan succeeds.
    const orphanName = orphan.url.split("/").pop();
    expect((await request.delete(`/api/admin/uploads/${orphanName}`, { headers: { cookie: adminCookie } })).status()).toBe(204);

    // Detach, then prune removes the now-unreferenced file and reports a count.
    await request.patch(`/api/components/${partId}`, { headers: { cookie: sellerCookie }, data: { image: "" } });
    const pruned = await request.post("/api/admin/uploads/prune", { headers: { cookie: adminCookie } });
    expect(pruned.ok()).toBeTruthy();
    expect(typeof (await pruned.json()).deleted).toBe("number");
  });
});