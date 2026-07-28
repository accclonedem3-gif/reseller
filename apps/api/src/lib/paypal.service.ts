import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import axios, { AxiosError } from "axios";
import { decryptSecret } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import {
  extractPaypalApprovalUrl,
  formatPaypalUsdAmount,
} from "./paypal-payment";

type PaypalCredentials = {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  sandbox: boolean;
};

type PaypalTokenCacheEntry = {
  clientId: string;
  accessToken: string;
  expiresAt: number;
};

@Injectable()
export class PaypalService {
  private readonly tokenCache = new Map<string, PaypalTokenCacheEntry>();

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async createOrder(input: {
    shopId: string;
    externalOrderCode: string;
    description: string;
    amountUsd: number;
    returnUrl: string;
    cancelUrl: string;
  }) {
    const credentials = await this.getCredentials(input.shopId, true);
    const accessToken = await this.getAccessToken(input.shopId, credentials);
    const baseUrl = this.getBaseUrl(credentials.sandbox);
    const response = await axios.post(
      `${baseUrl}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.externalOrderCode,
            custom_id: input.externalOrderCode,
            invoice_id: input.externalOrderCode,
            description: input.description.slice(0, 127),
            amount: {
              currency_code: "USD",
              value: formatPaypalUsdAmount(input.amountUsd),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
            },
          },
        },
      },
      {
        timeout: 15_000,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `create-${input.externalOrderCode}`.slice(0, 108),
          Prefer: "return=representation",
        },
      },
    ).catch((error) => this.throwPaypalError(error, "create order"));

    const checkoutUrl = extractPaypalApprovalUrl(response.data);
    const orderId = String(response.data?.id || "").trim();
    if (!orderId || !checkoutUrl) {
      throw new BadRequestException("PayPal did not return a valid checkout order.");
    }

    return {
      orderId,
      checkoutUrl,
      sandbox: credentials.sandbox,
      rawPayload: response.data,
    };
  }

  async getOrder(shopId: string, orderId: string) {
    const credentials = await this.getCredentials(shopId, false);
    const accessToken = await this.getAccessToken(shopId, credentials);
    const response = await axios.get(
      `${this.getBaseUrl(credentials.sandbox)}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      {
        timeout: 15_000,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    ).catch((error) => this.throwPaypalError(error, "get order"));
    return response.data;
  }

  async captureOrder(shopId: string, orderId: string, externalOrderCode: string) {
    const credentials = await this.getCredentials(shopId, false);
    const accessToken = await this.getAccessToken(shopId, credentials);
    try {
      const response = await axios.post(
        `${this.getBaseUrl(credentials.sandbox)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {},
        {
          timeout: 15_000,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": `capture-${externalOrderCode}`.slice(0, 108),
            Prefer: "return=representation",
          },
        },
      );
      return response.data;
    } catch (error) {
      const issue = this.getPaypalIssue(error);
      if (issue === "ORDER_ALREADY_CAPTURED") {
        return this.getOrder(shopId, orderId);
      }
      return this.throwPaypalError(error, "capture order");
    }
  }

  async verifyWebhook(
    shopId: string,
    headers: Record<string, string | string[] | undefined>,
    event: unknown,
  ) {
    const credentials = await this.getCredentials(shopId, false);
    if (!credentials.webhookId) return false;
    const accessToken = await this.getAccessToken(shopId, credentials);
    const header = (name: string) => {
      const value = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(value) ? String(value[0] || "") : String(value || "");
    };
    const response = await axios.post(
      `${this.getBaseUrl(credentials.sandbox)}/v1/notifications/verify-webhook-signature`,
      {
        transmission_id: header("paypal-transmission-id"),
        transmission_time: header("paypal-transmission-time"),
        cert_url: header("paypal-cert-url"),
        auth_algo: header("paypal-auth-algo"),
        transmission_sig: header("paypal-transmission-sig"),
        webhook_id: credentials.webhookId,
        webhook_event: event,
      },
      {
        timeout: 15_000,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    ).catch((error) => this.throwPaypalError(error, "verify webhook"));
    return String(response.data?.verification_status || "").toUpperCase() === "SUCCESS";
  }

  private async getCredentials(shopId: string, requireEnabled: boolean): Promise<PaypalCredentials> {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId },
      select: {
        paypalClientIdEncrypted: true,
        paypalClientSecretEncrypted: true,
        paypalWebhookId: true,
        paypalEnabled: true,
        paypalSandbox: true,
      },
    });
    if (!paymentConfig || (requireEnabled && !paymentConfig.paypalEnabled)) {
      throw new BadRequestException("PayPal is not enabled for this shop.");
    }
    const clientId = this.safeDecrypt(paymentConfig.paypalClientIdEncrypted);
    const clientSecret = this.safeDecrypt(paymentConfig.paypalClientSecretEncrypted);
    if (!clientId || !clientSecret) {
      throw new BadRequestException("PayPal Client ID and Client Secret are required.");
    }
    return {
      clientId,
      clientSecret,
      webhookId: String(paymentConfig.paypalWebhookId || "").trim(),
      sandbox: paymentConfig.paypalSandbox,
    };
  }

  private safeDecrypt(payload: string | null | undefined) {
    try {
      return decryptSecret(payload, this.config.encryptionKey).trim();
    } catch {
      return "";
    }
  }

  private async getAccessToken(shopId: string, credentials: PaypalCredentials) {
    const cacheKey = `${shopId}:${credentials.sandbox ? "sandbox" : "live"}`;
    const cached = this.tokenCache.get(cacheKey);
    if (
      cached
      && cached.clientId === credentials.clientId
      && cached.expiresAt > Date.now() + 60_000
    ) {
      return cached.accessToken;
    }
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64");
    const response = await axios.post(
      `${this.getBaseUrl(credentials.sandbox)}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        timeout: 15_000,
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    ).catch((error) => this.throwPaypalError(error, "authenticate"));
    const accessToken = String(response.data?.access_token || "").trim();
    const expiresIn = Number(response.data?.expires_in || 0);
    if (!accessToken) {
      throw new BadRequestException("PayPal authentication returned no access token.");
    }
    this.tokenCache.set(cacheKey, {
      clientId: credentials.clientId,
      accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    });
    return accessToken;
  }

  private getBaseUrl(sandbox: boolean) {
    return sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  }

  private getPaypalIssue(error: unknown) {
    const data = (error as AxiosError<any>)?.response?.data;
    return String(data?.details?.[0]?.issue || data?.name || "").toUpperCase();
  }

  private throwPaypalError(error: unknown, operation: string): never {
    const axiosError = error as AxiosError<any>;
    const status = axiosError.response?.status;
    const issue = this.getPaypalIssue(error);
    const debugId = String(axiosError.response?.data?.debug_id || "").trim();
    const suffix = [status ? `HTTP ${status}` : "", issue, debugId ? `debug ${debugId}` : ""]
      .filter(Boolean)
      .join(", ");
    throw new BadRequestException(`Unable to ${operation} with PayPal${suffix ? ` (${suffix})` : ""}.`);
  }
}
