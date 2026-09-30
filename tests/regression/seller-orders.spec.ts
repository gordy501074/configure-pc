// @group regression
// Customer-orders section for sellers and the admin installment workflow:
// the seller sees only orders containing their lines and moves them through the
// lifecycle; the admin approves/rejects Alpha-Bank installment requests; a
// customer whose installment was rejected may buy at their own expense.
//
// The suite shares one SQLite DB with other specs, so every assertion is scoped
// to a card identified by a unique item name created by this spec.

import { test, expect } from "@playwright/test";
import type { Locator, Page, APIRequestContext } from "@playwright/test";
import { APP_BASE, TEST_DB_PATH } from "../helpers/testDb";
import Database from "better-sqlite3";

const SELLER_EMAIL = "user@company.com";
const SELLER_NAME = "Продавец Confi";
const ADMIN_EMAIL = "avgordeev@alfabank.ru";
const ADMIN_NAME = "Администратор";

const ORDER_IDS = ["ord-so-seller", "ord-so-alpha", "ord-so-alpha2", "ord-so-buyown"];

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

function cleanupDb(): void {
  const db = new Database(TEST_DB_PATH);
  db.pragma("foreign_keys = ON");
  const placeholders = ORDER_IDS.map(() => "?").join(",");
  db.prepare(`DELETE FROM order_item WHERE order_id IN (${placeholders})`).run(...ORDER_IDS);
  db.prepare(`DELETE FROM order_header WHERE order_id IN (${placeholders})`).run(...ORDER_IDS);
  db.close();
}

test.afterEach(() => {
  cleanupDb();
});

async function createOrder(
  request: APIRequestContext,
  sessionId: string,
  userId: string,
  id: string,
  status: string,
  itemName: string,
): Promise<void> {
  const res = await request.put(`/api/orders/${id}?userId=${encodeURIComponent(userId)}`, {
    headers: { cookie: `confi_session=${sessionId}` },
    data: {
      status,
      address: "Москва",
      userName: "SO Клиент",
      items: [{ kind: "ready", refId: "ready-gaming", name: itemName, price: 139900, count: 1 }],
    },
  });
  expect(res.ok()).toBeTruthy();
}

/** The order card containing the uniquely-named item created by this spec. */
function cardFor(page: Page, itemName: string): Locator {
  return page.locator('[data-slot="card"]').filter({ hasText: itemName });
}

test.describe("regression: seller customer orders", () => {
  test("seller sees the tab, their order, and moves it through the lifecycle", async ({
    page,
    request,
  }) => {
    const cust = await login(page, request, "so-seller-cust@example.com", "SO Клиент");
    await createOrder(request, cust.sessionId, cust.id, "ord-so-seller", "new", "SO Lifecycle");

    await login(page, request, SELLER_EMAIL, SELLER_NAME);
    await page.goto("/profile/customer-orders");
    await expect(page.getByRole("heading", { name: "Заказы покупателей" })).toBeVisible();

    const card = cardFor(page, "SO Lifecycle");
    await expect(card).toHaveCount(1);

    // new -> confirmed ("Передать в сборку")
    await card.getByRole("button", { name: "Передать в сборку" }).click();
    await expect(card.getByText("Подтверждён")).toBeVisible();
    // confirmed -> delivery
    await card.getByRole("button", { name: "В доставку" }).click();
    await expect(card.getByText("В доставке")).toBeVisible();
    // delivery -> done
    await card.getByRole("button", { name: "Завершить" }).click();
    await expect(card.getByText("Выполнен")).toBeVisible();
  });

  test("an alpha order is visible to the seller without status actions", async ({
    page,
    request,
  }) => {
    const cust = await login(page, request, "so-alpha-cust@example.com", "SO Клиент");
    await createOrder(request, cust.sessionId, cust.id, "ord-so-alpha", "alpha", "SO AlphaView");

    await login(page, request, SELLER_EMAIL, SELLER_NAME);
    await page.goto("/profile/customer-orders");

    const card = cardFor(page, "SO AlphaView");
    await expect(card).toHaveCount(1);
    await expect(card.getByText("На рассмотрении в Альфа-Банке")).toBeVisible();
    await expect(card.getByRole("button", { name: "Передать в сборку" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Аннулировать" })).toHaveCount(0);
  });

  test("admin approves and rejects installment requests", async ({ page, request }) => {
    const cust = await login(page, request, "so-admin-cust@example.com", "SO Клиент");
    await createOrder(request, cust.sessionId, cust.id, "ord-so-alpha", "alpha", "SO Alpha A");
    await createOrder(request, cust.sessionId, cust.id, "ord-so-alpha2", "alpha", "SO Alpha B");

    await login(page, request, ADMIN_EMAIL, ADMIN_NAME);
    await page.goto("/profile/customer-orders");
    await page.getByRole("tab", { name: "Заявки на рассрочку" }).click();

    const approveCard = cardFor(page, "SO Alpha A");
    await expect(approveCard).toHaveCount(1);
    await approveCard.getByRole("button", { name: "Одобрить" }).click();
    await expect(cardFor(page, "SO Alpha A")).toHaveCount(0);

    const rejectCard = cardFor(page, "SO Alpha B");
    await expect(rejectCard).toHaveCount(1);
    await rejectCard.getByRole("button", { name: "Отклонить" }).click();
    await expect(cardFor(page, "SO Alpha B")).toHaveCount(0);

    // The rejection is reflected for the customer.
    await page.context().clearCookies();
    await login(page, request, "so-admin-cust@example.com", "SO Клиент");
    await page.goto("/profile/orders");
    await expect(cardFor(page, "SO Alpha B").getByText("Рассрочка отклонена")).toBeVisible();
  });

  test("customer sees the rejection badge and buys at their own expense", async ({
    page,
    request,
  }) => {
    const cust = await login(page, request, "so-buyown-cust@example.com", "SO Клиент");
    await createOrder(request, cust.sessionId, cust.id, "ord-so-buyown", "alpha", "SO BuyOwn");

    const admin = await request.post("/api/session", { data: { email: ADMIN_EMAIL, name: ADMIN_NAME } });
    const adminSession = (await admin.json()) as { sessionId: string };
    await request.post("/api/admin/orders/ord-so-buyown/reject-installment", {
      headers: { cookie: `confi_session=${adminSession.sessionId}` },
    });

    await page.goto("/profile/orders");
    const card = cardFor(page, "SO BuyOwn");
    await expect(card.getByText("Рассрочка отклонена")).toBeVisible();
    await expect(card.getByText("Рассрочка недоступна")).toBeVisible();
    await card.getByRole("button", { name: "Купить за свой счёт" }).click();
    await expect(card.getByText("Подтверждён")).toBeVisible();
  });
});