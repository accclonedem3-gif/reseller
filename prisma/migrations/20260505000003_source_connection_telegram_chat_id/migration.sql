ALTER TABLE "internal_source_api_keys"
  ADD COLUMN "telegram_chat_id" TEXT NULL;

ALTER TABLE "downstream_source_connections"
  ADD COLUMN "downstream_telegram_chat_id" TEXT NULL;
