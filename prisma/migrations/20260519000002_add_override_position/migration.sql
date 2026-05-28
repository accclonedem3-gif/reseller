-- AlterTable
ALTER TABLE "seller_product_overrides" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex (optional, for sort performance)
CREATE INDEX "seller_product_overrides_seller_position_idx" ON "seller_product_overrides"("seller_id", "position");
