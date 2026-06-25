import axios, { AxiosInstance } from "axios";

import type {
  ProviderCredentials,
  ProviderProduct,
  ProviderPurchaseInput,
  ProviderPurchaseResult,
  ProviderBalanceResult,
  ProviderOrderStatusInput,
  ProviderOrderStatusResult,
} from "./provider";

// ─────────────────────────────────────────────────────────────
// Roboticvn Customer API v2 adapter.
//
// Different shape from canboso (the default external provider):
//   - Auth: `x-api-key` header (canboso uses `?key=` query param)
//   - Catalog: GET /products returns id+title only; variants (price + stock)
//     live under GET /products/{id}. Each VARIANT maps to one ProviderProduct
//     (externalId = variant_id).
//   - Purchase: prepaid-wallet model. POST /orders with
//     `payment_method:"wallet"` debits the wallet (required field — omitting it
//     returns HTTP 400). The order completes near-instantly for auto-delivery
//     products; credentials come from a SEPARATE GET /orders/{id}/delivery.
//   - A wallet-paid order keeps `payment_status:"not_paid"` forever — the
//     "done" signal is the order's own `status:"completed"`, NOT payment_status.
//
// Selected by host: provider.ts dispatches here when baseUrl is roboticvn.
// ─────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://api.roboticvn.com";
const WALLET_CURRENCY = "VND";

export function isRoboticvnBaseUrl(baseUrl?: string | null): boolean {
  return /(^|\/\/|\.)roboticvn\.com/i.test(String(baseUrl || ""));
}

// roboticvn API keys are prefixed `apk_`; canboso buyer keys use `tgb_`.
// The key prefix is the source of truth for routing — the bot-config UI has no
// baseUrl field, so a roboticvn shop is identified by its key alone.
export function isRoboticvnKey(buyerKey?: string | null): boolean {
  return /^apk_/i.test(String(buyerKey || "").trim());
}

export function isRoboticvnProvider(credentials: {
  baseUrl?: string | null;
  buyerKey?: string | null;
}): boolean {
  return isRoboticvnBaseUrl(credentials.baseUrl) || isRoboticvnKey(credentials.buyerKey);
}

