import {
  Body,
  Controller,
  Delete,
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
  GenerateUserbotLicenseKeyDto,
  ListAdminOrdersQueryDto,
  ListSellersQueryDto,
  RefundAdminOrderDto,
  SyncBotCommandsDto,
  UpdateSellerAffiliateCommissionDto,
  UpdateSellerTierDatesDto,
  UpdateSellerTierDto,
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

  @Get("global-search")
  globalSearch(@Query("q") query?: string) {
    return this.adminService.globalSearch(query || "");
  }

  @Get("finance")
  getFinanceOperations() {
    return this.adminService.getFinanceOperations();
  }

  @Get("system-health")
  getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  @Get("customers")
  listSystemCustomers(@Query("search") search?: string) {
    return this.adminService.listSystemCustomers(search);
  }

  @Get("automations")
  getAutomations() {
    return this.adminService.getAutomations();
  }

  @Get("top-referrers")
  getTopReferrers(@Query("limit") limit?: string) {
    return this.adminService.getTopReferrers(limit ? parseInt(limit) : 50);
  }

  @Get("sellers")
  listSellers(@Query() query: ListSellersQueryDto) {
    return this.adminService.listSellers({
      tier: query.tier,
      status: query.status,
      search: query.search,
    });
  }

  @Get("sellers/:userId")
  getSellerDetail(@Param("userId") userId: string) {
    return this.adminService.getSellerDetail(userId);
  }

  @Put("sellers/:userId/affiliate-commission")
  updateSellerAffiliateCommission(
    @Param("userId") userId: string,
    @Body() body: UpdateSellerAffiliateCommissionDto,
  ) {
    return this.adminService.updateSellerAffiliateCommission(
      userId,
      body.affiliateCommissionPercent ?? null,
    );
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

  @Post("orders/:id/refund")
  refundOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: RefundAdminOrderDto,
  ) {
    return this.adminService.refundOrderToCustomerWallet(user, id, body);
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

  @Post("sync-bot-commands")
  syncBotCommands(@Body() body: SyncBotCommandsDto) {
    return this.adminService.syncBotCommands(body.shopId);
  }

  @Get("debug/connections-by-chat-id/:chatId")
  debugConnectionsByChatId(@Param("chatId") chatId: string) {
    return this.adminService.debugConnectionsByChatId(chatId);
  }

  @Post("userbot-licenses/generate")
  generateUserbotLicenseKeys(@Body() body: GenerateUserbotLicenseKeyDto) {
    return this.adminService.generateUserbotLicenseKeys(body.type, body.durationDays, body.count);
  }

  @Get("userbot-licenses")
  listUserbotLicenseKeys() {
    return this.adminService.listUserbotLicenseKeys();
  }

  @Delete("userbot-licenses/:id")
  deleteUserbotLicenseKey(@Param("id") id: string) {
    return this.adminService.deleteUserbotLicenseKey(id);
  }

  @Post("userbot-licenses/:id/reset")
  resetUserbotLicenseKey(@Param("id") id: string) {
    return this.adminService.resetUserbotLicenseKey(id);
  }
}
