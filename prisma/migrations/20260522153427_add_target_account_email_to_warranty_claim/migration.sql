-- DropIndex
DROP INDEX "seller_product_overrides_seller_position_idx";

-- AlterTable
ALTER TABLE "broadcast_schedules" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "warranty_claims" ADD COLUMN     "target_account_email" TEXT;
