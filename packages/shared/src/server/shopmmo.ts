import axios, { AxiosInstance } from "axios";
import crypto from "crypto";

import type {
  ProviderCredentials,
  ProviderProduct,
  ProviderPurchaseInput,
  ProviderPurchaseResult,
  ProviderBalanceResult,
  ProviderOrderStatusInput,
  ProviderOrderStatusResult,
} from "./provider";

const DEFAULT_BASE_URL = "https://shopmmo.pro";
const WALLET_CURRENCY = "VND";

export function isShopMmoBaseUrl(baseUrl?: string | null): boolean {
  return /(^|\/\/|\.)shopmmo\.pro/i.test(String(baseUrl || ""));
}

export function isShopMmoKey(buyerKey?: string | null): boolean {
  const key = String(buyerKey || "").trim();
  // ShopMMO keys trong hệ thống của bạn là chuỗi 64 ký tự (ví dụ: 91c7e...F23)
  // và không bắt đầu bằng apk_ hay tgb_
  return /^[a-zA-Z0-9]{64}$/.test(key);
}

export function isShopMmoProvider(credentials: {
  baseUrl?: string | null;
  buyerKey?: string | null;
  providerName?: string | null;
}): boolean {
  const baseUrl = String(credentials.baseUrl || "").trim();

  // The configured URL is the authoritative provider identity. Older shop
  // records can retain the default "canboso" label after their credentials
  // are changed to ShopMMO (and both providers can use 64-character keys).
  if (isShopMmoBaseUrl(baseUrl)) return true;
  if (/(^|\/\/|\.)canboso\.com/i.test(baseUrl)) return false;

  const providerName = String(credentials.providerName || "")
    .trim()
    .toLowerCase();
  if (providerName.includes("shopmmo")) return true;
  if (providerName.includes("canboso")) return false;
  return isShopMmoKey(credentials.buyerKey);
}

function getTimeout(credentials: ProviderCredentials, fallback = 15000) {
  const timeout = Number(credentials.timeoutMs || fallback);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function client(
  credentials: ProviderCredentials,
  perRequestTimeout?: number,
): AxiosInstance {
  if (!credentials.buyerKey) {
    throw new Error("ShopMMO API key (X-API-Key) is missing.");
  }
  const raw = String(credentials.baseUrl || "").replace(/\/+$/, "");
  const base = isShopMmoBaseUrl(raw) ? raw : DEFAULT_BASE_URL;
  const baseURL = /\/api\/v1$/i.test(base) ? base : `${base}/api/v1`;

  const instance = axios.create({
    baseURL,
    timeout: perRequestTimeout ?? getTimeout(credentials),
    headers: {
      "X-API-Key": credentials.buyerKey,
      Accept: "application/json",
    },
  });

  instance.interceptors.response.use(undefined, async (error) => {
    const config = error.config as any;
    if (!config) return Promise.reject(error);

    config.__retryCount = config.__retryCount || 0;
    const status = error.response?.status;

    // 429 Rate Limit or 5xx server errors
    const isRetryable =
      status === 429 || (status && status >= 500 && status <= 599);

    if (isRetryable && config.__retryCount < 4) {
      config.__retryCount += 1;

      let delayMs = 1500 * Math.pow(1.5, config.__retryCount - 1);
      const retryAfter = error.response?.headers?.["retry-after"];
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed) && parsed > 0) {
          delayMs = parsed * 1000;
        }
      }

      delayMs += Math.random() * 500;
      await delay(delayMs);

      return instance(config);
    }
    return Promise.reject(error);
  });

  return instance;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, any> | undefined;
    const reqId = error.response?.headers?.["x-request-id"];
    const reqIdStr = reqId ? ` (ReqID: ${reqId})` : "";
    return (
      String(
        data?.error?.message ||
          data?.message ||
          error.message ||
          "ShopMMO request failed",
      ) + reqIdStr
    );
  }
  return error instanceof Error ? error.message : "ShopMMO request failed";
}

function isOutOfStockError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = Number(error.response?.status);
  const data = error.response?.data as Record<string, any> | undefined;
  const msg = (
    data?.error?.message ||
    data?.message ||
    error.message ||
    ""
  ).toLowerCase();

  return (
    status === 404 ||
    status === 409 ||
    status === 410 ||
    msg.includes("không đủ") ||
    msg.includes("hết hàng") ||
    msg.includes("out of stock")
  );
}

// ── Catalog ──────────────────────────────────────────────────

export async function fetchShopMmoProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const api = client(credentials);
  const products: ProviderProduct[] = [];

  let page = 1;
  const perPage = 50;

  for (let guard = 0; guard < 50; guard += 1) {
    const { data } = await api.get("/products", {
      params: {
        in_stock: 1,
        per_page: perPage,
        page,
      },
    });

    const rows = Array.isArray(data?.data) ? data.data : [];

    for (const item of rows) {
      if (!item || !item.id) continue;

      const available =
        item.api_stock !== undefined && item.api_stock !== null
          ? Number(item.api_stock)
          : null;

      products.push({
        externalId: String(item.id),
        sourceName: String(item.name || "Untitled product"),
        sourceRawName: String(item.name || ""),
        description: null,
        rawDescription: null,
        price: Number(item.price || 0),
        available,
        hidden: false,
        isSlotProduct: false,
        requiresCustomerEmail: false,
        requiresSlotMonths: false,
        slotDurations: [],
        quantityFixed: 1,
        walletCurrency: WALLET_CURRENCY,
        metadata: {
          provider: "shopmmo",
          sold: Number(item.sold || 0),
          slug: item.slug || null,
        },
      });
    }

    const lastPage = Number(data?.last_page || 1);
    if (page >= lastPage || rows.length === 0) {
      break;
    }
    page++;
  }

  return products;
}

