-- Enums
ALTER TYPE "WalletLedgerType" ADD VALUE IF NOT EXISTS 'AFFILIATE_LEVEL_1';
ALTER TYPE "WalletLedgerType" ADD VALUE IF NOT EXISTS 'AFFILIATE_LEVEL_2';
ALTER TYPE "WalletLedgerType" ADD VALUE IF NOT EXISTS 'AFFILIATE_CLAWBACK';
ALTER TYPE "WalletLedgerType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PAYMENT';

DO $$ BEGIN
    CREATE TYPE "TierPlan" AS ENUM ('MONTHLY', 'SEMI_ANNUAL', 'ANNUAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TierSubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REFUNDED', 'CANCELED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Seller table extensions
ALTER TABLE "sellers"
    ADD COLUMN IF NOT EXISTS "referred_by_seller_id" TEXT,
    ADD COLUMN IF NOT EXISTS "referral_code" TEXT,
    ADD COLUMN IF NOT EXISTS "affiliate_unlocked_tier" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS "affiliate_unlocked_tier_2_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "affiliate_unlocked_tier_3_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "auto_renew_config" JSONB,
    ADD COLUMN IF NOT EXISTS "signup_ip" TEXT,
    ADD COLUMN IF NOT EXISTS "signup_device_fingerprint" TEXT;

-- Unique index on referral_code (nullable unique)
CREATE UNIQUE INDEX IF NOT EXISTS "sellers_referral_code_key" ON "sellers"("referral_code") WHERE "referral_code" IS NOT NULL;

-- FK for referredBy
ALTER TABLE "sellers"
    DROP CONSTRAINT IF EXISTS "sellers_referred_by_seller_id_fkey";
ALTER TABLE "sellers"
    ADD CONSTRAINT "sellers_referred_by_seller_id_fkey" FOREIGN KEY ("referred_by_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TierSubscription table
CREATE TABLE IF NOT EXISTS "tier_subscriptions" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "tier" "SellerTier" NOT NULL,
    "plan" "TierPlan" NOT NULL,
    "price_vnd" DECIMAL(18,2) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "TierSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "payment_method" TEXT,
    "payment_transaction_id" TEXT,
    "paid_from_wallet_balance" BOOLEAN NOT NULL DEFAULT false,
    "referrer_seller_id" TEXT,
    "grand_referrer_seller_id" TEXT,
    "level_1_rate" DECIMAL(5,4),
    "level_2_rate" DECIMAL(5,4),
    "level_1_commission_vnd" DECIMAL(18,2),
    "level_2_commission_vnd" DECIMAL(18,2),
    "refunded_at" TIMESTAMP(3),
    "is_admin_grant" BOOLEAN NOT NULL DEFAULT false,
    "admin_grant_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tier_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tier_subscriptions_seller_id_status_idx" ON "tier_subscriptions"("seller_id", "status");
CREATE INDEX IF NOT EXISTS "tier_subscriptions_ends_at_status_idx" ON "tier_subscriptions"("ends_at", "status");
CREATE INDEX IF NOT EXISTS "tier_subscriptions_referrer_seller_id_idx" ON "tier_subscriptions"("referrer_seller_id");

ALTER TABLE "tier_subscriptions"
    ADD CONSTRAINT "tier_subscriptions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tier_subscriptions"
    ADD CONSTRAINT "tier_subscriptions_referrer_seller_id_fkey" FOREIGN KEY ("referrer_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tier_subscriptions"
    ADD CONSTRAINT "tier_subscriptions_grand_referrer_seller_id_fkey" FOREIGN KEY ("grand_referrer_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill referral_code for existing sellers (random 8 char base36)
UPDATE "sellers"
SET "referral_code" = UPPER(SUBSTR(MD5(RANDOM()::TEXT || id), 1, 8))
WHERE "referral_code" IS NULL;
