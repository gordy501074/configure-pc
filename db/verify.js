// Run db/verify.sql checks against db/confi.db and print results.
// Usage: npm run db:verify   (or: node db/verify.js)

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(root, "db", "confi.db");
const SQL = readFileSync(join(root, "db", "verify.sql"), "utf8");

const db = new Database(DB_PATH, { readonly: true });
db.pragma("foreign_keys = ON");

// Split on statement terminators, dropping comment-only lines and blank lines.
const statements = SQL
  .split(/;\s*(?:\r?\n|$)/)
  .map((s) =>
    s
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter(Boolean);

for (const stmt of statements) {
  if (!/^SELECT/i.test(stmt)) continue;
  try {
    const rows = db.prepare(stmt).all();
    // First statement is the counts table; echo each result set.
    // eslint-disable-next-line no-console
    console.table(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[verify] statement failed:", err.message);
  }
}
db.close();