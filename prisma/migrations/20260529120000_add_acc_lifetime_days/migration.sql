-- Pre-die date feature: seller declares the expected lifetime (in days) of accounts in the
-- current batch. Warranty submission compares now vs (deliveredAt + accLifetimeDays); if
-- expired, the auto-check is skipped and the claim is auto-resolved with a synthetic
-- "batch_lifetime_expired" verdict — saves the 25-60s tool spawn when the seller already
-- knows the batch is dead.
--
-- Null = no declared lifetime (current behavior, always run the tool).
ALTER TABLE "source_products" ADD COLUMN "acc_lifetime_days" INTEGER;
