import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { PrismaService } from "../../db/prisma.service";
import { AppConfigService } from "../../config/app-config.service";
import { getSellerCapabilities, isSellerReadOnly } from "../../business/seller-tier";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService)
    private readonly jwtService: JwtService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const header = String(request.headers.authorization || "");

    if (!header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const token = header.slice("Bearer ".length).trim();

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        role: string;
      }>(token, {
        secret: this.config.accessSecret,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          seller: {
            select: {
              id: true,
              tier: true,
              status: true,
            },
          },
        },
      });

      if (!user || user.status !== "ACTIVE") {
        throw new UnauthorizedException("User is not active.");
      }

      request.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        sellerId: user.seller?.id || null,
        sellerTier: user.seller?.tier || null,
        sellerStatus: user.seller?.status || null,
        sellerCapabilities: getSellerCapabilities(user.seller?.tier),
        sellerReadOnly: isSellerReadOnly(user.seller?.tier),
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException("Invalid access token.");
    }
  }
}
