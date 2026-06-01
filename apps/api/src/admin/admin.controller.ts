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
import { UserRole } from "@prisma/client";

import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";

import {
  BulkUpdateSystemConfigDto,
  ListAdminOrdersQueryDto,
  ListSellersQueryDto,
  TestProxiesDto,
  UpdateSellerTierDto,
  UpdateSellerTierDatesDto,
  WarrantyStatsQueryDto,
} from "./admin.dto";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(
    @Inject(AdminService)
    private readonly adminService: AdminService,
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

  // Thống kê bảo hành theo ngày (giờ VN) — chia cột theo giờ/phút để quản lý số lượng,
  // kèm số acc hoàn tiền / thay mới và tốc độ phát sinh 1 phút / 1 giờ / 24h gần nhất.
  @Get("warranty-stats")
  getWarrantyStats(@Query() query: WarrantyStatsQueryDto) {
    return this.adminService.getWarrantyStats(query.date, query.granularity ?? "hour");
  }

  // Sức khỏe vận hành pipeline bảo hành: hàng đợi, proxy sống/tổng, tỉ lệ tool thành công 24h,
  // trạng thái Redis circuit. Hiển thị trên dashboard admin (cảnh báo khi proxy sống = 0).
  @Get("warranty-metrics")
  getWarrantyMetrics() {
    return this.adminService.getWarrantyMetrics();
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

  // Test proxy TRƯỚC khi lưu — admin dán proxy vào ô, bấm "Test" để biết con nào sống/khỏe.
  @Post("test-proxies")
  testProxies(@Body() body: TestProxiesDto) {
    return this.adminService.testProxies(body.proxies, body.mode || "full");
  }
}
