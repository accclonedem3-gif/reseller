import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CustomerWalletLedgerType, OrderStatus, Prisma, SellerTier, UserRole, UserStatus, WalletLedgerType } from "@prisma/client";
import { decryptSecret, isMockBotToken, telegramSetCommands } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { AffiliateService } from "../affiliate/affiliate.service";
import { PrismaService } from "../db/prisma.service";
import { commandsForTier } from "../lib/bot-commands";
import { FeatureFlagService } from "../lib/feature-flag.service";
import { decimalToNumber, toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";
import type { RefundAdminOrderDto } from "./admin.dto";

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(FeatureFlagService)
    private readonly featureFlags: FeatureFlagService,
    @Inject(AffiliateService)
    private readonly affiliateService: AffiliateService,
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

  async globalSearch(rawQuery: string) {
    const query = rawQuery.trim();
    if (query.length < 2) return { sellers: [], customers: [], orders: [] };

    const [sellers, customers, orders] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          role: UserRole.SELLER,
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { seller: { displayName: { contains: query, mode: "insensitive" } } },
          ],
        },
        take: 6,
        select: { id: true, email: true, seller: { select: { displayName: true, tier: true, status: true } } },
      }),
      this.prisma.customer.findMany({
        where: {
          OR: [
            { telegramUserId: { contains: query, mode: "insensitive" } },
            { telegramChatId: { contains: query, mode: "insensitive" } },
            { telegramUsername: { contains: query, mode: "insensitive" } },
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 6,
        select: { id: true, telegramUserId: true, telegramUsername: true, firstName: true, lastName: true, shop: { select: { name: true } } },
      }),
      this.prisma.order.findMany({
        where: {
          OR: [
            { orderCode: { contains: query, mode: "insensitive" } },
            { productNameSnapshot: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, orderCode: true, productNameSnapshot: true, status: true, totalSaleAmount: true },
      }),
    ]);

    return {
      sellers: sellers.map((row) => ({ id: row.id, title: row.seller?.displayName || row.email, subtitle: `${row.email} · ${row.seller?.tier ?? "FREE"}`, status: row.seller?.status ?? null })),
      customers: customers.map((row) => ({ id: row.id, title: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.telegramUsername || row.telegramUserId, subtitle: `${row.shop.name} · ${row.telegramUserId}` })),
      orders: orders.map((row) => ({ id: row.id, title: row.orderCode, subtitle: row.productNameSnapshot, status: row.status, amount: decimalToNumber(row.totalSaleAmount) })),
    };
  }

  async getSellerDetail(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.SELLER },
      include: {
        seller: {
          include: {
            wallet: true,
            shops: { include: { botConfig: true, paymentConfig: true, providerConfig: true } },
            tierSubscriptions: { orderBy: { createdAt: "desc" }, take: 10 },
            ledgers: { orderBy: { createdAt: "desc" }, take: 15 },
            _count: { select: { orders: true, customers: true, referrals: true, withdraws: true } },
          },
        },
      },
    });
    if (!user?.seller) throw new NotFoundException("Seller not found");

    const [revenue, recentOrders] = await Promise.all([
      this.prisma.order.aggregate({
        where: { sellerId: user.seller.id, status: { in: ["DELIVERED", "PAID", "PROCESSING_PURCHASE"] } },
        _sum: { totalSaleAmount: true, totalSourceAmount: true },
      }),
      this.prisma.order.findMany({
        where: { sellerId: user.seller.id }, orderBy: { createdAt: "desc" }, take: 10,
        select: { id: true, orderCode: true, productNameSnapshot: true, status: true, totalSaleAmount: true, createdAt: true },
      }),
    ]);

    const seller = user.seller;
    return {
      user: { id: user.id, email: user.email, recoveryEmail: user.recoveryEmail, status: user.status, createdAt: user.createdAt },
      seller: { id: seller.id, displayName: seller.displayName, phone: seller.phone, status: seller.status, tier: seller.tier, tierStartedAt: seller.tierStartedAt, tierExpiresAt: seller.tierExpiresAt, referralCode: seller.referralCode, signupIp: seller.signupIp },
      metrics: { walletBalance: decimalToNumber(seller.wallet?.balance), orders: seller._count.orders, customers: seller._count.customers, referrals: seller._count.referrals, withdraws: seller._count.withdraws, revenue: decimalToNumber(revenue._sum.totalSaleAmount), sourceCost: decimalToNumber(revenue._sum.totalSourceAmount) },
      shops: seller.shops.map((shop) => ({ id: shop.id, name: shop.name, slug: shop.slug, status: shop.status, botUsername: shop.botConfig?.telegramBotUsername ?? null, webhookStatus: shop.botConfig?.webhookStatus ?? null, deliveryMode: shop.botConfig?.deliveryMode ?? null, paymentProvider: shop.paymentConfig?.provider ?? null, sourceProvider: shop.providerConfig?.providerKind ?? null })),
      subscriptions: seller.tierSubscriptions.map((row) => ({ ...row, priceVnd: decimalToNumber(row.priceVnd), level1CommissionVnd: decimalToNumber(row.level1CommissionVnd), level2CommissionVnd: decimalToNumber(row.level2CommissionVnd) })),
      ledgers: seller.ledgers.map((row) => ({ ...row, amount: decimalToNumber(row.amount), balanceBefore: decimalToNumber(row.balanceBefore), balanceAfter: decimalToNumber(row.balanceAfter) })),
      recentOrders: recentOrders.map((row) => ({ ...row, totalSaleAmount: decimalToNumber(row.totalSaleAmount) })),
    };
  }

  async getFinanceOperations() {
    const [sellerWallets, customerWallets, paidOrders, deposits, pendingWithdraws, paymentsByProvider, recentMovements] = await Promise.all([
      this.prisma.sellerWallet.aggregate({ _sum: { balance: true } }),
      this.prisma.customerWallet.aggregate({ _sum: { balance: true, commissionBalance: true } }),
      this.prisma.order.aggregate({ where: { status: { in: ["DELIVERED", "PAID", "PROCESSING_PURCHASE"] } }, _sum: { totalSaleAmount: true, totalSourceAmount: true } }),
      this.prisma.depositRequest.aggregate({ where: { status: "CONFIRMED" }, _sum: { amount: true } }),
      this.prisma.withdrawRequest.aggregate({ where: { status: "PENDING" }, _sum: { amount: true }, _count: true }),
      this.prisma.paymentTransaction.groupBy({ by: ["provider", "status"], _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.walletLedger.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { seller: { select: { displayName: true, user: { select: { email: true } } } } } }),
    ]);

    const revenue = decimalToNumber(paidOrders._sum.totalSaleAmount);
    const sourceCost = decimalToNumber(paidOrders._sum.totalSourceAmount);
    return {
      summary: {
        sellerWalletBalance: decimalToNumber(sellerWallets._sum.balance),
        customerCashBalance: decimalToNumber(customerWallets._sum.balance),
        customerCommissionBalance: decimalToNumber(customerWallets._sum.commissionBalance),
        grossRevenue: revenue,
        sourceCost,
        grossProfit: revenue - sourceCost,
        paidDeposits: decimalToNumber(deposits._sum?.amount),
        pendingWithdrawAmount: decimalToNumber(pendingWithdraws._sum.amount),
        pendingWithdrawCount: pendingWithdraws._count,
      },
      providers: paymentsByProvider.map((row) => ({ provider: row.provider, status: row.status, count: row._count._all, amount: decimalToNumber(row._sum.amount) })),
      recentMovements: recentMovements.map((row) => ({ id: row.id, sellerName: row.seller.displayName || row.seller.user.email, type: row.type, amount: decimalToNumber(row.amount), balanceAfter: decimalToNumber(row.balanceAfter), note: row.note, createdAt: row.createdAt })),
    };
  }

  async listSystemCustomers(search?: string) {
    const query = search?.trim();
    const customers = await this.prisma.customer.findMany({
      where: query ? { OR: [
        { telegramUserId: { contains: query, mode: "insensitive" } },
        { telegramChatId: { contains: query, mode: "insensitive" } },
        { telegramUsername: { contains: query, mode: "insensitive" } },
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
      ] } : {},
      orderBy: { createdAt: "desc" }, take: 200,
      include: { wallet: true, shop: { select: { name: true, seller: { select: { displayName: true } } } }, _count: { select: { orders: true, warrantyClaims: true } } },
    });
    return customers.map((row) => ({ id: row.id, telegramUserId: row.telegramUserId, telegramChatId: row.telegramChatId, username: row.telegramUsername, displayName: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.telegramUsername || row.telegramUserId, shopName: row.shop.name, sellerName: row.shop.seller.displayName, preferredLanguage: row.preferredLanguage, isCtv: row.isCtv, blacklisted: row.blacklisted, cashBalance: decimalToNumber(row.wallet?.balance), commissionBalance: decimalToNumber(row.wallet?.commissionBalance), orderCount: row._count.orders, warrantyCount: row._count.warrantyClaims, createdAt: row.createdAt }));
  }

  async updateSellerAffiliateCommission(
    userId: string,
    affiliateCommissionPercent: number | null,
  ) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException("Seller not found");

    if (
      affiliateCommissionPercent !== null &&
      (!Number.isFinite(affiliateCommissionPercent) ||
        affiliateCommissionPercent < 0 ||
        affiliateCommissionPercent > 100)
    ) {
      throw new BadRequestException("Commission percent must be between 0 and 100.");
    }

    const updated = await this.prisma.seller.update({
      where: { id: seller.id },
      data: {
        affiliateCommissionPercent:
          affiliateCommissionPercent === null
            ? null
            : toDecimal(affiliateCommissionPercent),
      },
      select: { id: true, userId: true, affiliateCommissionPercent: true },
    });

    return {
      sellerId: updated.id,
      userId: updated.userId,
      affiliateCommissionPercent:
        updated.affiliateCommissionPercent === null
          ? null
          : decimalToNumber(updated.affiliateCommissionPercent),
    };
  }
  async getSystemHealth() {
    const now = new Date();
    const staleAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const expiringAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [shops, botStates, failedPayments, pendingPayments, failedOrders, pendingOrders, expiringSellers, lowStock, recentFailures] = await Promise.all([
      this.prisma.shop.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.botConfig.groupBy({ by: ["webhookStatus", "deliveryMode"], _count: { _all: true } }),
      this.prisma.paymentTransaction.count({ where: { status: "FAILED", updatedAt: { gte: staleAt } } }),
      this.prisma.paymentTransaction.count({ where: { status: "PENDING", createdAt: { lt: staleAt } } }),
      this.prisma.order.count({ where: { status: "FAILED", updatedAt: { gte: staleAt } } }),
      this.prisma.order.count({ where: { status: { in: ["PAID", "PROCESSING_PURCHASE"] }, updatedAt: { lt: staleAt } } }),
      this.prisma.seller.count({ where: { tierExpiresAt: { gte: now, lte: expiringAt } } }),
      this.prisma.sourceProduct.count({ where: { available: { lte: 5 } } }),
      this.prisma.order.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, orderCode: true, failureReason: true, updatedAt: true, shop: { select: { name: true } } } }),
    ]);
    return {
      generatedAt: now,
      database: { status: "operational", latencyMs: null },
      shops: shops.map((row) => ({ status: row.status, count: row._count._all })),
      bots: botStates.map((row) => ({ webhookStatus: row.webhookStatus, deliveryMode: row.deliveryMode, count: row._count._all })),
      alerts: { failedPayments24h: failedPayments, stalePendingPayments: pendingPayments, failedOrders24h: failedOrders, staleProcessingOrders: pendingOrders, expiringSellers7d: expiringSellers, lowStockProducts: lowStock },
      recentFailures: recentFailures.map((row) => ({ id: row.id, orderCode: row.orderCode, reason: row.failureReason, shopName: row.shop.name, updatedAt: row.updatedAt })),
    };
  }

  async getAutomations() {
    const flags = await this.featureFlags.list();
    return {
      generatedAt: new Date(),
      total: flags.length,
      active: flags.filter((flag) => flag.enabled).length,
      maintenance: flags.filter((flag) => !flag.enabled).length,
      flags,
    };
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
      affiliateCommissionPercent: u.seller?.affiliateCommissionPercent == null
        ? null
        : decimalToNumber(u.seller.affiliateCommissionPercent),
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

  /**
   * Leaderboard of sellers who referred the most other sellers, with how many of those referrals
   * are still on a paid (active) tier and the total affiliate commission they have earned.
   */
  async getTopReferrers(limit = 50) {
    const now = new Date();

    const [totalGroups, activeGroups, commissionGroups] = await Promise.all([
      this.prisma.seller.groupBy({
        by: ["referredBySellerId"],
        where: { referredBySellerId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.seller.groupBy({
        by: ["referredBySellerId"],
        where: {
          referredBySellerId: { not: null },
          tier: { not: SellerTier.FREE },
          tierExpiresAt: { gt: now },
        },
        _count: { _all: true },
      }),
      this.prisma.walletLedger.groupBy({
        by: ["sellerId"],
        where: {
          type: { in: [WalletLedgerType.AFFILIATE_LEVEL_1, WalletLedgerType.AFFILIATE_LEVEL_2] },
        },
        _sum: { amount: true },
      }),
    ]);

    const totalMap = new Map(totalGroups.map((g) => [g.referredBySellerId as string, g._count._all]));
    const activeMap = new Map(activeGroups.map((g) => [g.referredBySellerId as string, g._count._all]));
    const commissionMap = new Map(commissionGroups.map((g) => [g.sellerId, decimalToNumber(g._sum.amount)]));

    // Candidate referrers = anyone who referred someone OR earned affiliate commission.
    const referrerIds = new Set<string>();
    for (const g of totalGroups) if (g.referredBySellerId) referrerIds.add(g.referredBySellerId);
    for (const g of commissionGroups) if (decimalToNumber(g._sum.amount) > 0) referrerIds.add(g.sellerId);

    if (referrerIds.size === 0) return [];

    const sellers = await this.prisma.seller.findMany({
      where: { id: { in: [...referrerIds] } },
      select: {
        id: true,
        displayName: true,
        tier: true,
        referralCode: true,
        user: { select: { email: true } },
      },
    });
    const sellerMap = new Map(sellers.map((s) => [s.id, s]));

    const rows = [...referrerIds].map((id) => {
      const s = sellerMap.get(id);
      return {
        sellerId: id,
        displayName: s?.displayName ?? null,
        email: s?.user?.email ?? null,
        tier: s?.tier ? s.tier.toLowerCase() : null,
        referralCode: s?.referralCode ?? null,
        referredCount: totalMap.get(id) ?? 0,
        activeReferredCount: activeMap.get(id) ?? 0,
        commissionVnd: commissionMap.get(id) ?? 0,
      };
    });

    rows.sort(
      (a, b) =>
        b.referredCount - a.referredCount ||
        b.activeReferredCount - a.activeReferredCount ||
        b.commissionVnd - a.commissionVnd,
    );

    return rows.slice(0, limit);
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
            wallet: { select: { balance: true } },
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

    const refundAggregate = await this.prisma.customerWalletLedger.aggregate({
      where: {
        customerId: order.customerId,
        type: CustomerWalletLedgerType.REFUND_ORDER,
        referenceType: "admin_order_refund",
        referenceId: order.id,
      },
      _sum: { amount: true },
    });

    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status.toLowerCase(),
      paymentStatus: order.paymentStatus.toLowerCase(),
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
      customerWalletBalance: decimalToNumber(order.customer?.wallet?.balance),
      refundedAmount: order.status === "REFUNDED"
        ? decimalToNumber(order.totalSaleAmount)
        : decimalToNumber(refundAggregate._sum.amount),
      warrantyPolicy: order.warrantyPolicySnapshot,
      warrantyClaims: order.warrantyClaims,
      sourceProviderKind: order.sourceProviderKindSnapshot,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  async refundOrderToCustomerWallet(
    user: AuthenticatedUser,
    orderId: string,
    dto: RefundAdminOrderDto,
  ) {
    const amount = dto.amount;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderCode: true, customerId: true, totalSaleAmount: true, status: true, paymentStatus: true },
      });
      if (!order) throw new NotFoundException("Order not found");

      const priorRefunds = await tx.customerWalletLedger.aggregate({
        where: {
          customerId: order.customerId,
          type: CustomerWalletLedgerType.REFUND_ORDER,
          referenceType: "admin_order_refund",
          referenceId: order.id,
        },
        _sum: { amount: true },
      });
      const refundedBefore = decimalToNumber(priorRefunds._sum.amount);
      const orderTotal = decimalToNumber(order.totalSaleAmount);
      if (order.status === "REFUNDED") {
        throw new BadRequestException("Order has already been refunded.");
      }
      if (order.paymentStatus !== "PAID") {
        throw new BadRequestException("Only paid orders can be refunded.");
      }
      const remaining = Math.max(0, orderTotal - refundedBefore);
      if (remaining <= 0) throw new BadRequestException("Order has already been refunded in full.");
      if (amount > remaining) {
        throw new BadRequestException(`Refund amount cannot exceed the remaining ${remaining.toLocaleString("vi-VN")} VND.`);
      }

      let wallet = await tx.customerWallet.findUnique({ where: { customerId: order.customerId } });
      if (!wallet) {
        wallet = await tx.customerWallet.create({
          data: { customerId: order.customerId, balance: toDecimal(0) },
        });
      }
      await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`);
      const freshWallet = await tx.customerWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const balanceBefore = decimalToNumber(freshWallet.balance);
      const balanceAfter = balanceBefore + amount;
      const refundedAfter = refundedBefore + amount;
      const isFullRefund = refundedAfter >= orderTotal;

      await tx.customerWallet.update({
        where: { id: wallet.id },
        data: { balance: toDecimal(balanceAfter) },
      });
      await tx.customerWalletLedger.create({
        data: {
          customerId: order.customerId,
          walletId: wallet.id,
          type: CustomerWalletLedgerType.REFUND_ORDER,
          currency: "VND",
          amount: toDecimal(amount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          commissionBalanceBefore: freshWallet.commissionBalance,
          commissionBalanceAfter: freshWallet.commissionBalance,
          referenceType: "admin_order_refund",
          referenceId: order.id,
          note: dto.note?.trim() || `Admin refund for order ${order.orderCode}`,
        },
      });
      if (isFullRefund) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: "REFUNDED", paymentStatus: "REFUNDED" },
        });
      }
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "admin_customer_wallet_refund",
          payloadJson: {
            amount,
            refundedTotal: refundedAfter,
            balanceBefore,
            balanceAfter,
            isFullRefund,
            adminUserId: user.id,
            note: dto.note?.trim() || null,
          } as Prisma.InputJsonValue,
        },
      });
      return { amount, refundedTotal: refundedAfter, remaining: Math.max(0, orderTotal - refundedAfter), balanceAfter, isFullRefund };
    });

    if (result.isFullRefund) {
      await this.affiliateService.revokeCommission(orderId);
    } else {
      await this.affiliateService.revokeCommissionForRefund(orderId, amount);
    }

    return { success: true, ...result };
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

  async debugConnectionsByChatId(chatId: string) {
    const normalized = String(chatId || "").trim();
    if (!normalized) {
      return { error: "chatId is required" };
    }

    const matchingConnections = await this.prisma.downstreamSourceConnection.findMany({
      where: { downstreamTelegramChatId: normalized },
      include: {
        upstreamShop: { select: { id: true, name: true, slug: true } },
        downstreamShop: { select: { id: true, name: true, slug: true, botConfig: { select: { ownerTelegramUserId: true, telegramBotUsername: true } } } },
      },
    });

    const botConfigsOwnedByChatId = await this.prisma.botConfig.findMany({
      where: { ownerTelegramUserId: normalized },
      select: {
        shopId: true,
        ownerTelegramUserId: true,
        telegramBotUsername: true,
        shop: {
          select: {
            id: true,
            name: true,
            slug: true,
            downstreamSourceConnections: {
              select: {
                id: true,
                downstreamTelegramChatId: true,
                upstreamShop: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    const customersInUpstreamShops = await this.prisma.customer.findMany({
      where: { telegramChatId: normalized },
      select: {
        id: true,
        shopId: true,
        telegramChatId: true,
        telegramUserId: true,
        telegramUsername: true,
        shop: { select: { name: true, slug: true } },
        wallet: { select: { balance: true, currency: true } },
      },
    });

    return {
      queryChatId: normalized,
      connectionsWhereThisChatIdIsDownstream: matchingConnections,
      botConfigsOwnedByThisChatId: botConfigsOwnedByChatId,
      customerRecordsWithThisChatId: customersInUpstreamShops,
    };
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

  async generateUserbotLicenseKeys(type: "PLUS" | "PRO" | "UNLIMITED", durationDays: number, count: number) {
    const keysToCreate = [];
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    for (let i = 0; i < count; i++) {
      let randomPart = "";
      for (let j = 0; j < 8; j++) {
        randomPart += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      const code = `UB-${type}-${randomPart}`;
      keysToCreate.push({
        code,
        type,
        durationDays,
      });
    }

    await this.prisma.telegramUserbotLicenseKey.createMany({
      data: keysToCreate,
      skipDuplicates: true,
    });

    return { success: true, count: keysToCreate.length };
  }

  async listUserbotLicenseKeys() {
    const keys = await this.prisma.telegramUserbotLicenseKey.findMany({
      include: {
        redeemedBySeller: {
          select: {
            id: true,
            user: { select: { email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return keys.map((k) => ({
      id: k.id,
      code: k.code,
      type: k.type,
      durationDays: k.durationDays,
      isRedeemed: k.isRedeemed,
      redeemedAt: k.redeemedAt,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      redeemedBySellerId: k.redeemedBySellerId,
      redeemedByEmail: k.redeemedBySeller?.user?.email || null,
    }));
  }

  async resetUserbotLicenseKey(id: string) {
    const key = await this.prisma.telegramUserbotLicenseKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException("License key not found.");

    if (key.isRedeemed && key.redeemedBySellerId) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: key.redeemedBySellerId },
        select: { userbotLicenseExpiresAt: true },
      });
      if (seller && seller.userbotLicenseExpiresAt) {
        const newExpiresAt = new Date(
          new Date(seller.userbotLicenseExpiresAt).getTime() - key.durationDays * 86400 * 1000,
        );
        await this.prisma.seller.update({
          where: { id: key.redeemedBySellerId },
          data: { userbotLicenseExpiresAt: newExpiresAt },
        });
      }
    }

    await this.prisma.telegramUserbotLicenseKey.update({
      where: { id },
      data: {
        isRedeemed: false,
        redeemedBySellerId: null,
        redeemedAt: null,
      },
    });

    return { success: true };
  }

  async deleteUserbotLicenseKey(id: string) {
    const key = await this.prisma.telegramUserbotLicenseKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException("License key not found.");

    if (key.isRedeemed && key.redeemedBySellerId) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: key.redeemedBySellerId },
        select: { userbotLicenseExpiresAt: true },
      });
      if (seller && seller.userbotLicenseExpiresAt) {
        const newExpiresAt = new Date(
          new Date(seller.userbotLicenseExpiresAt).getTime() - key.durationDays * 86400 * 1000,
        );
        await this.prisma.seller.update({
          where: { id: key.redeemedBySellerId },
          data: { userbotLicenseExpiresAt: newExpiresAt },
        });
      }
    }

    await this.prisma.telegramUserbotLicenseKey.delete({ where: { id } });
    return { success: true };
  }
}
