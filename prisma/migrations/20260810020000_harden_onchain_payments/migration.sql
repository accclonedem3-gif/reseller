ALTER TABLE "onchain_payment_receipts"
ADD COLUMN "tx_hash_normalized" TEXT,
ADD COLUMN "token_address" TEXT,
ADD COLUMN "block_reference" TEXT,
ADD COLUMN "confirmations" INTEGER,
ADD COLUMN "verification_version" INTEGER NOT NULL DEFAULT 1;

UPDATE "onchain_payment_receipts"
SET "tx_hash_normalized" = CASE
  WHEN regexp_replace(trim("tx_hash"), '^0x', '', 'i') ~ '^[0-9a-fA-F]{64}$'
    THEN lower(regexp_replace(trim("tx_hash"), '^0x', '', 'i'))
  ELSE trim("tx_hash")
END;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "onchain_payment_receipts"
    GROUP BY "tx_hash_normalized"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized on-chain transaction hashes must be reconciled before deploying this migration.';
  END IF;
END $$;

ALTER TABLE "onchain_payment_receipts"
ALTER COLUMN "tx_hash_normalized" SET NOT NULL;

CREATE UNIQUE INDEX "onchain_payment_receipts_tx_hash_normalized_key"
ON "onchain_payment_receipts"("tx_hash_normalized");

CREATE TABLE "onchain_invoice_reservations" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "destination" TEXT NOT NULL,
  "amount_key" TEXT NOT NULL,
  "external_order_code" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onchain_invoice_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onchain_invoice_reservations_external_order_code_key"
ON "onchain_invoice_reservations"("external_order_code");

CREATE UNIQUE INDEX "onchain_invoice_reservations_provider_destination_amount_key_key"
ON "onchain_invoice_reservations"("provider", "destination", "amount_key");

CREATE INDEX "onchain_invoice_reservations_expires_at_idx"
ON "onchain_invoice_reservations"("expires_at");

CREATE UNIQUE INDEX "tier_subscriptions_payment_transaction_id_key"
ON "tier_subscriptions"("payment_transaction_id");
