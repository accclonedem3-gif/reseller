-- Per-shop Pay2s balance-webhook token (the value the seller declares when creating the Hook).
ALTER TABLE "payment_configs" ADD COLUMN "pay2s_webhook_token_encrypted" TEXT;
