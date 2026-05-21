-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SELLER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING');

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('DISABLED', 'PENDING', 'ACTIVE', 'FAILED', 'POLLING');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'PROCESSING_PURCHASE', 'DELIVERED', 'FAILED', 'PAID_WAITING_STOCK', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WalletLedgerType" AS ENUM ('TOPUP', 'DEBIT_PURCHASE', 'REFUND_PURCHASE', 'WITHDRAW', 'ADJUST', 'WITHDRAW_REJECT_REFUND');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WithdrawStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BroadcastLogStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYOS', 'MOCK');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TelegramDeliveryMode" AS ENUM ('WEBHOOK', 'POLLING');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "status" "SellerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "logo_url" TEXT,
    "support_telegram" TEXT,
    "support_zalo" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'DRAFT',
    "default_currency" TEXT NOT NULL DEFAULT 'VND',
    "last_catalog_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_configs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "telegram_bot_token_encrypted" TEXT NOT NULL,
    "telegram_bot_id" TEXT,
    "telegram_bot_username" TEXT,
    "webhook_url" TEXT,
    "webhook_status" "WebhookStatus" NOT NULL DEFAULT 'DISABLED',
    "delivery_mode" "TelegramDeliveryMode" NOT NULL DEFAULT 'POLLING',
    "last_verified_at" TIMESTAMP(3),
    "last_processed_update_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'canboso',
    "base_url" TEXT NOT NULL DEFAULT 'https://canboso.com',
    "buyer_key_encrypted" TEXT NOT NULL,
    "connection_status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_configs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MOCK',
    "payos_client_id_encrypted" TEXT,
    "payos_api_key_encrypted" TEXT,
    "payos_checksum_key_encrypted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_wallets" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledgers" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "type" "WalletLedgerType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance_before" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_products" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "external_product_id" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'canboso',
    "source_name" TEXT NOT NULL,
    "source_raw_name" TEXT,
    "source_description" TEXT,
    "source_price" DECIMAL(18,2) NOT NULL,
    "available" INTEGER,
    "sold_count" INTEGER NOT NULL DEFAULT 0,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "metadata_json" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_product_overrides" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "display_name" TEXT,
    "sale_price" DECIMAL(18,2),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "promo_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_product_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "telegram_username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_code" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sale_price" DECIMAL(18,2) NOT NULL,
    "source_price_snapshot" DECIMAL(18,2) NOT NULL,
    "total_sale_amount" DECIMAL(18,2) NOT NULL,
    "total_source_amount" DECIMAL(18,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "delivered_account_text" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "external_order_code" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "qr_code" TEXT,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "raw_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_requests" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdraw_requests" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "bank_account_name" TEXT,
    "note" TEXT,
    "status" "WithdrawStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdraw_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "title" TEXT,
    "message" TEXT NOT NULL,
    "image_url" TEXT,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "total_targets" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_logs" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "BroadcastLogStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "raw_response_json" JSONB,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_links" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_events" (
    "id" TEXT NOT NULL,
    "referral_link_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_user_id_key" ON "sellers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "bot_configs_shop_id_key" ON "bot_configs"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_configs_shop_id_key" ON "provider_configs"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_configs_shop_id_key" ON "payment_configs"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_wallets_seller_id_key" ON "seller_wallets"("seller_id");

-- CreateIndex
CREATE INDEX "wallet_ledgers_seller_id_created_at_idx" ON "wallet_ledgers"("seller_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_products_shop_id_external_product_id_key" ON "source_products"("shop_id", "external_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_product_overrides_seller_id_source_product_id_key" ON "seller_product_overrides"("seller_id", "source_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_shop_id_telegram_user_id_key" ON "customers"("shop_id", "telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_code_key" ON "orders"("order_code");

-- CreateIndex
CREATE INDEX "orders_seller_id_created_at_idx" ON "orders"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_shop_id_status_idx" ON "orders"("shop_id", "status");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_order_id_key" ON "payment_transactions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_external_order_code_key" ON "payment_transactions"("external_order_code");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_logs_broadcast_id_customer_id_key" ON "broadcast_logs"("broadcast_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_links_code_key" ON "referral_links"("code");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_configs" ADD CONSTRAINT "bot_configs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configs" ADD CONSTRAINT "payment_configs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_wallets" ADD CONSTRAINT "seller_wallets_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledgers" ADD CONSTRAINT "wallet_ledgers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledgers" ADD CONSTRAINT "wallet_ledgers_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "seller_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_products" ADD CONSTRAINT "source_products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_product_overrides" ADD CONSTRAINT "seller_product_overrides_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_product_overrides" ADD CONSTRAINT "seller_product_overrides_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_product_overrides" ADD CONSTRAINT "seller_product_overrides_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "source_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "source_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdraw_requests" ADD CONSTRAINT "withdraw_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdraw_requests" ADD CONSTRAINT "withdraw_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_logs" ADD CONSTRAINT "broadcast_logs_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_logs" ADD CONSTRAINT "broadcast_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referral_link_id_fkey" FOREIGN KEY ("referral_link_id") REFERENCES "referral_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


