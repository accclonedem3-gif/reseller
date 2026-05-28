UPDATE "customer_wallets"
SET "balance_usdt" = ROUND((balance / 27000)::numeric, 8)
WHERE "balance_usdt" = 0 AND balance > 0;
