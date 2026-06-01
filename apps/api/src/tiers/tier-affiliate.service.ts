import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, WalletLedgerType } from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import { decimalToNumber, toDecimal } from "../lib/utils";
import {
  LEVEL_2_RATE,
  calcLevel1Rate,
  tierFromCumulative,
  TIER_UNLOCK_THRESHOLDS,
} from "./tier-pricing";

@Injectable()
export class TierAffiliateService {
  private readonly logger = new Logger(TierAffiliateService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Generate a unique random referral code for a seller.
   * 8 chars uppercase alphanumeric.
   */
  async generateReferralCode(): Promise<string> {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusable chars
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = "";
      for (let i = 0; i < 8; i++) {
        code += charset[Math.floor(Math.random() * charset.length)];
      }
      const existing = await this.prisma.seller.findUnique({ where: { referralCode: code } });
      if (!existing) return code;
    }
    throw new Error("Failed to generate unique referral code");
  }

  /**
   * Resolve referrer seller from a referral code, with fraud checks.
   * Returns null if invalid, self-referral, or fraud detected.
   */
  async resolveReferrer(
    referralCode: string | null | undefined,
    candidateSellerId: string,
    candidateSignupIp?: string | null,
    candidateSignupDevice?: string | null,
  ): Promise<string | null> {
    if (!referralCode || !referralCode.trim()) return null;
    const normalizedCode = referralCode.trim().toUpperCase();

    // Try Seller.referralCode first (system-default codes)
    let referrer = await this.prisma.seller.findUnique({
      where: { referralCode: normalizedCode },
      select: {
        id: true,
        phone: true,
        signupIp: true,
        signupDeviceFingerprint: true,
        user: { select: { email: true } },
      },
    });

    // Fallback: try DiscountCode.code (admin-created codes that also act as referral)
    if (!referrer) {
      const discountCode = await this.prisma.discountCode.findUnique({
        where: { code: normalizedCode },
        select: {
          active: true,
          referrerSeller: {
            select: {
              id: true,
              phone: true,
              signupIp: true,
              signupDeviceFingerprint: true,
              user: { select: { email: true } },
            },
          },
        },
      });
      if (discountCode?.active) {
        referrer = discountCode.referrerSeller;
      }
    }

    if (!referrer) return null;
    if (referrer.id === candidateSellerId) return null;

    // Self-referral fraud check
    const candidate = await this.prisma.seller.findUnique({
      where: { id: candidateSellerId },
      select: { phone: true, user: { select: { email: true } } },
    });
    if (!candidate) return null;

    const sameEmail =
      !!referrer.user?.email && !!candidate.user?.email && referrer.user.email === candidate.user.email;
    const samePhone =
      !!referrer.phone && !!candidate.phone && referrer.phone === candidate.phone;
    const sameIp =
      !!referrer.signupIp && !!candidateSignupIp && referrer.signupIp === candidateSignupIp;
    const sameDevice =
      !!referrer.signupDeviceFingerprint &&
      !!candidateSignupDevice &&
      referrer.signupDeviceFingerprint === candidateSignupDevice;

    if (sameEmail || samePhone) {
      this.logger.warn(`Self-referral blocked: ${candidateSellerId} ← ${referrer.id} (email/phone match)`);
      return null;
    }
    // IP/device match is suspicious but not auto-block; log it for review
    if (sameIp || sameDevice) {
      this.logger.warn(`Possible self-referral: ${candidateSellerId} ← ${referrer.id} (ip=${sameIp}, device=${sameDevice})`);
      // Still allow but flag for admin review later
    }

    return referrer.id;
  }

