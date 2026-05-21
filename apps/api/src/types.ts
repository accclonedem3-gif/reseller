import type { SellerStatus, SellerTier, UserRole } from "@prisma/client";

import type { SellerCapability } from "./business/seller-tier";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  sellerId: string | null;
  sellerTier: SellerTier | null;
  sellerStatus: SellerStatus | null;
  sellerCapabilities: SellerCapability[];
  sellerReadOnly: boolean;
}
