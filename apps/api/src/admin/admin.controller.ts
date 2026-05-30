import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { UserRole, WithdrawStatus } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthenticatedUser } from "../types";
import {
  ApproveWithdrawRequestDto,
  RejectWithdrawRequestDto,
} from "../wallet/wallet.dto";
import { WalletService } from "../wallet/wallet.service";

import {
  BulkUpdateSystemConfigDto,
  ListAdminOrdersQueryDto,
  ListSellersQueryDto,
  UpdateSellerTierDto,
  UpdateSellerTierDatesDto,
} from "./admin.dto";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(
    @Inject(AdminService)
    private readonly adminService: AdminService,
    @Inject(WalletService)
    private readonly walletService: WalletService,
  ) {}

  @Get("overview")
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get("revenue-chart")
  getRevenueChart(@Query("days") days?: string) {
    return this.adminService.getRevenueChart(days ? parseInt(days) : 30);
  }

  @Get("recent-sellers")
  getRecentSellers() {
    return this.adminService.getRecentSellers(10);
  }

  @Get("sellers")
  listSellers(@Query() query: ListSellersQueryDto) {
    return this.adminService.listSellers({
      tier: query.tier,
      status: query.status,
      search: query.search,
    });
  }

  @Put("sellers/:userId/tier")
  updateSellerTier(
    @Param("userId") userId: string,
    @Body() body: UpdateSellerTierDto,
  ) {
    return this.adminService.updateSellerTier(userId, body.tier);
  }

  @Put("sellers/:userId/tier-dates")
  updateSellerTierDates(
    @Param("userId") userId: string,
    @Body() body: UpdateSellerTierDatesDto,
  ) {
    return this.adminService.updateSellerTierDates(userId, body);
  }

  @Get("orders")
  listOrders(@Query() query: ListAdminOrdersQueryDto) {
    return this.adminService.listOrders({
      page: query.page ?? 1,
      status: query.status,
      search: query.search,
    });
  }

  @Get("orders/:id")
  async getOrderDetail(@Param("id") id: string) {
    const order = await this.adminService.getOrderDetail(id);
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  @Get("system-config")
  getSystemConfigs() {
    return this.adminService.getSystemConfigs();
  }

  @Put("system-config")
  bulkUpdateSystemConfig(@Body() body: BulkUpdateSystemConfigDto) {
    return this.adminService.bulkUpsertSystemConfig(body.configs);
  }

  @Get("withdraw-requests")
  listWithdrawRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: WithdrawStatus,
  ) {
    return this.walletService.adminListWithdrawRequests(user, status);
  }

  @Post("withdraw-requests/:id/approve")
  approveWithdrawRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: ApproveWithdrawRequestDto,
  ) {
    return this.walletService.adminApproveWithdrawRequest(user, id, { note: body.note });
  }

  @Post("withdraw-requests/:id/reject")
  rejectWithdrawRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: RejectWithdrawRequestDto,
  ) {
    return this.walletService.adminRejectWithdrawRequest(user, id, body.reason);
  }
}
