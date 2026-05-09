-- AlterTable
ALTER TABLE "deposit_requests"
ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYOS',
ADD COLUMN "external_order_code" TEXT,
ADD COLUMN "checkout_url" TEXT,
ADD COLUMN "qr_code" TEXT,
ADD COLUMN "expires_at" TIMESTAMP(3),
ADD COLUMN "paid_at" TIMESTAMP(3),
ADD COLUMN "raw_payload_json" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "deposit_requests_external_order_code_key" ON "deposit_requests"("external_order_code");
