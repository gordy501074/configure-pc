// Import user data from a localStorage export into Confi SQLite.
//
// Reads a JSON export matching the alfagen: prefixed keys:
//   { "alfagen:session": User|null, "alfagen:configs": Config[], "alfagen:reviews": Review[],
//     "alfagen:orders": Order[], "alfagen:settings": AppSettings|null }
// All rows are bound to a surrogate default user (plan section 3, step 4).
//
// Usage: node db/import-localstorage.js <export.json>
//   or:  node db/import-localstorage.js --stdin

import Database from "better-sqlite3";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(root, "db", "confi.db");
const QUARANTINE = join(root, "db", "quarantine-import.log");
const SURROGATE_USER_ID = "usr-localstorage-import";

const USAGES = ["gaming", "work", "video", "universal"];
const STATUSES = ["new", "confirmed", "delivery", "done", "alpha"];
const SOURCES = ["custom", "auto", "ready"];

mkdirSync(dirname(DB_PATH), { recursive: true });

let quarantined = 0;
function quarantine(kind, id, reason) {
  quarantined += 1;
  const line = `${new Date().toISOString()} ${kind}=${id ?? "?"} ${reason}\n`;
  // eslint-disable-next-line no-console
  console.warn("[quarantine-import]", line.trim());
  appendFileSync(QUARANTINE, line, "utf8");
}

function tsToIso(value, fallback) {
  const ms = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  return fallback;
}

// CLI arg: path to export file, or --stdin to read export from stdin.
const arg = process.argv[2];
let exportData;
if (arg === "--stdin") {
  exportData = JSON.parse(readFileSync(0, "utf8"));
} else if (arg) {
  exportData = JSON.parse(readFileSync(arg, "utf8"));
} else {
  // eslint-disable-next-line no-console
  console.error("Usage: node db/import-localstorage.js <export.json> | --stdin");
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// Idempotent surrogate user.
db.prepare(
  `INSERT INTO user_account (user_id, name, role) VALUES (?, 'Импортированный', 'customer')
   ON CONFLICT(user_id) DO NOTHING`,
).run(SURROGATE_USER_ID);

const ORDER_COLS = db.prepare(
  `INSERT INTO order_header (order_id, user_id, total_kopecks, status, address, user_name, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const INSERT_ITEM = db.prepare(
  `INSERT INTO order_item (order_id, position, kind, ref_id, name, price_kopecks, count)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const INSERT_REVIEW = db.prepare(
  `INSERT INTO review (review_id, ready_pc_id, entity_slug, author, rating, body, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const INSERT_CONFIG = db.prepare(
  `INSERT INTO config (config_id, user_id, name, source, usage, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const INSERT_CONFIG_PART = db.prepare(
  `INSERT INTO config_part (config_id, category, part_id) VALUES (?, ?, ?)`,
);
const UPSERT_SETTING = db.prepare(
  `INSERT INTO app_setting (setting_id, user_id, setting_key, setting_value)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id, setting_key) DO UPDATE SET
     setting_id=excluded.setting_id, setting_value=excluded.setting_value,
     updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
);

const NEW_ROOT = (key) => `user-${SURROGATE_USER_ID}:${key}`;

// --- Orders (batched) ---
const orders = Array.isArray(exportData["alfagen:orders"]) ? exportData["alfagen:orders"] : [];
const importOrders = db.transaction(() => {
  for (const o of orders) {
    if (!o || !o.id) { quarantine("order", o?.id, "skipped: no id"); continue; }
    const total = Number.isFinite(o.total) ? Math.round(o.total * 100) : NaN;
    const items = Array.isArray(o.items) ? o.items : [];
    const computed = items.reduce((s, it) => s + (Number.isFinite(it?.price) ? it.price * (it?.count ?? 1) : 0), 0) * 100;
    let totalKopecks = total;
    if (!Number.isFinite(totalKopecks) || Math.abs(totalKopecks - computed) > 1) {
      quarantine("order", o.id, `total mismatch (raw=${total}, computed=${computed}); using computed`);
      totalKopecks = computed;
    }
    const status = STATUSES.includes(o.status) ? o.status : "new";
    const ts = tsToIso(o.createdAt, new Date().toISOString());
    const ok = ORDER_COLS.run(
      o.id, SURROGATE_USER_ID, Math.round(totalKopecks), status,
      String(o.address ?? ""), String(o.userName ?? ""), ts,
    );
    if (ok) {
      items.forEach((it, pos) => {
        if (!it || !it.refId) { quarantine("order_item", o.id, `skipped item #${pos}`); return; }
        INSERT_ITEM.run(
          o.id, pos, it.kind === "config" ? "config" : "ready",
          String(it.refId), String(it.name ?? ""),
          Math.max(0, Math.round((Number.isFinite(it.price) ? it.price : 0) * 100)),
          Number.isInteger(it.count) && it.count > 0 ? it.count : 1,
        );
      });
    }
  }
});

