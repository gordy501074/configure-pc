// @group regression
// Sales analytics section for sellers and the admin (KPI, charts, installment).
//
// The suite shares one SQLite DB with other specs, so every order it seeds is
// attributed to a dedicated throwaway seller (`usr-sa-seller2`), which makes the
// seller-scoped assertions exact. Aggregate (all-sellers) expectations are read
// from the live API response, since sibling suites also create orders.

import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import Database from "better-sqlite3";
import { APP_BASE, TEST_DB_PATH } from "../helpers/testDb";
import { formatPrice } from "../../src/lib/format";
import type { SalesAnalytics } from "../../src/types";

const ADMIN_EMAIL = "avgordeev@alfabank.ru";
const ADMIN_NAME = "Администратор";
const SELLER_ID = "usr-sa-seller2";
const SELLER_EMAIL = "sa-seller2@example.com";
const SELLER_NAME = "Второй Продавец";
const EMPTY_SELLER_ID = "usr-sa-empty";
const EMPTY_SELLER_EMAIL = "sa-empty@example.com";
const EMPTY_SELLER_NAME = "Пустой Продавец";

const ORDER_IDS = [
  "ord-sa-done",
  "ord-sa-cancel",
  "ord-sa-alpha",
  "ord-sa-approved",
  "ord-sa-buyown",
  "ord-sa-other",
];

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

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(TEST_DB_PATH);
  db.pragma("foreign_keys = ON");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Deterministic seed: a dedicated seller, a customer, and orders across statuses. */
