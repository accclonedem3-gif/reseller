import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import {
  DownstreamSourceConnectionStatus,
  InternalSourceApiKeyStatus,
  InternalSourceLedgerType,
  InternalSourceOrderStatus,
  Prisma,
  ProviderKind,
  SellerTier,
  WalletLedgerType,
} from "@prisma/client";
import {
  decryptSecret,
  encryptSecret,
  purchaseFromProvider,
} from "@reseller/shared/server";
import { randomBytes } from "node:crypto";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { decimalToNumber, generateSourceOrderCode, hashValue, splitWalletDebit, toDecimal } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import { StockAlertService } from "../source/stock-alert.service";
import type { AuthenticatedUser } from "../types";

import type {
  AdjustConnectionBalanceDto,
  ConnectInternalSourceDto,
  CreateInternalSourceApiKeyDto,
  DeliverInternalSourceOrderDto,
  FailInternalSourceOrderDto,
  InternalBuyerPurchaseDto,
  TopUpInternalSourceConnectionDto,
} from "./internal-source.dto";

type ResolvedSourceKey = Prisma.InternalSourceApiKeyGetPayload<{
  include: {
    seller: true;
    shop: true;
    connection: {
      include: {
        upstreamSeller: true;
        upstreamShop: true;
        downstreamSeller: true;
        downstreamShop: true;
      };
    };
  };
}>;

type PublishedSourceProduct = Prisma.SourceProductGetPayload<{
  include: {
    overrides: true;
  };
}>;

