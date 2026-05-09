import axios from "axios";

import {
  DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_NAME,
} from "../constants";

export interface ProviderCredentials {
  baseUrl?: string;
  buyerKey: string;
  providerName?: string;
  timeoutMs?: number;
}

export interface ProviderProduct {
  externalId: string;
  sourceName: string;
  sourceRawName: string | null;
  description: string | null;
  rawDescription: string | null;
  price: number;
  available: number | null;
  hidden: boolean;
  isSlotProduct: boolean;
  requiresCustomerEmail: boolean;
  requiresSlotMonths: boolean;
  slotDurations: number[];
  quantityFixed: number;
  walletCurrency: string;
  metadata: Record<string, unknown>;
}

export interface ProviderPurchaseInput {
  productId: string;
  quantity: number;
  customerEmail?: string | null;
  slotMonths?: number | null;
  clientOrderCode?: string | null;
}

export interface ProviderPurchaseResult {
  success: boolean;
  deliveredText: string | null;
  outOfStock: boolean;
  pending?: boolean;
  providerOrderId?: string | null;
  providerOrderCode?: string | null;
  rawPayload?: unknown;
  message?: string;
}

export interface ProviderBalanceResult {
  success: boolean;
  walletCurrency: string;
  balance: number;
  balanceVnd: number | null;
  balanceUsd: number | null;
  balanceText: string | null;
  usdtBalance: number;
  updatedAt: string | null;
  requesterName: string | null;
  requesterChatId: string | null;
  botSource: string | null;
  rawPayload: unknown;
}

export interface ProviderOrderStatusInput {
  orderId?: string | null;
  orderCode?: string | null;
}

export interface ProviderOrderStatusResult {
  success: boolean;
  status: string | null;
  deliveredText: string | null;
  failureReason: string | null;
  providerOrderId: string | null;
  providerOrderCode: string | null;
  pending: boolean;
  outOfStock: boolean;
  rawPayload: unknown;
  message?: string;
}

function getBaseUrl(credentials: ProviderCredentials) {
  return String(credentials.baseUrl || DEFAULT_PROVIDER_BASE_URL).replace(/\/$/, "");
}

function buildBuyerApiUrl(credentials: ProviderCredentials, path: string) {
  const baseUrl = getBaseUrl(credentials);
  const normalizedPath = String(path || "").replace(/^\/+/, "");

  if (/\/api\/v1$/i.test(baseUrl)) {
    return `${baseUrl}/telegram-buyer/${normalizedPath}`;
  }

  return `${baseUrl}/api/telegram-buyer/${normalizedPath}`;
}

