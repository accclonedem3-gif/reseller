ALTER TYPE "PaymentProvider" ADD VALUE 'USDT_TRC20';

ALTER TABLE "payment_configs"
ADD COLUMN "usdt_trc20_address" TEXT;
