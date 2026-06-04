import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, Prisma, SellerTier, UserRole, UserStatus } from "@prisma/client";
import { decryptSecret, isMockBotToken, telegramSetCommands } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { commandsForTier } from "../lib/bot-commands";
import { decimalToNumber } from "../lib/utils";

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async getOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [
      totalSellers,
      activeSellers,
      tierCounts,
      totalOrdersThisMonth,
      totalOrdersLastMonth,
      revenueThisMonth,
      revenueLastMonth,
      totalOrders,
    ] = await Promise.all([
      this.prisma.seller.count(),
      this.prisma.seller.count({ where: { status: "ACTIVE" } }),
      this.prisma.seller.groupBy({
        by: ["tier"],
        _count: { tier: true },
      }),
      this.prisma.order.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      this.prisma.order.count({
        where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
      }),
      this.prisma.order.aggregate({
        where: {
          status: { in: ["DELIVERED", "PAID", "PROCESSING_PURCHASE"] },
          createdAt: { gte: startOfMonth },
        },
        _sum: { totalSaleAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: { in: ["DELIVERED", "PAID", "PROCESSING_PURCHASE"] },
          createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
        },
        _sum: { totalSaleAmount: true },
      }),
      this.prisma.order.count(),
    ]);

    const tierMap: Record<string, number> = {};
    for (const t of tierCounts) {
      tierMap[t.tier.toLowerCase()] = t._count.tier;
    }

    return {
      totalSellers,
      activeSellers,
      tierCounts: tierMap,
      totalOrders,
      totalOrdersThisMonth,
      totalOrdersLastMonth,
      revenueThisMonth: decimalToNumber(revenueThisMonth._sum?.totalSaleAmount ?? 0),
      revenueLastMonth: decimalToNumber(revenueLastMonth._sum?.totalSaleAmount ?? 0),
    };
  }

  async getRevenueChart(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ["DELIVERED", "PAID", "PROCESSING_PURCHASE"] },
        createdAt: { gte: since },
      },
      select: { createdAt: true, totalSaleAmount: true },
    });

    const map = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      map.set(d.toISOString().slice(0, 10), 0);
    }

    for (const order of orders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + decimalToNumber(order.totalSaleAmount));
    }

    return Array.from(map.entries()).map(([date, revenue]) => ({ date, revenue }));
  }

  async getRecentSellers(limit = 10) {
    const users = await this.prisma.user.findMany({
      where: { role: UserRole.SELLER },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        seller: {
          select: {
            displayName: true,
            tier: true,
            status: true,
            shops: {
              take: 1,
              select: { name: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      username: u.email,
      displayName: u.seller?.displayName || null,
      tier: u.seller?.tier.toLowerCase() || null,
      status: u.status.toLowerCase(),
      shopName: u.seller?.shops[0]?.name || null,
      createdAt: u.createdAt,
    }));
  }

  async listSellers(filters: { tier?: SellerTier; status?: string; search?: string }) {
    const users = await this.prisma.user.findMany({
      where: {
        role: UserRole.SELLER,
        ...(filters.status
          ? { status: filters.status.toUpperCase() as UserStatus }
          : {}),
        ...(filters.search
          ? {
              OR: [
                { email: { contains: filters.search, mode: "insensitive" } },
                {
                  seller: {
                    displayName: { contains: filters.search, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
        ...(filters.tier
          ? { seller: { tier: filters.tier } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        seller: {
          include: {
            shops: {
              take: 1,
              orderBy: { createdAt: "asc" },
              select: { id: true, name: true, slug: true, status: true },
            },
            wallet: { select: { balance: true } },
            _count: {
              select: { orders: true, customers: true },
            },
          },
        },
      },
      take: 500,
    });

    return users.map((u) => ({
      id: u.id,
      sellerId: u.seller?.id || null,
      referralCode: u.seller?.referralCode || null,
      username: u.email,
      recoveryEmail: u.recoveryEmail,
      status: u.status.toLowerCase(),
      createdAt: u.createdAt,
      displayName: u.seller?.displayName || null,
      sellerTier: u.seller?.tier.toLowerCase() || null,
      sellerTierStartedAt: u.seller?.tierStartedAt || null,
      sellerTierExpiresAt: u.seller?.tierExpiresAt || null,
      sellerStatus: u.seller?.status.toLowerCase() || null,
      shopId: u.seller?.shops[0]?.id || null,
      shopName: u.seller?.shops[0]?.name || null,
      shopSlug: u.seller?.shops[0]?.slug || null,
      shopStatus: u.seller?.shops[0]?.status.toLowerCase() || null,
      walletBalance: u.seller?.wallet ? decimalToNumber(u.seller.wallet.balance) : 0,
      orderCount: u.seller?._count.orders ?? 0,
      customerCount: u.seller?._count.customers ?? 0,
    }));
  }

  async updateSellerTier(userId: string, tier: SellerTier) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { seller: true },
    });

    if (!user || user.role !== UserRole.SELLER || !user.seller) {
      throw new Error("Seller not found");
    }

    await this.prisma.seller.update({
      where: { id: user.seller.id },
      data: { tier },
    });

    return { id: userId, tier: tier.toLowerCase() };
  }

  async updateSellerTierDates(
    userId: string,
    dates: { tierStartedAt?: string | null; tierExpiresAt?: string | null },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { seller: true },
    });

    if (!user || user.role !== UserRole.SELLER || !user.seller) {
      throw new Error("Seller not found");
    }

    const tierStartedAt =
      "tierStartedAt" in dates
        ? dates.tierStartedAt
          ? new Date(dates.tierStartedAt)
          : null
        : undefined;

    let tierExpiresAt: Date | null | undefined =
      "tierExpiresAt" in dates
        ? dates.tierExpiresAt
          ? new Date(dates.tierExpiresAt)
          : null
        : undefined;

    // Nếu chỉ set tierStartedAt mà không kèm tierExpiresAt → tự tính +30 ngày
    if (tierStartedAt && tierExpiresAt === undefined) {
      tierExpiresAt = new Date(tierStartedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const updated = await this.prisma.seller.update({
      where: { id: user.seller.id },
      data: { tierStartedAt, tierExpiresAt },
      select: { tierStartedAt: true, tierExpiresAt: true },
    });

    return { id: userId, tierStartedAt: updated.tierStartedAt, tierExpiresAt: updated.tierExpiresAt };
  }

  async listOrders(params: { page: number; status?: string; search?: string }) {
    const PAGE_SIZE = 20;
    const skip = (params.page - 1) * PAGE_SIZE;

    const where: Prisma.OrderWhereInput = {};
    if (params.status) {
      where.status = params.status.toUpperCase() as OrderStatus;
    }
    if (params.search) {
      where.OR = [
        { orderCode: { contains: params.search, mode: "insensitive" } },
        { productNameSnapshot: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
        include: {
          seller: { select: { displayName: true } },
          shop: { select: { name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        status: o.status.toLowerCase(),
        productName: o.productNameSnapshot,
        totalAmount: decimalToNumber(o.totalSaleAmount),
        quantity: o.quantity,
        sellerName: o.seller?.displayName || null,
        shopName: o.shop?.name || null,
        createdAt: o.createdAt,
      })),
      total,
      page: params.page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
  }

  async getOrderDetail(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        seller: { select: { displayName: true } },
        shop: { select: { name: true } },
        customer: {
          select: {
            telegramUserId: true,
            firstName: true,
            lastName: true,
          },
        },
        warrantyClaims: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            claimNumber: true,
            status: true,
            customerMessage: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) return null;

    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status.toLowerCase(),
      productName: order.productNameSnapshot,
      totalAmount: decimalToNumber(order.totalSaleAmount),
      quantity: order.quantity,
      unitPrice: decimalToNumber(order.salePrice),
      deliveredAccountText: order.deliveredAccountText,
      sellerName: order.seller?.displayName || null,
      shopName: order.shop?.name || null,
      customerTelegramId: order.customer?.telegramUserId || null,
      customerName:
        [order.customer?.firstName, order.customer?.lastName]
          .filter(Boolean)
          .join(" ") || null,
      warrantyPolicy: order.warrantyPolicySnapshot,
      warrantyClaims: order.warrantyClaims,
      sourceProviderKind: order.sourceProviderKindSnapshot,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  async getSystemConfigs() {
    const configs = await this.prisma.systemConfig.findMany();
    return Object.fromEntries(configs.map((c) => [c.key, c.value]));
  }

  async upsertSystemConfig(key: string, value: string) {
    await this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { key, value };
  }

  async bulkUpsertSystemConfig(configs: Record<string, string>) {
    await this.prisma.$transaction(
      Object.entries(configs).map(([key, value]) =>
        this.prisma.systemConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    return this.getSystemConfigs();
  }

  async syncBotCommands(shopId?: string) {
    const rows = await this.prisma.botConfig.findMany({
      where: shopId ? { shopId } : {},
      select: {
        shopId: true,
        telegramBotTokenEncrypted: true,
        telegramBotUsername: true,
        shop: { select: { seller: { select: { tier: true } } } },
      },
    });
    if (shopId && rows.length === 0) {
      throw new NotFoundException("Shop or BotConfig not found");
    }

    type SyncResult = {
      shopId: string;
      botUsername: string | null;
      tier: SellerTier;
      status: "ok" | "skipped" | "failed";
      reason?: string;
      error?: string;
    };

    const concurrency = 5;
    const queue = [...rows];
    const results: SyncResult[] = [];

    const run = async () => {
      while (queue.length > 0) {
        const row = queue.shift();
        if (!row) break;
        const tier = row.shop?.seller?.tier ?? SellerTier.PRO;
        const commands = commandsForTier(tier);
        let token = "";
        try {
          token = decryptSecret(row.telegramBotTokenEncrypted, this.config.encryptionKey);
        } catch {
          token = "";
        }
        if (!token) {
          results.push({ shopId: row.shopId, botUsername: row.telegramBotUsername, tier, status: "skipped", reason: "no_token" });
          continue;
        }
        if (isMockBotToken(token)) {
          results.push({ shopId: row.shopId, botUsername: row.telegramBotUsername, tier, status: "skipped", reason: "mock_token" });
          continue;
        }
        try {
          await telegramSetCommands(token, commands);
          results.push({ shopId: row.shopId, botUsername: row.telegramBotUsername, tier, status: "ok" });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error(`[sync-bot-commands] failed shop=${row.shopId} bot=${row.telegramBotUsername ?? "?"} err=${message}`);
          results.push({ shopId: row.shopId, botUsername: row.telegramBotUsername, tier, status: "failed", error: message });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length || 1) }, () => run()));

    const ok = results.filter((r) => r.status === "ok").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;
    // eslint-disable-next-line no-console
    console.log(`[sync-bot-commands] done total=${results.length} ok=${ok} skipped=${skipped} failed=${failed}`);

    return { total: results.length, ok, skipped, failed, results };
  }
}