// ── Balance ──────────────────────────────────────────────────

export async function fetchShopMmoBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const api = client(credentials);
  const { data } = await api.get("/profile");

  const balance = Number(data?.money || 0);

  return {
    success: true,
    walletCurrency: WALLET_CURRENCY,
    balance: balance,
    balanceVnd: balance,
    balanceUsd: 0,
    balanceText: `${balance.toLocaleString("vi-VN")}₫`,
    usdtBalance: 0,
    updatedAt: null,
    requesterName: String(data?.username || "").trim() || null,
    requesterChatId: String(data?.id || "").trim() || null,
    botSource: "shopmmo",
    rawPayload: data,
  };
}

// ── Delivery ─────────────────────────────────────────────────

function formatDelivery(items: any[] | undefined): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lines = items
    .map((item) => {
      return String(item?.account || "").trim() || null;
    })
    .filter(Boolean) as string[];
  return lines.length > 0 ? lines.join("\n\n") : null;
}

// ── Purchase ─────────────────────────────────────────────────

export async function purchaseFromShopMmo(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  const overallTimeout = getTimeout(credentials, 60000);
  const api = client(credentials, overallTimeout);

  const idempotencyKey = input.clientOrderCode || crypto.randomUUID();

  try {
    const { data } = await api.post(
      "/order",
      {
        product_id: input.productId,
        amount: input.quantity,
      },
      {
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      },
    );

    const status = String(data?.status || "")
      .trim()
      .toLowerCase();
    const transId = String(data?.trans_id || "").trim();

    if (!transId) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: false,
        message: "ShopMMO order created but returned no trans_id.",
        rawPayload: data,
      };
    }

    if (status === "failed") {
      return {
        success: false,
        deliveredText: null,
        outOfStock: false,
        providerOrderId: null,
        providerOrderCode: transId,
        message: "ShopMMO order failed immediately.",
        rawPayload: data,
      };
    }

    if (status === "success") {
      const deliveredText = formatDelivery(data?.items);
      return {
        success: Boolean(deliveredText),
        deliveredText,
        outOfStock: false,
        pending: !deliveredText,
        providerOrderId: null,
        providerOrderCode: transId,
        message: deliveredText
          ? undefined
          : "Order success but delivery is empty.",
        rawPayload: data,
      };
    }

    // Default to pending for async=1 (status: reconcile_pending)
    return {
      success: false,
      deliveredText: null,
      outOfStock: false,
      pending: true,
      providerOrderId: null,
      providerOrderCode: transId,
      message: `ShopMMO order pending (status: ${status}). Will reconcile.`,
      rawPayload: data,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 402) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: false,
        message: "Số dư ShopMMO không đủ (HTTP 402).",
        rawPayload: error.response?.data,
      };
    }

    return {
      success: false,
      deliveredText: null,
      outOfStock: isOutOfStockError(error),
      message: errorMessage(error),
      rawPayload: axios.isAxiosError(error) ? error.response?.data : undefined,
    };
  }
}

// ── Order status (reconcile) ─────────────────────────────────

export async function fetchShopMmoOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const transId = String(input.orderCode || input.orderId || "").trim();
  if (!transId) {
    return {
      success: false,
      status: null,
      deliveredText: null,
      failureReason: null,
      providerOrderId: null,
      providerOrderCode: null,
      pending: false,
      outOfStock: false,
      rawPayload: null,
      message: "ShopMMO trans_id (orderCode) is required.",
    };
  }

  const api = client(credentials);
  try {
    const { data } = await api.get(`/orders/${encodeURIComponent(transId)}`);
    const status = String(data?.status || "")
      .trim()
      .toLowerCase();

    if (status === "success") {
      const deliveredText = formatDelivery(data?.items);
      return {
        success: Boolean(deliveredText),
        status: deliveredText ? "delivered" : "completed",
        deliveredText,
        failureReason: null,
        providerOrderId: null,
        providerOrderCode: transId,
        pending: !deliveredText,
        outOfStock: false,
        rawPayload: data,
      };
    }

    const failed = status === "failed";
    const pending = status === "reconcile_pending" || status === "pending";

    return {
      success: true, // we successfully fetched the status
      status,
      deliveredText: null,
      failureReason: failed ? `ShopMMO order failed.` : null,
      providerOrderId: null,
      providerOrderCode: transId,
      pending: pending || (!failed && !status),
      outOfStock: false,
      rawPayload: data,
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      deliveredText: null,
      failureReason: errorMessage(error),
      providerOrderId: null,
      providerOrderCode: transId,
      pending: false,
      outOfStock: false,
      rawPayload: axios.isAxiosError(error) ? error.response?.data : null,
      message: errorMessage(error),
    };
  }
}
