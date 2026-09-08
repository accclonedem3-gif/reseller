import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";
import type { AuthenticatedUser } from "../types";

import { CreateUpgradePaymentDto } from "./upgrade.dto";
import { UpgradeService } from "./upgrade.service";

@Controller("upgrade")
@UseGuards(JwtAuthGuard)
export class UpgradeController {
  constructor(
    @Inject(UpgradeService)
    private readonly upgradeService: UpgradeService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
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
  async mockConfirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("externalOrderCode") externalOrderCode: string,
  ) {
    if (
      this.config.nodeEnv === "production"
      || this.config.paymentMode.trim().toLowerCase() !== "mock"
    ) {
      throw new NotFoundException("Not found.");
    }

    const result = await this.upgradeService.confirmMockUpgrade(
      user,
      externalOrderCode,
    );

    return result ?? { skipped: true };
  }
}
