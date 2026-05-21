-- CreateTable
CREATE TABLE "icon_catalog" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT,
    "label" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "custom_emoji_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icon_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "icon_catalog_shop_id_position_idx" ON "icon_catalog"("shop_id", "position");

-- AddForeignKey
ALTER TABLE "icon_catalog" ADD CONSTRAINT "icon_catalog_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
