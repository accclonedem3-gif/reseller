-- AddColumn: telegram_blocked_at on customers
-- Additive-only migration: adds a nullable column with no default.
-- Existing rows will have NULL (not blocked), which is the correct semantic.
-- Safe to run on live production with no downtime.

ALTER TABLE "customers" ADD COLUMN "telegram_blocked_at" TIMESTAMP(3);
