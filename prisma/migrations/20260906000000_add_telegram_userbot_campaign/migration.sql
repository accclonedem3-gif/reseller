-- CreateEnum
CREATE TYPE "TelegramUserTemplateType" AS ENUM ('SPINTAX_TEXT', 'FORWARD_SAVED_MESSAGE');

-- CreateEnum
CREATE TYPE "UserbotCampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "UserbotLogStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "TelegramUserbotLicenseType" AS ENUM ('PLUS', 'PRO', 'UNLIMITED');

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "userbot_license_type" "TelegramUserbotLicenseType",
ADD COLUMN IF NOT EXISTS "userbot_license_expires_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_user_sessions" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "session_string" TEXT NOT NULL,
    "telegram_user_id" BIGINT,
    "telegram_username" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "proxy_url" TEXT,
    "api_id" INTEGER,
    "api_hash" TEXT,
    "groups_count" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_user_groups" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "telegram_chat_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "member_count" INTEGER,
    "can_send_messages" BOOLEAN NOT NULL DEFAULT true,
    "is_supergroup" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_user_templates" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TelegramUserTemplateType" NOT NULL DEFAULT 'SPINTAX_TEXT',
    "content" TEXT,
    "media_url" TEXT,
    "saved_message_id" BIGINT,
    "saved_message_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_user_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_user_campaigns" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_group_ids" JSONB NOT NULL,
    "delay_seconds" INTEGER NOT NULL DEFAULT 60,
    "schedule_time" TIMESTAMP(3),
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "repeat_interval_hours" INTEGER DEFAULT 24,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "status" "UserbotCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "total_target" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_user_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_user_campaign_logs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "group_title" TEXT NOT NULL,
    "group_chat_id" BIGINT NOT NULL,
    "status" "UserbotLogStatus" NOT NULL,
    "error_detail" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_user_campaign_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_userbot_license_keys" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "TelegramUserbotLicenseType" NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "is_redeemed" BOOLEAN NOT NULL DEFAULT false,
    "redeemed_by_seller_id" TEXT,
    "redeemed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_userbot_license_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_user_sessions_seller_id_phone_number_key" ON "telegram_user_sessions"("seller_id", "phone_number");
CREATE INDEX IF NOT EXISTS "telegram_user_sessions_seller_id_phone_number_idx" ON "telegram_user_sessions"("seller_id", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_user_groups_session_id_telegram_chat_id_key" ON "telegram_user_groups"("session_id", "telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_userbot_license_keys_code_key" ON "telegram_userbot_license_keys"("code");

-- AddForeignKey
ALTER TABLE "telegram_user_sessions" ADD CONSTRAINT "telegram_user_sessions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_user_groups" ADD CONSTRAINT "telegram_user_groups_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "telegram_user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_user_templates" ADD CONSTRAINT "telegram_user_templates_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_user_campaigns" ADD CONSTRAINT "telegram_user_campaigns_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_user_campaigns" ADD CONSTRAINT "telegram_user_campaigns_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "telegram_user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_user_campaigns" ADD CONSTRAINT "telegram_user_campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "telegram_user_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_user_campaign_logs" ADD CONSTRAINT "telegram_user_campaign_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "telegram_user_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_userbot_license_keys" ADD CONSTRAINT "telegram_userbot_license_keys_redeemed_by_seller_id_fkey" FOREIGN KEY ("redeemed_by_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
