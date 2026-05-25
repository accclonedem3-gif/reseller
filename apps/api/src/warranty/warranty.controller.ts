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
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import type { AuthenticatedUser } from "../types";

import { OpenWarrantyClaimDto, RejectWarrantyClaimDto, ResolveWarrantyClaimDto } from "./warranty.dto";
import { WarrantyAutoCheckService } from "./warranty-auto-check.service";
import { WarrantyService } from "./warranty.service";

@Controller("warranty")
@UseGuards(ThrottlerGuard)
export class WarrantyController {
  constructor(
    @Inject(WarrantyService)
    private readonly warrantyService: WarrantyService,
    @Inject(WarrantyAutoCheckService)
    private readonly autoCheckService: WarrantyAutoCheckService,
  ) {}

  @Get("claims/:id/auto-check")
  @Throttle({ default: { ttl: 10000, limit: 30 } })
  async getAutoCheckStatus(@Param("id") id: string, @Query("token") token?: string) {
    const status = await this.autoCheckService.getStatus(id, token);
    return status || { autoCheckStatus: null };
  }

  // SECURITY NOTE: this endpoint is unauthenticated — any caller knowing an orderCode can
  // open a claim. It was the legacy pre-publicSubmitClaim path and the JwtAuthGuard was never
  // added. TODO: add @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard), inject @CurrentUser(),
  // and scope the order lookup to the seller's own shop in openClaim().
  @Post("claim")
  @Throttle({ default: { ttl: 60000, limit: 5 } })
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

  @Post("claims/:id/recheck")
  @UseGuards(JwtAuthGuard, SellerCapabilitiesGuard)
  @RequireSellerCapabilities("warranty_manage")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  recheckClaim(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.warrantyService.recheckClaim(user, id);
  }
}
