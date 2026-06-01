-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'USDT_SOL';

-- AlterTable
ALTER TABLE "payment_configs" ADD COLUMN "usdt_solana_address" TEXT;
