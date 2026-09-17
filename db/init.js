// Apply the Confi SQLite schema (empty STRICT tables, indexes, WAL, user_version=3).
// Idempotent: re-running is safe.  Usage: npm run db:init
//
// The schema lives in db/schema.sql and is also applied by db/seed.js before seeding.
// A dedicated migration (db/migrate.js) rebuilds user_account for the v3 role CHECK.

import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateSellerBrandDescription, migrateUserAccount } from "./migrate.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(root, "db", "confi.db");
const SCHEMA = join(root, "db", "schema.sql");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.exec(readFileSync(SCHEMA, "utf8"));
migrateUserAccount(db);
migrateSellerBrandDescription(db);

const tables = db
  .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'")
  .get().c;
const version = db.prepare("PRAGMA user_version").get().user_version;
// eslint-disable-next-line no-console
console.log(`db:init OK -> tables=${tables} user_version=${version} (${DB_PATH})`);
db.close();