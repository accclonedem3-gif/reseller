/**
 * Binance Pay Merchant API client
 *
 * Docs:
 *   Auth/signing:     https://developers.binance.com/docs/binance-pay/authentication
 *   Common rules:     https://developers.binance.com/docs/binance-pay/api-common
 *   Create order v2:  https://developers.binance.com/docs/binance-pay/api-order-create-v2
 *   Query order v2:   https://developers.binance.com/docs/binance-pay/api-order-query-v2
 *   Webhook rules:    https://developers.binance.com/docs/binance-pay/webhook-common
 *   Query cert:       https://developers.binance.com/docs/binance-pay/webhook-query-certificate
 *   Notification:     https://developers.binance.com/docs/binance-pay/order-notification
 */

import * as crypto from "crypto";

import { BadRequestException, Injectable, Logger } from "@nestjs/common";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface BinancePayOrderResult {
  prepayId: string;
  terminalType: string;
  expireTime: number;
  qrcodeLink: string;
  qrContent: string;
  checkoutUrl: string;
  deeplink: string;
  universalUrl: string;
}

export interface BinancePayOrderStatus {
  merchantTradeNo: string;
  prepayId: string;
  status: "INITIAL" | "PENDING" | "PAID" | "CANCELED" | "ERROR" | "REFUNDING" | "REFUNDED" | "EXPIRED";
  currency: string;
  totalFee: string;
  openUserId?: string;
}

export interface BinancePayWebhookPayload {
  bizType: string;
  bizId: string;
  bizStatus: string;
  data: string; // JSON string
}

interface BinancePayCreateOrderBody {
  env: {
    terminalType: "WEB";
  };
  merchantTradeNo: string;
  orderAmount: number;
  currency: "USDT";
  goods: {
    goodsType: "02";
    goodsCategory: "Z000";
    referenceGoodsId: string;
    goodsName: string;
    goodsDetail?: string;
  };
  passThroughInfo: string;
  webhookUrl: string;
  orderExpireTime?: number;
}

