-- Add THUNDER to the PaymentProvider enum (from the warranty branch's provider union).
-- NOTE: Postgres does not allow ALTER TYPE ... ADD VALUE inside a transaction block with
-- dependent DDL, so this runs isolated as its own migration (mirrors extend_stock_enums).
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'THUNDER';
