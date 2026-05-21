import { Body, Controller, Get, Inject, Put, UseGuards } from "@nestjs/common";
import { SellerTier } from "@prisma/client";
import { AffiliateService } from "./affiliate.service";
import { UpdateAffiliateConfigDto } from "./affiliate.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../types";

@Controller("affiliate")
@UseGuards(JwtAuthGuard)
export class AffiliateController {
  constructor(
    @Inject(AffiliateService)
    private readonly affiliateService: AffiliateService,
  ) {}

  @Get("config")
  @UseGuards(SellerTierGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  getConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.affiliateService.getConfigByUser(user);
  }

  @Put("config")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("shop_manage")
  updateConfig(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAffiliateConfigDto) {
    return this.affiliateService.upsertConfigByUser(user, dto);
  }

  @Get("leaderboard")
  @UseGuards(SellerTierGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  getLeaderboard(@CurrentUser() user: AuthenticatedUser) {
    return this.affiliateService.getLeaderboard(user);
  }
}
