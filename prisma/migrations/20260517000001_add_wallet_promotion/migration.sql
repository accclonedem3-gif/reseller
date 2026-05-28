-- AlterEnum
ALTER TYPE "CustomerWalletLedgerType" ADD VALUE IF NOT EXISTS 'TOPUP_BONUS';

-- AlterTable
ALTER TABLE "customer_wallet_topups"
ADD COLUMN IF NOT EXISTS "bonus_percent" DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS "bonus_amount" DECIMAL(18,2);

-- CreateTable
CREATE TABLE IF NOT EXISTS "wallet_promotions" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "bonus_percent" DECIMAL(5,2) NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wallet_promotions_shop_id_start_at_end_at_idx" ON "wallet_promotions"("shop_id", "start_at", "end_at");

-- AddForeignKey
ALTER TABLE "wallet_promotions" DROP CONSTRAINT IF EXISTS "wallet_promotions_shop_id_fkey";
ALTER TABLE "wallet_promotions" ADD CONSTRAINT "wallet_promotions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
