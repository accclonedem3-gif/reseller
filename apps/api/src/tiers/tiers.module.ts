import { Module } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";

import { TierAffiliateService } from "./tier-affiliate.service";
import { TiersController } from "./tiers.controller";
import { TiersService } from "./tiers.service";

@Module({
  controllers: [TiersController],
  providers: [
    AppConfigService,
    PrismaService,
    PaymentService,
    TiersService,
    TierAffiliateService,
  ],
  exports: [TiersService, TierAffiliateService],
})
export class TiersModule {}
