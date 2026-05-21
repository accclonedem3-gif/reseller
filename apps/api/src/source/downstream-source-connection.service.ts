import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DownstreamSourceConnectionStatus,
  InternalSourceLedgerType,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import { decimalToNumber, toDecimal } from "../lib/utils";

@Injectable()
export class DownstreamSourceConnectionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createConnection(
    upstreamSellerId: string,
    upstreamShopId: string,
    downstreamSellerId: string,
    downstreamShopId: string,
    apiKeyId: string,
  ) {
    const existing = await this.prisma.downstreamSourceConnection.findUnique({
      where: {
        upstreamShopId_downstreamShopId: { upstreamShopId, downstreamShopId },
      },
    });

    if (existing) {
      return this.prisma.downstreamSourceConnection.update({
        where: { id: existing.id },
        data: {
          apiKeyId,
          status: DownstreamSourceConnectionStatus.ACTIVE,
        },
      });
    }

    const upstreamShop = await this.prisma.shop.findUnique({
      where: { id: upstreamShopId },
      select: { defaultCurrency: true },
    });

    return this.prisma.downstreamSourceConnection.create({
      data: {
        upstreamSellerId,
        upstreamShopId,
        downstreamSellerId,
        downstreamShopId,
        apiKeyId,
        status: DownstreamSourceConnectionStatus.ACTIVE,
        currency: upstreamShop?.defaultCurrency ?? "VND",
      },
    });
  }

  async getConnectionByApiKey(apiKeyId: string) {
    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { apiKeyId },
      include: {
        upstreamSeller: true,
        upstreamShop: true,
        downstreamSeller: true,
        downstreamShop: true,
        apiKey: true,
      },
    });

    if (!connection) {
      throw new NotFoundException("No connection found for this API key.");
    }

    return connection;
  }

  async creditBalance(connectionId: string, amount: number, note?: string) {
    if (amount <= 0) {
      throw new BadRequestException("Credit amount must be positive.");
    }

    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.downstreamSourceConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection) {
        throw new NotFoundException("Connection not found.");
      }

      if (!connection.downstreamTelegramChatId) {
        throw new BadRequestException("Connection has no linked customer wallet.");
      }

      const customer = await tx.customer.findFirst({
        where: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
        include: { wallet: true },
      });

      if (!customer) {
        throw new NotFoundException("Linked customer not found.");
      }

      let wallet = customer.wallet;
      if (!wallet) {
        wallet = await tx.customerWallet.create({
          data: { customerId: customer.id, balance: toDecimal(0), balanceUsdt: toDecimal(0), currency: "VND" },
        });
      }

      await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`);

      const balanceBefore = decimalToNumber(wallet.balance);
      const balanceAfter = balanceBefore + amount;

      await tx.customerWallet.update({
        where: { id: wallet.id },
        data: { balance: toDecimal(balanceAfter) },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: customer.id,
          walletId: wallet.id,
          type: "TOPUP",
          amount: toDecimal(amount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          note: note ?? "Nạp ví từ ULTRA",
        },
      });

      const ledger = await tx.internalSourceLedger.create({
        data: {
          connectionId,
          type: InternalSourceLedgerType.TOPUP,
          amount: toDecimal(amount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          note: note ?? null,
        },
      });

      return { balanceBefore, balanceAfter, ledgerId: ledger.id };
    });
  }

  async debitBalance(connectionId: string, amount: number, referenceId: string) {
    if (amount <= 0) {
      throw new BadRequestException("Debit amount must be positive.");
    }

    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.downstreamSourceConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection) {
        throw new NotFoundException("Connection not found.");
      }

      if (!connection.downstreamTelegramChatId) {
        throw new BadRequestException("Connection has no linked customer wallet.");
      }

      const customer = await tx.customer.findFirst({
        where: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
        include: { wallet: true },
      });

      if (!customer?.wallet) {
        throw new BadRequestException("Customer wallet not found.");
      }

      await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`);

      const balanceBefore = decimalToNumber(customer.wallet.balance);

      if (balanceBefore < amount) {
        throw new BadRequestException("Insufficient balance.");
      }

      const balanceAfter = balanceBefore - amount;

      await tx.customerWallet.update({
        where: { id: customer.wallet.id },
        data: { balance: toDecimal(balanceAfter) },
      });

      await tx.downstreamSourceConnection.update({
        where: { id: connectionId },
        data: { lastOrderedAt: new Date() },
      });

      const ledger = await tx.internalSourceLedger.create({
        data: {
          connectionId,
          type: InternalSourceLedgerType.DEBIT_ORDER,
          amount: toDecimal(amount * -1),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "internal_source_order",
          referenceId,
          note: "Debit downstream source balance for order",
        },
      });

      return { balanceBefore, balanceAfter, ledgerId: ledger.id };
    });
  }

  async getBalance(connectionId: string) {
    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id: connectionId },
      select: { id: true, currency: true, updatedAt: true, upstreamShopId: true, downstreamTelegramChatId: true },
    });

    if (!connection) {
      throw new NotFoundException("Connection not found.");
    }

    let balance = 0;
    if (connection.downstreamTelegramChatId) {
      const wallet = await this.prisma.customerWallet.findFirst({
        where: {
          customer: {
            shopId: connection.upstreamShopId,
            telegramChatId: connection.downstreamTelegramChatId,
          },
        },
        select: { balance: true },
      });
      if (wallet) balance = decimalToNumber(wallet.balance);
    }

    return {
      connectionId: connection.id,
      balance,
      currency: connection.currency,
      updatedAt: connection.updatedAt,
    };
  }
}
