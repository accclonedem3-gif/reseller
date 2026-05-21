import { SetMetadata } from "@nestjs/common";
import { SellerTier } from "@prisma/client";

export const SELLER_TIER_KEY = "seller_tier";

export const RequireSellerTier = (...tiers: SellerTier[]) =>
  SetMetadata(SELLER_TIER_KEY, tiers);
