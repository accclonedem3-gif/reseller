ALTER TABLE "provider_configs"
ADD COLUMN "source_webhook_key" TEXT;

CREATE UNIQUE INDEX "provider_configs_source_webhook_key_key"
ON "provider_configs"("source_webhook_key");