function getTimeout(credentials: ProviderCredentials, fallback = 15000) {
  const timeout = Number(credentials.timeoutMs || fallback);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function client(credentials: ProviderCredentials, perRequestTimeout?: number): AxiosInstance {
  if (!credentials.buyerKey) {
    throw new Error("Roboticvn API key (x-api-key) is missing.");
  }
  // Routing here is by key prefix, so a stale/wrong baseUrl (e.g. left at the
  // canboso default because the UI has no baseUrl field) must NOT leak through.
  // Only honour baseUrl when it actually points at roboticvn; else use default.
  const raw = String(credentials.baseUrl || "").replace(/\/+$/, "");
  const base = isRoboticvnBaseUrl(raw) ? raw : DEFAULT_BASE_URL;
  // Endpoints live under /api/v2. Accept a baseUrl with or without that suffix.
  const baseURL = /\/api\/v2$/i.test(base) ? base : `${base}/api/v2`;
  return axios.create({
    baseURL,
    timeout: perRequestTimeout ?? getTimeout(credentials),
    headers: {
      "x-api-key": credentials.buyerKey,
      Accept: "application/json",
    },
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, any> | undefined;
    return String(data?.error?.message || data?.message || error.message || "Roboticvn request failed");
  }
  return error instanceof Error ? error.message : "Roboticvn request failed";
}

function isOutOfStockError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = Number(error.response?.status);
  const msg = errorMessage(error).toLowerCase();
  return (
    [404, 409, 410].includes(status) ||
    msg.includes("không khả dụng") ||
    msg.includes("hết hàng") ||
    msg.includes("out of stock") ||
    msg.includes("sold out")
  );
}

// ── Catalog ──────────────────────────────────────────────────

interface RvVariant {
  id: string;
  title: string;
  prices?: Record<string, number>;
  in_stock?: boolean;
  available_quantity?: number;
}

interface RvProductDetail {
  id: string;
  title: string;
  description?: string | null;
  thumbnail?: string | null;
  in_stock?: boolean;
  variants?: RvVariant[];
}

function variantPrice(variant: RvVariant): number {
  const vnd = Number(variant.prices?.vnd);
  if (Number.isFinite(vnd) && vnd > 0) return vnd;
  const anyPrice = Object.values(variant.prices || {}).find((v) => Number.isFinite(Number(v)));
  return Number(anyPrice || 0);
}

function mapVariant(product: RvProductDetail, variant: RvVariant): ProviderProduct {
  const variantTitle = String(variant.title || "").trim();
  const productTitle = String(product.title || "").trim();
  const sourceName = variantTitle
    ? `${productTitle} — ${variantTitle}`
    : productTitle || "Untitled product";
  const available =
    variant.available_quantity === undefined || variant.available_quantity === null
      ? null
      : Number(variant.available_quantity);

  return {
    externalId: String(variant.id || ""),
    sourceName,
    sourceRawName: variantTitle || null,
    description: String(product.description || "").trim() || null,
    rawDescription: null,
    price: variantPrice(variant),
    available,
    hidden: variant.in_stock === false,
    isSlotProduct: false,
    requiresCustomerEmail: false,
    requiresSlotMonths: false,
    slotDurations: [],
    quantityFixed: 1,
    walletCurrency: WALLET_CURRENCY,
    metadata: {
      provider: "roboticvn",
      productId: product.id,
      productTitle,
      variantId: variant.id,
      variantTitle,
      prices: variant.prices || {},
      thumbnail: product.thumbnail || null,
    },
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const settled = await Promise.all(chunk.map(task));
    results.push(...settled);
  }
  return results;
}

export async function fetchRoboticvnProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const api = client(credentials);

  // 1. Page through the (id + title) product list.
  const summaries: { id: string }[] = [];
  const pageSize = 100;
  let offset = 0;
  for (let guard = 0; guard < 50; guard += 1) {
    const { data } = await api.get("/products", { params: { limit: pageSize, offset } });
    const rows: { id: string }[] = Array.isArray(data?.data) ? data.data : [];
    summaries.push(...rows.filter((r) => r?.id));
    const count = Number(data?.meta?.count ?? rows.length);
    offset += pageSize;
    if (rows.length < pageSize || offset >= count) break;
  }

  // 2. Fan out to product detail (variants live there). N+1 — keep concurrency low (429-aware).
  const details = await runWithConcurrency(summaries, 5, async (summary) => {
    try {
      const { data } = await api.get(`/products/${encodeURIComponent(summary.id)}`);
      return data?.data as RvProductDetail | undefined;
    } catch {
      return undefined;
    }
  });

  // 3. Flatten variants → one ProviderProduct each.
  const products: ProviderProduct[] = [];
  for (const detail of details) {
    if (!detail?.variants?.length) continue;
    for (const variant of detail.variants) {
      if (!variant?.id) continue;
      products.push(mapVariant(detail, variant));
    }
  }
  return products;
}

// ── Balance ──────────────────────────────────────────────────

export async function fetchRoboticvnBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const api = client(credentials);
  const { data } = await api.get("/wallet/balance");
  const balances = (data?.data || {}) as Record<string, number>;
  const vnd = Number(balances.vnd || 0);
  const usd = Number(balances.usd || 0);

  return {
    success: true,
    walletCurrency: WALLET_CURRENCY,
    balance: vnd,
    balanceVnd: vnd,
    balanceUsd: usd,
    balanceText: `${vnd.toLocaleString("vi-VN")}₫`,
    usdtBalance: 0,
    updatedAt: null,
    requesterName: null,
    requesterChatId: null,
    botSource: "roboticvn",
    rawPayload: data,
  };
}

// ── Delivery ─────────────────────────────────────────────────

interface RvDeliveryItem {
  account?: string | null;
  password?: string | null;
  additional_info?: string | null;
  display_title?: string | null;
  title?: string | null;
}

function formatDelivery(items: RvDeliveryItem[] | undefined): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lines = items
    .map((item) => {
      const parts = [item.account, item.password, item.additional_info]
        .map((v) => String(v ?? "").trim())
        .filter(Boolean);
      return parts.length > 0 ? parts.join(" | ") : null;
    })
    .filter(Boolean) as string[];
  return lines.length > 0 ? lines.join("\n\n") : null;
}

async function fetchDelivery(api: AxiosInstance, orderId: string): Promise<string | null> {
  try {
    const { data } = await api.get(`/orders/${encodeURIComponent(orderId)}/delivery`);
    return formatDelivery(data?.data as RvDeliveryItem[]);
  } catch {
    return null;
  }
}

