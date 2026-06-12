-- Persist each Telegram customer's Premium status so button icons can render per-viewer
-- (custom-emoji for premium, text emoji for non-premium) everywhere, including push flows.
-- Refreshed on every incoming update in ensureTelegramCustomerSeen.
ALTER TABLE "customers" ADD COLUMN "is_premium" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "is_premium_checked_at" TIMESTAMP(3);
