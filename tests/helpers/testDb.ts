// Test-support module: create a fresh throwaway SQLite DB (schema + seed) for
// isolated Playwright runs, plus shared constants for config/CI.

import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { components, readyPcs } from "../../src/data/mock.ts";
import { migrateSellerBrandDescription, migrateUserAccount, migrateVendorAndAvailability } from "../../db/migrate.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const TEST_DB_PATH = process.env.TEST_DB_PATH ?? join(root, ".test-data", "confi-test.db");
export const API_PORT = Number(process.env.API_PORT ?? 8787);
export const APP_PORT = Number(process.env.APP_PORT ?? 5173);
export const APP_BASE = process.env.APP_BASE_URL ?? `http://localhost:${APP_PORT}`;

const CATEGORIES = ["cpu", "gpu", "motherboard", "ram", "storage", "case", "psu", "cooler"] as const;

function compatJson(p: Record<string, unknown>): string {
  return JSON.stringify({ v: 2, ...(p.compat as Record<string, unknown> | undefined) });
}

function specsJson(p: { specs?: unknown[] }): string {
  return JSON.stringify(p.specs ?? []);
}

function composeName(vendorName: string, brand: string): string {
  const v = String(vendorName ?? "").trim();
  const b = String(brand ?? "").trim();
  if (v && b) return `${v} ${b}`;
  return v || b;
}

function modelFromName(name: string, vendorName: string): string {
  const n = String(name ?? "").trim();
  const v = String(vendorName ?? "").trim();
  if (!v) return n;
  if (n.toLowerCase().startsWith(v.toLowerCase())) return n.slice(v.length).trim();
  return n;
}

