import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";

import { PublicWarrantyClaimDto, PublicWarrantySearchDto } from "./warranty.dto";
import { WarrantyService } from "./warranty.service";

@Controller("public/warranty")
@UseGuards(ThrottlerGuard)
export class WarrantyPublicController {
  constructor(
    @Inject(WarrantyService)
    private readonly warrantyService: WarrantyService,
  ) {}

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

  // RES-1: 30 claims / 10 min per IP in production. Raise via CLAIM_RATE_LIMIT env var for testing.
  @Post("claim")
  @Throttle({ default: { ttl: 600000, limit: Number(process.env.CLAIM_RATE_LIMIT ?? 30) } })
  submitClaim(@Body() dto: PublicWarrantyClaimDto) {
    return this.warrantyService.publicSubmitClaim(dto);
  }
}
