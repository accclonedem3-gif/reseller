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

const DEFAULT_BASE_URL = "https://khommo.vn";
const DEFAULT_CURRENCY = "VND";

export function isKhommoBaseUrl(value?: string | null): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    return host === "khommo.vn" || host.endsWith(".khommo.vn");
  } catch {
    return /(^|\/\/|\.)khommo\.vn(?::\d+)?(?=\/|$)/i.test(raw);
  }
}

export function isKhommoProvider(credentials: {
  baseUrl?: string | null;
  providerName?: string | null;
  buyerKey?: string | null;
}): boolean {
  const providerName = String(credentials.providerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (
    providerName === "khommo" ||
    providerName === "khommovn" ||
    isKhommoBaseUrl(credentials.baseUrl)
  );
}

function getTimeout(credentials: ProviderCredentials, fallback = 35_000): number {
  const timeout = Number(credentials.timeoutMs || fallback);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function client(credentials: ProviderCredentials): AxiosInstance {
  const raw = String(credentials.baseUrl || "").replace(/\/+$/, "");
  const baseURL = raw || DEFAULT_BASE_URL;
  const apiKey = String(credentials.buyerKey || "").trim();

  if (!apiKey) {
    throw new Error("KhoMMO API key is missing. Lấy API key tại https://khommo.vn/client/document-api");
  }

  return axios.create({
    baseURL,
    timeout: getTimeout(credentials),
    headers: {
      Accept: "application/json",
    },
  });
}

function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string") return data.trim() || error.message;
    if (data && typeof data === "object") {
      const rec = data as Record<string, unknown>;
      const detail = rec.msg || rec.message || rec.error || rec.desc;
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    }
    return error.message || "KhoMMO request failed.";
  }
  return error instanceof Error ? error.message : "KhoMMO request failed.";
}

function isOutOfStockError(msg: string): boolean {
  return /out of stock|sold out|hết hàng|het hang|insufficient stock|không đủ số lượng|không đủ hàng|số lượng còn lại/i.test(
    msg,
  );
}

export async function fetchKhommoBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const http = client(credentials);
  const apiKey = String(credentials.buyerKey || "").trim();

  try {
    const response = await http.get("/api/profile.php", {
      params: { api_key: apiKey },
    });
    const data = response.data || {};

    if (data.status === "error") {
      throw new Error(data.msg || "KhoMMO returned profile error.");
    }

    const profileData = data.data || {};
    const balanceVnd = Number(profileData.money ?? 0);
    const username = profileData.username ? String(profileData.username).trim() : null;

    return {
      success: true,
      walletCurrency: DEFAULT_CURRENCY,
      balance: balanceVnd,
      balanceVnd,
      balanceUsd: null,
      balanceText: `${balanceVnd.toLocaleString("vi-VN")} đ`,
      usdtBalance: 0,
      updatedAt: new Date().toISOString(),
      requesterName: username,
      requesterChatId: null,
      botSource: "khommo",
      rawPayload: data,
    };
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

interface KhommoRawProduct {
  id: string | number;
  name: string;
  price?: string | number;
  amount?: string | number;
  description?: string | null;
  flag?: string | null;
  min?: string | number;
  max?: string | number;
}

interface KhommoCategory {
  id?: string | number;
  name?: string;
  icon?: string;
  products?: KhommoRawProduct[];
}

export async function fetchKhommoProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const http = client(credentials);
  const apiKey = String(credentials.buyerKey || "").trim();

  try {
    const response = await http.get("/api/products.php", {
      params: { api_key: apiKey },
    });
    const data = response.data || {};

    if (data.status === "error") {
      throw new Error(data.msg || "KhoMMO products request failed.");
    }

    const products: ProviderProduct[] = [];
    const seenIds = new Set<string>();

    const processProduct = (p: KhommoRawProduct, categoryName?: string) => {
      const rawId = String(p.id ?? "").trim();
      if (!rawId || seenIds.has(rawId)) return;
      seenIds.add(rawId);

      const name = String(p.name || "Untitled product").trim();
      const price = Number(p.price ?? 0);
      const stock = p.amount != null ? Math.max(0, Math.floor(Number(p.amount) || 0)) : 0;
      const description = p.description ? String(p.description).trim() : null;
      const minQty = Math.max(1, Math.floor(Number(p.min) || 1));

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
        quantityFixed: minQty,
        walletCurrency: DEFAULT_CURRENCY,
        metadata: {
          provider: "khommo",
          delivery_mode: "instant_items",
          product_id: rawId,
          category_name: categoryName || null,
          stock,
          min: minQty,
          max: p.max ? Number(p.max) : null,
        },
      });
    };

    // Standard shape: data: [ { id, name, icon, products: [...] } ]
    if (Array.isArray(data.data)) {
      for (const cat of data.data as KhommoCategory[]) {
        if (Array.isArray(cat.products)) {
          for (const p of cat.products) {
            processProduct(p, cat.name);
          }
        } else if ((cat as unknown as KhommoRawProduct).id && (cat as unknown as KhommoRawProduct).name) {
          // Flattened products fallback
          processProduct(cat as unknown as KhommoRawProduct);
        }
      }
    } else if (Array.isArray(data.products)) {
      for (const p of data.products as KhommoRawProduct[]) {
        processProduct(p);
      }
    }

    return products;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export async function purchaseFromKhommo(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  const http = client(credentials);
  const apiKey = String(credentials.buyerKey || "").trim();
  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));

  try {
    const postData = new URLSearchParams();
    postData.append("action", "buyProduct");
    postData.append("id", String(input.productId));
    postData.append("amount", String(quantity));
    postData.append("api_key", apiKey);

    const response = await http.post("/api/buy_product.php", postData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(getTimeout(credentials)),
    });

    const data = response.data || {};

    if (data.status === "error") {
      const msg = String(data.msg || data.message || "KhoMMO purchase failed.");
      return {
        success: false,
        deliveredText: null,
        outOfStock: isOutOfStockError(msg),
        pending: false,
        message: msg,
        rawPayload: data,
      };
    }

    if (data.status === "success") {
      let deliveredText: string | null = null;
      if (Array.isArray(data.data)) {
        deliveredText = data.data
          .map((item: unknown) => String(item ?? "").trim())
          .filter(Boolean)
          .join("\n");
      } else if (typeof data.data === "string" && data.data.trim()) {
        deliveredText = data.data.trim();
      }

      const transId = String(data.trans_id || data.order_id || "").trim();

      return {
        success: true,
        deliveredText: deliveredText || null,
        outOfStock: false,
        pending: false,
        providerOrderId: transId || null,
        providerOrderCode: transId || null,
        rawPayload: data,
        message: String(data.msg || "Tạo đơn hàng thành công!"),
      };
    }

    throw new Error(data.msg || "KhoMMO returned an unknown response status.");
  } catch (error) {
    const msg = extractErrorMessage(error);
    const isAmbiguousTimeout =
      axios.isAxiosError(error) &&
      (error.code === "ECONNABORTED" || error.code === "ERR_CANCELED");

    return {
      success: false,
      deliveredText: null,
      outOfStock: isOutOfStockError(msg),
      pending: isAmbiguousTimeout,
      rawPayload: axios.isAxiosError(error) ? error.response?.data : undefined,
      message: isAmbiguousTimeout
        ? "Yêu cầu mua hàng tới KhoMMO bị quá thời gian. Đơn hàng đang được giữ lại để đối soát."
        : msg,
    };
  }
}

