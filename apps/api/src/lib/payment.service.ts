import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProvider } from "@prisma/client";
import {
  buildVietQrImageUrl,
  createPay2sPaymentLink,
  createPayOSPaymentLink,
  decryptSecret,
  fetchWeb2mTransactions,
  getPayOSPaymentLinkStatus,
  type Pay2sBankInfo,
  type PaymentLinkResult,
  type PayOSBankInfo,
  type Web2mTransaction,
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
    bankInfo?: PayOSBankInfo;
    manualCrypto?: {
      provider: "BINANCE" | "OKX" | "USDT_TRC20" | "USDT_SOL";
      uid?: string | null;
      address?: string | null;
      network?: "TRC20" | "SOLANA" | null;
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
      provider === PaymentProvider.USDT_TRC20 ||
      provider === PaymentProvider.USDT_SOL
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
        bankInfo: response.bankInfo,
      };
    }

    if (provider === PaymentProvider.WEB2M) {
      const creds = this.resolveWeb2mPaymentCredentials(paymentConfig);
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
      const credentials = this.resolvePay2sCredentials(paymentConfig);
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
            bin: response.bankInfo.bankId,
            description: input.description,
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
    const cryptoProvider: "BINANCE" | "OKX" | "USDT_TRC20" | "USDT_SOL" =
      provider === PaymentProvider.BINANCE
        ? "BINANCE"
        : provider === PaymentProvider.OKX
          ? "OKX"
          : provider === PaymentProvider.USDT_SOL
            ? "USDT_SOL"
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
        : cryptoProvider === "USDT_SOL"
          ? paymentConfig?.usdtSolanaAddress || ""
          : "",
    ).trim();

    if (cryptoProvider === "USDT_TRC20" && !address) {
      throw new BadRequestException("USDT TRC20 address is not configured.");
    }

    if (cryptoProvider === "USDT_SOL" && !address) {
      throw new BadRequestException("USDT Solana address is not configured.");
    }

    if (cryptoProvider !== "USDT_TRC20" && cryptoProvider !== "USDT_SOL" && !uid) {
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

    const note = input.externalOrderCode;
    const manualCrypto = {
      provider: cryptoProvider,
      uid: uid || null,
      address: address || null,
      network: cryptoProvider === "USDT_TRC20"
        ? ("TRC20" as const)
        : cryptoProvider === "USDT_SOL"
          ? ("SOLANA" as const)
          : null,
      usdtAmount,
      usdtVndRate: rate,
      note,
      hasPersonalApi,
    };
    const checkoutUrl = `manual-crypto://${cryptoProvider.toLowerCase()}/${input.externalOrderCode}`;
    const qrCode = cryptoProvider === "USDT_TRC20" || cryptoProvider === "USDT_SOL"
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
    const [txRows, depositRows] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: {
          provider: PaymentProvider.WEB2M,
          status: "PENDING",
          createdAt: { gte: since },
        },
        select: {
          externalOrderCode: true,
          amount: true,
          order: { select: { orderCode: true } },
        },
        take: 200,
      }),
      this.prisma.depositRequest.findMany({
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
    ];
  }

  /**
   * Resolve Web2m credentials needed to render a VietQR for a NEW payment.
   * Webhook-based flow only needs account + bank code (no IB password / API token).
   */
  private resolveWeb2mPaymentCredentials(paymentConfig: {
    web2mAccountNumber: string | null;
    web2mBankCode: string | null;
  } | null) {
    const accountNumber = paymentConfig?.web2mAccountNumber || process.env.WEB2M_ACCOUNT_NUMBER || "";
    const bankCode = (paymentConfig?.web2mBankCode || process.env.WEB2M_BANK_CODE || "").toLowerCase();
    if (!accountNumber || !bankCode) {
      throw new BadRequestException("Web2m configuration is incomplete (missing bank account or bank code).");
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

    const [pendingTx, pendingDeposits] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: {
          provider: PaymentProvider.PAY2S,
          status: "PENDING",
        },
        select: { externalOrderCode: true, amount: true },
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
    ]);

    const candidates = [
      ...pendingTx.map((p) => ({ externalOrderCode: p.externalOrderCode, amount: p.amount })),
      ...pendingDeposits.map((d) => ({ externalOrderCode: d.externalOrderCode!, amount: d.amount })),
    ];

    for (const p of candidates) {
      const code = String(p.externalOrderCode).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!code) continue;
      const last6 = code.slice(-6);
      const codeMatches = normalized.includes(code) || (last6.length === 6 && normalized.includes(last6));
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
  } | null) {
    const partnerCode =
      this.safeDecryptSecret(paymentConfig?.pay2sPartnerCodeEncrypted) ||
      process.env.PAY2S_PARTNER_CODE ||
      "";
    const accessKey =
      this.safeDecryptSecret(paymentConfig?.pay2sAccessKeyEncrypted) ||
      process.env.PAY2S_ACCESS_KEY ||
      "";
    const secretKey =
      this.safeDecryptSecret(paymentConfig?.pay2sSecretKeyEncrypted) ||
      process.env.PAY2S_SECRET_KEY ||
      "";
    const bankAccount =
      paymentConfig?.pay2sBankAccount || process.env.PAY2S_BANK_ACCOUNT || "";
    const bankId =
      paymentConfig?.pay2sBankId || process.env.PAY2S_BANK_ID || "";

    if (!partnerCode || !accessKey || !secretKey || !bankAccount || !bankId) {
      throw new BadRequestException("Pay2s configuration is incomplete.");
    }

    return { partnerCode, accessKey, secretKey, bankAccount, bankId };
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
