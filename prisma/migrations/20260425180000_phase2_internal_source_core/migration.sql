-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('EXTERNAL', 'INTERNAL');

-- CreateEnum
CREATE TYPE "InternalSourceApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DownstreamSourceConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "InternalSourceLedgerType" AS ENUM ('TOPUP', 'DEBIT_ORDER', 'REFUND_ORDER', 'ADJUST');

-- CreateEnum
CREATE TYPE "InternalSourceOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'PENDING_STOCK', 'PENDING_MANUAL', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SourceProductFamily" AS ENUM ('CHATGPT', 'VEO3', 'CLAUDE', 'GEMINI', 'CANVA', 'CAPCUT', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceAccountType" AS ENUM ('PERSONAL', 'SHARED', 'ADD_FAMILY', 'CREDIT_API', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceDurationType" AS ENUM ('DAY_1', 'DAY_7', 'MONTH_1', 'MONTH_3', 'MONTH_6', 'MONTH_12', 'LIFETIME', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceDeliveryMode" AS ENUM ('AUTO_API', 'AUTO_STOCK', 'MANUAL');

-- CreateEnum
CREATE TYPE "SourceWarrantyPolicy" AS ENUM ('KBH', 'BH24H', 'BH1M', 'BH6M', 'BH12M');

-- AlterTable
ALTER TABLE "provider_configs"
ADD COLUMN IF NOT EXISTS "provider_kind" "ProviderKind" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN IF NOT EXISTS "internal_source_connection_id" TEXT;

-- AlterTable
ALTER TABLE "source_products"
ADD COLUMN IF NOT EXISTS "internal_source_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "internal_source_price" DECIMAL(18, 2),
ADD COLUMN IF NOT EXISTS "product_family" "SourceProductFamily",
ADD COLUMN IF NOT EXISTS "product_family_other" TEXT,
ADD COLUMN IF NOT EXISTS "account_type" "SourceAccountType",
ADD COLUMN IF NOT EXISTS "account_type_other" TEXT,
ADD COLUMN IF NOT EXISTS "duration_type" "SourceDurationType",
ADD COLUMN IF NOT EXISTS "duration_type_other" TEXT,
ADD COLUMN IF NOT EXISTS "source_delivery_mode" "SourceDeliveryMode",
ADD COLUMN IF NOT EXISTS "warranty_policy" "SourceWarrantyPolicy";

-- AlterTable
ALTER TABLE "orders"
ADD COLUMN IF NOT EXISTS "source_provider_kind_snapshot" "ProviderKind",
ADD COLUMN IF NOT EXISTS "internal_source_order_id" TEXT,
ADD COLUMN IF NOT EXISTS "internal_source_order_code" TEXT;

-- CreateTable
CREATE TABLE "internal_source_api_keys" (
  "id" TEXT NOT NULL,
  "seller_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "note" TEXT,
  "key_prefix" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "status" "InternalSourceApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "internal_source_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downstream_source_connections" (
  "id" TEXT NOT NULL,
  "upstream_seller_id" TEXT NOT NULL,
  "upstream_shop_id" TEXT NOT NULL,
  "downstream_seller_id" TEXT NOT NULL,
  "downstream_shop_id" TEXT NOT NULL,
  "api_key_id" TEXT,
  "status" "DownstreamSourceConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "label" TEXT,
  "balance" DECIMAL(18, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "last_catalog_sync_at" TIMESTAMP(3),
  "last_ordered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "downstream_source_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_source_ledgers" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "type" "InternalSourceLedgerType" NOT NULL,
  "amount" DECIMAL(18, 2) NOT NULL,
  "balance_before" DECIMAL(18, 2) NOT NULL,
  "balance_after" DECIMAL(18, 2) NOT NULL,
  "reference_type" TEXT,
  "reference_id" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "internal_source_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_source_orders" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "api_key_id" TEXT NOT NULL,
  "upstream_seller_id" TEXT NOT NULL,
  "upstream_shop_id" TEXT NOT NULL,
  "downstream_seller_id" TEXT NOT NULL,
  "downstream_shop_id" TEXT NOT NULL,
  "source_product_id" TEXT NOT NULL,
  "source_order_code" TEXT NOT NULL,
  "downstream_order_code" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit_price" DECIMAL(18, 2) NOT NULL,
  "source_price_snapshot" DECIMAL(18, 2) NOT NULL,
  "total_amount" DECIMAL(18, 2) NOT NULL,
  "status" "InternalSourceOrderStatus" NOT NULL DEFAULT 'PENDING',
  "delivered_account_text" TEXT,
  "failure_reason" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "delivered_at" TIMESTAMP(3),

  CONSTRAINT "internal_source_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_source_order_events" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "internal_source_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_source_access_logs" (
  "id" TEXT NOT NULL,
  "api_key_id" TEXT NOT NULL,
  "connection_id" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status_code" INTEGER,
  "ip_address" TEXT,
  "request_body_json" JSONB,
  "response_body_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "internal_source_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_configs_internal_source_connection_id_key" ON "provider_configs"("internal_source_connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_internal_source_order_id_key" ON "orders"("internal_source_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "internal_source_api_keys_key_hash_key" ON "internal_source_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "internal_source_api_keys_seller_id_status_created_at_idx" ON "internal_source_api_keys"("seller_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "downstream_source_connections_api_key_id_key" ON "downstream_source_connections"("api_key_id");

-- CreateIndex
CREATE UNIQUE INDEX "downstream_source_connections_upstream_shop_id_downstream_shop_i_key" ON "downstream_source_connections"("upstream_shop_id", "downstream_shop_id");

-- CreateIndex
CREATE INDEX "downstream_source_connections_downstream_seller_id_status_creat_idx" ON "downstream_source_connections"("downstream_seller_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "downstream_source_connections_upstream_seller_id_status_created_idx" ON "downstream_source_connections"("upstream_seller_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "internal_source_ledgers_connection_id_created_at_idx" ON "internal_source_ledgers"("connection_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "internal_source_orders_source_order_code_key" ON "internal_source_orders"("source_order_code");

-- CreateIndex
CREATE INDEX "internal_source_orders_connection_id_created_at_idx" ON "internal_source_orders"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_source_orders_source_product_id_created_at_idx" ON "internal_source_orders"("source_product_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_source_orders_status_created_at_idx" ON "internal_source_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "internal_source_order_events_order_id_created_at_idx" ON "internal_source_order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_source_access_logs_api_key_id_created_at_idx" ON "internal_source_access_logs"("api_key_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_source_access_logs_connection_id_created_at_idx" ON "internal_source_access_logs"("connection_id", "created_at");

-- AddForeignKey
ALTER TABLE "provider_configs"
ADD CONSTRAINT "provider_configs_internal_source_connection_id_fkey"
FOREIGN KEY ("internal_source_connection_id") REFERENCES "downstream_source_connections"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders"
ADD CONSTRAINT "orders_internal_source_order_id_fkey"
FOREIGN KEY ("internal_source_order_id") REFERENCES "internal_source_orders"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_api_keys"
ADD CONSTRAINT "internal_source_api_keys_seller_id_fkey"
FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_api_keys"
ADD CONSTRAINT "internal_source_api_keys_shop_id_fkey"
FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downstream_source_connections"
ADD CONSTRAINT "downstream_source_connections_upstream_seller_id_fkey"
FOREIGN KEY ("upstream_seller_id") REFERENCES "sellers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downstream_source_connections"
ADD CONSTRAINT "downstream_source_connections_upstream_shop_id_fkey"
FOREIGN KEY ("upstream_shop_id") REFERENCES "shops"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downstream_source_connections"
ADD CONSTRAINT "downstream_source_connections_downstream_seller_id_fkey"
FOREIGN KEY ("downstream_seller_id") REFERENCES "sellers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downstream_source_connections"
ADD CONSTRAINT "downstream_source_connections_downstream_shop_id_fkey"
FOREIGN KEY ("downstream_shop_id") REFERENCES "shops"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downstream_source_connections"
ADD CONSTRAINT "downstream_source_connections_api_key_id_fkey"
FOREIGN KEY ("api_key_id") REFERENCES "internal_source_api_keys"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_ledgers"
ADD CONSTRAINT "internal_source_ledgers_connection_id_fkey"
FOREIGN KEY ("connection_id") REFERENCES "downstream_source_connections"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_orders"
ADD CONSTRAINT "internal_source_orders_connection_id_fkey"
FOREIGN KEY ("connection_id") REFERENCES "downstream_source_connections"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_orders"
ADD CONSTRAINT "internal_source_orders_api_key_id_fkey"
FOREIGN KEY ("api_key_id") REFERENCES "internal_source_api_keys"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_orders"
ADD CONSTRAINT "internal_source_orders_upstream_seller_id_fkey"
FOREIGN KEY ("upstream_seller_id") REFERENCES "sellers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_orders"
ADD CONSTRAINT "internal_source_orders_upstream_shop_id_fkey"
FOREIGN KEY ("upstream_shop_id") REFERENCES "shops"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_orders"
ADD CONSTRAINT "internal_source_orders_downstream_seller_id_fkey"
FOREIGN KEY ("downstream_seller_id") REFERENCES "sellers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_orders"
ADD CONSTRAINT "internal_source_orders_downstream_shop_id_fkey"
FOREIGN KEY ("downstream_shop_id") REFERENCES "shops"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_orders"
ADD CONSTRAINT "internal_source_orders_source_product_id_fkey"
FOREIGN KEY ("source_product_id") REFERENCES "source_products"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_order_events"
ADD CONSTRAINT "internal_source_order_events_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "internal_source_orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_access_logs"
ADD CONSTRAINT "internal_source_access_logs_api_key_id_fkey"
FOREIGN KEY ("api_key_id") REFERENCES "internal_source_api_keys"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_source_access_logs"
ADD CONSTRAINT "internal_source_access_logs_connection_id_fkey"
FOREIGN KEY ("connection_id") REFERENCES "downstream_source_connections"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
