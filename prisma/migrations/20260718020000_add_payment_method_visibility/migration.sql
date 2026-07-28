ALTER TABLE "payment_configs"
ADD COLUMN "binance_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "okx_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "usdt_trc20_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "usdt_solana_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "usdt_ton_enabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "payment_configs"
SET
  "binance_enabled" = COALESCE(BTRIM("binance_uid"), '') <> '' OR "binance_pay_enabled" = true,
  "okx_enabled" = COALESCE(BTRIM("okx_uid"), '') <> '',
  "usdt_trc20_enabled" = COALESCE(BTRIM("usdt_trc20_address"), '') <> '',
  "usdt_solana_enabled" = COALESCE(BTRIM("usdt_solana_address"), '') <> '',
  "usdt_ton_enabled" = COALESCE(BTRIM("usdt_ton_address"), '') <> '';

-- PayPal is an additional checkout method, never the shop's primary VND gateway.
-- Repair rows created before the two settings were separated.
UPDATE "payment_configs"
SET "provider" = CASE
  WHEN "payos_client_id_encrypted" IS NOT NULL
    AND "payos_api_key_encrypted" IS NOT NULL
    AND "payos_checksum_key_encrypted" IS NOT NULL
    THEN 'PAYOS'::"PaymentProvider"
  WHEN "pay2s_partner_code_encrypted" IS NOT NULL
    AND "pay2s_access_key_encrypted" IS NOT NULL
    AND "pay2s_secret_key_encrypted" IS NOT NULL
    THEN 'PAY2S'::"PaymentProvider"
  WHEN COALESCE(BTRIM("web2m_account_number"), '') <> ''
    AND COALESCE(BTRIM("web2m_bank_code"), '') <> ''
    THEN 'WEB2M'::"PaymentProvider"
  ELSE 'MOCK'::"PaymentProvider"
END
WHERE "provider" = 'PAYPAL'::"PaymentProvider";
