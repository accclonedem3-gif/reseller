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

const DEFAULT_BASE_URL = "https://webshop.haivankhosi.site";
const DEFAULT_CURRENCY = "VND";

export function isHaiVanKhoSiBaseUrl(value?: string | null): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    return (
      host === "webshop.haivankhosi.site" ||
      host === "haivankhosi.site" ||
      host.endsWith(".haivankhosi.site")
    );
  } catch {
    return /(^|\/\/|\.)haivankhosi\.site(?::\d+)?(?=\/|$)/i.test(raw);
  }
}

export function isHaiVanKhoSiProvider(credentials: {
  baseUrl?: string | null;
  providerName?: string | null;
  buyerKey?: string | null;
}): boolean {
  const providerName = String(credentials.providerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (
    providerName === "haivankhosi" ||
    providerName === "haivan" ||
    providerName === "webshophaivankhosi" ||
    isHaiVanKhoSiBaseUrl(credentials.baseUrl)
  );
}

function getTimeout(credentials: ProviderCredentials, fallback = 15_000): number {
  const timeout = Number(credentials.timeoutMs || fallback);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function client(credentials: ProviderCredentials): AxiosInstance {
  const raw = String(credentials.baseUrl || "").replace(/\/+$/, "");
  const baseURL = raw || DEFAULT_BASE_URL;
  const apiKey = String(credentials.buyerKey || "").trim();

  if (!apiKey) {
    throw new Error("HaiVanKhoSi API key is missing. Set X-API-Key from Telegram bot /apikey command.");
  }

  return axios.create({
    baseURL,
    timeout: getTimeout(credentials),
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string") return data.trim() || error.message;
    if (data && typeof data === "object") {
      const rec = data as Record<string, unknown>;
      const detail = rec.error || rec.message || rec.desc || rec.detail;
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    }
    return error.message || "HaiVanKhoSi request failed.";
  }
  return error instanceof Error ? error.message : "HaiVanKhoSi request failed.";
}

function isOutOfStockError(msg: string): boolean {
  return /out of stock|sold out|hết hàng|het hang|insufficient stock|không đủ số lượng|không đủ hàng/i.test(
    msg,
  );
}

export async function fetchHaiVanKhoSiBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const http = client(credentials);
  try {
    const response = await http.get("/api/balance");
    const data = response.data || {};

    if (data.success === false) {
      throw new Error(data.error || "HaiVanKhoSi returned balance error.");
    }

    const balanceVnd = Number(data.balance_vnd || 0);
    const balanceUsdt = Number(data.balance_usdt || 0);
    const username = data.username ? String(data.username).trim() : null;
    const userId = data.user_id ? String(data.user_id).trim() : null;

    return {
      success: true,
      walletCurrency: DEFAULT_CURRENCY,
      balance: balanceVnd,
      balanceVnd,
      balanceUsd: null,
      balanceText: `${balanceVnd.toLocaleString("vi-VN")} đ`,
      usdtBalance: balanceUsdt,
      updatedAt: new Date().toISOString(),
      requesterName: username || userId || null,
      requesterChatId: userId || null,
      botSource: "haivankhosi",
      rawPayload: data,
    };
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

interface HaiVanProductItem {
  id: string | number;
  name: string;
  emoji_id?: string;
  price_vnd?: number;
  price_usdt?: number;
  price?: number;
  original_price_vnd?: number;
  discount_vnd?: number;
  discount_type?: string;
  discount_value?: number;
  promo_code?: string;
  stock?: number;
  description?: string;
}

interface HaiVanMenuItem {
  id?: string | null;
  name?: string;
  emoji_id?: string;
  menu_path?: string[];
  products?: HaiVanProductItem[];
}

export async function fetchHaiVanKhoSiProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const http = client(credentials);
  try {
    const response = await http.get("/api/products");
    const data = response.data || {};

    if (data.success === false) {
      throw new Error(data.error || "HaiVanKhoSi products request failed.");
    }

    const products: ProviderProduct[] = [];
    const seenIds = new Set<string>();

    const processProduct = (p: HaiVanProductItem, menuInfo?: { id?: string | null; name?: string; menu_path?: string[]; emoji_id?: string }) => {
      const rawId = String(p.id ?? "").trim();
      if (!rawId || seenIds.has(rawId)) return;
      seenIds.add(rawId);

      const name = String(p.name || "Untitled product").trim();
      const price = Number(p.price_vnd ?? p.price ?? p.original_price_vnd ?? 0);
      const stock = p.stock != null ? Math.max(0, Math.floor(Number(p.stock) || 0)) : 0;
      const description = p.description ? String(p.description).trim() : null;
      const emojiId = String(p.emoji_id || menuInfo?.emoji_id || "").trim() || null;

      products.push({
        externalId: rawId,
        sourceName: name,
        sourceRawName: name,
        description,
        rawDescription: null,
        price,
        available: stock,
        hidden: false,
        isSlotProduct: false,
        requiresCustomerEmail: false,
        requiresSlotMonths: false,
        slotDurations: [],
        quantityFixed: 1,
        walletCurrency: DEFAULT_CURRENCY,
        metadata: {
          provider: "haivankhosi",
          delivery_mode: "instant_items",
          product_id: rawId,
          price_vnd: p.price_vnd,
          price_usdt: p.price_usdt,
          original_price_vnd: p.original_price_vnd,
          discount_vnd: p.discount_vnd,
          stock,
          menu_id: menuInfo?.id || null,
          menu_name: menuInfo?.name || null,
          menu_path: menuInfo?.menu_path || [],
          emoji_id: emojiId,
        },
      });
    };

    // 1. Check menus[].products (standard API structure)
    if (Array.isArray(data.menus)) {
      for (const menu of data.menus as HaiVanMenuItem[]) {
        const menuProducts = Array.isArray(menu.products) ? menu.products : [];
        for (const p of menuProducts) {
          processProduct(p, {
            id: menu.id,
            name: menu.name,
            menu_path: menu.menu_path,
            emoji_id: menu.emoji_id,
          });
        }
      }
    }

    // 2. Check flat products[] (if provided directly or via ?format=flat)
    if (Array.isArray(data.products)) {
      for (const p of data.products as HaiVanProductItem[]) {
        processProduct(p);
      }
    }

    return products;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export async function purchaseFromHaiVanKhoSi(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  const http = client(credentials);
  const quantity = Math.max(1, Math.min(100, Math.floor(Number(input.quantity) || 1)));

  try {
    const response = await http.post("/api/buy", {
      product_id: input.productId,
      quantity,
      currency: "vnd",
    });

    const data = response.data || {};

    if (data.success !== true) {
      const errorMsg = String(data.error || data.message || "Purchase failed from HaiVanKhoSi.");
      return {
        success: false,
        deliveredText: null,
        outOfStock: isOutOfStockError(errorMsg),
        pending: false,
        message: errorMsg,
        rawPayload: data,
      };
    }

    const items = Array.isArray(data.items)
      ? data.items.map((i: any) => String(i || "").trim()).filter(Boolean)
      : [];

    const deliveredText = items.length > 0 ? items.join("\n") : null;
    const orderGroup = String(data.order?.order_group || data.order?.id || "").trim() || null;

    return {
      success: true,
      deliveredText,
      outOfStock: false,
      pending: false,
      providerOrderId: orderGroup,
      providerOrderCode: orderGroup,
      rawPayload: data,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const isAmbiguousTimeout =
        error.code === "ECONNABORTED" || error.code === "ERR_CANCELED";
      const errorMsg = extractErrorMessage(error);
      const outOfStock = isOutOfStockError(errorMsg);

      return {
        success: false,
        deliveredText: null,
        outOfStock,
        pending: isAmbiguousTimeout,
        providerOrderId: null,
        providerOrderCode: null,
        rawPayload: error.response?.data,
        message: isAmbiguousTimeout
          ? "HaiVanKhoSi purchase timed out; order held for status check."
          : errorMsg,
      };
    }

    return {
      success: false,
      deliveredText: null,
      outOfStock: false,
      pending: false,
      message: error instanceof Error ? error.message : "HaiVanKhoSi purchase failed.",
    };
  }
}

interface HaiVanOrderRecord {
  id: string;
  product?: string;
  items?: string[];
  price?: number;
  quantity?: number;
  created_at?: string;
}

export async function fetchHaiVanKhoSiOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const http = client(credentials);
  const targetCode = String(input.orderCode || input.orderId || "").trim();

  try {
    const response = await http.get("/api/orders");
    const data = response.data || {};

    if (data.success !== true || !Array.isArray(data.orders)) {
      return {
        success: false,
        status: null,
        deliveredText: null,
        failureReason: data.error || "Invalid orders list response",
        providerOrderId: targetCode || null,
        providerOrderCode: targetCode || null,
        pending: false,
        outOfStock: false,
        rawPayload: data,
        message: data.error || "Orders lookup failed",
      };
    }

    const orders = data.orders as HaiVanOrderRecord[];
    const matched = orders.find(
      (o) => String(o.id || "").trim() === targetCode,
    );

    if (matched) {
      const items = Array.isArray(matched.items)
        ? matched.items.map((i) => String(i || "").trim()).filter(Boolean)
        : [];
      const deliveredText = items.join("\n") || null;

      return {
        success: true,
        status: "delivered",
        deliveredText,
        failureReason: null,
        providerOrderId: matched.id,
        providerOrderCode: matched.id,
        pending: false,
        outOfStock: false,
        rawPayload: matched,
      };
    }

    // Not in historical list yet
    return {
      success: true,
      status: "pending",
      deliveredText: null,
      failureReason: null,
      providerOrderId: targetCode || null,
      providerOrderCode: targetCode || null,
      pending: true,
      outOfStock: false,
      rawPayload: data,
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      deliveredText: null,
      failureReason: extractErrorMessage(error),
      providerOrderId: targetCode || null,
      providerOrderCode: targetCode || null,
      pending: false,
      outOfStock: false,
      rawPayload: null,
      message: extractErrorMessage(error),
    };
  }
}

export async function verifyHaiVanKhoSiConnection(
  credentials: ProviderCredentials,
): Promise<{ ok: boolean; providerName: string; sampleSize: number }> {
  const products = await fetchHaiVanKhoSiProducts(credentials);
  return {
    ok: true,
    providerName: "haivankhosi",
    sampleSize: products.length,
  };
}
