import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PaymentProvider, Prisma, SellerTier, WalletLedgerType } from "@prisma/client";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";
import { decimalToNumber, generateExternalPaymentCode, toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";

import { TierAffiliateService } from "./tier-affiliate.service";
import {
  PLAN_LABELS,
  PlanKey,
  PAYMENT_EXPIRY_MINUTES,
  TIER_LABELS,
  TierKey,
  getDurationMs,
  getPrice,
  planEnumToKey,
  planKeyToEnum,
  tierEnumToKey,
  tierKeyToEnum,
} from "./tier-pricing";

type PaymentMethodInput = "PAYOS" | "USDT_TRC20" | "USDT_SOL" | "WALLET_BALANCE";

@Injectable()
export class TiersService {
  private readonly logger = new Logger(TiersService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(TierAffiliateService)
    private readonly tierAffiliate: TierAffiliateService,
  ) {}

  /**
   * Return list of plans available to the user.
   * PRO: always public.
   * ULTRA: only if user already is/was ULTRA (i.e., admin granted before).
   */
  async getQuote(user: AuthenticatedUser) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        tier: true,
        tierExpiresAt: true,
        affiliateUnlockedTier: true,
        referralCode: true,
        autoRenewConfig: true,
      },
    });
    if (!seller) throw new NotFoundException("Seller not found");

    const hasUltraHistory = await this.prisma.tierSubscription.findFirst({
      where: { sellerId: seller.id, tier: SellerTier.ULTRA },
      select: { id: true },
    });
    const showUltra = seller.tier === SellerTier.ULTRA || !!hasUltraHistory;

    const wallet = await this.prisma.sellerWallet.findUnique({ where: { sellerId: seller.id } });
    const walletBalance = wallet ? decimalToNumber(wallet.balance) : 0;

    const buildPlans = (tier: TierKey) => (
      ["monthly", "quarterly", "semi_annual", "annual"] as PlanKey[]
    ).map((plan) => ({
      plan,
      label: PLAN_LABELS[plan],
      priceVnd: getPrice(tier, plan),
    }));

    return {
      currentTier: seller.tier,
      currentTierExpiresAt: seller.tierExpiresAt,
      referralCode: seller.referralCode,
      walletBalance,
      autoRenewConfig: seller.autoRenewConfig,
      affiliateUnlockedTier: seller.affiliateUnlockedTier,
      pro: { tier: "pro" as const, label: TIER_LABELS.pro, plans: buildPlans("pro") },
      ultra: showUltra
        ? { tier: "ultra" as const, label: TIER_LABELS.ultra, plans: buildPlans("ultra") }
        : null,
    };
  }

  async purchase(
    user: AuthenticatedUser,
    args: {
      tier: TierKey;
      plan: PlanKey;
      referralCode?: string | null;
      paymentMethod: PaymentMethodInput;
      clientIp?: string;
      deviceFingerprint?: string;
    },
  ) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        tier: true,
        tierExpiresAt: true,
        referredBySellerId: true,
        signupIp: true,
        signupDeviceFingerprint: true,
      },
    });
    if (!seller) throw new NotFoundException("Seller not found");

    // ULTRA can only be purchased by someone who's already / has been ULTRA
    if (args.tier === "ultra") {
      const everUltra = await this.prisma.tierSubscription.findFirst({
        where: { sellerId: seller.id, tier: SellerTier.ULTRA },
        select: { id: true },
      });
      if (seller.tier !== SellerTier.ULTRA && !everUltra) {
        throw new ForbiddenException("ULTRA chỉ có thể được nâng cấp bởi admin lần đầu.");
      }
    }

    const priceVnd = getPrice(args.tier, args.plan);
    const durationMs = getDurationMs(args.plan);

    // ── Resolve referrer (only if seller doesn't already have one) ────
    let referrerSellerId: string | null = seller.referredBySellerId;
    if (!referrerSellerId && args.referralCode) {
      referrerSellerId = await this.tierAffiliate.resolveReferrer(
        args.referralCode,
        seller.id,
        args.clientIp ?? seller.signupIp,
        args.deviceFingerprint ?? seller.signupDeviceFingerprint,
      );
      if (referrerSellerId) {
        await this.prisma.seller.update({
          where: { id: seller.id },
          data: { referredBySellerId: referrerSellerId },
        });
      }
    }

    // Resolve grand referrer (level 2)
    let grandReferrerSellerId: string | null = null;
    if (referrerSellerId) {
      const ref = await this.prisma.seller.findUnique({
        where: { id: referrerSellerId },
        select: { referredBySellerId: true },
      });
      if (ref?.referredBySellerId && ref.referredBySellerId !== seller.id) {
        grandReferrerSellerId = ref.referredBySellerId;
      }
    }

    // ── Wallet balance payment shortcut ─────────────────────────────
    if (args.paymentMethod === "WALLET_BALANCE") {
      return this.purchaseFromWalletBalance(seller.id, args.tier, args.plan, priceVnd, durationMs, referrerSellerId, grandReferrerSellerId);
    }

    // ── External payment path: PayOS / USDT_TRC20 / USDT_SOL ────────
    const externalOrderCode = generateExternalPaymentCode();
    const description = `${TIER_LABELS[args.tier]}-${PLAN_LABELS[args.plan].replace(/\s/g, "")}`;

    const providerOverride =
      args.paymentMethod === "USDT_TRC20"
        ? PaymentProvider.USDT_TRC20
        : args.paymentMethod === "USDT_SOL"
          ? PaymentProvider.USDT_SOL
          : PaymentProvider.PAYOS;

    // PayOS 5 phút (chuyển khoản nhanh), USDT 30 phút (crypto chậm hơn)
    const expiryMinutes = providerOverride === PaymentProvider.PAYOS ? 5 : PAYMENT_EXPIRY_MINUTES;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const payment = await this.paymentService.createPaymentLink({
      shopId: this.config.platformDepositShopId || "platform-tier",
      externalOrderCode,
      amount: priceVnd,
      description,
      expiredAt: expiresAt,
      providerOverride,
    });

    // Store as DepositRequest (reusing existing infra) with structured note
    const deposit = await this.prisma.depositRequest.create({
      data: {
        sellerId: seller.id,
        amount: toDecimal(priceVnd),
        provider: payment.provider,
        externalOrderCode,
        checkoutUrl: payment.checkoutUrl,
        qrCode: payment.qrCode,
        expiresAt,
        note: `TIER_SUB:${args.tier}:${args.plan}:${seller.id}:${referrerSellerId ?? ""}:${grandReferrerSellerId ?? ""}`,
        rawPayloadJson: payment.providerPayload as any,
      },
    });

    return {
      depositRequestId: deposit.id,
      externalOrderCode,
      checkoutUrl: payment.checkoutUrl,
      qrCode: payment.qrCode,
      amount: priceVnd,
      tier: args.tier,
      plan: args.plan,
      provider: payment.provider.toLowerCase(),
      expiresAt,
      reconcileToken: this.paymentService.buildPublicReconcileToken(externalOrderCode),
      providerPayload: payment.providerPayload,
      bankInfo: (payment as any).bankInfo ?? null,
      manualCrypto: (payment as any).manualCrypto ?? null,
    };
  }

  /**
   * Pay tier from seller's wallet balance immediately.
   */
  private async purchaseFromWalletBalance(
    sellerId: string,
    tier: TierKey,
    plan: PlanKey,
    priceVnd: number,
    durationMs: number,
    referrerSellerId: string | null,
    grandReferrerSellerId: string | null,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.sellerWallet.findUnique({ where: { sellerId } });
      if (!wallet) throw new BadRequestException("Ví seller chưa tồn tại, hãy nạp tiền trước.");
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );
      const fresh = await tx.sellerWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const balanceBefore = decimalToNumber(fresh.balance);
      if (balanceBefore < priceVnd) {
        throw new BadRequestException(`Số dư ví không đủ. Cần ${priceVnd.toLocaleString("vi-VN")}đ, hiện có ${balanceBefore.toLocaleString("vi-VN")}đ.`);
      }
      const balanceAfter = balanceBefore - priceVnd;

      // Compute tier extension dates
      const currentSeller = await tx.seller.findUniqueOrThrow({
        where: { id: sellerId },
        select: { tier: true, tierStartedAt: true, tierExpiresAt: true },
      });
      const now = new Date();
      const tierEnum = tierKeyToEnum(tier);
      const isRenewal = currentSeller.tier === tierEnum && currentSeller.tierExpiresAt && currentSeller.tierExpiresAt > now;
      const startsAt = isRenewal ? currentSeller.tierStartedAt ?? now : now;
      const base = isRenewal ? currentSeller.tierExpiresAt! : now;
      const endsAt = new Date(base.getTime() + durationMs);

      // Create subscription
      const subscription = await tx.tierSubscription.create({
        data: {
          sellerId,
          tier: tierEnum,
          plan: planKeyToEnum(plan),
          priceVnd: toDecimal(priceVnd),
          startsAt,
          endsAt,
          paymentMethod: "WALLET_BALANCE",
          paidFromWalletBalance: true,
          referrerSellerId,
          grandReferrerSellerId,
        },
      });

      // Update seller tier
      await tx.seller.update({
        where: { id: sellerId },
        data: { tier: tierEnum, tierStartedAt: startsAt, tierExpiresAt: endsAt },
      });

      // Debit wallet
      await tx.sellerWallet.update({ where: { id: wallet.id }, data: { balance: toDecimal(balanceAfter) } });
      await tx.walletLedger.create({
        data: {
          sellerId,
          walletId: wallet.id,
          type: WalletLedgerType.SUBSCRIPTION_PAYMENT,
          amount: toDecimal(-priceVnd),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "tier_subscription",
          referenceId: subscription.id,
          note: `Trừ ví: ${TIER_LABELS[tier]} ${PLAN_LABELS[plan]}`,
        },
      });

      // Credit commissions to referrers
      const sourceLabel = `${TIER_LABELS[tier]} ${PLAN_LABELS[plan]}`;
      const commissions = await this.tierAffiliate.creditCommissionsForSubscription(tx, {
        subscriptionId: subscription.id,
        payerSellerId: sellerId,
        priceVnd,
        referrerSellerId,
        grandReferrerSellerId,
        sourceLabel,
      });

      return { subscription, commissions, balanceAfter };
    });

    return {
      success: true,
      paidFromWallet: true,
      subscriptionId: result.subscription.id,
      tier,
      plan,
      amount: priceVnd,
      newWalletBalance: result.balanceAfter,
      endsAt: result.subscription.endsAt,
      level1Commission: result.commissions.level1Commission,
      level2Commission: result.commissions.level2Commission,
    };
  }

  /**
   * Called from webhook when a tier subscription payment is PAID.
   * Note: parses DepositRequest with note prefix "TIER_SUB:".
   */
  async confirmFromExternalOrderCode(externalOrderCode: string, rawPayload?: unknown) {
    const deposit = await this.prisma.depositRequest.findUnique({ where: { externalOrderCode } });
    if (!deposit) return null;
    const note = deposit.note || "";
    const match = note.match(/^TIER_SUB:(pro|ultra):(monthly|quarterly|semi_annual|annual):([^:]+):([^:]*):([^:]*)$/);
    if (!match) return null;
    const tier = match[1] as TierKey;
    const plan = match[2] as PlanKey;
    const sellerId = match[3]!;
    const referrerSellerId = match[4] ? match[4] : null;
    const grandReferrerSellerId = match[5] ? match[5] : null;

    if (deposit.status === "CONFIRMED") {
      this.logger.log(`TIER_SUB already confirmed: ${externalOrderCode}`);
      return { alreadyConfirmed: true };
    }

    const priceVnd = decimalToNumber(deposit.amount);
    const durationMs = getDurationMs(plan);

    await this.prisma.$transaction(async (tx) => {
      await tx.depositRequest.update({
        where: { id: deposit.id },
        data: {
          status: "CONFIRMED",
          paidAt: new Date(),
          approvedAt: new Date(),
          rawPayloadJson: rawPayload as any,
        },
      });

      // Reverse erroneous wallet credit if the deposit handler mistakenly credited the wallet
      const errLedger = await tx.walletLedger.findFirst({
        where: { referenceType: "deposit_request", referenceId: deposit.id },
      });
      if (errLedger) {
        const wallet = await tx.sellerWallet.findUnique({ where: { sellerId } });
        if (wallet) {
          const balanceBefore = decimalToNumber(wallet.balance);
          const creditAmount = decimalToNumber(errLedger.amount);
          const balanceAfter = Math.max(0, balanceBefore - creditAmount);
          await tx.sellerWallet.update({ where: { id: wallet.id }, data: { balance: toDecimal(balanceAfter) } });
          await tx.walletLedger.create({
            data: {
              sellerId,
              walletId: wallet.id,
              type: WalletLedgerType.ADJUST,
              amount: toDecimal(-creditAmount),
              balanceBefore: toDecimal(balanceBefore),
              balanceAfter: toDecimal(balanceAfter),
              referenceType: "tier_subscription_reversal",
              referenceId: deposit.id,
              note: "Reversal: tier payment incorrectly credited to wallet",
            },
          });
        }
      }

      const currentSeller = await tx.seller.findUniqueOrThrow({
        where: { id: sellerId },
        select: { tier: true, tierStartedAt: true, tierExpiresAt: true },
      });
      const now = new Date();
      const tierEnum = tierKeyToEnum(tier);
      const isRenewal = currentSeller.tier === tierEnum && currentSeller.tierExpiresAt && currentSeller.tierExpiresAt > now;
      const startsAt = isRenewal ? currentSeller.tierStartedAt ?? now : now;
      const base = isRenewal ? currentSeller.tierExpiresAt! : now;
      const endsAt = new Date(base.getTime() + durationMs);

      const subscription = await tx.tierSubscription.create({
        data: {
          sellerId,
          tier: tierEnum,
          plan: planKeyToEnum(plan),
          priceVnd: toDecimal(priceVnd),
          startsAt,
          endsAt,
          paymentMethod: deposit.provider,
          paymentTransactionId: deposit.id,
          referrerSellerId,
          grandReferrerSellerId,
        },
      });

      await tx.seller.update({
        where: { id: sellerId },
        data: { tier: tierEnum, tierStartedAt: startsAt, tierExpiresAt: endsAt },
      });

      const sourceLabel = `${TIER_LABELS[tier]} ${PLAN_LABELS[plan]}`;
      await this.tierAffiliate.creditCommissionsForSubscription(tx, {
        subscriptionId: subscription.id,
        payerSellerId: sellerId,
        priceVnd,
        referrerSellerId,
        grandReferrerSellerId,
        sourceLabel,
      });
    });

    return { success: true, tier, plan };
  }

  /**
   * Admin grants ULTRA to a seller (no payment, no commission).
   */
  async adminGrantUltra(adminUser: AuthenticatedUser, args: { sellerId: string; days: number; note?: string }) {
    if (adminUser.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only super admin can grant tier.");
    }
    const seller = await this.prisma.seller.findUnique({ where: { id: args.sellerId } });
    if (!seller) throw new NotFoundException("Seller not found");

    const durationMs = args.days * 24 * 60 * 60 * 1000;
    const now = new Date();
    const isExtension = seller.tier === SellerTier.ULTRA && seller.tierExpiresAt && seller.tierExpiresAt > now;
    const startsAt = isExtension ? seller.tierStartedAt ?? now : now;
    const base = isExtension ? seller.tierExpiresAt! : now;
    const endsAt = new Date(base.getTime() + durationMs);

    const subscription = await this.prisma.tierSubscription.create({
      data: {
        sellerId: seller.id,
        tier: SellerTier.ULTRA,
        plan: durationMs >= 360 * 24 * 60 * 60 * 1000
          ? "ANNUAL"
          : durationMs >= 170 * 24 * 60 * 60 * 1000
            ? "SEMI_ANNUAL"
            : "MONTHLY",
        priceVnd: toDecimal(0),
        startsAt,
        endsAt,
        isAdminGrant: true,
        adminGrantNote: args.note ?? null,
        paymentMethod: "ADMIN_GRANT",
      },
    });

    await this.prisma.seller.update({
      where: { id: seller.id },
      data: { tier: SellerTier.ULTRA, tierStartedAt: startsAt, tierExpiresAt: endsAt },
    });

    return { success: true, subscriptionId: subscription.id, endsAt };
  }

  /**
   * Admin refunds a tier subscription:
   *   - marks it REFUNDED + refundedAt
   *   - claws back affiliate commissions paid out (within 7d window)
   *   - if paid from wallet, credits the price back to the seller's wallet
   *   - if paid via gateway, returns a marker so admin handles the external refund
   *   - downgrades seller.tier to FREE if this was their active subscription
   */
  async refundTierSubscription(
    adminUser: AuthenticatedUser,
    args: { subscriptionId: string; note?: string },
  ) {
    if (adminUser.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only super admin can refund tier subscriptions.");
    }

    const sub = await this.prisma.tierSubscription.findUnique({
      where: { id: args.subscriptionId },
      select: {
        id: true,
        sellerId: true,
        tier: true,
        priceVnd: true,
        startsAt: true,
        endsAt: true,
        status: true,
        paidFromWalletBalance: true,
        refundedAt: true,
        isAdminGrant: true,
        seller: { select: { tier: true, tierExpiresAt: true } },
      },
    });
    if (!sub) throw new NotFoundException("Tier subscription not found.");
    if (sub.refundedAt || sub.status === "REFUNDED") {
      throw new BadRequestException("Subscription đã được refund trước đó.");
    }
    if (sub.isAdminGrant) {
      throw new BadRequestException("Admin grant không thể refund (không có thanh toán).");
    }

    const priceVnd = decimalToNumber(sub.priceVnd);
    const isStillActive =
      sub.seller.tier === sub.tier &&
      sub.seller.tierExpiresAt &&
      sub.seller.tierExpiresAt.getTime() === sub.endsAt.getTime();

    await this.prisma.$transaction(async (tx) => {
      await tx.tierSubscription.update({
        where: { id: sub.id },
        data: {
          status: "REFUNDED",
          refundedAt: new Date(),
          adminGrantNote: args.note
            ? `[refund by admin] ${args.note}`
            : "[refund by admin]",
        },
      });

      // 1) Claw back commissions (referrer + grand-referrer) if within window
      await this.tierAffiliate.clawBackCommissions(tx, sub.id);

      // 2) Refund money to seller's wallet if they paid from wallet balance
      if (sub.paidFromWalletBalance && priceVnd > 0) {
        const wallet = await tx.sellerWallet.upsert({
          where: { sellerId: sub.sellerId },
          update: {},
          create: { sellerId: sub.sellerId, balance: toDecimal(0) },
        });
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
        );
        const fresh = await tx.sellerWallet.findUniqueOrThrow({ where: { id: wallet.id } });
        const balanceBefore = decimalToNumber(fresh.balance);
        const balanceAfter = balanceBefore + priceVnd;
        await tx.sellerWallet.update({
          where: { id: wallet.id },
          data: { balance: toDecimal(balanceAfter) },
        });
        await tx.walletLedger.create({
          data: {
            sellerId: sub.sellerId,
            walletId: wallet.id,
            type: WalletLedgerType.ADJUST,
            amount: toDecimal(priceVnd),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            referenceType: "tier_subscription_refund",
            referenceId: sub.id,
            note: `Hoàn ví khi admin refund subscription ${sub.id.slice(0, 8)}`,
          },
        });
      }

      // 3) Downgrade seller tier if this was the active subscription
      if (isStillActive) {
        await tx.seller.update({
          where: { id: sub.sellerId },
          data: {
            tier: SellerTier.FREE,
            tierStartedAt: null,
            tierExpiresAt: null,
          },
        });
      }
    });

    this.logger.log(
      `Admin ${adminUser.id} refunded tier subscription ${sub.id} (seller=${sub.sellerId}, price=${priceVnd}, walletRefunded=${sub.paidFromWalletBalance})`,
    );

    return {
      success: true,
      subscriptionId: sub.id,
      walletRefunded: sub.paidFromWalletBalance,
      priceRefunded: priceVnd,
      externalRefundRequired: !sub.paidFromWalletBalance,
      tierDowngraded: isStillActive,
    };
  }

  /**
   * Affiliate stats for the current seller (used by /dashboard/affiliate page).
   */
  async getAffiliateStats(user: AuthenticatedUser) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        referralCode: true,
        affiliateUnlockedTier: true,
        affiliateUnlockedTier2At: true,
        affiliateUnlockedTier3At: true,
      },
    });
    if (!seller) throw new NotFoundException("Seller not found");

    const [allTime, last90d, last30d, currentMonth] = await Promise.all([
      this.tierAffiliate.getAllTimeCommission(seller.id),
      this.tierAffiliate.getActivityCommission(seller.id, 90),
      this.tierAffiliate.getActivityCommission(seller.id, 30),
      (async () => {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const result = await this.prisma.walletLedger.aggregate({
          where: {
            sellerId: seller.id,
            type: { in: [WalletLedgerType.AFFILIATE_LEVEL_1, WalletLedgerType.AFFILIATE_LEVEL_2] },
            createdAt: { gte: startOfMonth },
          },
          _sum: { amount: true },
        });
        return decimalToNumber(result._sum.amount);
      })(),
    ]);

    // Compute effective tier (based on activity)
    const effectiveLevel1Rate = this.tierAffiliate["constructor"] // hack to access static method
      ? null
      : null;
    // Use the imported helper directly:
    const effectiveRate = (function () {
      const { calcLevel1Rate } = require("./tier-pricing");
      return calcLevel1Rate(seller.affiliateUnlockedTier, last90d);
    })();

    // Direct referrals (level 1)
    const level1Referrals = await this.prisma.seller.findMany({
      where: { referredBySellerId: seller.id },
      select: {
        id: true,
        displayName: true,
        tier: true,
        tierExpiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Level 2 referrals (referrals of level 1)
    const level2Referrals = await this.prisma.seller.findMany({
      where: { referredBy: { referredBySellerId: seller.id } },
      select: {
        id: true,
        displayName: true,
        tier: true,
        tierExpiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Recent commission ledger
    const recentLedger = await this.prisma.walletLedger.findMany({
      where: {
        sellerId: seller.id,
        type: {
          in: [
            WalletLedgerType.AFFILIATE_LEVEL_1,
            WalletLedgerType.AFFILIATE_LEVEL_2,
            WalletLedgerType.AFFILIATE_CLAWBACK,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Monthly chart data (last 12 months)
    const monthlyChart = await this.computeMonthlyCommission(seller.id, 12);

    return {
      referralCode: seller.referralCode,
      unlockedTier: seller.affiliateUnlockedTier,
      unlockedTier2At: seller.affiliateUnlockedTier2At,
      unlockedTier3At: seller.affiliateUnlockedTier3At,
      effectiveRate,
      activity90d: last90d,
      activity30d: last30d,
      allTimeCommission: allTime,
      currentMonthCommission: currentMonth,
      level1Count: level1Referrals.length,
      level1ActiveCount: level1Referrals.filter((r) => r.tier !== SellerTier.FREE && r.tierExpiresAt && r.tierExpiresAt > new Date()).length,
      level2Count: level2Referrals.length,
      level2ActiveCount: level2Referrals.filter((r) => r.tier !== SellerTier.FREE && r.tierExpiresAt && r.tierExpiresAt > new Date()).length,
      level1Referrals,
      level2Referrals,
      recentLedger: recentLedger.map((l) => ({
        id: l.id,
        type: l.type,
        amount: decimalToNumber(l.amount),
        note: l.note,
        createdAt: l.createdAt,
      })),
      monthlyChart,
    };
  }

  private async computeMonthlyCommission(sellerId: string, months: number) {
    const data: Array<{ month: string; total: number }> = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const result = await this.prisma.walletLedger.aggregate({
        where: {
          sellerId,
          type: { in: [WalletLedgerType.AFFILIATE_LEVEL_1, WalletLedgerType.AFFILIATE_LEVEL_2] },
          createdAt: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
      });
      data.push({
        month: `${monthStart.getMonth() + 1}/${monthStart.getFullYear()}`,
        total: decimalToNumber(result._sum.amount),
      });
    }
    return data;
  }

  /**
   * Cron-triggered: scan sellers about to expire and auto-renew if configured.
   * Called by worker daily.
   */
  async processAutoRenewals(): Promise<{ renewed: number; failed: number }> {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days from now
    const sellers = await this.prisma.seller.findMany({
      where: {
        tierExpiresAt: { lte: soon, gt: new Date() },
        autoRenewConfig: { not: Prisma.JsonNull },
        tier: { in: [SellerTier.PRO, SellerTier.ULTRA] },
      },
      select: {
        id: true,
        userId: true,
        tier: true,
        tierExpiresAt: true,
        autoRenewConfig: true,
      },
    });

    let renewed = 0;
    let failed = 0;

    for (const seller of sellers) {
      const config = seller.autoRenewConfig as { enabled?: boolean; plan?: PlanKey; useWallet?: boolean } | null;
      if (!config?.enabled) continue;

      // Only support wallet-based auto-renew (external payment needs user interaction)
      if (!config.useWallet) continue;

      const tierKey = tierEnumToKey(seller.tier);
      if (!tierKey) continue;
      const plan = config.plan || "monthly";

      try {
        await this.purchase(
          { id: seller.userId, role: "SELLER" } as AuthenticatedUser,
          { tier: tierKey, plan, paymentMethod: "WALLET_BALANCE" },
        );
        renewed++;
        this.logger.log(`Auto-renewed ${tierKey}/${plan} for seller ${seller.id}`);
      } catch (error) {
        failed++;
        this.logger.warn(`Auto-renew failed for seller ${seller.id}: ${(error as Error).message}`);
      }
    }

    return { renewed, failed };
  }

  /**
   * Set auto-renew config for current seller.
   */
  async setAutoRenew(user: AuthenticatedUser, config: { enabled: boolean; plan?: PlanKey; useWallet?: boolean }) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!seller) throw new NotFoundException("Seller not found");

    await this.prisma.seller.update({
      where: { id: seller.id },
      data: {
        autoRenewConfig: {
          enabled: config.enabled,
          plan: config.plan ?? "monthly",
          useWallet: config.useWallet ?? false,
        },
      },
    });

    return { success: true };
  }
}
