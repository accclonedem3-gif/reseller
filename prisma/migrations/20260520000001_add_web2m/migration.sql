-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'WEB2M';

-- AlterTable
ALTER TABLE "payment_configs" ADD COLUMN "web2m_account_number" TEXT;
ALTER TABLE "payment_configs" ADD COLUMN "web2m_bank_code" TEXT;
ALTER TABLE "payment_configs" ADD COLUMN "web2m_password_encrypted" TEXT;
ALTER TABLE "payment_configs" ADD COLUMN "web2m_token_encrypted" TEXT;