function getTimeout(credentials: ProviderCredentials) {
  const timeout = Number(credentials.timeoutMs || 10000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 10000;
}

function normalizeAvailable(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatDeliveredAccounts(deliveredAccounts: unknown) {
  if (!Array.isArray(deliveredAccounts) || deliveredAccounts.length === 0) {
    return null;
  }

  return deliveredAccounts
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const typed = item as Record<string, unknown>;
      const login =
        String(
          typed.user || typed.email || typed.username || typed.login || "",
        ).trim() || "";
      const password =
        String(typed.password || typed.pass || typed.secret || "").trim() || "";
      const primary = login && password ? `${login}:${password}` : login || password;
      const extraLines = [];

      if (typed.verifyEmail) {
        extraLines.push(`Email khôi phục: ${String(typed.verifyEmail)}`);
      }

      if (typed.deliveredAt) {
        extraLines.push(`Thời gian giao: ${String(typed.deliveredAt)}`);
      }

      return [`Tài khoản ${index + 1}: ${primary}`, ...extraLines]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function isOutOfStock(payload: unknown, statusCode?: number) {
  const typed = (payload || {}) as Record<string, unknown>;
  const normalizedCode = String(
    typed.code || typed.errorCode || "",
  ).toUpperCase();
  const normalizedMessage = String(
    typed.message || typed.desc || typed.error || "",
  ).toUpperCase();

  return (
    [404, 409, 410, 422].includes(Number(statusCode)) ||
    normalizedCode.includes("OUT_OF_STOCK") ||
    normalizedCode.includes("SOLD_OUT") ||
    normalizedMessage.includes("OUT OF STOCK") ||
    normalizedMessage.includes("INVENTORY NOT ENOUGH") ||
    normalizedMessage.includes("HET HANG")
  );
}

export async function verifyProviderConnection(credentials: ProviderCredentials) {
  const products = await fetchProviderProducts(credentials);
  return {
    ok: products.length > 0,
    providerName: credentials.providerName || DEFAULT_PROVIDER_NAME,
    sampleSize: products.length,
  };
}

export async function fetchProviderProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  if (!credentials.buyerKey) {
    throw new Error("Provider buyer key is missing.");
  }

  const response = await axios.get(
    buildBuyerApiUrl(credentials, "products"),
    {
      params: {
        key: credentials.buyerKey,
      },
      timeout: getTimeout(credentials),
    },
  );

  if (response.data?.success !== true || !Array.isArray(response.data?.products)) {
    throw new Error("Provider returned an invalid product list.");
  }

  return response.data.products.map((product: Record<string, unknown>) => ({
    externalId: String(product._id || product.id || ""),
    sourceName: String(product.product_name || product.name || "Untitled product"),
    sourceRawName: String(product.product_name_raw || product.rawName || "").trim() || null,
    description: String(product.description || "").trim() || null,
    rawDescription:
      String(product.description_raw || "").trim() || null,
    price: Number(product.walletPricing ?? product.pricing ?? 0),
    available: normalizeAvailable((product.stats as Record<string, unknown> | undefined)?.available),
    hidden: Boolean(product.hidden) || product.status === "inactive" || product.enabled === false || product.active === false,
    isSlotProduct: Boolean(product.isSlotProduct),
    requiresCustomerEmail: Boolean(product.requiresCustomerEmail),
    requiresSlotMonths: Boolean(product.requiresSlotMonths),
    slotDurations: Array.isArray(product.slotDurations)
      ? product.slotDurations.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [],
    quantityFixed: Number(product.quantityFixed || 1) || 1,
    walletCurrency: String(product.walletCurrency || "VND"),
    metadata: product,
  }));
}

export async function fetchProviderBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  if (!credentials.buyerKey) {
    throw new Error("Provider buyer key is missing.");
  }

  const response = await axios.get(
    buildBuyerApiUrl(credentials, "balance"),
    {
      params: {
        key: credentials.buyerKey,
      },
      timeout: getTimeout(credentials),
    },
  );

  if (response.data?.success !== true) {
    throw new Error(
      String(response.data?.message || response.data?.desc || "Provider returned an invalid balance response."),
    );
  }

  return {
    success: true,
    walletCurrency: String(response.data?.walletCurrency || "VND"),
    balance: Number(response.data?.balance || 0),
    balanceVnd:
      response.data?.balanceVnd === null || response.data?.balanceVnd === undefined
        ? null
        : Number(response.data.balanceVnd),
    balanceUsd:
      response.data?.balanceUsd === null || response.data?.balanceUsd === undefined
        ? null
        : Number(response.data.balanceUsd),
    balanceText: String(response.data?.balanceText || "").trim() || null,
    usdtBalance: Number(response.data?.usdtBalance || 0),
    updatedAt: String(response.data?.updatedAt || "").trim() || null,
    requesterName: String(response.data?.requester?.name || "").trim() || null,
    requesterChatId: String(response.data?.requester?.chatId || "").trim() || null,
    botSource: String(response.data?.botSource || "").trim() || null,
    rawPayload: response.data,
  };
}

export async function purchaseFromProvider(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  if (!credentials.buyerKey) {
    throw new Error("Provider buyer key is missing.");
  }

  try {
    const response = await axios.post(
      buildBuyerApiUrl(credentials, "purchase"),
      {
        key: credentials.buyerKey,
        product_id: input.productId,
        quantity: input.quantity,
        customer_email: input.customerEmail || undefined,
        slot_months: input.slotMonths || undefined,
        client_order_code: (input as any).clientOrderCode || undefined,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: getTimeout(credentials),
      },
    );

    if (response.data?.success !== true) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: isOutOfStock(response.data),
        pending: Boolean(response.data?.pending),
        providerOrderId: String(response.data?.orderId || "").trim() || null,
        providerOrderCode: String(response.data?.orderCode || "").trim() || null,
        rawPayload: response.data,
        message: String(response.data?.message || response.data?.desc || "Purchase failed"),
      };
    }

    return {
      success: true,
      deliveredText:
        formatDeliveredAccounts(response.data.deliveredAccounts) ||
        String(response.data?.deliveredText || "").trim() ||
        null,
      outOfStock: false,
      pending: Boolean(response.data?.pending),
      providerOrderId: String(response.data?.orderId || "").trim() || null,
      providerOrderCode: String(response.data?.orderCode || "").trim() || null,
      rawPayload: response.data,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: isOutOfStock(error.response?.data, error.response?.status),
        pending: Boolean(error.response?.data?.pending),
        providerOrderId: String(error.response?.data?.orderId || "").trim() || null,
        providerOrderCode: String(error.response?.data?.orderCode || "").trim() || null,
        rawPayload: error.response?.data,
        message:
          String(
            error.response?.data?.message ||
              error.response?.data?.desc ||
              error.message,
          ) || "Provider purchase failed",
      };
    }

    return {
      success: false,
      deliveredText: null,
      outOfStock: false,
      message: error instanceof Error ? error.message : "Provider purchase failed",
    };
  }
}

