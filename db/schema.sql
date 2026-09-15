-- Confi SQLite schema (STRICT, WAL). Version 3.
-- DDL per plan section 2. Applied idempotently by db:init / db:seed.

PRAGMA user_version = 3;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS part (
  part_id       TEXT PRIMARY KEY,
  category      TEXT NOT NULL CHECK (category IN ('cpu','gpu','motherboard','ram','storage','case','psu','cooler')),
  name          TEXT NOT NULL,
  brand         TEXT NOT NULL,
  price_kopecks INTEGER NOT NULL CHECK (price_kopecks >= 0),
  tdp_watt      INTEGER NOT NULL DEFAULT 0 CHECK (tdp_watt BETWEEN 0 AND 65355),
  compat_json   TEXT NOT NULL,
  specs_json    TEXT NOT NULL DEFAULT '[]',
  image_url     TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS ready_pc (
  ready_pc_id   TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  brand         TEXT NOT NULL,
  usage         TEXT NOT NULL CHECK (usage IN ('gaming','work','video','universal')),
  price_kopecks INTEGER NOT NULL CHECK (price_kopecks >= 0),
  tdp_watt      INTEGER NOT NULL DEFAULT 0,
  summary       TEXT NOT NULL,
  specs_json    TEXT NOT NULL DEFAULT '[]',
  image_url     TEXT,
  in_stock      INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0,1)),
  rating        REAL NOT NULL DEFAULT 5 CHECK (rating BETWEEN 0 AND 5),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- junction: ready PC <-> component
CREATE TABLE IF NOT EXISTS ready_pc_part (
  ready_pc_id TEXT NOT NULL,
  part_id     TEXT NOT NULL,
  category    TEXT NOT NULL,
  PRIMARY KEY (ready_pc_id, category),
  UNIQUE (ready_pc_id, part_id),
  FOREIGN KEY (ready_pc_id) REFERENCES ready_pc(ready_pc_id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES part(part_id) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_account (
  user_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  role       TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','seller','admin')),
  company    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (email)
) STRICT;

CREATE TABLE IF NOT EXISTS config (
  config_id  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT 'Моя сборка',
  source     TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('custom','auto','ready')),
  usage      TEXT CHECK (usage IN ('gaming','work','video','universal')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS config_part (
  config_id TEXT NOT NULL,
  category  TEXT NOT NULL CHECK (category IN ('cpu','gpu','motherboard','ram','storage','case','psu','cooler')),
  part_id   TEXT NOT NULL,
  PRIMARY KEY (config_id, category),
  FOREIGN KEY (config_id) REFERENCES config(config_id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES part(part_id) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS order_header (
  order_id      TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  total_kopecks INTEGER NOT NULL CHECK (total_kopecks >= 0),
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','delivery','done','alpha')),
  address       TEXT NOT NULL,
  user_name     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS order_item (
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

CREATE TABLE IF NOT EXISTS review (
  review_id   TEXT PRIMARY KEY,
  ready_pc_id TEXT,
  entity_slug TEXT,
  author      TEXT NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ( (ready_pc_id IS NOT NULL AND entity_slug IS NULL)
       OR (ready_pc_id IS NULL AND entity_slug IS NOT NULL) ),
  FOREIGN KEY (ready_pc_id) REFERENCES ready_pc(ready_pc_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS app_setting (
  setting_id    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  setting_key   TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, setting_key),
  FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE CASCADE
) STRICT;

-- Active auth sessions (replaces alfagen:session / client-side session).
CREATE TABLE IF NOT EXISTS auth_session (
  session_id TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE CASCADE
) STRICT;

-- Pending phone/SMS verification (replaces alfagen:pendingAuth).
CREATE TABLE IF NOT EXISTS auth_pending (
  phone      TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

-- Seller <-> brand ownership (1-to-many: a seller owns many brands).
CREATE TABLE IF NOT EXISTS seller_brand (
  seller_id TEXT NOT NULL,
  brand     TEXT NOT NULL,
  PRIMARY KEY (seller_id, brand),
  FOREIGN KEY (seller_id) REFERENCES user_account(user_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

-- Generic key/value store for small app state (replaces remaining alfagen:* keys).
CREATE TABLE IF NOT EXISTS kv_store (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- Telemetry: anonymized user-action events ingested from the SPA analytics client.
CREATE TABLE IF NOT EXISTS analytics_events (
  event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  session_id TEXT,
  user_id    TEXT,
  event      TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error','critical')),
  route      TEXT,
  payload    TEXT NOT NULL DEFAULT '{}',
  ua         TEXT,
  build      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_analytics_ts    ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event);
CREATE INDEX IF NOT EXISTS idx_analytics_user  ON analytics_events(user_id);

-- Indexes (plan section 2)
CREATE INDEX IF NOT EXISTS idx_ready_pc_usage  ON ready_pc(usage);
CREATE INDEX IF NOT EXISTS idx_ready_pc_price  ON ready_pc(price_kopecks);
CREATE INDEX IF NOT EXISTS idx_ready_pc_rating ON ready_pc(rating DESC);
CREATE INDEX IF NOT EXISTS idx_part_active     ON part(category, is_active);
CREATE INDEX IF NOT EXISTS idx_config_user_id  ON config(user_id);
CREATE INDEX IF NOT EXISTS idx_config_updated  ON config(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_user      ON order_header(user_id);
CREATE INDEX IF NOT EXISTS idx_review_ready    ON review(ready_pc_id);
CREATE INDEX IF NOT EXISTS idx_review_entity   ON review(entity_slug);
CREATE INDEX IF NOT EXISTS idx_session_user    ON auth_session(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_phone   ON auth_pending(phone);