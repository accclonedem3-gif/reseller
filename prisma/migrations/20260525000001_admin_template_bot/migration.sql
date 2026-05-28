-- Shop.isTemplate flag
ALTER TABLE "shops" ADD COLUMN "is_template" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "idx_shops_is_template" ON "shops"("is_template") WHERE "is_template" = true;

-- SourceProduct.isSample flag
ALTER TABLE "source_products" ADD COLUMN "is_sample" BOOLEAN NOT NULL DEFAULT false;

-- BotMediaCache table — caches Telegram file_id per bot/media
CREATE TABLE "bot_media_cache" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "media_key" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_media_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_media_cache_shop_id_media_key_key" ON "bot_media_cache"("shop_id", "media_key");

ALTER TABLE "bot_media_cache" ADD CONSTRAINT "bot_media_cache_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
