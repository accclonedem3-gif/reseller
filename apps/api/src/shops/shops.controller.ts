import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SellerTier } from "@prisma/client";
import { memoryStorage } from "multer";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import type { AuthenticatedUser } from "../types";

import {
  CreateProviderSourceDto,
  ProviderSourceOrdersQueryDto,
  UpdateBotConfigDto,
  UpdateShopDto,
} from "./shops.dto";
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

  @Post("bot-config/upload-banner")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("bot_manage")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
        ) {
          callback(
            new BadRequestException("Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP."),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadShopBanner(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.shopsService.uploadShopBanner(user, file);
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

  @Get("provider-sources")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_external_use")
  listProviderSources(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.listProviderSources(user);
  }

  @Get("provider-sources-summary")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_external_use")
  getProviderSourcesSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.getProviderSourcesSummary(user);
  }

  @Get("provider-sources/:id/detail")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_external_use")
  getProviderSourceDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.shopsService.getProviderSourceDetail(user, id);
  }

  @Get("provider-sources/:id/orders")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_external_use")
  getProviderSourceOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: ProviderSourceOrdersQueryDto,
  ) {
    return this.shopsService.getProviderSourceOrders(user, id, query);
  }

  @Post("provider-sources")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_external_use")
  createProviderSource(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProviderSourceDto,
  ) {
    return this.shopsService.createProviderSource(user, body);
  }

  @Post("provider-sources/:id/sync")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_external_use")
  syncProviderSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.shopsService.syncProviderSource(user, id);
  }

  @Post("provider-sources/:id/reconnect")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_external_use")
  reconnectProviderSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.shopsService.reconnectProviderSource(user, id);
  }

  @Delete("provider-sources/:id/permanent")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_external_use")
  removeProviderSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.shopsService.removeProviderSource(user, id);
  }

  @Delete("provider-sources/:id")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_external_use")
  disconnectProviderSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.shopsService.disconnectProviderSource(user, id);
  }

  @Post("bot-config/verify-okx-personal")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("bot_manage")
  verifyOkxPersonal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { apiKey?: string; secretKey?: string; passphrase?: string },
  ) {
    return this.shopsService.verifyOkxPersonal(user, body);
  }
}
