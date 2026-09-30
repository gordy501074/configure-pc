// @group regression
// Seller ready-build flows backed by the seller's active price list:
// create/update/archive/reactivate, computed validity, model uniqueness, and
// the buyer-facing showcase that hides invalid builds.
//
// All tests share one SQLite DB, so each test cleans up the builds it creates
// and restores part availability / the canonical "Основной" price list.

import { test, expect } from "@playwright/test";
import type { Page, APIRequestContext } from "@playwright/test";
import { APP_BASE, TEST_DB_PATH } from "../helpers/testDb";
import Database from "better-sqlite3";
import { components } from "../../src/data/mock.ts";

const SELLER_EMAIL = "user@company.com";
const SELLER_NAME = "Продавец Confi";
const SELLER_ID = "usr-seller";

/** A mutually-compatible, fully-priced composition across all 8 categories. */
const BUILD_PARTS = [
  { category: "cpu", partId: "cpu-r5-5600" },
  { category: "gpu", partId: "gpu-rx-7600" },
  { category: "motherboard", partId: "mb-b550-am4" },
  { category: "ram", partId: "ram-ddr4-16" },
  { category: "storage", partId: "ssd-1tb-nvme" },
  { category: "case", partId: "case-matx" },
  { category: "psu", partId: "psu-650" },
  { category: "cooler", partId: "cooler-air" },
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

async function sellerSession(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/session", {
    data: { email: SELLER_EMAIL, name: SELLER_NAME },
  });
  const { sessionId } = await res.json();
  return sessionId as string;
}

