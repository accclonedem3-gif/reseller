-- Add SCHEDULED to BroadcastStatus enum
ALTER TYPE "BroadcastStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

-- Add scheduledAt and scheduleId to broadcasts
ALTER TABLE "broadcasts"
  ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "schedule_id" TEXT;

-- Create broadcast_schedules table
CREATE TABLE IF NOT EXISTS "broadcast_schedules" (
  "id"          TEXT NOT NULL,
  "shop_id"     TEXT NOT NULL,
  "seller_id"   TEXT NOT NULL,
  "title"       TEXT,
  "message"     TEXT NOT NULL,
  "image_url"   TEXT,
  "send_time"   TEXT NOT NULL,
  "frequency"   TEXT NOT NULL DEFAULT 'daily',
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "last_run_at" TIMESTAMP(3),
  "next_run_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "broadcast_schedules_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "broadcast_schedules"
  ADD CONSTRAINT "broadcast_schedules_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "broadcast_schedules_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcasts"
  ADD CONSTRAINT "broadcasts_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "broadcast_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
