import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../db/prisma.service";
import { UpdateAffiliateConfigDto } from "./affiliate.dto";
import type { AuthenticatedUser } from "../types";

function toDecimal(n: number) {
  return new Prisma.Decimal(n);
}

function decimalToNumber(d: Prisma.Decimal | null | undefined) {
  return d ? Number(d) : 0;
}

@Injectable()
export class AffiliateService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  private async resolveShop(user: AuthenticatedUser) {
    const shop = await this.prisma.shop.findFirst({
      where: { sellerId: user.sellerId! },
    });
    if (!shop) throw new NotFoundException("Shop not found");
    return shop;
  }

  async getConfigByUser(user: AuthenticatedUser) {
    const shop = await this.resolveShop(user);
    const config = await this.prisma.affiliateConfig.findUnique({ where: { shopId: shop.id } });
    return config ?? { shopId: shop.id, enabled: false, commissionPct: 0, programText: null };
  }

  async upsertConfigByUser(user: AuthenticatedUser, dto: UpdateAffiliateConfigDto) {
    const shop = await this.resolveShop(user);
    return this.prisma.affiliateConfig.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        sellerId: user.sellerId!,
        enabled: dto.enabled,
        commissionPct: dto.commissionPct,
        programText: dto.programText,
      },
      update: {
        enabled: dto.enabled,
        commissionPct: dto.commissionPct,
        programText: dto.programText,
      },
    });
  }

  async getStatsByCustomer(customerId: string) {
    const [commissionSum, downlineCount] = await Promise.all([
      this.prisma.order.aggregate({
        where: { affiliateCustomerId: customerId },
        _sum: { affiliateCommission: true },
      }),
      this.prisma.customer.count({ where: { referredById: customerId } }),
    ]);
    return {
      commissionBalance: Number(commissionSum._sum.affiliateCommission ?? 0),
      downlineCount,
    };
  }

  async getConfigByShopId(shopId: string) {
    return this.prisma.affiliateConfig.findUnique({ where: { shopId } });
  }

  async creditCommission(orderId: string, affiliateCustomerId: string, amount: number) {
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          affiliateCustomerId,
          affiliateCommission: toDecimal(amount),
        },
      });

      const wallet = await tx.customerWallet.findUnique({
        where: { customerId: affiliateCustomerId },
      });

      if (!wallet) return;

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const fresh = await tx.customerWallet.findUnique({ where: { id: wallet.id } });
      if (!fresh) return;

      const balanceBefore = decimalToNumber(fresh.balance);
      const balanceAfter = balanceBefore + amount;

      await tx.customerWallet.update({
        where: { id: wallet.id },
        data: { balance: toDecimal(balanceAfter) },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: affiliateCustomerId,
          walletId: wallet.id,
          type: "AFFILIATE_COMMISSION",
          amount: toDecimal(amount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "order",
          referenceId: orderId,
        },
      });
    });
  }

  async getLeaderboard(user: AuthenticatedUser, limit = 20) {
    const shop = await this.resolveShop(user);

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        telegram_username: string | null;
        first_name: string | null;
        last_name: string | null;
        downline_count: bigint;
        total_commission: string | null;
      }>
    >`
      SELECT
        c.id,
        c.telegram_username,
        c.first_name,
        c.last_name,
        COUNT(DISTINCT d.id)::bigint AS downline_count,
        SUM(o.affiliate_commission)::text AS total_commission
      FROM customers c
      LEFT JOIN customers d ON d.referred_by_id = c.id AND d.shop_id = ${shop.id}
      LEFT JOIN orders o ON o.affiliate_customer_id = c.id AND o.shop_id = ${shop.id}
      WHERE c.shop_id = ${shop.id}
      GROUP BY c.id, c.telegram_username, c.first_name, c.last_name
      HAVING COUNT(DISTINCT d.id) > 0 OR SUM(o.affiliate_commission) > 0
      ORDER BY downline_count DESC, SUM(o.affiliate_commission) DESC NULLS LAST
      LIMIT ${limit}
    `;

    return rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.telegram_username || "—",
      telegramUsername: r.telegram_username,
      downlineCount: Number(r.downline_count),
      totalCommission: r.total_commission ? parseFloat(r.total_commission) : 0,
    }));
  }
}
