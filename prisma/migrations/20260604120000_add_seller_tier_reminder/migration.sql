-- AlterTable
ALTER TABLE "sellers"
ADD COLUMN "last_tier_reminder_stage" TEXT,
ADD COLUMN "last_tier_reminder_at" TIMESTAMP(3);
