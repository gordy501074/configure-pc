-- SQLite data verification (plan section 3, step 8).
-- Run with better-sqlite3's CLI or: node db/schema.js (the seed script prints counts).
-- Paste into: sqlite3 db/confi.db ".read db/verify.sql"

-- 1. Row counts for every table.
SELECT 'part'            AS entity, count(*) AS rows FROM part
UNION ALL SELECT 'ready_pc',         count(*) FROM ready_pc
UNION ALL SELECT 'ready_pc_part',    count(*) FROM ready_pc_part
UNION ALL SELECT 'user_account',     count(*) FROM user_account
UNION ALL SELECT 'config',           count(*) FROM config
UNION ALL SELECT 'config_part',      count(*) FROM config_part
UNION ALL SELECT 'order_header',     count(*) FROM order_header
UNION ALL SELECT 'order_item',       count(*) FROM order_item
UNION ALL SELECT 'review',           count(*) FROM review
UNION ALL SELECT 'app_setting',      count(*) FROM app_setting;

-- FK integrity: orphaned junction rows should be 0.
SELECT 'orphan_ready_pc_part' AS check_name,
  (SELECT count(*) FROM ready_pc_part rpp
    LEFT JOIN ready_pc r ON r.ready_pc_id = rpp.ready_pc_id
    LEFT JOIN part p ON p.part_id = rpp.part_id
    WHERE r.ready_pc_id IS NULL OR p.part_id IS NULL) AS orphan_count
UNION ALL SELECT 'orphan_config_part', (
  SELECT count(*) FROM config_part cp
    LEFT JOIN config c ON c.config_id = cp.config_id
    LEFT JOIN part p ON p.part_id = cp.part_id
    WHERE c.config_id IS NULL OR p.part_id IS NULL)
UNION ALL SELECT 'orphan_order_item', (
  SELECT count(*) FROM order_item oi
    LEFT JOIN order_header oh ON oh.order_id = oi.order_id
    WHERE oh.order_id IS NULL);

-- 3. Sanity aggregates.
SELECT
  (SELECT count(DISTINCT category) FROM part)            AS part_categories,
  (SELECT sum(price_kopecks) FROM part)                  AS part_price_kopecks,
  (SELECT count(*) FROM part WHERE is_active <> 1)       AS inactive_parts,
  (SELECT count(*) FROM config_part WHERE part_id NOT IN (SELECT part_id FROM part)) AS dangling_config_parts;

-- 4. Sample first 10 configs with their part-row-count (plan verification target).
SELECT c.config_id, c.name, count(cp.part_id) AS parts_in_config
FROM config c
LEFT JOIN config_part cp ON cp.config_id = c.config_id
GROUP BY c.config_id, c.name
ORDER BY c.created_at DESC
LIMIT 10;