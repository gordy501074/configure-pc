// Idempotent schema migration for the Confi SQLite DB (plan: v2 -> v3).
//
// W.sql applies CREATE TABLE IF NOT EXISTS, but SQLite cannot alter an existing
// CHECK constraint in place, so user_account must be rebuilt from the new DDL.
// This module runs AFTER schema.sql and is safe to re-run.
//
// Called by: db/init.js, db/seed.js, tests/helpers/testDb.ts, src/server/db.ts
// (Node 24 type-stripping lets plain .js / .ts consumers import it).
//
// - New CHECK: role IN ('customer','seller','admin') (removes 'guest').
// - Adds the `company` column (seller's "Компания").
// - Guest rows are dropped (demo policy: guest = anonymous, no account row).
//
// foreign_keys / defer_foreign_keys PRAGMAs cannot change inside a transaction,
// so this runs as bare statements (documented SQLite table-rebuild recipe).

import type Database from "better-sqlite3";

const NEW_USER_ACCOUNT = `
CREATE TABLE new_user_account (
  user_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  role       TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','seller','admin')),
  company    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (email)
) STRICT
`;

/** True when user_account already has the new CHECK and `company` column. */
function userAccountIsMigrated(db: Database.Database): boolean {
  const row = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='user_account'`,
    )
    .get() as { sql: string } | undefined;
  return !!row && /\badmin\b/.test(row.sql) && /company/i.test(row.sql);
}

/**
 * Apply the idempotent v3 migration (rebuild user_account). No-op if already done.
 * Uses the temp-table-and-rename recipe so child FKs re-point to the real table.
 */
export function migrateUserAccount(db: Database.Database): void {
  if (userAccountIsMigrated(db)) return;

  db.pragma("foreign_keys = OFF");
  db.pragma("defer_foreign_keys = ON");
  try {
    db.exec(NEW_USER_ACCOUNT);
    db.exec(`
      INSERT INTO new_user_account (user_id, name, email, phone, role, company, created_at)
      SELECT user_id, name, email, phone, role, NULL, created_at
      FROM user_account
      WHERE role <> 'guest'
    `);
    db.exec(`DROP TABLE user_account`);
    // RENAME also rewrites child-table FK references to the new user_account.
    db.exec(`ALTER TABLE new_user_account RENAME TO user_account`);
    const integrity = db.exec(`PRAGMA foreign_key_check;`) as unknown as [];
    if (Array.isArray(integrity) && integrity.length > 0) {
      throw new Error(
        `user_account migration left FK violations: ${JSON.stringify(integrity)}`,
      );
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * True when seller_brand already has the `description` column.
 * A missing table counts as "not present" so the rebuild guard and the
 * transactional copy-then-rename path are driven by the same condition.
 */
function sellerBrandHasDescription(db: Database.Database): boolean {
  const row = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='seller_brand'`,
    )
    .get() as { sql: string } | undefined;
  return !!row && /description/i.test(row.sql);
}

/**
 * Idempotent v4 migration: add the `description` column to seller_brand by
 * rebuilding the table, preserving existing rows (description = NULL).
 *
 * The rebuild runs as a single transaction (CREATE -> INSERT -> DROP -> RENAME)
 * so a crash or concurrent process cannot leave a half-migrated state. A
 * per-process unique temp-table name avoids collisions if two servers race the
 * migration; the idempotent guard makes the loser a safe no-op.
 */
export function migrateSellerBrandDescription(db: Database.Database): void {
  if (sellerBrandHasDescription(db)) return;

  const tmp = `new_seller_brand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  db.pragma("foreign_keys = OFF");
  db.pragma("defer_foreign_keys = ON");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE ${tmp} (
          seller_id   TEXT NOT NULL,
          brand       TEXT NOT NULL,
          description TEXT,
          PRIMARY KEY (seller_id, brand),
          FOREIGN KEY (seller_id) REFERENCES user_account(user_id) ON DELETE CASCADE
        ) STRICT, WITHOUT ROWID
      `);
      db.exec(`
        INSERT INTO ${tmp} (seller_id, brand, description)
        SELECT seller_id, brand, NULL FROM seller_brand
      `);
      db.exec(`DROP TABLE seller_brand`);
      db.exec(`ALTER TABLE ${tmp} RENAME TO seller_brand`);
    })();
    const integrity = db.exec(`PRAGMA foreign_key_check;`) as unknown as [];
    if (Array.isArray(integrity) && integrity.length > 0) {
      throw new Error(
        `seller_brand migration left FK violations: ${JSON.stringify(integrity)}`,
      );
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

// ---- v6: vendor dictionary + part vendor_id / is_available + FK SET NULL ----

/**
 * True when the schema has already reached v6: `vendor` table exists, `part`
 * has `vendor_id` and `is_available`, and both junction FKs are ON DELETE SET NULL.
 */
function vendorAndAvailabilityIsMigrated(db: Database.Database): boolean {
  const vendor = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='vendor'`)
    .get();
  if (!vendor) return false;
  const part = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='part'`)
    .get() as { sql: string } | undefined;
  if (!part || !/vendor_id/i.test(part.sql) || !/is_available/i.test(part.sql)) {
    return false;
  }
  const cfgPart = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='config_part'`)
    .get() as { sql: string } | undefined;
  if (!cfgPart || !/SET NULL/i.test(cfgPart.sql)) return false;
  const readyPart = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ready_pc_part'`)
    .get() as { sql: string } | undefined;
  return !!readyPart && /SET NULL/i.test(readyPart.sql);
}

