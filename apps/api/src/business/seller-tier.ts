import { SellerTier } from "@prisma/client";

export const sellerCapabilityValues = [
  "shop_manage",
  "bot_manage",
  "products_manage",
  "orders_manage",
  "wallet_manage",
  "broadcast_manage",
  "source_external_use",
  "source_internal_use",
  "source_internal_manage",
  "source_key_manage",
  "warranty_manage",
] as const;

export type SellerCapability = (typeof sellerCapabilityValues)[number];

const proCapabilities: SellerCapability[] = [
  "shop_manage",
  "bot_manage",
  "products_manage",
  "orders_manage",
  "wallet_manage",
  "broadcast_manage",
  "source_external_use",
  "source_internal_use",
  "warranty_manage",
];

const tierCapabilityMap: Record<SellerTier, SellerCapability[]> = {
  [SellerTier.FREE]: [],
  [SellerTier.PRO]: proCapabilities,
  [SellerTier.ULTRA]: [
    ...proCapabilities,
    "source_internal_manage",
    "source_key_manage",
  ],
};

export function getSellerCapabilities(tier: SellerTier | null | undefined) {
  if (!tier) {
    return [] as SellerCapability[];
  }

  return tierCapabilityMap[tier] || [];
}

export function hasSellerCapability(
  tier: SellerTier | null | undefined,
  capability: SellerCapability,
) {
  return getSellerCapabilities(tier).includes(capability);
}

export function isSellerReadOnly(tier: SellerTier | null | undefined) {
  return tier === SellerTier.FREE;
}
