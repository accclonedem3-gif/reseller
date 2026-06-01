-- Add QUARTERLY value to TierPlan enum (positioned between MONTHLY and SEMI_ANNUAL conceptually)
ALTER TYPE "TierPlan" ADD VALUE IF NOT EXISTS 'QUARTERLY';
