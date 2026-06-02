-- Add OKX Personal API credentials + BEP20 USDT address
ALTER TABLE "payment_configs"
  ADD COLUMN "usdt_bep20_address" TEXT,
  ADD COLUMN "okx_personal_api_key_encrypted" TEXT,
  ADD COLUMN "okx_personal_secret_key_encrypted" TEXT,
  ADD COLUMN "okx_personal_passphrase_encrypted" TEXT,
  ADD COLUMN "okx_personal_api_enabled" BOOLEAN NOT NULL DEFAULT FALSE;
