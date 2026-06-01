import { Injectable, Inject, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";
import { ShopsService } from "../shops/shops.service";
import { decimalToNumber } from "../lib/utils";
import type { AuthenticatedUser } from "../types";

@Injectable()
export class CustomersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShopsService) private readonly shopsService: ShopsService,
  ) {}

  async listCustomers(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const [customers, downstreamConns, spentRows] = await Promise.all([
      this.prisma.customer.findMany({
        where: { shopId: shop.id },
        select: {
          id: true,
          telegramUserId: true,
          telegramChatId: true,
          telegramUsername: true,
          firstName: true,
          lastName: true,
          preferredLanguage: true,
          isCtv: true,
          blacklisted: true,
          discountPercent: true,
          createdAt: true,
          wallet: {
            select: { balance: true, commissionBalance: true, currency: true },
          },
          _count: {
            select: { orders: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.downstreamSourceConnection.findMany({
        where: { upstreamShopId: shop.id, status: "ACTIVE" },
        select: {
          downstreamTelegramChatId: true,
          downstreamShop: {
            select: {
              botConfig: { select: { telegramBotUsername: true, ownerTelegramUserId: true } },
            },
          },
        },
      }),
      this.prisma.order.groupBy({
        by: ["customerId"],
        where: { shopId: shop.id, status: "DELIVERED" },
        _sum: { totalSaleAmount: true },
      }),
    ]);

    const spentByCustomer = new Map<string, number>();
    for (const row of spentRows) {
      spentByCustomer.set(row.customerId, decimalToNumber(row._sum.totalSaleAmount || 0));
    }

    const connByTelegramChatId = new Map<string, string | null>();
    for (const conn of downstreamConns) {
      const botUsername = conn.downstreamShop?.botConfig?.telegramBotUsername || null;
      if (conn.downstreamTelegramChatId) {
        connByTelegramChatId.set(conn.downstreamTelegramChatId, botUsername);
      }
      const ownerUserId = conn.downstreamShop?.botConfig?.ownerTelegramUserId;
      if (ownerUserId) {
        connByTelegramChatId.set(ownerUserId, botUsername);
      }
    }

    return customers.map((c) => ({
      id: c.id,
      telegramUserId: c.telegramUserId,
      telegramChatId: c.telegramChatId,
      username: c.telegramUsername || null,
      displayName: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.telegramUsername || c.telegramChatId,
      preferredLanguage: c.preferredLanguage,
      isCtv: c.isCtv,
      blacklisted: c.blacklisted,
      discountPercent: c.discountPercent,
      walletBalance: c.wallet ? decimalToNumber(c.wallet.balance) : 0,
      commissionBalance: c.wallet ? decimalToNumber(c.wallet.commissionBalance) : 0,
      orderCount: c._count.orders,
      totalSpent: spentByCustomer.get(c.id) ?? 0,
      createdAt: c.createdAt,
      connectedBotUsername: connByTelegramChatId.get(c.telegramChatId) || null,
    }));
  }

  async getCustomerOrders(
    user: AuthenticatedUser,
    customerId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
      select: {
        id: true,
        telegramUserId: true,
        telegramChatId: true,
        telegramUsername: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
    });
    if (!customer) {
      throw new NotFoundException("Customer not found.");
    }

    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
    const offset = Math.max(Number(options.offset) || 0, 0);

    const [orders, total, agg] = await Promise.all([
      this.prisma.order.findMany({
        where: { customerId: customer.id, shopId: shop.id },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          orderCode: true,
          productNameSnapshot: true,
          quantity: true,
          salePrice: true,
          totalSaleAmount: true,
          totalSourceAmount: true,
          status: true,
          paymentStatus: true,
          createdAt: true,
          paidAt: true,
          deliveredAt: true,
          deliveredAccountText: true,
        },
      }),
      this.prisma.order.count({
        where: { customerId: customer.id, shopId: shop.id },
      }),
      this.prisma.order.aggregate({
        where: { customerId: customer.id, shopId: shop.id, status: "DELIVERED" },
        _sum: { totalSaleAmount: true, totalSourceAmount: true },
      }),
    ]);

    return {
      customer: {
        id: customer.id,
        telegramUserId: customer.telegramUserId,
        telegramUsername: customer.telegramUsername,
        displayName: [customer.firstName, customer.lastName].filter(Boolean).join(" ")
          || customer.telegramUsername
          || customer.telegramChatId,
        createdAt: customer.createdAt,
      },
      orders: orders.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        productName: o.productNameSnapshot,
        quantity: o.quantity,
        salePrice: decimalToNumber(o.salePrice),
        totalSaleAmount: decimalToNumber(o.totalSaleAmount),
        totalSourceAmount: decimalToNumber(o.totalSourceAmount),
        profit: decimalToNumber(o.totalSaleAmount) - decimalToNumber(o.totalSourceAmount),
        status: o.status,
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        deliveredAt: o.deliveredAt,
        hasDeliveredText: !!o.deliveredAccountText,
      })),
      total,
      summary: {
        totalSpent: decimalToNumber(agg._sum.totalSaleAmount || 0),
        totalCost: decimalToNumber(agg._sum.totalSourceAmount || 0),
        totalProfit: decimalToNumber(agg._sum.totalSaleAmount || 0) - decimalToNumber(agg._sum.totalSourceAmount || 0),
      },
    };
  }

  async setCtv(user: AuthenticatedUser, customerId: string, isCtv: boolean) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found.");
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { isCtv },
      select: { id: true, isCtv: true },
    });
  }

  async setBlacklist(user: AuthenticatedUser, customerId: string, blacklisted: boolean) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found.");
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { blacklisted },
      select: { id: true, blacklisted: true },
    });
  }

  async setDiscountPercent(user: AuthenticatedUser, customerId: string, discountPercent: number) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found.");
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { discountPercent },
      select: { id: true, discountPercent: true },
    });
  }
}
