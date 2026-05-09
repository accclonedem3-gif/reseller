-- CreateEnum
CREATE TYPE "ConnectionTopupStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "connection_topup_requests" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "upstream_shop_id" TEXT NOT NULL,
    "downstream_shop_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "external_order_code" TEXT NOT NULL,
    "status" "ConnectionTopupStatus" NOT NULL DEFAULT 'PENDING',
    "checkout_url" TEXT,
    "qr_code" TEXT,
    "expires_at" TIMESTAMP(3),
    "raw_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connection_topup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connection_topup_requests_external_order_code_key" ON "connection_topup_requests"("external_order_code");

-- CreateIndex
CREATE INDEX "connection_topup_requests_connection_id_created_at_idx" ON "connection_topup_requests"("connection_id", "created_at");

-- AddForeignKey
ALTER TABLE "connection_topup_requests" ADD CONSTRAINT "connection_topup_requests_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "downstream_source_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_topup_requests" ADD CONSTRAINT "connection_topup_requests_upstream_shop_id_fkey" FOREIGN KEY ("upstream_shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_topup_requests" ADD CONSTRAINT "connection_topup_requests_downstream_shop_id_fkey" FOREIGN KEY ("downstream_shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
