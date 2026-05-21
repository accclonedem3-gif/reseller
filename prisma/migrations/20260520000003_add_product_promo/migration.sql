-- AlterTable
ALTER TABLE "source_products" ADD COLUMN "promo_type" TEXT;
ALTER TABLE "source_products" ADD COLUMN "promo_buy_n" INTEGER;
ALTER TABLE "source_products" ADD COLUMN "promo_get_m" INTEGER;
ALTER TABLE "source_products" ADD COLUMN "promo_bulk_min_qty" INTEGER;
ALTER TABLE "source_products" ADD COLUMN "promo_bulk_discount_pct" DECIMAL(5,2);
