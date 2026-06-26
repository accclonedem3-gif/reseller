-- Customer-bound (canboso-style) source connections & orders have no downstream
-- seller/shop: the buyer is a bot customer who tops up a wallet in the upstream
-- shop and consumes the source API via their issued key. Relax NOT NULL so these
-- rows can exist without a downstream shop identity.

ALTER TABLE "downstream_source_connections"
  ALTER COLUMN "downstream_seller_id" DROP NOT NULL,
  ALTER COLUMN "downstream_shop_id" DROP NOT NULL;

ALTER TABLE "internal_source_orders"
  ALTER COLUMN "downstream_seller_id" DROP NOT NULL,
  ALTER COLUMN "downstream_shop_id" DROP NOT NULL;
