-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "UserbotTargetMode" AS ENUM ('GROUP_ONLY', 'MEMBERS_DM', 'BOTH');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
ALTER TYPE "UserbotLogStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
ALTER TYPE "TelegramUserbotLicenseType" ADD VALUE IF NOT EXISTS 'ULTRA_UNLIMITED';

-- AlterTable
ALTER TABLE "telegram_user_groups" ADD COLUMN IF NOT EXISTS "has_topics" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "telegram_user_campaigns" ADD COLUMN IF NOT EXISTS "target_mode" "UserbotTargetMode" NOT NULL DEFAULT 'GROUP_ONLY',
ADD COLUMN IF NOT EXISTS "target_topics" JSONB,
ADD COLUMN IF NOT EXISTS "max_members_per_run" INTEGER DEFAULT 30;

-- AlterTable
ALTER TABLE "telegram_user_campaign_logs" ADD COLUMN IF NOT EXISTS "target_type" TEXT DEFAULT 'GROUP',
ADD COLUMN IF NOT EXISTS "target_name" TEXT,
ADD COLUMN IF NOT EXISTS "topic_id" INTEGER;