/** Delete all builds created by these tests and restore seeded flags/prices/parts. */
function cleanupDb(): void {
  const db = new Database(TEST_DB_PATH);
  db.pragma("foreign_keys = ON");
  const seeded = ["ready-office", "ready-gaming", "ready-pro-workstation", "ready-value"];
  const placeholders = seeded.map(() => "?").join(",");
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM ready_pc_part WHERE ready_pc_id NOT IN (${placeholders})`,
    ).run(...seeded);
    db.prepare(
      `DELETE FROM ready_pc WHERE ready_pc_id NOT IN (${placeholders})`,
    ).run(...seeded);
    db.prepare(`UPDATE ready_pc SET is_active = 1`).run();
    db.prepare(`UPDATE part SET is_active = 1, is_available = 1`).run();
    db.prepare(`DELETE FROM seller_brand WHERE seller_id = 'usr-seller' AND brand = 'Acme'`).run();
    db.prepare(`DELETE FROM config_part WHERE config_id LIKE 'cfg-rb-%'`).run();
    db.prepare(`DELETE FROM config WHERE config_id LIKE 'cfg-rb-%'`).run();
    db.prepare(`DELETE FROM order_item WHERE order_id = 'ord-rb-1'`).run();
    db.prepare(`DELETE FROM order_header WHERE order_id = 'ord-rb-1'`).run();
    // Restore the canonical active "Основной" list with mock prices.
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
  cleanupDb();
});

test.describe("regression: seller ready builds", () => {
  test("customer is forbidden from seller ready endpoints", async ({ request }) => {
    const cust = await request.post("/api/session", {
      data: { email: "rb-customer@example.com", name: "RB Клиент" },
    });
    const { sessionId } = await cust.json();
    const res = await request.get(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${sessionId}` },
    });
    expect(res.status()).toBe(403);
  });

  test("seller creates a build from the active price list; it is valid and public", async ({
    request,
  }) => {
    const cookie = await sellerSession(request);
    const res = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E Create", parts: BUILD_PARTS },
    });
    expect(res.status()).toBe(201);
    const build = (await res.json()) as { id: string; name: string; valid: boolean };
    expect(build.name).toBe("Confi E2E Create");
    expect(build.valid).toBe(true);

    // A freshly created build has no reviews, so its rating is 0 (not a fake 5.0).
    const full = (await (
      await request.get(`/api/ready/${build.id}?sellerId=${SELLER_ID}`)
    ).json()) as {
      rating: number;
      reviewCount: number;
      specs: { label: string; value: string }[];
    };
    expect(full.reviewCount).toBe(0);
    expect(full.rating).toBe(0);

    // Derived specs include the CPU, GPU and RAM rows.
    const labels = full.specs.map((s) => s.label);
    expect(labels).toContain("Процессор");
    expect(labels).toContain("Видеокарта");
    expect(labels).toContain("Память");

    // Visible on the public showcase (valid query filter).
    const showcase = (await (
      await request.get(`/api/ready?sellerId=${SELLER_ID}&valid=1`)
    ).json()) as { id: string; valid: boolean }[];
    const found = showcase.find((p) => p.id === build.id);
    expect(found).toBeTruthy();
    expect(found!.valid).toBe(true);
  });

  test("duplicate active model returns 409 model_exists", async ({ request }) => {
    const cookie = await sellerSession(request);
    const first = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E Dupe", parts: BUILD_PARTS },
    });
    expect(first.status()).toBe(201);

    const second = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "e2e dupe", parts: BUILD_PARTS },
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).error).toBe("model_exists");
  });

  test("model uniqueness ignores the brand", async ({ request }) => {
    const cookie = await sellerSession(request);
    // Seller owns a second brand.
    await request.put(`/api/seller/${SELLER_ID}/brands`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Acme", description: "E2E brand" },
    });
    const first = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E CrossBrand", parts: BUILD_PARTS },
    });
    expect(first.status()).toBe(201);

    // Same model under a different brand must still conflict.
    const second = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Acme", model: "E2E CrossBrand", parts: BUILD_PARTS },
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).error).toBe("model_exists");
  });

  test("part placed in the wrong category slot is rejected", async ({ request }) => {
    const cookie = await sellerSession(request);
    const weird = BUILD_PARTS.map((p) =>
      p.category === "cpu" ? { category: "cpu", partId: "gpu-rx-7600" } : p,
    );
    const res = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E WrongSlot", parts: weird },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("invalid_build");
  });

  test("seller cannot archive another seller's build", async ({ request }) => {
    // Create a build owned by the seeded seller.
    const sellerCookie = await sellerSession(request);
    const created = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${sellerCookie}` },
      data: { brand: "Confi", model: "E2E Owned", parts: BUILD_PARTS },
    });
    const victim = (await created.json()) as { id: string };

    // A different seller uses their own id in the path with the victim's build id.
    const other = await request.post("/api/session", {
      data: { name: "Другой продавец" },
    });
    const otherBody = (await other.json()) as { user: { id: string }; sessionId: string };
    const del = await request.delete(
      `/api/seller/${otherBody.user.id}/ready/${victim.id}`,
      { headers: { cookie: `confi_session=${otherBody.sessionId}` } },
    );
    // Ownership scoping resolves the build under the attacker's seller id -> 404.
    expect(del.status()).toBe(404);

    // The victim build is still active.
    const one = (await (
      await request.get(`/api/ready/${victim.id}?sellerId=${SELLER_ID}`)
    ).json()) as { archived?: boolean };
    expect(one.archived).not.toBe(true);
  });

  test("zero-pricing a component marks the build invalid and hides it from the showcase", async ({
    request,
  }) => {
    const cookie = await sellerSession(request);
    const created = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E Invalid", parts: BUILD_PARTS },
    });
    const build = (await created.json()) as { id: string };

    const lists = await (
      await request.get(`/api/seller/${SELLER_ID}/price-lists`, {
        headers: { cookie: `confi_session=${cookie}` },
      })
    ).json();
    const mainId = (lists as { id: string }[])[0].id;

    // Zero the GPU price in the active list.
    await request.put(
      `/api/seller/${SELLER_ID}/price-lists/${mainId}/items/gpu-rx-7600`,
      { headers: { cookie: `confi_session=${cookie}` }, data: { price: 0 } },
    );

    const one = (await (
      await request.get(`/api/ready/${build.id}?sellerId=${SELLER_ID}`)
    ).json()) as { valid: boolean };
    expect(one.valid).toBe(false);

    const showcase = (await (
      await request.get(`/api/ready?sellerId=${SELLER_ID}&valid=1`)
    ).json()) as { id: string }[];
    expect(showcase.some((p) => p.id === build.id)).toBe(false);
  });

  test("archived build leaves the active list and showcase, then reactivates", async ({
    request,
  }) => {
    const cookie = await sellerSession(request);
    const created = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E Archive", parts: BUILD_PARTS },
    });
    const build = (await created.json()) as { id: string };

    const del = await request.delete(`/api/seller/${SELLER_ID}/ready/${build.id}`, {
      headers: { cookie: `confi_session=${cookie}` },
    });
    expect(del.status()).toBe(204);

    const sellerList = (await (
      await request.get(`/api/seller/${SELLER_ID}/ready`, {
        headers: { cookie: `confi_session=${cookie}` },
      })
    ).json()) as { id: string; archived: boolean }[];
    const archived = sellerList.find((b) => b.id === build.id);
    expect(archived?.archived).toBe(true);

    const showcase = (await (
      await request.get(`/api/ready?sellerId=${SELLER_ID}&valid=1`)
    ).json()) as { id: string }[];
    expect(showcase.some((p) => p.id === build.id)).toBe(false);

    // Reactivate -> back in the showcase.
    const re = await request.post(
      `/api/seller/${SELLER_ID}/ready/${build.id}/reactivate`,
      { headers: { cookie: `confi_session=${cookie}` } },
    );
    expect(re.ok()).toBeTruthy();
    const back = (await (
      await request.get(`/api/ready?sellerId=${SELLER_ID}&valid=1`)
    ).json()) as { id: string }[];
    expect(back.some((p) => p.id === build.id)).toBe(true);
  });

  test("a model held only by an archived build can be reused; reactivate then conflicts", async ({
    request,
  }) => {
    const cookie = await sellerSession(request);
    const created = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E Reuse", parts: BUILD_PARTS },
    });
    const oldBuild = (await created.json()) as { id: string };

    await request.delete(`/api/seller/${SELLER_ID}/ready/${oldBuild.id}`, {
      headers: { cookie: `confi_session=${cookie}` },
    });

    // Taking the same model as a new active build succeeds (archived excluded).
    const reuse = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E Reuse", parts: BUILD_PARTS },
    });
    expect(reuse.status()).toBe(201);

    // Reactivating the archived original now conflicts.
    const re = await request.post(
      `/api/seller/${SELLER_ID}/ready/${oldBuild.id}/reactivate`,
      { headers: { cookie: `confi_session=${cookie}` } },
    );
    expect(re.status()).toBe(409);
    expect((await re.json()).error).toBe("model_exists");
  });

  test("incomplete composition is rejected with 400 invalid_build", async ({ request }) => {
    const cookie = await sellerSession(request);
    const res = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E Bad", parts: BUILD_PARTS.slice(0, 5) },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("invalid_build");
  });

  test("seeded Confi build remains valid on the showcase (regression)", async ({
    request,
  }) => {
    const showcase = (await (
      await request.get(`/api/ready?sellerId=${SELLER_ID}&valid=1`)
    ).json()) as { id: string; valid: boolean }[];
    expect(showcase.length).toBeGreaterThan(0);
    expect(showcase.some((p) => p.id === "ready-office" && p.valid)).toBe(true);
  });

  test("build without stored specs derives them from its composition", async ({
    request,
  }) => {
    const cookie = await sellerSession(request);
    const created = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E LegacySpecs", parts: BUILD_PARTS },
    });
    const build = (await created.json()) as { id: string };

    // Simulate a build persisted before specs were auto-generated.
    const db = new Database(TEST_DB_PATH);
    db.prepare(`UPDATE ready_pc SET specs_json = '[]' WHERE ready_pc_id = ?`).run(build.id);
    db.close();

    const one = (await (
      await request.get(`/api/ready/${build.id}?sellerId=${SELLER_ID}`)
    ).json()) as { specs: { label: string; value: string }[] };
    const labels = one.specs.map((s) => s.label);
    expect(labels).toContain("Процессор");
    expect(labels).toContain("Видеокарта");
    expect(labels).toContain("Накопитель");
  });

  test("a saved ready config is marked unavailable when its build is archived", async ({
    page,
    request,
  }) => {
    const cookie = await sellerSession(request);
    const created = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E Archivable", parts: BUILD_PARTS },
    });
    const build = (await created.json()) as { id: string };

    // A customer saves this ready build to their profile.
    const cust = await login(page, request, "rb-archive-cust@example.com", "RB Архив Клиент");
    const saved = await request.put(
      `/api/configs/cfg-rb-archive?userId=${encodeURIComponent(cust.id)}`,
      {
        headers: { cookie: `confi_session=${cust.sessionId}` },
        data: {
          name: "Сохранённая готовая сборка",
          source: "ready",
          seller_id: SELLER_ID,
          ready_pc_id: build.id,
          parts: BUILD_PARTS.map((p) => ({ category: p.category, part_id: p.partId })),
        },
      },
    );
    expect(saved.ok()).toBeTruthy();

    // While the build is active, the config is valid.
    let cfg = (await (
      await request.get(`/api/configs/cfg-rb-archive?userId=${encodeURIComponent(cust.id)}`, {
        headers: { cookie: `confi_session=${cust.sessionId}` },
      })
    ).json()) as { buildInvalid?: boolean };
    expect(cfg.buildInvalid).not.toBe(true);

    // Archive the build.
    await request.delete(`/api/seller/${SELLER_ID}/ready/${build.id}`, {
      headers: { cookie: `confi_session=${cookie}` },
    });

    // The saved config is now marked invalid and the profile shows the badge.
    cfg = (await (
      await request.get(`/api/configs/cfg-rb-archive?userId=${encodeURIComponent(cust.id)}`, {
        headers: { cookie: `confi_session=${cust.sessionId}` },
      })
    ).json()) as { buildInvalid?: boolean };
    expect(cfg.buildInvalid).toBe(true);

    await page.goto("/profile");
    await expect(page.getByText("Сборка недоступна для заказа")).toBeVisible();
  });

  test("archiving a build does not affect an existing order snapshot", async ({
    request,
  }) => {
    const cookie = await sellerSession(request);
    const created = await request.post(`/api/seller/${SELLER_ID}/ready`, {
      headers: { cookie: `confi_session=${cookie}` },
      data: { brand: "Confi", model: "E2E OrderSnap", parts: BUILD_PARTS },
    });
    const build = (await created.json()) as { id: string; name: string };

    const custRes = await request.post("/api/session", {
      data: { email: "rb-order-cust@example.com", name: "RB Заказ Клиент" },
    });
    const cust = (await custRes.json()) as {
      user: { id: string };
      sessionId: string;
    };
    const placed = await request.put(
      `/api/orders/ord-rb-1?userId=${encodeURIComponent(cust.user.id)}`,
      {
        headers: { cookie: `confi_session=${cust.sessionId}` },
        data: {
          status: "new",
          address: "Москва",
          userName: "RB Заказ Клиент",
          items: [{ kind: "ready", refId: build.id, name: build.name, price: 100000, count: 1 }],
        },
      },
    );
    expect(placed.ok()).toBeTruthy();

    await request.delete(`/api/seller/${SELLER_ID}/ready/${build.id}`, {
      headers: { cookie: `confi_session=${cookie}` },
    });

    // The order item keeps its snapshot name/price regardless of the archive.
    const orders = (await (
      await request.get(`/api/orders?userId=${encodeURIComponent(cust.user.id)}`, {
        headers: { cookie: `confi_session=${cust.sessionId}` },
      })
    ).json()) as { items: { name: string; price: number; sellerId?: string }[] }[];
    const item = orders.flatMap((o) => o.items).find((i) => i.name === build.name);
    expect(item).toBeTruthy();
    expect(item!.price).toBe(100000);
    // Seller attribution is snapshotted from ready_pc.seller_id at order time.
    expect(item!.sellerId).toBe(SELLER_ID);
  });

  test("seller manages ready builds from the profile tab (UI)", async ({
    page,
    request,
  }) => {
    await login(page, request, SELLER_EMAIL, SELLER_NAME);
    await page.goto("/profile/ready-builds");
    await expect(
      page.getByRole("heading", { name: "Готовые конфигурации" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать" })).toBeVisible();

    // The seeded Confi builds appear as cards.
    await expect(page.getByText("Confi Office 3000")).toBeVisible();
  });
});