export async function fetchProviderOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  if (!credentials.buyerKey) {
    throw new Error("Provider buyer key is missing.");
  }

  if (!input.orderId && !input.orderCode) {
    throw new Error("Provider order id or order code is required.");
  }

  try {
    const response = await axios.get(
      buildBuyerApiUrl(credentials, "order-status"),
      {
        params: {
          key: credentials.buyerKey,
          order_id: input.orderId || undefined,
          order_code: input.orderCode || undefined,
        },
        timeout: getTimeout(credentials),
      },
    );

    const order = response.data?.order as Record<string, unknown> | undefined;
    const status = String(order?.status || "").trim().toLowerCase() || null;
    const deliveredText = String(order?.deliveredText || "").trim() || null;
    const failureReason = String(order?.failureReason || "").trim() || null;

    if (response.data?.success !== true || !order) {
      return {
        success: false,
        status,
        deliveredText,
        failureReason,
        providerOrderId: String(order?.id || "").trim() || null,
        providerOrderCode: String(order?.orderCode || "").trim() || null,
        pending: false,
        outOfStock: false,
        rawPayload: response.data,
        message: String(response.data?.message || "Provider returned an invalid order status response."),
      };
    }

    return {
      success: true,
      status,
      deliveredText,
      failureReason,
      providerOrderId: String(order.id || "").trim() || null,
      providerOrderCode: String(order.orderCode || "").trim() || null,
      pending: ["pending", "processing", "pending_stock", "pending_manual"].includes(
        String(status || ""),
      ),
      outOfStock: status === "pending_stock",
      rawPayload: response.data,
      message: String(response.data?.message || "").trim() || undefined,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const order = error.response?.data?.order as Record<string, unknown> | undefined;
      const status = String(order?.status || "").trim().toLowerCase() || null;

      return {
        success: false,
        status,
        deliveredText: String(order?.deliveredText || "").trim() || null,
        failureReason:
          String(order?.failureReason || error.response?.data?.message || "").trim() || null,
        providerOrderId: String(order?.id || "").trim() || null,
        providerOrderCode: String(order?.orderCode || "").trim() || null,
        pending: ["pending", "processing", "pending_stock", "pending_manual"].includes(
          String(status || ""),
        ),
        outOfStock: status === "pending_stock",
        rawPayload: error.response?.data,
        message:
          String(
            error.response?.data?.message ||
              error.response?.data?.desc ||
              error.message,
          ) || "Provider order status request failed",
      };
    }

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
      message: error instanceof Error ? error.message : "Provider order status request failed",
    };
  }
}
