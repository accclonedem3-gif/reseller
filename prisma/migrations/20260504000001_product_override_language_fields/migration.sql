ALTER TABLE "seller_product_overrides"
  ADD COLUMN "sale_price_usd" DECIMAL(18,4) NULL,
  ADD COLUMN "hidden_vi"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hidden_en"      BOOLEAN NOT NULL DEFAULT false;
