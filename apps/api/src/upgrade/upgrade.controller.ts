import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../types";

import { CreateUpgradePaymentDto } from "./upgrade.dto";
import { UpgradeService } from "./upgrade.service";

@Controller("upgrade")
@UseGuards(JwtAuthGuard)
export class UpgradeController {
  constructor(
    @Inject(UpgradeService)
    private readonly upgradeService: UpgradeService,
  ) {}

  /**
   * Tạo payment link để nâng gói.
   * POST /upgrade/payment
   */
  @Post("payment")
  createUpgradePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateUpgradePaymentDto,
  ) {
    return this.upgradeService.createUpgradePayment(user, body.targetTier);
  }

  /**
   * Lấy trạng thái upgrade payment.
   * GET /upgrade/payment/:externalOrderCode
   */
  @Get("payment/:externalOrderCode")
  getUpgradeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("externalOrderCode") externalOrderCode: string,
  ) {
    return this.upgradeService.getUpgradeStatus(user, externalOrderCode);
  }

  /**
   * Mock confirm — chỉ dùng khi MOCK mode (dev).
   * POST /upgrade/mock-confirm/:externalOrderCode
   */
  @Post("mock-confirm/:externalOrderCode")
  async mockConfirm(@Param("externalOrderCode") externalOrderCode: string) {
    const result = await this.upgradeService.confirmUpgradeByExternalOrderCode(
      externalOrderCode,
      { mock: true, confirmedAt: new Date().toISOString() },
    );

    return result ?? { skipped: true };
  }
}
