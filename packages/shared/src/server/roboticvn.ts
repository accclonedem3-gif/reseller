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

export function resolveRoboticvnOrderReference(
  payload: unknown,
  fallbackId = "",
): { providerOrderId: string; providerOrderCode: string } {
  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const providerOrderId = String(
    body.order_id || body.id || fallbackId || "",
  ).trim();
  const providerOrderCode = String(body.display_id || "").trim();

  return {
    providerOrderId,
    providerOrderCode: providerOrderCode || providerOrderId,
  };
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
  const instance = axios.create({
    baseURL,
    timeout: perRequestTimeout ?? getTimeout(credentials),
    headers: {
      "x-api-key": credentials.buyerKey,
      Accept: "application/json",
    },
  });

  instance.interceptors.response.use(undefined, async (error) => {
    const config = error.config as any;
    if (!config) return Promise.reject(error);

    config.__retryCount = config.__retryCount || 0;
    const status = error.response?.status;
    const isProductDetailRequest = /^\/products\/[^/]+/i.test(String(config.url || ""));

    // RoboticVN sometimes reports its per-IP detail rate limit as 401/403 instead
    // of 429. Retry those statuses only for product-detail calls so a genuinely
    // invalid API key still fails fast on catalog/balance/order endpoints.
    const isRateLimitedDetail = isProductDetailRequest && (status === 401 || status === 403);
    const isRetryable = isRateLimitedDetail || status === 429 || (status && status >= 500 && status <= 599);

    if (isRetryable && config.__retryCount < 4) {
      config.__retryCount += 1;

      const retryAfterSeconds = Number(error.response?.headers?.["retry-after"] || 0);
      let delayMs = retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : isRateLimitedDetail
          ? 10_000 * config.__retryCount
          : 1500 * Math.pow(1.5, config.__retryCount - 1);
      const retryAfter = error.response?.headers?.["retry-after"];
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed) && parsed > 0) {
          delayMs = parsed * 1000;
        }
      }
      
      // Add jitter
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

// RoboticVN applies its detail-request limit per caller IP, not per API key.
// All catalog syncs in this process therefore have to share one gate; pacing
// each shop independently still creates a burst when several shops sync at once.
let roboticvnDetailQueue: Promise<void> = Promise.resolve();
let roboticvnLastDetailStartedAt = 0;

function runRoboticvnDetailRequest<T>(
  intervalMs: number,
  request: () => Promise<T>,
): Promise<T> {
  const run = roboticvnDetailQueue.catch(() => undefined).then(async () => {
    const waitMs = Math.max(
      0,
      intervalMs - (Date.now() - roboticvnLastDetailStartedAt),
    );
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    roboticvnLastDetailStartedAt = Date.now();
    return request();
  });

  roboticvnDetailQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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
      providerDescription: String(product.description || "").trim() || null,
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

// Lightweight verify: 1 HTTP request to `/products` list. Skips the N+1 detail
// fan-out of fetchRoboticvnProducts so `verifyProviderConnection` doesn't trip
// roboticvn's per-IP rate limit (which returns 401/403, not 429) during rapid
// re-verify. Enough to confirm the key + baseUrl work.
export async function verifyRoboticvnCredentials(
  credentials: ProviderCredentials,
): Promise<{ ok: boolean; sampleSize: number }> {
  const api = client(credentials);
  const { data } = await api.get("/products", { params: { limit: 1, offset: 0 } });
  const count = Number(data?.meta?.count ?? (Array.isArray(data?.data) ? data.data.length : 0));
  return { ok: count > 0, sampleSize: count };
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

  // 2. Fetch details at a conservative pace. RoboticVN limits by IP and may
  // return 401/403 (instead of 429) when calls are bursty. A sequential 650 ms
  // interval stays below 100 detail requests/minute and leaves room for list,
  // balance and order calls made by the same worker.
  const configuredInterval = Number(process.env.ROBOTICVN_DETAIL_REQUEST_INTERVAL_MS || 650);
  const detailIntervalMs = Number.isFinite(configuredInterval)
    ? Math.max(600, configuredInterval)
    : 650;
  const details: Array<RvProductDetail | undefined> = [];
  for (const summary of summaries) {
    try {
      const { data } = await runRoboticvnDetailRequest(detailIntervalMs, () =>
        api.get(`/products/${encodeURIComponent(summary.id)}`),
      );
      details.push(data?.data as RvProductDetail | undefined);
    } catch (error) {
      console.warn(
        `[roboticvn] skipped product detail ${summary.id} after retries: ${errorMessage(error)}`,
      );
      details.push(undefined);
    }
  }

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

// ── Single-variant stock check (1 HTTP request) ─────────────

/**
 * Check whether a specific variant is in stock by fetching only its parent
 * product detail (`GET /products/{productId}`).  This costs **1 HTTP request**
 * instead of the N+1 fan-out of `fetchRoboticvnProducts`.
 *
 * @param variantId    The externalProductId stored in SourceProduct (= variant.id).
 * @param productId    The parent product id — stored in SourceProduct.metadataJson.productId
 *                     when the catalog was synced.  When absent we fall back to the DB
 *                     `available` field (no HTTP call at all).
 * @returns `true` if the variant exists, is in stock, and not hidden.
 *          `false` if it is out of stock or hidden.
 *          `null` if we could not determine (caller should fail-open).
 */
export interface RoboticvnVariantAvailability {
  inStock: boolean;
  availableQuantity: number | null;
}

export async function checkRoboticvnVariantAvailability(
  credentials: ProviderCredentials,
  variantId: string,
  productId?: string | null,
): Promise<RoboticvnVariantAvailability | null> {
  if (!productId) return null; // can't check without parent product id

  try {
    const api = client(credentials);
    const configuredInterval = Number(process.env.ROBOTICVN_DETAIL_REQUEST_INTERVAL_MS || 650);
    const detailIntervalMs = Number.isFinite(configuredInterval)
      ? Math.max(600, configuredInterval)
      : 650;
    const { data } = await runRoboticvnDetailRequest(detailIntervalMs, () =>
      api.get(`/products/${encodeURIComponent(productId)}`),
    );
    const detail = data?.data as RvProductDetail | undefined;
    if (!detail?.variants?.length) return { inStock: false, availableQuantity: 0 };

    const variant = detail.variants.find((v) => String(v.id) === String(variantId));
    if (!variant || variant.in_stock === false) {
      return { inStock: false, availableQuantity: 0 };
    }
    const rawQuantity = variant.available_quantity;
    const availableQuantity = rawQuantity === undefined || rawQuantity === null
      ? null
      : Math.max(0, Math.floor(Number(rawQuantity) || 0));
    return {
      inStock: availableQuantity === null || availableQuantity > 0,
      availableQuantity,
    };
  } catch {
    return null; // fail-open
  }
}

export async function checkRoboticvnVariantStock(
  credentials: ProviderCredentials,
  variantId: string,
  productId?: string | null,
): Promise<boolean | null> {
  const availability = await checkRoboticvnVariantAvailability(
    credentials,
    variantId,
    productId,
  );
  return availability?.inStock ?? null;
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

interface RvDeliveryResponse {
  deliveredAccount?: RvDeliveryItem[] | null;
  delivered_accounts?: RvDeliveryItem[] | null;
  // Kept as a compatibility fallback for older/alternate response shapes.
  data?: RvDeliveryItem[] | null;
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

function deliveryItems(payload: unknown): RvDeliveryItem[] {
  if (!payload || typeof payload !== "object") return [];

  const response = payload as RvDeliveryResponse;
  const snakeCase = Array.isArray(response.delivered_accounts)
    ? response.delivered_accounts
    : [];
  const camelCase = Array.isArray(response.deliveredAccount) ? response.deliveredAccount : [];
  const legacy = Array.isArray(response.data) ? response.data : [];

  // The v2 schema exposes both names as aliases. Pick one non-empty array so
  // the same credentials are never delivered twice.
  if (snakeCase.length > 0) return snakeCase;
  if (camelCase.length > 0) return camelCase;
  return legacy;
}

async function fetchDelivery(api: AxiosInstance, orderId: string): Promise<string | null> {
  try {
    const { data } = await api.get(`/orders/${encodeURIComponent(orderId)}/delivery`);
    return formatDelivery(deliveryItems(data));
  } catch (error) {
    if (axios.isAxiosError(error) && [400, 404].includes(Number(error.response?.status))) {
      return null;
    }
    throw error;
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
  const api = client(credentials, overallTimeout);

  let orderId = "";
  let orderDisplayCode = "";
  try {
    const { data } = await api.post("/orders", {
      items: [{ variant_id: input.productId, quantity: input.quantity }],
      currency_code: "vnd",
      payment_method: "wallet",
    });
    const reference = resolveRoboticvnOrderReference(data?.data);
    orderId = reference.providerOrderId;
    orderDisplayCode = reference.providerOrderCode;
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
      orderDisplayCode = resolveRoboticvnOrderReference(
        data?.data,
        orderId,
      ).providerOrderCode;
      // Delivery is the source of truth for fulfilment. Do not require one
      // exact order-status string: the provider only needs the created order id.
      const deliveredText = await fetchDelivery(api, orderId);
      if (deliveredText) {
        return {
          success: true,
          deliveredText,
          outOfStock: false,
          pending: false,
          providerOrderId: orderId,
          providerOrderCode: orderDisplayCode || orderId,
          rawPayload: data,
        };
      }
      if (lastStatus === "failed" || lastStatus === "cancelled") {
        return {
          success: false,
          deliveredText: null,
          outOfStock: false,
          providerOrderId: orderId,
          providerOrderCode: orderDisplayCode || orderId,
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
    providerOrderId: orderId,
    providerOrderCode: orderDisplayCode || orderId,
    message:
      lastStatus === "completed"
        ? "Roboticvn order completed; delivery is not ready and will reconcile."
        : `Roboticvn order still ${lastStatus}; will reconcile.`,
  };
}

// ── Order status (reconcile) ─────────────────────────────────

export async function fetchRoboticvnOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const orderId = String(input.orderId || input.orderCode || "").trim();
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
    const reference = resolveRoboticvnOrderReference(data?.data, orderId);
    const resolvedOrderId = reference.providerOrderId || orderId;
    const orderDisplayCode = reference.providerOrderCode || resolvedOrderId;
    const deliveredText = await fetchDelivery(api, orderId);

    if (deliveredText) {
      return {
        success: true,
        // Map to the worker's expected terminal state.
        status: "delivered",
        deliveredText,
        failureReason: null,
        providerOrderId: resolvedOrderId,
        providerOrderCode: orderDisplayCode,
        pending: false,
        outOfStock: false,
        rawPayload: data,
      };
    }

    if (status === "completed") {
      return {
        success: false,
        status: "completed",
        deliveredText: null,
        failureReason: null,
        providerOrderId: resolvedOrderId,
        providerOrderCode: orderDisplayCode,
        pending: true,
        outOfStock: false,
        rawPayload: data,
        message: "Roboticvn order completed; delivery is not ready.",
      };
    }

    const failed = status === "failed" || status === "cancelled";
    return {
      success: true,
      status,
      deliveredText: null,
      failureReason: failed ? `Roboticvn order ${status}.` : null,
      providerOrderId: resolvedOrderId,
      providerOrderCode: orderDisplayCode,
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
      providerOrderId: orderId,
      providerOrderCode: orderId,
      pending: false,
      outOfStock: false,
      rawPayload: axios.isAxiosError(error) ? error.response?.data : null,
      message: errorMessage(error),
    };
  }
}
