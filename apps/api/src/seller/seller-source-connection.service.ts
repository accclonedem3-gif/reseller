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

    if (apiKey.connection && apiKey.connection.downstreamShopId == null) {
      throw new BadRequestException(
        "This key is bound to a bot wallet (customer source key) and cannot be used as a dashboard shop connection.",
      );
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

      // Detect "switching source" — if shop currently linked to a DIFFERENT internal source connection,
      // we need to clean orphan catalog rows that came from the previous source.
      const previousProviderConfig = await tx.providerConfig.findUnique({
        where: { shopId: downstreamShop.id },
        select: { internalSourceConnectionId: true, providerName: true },
      });
      const isSwitchingSource =
        previousProviderConfig?.internalSourceConnectionId != null &&
        previousProviderConfig.internalSourceConnectionId !== existing?.id;
      const wasExternalProvider =
        previousProviderConfig != null &&
        previousProviderConfig.internalSourceConnectionId == null &&
        previousProviderConfig.providerName !== "manual" &&
        previousProviderConfig.providerName !== "internal_pro";

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

      // Cleanup orphan catalog rows from previous source (only those without order history)
      if (isSwitchingSource || wasExternalProvider) {
        const orphans = await tx.sourceProduct.findMany({
          where: {
            shopId: downstreamShop.id,
            providerName: { not: "manual" },
            orders: { none: {} },
            internalSourceOrders: { none: {} },
          },
          select: { id: true },
        });
        if (orphans.length > 0) {
          await tx.sourceProduct.deleteMany({
            where: { id: { in: orphans.map((o) => o.id) } },
          });
        }
      }

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
      inheritSourceTemplate: connection.inheritSourceTemplate,
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
      include: {
        overrides: {
          where: { sellerId: connection.upstreamSellerId },
          select: { salePrice: true },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const providerProducts: ProviderProduct[] = upstreamProducts.map((p) => {
      const fallbackSalePrice = p.overrides?.[0]?.salePrice
        ? decimalToNumber(p.overrides[0].salePrice)
        : 0;
      const wholesalePrice = p.internalSourcePrice != null
        ? decimalToNumber(p.internalSourcePrice)
        : fallbackSalePrice;
      return ({
      externalId: p.id,
      sourceName: p.sourceName,
      sourceRawName: p.sourceRawName,
      description: p.sourceDescription,
      rawDescription: p.sourceDescription,
      price: wholesalePrice,
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
    });
    });

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

  async setInheritTemplate(user: AuthenticatedUser, enabled: boolean) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const result = await this.prisma.downstreamSourceConnection.updateMany({
      where: { downstreamShopId: shop.id, status: DownstreamSourceConnectionStatus.ACTIVE },
      data: { inheritSourceTemplate: enabled },
    });
    if (result.count === 0) {
      throw new NotFoundException("No active source connection.");
    }
    return { ok: true, inheritSourceTemplate: enabled };
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
      inheritSourceTemplate: connection.inheritSourceTemplate,
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

  async cleanupOrphanCatalogProducts(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const candidates = await this.prisma.sourceProduct.findMany({
      where: {
        shopId: shop.id,
        providerName: { not: "manual" },
        orders: { none: {} },
        internalSourceOrders: { none: {} },
      },
      select: { id: true, sourceName: true, externalProductId: true, providerName: true, available: true },
    });

    // Only delete those that are stale (available=0) OR no longer match the current provider naming.
    // Manual products (providerName=manual) are protected above. Products with order history are protected above.
    const currentProvider = await this.prisma.providerConfig.findUnique({
      where: { shopId: shop.id },
      select: { internalSourceConnectionId: true },
    });
    let upstreamShopId: string | null = null;
    if (currentProvider?.internalSourceConnectionId) {
      const connection = await this.prisma.downstreamSourceConnection.findUnique({
        where: { id: currentProvider.internalSourceConnectionId },
        select: { upstreamShopId: true },
      });
      upstreamShopId = connection?.upstreamShopId ?? null;
    }

    let activeUpstreamIds = new Set<string>();
    if (upstreamShopId) {
      const activeUpstream = await this.prisma.sourceProduct.findMany({
        where: { shopId: upstreamShopId, internalSourceEnabled: true },
        select: { id: true },
      });
      activeUpstreamIds = new Set(activeUpstream.map((p) => p.id));
    }

    const toDelete = candidates.filter((c) => {
      // Drop if: not in current upstream catalog
      if (activeUpstreamIds.size > 0 && !activeUpstreamIds.has(c.externalProductId)) return true;
      // Drop if: legacy provider (e.g. canboso) — different from current internal_pro
      if (currentProvider?.internalSourceConnectionId && c.providerName !== "internal_pro") return true;
      // Drop if: marked stale and no upstream context to verify
      if (!upstreamShopId && c.available === 0) return true;
      return false;
    });

    if (toDelete.length === 0) {
      return { deleted: 0, scanned: candidates.length };
    }

    await this.prisma.sourceProduct.deleteMany({
      where: { id: { in: toDelete.map((p) => p.id) } },
    });

    return { deleted: toDelete.length, scanned: candidates.length };
  }

  async debugBalance(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    if (!shop.providerConfig?.internalSourceConnectionId) {
      return { error: "No internal source connection found.", shopId: shop.id };
    }
    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id: shop.providerConfig.internalSourceConnectionId },
      include: { upstreamShop: { select: { id: true, name: true } } },
    });
    if (!connection) {
      return { error: "Connection record not found.", connectionId: shop.providerConfig.internalSourceConnectionId };
    }
    const downstreamBotConfig = connection.downstreamShopId
      ? await this.prisma.botConfig.findUnique({
          where: { shopId: connection.downstreamShopId },
          select: { ownerTelegramUserId: true, telegramBotUsername: true },
        })
      : null;
    const candidateChatIds = Array.from(new Set([
      connection.downstreamTelegramChatId,
      downstreamBotConfig?.ownerTelegramUserId,
    ].filter((v): v is string => typeof v === "string" && v.length > 0)));

    const customerLookups = await Promise.all(
      candidateChatIds.map(async (chatId) => {
        const customer = await this.prisma.customer.findFirst({
          where: { shopId: connection.upstreamShopId, telegramChatId: chatId },
          select: {
            id: true,
            telegramChatId: true,
            telegramUserId: true,
            telegramUsername: true,
            wallet: { select: { balance: true, currency: true } },
          },
        });
        return { chatId, customer };
      }),
    );

    // Also fuzzy-search any customer in upstream shop matching the downstream bot owner username (debug helper)
    const allDownstreamRelatedCustomers = await this.prisma.customer.findMany({
      where: {
        shopId: connection.upstreamShopId,
        OR: candidateChatIds.length > 0
          ? [
              { telegramChatId: { in: candidateChatIds } },
              { telegramUserId: { in: candidateChatIds } },
            ]
          : [{ id: "__never__" }],
      },
      select: {
        id: true,
        telegramChatId: true,
        telegramUserId: true,
        telegramUsername: true,
        wallet: { select: { balance: true } },
      },
      take: 10,
    });

    return {
      shopId: shop.id,
      connectionId: connection.id,
      upstreamShop: connection.upstreamShop,
      downstreamShopId: connection.downstreamShopId,
      connectionDownstreamTelegramChatId: connection.downstreamTelegramChatId,
      downstreamBotOwnerTelegramUserId: downstreamBotConfig?.ownerTelegramUserId ?? null,
      downstreamBotUsername: downstreamBotConfig?.telegramBotUsername ?? null,
      candidateChatIds,
      customerLookupsByChatId: customerLookups,
      fuzzyMatchedCustomers: allDownstreamRelatedCustomers,
      hint:
        customerLookups.some((c) => c.customer?.wallet)
          ? "OK — found wallet via chatId lookup. Order should pass balance check."
          : "MISMATCH — neither connection.downstreamTelegramChatId nor downstreamBotConfig.ownerTelegramUserId points at a customer with a wallet in the upstream shop. Tell em which chatId you used to top-up the ULTRA bot.",
    };
  }
}