  /**
   * Sum of commissions received in the last N days (in VND).
   */
  async getActivityCommission(sellerId: string, lastDays: number = 90): Promise<number> {
    const since = new Date(Date.now() - lastDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.walletLedger.aggregate({
      where: {
        sellerId,
        type: { in: [WalletLedgerType.AFFILIATE_LEVEL_1, WalletLedgerType.AFFILIATE_LEVEL_2] },
        createdAt: { gte: since },
      },
      _sum: { amount: true },
    });
    return decimalToNumber(result._sum.amount);
  }

  /**
   * Sum of all-time commissions (positive entries only — excluding clawbacks).
   */
  async getAllTimeCommission(sellerId: string): Promise<number> {
    const result = await this.prisma.walletLedger.aggregate({
      where: {
        sellerId,
        type: { in: [WalletLedgerType.AFFILIATE_LEVEL_1, WalletLedgerType.AFFILIATE_LEVEL_2] },
      },
      _sum: { amount: true },
    });
    return decimalToNumber(result._sum.amount);
  }

  /**
   * Credit commissions for a tier subscription. Calculates level 1 + level 2.
   * Updates affiliate tier unlock status if cumulative crosses thresholds.
   * Returns the amounts credited.
   */
  async creditCommissionsForSubscription(
    tx: Prisma.TransactionClient,
    args: {
      subscriptionId: string;
      payerSellerId: string;
      priceVnd: number;
      referrerSellerId: string | null;
      grandReferrerSellerId: string | null;
      sourceLabel: string;
    },
  ): Promise<{ level1Commission: number; level2Commission: number }> {
    let level1Commission = 0;
    let level2Commission = 0;
    let level1Rate = 0;
    let level2Rate = 0;

    // Idempotent guard — if this subscription already has any AFFILIATE_LEVEL_* ledger entry,
    // bail out to prevent double-credit when a webhook fires twice or admin retries.
    const alreadyCredited = await tx.walletLedger.findFirst({
      where: {
        referenceType: "tier_subscription",
        referenceId: args.subscriptionId,
        type: { in: [WalletLedgerType.AFFILIATE_LEVEL_1, WalletLedgerType.AFFILIATE_LEVEL_2] },
      },
      select: { id: true },
    });
    if (alreadyCredited) {
      return { level1Commission: 0, level2Commission: 0 };
    }

    // ── Level 1 ─────────────────────────────────────────────────────
    if (args.referrerSellerId) {
      const referrer = await tx.seller.findUnique({
        where: { id: args.referrerSellerId },
        select: { affiliateUnlockedTier: true },
      });
      if (referrer) {
        // Activity in last 90d (use raw query for transaction safety)
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const activityRows = await tx.walletLedger.aggregate({
          where: {
            sellerId: args.referrerSellerId,
            type: { in: [WalletLedgerType.AFFILIATE_LEVEL_1, WalletLedgerType.AFFILIATE_LEVEL_2] },
            createdAt: { gte: since },
          },
          _sum: { amount: true },
        });
        const activity90d = decimalToNumber(activityRows._sum.amount);
        level1Rate = calcLevel1Rate(referrer.affiliateUnlockedTier, activity90d);
        level1Commission = Math.round(args.priceVnd * level1Rate);

        await this.creditToWallet(tx, {
          sellerId: args.referrerSellerId,
          amount: level1Commission,
          type: WalletLedgerType.AFFILIATE_LEVEL_1,
          referenceType: "tier_subscription",
          referenceId: args.subscriptionId,
          note: `Hoa hồng cấp 1 (${(level1Rate * 100).toFixed(0)}%): ${args.sourceLabel}`,
        });

        // Check tier unlock based on new all-time cumulative
        await this.maybeUnlockTier(tx, args.referrerSellerId);
      }
    }

    // ── Level 2 ─────────────────────────────────────────────────────
    if (args.grandReferrerSellerId && args.grandReferrerSellerId !== args.referrerSellerId) {
      level2Rate = LEVEL_2_RATE;
      level2Commission = Math.round(args.priceVnd * level2Rate);

      await this.creditToWallet(tx, {
        sellerId: args.grandReferrerSellerId,
        amount: level2Commission,
        type: WalletLedgerType.AFFILIATE_LEVEL_2,
        referenceType: "tier_subscription",
        referenceId: args.subscriptionId,
        note: `Hoa hồng cấp 2 (2%): ${args.sourceLabel}`,
      });

      await this.maybeUnlockTier(tx, args.grandReferrerSellerId);
    }

    // ── Store rates+amounts on subscription for audit ───────────────
    await tx.tierSubscription.update({
      where: { id: args.subscriptionId },
      data: {
        level1Rate: level1Rate > 0 ? toDecimal(level1Rate) : null,
        level2Rate: level2Rate > 0 ? toDecimal(level2Rate) : null,
        level1CommissionVnd: level1Commission > 0 ? toDecimal(level1Commission) : null,
        level2CommissionVnd: level2Commission > 0 ? toDecimal(level2Commission) : null,
      },
    });

    return { level1Commission, level2Commission };
  }

  /**
   * Add amount to seller_wallet.balance + create ledger entry.
   */
  private async creditToWallet(
    tx: Prisma.TransactionClient,
    args: {
      sellerId: string;
      amount: number;
      type: WalletLedgerType;
      referenceType: string;
      referenceId: string;
      note: string;
    },
  ): Promise<void> {
    const wallet = await tx.sellerWallet.upsert({
      where: { sellerId: args.sellerId },
      update: {},
      create: { sellerId: args.sellerId, balance: toDecimal(0) },
    });
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
    );
    const fresh = await tx.sellerWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const balanceBefore = decimalToNumber(fresh.balance);
    const balanceAfter = balanceBefore + args.amount;
    await tx.sellerWallet.update({
      where: { id: wallet.id },
      data: { balance: toDecimal(balanceAfter) },
    });
    await tx.walletLedger.create({
      data: {
        sellerId: args.sellerId,
        walletId: wallet.id,
        type: args.type,
        amount: toDecimal(args.amount),
        balanceBefore: toDecimal(balanceBefore),
        balanceAfter: toDecimal(balanceAfter),
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        note: args.note,
      },
    });
  }