// ── Purchase ─────────────────────────────────────────────────
//
// Wallet-debit happens at POST /orders. After the order exists this function
// MUST NOT throw — a thrown error from a successful purchase would lose the
// wallet-debit/order linkage. On any post-creation hiccup we return
// `pending` + providerOrderId so the order is recorded for manual reconcile,
// never re-purchased (which would double-charge: roboticvn has no idempotency key).

export async function purchaseFromRoboticvn(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  const overallTimeout = getTimeout(credentials, 60000);
  const api = client(credentials, Math.min(20000, overallTimeout));

  let orderId = "";
  try {
    const { data } = await api.post("/orders", {
      items: [{ variant_id: input.productId, quantity: input.quantity }],
      currency_code: "vnd",
      payment_method: "wallet",
    });
    orderId = String(data?.data?.order_id || "").trim();
    if (!orderId) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: false,
        message: "Roboticvn order created but returned no order_id.",
        rawPayload: data,
      };
    }
  } catch (error) {
    // Order was NOT created → no wallet debit. Safe to report failure.
    return {
      success: false,
      deliveredText: null,
      outOfStock: isOutOfStockError(error),
      message: errorMessage(error),
      rawPayload: axios.isAxiosError(error) ? error.response?.data : undefined,
    };
  }

  // Order exists (wallet debited). From here, never throw.
  const deadline = Date.now() + overallTimeout;
  let lastStatus = "pending";
  try {
    while (Date.now() < deadline) {
      const { data } = await api.get(`/orders/${encodeURIComponent(orderId)}`);
      lastStatus = String(data?.data?.status || "").trim().toLowerCase();
      if (lastStatus === "completed") {
        const deliveredText = await fetchDelivery(api, orderId);
        return {
          success: Boolean(deliveredText),
          deliveredText,
          outOfStock: false,
          pending: !deliveredText,
          // providerOrderId is null on purpose: the worker writes it into
          // Order.internalSourceOrderId, a UNIQUE FK to internal_source_orders.
          // A roboticvn order id (order_xxx) is NOT a row there → FK violation.
          // Keep the ref in providerOrderCode (plain string column) instead.
          providerOrderId: null,
          providerOrderCode: orderId,
          rawPayload: data,
          message: deliveredText ? undefined : "Order completed but delivery is empty.",
        };
      }
      if (lastStatus === "failed" || lastStatus === "cancelled") {
        return {
          success: false,
          deliveredText: null,
          outOfStock: false,
          providerOrderId: null,
          providerOrderCode: orderId,
          message: `Roboticvn order ${lastStatus}.`,
          rawPayload: data,
        };
      }
      await delay(2500);
    }
  } catch {
    // fall through to pending — order is recorded, reconcile later
  }

  return {
    success: false,
    deliveredText: null,
    outOfStock: false,
    pending: true,
    providerOrderId: null,
    providerOrderCode: orderId,
    message: `Roboticvn order still ${lastStatus}; will reconcile.`,
  };
}

// ── Order status (reconcile) ─────────────────────────────────

export async function fetchRoboticvnOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const orderId = String(input.orderId || "").trim();
  if (!orderId) {
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
      message: "Roboticvn order id is required.",
    };
  }

  const api = client(credentials);
  try {
    const { data } = await api.get(`/orders/${encodeURIComponent(orderId)}`);
    const status = String(data?.data?.status || "").trim().toLowerCase();

    if (status === "completed") {
      const deliveredText = await fetchDelivery(api, orderId);
      return {
        success: Boolean(deliveredText),
        // Map to the worker's expected terminal state.
        status: deliveredText ? "delivered" : "completed",
        deliveredText,
        failureReason: null,
        // null on purpose — see note in purchaseFromRoboticvn (FK to internal_source_orders).
        providerOrderId: null,
        providerOrderCode: orderId,
        pending: !deliveredText,
        outOfStock: false,
        rawPayload: data,
      };
    }

    const failed = status === "failed" || status === "cancelled";
    return {
      success: true,
      status,
      deliveredText: null,
      failureReason: failed ? `Roboticvn order ${status}.` : null,
      providerOrderId: null,
      providerOrderCode: orderId,
      pending: !failed,
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
      providerOrderCode: orderId,
      pending: false,
      outOfStock: false,
      rawPayload: axios.isAxiosError(error) ? error.response?.data : null,
      message: errorMessage(error),
    };
  }
}
