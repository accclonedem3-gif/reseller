import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CustomerWalletLedgerType,
  DownstreamSourceConnectionStatus,
  InternalSourceLedgerType,
  PaymentProvider,
  PaymentTransactionStatus,
  Prisma,
} from "@prisma/client";
import { WalletPromotionService } from "../wallet/wallet-promotion.service";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";
import { FeatureFlagService } from "../lib/feature-flag.service";
import {
  decimalToNumber,
  generateExternalPaymentCode,
  toDecimal,
} from "../lib/utils";
import { ShopsService } from "../shops/shops.service";

const TOPUP_EXPIRY_MS = 5 * 60 * 1000;
const TOPUP_EXPIRY_ONCHAIN_MS = 30 * 60 * 1000;
type TelegramCustomerProfile = {
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

@Injectable()
export class CustomerWalletService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(WalletPromotionService)
    private readonly promotionService: WalletPromotionService,
    @Inject(FeatureFlagService)
    private readonly featureFlags: FeatureFlagService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async getWalletSummaryForTelegram(shopId: string, telegramUserId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: {
        shopId_telegramUserId: {
          shopId,
          telegramUserId,
        },
      },
      include: {
        wallet: true,
        walletTopups: {
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        },
      },
    });

    return {
      balance: decimalToNumber(customer?.wallet?.balance),
      commissionBalance: decimalToNumber(customer?.wallet?.commissionBalance),
      currency: customer?.wallet?.currency || "VND",
      telegramUsername: customer?.telegramUsername || null,
      telegramChatId: customer?.telegramChatId || null,
      pendingTopups: (customer?.walletTopups || [])
        .filter((topup) => topup.status === PaymentTransactionStatus.PENDING)
        .map((topup) => this.mapTopup(topup, topup.shopId)),
      recentTopups: (customer?.walletTopups || []).map((topup) => this.mapTopup(topup, topup.shopId)),
    };
  }

  /** Recent wallet ledger entries (all balance movements) for the bot history view. */
  async getWalletLedgerForTelegram(
    shopId: string,
    telegramUserId: string,
    limit = 15,
    offset = 0,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { shopId_telegramUserId: { shopId, telegramUserId } },
      select: { id: true },
    });
    if (!customer) return [];
    const entries = await this.prisma.customerWalletLedger.findMany({
      where: {
        customerId: customer.id,
        // Hide the internal currency-sync shadow rows (e.g. the USDT mirror of a
        // VND adjust) — they confuse the customer and visually double-count.
        NOT: { note: { startsWith: "Auto-sync" } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: Math.max(0, offset),
      select: {
        type: true,
        amount: true,
        balanceAfter: true,
        commissionBalanceAfter: true,
        note: true,
        createdAt: true,
      },
    });
    return entries.map((e) => ({
      type: e.type as string,
      amount: decimalToNumber(e.amount),
      balanceAfter: decimalToNumber(e.balanceAfter),
      commissionBalanceAfter:
        e.commissionBalanceAfter != null ? decimalToNumber(e.commissionBalanceAfter) : null,
      note: e.note ?? null,
      createdAt: e.createdAt,
    }));
  }

  async createTopupForTelegram(input: {
    shopId: string;
    amount: number;
    customer: TelegramCustomerProfile;
    providerOverride?: import("@prisma/client").PaymentProvider;
  }) {
    await this.featureFlags.assertEnabled("wallet_topups");
    const amount = Number(input.amount);

    if (!Number.isInteger(amount) || amount < 1000) {
      throw new BadRequestException("Số tiền nạp phải là số nguyên từ 1.000đ trở lên.");
    }

    await this.shopsService.getSellerShopByShopId(input.shopId);
    const customer = await this.upsertTelegramCustomer(input.shopId, input.customer);
    const wallet = await this.prisma.customerWallet.upsert({
      where: {
        customerId: customer.id,
      },
      update: {},
      create: {
        customerId: customer.id,
        balance: toDecimal(0),
      },
    });

    const externalOrderCode = generateExternalPaymentCode();
    const isOnchain = input.providerOverride === PaymentProvider.USDT_TRC20
      || input.providerOverride === PaymentProvider.USDT_BEP20
      || input.providerOverride === PaymentProvider.USDT_SOL
      || input.providerOverride === PaymentProvider.USDT_TON;
    const expiresAt = new Date(Date.now() + (isOnchain ? TOPUP_EXPIRY_ONCHAIN_MS : TOPUP_EXPIRY_MS));
    const payment = await this.paymentService.createPaymentLink({
      shopId: input.shopId,
      externalOrderCode,
      amount,
      description: `NAPVI-${externalOrderCode.slice(-6)}`,
      expiredAt: expiresAt,
      providerOverride: input.providerOverride,
    });

    // Snapshot active promotion at payment creation time
    const activePromo = await this.promotionService.getActivePromotion(input.shopId, amount);
    const bonusPercent = activePromo ? activePromo.bonusPercent : null;
    const bonusAmount = bonusPercent !== null ? Math.floor(amount * bonusPercent / 100) : null;

    const topup = await this.prisma.customerWalletTopup.create({
      data: {
        shopId: input.shopId,
        customerId: customer.id,
        walletId: wallet.id,
        provider: payment.provider,
        amount: toDecimal(amount),
        externalOrderCode,
        checkoutUrl: payment.checkoutUrl,
        qrCode: payment.qrCode,
        status: PaymentTransactionStatus.PENDING,
        expiresAt,
        bonusPercent: bonusPercent !== null ? toDecimal(bonusPercent) : null,
        bonusAmount: bonusAmount !== null ? toDecimal(bonusAmount) : null,
        rawPayloadJson: payment.providerPayload as Prisma.InputJsonValue,
      },
    });

    return {
      topup: this.mapTopup(topup, topup.shopId),
      walletBalance: decimalToNumber(wallet.balance),
      bankInfo: payment.bankInfo,
      manualCrypto: payment.manualCrypto,
    };
  }

  async markTopupPaid(
    externalOrderCode: string,
    rawPayload?: unknown,
    options?: { cryptoTxHash?: string | null; confirmedExternalPayment?: boolean },
  ) {
    const topup = await this.prisma.customerWalletTopup.findUnique({
      where: {
        externalOrderCode,
      },
      include: {
        customer: true,
        wallet: true,
      },
    });

    if (!topup) {
      throw new NotFoundException("Customer wallet topup not found.");
    }

    if (topup.status === PaymentTransactionStatus.PAID) {
      return {
        topup: this.mapTopup(topup, topup.shopId),
        customer: topup.customer,
        balanceAfter: decimalToNumber(topup.wallet.balance),
      };
    }

    await this.paymentService.assertCryptoReceiptClaimed(
      externalOrderCode,
      topup.provider,
      options?.cryptoTxHash,
    );

    const canRecoverCanceled =
      topup.status === PaymentTransactionStatus.CANCELED &&
      options?.confirmedExternalPayment === true;

    if (topup.status !== PaymentTransactionStatus.PENDING && !canRecoverCanceled) {
      return {
        topup: this.mapTopup(topup, topup.shopId),
        customer: topup.customer,
        balanceAfter: decimalToNumber(topup.wallet.balance),
      };
    }

    // Resolve per-shop USDT rate override (bot display uses this rate; ledger must match).
    // Read BEFORE the transaction so the tx stays short. paymentConfig is stable during the tx.
    const paymentConfigForRate = await this.prisma.paymentConfig.findUnique({
      where: { shopId: topup.shopId },
      select: { usdtVndRateOverride: true },
    });
    const usdtVndRateForTopup = (() => {
      const override = Number(paymentConfigForRate?.usdtVndRateOverride ?? NaN);
      return Number.isFinite(override) && override > 0 ? override : this.config.usdtVndRate;
    })();

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallet_topups WHERE id = ${topup.id} FOR UPDATE`,
      );

      const currentTopup = await tx.customerWalletTopup.findUnique({
        where: {
          id: topup.id,
        },
        include: {
          customer: true,
          wallet: true,
        },
      });

      if (!currentTopup) {
        throw new NotFoundException("Customer wallet topup not found.");
      }

      const canRecoverCurrentCanceled =
        currentTopup.status === PaymentTransactionStatus.CANCELED &&
        options?.confirmedExternalPayment === true;

      if (
        currentTopup.status !== PaymentTransactionStatus.PENDING &&
        !canRecoverCurrentCanceled
      ) {
        return {
          topup: this.mapTopup(currentTopup, currentTopup.shopId),
          customer: currentTopup.customer,
          balanceAfter: decimalToNumber(currentTopup.wallet.balance),
        };
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${currentTopup.walletId} FOR UPDATE`,
      );

      const currentWallet = await tx.customerWallet.findUnique({
        where: { id: currentTopup.walletId },
      });
      if (!currentWallet) {
        throw new NotFoundException("Customer wallet not found.");
      }

      const balanceBefore = decimalToNumber(currentWallet.balance);
      const topupAmount = decimalToNumber(currentTopup.amount);
      const bonusAmount = currentTopup.bonusAmount ? decimalToNumber(currentTopup.bonusAmount) : 0;
      const balanceAfter = balanceBefore + topupAmount + bonusAmount;
      const usdtBefore = decimalToNumber(currentWallet.balanceUsdt);
      const rawPayloadTyped = rawPayload != null && typeof rawPayload === "object" ? rawPayload as Record<string, unknown> : null;
      const actualAmountUsdt = typeof rawPayloadTyped?.amountUsdt === "number" && Number.isFinite(rawPayloadTyped.amountUsdt as number)
        ? rawPayloadTyped.amountUsdt as number
        : null;
      // Ledger must record the SAME rate the bot showed the customer.
      const usdtDelta = actualAmountUsdt ?? topupAmount / usdtVndRateForTopup;
      const usdtAfter = usdtBefore + usdtDelta;

      const updatedWallet = await tx.customerWallet.update({
        where: {
          id: currentTopup.walletId,
        },
        data: {
          balance: toDecimal(balanceAfter),
          balanceUsdt: toDecimal(usdtAfter),
        },
      });

      const mainBalanceAfter = balanceBefore + topupAmount;
      await tx.customerWalletLedger.create({
        data: {
          customerId: currentTopup.customerId,
          walletId: currentTopup.walletId,
          type: CustomerWalletLedgerType.TOPUP,
          currency: "VND",
          amount: currentTopup.amount,
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(mainBalanceAfter),
          referenceType: "customer_wallet_topup",
          referenceId: currentTopup.id,
          note: "Top up wallet from Telegram bot",
        },
      });

      if (bonusAmount > 0) {
        await tx.customerWalletLedger.create({
          data: {
            customerId: currentTopup.customerId,
            walletId: currentTopup.walletId,
            type: CustomerWalletLedgerType.TOPUP_BONUS,
            currency: "VND",
            amount: toDecimal(bonusAmount),
            balanceBefore: toDecimal(mainBalanceAfter),
            balanceAfter: toDecimal(balanceAfter),
            referenceType: "customer_wallet_topup",
            referenceId: currentTopup.id,
            note: `Bonus ${decimalToNumber(currentTopup.bonusPercent!)}% khuyến mãi nạp ví`,
          },
        });
      }

      await tx.customerWalletLedger.create({
        data: {
          customerId: currentTopup.customerId,
          walletId: currentTopup.walletId,
          type: CustomerWalletLedgerType.TOPUP,
          currency: "USDT",
          amount: toDecimal(usdtDelta),
          balanceBefore: toDecimal(usdtBefore),
          balanceAfter: toDecimal(usdtAfter),
          referenceType: "customer_wallet_topup",
          referenceId: currentTopup.id,
          note: "Auto-sync USDT from VND topup",
        },
      });

      const updatedTopup = await tx.customerWalletTopup.update({
        where: {
          id: currentTopup.id,
        },
        data: {
          status: PaymentTransactionStatus.PAID,
          paidAt: new Date(),
          canceledAt: null,
          cryptoTxHash: options?.cryptoTxHash || undefined,
          rawPayloadJson: rawPayload as Prisma.InputJsonValue,
        },
      });

      return {
        topup: this.mapTopup(updatedTopup, currentTopup.shopId),
        customer: currentTopup.customer,
        balanceAfter: decimalToNumber(updatedWallet.balance),
      };
    });

    // Auto-credit DownstreamSourceConnection if this customer is a linked reseller
    const telegramChatId = topup.customer.telegramChatId;
    if (telegramChatId) {
      const connection = await this.prisma.downstreamSourceConnection.findFirst({
        where: {
          upstreamShopId: topup.shopId,
          downstreamTelegramChatId: telegramChatId,
          status: DownstreamSourceConnectionStatus.ACTIVE,
        },
      });
      if (connection) {
        // Record in InternalSourceLedger for audit — wallet is already credited above.
        // Must await so the audit row is flushed before the request returns; if the
        // insert throws we log but do NOT roll back the wallet credit (wallet ledger
        // is the source of truth, this is a duplicated audit trail).
        const walletAfter = decimalToNumber(result.balanceAfter ?? 0);
        const topupAmount = decimalToNumber(topup.amount);
        try {
          await this.prisma.internalSourceLedger.create({
            data: {
              connectionId: connection.id,
              type: InternalSourceLedgerType.TOPUP,
              amount: topup.amount,
              balanceBefore: toDecimal(walletAfter - topupAmount),
              balanceAfter: toDecimal(walletAfter),
              referenceType: "customer_wallet_topup",
              referenceId: topup.id,
              note: "Auto credit from customer wallet top-up in upstream bot",
            },
          });
        } catch (err) {
          console.error(
            `[customer-wallet] Failed to record InternalSourceLedger audit for topup ${topup.id}:`,
            err,
          );
        }
      }
    }

    return result;
  }

  async expirePendingTopups(limit = 50) {
    const expiredTopups = await this.prisma.customerWalletTopup.findMany({
      where: {
        status: PaymentTransactionStatus.PENDING,
        expiresAt: {
          lte: new Date(),
        },
      },
      include: {
        customer: true,
        shop: {
          include: {
            botConfig: true,
          },
        },
      },
      orderBy: {
        expiresAt: "asc",
      },
      take: limit,
    });

    const results: Array<{
      externalOrderCode: string;
      amount: number;
      telegramChatId: string;
      shopId: string;
    }> = [];

    for (const topup of expiredTopups) {
      const updated = await this.prisma.customerWalletTopup.updateMany({
        where: {
          id: topup.id,
          status: PaymentTransactionStatus.PENDING,
        },
        data: {
          status: PaymentTransactionStatus.CANCELED,
          canceledAt: new Date(),
        },
      });

      if (updated.count > 0) {
        results.push({
          externalOrderCode: topup.externalOrderCode,
          amount: decimalToNumber(topup.amount),
          telegramChatId: topup.customer.telegramChatId,
          shopId: topup.shopId,
        });
      }
    }

    return results;
  }

  private async upsertTelegramCustomer(shopId: string, customer: TelegramCustomerProfile) {
    const shop = await this.shopsService.getSellerShopByShopId(shopId);

    return this.prisma.customer.upsert({
      where: {
        shopId_telegramUserId: {
          shopId,
          telegramUserId: customer.telegramUserId,
        },
      },
      update: {
        telegramChatId: customer.telegramChatId,
        telegramUsername: customer.telegramUsername || null,
        firstName: customer.firstName || null,
        lastName: customer.lastName || null,
      },
      create: {
        sellerId: shop.sellerId,
        shopId,
        telegramUserId: customer.telegramUserId,
        telegramChatId: customer.telegramChatId,
        telegramUsername: customer.telegramUsername || null,
        firstName: customer.firstName || null,
        lastName: customer.lastName || null,
      },
    });
  }

  private mapTopup(topup: {
    id: string;
    shopId?: string;
    amount: Prisma.Decimal;
    currency: string;
    externalOrderCode: string;
    checkoutUrl: string;
    qrCode: string | null;
    status: PaymentTransactionStatus;
    expiresAt: Date;
    createdAt: Date;
    paidAt: Date | null;
    bonusPercent?: Prisma.Decimal | null;
    bonusAmount?: Prisma.Decimal | null;
  }, shopId?: string) {
    return {
      id: topup.id,
      shopId: shopId || topup.shopId || "",
      amount: decimalToNumber(topup.amount),
      currency: topup.currency,
      externalOrderCode: topup.externalOrderCode,
      checkoutUrl: topup.checkoutUrl,
      qrCode: topup.qrCode,
      status: topup.status.toLowerCase(),
      expiresAt: topup.expiresAt,
      createdAt: topup.createdAt,
      paidAt: topup.paidAt,
      bonusPercent: topup.bonusPercent ? decimalToNumber(topup.bonusPercent) : null,
      bonusAmount: topup.bonusAmount ? decimalToNumber(topup.bonusAmount) : null,
    };
  }
}
