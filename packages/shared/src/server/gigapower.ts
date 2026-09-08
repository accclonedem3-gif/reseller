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

const DEFAULT_BASE_URL = "http://gigapower.top:5000";
const DEFAULT_ACCOUNT_TYPE = "normal";
const CATALOG_LIMIT = 100;
const WALLET_CURRENCY = "VND";

interface GigaPowerAuth {
  user: string;
  pass: string;
}

export function isGigaPowerBaseUrl(value?: string | null): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;

  try {
    return new URL(raw).hostname.toLowerCase() === "gigapower.top";
  } catch {
    return /(^|\/\/)gigapower\.top(?=[:/]|$)/i.test(raw);
  }
}

export function isGigaPowerProvider(credentials: {
  baseUrl?: string | null;
  providerName?: string | null;
}): boolean {
  const providerName = String(credentials.providerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (
    providerName === "gigapower" || isGigaPowerBaseUrl(credentials.baseUrl)
  );
}

function authFromParams(raw: string): GigaPowerAuth | null {
  try {
    const params = raw.includes("://")
      ? new URL(raw).searchParams
      : new URLSearchParams(raw.replace(/^\?/, ""));
    const user = String(params.get("user") || "").trim();
    const pass = String(params.get("pass") || "").trim();
    return user && pass ? { user, pass } : null;
  } catch {
    return null;
  }
}

export function parseGigaPowerCredentials(buyerKey: string): GigaPowerAuth {
  const raw = String(buyerKey || "").trim();
  if (!raw) {
    throw new Error("GigaPower credentials are missing.");
  }

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const user = String(parsed.user ?? parsed.username ?? "").trim();
      const pass = String(parsed.pass ?? parsed.password ?? "").trim();
      if (user && pass) return { user, pass };
    } catch {
      // Continue to the human-friendly formats below.
    }
  }

  const fromParams = authFromParams(raw);
  if (fromParams) return fromParams;

  const separatorIndexes = [":", "|", "\n"]
    .map((separator) => raw.indexOf(separator))
    .filter((index) => index > 0);
  const separatorIndex = Math.min(...separatorIndexes);
  if (Number.isFinite(separatorIndex)) {
    const user = raw.slice(0, separatorIndex).trim();
    const pass = raw.slice(separatorIndex + 1).trim();
    if (user && pass) return { user, pass };
  }

  throw new Error(
    "GigaPower credentials must use the username:password format.",
  );
}

