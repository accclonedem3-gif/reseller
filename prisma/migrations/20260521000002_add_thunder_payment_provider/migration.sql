-- Add THUNDER to PaymentProvider enum (already present in dev DB but missing from Prisma schema).
-- Idempotent: skip if already exists.
DO $$ BEGIN
  ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'THUNDER';
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
