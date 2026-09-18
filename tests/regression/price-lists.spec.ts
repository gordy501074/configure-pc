// @group regression
// Seller price-list flows: CRUD + activation, multi-select "Add components from
// the dictionary", price projection into the catalog/configurator, unavailability
// when a part is missing/zero-priced, and the -5% "price may be stale" badge in
// the buyer's profile (snapshot vs current for custom/auto; live prices for ready).
//
// NOTE: all tests share one SQLite DB. Tests that mutate the ConfiГУРА price list
// restore it to the seeded default afterwards so later tests (e.g. ready-filters)
// always see the canonical prices.

import { test, expect } from "@playwright/test";
import type { Page, APIRequestContext } from "@playwright/test";
import { APP_BASE, TEST_DB_PATH } from "../helpers/testDb";
import Database from "better-sqlite3";
import { components } from "../../src/data/mock.ts";

const SELLER_EMAIL = "user@company.com";
const SELLER_NAME = "Продавец Confi";
const SELLER_ID = "usr-seller";
const MAIN_LIST = "pl-main";

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

async function sellerSession(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/session", {
    data: { email: SELLER_EMAIL, name: SELLER_NAME },
  });
  const { sessionId } = await res.json();
  return sessionId as string;
}

/** Rebuild the seeded ConfiГУРА "Основной" list with all catalog parts at mock prices, active. */
function restoreMainList(): void {
  const db = new Database(TEST_DB_PATH);
  db.pragma("foreign_keys = ON");
  const tx = db.transaction(() => {
    // compact: ensure "Основной" active and every mock part at its price.
    db.prepare(
      `INSERT INTO price_list (price_list_id, seller_id, name, is_active)
       VALUES ('pl-main', 'usr-seller', 'Основной', 1)
       ON CONFLICT(price_list_id) DO UPDATE SET is_active=1`,
    ).run();
    db.prepare(
      `UPDATE price_list SET is_active=0 WHERE seller_id='usr-seller' AND price_list_id<>'pl-main'`,
    ).run();
    db.prepare(`DELETE FROM price_list_item WHERE price_list_id='pl-main'`).run();
    const ins = db.prepare(
      `INSERT INTO price_list_item (price_list_id, part_id, price_kopecks)
       VALUES ('pl-main', ?, ?)`,
    );
    for (const cat of Object.keys(components)) {
      for (const p of (components as Record<string, unknown[]>)[cat] ?? []) {
        const priceRub = Number((p as { price?: unknown }).price) || 0;
        ins.run((p as { id: string }).id, Math.round(priceRub * 100));
      }
    }
  });
  tx();
  db.close();
}

test.afterEach(() => {
  // Ensure the canonical list is active for whatever test runs next.
  restoreMainList();
});

