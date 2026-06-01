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
      lifetimeCommission: Number(commissionSum._sum.affiliateCommission ?? 0),
      downlineCount,
    };
  }

  async getConfigByShopId(shopId: string) {
    return this.prisma.affiliateConfig.findUnique({ where: { shopId } });
  }

  async creditCommission(orderId: string, affiliateCustomerId: string, amount: number) {
    await this.prisma.$transaction(async (tx) => {
      // Idempotency: lock the order row, then re-check whether commission was already credited.
      // Two concurrent callers (e.g. a double-fired manual-complete) serialize on this lock; the
      // loser sees affiliateCommission already set and no-ops — no double wallet credit, no
      // duplicate AFFILIATE_COMMISSION ledger row (the ledger has no unique constraint to catch it).
      await tx.$queryRaw(Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
      const existing = await tx.order.findUnique({
        where: { id: orderId },
        select: { affiliateCommission: true },
      });
      if (existing?.affiliateCommission != null && decimalToNumber(existing.affiliateCommission) > 0) {
        return;
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          affiliateCustomerId,
          affiliateCommission: toDecimal(amount),
        },
      });

      const wallet = await tx.customerWallet.upsert({
        where: { customerId: affiliateCustomerId },
        update: {},
        create: { customerId: affiliateCustomerId },
      });

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const fresh = await tx.customerWallet.findUnique({ where: { id: wallet.id } });
      if (!fresh) return;

      const balance = decimalToNumber(fresh.balance);
      const commissionBefore = decimalToNumber(fresh.commissionBalance);
      const commissionAfter = commissionBefore + amount;

      await tx.customerWallet.update({
        where: { id: wallet.id },
        data: { commissionBalance: toDecimal(commissionAfter) },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: affiliateCustomerId,
          walletId: wallet.id,
          type: "AFFILIATE_COMMISSION",
          amount: toDecimal(amount),
          balanceBefore: toDecimal(balance),
          balanceAfter: toDecimal(balance),
          commissionBalanceBefore: toDecimal(commissionBefore),
          commissionBalanceAfter: toDecimal(commissionAfter),
          referenceType: "order",
          referenceId: orderId,
        },
      });
    });
  }

  async revokeCommission(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, affiliateCustomerId: true, affiliateCommission: true },
    });
    if (!order?.affiliateCustomerId) return;
    const amount = Number(order.affiliateCommission ?? 0);
    if (amount <= 0) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { affiliateCommission: toDecimal(0) },
      });

      const wallet = await tx.customerWallet.upsert({
        where: { customerId: order.affiliateCustomerId as string },
        update: {},
        create: { customerId: order.affiliateCustomerId as string },
      });

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const fresh = await tx.customerWallet.findUnique({ where: { id: wallet.id } });
      if (!fresh) return;

      const balance = decimalToNumber(fresh.balance);
      const commissionBefore = decimalToNumber(fresh.commissionBalance);
      const commissionAfter = commissionBefore - amount;

      await tx.customerWallet.update({
        where: { id: wallet.id },
        data: { commissionBalance: toDecimal(commissionAfter) },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: order.affiliateCustomerId as string,
          walletId: wallet.id,
          type: "REFUND_ORDER",
          amount: toDecimal(-amount),
          balanceBefore: toDecimal(balance),
          balanceAfter: toDecimal(balance),
          commissionBalanceBefore: toDecimal(commissionBefore),
          commissionBalanceAfter: toDecimal(commissionAfter),
          referenceType: "order",
          referenceId: orderId,
          note: "Claw back commission when order failed/refunded",
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
        COALESCE(dl.downline_count, 0)::bigint AS downline_count,
        COALESCE(ord.total_commission, 0)::text AS total_commission
      FROM customers c
      LEFT JOIN (
        SELECT referred_by_id, COUNT(*)::bigint AS downline_count
        FROM customers
        WHERE shop_id = ${shop.id} AND referred_by_id IS NOT NULL
        GROUP BY referred_by_id
      ) dl ON dl.referred_by_id = c.id
      LEFT JOIN (
        SELECT affiliate_customer_id, SUM(affiliate_commission) AS total_commission
        FROM orders
        WHERE shop_id = ${shop.id} AND affiliate_customer_id IS NOT NULL
        GROUP BY affiliate_customer_id
      ) ord ON ord.affiliate_customer_id = c.id
      WHERE c.shop_id = ${shop.id}
        AND (COALESCE(dl.downline_count, 0) > 0 OR COALESCE(ord.total_commission, 0) > 0)
      ORDER BY downline_count DESC, total_commission DESC NULLS LAST
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
