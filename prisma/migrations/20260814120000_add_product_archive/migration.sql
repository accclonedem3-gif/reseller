ALTER TABLE "source_products"
ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE INDEX "source_products_shop_id_archived_at_idx"
ON "source_products"("shop_id", "archived_at");
