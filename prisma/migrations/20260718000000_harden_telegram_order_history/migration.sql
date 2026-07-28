-- A Telegram user's private chat id equals their user id. Never retain a
-- group/supergroup id as the delivery destination for customer credentials.
UPDATE "customers"
SET
  "telegram_chat_id" = "telegram_user_id",
  "updated_at" = CURRENT_TIMESTAMP
WHERE "telegram_chat_id" LIKE '-%';

-- Supports customer order-history pagination in newest-first order.
CREATE INDEX "orders_customer_id_created_at_idx"
ON "orders"("customer_id", "created_at");
