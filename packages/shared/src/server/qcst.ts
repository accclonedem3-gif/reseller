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

const DEFAULT_BASE_URL = "https://api.qcst.tech";
const DEFAULT_CURRENCY = "VND";

export function isQcstBaseUrl(value?: string | null): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    return host === "api.qcst.tech" || host === "qcst.tech" || host.endsWith(".qcst.tech");
  } catch {
    return /(^|\/\/|\.)qcst\.tech(?::\d+)?(?=\/|$)/i.test(raw);
  }
}

export function isQcstKey(value?: string | null): boolean {
  const raw = String(value || "").trim();
  return raw.startsWith("qcst_live_") || raw.startsWith("qcst_");
}

export function isQcstProvider(credentials: {
  baseUrl?: string | null;
  providerName?: string | null;
  buyerKey?: string | null;
}): boolean {
  const providerName = String(credentials.providerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (
    providerName === "qcst" ||
    providerName === "qcsttech" ||
    isQcstBaseUrl(credentials.baseUrl) ||
    isQcstKey(credentials.buyerKey)
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
    throw new Error("QCST API key is missing. Lấy API key tại https://api.qcst.tech");
  }

  return axios.create({
    baseURL,
    timeout: getTimeout(credentials),
    headers: {
      Accept: "application/json",
      "X-API-Key": apiKey,
    },
  });
}

function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string") return data.trim() || error.message;
    if (data && typeof data === "object") {
      const rec = data as Record<string, unknown>;
      const detail = rec.detail || rec.msg || rec.message || rec.error || rec.title;
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    }
    return error.message || "QCST request failed.";
  }
  return error instanceof Error ? error.message : "QCST request failed.";
}

function isOutOfStockError(msg: string): boolean {
  return /out of stock|sold out|hết hàng|het hang|insufficient stock|không đủ số lượng|không đủ hàng|stock_quantity/i.test(
    msg,
  );
}

export function formatQcstDelivery(delivery: unknown): string | null {
  if (!delivery) return null;
  if (typeof delivery === "string") {
    const trimmed = delivery.trim();
    return trimmed || null;
  }
  if (Array.isArray(delivery)) {
    const lines = delivery
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item.trim();
        if (typeof item === "object") {
          const obj = item as Record<string, unknown>;
          if (obj.account && obj.password) {
            return `${obj.account}|${obj.password}${obj.extra ? `|${obj.extra}` : ""}`;
          }
          if (obj.email && obj.password) {
            return `${obj.email}|${obj.password}${obj.extra ? `|${obj.extra}` : ""}`;
          }
          if (obj.username && obj.password) {
            return `${obj.username}|${obj.password}${obj.extra ? `|${obj.extra}` : ""}`;
          }
          const primaryVal = obj.key || obj.code || obj.token || obj.license || obj.data || obj.text || obj.content;
          if (typeof primaryVal === "string" && primaryVal.trim()) return primaryVal.trim();
          return JSON.stringify(item);
        }
        return String(item);
      })
      .filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : null;
  }
  if (typeof delivery === "object") {
    const obj = delivery as Record<string, unknown>;
    if (Array.isArray(obj.accounts)) return formatQcstDelivery(obj.accounts);
    if (Array.isArray(obj.keys)) return formatQcstDelivery(obj.keys);
    if (Array.isArray(obj.items)) return formatQcstDelivery(obj.items);
    if (Array.isArray(obj.data)) return formatQcstDelivery(obj.data);
    if (typeof obj.text === "string" && obj.text.trim()) return obj.text.trim();
    if (typeof obj.content === "string" && obj.content.trim()) return obj.content.trim();
    if (obj.account && obj.password) {
      return `${obj.account}|${obj.password}${obj.extra ? `|${obj.extra}` : ""}`;
    }
    return JSON.stringify(delivery);
  }
  return String(delivery).trim() || null;
}

export async function fetchQcstBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const http = client(credentials);

  try {
    const response = await http.get("/v1/balance");
    const data = response.data || {};

    if (data.success === false) {
      throw new Error(data.detail || "QCST returned balance error.");
    }

    const walletData = data.data || {};
    const balanceAmount = Number(walletData.available ?? 0);
    const currency = String(walletData.currency || DEFAULT_CURRENCY).toUpperCase();

    return {
      success: true,
      walletCurrency: currency,
      balance: balanceAmount,
      balanceVnd: currency === "VND" ? balanceAmount : null,
      balanceUsd: null,
      balanceText: `${balanceAmount.toLocaleString("vi-VN")} ${currency}`,
      usdtBalance: 0,
      updatedAt: new Date().toISOString(),
      requesterName: null,
      requesterChatId: null,
      botSource: "qcst",
      rawPayload: data,
    };
  } catch (error) {
    throw new Error(`QCST balance check failed: ${extractErrorMessage(error)}`);
  }
}

