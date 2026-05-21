CREATE TABLE "shop_catalog_groups" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_catalog_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shop_catalog_groups_shop_id_position_idx" ON "shop_catalog_groups"("shop_id", "position");

ALTER TABLE "seller_product_overrides" ADD COLUMN "group_id" TEXT;

ALTER TABLE "shop_catalog_groups" ADD CONSTRAINT "shop_catalog_groups_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seller_product_overrides" ADD CONSTRAINT "seller_product_overrides_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "shop_catalog_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
