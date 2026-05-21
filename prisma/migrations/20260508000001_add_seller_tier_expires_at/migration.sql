-- AlterTable
ALTER TABLE "sellers" ADD COLUMN "tier_started_at" TIMESTAMP(3),
                      ADD COLUMN "tier_expires_at" TIMESTAMP(3);
