-- CreateEnum
CREATE TYPE "StockEntryStatus" AS ENUM ('AVAILABLE', 'SOLD', 'EXTRACTED');

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost_per_unit" DECIMAL(18,2),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_entries" (
    "id" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "text" TEXT NOT NULL,
    "status" "StockEntryStatus" NOT NULL DEFAULT 'AVAILABLE',
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sold_at" TIMESTAMP(3),
    "sold_to_order_id" TEXT,
    "sold_to_customer_id" TEXT,
    "extracted_at" TIMESTAMP(3),

    CONSTRAINT "stock_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_batches_source_product_id_created_at_idx" ON "stock_batches"("source_product_id", "created_at");
CREATE INDEX "stock_batches_source_product_id_deleted_at_idx" ON "stock_batches"("source_product_id", "deleted_at");

-- CreateIndex
CREATE INDEX "stock_entries_source_product_id_status_uploaded_at_idx" ON "stock_entries"("source_product_id", "status", "uploaded_at");
CREATE INDEX "stock_entries_batch_id_status_idx" ON "stock_entries"("batch_id", "status");
CREATE INDEX "stock_entries_sold_to_order_id_idx" ON "stock_entries"("sold_to_order_id");
CREATE INDEX "stock_entries_sold_to_customer_id_idx" ON "stock_entries"("sold_to_customer_id");

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "source_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "source_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_sold_to_order_id_fkey" FOREIGN KEY ("sold_to_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_sold_to_customer_id_fkey" FOREIGN KEY ("sold_to_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data migration: backfill StockEntry from existing metadataJson.deliveryEntries
-- This converts the legacy text-array stock format into the new row-based format.
-- batchId = NULL means "Kho cũ" (legacy stock, no cost tracking).
INSERT INTO "stock_entries" (
  "id",
  "source_product_id",
  "batch_id",
  "text",
  "status",
  "uploaded_at"
)
SELECT
  -- Use Postgres-generated UUID for stable IDs (matches cuid spec roughly).
  -- We append the position so multiple entries per product get unique ids.
  CONCAT('cmpse', SUBSTR(MD5(sp.id || '#' || (ord - 1)::text), 1, 20)) AS id,
  sp.id AS source_product_id,
  NULL AS batch_id,
  TRIM(entry::text) AS text,
  'AVAILABLE'::"StockEntryStatus" AS status,
  sp.created_at AS uploaded_at
FROM "source_products" sp,
LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(COALESCE(sp.metadata_json, '{}'::jsonb) -> 'deliveryEntries') = 'array'
      THEN COALESCE(sp.metadata_json, '{}'::jsonb) -> 'deliveryEntries'
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS t(entry, ord)
WHERE TRIM(entry::text) <> '';
