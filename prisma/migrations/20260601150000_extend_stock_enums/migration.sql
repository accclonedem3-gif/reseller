-- Extend StockOperationType and StockExtractMethod enums
-- NOTE: Postgres does not allow ALTER TYPE ... ADD VALUE inside a transaction block.
-- Each statement runs at top level.

ALTER TYPE "StockOperationType" ADD VALUE IF NOT EXISTS 'PREVIEW';
ALTER TYPE "StockExtractMethod" ADD VALUE IF NOT EXISTS 'RANGE';
ALTER TYPE "StockExtractMethod" ADD VALUE IF NOT EXISTS 'MANUAL';
