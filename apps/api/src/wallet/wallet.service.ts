import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DepositStatus,
  PaymentTransactionStatus,
  Prisma,
  WalletLedgerType,
  WithdrawStatus,
} from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";
import { decimalToNumber, generateExternalPaymentCode, toDecimal } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

import type {
  CreateDepositRequestDto,
  CreateWithdrawRequestDto,
} from "./wallet.dto";

@Injectable()
export class WalletService {
  private readonly depositExpiryMs = 5 * 60 * 1000;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
  ) {}

  async getWallet(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const wallet = await this.prisma.sellerWallet.findUnique({
      where: { sellerId: shop.sellerId },
    });

    if (!wallet) {
      throw new NotFoundException("Wallet not found.");
    }

    const pendingWithdrawAmount = await this.getPendingWithdrawAmount(shop.sellerId);
    const balance = decimalToNumber(wallet.balance);
    const withdrawableBalance = Math.max(0, balance - pendingWithdrawAmount);

    return {
      id: wallet.id,
      sellerId: wallet.sellerId,
      balance,
      pendingWithdrawAmount,
      withdrawableBalance,
      currency: wallet.currency,
      updatedAt: wallet.updatedAt,
    };
  }

  async getSourceWallet(user: AuthenticatedUser) {
    const sourceWallet = await this.shopsService.getProviderBalanceForUser(user.id);

    return {
      walletCurrency: sourceWallet.walletCurrency,
      balance: sourceWallet.balance,
      balanceVnd: sourceWallet.balanceVnd,
      balanceUsd: sourceWallet.balanceUsd,
      balanceText: sourceWallet.balanceText,
      usdtBalance: sourceWallet.usdtBalance,
      requesterName: sourceWallet.requesterName,
      requesterChatId: sourceWallet.requesterChatId,
      botSource: sourceWallet.botSource,
      updatedAt: sourceWallet.updatedAt,
    };
  }

  async getWalletLedgers(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const ledgers = await this.prisma.walletLedger.findMany({
      where: {
        sellerId: shop.sellerId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return ledgers.map((ledger) => ({
      id: ledger.id,
      type: ledger.type.toLowerCase(),
      amount: decimalToNumber(ledger.amount),
      balanceBefore: decimalToNumber(ledger.balanceBefore),
      balanceAfter: decimalToNumber(ledger.balanceAfter),
      referenceType: ledger.referenceType,
      referenceId: ledger.referenceId,
      note: ledger.note,
      createdAt: ledger.createdAt,
    }));
  }

  async listDepositRequests(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.depositRequest.findMany({
      where: {
        sellerId: shop.sellerId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });
  }

  async listWithdrawRequests(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.withdrawRequest.findMany({
      where: {
        sellerId: shop.sellerId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });
  }

  async createDepositRequest(user: AuthenticatedUser, dto: CreateDepositRequestDto) {
    throw new BadRequestException(
      "Tính năng nạp ví seller qua web đã được tắt. Vui lòng nạp trực tiếp ở bot nguồn Canboso.",
    );

    const shop = await this.shopsService.getSellerShop(user.id);
    const amount = Number(dto.amount);

    if (!Number.isInteger(amount) || amount < 1000) {
      throw new BadRequestException("Deposit amount must be at least 1,000 VND.");
    }

    const externalOrderCode = generateExternalPaymentCode();
    const expiresAt = new Date(Date.now() + this.depositExpiryMs);
    const payment = await this.paymentService.createPaymentLink({
      shopId: shop.id,
      externalOrderCode,
      amount,
      description: `NAPCTV-${externalOrderCode.slice(-6)}`,
      expiredAt: expiresAt,
    });

    return this.prisma.depositRequest.create({
      data: {
        sellerId: shop.sellerId,
        amount: toDecimal(amount),
        provider: payment.provider,
        externalOrderCode,
        checkoutUrl: payment.checkoutUrl,
        qrCode: payment.qrCode,
        expiresAt,
        note: dto.note ?? "Top up seller wallet from dashboard",
        rawPayloadJson: payment.providerPayload as Prisma.InputJsonValue,
      },
    });
  }

  async confirmDepositRequestByExternalOrderCode(externalOrderCode: string, rawPayload?: unknown) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: {
        externalOrderCode,
      },
    });

    if (!deposit) {
      throw new NotFoundException("Deposit request not found.");
    }

    // Upgrade deposits are handled by UpgradeService, not wallet
    if (deposit.note && deposit.note.startsWith("UPGRADE_TIER:")) {
      throw new NotFoundException("Deposit request not found.");
    }

    if (deposit.status === DepositStatus.CONFIRMED) {
      return deposit;
    }

    if (deposit.status !== DepositStatus.PENDING) {
      return deposit;
    }

    await this.creditWallet(
      deposit.sellerId,
      decimalToNumber(deposit.amount),
      WalletLedgerType.TOPUP,
      "deposit_request",
      deposit.id,
      "Top up seller wallet from dashboard payment",
    );

    return this.prisma.depositRequest.update({
      where: {
        id: deposit.id,
      },
      data: {
        status: DepositStatus.CONFIRMED,
        paidAt: new Date(),
        approvedAt: new Date(),
        rawPayloadJson: rawPayload as Prisma.InputJsonValue,
        note: deposit.note ?? "Top up seller wallet from dashboard",
      },
    });
  }

  async expirePendingDepositRequests(limit = 50) {
    const expiredRequests = await this.prisma.depositRequest.findMany({
      where: {
        status: DepositStatus.PENDING,
        externalOrderCode: {
          not: null,
        },
        expiresAt: {
          lte: new Date(),
        },
      },
      orderBy: {
        expiresAt: "asc",
      },
      take: limit,
    });

    for (const request of expiredRequests) {
      await this.prisma.depositRequest.updateMany({
        where: {
          id: request.id,
          status: DepositStatus.PENDING,
        },
        data: {
          status: DepositStatus.REJECTED,
          note: request.note || "Expired payment link",
        },
      });
    }

    return expiredRequests.length;
  }

  async createWithdrawRequest(user: AuthenticatedUser, dto: CreateWithdrawRequestDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const amount = Number(dto.amount);

    if (!Number.isInteger(amount) || amount < 1000) {
      throw new BadRequestException("Withdraw amount must be at least 1,000 VND.");
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.sellerWallet.findUnique({
        where: { sellerId: shop.sellerId },
      });

      if (!wallet) {
        throw new NotFoundException("Wallet not found.");
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const pendingWithdrawAggregate = await tx.withdrawRequest.aggregate({
        where: {
          sellerId: shop.sellerId,
          status: WithdrawStatus.PENDING,
        },
        _sum: {
          amount: true,
        },
      });
      const balance = decimalToNumber(wallet.balance);
      const pendingWithdrawAmount = decimalToNumber(pendingWithdrawAggregate._sum.amount);
      const withdrawableBalance = Math.max(0, balance - pendingWithdrawAmount);

      if (withdrawableBalance < amount) {
        throw new BadRequestException("Insufficient withdrawable wallet balance.");
      }

      return tx.withdrawRequest.create({
        data: {
          sellerId: shop.sellerId,
          amount: toDecimal(amount),
          bankName: dto.bankName,
          bankAccountNumber: dto.bankAccountNumber,
          bankAccountName: dto.bankAccountName,
          note: dto.note ?? null,
        },
      });
    });
  }

  async debitForOrder(
    sellerId: string,
    amount: number,
    referenceId: string,
    note = "Debit wallet for upstream purchase",
  ) {
    return this.applyWalletMutation(
      sellerId,
      amount * -1,
      WalletLedgerType.DEBIT_PURCHASE,
      "order",
      referenceId,
      note,
    );
  }

  async refundForOrder(
    sellerId: string,
    amount: number,
    referenceId: string,
    note = "Refund wallet after upstream failure",
  ) {
    return this.applyWalletMutation(
      sellerId,
      amount,
      WalletLedgerType.REFUND_PURCHASE,
      "order",
      referenceId,
      note,
    );
  }

  async creditWallet(
    sellerId: string,
    amount: number,
    type: WalletLedgerType,
    referenceType: string,
    referenceId: string,
    note?: string,
  ) {
    return this.applyWalletMutation(
      sellerId,
      amount,
      type,
      referenceType,
      referenceId,
      note,
    );
  }

  private async applyWalletMutation(
    sellerId: string,
    delta: number,
    type: WalletLedgerType,
    referenceType: string,
    referenceId: string,
    note?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.sellerWallet.findUnique({
        where: { sellerId },
      });

      if (!wallet) {
        throw new NotFoundException("Wallet not found.");
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const balanceBefore = decimalToNumber(wallet.balance);
      const balanceAfter = balanceBefore + delta;

      if (balanceAfter < 0) {
        throw new BadRequestException("Insufficient wallet balance.");
      }

      const updatedWallet = await tx.sellerWallet.update({
        where: { id: wallet.id },
        data: {
          balance: toDecimal(balanceAfter),
        },
      });

      const ledger = await tx.walletLedger.create({
        data: {
          sellerId,
          walletId: wallet.id,
          type,
          amount: toDecimal(delta),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType,
          referenceId,
          note: note ?? null,
        },
      });

      return {
        wallet: updatedWallet,
        ledger,
      };
    });
  }

  async getCustomerWallets(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const wallets = await this.prisma.customerWallet.findMany({
      where: { customer: { shopId: shop.id } },
      include: {
        customer: { select: { telegramUsername: true, telegramUserId: true, firstName: true, lastName: true } },
        topups: { where: { status: PaymentTransactionStatus.PAID }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, amount: true } },
      },
      orderBy: { balance: "desc" },
    });
    return wallets.map((w) => {
      const c = w.customer;
      const displayName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;
      return {
        id: w.id,
        customerId: w.customerId,
        balance: decimalToNumber(w.balance),
        currency: w.currency,
        updatedAt: w.updatedAt,
        telegramUsername: c.telegramUsername,
        telegramUserId: c.telegramUserId,
        name: displayName,
        lastTopupAt: w.topups[0]?.createdAt ?? null,
        lastTopupAmount: w.topups[0] ? decimalToNumber(w.topups[0].amount) : null,
      };
    });
  }

  async getCustomerTopupHistory(user: AuthenticatedUser, customerId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const topups = await this.prisma.customerWalletTopup.findMany({
      where: { customer: { shopId: shop.id, id: customerId } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return topups.map((t) => ({
      id: t.id,
      amount: decimalToNumber(t.amount),
      status: t.status,
      createdAt: t.createdAt,
    }));
  }

  private async getPendingWithdrawAmount(sellerId: string) {
    const aggregate = await this.prisma.withdrawRequest.aggregate({
      where: {
        sellerId,
        status: WithdrawStatus.PENDING,
      },
      _sum: {
        amount: true,
      },
    });

    return decimalToNumber(aggregate._sum.amount);
  }
}
