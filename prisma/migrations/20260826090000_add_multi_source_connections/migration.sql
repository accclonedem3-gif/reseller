-- A shop may own multiple independent provider credentials. Every catalog row
-- records both its provider source and a required scope so overlapping product
-- ids from different providers never overwrite each other.
ALTER TABLE "source_products"
ADD COLUMN "internal_source_connection_id" TEXT,
ADD COLUMN "provider_source_id" TEXT,
ADD COLUMN "source_scope" TEXT NOT NULL DEFAULT 'legacy';

CREATE TABLE "shop_provider_sources" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "buyer_key_encrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source_notification_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "price_markup_percent" DECIMAL(5,2),
    "connection_status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "last_verified_at" TIMESTAMP(3),
    "last_catalog_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shop_provider_sources_pkey" PRIMARY KEY ("id")
);

INSERT INTO "shop_provider_sources" (
    "id", "shop_id", "label", "provider_name", "base_url",
    "buyer_key_encrypted", "enabled", "source_notification_sync_enabled",
    "price_markup_percent", "connection_status", "last_verified_at",
    "last_catalog_sync_at", "created_at", "updated_at"
)
SELECT
    config."id", config."shop_id", config."provider_name",
    config."provider_name", config."base_url", config."buyer_key_encrypted",
    true, config."source_notification_sync_enabled", config."price_markup_percent",
    config."connection_status", config."last_verified_at", shop."last_catalog_sync_at",
    config."created_at", config."updated_at"
FROM "provider_configs" AS config
JOIN "shops" AS shop ON shop."id" = config."shop_id"
WHERE config."provider_kind" = 'EXTERNAL'
  AND config."buyer_key_encrypted" <> '';

UPDATE "source_products" AS product
SET "provider_source_id" = source."id",
    "source_scope" = 'provider:' || source."id"
FROM "provider_configs" AS config
JOIN "shop_provider_sources" AS source ON source."id" = config."id"
WHERE config."shop_id" = product."shop_id"
  AND source."shop_id" = product."shop_id"
  AND config."provider_kind" = 'EXTERNAL'
  AND product."provider_name" NOT IN ('manual', 'disconnected_archive');

UPDATE "source_products" AS product
SET "internal_source_connection_id" = config."internal_source_connection_id",
    "source_scope" = 'internal:' || config."internal_source_connection_id"
FROM "provider_configs" AS config
WHERE config."shop_id" = product."shop_id"
  AND config."internal_source_connection_id" IS NOT NULL
  AND product."provider_name" = 'internal_pro';

DROP INDEX "source_products_shop_id_external_product_id_key";
CREATE UNIQUE INDEX "source_products_shop_id_source_scope_external_product_id_key"
ON "source_products"("shop_id", "source_scope", "external_product_id");
CREATE INDEX "source_products_internal_source_connection_id_idx"
ON "source_products"("internal_source_connection_id");
CREATE INDEX "source_products_provider_source_id_idx"
ON "source_products"("provider_source_id");
CREATE INDEX "shop_provider_sources_shop_id_enabled_created_at_idx"
ON "shop_provider_sources"("shop_id", "enabled", "created_at");

ALTER TABLE "source_products"
ADD CONSTRAINT "source_products_internal_source_connection_id_fkey"
FOREIGN KEY ("internal_source_connection_id")
REFERENCES "downstream_source_connections"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shop_provider_sources"
ADD CONSTRAINT "shop_provider_sources_shop_id_fkey"
FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "source_products"
ADD CONSTRAINT "source_products_provider_source_id_fkey"
FOREIGN KEY ("provider_source_id") REFERENCES "shop_provider_sources"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
