// SQLite connection setup for the Confi server (plan section 4).
// better-sqlite3 is synchronous; a single shared connection is used (one writer, fine for demo).

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DB_PATH =
  process.env.DB_PATH ?? join(root, "db", "confi.db");

let cachedDb: Database.Database | null = null;

/**
 * Open (and cache) the SQLite connection, applying per-connection PRAGMAs
 * that do not persist across reconnect (WAL, foreign_keys, busy_timeout).
 * On a fresh checkout the schema is applied automatically.
 */
export function openDb(): Database.Database {
  if (cachedDb) return cachedDb;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const fresh = !existsSync(DB_PATH);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  if (fresh) {
    const schemaPath = join(root, "db", "schema.sql");
    db.exec(readFileSync(schemaPath, "utf8"));
  }

  cachedDb = db;
  return db;
}

export function getDb(): Database.Database {
  return openDb();
}

export default getDb;