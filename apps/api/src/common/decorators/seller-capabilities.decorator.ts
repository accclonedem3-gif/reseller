import { SetMetadata } from "@nestjs/common";

import type { SellerCapability } from "../../business/seller-tier";

export const SELLER_CAPABILITIES_KEY = "seller_capabilities";

export const RequireSellerCapabilities = (...capabilities: SellerCapability[]) =>
  SetMetadata(SELLER_CAPABILITIES_KEY, capabilities);
