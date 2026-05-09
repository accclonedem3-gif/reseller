import { Controller, Delete, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { InternalSourceOrderStatus, SellerTier } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import type { AuthenticatedUser } from "../types";

import { ProAnalyticsService } from "./pro-analytics.service";
import type { AnalyticsPeriod } from "./pro-analytics.service";

class OverviewQueryDto {
  @IsOptional()
  @IsIn(["today", "week", "month"])
  period?: AnalyticsPeriod;
}

class WarrantyHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  productId?: string;
}

class OrdersQueryDto {
  @IsOptional()
  @IsEnum(InternalSourceOrderStatus)
  status?: InternalSourceOrderStatus;

  @IsOptional()
  @IsString()
  downstreamSellerId?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

@Controller("pro/analytics")
@UseGuards(JwtAuthGuard, SellerTierGuard)
@RequireSellerTier(SellerTier.ULTRA)
export class ProAnalyticsController {
  constructor(
    @Inject(ProAnalyticsService)
    private readonly service: ProAnalyticsService,
  ) {}

  @Get("overview")
  getOverview(@CurrentUser() user: AuthenticatedUser, @Query() query: OverviewQueryDto) {
    return this.service.getSourceOverview(user, query.period);
  }

  @Get("downstream")
  getDownstream(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getDownstreamList(user);
  }

  @Get("orders")
  getOrders(@CurrentUser() user: AuthenticatedUser, @Query() query: OrdersQueryDto) {
    return this.service.getSourceOrders(user, query);
  }

  @Get("top-products")
  getTopProducts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getTopProducts(user);
  }

  @Get("warranty-history")
  getWarrantyHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: WarrantyHistoryQueryDto,
  ) {
    return this.service.getWarrantyHistory(user, {
      page: query.page,
      productId: query.productId,
    });
  }

  @Delete("connections/:id")
  revokeConnection(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.revokeConnection(user, id);
  }
}