function seedOrders(): void {
  withDb((db) => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO user_account (user_id, name, email, phone, role, company)
       VALUES (@id, @name, @email, NULL, 'seller', NULL)
       ON CONFLICT(user_id) DO NOTHING`,
    ).run({ id: SELLER_ID, name: SELLER_NAME, email: SELLER_EMAIL });
    db.prepare(
      `INSERT INTO user_account (user_id, name, email, phone, role, company)
       VALUES (@id, @name, @email, NULL, 'seller', NULL)
       ON CONFLICT(user_id) DO NOTHING`,
    ).run({ id: EMPTY_SELLER_ID, name: EMPTY_SELLER_NAME, email: EMPTY_SELLER_EMAIL });
    db.prepare(
      `INSERT INTO user_account (user_id, name, email, phone, role, company)
       VALUES ('usr-sa-cust', 'SA Клиент', 'sa-cust@example.com', NULL, 'customer', NULL)
       ON CONFLICT(user_id) DO NOTHING`,
    ).run();

    const insertHeader = db.prepare(
      `INSERT INTO order_header
         (order_id, user_id, total_kopecks, status, payment_method, installment_decision, address, user_name, created_at)
       VALUES (@id, 'usr-sa-cust', @total, @status, @method, @decision, 'Москва', 'SA Клиент', @created_at)
       ON CONFLICT(order_id) DO UPDATE SET
         total_kopecks=excluded.total_kopecks, status=excluded.status,
         payment_method=excluded.payment_method, installment_decision=excluded.installment_decision,
         created_at=excluded.created_at`,
    );
    const insertItem = db.prepare(
      `INSERT INTO order_item (order_id, position, kind, ref_id, name, price_kopecks, count, seller_id, category)
       VALUES (@order_id, @position, @kind, @ref_id, @name, @price, @count, @seller_id, @category)
       ON CONFLICT(order_id, position) DO UPDATE SET
         name=excluded.name, price_kopecks=excluded.price_kopecks, count=excluded.count,
         seller_id=excluded.seller_id, category=excluded.category`,
    );

    const orders = [
      // done, full -> revenue 2000 ₽ (2 × 1000)
      { id: "ord-sa-done", total: 200000, status: "done", method: "full", decision: null, price: 100000, count: 2, seller: SELLER_ID },
      // cancelled, full -> excluded from revenue
      { id: "ord-sa-cancel", total: 100000, status: "cancelled", method: "full", decision: null, price: 100000, count: 1, seller: SELLER_ID },
      // alpha, installment pending
      { id: "ord-sa-alpha", total: 100000, status: "alpha", method: "installment", decision: "pending", price: 100000, count: 1, seller: SELLER_ID },
      // confirmed, installment approved -> 2000 ₽
      { id: "ord-sa-approved", total: 200000, status: "confirmed", method: "installment", decision: "approved", price: 200000, count: 1, seller: SELLER_ID },
      // confirmed, bought at own expense (full + rejected) -> 1000 ₽
      { id: "ord-sa-buyown", total: 100000, status: "confirmed", method: "full", decision: "rejected", price: 100000, count: 1, seller: SELLER_ID },
      // another seller's line -> excluded from the dedicated seller's view
      { id: "ord-sa-other", total: 300000, status: "done", method: "full", decision: null, price: 300000, count: 1, seller: "usr-admin" },
    ];

    db.transaction(() => {
      for (const o of orders) {
        insertHeader.run({
          id: o.id, total: o.total, status: o.status,
          method: o.method, decision: o.decision, created_at: now,
        });
        insertItem.run({
          order_id: o.id, position: 0, kind: "ready", ref_id: "ready-gaming",
          name: o.id, price: o.price, count: o.count, seller_id: o.seller, category: "gpu",
        });
      }
    })();
  });
}

function cleanupDb(): void {
  withDb((db) => {
    const placeholders = ORDER_IDS.map(() => "?").join(",");
    db.prepare(`DELETE FROM order_item WHERE order_id IN (${placeholders})`).run(...ORDER_IDS);
    db.prepare(`DELETE FROM order_header WHERE order_id IN (${placeholders})`).run(...ORDER_IDS);
    db.prepare(`DELETE FROM user_account WHERE user_id IN (?, ?, 'usr-sa-cust')`).run(SELLER_ID, EMPTY_SELLER_ID);
  });
}

test.afterEach(() => {
  cleanupDb();
});

async function fetchAdminAnalytics(
  request: APIRequestContext,
  sessionId: string,
): Promise<SalesAnalytics> {
  const res = await request.get("/api/admin/analytics?period=30d", {
    headers: { cookie: `confi_session=${sessionId}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as SalesAnalytics;
}

test.describe("regression: sales analytics", () => {
  test("seller sees only their own lines and the KPI excludes cancelled orders", async ({
    page,
    request,
  }) => {
    seedOrders();
    await login(page, request, SELLER_EMAIL, SELLER_NAME);
    await page.goto("/profile/sales-analytics");
    await expect(page.getByRole("heading", { name: "Аналитика продаж" })).toBeVisible();

    // Revenue = done 2000 + alpha 1000 + approved 2000 + buyown 1000 = 6000 ₽
    // (own lines only; cancelled excluded).
    const revenueCard = page.locator('[data-slot="card"][aria-label="Выручка"]');
    await expect(revenueCard.getByText(formatPrice(6000))).toBeVisible();
    // 4 non-cancelled orders, 1 cancelled (20%).
    await expect(
      page.locator('[data-slot="card"][aria-label="Заказы"]').getByText("4", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("20%")).toBeVisible();

    // Seller never sees the admin-only installment tool.
    await expect(page.getByText("Рассрочка от Альфа-Банка")).toHaveCount(0);
  });

  test("admin aggregate matches the API and the selector scopes to one seller", async ({
    page,
    request,
  }) => {
    seedOrders();
    const admin = await login(page, request, ADMIN_EMAIL, ADMIN_NAME);
    const api = await fetchAdminAnalytics(request, admin.sessionId);

    await page.goto("/profile/sales-analytics");
    const revenueCard = page.locator('[data-slot="card"][aria-label="Выручка"]');
    await expect(revenueCard.getByText(formatPrice(api.kpi.revenue))).toBeVisible();
    await expect(page.getByText("Рассрочка от Альфа-Банка")).toBeVisible();

    // Switch to the dedicated seller -> exact 6000 ₽ from this spec's orders.
    await page.getByRole("combobox", { name: "Продавец" }).click();
    await page.getByRole("option", { name: new RegExp(SELLER_NAME) }).click();
    await expect(revenueCard.getByText(formatPrice(6000))).toBeVisible();
    // Per-seller view has no installment tool.
    await expect(page.getByText("Рассрочка от Альфа-Банка")).toHaveCount(0);
  });

  test("changing the period re-requests the analytics endpoint", async ({ page, request }) => {
    seedOrders();
    await login(page, request, ADMIN_EMAIL, ADMIN_NAME);
    await page.goto("/profile/sales-analytics");
    await expect(page.getByRole("heading", { name: "Аналитика продаж" })).toBeVisible();

    const req = page.waitForRequest((r) => r.url().includes("/api/admin/analytics"));
    await page.getByRole("tab", { name: "7 дней" }).click();
    expect((await req).url()).toContain("period=7d");
  });

  test("empty period shows the empty state", async ({ page, request }) => {
    seedOrders();
    // A seller with no orders sees the empty state.
    await login(page, request, EMPTY_SELLER_EMAIL, EMPTY_SELLER_NAME);
    await page.goto("/profile/sales-analytics");
    await expect(
      page.getByRole("heading", { name: "Недостаточно данных за выбранный период" }),
    ).toBeVisible();
  });

  test("admin installment shares match the API and exclude buy-own from installment", async ({
    page,
    request,
  }) => {
    seedOrders();
    const admin = await login(page, request, ADMIN_EMAIL, ADMIN_NAME);
    const api = await fetchAdminAnalytics(request, admin.sessionId);
    expect(api.installment).toBeTruthy();
    const inst = api.installment!;

    await page.goto("/profile/sales-analytics");
    const block = page.locator('[aria-label="Рассрочка от Альфа-Банка"]');
    await expect(block).toBeVisible();
    await expect(
      block.locator('[data-slot="card"][aria-label="Одобрено"]').getByText(String(inst.approved), { exact: true }),
    ).toBeVisible();
    await expect(
      block.locator('[data-slot="card"][aria-label="Отклонено"]').getByText(String(inst.rejected), { exact: true }),
    ).toBeVisible();
    await expect(
      block.locator('[data-slot="card"][aria-label="На рассмотрении"]').getByText(String(inst.pending), { exact: true }),
    ).toBeVisible();
    await expect(
      block
        .locator('[data-slot="card"][aria-label="Доля рассрочки"]')
        .getByText(`${Math.round(inst.installmentShare * 100)}%`, { exact: true }),
    ).toBeVisible();

    // The spec's own rejected+full (buy-own) order is never counted as installment.
    expect(inst.withInstallment).toBeGreaterThanOrEqual(1);
  });
});