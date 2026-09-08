import axios from "axios";
import { createHash } from "node:crypto";

import { DEFAULT_PROVIDER_BASE_URL, DEFAULT_PROVIDER_NAME } from "../constants";
import {
  isRoboticvnProvider,
  fetchRoboticvnProducts,
  fetchRoboticvnBalance,
  purchaseFromRoboticvn,
  fetchRoboticvnOrderStatus,
  checkRoboticvnVariantStock,
  checkRoboticvnVariantAvailability,
  verifyRoboticvnCredentials,
} from "./roboticvn";
import {
  isShopMmoProvider,
  fetchShopMmoProducts,
  fetchShopMmoBalance,
  purchaseFromShopMmo,
  fetchShopMmoOrderStatus,
} from "./shopmmo";
import {
  isHuyMaiProvider,
  fetchHuyMaiProducts,
  fetchHuyMaiBalance,
  purchaseFromHuyMai,
  fetchHuyMaiOrderStatus,
} from "./huymai";
import {
  isZamptoProvider,
  fetchZamptoProducts,
  fetchZamptoBalance,
  purchaseFromZampto,
  fetchZamptoOrderStatus,
} from "./zampto";
import {
  isGigaPowerProvider,
  fetchGigaPowerProducts,
  fetchGigaPowerBalance,
  purchaseFromGigaPower,
  fetchGigaPowerOrderStatus,
} from "./gigapower";

export {
  isRoboticvnBaseUrl,
  isRoboticvnKey,
  isRoboticvnProvider,
  resolveRoboticvnOrderReference,
} from "./roboticvn";
export { isShopMmoBaseUrl, isShopMmoKey, isShopMmoProvider } from "./shopmmo";
export { isHuyMaiBaseUrl, isHuyMaiKey, isHuyMaiProvider } from "./huymai";
export { isZamptoBaseUrl, isZamptoKey, isZamptoProvider } from "./zampto";
export {
  isGigaPowerBaseUrl,
  isGigaPowerProvider,
  parseGigaPowerCredentials,
} from "./gigapower";

export interface ProviderCredentials {
  baseUrl?: string;
  buyerKey: string;
  providerName?: string;
  timeoutMs?: number;
}

/**
 * Whether checkout can verify the provider wallet before accepting an order.
 * Providers without a balance endpoint must enforce funds in their purchase
 * response instead of being rejected during checkout.
 */
export function supportsProviderBalanceLookup(
  credentials: Pick<ProviderCredentials, "baseUrl" | "providerName">,
): boolean {
  return !isGigaPowerProvider(credentials);
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

export function convertProviderPriceToVnd(
  priceInput: number,
  currencyInput: string,
  usdVndRateInput: number,
): number {
  const price = Number(priceInput);
  const currency = String(currencyInput || "VND")
    .trim()
    .toUpperCase();

  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`Invalid provider product price: ${String(priceInput)}`);
  }

  if (currency === "VND") return price;

  if (currency === "USD" || currency === "USDT") {
    const usdVndRate = Number(usdVndRateInput);
    if (!Number.isFinite(usdVndRate) || usdVndRate <= 0) {
      throw new Error(
        `Invalid USD/USDT to VND rate: ${String(usdVndRateInput)}`,
      );
    }
    return Math.round(price * usdVndRate);
  }

  throw new Error(
    `Unsupported provider product currency: ${currency || "(empty)"}`,
  );
}

// Canboso limits the catalog endpoint per buyer key. Catalog sync, checkout
// validation and multiple shops can otherwise request the exact same snapshot
// at nearly the same time. Keep only successful responses for slightly less
// than one sync interval and collapse concurrent requests in this process.
const CANBOSO_CATALOG_CACHE_TTL_MS = 55_000;
const canbosoCatalogCache = new Map<
  string,
  { expiresAt: number; products: ProviderProduct[] }
>();
const canbosoCatalogRequests = new Map<string, Promise<ProviderProduct[]>>();

