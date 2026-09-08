ALTER TABLE "source_products"
ADD COLUMN "preorder_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "preorder_fee_percent" DECIMAL(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE "orders"
ADD COLUMN "is_preorder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "preorder_fee_percent" DECIMAL(5, 2) NOT NULL DEFAULT 0,
ADD COLUMN "preorder_fee_amount" DECIMAL(18, 2) NOT NULL DEFAULT 0;

CREATE INDEX "orders_source_product_id_is_preorder_status_paid_at_idx"
ON "orders"("source_product_id", "is_preorder", "status", "paid_at");
