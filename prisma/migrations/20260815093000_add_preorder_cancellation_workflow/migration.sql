CREATE TYPE "PreorderCancellationStatus" AS ENUM (
  'NONE',
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'SELLER_CANCELED'
);

ALTER TABLE "orders"
ADD COLUMN "preorder_cancellation_status" "PreorderCancellationStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "preorder_cancel_requested_by" TEXT,
ADD COLUMN "preorder_cancel_reason" TEXT,
ADD COLUMN "preorder_cancel_requested_at" TIMESTAMP(3),
ADD COLUMN "preorder_cancel_reviewed_at" TIMESTAMP(3),
ADD COLUMN "preorder_cancel_reviewed_by" TEXT,
ADD COLUMN "preorder_cancel_refund_amount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN "preorder_cancel_fee_refund_amount" DECIMAL(18, 2) NOT NULL DEFAULT 0;

CREATE INDEX "orders_shop_id_preorder_cancellation_status_updated_at_idx"
ON "orders"("shop_id", "preorder_cancellation_status", "updated_at");