function getCanbosoCatalogCacheKey(credentials: ProviderCredentials) {
  return createHash("sha256")
    .update(`${getBaseUrl(credentials)}\n${credentials.buyerKey}`)
    .digest("hex");
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

export function resolveProviderBalanceVnd(
  balanceResult: Pick<
    ProviderBalanceResult,
    "walletCurrency" | "balance" | "balanceVnd" | "balanceUsd" | "usdtBalance"
  >,
  productCurrencyInput: string,
  usdVndRateInput: number,
): number | null {
  const productCurrency = String(productCurrencyInput || "VND")
    .trim()
    .toUpperCase();
  const walletCurrency = String(balanceResult.walletCurrency || "")
    .trim()
    .toUpperCase();
  const validBalance = (value: number | null | undefined) => {
    const normalized = Number(value);
    return value !== null &&
      value !== undefined &&
      Number.isFinite(normalized) &&
      normalized >= 0
      ? normalized
      : null;
  };

  if (productCurrency === "VND") {
    return (
      validBalance(balanceResult.balanceVnd) ??
      (walletCurrency === "VND" ? validBalance(balanceResult.balance) : null)
    );
  }

  if (productCurrency === "USD" || productCurrency === "USDT") {
    const balanceUsd =
      validBalance(balanceResult.balanceUsd) ??
      (walletCurrency === "USD" || walletCurrency === "USDT"
        ? validBalance(balanceResult.balance)
        : null) ??
      (productCurrency === "USDT"
        ? validBalance(balanceResult.usdtBalance)
        : null);

    return balanceUsd === null
      ? null
      : convertProviderPriceToVnd(balanceUsd, productCurrency, usdVndRateInput);
  }

  return null;
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
  return String(credentials.baseUrl || DEFAULT_PROVIDER_BASE_URL).replace(
    /\/$/,
    "",
  );
}

function buildBuyerApiUrl(credentials: ProviderCredentials, path: string) {
  const baseUrl = getBaseUrl(credentials);
  const normalizedPath = String(path || "").replace(/^\/+/, "");

  if (/\/api\/v\d+$/i.test(baseUrl)) {
    return `${baseUrl}/telegram-buyer/${normalizedPath}`;
  }

  return `${baseUrl}/api/v2/telegram-buyer/${normalizedPath}`;
}

function getTimeout(credentials: ProviderCredentials) {
  const timeout = Number(credentials.timeoutMs || 10000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 10000;
}

function normalizeAvailable(value: unknown) {
  // Canboso uses null for products whose inventory is not quantity-limited
  // (notably manually fulfilled slot products). Preserve that sentinel: in the
  // catalog domain null means unlimited/available, while 0 means out of stock.
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

const LOGIN_KEYS = new Set(["user", "email", "username", "login", "account"]);
const PASSWORD_KEYS = new Set(["password", "pass", "pwd"]);
const SKIP_KEYS = new Set([
  "id",
  "status",
  "type",
  "created_at",
  "updated_at",
  "createdAt",
  "updatedAt",
  "productItemId",
  "deliveredAt",
]);

function extractAccountExtras(
  typed: Record<string, unknown>,
  usedValues: Set<string>,
): string[] {
  return Object.entries(typed)
    .filter(
      ([k]) => !LOGIN_KEYS.has(k) && !PASSWORD_KEYS.has(k) && !SKIP_KEYS.has(k),
    )
    .map(([, v]) => String(v || "").trim())
    .filter((v) => v && !usedValues.has(v));
}

function formatDeliveredAccounts(deliveredAccounts: unknown): string | null {
  if (!Array.isArray(deliveredAccounts) || deliveredAccounts.length === 0) {
    return null;
  }

  const lines = deliveredAccounts
    .map((item) => {
      if (typeof item === "string") {
        return item.trim() || null;
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const typed = item as Record<string, unknown>;

      const login =
        [...LOGIN_KEYS]
          .map((k) => String(typed[k] || "").trim())
          .find(Boolean) ?? "";

      const password =
        [...PASSWORD_KEYS]
          .map((k) => String(typed[k] || "").trim())
          .find(Boolean) ?? "";

      const usedValues = new Set([login, password].filter(Boolean));
      const extras = extractAccountExtras(typed, usedValues);

      const parts = [login, password, ...extras].filter(Boolean);
      return parts.length > 0 ? parts.join(" | ") : null;
    })
    .filter(Boolean) as string[];

  return lines.length > 0 ? lines.join("\n\n") : null;
}

function mergeDeliveredText(
  deliveredText: string,
  deliveredAccounts: unknown,
): string {
  const accountsText = formatDeliveredAccounts(deliveredAccounts);
  if (!accountsText) return deliveredText;

  // extract extra values from accounts that aren't already in deliveredText
  const textLower = deliveredText.toLowerCase();
  const extras: string[] = [];

  if (Array.isArray(deliveredAccounts)) {
    for (const item of deliveredAccounts) {
      if (!item || typeof item !== "object") continue;
      const typed = item as Record<string, unknown>;
      const usedValues = new Set<string>();
      const itemExtras = extractAccountExtras(typed, usedValues);
      for (const v of itemExtras) {
        if (!textLower.includes(v.toLowerCase())) {
          extras.push(v);
        }
      }
    }
  }

  if (extras.length === 0) return deliveredText;
  return `${deliveredText} | ${extras.join(" | ")}`;
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

export async function verifyProviderConnection(
  credentials: ProviderCredentials,
) {
  if (isGigaPowerProvider(credentials)) {
    const products = await fetchGigaPowerProducts(credentials);
    return { ok: true, providerName: "gigapower", sampleSize: products.length };
  }
  if (isZamptoProvider(credentials)) {
    const products = await fetchZamptoProducts(credentials);
    return { ok: true, providerName: "zampto", sampleSize: products.length };
  }
  if (isHuyMaiProvider(credentials)) {
    const products = await fetchHuyMaiProducts(credentials);
    return { ok: true, providerName: "huymai", sampleSize: products.length };
  }
  // Roboticvn: skip the N+1 detail fan-out of fetchRoboticvnProducts (which trips
  // the provider's per-IP rate limit on rapid re-verify and comes back as 401).
  // A single /products list request is enough to confirm the key + baseUrl work.
  if (isRoboticvnProvider(credentials)) {
    const result = await verifyRoboticvnCredentials(credentials);
    return {
      ok: result.ok,
      providerName: credentials.providerName || "roboticvn",
      sampleSize: result.sampleSize,
    };
  }
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
  if (isGigaPowerProvider(credentials)) {
    return fetchGigaPowerProducts(credentials);
  }
  if (isZamptoProvider(credentials)) return fetchZamptoProducts(credentials);
  if (isHuyMaiProvider(credentials)) return fetchHuyMaiProducts(credentials);
  if (isRoboticvnProvider(credentials)) {
    return fetchRoboticvnProducts(credentials);
  }
  if (isShopMmoProvider(credentials)) {
    return fetchShopMmoProducts(credentials);
  }
  if (!credentials.buyerKey) {
    throw new Error("Provider buyer key is missing.");
  }

  const cacheKey = getCanbosoCatalogCacheKey(credentials);
  const now = Date.now();
  const cached = canbosoCatalogCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.products;
  }
  if (cached) {
    canbosoCatalogCache.delete(cacheKey);
  }

  const inFlight = canbosoCatalogRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const response = await axios.get(
      buildBuyerApiUrl(credentials, "products"),
      {
        params: {
          key: credentials.buyerKey,
        },
        timeout: getTimeout(credentials),
      },
    );

    if (
      response.data?.success !== true ||
      !Array.isArray(response.data?.products)
    ) {
      throw new Error("Provider returned an invalid product list.");
    }

    const products = response.data.products.map(
      (product: Record<string, unknown>) => {
        const price = product.price as Record<string, unknown> | undefined;
        const availability = product.availability as
          | Record<string, unknown>
          | undefined;
        const requirements = product.purchaseRequirements as
          | Record<string, unknown>
          | undefined;
        const productType = String(product.productType || "").toLowerCase();
        const slotDurations =
          requirements?.allowedMonths ?? product.slotDurations;

        return {
          externalId: String(
            product.productId || product._id || product.id || "",
          ),
          sourceName: String(
            product.product_name || product.name || "Untitled product",
          ),
          sourceRawName:
            String(product.product_name_raw || product.rawName || "").trim() ||
            null,
          description: String(product.description || "").trim() || null,
          rawDescription: String(product.description_raw || "").trim() || null,
          price: Number(
            price?.amount ?? product.walletPricing ?? product.pricing ?? 0,
          ),
          available: normalizeAvailable(
            availability?.available ??
              (product.stats as Record<string, unknown> | undefined)?.available,
          ),
          hidden:
            Boolean(product.hidden) ||
            product.status === "inactive" ||
            product.enabled === false ||
            product.active === false,
          isSlotProduct:
            productType === "slot" ||
            Boolean(product.isSlotProduct ?? product.is_slot_product),
          requiresCustomerEmail: Boolean(
            requirements?.customerEmail ??
            product.requiresCustomerEmail ??
            product.requires_customer_email,
          ),
          requiresSlotMonths: Boolean(
            requirements?.slotMonths ??
            product.requiresSlotMonths ??
            product.requires_slot_months,
          ),
          slotDurations: Array.isArray(slotDurations)
            ? slotDurations
                .map((item) => Number(item))
                .filter((item) => Number.isFinite(item))
            : [],
          quantityFixed:
            Number(requirements?.quantityFixed ?? product.quantityFixed ?? 1) ||
            1,
          walletCurrency: String(
            price?.currency ||
              product.walletCurrency ||
              product.currency ||
              product.currency_code ||
              response.data?.walletCurrency ||
              "VND",
          ).toUpperCase(),
          metadata: product,
        };
      },
    );

    canbosoCatalogCache.set(cacheKey, {
      expiresAt: Date.now() + CANBOSO_CATALOG_CACHE_TTL_MS,
      products,
    });
    return products;
  })();

  canbosoCatalogRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    canbosoCatalogRequests.delete(cacheKey);
  }
}

/**
 * Lightweight stock check for a SINGLE product variant.
 * For roboticvn: 1 HTTP request (GET /products/{parentId}) instead of N+1.
 * For other providers: returns null (caller should fall back to DB or full catalog).
 */
export async function checkProviderVariantStock(
  credentials: ProviderCredentials,
  variantId: string,
  parentProductId?: string | null,
): Promise<boolean | null> {
  if (isRoboticvnProvider(credentials)) {
    return checkRoboticvnVariantStock(credentials, variantId, parentProductId);
  }
  if (isShopMmoProvider(credentials)) {
    return null; // ShopMMO does not have a single-variant endpoint
  }
  // Non-roboticvn: no single-variant endpoint available → caller decides.
  return null;
}

export async function checkProviderVariantAvailability(
  credentials: ProviderCredentials,
  variantId: string,
  parentProductId?: string | null,
): Promise<{ inStock: boolean; availableQuantity: number | null } | null> {
  if (isRoboticvnProvider(credentials)) {
    return checkRoboticvnVariantAvailability(
      credentials,
      variantId,
      parentProductId,
    );
  }
  return null;
}

export async function fetchProviderBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  if (isGigaPowerProvider(credentials)) {
    return fetchGigaPowerBalance(credentials);
  }
  if (isZamptoProvider(credentials)) return fetchZamptoBalance(credentials);
  if (isHuyMaiProvider(credentials)) return fetchHuyMaiBalance(credentials);
  if (isRoboticvnProvider(credentials)) {
    return fetchRoboticvnBalance(credentials);
  }
  if (isShopMmoProvider(credentials)) {
    return fetchShopMmoBalance(credentials);
  }
  if (!credentials.buyerKey) {
    throw new Error("Provider buyer key is missing.");
  }

  const response = await axios.get(buildBuyerApiUrl(credentials, "balance"), {
    params: {
      key: credentials.buyerKey,
    },
    timeout: getTimeout(credentials),
  });

  if (response.data?.success !== true) {
    throw new Error(
      String(
        response.data?.message ||
          response.data?.desc ||
          "Provider returned an invalid balance response.",
      ),
    );
  }

  return {
    success: true,
    walletCurrency: String(response.data?.walletCurrency || "VND"),
    balance: Number(response.data?.balance || 0),
    balanceVnd:
      response.data?.balanceVnd === null ||
      response.data?.balanceVnd === undefined
        ? null
        : Number(response.data.balanceVnd),
    balanceUsd:
      response.data?.balanceUsd === null ||
      response.data?.balanceUsd === undefined
        ? null
        : Number(response.data.balanceUsd),
    balanceText: String(response.data?.balanceText || "").trim() || null,
    usdtBalance: Number(response.data?.usdtBalance || 0),
    updatedAt: String(response.data?.updatedAt || "").trim() || null,
    requesterName: String(response.data?.requester?.name || "").trim() || null,
    requesterChatId:
      String(response.data?.requester?.chatId || "").trim() || null,
    botSource: String(response.data?.botSource || "").trim() || null,
    rawPayload: response.data,
  };
}

