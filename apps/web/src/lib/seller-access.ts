import type { StoredSession } from "./storage";

export type SellerCapability =
  | "shop_manage"
  | "bot_manage"
  | "products_manage"
  | "orders_manage"
  | "wallet_manage"
  | "broadcast_manage"
  | "source_external_use"
  | "source_internal_use"
  | "source_internal_manage"
  | "source_key_manage"
  | "warranty_manage";

export function isSellerReadOnly(session: StoredSession | null | undefined) {
  return Boolean(session?.user.sellerReadOnly);
}

export function hasSellerCapability(
  session: StoredSession | null | undefined,
  capability: SellerCapability,
) {
  return session?.user.sellerCapabilities?.includes(capability) || false;
}
