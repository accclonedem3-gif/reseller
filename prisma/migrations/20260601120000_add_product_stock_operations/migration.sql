-- CreateEnum
CREATE TYPE "StockOperationType" AS ENUM ('UPLOAD', 'EXTRACT');

-- CreateEnum
CREATE TYPE "StockExtractMethod" AS ENUM ('FIFO', 'LIFO', 'RANDOM');

-- CreateTable
CREATE TABLE "product_stock_operations" (
    "id" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "operation_type" "StockOperationType" NOT NULL,
    "extract_method" "StockExtractMethod",
    "quantity" INTEGER NOT NULL,
    "available_before" INTEGER NOT NULL,
    "available_after" INTEGER NOT NULL,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_stock_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_stock_operations_source_product_id_created_at_idx" ON "product_stock_operations"("source_product_id", "created_at");

-- AddForeignKey
ALTER TABLE "product_stock_operations" ADD CONSTRAINT "product_stock_operations_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "source_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