// --- Configs (batched) ---
const configs = Array.isArray(exportData["alfagen:configs"]) ? exportData["alfagen:configs"] : [];
const importConfigs = db.transaction(() => {
  for (const c of configs) {
    if (!c || !c.id) { quarantine("config", c?.id, "skipped: no id"); continue; }
    const parts = Array.isArray(c.parts) ? c.parts : [];
    const createdAt = tsToIso(c.createdAt, new Date().toISOString());
    const updatedAt = tsToIso(c.updatedAt, createdAt);
    INSERT_CONFIG.run(
      c.id, SURROGATE_USER_ID, String(c.name ?? "Моя сборка"),
      SOURCES.includes(c.source) ? c.source : "custom",
      USAGES.includes(c.usage) ? c.usage : null,
      createdAt, updatedAt,
    );
    for (const cp of parts) {
      if (!cp?.part?.id || !cp.category) { quarantine("config_part", c.id, `skipped ${cp?.category}`); continue; }
      INSERT_CONFIG_PART.run(c.id, cp.category, cp.part.id);
    }
  }
});

// --- Reviews ---
const reviews = Array.isArray(exportData["alfagen:reviews"]) ? exportData["alfagen:reviews"] : [];
const importReviews = db.transaction(() => {
  for (const r of reviews) {
    if (!r || !r.id) { quarantine("review", r?.id, "skipped: no id"); continue; }
    const entity = String(r.entityId ?? "");
    const readyPcId = /^ready-/.test(entity) ? entity : null;
    const slug = /^ready-/.test(entity) ? null : entity ? "custom-config" : null;
    const rating = Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5 ? r.rating : null;
    if (rating == null) { quarantine("review", r.id, `bad rating ${r.rating}`); continue; }
    INSERT_REVIEW.run(
      r.id, readyPcId, slug, String(r.author ?? "Гость"),
      rating, String(r.text ?? ""), tsToIso(r.createdAt, new Date().toISOString()),
    );
  }
});

// --- Settings ---
const settings = exportData["alfagen:settings"];
const importSettings = db.transaction(() => {
  if (!settings || typeof settings !== "object") return;
  if (settings.theme === "dark" || settings.theme === "light") {
    UPSERT_SETTING.run(NEW_ROOT("theme"), SURROGATE_USER_ID, "theme", settings.theme);
  }
  if (typeof settings.notifications === "boolean") {
    UPSERT_SETTING.run(NEW_ROOT("notifications"), SURROGATE_USER_ID, "notifications", settings.notifications ? "true" : "false");
  }
});

importOrders();
importConfigs();
importReviews();
importSettings();

const summary = db.prepare(
  `SELECT
    (SELECT count(*) FROM order_header)    AS orders,
    (SELECT count(*) FROM order_item)      AS order_items,
    (SELECT count(*) FROM config)          AS configs,
    (SELECT count(*) FROM config_part)     AS config_parts,
    (SELECT count(*) FROM review)          AS reviews,
    (SELECT count(*) FROM app_setting)     AS settings`,
).get();
// eslint-disable-next-line no-console
console.log("Import complete.");
// eslint-disable-next-line no-console
console.log({ ...summary, quarantined, surrogate_user: SURROGATE_USER_ID, log: QUARANTINE });
db.close();