function getTimeout(credentials: ProviderCredentials, fallback = 15_000) {
  const timeout = Number(credentials.timeoutMs || fallback);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function client(
  credentials: ProviderCredentials,
  perRequestTimeout?: number,
): AxiosInstance {
  const raw = String(credentials.baseUrl || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const baseURL = raw.replace(/\/api$/i, "") || DEFAULT_BASE_URL;
  return axios.create({
    baseURL,
    timeout: perRequestTimeout ?? getTimeout(credentials),
    headers: { Accept: "application/json" },
  });
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function messageFromPayload(payload: unknown, fallback: string): string {
  const body = record(payload);
  return String(body.error || body.message || body.desc || fallback).trim();
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return messageFromPayload(
      error.response?.data,
      error.message || "GigaPower request failed.",
    );
  }
  return error instanceof Error ? error.message : "GigaPower request failed.";
}

function isAlreadySold(payload: unknown, statusCode?: number): boolean {
  const message = messageFromPayload(payload, "").toLowerCase();
  return (
    [404, 409, 410].includes(Number(statusCode)) ||
    message.includes("already sold") ||
    message.includes("account is sold") ||
    message.includes("out of stock")
  );
}

function formatDelivery(payload: unknown): string | null {
  const body = record(payload);
  const credentials = record(body.credentials);
  const username = String(
    credentials.username ?? credentials.user ?? credentials.account ?? "",
  ).trim();
  const password = String(
    credentials.password ?? credentials.pass ?? credentials.pwd ?? "",
  ).trim();

  if (username && password) return `${username} | ${password}`;

  const accountInfo = String(
    body.account_info ?? body.accountInfo ?? "",
  ).trim();
  if (accountInfo) return accountInfo;
  return [username, password].filter(Boolean).join(" | ") || null;
}

export async function fetchGigaPowerProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const auth = parseGigaPowerCredentials(credentials.buyerKey);
  const { data } = await client(credentials).get("/api/accounts/available", {
    params: {
      ...auth,
      type: DEFAULT_ACCOUNT_TYPE,
      limit: CATALOG_LIMIT,
    },
  });

  if (data?.success !== true || !Array.isArray(data?.accounts)) {
    throw new Error(
      messageFromPayload(data, "GigaPower returned an invalid account list."),
    );
  }

  return data.accounts
    .map((value: unknown): ProviderProduct | null => {
      const item = record(value);
      const id = String(item.id ?? item.account_id ?? "").trim();
      const price = Number(item.price);
      if (!id || !Number.isFinite(price) || price < 0) return null;

      const name = String(item.display_name ?? item.name ?? id).trim() || id;
      const description = String(item.description ?? "").trim();
      return {
        externalId: id,
        sourceName: name,
        sourceRawName: name,
        description: description || null,
        rawDescription: description || null,
        price,
        available: 1,
        hidden: false,
        isSlotProduct: false,
        requiresCustomerEmail: false,
        requiresSlotMonths: false,
        slotDurations: [],
        quantityFixed: 1,
        walletCurrency: WALLET_CURRENCY,
        metadata: {
          ...item,
          provider: "gigapower",
          uniqueAccount: true,
        },
      };
    })
    .filter((item: ProviderProduct | null): item is ProviderProduct =>
      Boolean(item),
    );
}

export async function fetchGigaPowerBalance(
  _credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  throw new Error("GigaPower does not expose a balance lookup endpoint.");
}

export async function purchaseFromGigaPower(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  if (input.quantity !== 1) {
    return {
      success: false,
      deliveredText: null,
      outOfStock: false,
      pending: false,
      message: "GigaPower accounts can only be purchased one at a time.",
    };
  }

  const accountId = String(input.productId || "").trim();
  if (!accountId) {
    return {
      success: false,
      deliveredText: null,
      outOfStock: false,
      pending: false,
      message: "GigaPower account id is missing.",
    };
  }

  let auth: GigaPowerAuth;
  try {
    auth = parseGigaPowerCredentials(credentials.buyerKey);
  } catch (error) {
    return {
      success: false,
      deliveredText: null,
      outOfStock: false,
      pending: false,
      message: errorMessage(error),
    };
  }

  const timeout = getTimeout(credentials, 120_000);
  try {
    const { data } = await client(credentials, timeout).get(
      "/api/buy_account",
      {
        params: { ...auth, account_id: accountId },
        signal: AbortSignal.timeout(timeout),
      },
    );

    if (data?.success !== true) {
      return {
        success: false,
        deliveredText: null,
        outOfStock: isAlreadySold(data),
        pending: false,
        providerOrderId: null,
        providerOrderCode: null,
        rawPayload: data,
        message: messageFromPayload(data, "GigaPower purchase failed."),
      };
    }

    const deliveredText = formatDelivery(data);
    return {
      success: Boolean(deliveredText),
      deliveredText,
      outOfStock: false,
      pending: !deliveredText,
      providerOrderId:
        String(data?.account_id ?? accountId).trim() || accountId,
      providerOrderCode: null,
      rawPayload: data,
      message: deliveredText
        ? undefined
        : "GigaPower charged the purchase but returned no credentials; manual review is required.",
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const statusCode = Number(error.response?.status);
      const outOfStock = isAlreadySold(error.response?.data, statusCode);
      const definitelyRejected =
        Boolean(error.response) && statusCode >= 400 && statusCode < 500;
      return {
        success: false,
        deliveredText: null,
        outOfStock,
        // This purchase endpoint has no idempotency key or order lookup. A
        // transport/5xx failure can therefore be a completed purchase whose
        // response was lost. Hold it for manual review instead of retrying.
        pending: !outOfStock && !definitelyRejected,
        providerOrderId: !definitelyRejected ? accountId : null,
        providerOrderCode: null,
        rawPayload: error.response?.data,
        message:
          !outOfStock && !definitelyRejected
            ? "GigaPower purchase result is uncertain; do not retry automatically. Manual review is required."
            : errorMessage(error),
      };
    }

    return {
      success: false,
      deliveredText: null,
      outOfStock: false,
      pending: false,
      message: errorMessage(error),
    };
  }
}

export async function fetchGigaPowerOrderStatus(
  _credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  return {
    success: false,
    status: null,
    deliveredText: null,
    failureReason: "GigaPower does not expose an order lookup endpoint.",
    providerOrderId: input.orderId || null,
    providerOrderCode: input.orderCode || null,
    pending: true,
    outOfStock: false,
    rawPayload: null,
    message: "GigaPower purchase status requires manual review.",
  };
}
