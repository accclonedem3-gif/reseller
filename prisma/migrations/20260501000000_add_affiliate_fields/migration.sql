-- Add affiliate fields to customers table
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "referred_by_id" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "referral_code" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'customers_referral_code_key') THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_referral_code_key" UNIQUE ("referral_code");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_referred_by_id_fkey') THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_referred_by_id_fkey"
      FOREIGN KEY ("referred_by_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Add affiliate fields to orders table
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "affiliate_customer_id" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "affiliate_commission" DECIMAL(18, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_affiliate_customer_id_fkey') THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliate_customer_id_fkey"
      FOREIGN KEY ("affiliate_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Create referral_links table
CREATE TABLE IF NOT EXISTS "referral_links" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "seller_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "referral_links_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'referral_links_code_key') THEN
    ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_code_key" UNIQUE ("code");
  END IF;
END $$;

-- Create referral_events table
CREATE TABLE IF NOT EXISTS "referral_events" (
  "id" TEXT NOT NULL,
  "referral_link_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "event_type" TEXT NOT NULL,
  "payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_events_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_events_referral_link_id_fkey') THEN
    ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referral_link_id_fkey"
      FOREIGN KEY ("referral_link_id") REFERENCES "referral_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_events_customer_id_fkey') THEN
    ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Create affiliate_configs table
CREATE TABLE IF NOT EXISTS "affiliate_configs" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "seller_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "commission_pct" DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "program_text" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "affiliate_configs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'affiliate_configs_shop_id_key') THEN
    ALTER TABLE "affiliate_configs" ADD CONSTRAINT "affiliate_configs_shop_id_key" UNIQUE ("shop_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_configs_shop_id_fkey') THEN
    ALTER TABLE "affiliate_configs" ADD CONSTRAINT "affiliate_configs_shop_id_fkey"
      FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_configs_seller_id_fkey') THEN
    ALTER TABLE "affiliate_configs" ADD CONSTRAINT "affiliate_configs_seller_id_fkey"
      FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