test.describe("regression: seller price lists", () => {
  test("seller can create, rename, activate and delete a price list", async ({
    page,
    request,
  }) => {
    await login(page, request, SELLER_EMAIL, SELLER_NAME);
    await page.goto("/profile/price-lists");
    await expect(
      page.getByRole("heading", { name: "Прайс-листы" }),
    ).toBeVisible();

    // Seeded ConfiГУРА "Основной" is active by default.
    await expect(page.getByRole("button", { name: "Основной" })).toBeVisible();
    await expect(page.getByText("Активный")).toBeVisible();

    // Create a second list (not active).
    await page.getByRole("button", { name: "Создать прайс-лист" }).click();
    await page.getByLabel("Название").fill("Промо");
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(page.getByRole("button", { name: "Промо" })).toBeVisible();

    // Activate "Промо" -> "Основной" is no longer active.
    const promoCard = page
      .getByRole("button", { name: "Промо" })
      .locator("xpath=ancestor::*[contains(@class,'p-4')][1]");
    await promoCard.getByRole("button", { name: "Активировать" }).click();
    await expect(promoCard.getByText("Активный")).toBeVisible();

    // Rename it.
    await promoCard.getByRole("button", { name: "Переименовать" }).click();
    await page.getByLabel("Название").fill("Промо 2");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByRole("button", { name: "Промо 2" })).toBeVisible();

    // Delete it -> "Основной" becomes active again (only remaining).
    const promo2Card = page
      .getByRole("button", { name: "Промо 2" })
      .locator("xpath=ancestor::*[contains(@class,'p-4')][1]");
    await promo2Card.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByRole("button", { name: "Промо 2" })).toHaveCount(0);
    const mainCard = page
      .getByRole("button", { name: "Основной" })
      .locator("xpath=ancestor::*[contains(@class,'p-4')][1]");
    await expect(mainCard.getByText("Активный")).toBeVisible();
  });

  test("multi-select 'add all' populates a list; catalog projects prices", async ({
    page,
    request,
  }) => {
    const cookie = await sellerSession(request);

    // Start clean: delete every item from "Основной", then add all via the API.
    const lists = await request.get(`/api/seller/${SELLER_ID}/price-lists`, {
      headers: { cookie: `confi_session=${cookie}` },
    });
    const main = (await lists.json()).find(
      (l: { id: string }) => l.id === MAIN_LIST,
    );
    expect(main).toBeTruthy();
    const mainId = (main as { id: string }).id;
    for (const it of (main as { items: { partId: string }[] }).items) {
      await request.delete(
        `/api/seller/${SELLER_ID}/price-lists/${mainId}/items/${it.partId}`,
        { headers: { cookie: `confi_session=${cookie}` } },
      );
    }

    // Missing list should now contain the full catalog (38 parts).
    const missing = await request.get(
      `/api/seller/${SELLER_ID}/price-lists/${mainId}/items/missing`,
      { headers: { cookie: `confi_session=${cookie}` } },
    );
    const missingItems = (await missing.json()) as unknown[];
    expect(missingItems.length).toBeGreaterThan(0);

    // Multi-select in the UI: open list, open the dialog, "add all".
    await login(page, request, SELLER_EMAIL, SELLER_NAME);
    await page.goto("/profile/price-lists");
    await page.getByRole("button", { name: "Основной" }).click();
    await page
      .getByRole("button", { name: "Добавить компоненты из справочника" })
      .click();
    await page.getByRole("checkbox", { name: "Добавить все" }).check();
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    await expect(page.getByText("Позиций: 38")).toBeVisible();

    // Newly added items carry price 0 (= unavailable for ordering) per plan.
    const zeroPrice = await request.get(
      `/api/parts?category=cpu&sellerId=${SELLER_ID}`,
    );
    const zeroList = (await zeroPrice.json()) as {
      id: string;
      price?: number;
      available?: boolean;
    }[];
    expect(zeroList.length).toBeGreaterThan(0);
    for (const p of zeroList) {
      expect(p.available).toBe(false);
      expect(p.price).toBe(0);
    }

    // Set a real price on one part; the catalog then projects it and the part
    // becomes orderable under this seller.
    await request.put(
      `/api/seller/${SELLER_ID}/price-lists/${mainId}/items/cpu-r5-5600`,
      {
        headers: { cookie: `confi_session=${cookie}` },
        data: { price: 12000 },
      },
    );
    const priced = await request.get(
      `/api/parts?category=cpu&sellerId=${SELLER_ID}`,
    );
    const pricedList = (await priced.json()) as {
      id: string;
      price?: number;
      available?: boolean;
    }[];
    const cpu5600 = pricedList.find((p) => p.id === "cpu-r5-5600");
    expect(cpu5600).toBeTruthy();
    expect(cpu5600!.price).toBe(12000);
    expect(cpu5600!.available).toBe(true);
  });

  test("missing/zero-priced part is unavailable for ordering", async ({
    request,
  }) => {
    const cookie = await sellerSession(request);
    const lists = await (await request.get(
      `/api/seller/${SELLER_ID}/price-lists`,
      { headers: { cookie: `confi_session=${cookie}` } },
    )).json();
    const main = (lists as { id: string }[]).find((l) => l.id === MAIN_LIST);

    // Set one part's price to 0 -> it becomes unavailable via the catalog.
    await request.put(
      `/api/seller/${SELLER_ID}/price-lists/${(main as { id: string }).id}/items/gpu-rtx-4070-super`,
      {
        headers: { cookie: `confi_session=${cookie}` },
        data: { price: 0 },
      },
    );
    const parts = await (await request.get(
      `/api/parts?category=gpu&sellerId=${SELLER_ID}`,
    )).json() as { id: string; available?: boolean; price?: number }[];
    const miss = parts.find((p) => p.id === "gpu-rtx-4070-super");
    expect(miss).toBeTruthy();
    expect(miss!.available).toBe(false);
    expect(miss!.price).toBe(0);
  });

  test(">5% price change flags 'price may be stale' in a custom config", async ({
    page,
    request,
  }) => {
    const cookie = await sellerSession(request);
    const lists = await (await request.get(
      `/api/seller/${SELLER_ID}/price-lists`,
      { headers: { cookie: `confi_session=${cookie}` } },
    )).json();
    const main = (lists as { id: string }[])[0];

    const cpu = "cpu-r5-5600";
    const partsRes = await request.get(
      `/api/parts?category=cpu&sellerId=${SELLER_ID}`,
    );
    const cpuList = (await partsRes.json()) as { id: string; price: number }[];
    const cpuPrice = cpuList.find((p) => p.id === cpu)!.price;

    // Raise the price >5% for the current list.
    await request.put(
      `/api/seller/${SELLER_ID}/price-lists/${main.id}/items/${cpu}`,
      {
        headers: { cookie: `confi_session=${cookie}` },
        data: { price: Math.round(cpuPrice * 1.2 * 100) / 100 },
      },
    );

    // Customer saves a minimal custom config with a snapshot at the OLD price.
    const cust = await login(page, request, "stale-cust@example.com", "Stale клиент");
    const saved = await request.put(
      `/api/configs/cfg-stale?userId=${encodeURIComponent(cust.id)}`,
      {
        headers: { cookie: `confi_session=${cust.sessionId}` },
        data: {
          name: "Сборка со старой ценой",
          source: "custom",
          seller_id: SELLER_ID,
          parts: [{ category: "cpu", part_id: cpu, price: cpuPrice }],
        },
      },
    );
    expect(saved.ok()).toBeTruthy();

    // The saved config exposes snapshot vs current; server comparison is stale.
    const cfg = await (await request.get(
      `/api/configs/cfg-stale?userId=${encodeURIComponent(cust.id)}`,
      { headers: { cookie: `confi_session=${cust.sessionId}` } },
    )).json() as { parts: { price?: number; currentPrice?: number }[] };
    const part = cfg.parts[0];
    expect(part.price).toBe(cpuPrice);
    expect(part.currentPrice).toBeGreaterThan(part.price!);

    // UI shows the badge on the component and on the whole build.
    await page.goto("/profile");
    await expect(page.getByText("Цена может быть неактуальной")).toHaveCount(2);
  });

  test("ready config in profile shows live (re-priced) prices", async ({
    page,
    request,
  }) => {
    const cust = await login(page, request, "ready-live@example.com", "Ready клиент");
    const saved = await request.put(
      `/api/configs/cfg-ready-live?userId=${encodeURIComponent(cust.id)}`,
      {
        headers: { cookie: `confi_session=${cust.sessionId}` },
        data: {
          name: "Готовая сборка",
          source: "ready",
          seller_id: SELLER_ID,
          parts: [
            { category: "cpu", part_id: "cpu-r5-5600" },
            { category: "gpu", part_id: "gpu-rx-7600" },
          ],
        },
      },
    );
    expect(saved.ok()).toBeTruthy();

    await page.goto("/profile");
    await expect(page.getByText("Готовая сборка")).toBeVisible();
    // Ready sources are never flagged stale (live prices).
    await expect(page.getByText("Цена может быть неактуальной")).toHaveCount(0);
  });
});