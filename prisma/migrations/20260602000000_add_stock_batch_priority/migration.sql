-- Add priority field to stock_batches.
-- Default 0 = no manual priority (FIFO by createdAt).
-- Higher number = sold sooner (e.g. seller can set 1, 2, 3... to bump a batch
-- to the front of the queue without rearranging createdAt).
ALTER TABLE "stock_batches" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "stock_batches_source_product_id_priority_created_at_idx"
  ON "stock_batches"("source_product_id", "priority", "created_at");
