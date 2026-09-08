import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProvider, Prisma } from "@prisma/client";
import {
  buildVietQrImageUrl,
  createPay2sPaymentLink,
  pay2sBankCodeToBin,
  createPayOSPaymentLink,
  decryptSecret,
  fetchWeb2mTransactions,
  getPayOSPaymentLinkStatus,
  normalizeBep20Address,
  normalizeTonAddress,
  type Pay2sBankInfo,
  type PaymentLinkResult,
  type PayOSBankInfo,
  type Web2mTransaction,
} from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { BinancePayService } from "./binance-pay.service";
import {
  extractPaypalWebhookExternalOrderCode,
  extractPaypalWebhookOrderId,
  summarizePaypalOrder,
} from "./paypal-payment";
import { PaypalService } from "./paypal.service";
import { FeatureFlagService, type FeatureFlagKey } from "./feature-flag.service";

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(BinancePayService)
    private readonly binancePayService: BinancePayService,
    @Inject(PaypalService)
    private readonly paypalService: PaypalService,
    @Inject(FeatureFlagService)
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private safeDecryptSecret(payload: string | null | undefined) {
    try {
      return decryptSecret(payload, this.config.encryptionKey);
    } catch {
      return "";
    }
  }

  /**
   * Only the synthetic PLATFORM pseudo-shops (tier upgrade / renewal / platform deposit) may borrow
   * the platform-owner's env payment credentials (PAYOS_*, PAY2S_*, WEB2M_*, BINANCE_PAY_*). They
   * have no PaymentConfig of their own — the env account IS their account by design.
   *
   * A REAL shop must NEVER fall back to env: if its own keys are blank or fail to decrypt, payment
   * creation FAILS CLOSED instead of silently routing the shop's customers' money to the platform
   * owner's account. (This is the movaci bug: blank shop config → env fallback → money to platform.)
   */
  private isPlatformShop(shopId: string): boolean {
    const id = String(shopId || "").trim();
    if (!id) return false;
    if (id.startsWith("platform-")) return true; // "platform-upgrade", "platform-tier"
    const depositShop = String(this.config.platformDepositShopId || "").trim();
    return !!depositShop && id === depositShop; // PLATFORM_DEPOSIT_SHOP_ID (wallet top-up / tiers)
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

  buildPaypalReturnState(externalOrderCode: string) {
    return createHmac("sha256", this.config.internalApiToken)
      .update(`paypal-return:${String(externalOrderCode || "").trim()}`)
      .digest("hex");
  }

  isValidPaypalReturnState(externalOrderCode: string, providedState: string | null | undefined) {
    const expected = Buffer.from(this.buildPaypalReturnState(externalOrderCode), "utf8");
    const provided = Buffer.from(String(providedState || "").trim(), "utf8");
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  async claimOnchainPaymentReceipt(input: {
    provider: PaymentProvider;
    txHash: string;
    externalOrderCode: string;
    amountUsdt: number;
    destination: string;
    transactionAt: Date;
    tokenAddress?: string | null;
    blockReference?: string | number | null;
    confirmations?: number | null;
    rawPayload?: unknown;
  }) {
    const providerFeature: FeatureFlagKey | null =
      input.provider === PaymentProvider.USDT_TRC20 ? "payment_trc20"
      : input.provider === PaymentProvider.USDT_BEP20 ? "payment_bep20"
      : input.provider === PaymentProvider.USDT_SOL ? "payment_solana"
      : input.provider === PaymentProvider.USDT_TON ? "payment_ton"
      : null;
    if (providerFeature) await this.featureFlags.assertEnabled(providerFeature);

    const allowedProviders = new Set<PaymentProvider>([
      PaymentProvider.BINANCE,
      PaymentProvider.OKX,
      PaymentProvider.USDT_TRC20,
      PaymentProvider.USDT_BEP20,
      PaymentProvider.USDT_SOL,
      PaymentProvider.USDT_TON,
    ]);
    if (!allowedProviders.has(input.provider)) {
      throw new BadRequestException("Unsupported USDT payment provider.");
    }
    if (!input.txHash || !input.externalOrderCode || !input.destination) {
      throw new BadRequestException("USDT receipt data is incomplete.");
    }
    if (!Number.isFinite(input.amountUsdt) || input.amountUsdt <= 0) {
      throw new BadRequestException("USDT receipt amount is invalid.");
    }

    const txHashNormalized = this.normalizeOnchainTxHash(input.txHash);
    const target = await this.resolvePaymentStatusTarget(input.externalOrderCode);
    if (!target) throw new NotFoundException("Payment target not found.");
    if (target.provider !== input.provider) {
      throw new BadRequestException("On-chain receipt provider does not match the payment target.");
    }
    const transactionAtMs = input.transactionAt?.getTime();
    const minimumTransactionAt = target.createdAt.getTime() - 60 * 1000;
    if (!Number.isFinite(transactionAtMs) || transactionAtMs! < minimumTransactionAt) {
      throw new BadRequestException("Blockchain transaction predates this payment request.");
    }
    if (transactionAtMs! > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException("Blockchain transaction timestamp is invalid.");
    }
    if (this.isReceiptBackedCryptoProvider(input.provider)) {
      const expectation = this.extractOnchainExpectation(target);
      const actualDestination = this.normalizeOnchainDestination(input.provider, input.destination);
      if (Math.abs(input.amountUsdt - expectation.amountUsdt) > this.config.usdtPaymentTolerance + 1e-9) {
        throw new BadRequestException("On-chain transfer amount does not match the invoice.");
      }
      if (!actualDestination || actualDestination !== expectation.destination) {
        throw new BadRequestException("On-chain transfer destination does not match the invoice.");
      }
      if (target.expiresAt && transactionAtMs! > target.expiresAt.getTime() + 60_000) {
        throw new BadRequestException("Blockchain transaction was made after this payment request expired.");
      }
    }

    const [byTransaction, byExternalOrderCode] = await Promise.all([
      this.prisma.onchainPaymentReceipt.findUnique({
        where: { txHashNormalized },
      }),
      this.prisma.onchainPaymentReceipt.findUnique({
        where: { externalOrderCode: input.externalOrderCode },
      }),
    ]);
    const existing = byTransaction || byExternalOrderCode;
    if (existing) {
      if (
        existing.externalOrderCode !== input.externalOrderCode
        || existing.txHashNormalized !== txHashNormalized
      ) {
        throw new BadRequestException("This blockchain transaction or invoice has already been claimed.");
      }
      return existing;
    }

    try {
      return await this.prisma.onchainPaymentReceipt.create({
        data: {
          provider: input.provider,
          txHash: input.txHash,
          txHashNormalized,
          externalOrderCode: input.externalOrderCode,
          amountUsdt: input.amountUsdt,
          destination: input.destination,
          tokenAddress: input.tokenAddress || null,
          blockReference: input.blockReference == null ? null : String(input.blockReference),
          confirmations: input.confirmations == null ? null : Math.max(0, Math.floor(input.confirmations)),
          verificationVersion: 2,
          transactionAt: input.transactionAt,
          rawPayloadJson: input.rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      const raced = await this.prisma.onchainPaymentReceipt.findUnique({
        where: { txHashNormalized },
      });
      if (raced?.externalOrderCode === input.externalOrderCode) return raced;
      throw error;
    }
  }

  async markOnchainPaymentReceiptProcessed(receiptId: string, rawPayload?: unknown) {
    return this.prisma.onchainPaymentReceipt.update({
      where: { id: receiptId },
      data: {
        processedAt: new Date(),
        rawPayloadJson: rawPayload as Prisma.InputJsonValue,
      },
    });
  }

  async getOnchainPaymentExpectation(externalOrderCode: string) {
    const target = await this.resolvePaymentStatusTarget(externalOrderCode);
    if (!target) throw new NotFoundException("Payment target not found.");
    if (!this.isReceiptBackedCryptoProvider(target.provider)) {
      throw new BadRequestException("Payment target is not a receipt-backed crypto payment.");
    }
    const expectation = this.extractOnchainExpectation(target);
    return {
      ...expectation,
      provider: target.provider,
      shopId: target.shopId,
      createdAt: target.createdAt,
      expiresAt: target.expiresAt,
    };
  }

  async assertCryptoReceiptClaimed(
    externalOrderCode: string,
    provider: PaymentProvider,
    txHash?: string | null,
  ) {
    if (!this.isReceiptBackedCryptoProvider(provider)) return null;

    const receipt = await this.prisma.onchainPaymentReceipt.findUnique({
      where: { externalOrderCode },
    });
    if (!receipt || receipt.provider !== provider) {
      throw new BadRequestException(
        "Crypto payment cannot be settled before its provider receipt is verified.",
      );
    }

    if (txHash) {
      const normalized = this.normalizeOnchainTxHash(txHash);
      if (receipt.txHashNormalized !== normalized) {
        throw new BadRequestException(
          "Crypto transaction hash does not match the verified receipt.",
        );
      }
    }

    return receipt;
  }

  normalizeOnchainTxHash(value: string) {
    const trimmed = String(value || "").trim();
    if (!trimmed) throw new BadRequestException("Blockchain transaction hash is required.");
    const withoutPrefix = trimmed.replace(/^0x/i, "");
    if (/^[a-fA-F0-9]{64}$/.test(withoutPrefix)) return withoutPrefix.toLowerCase();
    return trimmed;
  }

  private isDirectOnchainProvider(provider: PaymentProvider) {
    return provider === PaymentProvider.USDT_TRC20
      || provider === PaymentProvider.USDT_BEP20
      || provider === PaymentProvider.USDT_SOL
      || provider === PaymentProvider.USDT_TON;
  }

  private isReceiptBackedCryptoProvider(provider: PaymentProvider) {
    return provider === PaymentProvider.BINANCE
      || provider === PaymentProvider.OKX
      || this.isDirectOnchainProvider(provider);
  }

  private normalizeOnchainDestination(provider: PaymentProvider, value: string) {
    if (provider === PaymentProvider.USDT_BEP20) {
      return normalizeBep20Address(value) || "";
    }
    if (provider === PaymentProvider.USDT_TON) {
      return normalizeTonAddress(value) || "";
    }
    return String(value || "").trim();
  }

  private extractOnchainExpectation(target: {
    provider: PaymentProvider;
    rawPayloadJson?: Prisma.JsonValue | null;
  }) {
    const payload = target.rawPayloadJson && typeof target.rawPayloadJson === "object"
      ? target.rawPayloadJson as Record<string, unknown>
      : null;
    const manualCrypto = payload?.manualCrypto && typeof payload.manualCrypto === "object"
      ? payload.manualCrypto as Record<string, unknown>
      : null;
    const amountUsdt = Number(manualCrypto?.usdtAmount || 0);
    const destination = this.normalizeOnchainDestination(
      target.provider,
      String(manualCrypto?.address || manualCrypto?.uid || ""),
    );
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      throw new BadRequestException("On-chain invoice amount is missing.");
    }
    if (!destination) {
      throw new BadRequestException("On-chain invoice destination is missing or invalid.");
    }
    return { amountUsdt, destination };
  }

  private async reserveOnchainInvoiceAmount(input: {
    provider: PaymentProvider;
    destination: string;
    amountUsdt: number;
    externalOrderCode: string;
  }) {
    const destination = this.normalizeOnchainDestination(input.provider, input.destination);
    if (!destination) throw new BadRequestException("On-chain receiving address is invalid.");

    const existing = await this.prisma.onchainInvoiceReservation.findUnique({
      where: { externalOrderCode: input.externalOrderCode },
    });
    if (existing) return Number(existing.amountKey);

    const now = new Date();
    await this.prisma.onchainInvoiceReservation.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const step = Math.max(0.01, this.config.usdtPaymentTolerance * 2 + 0.01);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const candidate = this.ceilToDecimals(input.amountUsdt + attempt * step, 2);
      const amountKey = candidate.toFixed(8);
      try {
        await this.prisma.onchainInvoiceReservation.create({
          data: {
            provider: input.provider,
            destination,
            amountKey,
            externalOrderCode: input.externalOrderCode,
            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
          },
        });
        return candidate;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        const raced = await this.prisma.onchainInvoiceReservation.findUnique({
          where: { externalOrderCode: input.externalOrderCode },
        });
        if (raced) return Number(raced.amountKey);
      }
    }
    throw new ServiceUnavailableException("Could not reserve a unique on-chain payment amount.");
  }

  resolveUsdtVndRate(paymentConfig: {
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

  private resolvePaypalVndRate(paymentConfig: {
    paypalVndRateOverride?: unknown;
  } | null) {
    const overrideRate = Number(paymentConfig?.paypalVndRateOverride ?? NaN);
    if (Number.isFinite(overrideRate) && overrideRate > 0) return overrideRate;
    const fallbackRate = Number(this.config.paypalVndRate || 26000);
    if (!Number.isFinite(fallbackRate) || fallbackRate <= 0) {
      throw new BadRequestException("PAYPAL_VND_RATE must be greater than 0.");
    }
    return fallbackRate;
  }

  async createPaymentLink(input: {
    shopId: string;
    externalOrderCode: string;
    amount: number;
    amountUsd?: number | null;
    description: string;
    expiredAt?: Date;
    providerOverride?: PaymentProvider;
  }): Promise<{
    provider: PaymentProvider;
    checkoutUrl: string;
    qrCode: string | null;
    providerPayload: unknown;
    providerAmount?: number;
    providerCurrency?: string;
    providerReference?: string;
    bankInfo?: PayOSBankInfo;
    manualCrypto?: {
      provider: "BINANCE" | "OKX" | "USDT_TRC20" | "USDT_BEP20" | "USDT_SOL" | "USDT_TON";
      uid?: string | null;
      address?: string | null;
      network?: "TRC20" | "BEP20" | "SOLANA" | "TON" | null;
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

    // Env payment-credential fallback is allowed ONLY for platform pseudo-shops. A real shop with
    // blank/undecryptable keys fails closed (see isPlatformShop) so its money can't route to the
    // platform owner's PayOS/Pay2s/etc. account.
    const allowEnvFallback = this.isPlatformShop(input.shopId);

    const provider = this.config.paymentMode === "mock"
      ? PaymentProvider.MOCK
      : (input.providerOverride || paymentConfig?.provider || PaymentProvider.PAYOS);

    const providerFeature: FeatureFlagKey | null =
      provider === PaymentProvider.USDT_TRC20 ? "payment_trc20"
      : provider === PaymentProvider.USDT_BEP20 ? "payment_bep20"
      : provider === PaymentProvider.USDT_SOL ? "payment_solana"
      : provider === PaymentProvider.USDT_TON ? "payment_ton"
      : provider === PaymentProvider.PAYOS || provider === PaymentProvider.PAY2S || provider === PaymentProvider.WEB2M
        ? "payment_bank"
        : null;
    if (providerFeature) await this.featureFlags.assertEnabled(providerFeature);

    if (provider === PaymentProvider.PAYPAL) {
      const paypalVndRate = this.resolvePaypalVndRate(paymentConfig);
      const explicitUsd = Number(input.amountUsd ?? NaN);
      const rawAmountUsd = Number.isFinite(explicitUsd) && explicitUsd > 0
        ? explicitUsd
        : input.amount / paypalVndRate;
      const amountUsd = Math.ceil(rawAmountUsd * 100) / 100;
      if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
        throw new BadRequestException("PayPal amount must be at least 0.01 USD.");
      }
      const state = this.buildPaypalReturnState(input.externalOrderCode);
      const reconcileToken = this.buildPublicReconcileToken(input.externalOrderCode);
      const statusQuery = `orderCode=${encodeURIComponent(input.externalOrderCode)}&rt=${encodeURIComponent(reconcileToken)}`;
      const paypal = await this.paypalService.createOrder({
        shopId: input.shopId,
        externalOrderCode: input.externalOrderCode,
        description: input.description,
        amountUsd,
        returnUrl: `${this.config.appPublicUrl}/api/v1/webhooks/paypal/return/${encodeURIComponent(input.externalOrderCode)}?state=${encodeURIComponent(state)}`,
        cancelUrl: `${this.config.webPublicUrl}/payments/cancel?${statusQuery}`,
      });
      return {
        provider,
        checkoutUrl: paypal.checkoutUrl,
        qrCode: null,
        providerAmount: amountUsd,
        providerCurrency: "USD",
        providerReference: paypal.orderId,
        providerPayload: {
          paypal: {
            orderId: paypal.orderId,
            amountUsd,
            currency: "USD",
            vndAmount: input.amount,
            vndRate: paypalVndRate,
            sandbox: paypal.sandbox,
            createResponse: paypal.rawPayload,
          },
        },
      };
    }

    // ── BINANCE_PAY (auto merchant flow) ──────────────────────────────────────
    if (provider === PaymentProvider.BINANCE_PAY) {
      return this.createBinancePayPaymentLink(paymentConfig, input, allowEnvFallback);
    }

    if (
      provider === PaymentProvider.BINANCE ||
      provider === PaymentProvider.OKX ||
      provider === PaymentProvider.USDT_TRC20 ||
      provider === PaymentProvider.USDT_BEP20 ||
      provider === PaymentProvider.USDT_SOL ||
      provider === PaymentProvider.USDT_TON
    ) {
      return await this.createManualCryptoPaymentLink(provider, paymentConfig as any, input);
    }

    if (provider === PaymentProvider.PAYOS) {
      const credentials = this.resolvePayOSCredentials(paymentConfig, allowEnvFallback);
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
        bankInfo: response.bankInfo,
      };
    }

    if (provider === PaymentProvider.WEB2M) {
      const creds = this.resolveWeb2mPaymentCredentials(paymentConfig, allowEnvFallback);
      const orderInfo = input.description.replace(/[^A-Za-z0-9]/g, "").slice(0, 32)
        || `ORD${input.externalOrderCode.slice(-6)}`;
      const qrUrl = buildVietQrImageUrl({
        bankCode: creds.bankCode,
        accountNumber: creds.accountNumber,
        amount: Math.round(input.amount),
        description: orderInfo,
      });
      const bankInfo: PayOSBankInfo = {
        accountNumber: creds.accountNumber,
        accountName: "",
        bin: creds.bankCode.toUpperCase(),
        description: orderInfo,
      };
      return {
        provider,
        checkoutUrl: qrUrl,
        qrCode: qrUrl,
        providerPayload: { web2m: true, orderInfo, amount: input.amount },
        bankInfo,
      };
    }

    if (provider === PaymentProvider.PAY2S) {
      const credentials = this.resolvePay2sCredentials(paymentConfig, allowEnvFallback);
      const reconcileToken = this.buildPublicReconcileToken(input.externalOrderCode);
      const paymentStatusQuery = `orderCode=${encodeURIComponent(input.externalOrderCode)}&rt=${encodeURIComponent(reconcileToken)}`;

      const response = await createPay2sPaymentLink(credentials, {
        orderCode: input.externalOrderCode,
        orderId: input.externalOrderCode,
        amount: Math.round(input.amount),
        description: input.description.replace(/[^A-Za-z0-9]/g, "").slice(0, 32) || `ORD${input.externalOrderCode.slice(-6)}`,
        redirectUrl: `${this.config.webPublicUrl}/payments/success?${paymentStatusQuery}`,
        ipnUrl: `${this.config.appPublicUrl}/api/v1/webhooks/pay2s`,
      });

      const bankInfo: PayOSBankInfo | undefined = response.bankInfo
        ? {
            accountNumber: response.bankInfo.accountNumber,
            accountName: response.bankInfo.accountName,
            // Map Pay2s bank CODE → NAPAS BIN so we can render a branded VietQR (like PayOS).
            bin: pay2sBankCodeToBin(response.bankInfo.bankId) || response.bankInfo.bankId,
            // Memo = externalOrderCode so both the QR scan and a manual transfer carry the code the
            // balance webhook / IPN match on (findPay2sPendingByContent matches externalOrderCode).
            description: input.externalOrderCode,
          }
        : undefined;

      return {
        provider,
        checkoutUrl: response.checkoutUrl,
        qrCode: response.qrCode,
        providerPayload: response.providerResponse,
        bankInfo,
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
      usdtSolanaAddress?: string | null;
      usdtTonAddress?: string | null;
      usdtVndRateOverride?: unknown;
      binancePersonalApiKeyEncrypted?: string | null;
      binancePersonalSecretKeyEncrypted?: string | null;
      okxPersonalApiKeyEncrypted?: string | null;
      okxPersonalSecretKeyEncrypted?: string | null;
      okxPersonalPassphraseEncrypted?: string | null;
      okxPersonalApiEnabled?: boolean;
      usdtBep20Address?: string | null;
    } | null,
    input: {
      shopId: string;
      externalOrderCode: string;
      amount: number;
    },
  ) {
    const cryptoProvider: "BINANCE" | "OKX" | "USDT_TRC20" | "USDT_BEP20" | "USDT_SOL" | "USDT_TON" =
      provider === PaymentProvider.BINANCE
        ? "BINANCE"
        : provider === PaymentProvider.OKX
          ? "OKX"
          : provider === PaymentProvider.USDT_SOL
            ? "USDT_SOL"
            : provider === PaymentProvider.USDT_TON
              ? "USDT_TON"
              : provider === PaymentProvider.USDT_BEP20
                ? "USDT_BEP20"
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
        : cryptoProvider === "USDT_BEP20"
          ? paymentConfig?.usdtBep20Address || ""
          : cryptoProvider === "USDT_SOL"
            ? paymentConfig?.usdtSolanaAddress || ""
            : cryptoProvider === "USDT_TON"
              ? paymentConfig?.usdtTonAddress || ""
              : "",
    ).trim();

    if (cryptoProvider === "USDT_TRC20" && !address) {
      throw new BadRequestException("USDT TRC20 address is not configured.");
    }

    if (cryptoProvider === "USDT_BEP20" && !address) {
      throw new BadRequestException("USDT BEP20 address is not configured.");
    }

    if (cryptoProvider === "USDT_SOL" && !address) {
      throw new BadRequestException("USDT Solana address is not configured.");
    }

    if (cryptoProvider === "USDT_TON" && !address) {
      throw new BadRequestException("USDT TON address is not configured.");
    }

    if (!["USDT_TRC20", "USDT_BEP20", "USDT_SOL", "USDT_TON"].includes(cryptoProvider) && !uid) {
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

    // OKX Personal API — auto-detect via amount matching, same anti-collision
    // trick as Binance: bump USDT amount by 0.01 if there is another pending
    // OKX order with the same amount in the last hour. The worker poller
    // matches incoming deposits by exact amount, so amounts must be unique.
    if (
      cryptoProvider === "OKX" &&
      paymentConfig?.okxPersonalApiEnabled &&
      paymentConfig?.okxPersonalApiKeyEncrypted &&
      paymentConfig?.okxPersonalSecretKeyEncrypted &&
      paymentConfig?.okxPersonalPassphraseEncrypted
    ) {
      hasPersonalApi = true;

      const recentPending = await this.prisma.paymentTransaction.findMany({
        where: {
          provider: PaymentProvider.OKX,
          status: "PENDING",
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          order: { shopId: input.shopId },
        },
        select: { rawPayloadJson: true },
      });
      const usedUsdtAmounts = new Set(
        recentPending.map((t) => {
          const payload = t.rawPayloadJson as any;
          return Number(payload?.manualCrypto?.usdtAmount || 0);
        }),
      );
      let offset = 0;
      let targetUsdt = usdtAmount;
      while (usedUsdtAmounts.has(targetUsdt) && offset < 99) {
        offset += 0.01;
        targetUsdt = this.ceilToDecimals(usdtAmount + offset, 2);
      }
      usdtAmount = targetUsdt;
    }

    // Anti-collision for USDT_TRC20 (auto-detect needs unique amounts to match)
    if (cryptoProvider === "USDT_TRC20") {
      const [recentPendingOrders, recentPendingTopups] = await Promise.all([
        this.prisma.paymentTransaction.findMany({
          where: {
            provider: PaymentProvider.USDT_TRC20,
            status: "PENDING",
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            order: { shopId: input.shopId },
          },
          select: { rawPayloadJson: true },
        }),
        this.prisma.customerWalletTopup.findMany({
          where: {
            provider: PaymentProvider.USDT_TRC20,
            status: "PENDING",
            shopId: input.shopId,
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
          select: { rawPayloadJson: true },
        }),
      ]);
      const usedAmounts = new Set<number>();
      for (const t of [...recentPendingOrders, ...recentPendingTopups]) {
        const payload = t.rawPayloadJson as any;
        const amount = Number(payload?.manualCrypto?.usdtAmount || 0);
        if (amount > 0) usedAmounts.add(amount);
      }
      let offset = 0;
      let targetUsdt = usdtAmount;
      while (usedAmounts.has(targetUsdt) && offset < 99) {
        offset += 0.01;
        targetUsdt = this.ceilToDecimals(usdtAmount + offset, 2);
      }
      usdtAmount = targetUsdt;
    }

    // Anti-collision for USDT_BEP20 (auto-detect needs unique amounts to match)
    if (cryptoProvider === "USDT_BEP20") {
      const [recentPendingOrders, recentPendingTopups, recentPendingDeposits] = await Promise.all([
        this.prisma.paymentTransaction.findMany({
          where: {
            provider: PaymentProvider.USDT_BEP20,
            status: "PENDING",
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
          select: { rawPayloadJson: true },
        }),
        this.prisma.customerWalletTopup.findMany({
          where: {
            provider: PaymentProvider.USDT_BEP20,
            status: "PENDING",
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
          select: { rawPayloadJson: true },
        }),
        this.prisma.depositRequest.findMany({
          where: {
            provider: PaymentProvider.USDT_BEP20,
            status: "PENDING",
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
          select: { rawPayloadJson: true },
        }),
      ]);
      const usedAmounts = new Set<number>();
      for (const t of [...recentPendingOrders, ...recentPendingTopups, ...recentPendingDeposits]) {
        const payload = t.rawPayloadJson as any;
        const amount = Number(payload?.manualCrypto?.usdtAmount || 0);
        if (amount > 0) usedAmounts.add(Number(amount.toFixed(2)));
      }
      const minimumGap = Math.max(0.01, this.config.usdtPaymentTolerance * 2);
      let offset = 0;
      let targetUsdt = usdtAmount;
      const collides = (candidate: number) => [...usedAmounts].some(
        (used) => Math.abs(used - candidate) <= minimumGap + 1e-9,
      );
      while (collides(Number(targetUsdt.toFixed(2))) && offset < 99) {
        offset += 0.01;
        targetUsdt = this.ceilToDecimals(usdtAmount + offset, 2);
      }
      usdtAmount = targetUsdt;
    }

    // Anti-collision for USDT_SOL (auto-detect needs unique amounts to match)
    if (cryptoProvider === "USDT_SOL") {
      const [recentPendingOrders, recentPendingTopups] = await Promise.all([
        this.prisma.paymentTransaction.findMany({
          where: {
            provider: PaymentProvider.USDT_SOL,
            status: "PENDING",
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            order: { shopId: input.shopId },
          },
          select: { rawPayloadJson: true },
        }),
        this.prisma.customerWalletTopup.findMany({
          where: {
            provider: PaymentProvider.USDT_SOL,
            status: "PENDING",
            shopId: input.shopId,
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
          select: { rawPayloadJson: true },
        }),
      ]);
      const usedAmounts = new Set<number>();
      for (const t of [...recentPendingOrders, ...recentPendingTopups]) {
        const payload = t.rawPayloadJson as any;
        const amount = Number(payload?.manualCrypto?.usdtAmount || 0);
        if (amount > 0) usedAmounts.add(amount);
      }
      let offset = 0;
      let targetUsdt = usdtAmount;
      while (usedAmounts.has(targetUsdt) && offset < 99) {
        offset += 0.01;
        targetUsdt = this.ceilToDecimals(usdtAmount + offset, 2);
      }
      usdtAmount = targetUsdt;
    }

    // TON invoices are matched by exact amount. Keep the amount unique platform-wide because
    // multiple shops may intentionally receive into the same TON wallet.
    if (cryptoProvider === "USDT_TON") {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000);
      const [recentPendingOrders, recentPendingTopups, recentPendingDeposits] = await Promise.all([
        this.prisma.paymentTransaction.findMany({
          where: {
            provider: PaymentProvider.USDT_TON,
            status: "PENDING",
            createdAt: { gte: cutoff },
          },
          select: { rawPayloadJson: true },
        }),
        this.prisma.customerWalletTopup.findMany({
          where: {
            provider: PaymentProvider.USDT_TON,
            status: "PENDING",
            createdAt: { gte: cutoff },
          },
          select: { rawPayloadJson: true },
        }),
        this.prisma.depositRequest.findMany({
          where: {
            provider: PaymentProvider.USDT_TON,
            status: "PENDING",
            createdAt: { gte: cutoff },
          },
          select: { rawPayloadJson: true },
        }),
      ]);
      const usedAmounts = new Set<number>();
      for (const record of [...recentPendingOrders, ...recentPendingTopups, ...recentPendingDeposits]) {
        const payload = record.rawPayloadJson as any;
        const amount = Number(payload?.manualCrypto?.usdtAmount || 0);
        if (amount > 0) usedAmounts.add(Number(amount.toFixed(2)));
      }

      // Matching accepts +/- USDT_PAYMENT_TOLERANCE, so invoice amounts must be farther
      // apart than twice that tolerance; merely avoiding exact duplicates is insufficient.
      const minimumGap = Math.max(0.01, this.config.usdtPaymentTolerance * 2);
      let offset = 0;
      let targetUsdt = usdtAmount;
      const collides = (candidate: number) => [...usedAmounts].some(
        (used) => Math.abs(used - candidate) <= minimumGap + 1e-9,
      );
      while (collides(Number(targetUsdt.toFixed(2))) && offset < 99) {
        offset += 0.01;
        targetUsdt = this.ceilToDecimals(usdtAmount + offset, 2);
      }
      usdtAmount = targetUsdt;
    }

    if ([
      "USDT_TRC20",
      "USDT_BEP20",
      "USDT_SOL",
      "USDT_TON",
    ].includes(cryptoProvider)) {
      usdtAmount = await this.reserveOnchainInvoiceAmount({
        provider,
        destination: address,
        amountUsdt: usdtAmount,
        externalOrderCode: input.externalOrderCode,
      });
    }

    const note = input.externalOrderCode;
    const manualCrypto = {
      provider: cryptoProvider,
      uid: uid || null,
      address: address || null,
      network: cryptoProvider === "USDT_TRC20"
        ? ("TRC20" as const)
        : cryptoProvider === "USDT_BEP20"
          ? ("BEP20" as const)
          : cryptoProvider === "USDT_SOL"
            ? ("SOLANA" as const)
            : cryptoProvider === "USDT_TON"
              ? ("TON" as const)
              : null,
      usdtAmount,
      usdtVndRate: rate,
      note,
      hasPersonalApi,
    };
    const checkoutUrl = `manual-crypto://${cryptoProvider.toLowerCase()}/${input.externalOrderCode}`;
    const qrCode = ["USDT_TRC20", "USDT_BEP20", "USDT_SOL", "USDT_TON"].includes(cryptoProvider)
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

    if (
      target.provider !== PaymentProvider.PAYOS
      && target.provider !== PaymentProvider.BINANCE_PAY
      && target.provider !== PaymentProvider.PAYPAL
    ) {
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

    if (target.provider === PaymentProvider.PAYPAL) {
      return this.reconcilePaypalOrder(externalOrderCode);
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

  async getTelegramBotUsernameForExternalOrderCode(externalOrderCode: string) {
    const target = await this.resolvePaymentStatusTarget(externalOrderCode);
    if (!target?.shopId) return null;
    const botConfig = await this.prisma.botConfig.findUnique({
      where: { shopId: target.shopId },
      select: { telegramBotUsername: true },
    });
    const username = String(botConfig?.telegramBotUsername || "").replace(/^@/, "").trim();
    return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : null;
  }

  async resolvePaypalWebhookExternalOrderCode(event: unknown) {
    const fromPayload = extractPaypalWebhookExternalOrderCode(event);
    if (fromPayload) return fromPayload;
    const paypalOrderId = extractPaypalWebhookOrderId(event);
    if (!paypalOrderId) return "";
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: {
        provider: PaymentProvider.PAYPAL,
        providerReference: paypalOrderId,
      },
      select: { externalOrderCode: true },
    });
    return transaction?.externalOrderCode || "";
  }

  async reconcilePaypalOrder(
    externalOrderCode: string,
    paypalOrderId?: string | null,
    expectedShopId?: string | null,
  ) {
    const target = await this.resolvePaymentStatusTarget(externalOrderCode);
    if (!target || target.provider !== PaymentProvider.PAYPAL) {
      throw new BadRequestException("PayPal payment record not found.");
    }
    if (expectedShopId && target.shopId !== expectedShopId) {
      throw new BadRequestException("PayPal webhook shop does not match the payment record.");
    }
    const expectedOrderId = String(target.providerReference || "").trim();
    const requestedOrderId = String(paypalOrderId || expectedOrderId).trim();
    if (!expectedOrderId || !requestedOrderId || requestedOrderId !== expectedOrderId) {
      throw new BadRequestException("PayPal order reference does not match the payment record.");
    }

    let remoteOrder = await this.paypalService.getOrder(target.shopId, expectedOrderId);
    let summary = summarizePaypalOrder(remoteOrder);
    if (summary.status === "APPROVED" && !summary.completed) {
      remoteOrder = await this.paypalService.captureOrder(
        target.shopId,
        expectedOrderId,
        externalOrderCode,
      );
      summary = summarizePaypalOrder(remoteOrder);
    }

    const expectedAmount = Number(target.providerAmount || 0);
    const expectedCurrency = String(target.providerCurrency || "USD").toUpperCase();
    if (!summary.orderId || summary.orderId !== expectedOrderId) {
      throw new BadRequestException("PayPal returned a different order reference.");
    }
    if (!summary.externalOrderCode || summary.externalOrderCode !== externalOrderCode) {
      throw new BadRequestException("PayPal order does not belong to this local payment.");
    }
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      throw new BadRequestException("Stored PayPal amount is invalid.");
    }
    if (summary.currency !== expectedCurrency || Math.abs(summary.amount - expectedAmount) > 0.001) {
      throw new BadRequestException("PayPal order currency or amount does not match.");
    }
    if (summary.completed && summary.amountPaid + 0.001 < expectedAmount) {
      throw new BadRequestException("PayPal captured less than the required amount.");
    }

    return {
      kind: target.kind,
      provider: target.provider,
      providerStatus: summary.status,
      amount: summary.amount,
      amountPaid: summary.amountPaid,
      localPaymentStatus: target.localPaymentStatus,
      localOrderStatus: target.localOrderStatus,
      failureReason: target.failureReason,
      rawPayload: remoteOrder,
      paypalOrderId: summary.orderId,
      paypalCaptureId: summary.captureId,
    };
  }

  async verifyPaypalWebhook(
    shopId: string,
    headers: Record<string, string | string[] | undefined>,
    event: unknown,
  ) {
    return this.paypalService.verifyWebhook(shopId, headers, event);
  }

  /**
   * Find a shop's PaymentConfig by matching the Web2m access token (Bearer header value).
   * Used to authenticate the Web2m webhook callback.
   */
  async findShopByWeb2mAccessToken(bearer: string): Promise<{ shopId: string } | null> {
    if (!bearer) return null;
    const configs = await this.prisma.paymentConfig.findMany({
      where: {
        provider: PaymentProvider.WEB2M,
        web2mAccessTokenEncrypted: { not: null },
      },
      select: { shopId: true, web2mAccessTokenEncrypted: true },
    });
    for (const c of configs) {
      const stored = this.safeDecryptSecret(c.web2mAccessTokenEncrypted);
      if (stored && stored === bearer) {
        return { shopId: c.shopId };
      }
    }
    return null;
  }

  /**
   * List PENDING Web2m payments for a shop within a time window.
   */
  async listPendingWeb2mPayments(shopId: string, since: Date) {
    const [txRows, depositRows, topupRows] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: {
          provider: PaymentProvider.WEB2M,
          status: "PENDING",
          createdAt: { gte: since },
          order: { shopId },
        },
        select: {
          externalOrderCode: true,
          amount: true,
          order: { select: { orderCode: true } },
        },
        take: 200,
      }),
      this.isPlatformShop(shopId)
        ? this.prisma.depositRequest.findMany({
        where: {
          provider: PaymentProvider.WEB2M,
          status: "PENDING",
          createdAt: { gte: since },
          externalOrderCode: { not: null },
        },
        select: {
          externalOrderCode: true,
          amount: true,
        },
          take: 200,
        })
        : Promise.resolve([]),
      // Customer wallet top-ups — same gap as PAY2S: without this the WEB2M bank webhook only
      // matched orders + seller deposits, so a wallet top-up never auto-credited.
      this.prisma.customerWalletTopup.findMany({
        where: {
          provider: PaymentProvider.WEB2M,
          status: "PENDING",
          shopId,
          createdAt: { gte: since },
        },
        select: {
          externalOrderCode: true,
          amount: true,
        },
        take: 200,
      }),
    ]);
    return [
      ...txRows.map((r) => ({
        externalOrderCode: r.externalOrderCode,
        amount: r.amount,
        orderCode: (r as any).order?.orderCode ?? null,
      })),
      ...depositRows.map((d) => ({
        externalOrderCode: d.externalOrderCode!,
        amount: d.amount,
        orderCode: null,
      })),
      ...topupRows.map((t) => ({
        externalOrderCode: t.externalOrderCode,
        amount: t.amount,
        orderCode: null,
      })),
    ];
  }

  /**
   * Resolve Web2m credentials needed to render a VietQR for a NEW payment.
   * Webhook-based flow only needs account + bank code (no IB password / API token).
   */
  private resolveWeb2mPaymentCredentials(paymentConfig: {
    web2mAccountNumber: string | null;
    web2mBankCode: string | null;
  } | null, allowEnvFallback = true) {
    const env = (v: string | undefined) => (allowEnvFallback ? v || "" : "");
    const accountNumber = paymentConfig?.web2mAccountNumber || env(process.env.WEB2M_ACCOUNT_NUMBER);
    const bankCode = (paymentConfig?.web2mBankCode || env(process.env.WEB2M_BANK_CODE)).toLowerCase();
    if (!accountNumber || !bankCode) {
      throw new BadRequestException(
        allowEnvFallback
          ? "Web2m configuration is incomplete (missing bank account or bank code)."
          : "Shop chưa cấu hình Web2m (thiếu số tài khoản / mã ngân hàng). Vào Cài đặt thanh toán để nhập, hoặc chọn cổng thanh toán khác.",
      );
    }
    return { accountNumber, bankCode };
  }

  private resolveWeb2mCredentials(paymentConfig: {
    web2mAccountNumber: string | null;
    web2mBankCode: string | null;
    web2mPasswordEncrypted: string | null;
    web2mTokenEncrypted: string | null;
  } | null) {
    const accountNumber =
      paymentConfig?.web2mAccountNumber || process.env.WEB2M_ACCOUNT_NUMBER || "";
    const bankCode =
      (paymentConfig?.web2mBankCode || process.env.WEB2M_BANK_CODE || "").toLowerCase();
    const password =
      this.safeDecryptSecret(paymentConfig?.web2mPasswordEncrypted) ||
      process.env.WEB2M_PASSWORD ||
      "";
    const token =
      this.safeDecryptSecret(paymentConfig?.web2mTokenEncrypted) ||
      process.env.WEB2M_TOKEN ||
      "";

    if (!accountNumber || !bankCode || !password || !token) {
      throw new BadRequestException("Web2m configuration is incomplete.");
    }

    return { accountNumber, bankCode, password, token };
  }

  /**
   * Poll Web2m bank API for new transactions and match them against pending payments
   * for the given shop. Called by worker every N seconds.
   * Returns array of externalOrderCodes that were marked PAID.
   */
  async pollWeb2mForShop(shopId: string): Promise<string[]> {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({ where: { shopId } });
    if (!paymentConfig || paymentConfig.provider !== PaymentProvider.WEB2M) return [];

    let creds;
    try {
      creds = this.resolveWeb2mCredentials(paymentConfig);
    } catch {
      return [];
    }

    let transactions: Web2mTransaction[];
    try {
      transactions = await fetchWeb2mTransactions(creds);
    } catch {
      return [];
    }
    if (transactions.length === 0) return [];

    // Get pending Web2m payments for this shop (last 24 hours)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pending = await this.prisma.paymentTransaction.findMany({
      where: {
        provider: PaymentProvider.WEB2M,
        status: "PENDING",
        createdAt: { gte: since },
      },
      select: { externalOrderCode: true, amount: true },
      take: 200,
    });

    const matched: string[] = [];
    for (const txn of transactions) {
      if (txn.amount <= 0) continue;
      const normalized = txn.description.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!normalized) continue;
      for (const p of pending) {
        const code = String(p.externalOrderCode).toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!code) continue;
        const last6 = code.slice(-6);
        const codeMatches = normalized.includes(code) || (last6.length === 6 && normalized.includes(last6));
        if (!codeMatches) continue;
        const expectedAmount = Number(p.amount);
        if (Math.abs(expectedAmount - txn.amount) > 1) continue;
        matched.push(p.externalOrderCode);
        break; // each transaction matches at most 1 payment
      }
    }

    return matched;
  }

  /**
   * Find a PENDING Pay2s payment whose externalOrderCode (or its last 6 chars) appears in
   * the transfer content and whose amount matches. Used for the bank balance webhook
   * where Pay2s reports any incoming credit to the shop's bank account.
   */
  async findPay2sPendingByContent(content: string, amount: number): Promise<string | null> {
    const normalized = content.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!normalized) return null;

    const [pendingTx, pendingDeposits, pendingTopups] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: {
          provider: PaymentProvider.PAY2S,
          status: "PENDING",
        },
        select: {
          externalOrderCode: true,
          amount: true,
          order: { select: { orderCode: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.depositRequest.findMany({
        where: {
          provider: PaymentProvider.PAY2S,
          status: "PENDING",
          externalOrderCode: { not: null },
        },
        select: { externalOrderCode: true, amount: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      // Customer wallet top-ups (bot wallet) — without this the bank-balance webhook only matched
      // orders + seller deposits, so a PAY2S wallet top-up never auto-credited via the balance hook.
      this.prisma.customerWalletTopup.findMany({
        where: {
          provider: PaymentProvider.PAY2S,
          status: "PENDING",
        },
        select: { externalOrderCode: true, amount: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);

    const candidates = [
      ...pendingTx.map((p) => ({ externalOrderCode: p.externalOrderCode, orderCode: p.order.orderCode, amount: p.amount })),
      ...pendingDeposits.map((d) => ({ externalOrderCode: d.externalOrderCode!, orderCode: null, amount: d.amount })),
      ...pendingTopups.map((t) => ({ externalOrderCode: t.externalOrderCode, orderCode: null, amount: t.amount })),
    ];

    for (const p of candidates) {
      const code = String(p.externalOrderCode).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!code) continue;
      const last6 = code.slice(-6);
      const orderCode = String(p.orderCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const codeMatches =
        normalized.includes(code) ||
        (last6.length === 6 && normalized.includes(last6)) ||
        (orderCode.length > 0 && normalized.includes(orderCode));
      if (!codeMatches) continue;
      const expectedAmount = Number(p.amount);
      // tolerance ±1 VND for rounding
      if (Math.abs(expectedAmount - amount) <= 1) {
        return p.externalOrderCode;
      }
    }
    return null;
  }

  async getPay2sCredentialsForExternalOrderCode(externalOrderCode: string) {
    const target = await this.resolvePaymentStatusTarget(externalOrderCode);
    if (!target || target.provider !== PaymentProvider.PAY2S) {
      return {
        partnerCode: process.env.PAY2S_PARTNER_CODE || "",
        accessKey: process.env.PAY2S_ACCESS_KEY || "",
        secretKey: process.env.PAY2S_SECRET_KEY || "",
      };
    }
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId: target.shopId },
    });
    return {
      partnerCode:
        this.safeDecryptSecret(paymentConfig?.pay2sPartnerCodeEncrypted) ||
        process.env.PAY2S_PARTNER_CODE ||
        "",
      accessKey:
        this.safeDecryptSecret(paymentConfig?.pay2sAccessKeyEncrypted) ||
        process.env.PAY2S_ACCESS_KEY ||
        "",
      secretKey:
        this.safeDecryptSecret(paymentConfig?.pay2sSecretKeyEncrypted) ||
        process.env.PAY2S_SECRET_KEY ||
        "",
    };
  }

  /** Resolve a shop's Pay2s balance-webhook token (the value the seller declared on the Hook). */
  async getPay2sWebhookTokenForExternalOrderCode(externalOrderCode: string): Promise<string> {
    const target = await this.resolvePaymentStatusTarget(externalOrderCode);
    if (!target) {
      return process.env.PAY2S_WEBHOOK_TOKEN || "";
    }
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId: target.shopId },
    });
    return (
      this.safeDecryptSecret(paymentConfig?.pay2sWebhookTokenEncrypted) ||
      process.env.PAY2S_WEBHOOK_TOKEN ||
      ""
    );
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

  private resolvePay2sCredentials(paymentConfig: {
    pay2sPartnerCodeEncrypted: string | null;
    pay2sAccessKeyEncrypted: string | null;
    pay2sSecretKeyEncrypted: string | null;
    pay2sBankAccount: string | null;
    pay2sBankId: string | null;
  } | null, allowEnvFallback = true) {
    const env = (v: string | undefined) => (allowEnvFallback ? v || "" : "");
    const partnerCode =
      this.safeDecryptSecret(paymentConfig?.pay2sPartnerCodeEncrypted) || env(process.env.PAY2S_PARTNER_CODE);
    const accessKey =
      this.safeDecryptSecret(paymentConfig?.pay2sAccessKeyEncrypted) || env(process.env.PAY2S_ACCESS_KEY);
    const secretKey =
      this.safeDecryptSecret(paymentConfig?.pay2sSecretKeyEncrypted) || env(process.env.PAY2S_SECRET_KEY);
    const bankAccount = paymentConfig?.pay2sBankAccount || env(process.env.PAY2S_BANK_ACCOUNT);
    const bankId = paymentConfig?.pay2sBankId || env(process.env.PAY2S_BANK_ID);

    if (!partnerCode || !accessKey || !secretKey || !bankAccount || !bankId) {
      throw new BadRequestException(
        allowEnvFallback
          ? "Pay2s configuration is incomplete."
          : "Shop chưa cấu hình Pay2s. Vào Cài đặt thanh toán để nhập key riêng, hoặc chọn cổng thanh toán khác.",
      );
    }

    return { partnerCode, accessKey, secretKey, bankAccount, bankId };
  }

  private resolvePayOSCredentials(paymentConfig: {
    payosClientIdEncrypted: string | null;
    payosApiKeyEncrypted: string | null;
    payosChecksumKeyEncrypted: string | null;
  } | null, allowEnvFallback = true) {
    const env = (v: string | undefined) => (allowEnvFallback ? v || "" : "");
    const clientId =
      this.safeDecryptSecret(paymentConfig?.payosClientIdEncrypted) || env(process.env.PAYOS_CLIENT_ID);
    const apiKey =
      this.safeDecryptSecret(paymentConfig?.payosApiKeyEncrypted) || env(process.env.PAYOS_API_KEY);
    const checksumKey =
      this.safeDecryptSecret(paymentConfig?.payosChecksumKeyEncrypted) || env(process.env.PAYOS_CHECKSUM_KEY);

    if (!clientId || !apiKey || !checksumKey) {
      throw new BadRequestException(
        allowEnvFallback
          ? "PayOS configuration is incomplete."
          : "Shop chưa cấu hình PayOS (thiếu Client ID / API Key / Checksum Key). Vào Cài đặt thanh toán để nhập key riêng, hoặc chọn cổng thanh toán khác.",
      );
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
  } | null, allowEnvFallback = true) {
    const env = (v: string | undefined) => (allowEnvFallback ? v || "" : "");
    const apiKey =
      this.safeDecryptSecret(paymentConfig?.binancePayApiKeyEncrypted) || env(process.env.BINANCE_PAY_API_KEY);
    const secretKey =
      this.safeDecryptSecret(paymentConfig?.binancePaySecretKeyEncrypted) || env(process.env.BINANCE_PAY_SECRET_KEY);

    if (!apiKey || !secretKey) {
      throw new BadRequestException(
        allowEnvFallback
          ? "Binance Pay Merchant configuration is incomplete (missing API key or secret)."
          : "Shop chưa cấu hình Binance Pay. Vào Cài đặt thanh toán để nhập, hoặc chọn cổng thanh toán khác.",
      );
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
    allowEnvFallback = true,
  ) {
    const { apiKey, secretKey } = this.resolveBinancePayCredentials(paymentConfig, allowEnvFallback);
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
    createdAt: Date;
    expiresAt: Date | null;
    localPaymentStatus: string | null;
    localOrderStatus?: string | null;
    failureReason?: string | null;
    rawPayloadJson?: Prisma.JsonValue | null;
    providerAmount?: number | null;
    providerCurrency?: string | null;
    providerReference?: string | null;
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
        createdAt: paymentTransaction.createdAt,
        expiresAt: new Date(paymentTransaction.createdAt.getTime() + 30 * 60 * 1000),
        localPaymentStatus: paymentTransaction.status,
        localOrderStatus: paymentTransaction.order.status,
        failureReason: paymentTransaction.order.failureReason,
        rawPayloadJson: paymentTransaction.rawPayloadJson,
        providerAmount: paymentTransaction.providerAmount == null
          ? null
          : Number(paymentTransaction.providerAmount),
        providerCurrency: paymentTransaction.providerCurrency,
        providerReference: paymentTransaction.providerReference,
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
        rawPayloadJson: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    if (customerTopup) {
      return {
        kind: "customer_topup",
        provider: customerTopup.provider,
        shopId: customerTopup.shopId,
        createdAt: customerTopup.createdAt,
        expiresAt: customerTopup.expiresAt,
        localPaymentStatus: customerTopup.status,
        rawPayloadJson: customerTopup.rawPayloadJson,
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
        rawPayloadJson: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    if (!deposit) {
      const connectionTopup = await this.prisma.connectionTopupRequest.findUnique({
        where: { externalOrderCode },
        select: { provider: true, upstreamShopId: true, status: true, rawPayloadJson: true, createdAt: true, expiresAt: true },
      });

      if (!connectionTopup) {
        return null;
      }

      return {
        kind: "connection_topup",
        provider: connectionTopup.provider,
        shopId: connectionTopup.upstreamShopId,
        createdAt: connectionTopup.createdAt,
        expiresAt: connectionTopup.expiresAt,
        localPaymentStatus: connectionTopup.status,
        rawPayloadJson: connectionTopup.rawPayloadJson,
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
      createdAt: deposit.createdAt,
      expiresAt: deposit.expiresAt,
      localPaymentStatus: deposit.status,
      rawPayloadJson: deposit.rawPayloadJson,
    };
  }
}
