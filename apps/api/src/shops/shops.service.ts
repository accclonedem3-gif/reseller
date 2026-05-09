import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { API_PREFIX } from "@reseller/shared";
import {
  Prisma,
  ProviderKind,
  SellerTier,
  SourceAccountType,
  SourceDeliveryMode,
  SourceDurationType,
  SourceProductFamily,
  SourceWarrantyPolicy,
} from "@prisma/client";
import {
  decryptSecret,
  encryptSecret,
  fetchProviderBalance,
  fetchProviderProducts,
  getMockProviderProducts,
  getMockTelegramBotInfo,
  isMockBotToken,
  isMockBuyerKey,
  maskSecret,
  telegramDeleteWebhook,
  telegramGetMe,
  telegramSendMessage,
  telegramSetCommands,
  telegramSetWebhook,
  verifyProviderConnection,
} from "@reseller/shared/server";
import type { ProviderBalanceResult, ProviderProduct } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { decimalToNumber, slugify, toDecimal } from "../lib/utils";

import type { AuthenticatedUser } from "../types";
import type { UpdateBotConfigDto, UpdateShopDto } from "./shops.dto";

const PRO_COMMANDS = [
  { command: "start", description: "Trang chủ" },
  { command: "products", description: "Xem sản phẩm" },
  { command: "help", description: "Hướng dẫn mua hàng" },
  { command: "support", description: "Thông tin hỗ trợ" },
];

const ULTRA_COMMANDS = [
  ...PRO_COMMANDS,
  { command: "warranty", description: "Yêu cầu bảo hành" },
  { command: "api", description: "Quản lý API key" },
];

type ShopCatalogContext = Prisma.ShopGetPayload<{
  include: {
    botConfig: true;
    providerConfig: true;
    seller: true;
  };
}>;

type CatalogStockNotification = {
  sourceProductId: string;
  displayName: string;
  addedQuantity: number;
  available: number;
};

