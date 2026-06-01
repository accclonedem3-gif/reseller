-- CreateTable
CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL,
    "description" TEXT,
    "referrer_seller_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_code_usages" (
    "id" TEXT NOT NULL,
    "discount_code_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "amount_discounted" DECIMAL(18,2) NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_code_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE INDEX "discount_codes_referrer_seller_id_idx" ON "discount_codes"("referrer_seller_id");

-- CreateIndex
CREATE INDEX "discount_codes_active_idx" ON "discount_codes"("active");

-- CreateIndex
CREATE UNIQUE INDEX "discount_code_usages_subscription_id_key" ON "discount_code_usages"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_code_usages_discount_code_id_seller_id_key" ON "discount_code_usages"("discount_code_id", "seller_id");

-- CreateIndex
CREATE INDEX "discount_code_usages_seller_id_idx" ON "discount_code_usages"("seller_id");

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_referrer_seller_id_fkey" FOREIGN KEY ("referrer_seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_usages" ADD CONSTRAINT "discount_code_usages_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_usages" ADD CONSTRAINT "discount_code_usages_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_usages" ADD CONSTRAINT "discount_code_usages_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "tier_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
