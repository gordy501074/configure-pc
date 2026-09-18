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
UNION ALL SELECT 'app_setting',      count(*) FROM app_setting
UNION ALL SELECT 'seller_brand',     count(*) FROM seller_brand
UNION ALL SELECT 'auth_session',     count(*) FROM auth_session;

-- 1b. Role users exist as expected (admin & seller, no phone for them).
SELECT
  (SELECT count(*) FROM user_account WHERE role='admin')  AS admin_count,
  (SELECT count(*) FROM user_account WHERE role='seller') AS seller_count,
  (SELECT count(*) FROM user_account WHERE role='customer') AS customer_count,
  (SELECT count(*) FROM user_account WHERE role IN ('admin','seller') AND phone IS NOT NULL) AS roles_with_phone,
  (SELECT count(*) FROM seller_brand sb JOIN user_account u ON u.user_id=sb.seller_id
     WHERE u.role='seller' AND sb.brand='Confi') AS confi_seller_brand,
  (SELECT count(*) FROM seller_brand sb WHERE sb.brand='Confi' AND sb.description IS NOT NULL) AS seller_brand_has_description;

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
  (SELECT count(*) FROM part WHERE is_active <> 1)       AS inactive_parts,
  (SELECT count(*) FROM price_list)                      AS price_lists,
  (SELECT count(*) FROM price_list_item)                 AS price_list_items,
  (SELECT count(*) FROM price_list WHERE is_active = 1)  AS active_price_lists,
  (SELECT count(*) FROM config_part WHERE part_id NOT IN (SELECT part_id FROM part)) AS dangling_config_parts;

-- 3b. Price-list / seller binding sanity (plan v7):
--   - part price removed: sum of part price_kopecks is gone by design (column absent)
--   - active ConfiГУРА price list exists
--   - config / ready_pc bound to a seller.
SELECT
  (SELECT count(*) FROM price_list pl
     JOIN user_account u ON u.user_id = pl.seller_id
    WHERE u.role = 'seller' AND pl.is_active = 1)        AS active_seller_price_lists,
  (SELECT count(*) FROM config WHERE seller_id IS NOT NULL)   AS configs_with_seller,
  (SELECT count(*) FROM ready_pc WHERE seller_id IS NOT NULL) AS ready_pcs_with_seller,
  (SELECT count(DISTINCT c.seller_id) FROM config c
     JOIN price_list pl ON pl.seller_id = c.seller_id)   AS config_sellers_with_price_list;

-- 4. Sample first 10 configs with their part-row-count (plan verification target).
SELECT c.config_id, c.name, count(cp.part_id) AS parts_in_config
FROM config c
LEFT JOIN config_part cp ON cp.config_id = c.config_id
GROUP BY c.config_id, c.name
ORDER BY c.created_at DESC
LIMIT 10;