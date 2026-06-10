-- Full warranty system port (from the warranty branch) onto master — additive only.
-- New nullable columns + the auto-check pipeline fields + supporting indexes + trigram search.

-- 1. SourceProduct: batch pre-die lifetime (counted from import time, not delivery)
ALTER TABLE "source_products"
  ADD COLUMN "acc_lifetime_days" INTEGER,
  ADD COLUMN "acc_batch_started_at" TIMESTAMP(3);

-- 2. Order: per-order warranty claim code (generated at order create; nullable for legacy orders)
ALTER TABLE "orders"
  ADD COLUMN "warranty_claim_code" TEXT;

-- 3. WarrantyClaim: target email, manual-resolver audit, and the async auto-check pipeline fields
ALTER TABLE "warranty_claims"
  ADD COLUMN "target_account_email" TEXT,
  ADD COLUMN "resolved_by_id" TEXT,
  ADD COLUMN "auto_check_status" TEXT,
  ADD COLUMN "auto_check_tool" TEXT,
  ADD COLUMN "auto_check_job_id" TEXT,
  ADD COLUMN "auto_check_result" JSONB,
  ADD COLUMN "auto_check_started_at" TIMESTAMP(3),
  ADD COLUMN "auto_check_completed_at" TIMESTAMP(3),
  ADD COLUMN "auto_check_error_message" TEXT,
  ADD COLUMN "auto_check_attempts" INTEGER NOT NULL DEFAULT 0;

-- 4. Indexes powering the auto-check sweep + the manual-resolve / per-order claim queries
CREATE INDEX "warranty_claims_auto_check_status_idx" ON "warranty_claims"("auto_check_status");
CREATE INDEX "warranty_claims_auto_check_status_auto_check_started_at_idx" ON "warranty_claims"("auto_check_status", "auto_check_started_at");
CREATE INDEX "warranty_claims_order_id_status_resolved_at_idx" ON "warranty_claims"("order_id", "status", "resolved_at");

-- 5. Trigram search: index delivered-account-text so warranty lookup by account (ILIKE %q%) is fast
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "orders_delivered_account_text_trgm_idx" ON "orders" USING GIN ("delivered_account_text" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "warranty_claims_delivered_account_text_trgm_idx" ON "warranty_claims" USING GIN ("delivered_account_text" gin_trgm_ops);
