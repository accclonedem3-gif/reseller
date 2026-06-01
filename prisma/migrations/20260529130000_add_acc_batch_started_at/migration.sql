-- Batch start date: when this batch of accounts started living (i.e. when the seller
-- added them to inventory). Lifetime is computed as batchStartedAt + accLifetimeDays
-- instead of deliveredAt + accLifetimeDays, because real upstream acc lifetime is
-- counted from when the batch was created upstream — NOT from when the reseller sells
-- it to a specific customer. Example: lô về 01/01 sống 11 ngày → die ngày 12/01 cho
-- mọi khách, không quan trọng khách mua ngày 01/01 hay 05/01.
--
-- Null = fall back to using deliveredAt (legacy behavior).
ALTER TABLE "source_products" ADD COLUMN "acc_batch_started_at" TIMESTAMP(3);
