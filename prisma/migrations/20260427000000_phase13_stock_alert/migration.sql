ALTER TABLE "source_products" ADD COLUMN "stock_alert_threshold" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "source_products" ADD COLUMN "stock_alert_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "source_products" ADD COLUMN "last_stock_alert_at" TIMESTAMP(3);
