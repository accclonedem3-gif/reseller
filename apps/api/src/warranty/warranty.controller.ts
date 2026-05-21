import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import type { AuthenticatedUser } from "../types";

import { OpenWarrantyClaimDto, RejectWarrantyClaimDto, ResolveWarrantyClaimDto } from "./warranty.dto";
import { WarrantyService } from "./warranty.service";

@Controller("warranty")
export class WarrantyController {
  constructor(
    @Inject(WarrantyService)
    private readonly warrantyService: WarrantyService,
  ) {}

  @Post("claim")
  openClaim(@Body() dto: OpenWarrantyClaimDto) {
    return this.warrantyService.openClaim(dto);
  }

  @Get("claims")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("warranty_manage")
  listClaims(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
  ) {
    return this.warrantyService.listClaims(user, status);
  }

  @Get("claims/:id")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("warranty_manage")
  getClaim(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.warrantyService.getClaim(user, id);
  }

  @Put("claims/:id/resolve")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("warranty_manage")
  resolveClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: ResolveWarrantyClaimDto,
  ) {
    return this.warrantyService.resolveClaimManually(user, id, body);
  }

  @Post("claims/:id/resolve-manual")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("warranty_manage")
  resolveClaimManually(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: ResolveWarrantyClaimDto,
  ) {
    return this.warrantyService.resolveClaimManually(user, id, body);
  }

  @Post("claims/:id/reject")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("warranty_manage")
  rejectClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: RejectWarrantyClaimDto,
  ) {
    return this.warrantyService.rejectClaim(user, id, body);
  }
}
