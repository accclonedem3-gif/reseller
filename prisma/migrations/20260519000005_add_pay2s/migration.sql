-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'PAY2S';

-- AlterTable
ALTER TABLE "payment_configs" ADD COLUMN "pay2s_partner_code_encrypted" TEXT;
ALTER TABLE "payment_configs" ADD COLUMN "pay2s_access_key_encrypted" TEXT;
ALTER TABLE "payment_configs" ADD COLUMN "pay2s_secret_key_encrypted" TEXT;
ALTER TABLE "payment_configs" ADD COLUMN "pay2s_bank_account" TEXT;
ALTER TABLE "payment_configs" ADD COLUMN "pay2s_bank_id" TEXT;
