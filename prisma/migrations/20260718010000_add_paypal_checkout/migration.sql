ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PAYPAL';

ALTER TABLE "payment_configs"
ADD COLUMN "paypal_client_id_encrypted" TEXT,
ADD COLUMN "paypal_client_secret_encrypted" TEXT,
ADD COLUMN "paypal_webhook_id" TEXT,
ADD COLUMN "paypal_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paypal_sandbox" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "paypal_vnd_rate_override" DECIMAL(18, 2);

ALTER TABLE "payment_transactions"
ADD COLUMN "provider_amount" DECIMAL(18, 4),
ADD COLUMN "provider_currency" TEXT,
ADD COLUMN "provider_reference" TEXT;

CREATE UNIQUE INDEX "payment_transactions_provider_reference_key"
ON "payment_transactions"("provider_reference");