  /**
   * Check seller's all-time cumulative commission and unlock tier if crossed thresholds.
   */
  private async maybeUnlockTier(
    tx: Prisma.TransactionClient,
    sellerId: string,
  ): Promise<void> {
    const cumulative = await tx.walletLedger.aggregate({
      where: {
        sellerId,
        type: { in: [WalletLedgerType.AFFILIATE_LEVEL_1, WalletLedgerType.AFFILIATE_LEVEL_2] },
      },
      _sum: { amount: true },
    });
    const totalVnd = decimalToNumber(cumulative._sum.amount);
    const newTier = tierFromCumulative(totalVnd);

    const seller = await tx.seller.findUnique({
      where: { id: sellerId },
      select: { affiliateUnlockedTier: true, affiliateUnlockedTier2At: true, affiliateUnlockedTier3At: true },
    });
    if (!seller) return;
    if (newTier <= seller.affiliateUnlockedTier) return;

    const now = new Date();
    const update: Prisma.SellerUpdateInput = { affiliateUnlockedTier: newTier };
    if (newTier >= 2 && !seller.affiliateUnlockedTier2At) update.affiliateUnlockedTier2At = now;
    if (newTier >= 3 && !seller.affiliateUnlockedTier3At) update.affiliateUnlockedTier3At = now;

    await tx.seller.update({ where: { id: sellerId }, data: update });
    this.logger.log(`Seller ${sellerId} unlocked affiliate tier ${newTier} (cumulative=${totalVnd})`);
  }

  /**
   * Claw back commissions when a subscription is refunded.
   * Only claws back if within REFUND_CLAWBACK_DAYS of creation.
   */
  async clawBackCommissions(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
  ): Promise<void> {
    const sub = await tx.tierSubscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        createdAt: true,
        referrerSellerId: true,
        grandReferrerSellerId: true,
        level1CommissionVnd: true,
        level2CommissionVnd: true,
      },
    });
    if (!sub) return;

    const REFUND_CLAWBACK_DAYS = 7;
    const ageMs = Date.now() - sub.createdAt.getTime();
    const withinWindow = ageMs <= REFUND_CLAWBACK_DAYS * 24 * 60 * 60 * 1000;
    if (!withinWindow) {
      this.logger.log(`Subscription ${subscriptionId} refunded after ${REFUND_CLAWBACK_DAYS}d window — no clawback`);
      return;
    }

    if (sub.referrerSellerId && sub.level1CommissionVnd) {
      const amount = decimalToNumber(sub.level1CommissionVnd);
      await this.debitFromWallet(tx, {
        sellerId: sub.referrerSellerId,
        amount,
        type: WalletLedgerType.AFFILIATE_CLAWBACK,
        referenceType: "tier_subscription_refund",
        referenceId: subscriptionId,
        note: `Claw back hoa hồng cấp 1 do refund đơn ${subscriptionId.slice(0, 8)}`,
      });
    }
    if (sub.grandReferrerSellerId && sub.level2CommissionVnd) {
      const amount = decimalToNumber(sub.level2CommissionVnd);
      await this.debitFromWallet(tx, {
        sellerId: sub.grandReferrerSellerId,
        amount,
        type: WalletLedgerType.AFFILIATE_CLAWBACK,
        referenceType: "tier_subscription_refund",
        referenceId: subscriptionId,
        note: `Claw back hoa hồng cấp 2 do refund đơn ${subscriptionId.slice(0, 8)}`,
      });
    }
  }

  private async debitFromWallet(
    tx: Prisma.TransactionClient,
    args: {
      sellerId: string;
      amount: number;
      type: WalletLedgerType;
      referenceType: string;
      referenceId: string;
      note: string;
    },
  ): Promise<void> {
    const wallet = await tx.sellerWallet.findUnique({ where: { sellerId: args.sellerId } });
    if (!wallet) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
    );
    const fresh = await tx.sellerWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const balanceBefore = decimalToNumber(fresh.balance);
    const balanceAfter = balanceBefore - args.amount;
    await tx.sellerWallet.update({
      where: { id: wallet.id },
      data: { balance: toDecimal(balanceAfter) },
    });
    await tx.walletLedger.create({
      data: {
        sellerId: args.sellerId,
        walletId: wallet.id,
        type: args.type,
        amount: toDecimal(-args.amount),
        balanceBefore: toDecimal(balanceBefore),
        balanceAfter: toDecimal(balanceAfter),
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        note: args.note,
      },
    });
  }
}
