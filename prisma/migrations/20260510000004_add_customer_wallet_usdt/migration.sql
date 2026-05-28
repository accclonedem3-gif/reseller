ALTER TABLE "customer_wallets" ADD COLUMN "balance_usdt" DECIMAL(18,8) NOT NULL DEFAULT 0;
ALTER TABLE "customer_wallet_ledgers" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'VND';
