-- CreateEnum
CREATE TYPE "StorefrontMode" AS ENUM ('TELEGRAM_ONLY', 'HYBRID', 'WEB_ONLY');

-- CreateEnum
CREATE TYPE "WarrantyClaimStatus" AS ENUM (
  'PENDING',
  'AUTO_RESOLVED',
  'PENDING_STOCK',
  'PENDING_REVIEW',
  'PENDING_MANUAL',
  'REJECTED',
  'RESOLVED_MANUAL'
);

-- AlterTable
ALTER TABLE "shops"
ADD COLUMN IF NOT EXISTS "storefront_mode" "StorefrontMode" NOT NULL DEFAULT 'TELEGRAM_ONLY',
ADD COLUMN IF NOT EXISTS "storefront_config_json" JSONB;

-- AlterTable
ALTER TABLE "orders"
ADD COLUMN IF NOT EXISTS "warranty_policy_snapshot" "SourceWarrantyPolicy",
ADD COLUMN IF NOT EXISTS "warranty_delivery_mode_snapshot" "SourceDeliveryMode",
ADD COLUMN IF NOT EXISTS "warranty_started_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "warranty_expires_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "warranty_claim_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "warranty_claims" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "seller_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "claim_number" INTEGER NOT NULL,
  "status" "WarrantyClaimStatus" NOT NULL DEFAULT 'PENDING',
  "order_code_snapshot" TEXT NOT NULL,
  "product_name_snapshot" TEXT NOT NULL,
  "warranty_policy_snapshot" "SourceWarrantyPolicy",
  "delivery_mode_snapshot" "SourceDeliveryMode",
  "customer_message" TEXT,
  "delivered_account_text" TEXT,
  "resolution_note" TEXT,
  "metadata_json" JSONB,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claims_order_id_claim_number_key"
ON "warranty_claims"("order_id", "claim_number");

-- CreateIndex
CREATE INDEX "warranty_claims_seller_id_status_created_at_idx"
ON "warranty_claims"("seller_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "warranty_claims_shop_id_status_created_at_idx"
ON "warranty_claims"("shop_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "warranty_claims_customer_id_created_at_idx"
ON "warranty_claims"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "warranty_claims"
ADD CONSTRAINT "warranty_claims_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims"
ADD CONSTRAINT "warranty_claims_seller_id_fkey"
FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims"
ADD CONSTRAINT "warranty_claims_shop_id_fkey"
FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims"
ADD CONSTRAINT "warranty_claims_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
