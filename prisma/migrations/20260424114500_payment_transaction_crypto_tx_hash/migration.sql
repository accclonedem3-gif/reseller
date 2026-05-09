ALTER TABLE "payment_transactions"
ADD COLUMN "crypto_tx_hash" TEXT;

CREATE UNIQUE INDEX "payment_transactions_crypto_tx_hash_key"
ON "payment_transactions"("crypto_tx_hash");
