ALTER TABLE "provider_configs"
ADD COLUMN IF NOT EXISTS "source_notification_sync_enabled" BOOLEAN NOT NULL DEFAULT true;
