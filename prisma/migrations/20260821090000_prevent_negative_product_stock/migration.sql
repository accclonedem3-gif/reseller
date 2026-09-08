-- Repair legacy oversold counters before enforcing the invariant.
UPDATE "source_products"
SET "available" = 0
WHERE "available" < 0;

ALTER TABLE "source_products"
ADD CONSTRAINT "source_products_available_nonnegative"
CHECK ("available" IS NULL OR "available" >= 0);
