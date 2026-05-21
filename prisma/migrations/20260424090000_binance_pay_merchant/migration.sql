-- Migration: 20260424090000_binance_pay_merchant
-- Add BINANCE_PAY provider and Binance Pay Merchant API fields

-- 1. Add BINANCE_PAY to the PaymentProvider enum (PostgreSQL)
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'BINANCE_PAY';

-- 2. Add Binance Pay Merchant API columns to payment_configs
ALTER TABLE "payment_configs"
  ADD COLUMN IF NOT EXISTS "binance_pay_api_key_encrypted"    TEXT,
  ADD COLUMN IF NOT EXISTS "binance_pay_secret_key_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "binance_pay_enabled"              BOOLEAN NOT NULL DEFAULT false;
