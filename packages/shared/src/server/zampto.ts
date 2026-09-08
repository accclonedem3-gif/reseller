import axios, { AxiosInstance } from "axios";

import type {
  ProviderBalanceResult,
  ProviderCredentials,
  ProviderOrderStatusInput,
  ProviderOrderStatusResult,
  ProviderProduct,
  ProviderPurchaseInput,
  ProviderPurchaseResult,
} from "./provider";

const DEFAULT_BASE_URL = "http://node12.zampto.net:20291";
const DEFAULT_CURRENCY = "VND";

export function isZamptoBaseUrl(value?: string | null): boolean {
  return /(^|\/\/|\.)zampto\.net(?::\d+)?(?=\/|$)/i.test(String(value || ""));
}

export function isZamptoKey(value?: string | null): boolean {
  return /^sk_[a-f0-9]{48}$/i.test(String(value || "").trim());
}

export function isZamptoProvider(value: {
  baseUrl?: string | null;
  buyerKey?: string | null;
}): boolean {
  return isZamptoBaseUrl(value.baseUrl) || isZamptoKey(value.buyerKey);
}

function getTimeout(credentials: ProviderCredentials, fallback = 15000) {
  const timeout = Number(credentials.timeoutMs || fallback);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function client(credentials: ProviderCredentials): AxiosInstance {
  if (!credentials.buyerKey) {
    throw new Error("Zampto API key (X-API-Key) is missing.");
  }

  const raw = String(credentials.baseUrl || "").replace(/\/+$/, "");
  const base = raw || DEFAULT_BASE_URL;
  const baseURL = /\/api$/i.test(base) ? base : `${base}/api`;

  return axios.create({
    baseURL,
    timeout: getTimeout(credentials),
    headers: {
      "X-API-Key": credentials.buyerKey,
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

function rows(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  const root = record(payload);
  const candidates = [
    root.products,
    root.items,
    root.data,
    root.result,
    record(root.data).products,
    record(root.data).items,
    record(root.result).products,
    record(root.result).items,
  ];
  return candidates.find(Array.isArray) || [];
}

function body(payload: unknown): Record<string, any> {
  const root = record(payload);
  for (const candidate of [root.order, root.data, root.result]) {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      const nested = record(candidate);
      return record(nested.order || nested.data || nested.result || nested);
    }
  }
  return root;
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
  const direct = Number(
    raw
      .replace(/[^\d.,-]/g, "")
      .replace(/\s/g, "")
      .replace(",", "."),
  );
  return Number.isFinite(direct) ? direct : fallback;
}

function available(item: Record<string, any>): number | null {
  if (item.in_stock === false || item.available === false) return 0;
  const value =
    item.stock ??
    item.stock_quantity ??
    item.available_quantity ??
    item.api_stock ??
    item.quantity_available ??
    item.available;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const normalized = String(value).trim().toLowerCase();
  if (/out of stock|sold out|hết hàng|het hang/.test(normalized)) return 0;
  const parsed = numeric(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function explicitFailure(payload: unknown): boolean {
  const root = record(payload);
  return root.success === false || root.ok === false || root.status === false;
}

function payloadOutOfStock(payload: unknown): boolean {
  const root = record(payload);
  const order = body(payload);
  const text = [
    root.message,
    root.desc,
    root.code,
    order.message,
    order.status,
    order.code,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  return /out[_ ]of[_ ]stock|sold[_ ]out|hết hàng|het hang|không đủ tồn|khong du ton/.test(
    text,
  );
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = record(error.response?.data);
    const nestedError = record(data.error);
    return String(
      data.message ||
        data.desc ||
        nestedError.message ||
        data.error ||
        error.message ||
        "Zampto request failed.",
    );
  }
  return error instanceof Error ? error.message : "Zampto request failed.";
}

function isOutOfStock(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = Number(error.response?.status);
  const message = errorMessage(error).toLowerCase();
  return (
    [409, 410, 422].includes(status) ||
    /out of stock|sold out|hết hàng|het hang|không đủ tồn|khong du ton/.test(
      message,
    )
  );
}

const DELIVERY_KEYS = [
  "account",
  "credential",
  "content",
  "email",
  "username",
  "login",
  "password",
  "pass",
  "token",
  "code",
  "key",
  "data",
  "details",
] as const;

function formatDeliveryValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim() || null;
  }
  if (Array.isArray(value)) {
    const lines = value
      .map(formatDeliveryValue)
      .filter((item): item is string => Boolean(item));
    return lines.length ? lines.join("\n\n") : null;
  }
  const item = record(value);
  const values = DELIVERY_KEYS.map((key) =>
    String(item[key] ?? "").trim(),
  ).filter(Boolean);
  return values.length ? [...new Set(values)].join(" | ") : null;
}

function delivery(payload: unknown): string | null {
  const root = record(payload);
  const order = body(payload);
  const candidates = [
    order.deliveredText,
    order.delivered_text,
    order.delivery,
    order.delivery_data,
    order.accounts,
    order.items,
    order.credentials,
    order.product_data,
    order.account_data,
    order.content,
    root.deliveredText,
    root.delivered_text,
    root.delivery,
    root.accounts,
    root.items,
    Array.isArray(root.data) || typeof root.data === "string"
      ? root.data
      : null,
  ];
  for (const candidate of candidates) {
    const formatted = formatDeliveryValue(candidate);
    if (formatted) return formatted;
  }
  return null;
}

function orderIdentity(payload: unknown) {
  const order = body(payload);
  const orderId = String(order.id ?? order.order_id ?? order._id ?? "").trim();
  const orderCode = String(
    order.order_code ?? order.orderCode ?? order.code ?? order.reference ?? "",
  ).trim();
  return {
    orderId: orderId || null,
    orderCode: orderCode || orderId || null,
  };
}

function orderStatus(payload: unknown): string {
  const order = body(payload);
  return String(order.status ?? order.order_status ?? "")
    .trim()
    .toLowerCase();
}

export async function fetchZamptoProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const { data } = await client(credentials).get("/products");
  if (explicitFailure(data)) {
    throw new Error(
      String(record(data).message || "Zampto rejected the product request."),
    );
  }

  return rows(data)
    .map((item: any): ProviderProduct => {
      const id = String(item.id ?? item.product_id ?? item._id ?? "").trim();
      const name = String(
        item.name ?? item.product_name ?? item.title ?? "Untitled product",
      ).trim();
      const description = String(item.description ?? item.desc ?? "").trim();
      return {
        externalId: id,
        sourceName: name || "Untitled product",
        sourceRawName: name || null,
        description: description || null,
        rawDescription: description || null,
        price: numeric(
          item.price ?? item.unit_price ?? item.sale_price ?? item.amount,
        ),
        available: available(item),
        hidden:
          item.hidden === true ||
          item.active === false ||
          item.enabled === false ||
          ["inactive", "hidden", "disabled"].includes(
            String(item.status || "").toLowerCase(),
          ),
        isSlotProduct: false,
        requiresCustomerEmail: false,
        requiresSlotMonths: false,
        slotDurations: [],
        quantityFixed:
          numeric(item.quantity_fixed ?? item.min_quantity, 1) || 1,
        walletCurrency: String(item.currency || DEFAULT_CURRENCY).toUpperCase(),
        metadata: { ...item, provider: "zampto" },
      };
    })
    .filter((item: ProviderProduct) => Boolean(item.externalId));
}

export async function fetchZamptoBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const { data } = await client(credentials).get("/balance");
  if (explicitFailure(data)) {
    throw new Error(
      String(record(data).message || "Zampto rejected the balance request."),
    );
  }
  const value = body(data);
  const balance = numeric(value.balance ?? value.wallet_balance ?? value.money);
  const currency = String(value.currency || DEFAULT_CURRENCY).toUpperCase();
  return {
    success: true,
    walletCurrency: currency,
    balance,
    balanceVnd: currency === "VND" ? balance : null,
    balanceUsd: ["USD", "USDT"].includes(currency) ? balance : null,
    balanceText: `${balance.toLocaleString("vi-VN")} ${currency}`,
    usdtBalance: currency === "USDT" ? balance : 0,
    updatedAt: String(value.updated_at ?? value.updatedAt ?? "").trim() || null,
    requesterName:
      String(value.name ?? value.username ?? value.user ?? "").trim() || null,
    requesterChatId: null,
    botSource: "zampto",
    rawPayload: data,
  };
}

export async function purchaseFromZampto(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  try {
    const { data } = await client(credentials).post("/buy", {
      product_id: input.productId,
      quantity: input.quantity,
    });
    const identity = orderIdentity(data);
    const status = orderStatus(data);
    const deliveredText = delivery(data);
    const failed =
      explicitFailure(data) ||
      ["failed", "cancelled", "canceled", "rejected"].includes(status);
    if (failed) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: payloadOutOfStock(data),
        pending: false,
        providerOrderId: identity.orderId,
        providerOrderCode: identity.orderCode,
        rawPayload: data,
        message: String(
          record(data).message || `Zampto order ${status || "failed"}.`,
        ),
      };
    }
    if (!deliveredText && !identity.orderCode) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: false,
        pending: false,
        rawPayload: data,
        message:
          "Zampto accepted the purchase but returned no order code or delivery.",
      };
    }
    return {
      success: Boolean(deliveredText),
      deliveredText,
      outOfStock: false,
      pending: !deliveredText,
      providerOrderId: identity.orderId,
      providerOrderCode: identity.orderCode,
      rawPayload: data,
      message: deliveredText
        ? undefined
        : "Zampto order created; delivery is pending.",
    };
  } catch (error) {
    return {
      success: false,
      deliveredText: null,
      outOfStock: isOutOfStock(error),
      pending: false,
      rawPayload: axios.isAxiosError(error) ? error.response?.data : undefined,
      message: errorMessage(error),
    };
  }
}

