import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DownstreamSourceConnectionStatus,
  InternalSourceOrderStatus,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import { decimalToNumber } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

export type AnalyticsPeriod = "today" | "week" | "month";

@Injectable()
export class ProAnalyticsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
  ) {}

  private getDateRange(period: AnalyticsPeriod) {
    const now = new Date();
    const start = new Date();
    if (period === "today") {
      start.setHours(0, 0, 0, 0);
    } else if (period === "week") {
      const day = now.getDay();
      start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }
    return { start, end: now };
  }

  async getSourceOverview(user: AuthenticatedUser, period: AnalyticsPeriod = "month") {
    const shop = await this.shopsService.getSellerShop(user.id);
    const { start, end } = this.getDateRange(period);

    const [totalOrders, deliveredOrders, activeConnections, stockResult, warrantyCounts, warrantyCostResult] =
      await Promise.all([
        this.prisma.internalSourceOrder.count({
          where: { upstreamShopId: shop.id, createdAt: { gte: start, lte: end } },
        }),
        this.prisma.internalSourceOrder.findMany({
          where: {
            upstreamShopId: shop.id,
            status: InternalSourceOrderStatus.DELIVERED,
            createdAt: { gte: start, lte: end },
          },
          select: { totalAmount: true, sourcePriceSnapshot: true, quantity: true },
        }),
        this.prisma.downstreamSourceConnection.count({
          where: { upstreamShopId: shop.id, status: DownstreamSourceConnectionStatus.ACTIVE },
        }),
        this.prisma.sourceProduct.aggregate({
          _sum: { available: true },
          where: { shopId: shop.id, internalSourceEnabled: true },
        }),
        this.prisma.warrantyClaim.groupBy({
          by: ["status"],
          _count: { id: true },
          where: {
            order: {
              internalSourceOrder: { upstreamShopId: shop.id },
            },
            createdAt: { gte: start, lte: end },
          },
        }),
        this.prisma.warrantyClaim.aggregate({
          _sum: { replacementCostSnapshot: true },
          where: {
            order: {
              internalSourceOrder: { upstreamShopId: shop.id },
            },
            status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] },
            resolvedAt: { gte: start, lte: end },
          },
        }),
      ]);

    let revenue = 0;
    let cost = 0;
    for (const o of deliveredOrders) {
      revenue += decimalToNumber(o.totalAmount);
      cost += decimalToNumber(o.sourcePriceSnapshot) * o.quantity;
    }

    const warrantyTotal = warrantyCounts.reduce((s, r) => s + r._count.id, 0);
    const warrantyAutoResolved = warrantyCounts
      .filter((r) => r.status === "AUTO_RESOLVED")
      .reduce((s, r) => s + r._count.id, 0);
    const warrantyCost = warrantyCostResult._sum.replacementCostSnapshot
      ? decimalToNumber(warrantyCostResult._sum.replacementCostSnapshot)
      : 0;

    return {
      period,
      totalOrders,
      revenue,
      cost,
      grossProfit: revenue - cost - warrantyCost,
      activeConnections,
      totalAvailableStock: stockResult._sum.available ?? 0,
      warrantyTotal,
      warrantyAutoResolved,
      warrantyCost,
    };
  }

  async getDownstreamList(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const connections = await this.prisma.downstreamSourceConnection.findMany({
      where: { upstreamShopId: shop.id },
      include: {
        downstreamSeller: { select: { id: true, displayName: true } },
        downstreamShop: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Batch-fetch wallet balances for all connections
    const downstreamChatIds = connections
      .map((c) => c.downstreamTelegramChatId)
      .filter((id): id is string => !!id);

    const wallets = downstreamChatIds.length > 0
      ? await this.prisma.customerWallet.findMany({
          where: { customer: { shopId: shop.id, telegramChatId: { in: downstreamChatIds } } },
          include: { customer: { select: { telegramChatId: true } } },
        })
      : [];

    const walletByChatId = new Map(wallets.map((w) => [w.customer.telegramChatId, decimalToNumber(w.balance)]));

    const stats = await Promise.all(
      connections.map(async (conn) => {
        const [totalOrders, revenueResult] = await Promise.all([
          this.prisma.internalSourceOrder.count({
            where: { connectionId: conn.id },
          }),
          this.prisma.internalSourceOrder.aggregate({
            _sum: { totalAmount: true },
            where: {
              connectionId: conn.id,
              status: InternalSourceOrderStatus.DELIVERED,
            },
          }),
        ]);

        const balance = conn.downstreamTelegramChatId
          ? (walletByChatId.get(conn.downstreamTelegramChatId) ?? 0)
          : 0;

        return {
          id: conn.id,
          downstreamSellerId: conn.downstreamSellerId,
          downstreamSellerName: conn.downstreamSeller.displayName,
          shopName: conn.downstreamShop.name,
          shopSlug: conn.downstreamShop.slug,
          balance,
          currency: conn.currency,
          status: conn.status,
          totalOrders,
          totalRevenue: revenueResult._sum.totalAmount
            ? decimalToNumber(revenueResult._sum.totalAmount)
            : 0,
          lastOrderedAt: conn.lastOrderedAt,
          createdAt: conn.createdAt,
        };
      }),
    );

    return stats;
  }

  async getSourceOrders(
    user: AuthenticatedUser,
    filters: {
      status?: InternalSourceOrderStatus;
      downstreamSellerId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { upstreamShopId: shop.id };
    if (filters.status) where.status = filters.status;
    if (filters.downstreamSellerId) where.downstreamSellerId = filters.downstreamSellerId;
    if (filters.dateFrom || filters.dateTo) {
      const range: Record<string, Date> = {};
      if (filters.dateFrom) range.gte = new Date(filters.dateFrom);
      if (filters.dateTo) range.lte = new Date(filters.dateTo);
      where.createdAt = range;
    }

    const [total, orders] = await Promise.all([
      this.prisma.internalSourceOrder.count({ where }),
      this.prisma.internalSourceOrder.findMany({
        where,
        include: {
          downstreamSeller: { select: { displayName: true } },
          sourceProduct: { select: { sourceName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      items: orders.map((o) => ({
        id: o.id,
        orderCode: o.sourceOrderCode,
        downstreamOrderCode: o.downstreamOrderCode,
        downstreamSellerName: o.downstreamSeller.displayName,
        productName: o.sourceProduct.sourceName,
        quantity: o.quantity,
        unitPrice: decimalToNumber(o.unitPrice),
        totalAmount: decimalToNumber(o.totalAmount),
        status: o.status,
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt,
      })),
    };
  }

  async getTopProducts(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const [products, orderStats, warrantyStats] = await Promise.all([
      this.prisma.sourceProduct.findMany({
        where: { shopId: shop.id, internalSourceEnabled: true },
        orderBy: { soldCount: "desc" },
      }),
      this.prisma.internalSourceOrder.groupBy({
        by: ["sourceProductId"],
        _sum: { totalAmount: true, quantity: true },
        _count: { id: true },
        where: {
          upstreamShopId: shop.id,
          status: InternalSourceOrderStatus.DELIVERED,
        },
      }),
      this.prisma.warrantyClaim.groupBy({
        by: ["status"],
        _count: { id: true },
        where: {
          order: {
            internalSourceOrder: { upstreamShopId: shop.id },
          },
        },
      }),
    ]);

    const ordersByProduct = new Map(
      orderStats.map((r) => [r.sourceProductId, r]),
    );

    const warrantyByStatus = new Map(
      warrantyStats.map((r) => [r.status, r._count.id]),
    );

    return products.map((p) => {
      const stat = ordersByProduct.get(p.id);
      const revenue = stat?._sum.totalAmount ? decimalToNumber(stat._sum.totalAmount) : 0;
      const unitsSold = stat?._sum.quantity ?? p.soldCount;
      const sourcePrice = decimalToNumber(p.sourcePrice);
      const internalPrice = decimalToNumber(p.internalSourcePrice ?? p.sourcePrice);
      const cost = sourcePrice * unitsSold;
      const grossProfit = revenue - cost;

      return {
        id: p.id,
        productIcon: p.productIcon,
        name: p.sourceName,
        sourcePrice,
        internalPrice,
        profitPerUnit: internalPrice - sourcePrice,
        available: p.available ?? 0,
        soldCount: unitsSold,
        revenue,
        cost,
        grossProfit,
      };
    });
  }

  async getWarrantyHistory(user: AuthenticatedUser, params: { page?: number; productId?: string }) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const PAGE_SIZE = 20;
    const page = Math.max(1, params.page ?? 1);
    const skip = (page - 1) * PAGE_SIZE;

    const where: Prisma.WarrantyClaimWhereInput = {
      order: {
        internalSourceOrder: params.productId
          ? { upstreamShopId: shop.id, sourceProductId: params.productId }
          : { upstreamShopId: shop.id },
      },
    };

    const [claims, total] = await Promise.all([
      this.prisma.warrantyClaim.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
        include: {
          order: {
            select: {
              orderCode: true,
              productNameSnapshot: true,
              salePrice: true,
              internalSourceOrder: {
                select: {
                  sourceOrderCode: true,
                  sourcePriceSnapshot: true,
                  unitPrice: true,
                  quantity: true,
                  sourceProduct: { select: { sourceName: true, productIcon: true } },
                  downstreamSeller: { select: { displayName: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.warrantyClaim.count({ where }),
    ]);

    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(total / PAGE_SIZE),
      items: claims.map((c) => ({
        id: c.id,
        claimNumber: c.claimNumber,
        status: c.status,
        orderCode: c.orderCodeSnapshot,
        productName: c.order.internalSourceOrder?.sourceProduct.sourceName ?? c.productNameSnapshot,
        productIcon: c.order.internalSourceOrder?.sourceProduct.productIcon ?? null,
        downstreamSeller: c.order.internalSourceOrder?.downstreamSeller.displayName ?? null,
        sourceOrderCode: c.order.internalSourceOrder?.sourceOrderCode ?? null,
        unitPrice: c.order.internalSourceOrder ? decimalToNumber(c.order.internalSourceOrder.unitPrice) : 0,
        sourcePriceSnapshot: c.order.internalSourceOrder ? decimalToNumber(c.order.internalSourceOrder.sourcePriceSnapshot) : 0,
        quantity: c.order.internalSourceOrder?.quantity ?? 1,
        replacementCost: c.replacementCostSnapshot ? decimalToNumber(c.replacementCostSnapshot) : null,
        customerMessage: c.customerMessage,
        resolutionNote: c.resolutionNote,
        resolvedAt: c.resolvedAt,
        createdAt: c.createdAt,
      })),
    };
  }

  async getChartData(user: AuthenticatedUser, days: number = 30) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);

    const orders = await this.prisma.internalSourceOrder.findMany({
      where: {
        upstreamShopId: shop.id,
        status: InternalSourceOrderStatus.DELIVERED,
        createdAt: { gte: start, lte: end },
      },
      select: { totalAmount: true, sourcePriceSnapshot: true, quantity: true, createdAt: true },
    });

    const byDay = new Map<string, { revenue: number; cost: number }>();
    for (const o of orders) {
      const label = o.createdAt.toISOString().slice(0, 10);
      const existing = byDay.get(label) ?? { revenue: 0, cost: 0 };
      existing.revenue += decimalToNumber(o.totalAmount);
      existing.cost += decimalToNumber(o.sourcePriceSnapshot) * o.quantity;
      byDay.set(label, existing);
    }

    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toISOString().slice(0, 10);
      const data = byDay.get(label) ?? { revenue: 0, cost: 0 };
      result.push({ label, revenue: data.revenue, grossProfit: data.revenue - data.cost });
    }
    return result;
  }

  async revokeConnection(user: AuthenticatedUser, connectionId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: { id: connectionId, upstreamShopId: shop.id },
    });

    if (!connection) {
      throw new NotFoundException("Connection not found.");
    }

    if (connection.status === DownstreamSourceConnectionStatus.REVOKED) {
      throw new ForbiddenException("Connection is already revoked.");
    }

    return this.prisma.downstreamSourceConnection.update({
      where: { id: connectionId },
      data: { status: DownstreamSourceConnectionStatus.REVOKED },
    });
  }
}
