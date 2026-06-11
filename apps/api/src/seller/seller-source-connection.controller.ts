import { Body, Controller, Delete, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { IsInt, IsNotEmpty, IsString, Min, MinLength } from "class-validator";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import type { AuthenticatedUser } from "../types";

import { SellerSourceConnectionService } from "./seller-source-connection.service";

class ConnectSourceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  apiKey!: string;
}

class TopupPayosDto {
  @IsInt()
  @Min(10000)
  amount!: number;
}

@Controller("seller/source-connection")
@UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
@RequireSellerCapabilities("source_internal_use")
export class SellerSourceConnectionController {
  constructor(
    @Inject(SellerSourceConnectionService)
    private readonly service: SellerSourceConnectionService,
  ) {}

  @Get()
  getCurrentConnection(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getCurrentConnection(user);
  }

  @Get("debug-balance")
  debugBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.service.debugBalance(user);
  }

  @Post("cleanup-orphan-products")
  cleanupOrphanProducts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.cleanupOrphanCatalogProducts(user);
  }

  @Post()
  connect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectSourceDto,
  ) {
    return this.service.connect(user, dto.apiKey);
  }

  @Post("sync-catalog")
  syncCatalog(@CurrentUser() user: AuthenticatedUser) {
    return this.service.syncCatalog(user);
  }

  @Post("inherit-template")
  setInheritTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled: boolean },
  ) {
    return this.service.setInheritTemplate(user, dto.enabled === true);
  }

  @Delete()
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.service.disconnect(user);
  }

  @Post("topup-payos")
  createTopupPayos(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TopupPayosDto,
  ) {
    return this.service.createPayosTopup(user, dto.amount);
  }
}
