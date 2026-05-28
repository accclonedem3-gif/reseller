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

    const [customers, downstreamConns] = await Promise.all([
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
    ]);

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
      createdAt: c.createdAt,
      connectedBotUsername: connByTelegramChatId.get(c.telegramChatId) || null,
    }));
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
