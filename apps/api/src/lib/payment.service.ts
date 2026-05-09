import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProvider } from "@prisma/client";
import {
  createPayOSPaymentLink,
  decryptSecret,
  getPayOSPaymentLinkStatus,
  type PaymentLinkResult,
} from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { BinancePayService } from "./binance-pay.service";

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(BinancePayService)
    private readonly binancePayService: BinancePayService,
  ) {}

  private safeDecryptSecret(payload: string | null | undefined) {
    try {
      return decryptSecret(payload, this.config.encryptionKey);
    } catch {
      return "";
    }
  }

  buildPublicReconcileToken(externalOrderCode: string) {
    return createHmac("sha256", this.config.internalApiToken)
      .update(`payos-reconcile:${String(externalOrderCode || "").trim()}`)
      .digest("hex");
  }

  isValidPublicReconcileToken(externalOrderCode: string, providedToken: string | null | undefined) {
    const expected = Buffer.from(this.buildPublicReconcileToken(externalOrderCode), "utf8");
    const provided = Buffer.from(String(providedToken || "").trim(), "utf8");

    if (expected.length !== provided.length) {
      return false;
    }

    return timingSafeEqual(expected, provided);
  }

  private resolveUsdtVndRate(paymentConfig: {
    usdtVndRateOverride?: unknown;
  } | null) {
    const overrideRate = Number(paymentConfig?.usdtVndRateOverride ?? NaN);

    if (Number.isFinite(overrideRate) && overrideRate > 0) {
      return overrideRate;
    }

    const fallbackRate = Number(this.config.usdtVndRate || 26000);

    if (!Number.isFinite(fallbackRate) || fallbackRate <= 0) {
      throw new BadRequestException("USDT_VND_RATE must be greater than 0.");
    }

    return fallbackRate;
  }

  async createPaymentLink(input: {
    shopId: string;
    externalOrderCode: string;
    amount: number;
    description: string;
    expiredAt?: Date;
    providerOverride?: PaymentProvider;
  }): Promise<{
    provider: PaymentProvider;
    checkoutUrl: string;
    qrCode: string | null;
    providerPayload: unknown;
    manualCrypto?: {
      provider: "BINANCE" | "OKX" | "USDT_TRC20";
      uid?: string | null;
      address?: string | null;
      network?: "TRC20" | null;
      usdtAmount: number;
      usdtVndRate: number;
      note: string;
      hasPersonalApi?: boolean;
    };
    binancePay?: {
      prepayId: string;
      qrcodeLink: string;
      deeplink: string;
      universalUrl: string;
    };
  }> {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: {
        shopId: input.shopId,
      },
    });

    const provider = this.config.paymentMode === "mock"
      ? PaymentProvider.MOCK
      : (input.providerOverride || paymentConfig?.provider || PaymentProvider.PAYOS);

    // ── BINANCE_PAY (auto merchant flow) ──────────────────────────────────────
    if (provider === PaymentProvider.BINANCE_PAY) {
      return this.createBinancePayPaymentLink(paymentConfig, input);
    }

    if (
      provider === PaymentProvider.BINANCE ||
      provider === PaymentProvider.OKX ||
      provider === PaymentProvider.USDT_TRC20
    ) {
      return await this.createManualCryptoPaymentLink(provider, paymentConfig as any, input);
    }

    if (provider === PaymentProvider.PAYOS) {
      const credentials = this.resolvePayOSCredentials(paymentConfig);
      const reconcileToken = this.buildPublicReconcileToken(input.externalOrderCode);
      const paymentStatusQuery = `orderCode=${encodeURIComponent(input.externalOrderCode)}&rt=${encodeURIComponent(reconcileToken)}`;

      const response: PaymentLinkResult = await createPayOSPaymentLink(
        credentials,
        {
          orderCode: Number(input.externalOrderCode),
          amount: Math.round(input.amount),
          description: input.description.slice(0, 25),
          returnUrl: `${this.config.webPublicUrl}/payments/success?${paymentStatusQuery}`,
          cancelUrl: `${this.config.webPublicUrl}/payments/cancel?${paymentStatusQuery}`,
          expiredAt: input.expiredAt
            ? Math.floor(new Date(input.expiredAt).getTime() / 1000)
            : undefined,
        },
      );

      return {
        provider,
        checkoutUrl: response.checkoutUrl,
        qrCode: response.qrCode,
        providerPayload: response.providerResponse,
      };
    }

    const mockUrl = `${this.config.appPublicUrl}/api/v1/dev/mock-payments/${input.externalOrderCode}`;

    return {
      provider: PaymentProvider.MOCK,
      checkoutUrl: mockUrl,
      qrCode: mockUrl,
      providerPayload: {
        mock: true,
      },
    };
  }

  private async createManualCryptoPaymentLink(
    provider: PaymentProvider,
    paymentConfig: {
      binanceUid: string | null;
      okxUid: string | null;
      usdtTrc20Address: string | null;
      usdtVndRateOverride?: unknown;
      binancePersonalApiKeyEncrypted?: string | null;
      binancePersonalSecretKeyEncrypted?: string | null;
    } | null,
    input: {
      shopId: string;
      externalOrderCode: string;
      amount: number;
    },
  ) {
    const cryptoProvider: "BINANCE" | "OKX" | "USDT_TRC20" =
      provider === PaymentProvider.BINANCE
        ? "BINANCE"
        : provider === PaymentProvider.OKX
          ? "OKX"
          : "USDT_TRC20";
    const uid = String(
      cryptoProvider === "BINANCE"
        ? paymentConfig?.binanceUid || ""
        : cryptoProvider === "OKX"
          ? paymentConfig?.okxUid || ""
          : "",
    ).trim();
    const address = String(
      cryptoProvider === "USDT_TRC20"
        ? paymentConfig?.usdtTrc20Address || ""
        : "",
    ).trim();

    if (cryptoProvider === "USDT_TRC20" && !address) {
      throw new BadRequestException("USDT TRC20 address is not configured.");
    }

    if (cryptoProvider !== "USDT_TRC20" && !uid) {
      throw new BadRequestException(
        cryptoProvider === "BINANCE"
          ? "Binance UID is not configured."
          : "OKX UID is not configured.",
      );
    }

    const rate = this.resolveUsdtVndRate(paymentConfig);

    let usdtAmount = this.ceilToDecimals(Number(input.amount) / rate, 2);
    let hasPersonalApi = false;

    if (
      cryptoProvider === "BINANCE" &&
      paymentConfig?.binancePersonalApiKeyEncrypted &&
      paymentConfig?.binancePersonalSecretKeyEncrypted
    ) {
      hasPersonalApi = true;
      
      const recentPending = await this.prisma.paymentTransaction.findMany({
        where: {
          provider: PaymentProvider.BINANCE,
          status: "PENDING",
          createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
          order: { shopId: input.shopId }
        },
        select: { rawPayloadJson: true }
      });

      const usedUsdtAmounts = new Set(
        recentPending.map(t => {
          const payload = t.rawPayloadJson as any;
          return Number(payload?.manualCrypto?.usdtAmount || 0);
        })
      );

      let offset = 0;
      let targetUsdt = usdtAmount;
      while (usedUsdtAmounts.has(targetUsdt) && offset < 99) {
        offset += 0.01;
        targetUsdt = this.ceilToDecimals(usdtAmount + offset, 2);
      }
      usdtAmount = targetUsdt;
    }

    const note = input.externalOrderCode;
    const manualCrypto = {
      provider: cryptoProvider,
      uid: uid || null,
      address: address || null,
      network: cryptoProvider === "USDT_TRC20" ? ("TRC20" as const) : null,
      usdtAmount,
      usdtVndRate: rate,
      note,
      hasPersonalApi,
    };
    const checkoutUrl = `manual-crypto://${cryptoProvider.toLowerCase()}/${input.externalOrderCode}`;
    const qrCode = cryptoProvider === "USDT_TRC20"
      ? `qrdata:${address}`
      : null;

    return {
      provider,
      checkoutUrl,
      qrCode,
      providerPayload: {
        manualCrypto,
      },
      manualCrypto,
    };
  }

  private buildUsdtTrc20CheckoutUrl(input: {
    address: string;
    amount: number;
    reference: string;
  }) {
    const url = new URL("/payments/crypto", this.config.webPublicUrl);
    url.searchParams.set("provider", "usdt_trc20");
    url.searchParams.set("token", "USDT");
    url.searchParams.set("network", "TRC20");
    url.searchParams.set("address", input.address);
    url.searchParams.set("amount", this.formatUsdtAmount(input.amount));
    url.searchParams.set("ref", input.reference);
    return url.toString();
  }

  private formatUsdtAmount(value: number) {
    return Number(value || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    });
  }

  async getExternalPaymentStatus(externalOrderCode: string) {
    const target = await this.resolvePaymentStatusTarget(externalOrderCode);

    if (!target) {
      throw new BadRequestException("Payment record not found.");
    }

    if (target.provider !== PaymentProvider.PAYOS && target.provider !== PaymentProvider.BINANCE_PAY) {
      return {
        kind: target.kind,
        provider: target.provider,
        providerStatus: target.localPaymentStatus || "UNKNOWN",
        amount: null,
        amountPaid: null,
        localPaymentStatus: target.localPaymentStatus,
        localOrderStatus: target.localOrderStatus,
        failureReason: target.failureReason,
        rawPayload: null,
      };
    }

    if (target.provider === PaymentProvider.BINANCE_PAY) {
      return this.getBinancePayExternalStatus(target, externalOrderCode);
    }

    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: {
        shopId: target.shopId,
      },
    });
    const credentials = this.resolvePayOSCredentials(paymentConfig);
    const remoteStatus = await getPayOSPaymentLinkStatus(credentials, externalOrderCode);

    return {
      kind: target.kind,
      provider: target.provider,
      providerStatus: remoteStatus.status,
      amount: remoteStatus.amount,
      amountPaid: remoteStatus.amountPaid,
      localPaymentStatus: target.localPaymentStatus,
      localOrderStatus: target.localOrderStatus,
      failureReason: target.failureReason,
      rawPayload: remoteStatus.providerResponse,
    };
  }

  async getPayOSChecksumKeyForExternalOrderCode(externalOrderCode: string) {
    const target = await this.resolvePaymentStatusTarget(externalOrderCode);

    if (!target || target.provider !== PaymentProvider.PAYOS) {
      return process.env.PAYOS_CHECKSUM_KEY || "";
    }

    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: {
        shopId: target.shopId,
      },
    });

    return (
      this.safeDecryptSecret(paymentConfig?.payosChecksumKeyEncrypted) ||
      process.env.PAYOS_CHECKSUM_KEY ||
      ""
    );
  }

  private resolvePayOSCredentials(paymentConfig: {
    payosClientIdEncrypted: string | null;
    payosApiKeyEncrypted: string | null;
    payosChecksumKeyEncrypted: string | null;
  } | null) {
    const clientId =
      this.safeDecryptSecret(paymentConfig?.payosClientIdEncrypted) ||
      process.env.PAYOS_CLIENT_ID ||
      "";
    const apiKey =
      this.safeDecryptSecret(paymentConfig?.payosApiKeyEncrypted) ||
      process.env.PAYOS_API_KEY ||
      "";
    const checksumKey =
      this.safeDecryptSecret(paymentConfig?.payosChecksumKeyEncrypted) ||
      process.env.PAYOS_CHECKSUM_KEY ||
      "";

    if (!clientId || !apiKey || !checksumKey) {
      throw new BadRequestException("PayOS configuration is incomplete.");
    }

    return {
      clientId,
      apiKey,
      checksumKey,
    };
  }

  // ── Binance Pay helpers ──────────────────────────────────────────────────────

  /**
   * Resolve Binance Pay API key + secret for a shop's PaymentConfig.
   * Falls back to env vars BINANCE_PAY_API_KEY / BINANCE_PAY_SECRET_KEY.
   */
  private resolveBinancePayCredentials(paymentConfig: {
    binancePayApiKeyEncrypted: string | null;
    binancePaySecretKeyEncrypted: string | null;
    binancePayEnabled: boolean;
  } | null) {
    const apiKey =
      this.safeDecryptSecret(paymentConfig?.binancePayApiKeyEncrypted) ||
      process.env.BINANCE_PAY_API_KEY ||
      "";
    const secretKey =
      this.safeDecryptSecret(paymentConfig?.binancePaySecretKeyEncrypted) ||
      process.env.BINANCE_PAY_SECRET_KEY ||
      "";

    if (!apiKey || !secretKey) {
      throw new BadRequestException("Binance Pay Merchant configuration is incomplete (missing API key or secret).");
    }

    return { apiKey, secretKey };
  }

  private async createBinancePayPaymentLink(
    paymentConfig: {
      binancePayApiKeyEncrypted: string | null;
      binancePaySecretKeyEncrypted: string | null;
      binancePayEnabled: boolean;
      usdtVndRateOverride?: unknown;
    } | null,
    input: {
      shopId: string;
      externalOrderCode: string;
      amount: number;
      description: string;
      expiredAt?: Date;
    },
  ) {
    const { apiKey, secretKey } = this.resolveBinancePayCredentials(paymentConfig);
    const rate = this.resolveUsdtVndRate(paymentConfig);

    const usdtAmount = this.binancePayService.ceilUsdt(Number(input.amount), rate);
    const merchantTradeNo = this.binancePayService.buildMerchantTradeNo(input.externalOrderCode);

    const webhookUrl =
      process.env.BINANCE_PAY_WEBHOOK_URL ||
      `${this.config.appPublicUrl}/api/v1/webhooks/binancepay`;

    const orderData = await this.binancePayService.createOrder(apiKey, secretKey, {
      externalOrderCode: input.externalOrderCode,
      usdtAmount,
      orderDescription: input.description.slice(0, 256),
      webhookUrl,
      expiredAt: input.expiredAt,
    });

    return {
      provider: PaymentProvider.BINANCE_PAY,
      checkoutUrl: orderData.checkoutUrl,
      qrCode: orderData.qrcodeLink || null,
      providerPayload: {
        prepayId: orderData.prepayId,
        merchantTradeNo,
        usdtAmount,
        usdtVndRate: rate,
      },
      binancePay: {
        prepayId: orderData.prepayId,
        qrcodeLink: orderData.qrcodeLink,
        deeplink: orderData.deeplink,
        universalUrl: orderData.universalUrl,
      },
    };
  }

  private async getBinancePayExternalStatus(
    target: {
      kind: string;
      provider: PaymentProvider;
      shopId: string;
      localPaymentStatus: string | null;
      localOrderStatus?: string | null;
      failureReason?: string | null;
    },
    externalOrderCode: string,
  ) {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId: target.shopId },
    });

    let providerStatus = target.localPaymentStatus || "UNKNOWN";

    try {
      const { apiKey, secretKey } = this.resolveBinancePayCredentials(paymentConfig);
      const merchantTradeNo = this.binancePayService.buildMerchantTradeNo(externalOrderCode);
      const remote = await this.binancePayService.queryOrder(apiKey, secretKey, merchantTradeNo);
      providerStatus = remote.status;
    } catch {
      // If query fails, fall back to local status
    }

    return {
      kind: target.kind,
      provider: target.provider,
      providerStatus,
      amount: null,
      amountPaid: null,
      localPaymentStatus: target.localPaymentStatus,
      localOrderStatus: target.localOrderStatus,
      failureReason: target.failureReason,
      rawPayload: null,
    };
  }

  /**
   * Verify a Binance Pay webhook notification.
   * Returns the merchantTradeNo (used to look up the externalOrderCode) on success.
   * Throws BadRequestException if signature is invalid.
   */
  async verifyBinancePayWebhook(
    headers: {
      timestamp: string;
      nonce: string;
      certSerial: string;
      signature: string;
    },
    rawBody: string,
  ): Promise<{ externalOrderCode: string; merchantTradeNo: string; bizStatus: string; rawData: unknown }> {
    const verifiedShopId = await this.resolveVerifiedBinancePayShopId(headers, rawBody);
    const payload = this.parseBinancePayWebhookPayload(rawBody);
    const externalOrderCode =
      String(payload.innerData.passThroughInfo || "").trim() ||
      this.binancePayService.merchantTradeNoToExternalOrderCode(payload.innerData.merchantTradeNo || "");

    if (!externalOrderCode) {
      throw new BadRequestException("Binance Pay webhook is missing external order reference.");
    }

    const target = await this.resolvePaymentStatusTarget(externalOrderCode);

    if (!target?.shopId) {
      throw new NotFoundException("Payment target not found for Binance Pay webhook.");
    }

    if (target.provider !== PaymentProvider.BINANCE_PAY) {
      throw new BadRequestException("Binance Pay webhook target provider mismatch.");
    }

    if (target.shopId !== verifiedShopId) {
      throw new BadRequestException("Binance Pay webhook target shop mismatch.");
    }

    return {
      externalOrderCode,
      merchantTradeNo: payload.innerData.merchantTradeNo || "",
      bizStatus: payload.payload.bizStatus || "",
      rawData: payload.payload,
    };
  }

  private async resolveVerifiedBinancePayShopId(
    headers: {
      timestamp: string;
      nonce: string;
      certSerial: string;
      signature: string;
    },
    rawBody: string,
  ) {
    const envShopId = String(process.env.BINANCE_PAY_SHOP_ID || "").trim();
    const candidates = envShopId
      ? await this.prisma.paymentConfig.findMany({
          where: {
            shopId: envShopId,
            binancePayEnabled: true,
          },
          select: {
            shopId: true,
            binancePayApiKeyEncrypted: true,
            binancePaySecretKeyEncrypted: true,
            binancePayEnabled: true,
          },
          take: 1,
        })
      : await this.prisma.paymentConfig.findMany({
          where: {
            binancePayEnabled: true,
          },
          select: {
            shopId: true,
            binancePayApiKeyEncrypted: true,
            binancePaySecretKeyEncrypted: true,
            binancePayEnabled: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        });

    if (candidates.length === 0) {
      throw new NotFoundException("No Binance Pay merchant configuration is enabled.");
    }

    let retryableError: Error | null = null;

    for (const candidate of candidates) {
      let credentials: { apiKey: string; secretKey: string };

      try {
        credentials = this.resolveBinancePayCredentials(candidate);
      } catch (error) {
        if (envShopId) {
          throw error;
        }
        continue;
      }

      try {
        const certs = await this.binancePayService.fetchCertificates(
          credentials.apiKey,
          credentials.secretKey,
        );
        const cert = certs.find((item) => item.certSerial === headers.certSerial);

        if (!cert) {
          continue;
        }

        const pem = cert.certPublic.includes("-----BEGIN")
          ? cert.certPublic
          : `-----BEGIN PUBLIC KEY-----\n${cert.certPublic}\n-----END PUBLIC KEY-----`;

        const isValid = this.binancePayService.verifyWebhookSignature(
          headers.timestamp,
          headers.nonce,
          rawBody,
          headers.signature,
          pem,
        );

        if (isValid) {
          return candidate.shopId;
        }
      } catch (error) {
        if (error instanceof Error) {
          retryableError = error;
        } else {
          retryableError = new Error(String(error));
        }

        if (envShopId) {
          throw retryableError;
        }
      }
    }

    if (retryableError) {
      throw retryableError;
    }

    throw new BadRequestException("Binance Pay webhook signature verification failed.");
  }

  private parseBinancePayWebhookPayload(rawBody: string) {
    let payload: {
      bizType?: string;
      bizId?: string;
      bizStatus?: string;
      data?: string;
    };

    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      throw new BadRequestException("Binance Pay webhook payload is not valid JSON.");
    }

    let innerData: {
      merchantTradeNo?: string;
      passThroughInfo?: string;
    };

    try {
      innerData = JSON.parse(String(payload.data || "{}")) as typeof innerData;
    } catch {
      throw new BadRequestException("Binance Pay webhook data field is not valid JSON.");
    }

    return {
      payload,
      innerData,
    };
  }

  private ceilToDecimals(value: number, decimals: number) {
    const factor = 10 ** decimals;
    return Math.ceil(value * factor) / factor;
  }

  private async resolvePaymentStatusTarget(externalOrderCode: string): Promise<{
    kind: "order" | "customer_topup" | "seller_deposit" | "connection_topup";
    provider: PaymentProvider;
    shopId: string;
    localPaymentStatus: string | null;
    localOrderStatus?: string | null;
    failureReason?: string | null;
  } | null> {
    const paymentTransaction = await this.prisma.paymentTransaction.findUnique({
      where: {
        externalOrderCode,
      },
      include: {
        order: {
          select: {
            shopId: true,
            status: true,
            failureReason: true,
          },
        },
      },
    });

    if (paymentTransaction?.order) {
      return {
        kind: "order",
        provider: paymentTransaction.provider,
        shopId: paymentTransaction.order.shopId,
        localPaymentStatus: paymentTransaction.status,
        localOrderStatus: paymentTransaction.order.status,
        failureReason: paymentTransaction.order.failureReason,
      };
    }

    const customerTopup = await this.prisma.customerWalletTopup.findUnique({
      where: {
        externalOrderCode,
      },
      select: {
        provider: true,
        shopId: true,
        status: true,
      },
    });

    if (customerTopup) {
      return {
        kind: "customer_topup",
        provider: customerTopup.provider,
        shopId: customerTopup.shopId,
        localPaymentStatus: customerTopup.status,
      };
    }

    const deposit = await this.prisma.depositRequest.findUnique({
      where: {
        externalOrderCode,
      },
      select: {
        provider: true,
        sellerId: true,
        status: true,
      },
    });

    if (!deposit) {
      const connectionTopup = await this.prisma.connectionTopupRequest.findUnique({
        where: { externalOrderCode },
        select: { provider: true, upstreamShopId: true, status: true },
      });

      if (!connectionTopup) {
        return null;
      }

      return {
        kind: "connection_topup",
        provider: connectionTopup.provider,
        shopId: connectionTopup.upstreamShopId,
        localPaymentStatus: connectionTopup.status,
      };
    }

    const shop = await this.prisma.shop.findFirst({
      where: {
        sellerId: deposit.sellerId,
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    if (!shop) {
      throw new BadRequestException("Shop not found for seller deposit payment.");
    }

    return {
      kind: "seller_deposit",
      provider: deposit.provider,
      shopId: shop.id,
      localPaymentStatus: deposit.status,
    };
  }
}
