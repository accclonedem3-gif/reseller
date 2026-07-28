ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'USDT_TON';

ALTER TABLE "payment_configs"
ADD COLUMN "usdt_ton_address" TEXT;

CREATE TABLE "onchain_payment_receipts" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "external_order_code" TEXT NOT NULL,
    "amount_usdt" DECIMAL(30,8) NOT NULL,
    "destination" TEXT NOT NULL,
    "transaction_at" TIMESTAMP(3) NOT NULL,
    "raw_payload_json" JSONB,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onchain_payment_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onchain_payment_receipts_external_order_code_key"
ON "onchain_payment_receipts"("external_order_code");

CREATE UNIQUE INDEX "onchain_payment_receipts_provider_tx_hash_key"
ON "onchain_payment_receipts"("provider", "tx_hash");

CREATE INDEX "onchain_payment_receipts_processed_at_created_at_idx"
ON "onchain_payment_receipts"("processed_at", "created_at");
