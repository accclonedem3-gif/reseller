ALTER TABLE "orders"
ADD COLUMN "provider_order_id" TEXT,
ADD COLUMN "provider_order_code" TEXT;

-- Preserve the external lookup reference previously overloaded into
-- internal_source_order_code. The display code is backfilled from each
-- provider API separately because RoboticVN uses a different display_id.
UPDATE "orders"
SET "provider_order_id" = "internal_source_order_code"
WHERE "source_provider_kind_snapshot" = 'EXTERNAL'
  AND "internal_source_order_code" IS NOT NULL;

-- Some older rows predate source_provider_kind_snapshot. Their source product
-- relation still identifies them as external-provider orders.
UPDATE "orders" AS "order"
SET "provider_order_id" = "order"."internal_source_order_code"
FROM "source_products" AS "product"
WHERE "order"."source_product_id" = "product"."id"
  AND "product"."provider_source_id" IS NOT NULL
  AND "order"."provider_order_id" IS NULL
  AND "order"."internal_source_order_code" IS NOT NULL;

CREATE INDEX "orders_provider_order_code_idx"
ON "orders"("provider_order_code");
