// @group unit
// Unit tests for db/migrate.ts — the v9 order-attribution + soft-cancel migration
// (adds order_item.seller_id/category, widens order_header CHECK to 'cancelled',
// and best-effort-backfills snapshots). Runs against an in-memory SQLite DB.
import { test } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { migrateOrderAttributionAndCancel, migrateOrderRejectedStatus } from "../../db/migrate.ts";

/** Minimal pre-v9 schema: order_item lacks seller_id/category; status CHECK has no 'cancelled'. */
function preV9Db(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE user_account (
      user_id TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      role    TEXT NOT NULL DEFAULT 'customer'
    ) STRICT;

    CREATE TABLE ready_pc (
      ready_pc_id TEXT PRIMARY KEY,
      seller_id   TEXT
    ) STRICT;

    CREATE TABLE part (
      part_id  TEXT PRIMARY KEY,
      category TEXT NOT NULL
    ) STRICT;

    CREATE TABLE order_header (
      order_id      TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      total_kopecks INTEGER NOT NULL CHECK (total_kopecks >= 0),
      status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','delivery','done','alpha')),
      address       TEXT NOT NULL,
      user_name     TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE order_item (
      order_id      TEXT NOT NULL,
      position      INTEGER NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN ('ready','config')),
      ref_id        TEXT NOT NULL,
      name          TEXT NOT NULL,
      price_kopecks INTEGER NOT NULL CHECK (price_kopecks >= 0),
      count         INTEGER NOT NULL DEFAULT 1 CHECK (count BETWEEN 1 AND 9999),
      PRIMARY KEY (order_id, position),
      FOREIGN KEY (order_id) REFERENCES order_header(order_id) ON DELETE CASCADE
    ) STRICT, WITHOUT ROWID;
  `);
  db.prepare(`INSERT INTO user_account (user_id, name, role) VALUES ('usr-seller','Продавец','seller')`).run();
  db.prepare(`INSERT INTO user_account (user_id, name, role) VALUES ('usr-cust','Клиент','customer')`).run();
  db.prepare(`INSERT INTO ready_pc (ready_pc_id, seller_id) VALUES ('ready-1','usr-seller')`).run();
  db.prepare(`INSERT INTO ready_pc (ready_pc_id, seller_id) VALUES ('ready-legacy',NULL)`).run();
  db.prepare(`INSERT INTO part (part_id, category) VALUES ('cpu-1','cpu')`).run();
  db.prepare(
    `INSERT INTO order_header (order_id, user_id, total_kopecks, status, address, user_name)
     VALUES ('ord-1','usr-cust',100,'new','Москва','Клиент')`,
  ).run();
  db.prepare(
    `INSERT INTO order_item (order_id, position, kind, ref_id, name, price_kopecks, count)
     VALUES ('ord-1',0,'ready','ready-1','Сборка',100,1)`,
  ).run();
  db.prepare(
    `INSERT INTO order_item (order_id, position, kind, ref_id, name, price_kopecks, count)
     VALUES ('ord-1',1,'config','cpu-1','Процессор',50,1)`,
  ).run();
  return db;
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

test("v9 migration adds order_item.seller_id/category and 'cancelled' CHECK", () => {
  const db = preV9Db();
  assert.ok(!columns(db, "order_item").includes("seller_id"));
  assert.ok(!columns(db, "order_item").includes("category"));

  migrateOrderAttributionAndCancel(db);

  assert.ok(columns(db, "order_item").includes("seller_id"));
  assert.ok(columns(db, "order_item").includes("category"));
  // The seller FK must exist after the upgrade (ALTER ADD COLUMN cannot add it).
  const fks = db.prepare(`PRAGMA foreign_key_list(order_item)`).all() as {
    from: string;
    table: string;
    on_delete: string;
  }[];
  const sellerFk = fks.find((f) => f.from === "seller_id");
  assert.ok(sellerFk, "order_item.seller_id FK should exist after migration");
  assert.equal(sellerFk!.table, "user_account");
  assert.equal(sellerFk!.on_delete, "SET NULL");
  const header = db
    .prepare(`SELECT sql FROM sqlite_master WHERE name='order_header'`)
    .get() as { sql: string };
  assert.match(header.sql, /cancelled/);

  // The widened CHECK now accepts 'cancelled' and rows survive the rebuild.
  db.prepare(`UPDATE order_header SET status='cancelled' WHERE order_id='ord-1'`).run();
  assert.equal(
    (db.prepare(`SELECT status FROM order_header WHERE order_id='ord-1'`).get() as { status: string }).status,
    "cancelled",
  );
  db.close();
});

test("v9 migration backfills ready seller and config category", () => {
  const db = preV9Db();
  migrateOrderAttributionAndCancel(db);

  const ready = db
    .prepare(`SELECT seller_id, category FROM order_item WHERE kind='ready'`)
    .get() as { seller_id: string | null; category: string | null };
  assert.equal(ready.seller_id, "usr-seller");
  assert.equal(ready.category, null);

  const config = db
    .prepare(`SELECT seller_id, category FROM order_item WHERE kind='config'`)
    .get() as { seller_id: string | null; category: string | null };
  // Config attribution is historically unrecoverable (ref_id is a part id).
  assert.equal(config.seller_id, null);
  assert.equal(config.category, "cpu");
  db.close();
});

test("v9 migration is idempotent", () => {
  const db = preV9Db();
  migrateOrderAttributionAndCancel(db);
  const first = db
    .prepare(`SELECT seller_id, category FROM order_item ORDER BY position`)
    .all();
  migrateOrderAttributionAndCancel(db);
  const second = db
    .prepare(`SELECT seller_id, category FROM order_item ORDER BY position`)
    .all();
  assert.deepEqual(second, first);
  // FK integrity holds after the order_header rebuild.
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("v9 migration self-heals a seller_id column added without its FK", () => {
  const db = preV9Db();
  // Simulate an earlier build that added the bare columns via ALTER TABLE.
  db.exec(`ALTER TABLE order_item ADD COLUMN seller_id TEXT`);
  db.exec(`ALTER TABLE order_item ADD COLUMN category TEXT`);
  const before = db.prepare(`PRAGMA foreign_key_list(order_item)`).all() as {
    from: string;
  }[];
  assert.ok(!before.some((f) => f.from === "seller_id"), "precondition: no FK yet");

  migrateOrderAttributionAndCancel(db);

  const after = db.prepare(`PRAGMA foreign_key_list(order_item)`).all() as {
    from: string;
    table: string;
  }[];
  assert.ok(
    after.some((f) => f.from === "seller_id" && f.table === "user_account"),
    "seller FK should be added on the self-heal rebuild",
  );
  // Existing data is preserved through the rebuild.
  assert.equal(
    (db.prepare(`SELECT count(*) AS c FROM order_item`).get() as { c: number }).c,
    2,
  );
  db.close();
});

test("v10 migration widens the order_header CHECK to 'alpha_rejected'", () => {
  const db = preV9Db();
  // Bring the pre-v10 DB up to v9 first (order_header accepts 'cancelled').
  migrateOrderAttributionAndCancel(db);
  assert.doesNotMatch(
    (db.prepare(`SELECT sql FROM sqlite_master WHERE name='order_header'`).get() as { sql: string }).sql,
    /alpha_rejected/,
  );

  migrateOrderRejectedStatus(db);

  const header = (db
    .prepare(`SELECT sql FROM sqlite_master WHERE name='order_header'`)
    .get()) as { sql: string };
  assert.match(header.sql, /alpha_rejected/);

  // The widened CHECK accepts the new status and rows survive the rebuild.
  db.prepare(`UPDATE order_header SET status='alpha_rejected' WHERE order_id='ord-1'`).run();
  assert.equal(
    (db.prepare(`SELECT status FROM order_header WHERE order_id='ord-1'`).get() as { status: string })
      .status,
    "alpha_rejected",
  );
  // FK integrity holds after the rebuild (child order_item points at the real table).
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("v10 migration is idempotent", () => {
  const db = preV9Db();
  migrateOrderAttributionAndCancel(db);
  migrateOrderRejectedStatus(db);
  const first = db.prepare(`SELECT * FROM order_header ORDER BY order_id`).all();
  migrateOrderRejectedStatus(db);
  const second = db.prepare(`SELECT * FROM order_header ORDER BY order_id`).all();
  assert.deepEqual(second, first);
  db.close();
});