export async function fetchKhommoOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const http = client(credentials);
  const apiKey = String(credentials.buyerKey || "").trim();
  const orderCode = String(input.orderCode || input.orderId || "").trim();

  if (!orderCode) {
    throw new Error("Provider order id or order code is required.");
  }

  try {
    const response = await http.get("/api/order.php", {
      params: {
        api_key: apiKey,
        order: orderCode,
      },
    });

    const data = response.data || {};

    if (data.status === "error") {
      const msg = String(data.msg || "");
      if (/không tồn tại/i.test(msg)) {
        return {
          success: false,
          status: "failed",
          deliveredText: null,
          failureReason: "Đơn hàng không tồn tại trên KhoMMO.",
          providerOrderId: orderCode,
          providerOrderCode: orderCode,
          pending: false,
          outOfStock: false,
          message: "Đơn hàng không tồn tại trên KhoMMO.",
          rawPayload: data,
        };
      }
      return {
        success: false,
        status: "failed",
        deliveredText: null,
        failureReason: msg || "Tra cứu đơn hàng KhoMMO thất bại.",
        providerOrderId: orderCode,
        providerOrderCode: orderCode,
        pending: false,
        outOfStock: false,
        message: msg || "Tra cứu đơn hàng KhoMMO thất bại.",
        rawPayload: data,
      };
    }

    let deliveredText: string | null = null;
    const orderData = data.data || data;
    if (Array.isArray(orderData.accounts)) {
      deliveredText = orderData.accounts.map(String).filter(Boolean).join("\n");
    } else if (Array.isArray(orderData.data)) {
      deliveredText = orderData.data.map(String).filter(Boolean).join("\n");
    }

    return {
      success: true,
      status: "completed",
      deliveredText: deliveredText || null,
      failureReason: null,
      providerOrderId: orderCode,
      providerOrderCode: orderCode,
      pending: false,
      outOfStock: false,
      rawPayload: data,
      message: "Lấy thông tin đơn hàng thành công.",
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      deliveredText: null,
      failureReason: extractErrorMessage(error),
      providerOrderId: orderCode,
      providerOrderCode: orderCode,
      pending: false,
      outOfStock: false,
      message: extractErrorMessage(error),
      rawPayload: undefined,
    };
  }
}

export async function verifyKhommoCredentials(
  credentials: ProviderCredentials,
): Promise<{ ok: boolean; providerName: string; sampleSize?: number }> {
  const products = await fetchKhommoProducts(credentials);
  return {
    ok: products.length > 0,
    providerName: "khommo",
    sampleSize: products.length,
  };
}