export async function fetchZamptoOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const lookup = String(input.orderCode || input.orderId || "").trim();
  if (!lookup) throw new Error("Zampto order code is required.");
  try {
    const { data } = await client(credentials).get(
      `/orders/${encodeURIComponent(lookup)}`,
    );
    const identity = orderIdentity(data);
    const currentStatus = orderStatus(data);
    const deliveredText = delivery(data);
    const failed =
      explicitFailure(data) ||
      ["failed", "cancelled", "canceled", "rejected"].includes(currentStatus);
    const outOfStock = /out_of_stock|sold_out/.test(currentStatus);
    return {
      success: !failed,
      status: deliveredText ? "delivered" : currentStatus || "pending",
      deliveredText,
      failureReason: failed
        ? String(
            record(data).message ||
              `Zampto order ${currentStatus || "failed"}.`,
          )
        : null,
      providerOrderId: identity.orderId,
      providerOrderCode: identity.orderCode || lookup,
      pending: !failed && !deliveredText,
      outOfStock,
      rawPayload: data,
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      deliveredText: null,
      failureReason: errorMessage(error),
      providerOrderId: input.orderId || null,
      providerOrderCode: input.orderCode || lookup,
      pending: false,
      outOfStock: isOutOfStock(error),
      rawPayload: axios.isAxiosError(error) ? error.response?.data : null,
      message: errorMessage(error),
    };
  }
}
