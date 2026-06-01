-- Audit trail: record which user (seller/admin) manually resolved or rejected a warranty claim.
-- NULL for auto-resolved/auto-rejected (system action) and for legacy pre-audit claims.
ALTER TABLE "warranty_claims" ADD COLUMN "resolved_by_id" TEXT;
