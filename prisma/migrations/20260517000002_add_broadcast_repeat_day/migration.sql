-- AlterTable
ALTER TABLE "broadcast_schedules"
ADD COLUMN IF NOT EXISTS "repeat_day" INTEGER;
