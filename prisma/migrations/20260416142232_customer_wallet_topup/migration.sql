-- CreateEnum
CREATE TYPE "CustomerWalletLedgerType" AS ENUM ('TOPUP', 'SPEND_ORDER', 'REFUND_ORDER', 'ADJUST');

-- CreateTable
CREATE TABLE "customer_wallets" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_wallet_ledgers" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "type" "CustomerWalletLedgerType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance_before" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_wallet_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_wallet_topups" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "external_order_code" TEXT NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "qr_code" TEXT,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "raw_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_wallet_topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_wallets_customer_id_key" ON "customer_wallets"("customer_id");

-- CreateIndex
CREATE INDEX "customer_wallet_ledgers_customer_id_created_at_idx" ON "customer_wallet_ledgers"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_wallet_topups_external_order_code_key" ON "customer_wallet_topups"("external_order_code");

-- CreateIndex
CREATE INDEX "customer_wallet_topups_customer_id_created_at_idx" ON "customer_wallet_topups"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_wallet_topups_status_expires_at_idx" ON "customer_wallet_topups"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "customer_wallets" ADD CONSTRAINT "customer_wallets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wallet_ledgers" ADD CONSTRAINT "customer_wallet_ledgers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wallet_ledgers" ADD CONSTRAINT "customer_wallet_ledgers_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "customer_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wallet_topups" ADD CONSTRAINT "customer_wallet_topups_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wallet_topups" ADD CONSTRAINT "customer_wallet_topups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_wallet_topups" ADD CONSTRAINT "customer_wallet_topups_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "customer_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
