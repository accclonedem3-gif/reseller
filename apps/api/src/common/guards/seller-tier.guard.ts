import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SellerTier } from "@prisma/client";

import type { AuthenticatedUser } from "../../types";
import { SELLER_TIER_KEY } from "../decorators/seller-tier.decorator";

@Injectable()
export class SellerTierGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredTiers =
      this.reflector.getAllAndOverride<SellerTier[]>(SELLER_TIER_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (requiredTiers.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException("Authentication is required.");
    }

    if (user.role === "SUPER_ADMIN") {
      return true;
    }

    if (!user.sellerTier) {
      throw new ForbiddenException("Seller context is missing.");
    }

    if (!requiredTiers.includes(user.sellerTier)) {
      throw new ForbiddenException(
        "FREE accounts are read-only. Upgrade your plan to continue.",
      );
    }

    return true;
  }
}
