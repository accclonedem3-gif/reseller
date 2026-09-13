-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "target_link" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "comments" TEXT;
