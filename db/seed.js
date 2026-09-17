// Seed the Confi SQLite catalog (part, ready_pc, ready_pc_part) from src/data/mock.ts.
// Node 24 native TS type-stripping imports the mock directly.
//
// Usage: npm run db:seed   (or: node db/seed.js)

import Database from "better-sqlite3";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { components, readyPcs, seededReviews } from "../src/data/mock.ts";
import { migrateSellerBrandDescription, migrateUserAccount, migrateVendorAndAvailability } from "./migrate.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(root, "db", "confi.db");
const SCHEMA = join(root, "db", "schema.sql");
const QUARANTINE = join(root, "db", "quarantine-part.log");

mkdirSync(dirname(DB_PATH), { recursive: true });

const CATEGORIES = [
  "cpu",
  "gpu",
  "motherboard",
  "ram",
  "storage",
  "case",
  "psu",
  "cooler",
];

/** Serialize the nested PartCompat document into compat_json (versioned). */
function compatJson(p) {
  return JSON.stringify({ v: 2, ...p.compat });
}

function specsJson(p) {
  return JSON.stringify(p.specs ?? []);
}

let quarantined = 0;
function quarantine(id, reason) {
  quarantined += 1;
  const line = `${new Date().toISOString()} part=${id} ${reason}\n`;
  // eslint-disable-next-line no-console
  console.warn("[quarantine]", line.trim());
  appendFileSync(QUARANTINE, line, "utf8");
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.exec(readFileSync(SCHEMA, "utf8"));
migrateUserAccount(db);
migrateSellerBrandDescription(db);
migrateVendorAndAvailability(db);

/** Validate a single part row; returns null to skip. */
function validatePart(p) {
  if (!p.id) return quarantine(p.id ?? "?", "skipped: empty id"), null;
  if (!p.name || !String(p.name).trim()) return quarantine(p.id, "skipped: empty name"), null;
  if (!p.brand || !String(p.brand).trim()) return quarantine(p.id, "skipped: empty brand"), null;
  if (!CATEGORIES.includes(p.category)) return quarantine(p.id, `skipped: bad category ${p.category}`), null;
  if (!Number.isFinite(p.price) || p.price < 0) return quarantine(p.id, `skipped: bad price ${p.price}`), null;
  if (!Number.isFinite(p.tdp) || p.tdp < 0 || p.tdp > 65355) return quarantine(p.id, `skipped: bad tdp ${p.tdp}`), null;
  // vendorship: торговая марка = p.brand; модель = name минус марка; name = марка + модель.
  const brand = modelFromName(p.name, p.brand);
  return {
    part_id: p.id,
    category: p.category,
    name: composeName(p.brand, brand),
    brand,
    price_kopecks: Math.round(p.price * 100),
    tdp_watt: Math.round(p.tdp),
  };
}

/** Compose a full display name from a trademark and a model, e.g. "Intel Core i5-13400F". */
function composeName(vendorName, brand) {
  const v = String(vendorName ?? "").trim();
  const b = String(brand ?? "").trim();
  if (v && b) return `${v} ${b}`;
  return v || b;
}

/** Strip a leading trademark from a full name, returning the model/line name. */
function modelFromName(name, vendorName) {
  const n = String(name ?? "").trim();
  const v = String(vendorName ?? "").trim();
  if (!v) return n;
  if (n.toLowerCase().startsWith(v.toLowerCase())) return n.slice(v.length).trim();
  return n;
}

const getVendorByName = db.prepare(`
  SELECT vendor_id FROM vendor WHERE name = ? COLLATE NOCASE
`);

const insertVendor = db.prepare(`
  INSERT INTO vendor (vendor_id, name)
  VALUES (@vendor_id, @name)
  ON CONFLICT(name) DO UPDATE SET name=excluded.name
`);

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

/** Ensure a vendor row exists for the brand, returning its real stored id. */
function ensureVendor(brand) {
  const name = String(brand).trim();
  if (!name) return null;
  // Reuse an existing vendor (e.g. created by the v6 migration or the API with a
  // random id) so the returned id always matches the stored row.
  const existing = getVendorByName.get(name);
  if (existing) return existing.vendor_id;
  // Fall back to a random id (same family as the migration/repository) to avoid
  // colliding with ids that already exist under a different name.
  const vid = `ven-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  insertVendor.run({ vendor_id: vid, name });
  return vid;
}

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

const insertReview = db.prepare(`
  INSERT INTO review (review_id, ready_pc_id, author, rating, body, created_at)
  VALUES (@id, @ready_pc_id, @author, @rating, @body, @created_at)
  ON CONFLICT(review_id) DO NOTHING
`);

const upsertAccount = db.prepare(`
  INSERT INTO user_account (user_id, name, email, phone, role, company)
  VALUES (@user_id, @name, @email, @phone, @role, @company)
  ON CONFLICT(user_id) DO UPDATE SET
    email=excluded.email, phone=excluded.phone, role=excluded.role
`);

const insertSellerBrand = db.prepare(`
  INSERT INTO seller_brand (seller_id, brand, description)
  VALUES (@seller_id, @brand, @description)
  ON CONFLICT(seller_id, brand) DO UPDATE SET description=excluded.description
`);

const seedAll = db.transaction(() => {
  // Re-seed catalog idempotently. User-generated data (config, config_part,
  // order_header, order_item, review, app_setting) and user_account /
  // seller_brand are NOT deleted so saved configs, orders, reviews and profile
  // edits survive application restarts (e.g. on npm start). Catalog rows are
  // upserted below; nothing in the catalog is deleted, so FK references from
  // user rows (ON DELETE RESTRICT / CASCADE) are never triggered.

  let partCount = 0;
  for (const cat of CATEGORIES) {
    for (const p of components[cat]) {
      const row = validatePart(p);
      if (!row) continue;
      insertPart.run({
        ...row,
        vendor_id: ensureVendor(p.brand),
        compat_json: compatJson(p),
        specs_json: specsJson(p),
        image_url: p.image ?? null,
      });
      partCount += 1;
    }
  }

  for (const rp of readyPcs) {
    insertReady.run({
      id: rp.id,
      name: rp.name,
      brand: rp.brand,
      usage: rp.usage,
      price_kopecks: Math.round(rp.price * 100),
      tdp_watt: Math.round(rp.tdp),
      summary: rp.summary,
      specs_json: JSON.stringify(rp.specs ?? []),
      image_url: rp.image ?? null,
      in_stock: rp.inStock ? 1 : 0,
      rating: rp.rating,
    });
    for (const { category, part } of rp.parts) {
      insertReadyPart.run({ ready_pc_id: rp.id, part_id: part.id, category });
    }
  }

  for (const r of seededReviews) {
    insertReview.run({
      id: r.id,
      ready_pc_id: /^ready-/.test(r.entityId) ? r.entityId : null,
      author: r.author,
      rating: r.rating,
      body: r.text,
      created_at: new Date(r.createdAt).toISOString(),
    });
  }

  // Roles: admin & seller have NO phone (email-only login). Seller owns brand(s).
  upsertAccount.run({
    user_id: "usr-admin",
    name: "Администратор",
    email: "avgordeev@alfabank.ru",
    phone: null,
    role: "admin",
    company: null,
  });
  upsertAccount.run({
    user_id: "usr-seller",
    name: "Продавец Confi",
    email: "user@company.com",
    phone: null,
    role: "seller",
    company: "Confi Маркет",
  });
  insertSellerBrand.run({
    seller_id: "usr-seller",
    brand: "Confi",
    description: "Собственные сборки Confi",
  });

  // Remove vendors no longer referenced by any part (e.g. model names wrongly
  // created as vendors by earlier buggy seeds, or leftovers from deleted parts).
  db.exec(`DELETE FROM vendor WHERE vendor_id NOT IN (SELECT vendor_id FROM part WHERE vendor_id IS NOT NULL)`);

  return partCount;
});

const inserted = seedAll();

const counts = db.prepare("SELECT (SELECT count(*) FROM part) AS parts, (SELECT count(*) FROM ready_pc) AS ready, (SELECT count(*) FROM ready_pc_part) AS ready_parts, (SELECT count(*) FROM review) AS reviews").get();
// eslint-disable-next-line no-console
console.log("Seed complete.");
// eslint-disable-next-line no-console
console.log({ inserted, ...counts, quarantined });
db.close();