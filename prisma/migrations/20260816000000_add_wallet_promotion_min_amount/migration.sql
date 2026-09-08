ALTER TABLE "wallet_promotions"
ADD COLUMN IF NOT EXISTS "min_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "wallet_promotions_shop_id_start_at_end_at_idx";
CREATE INDEX IF NOT EXISTS "wallet_promotions_shop_id_start_at_end_at_min_amount_idx"
ON "wallet_promotions"("shop_id", "start_at", "end_at", "min_amount");
