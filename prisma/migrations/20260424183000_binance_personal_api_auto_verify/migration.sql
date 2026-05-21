ALTER TABLE "payment_configs"
  ADD COLUMN IF NOT EXISTS "binance_personal_api_key_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "binance_personal_secret_key_encrypted" TEXT;