export async function fetchQcstProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const http = client(credentials);

  try {
    const response = await http.get("/v1/products");
    const data = response.data || {};

    if (data.success === false) {
      throw new Error(data.detail || "QCST returned product list error.");
    }

    const items = Array.isArray(data.data) ? data.data : [];
    const products: ProviderProduct[] = [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.id || "").trim();
      const name = String(item.name || "").trim();
      if (!id || !name) continue;

      const price = Number(item.price || 0);
      const isOOS = item.availability === "OUT_OF_STOCK" || item.stock_quantity === 0;
      const stockQuantity = item.stock_quantity !== null && item.stock_quantity !== undefined
        ? Number(item.stock_quantity)
        : null;

      const available = isOOS ? 0 : (stockQuantity !== null && Number.isFinite(stockQuantity) ? Math.max(0, stockQuantity) : 999);

      const descriptionParts: string[] = [];
      if (item.description) descriptionParts.push(String(item.description).trim());
      if (item.warranty) descriptionParts.push(`Bảo hành: ${String(item.warranty).trim()}`);
      if (item.customer_prompt) descriptionParts.push(`Lưu ý: ${String(item.customer_prompt).trim()}`);

      const requiresCustomerEmail = item.customer_input_type === "EMAIL";

      products.push({
        externalId: id,
        sourceName: name,
        sourceRawName: name,
        description: descriptionParts.length > 0 ? descriptionParts.join("\n\n") : null,
        rawDescription: item.description ? String(item.description).trim() : null,
        price,
        available,
        hidden: false,
        isSlotProduct: false,
        requiresCustomerEmail,
        requiresSlotMonths: false,
        slotDurations: [],
        quantityFixed: Math.max(1, Number(item.min_quantity) || 1),
        walletCurrency: String(item.currency || DEFAULT_CURRENCY).toUpperCase(),
        metadata: {
          provider: "qcst",
          customerInputType: item.customer_input_type,
          fulfillmentMode: item.fulfillment_mode,
          availability: item.availability,
          stockType: item.stock_type,
          minQuantity: item.min_quantity,
          maxQuantity: item.max_quantity,
          warranty: item.warranty,
          nameEn: item.name_en,
        },
      });
    }

    return products;
  } catch (error) {
    throw new Error(`QCST products fetch failed: ${extractErrorMessage(error)}`);
  }
}

