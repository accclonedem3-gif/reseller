import axios, { AxiosError, AxiosInstance } from "axios";

import type {
  ProviderBalanceResult,
  ProviderCredentials,
  ProviderOrderStatusInput,
  ProviderOrderStatusResult,
  ProviderProduct,
  ProviderPurchaseInput,
  ProviderPurchaseResult,
} from "./provider";

const DEFAULT_BASE_URL = "https://api.dinos-tore.com";
const DEFAULT_CURRENCY = "VND";

export function isDinostoreBaseUrl(value?: string | null): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return (
      url.hostname.toLowerCase() === "api.dinos-tore.com" ||
      url.hostname.toLowerCase() === "dinos-tore.com" ||
      url.hostname.toLowerCase().endsWith(".dinos-tore.com")
    );
  } catch {
    return /(^|\/\/|\.)dinos-tore\.com(?::\d+)?(?=\/|$)/i.test(raw);
  }
}

export function isDinostoreKey(value?: string | null): boolean {
  const raw = String(value || "").trim();
  return /^sk_(?:live|test)_[a-zA-Z0-9_-]{16,}$/i.test(raw);
}

export function isDinostoreProvider(credentials: {
  baseUrl?: string | null;
  buyerKey?: string | null;
  providerName?: string | null;
}): boolean {
  const providerName = String(credentials.providerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (
    providerName === "dinostore" ||
    providerName === "dinostoresocial" ||
    providerName === "dinostoredotcom" ||
    isDinostoreBaseUrl(credentials.baseUrl) ||
    isDinostoreKey(credentials.buyerKey)
  );
}

function getTimeout(credentials: ProviderCredentials, fallback = 15_000): number {
  const timeout = Number(credentials.timeoutMs || fallback);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function client(credentials: ProviderCredentials, perRequestTimeout?: number): AxiosInstance {
  if (!credentials.buyerKey) {
    throw new Error("Dinostore API key (x-api-key) is missing.");
  }

  const raw = String(credentials.baseUrl || "").replace(/\/+$/, "");
  const baseURL = raw || DEFAULT_BASE_URL;

  return axios.create({
    baseURL,
    timeout: perRequestTimeout ?? getTimeout(credentials),
    headers: {
      "x-api-key": credentials.buyerKey.trim(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function numeric(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(raw)) {
    const grouped = Number(raw.replace(/[.,]/g, ""));
    return Number.isFinite(grouped) ? grouped : fallback;
  }
  const normalized = Number(raw.replace(/,/g, "."));
  return Number.isFinite(normalized) ? normalized : fallback;
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string") return data.trim() || error.message;
    if (data && typeof data === "object") {
      const rec = data as Record<string, unknown>;
      const detail = rec.detail || rec.message || rec.error || rec.desc;
      if (typeof detail === "string" && detail.trim()) return detail.trim();
      if (Array.isArray(detail) && detail.length > 0) {
        return JSON.stringify(detail);
      }
    }
    return error.message || "Dinostore request failed.";
  }
  return error instanceof Error ? error.message : "Dinostore request failed.";
}

function isOutOfStock(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = Number(error.response?.status);
  const msg = errorMessage(error).toLowerCase();
  return (
    [404, 409, 410, 422].includes(status) ||
    /out of stock|sold out|hết hàng|het hang|dino_out_of_stock|insufficient stock/i.test(
      msg,
    )
  );
}

function extractItemsFromPayload(data: Record<string, any>): string[] {
  const items = data.items || data.accounts || data.credentials;
  if (Array.isArray(items)) {
    return items
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const rec = item as Record<string, any>;
          const user = rec.username || rec.user || rec.email || rec.account;
          const pass = rec.password || rec.pass;
          if (user && pass) return `${user}|${pass}`;
          return Object.values(rec).filter(Boolean).join("|");
        }
        return String(item || "").trim();
      })
      .filter(Boolean);
  }
  return [];
}

export async function fetchDinostoreBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const http = client(credentials);
  const response = await http.get("/api/v2/me");
  const root = record(response.data);
  if (root.ok === false) {
    throw new Error(
      String(root.message || root.detail || "Dinostore rejected the balance request."),
    );
  }

  const data = record(root.data);
  const balance = numeric(data.balance, 0);
  const partnerName = String(data.partner_name || "").trim() || null;

  return {
    success: true,
    walletCurrency: DEFAULT_CURRENCY,
    balance,
    balanceVnd: balance,
    balanceUsd: null,
    balanceText: `${balance.toLocaleString("vi-VN")} VND`,
    usdtBalance: 0,
    updatedAt: new Date().toISOString(),
    requesterName: partnerName,
    requesterChatId: null,
    botSource: "dinostore",
    rawPayload: response.data,
  };
}

export async function fetchDinostoreProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const http = client(credentials);
  const providerName = String(credentials.providerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const isSocialProvider =
    providerName === "dinostoresocial" ||
    providerName.includes("social");

  let response;
  try {
    response = await http.get(
      isSocialProvider ? "/api/social/catalog" : "/api/v2/catalog",
    );
  } catch (error) {
    throw new Error(`Dinostore catalog fetch failed: ${errorMessage(error)}`);
  }

  const rootData = record(response.data);
  const rawProducts: any[] = Array.isArray(rootData.data?.products)
    ? rootData.data.products
    : Array.isArray(rootData.products)
      ? rootData.products
      : [];

  return rawProducts
    .map((item: any): ProviderProduct | null => {
      const id = String(
        item.product_id ?? item.product_code ?? item.id ?? "",
      ).trim();
      if (!id) return null;

      const name = String(
        item.name ?? item.product_name ?? item.title ?? "Untitled product",
      ).trim();
      const description = String(
        item.description ?? item.desc ?? "",
      ).trim();
      const price = numeric(item.price, 0);

      let available: number | null = null;
      if (item.stock_count !== null && item.stock_count !== undefined) {
        available = numeric(item.stock_count, 0);
      } else if (item.stock !== null && item.stock !== undefined && typeof item.stock === "number") {
        available = numeric(item.stock, 0);
      } else if (item.stock_status === "out_of_stock") {
        available = 0;
      }

      const isOutOfStockStatus =
        item.stock_status === "out_of_stock" ||
        item.available === false ||
        item.status === "out_of_stock";

      const requiresGmail = Boolean(item.requires_gmail);
      const isSocial = Boolean(
        isSocialProvider ||
          item.is_cheotuongtac_service ||
          item.delivery_mode === "social_service" ||
          id.startsWith("ctt_"),
      );

      const minQty = numeric(
        item.minimum_order_quantity ?? item.service_package_quantity ?? item.min_quantity,
        1,
      );
      const maxQty = numeric(
        item.maximum_order_quantity ?? item.max_quantity,
        isSocial ? 50000 : 200,
      );

      return {
        externalId: id,
        sourceName: name || "Untitled product",
        sourceRawName: name || null,
        description: description || null,
        rawDescription: description || null,
        price,
        available,
        hidden: isOutOfStockStatus,
        isSlotProduct: !isSocial && (requiresGmail || item.delivery_mode === "manual_fulfillment"),
        requiresCustomerEmail: requiresGmail,
        requiresSlotMonths: false,
        slotDurations: [],
        quantityFixed: minQty > 1 ? minQty : 1,
        walletCurrency: String(item.currency || DEFAULT_CURRENCY).toUpperCase(),
        metadata: {
          ...item,
          provider: isSocial ? "dinostore_social" : "dinostore",
          delivery_mode: item.delivery_mode || (isSocial ? "social_service" : undefined),
          is_social: isSocial,
          requires_gmail: requiresGmail,
          minimum_order_quantity: minQty,
          maximum_order_quantity: maxQty,
          social_input_fields: item.social_input_fields || (isSocial ? ["link"] : []),
        },
      };
    })
    .filter((item): item is ProviderProduct => item !== null);
}

export async function purchaseFromDinostore(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  const http = client(credentials, 60_000);
  const partnerRef =
    String(input.clientOrderCode || "").trim() ||
    `DINO_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const isSocial =
    input.productId.startsWith("ctt_") ||
    String(input.productId).includes("social") ||
    String(credentials.providerName || "").toLowerCase().includes("social");

  const targetLink = String(input.targetLink || input.customerEmail || "").trim();

  try {
    let response;
    if (isSocial) {
      response = await http.post(
        "/api/social/orders",
        {
          partner_ref: partnerRef,
          product_id: input.productId,
          quantity: input.quantity,
          target_link: targetLink,
          comments: input.comments || undefined,
          customer_id: targetLink || partnerRef,
          note: `Order ${partnerRef}`,
        },
        {
          headers: {
            "x-idempotency-key": partnerRef,
          },
        },
      );
    } else {
      response = await http.post(
        "/api/v2/orders",
        {
          partner_ref: partnerRef,
          product_id: input.productId,
          quantity: input.quantity,
          customer_email: input.customerEmail || undefined,
          customer_id: input.customerEmail || partnerRef,
          note: `Order ${partnerRef}`,
          send_email: false,
        },
        {
          headers: {
            "x-idempotency-key": partnerRef,
          },
        },
      );
    }

    const root = record(response.data);
    const data = record(root.data);
    const orderCode = String(data.order_code || data.id || partnerRef).trim();
    const items = extractItemsFromPayload(data);
    const deliveredCount = numeric(data.delivered_count, 0);

    if (items.length > 0) {
      const deliveredText = items.join("\n\n");
      return {
        success: true,
        deliveredText,
        outOfStock: false,
        pending: false,
        providerOrderId: orderCode,
        providerOrderCode: orderCode,
        rawPayload: response.data,
      };
    }

    // Pending fulfillment: manual_pending, pending_source, social_service, or delivered_count === 0
    const deliveryMode = String(data.delivery_mode || "").toLowerCase();
    const isPendingMode =
      deliveryMode.includes("pending") ||
      deliveryMode.includes("manual") ||
      deliveryMode.includes("social") ||
      deliveredCount === 0;

    return {
      success: true,
      deliveredText: null,
      outOfStock: false,
      pending: true,
      providerOrderId: orderCode,
      providerOrderCode: orderCode,
      rawPayload: response.data,
      message: String(
        data.status ||
          root.message ||
          "Dinostore order created; delivery is pending.",
      ),
    };
  } catch (error) {
    const outOfStock = isOutOfStock(error);
    const msg = errorMessage(error);
    return {
      success: false,
      deliveredText: null,
      outOfStock,
      pending: false,
      rawPayload: axios.isAxiosError(error) ? error.response?.data : undefined,
      message: msg,
    };
  }
}

export async function fetchDinostoreOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const http = client(credentials);
  const lookup = String(input.orderCode || input.orderId || "").trim();
  if (!lookup) {
    throw new Error("Dinostore order code is required.");
  }

  try {
    const isSocialProvider =
      String(credentials.providerName || "").toLowerCase().includes("social") ||
      lookup.startsWith("ctt_");

    let response;
    if (isSocialProvider) {
      try {
        response = await http.get(`/api/social/orders/${encodeURIComponent(lookup)}`);
      } catch (err: any) {
        if (err.response?.status === 404) {
          try {
            response = await http.get(`/api/v2/orders/${encodeURIComponent(lookup)}`);
          } catch {
            response = await http.get(`/api/v2/orders/by-ref/${encodeURIComponent(lookup)}`);
          }
        } else {
          throw err;
        }
      }
    } else {
      try {
        response = await http.get(`/api/v2/orders/${encodeURIComponent(lookup)}`);
      } catch (err: any) {
        if (err.response?.status === 404) {
          try {
            response = await http.get(
              `/api/v2/orders/by-ref/${encodeURIComponent(lookup)}`,
            );
          } catch {
            // Try social orders endpoint if v2 returned 404
            try {
              response = await http.get(
                `/api/social/orders/${encodeURIComponent(lookup)}`,
              );
            } catch {
              throw err;
            }
          }
        } else {
          throw err;
        }
      }
    }

    const root = record(response.data);
    const data = record(root.data);
    const orderCode = String(data.order_code || data.id || lookup).trim();
    const items = extractItemsFromPayload(data);
    const statusText = String(data.status || "").toLowerCase();

    const isFailed =
      statusText.includes("hủy") ||
      statusText.includes("huy") ||
      statusText.includes("fail") ||
      statusText.includes("cancel") ||
      statusText.includes("rejected");

    if (isFailed) {
      return {
        success: false,
        status: "failed",
        deliveredText: null,
        failureReason: String(data.status || "Dinostore order was cancelled or failed."),
        providerOrderId: orderCode,
        providerOrderCode: orderCode,
        pending: false,
        outOfStock: false,
        rawPayload: response.data,
      };
    }

    if (items.length > 0) {
      const deliveredText = items.join("\n\n");
      return {
        success: true,
        status: "delivered",
        deliveredText,
        failureReason: null,
        providerOrderId: orderCode,
        providerOrderCode: orderCode,
        pending: false,
        outOfStock: false,
        rawPayload: response.data,
      };
    }

    const supplierStatus = String(data.supplier_status || "").toLowerCase();
    const isCompleted =
      statusText.includes("hoàn thành") ||
      statusText.includes("hoan thanh") ||
      statusText.includes("completed") ||
      statusText.includes("success") ||
      supplierStatus === "completed";

    if (isCompleted) {
      return {
        success: true,
        status: "delivered",
        deliveredText: "Dịch vụ tăng tương tác mạng xã hội đã hoàn tất thành công.",
        failureReason: null,
        providerOrderId: orderCode,
        providerOrderCode: orderCode,
        pending: false,
        outOfStock: false,
        rawPayload: response.data,
      };
    }

    return {
      success: true,
      status: "pending",
      deliveredText: null,
      failureReason: null,
      providerOrderId: orderCode,
      providerOrderCode: orderCode,
      pending: true,
      outOfStock: false,
      rawPayload: response.data,
    };
  } catch (error) {
    const msg = errorMessage(error);
    return {
      success: false,
      status: null,
      deliveredText: null,
      failureReason: msg,
      providerOrderId: input.orderId || null,
      providerOrderCode: input.orderCode || lookup,
      pending: false,
      outOfStock: isOutOfStock(error),
      rawPayload: axios.isAxiosError(error) ? error.response?.data : null,
      message: msg,
    };
  }
}
