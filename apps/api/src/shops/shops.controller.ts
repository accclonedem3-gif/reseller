import { Body, Controller, Get, Inject, Post, Put, UseGuards } from "@nestjs/common";
import { SellerTier } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import type { AuthenticatedUser } from "../types";

import { UpdateBotConfigDto, UpdateShopDto } from "./shops.dto";
import { ShopsService } from "./shops.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class ShopsController {
  constructor(
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
  ) {}

  @Get("shops/current")
  getCurrentShop(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.getCurrentShop(user);
  }

  @Put("shops/current")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("shop_manage")
  updateCurrentShop(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateShopDto,
  ) {
    return this.shopsService.updateCurrentShop(user, body);
  }

  @Get("bot-config")
  getBotConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.getBotConfig(user);
  }

  @Put("bot-config")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("bot_manage")
  updateBotConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateBotConfigDto,
  ) {
    return this.shopsService.updateBotConfig(user, body);
  }

  @Post("bot-config/verify-telegram")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("bot_manage")
  verifyTelegram(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.verifyTelegram(user);
  }

  @Post("bot-config/verify-provider")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_external_use")
  verifyProvider(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.verifyProvider(user);
  }

  @Post("bot-config/sync-products")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_external_use")
  syncProducts(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.syncProducts(user);
  }
}