export async function purchaseFromQcst(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  const http = client(credentials);
  const quantity = Math.max(1, Number(input.quantity) || 1);
  const anyInput = input as unknown as Record<string, unknown>;
  const clientOrderId = String(
    input.clientOrderCode || anyInput.orderId || `ORD-QCST-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  ).trim();

  let customerInputs: string[] = [];
  if (Array.isArray(anyInput.customerInputs) && anyInput.customerInputs.length > 0) {
    customerInputs = (anyInput.customerInputs as unknown[])
      .map((item: unknown) => String(item || "").trim())
      .filter(Boolean);
  } else if (input.customerEmail) {
    customerInputs = [String(input.customerEmail).trim()];
  } else if (input.targetLink) {
    customerInputs = [String(input.targetLink).trim()];
  } else if (input.comments) {
    customerInputs = [String(input.comments).trim()];
  } else if (anyInput.account) {
    customerInputs = [String(anyInput.account).trim()];
  }

  try {
    const payload = {
      client_order_id: clientOrderId,
      product_id: String(input.productId).trim(),
      quantity,
      customer_inputs: customerInputs,
      locale: "vi",
    };

    const response = await http.post("/v1/orders", payload, {
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": clientOrderId,
      },
      signal: AbortSignal.timeout(getTimeout(credentials)),
    });

    const data = response.data || {};

    if (data.success === false) {
      const msg = String(data.detail || data.message || "QCST purchase failed.");
      return {
        success: false,
        deliveredText: null,
        outOfStock: isOutOfStockError(msg),
        pending: false,
        message: msg,
        rawPayload: data,
      };
    }

    const orderData = data.data || {};
    const orderId = String(orderData.id || "").trim();
    let status = String(orderData.status || "").toUpperCase();
    let deliveredText = formatQcstDelivery(orderData.delivery);

    // If order is PENDING or PROCESSING, poll order status up to 3 times (with 2s intervals)
    if ((status === "PENDING" || status === "PROCESSING") && !deliveredText && orderId) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const pollRes = await http.get(`/v1/orders/${encodeURIComponent(orderId)}`);
          const pollData = pollRes.data?.data || {};
          status = String(pollData.status || "").toUpperCase();
          const polledDelivery = formatQcstDelivery(pollData.delivery);
          if (polledDelivery) {
            deliveredText = polledDelivery;
            break;
          }
          if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED") {
            break;
          }
        } catch {
          // Ignore transient polling error
        }
      }
    }

    if (status === "COMPLETED" || (deliveredText && status !== "FAILED" && status !== "CANCELLED")) {
      return {
        success: true,
        deliveredText: deliveredText || null,
        outOfStock: false,
        pending: false,
        providerOrderId: orderId || null,
        providerOrderCode: orderData.client_order_id || clientOrderId,
        rawPayload: data,
        message: "Đặt hàng thành công qua QCST",
      };
    }

    if (status === "PENDING" || status === "PROCESSING") {
      return {
        success: false,
        deliveredText: null,
        outOfStock: false,
        pending: true,
        providerOrderId: orderId || null,
        providerOrderCode: orderData.client_order_id || clientOrderId,
        rawPayload: data,
        message: "Đơn hàng đang được QCST xử lý.",
      };
    }

    const errMsg = orderData.error?.detail || orderData.error?.code || `QCST đơn hàng ở trạng thái: ${status}`;
    return {
      success: false,
      deliveredText: null,
      outOfStock: isOutOfStockError(errMsg),
      pending: false,
      providerOrderId: orderId || null,
      providerOrderCode: orderData.client_order_id || clientOrderId,
      rawPayload: data,
      message: errMsg,
    };
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
        ? "Yêu cầu mua hàng tới QCST bị quá thời gian. Đơn hàng đang được giữ lại để đối soát."
        : msg,
    };
  }
}

export async function fetchQcstOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const http = client(credentials);
  const orderId = String(input.orderId || input.orderCode || "").trim();

  if (!orderId) {
    throw new Error("Provider order id is required.");
  }

  try {
    const response = await http.get(`/v1/orders/${encodeURIComponent(orderId)}`);
    const data = response.data || {};

    if (data.success === false) {
      return {
        success: false,
        status: "failed",
        deliveredText: null,
        failureReason: data.detail || "Không tìm thấy đơn hàng trên QCST.",
        providerOrderId: orderId,
        providerOrderCode: orderId,
        pending: false,
        outOfStock: false,
        rawPayload: data,
      };
    }

    const orderData = data.data || {};
    const status = String(orderData.status || "").toUpperCase();
    const deliveredText = formatQcstDelivery(orderData.delivery);

    if (status === "COMPLETED") {
      return {
        success: true,
        status: "completed",
        deliveredText,
        failureReason: null,
        providerOrderId: String(orderData.id || orderId),
        providerOrderCode: String(orderData.client_order_id || orderId),
        pending: false,
        outOfStock: false,
        rawPayload: data,
      };
    }

    if (status === "PENDING" || status === "PROCESSING") {
      return {
        success: false,
        status: "processing",
        deliveredText: null,
        failureReason: null,
        providerOrderId: String(orderData.id || orderId),
        providerOrderCode: String(orderData.client_order_id || orderId),
        pending: true,
        outOfStock: false,
        rawPayload: data,
      };
    }

    const errMsg = orderData.error?.detail || orderData.error?.code || `Trạng thái QCST: ${status}`;
    return {
      success: false,
      status: "failed",
      deliveredText: null,
      failureReason: errMsg,
      providerOrderId: String(orderData.id || orderId),
      providerOrderCode: String(orderData.client_order_id || orderId),
      pending: false,
      outOfStock: isOutOfStockError(errMsg),
      rawPayload: data,
    };
  } catch (error) {
    const msg = extractErrorMessage(error);
    return {
      success: false,
      status: "error",
      deliveredText: null,
      failureReason: msg,
      providerOrderId: orderId,
      providerOrderCode: orderId,
      pending: false,
      outOfStock: false,
      rawPayload: axios.isAxiosError(error) ? error.response?.data : undefined,
    };
  }
}

export async function verifyQcstCredentials(
  credentials: ProviderCredentials,
): Promise<boolean> {
  try {
    const balance = await fetchQcstBalance(credentials);
    return balance.success;
  } catch {
    return false;
  }
}
