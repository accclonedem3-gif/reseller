import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ConnectionStatus,
  ConnectionTopupStatus,
  CustomerWalletLedgerType,
  DownstreamSourceConnectionStatus,
  InternalSourceLedgerType,
  Prisma,
  ProviderKind,
  SellerTier,
} from "@prisma/client";
import { encryptSecret } from "@reseller/shared/server";
import type { ProviderProduct } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";
import { decimalToNumber, generateExternalPaymentCode, toDecimal } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import { InternalSourceApiKeyService } from "../source/internal-source-api-key.service";
import type { AuthenticatedUser } from "../types";

@Injectable()
export class SellerSourceConnectionService {
  private readonly topupExpiryMs = 15 * 60 * 1000;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(InternalSourceApiKeyService)
    private readonly apiKeyService: InternalSourceApiKeyService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
  ) {}

  async connect(user: AuthenticatedUser, rawApiKey: string) {
    const normalizedKey = String(rawApiKey || "").trim();

    if (!normalizedKey) {
      throw new BadRequestException("API key is required.");
    }

    const apiKey = await this.apiKeyService.validateKey(normalizedKey);

    const upstreamSeller = await this.prisma.seller.findUnique({
      where: { id: apiKey.sellerId },
      select: { tier: true },
    });

    if (upstreamSeller?.tier !== SellerTier.ULTRA) {
      throw new ForbiddenException("This key was not issued by a PRO seller.");
    }

    const downstreamShop = await this.shopsService.getSellerShop(user.id);
    const downstreamBotConfig = await this.prisma.botConfig.findUnique({
      where: { shopId: downstreamShop.id },
      select: { ownerTelegramUserId: true },
    });
    const resolvedTelegramChatId = apiKey.telegramChatId || downstreamBotConfig?.ownerTelegramUserId || null;

    if (apiKey.shopId === downstreamShop.id) {
      throw new BadRequestException("You cannot connect your shop to its own source key.");
    }

    if (
      apiKey.connection &&
      apiKey.connection.downstreamShopId !== downstreamShop.id
    ) {
      throw new BadRequestException(
        "This source key is already assigned to another downstream shop.",
      );
    }

    const connection = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.downstreamSourceConnection.findUnique({
        where: {
          upstreamShopId_downstreamShopId: {
            upstreamShopId: apiKey.shopId,
            downstreamShopId: downstreamShop.id,
          },
        },
      });

      const nextConnection = existing
        ? await tx.downstreamSourceConnection.update({
            where: { id: existing.id },
            data: {
              apiKeyId: apiKey.id,
              status: DownstreamSourceConnectionStatus.ACTIVE,
              ...(resolvedTelegramChatId ? { downstreamTelegramChatId: resolvedTelegramChatId } : {}),
            },
          })
        : await tx.downstreamSourceConnection.create({
            data: {
              upstreamSellerId: apiKey.sellerId,
              upstreamShopId: apiKey.shopId,
              downstreamSellerId: downstreamShop.sellerId,
              downstreamShopId: downstreamShop.id,
              apiKeyId: apiKey.id,
              status: DownstreamSourceConnectionStatus.ACTIVE,
              currency: downstreamShop.defaultCurrency,
              downstreamTelegramChatId: resolvedTelegramChatId,
            },
          });

      const encryptedKey = encryptSecret(normalizedKey, this.config.encryptionKey);

      await tx.providerConfig.upsert({
        where: { shopId: downstreamShop.id },
        update: {
          providerKind: ProviderKind.INTERNAL,
          providerName: "internal_pro",
          baseUrl: this.getInternalBuyerBaseUrl(),
          buyerKeyEncrypted: encryptedKey,
          internalSourceConnectionId: nextConnection.id,
          connectionStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
        },
        create: {
          shopId: downstreamShop.id,
          providerKind: ProviderKind.INTERNAL,
          providerName: "internal_pro",
          baseUrl: this.getInternalBuyerBaseUrl(),
          buyerKeyEncrypted: encryptedKey,
          internalSourceConnectionId: nextConnection.id,
          sourceNotificationSyncEnabled: true,
          connectionStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
        },
      });

      return nextConnection;
    });

    return this.getConnectionById(connection.id);
  }

  async getCurrentConnection(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: { downstreamShopId: shop.id, status: DownstreamSourceConnectionStatus.ACTIVE },
      include: {
        apiKey: { select: { id: true, label: true, keyPrefix: true, status: true, expiresAt: true } },
        upstreamSeller: { select: { id: true, displayName: true, tier: true } },
        upstreamShop: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
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

    return {
      id: connection.id,
      status: connection.status.toLowerCase(),
      balance: walletBalance,
      currency: connection.currency,
      lastCatalogSyncAt: connection.lastCatalogSyncAt,
      lastOrderedAt: connection.lastOrderedAt,
      apiKey: connection.apiKey
        ? {
            id: connection.apiKey.id,
            label: connection.apiKey.label,
            keyPrefix: connection.apiKey.keyPrefix,
            status: connection.apiKey.status.toLowerCase(),
            expiresAt: connection.apiKey.expiresAt,
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
    };
  }

  async syncCatalog(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);

    if (!shop.providerConfig?.internalSourceConnectionId) {
      throw new NotFoundException("No internal source connection found.");
    }

    if (shop.providerConfig.providerKind !== ProviderKind.INTERNAL) {
      throw new BadRequestException(
        "Shop is not configured to use an internal source.",
      );
    }

    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id: shop.providerConfig.internalSourceConnectionId },
    });

    if (!connection || connection.status !== DownstreamSourceConnectionStatus.ACTIVE) {
      throw new BadRequestException("Internal source connection is not active.");
    }

    const upstreamProducts = await this.prisma.sourceProduct.findMany({
      where: {
        shopId: connection.upstreamShopId,
        internalSourceEnabled: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const providerProducts: ProviderProduct[] = upstreamProducts.map((p) => ({
      externalId: p.id,
      sourceName: p.sourceName,
      sourceRawName: p.sourceRawName,
      description: p.sourceDescription,
      rawDescription: p.sourceDescription,
      price: decimalToNumber(p.internalSourcePrice ?? p.sourcePrice),
      available: p.available,
      hidden: false,
      isSlotProduct: false,
      requiresCustomerEmail: false,
      requiresSlotMonths: false,
      slotDurations: [],
      quantityFixed: 1,
      walletCurrency: "VND",
      metadata: {
        productFamily: p.productFamily ?? null,
        productFamilyOther: p.productFamilyOther ?? null,
        accountType: p.accountType ?? null,
        accountTypeOther: p.accountTypeOther ?? null,
        durationType: p.durationType ?? null,
        durationTypeOther: p.durationTypeOther ?? null,
        sourceDeliveryMode: p.sourceDeliveryMode ?? null,
        deliveryMode: p.sourceDeliveryMode ?? null,
        warrantyPolicy: p.warrantyPolicy ?? null,
        internalSourceEnabled: p.internalSourceEnabled,
        internalSourcePrice: p.internalSourcePrice
          ? decimalToNumber(p.internalSourcePrice)
          : null,
        productIcon: p.productIcon ?? null,
        iconCustomEmojiId: p.iconCustomEmojiId ?? null,
        imageUrl: p.imageUrl ?? null,
      },
    }));

    const result = await this.shopsService.applyCatalogProductsForShop(
      shop.id,
      providerProducts,
    );

    await this.prisma.downstreamSourceConnection.update({
      where: { id: connection.id },
      data: { lastCatalogSyncAt: new Date() },
    });

    return { synced: result.synced, notified: result.notified };
  }

  async createPayosTopup(user: AuthenticatedUser, amount: number) {
    const shop = await this.shopsService.getSellerShop(user.id);

    if (!Number.isInteger(amount) || amount < 10000) {
      throw new BadRequestException("Số tiền nạp tối thiểu là 10,000 VND.");
    }

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: { downstreamShopId: shop.id, status: DownstreamSourceConnectionStatus.ACTIVE },
    });

    if (!connection) {
      throw new NotFoundException("Không tìm thấy kết nối nguồn PRO đang hoạt động.");
    }

    const externalOrderCode = generateExternalPaymentCode();
    const expiresAt = new Date(Date.now() + this.topupExpiryMs);

    const payment = await this.paymentService.createPaymentLink({
      shopId: connection.upstreamShopId,
      externalOrderCode,
      amount,
      description: `NAPTIEN-${externalOrderCode.slice(-6)}`,
      expiredAt: expiresAt,
    });

    await this.prisma.connectionTopupRequest.create({
      data: {
        connectionId: connection.id,
        upstreamShopId: connection.upstreamShopId,
        downstreamShopId: shop.id,
        amount: toDecimal(amount),
        provider: payment.provider,
        externalOrderCode,
        status: ConnectionTopupStatus.PENDING,
        checkoutUrl: payment.checkoutUrl,
        qrCode: payment.qrCode,
        expiresAt,
        rawPayloadJson: payment.providerPayload as Prisma.InputJsonValue,
      },
    });

    return {
      externalOrderCode,
      checkoutUrl: payment.checkoutUrl,
      qrCode: payment.qrCode,
      expiresAt,
      amount,
    };
  }

  async createPayosTopupForConnection(connectionId: string, downstreamShopId: string, amount: number) {
    if (!Number.isInteger(amount) || amount < 10000) {
      throw new BadRequestException("Số tiền nạp tối thiểu là 10,000 VND.");
    }

    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection || connection.downstreamShopId !== downstreamShopId) {
      throw new NotFoundException("Kết nối không tồn tại.");
    }

    if (connection.status !== DownstreamSourceConnectionStatus.ACTIVE) {
      throw new BadRequestException("Kết nối không đang hoạt động.");
    }

    const externalOrderCode = generateExternalPaymentCode();
    const expiresAt = new Date(Date.now() + this.topupExpiryMs);

    const payment = await this.paymentService.createPaymentLink({
      shopId: connection.upstreamShopId,
      externalOrderCode,
      amount,
      description: `NAPTIEN-${externalOrderCode.slice(-6)}`,
      expiredAt: expiresAt,
    });

    await this.prisma.connectionTopupRequest.create({
      data: {
        connectionId: connection.id,
        upstreamShopId: connection.upstreamShopId,
        downstreamShopId,
        amount: toDecimal(amount),
        provider: payment.provider,
        externalOrderCode,
        status: ConnectionTopupStatus.PENDING,
        checkoutUrl: payment.checkoutUrl,
        qrCode: payment.qrCode,
        expiresAt,
        rawPayloadJson: payment.providerPayload as Prisma.InputJsonValue,
      },
    });

    return {
      externalOrderCode,
      checkoutUrl: payment.checkoutUrl,
      qrCode: payment.qrCode,
      expiresAt,
      amount,
    };
  }

  async markTopupPaid(externalOrderCode: string, rawPayload?: unknown) {
    const topup = await this.prisma.connectionTopupRequest.findUnique({
      where: { externalOrderCode },
    });

    if (!topup) {
      throw new NotFoundException("Connection topup request not found.");
    }

    if (topup.status === ConnectionTopupStatus.PAID) {
      const connection = await this.prisma.downstreamSourceConnection.findUnique({
        where: { id: topup.connectionId },
        select: { id: true, upstreamShopId: true, downstreamTelegramChatId: true },
      });
      let walletBalance = 0;
      if (connection?.downstreamTelegramChatId) {
        const wallet = await this.prisma.customerWallet.findFirst({
          where: {
            customer: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
          },
          select: { balance: true },
        });
        if (wallet) walletBalance = decimalToNumber(wallet.balance);
      }
      return {
        topup,
        balanceAfter: walletBalance,
        connectionId: topup.connectionId,
        downstreamShopId: topup.downstreamShopId,
        upstreamShopId: topup.upstreamShopId,
        amount: decimalToNumber(topup.amount),
      };
    }

    if (topup.status !== ConnectionTopupStatus.PENDING) {
      throw new BadRequestException("Topup request is no longer pending.");
    }

    const amount = decimalToNumber(topup.amount);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM downstream_source_connections WHERE id = ${topup.connectionId} FOR UPDATE`,
      );

      const connection = await tx.downstreamSourceConnection.findUnique({
        where: { id: topup.connectionId },
      });

      if (!connection) {
        throw new NotFoundException("Connection not found.");
      }

      // Credit customer wallet (source of truth)
      if (connection.downstreamTelegramChatId) {
        const customer = await tx.customer.findFirst({
          where: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
          include: { wallet: true },
        });

        if (customer) {
          let wallet = customer.wallet;
          if (!wallet) {
            wallet = await tx.customerWallet.create({
              data: { customerId: customer.id, balance: toDecimal(0), balanceUsdt: toDecimal(0), currency: "VND" },
            });
          }

          await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`);
          const walletBefore = decimalToNumber(wallet.balance);
          const walletAfter = walletBefore + amount;

          await tx.customerWallet.update({
            where: { id: wallet.id },
            data: { balance: toDecimal(walletAfter) },
          });

          await tx.customerWalletLedger.create({
            data: {
              customerId: customer.id,
              walletId: wallet.id,
              type: CustomerWalletLedgerType.TOPUP,
              amount: toDecimal(amount),
              balanceBefore: toDecimal(walletBefore),
              balanceAfter: toDecimal(walletAfter),
              referenceType: "connection_topup_request",
              referenceId: topup.id,
              note: "Nạp ví qua PayOS (bot đại lý)",
            },
          });

            await tx.internalSourceLedger.create({
            data: {
              connectionId: connection.id,
              type: InternalSourceLedgerType.TOPUP,
              amount: toDecimal(amount),
              balanceBefore: toDecimal(walletBefore),
              balanceAfter: toDecimal(walletAfter),
              referenceType: "connection_topup_request",
              referenceId: topup.id,
              note: "Top up via PayOS payment",
            },
          });
        }
      } else {
        // No linked customer — record ledger only, no wallet to credit
        await tx.internalSourceLedger.create({
          data: {
            connectionId: connection.id,
            type: InternalSourceLedgerType.TOPUP,
            amount: toDecimal(amount),
            balanceBefore: toDecimal(0),
            balanceAfter: toDecimal(0),
            referenceType: "connection_topup_request",
            referenceId: topup.id,
            note: "Top up via PayOS payment (no linked customer wallet)",
          },
        });
      }

      await tx.connectionTopupRequest.update({
        where: { id: topup.id },
        data: {
          status: ConnectionTopupStatus.PAID,
          rawPayloadJson: rawPayload as Prisma.InputJsonValue,
        },
      });
    });

    const refreshedConnection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id: topup.connectionId },
      select: { id: true, upstreamShopId: true, downstreamTelegramChatId: true },
    });
    let walletBalanceAfter = 0;
    if (refreshedConnection?.downstreamTelegramChatId) {
      const wallet = await this.prisma.customerWallet.findFirst({
        where: {
          customer: {
            shopId: refreshedConnection.upstreamShopId,
            telegramChatId: refreshedConnection.downstreamTelegramChatId,
          },
        },
        select: { balance: true },
      });
      if (wallet) walletBalanceAfter = decimalToNumber(wallet.balance);
    }

    return {
      topup,
      balanceAfter: walletBalanceAfter,
      connectionId: topup.connectionId,
      downstreamShopId: topup.downstreamShopId,
      upstreamShopId: topup.upstreamShopId,
      amount,
    };
  }

  async disconnect(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.downstreamSourceConnection.updateMany({
        where: { downstreamShopId: shop.id, status: DownstreamSourceConnectionStatus.ACTIVE },
        data: { status: DownstreamSourceConnectionStatus.DISABLED },
      });
      await tx.providerConfig.updateMany({
        where: { shopId: shop.id },
        data: { providerKind: ProviderKind.EXTERNAL, internalSourceConnectionId: null, connectionStatus: ConnectionStatus.DISABLED },
      });
    });

    return { ok: true };
  }

  private async getConnectionById(id: string) {
    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id },
      include: {
        apiKey: { select: { id: true, label: true, keyPrefix: true, status: true, expiresAt: true } },
        upstreamSeller: { select: { id: true, displayName: true, tier: true } },
        upstreamShop: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!connection) {
      throw new NotFoundException("Connection not found.");
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

    return {
      id: connection.id,
      status: connection.status.toLowerCase(),
      balance: walletBalance,
      currency: connection.currency,
      lastCatalogSyncAt: connection.lastCatalogSyncAt,
      lastOrderedAt: connection.lastOrderedAt,
      apiKey: connection.apiKey
        ? {
            id: connection.apiKey.id,
            label: connection.apiKey.label,
            keyPrefix: connection.apiKey.keyPrefix,
            status: connection.apiKey.status.toLowerCase(),
            expiresAt: connection.apiKey.expiresAt,
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
    };
  }

  private getInternalBuyerBaseUrl() {
    return `${String(this.config.appPublicUrl || "").replace(/\/$/, "")}/api/v1`;
  }
}
