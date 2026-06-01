import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";
import type { AuthenticatedUser } from "../types";

import { GrantUltraDto, PurchaseTierDto, RefundTierSubscriptionDto, SetAutoRenewDto } from "./tiers.dto";
import { TiersService } from "./tiers.service";

@Controller("tiers")
export class TiersController {
  constructor(
    @Inject(TiersService)
    private readonly tiersService: TiersService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  @Post("internal/run-auto-renewals")
  async runAutoRenewals(@Headers("x-internal-token") token: string) {
    if (!token || token !== this.config.internalApiToken) {
      throw new NotFoundException("Not found.");
    }
    return this.tiersService.processAutoRenewals();
  }

  @Get("quote")
  @UseGuards(JwtAuthGuard)
  getQuote(@CurrentUser() user: AuthenticatedUser) {
    return this.tiersService.getQuote(user);
  }

  @Get("affiliate-stats")
  @UseGuards(JwtAuthGuard)
  getAffiliateStats(@CurrentUser() user: AuthenticatedUser) {
    return this.tiersService.getAffiliateStats(user);
  }

  @Post("purchase")
  @UseGuards(JwtAuthGuard)
  purchase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PurchaseTierDto,
    @Req() req: Request,
  ) {
    const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip;
    return this.tiersService.purchase(user, {
      tier: body.tier,
      plan: body.plan,
      referralCode: body.referralCode,
      discountCode: body.discountCode,
      paymentMethod: body.paymentMethod,
      clientIp,
    });
  }

  @Post("auto-renew")
  @UseGuards(JwtAuthGuard)
  setAutoRenew(@CurrentUser() user: AuthenticatedUser, @Body() body: SetAutoRenewDto) {
    return this.tiersService.setAutoRenew(user, body);
  }

  @Post("admin/grant-ultra")
  @UseGuards(JwtAuthGuard)
  adminGrantUltra(@CurrentUser() user: AuthenticatedUser, @Body() body: GrantUltraDto) {
    return this.tiersService.adminGrantUltra(user, body);
  }

  @Post("admin/subscriptions/:id/refund")
  @UseGuards(JwtAuthGuard)
  refundSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") subscriptionId: string,
    @Body() body: RefundTierSubscriptionDto,
  ) {
    return this.tiersService.refundTierSubscription(user, {
      subscriptionId,
      note: body.note,
    });
  }
}
