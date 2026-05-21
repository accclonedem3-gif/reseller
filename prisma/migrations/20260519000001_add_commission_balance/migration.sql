-- AlterTable
ALTER TABLE "customer_wallets" ADD COLUMN "commission_balance" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "customer_wallet_ledgers" ADD COLUMN "commission_balance_before" DECIMAL(18,2);
ALTER TABLE "customer_wallet_ledgers" ADD COLUMN "commission_balance_after" DECIMAL(18,2);