/**
 * Idempotent v6 migration: introduce the `vendor` dictionary, add `vendor_id`
 * / `is_available` to `part`, and switch the `config_part` / `ready_pc_part`
 * FKs to `part ON DELETE SET NULL`.
 *
 * Because STRICT SQLite cannot alter columns/constraints in place, each table is
 * rebuilt via the documented FK-off recipe (CREATE -> INSERT -> DROP -> RENAME).
 * Foreign keys are populated from the existing `brand` values (brands become
 * vendor trademarks); `is_available` defaults to 1 for every part.
 */
export function migrateVendorAndAvailability(db: Database.Database): void {
  if (vendorAndAvailabilityIsMigrated(db)) return;

  const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpVendor = `new_vendor_${stamp}`;
  const tmpPart = `new_part_${stamp}`;
  const tmpConfigPart = `new_config_part_${stamp}`;
  const tmpReadyPart = `new_ready_pc_part_${stamp}`;

  db.pragma("foreign_keys = OFF");
  db.pragma("defer_foreign_keys = ON");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE ${tmpVendor} (
          vendor_id  TEXT PRIMARY KEY,
          name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ) STRICT
      `);
      // Populate vendors from the unique, non-empty part.brand values (trademarks),
      // collapsing case (Intel == intel) via a case-insensitive group.
      db.exec(`
        INSERT INTO ${tmpVendor} (vendor_id, name)
        SELECT 'ven-' || substr(lower(hex(randomBlob(16))), 1, 12), MIN(trim(brand))
        FROM part
        WHERE trim(brand) <> ''
        GROUP BY lower(trim(brand))
      `);

      db.exec(`
        CREATE TABLE ${tmpPart} (
          part_id       TEXT PRIMARY KEY,
          category      TEXT NOT NULL CHECK (category IN ('cpu','gpu','motherboard','ram','storage','case','psu','cooler')),
          name          TEXT NOT NULL,
          brand         TEXT NOT NULL,
          vendor_id     TEXT,
          price_kopecks INTEGER NOT NULL CHECK (price_kopecks >= 0),
          tdp_watt      INTEGER NOT NULL DEFAULT 0 CHECK (tdp_watt BETWEEN 0 AND 65355),
          compat_json   TEXT NOT NULL,
          specs_json    TEXT NOT NULL DEFAULT '[]',
          image_url     TEXT,
          is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
          is_available  INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
          created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          FOREIGN KEY (vendor_id) REFERENCES ${tmpVendor}(vendor_id) ON DELETE SET NULL
        ) STRICT
      `);
      db.exec(`
        INSERT INTO ${tmpPart} (part_id, category, name, brand, vendor_id, price_kopecks, tdp_watt, compat_json, specs_json, image_url, is_active, is_available, created_at)
        SELECT p.part_id, p.category, p.name, p.brand, v.vendor_id, p.price_kopecks, p.tdp_watt,
               p.compat_json, p.specs_json, p.image_url, p.is_active, 1, p.created_at
        FROM part p
        LEFT JOIN ${tmpVendor} v ON v.name = trim(p.brand) COLLATE NOCASE
      `);
      db.exec(`DROP TABLE part`);

      db.exec(`
        CREATE TABLE ${tmpConfigPart} (
          config_id TEXT NOT NULL,
          category  TEXT NOT NULL CHECK (category IN ('cpu','gpu','motherboard','ram','storage','case','psu','cooler')),
          part_id   TEXT,
          PRIMARY KEY (config_id, category),
          FOREIGN KEY (config_id) REFERENCES config(config_id) ON DELETE CASCADE,
          FOREIGN KEY (part_id) REFERENCES ${tmpPart}(part_id) ON DELETE SET NULL
        ) STRICT, WITHOUT ROWID
      `);
      db.exec(`
        INSERT INTO ${tmpConfigPart} (config_id, category, part_id)
        SELECT config_id, category, part_id FROM config_part
      `);
      db.exec(`DROP TABLE config_part`);

      db.exec(`
        CREATE TABLE ${tmpReadyPart} (
          ready_pc_id TEXT NOT NULL,
          part_id     TEXT,
          category    TEXT NOT NULL,
          PRIMARY KEY (ready_pc_id, category),
          UNIQUE (ready_pc_id, part_id),
          FOREIGN KEY (ready_pc_id) REFERENCES ready_pc(ready_pc_id) ON DELETE CASCADE,
          FOREIGN KEY (part_id) REFERENCES ${tmpPart}(part_id) ON DELETE SET NULL
        ) STRICT, WITHOUT ROWID
      `);
      db.exec(`
        INSERT INTO ${tmpReadyPart} (ready_pc_id, part_id, category)
        SELECT ready_pc_id, part_id, category FROM ready_pc_part
      `);
      db.exec(`DROP TABLE ready_pc_part`);

      db.exec(`DROP TABLE IF EXISTS part`);
      db.exec(`DROP TABLE IF EXISTS config_part`);
      db.exec(`DROP TABLE IF EXISTS ready_pc_part`);
      db.exec(`DROP TABLE IF EXISTS vendor`);

      db.exec(`ALTER TABLE ${tmpVendor} RENAME TO vendor`);
      db.exec(`ALTER TABLE ${tmpPart} RENAME TO part`);
      db.exec(`ALTER TABLE ${tmpConfigPart} RENAME TO config_part`);
      db.exec(`ALTER TABLE ${tmpReadyPart} RENAME TO ready_pc_part`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_part_active ON part(category, is_active)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_part_vendor ON part(vendor_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vendor_name ON vendor(name)`);
    })();

    const integrity = db.exec(`PRAGMA foreign_key_check;`) as unknown as [];
    if (Array.isArray(integrity) && integrity.length > 0) {
      throw new Error(
        `vendor migration left FK violations: ${JSON.stringify(integrity)}`,
      );
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}