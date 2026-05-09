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
  PaymentTransactionStatus,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";
import {
  decimalToNumber,
  generateExternalPaymentCode,
  toDecimal,
} from "../lib/utils";
import { ShopsService } from "../shops/shops.service";

const TOPUP_EXPIRY_MS = 5 * 60 * 1000;

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
      currency: customer?.wallet?.currency || "VND",
      pendingTopups: (customer?.walletTopups || [])
        .filter((topup) => topup.status === PaymentTransactionStatus.PENDING)
        .map((topup) => this.mapTopup(topup, topup.shopId)),
      recentTopups: (customer?.walletTopups || []).map((topup) => this.mapTopup(topup, topup.shopId)),
    };
  }

  async createTopupForTelegram(input: {
    shopId: string;
    amount: number;
    customer: TelegramCustomerProfile;
  }) {
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
    const expiresAt = new Date(Date.now() + TOPUP_EXPIRY_MS);
    const payment = await this.paymentService.createPaymentLink({
      shopId: input.shopId,
      externalOrderCode,
      amount,
      description: `NAPVI-${externalOrderCode.slice(-6)}`,
      expiredAt: expiresAt,
    });

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
        rawPayloadJson: payment.providerPayload as Prisma.InputJsonValue,
      },
    });

    return {
      topup: this.mapTopup(topup, topup.shopId),
      walletBalance: decimalToNumber(wallet.balance),
    };
  }

  async markTopupPaid(externalOrderCode: string, rawPayload?: unknown) {
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

    if (topup.status !== PaymentTransactionStatus.PENDING) {
      return {
        topup: this.mapTopup(topup, topup.shopId),
        customer: topup.customer,
        balanceAfter: decimalToNumber(topup.wallet.balance),
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
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

      if (currentTopup.status !== PaymentTransactionStatus.PENDING) {
        return {
          topup: this.mapTopup(currentTopup, currentTopup.shopId),
          customer: currentTopup.customer,
          balanceAfter: decimalToNumber(currentTopup.wallet.balance),
        };
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${currentTopup.walletId} FOR UPDATE`,
      );

      const balanceBefore = decimalToNumber(currentTopup.wallet.balance);
      const balanceAfter = balanceBefore + decimalToNumber(currentTopup.amount);

      const updatedWallet = await tx.customerWallet.update({
        where: {
          id: currentTopup.walletId,
        },
        data: {
          balance: toDecimal(balanceAfter),
        },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: currentTopup.customerId,
          walletId: currentTopup.walletId,
          type: CustomerWalletLedgerType.TOPUP,
          amount: currentTopup.amount,
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "customer_wallet_topup",
          referenceId: currentTopup.id,
          note: "Top up wallet from Telegram bot",
        },
      });

      const updatedTopup = await tx.customerWalletTopup.update({
        where: {
          id: currentTopup.id,
        },
        data: {
          status: PaymentTransactionStatus.PAID,
          paidAt: new Date(),
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
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM downstream_source_connections WHERE id = ${connection.id} FOR UPDATE`,
          );
          const current = await tx.downstreamSourceConnection.findUnique({ where: { id: connection.id } });
          if (!current) return;
          const balanceBefore = decimalToNumber(current.balance);
          const balanceAfter = balanceBefore + decimalToNumber(topup.amount);
          await tx.downstreamSourceConnection.update({
            where: { id: connection.id },
            data: { balance: toDecimal(balanceAfter) },
          });
          await tx.internalSourceLedger.create({
            data: {
              connectionId: connection.id,
              type: InternalSourceLedgerType.TOPUP,
              amount: topup.amount,
              balanceBefore: toDecimal(balanceBefore),
              balanceAfter: toDecimal(balanceAfter),
              referenceType: "customer_wallet_topup",
              referenceId: topup.id,
              note: "Auto credit from customer wallet top-up in upstream bot",
            },
          });
        }).catch(() => undefined);
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
    };
  }
}
