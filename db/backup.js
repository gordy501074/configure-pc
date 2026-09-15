// Backup / rollback helper for the Confi SQLite store (plan section 3, step 9).
//
//   npm run db:backup   -> copies db/confi.db to db/backups/confi-<timestamp>.db (incl. -wal/-shm)
//   npm run db:backup -- kill    -> turns on write-ahead, used before destructive ops
//
// Rollback (manual):
//   1. Stop the server.
//   2. Remove db/confi.db (and its -wal/-shm).
//   3. Copy the latest backup in db/backups/ back to db/confi.db.
//   4. Start the server.

import { mkdirSync, copyFileSync, readdirSync, existsSync, statSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(root, "db", "confi.db");
const BACKUP_DIR = join(root, "db", "backups");

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = join(BACKUP_DIR, `confi-${stamp}.db`);

if (!existsSync(DB)) {
  // eslint-disable-next-line no-console
  console.error(`No database at ${DB}; nothing to back up.`);
  process.exit(1);
}

const extras = [DB + "-wal", DB + "-shm", DB + "-journal"].filter((p) => existsSync(p));

const backupBase = backupFile.replace(/\.db$/, "");
copyFileSync(DB, backupFile);
for (const e of extras) {
  const suffix = e.slice(DB.length); // e.g. "-wal"
  copyFileSync(e, backupBase + suffix);
}

// eslint-disable-next-line no-console
console.log(`Backed up ${DB} (${statSync(backupFile).size} bytes) -> ${backupFile}`);

// ---------------- rollback ----------------
if (process.argv[2] === "--restore") {
  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .sort()
    .reverse();
  if (backups.length === 0) {
    // eslint-disable-next-line no-console
    console.error("No backups to restore.");
    process.exit(1);
  }
  const latest = join(BACKUP_DIR, backups[0]);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const p = DB + suffix;
    if (existsSync(p)) rmSync(p);
  }
  copyFileSync(latest, DB);
  // eslint-disable-next-line no-console
  console.log(`Restored ${latest} -> ${DB}`);
}