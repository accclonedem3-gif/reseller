import { Injectable } from "@nestjs/common";
import { SellerTier } from "@prisma/client";

@Injectable()
export class SellerCapabilityService {
  canManageShop(tier: SellerTier): boolean {
    return tier !== SellerTier.FREE;
  }

  canConfigureBot(tier: SellerTier): boolean {
    return tier !== SellerTier.FREE;
  }

  canConfigurePayment(tier: SellerTier): boolean {
    return tier !== SellerTier.FREE;
  }

  canUseSource(tier: SellerTier): boolean {
    return tier !== SellerTier.FREE;
  }

  canActAsSource(tier: SellerTier): boolean {
    return tier === SellerTier.ULTRA;
  }

  canIssueApiKeys(tier: SellerTier): boolean {
    return tier === SellerTier.ULTRA;
  }
}
