-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "warranty_claim_code" TEXT;

-- RenameIndex
ALTER INDEX "warranty_claims_auto_check_status_started_idx" RENAME TO "warranty_claims_auto_check_status_auto_check_started_at_idx";

-- RenameIndex
ALTER INDEX "warranty_claims_order_status_resolved_idx" RENAME TO "warranty_claims_order_id_status_resolved_at_idx";
