import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedUser } from "../../types";
import { SELLER_CAPABILITIES_KEY } from "../decorators/seller-capabilities.decorator";

@Injectable()
export class SellerCapabilitiesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredCapabilities =
      this.reflector.getAllAndOverride<string[]>(SELLER_CAPABILITIES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (requiredCapabilities.length === 0) {
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

    const missingCapability = requiredCapabilities.find(
      (capability) => !user.sellerCapabilities.includes(capability as any),
    );

    if (missingCapability) {
      throw new ForbiddenException(
        user.sellerReadOnly
          ? "FREE accounts are read-only. Upgrade your plan to continue."
          : `Your current plan does not allow "${missingCapability}".`,
      );
    }

    return true;
  }
}
