import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SellerTier } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import type { AuthenticatedUser } from "../types";

import {
  AdjustConnectionBalanceDto,
  ConnectInternalSourceDto,
  CreateInternalSourceApiKeyDto,
  DeliverInternalSourceOrderDto,
  FailInternalSourceOrderDto,
  InternalBuyerPurchaseDto,
  TopUpInternalSourceConnectionDto,
} from "./internal-source.dto";
import { InternalSourceService } from "./internal-source.service";

@Controller()
export class InternalSourceController {
  constructor(
    @Inject(InternalSourceService)
    private readonly internalSourceService: InternalSourceService,
  ) {}

  @Get("source/keys")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_key_manage")
  listApiKeys(@CurrentUser() user: AuthenticatedUser) {
    return this.internalSourceService.listApiKeys(user);
  }

  @Post("source/keys")
  @UseGuards(JwtAuthGuard, SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_key_manage")
  createApiKey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateInternalSourceApiKeyDto,
  ) {
    return this.internalSourceService.createApiKey(user, body);
  }

  @Post("source/keys/:id/revoke")
  @UseGuards(JwtAuthGuard, SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_key_manage")
  revokeApiKey(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.internalSourceService.revokeApiKey(user, id);
  }

  @Get("source/connections/current")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_internal_use")
  getCurrentConnection(@CurrentUser() user: AuthenticatedUser) {
    return this.internalSourceService.getCurrentConnection(user);
  }

  @Post("source/connections/connect")
  @UseGuards(JwtAuthGuard, SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_internal_use")
  connectCurrentShop(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConnectInternalSourceDto,
  ) {
    return this.internalSourceService.connectDownstreamShop(user, body);
  }

  @Post("source/connections/current/topup")
  @UseGuards(JwtAuthGuard, SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_internal_use")
  topUpCurrentConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TopUpInternalSourceConnectionDto,
  ) {
    return this.internalSourceService.topUpCurrentConnection(user, body);
  }

  @Get("source/connections/downstream")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_internal_manage")
  listDownstreamConnections(@CurrentUser() user: AuthenticatedUser) {
    return this.internalSourceService.listDownstreamConnections(user);
  }

  @Get("source/connections/downstream/:id/ledger")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_internal_manage")
  getConnectionLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.internalSourceService.getConnectionLedger(user, id);
  }

  @Put("source/connections/downstream/:id/adjust")
  @UseGuards(JwtAuthGuard, SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.ULTRA)
  @RequireSellerCapabilities("source_internal_manage")
  adjustConnectionBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: AdjustConnectionBalanceDto,
  ) {
    return this.internalSourceService.manualAdjustConnectionBalance(user, id, body);
  }

  @Get("source/orders")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("source_internal_manage")
  listSourceOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
  ) {
    return this.internalSourceService.listSourceOrders(user, status);
  }

  @Post("source/orders/:id/manual-deliver")
  @UseGuards(JwtAuthGuard, SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_internal_manage")
  manualDeliverSourceOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: DeliverInternalSourceOrderDto,
  ) {
    return this.internalSourceService.manualDeliverSourceOrder(user, id, body);
  }

  @Post("source/orders/:id/mark-failed")
  @UseGuards(JwtAuthGuard, SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("source_internal_manage")
  markSourceOrderFailed(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: FailInternalSourceOrderDto,
  ) {
    return this.internalSourceService.markSourceOrderFailed(user, id, body);
  }

  @Get("telegram-buyer/products")
  listBuyerCatalog(
    @Query("key") key: string,
    @Req() req: Request,
  ) {
    return this.internalSourceService.listProductsByKey(key, {
      method: req.method,
      path: req.originalUrl || req.url,
      ipAddress: req.ip || null,
    });
  }

  @Get("telegram-buyer/balance")
  getBuyerBalance(
    @Query("key") key: string,
    @Req() req: Request,
  ) {
    return this.internalSourceService.getBalanceByKey(key, {
      method: req.method,
      path: req.originalUrl || req.url,
      ipAddress: req.ip || null,
    });
  }

  @Post("telegram-buyer/purchase")
  createBuyerOrder(
    @Body() body: InternalBuyerPurchaseDto,
    @Req() req: Request,
  ) {
    return this.internalSourceService.createOrderByKey(body, {
      method: req.method,
      path: req.originalUrl || req.url,
      ipAddress: req.ip || null,
    });
  }

  @Get("telegram-buyer/order-status")
  getBuyerOrderStatus(
    @Query("key") key: string,
    @Query("order_id") orderId: string | undefined,
    @Query("order_code") orderCode: string | undefined,
    @Req() req: Request,
  ) {
    return this.internalSourceService.getOrderStatusByKey(
      key,
      {
        orderId,
        orderCode,
      },
      {
        method: req.method,
        path: req.originalUrl || req.url,
        ipAddress: req.ip || null,
      },
    );
  }
}
