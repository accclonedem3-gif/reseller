-- Backfill: enable all source products for ULTRA sellers so PRO bots can see them
UPDATE source_products sp
SET internal_source_enabled = true
FROM shops sh
JOIN sellers s ON s.id = sh.seller_id
WHERE sp.shop_id = sh.id
  AND s.tier = 'ULTRA'
  AND sp.internal_source_enabled = false;
