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

const DEFAULT_BASE_URL = "https://huymai.testflighty.com/api/v1";
export function isHuyMaiBaseUrl(value?: string | null): boolean {
  return /(^|\/\/)huymai\.testflighty\.com(?=\/|$)/i.test(String(value || ""));
}
export function isHuyMaiKey(value?: string | null): boolean {
  return /^hmk_[A-Za-z0-9_-]+$/.test(String(value || "").trim());
}
export function isHuyMaiProvider(value: {
  baseUrl?: string | null;
  buyerKey?: string | null;
}): boolean {
  return isHuyMaiBaseUrl(value.baseUrl) || isHuyMaiKey(value.buyerKey);
}
function client(credentials: ProviderCredentials): AxiosInstance {
  if (!credentials.buyerKey) throw new Error("HuyMai API key is missing.");
  const raw = String(credentials.baseUrl || "").replace(/\/+$/, "");
  const baseURL = isHuyMaiBaseUrl(raw)
    ? /\/api\/v1$/i.test(raw)
      ? raw
      : `${raw}/api/v1`
    : DEFAULT_BASE_URL;
  const timeout = Number(credentials.timeoutMs || 15000);
  return axios.create({
    baseURL,
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 15000,
    headers: {
      Authorization: `Bearer ${credentials.buyerKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}
function rows(data: any): any[] {
  if (Array.isArray(data)) return data;
  const result = data?.products ?? data?.data?.products ?? data?.data;
  return Array.isArray(result) ? result : [];
}
function delivery(accounts: unknown): string | null {
  if (!Array.isArray(accounts)) return null;
  const output = accounts
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (!value || typeof value !== "object") return "";
      const item = value as Record<string, unknown>;
      const preferred = [
        "account",
        "username",
        "email",
        "password",
        "token",
        "extra",
      ]
        .map((key) => String(item[key] ?? "").trim())
        .filter(Boolean);
      return (
        preferred.length
          ? preferred
          : Object.values(item).map(String).filter(Boolean)
      ).join(" | ");
    })
    .filter(Boolean);
  return output.length ? output.join("\n\n") : null;
}
function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error))
    return String(
      error.response?.data?.message ||
        error.response?.data?.error ||
        error.message,
    );
  return error instanceof Error ? error.message : "HuyMai request failed.";
}
function isOutOfStock(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const message = errorMessage(error).toLowerCase();
  return (
    [409, 410, 422].includes(Number(error.response?.status)) ||
    /het hang|out of stock|khong du ton/.test(message)
  );
}
export async function fetchHuyMaiProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const { data } = await client(credentials).get("/products");
  return rows(data)
    .map((item: any) => ({
      externalId: String(item.id ?? item.product_id ?? ""),
      sourceName: String(item.name ?? item.product_name ?? "Untitled product"),
      sourceRawName:
        String(item.name ?? item.product_name ?? "").trim() || null,
      description: String(item.description ?? "").trim() || null,
      rawDescription: String(item.description ?? "").trim() || null,
      price: Number(item.price ?? item.unit_price ?? 0),
      available: item.stock == null ? null : Number(item.stock),
      hidden:
        item.active === false ||
        item.enabled === false ||
        item.status === "inactive",
      isSlotProduct: false,
      requiresCustomerEmail: false,
      requiresSlotMonths: false,
      slotDurations: [],
      quantityFixed: 1,
      walletCurrency: String(item.currency || "VND").toUpperCase(),
      metadata: { ...item, provider: "huymai" },
    }))
    .filter((item: ProviderProduct) => Boolean(item.externalId));
}
export async function fetchHuyMaiBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const { data } = await client(credentials).get("/me");
  const body = data?.data ?? data;
  const balance = Number(body?.balance ?? body?.wallet_balance ?? 0);
  return {
    success: true,
    walletCurrency: String(body?.currency || "VND").toUpperCase(),
    balance,
    balanceVnd: balance,
    balanceUsd: null,
    balanceText: `${balance.toLocaleString("vi-VN")} VND`,
    usdtBalance: 0,
    updatedAt: null,
    requesterName: String(body?.name ?? body?.username ?? "").trim() || null,
    requesterChatId: null,
    botSource: "huymai",
    rawPayload: data,
  };
}
export async function purchaseFromHuyMai(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  try {
    const { data } = await client(credentials).post("/buy", {
      product_id: input.productId,
      qty: input.quantity,
    });
    const body = data?.data ?? data;
    const code = String(body?.order_code ?? body?.code ?? "").trim();
    const deliveredText = delivery(body?.accounts);
    return {
      success: Boolean(code && deliveredText),
      deliveredText,
      outOfStock: false,
      pending: Boolean(code && !deliveredText),
      providerOrderId: null,
      providerOrderCode: code || null,
      rawPayload: data,
      message:
        code && !deliveredText
          ? "HuyMai order created; delivery is pending."
          : undefined,
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
export async function fetchHuyMaiOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const code = String(input.orderCode || input.orderId || "").trim();
  if (!code) throw new Error("HuyMai order code is required.");
  try {
    const { data } = await client(credentials).get(
      `/orders/${encodeURIComponent(code)}`,
    );
    const body = data?.data ?? data;
    const deliveredText = delivery(body?.accounts);
    const status = String(
      body?.status ?? (deliveredText ? "delivered" : "pending"),
    ).toLowerCase();
    const failed = ["failed", "cancelled", "canceled"].includes(status);
    return {
      success: !failed,
      status: deliveredText ? "delivered" : status,
      deliveredText,
      failureReason: failed
        ? String(body?.message || `HuyMai order ${status}.`)
        : null,
      providerOrderId: null,
      providerOrderCode: String(body?.order_code ?? code),
      pending: !failed && !deliveredText,
      outOfStock: status === "out_of_stock",
      rawPayload: data,
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      deliveredText: null,
      failureReason: errorMessage(error),
      providerOrderId: null,
      providerOrderCode: code,
      pending: false,
      outOfStock: isOutOfStock(error),
      rawPayload: axios.isAxiosError(error) ? error.response?.data : null,
      message: errorMessage(error),
    };
  }
}
