import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../types";

import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    @Inject(ReportsService)
    private readonly reportsService: ReportsService,
  ) {}

  @Get("top-buyers")
  getTopBuyers(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getTopBuyers(user);
  }

  @Get("top-referrers")
  getTopReferrers() {
    return this.reportsService.getTopReferrers();
  }

  @Get("revenue")
  getRevenue(
    @CurrentUser() user: AuthenticatedUser,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    return this.reportsService.getRevenue(user, startDate, endDate);
  }
}
