import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";

import { PublicWarrantyClaimDto, PublicWarrantySearchDto } from "./warranty.dto";
import { WarrantyService } from "./warranty.service";

@Controller("public/warranty")
@UseGuards(ThrottlerGuard)
export class WarrantyPublicController {
  constructor(private readonly warrantyService: WarrantyService) {}

  @Get("shop/:slug")
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  getShopInfo(@Param("slug") slug: string) {
    return this.warrantyService.publicGetShopInfo(slug);
  }

  @Post("search")
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  searchOrders(@Body() dto: PublicWarrantySearchDto) {
    return this.warrantyService.publicSearchOrders(dto);
  }

  @Post("claim")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  submitClaim(@Body() dto: PublicWarrantyClaimDto) {
    return this.warrantyService.publicSubmitClaim(dto);
  }
}