@Injectable()
export class InternalSourceService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(StockAlertService)
    private readonly stockAlertService: StockAlertService,
  ) {}

  async listApiKeys(user: AuthenticatedUser) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const keys = await this.prisma.internalSourceApiKey.findMany({
      where: {
        sellerId: shop.sellerId,
      },
      include: {
        connection: {
          include: {
            downstreamSeller: true,
            downstreamShop: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const walletBalanceMap = new Map<string, number>();
    for (const key of keys) {
      if (key.connection?.downstreamTelegramChatId) {
        const wallet = await this.prisma.customerWallet.findFirst({
          where: {
            customer: {
              shopId: key.connection.upstreamShopId,
              telegramChatId: key.connection.downstreamTelegramChatId,
            },
          },
          select: { balance: true },
        });
        walletBalanceMap.set(key.connection.id, wallet ? decimalToNumber(wallet.balance) : 0);
      }
    }

    return keys.map((key) => ({
      id: key.id,
      label: key.label,
      note: key.note,
      keyPrefix: key.keyPrefix,
      status: key.status.toLowerCase(),
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
      connection: key.connection
        ? {
            id: key.connection.id,
            status: key.connection.status.toLowerCase(),
            downstreamSellerId: key.connection.downstreamSellerId,
            downstreamSellerName: key.connection.downstreamSeller.displayName,
            downstreamShopId: key.connection.downstreamShopId,
            downstreamShopName: key.connection.downstreamShop.name,
            balance: walletBalanceMap.get(key.connection.id) ?? 0,
            currency: key.connection.currency,
          }
        : null,
    }));
  }

  async createApiKey(user: AuthenticatedUser, dto: CreateInternalSourceApiKeyDto) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const rawKey = `isk_${randomBytes(24).toString("hex")}`;

    const created = await this.prisma.internalSourceApiKey.create({
      data: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        label: dto.label.trim(),
        note: dto.note?.trim() || null,
        keyPrefix: rawKey.slice(0, 12),
        keyHash: hashValue(rawKey),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return {
      id: created.id,
      label: created.label,
      key: rawKey,
      keyPrefix: created.keyPrefix,
      expiresAt: created.expiresAt,
      buyerApiBaseUrl: this.getInternalBuyerBaseUrl(),
      status: created.status.toLowerCase(),
      createdAt: created.createdAt,
    };
  }

  async revokeApiKey(user: AuthenticatedUser, id: string) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const key = await this.prisma.internalSourceApiKey.findFirst({
      where: {
        id,
        sellerId: shop.sellerId,
      },
      include: {
        connection: true,
      },
    });

    if (!key) {
      throw new NotFoundException("Source API key not found.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.internalSourceApiKey.update({
        where: { id: key.id },
        data: {
          status: InternalSourceApiKeyStatus.REVOKED,
          revokedAt: new Date(),
        },
      });

      if (key.connection) {
        await tx.downstreamSourceConnection.update({
          where: { id: key.connection.id },
          data: {
            status: DownstreamSourceConnectionStatus.DISABLED,
          },
        });

        await tx.providerConfig.updateMany({
          where: {
            internalSourceConnectionId: key.connection.id,
          },
          data: {
            connectionStatus: "DISABLED",
          },
        });
      }
    });

    return {
      success: true,
      id: key.id,
    };
  }

  async getCurrentConnection(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: {
        downstreamShopId: shop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      orderBy: { createdAt: "desc" },
      include: {
        apiKey: true,
        upstreamSeller: true,
        upstreamShop: true,
        downstreamSeller: true,
        downstreamShop: true,
      },
    });

    if (!connection) {
      return null;
    }

    let walletBalance = 0;
    if (connection.downstreamTelegramChatId) {
      const wallet = await this.prisma.customerWallet.findFirst({
        where: {
          customer: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
        },
        select: { balance: true },
      });
      if (wallet) walletBalance = decimalToNumber(wallet.balance);
    }

    return this.mapConnection(connection, walletBalance);
  }

  async listDownstreamConnections(user: AuthenticatedUser) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const connections = await this.prisma.downstreamSourceConnection.findMany({
      where: {
        upstreamShopId: shop.id,
      },
      include: {
        apiKey: true,
        upstreamSeller: true,
        upstreamShop: true,
        downstreamSeller: true,
        downstreamShop: {
          include: { botConfig: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const chatIds = connections
      .map((c) => c.apiKey?.telegramChatId)
      .filter((id): id is string => !!id);

    const customers = chatIds.length > 0
      ? await this.prisma.customer.findMany({
          where: { shopId: shop.id, telegramChatId: { in: chatIds } },
          select: { telegramChatId: true, telegramUsername: true, firstName: true, lastName: true },
        })
      : [];

    const customerByChatId = new Map(customers.map((c) => [c.telegramChatId, c]));

    // Batch-fetch wallet balances for all connections
    const downstreamChatIds = connections
      .map((c) => c.downstreamTelegramChatId)
      .filter((id): id is string => !!id);

    const wallets = downstreamChatIds.length > 0
      ? await this.prisma.customerWallet.findMany({
          where: {
            customer: {
              shopId: shop.id,
              telegramChatId: { in: downstreamChatIds },
            },
          },
          include: { customer: { select: { telegramChatId: true } } },
        })
      : [];

    const walletByChatId = new Map(
      wallets.map((w) => [w.customer.telegramChatId, decimalToNumber(w.balance)]),
    );

    return connections.map((connection) => {
      const customer = connection.apiKey?.telegramChatId
        ? customerByChatId.get(connection.apiKey.telegramChatId)
        : undefined;

      const walletBalance = connection.downstreamTelegramChatId
        ? (walletByChatId.get(connection.downstreamTelegramChatId) ?? 0)
        : 0;

      return {
        ...this.mapConnection(connection, walletBalance),
        downstreamSeller: connection.downstreamSeller
          ? {
              id: connection.downstreamSeller.id,
              displayName: connection.downstreamSeller.displayName,
              telegramUsername: customer?.telegramUsername ?? null,
            }
          : null,
        downstreamShop: connection.downstreamShop
          ? {
              id: connection.downstreamShop.id,
              name: connection.downstreamShop.name,
              slug: connection.downstreamShop.slug,
              telegramBotUsername: connection.downstreamShop.botConfig?.telegramBotUsername ?? null,
            }
          : null,
      };
    });
  }

  async getConnectionLedger(user: AuthenticatedUser, connectionId: string) {
    const shop = await this.getProSellerShopOrThrow(user.id);

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: { id: connectionId, upstreamShopId: shop.id },
    });

    if (!connection) {
      throw new NotFoundException("Connection not found.");
    }

    const ledger = await this.prisma.internalSourceLedger.findMany({
      where: { connectionId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return ledger.map((entry) => ({
      id: entry.id,
      type: entry.type.toLowerCase(),
      amount: decimalToNumber(entry.amount),
      balanceBefore: decimalToNumber(entry.balanceBefore),
      balanceAfter: decimalToNumber(entry.balanceAfter),
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      note: entry.note,
      createdAt: entry.createdAt,
    }));
  }

  async manualAdjustConnectionBalance(
    user: AuthenticatedUser,
    connectionId: string,
    dto: AdjustConnectionBalanceDto,
  ) {
    const shop = await this.getProSellerShopOrThrow(user.id);

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: { id: connectionId, upstreamShopId: shop.id },
    });

    if (!connection) {
      throw new NotFoundException("Connection not found.");
    }

    if (!connection.downstreamTelegramChatId) {
      throw new BadRequestException("Connection has no linked customer wallet to adjust.");
    }

    await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId! },
        include: { wallet: true },
      });

      if (!customer) {
        throw new NotFoundException("Linked customer not found.");
      }

      let cWallet = customer.wallet;
      if (!cWallet) {
        cWallet = await tx.customerWallet.create({
          data: { customerId: customer.id, balance: toDecimal(0), balanceUsdt: toDecimal(0), currency: "VND" },
        });
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${cWallet.id} FOR UPDATE`,
      );

      const balanceBefore = decimalToNumber(cWallet.balance);
      let balanceAfter: number;
      let adjustAmount: number;

      if (dto.action === "topup") {
        adjustAmount = dto.amount;
        balanceAfter = balanceBefore + dto.amount;
      } else if (dto.action === "deduct") {
        adjustAmount = -dto.amount;
        balanceAfter = Math.max(0, balanceBefore - dto.amount);
      } else {
        adjustAmount = dto.amount - balanceBefore;
        balanceAfter = dto.amount;
      }

      await tx.customerWallet.update({
        where: { id: cWallet.id },
        data: { balance: toDecimal(balanceAfter) },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: customer.id,
          walletId: cWallet.id,
          type: adjustAmount >= 0 ? "TOPUP" : "SPEND_ORDER",
          amount: toDecimal(adjustAmount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "manual_adjust",
          referenceId: user.id,
          note: dto.note?.trim() || "Manual balance adjustment by source owner",
        },
      });

      await tx.internalSourceLedger.create({
        data: {
          connectionId: connection.id,
          type: InternalSourceLedgerType.ADJUST,
          amount: toDecimal(adjustAmount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "manual_adjust",
          referenceId: user.id,
          note: dto.note?.trim() || "Manual balance adjustment by source owner",
        },
      });
    });

    return this.getCurrentConnectionById(connection.id);
  }

  async listSourceOrders(user: AuthenticatedUser, status?: string) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const orders = await this.prisma.internalSourceOrder.findMany({
      where: {
        upstreamShopId: shop.id,
        status: status
          ? (String(status || "").trim().toUpperCase() as InternalSourceOrderStatus)
          : undefined,
      },
      include: {
        connection: true,
        downstreamSeller: true,
        downstreamShop: true,
        sourceProduct: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return orders.map((order) => this.mapSourceOrder(order));
  }

  async connectDownstreamShop(
    user: AuthenticatedUser,
    dto: ConnectInternalSourceDto,
  ) {
    const downstreamShop = await this.shopsService.getSellerShop(user.id);
    const resolvedKey = await this.resolveApiKey(dto.apiKey);

    if (resolvedKey.seller.tier !== SellerTier.ULTRA) {
      throw new ForbiddenException("Only PRO sellers can publish internal source keys.");
    }

    this.assertApiKeyUsable(resolvedKey);

    if (
      resolvedKey.connection &&
      resolvedKey.connection.downstreamShopId !== downstreamShop.id
    ) {
      throw new BadRequestException("This source key is already assigned to another downstream shop.");
    }

    if (resolvedKey.shop.id === downstreamShop.id) {
      throw new BadRequestException("You cannot connect your shop to its own internal source key.");
    }

    const connection = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.downstreamSourceConnection.findUnique({
        where: {
          upstreamShopId_downstreamShopId: {
            upstreamShopId: resolvedKey.shop.id,
            downstreamShopId: downstreamShop.id,
          },
        },
      });

      const nextConnection = existing
        ? await tx.downstreamSourceConnection.update({
            where: { id: existing.id },
            data: {
              apiKeyId: resolvedKey.id,
              status: DownstreamSourceConnectionStatus.ACTIVE,
            },
          })
        : await tx.downstreamSourceConnection.create({
            data: {
              upstreamSellerId: resolvedKey.sellerId,
              upstreamShopId: resolvedKey.shopId,
              downstreamSellerId: downstreamShop.sellerId,
              downstreamShopId: downstreamShop.id,
              apiKeyId: resolvedKey.id,
              status: DownstreamSourceConnectionStatus.ACTIVE,
              currency: downstreamShop.defaultCurrency,
            },
          });

      await tx.providerConfig.upsert({
        where: { shopId: downstreamShop.id },
        update: {
          providerKind: ProviderKind.INTERNAL,
          providerName: "internal_pro",
          baseUrl: this.getInternalBuyerBaseUrl(),
          buyerKeyEncrypted: encryptSecret(dto.apiKey.trim(), this.config.encryptionKey),
          internalSourceConnectionId: nextConnection.id,
          connectionStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
        },
        create: {
          shopId: downstreamShop.id,
          providerKind: ProviderKind.INTERNAL,
          providerName: "internal_pro",
          baseUrl: this.getInternalBuyerBaseUrl(),
          buyerKeyEncrypted: encryptSecret(dto.apiKey.trim(), this.config.encryptionKey),
          internalSourceConnectionId: nextConnection.id,
          sourceNotificationSyncEnabled: true,
          connectionStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
        },
      });

      return nextConnection;
    });

    return this.getCurrentConnectionById(connection.id);
  }

  async topUpCurrentConnection(
    user: AuthenticatedUser,
    dto: TopUpInternalSourceConnectionDto,
  ) {
    const downstreamShop = await this.shopsService.getSellerShop(user.id);
    const amount = Number(dto.amount);

    if (!Number.isInteger(amount) || amount < 1000) {
      throw new BadRequestException("Top-up amount must be at least 1,000 VND.");
    }

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: {
        downstreamShopId: downstreamShop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!connection) {
      throw new NotFoundException("No internal source connection found for this shop.");
    }

    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.sellerWallet.findUnique({
        where: {
          sellerId: downstreamShop.sellerId,
        },
      });

      if (!wallet) {
        throw new NotFoundException("Seller wallet not found.");
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM downstream_source_connections WHERE id = ${connection.id} FOR UPDATE`,
      );

      const balanceBeforeWallet = decimalToNumber(wallet.balance);

      if (balanceBeforeWallet < amount) {
        throw new BadRequestException("Seller wallet balance is not enough for this source top-up.");
      }

      const refreshedConnection = await tx.downstreamSourceConnection.findUnique({
        where: { id: connection.id },
      });

      if (!refreshedConnection) {
        throw new NotFoundException("Internal source connection not found.");
      }

      const walletBalanceAfter = balanceBeforeWallet - amount;

      await tx.sellerWallet.update({
        where: { id: wallet.id },
        data: {
          balance: toDecimal(walletBalanceAfter),
        },
      });

      await tx.walletLedger.create({
        data: {
          sellerId: downstreamShop.sellerId,
          walletId: wallet.id,
          type: WalletLedgerType.ADJUST,
          amount: toDecimal(amount * -1),
          balanceBefore: toDecimal(balanceBeforeWallet),
          balanceAfter: toDecimal(walletBalanceAfter),
          referenceType: "internal_source_connection",
          referenceId: connection.id,
          note: "Top up internal PRO source balance from seller wallet",
        },
      });

      // Credit customer wallet (source of truth)
      let customerWalletBefore = 0;
      let customerWalletAfter = 0;
      if (refreshedConnection.downstreamTelegramChatId) {
        const customer = await tx.customer.findFirst({
          where: { shopId: refreshedConnection.upstreamShopId, telegramChatId: refreshedConnection.downstreamTelegramChatId },
          include: { wallet: true },
        });
        if (customer) {
          let cWallet = customer.wallet;
          if (!cWallet) {
            cWallet = await tx.customerWallet.create({
              data: { customerId: customer.id, balance: toDecimal(0), balanceUsdt: toDecimal(0), currency: "VND" },
            });
          }
          await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${cWallet.id} FOR UPDATE`);
          customerWalletBefore = decimalToNumber(cWallet.balance);
          customerWalletAfter = customerWalletBefore + amount;
          await tx.customerWallet.update({
            where: { id: cWallet.id },
            data: { balance: toDecimal(customerWalletAfter) },
          });
          await tx.customerWalletLedger.create({
            data: {
              customerId: customer.id,
              walletId: cWallet.id,
              type: "TOPUP",
              amount: toDecimal(amount),
              balanceBefore: toDecimal(customerWalletBefore),
              balanceAfter: toDecimal(customerWalletAfter),
              referenceType: "seller_wallet",
              referenceId: wallet.id,
              note: "Nạp ví từ seller wallet (bot nguồn PRO)",
            },
          });
        }
      }

      await tx.downstreamSourceConnection.update({
        where: { id: connection.id },
        data: {
          status: DownstreamSourceConnectionStatus.ACTIVE,
        },
      });

      await tx.internalSourceLedger.create({
        data: {
          connectionId: connection.id,
          type: InternalSourceLedgerType.TOPUP,
          amount: toDecimal(amount),
          balanceBefore: toDecimal(customerWalletBefore),
          balanceAfter: toDecimal(customerWalletAfter),
          referenceType: "seller_wallet",
          referenceId: wallet.id,
          note: "Top up from downstream seller wallet",
        },
      });
    });

    return this.getCurrentConnection(user);
  }

  async manualDeliverSourceOrder(
    user: AuthenticatedUser,
    id: string,
    dto: DeliverInternalSourceOrderDto,
  ) {
    const order = await this.getManagedSourceOrder(user.id, id);

    if (order.status === InternalSourceOrderStatus.DELIVERED) {
      throw new BadRequestException("Source order is already delivered.");
    }

    if (
      order.status === InternalSourceOrderStatus.FAILED ||
      order.status === InternalSourceOrderStatus.CANCELED
    ) {
      throw new BadRequestException("Source order is already closed.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.internalSourceOrder.update({
        where: { id: order.id },
        data: {
          status: InternalSourceOrderStatus.DELIVERED,
          deliveredAccountText: dto.deliveredAccountText.trim(),
          deliveredAt: new Date(),
          failureReason: null,
        },
      });

      await tx.internalSourceOrderEvent.create({
        data: {
          orderId: order.id,
          eventType: "manual_delivery_by_owner",
          payloadJson: {
            deliveredLength: dto.deliveredAccountText.trim().length,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return this.getSourceOrderById(id);
  }

  async markSourceOrderFailed(
    user: AuthenticatedUser,
    id: string,
    dto: FailInternalSourceOrderDto,
  ) {
    const order = await this.getManagedSourceOrder(user.id, id);

    if (order.status === InternalSourceOrderStatus.DELIVERED) {
      throw new BadRequestException("Delivered source orders cannot be failed.");
    }

    await this.failInternalSourceOrder(
      {
        id: order.id,
        connectionId: order.connectionId,
        totalAmount: order.totalAmount,
      },
      dto.reason.trim(),
      true,
    );

    return this.getSourceOrderById(id);
  }

  async listProductsByKey(rawKey: string, requestMeta?: {
    path?: string;
    method?: string;
    ipAddress?: string | null;
  }) {
    const resolvedKey = await this.resolveApiKey(rawKey);
    const connection = this.assertApiKeyUsable(resolvedKey);
    const products = await this.prisma.sourceProduct.findMany({
      where: {
        shopId: connection.upstreamShopId,
        internalSourceEnabled: true,
        OR: [
          { available: null },
          { available: { gt: 0 } },
        ],
      },
      include: {
        overrides: {
          where: {
            sellerId: connection.upstreamSellerId,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const customerDiscount = connection.downstreamTelegramChatId
      ? await this.prisma.customer.findFirst({
          where: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
          select: { discountPercent: true },
        }).then((c) => Number(c?.discountPercent ?? 0))
      : 0;

    const response = {
      success: true,
      products: products.map((product) =>
        this.mapPublishedProduct(product, connection.upstreamSellerId, customerDiscount),
      ),
    };

    await this.prisma.downstreamSourceConnection.update({
      where: { id: connection.id },
      data: {
        lastCatalogSyncAt: new Date(),
      },
    });

    await this.recordAccessLog(resolvedKey, requestMeta, 200, undefined, response);

    return response;
  }

  async getBalanceByKey(rawKey: string, requestMeta?: {
    path?: string;
    method?: string;
    ipAddress?: string | null;
  }) {
    const resolvedKey = await this.resolveApiKey(rawKey);
    const connection = this.assertApiKeyUsable(resolvedKey);
    let walletBalance = 0;
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
      if (wallet) walletBalance = decimalToNumber(wallet.balance);
    }
    const response = {
      success: true,
      balance: walletBalance,
      balanceVnd: walletBalance,
      balanceUsd: null,
      balanceText: `${walletBalance} ${connection.currency}`,
      walletCurrency: connection.currency,
      usdtBalance: 0,
      updatedAt: connection.updatedAt.toISOString(),
      requester: {
        name: connection.downstreamSeller.displayName,
        chatId: connection.id,
      },
      botSource: "internal_pro",
    };

    await this.recordAccessLog(resolvedKey, requestMeta, 200, undefined, response);

    return response;
  }

  async createOrderByKey(
    payload: InternalBuyerPurchaseDto,
    requestMeta?: {
      path?: string;
      method?: string;
      ipAddress?: string | null;
    },
  ) {
    const resolvedKey = await this.resolveApiKey(payload.key);
    const connection = this.assertApiKeyUsable(resolvedKey);
    const quantity = Number(payload.quantity);
    const product = await this.prisma.sourceProduct.findFirst({
      where: {
        id: payload.product_id,
        shopId: connection.upstreamShopId,
        internalSourceEnabled: true,
      },
      include: {
        overrides: {
          where: {
            sellerId: connection.upstreamSellerId,
          },
        },
      },
    });

    if (!product) {
      const errorResponse = {
        success: false,
        message: "Source product not found or not published.",
      };
      await this.recordAccessLog(resolvedKey, requestMeta, 404, payload, errorResponse);
      return errorResponse;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      const errorResponse = {
        success: false,
        message: "Quantity must be a positive integer.",
      };
      await this.recordAccessLog(resolvedKey, requestMeta, 400, payload, errorResponse);
      return errorResponse;
    }

    const unitPrice = decimalToNumber(product.internalSourcePrice || product.sourcePrice);
    const totalAmount = unitPrice * quantity;
    let createdOrderId = "";

    try {
      const created = await this.prisma.$transaction(async (tx) => {
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

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`,
        );

        const currentConnection = await tx.downstreamSourceConnection.findUnique({
          where: { id: connection.id },
          select: { id: true, status: true },
        });

        if (!currentConnection) {
          throw new NotFoundException("Internal source connection not found.");
        }

        const balanceBefore = decimalToNumber(customer.wallet.balance);
        const commissionBefore = decimalToNumber(customer.wallet.commissionBalance);

        if (balanceBefore + commissionBefore < totalAmount) {
          throw new BadRequestException("Downstream source balance is not enough.");
        }

        const split = splitWalletDebit(commissionBefore, balanceBefore, totalAmount);
        const balanceAfter = split.balanceAfter;
        const commissionAfter = split.commissionAfter;
        const sourceOrderCode = generateSourceOrderCode();
        const order = await tx.internalSourceOrder.create({
          data: {
            connectionId: connection.id,
            apiKeyId: resolvedKey.id,
            upstreamSellerId: connection.upstreamSellerId,
            upstreamShopId: connection.upstreamShopId,
            downstreamSellerId: connection.downstreamSellerId,
            downstreamShopId: connection.downstreamShopId,
            sourceProductId: product.id,
            sourceOrderCode,
            downstreamOrderCode: payload.client_order_code || null,
            quantity,
            unitPrice: toDecimal(unitPrice),
            sourcePriceSnapshot: product.sourcePrice,
            totalAmount: toDecimal(totalAmount),
            status: InternalSourceOrderStatus.PROCESSING,
            metadataJson: {
              customerEmail: payload.customer_email || null,
              slotMonths: payload.slot_months || null,
            } as Prisma.InputJsonValue,
          },
        });

        await tx.customerWallet.update({
          where: { id: customer.wallet.id },
          data: { balance: toDecimal(balanceAfter), commissionBalance: toDecimal(commissionAfter) },
        });

        await tx.customerWalletLedger.create({
          data: {
            customerId: customer.id,
            walletId: customer.wallet.id,
            type: "SPEND_ORDER",
            amount: toDecimal(totalAmount * -1),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            commissionBalanceBefore: toDecimal(commissionBefore),
            commissionBalanceAfter: toDecimal(commissionAfter),
            referenceType: "internal_source_order",
            referenceId: order.id,
            note: "Trừ số dư ví khi đặt hàng qua bot nguồn",
          },
        });

        await tx.downstreamSourceConnection.update({
          where: { id: connection.id },
          data: {
            status: DownstreamSourceConnectionStatus.ACTIVE,
            lastOrderedAt: new Date(),
          },
        });

        await tx.internalSourceLedger.create({
          data: {
            connectionId: connection.id,
            type: InternalSourceLedgerType.DEBIT_ORDER,
            amount: toDecimal(totalAmount * -1),
            balanceBefore: toDecimal(balanceBefore + commissionBefore),
            balanceAfter: toDecimal(balanceAfter + commissionAfter),
            referenceType: "internal_source_order",
            referenceId: order.id,
            note: "Debit downstream source balance for internal PRO order",
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: order.id,
            eventType: "order_created",
            payloadJson: {
              productId: product.id,
              quantity,
              totalAmount,
              downstreamOrderCode: payload.client_order_code || null,
            } as Prisma.InputJsonValue,
          },
        });

        return order;
      });

      createdOrderId = created.id;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not create internal source order.";
      const errorResponse = {
        success: false,
        message,
      };
      await this.recordAccessLog(resolvedKey, requestMeta, 400, payload, errorResponse);
      return errorResponse;
    }

    const result = await this.fulfillInternalSourceOrder(createdOrderId);
    await this.recordAccessLog(
      resolvedKey,
      requestMeta,
      result.success ? 200 : result.outOfStock || result.pending ? 409 : 422,
      payload,
      result.rawResponse,
    );

    return result.rawResponse;
  }

  async getOrderStatusByKey(
    rawKey: string,
    identifier: {
      orderId?: string;
      orderCode?: string;
    },
    requestMeta?: {
      path?: string;
      method?: string;
      ipAddress?: string | null;
    },
  ) {
    if (!identifier.orderId && !identifier.orderCode) {
      throw new BadRequestException("order_id or order_code is required.");
    }

    const resolvedKey = await this.resolveApiKey(rawKey);
    const connection = this.assertApiKeyUsable(resolvedKey);
    const order = await this.prisma.internalSourceOrder.findFirst({
      where: {
        connectionId: connection.id,
        id: identifier.orderId || undefined,
        sourceOrderCode: identifier.orderCode || undefined,
      },
    });

    if (!order) {
      const errorResponse = {
        success: false,
        message: "Source order not found.",
      };
      await this.recordAccessLog(resolvedKey, requestMeta, 404, identifier, errorResponse);
      return errorResponse;
    }

    const response = {
      success: true,
      order: {
        id: order.id,
        orderCode: order.sourceOrderCode,
        status: order.status.toLowerCase(),
        quantity: order.quantity,
        totalAmount: decimalToNumber(order.totalAmount),
        deliveredText: order.deliveredAccountText,
        failureReason: order.failureReason,
        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
      },
    };

    await this.recordAccessLog(resolvedKey, requestMeta, 200, identifier, response);

    return response;
  }

  async fulfillInternalSourceOrder(orderId: string) {
    const order = await this.prisma.internalSourceOrder.findUnique({
      where: { id: orderId },
      include: {
        connection: true,
        apiKey: true,
        upstreamShop: {
          include: {
            providerConfig: true,
          },
        },
        sourceProduct: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Internal source order not found.");
    }

    const sourceMetadata = this.asRecord(order.sourceProduct.metadataJson);
    const deliveryEntries = this.readManualDeliveryEntries(sourceMetadata);
    const isManualProduct = this.isManualProduct(order.sourceProduct);

    if (isManualProduct) {
      if (deliveryEntries.length >= order.quantity) {
        const deliveredEntries = deliveryEntries.slice(0, order.quantity);
        const remainingEntries = deliveryEntries.slice(order.quantity);
        const deliveredText = deliveredEntries.join("\n\n");

        await this.prisma.$transaction(async (tx) => {
          await tx.internalSourceOrder.update({
            where: { id: order.id },
            data: {
              status: InternalSourceOrderStatus.DELIVERED,
              deliveredAccountText: deliveredText,
              deliveredAt: new Date(),
            },
          });

          await tx.internalSourceOrderEvent.create({
            data: {
              orderId: order.id,
              eventType: "manual_stock_delivered",
              payloadJson: {
                deliveredCount: deliveredEntries.length,
              } as Prisma.InputJsonValue,
            },
          });

          await tx.sourceProduct.update({
            where: { id: order.sourceProductId },
            data: {
              soldCount: {
                increment: order.quantity,
              },
              available: remainingEntries.length,
              metadataJson: {
                ...sourceMetadata,
                manual: true,
                deliveryEntries: remainingEntries,
                deliveryText: this.normalizeManualDeliveryText(
                  remainingEntries.join("\n\n"),
                ),
              } as Prisma.InputJsonValue,
            },
          });
        });

        void this.stockAlertService.checkAndAlert(order.sourceProductId);
        return {
          success: true,
          outOfStock: false,
          pending: false,
          rawResponse: {
            success: true,
            orderId: order.id,
            orderCode: order.sourceOrderCode,
            deliveredText,
          },
        };
      }

      const nextStatus =
        deliveryEntries.length > 0
          ? InternalSourceOrderStatus.PENDING_STOCK
          : InternalSourceOrderStatus.PENDING_MANUAL;
      const message =
        nextStatus === InternalSourceOrderStatus.PENDING_STOCK
          ? "Replacement stock is not enough right now."
          : "This source product is waiting for manual processing.";

      await this.prisma.$transaction(async (tx) => {
        await tx.internalSourceOrder.update({
          where: { id: order.id },
          data: {
            status: nextStatus,
            failureReason: message,
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: order.id,
            eventType: "manual_pending",
            payloadJson: {
              reason: message,
              availableEntries: deliveryEntries.length,
            } as Prisma.InputJsonValue,
          },
        });
      });

      return {
        success: false,
        outOfStock: nextStatus === InternalSourceOrderStatus.PENDING_STOCK,
        pending: true,
        rawResponse: {
          success: false,
          pending: true,
          orderId: order.id,
          orderCode: order.sourceOrderCode,
          message,
        },
      };
    }

    const providerConfig = order.upstreamShop.providerConfig;
    const buyerKey = decryptSecret(
      providerConfig?.buyerKeyEncrypted,
      this.config.encryptionKey,
    );

    if (!providerConfig || !buyerKey) {
      await this.failInternalSourceOrder(order, "Upstream provider config is missing.", true);
      return {
        success: false,
        outOfStock: false,
        pending: false,
        rawResponse: {
          success: false,
          orderId: order.id,
          orderCode: order.sourceOrderCode,
          message: "Upstream provider config is missing.",
        },
      };
    }

    const purchaseResult = await purchaseFromProvider(
      {
        baseUrl: providerConfig.baseUrl,
        buyerKey,
        providerName: providerConfig.providerName,
      },
      {
        productId: order.sourceProduct.externalProductId,
        quantity: order.quantity,
        clientOrderCode: order.sourceOrderCode,
      },
    );

    if (purchaseResult.success && purchaseResult.deliveredText) {
      await this.prisma.$transaction(async (tx) => {
        await tx.internalSourceOrder.update({
          where: { id: order.id },
          data: {
            status: InternalSourceOrderStatus.DELIVERED,
            deliveredAccountText: purchaseResult.deliveredText,
            deliveredAt: new Date(),
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: order.id,
            eventType: "upstream_purchase_success",
            payloadJson: {
              providerOrderId: purchaseResult.providerOrderId,
              providerOrderCode: purchaseResult.providerOrderCode,
            } as Prisma.InputJsonValue,
          },
        });

        await tx.sourceProduct.update({
          where: { id: order.sourceProductId },
          data: {
            soldCount: {
              increment: order.quantity,
            },
            available:
              order.sourceProduct.available === null
                ? undefined
                : {
                    decrement: order.quantity,
                  },
          },
        });
      });

      void this.stockAlertService.checkAndAlert(order.sourceProductId);
      return {
        success: true,
        outOfStock: false,
        pending: false,
        rawResponse: {
          success: true,
          orderId: order.id,
          orderCode: order.sourceOrderCode,
          deliveredText: purchaseResult.deliveredText,
          upstreamOrderId: purchaseResult.providerOrderId,
          upstreamOrderCode: purchaseResult.providerOrderCode,
        },
      };
    }

    if (purchaseResult.outOfStock || purchaseResult.pending) {
      await this.prisma.$transaction(async (tx) => {
        await tx.internalSourceOrder.update({
          where: { id: order.id },
          data: {
            status: InternalSourceOrderStatus.PENDING_STOCK,
            failureReason: purchaseResult.message || "Source stock is not enough right now.",
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: order.id,
            eventType: "upstream_out_of_stock",
            payloadJson: {
              message: purchaseResult.message || null,
            } as Prisma.InputJsonValue,
          },
        });
      });

      return {
        success: false,
        outOfStock: true,
        pending: true,
        rawResponse: {
          success: false,
          pending: true,
          orderId: order.id,
          orderCode: order.sourceOrderCode,
          message: purchaseResult.message || "Source stock is not enough right now.",
        },
      };
    }

    await this.failInternalSourceOrder(
      order,
      purchaseResult.message || "Internal source purchase failed.",
      true,
    );

    return {
      success: false,
      outOfStock: false,
      pending: false,
      rawResponse: {
        success: false,
        orderId: order.id,
        orderCode: order.sourceOrderCode,
        message: purchaseResult.message || "Internal source purchase failed.",
      },
    };
  }

  private async failInternalSourceOrder(
    order: {
      id: string;
      connectionId: string;
      totalAmount: Prisma.Decimal;
    },
    reason: string,
    refundBalance: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.internalSourceOrder.update({
        where: { id: order.id },
        data: {
          status: InternalSourceOrderStatus.FAILED,
          failureReason: reason,
        },
      });

      await tx.internalSourceOrderEvent.create({
        data: {
          orderId: order.id,
          eventType: "order_failed",
          payloadJson: {
            reason,
          } as Prisma.InputJsonValue,
        },
      });

      if (!refundBalance) {
        return;
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM downstream_source_connections WHERE id = ${order.connectionId} FOR UPDATE`,
      );

      const connection = await tx.downstreamSourceConnection.findUnique({
        where: { id: order.connectionId },
      });

      if (!connection) {
        return;
      }

      const refundAmount = decimalToNumber(order.totalAmount);
      let walletBefore = 0;
      let walletAfter = 0;

      if (connection.downstreamTelegramChatId) {
        const customer = await tx.customer.findFirst({
          where: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
          include: { wallet: true },
        });
        if (customer) {
          let cWallet = customer.wallet;
          if (!cWallet) {
            cWallet = await tx.customerWallet.create({
              data: { customerId: customer.id, balance: toDecimal(0), balanceUsdt: toDecimal(0), currency: "VND" },
            });
          }
          await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${cWallet.id} FOR UPDATE`);
          walletBefore = decimalToNumber(cWallet.balance);
          walletAfter = walletBefore + refundAmount;
          await tx.customerWallet.update({
            where: { id: cWallet.id },
            data: { balance: toDecimal(walletAfter) },
          });
          await tx.customerWalletLedger.create({
            data: {
              customerId: customer.id,
              walletId: cWallet.id,
              type: "TOPUP",
              amount: toDecimal(refundAmount),
              balanceBefore: toDecimal(walletBefore),
              balanceAfter: toDecimal(walletAfter),
              referenceType: "internal_source_order",
              referenceId: order.id,
              note: reason ?? "Hoàn tiền đơn nguồn",
            },
          });
        }
      }

      await tx.internalSourceLedger.create({
        data: {
          connectionId: connection.id,
          type: InternalSourceLedgerType.REFUND_ORDER,
          amount: toDecimal(refundAmount),
          balanceBefore: toDecimal(walletBefore),
          balanceAfter: toDecimal(walletAfter),
          referenceType: "internal_source_order",
          referenceId: order.id,
          note: reason,
        },
      });
    });
  }

  private mapPublishedProduct(
    product: PublishedSourceProduct,
    sellerId: string,
    discountPercent = 0,
  ) {
    const override = product.overrides.find((item) => item.sellerId === sellerId);
    const displayName = override?.displayName || product.sourceName;
    const basePrice = decimalToNumber(product.internalSourcePrice || product.sourcePrice);
    const wholesalePrice = discountPercent > 0
      ? Math.round(basePrice * (1 - discountPercent / 100))
      : basePrice;

    return {
      _id: product.id,
      id: product.id,
      product_name: displayName,
      product_name_raw: product.sourceRawName || displayName,
      description: product.sourceDescription || "",
      walletPricing: wholesalePrice,
      pricing: wholesalePrice,
      sourcePrice: wholesalePrice,
      stats: {
        available: product.available,
      },
      available: product.available,
      isSlotProduct: false,
      requiresCustomerEmail: false,
      requiresSlotMonths: false,
      slotDurations: [],
      quantityFixed: 1,
      walletCurrency: "VND",
      productFamily: product.productFamily?.toLowerCase() || null,
      productFamilyOther: product.productFamilyOther || null,
      accountType: product.accountType?.toLowerCase() || null,
      accountTypeOther: product.accountTypeOther || null,
      durationType: product.durationType?.toLowerCase() || null,
      durationTypeOther: product.durationTypeOther || null,
      deliveryMode: product.sourceDeliveryMode?.toLowerCase() || null,
      warrantyPolicy: product.warrantyPolicy?.toLowerCase() || null,
      internalSourceEnabled: product.internalSourceEnabled,
      sourceDeliveryMode: product.sourceDeliveryMode?.toLowerCase() || null,
      providerName: "internal_pro",
    };
  }

  private async getManagedSourceOrder(userId: string, orderId: string) {
    const shop = await this.getProSellerShopOrThrow(userId);
    const order = await this.prisma.internalSourceOrder.findFirst({
      where: {
        id: orderId,
        upstreamShopId: shop.id,
      },
      include: {
        connection: true,
        downstreamSeller: true,
        downstreamShop: true,
        sourceProduct: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Source order not found.");
    }

    return order;
  }

  private async getSourceOrderById(id: string) {
    const order = await this.prisma.internalSourceOrder.findUnique({
      where: { id },
      include: {
        connection: true,
        downstreamSeller: true,
        downstreamShop: true,
        sourceProduct: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Source order not found.");
    }

    return this.mapSourceOrder(order);
  }

  private mapSourceOrder(
    order: Prisma.InternalSourceOrderGetPayload<{
      include: {
        connection: true;
        downstreamSeller: true;
        downstreamShop: true;
        sourceProduct: true;
      };
    }>,
  ) {
    return {
      id: order.id,
      orderCode: order.sourceOrderCode,
      downstreamOrderCode: order.downstreamOrderCode,
      status: order.status.toLowerCase(),
      quantity: order.quantity,
      unitPrice: decimalToNumber(order.unitPrice),
      totalAmount: decimalToNumber(order.totalAmount),
      deliveredAccountText: order.deliveredAccountText,
      failureReason: order.failureReason,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt,
      product: {
        id: order.sourceProduct.id,
        sourceName: order.sourceProduct.sourceName,
        providerName: order.sourceProduct.providerName,
      },
      downstreamSeller: {
        id: order.downstreamSeller.id,
        displayName: order.downstreamSeller.displayName,
      },
      downstreamShop: {
        id: order.downstreamShop.id,
        name: order.downstreamShop.name,
        slug: order.downstreamShop.slug,
      },
      connection: {
        id: order.connection.id,
        currency: order.connection.currency,
      },
    };
  }

  private async resolveApiKey(rawKey: string): Promise<ResolvedSourceKey> {
    const normalizedKey = String(rawKey || "").trim();

    if (!normalizedKey) {
      throw new BadRequestException("Source API key is missing.");
    }

    const include = {
      seller: true,
      shop: true,
      connection: {
        include: {
          upstreamSeller: true,
          upstreamShop: true,
          downstreamSeller: true,
          downstreamShop: true,
        },
      },
    } as const;

    const sha256Match = await this.prisma.internalSourceApiKey.findFirst({
      where: { keyHash: hashValue(normalizedKey) },
      include,
    });

    if (sha256Match) {
      return sha256Match;
    }

    const keyPrefix = normalizedKey.slice(0, 12);
    const candidates = await this.prisma.internalSourceApiKey.findMany({
      where: { keyPrefix },
      include,
    });

    for (const candidate of candidates) {
      if (await bcrypt.compare(normalizedKey, candidate.keyHash)) {
        return candidate;
      }
    }

    throw new ForbiddenException("Source API key is invalid.");
  }

  private assertApiKeyUsable(resolvedKey: ResolvedSourceKey) {
    if (resolvedKey.status !== InternalSourceApiKeyStatus.ACTIVE) {
      throw new ForbiddenException("Source API key is no longer active.");
    }

    if (resolvedKey.expiresAt && resolvedKey.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException("Source API key has expired.");
    }

    if (!resolvedKey.connection) {
      throw new ForbiddenException("Source API key is not assigned to a downstream connection yet.");
    }

    if (resolvedKey.connection.status !== DownstreamSourceConnectionStatus.ACTIVE) {
      throw new ForbiddenException("Downstream connection is not active.");
    }

    return resolvedKey.connection;
  }

  private async getProSellerShopOrThrow(userId: string) {
    const shop = await this.shopsService.getSellerShop(userId);
    const seller = await this.prisma.seller.findUnique({
      where: {
        id: shop.sellerId,
      },
      select: {
        tier: true,
      },
    });

    if (seller?.tier !== SellerTier.ULTRA) {
      throw new ForbiddenException("This action is only available for PRO sellers.");
    }

    return shop;
  }

  private getInternalBuyerBaseUrl() {
    return `${String(this.config.appPublicUrl || "").replace(/\/$/, "")}/api/v1`;
  }

  private async getCurrentConnectionById(id: string) {
    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id },
      include: {
        apiKey: true,
        upstreamSeller: true,
        upstreamShop: true,
        downstreamSeller: true,
        downstreamShop: true,
      },
    });

    if (!connection) {
      throw new NotFoundException("Internal source connection not found.");
    }

    let walletBalance = 0;
    if (connection.downstreamTelegramChatId) {
      const wallet = await this.prisma.customerWallet.findFirst({
        where: {
          customer: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
        },
        select: { balance: true },
      });
      if (wallet) walletBalance = decimalToNumber(wallet.balance);
    }

    return this.mapConnection(connection, walletBalance);
  }

  private mapConnection(
    connection: Prisma.DownstreamSourceConnectionGetPayload<{
      include: {
        apiKey: true;
        upstreamSeller: true;
        upstreamShop: true;
        downstreamSeller?: true;
        downstreamShop?: true;
      };
    }>,
    walletBalance = 0,
  ) {
    return {
      id: connection.id,
      status: connection.status.toLowerCase(),
      label: connection.label,
      balance: walletBalance,
      currency: connection.currency,
      lastCatalogSyncAt: connection.lastCatalogSyncAt,
      lastOrderedAt: connection.lastOrderedAt,
      buyerApiBaseUrl: this.getInternalBuyerBaseUrl(),
      apiKey: connection.apiKey
        ? {
            id: connection.apiKey.id,
            label: connection.apiKey.label,
            keyPrefix: connection.apiKey.keyPrefix,
            keySuffix: (() => {
              try {
                const raw = decryptSecret(connection.apiKey.keyEncrypted!, this.config.encryptionKey);
                return raw.slice(-4);
              } catch {
                return null;
              }
            })(),
            status: connection.apiKey.status.toLowerCase(),
            expiresAt: connection.apiKey.expiresAt,
            lastUsedAt: connection.apiKey.lastUsedAt,
          }
        : null,
      upstreamSeller: {
        id: connection.upstreamSeller.id,
        displayName: connection.upstreamSeller.displayName,
        tier: connection.upstreamSeller.tier.toLowerCase(),
      },
      upstreamShop: {
        id: connection.upstreamShop.id,
        name: connection.upstreamShop.name,
        slug: connection.upstreamShop.slug,
      },
      downstreamSeller:
        "downstreamSeller" in connection && connection.downstreamSeller
          ? {
              id: connection.downstreamSeller.id,
              displayName: connection.downstreamSeller.displayName,
            }
          : null,
      downstreamShop:
        "downstreamShop" in connection && connection.downstreamShop
          ? {
              id: connection.downstreamShop.id,
              name: connection.downstreamShop.name,
              slug: connection.downstreamShop.slug,
              telegramBotUsername:
                "botConfig" in connection.downstreamShop && connection.downstreamShop.botConfig
                  ? (connection.downstreamShop.botConfig as any).telegramBotUsername ?? null
                  : null,
            }
          : null,
    };
  }

  private async recordAccessLog(
    resolvedKey: ResolvedSourceKey,
    requestMeta:
      | {
          path?: string;
          method?: string;
          ipAddress?: string | null;
        }
      | undefined,
    statusCode: number,
    requestBody?: unknown,
    responseBody?: unknown,
  ) {
    await this.prisma.internalSourceAccessLog.create({
      data: {
        apiKeyId: resolvedKey.id,
        connectionId: resolvedKey.connection?.id || null,
        method: String(requestMeta?.method || "GET"),
        path: String(requestMeta?.path || "/telegram-buyer"),
        statusCode,
        ipAddress: requestMeta?.ipAddress || null,
        requestBodyJson: (requestBody || null) as Prisma.InputJsonValue,
        responseBodyJson: (responseBody || null) as Prisma.InputJsonValue,
      },
    });

    await this.prisma.internalSourceApiKey.update({
      where: { id: resolvedKey.id },
      data: {
        lastUsedAt: new Date(),
      },
    });
  }

  private isManualProduct(product: {
    providerName: string;
    metadataJson?: Prisma.JsonValue | null;
  }) {
    if (String(product.providerName || "").toLowerCase() === "manual") {
      return true;
    }

    const metadata = this.asRecord(product.metadataJson);
    return metadata.manual === true;
  }

  private asRecord(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {} as Record<string, any>;
    }

    return value as Record<string, any>;
  }

  private normalizeManualDeliveryText(value: string | null | undefined) {
    const normalized = String(value || "").replace(/\r\n/g, "\n").trim();
    return normalized || null;
  }

  private unwrapManualDeliveryEnvelope(value: string | null | undefined) {
    const normalized = String(value || "").trim();

    if (normalized.startsWith("{") && normalized.endsWith("}")) {
      return normalized.slice(1, -1).trim();
    }

    return normalized;
  }

  private sanitizeDeliveryEntry(value: string) {
    return value
      .trim()
      .replace(/^[{[]+/, "")
      .replace(/[}\],;]+$/g, "")
      .trim();
  }

  private parseJsonDeliveryEntries(normalized: string) {
    if (!normalized.startsWith("[")) {
      return [] as string[];
    }

    try {
      const parsed = JSON.parse(normalized);

      if (!Array.isArray(parsed)) {
        return [] as string[];
      }

      return parsed
        .map((entry) => this.normalizeJsonDeliveryEntry(entry))
        .filter(Boolean) as string[];
    } catch {
      return [] as string[];
    }
  }

  private normalizeJsonDeliveryEntry(entry: unknown) {
    if (typeof entry === "string") {
      return entry.trim() || null;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    const record = entry as Record<string, unknown>;
    const account = [record.account, record.email, record.username, record.user, record.login]
      .map((value) => String(value || "").trim())
      .find(Boolean);
    const password = [record.password, record.pass, record.pwd]
      .map((value) => String(value || "").trim())
      .find(Boolean);

    if (account && password) {
      return `${account} | ${password}`;
    }

    return null;
  }

  private readManualDeliveryEntries(metadata: Record<string, any>) {
    if (Array.isArray(metadata.deliveryEntries)) {
      return metadata.deliveryEntries
        .map((entry: unknown) => String(entry || "").trim())
        .filter(Boolean);
    }

    if (typeof metadata.deliveryText === "string") {
      const normalized = this.unwrapManualDeliveryEnvelope(
        this.normalizeManualDeliveryText(metadata.deliveryText),
      );

      if (!normalized) {
        return [] as string[];
      }

      const jsonEntries = this.parseJsonDeliveryEntries(normalized);
      if (jsonEntries.length > 0) {
        return jsonEntries;
      }

      return normalized
        .split("\n")
        .map((entry) => this.sanitizeDeliveryEntry(entry))
        .filter(Boolean);
    }

    return [] as string[];
  }
}