@Injectable()
export class ShopsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  private safeDecryptSecret(payload: string | null | undefined) {
    try {
      return decryptSecret(payload, this.config.encryptionKey);
    } catch {
      return "";
    }
  }

  private createSourceWebhookKey() {
    return `wh_${randomBytes(18).toString("hex")}`;
  }

  buildTelegramWebhookSecret(shopId: string) {
    return createHmac("sha256", this.config.internalApiToken)
      .update(`telegram-webhook:${String(shopId || "").trim()}`)
      .digest("hex");
  }

  isValidTelegramWebhookSecret(shopId: string, providedSecret: string | null | undefined) {
    const expected = Buffer.from(this.buildTelegramWebhookSecret(shopId), "utf8");
    const provided = Buffer.from(String(providedSecret || "").trim(), "utf8");

    if (expected.length !== provided.length) {
      return false;
    }

    return timingSafeEqual(expected, provided);
  }

  private buildSourceWebhookUrl(sourceWebhookKey: string) {
    const baseUrl = String(this.config.appPublicUrl || "").replace(/\/$/, "");
    return `${baseUrl}/${API_PREFIX}/webhooks/source-stock/${sourceWebhookKey}`;
  }

  private parseUsdtVndRateOverride(value: string | null | undefined) {
    if (value === null || value === undefined) {
      return undefined;
    }

    const normalized = String(value).replace(/,/g, "").trim();

    if (!normalized) {
      return null;
    }

    const rate = Number(normalized);

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException("USDT/VND rate must be greater than 0.");
    }

    return toDecimal(rate);
  }

  private async ensureSourceWebhookKey(providerConfig: {
    id: string;
    sourceWebhookKey: string | null;
  }) {
    if (providerConfig.sourceWebhookKey) {
      return providerConfig.sourceWebhookKey;
    }

    const updatedProviderConfig = await this.prisma.providerConfig.update({
      where: { id: providerConfig.id },
      data: {
        sourceWebhookKey: this.createSourceWebhookKey(),
      },
      select: {
        sourceWebhookKey: true,
      },
    });

    return updatedProviderConfig.sourceWebhookKey;
  }

  async getCurrentShop(user: AuthenticatedUser) {
    const shop = await this.getSellerShop(user.id);

    return {
      id: shop.id,
      sellerId: shop.sellerId,
      slug: shop.slug,
      name: shop.name,
      tagline: shop.tagline,
      logoUrl: shop.logoUrl,
      supportTelegram: shop.supportTelegram,
      supportZalo: shop.supportZalo,
      status: shop.status.toLowerCase(),
      storefrontMode: shop.storefrontMode.toLowerCase(),
      storefrontConfigJson: shop.storefrontConfigJson,
      defaultCurrency: shop.defaultCurrency,
      lastCatalogSyncAt: shop.lastCatalogSyncAt,
    };
  }

  async updateCurrentShop(user: AuthenticatedUser, dto: UpdateShopDto) {
    const shop = await this.getSellerShop(user.id);

    return this.prisma.shop.update({
      where: { id: shop.id },
      data: {
        name: dto.name ?? undefined,
        tagline: dto.tagline ?? undefined,
        supportTelegram: dto.supportTelegram ?? undefined,
        supportZalo: dto.supportZalo ?? undefined,
        logoUrl: dto.logoUrl ?? undefined,
        storefrontMode: dto.storefrontMode ?? undefined,
      },
    });
  }

  async getBotConfig(user: AuthenticatedUser) {
    const shop = await this.getSellerShop(user.id);
    const botConfig = shop.botConfig;
    const providerConfig = shop.providerConfig;
    const paymentConfig = shop.paymentConfig;
    const sourceWebhookKey = providerConfig
      ? await this.ensureSourceWebhookKey(providerConfig)
      : null;

    return {
      shopId: shop.id,
      shopName: shop.name,
      shopTagline: shop.tagline,
      logoUrl: shop.logoUrl,
      supportTelegram: shop.supportTelegram,
      supportZalo: shop.supportZalo,
      storefrontMode: shop.storefrontMode.toLowerCase(),
      storefrontConfigJson: shop.storefrontConfigJson,
      providerBaseUrl: providerConfig?.baseUrl || this.config.providerBaseUrl,
      providerName: providerConfig?.providerName || this.config.providerName,
      providerBuyerKeyMasked: maskSecret(
        this.safeDecryptSecret(providerConfig?.buyerKeyEncrypted),
      ),
      sourceNotificationSyncEnabled:
        providerConfig?.sourceNotificationSyncEnabled ?? true,
      botTokenMasked: maskSecret(
        this.safeDecryptSecret(botConfig?.telegramBotTokenEncrypted),
      ),
      paymentProvider: (paymentConfig?.provider || "MOCK").toLowerCase(),
      payosClientIdMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.payosClientIdEncrypted),
      ),
      payosApiKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.payosApiKeyEncrypted),
      ),
      payosChecksumKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.payosChecksumKeyEncrypted),
      ),
      binanceUid: paymentConfig?.binanceUid || "",
      okxUid: paymentConfig?.okxUid || "",
      usdtTrc20Address: paymentConfig?.usdtTrc20Address || "",
      usdtVndRateOverride: paymentConfig?.usdtVndRateOverride
        ? decimalToNumber(paymentConfig.usdtVndRateOverride)
        : null,
      defaultUsdtVndRate: this.config.usdtVndRate,
      binancePersonalApiKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.binancePersonalApiKeyEncrypted),
      ),
      binancePersonalSecretKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.binancePersonalSecretKeyEncrypted),
      ),
      binancePayApiKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.binancePayApiKeyEncrypted),
      ),
      binancePaySecretKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.binancePaySecretKeyEncrypted),
      ),
      binancePayEnabled: paymentConfig?.binancePayEnabled ?? false,
      telegramBotId: botConfig?.telegramBotId || null,
      telegramBotUsername: botConfig?.telegramBotUsername || null,
      telegramWebhookStatus: botConfig?.webhookStatus.toLowerCase() || "disabled",
      telegramDeliveryMode: botConfig?.deliveryMode.toLowerCase() || "polling",
      providerConnectionStatus: providerConfig?.connectionStatus.toLowerCase() || "pending",
      sourceWebhookUrl: sourceWebhookKey
        ? this.buildSourceWebhookUrl(sourceWebhookKey)
        : null,
      catalogSyncIntervalMs: this.config.catalogSyncIntervalMs,
      catalogSchedulerTickMs: this.config.catalogSchedulerTickMs,
      catalogSyncConcurrency: this.config.catalogSyncConcurrency,
      lastCatalogSyncAt: shop.lastCatalogSyncAt,
      lastTelegramVerifiedAt: botConfig?.lastVerifiedAt || null,
      lastProviderVerifiedAt: providerConfig?.lastVerifiedAt || null,
    };
  }

  async updateBotConfig(user: AuthenticatedUser, dto: UpdateBotConfigDto) {
    const shop = await this.getSellerShop(user.id);
    const encryptionKey = this.config.encryptionKey;
    const shouldUsePayOS = Boolean(
      dto.payosClientId || dto.payosApiKey || dto.payosChecksumKey,
    );
    const usdtVndRateOverride = this.parseUsdtVndRateOverride(
      dto.usdtVndRateOverride,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.shop.update({
        where: { id: shop.id },
        data: {
          name: dto.shopName ?? undefined,
          tagline: dto.shopTagline ?? undefined,
          supportTelegram: dto.supportTelegram ?? undefined,
          supportZalo: dto.supportZalo ?? undefined,
          logoUrl: dto.logoUrl ?? undefined,
          storefrontMode: dto.storefrontMode ?? undefined,
          slug: dto.shopName ? slugify(dto.shopName) || shop.slug : undefined,
        },
      });

      await tx.botConfig.upsert({
        where: { shopId: shop.id },
        update: {
          telegramBotTokenEncrypted: dto.botToken
            ? encryptSecret(dto.botToken, encryptionKey)
            : undefined,
        },
        create: {
          shopId: shop.id,
          telegramBotTokenEncrypted: dto.botToken
            ? encryptSecret(dto.botToken, encryptionKey)
            : "",
          webhookStatus: "DISABLED",
          deliveryMode: "POLLING",
        },
      });

      await tx.providerConfig.upsert({
        where: { shopId: shop.id },
        update: {
          providerName: this.config.providerName,
          baseUrl: dto.providerBaseUrl || this.config.providerBaseUrl,
          ...(dto.providerBuyerKey
            ? {
                buyerKeyEncrypted: encryptSecret(dto.providerBuyerKey, encryptionKey),
                providerKind: ProviderKind.EXTERNAL,
                internalSourceConnectionId: null,
                connectionStatus: "PENDING",
              }
            : {}),
          sourceNotificationSyncEnabled: dto.sourceNotificationSyncEnabled,
        },
        create: {
          shopId: shop.id,
          providerName: this.config.providerName,
          baseUrl: dto.providerBaseUrl || this.config.providerBaseUrl,
          buyerKeyEncrypted: dto.providerBuyerKey
            ? encryptSecret(dto.providerBuyerKey, encryptionKey)
            : "",
          providerKind: ProviderKind.EXTERNAL,
          sourceWebhookKey: this.createSourceWebhookKey(),
          sourceNotificationSyncEnabled: dto.sourceNotificationSyncEnabled ?? true,
          connectionStatus: "PENDING",
        },
      });

      await tx.paymentConfig.upsert({
        where: { shopId: shop.id },
        update: {
          provider: shouldUsePayOS
            ? "PAYOS"
            : dto.binancePayEnabled === true || (dto.binancePayApiKey && dto.binancePaySecretKey)
              ? "BINANCE_PAY"
              : undefined,
          payosClientIdEncrypted: dto.payosClientId
            ? encryptSecret(dto.payosClientId, encryptionKey)
            : undefined,
          payosApiKeyEncrypted: dto.payosApiKey
            ? encryptSecret(dto.payosApiKey, encryptionKey)
            : undefined,
          payosChecksumKeyEncrypted: dto.payosChecksumKey
            ? encryptSecret(dto.payosChecksumKey, encryptionKey)
            : undefined,
          binanceUid: dto.binanceUid ?? undefined,
          okxUid: dto.okxUid ?? undefined,
          usdtTrc20Address: dto.usdtTrc20Address ?? undefined,
          usdtVndRateOverride,
          binancePersonalApiKeyEncrypted: dto.binancePersonalApiKey
            ? encryptSecret(dto.binancePersonalApiKey, encryptionKey)
            : undefined,
          binancePersonalSecretKeyEncrypted: dto.binancePersonalSecretKey
            ? encryptSecret(dto.binancePersonalSecretKey, encryptionKey)
            : undefined,
          binancePayApiKeyEncrypted: dto.binancePayApiKey
            ? encryptSecret(dto.binancePayApiKey, encryptionKey)
            : undefined,
          binancePaySecretKeyEncrypted: dto.binancePaySecretKey
            ? encryptSecret(dto.binancePaySecretKey, encryptionKey)
            : undefined,
          binancePayEnabled: dto.binancePayEnabled ?? undefined,
        },
        create: {
          shopId: shop.id,
          provider:
            shouldUsePayOS || this.config.paymentMode === "payos"
              ? "PAYOS"
              : dto.binancePayApiKey && dto.binancePaySecretKey
                ? "BINANCE_PAY"
                : "MOCK",
          payosClientIdEncrypted: dto.payosClientId
            ? encryptSecret(dto.payosClientId, encryptionKey)
            : null,
          payosApiKeyEncrypted: dto.payosApiKey
            ? encryptSecret(dto.payosApiKey, encryptionKey)
            : null,
          payosChecksumKeyEncrypted: dto.payosChecksumKey
            ? encryptSecret(dto.payosChecksumKey, encryptionKey)
            : null,
          binanceUid: dto.binanceUid ?? null,
          okxUid: dto.okxUid ?? null,
          usdtTrc20Address: dto.usdtTrc20Address ?? null,
          usdtVndRateOverride: usdtVndRateOverride ?? null,
          binancePersonalApiKeyEncrypted: dto.binancePersonalApiKey
            ? encryptSecret(dto.binancePersonalApiKey, encryptionKey)
            : null,
          binancePersonalSecretKeyEncrypted: dto.binancePersonalSecretKey
            ? encryptSecret(dto.binancePersonalSecretKey, encryptionKey)
            : null,
          binancePayApiKeyEncrypted: dto.binancePayApiKey
            ? encryptSecret(dto.binancePayApiKey, encryptionKey)
            : null,
          binancePaySecretKeyEncrypted: dto.binancePaySecretKey
            ? encryptSecret(dto.binancePaySecretKey, encryptionKey)
            : null,
          binancePayEnabled: dto.binancePayEnabled ?? false,
        },
      });
    });

    return this.getBotConfig(user);
  }

  async verifyTelegram(user: AuthenticatedUser) {
    const shop = await this.getSellerShop(user.id);
    const sellerRow = await this.prisma.seller.findUnique({ where: { userId: user.id }, select: { tier: true } });
    const botCommands = sellerRow?.tier === SellerTier.ULTRA ? ULTRA_COMMANDS : PRO_COMMANDS;
    const token = decryptSecret(
      shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (!token) {
      throw new BadRequestException("BOT_TOKEN is missing.");
    }

    let botInfo: {
      id: number | string;
      username?: string;
    };

    if (this.config.mockTelegramEnabled && isMockBotToken(token)) {
      botInfo = getMockTelegramBotInfo();
    } else {
      botInfo = await telegramGetMe(token);
    }

    const canUseWebhook =
      !this.config.mockTelegramEnabled &&
      !this.config.appPublicUrl.includes("localhost") &&
      !this.config.appPublicUrl.includes("127.0.0.1");

    if (canUseWebhook) {
      const webhookUrl = `${this.config.appPublicUrl}/api/v1/webhooks/telegram/${shop.id}`;
      await telegramSetWebhook(token, webhookUrl, this.buildTelegramWebhookSecret(shop.id));
      await telegramSetCommands(token, botCommands);

      await this.prisma.botConfig.update({
        where: { shopId: shop.id },
        data: {
          telegramBotId: String(botInfo.id),
          telegramBotUsername: botInfo.username || null,
          webhookUrl,
          webhookStatus: "ACTIVE",
          deliveryMode: "WEBHOOK",
          lastVerifiedAt: new Date(),
        },
      });
    } else {
      if (!(this.config.mockTelegramEnabled && isMockBotToken(token))) {
        await telegramDeleteWebhook(token).catch(() => undefined);
        await telegramSetCommands(token, botCommands).catch(() => undefined);
      }

      await this.prisma.botConfig.update({
        where: { shopId: shop.id },
        data: {
          telegramBotId: String(botInfo.id),
          telegramBotUsername: botInfo.username || null,
          webhookUrl: null,
          webhookStatus: "POLLING",
          deliveryMode: "POLLING",
          lastVerifiedAt: new Date(),
        },
      });
    }

    return this.getBotConfig(user);
  }

  async verifyProvider(user: AuthenticatedUser) {
    const shop = await this.getSellerShop(user.id);
    const providerConfig = shop.providerConfig;
    const buyerKey = decryptSecret(
      providerConfig?.buyerKeyEncrypted,
      this.config.encryptionKey,
    );

    if (!buyerKey) {
      throw new BadRequestException("Provider buyer key is missing.");
    }

    let verificationResult: { ok: boolean; sampleSize: number };

    if (this.config.mockProviderEnabled && isMockBuyerKey(buyerKey)) {
      verificationResult = {
        ok: true,
        sampleSize: getMockProviderProducts().length,
      };
    } else {
      try {
        const result = await verifyProviderConnection({
          baseUrl: providerConfig?.baseUrl || this.config.providerBaseUrl,
          buyerKey,
        });
        verificationResult = {
          ok: result.ok,
          sampleSize: result.sampleSize,
        };
      } catch (error) {
        await this.prisma.providerConfig.update({
          where: { shopId: shop.id },
          data: {
            connectionStatus: "FAILED",
            lastVerifiedAt: new Date(),
          },
        });

        throw new BadRequestException(this.formatProviderError(error));
      }
    }

    await this.prisma.providerConfig.update({
      where: { shopId: shop.id },
      data: {
        connectionStatus: verificationResult.ok ? "VERIFIED" : "FAILED",
        lastVerifiedAt: new Date(),
      },
    });

    return {
      ...(await this.getBotConfig(user)),
      providerSampleSize: verificationResult.sampleSize,
    };
  }

  async syncProducts(user: AuthenticatedUser) {
    const shop = await this.getSellerShop(user.id);
    const synced = await this.syncCatalogForShop(shop.id);

    return {
      synced,
      shopId: shop.id,
      lastCatalogSyncAt: new Date(),
    };
  }

  async handleSourceCatalogWebhook(
    webhookKey: string,
    body: Record<string, unknown>,
  ) {
    const providerConfig = await this.prisma.providerConfig.findUnique({
      where: { sourceWebhookKey: webhookKey },
      include: {
        shop: {
          include: {
            botConfig: true,
            providerConfig: true,
            seller: true,
          },
        },
      },
    });

    const shop = providerConfig?.shop;

    if (!shop || !shop.providerConfig) {
      throw new NotFoundException("Source webhook not found.");
    }

    const products = this.normalizeSourceWebhookProducts(body);

    if (products.length === 0) {
      const synced = await this.syncCatalogForShop(shop.id);

      return {
        success: true,
        mode: "full_sync",
        shopId: shop.id,
        synced,
        notified: 0,
      };
    }

    const result = await this.applyCatalogProducts(shop, products);

    return {
      success: true,
      mode: "payload",
      shopId: shop.id,
      synced: result.synced,
      notified: result.notified,
    };
  }

  async syncCatalogForShop(shopId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        botConfig: true,
        providerConfig: true,
        seller: true,
      },
    });

    if (!shop || !shop.providerConfig) {
      throw new NotFoundException("Shop or provider config not found.");
    }

    const buyerKey = decryptSecret(
      shop.providerConfig.buyerKeyEncrypted,
      this.config.encryptionKey,
    );

    if (!buyerKey) {
      throw new BadRequestException("Provider buyer key is missing.");
    }

    let products: ProviderProduct[];
    if (this.config.mockProviderEnabled && isMockBuyerKey(buyerKey)) {
      products = getMockProviderProducts();
    } else {
      try {
        products = await fetchProviderProducts({
          baseUrl: shop.providerConfig.baseUrl,
          buyerKey,
        });
      } catch (error) {
        throw new BadRequestException(this.formatProviderError(error));
      }
    }
    const result = await this.applyCatalogProducts(shop, products);

    return result.synced;
  }

  async applyCatalogProductsForShop(shopId: string, products: ProviderProduct[]) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        botConfig: true,
        providerConfig: true,
        seller: true,
      },
    });

    if (!shop || !shop.providerConfig) {
      throw new NotFoundException("Shop or provider config not found.");
    }

    return this.applyCatalogProducts(shop, products);
  }

  private async applyCatalogProducts(
    shop: ShopCatalogContext,
    products: ProviderProduct[],
  ) {
    if (!shop.providerConfig) {
      throw new NotFoundException("Shop provider config not found.");
    }

    const normalizedProducts = products.filter(
      (product) => String(product.externalId || "").trim() !== "",
    );
    const existingProducts = await this.prisma.sourceProduct.findMany({
      where: { shopId: shop.id },
      select: {
        externalProductId: true,
        available: true,
        sourcePrice: true,
        overrides: {
          where: { sellerId: shop.sellerId },
          select: { salePrice: true },
          take: 1,
        },
      },
    });
    const existingByExternalId = new Map(
      existingProducts.map((item) => [item.externalProductId, item]),
    );
    const stockNotifications: CatalogStockNotification[] = [];
    const syncedAt = new Date();

    for (const product of normalizedProducts) {
      const previous = existingByExternalId.get(product.externalId);
      const nextAvailable = product.hidden ? 0 : this.normalizeNullableNumber(product.available);
      const businessFields =
        shop.providerConfig.providerKind === ProviderKind.INTERNAL
          ? this.extractSyncedSourceBusinessFields(product.metadata)
          : {};
      const sourceProduct = await this.prisma.sourceProduct.upsert({
        where: {
          shopId_externalProductId: {
            shopId: shop.id,
            externalProductId: product.externalId,
          },
        },
        update: {
          sourceName: product.sourceName,
          sourceRawName: product.sourceRawName || product.sourceName,
          sourceDescription: product.description || product.rawDescription,
          sourcePrice: toDecimal(product.price),
          available: nextAvailable,
          totalCount: nextAvailable ?? 0,
          ...businessFields,
          metadataJson: product.metadata as Prisma.InputJsonValue,
          syncedAt,
        },
        create: {
          shopId: shop.id,
          externalProductId: product.externalId,
          providerName: shop.providerConfig.providerName,
          sourceName: product.sourceName,
          sourceRawName: product.sourceRawName || product.sourceName,
          sourceDescription: product.description || product.rawDescription,
          sourcePrice: toDecimal(product.price),
          available: nextAvailable,
          totalCount: nextAvailable ?? 0,
          internalSourceEnabled: shop.seller.tier === "ULTRA",
          ...businessFields,
          metadataJson: product.metadata as Prisma.InputJsonValue,
          syncedAt,
        },
      });

      const oldSourcePrice = previous?.sourcePrice != null ? Number(previous.sourcePrice) : null;
      const existingSalePrice = previous?.overrides?.[0]?.salePrice != null
        ? Number(previous.overrides[0].salePrice)
        : null;
      let newSalePrice: number;
      if (oldSourcePrice !== null && existingSalePrice !== null) {
        const delta = product.price - oldSourcePrice;
        newSalePrice = Math.max(product.price + 30000, existingSalePrice + delta);
      } else {
        newSalePrice = product.price + 30000;
      }

      await this.prisma.sellerProductOverride.upsert({
        where: {
          sellerId_sourceProductId: {
            sellerId: shop.sellerId,
            sourceProductId: sourceProduct.id,
          },
        },
        update: {
          salePrice: toDecimal(newSalePrice),
        },
        create: {
          sellerId: shop.sellerId,
          shopId: shop.id,
          sourceProductId: sourceProduct.id,
          displayName: product.sourceName,
          salePrice: toDecimal(product.price + 30000),
          enabled: true,
          hidden: false,
        },
      });

      if (
        previous &&
        previous.available !== null &&
        nextAvailable !== null &&
        Number.isFinite(previous.available) &&
        Number.isFinite(nextAvailable)
      ) {
        const addedQuantity = Math.max(
          0,
          Number(nextAvailable) - Number(previous.available),
        );

        if (addedQuantity > 0 && Number(nextAvailable) > 0) {
          stockNotifications.push({
            sourceProductId: sourceProduct.id,
            displayName: product.sourceName,
            addedQuantity,
            available: Number(nextAvailable),
          });
        }
      }
    }

    const incomingExternalIds = new Set(normalizedProducts.map((p) => p.externalId));
    const staleExternalIds = existingProducts
      .filter((p) => !incomingExternalIds.has(p.externalProductId))
      .map((p) => p.externalProductId);

    if (staleExternalIds.length > 0) {
      await this.prisma.sourceProduct.updateMany({
        where: {
          shopId: shop.id,
          externalProductId: { in: staleExternalIds },
        },
        data: { available: 0 },
      });
    }

    await this.prisma.shop.update({
      where: { id: shop.id },
      data: {
        lastCatalogSyncAt: syncedAt,
        status: "ACTIVE",
      },
    });

    if (shop.providerConfig.internalSourceConnectionId) {
      await this.prisma.downstreamSourceConnection.update({
        where: { id: shop.providerConfig.internalSourceConnectionId },
        data: {
          lastCatalogSyncAt: syncedAt,
        },
      }).catch(() => undefined);
    }

    const notified = shop.providerConfig.sourceNotificationSyncEnabled
      ? await this.notifyCatalogStockUpdates(
          shop.id,
          shop.botConfig?.telegramBotTokenEncrypted || null,
          stockNotifications,
        )
      : 0;

    return {
      synced: normalizedProducts.length,
      notified,
    };
  }

  private async notifyCatalogStockUpdates(
    shopId: string,
    encryptedBotToken: string | null,
    notifications: CatalogStockNotification[],
  ) {
    if (notifications.length === 0 || !encryptedBotToken) {
      return 0;
    }

    const token = decryptSecret(encryptedBotToken, this.config.encryptionKey);

    if (
      !token ||
      (this.config.mockTelegramEnabled && isMockBotToken(token))
    ) {
      return 0;
    }

    const customers = await this.prisma.customer.findMany({
      where: { shopId },
      select: {
        telegramChatId: true,
      },
    });

    if (customers.length === 0) {
      return 0;
    }

    for (const customer of customers) {
      for (const item of notifications) {
        await telegramSendMessage(
          token,
          customer.telegramChatId,
          [
            `📦 ${item.displayName}`,
            `➕ Thêm: ${item.addedQuantity}`,
            `📦 Tồn kho hiện tại: ${item.available}`,
          ].join("\n"),
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🛒 Mua ngay", callback_data: `buy:${item.sourceProductId}` }],
              ],
            },
          },
        ).catch(() => undefined);
      }
    }

    return notifications.length * customers.length;
  }

  private normalizeSourceWebhookProducts(body: Record<string, unknown>) {
    const products = this.extractSourceWebhookProductPayloads(body)
      .map((item) => this.normalizeSourceWebhookProduct(item))
      .filter((item): item is ProviderProduct => item !== null);
    const productsByExternalId = new Map(
      products.map((item) => [item.externalId, item]),
    );

    return Array.from(productsByExternalId.values());
  }

  private extractSourceWebhookProductPayloads(body: Record<string, unknown>) {
    const payloads: Array<Record<string, unknown>> = [];
    const arrayCandidates = [
      this.pickFirstDefined(body, [["products"]]),
      this.pickFirstDefined(body, [["items"]]),
      this.pickFirstDefined(body, [["catalog"]]),
      this.pickFirstDefined(body, [["productList"]]),
      this.pickFirstDefined(body, [["data", "products"]]),
      this.pickFirstDefined(body, [["data", "items"]]),
      this.pickFirstDefined(body, [["data", "catalog"]]),
      this.pickFirstDefined(body, [["data", "productList"]]),
      this.pickFirstDefined(body, [["payload", "products"]]),
      this.pickFirstDefined(body, [["payload", "items"]]),
    ];

    for (const candidate of arrayCandidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      for (const item of candidate) {
        if (this.isPlainRecord(item) && this.isLikelySourceWebhookProduct(item)) {
          payloads.push(item);
        }
      }
    }

    if (payloads.length > 0) {
      return payloads;
    }

    const singleCandidates = [
      this.pickFirstDefined(body, [["product"]]),
      this.pickFirstDefined(body, [["item"]]),
      this.pickFirstDefined(body, [["data", "product"]]),
      this.pickFirstDefined(body, [["data", "item"]]),
      this.pickFirstDefined(body, [["payload", "product"]]),
    ];

    for (const candidate of singleCandidates) {
      if (this.isPlainRecord(candidate) && this.isLikelySourceWebhookProduct(candidate)) {
        payloads.push(candidate);
      }
    }

    if (payloads.length > 0) {
      return payloads;
    }

    if (this.isLikelySourceWebhookProduct(body)) {
      payloads.push(body);
    }

    const dataCandidate = this.pickFirstDefined(body, [["data"]]);

    if (
      payloads.length === 0 &&
      this.isPlainRecord(dataCandidate) &&
      this.isLikelySourceWebhookProduct(dataCandidate)
    ) {
      payloads.push(dataCandidate);
    }

    return payloads;
  }

  private normalizeSourceWebhookProduct(
    payload: Record<string, unknown>,
  ): ProviderProduct | null {
    const externalId = String(
      this.pickFirstDefined(payload, [
        ["_id"],
        ["id"],
        ["productId"],
        ["product_id"],
        ["externalProductId"],
        ["external_id"],
      ]) || "",
    ).trim();
    const sourceName = String(
      this.pickFirstDefined(payload, [
        ["product_name"],
        ["productName"],
        ["name"],
        ["title"],
      ]) || "",
    ).trim();
    const availableValue = this.pickFirstDefined(payload, [
      ["stats", "available"],
      ["available"],
      ["stock"],
      ["quantity"],
      ["inventory"],
      ["count"],
      ["totalCount"],
      ["total_count"],
    ]);
    const priceValue = this.pickFirstDefined(payload, [
      ["walletPricing"],
      ["wallet_pricing"],
      ["pricing"],
      ["sourcePrice"],
      ["source_price"],
      ["price"],
      ["amount"],
      ["cost"],
    ]);

    if (!externalId || (!sourceName && availableValue === undefined && priceValue === undefined)) {
      return null;
    }

    const slotDurationsSource = this.pickFirstDefined(payload, [
      ["slotDurations"],
      ["slot_durations"],
    ]);
    const slotDurations = Array.isArray(slotDurationsSource)
      ? slotDurationsSource
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item))
      : [];
    const quantityFixed = Number(
      this.pickFirstDefined(payload, [["quantityFixed"], ["quantity_fixed"]]) || 1,
    );

    return {
      externalId,
      sourceName: sourceName || externalId,
      sourceRawName:
        String(
          this.pickFirstDefined(payload, [
            ["product_name_raw"],
            ["rawName"],
            ["raw_name"],
          ]) || sourceName || externalId,
        ).trim() || null,
      description:
        String(
          this.pickFirstDefined(payload, [["description"], ["desc"]]) || "",
        ).trim() || null,
      rawDescription:
        String(
          this.pickFirstDefined(payload, [
            ["description_raw"],
            ["rawDescription"],
            ["raw_description"],
          ]) || "",
        ).trim() || null,
      price: Number.isFinite(Number(priceValue)) ? Number(priceValue) : 0,
      available: this.normalizeNullableNumber(availableValue),
      hidden: Boolean(
        this.pickFirstDefined(payload, [["hidden"]]) || false,
      ),
      isSlotProduct: Boolean(
        this.pickFirstDefined(payload, [["isSlotProduct"], ["is_slot_product"]]) || false,
      ),
      requiresCustomerEmail: Boolean(
        this.pickFirstDefined(payload, [
          ["requiresCustomerEmail"],
          ["requires_customer_email"],
        ]) || false,
      ),
      requiresSlotMonths: Boolean(
        this.pickFirstDefined(payload, [
          ["requiresSlotMonths"],
          ["requires_slot_months"],
        ]) || false,
      ),
      slotDurations,
      quantityFixed:
        Number.isFinite(quantityFixed) && quantityFixed > 0
          ? Math.floor(quantityFixed)
          : 1,
      walletCurrency:
        String(
          this.pickFirstDefined(payload, [["walletCurrency"], ["currency"]]) || "VND",
        ).trim() || "VND",
      metadata: payload,
    };
  }

  private isLikelySourceWebhookProduct(value: unknown) {
    if (!this.isPlainRecord(value)) {
      return false;
    }

    const externalId = this.pickFirstDefined(value, [
      ["_id"],
      ["id"],
      ["productId"],
      ["product_id"],
      ["externalProductId"],
      ["external_id"],
    ]);
    const sourceName = this.pickFirstDefined(value, [
      ["product_name"],
      ["productName"],
      ["name"],
      ["title"],
    ]);
    const availableValue = this.pickFirstDefined(value, [
      ["stats", "available"],
      ["available"],
      ["stock"],
      ["quantity"],
      ["inventory"],
      ["count"],
      ["totalCount"],
      ["total_count"],
    ]);
    const priceValue = this.pickFirstDefined(value, [
      ["walletPricing"],
      ["wallet_pricing"],
      ["pricing"],
      ["sourcePrice"],
      ["source_price"],
      ["price"],
      ["amount"],
      ["cost"],
    ]);

    return Boolean(
      String(externalId || "").trim() &&
        (
          String(sourceName || "").trim() ||
          availableValue !== undefined ||
          priceValue !== undefined
        ),
    );
  }

  private pickFirstDefined(
    source: Record<string, unknown>,
    paths: string[][],
  ): unknown {
    for (const path of paths) {
      const value = this.getNestedValue(source, path);

      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === "string" && value.trim() === "") {
        continue;
      }

      return value;
    }

    return undefined;
  }

  private getNestedValue(source: unknown, path: string[]) {
    let current: unknown = source;

    for (const segment of path) {
      if (!this.isPlainRecord(current) || !(segment in current)) {
        return undefined;
      }

      current = current[segment];
    }

    return current;
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private normalizeNullableNumber(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private extractSyncedSourceBusinessFields(metadata: Record<string, unknown>) {
    const productFamily = this.normalizeEnumValue(
      metadata.productFamily,
      SourceProductFamily,
    );
    const accountType = this.normalizeEnumValue(
      metadata.accountType,
      SourceAccountType,
    );
    const durationType = this.normalizeEnumValue(
      metadata.durationType,
      SourceDurationType,
    );
    const sourceDeliveryMode = this.normalizeEnumValue(
      metadata.sourceDeliveryMode ?? metadata.deliveryMode,
      SourceDeliveryMode,
    );
    const warrantyPolicy = this.normalizeEnumValue(
      metadata.warrantyPolicy,
      SourceWarrantyPolicy,
    );

    return {
      productFamily,
      productFamilyOther:
        productFamily === SourceProductFamily.OTHER
          ? String(metadata.productFamilyOther || "").trim() || null
          : null,
      accountType,
      accountTypeOther:
        accountType === SourceAccountType.OTHER
          ? String(metadata.accountTypeOther || "").trim() || null
          : null,
      durationType,
      durationTypeOther:
        durationType === SourceDurationType.OTHER
          ? String(metadata.durationTypeOther || "").trim() || null
          : null,
      sourceDeliveryMode,
      warrantyPolicy,
    };
  }

  private normalizeEnumValue<T extends string>(
    value: unknown,
    enumObject: Record<string, T>,
  ) {
    const normalized = String(value || "").trim().toUpperCase();

    if (!normalized) {
      return undefined;
    }

    return Object.values(enumObject).includes(normalized as T)
      ? (normalized as T)
      : undefined;
  }

  async getSellerShop(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      include: {
        shops: {
          include: {
            botConfig: true,
            providerConfig: true,
            paymentConfig: true,
          },
          orderBy: {
            createdAt: "asc",
          },
          take: 1,
        },
      },
    });

    if (!seller || seller.shops.length === 0) {
      throw new NotFoundException("Seller shop not found.");
    }

    const shop = seller.shops[0];

    if (!shop) {
      throw new NotFoundException("Seller shop not found.");
    }

    return shop;
  }

  async getSellerShopByShopId(shopId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        seller: true,
        botConfig: true,
        providerConfig: true,
        paymentConfig: true,
      },
    });

    if (!shop) {
      throw new NotFoundException("Shop not found.");
    }

    return shop;
  }

  async getCatalogViewForShop(shopId: string) {
    const products = await this.prisma.sourceProduct.findMany({
      where: { shopId },
      include: {
        overrides: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return products.map((product) => {
      const override = product.overrides[0];
      const metadata =
        product.metadataJson && typeof product.metadataJson === "object" && !Array.isArray(product.metadataJson)
          ? (product.metadataJson as Record<string, unknown>)
          : {};
      const isManual =
        String(product.providerName || "").toLowerCase() === "manual" || metadata.manual === true;

      return {
        id: product.id,
        sourceProductId: product.externalProductId,
        providerName: product.providerName,
        sourceName: product.sourceName,
        displayName: override?.displayName || product.sourceName,
        description: product.sourceDescription,
        sourcePrice: decimalToNumber(product.sourcePrice),
        salePrice: decimalToNumber(override?.salePrice || product.sourcePrice),
        available: product.available,
        soldCount: product.soldCount,
        totalCount: product.totalCount,
        enabled: override?.enabled ?? true,
        hidden: override?.hidden ?? false,
        hiddenVi: override?.hiddenVi ?? false,
        hiddenEn: override?.hiddenEn ?? false,
        salePriceUsd: override?.salePriceUsd ? decimalToNumber(override.salePriceUsd) : null,
        promoText: override?.promoText || null,
        isManual,
        deliveryText:
          typeof metadata.deliveryText === "string" ? metadata.deliveryText : null,
        internalSourceEnabled: product.internalSourceEnabled,
        internalSourcePrice: product.internalSourcePrice
          ? decimalToNumber(product.internalSourcePrice)
          : null,
        productFamily: product.productFamily?.toLowerCase() || null,
        productFamilyOther: product.productFamilyOther || null,
        accountType: product.accountType?.toLowerCase() || null,
        accountTypeOther: product.accountTypeOther || null,
        durationType: product.durationType?.toLowerCase() || null,
        durationTypeOther: product.durationTypeOther || null,
        sourceDeliveryMode: product.sourceDeliveryMode?.toLowerCase() || null,
        warrantyPolicy: product.warrantyPolicy?.toLowerCase() || null,
        productIcon: product.productIcon || null,
        syncedAt: product.syncedAt,
      };
    });
  }

  async getProviderBalanceForUser(userId: string) {
    const shop = await this.getSellerShop(userId);
    return this.getProviderBalanceForShopId(shop.id);
  }

  async getProviderBalanceForShopId(shopId: string): Promise<ProviderBalanceResult> {
    const shop = await this.getSellerShopByShopId(shopId);

    if (!shop.providerConfig) {
      throw new BadRequestException("Provider buyer key is missing.");
    }

    if (shop.providerConfig.providerKind === ProviderKind.INTERNAL) {
      const connectionId = shop.providerConfig.internalSourceConnectionId;
      if (!connectionId) throw new BadRequestException("Internal source connection not found.");
      const connection = await this.prisma.downstreamSourceConnection.findUnique({
        where: { id: connectionId },
        include: { upstreamShop: true },
      });
      if (!connection) throw new BadRequestException("Internal source connection not found.");
      const balance = decimalToNumber(connection.balance);
      return {
        success: true,
        walletCurrency: connection.currency,
        balance,
        balanceVnd: balance,
        balanceUsd: null,
        balanceText: `${balance.toLocaleString("vi-VN")} ${connection.currency}`,
        usdtBalance: 0,
        updatedAt: connection.updatedAt.toISOString(),
        requesterName: null,
        requesterChatId: null,
        botSource: connection.upstreamShop?.name || "ULTRA",
        rawPayload: {},
      };
    }

    const buyerKey = decryptSecret(
      shop.providerConfig.buyerKeyEncrypted,
      this.config.encryptionKey,
    );

    if (!buyerKey) {
      throw new BadRequestException("Provider buyer key is missing.");
    }

    if (String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true" && isMockBuyerKey(buyerKey)) {
      return {
        success: true,
        walletCurrency: "VND",
        balance: 0,
        balanceVnd: 0,
        balanceUsd: null,
        balanceText: "0 VND",
        usdtBalance: 0,
        updatedAt: new Date().toISOString(),
        requesterName: null,
        requesterChatId: null,
        botSource: "mock",
        rawPayload: { mock: true },
      };
    }

    try {
      return await fetchProviderBalance({
        baseUrl: shop.providerConfig.baseUrl,
        buyerKey,
        providerName: shop.providerConfig.providerName,
      });
    } catch (error) {
      throw new BadRequestException(this.formatProviderError(error));
    }
  }

  private formatProviderError(error: unknown) {
    const typed = error as {
      message?: string;
      code?: string;
      response?: {
        status?: number;
        data?: {
          message?: string;
          desc?: string;
          error?: string;
        };
      };
    };
    const upstreamMessage =
      typed.response?.data?.message ||
      typed.response?.data?.desc ||
      typed.response?.data?.error ||
      typed.message ||
      "";

    if (typed.code === "ECONNABORTED") {
      return "Không thể kết nối nguồn vì request quá thời gian. Hãy kiểm tra Provider base URL rồi thử lại.";
    }

    if (typed.response?.status === 401 || typed.response?.status === 403) {
      return "Buyer key không hợp lệ hoặc không có quyền truy cập nguồn.";
    }

    if (typed.response?.status === 404) {
      return "Provider base URL không đúng hoặc nguồn không có API sản phẩm.";
    }

    if (upstreamMessage) {
      return `Không thể xác thực nguồn: ${upstreamMessage}`;
    }

    return "Không thể xác thực nguồn. Hãy kiểm tra Provider base URL và Buyer key.";
  }

  /**
   * Find the first PaymentConfig that has Binance Pay enabled.
   * Used by the webhook controller to identify which shop a Binance Pay
   * notification belongs to when BINANCE_PAY_SHOP_ID env var is not set.
   */
  async findFirstShopWithBinancePayEnabled(): Promise<{ shopId: string } | null> {
    const config = await this.prisma.paymentConfig.findFirst({
      where: { binancePayEnabled: true },
      select: { shopId: true },
      orderBy: { createdAt: "asc" },
    });

    return config ?? null;
  }
}