export async function purchaseFromProvider(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  if (isGigaPowerProvider(credentials)) {
    return purchaseFromGigaPower(credentials, input);
  }
  if (isZamptoProvider(credentials))
    return purchaseFromZampto(credentials, input);
  if (isHuyMaiProvider(credentials))
    return purchaseFromHuyMai(credentials, input);
  if (isRoboticvnProvider(credentials)) {
    return purchaseFromRoboticvn(credentials, input);
  }
  if (isShopMmoProvider(credentials)) {
    return purchaseFromShopMmo(credentials, input);
  }
  if (!credentials.buyerKey) {
    throw new Error("Provider buyer key is missing.");
  }

  // Canboso requires a caller-owned, stable idempotency key on every purchase.
  // Use our client order code so every retry of the same local order reuses the
  // same key. Canboso's orderCode only exists after this request succeeds; it is
  // read from the response below and stored as the upstream/source order code.
  const idempotencyKey = String(input.clientOrderCode || "").trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return {
      success: false,
      deliveredText: null,
      outOfStock: false,
      message:
        "A stable client order code (8-128 characters) is required for provider purchase.",
    };
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
          "Idempotency-Key": idempotencyKey,
        },
        timeout: getTimeout(credentials),
        // Axios' socket timeout can be kept alive forever by a provider that
        // trickles response bytes without ever completing the JSON body. Use
        // an absolute deadline as well so one bad source cannot occupy a
        // purchase-worker slot indefinitely.
        signal: AbortSignal.timeout(getTimeout(credentials)),
      },
    );

    // A successful purchase request may reserve or consume inventory. Do not
    // let the next catalog sync reuse the pre-purchase snapshot.
    canbosoCatalogCache.delete(getCanbosoCatalogCacheKey(credentials));

    if (response.data?.success !== true) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: isOutOfStock(response.data),
        pending: Boolean(response.data?.pending),
        providerOrderId: String(response.data?.orderId || "").trim() || null,
        providerOrderCode:
          String(response.data?.orderCode || "").trim() || null,
        rawPayload: response.data,
        message: String(
          response.data?.message || response.data?.desc || "Purchase failed",
        ),
      };
    }

    const order = response.data?.order as Record<string, unknown> | undefined;
    const delivery = response.data?.delivery as
      | Record<string, unknown>
      | undefined;
    const deliveredAccounts =
      delivery?.accounts ?? response.data?.deliveredAccounts;
    const rawDeliveredText = String(
      delivery?.deliveredText ?? response.data?.deliveredText ?? "",
    ).trim();
    const deliveredText = rawDeliveredText
      ? mergeDeliveredText(rawDeliveredText, deliveredAccounts)
      : formatDeliveredAccounts(deliveredAccounts);
    const orderStatus = String(order?.status || "")
      .trim()
      .toLowerCase();
    const pending =
      Boolean(response.data?.pending) ||
      ["paid", "pending", "processing", "pending_manual"].includes(orderStatus);

    return {
      success: true,
      deliveredText: deliveredText || null,
      outOfStock: false,
      pending,
      providerOrderId:
        String(order?.id || response.data?.orderId || "").trim() || null,
      providerOrderCode:
        String(order?.orderCode || response.data?.orderCode || "").trim() ||
        null,
      rawPayload: response.data,
    };
  } catch (error) {
    // Out-of-stock and pending responses are useful stock signals too. Force
    // the next scheduled sync to refresh instead of serving an older snapshot.
    canbosoCatalogCache.delete(getCanbosoCatalogCacheKey(credentials));
    if (axios.isAxiosError(error)) {
      const isAmbiguousTimeout =
        error.code === "ECONNABORTED" || error.code === "ERR_CANCELED";
      return {
        success: false,
        deliveredText: null,
        outOfStock: isOutOfStock(error.response?.data, error.response?.status),
        // A timed-out POST may already have reached the provider. Keep the
        // paid order in seller-review/waiting state instead of declaring a
        // definitive failure; retries remain protected by Idempotency-Key.
        pending: isAmbiguousTimeout || Boolean(error.response?.data?.pending),
        providerOrderId:
          String(error.response?.data?.orderId || "").trim() || null,
        providerOrderCode:
          String(error.response?.data?.orderCode || "").trim() || null,
        rawPayload: error.response?.data,
        message: isAmbiguousTimeout
          ? "Provider purchase timed out; the result is being held for safe reconciliation."
          : String(
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
      message:
        error instanceof Error ? error.message : "Provider purchase failed",
    };
  }
}

export async function fetchProviderOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  if (isGigaPowerProvider(credentials)) {
    return fetchGigaPowerOrderStatus(credentials, input);
  }
  if (isZamptoProvider(credentials))
    return fetchZamptoOrderStatus(credentials, input);
  if (isHuyMaiProvider(credentials))
    return fetchHuyMaiOrderStatus(credentials, input);
  if (isRoboticvnProvider(credentials)) {
    return fetchRoboticvnOrderStatus(credentials, input);
  }
  if (isShopMmoProvider(credentials)) {
    return fetchShopMmoOrderStatus(credentials, input);
  }
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
    const status =
      String(order?.status || "")
        .trim()
        .toLowerCase() || null;
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
        message: String(
          response.data?.message ||
            "Provider returned an invalid order status response.",
        ),
      };
    }

    return {
      success: true,
      status,
      deliveredText,
      failureReason,
      providerOrderId: String(order.id || "").trim() || null,
      providerOrderCode: String(order.orderCode || "").trim() || null,
      pending: [
        "pending",
        "processing",
        "pending_stock",
        "pending_manual",
      ].includes(String(status || "")),
      outOfStock: status === "pending_stock",
      rawPayload: response.data,
      message: String(response.data?.message || "").trim() || undefined,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const order = error.response?.data?.order as
        | Record<string, unknown>
        | undefined;
      const status =
        String(order?.status || "")
          .trim()
          .toLowerCase() || null;

      return {
        success: false,
        status,
        deliveredText: String(order?.deliveredText || "").trim() || null,
        failureReason:
          String(
            order?.failureReason || error.response?.data?.message || "",
          ).trim() || null,
        providerOrderId: String(order?.id || "").trim() || null,
        providerOrderCode: String(order?.orderCode || "").trim() || null,
        pending: [
          "pending",
          "processing",
          "pending_stock",
          "pending_manual",
        ].includes(String(status || "")),
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
      message:
        error instanceof Error
          ? error.message
          : "Provider order status request failed",
    };
  }
}
