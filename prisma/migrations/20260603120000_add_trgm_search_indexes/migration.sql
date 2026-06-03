-- Public warranty lookup searches account text with ILIKE '%query%' (publicSearchOrders +
-- checkTelegramWarrantyEligibility). A plain b-tree can't serve a leading-wildcard LIKE, so the
-- query did a sequential scan over every DELIVERED order's delivered_account_text — slow on shops
-- with tens of thousands of orders, on a customer-facing (rate-limited) endpoint.
--
-- pg_trgm GIN indexes make ILIKE '%q%' index-assisted. IF NOT EXISTS keeps this idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "orders_delivered_account_text_trgm_idx"
  ON "orders" USING gin ("delivered_account_text" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "warranty_claims_delivered_account_text_trgm_idx"
  ON "warranty_claims" USING gin ("delivered_account_text" gin_trgm_ops);
