// CLI helper to inspect the analytics_events table.
// Usage: node db/analytics.js [count|recent [n]|flows [n]]
import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(root, "db", "confi.db");
const db = new Database(DB_PATH, { readonly: true });

const cmd = process.argv[2] ?? "count";

function printEvents(rows) {
  for (const r of rows) {
    console.log(
      JSON.stringify({
        ts: r.ts, event: r.event, level: r.level, route: r.route,
        userId: r.userId, payload: safeParse(r.payload),
      }),
    );
  }
}
function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

switch (cmd) {
  case "count": {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM analytics_events").get();
    console.log(`analytics_events rows: ${n}`);
    break;
  }
  case "recent": {
    const n = Number(process.argv[3] ?? 20);
    printEvents(db.prepare(
      `SELECT ts, event, level, route, user_id AS userId, payload
       FROM analytics_events ORDER BY ts DESC LIMIT ?`,
    ).all(n));
    break;
  }
  case "flows": {
    const limit = Number(process.argv[3] ?? 50);
    const rows = db.prepare(
      `SELECT event, COUNT(*) AS count FROM analytics_events
       WHERE level != 'debug' GROUP BY event ORDER BY count DESC LIMIT ?`,
    ).all(limit);
    console.table(rows);
    break;
  }
  default:
    console.error("usage: node db/analytics.js [count|recent|flows]");
    process.exitCode = 1;
}
db.close();