import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { API_PREFIX, RESTOCK_NOTI_DEDUP_TTL_MS, restockNotiDedupKey } from "@reseller/shared";
import {
  DownstreamSourceConnectionStatus,
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
  isRoboticvnBaseUrl,
  maskSecret,
  renderRestockHtml,
  resolveRestockTemplate,
  telegramDeleteWebhook,
  telegramGetMe,
  telegramSendMessage,
  telegramSetCommands,
  telegramSetWebhook,
  verifyProviderConnection,
} from "@reseller/shared/server";
import type { ProviderBalanceResult, ProviderProduct } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { CacheService } from "../lib/cache.service";
import { PrismaService } from "../db/prisma.service";
import { OkxPersonalApiService } from "../lib/okx-personal-api.service";
import { decimalToNumber, slugify, toDecimal } from "../lib/utils";

import type { AuthenticatedUser } from "../types";
import type { UpdateBotConfigDto, UpdateShopDto } from "./shops.dto";

import { PRO_COMMANDS, ULTRA_COMMANDS } from "../lib/bot-commands";

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

// PRO per-connection overrides layered on top of an inherited ULTRA template.
type TemplateOverrides = {
  groups?: Record<string, { name?: string; position?: number; hidden?: boolean }>;
  products?: Record<string, { position?: number }>;
};

