import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";
import { decimalToNumber } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

@Injectable()
export class ReportsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
  ) {}

  async getTopBuyers(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const orders = await this.prisma.order.findMany({
      where: {
        shopId: shop.id,
        paymentStatus: "PAID",
      },
      include: {
        customer: true,
      },
    });

    const grouped = new Map<
      string,
      {
        customerId: string;
        name: string;
        telegramUsername: string | null;
        totalOrders: number;
        totalSpent: number;
      }
    >();

    for (const order of orders) {
      const current = grouped.get(order.customerId) || {
        customerId: order.customerId,
        name:
          [order.customer.firstName, order.customer.lastName]
            .filter(Boolean)
            .join(" ") ||
          order.customer.telegramUsername ||
          order.customer.telegramUserId,
        telegramUsername: order.customer.telegramUsername,
        totalOrders: 0,
        totalSpent: 0,
      };

      current.totalOrders += 1;
      current.totalSpent += decimalToNumber(order.totalSaleAmount);
      grouped.set(order.customerId, current);
    }

    return Array.from(grouped.values())
      .sort((left, right) => right.totalSpent - left.totalSpent)
      .slice(0, 10);
  }

  async getTopReferrers() {
    return {
      items: [],
      message:
        "Phần referral đang ở mức MVP. Schema đã sẵn sàng nhưng hiện chưa có sự kiện giới thiệu nào được ghi nhận.",
    };
  }

  async getRevenue(user: AuthenticatedUser, startDate?: string, endDate?: string) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Resolve chart window
    let rangeStart: Date;
    let rangeEnd: Date;
    if (startDate && endDate) {
      rangeStart = new Date(`${startDate}T00:00:00`);
      rangeEnd = new Date(`${endDate}T23:59:59.999`);
    } else {
      rangeStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
      rangeEnd = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const day7Start = new Date(todayStart); day7Start.setDate(todayStart.getDate() - 6);
    const day30Start = new Date(todayStart); day30Start.setDate(todayStart.getDate() - 29);
    const day90Start = new Date(todayStart); day90Start.setDate(todayStart.getDate() - 89);

    const [rangeOrders, allOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: { shopId: shop.id, paymentStatus: "PAID", createdAt: { gte: rangeStart, lte: rangeEnd } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.order.findMany({
        where: { shopId: shop.id, paymentStatus: "PAID" },
        select: { createdAt: true, totalSaleAmount: true, totalSourceAmount: true },
      }),
    ]);

    const points = new Map<
      string,
      {
        label: string;
        grossRevenue: number;
        estimatedProfit: number;
        deliveredOrders: number;
      }
    >();

    for (const order of rangeOrders) {
      const label = order.createdAt.toISOString().slice(0, 10);
      const current = points.get(label) || {
        label,
        grossRevenue: 0,
        estimatedProfit: 0,
        deliveredOrders: 0,
      };

      const totalSale = decimalToNumber(order.totalSaleAmount);
      const totalSource = decimalToNumber(order.totalSourceAmount);
      current.grossRevenue += totalSale;
      current.estimatedProfit += totalSale - totalSource;
      if (order.status === "DELIVERED") {
        current.deliveredOrders += 1;
      }
      points.set(label, current);
    }

    const series = Array.from(points.values());
    const totals = series.reduce(
      (accumulator, item) => ({
        grossRevenue: accumulator.grossRevenue + item.grossRevenue,
        estimatedProfit: accumulator.estimatedProfit + item.estimatedProfit,
        deliveredOrders: accumulator.deliveredOrders + item.deliveredOrders,
      }),
      { grossRevenue: 0, estimatedProfit: 0, deliveredOrders: 0 },
    );

    const profitSummary = { today: 0, last7d: 0, last30d: 0, last90d: 0, allTime: 0 };
    for (const o of allOrders) {
      const profit = decimalToNumber(o.totalSaleAmount) - decimalToNumber(o.totalSourceAmount);
      profitSummary.allTime += profit;
      if (o.createdAt >= day90Start) profitSummary.last90d += profit;
      if (o.createdAt >= day30Start) profitSummary.last30d += profit;
      if (o.createdAt >= day7Start) profitSummary.last7d += profit;
      if (o.createdAt >= todayStart) profitSummary.today += profit;
    }

    return { summary: totals, series, profitSummary };
  }
}
