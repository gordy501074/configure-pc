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