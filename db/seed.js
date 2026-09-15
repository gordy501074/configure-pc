// Seed the Confi SQLite catalog (part, ready_pc, ready_pc_part) from src/data/mock.ts.
// Node 24 native TS type-stripping imports the mock directly.
//
// Usage: npm run db:seed   (or: node db/seed.js)

import Database from "better-sqlite3";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { components, readyPcs, seededReviews } from "../src/data/mock.ts";
import { migrateUserAccount } from "./migrate.ts";

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

/** Normalize a psu part's form factor (mock mixes psuForm/formFactor). */
function psuFormOf(p) {
  return p.psuForm ?? p.formFactor;
}

/** Extract sparse compat markers into a JSON object. Mirrors Part fields. */
function compatJson(p) {
  const compat = {
    socket: p.socket,
    chipset: p.chipset,
    ramType: p.ramType,
    psuForm: psuFormOf(p),
    power: p.power,
    formFactor: p.formFactor,
    gpuLength: p.gpuLength,
    cpuCoolerMaxHeight: p.cpuCoolerMaxHeight,
    includesCooler: p.includesCooler,
    coolTdp: p.coolTdp,
    sizeMm: p.sizeMm,
    benches: p.benches ?? [],
  };
  return JSON.stringify(compat);
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

/** Validate a single part row; returns null to skip. */
function validatePart(p) {
  if (!p.id) return quarantine(p.id ?? "?", "skipped: empty id"), null;
  if (!p.name || !String(p.name).trim()) return quarantine(p.id, "skipped: empty name"), null;
  if (!p.brand || !String(p.brand).trim()) return quarantine(p.id, "skipped: empty brand"), null;
  if (!CATEGORIES.includes(p.category)) return quarantine(p.id, `skipped: bad category ${p.category}`), null;
  if (!Number.isFinite(p.price) || p.price < 0) return quarantine(p.id, `skipped: bad price ${p.price}`), null;
  if (!Number.isFinite(p.tdp) || p.tdp < 0 || p.tdp > 65355) return quarantine(p.id, `skipped: bad tdp ${p.tdp}`), null;
  return {
    part_id: p.id,
    category: p.category,
    name: p.name,
    brand: p.brand,
    price_kopecks: Math.round(p.price * 100),
    tdp_watt: Math.round(p.tdp),
  };
}

const insertPart = db.prepare(`
  INSERT INTO part (part_id, category, name, brand, price_kopecks, tdp_watt, compat_json, specs_json, image_url, is_active)
  VALUES (@part_id, @category, @name, @brand, @price_kopecks, @tdp_watt, @compat_json, @specs_json, @image_url, 1)
  ON CONFLICT(part_id) DO UPDATE SET
    category=excluded.category, name=excluded.name, brand=excluded.brand,
    price_kopecks=excluded.price_kopecks, tdp_watt=excluded.tdp_watt,
    compat_json=excluded.compat_json, specs_json=excluded.specs_json,
    image_url=excluded.image_url, is_active=1
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

const insertReview = db.prepare(`
  INSERT INTO review (review_id, ready_pc_id, author, rating, body, created_at)
  VALUES (@id, @ready_pc_id, @author, @rating, @body, @created_at)
  ON CONFLICT(review_id) DO NOTHING
`);

const upsertAccount = db.prepare(`
  INSERT INTO user_account (user_id, name, email, phone, role, company)
  VALUES (@user_id, @name, @email, @phone, @role, @company)
  ON CONFLICT(user_id) DO UPDATE SET
    email=excluded.email, phone=excluded.phone,
    role=excluded.role, company=excluded.company
`);

const insertSellerBrand = db.prepare(`
  INSERT INTO seller_brand (seller_id, brand)
  VALUES (@seller_id, @brand)
  ON CONFLICT(seller_id, brand) DO NOTHING
`);

const seedAll = db.transaction(() => {
  // Clear in FK-safe order: child tables first, then catalog parents.
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

  let partCount = 0;
  for (const cat of CATEGORIES) {
    for (const p of components[cat]) {
      const row = validatePart(p);
      if (!row) continue;
      insertPart.run({
        ...row,
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
  insertSellerBrand.run({ seller_id: "usr-seller", brand: "Confi" });

  return partCount;
});

const inserted = seedAll();

const counts = db.prepare("SELECT (SELECT count(*) FROM part) AS parts, (SELECT count(*) FROM ready_pc) AS ready, (SELECT count(*) FROM ready_pc_part) AS ready_parts, (SELECT count(*) FROM review) AS reviews").get();
// eslint-disable-next-line no-console
console.log("Seed complete.");
// eslint-disable-next-line no-console
console.log({ inserted, ...counts, quarantined });
db.close();