@Injectable()
export class ShopsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(forwardRef(() => OkxPersonalApiService))
    private readonly okxApi: OkxPersonalApiService,
    @Inject(CacheService)
    private readonly cache: CacheService,
  ) {}

  async verifyOkxPersonal(
    user: AuthenticatedUser,
    body: { apiKey?: string; secretKey?: string; passphrase?: string },
  ) {
    const shop = await this.getSellerShop(user.id);
    const cfg = shop.paymentConfig;
    const apiKey = (body.apiKey || "").trim()
      || this.safeDecryptSecret(cfg?.okxPersonalApiKeyEncrypted).trim();
    const secret = (body.secretKey || "").trim()
      || this.safeDecryptSecret(cfg?.okxPersonalSecretKeyEncrypted).trim();
    const passphrase = (body.passphrase || "").trim()
      || this.safeDecryptSecret(cfg?.okxPersonalPassphraseEncrypted).trim();
    if (!apiKey || !secret || !passphrase) {
      throw new BadRequestException(
        "Cần đủ 3 thông tin: API Key + Secret Key + Passphrase.",
      );
    }
    const result = await this.okxApi.verifyCredentials(apiKey, secret, passphrase);
    return { ok: true, uid: result.uid, level: result.level || null };
  }

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
        tagline: dto.tagline !== undefined ? (dto.tagline?.trim() || null) : undefined,
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
      priceMarkupPercent: providerConfig?.priceMarkupPercent != null
        ? decimalToNumber(providerConfig.priceMarkupPercent)
        : null,
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
      pay2sPartnerCodeMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.pay2sPartnerCodeEncrypted),
      ),
      pay2sAccessKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.pay2sAccessKeyEncrypted),
      ),
      pay2sSecretKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.pay2sSecretKeyEncrypted),
      ),
      pay2sBankAccount: paymentConfig?.pay2sBankAccount || "",
      pay2sBankId: paymentConfig?.pay2sBankId || "",
      pay2sWebhookTokenMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.pay2sWebhookTokenEncrypted),
      ),
      web2mAccountNumber: paymentConfig?.web2mAccountNumber || "",
      web2mBankCode: paymentConfig?.web2mBankCode || "",
      web2mPasswordMasked: maskSecret(this.safeDecryptSecret(paymentConfig?.web2mPasswordEncrypted)),
      web2mTokenMasked: maskSecret(this.safeDecryptSecret(paymentConfig?.web2mTokenEncrypted)),
      web2mAccessTokenMasked: maskSecret(this.safeDecryptSecret(paymentConfig?.web2mAccessTokenEncrypted)),
      binanceUid: paymentConfig?.binanceUid || "",
      okxUid: paymentConfig?.okxUid || "",
      usdtTrc20Address: paymentConfig?.usdtTrc20Address || "",
      usdtBep20Address: paymentConfig?.usdtBep20Address || "",
      usdtSolanaAddress: paymentConfig?.usdtSolanaAddress || "",
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
      okxPersonalApiKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.okxPersonalApiKeyEncrypted),
      ),
      okxPersonalSecretKeyMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.okxPersonalSecretKeyEncrypted),
      ),
      okxPersonalPassphraseMasked: maskSecret(
        this.safeDecryptSecret(paymentConfig?.okxPersonalPassphraseEncrypted),
      ),
      okxPersonalApiEnabled: paymentConfig?.okxPersonalApiEnabled ?? false,
      telegramBotId: botConfig?.telegramBotId || null,
      telegramBotUsername: botConfig?.telegramBotUsername || null,
      ownerTelegramUserId: botConfig?.ownerTelegramUserId || null,
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
      showOutOfStock: (botConfig?.customizationJson as Record<string, unknown> | null)?.showOutOfStock === true,
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
          tagline: dto.shopTagline !== undefined ? (dto.shopTagline?.trim() || null) : undefined,
          supportTelegram: dto.supportTelegram !== undefined ? (dto.supportTelegram || null) : undefined,
          supportZalo: dto.supportZalo !== undefined ? (dto.supportZalo || null) : undefined,
          logoUrl: dto.logoUrl !== undefined ? (dto.logoUrl || null) : undefined,
          storefrontMode: dto.storefrontMode ?? undefined,
          slug: dto.shopName ? slugify(dto.shopName) || shop.slug : undefined,
        },
      });

      const existingCust = (shop.botConfig?.customizationJson as Record<string, unknown> | null) ?? {};
      const custPatch: Record<string, unknown> = {};
      if (dto.showOutOfStock !== undefined) custPatch.showOutOfStock = dto.showOutOfStock;
      const mergedCust = Object.keys(custPatch).length > 0 ? { ...existingCust, ...custPatch } : undefined;

      await tx.botConfig.upsert({
        where: { shopId: shop.id },
        update: {
          telegramBotTokenEncrypted: dto.botToken
            ? encryptSecret(dto.botToken, encryptionKey)
            : undefined,
          ownerTelegramUserId: dto.ownerTelegramUserId ?? undefined,
          ...(mergedCust !== undefined ? { customizationJson: mergedCust as Prisma.InputJsonValue } : {}),
        },
        create: {
          shopId: shop.id,
          telegramBotTokenEncrypted: dto.botToken
            ? encryptSecret(dto.botToken, encryptionKey)
            : "",
          ownerTelegramUserId: dto.ownerTelegramUserId ?? null,
          webhookStatus: "DISABLED",
          deliveryMode: "POLLING",
          ...(mergedCust !== undefined ? { customizationJson: mergedCust as Prisma.InputJsonValue } : {}),
        },
      });

      const resolvedProviderBaseUrl = dto.providerBaseUrl || this.config.providerBaseUrl;
      const resolvedProviderName = isRoboticvnBaseUrl(resolvedProviderBaseUrl)
        ? "roboticvn"
        : this.config.providerName;

      await tx.providerConfig.upsert({
        where: { shopId: shop.id },
        update: {
          providerName: resolvedProviderName,
          baseUrl: resolvedProviderBaseUrl,
          ...(dto.providerBuyerKey
            ? {
                buyerKeyEncrypted: encryptSecret(dto.providerBuyerKey, encryptionKey),
                providerKind: ProviderKind.EXTERNAL,
                internalSourceConnectionId: null,
                connectionStatus: "PENDING",
              }
            : {}),
          sourceNotificationSyncEnabled: dto.sourceNotificationSyncEnabled,
          priceMarkupPercent: dto.priceMarkupPercent !== undefined
            ? (dto.priceMarkupPercent === null ? null : toDecimal(dto.priceMarkupPercent))
            : undefined,
        },
        create: {
          shopId: shop.id,
          providerName: resolvedProviderName,
          baseUrl: resolvedProviderBaseUrl,
          buyerKeyEncrypted: dto.providerBuyerKey
            ? encryptSecret(dto.providerBuyerKey, encryptionKey)
            : "",
          providerKind: ProviderKind.EXTERNAL,
          sourceWebhookKey: this.createSourceWebhookKey(),
          sourceNotificationSyncEnabled: dto.sourceNotificationSyncEnabled ?? true,
          priceMarkupPercent: dto.priceMarkupPercent != null ? toDecimal(dto.priceMarkupPercent) : null,
          connectionStatus: "PENDING",
        },
      });

      // Reconcile stale ULTRA connections. A live ULTRA link always coincides with
      // providerKind=INTERNAL + internalSourceConnectionId set (see seller-source-connection.service).
      // So if this shop is now on an EXTERNAL (canboso) source with no internalSourceConnectionId but
      // still has an ACTIVE DownstreamSourceConnection, that row is stale — disable it. Otherwise the
      // bot-config UI keeps reading it as "connected to ULTRA" and shows the "đổi key ULTRA"
      // placeholder instead of the saved canboso buyer key. Runs on every save, so it also heals the
      // already-switched shops that were left inconsistent before this fix (no re-paste needed).
      const pcAfter = await tx.providerConfig.findUnique({
        where: { shopId: shop.id },
        select: { providerKind: true, internalSourceConnectionId: true, baseUrl: true },
      });
      if (pcAfter && pcAfter.providerKind === ProviderKind.EXTERNAL && !pcAfter.internalSourceConnectionId) {
        await tx.downstreamSourceConnection.updateMany({
          where: { downstreamShopId: shop.id, status: DownstreamSourceConnectionStatus.ACTIVE },
          data: { status: DownstreamSourceConnectionStatus.DISABLED },
        });
        // ULTRA-connect set baseUrl to our own internal buyer API (`<appPublicUrl>/api/v1`). After
        // switching to canboso the FE keeps echoing that stale URL back, so provider calls hit our
        // internal endpoint (expects an isk_ key) and reject the canboso tgb_ key with 400
        // "Buyer key không hợp lệ". Reset a leaked internal baseUrl to the external provider default.
        const internalBase = `${String(this.config.appPublicUrl || "").replace(/\/$/, "")}/api/v1`;
        if (pcAfter.baseUrl && pcAfter.baseUrl.replace(/\/$/, "") === internalBase) {
          await tx.providerConfig.update({
            where: { shopId: shop.id },
            data: { baseUrl: this.config.providerBaseUrl },
          });
        }
      }

      const explicitProvider = dto.paymentProvider && ["PAYOS", "PAY2S", "WEB2M", "BINANCE_PAY", "MOCK", "BINANCE", "OKX", "USDT_TRC20"].includes(dto.paymentProvider)
        ? (dto.paymentProvider as any)
        : undefined;

      // Plain (non-encrypted) payment fields: the bot-config form sends `null` for a field the
      // seller cleared, and OMITS the field entirely on partial saves (e.g. the notify toggle).
      // `?? undefined` collapsed both to undefined → Prisma skipped → a cleared UID/address kept
      // its old value. Distinguish them: undefined (omitted) = keep, null (cleared) = wipe.
      const setOrKeep = (v: string | null | undefined) => (v === undefined ? undefined : v);

      await tx.paymentConfig.upsert({
        where: { shopId: shop.id },
        update: {
          provider: explicitProvider
            ?? (shouldUsePayOS
              ? "PAYOS"
              : dto.binancePayEnabled === true || (dto.binancePayApiKey && dto.binancePaySecretKey)
                ? "BINANCE_PAY"
                : undefined),
          payosClientIdEncrypted: dto.payosClientId
            ? encryptSecret(dto.payosClientId, encryptionKey)
            : undefined,
          payosApiKeyEncrypted: dto.payosApiKey
            ? encryptSecret(dto.payosApiKey, encryptionKey)
            : undefined,
          payosChecksumKeyEncrypted: dto.payosChecksumKey
            ? encryptSecret(dto.payosChecksumKey, encryptionKey)
            : undefined,
          pay2sPartnerCodeEncrypted: dto.pay2sPartnerCode
            ? encryptSecret(dto.pay2sPartnerCode, encryptionKey)
            : undefined,
          pay2sAccessKeyEncrypted: dto.pay2sAccessKey
            ? encryptSecret(dto.pay2sAccessKey, encryptionKey)
            : undefined,
          pay2sSecretKeyEncrypted: dto.pay2sSecretKey
            ? encryptSecret(dto.pay2sSecretKey, encryptionKey)
            : undefined,
          pay2sBankAccount: setOrKeep(dto.pay2sBankAccount),
          pay2sBankId: setOrKeep(dto.pay2sBankId),
          pay2sWebhookTokenEncrypted: dto.pay2sWebhookToken
            ? encryptSecret(dto.pay2sWebhookToken, encryptionKey)
            : undefined,
          web2mAccountNumber: setOrKeep(dto.web2mAccountNumber),
          web2mBankCode: setOrKeep(dto.web2mBankCode),
          web2mPasswordEncrypted: dto.web2mPassword
            ? encryptSecret(dto.web2mPassword, encryptionKey)
            : undefined,
          web2mTokenEncrypted: dto.web2mToken
            ? encryptSecret(dto.web2mToken, encryptionKey)
            : undefined,
          web2mAccessTokenEncrypted: dto.web2mAccessToken
            ? encryptSecret(dto.web2mAccessToken, encryptionKey)
            : undefined,
          binanceUid: setOrKeep(dto.binanceUid),
          okxUid: setOrKeep(dto.okxUid),
          usdtTrc20Address: setOrKeep(dto.usdtTrc20Address),
          usdtBep20Address: setOrKeep(dto.usdtBep20Address),
          usdtSolanaAddress: setOrKeep(dto.usdtSolanaAddress),
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
          okxPersonalApiKeyEncrypted: dto.okxPersonalApiKey
            ? encryptSecret(dto.okxPersonalApiKey, encryptionKey)
            : undefined,
          okxPersonalSecretKeyEncrypted: dto.okxPersonalSecretKey
            ? encryptSecret(dto.okxPersonalSecretKey, encryptionKey)
            : undefined,
          okxPersonalPassphraseEncrypted: dto.okxPersonalPassphrase
            ? encryptSecret(dto.okxPersonalPassphrase, encryptionKey)
            : undefined,
          okxPersonalApiEnabled: dto.okxPersonalApiEnabled ?? undefined,
        },
        create: {
          shopId: shop.id,
          provider:
            explicitProvider
            ?? (shouldUsePayOS || this.config.paymentMode === "payos"
              ? "PAYOS"
              : dto.binancePayApiKey && dto.binancePaySecretKey
                ? "BINANCE_PAY"
                : "MOCK"),
          payosClientIdEncrypted: dto.payosClientId
            ? encryptSecret(dto.payosClientId, encryptionKey)
            : null,
          payosApiKeyEncrypted: dto.payosApiKey
            ? encryptSecret(dto.payosApiKey, encryptionKey)
            : null,
          payosChecksumKeyEncrypted: dto.payosChecksumKey
            ? encryptSecret(dto.payosChecksumKey, encryptionKey)
            : null,
          pay2sPartnerCodeEncrypted: dto.pay2sPartnerCode
            ? encryptSecret(dto.pay2sPartnerCode, encryptionKey)
            : null,
          pay2sAccessKeyEncrypted: dto.pay2sAccessKey
            ? encryptSecret(dto.pay2sAccessKey, encryptionKey)
            : null,
          pay2sSecretKeyEncrypted: dto.pay2sSecretKey
            ? encryptSecret(dto.pay2sSecretKey, encryptionKey)
            : null,
          pay2sBankAccount: dto.pay2sBankAccount ?? null,
          pay2sBankId: dto.pay2sBankId ?? null,
          pay2sWebhookTokenEncrypted: dto.pay2sWebhookToken
            ? encryptSecret(dto.pay2sWebhookToken, encryptionKey)
            : null,
          web2mAccountNumber: dto.web2mAccountNumber ?? null,
          web2mBankCode: dto.web2mBankCode ?? null,
          web2mPasswordEncrypted: dto.web2mPassword
            ? encryptSecret(dto.web2mPassword, encryptionKey)
            : null,
          web2mTokenEncrypted: dto.web2mToken
            ? encryptSecret(dto.web2mToken, encryptionKey)
            : null,
          web2mAccessTokenEncrypted: dto.web2mAccessToken
            ? encryptSecret(dto.web2mAccessToken, encryptionKey)
            : null,
          binanceUid: dto.binanceUid ?? null,
          okxUid: dto.okxUid ?? null,
          usdtTrc20Address: dto.usdtTrc20Address ?? null,
          usdtBep20Address: dto.usdtBep20Address ?? null,
          usdtSolanaAddress: dto.usdtSolanaAddress ?? null,
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
          okxPersonalApiKeyEncrypted: dto.okxPersonalApiKey
            ? encryptSecret(dto.okxPersonalApiKey, encryptionKey)
            : null,
          okxPersonalSecretKeyEncrypted: dto.okxPersonalSecretKey
            ? encryptSecret(dto.okxPersonalSecretKey, encryptionKey)
            : null,
          okxPersonalPassphraseEncrypted: dto.okxPersonalPassphrase
            ? encryptSecret(dto.okxPersonalPassphrase, encryptionKey)
            : null,
          okxPersonalApiEnabled: dto.okxPersonalApiEnabled ?? false,
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

    if (providerConfig?.providerKind === ProviderKind.INTERNAL) {
      const connectionId = providerConfig.internalSourceConnectionId;
      const connection = connectionId
        ? await this.prisma.downstreamSourceConnection.findUnique({ where: { id: connectionId } })
        : null;
      const isActive = connection?.status === "ACTIVE";
      await this.prisma.providerConfig.update({
        where: { shopId: shop.id },
        data: {
          connectionStatus: isActive ? "VERIFIED" : "FAILED",
          lastVerifiedAt: new Date(),
        },
      });
      const catalog = await this.getCatalogViewForShop(shop.id);
      return {
        ...(await this.getBotConfig(user)),
        providerSampleSize: catalog.length,
      };
    }

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
    // Per-shop catalog-sync mutex (shared key + protocol with the worker). Without it, concurrent
    // syncs — source→downstream cascade fan-out, the worker scheduler, connect-time + manual
    // triggers — each read `available` before any of them persists and re-fire the SAME restock
    // notification ("Thông báo nhập kho" spam). We wait briefly so a requested sync still runs once
    // the in-flight one finishes — by then the persisted `available` makes the delta 0 → no dup.
    const lockKey = `worker:catalog-sync:scheduled:${shopId}`;
    const lockToken = await this.cache.acquireLock(lockKey, 120_000, 10_000);
    try {
      return await this.syncCatalogForShopInner(shopId);
    } finally {
      await this.cache.releaseLock(lockKey, lockToken);
    }
  }

  private async syncCatalogForShopInner(shopId: string) {
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

    let products: ProviderProduct[];

    if (shop.providerConfig.providerKind === ProviderKind.INTERNAL) {
      const connectionId = shop.providerConfig.internalSourceConnectionId;
      if (!connectionId) {
        throw new BadRequestException("Internal source connection not configured.");
      }
      const connection = await this.prisma.downstreamSourceConnection.findUnique({
        where: { id: connectionId },
      });
      if (!connection || connection.status !== "ACTIVE") {
        throw new BadRequestException("Internal source connection is not active.");
      }
      const upstreamProducts = await this.prisma.sourceProduct.findMany({
        where: { shopId: connection.upstreamShopId, internalSourceEnabled: true },
        orderBy: { createdAt: "asc" },
      });
      const connCustomer = connection.downstreamTelegramChatId
        ? await this.prisma.customer.findFirst({
            where: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
            select: { discountPercent: true },
          })
        : null;
      const connDiscount = Number(connCustomer?.discountPercent ?? 0);
      products = upstreamProducts.map((p) => ({
        externalId: p.id,
        sourceName: p.sourceName,
        sourceRawName: p.sourceRawName || p.sourceName,
        description: p.sourceDescription,
        rawDescription: p.sourceDescription,
        price: (() => {
          const base = p.internalSourcePrice != null ? Number(p.internalSourcePrice) : Number(p.sourcePrice);
          return connDiscount > 0 ? Math.round(base * (1 - connDiscount / 100)) : base;
        })(),
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
          productPackage: (p as any).productPackage ?? null,
          accountType: p.accountType ?? null,
          accountTypeOther: p.accountTypeOther ?? null,
          durationType: p.durationType ?? null,
          durationTypeOther: p.durationTypeOther ?? null,
          sourceDeliveryMode: p.sourceDeliveryMode ?? null,
          deliveryMode: p.sourceDeliveryMode ?? null,
          warrantyPolicy: p.warrantyPolicy ?? null,
          internalSourceEnabled: p.internalSourceEnabled,
          internalSourcePrice: p.internalSourcePrice != null ? Number(p.internalSourcePrice) : null,
        },
      }));
    } else {
      const buyerKey = decryptSecret(
        shop.providerConfig.buyerKeyEncrypted,
        this.config.encryptionKey,
      );

      if (!buyerKey) {
        throw new BadRequestException("Provider buyer key is missing.");
      }

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
        providerName: true,
        available: true,
        sourcePrice: true,
        sourceDescriptionLocked: true,
        productIcon: true,
        iconCustomEmojiId: true,
        imageUrl: true,
        productFamily: true,
        metadataJson: true,
        overrides: {
          where: { sellerId: shop.sellerId },
          select: { salePrice: true, displayNameLocked: true, salePriceLocked: true },
          take: 1,
        },
      },
    });
    const existingByExternalId = new Map(
      existingProducts.map((item) => [item.externalProductId, item]),
    );
    const stockNotifications: CatalogStockNotification[] = [];
    const syncedAt = new Date();

    // Pre-load admin template defaults once for the whole batch (perf)
    const adminTplDefaults = await this.loadAdminTemplateProductDefaultsByFamily();
    const adminFamilies = await this.prisma.productFamily.findMany({
      where: { isActive: true },
      select: { key: true, label: true, emoji: true, customEmojiId: true },
    });
    const adminFamilyByKey = new Map(adminFamilies.map((f) => [f.key, f] as const));

    for (const product of normalizedProducts) {
      const previous = existingByExternalId.get(product.externalId);
      const nextAvailable = product.hidden ? 0 : this.normalizeNullableNumber(product.available);
      const rawBusinessFields = this.extractSyncedSourceBusinessFields(product.metadata);
      // Auto-detect family: ưu tiên dữ liệu DB cũ → metadata → name detect
      const detectedFamily = previous?.productFamily
        ?? rawBusinessFields.productFamily
        ?? this.detectFamilyFromName(product.sourceName, adminFamilies)
        ?? undefined;
      // Inject admin template defaults nhưng KHÔNG ghi đè giá trị seller đã set
      const adminMatch = detectedFamily ? adminTplDefaults[detectedFamily] : null;
      const famRow = detectedFamily ? adminFamilyByKey.get(detectedFamily) : undefined;
      const businessFields = {
        ...rawBusinessFields,
        productFamily: detectedFamily,
        // Ưu tiên: previous (seller đã set) → canboso → admin template → family catalog
        productIcon:
          previous?.productIcon
            ?? rawBusinessFields.productIcon
            ?? adminMatch?.icon
            ?? famRow?.emoji
            ?? undefined,
        iconCustomEmojiId:
          previous?.iconCustomEmojiId
            ?? rawBusinessFields.iconCustomEmojiId
            ?? adminMatch?.customEmojiId
            ?? famRow?.customEmojiId
            ?? undefined,
        imageUrl:
          previous?.imageUrl
            ?? rawBusinessFields.imageUrl
            ?? ((adminMatch?.media?.type === "photo" || adminMatch?.media?.type === "video") ? (adminMatch.media.url ?? undefined) : undefined),
      };
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
          ...(previous?.sourceDescriptionLocked ? {} : { sourceDescription: product.description || product.rawDescription }),
          sourcePrice: toDecimal(product.price),
          available: nextAvailable,
          totalCount: nextAvailable ?? 0,
          ...businessFields,
          metadataJson: {
            ...(product.metadata as Record<string, unknown>),
            ...(previous?.metadataJson && typeof previous.metadataJson === "object" && !Array.isArray(previous.metadataJson)
              ? { usageInstructions: (previous.metadataJson as Record<string, unknown>).usageInstructions ?? null }
              : {}),
          } as Prisma.InputJsonValue,
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

      const markupPercent = shop.providerConfig.priceMarkupPercent != null
        ? Number(shop.providerConfig.priceMarkupPercent)
        : null;
      const oldSourcePrice = previous?.sourcePrice != null ? Number(previous.sourcePrice) : null;
      const existingSalePrice = previous?.overrides?.[0]?.salePrice != null
        ? Number(previous.overrides[0].salePrice)
        : null;
      const salePriceLocked = previous?.overrides?.[0]?.salePriceLocked ?? false;
      let newSalePrice: number | undefined;
      if (!salePriceLocked && markupPercent !== null && markupPercent > 0) {
        newSalePrice = product.price * (1 + markupPercent / 100);
      } else if (oldSourcePrice !== null && existingSalePrice !== null) {
        const delta = product.price - oldSourcePrice;
        newSalePrice = salePriceLocked
          ? Math.max(product.price, existingSalePrice + delta)
          : Math.max(product.price + 10000, existingSalePrice + delta);
      } else if (!salePriceLocked) {
        newSalePrice = product.price + 10000;
      }

      await this.prisma.sellerProductOverride.upsert({
        where: {
          sellerId_sourceProductId: {
            sellerId: shop.sellerId,
            sourceProductId: sourceProduct.id,
          },
        },
        update: {
          ...(newSalePrice !== undefined ? { salePrice: toDecimal(newSalePrice) } : {}),
          ...(previous?.overrides?.[0]?.displayNameLocked
            ? {}
            : { displayName: product.sourceRawName || product.sourceName }),
        },
        create: {
          sellerId: shop.sellerId,
          shopId: shop.id,
          sourceProductId: sourceProduct.id,
          displayName: product.sourceRawName || product.sourceName,
          salePrice: toDecimal(markupPercent != null && markupPercent > 0
            ? product.price * (1 + markupPercent / 100)
            : product.price + 10000),
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
            displayName: product.sourceRawName || product.sourceName,
            addedQuantity,
            available: Number(nextAvailable),
          });
        }
      }
    }

    const incomingExternalIds = new Set(normalizedProducts.map((p) => p.externalId));
    const staleExternalIds = existingProducts
      .filter((p) => p.providerName !== "manual" && !incomingExternalIds.has(p.externalProductId))
      .map((p) => p.externalProductId);

    if (staleExternalIds.length > 0) {
      // Split stale products into "deletable" (no order history) vs "must-keep" (has orders → FK Restrict)
      const deletable = await this.prisma.sourceProduct.findMany({
        where: {
          shopId: shop.id,
          externalProductId: { in: staleExternalIds },
          providerName: { not: "manual" },
          orders: { none: {} },
          internalSourceOrders: { none: {} },
        },
        select: { id: true },
      });
      if (deletable.length > 0) {
        await this.prisma.sourceProduct.deleteMany({
          where: { id: { in: deletable.map((p) => p.id) } },
        });
      }

      // For stale products that DO have order history (cannot delete due to FK Restrict),
      // set available=0 so bot stops showing them, but keep the row for invoice / warranty traceback.
      await this.prisma.sourceProduct.updateMany({
        where: {
          shopId: shop.id,
          externalProductId: { in: staleExternalIds },
          providerName: { not: "manual" },
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

  /**
   * Claims the right to broadcast a restock notification for (shop, product, available) — true for
   * the first caller within the de-dup window, false after. Shared (same Redis key) by the worker
   * and every API notify path so one restock fans out exactly one message. Fail-open if Redis down.
   */
  async claimRestockNotification(
    shopId: string,
    sourceProductId: string,
    available: number,
  ): Promise<boolean> {
    return this.cache.claimOnce(
      restockNotiDedupKey(shopId, sourceProductId, available),
      RESTOCK_NOTI_DEDUP_TTL_MS,
    );
  }

  /** Admin template shop's customizationJson (isTemplate=true), memoized 60s. Source of the
   * inherited restock template. Returns null if the template shop / config is missing. */
  private async getAdminCustomizationCached(): Promise<Record<string, any> | null> {
    const cached = this.cache.memoGet<Record<string, any> | null>("admin:tpl:cust");
    if (cached !== null) return cached;
    const adminShop = await this.prisma.shop.findFirst({
      where: { isTemplate: true },
      select: { botConfig: { select: { customizationJson: true } } },
    });
    const cust = (adminShop?.botConfig?.customizationJson as Record<string, any>) ?? null;
    this.cache.memoSet("admin:tpl:cust", cust, 60);
    return cust;
  }

  /** Resolve the restock template for a shop (shop override > admin template > defaults). Public so
   * the bot service's upload-restock path shares the exact same resolution as the sync path. */
  async resolveRestockTemplateForShop(shopId: string) {
    const shopCfg = await this.prisma.botConfig.findFirst({
      where: { shopId },
      select: { customizationJson: true },
    });
    const shopCust = (shopCfg?.customizationJson as Record<string, any>) ?? null;
    return resolveRestockTemplate(shopCust, await this.getAdminCustomizationCached());
  }

  async notifyCatalogStockUpdates(
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

    const [customers, sourceProducts, shop] = await Promise.all([
      this.prisma.customer.findMany({
        where: { shopId },
        select: { telegramChatId: true, preferredLanguage: true },
      }),
      this.prisma.sourceProduct.findMany({
        where: { shopId },
        select: { id: true, iconCustomEmojiId: true },
      }),
      this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { botConfig: { select: { customizationJson: true } } },
      }),
    ]);

    if (customers.length === 0) {
      return 0;
    }

    const productById = new Map(sourceProducts.map((p) => [p.id, p]));
    const rawCust = shop?.botConfig?.customizationJson;
    const custJson = (rawCust && typeof rawCust === "object" && !Array.isArray(rawCust)) ? rawCust as Record<string, unknown> : {};
    const custEmojis = (custJson["buttonEmojis"] && typeof custJson["buttonEmojis"] === "object") ? custJson["buttonEmojis"] as Record<string, string> : {};
    const custLabels = (custJson["buttonLabels"] && typeof custJson["buttonLabels"] === "object") ? custJson["buttonLabels"] as Record<string, Record<string, string>> : {};
    const custEmojiIds = (custJson["buttonEmojiIds"] && typeof custJson["buttonEmojiIds"] === "object") ? custJson["buttonEmojiIds"] as Record<string, string> : {};

    const buildBtn = (key: string, fallbackEmoji: string, fallbackVi: string, fallbackEn: string, fallbackTh: string, cbData: string, lang: string) => {
      const custLabel = custLabels[key]?.[lang];
      const custEmoji = custEmojis[key];
      const custEmojiId = custEmojiIds[key];
      const fallbackText = lang === "en" ? fallbackEn : lang === "th" ? fallbackTh : fallbackVi;
      const text = custLabel ? ((custEmoji ? `${custEmoji} ` : "") + custLabel) : `${custEmoji ?? fallbackEmoji} ${fallbackText}`;
      const btn: Record<string, string> = { text, callback_data: cbData };
      if (custEmojiId) btn["icon_custom_emoji_id"] = custEmojiId;
      return btn;
    };

    // De-dup: claim each (product, available) restock once per window so the same event fanned
    // out by multiple paths (this sync, the worker, the ULTRA→PRO cascade, internal-source push,
    // a manual upload) broadcasts exactly one message instead of a burst of identical ones.
    const freshNotifications: CatalogStockNotification[] = [];
    for (const item of notifications) {
      if (await this.claimRestockNotification(shopId, item.sourceProductId, item.available)) {
        freshNotifications.push(item);
      }
    }
    if (freshNotifications.length === 0) {
      return 0;
    }

    const restockTemplate = resolveRestockTemplate(custJson, await this.getAdminCustomizationCached());

    for (const customer of customers) {
      const lang = customer.preferredLanguage === "en" ? "en" : customer.preferredLanguage === "th" ? "th" : "vi";

      for (const item of freshNotifications) {
        const product = productById.get(item.sourceProductId);
        const cbData = `buy:${item.sourceProductId}`;
        const rendered = renderRestockHtml(restockTemplate, {
          productName: item.displayName,
          addedQuantity: item.addedQuantity,
          available: item.available,
          productIconCustomEmojiId: product?.iconCustomEmojiId ?? null,
          language: lang,
        });

        await telegramSendMessage(
          token,
          customer.telegramChatId,
          rendered.text,
          {
            parse_mode: rendered.hasHtml ? "HTML" : undefined,
            reply_markup: {
              inline_keyboard: [[
                buildBtn("buyNow", "🛒", "Mua ngay", "Buy now", "ซื้อเลย", cbData, lang),
              ]],
            },
          },
        ).catch(() => undefined);
      }
    }

    return freshNotifications.length * customers.length;
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
    if (value === null || value === undefined) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  /**
   * Auto-detect SourceProductFamily từ tên sản phẩm (keyword matching).
   * Dùng khi canboso sync không gửi productFamily metadata.
   */
  private detectFamilyFromName(
    name: string | null | undefined,
    families: Array<{ key: string; label: string }> = [],
  ): string | null {
    if (!name) return null;
    const n = String(name).toLowerCase();
    // Thứ tự match: keyword cụ thể trước, generic sau
    if (/\b(chatgpt|gpt[\s-]*plus|gpt[\s-]*pro|gpt[\s-]*team|openai)\b/.test(n)) return SourceProductFamily.CHATGPT;
    if (/\b(claude|anthropic)\b/.test(n)) return SourceProductFamily.CLAUDE;
    if (/\b(gemini|google[\s-]*ai|bard)\b/.test(n)) return SourceProductFamily.GEMINI;
    if (/\b(grok|xai|x[\s-]*ai)\b/.test(n)) return SourceProductFamily.GROK;
    if (/\b(perplexity|pplx)\b/.test(n)) return SourceProductFamily.PERPLEXITY;
    if (/\b(veo[\s-]*3|veo3)\b/.test(n)) return SourceProductFamily.VEO3;
    if (/\b(kling)\b/.test(n)) return SourceProductFamily.KLING;
    if (/\b(higgsfield|higgs[\s-]*field|higg)\b/.test(n)) return SourceProductFamily.HIGGSFIELD;
    if (/\b(canva)\b/.test(n)) return SourceProductFamily.CANVA;
    if (/\b(capcut|cap[\s-]*cut)\b/.test(n)) return SourceProductFamily.CAPCUT;
    if (/\b(adobe|photoshop|illustrator|premiere|lightroom|creative[\s-]*cloud|after[\s-]*effects)\b/.test(n)) return SourceProductFamily.ADOBE;
    if (/\b(suno)\b/.test(n)) return SourceProductFamily.SUNO;
    if (/\b(eleven[\s-]*labs|elevenlabs|11labs|eleven)\b/.test(n)) return SourceProductFamily.ELEVENLABS;
    if (/\b(heygen|hey[\s-]*gen)\b/.test(n)) return SourceProductFamily.HEYGEN;
    if (/\b(gmail|google[\s-]*workspace|gworkspace)\b/.test(n)) return SourceProductFamily.GMAIL;
    if (/\b(youtube|yt[\s-]*premium|yt[\s-]*family)\b/.test(n)) return SourceProductFamily.YOUTUBE;
    if (/\b(tiktok|tik[\s-]*tok)\b/.test(n)) return SourceProductFamily.TIKTOK;
    if (/\b(zoom)\b/.test(n)) return SourceProductFamily.ZOOM;
    if (/\b(duolingo|duo[\s-]*lingo)\b/.test(n)) return SourceProductFamily.DUOLINGO;
    if (/\b(hidemyass|hma)\b/.test(n)) return SourceProductFamily.HMA;
    if (/\b(vpn|nordvpn|expressvpn|surfshark|protonvpn|cyberghost)\b/.test(n)) return SourceProductFamily.VPN;
    // Admin-added families: match the product name against the family label/key.
    for (const fam of families) {
      const lbl = String(fam.label || "").toLowerCase().trim();
      const key = String(fam.key || "").toLowerCase().trim();
      if (lbl.length >= 3 && n.includes(lbl)) return fam.key;
      if (key.length >= 3 && n.includes(key)) return fam.key;
    }
    return null;
  }

  /**
   * Load admin template's productDefaultsByFamily map (cached briefly via Prisma query).
   * Returns empty object if no template exists.
   */
  private async loadAdminTemplateProductDefaultsByFamily(): Promise<Record<string, any>> {
    try {
      const tpl = await this.prisma.shop.findFirst({
        where: { isTemplate: true },
        select: { botConfig: { select: { customizationJson: true } } },
      });
      const cust = (tpl?.botConfig?.customizationJson as Record<string, any>) ?? null;
      return (cust?.productDefaultsByFamily as Record<string, any>) ?? {};
    } catch {
      return {};
    }
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
      productIcon: metadata.productIcon ? String(metadata.productIcon) : undefined,
      iconCustomEmojiId: metadata.iconCustomEmojiId ? String(metadata.iconCustomEmojiId) : undefined,
      imageUrl: metadata.imageUrl ? String(metadata.imageUrl) : undefined,
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

  /**
   * When a PRO shop opts to inherit the ULTRA source's layout (DownstreamSourceConnection.
   * inheritSourceTemplate), remap each synced product's group + position to the UPSTREAM shop's
   * arrangement. PRO products carry externalProductId = the ULTRA SourceProduct.id (worker sync),
   * which equals the ULTRA SellerProductOverride.sourceProductId — so we can look up ULTRA's
   * group/position per product. Prices are left untouched (PRO keeps its own salePrice).
   */
  /** Active inherit-connection for a downstream shop, with the PRO's template-override map. */
  private async getInheritedContext(
    shopId: string,
  ): Promise<{ upstreamShopId: string; overrides: TemplateOverrides } | null> {
    const conn = await this.prisma.downstreamSourceConnection.findFirst({
      where: { downstreamShopId: shopId, status: "ACTIVE", inheritSourceTemplate: true },
      select: { upstreamShopId: true, templateOverridesJson: true },
    });
    if (!conn) return null;
    const overrides = (conn.templateOverridesJson && typeof conn.templateOverridesJson === "object"
      ? conn.templateOverridesJson
      : {}) as TemplateOverrides;
    return { upstreamShopId: conn.upstreamShopId, overrides };
  }

  private async applyInheritedLayout(
    shopId: string,
    mapped: { id: string; sourceProductId: string; groupId: string | null; position: number }[],
  ) {
    const ctx = await this.getInheritedContext(shopId);
    if (!ctx) return;
    const ultraOverrides = await this.prisma.sellerProductOverride.findMany({
      where: { shopId: ctx.upstreamShopId },
      select: { sourceProductId: true, groupId: true, position: true },
    });
    const layout = new Map<string, { groupId: string | null; position: number }>();
    for (const o of ultraOverrides) {
      layout.set(o.sourceProductId, { groupId: o.groupId, position: o.position });
    }
    const productOv = ctx.overrides.products ?? {};
    for (const m of mapped) {
      const l = layout.get(m.sourceProductId);
      m.groupId = l ? l.groupId : null;
      if (l) m.position = l.position;
      // PRO per-product position override on top of the inherited layout.
      const po = productOv[m.id];
      if (po && typeof po.position === "number") m.position = po.position;
    }
  }

  /** Map a single SourceProduct (with its overrides) to the catalog-item shape used by bot + UI. */
  private mapCatalogProduct(product: Prisma.SourceProductGetPayload<{ include: { overrides: true } }>) {
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
      displayName: override?.displayName || product.sourceRawName || product.sourceName,
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
      isShared: metadata.shared === true,
      sharedContent: typeof metadata.sharedContent === "string" ? metadata.sharedContent : null,
      usageInstructions: typeof metadata.usageInstructions === "string" ? metadata.usageInstructions : null,
      deliveryText:
        typeof metadata.deliveryText === "string" ? metadata.deliveryText : null,
      deliveryFormatHint:
        typeof metadata.deliveryFormatHint === "string" ? metadata.deliveryFormatHint : null,
      internalSourceEnabled: product.internalSourceEnabled,
      internalSourcePrice: product.internalSourcePrice
        ? decimalToNumber(product.internalSourcePrice)
        : null,
      productFamily: product.productFamily?.toLowerCase() || null,
      productFamilyOther: product.productFamilyOther || null,
      productPackage: (product as any).productPackage || null,
      accountType: product.accountType?.toLowerCase() || null,
      accountTypeOther: product.accountTypeOther || null,
      durationType: product.durationType?.toLowerCase() || null,
      durationTypeOther: product.durationTypeOther || null,
      sourceDeliveryMode: product.sourceDeliveryMode?.toLowerCase() || null,
      warrantyPolicy: product.warrantyPolicy?.toLowerCase() || null,
      // Batch lifetime (see SourceProduct.accLifetimeDays comment). Surface to the seller
      // UI so the product edit form can prefill the value and show when the clock started.
      accLifetimeDays: (product as any).accLifetimeDays ?? null,
      accBatchStartedAt: (product as any).accBatchStartedAt ?? null,
      productIcon: product.productIcon || null,
      iconCustomEmojiId: product.iconCustomEmojiId || null,
      iconOutOfStockEmojiId: product.iconOutOfStockEmojiId || null,
      imageUrl: product.imageUrl || null,
      syncedAt: product.syncedAt,
      groupId: override?.groupId ?? null,
      position: override?.position ?? 0,
      createdAt: product.createdAt,
      promoType: (product as any).promoType || null,
      promoBuyN: (product as any).promoBuyN ?? null,
      promoGetM: (product as any).promoGetM ?? null,
      promoBulkMinQty: (product as any).promoBulkMinQty ?? null,
      promoBulkDiscountPct: (product as any).promoBulkDiscountPct ? decimalToNumber((product as any).promoBulkDiscountPct) : null,
      promoStartAt: (product as any).promoStartAt ?? null,
      promoEndAt: (product as any).promoEndAt ?? null,
      promoBannerUrl: (product as any).promoBannerUrl ?? null,
    };
  }

  /** One mapped catalog item by id — avoids loading the WHOLE catalog just to show one product. */
  async getCatalogItemForShop(shopId: string, sourceProductId: string) {
    const product = await this.prisma.sourceProduct.findFirst({
      where: { id: sourceProductId, shopId },
      include: { overrides: true },
    });
    return product ? this.mapCatalogProduct(product) : null;
  }

  async getCatalogViewForShop(shopId: string, sortByAvailable = true, applyInheritedTemplate = false) {
    const products = await this.prisma.sourceProduct.findMany({
      where: { shopId },
      include: {
        overrides: true,
      },
      orderBy: sortByAvailable
        ? [{ available: { sort: "desc", nulls: "first" } }, { createdAt: "asc" }]
        : [{ createdAt: "asc" }],
    });

    const mapped = products.map((product) => this.mapCatalogProduct(product));
    if (applyInheritedTemplate) {
      await this.applyInheritedLayout(shopId, mapped);
    }
    // Sort by manual position first, then by sortByAvailable / createdAt
    return mapped.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      if (sortByAvailable) {
        const av = a.available === null ? Number.MAX_SAFE_INTEGER : a.available;
        const bv = b.available === null ? Number.MAX_SAFE_INTEGER : b.available;
        if (av !== bv) return bv - av;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * If the shop inherits the ULTRA source template, return the UPSTREAM shop's bot
   * customizationJson (welcome text, button labels, catalog text, emojis...); else null so the
   * caller keeps the shop's own customization.
   */
  async getInheritedCustomizationJson(shopId: string): Promise<Record<string, unknown> | null> {
    const conn = await this.prisma.downstreamSourceConnection.findFirst({
      where: { downstreamShopId: shopId, status: "ACTIVE", inheritSourceTemplate: true },
      select: { upstreamShopId: true },
    });
    if (!conn) return null;
    const bc = await this.prisma.botConfig.findUnique({
      where: { shopId: conn.upstreamShopId },
      select: { customizationJson: true },
    });
    return (bc?.customizationJson as Record<string, unknown> | null) ?? null;
  }

  async getCatalogGroupsForShop(shopId: string, applyInheritedTemplate = false) {
    if (applyInheritedTemplate) {
      const ctx = await this.getInheritedContext(shopId);
      if (ctx) {
        const groups = await this.prisma.shopCatalogGroup.findMany({
          where: { shopId: ctx.upstreamShopId },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        });
        const groupOv = ctx.overrides.groups ?? {};
        // Apply PRO overrides: custom name, custom order, hide a category.
        return groups
          .filter((g) => !groupOv[g.id]?.hidden)
          .map((g) => {
            const ov = groupOv[g.id];
            return {
              ...g,
              name: ov?.name?.trim() || g.name,
              position: typeof ov?.position === "number" ? ov.position : g.position,
            };
          })
          .sort((a, b) => a.position - b.position);
      }
    }
    return this.prisma.shopCatalogGroup.findMany({
      where: { shopId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
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

      const downstreamBotConfig = await this.prisma.botConfig.findUnique({
        where: { shopId: connection.downstreamShopId },
        select: { ownerTelegramUserId: true },
      });

      const candidateChatIds = Array.from(new Set([
        connection.downstreamTelegramChatId,
        downstreamBotConfig?.ownerTelegramUserId,
      ].filter((v): v is string => typeof v === "string" && v.length > 0)));

      let balance = 0;
      let matchedChatId: string | null = null;
      for (const chatId of candidateChatIds) {
        const wallet = await this.prisma.customerWallet.findFirst({
          where: {
            customer: { shopId: connection.upstreamShopId, telegramChatId: chatId },
          },
          select: { balance: true },
        });
        if (wallet) {
          balance = decimalToNumber(wallet.balance);
          matchedChatId = chatId;
          // Auto-heal: if connection's chatId is stale/null, sync it from the matched lookup
          if (chatId !== connection.downstreamTelegramChatId) {
            await this.prisma.downstreamSourceConnection.update({
              where: { id: connection.id },
              data: { downstreamTelegramChatId: chatId },
            }).catch(() => undefined);
          }
          break;
        }
      }

      if (!matchedChatId) {
        // eslint-disable-next-line no-console
        console.warn(`[provider-balance] No customerWallet matched for connection=${connection.id} candidates=${JSON.stringify(candidateChatIds)} upstreamShop=${connection.upstreamShopId}`);
      }

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
        requesterChatId: matchedChatId,
        botSource: connection.upstreamShop?.name || "ULTRA",
        rawPayload: { candidateChatIds, matchedChatId },
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

  async checkExternalProductStock(shopId: string, externalProductId: string | null): Promise<boolean> {
    if (!externalProductId) return true;
    const shop = await this.getSellerShopByShopId(shopId);
    if (!shop.providerConfig || shop.providerConfig.providerKind !== ProviderKind.EXTERNAL) return true;
    const buyerKey = decryptSecret(shop.providerConfig.buyerKeyEncrypted, this.config.encryptionKey);
    if (!buyerKey) return true;
    if (String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true" && isMockBuyerKey(buyerKey)) return true;
    try {
      const products = await fetchProviderProducts({
        baseUrl: shop.providerConfig.baseUrl,
        buyerKey,
        timeoutMs: 5000,
      });
      const found = products.find((p) => p.externalId === externalProductId);
      if (!found || found.hidden) return false;
      if (found.available !== null && found.available <= 0) return false;
      return true;
    } catch {
      return true;
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
