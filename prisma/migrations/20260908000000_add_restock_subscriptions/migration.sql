CREATE TABLE IF NOT EXISTS "restock_subscriptions" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restock_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "restock_subscriptions_customer_id_source_product_id_key"
    ON "restock_subscriptions"("customer_id", "source_product_id");

CREATE INDEX IF NOT EXISTS "restock_subscriptions_shop_id_idx"
    ON "restock_subscriptions"("shop_id");

CREATE INDEX IF NOT EXISTS "restock_subscriptions_source_product_id_idx"
    ON "restock_subscriptions"("source_product_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'restock_subscriptions_shop_id_fkey'
    ) THEN
        ALTER TABLE "restock_subscriptions"
            ADD CONSTRAINT "restock_subscriptions_shop_id_fkey"
            FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'restock_subscriptions_customer_id_fkey'
    ) THEN
        ALTER TABLE "restock_subscriptions"
            ADD CONSTRAINT "restock_subscriptions_customer_id_fkey"
            FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'restock_subscriptions_source_product_id_fkey'
    ) THEN
        ALTER TABLE "restock_subscriptions"
            ADD CONSTRAINT "restock_subscriptions_source_product_id_fkey"
            FOREIGN KEY ("source_product_id") REFERENCES "source_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