function seed(db: Database.Database): void {
  db.exec("PRAGMA foreign_keys = ON");
  const getVendorByName = db.prepare(
    `SELECT vendor_id FROM vendor WHERE name = ? COLLATE NOCASE`,
  );
  const insertVendor = db.prepare(`
    INSERT INTO vendor (vendor_id, name) VALUES (@vendor_id, @name)
    ON CONFLICT(name) DO UPDATE SET name=excluded.name
  `);
  const vendorIdFor = (brand: string): string => {
    const hex = Buffer.from(String(brand).trim().toLowerCase(), "utf8").toString("hex").slice(0, 24).padEnd(12, "0");
    return `ven-${hex}`;
  };
  const ensureVendor = (brand: string): string | null => {
    const name = String(brand).trim();
    if (!name) return null;
    const existing = getVendorByName.get(name) as { vendor_id: string } | undefined;
    if (existing) return existing.vendor_id;
    const vid = vendorIdFor(name);
    insertVendor.run({ vendor_id: vid, name });
    return vid;
  };
  const insertPart = db.prepare(`
    INSERT INTO part (part_id, category, name, brand, vendor_id, price_kopecks, tdp_watt, compat_json, specs_json, image_url, is_active, is_available)
    VALUES (@part_id, @category, @name, @brand, @vendor_id, @price_kopecks, @tdp_watt, @compat_json, @specs_json, @image_url, 1, 1)
    ON CONFLICT(part_id) DO UPDATE SET
      category=excluded.category, name=excluded.name, brand=excluded.brand,
      vendor_id=excluded.vendor_id,
      price_kopecks=excluded.price_kopecks, tdp_watt=excluded.tdp_watt,
      compat_json=excluded.compat_json, specs_json=excluded.specs_json,
      image_url=excluded.image_url, is_active=1, is_available=1
  `);
  const insertReady = db.prepare(`
    INSERT INTO ready_pc (ready_pc_id, name, brand, usage, price_kopecks, tdp_watt, summary, specs_json, image_url, in_stock, rating, is_active)
    VALUES (@id, @name, @brand, @usage, @price_kopecks, @tdp_watt, @summary, @specs_json, @image_url, @in_stock, @rating, 1)
    ON CONFLICT(ready_pc_id) DO UPDATE SET
      name=excluded.name, brand=excluded.brand, usage=excluded.usage,
      price_kopecks=excluded.price_kopecks, tdp_watt=excluded.tdp_watt,
      summary=excluded.summary, specs_json=excluded.specs_json,
      image_url=excluded.image_url, in_stock=excluded.in_stock,
      rating=excluded.rating, is_active=1
  `);
  const insertReadyPart = db.prepare(`
    INSERT INTO ready_pc_part (ready_pc_id, part_id, category)
    VALUES (@ready_pc_id, @part_id, @category)
    ON CONFLICT(ready_pc_id, part_id) DO NOTHING
  `);

  const upsertAccount = db.prepare(`
    INSERT INTO user_account (user_id, name, email, phone, role, company)
    VALUES (@user_id, @name, @email, @phone, @role, @company)
    ON CONFLICT(user_id) DO NOTHING
  `);
  const insertSellerBrand = db.prepare(`
    INSERT INTO seller_brand (seller_id, brand, description)
    VALUES (@seller_id, @brand, @description)
    ON CONFLICT(seller_id, brand) DO UPDATE SET description=excluded.description
  `);

  const seedAll = db.transaction(() => {
    db.prepare("DELETE FROM app_setting").run();
    db.prepare("DELETE FROM order_item").run();
    db.prepare("DELETE FROM order_header").run();
    db.prepare("DELETE FROM config_part").run();
    db.prepare("DELETE FROM config").run();
    db.prepare("DELETE FROM review").run();
    db.prepare("DELETE FROM seller_brand").run();
    db.prepare("DELETE FROM user_account").run();
    db.prepare("DELETE FROM ready_pc_part").run();
    db.prepare("DELETE FROM ready_pc").run();
    db.prepare("DELETE FROM part").run();
    db.prepare("DELETE FROM vendor").run();

    let n = 0;
    for (const cat of CATEGORIES) {
      for (const p of (components as Record<string, unknown[]>)[cat] ?? []) {
        const row = p as Record<string, unknown> & { id: string; name: string; brand: string; price: number; tdp: number };
        const model = modelFromName(row.name, row.brand);
        insertPart.run({
          part_id: row.id, category: cat, name: composeName(row.brand, model), brand: model,
          vendor_id: ensureVendor(row.brand),
          price_kopecks: Math.round(row.price * 100), tdp_watt: Math.round(row.tdp),
          compat_json: compatJson(row), specs_json: specsJson(row as { specs?: unknown[] }),
          image_url: row.image ?? null,
        });
        n++;
      }
    }
    for (const rp of readyPcs) {
      const parts = rp.parts.map((pp) => pp.part);
      insertReady.run({
        id: rp.id, name: rp.name, brand: rp.brand, usage: rp.usage,
        price_kopecks: Math.round(rp.price * 100), tdp_watt: Math.round(rp.tdp),
        summary: rp.summary, specs_json: JSON.stringify(rp.specs ?? []),
        image_url: rp.image ?? null, in_stock: rp.inStock ? 1 : 0, rating: rp.rating,
      });
      for (const { category, part } of rp.parts) {
        if (!part) continue;
        insertReadyPart.run({ ready_pc_id: rp.id, part_id: part.id, category });
      }
    }

    upsertAccount.run({
      user_id: "usr-admin", name: "Администратор", email: "avgordeev@alfabank.ru",
      phone: null, role: "admin", company: null,
    });
    upsertAccount.run({
      user_id: "usr-seller", name: "Продавец Confi", email: "user@company.com",
      phone: null, role: "seller", company: "Confi Маркет",
    });
    insertSellerBrand.run({
      seller_id: "usr-seller",
      brand: "Confi",
      description: "Собственные сборки Confi",
    });

    return n;
  });
  seedAll();
}

/** Create a fully-populated throwaway test DB; returns its path. */
export function initTestDb(dbPath = TEST_DB_PATH): string {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  // schema.sql is CREATE TABLE IF NOT EXISTS — safe on every run, which also
  // adds any new tables (e.g. seller_brand) to pre-existing test DBs.
  db.exec(readFileSync(join(root, "db", "schema.sql"), "utf8"));
  migrateUserAccount(db);
  migrateSellerBrandDescription(db);
  migrateVendorAndAvailability(db);
  seed(db);
  db.close();
  return dbPath;
}

/** Wipe the analytics event table to isolate test runs. */
export function resetAnalytics(dbPath = TEST_DB_PATH): void {
  const db = new Database(dbPath);
  db.prepare("DELETE FROM analytics_events").run();
  db.close();
}

/** Mark onboarding complete so route-gate tests reach their screens. */
export function setOnboardedTrue(dbPath = TEST_DB_PATH): void {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO kv_store (k, v, updated_at) VALUES ('onboarded', '1', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(k) DO UPDATE SET v='1', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run();
  db.close();
}