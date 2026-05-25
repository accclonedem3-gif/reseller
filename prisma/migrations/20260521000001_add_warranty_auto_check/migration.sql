-- Add auto-check fields to warranty_claims
ALTER TABLE "warranty_claims"
  ADD COLUMN "auto_check_status"        TEXT,
  ADD COLUMN "auto_check_tool"          TEXT,
  ADD COLUMN "auto_check_job_id"        TEXT,
  ADD COLUMN "auto_check_result"        JSONB,
  ADD COLUMN "auto_check_started_at"    TIMESTAMP(3),
  ADD COLUMN "auto_check_completed_at"  TIMESTAMP(3),
  ADD COLUMN "auto_check_error_message" TEXT,
  ADD COLUMN "auto_check_attempts"      INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "warranty_claims_auto_check_status_idx" ON "warranty_claims" ("auto_check_status");