interface BinancePayCertificate {
  certSerial: string;
  certPublic: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const BINANCE_PAY_BASE_URL = "https://bpay.binanceapi.com";
const MERCHANT_TRADE_NO_PREFIX = "RSP"; // max 32 chars total

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class BinancePayService {
  private readonly logger = new Logger(BinancePayService.name);

  // ── Signing ──────────────────────────────────────────────────────────────────

  /**
   * Build the canonical payload string and compute HMAC-SHA512 signature.
   *
   * Per docs:
   *   payload = timestamp + "\n" + nonce + "\n" + body + "\n"
   *   signature = HMAC-SHA512(payload, secretKey).toUpperCase()
   */
  buildSignature(
    timestamp: string,
    nonce: string,
    body: string,
    secretKey: string,
  ): string {
    const payload = `${timestamp}\n${nonce}\n${body}\n`;
    return crypto
      .createHmac("sha512", secretKey)
      .update(payload)
      .digest("hex")
      .toUpperCase();
  }

  buildHeaders(
    apiKey: string,
    secretKey: string,
    body: string,
  ): Record<string, string> {
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(16).toString("hex").toUpperCase(); // 32-char hex
    const signature = this.buildSignature(timestamp, nonce, body, secretKey);

    return {
      "Content-Type": "application/json",
      "BinancePay-Timestamp": timestamp,
      "BinancePay-Nonce": nonce,
      "BinancePay-Certificate-SN": apiKey, // apiKey acts as certificate serial number
      "BinancePay-Signature": signature,
    };
  }

  // ── API calls ────────────────────────────────────────────────────────────────

  /**
   * POST /binancepay/openapi/v2/order  — Create a new Binance Pay order
   *
   * We always use USDT (Phase 1). amount is VND, rate converts to USDT.
   */
  async createOrder(
    apiKey: string,
    secretKey: string,
    opts: {
      usdtAmount: number;       // already converted
      externalOrderCode: string;
      orderDescription: string; // used to derive a safe goodsName/goodsDetail
      webhookUrl: string;
      expiredAt?: Date;
    },
  ): Promise<BinancePayOrderResult> {
    const goodsName = this.sanitizeGoodsName(opts.orderDescription || opts.externalOrderCode);
    const merchantTradeNo = this.buildMerchantTradeNo(opts.externalOrderCode);
    const bodyPayload: BinancePayCreateOrderBody = {
      env: {
        terminalType: "WEB",
      },
      merchantTradeNo,
      orderAmount: Number(opts.usdtAmount.toFixed(2)),
      currency: "USDT",
      goods: {
        goodsType: "02",
        goodsCategory: "Z000",
        referenceGoodsId: this.sanitizeReferenceGoodsId(opts.externalOrderCode),
        goodsName,
        goodsDetail: this.sanitizeGoodsDetail(opts.orderDescription),
      },
      passThroughInfo: String(opts.externalOrderCode || "").slice(0, 512),
      webhookUrl: opts.webhookUrl,
      ...(opts.expiredAt
        ? {
            orderExpireTime: Math.max(Date.now() + 60_000, new Date(opts.expiredAt).getTime()),
          }
        : {}),
    };
    const body = JSON.stringify(bodyPayload);

    const headers = this.buildHeaders(apiKey, secretKey, body);
    const url = `${BINANCE_PAY_BASE_URL}/binancepay/openapi/v2/order`;

    this.logger.debug(`BinancePay createOrder → merchantTradeNo=${merchantTradeNo}`);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    const json = await res.json() as {
      status: string;
      code: string;
      errorMessage?: string;
      data?: BinancePayOrderResult;
    };

    if (json.status !== "SUCCESS" || !json.data) {
      throw new BadRequestException(
        `Binance Pay createOrder failed: [${json.code}] ${json.errorMessage || "unknown error"}`,
      );
    }

    return json.data;
  }

  /**
   * POST /binancepay/openapi/v2/order/query  — Query order status
   */
  async queryOrder(
    apiKey: string,
    secretKey: string,
    merchantTradeNo: string,
  ): Promise<BinancePayOrderStatus> {
    const body = JSON.stringify({ merchantTradeNo });
    const headers = this.buildHeaders(apiKey, secretKey, body);
    const url = `${BINANCE_PAY_BASE_URL}/binancepay/openapi/v2/order/query`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    const json = await res.json() as {
      status: string;
      code: string;
      errorMessage?: string;
      data?: BinancePayOrderStatus;
    };

    if (json.status !== "SUCCESS" || !json.data) {
      throw new BadRequestException(
        `Binance Pay queryOrder failed: [${json.code}] ${json.errorMessage || "unknown error"}`,
      );
    }

    return json.data;
  }

  /**
   * POST /binancepay/openapi/certificates  — Fetch RSA public key for webhook verification
   */
  async fetchCertificates(
    apiKey: string,
    secretKey: string,
  ): Promise<BinancePayCertificate[]> {
    const body = "{}";
    const headers = this.buildHeaders(apiKey, secretKey, body);
    const url = `${BINANCE_PAY_BASE_URL}/binancepay/openapi/certificates`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    const json = await res.json() as {
      status: string;
      code: string;
      errorMessage?: string;
      data?: BinancePayCertificate[];
    };

    if (json.status !== "SUCCESS" || !json.data) {
      throw new BadRequestException(
        `Binance Pay certificates fetch failed: [${json.code}] ${json.errorMessage || "unknown error"}`,
      );
    }

    return json.data;
  }

  // ── Personal Spot API (C2C) ────────────────────────────────────────────────

  /**
   * GET /sapi/v1/pay/transactions
   * Query personal Binance Pay (C2C) history.
   * Requires a standard Spot API key with "Enable Pay" read permission.
   */
  async queryPersonalPayTransactions(
    apiKey: string,
    secretKey: string,
    startTime?: number,
  ): Promise<{
    orderId: string;
    transactionId: string;
    transactionType: string;
    payeeId?: string;
    orderAmount?: string;
    amount?: string;
    currency: string;
    transactionTime: number;
    receipt?: string;
    payerInfo: any;
    receiverInfo?: any;
  }[]> {
    const timestamp = Date.now();
    let queryString = `timestamp=${timestamp}&limit=100`;

    if (startTime) {
      queryString += `&startTime=${startTime}`;
    }

    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(queryString)
      .digest("hex");

    const url = `https://api.binance.com/sapi/v1/pay/transactions?${queryString}&signature=${signature}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
    });

    const json = await res.json() as any;

    if (!res.ok || (json.code && json.code !== "000000")) {
      throw new BadRequestException(
        `Binance Spot API failed: [${json.code}] ${json.msg || "unknown error"}`,
      );
    }

    // Response structure: { code: '000000', message: 'success', data: [...] }
    return json.data || [];
  }

  // ── Webhook verification ─────────────────────────────────────────────────────

  /**
   * Verify a Binance Pay webhook signature using RSA public key.
   *
   * Per docs:
   *   payload   = timestamp + "\n" + nonce + "\n" + body + "\n"
   *   Verify RSA-SHA256 signature (base64) against payload using Binance's public key.
   */
  verifyWebhookSignature(
    timestamp: string,
    nonce: string,
    body: string,
    base64Signature: string,
    rsaPublicKeyPem: string,
  ): boolean {
    try {
      const payload = `${timestamp}\n${nonce}\n${body}\n`;
      const signatureBuffer = Buffer.from(base64Signature, "base64");

      return crypto.verify(
        "sha256",
        Buffer.from(payload),
        {
          key: rsaPublicKeyPem,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        signatureBuffer,
      );
    } catch (err) {
      this.logger.warn(
        "BinancePay webhook signature verification threw an error",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Derive a stable merchantTradeNo from an internal externalOrderCode.
   * Max 32 chars; we prefix with RSP and truncate.
   */
  buildMerchantTradeNo(externalOrderCode: string): string {
    const candidate = `${MERCHANT_TRADE_NO_PREFIX}${externalOrderCode}`.replace(/[^A-Za-z0-9]/g, "");
    return candidate.slice(0, 32);
  }

  /**
   * Reverse lookup: given merchantTradeNo, recover the externalOrderCode.
   */
  merchantTradeNoToExternalOrderCode(merchantTradeNo: string): string {
    return merchantTradeNo.startsWith(MERCHANT_TRADE_NO_PREFIX)
      ? merchantTradeNo.slice(MERCHANT_TRADE_NO_PREFIX.length)
      : merchantTradeNo;
  }

  ceilUsdt(vndAmount: number, usdtVndRate: number): number {
    const factor = 100;
    return Math.ceil((vndAmount / usdtVndRate) * factor) / factor;
  }

  private sanitizeReferenceGoodsId(value: string) {
    const normalized = String(value || "").replace(/[^A-Za-z0-9_-]/g, "");
    return normalized.slice(0, 64) || "ORDER";
  }

  private sanitizeGoodsName(value: string) {
    const normalized = String(value || "")
      .replace(/[^A-Za-z0-9 _.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return (normalized || "Reseller Order").slice(0, 256);
  }

  private sanitizeGoodsDetail(value: string) {
    const normalized = String(value || "")
      .replace(/[^A-Za-z0-9 _.,:-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return normalized ? normalized.slice(0, 256) : undefined;
  }
}
