import axios from "axios";
import { createHmac } from "node:crypto";

const PAYOS_API_URL = "https://api-merchant.payos.vn/v2/payment-requests";
const PAYOS_TIMEOUT_MS = Math.max(5000, Number(process.env.PAYOS_HTTP_TIMEOUT_MS || 20000));
const PAYOS_MAX_ATTEMPTS = 3;

/**
 * Bounded retry for TRANSIENT PayOS failures (mirrors the Telegram client). PayOS occasionally
 * lags past the timeout; a single try with no retry surfaces that as a hard error.
 * - 5xx / 429 → PayOS did NOT process the request → always safe to retry.
 * - timeout / network (ECONNABORTED, no response) → AMBIGUOUS (request may have landed). Only retry
 *   when `retryOnNetwork` is true — safe for idempotent GET (status check), NOT for the create-link
 *   POST (retrying could hit "orderCode already exists" if the first request actually went through).
 * 4xx / business errors are deterministic → never retried.
 */
async function payosRequestWithRetry<T>(
  doRequest: () => Promise<T>,
  opts: { retryOnNetwork: boolean },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= PAYOS_MAX_ATTEMPTS; attempt++) {
    try {
      return await doRequest();
    } catch (err) {
      lastErr = err;
      const e = err as { response?: { status?: number }; code?: string };
      const status = e?.response?.status;
      const isServer5xx = typeof status === "number" && status >= 500;
      const isRateLimited = status === 429;
      const isNetworkOrTimeout = e?.code === "ECONNABORTED" || !e?.response;
      const transient = isServer5xx || isRateLimited || (opts.retryOnNetwork && isNetworkOrTimeout);
      if (attempt >= PAYOS_MAX_ATTEMPTS || !transient) throw err;
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** (attempt - 1), 3000)));
    }
  }
  throw lastErr;
}

export interface PayOSCredentials {
  clientId: string;
  apiKey: string;
  checksumKey: string;
}

export interface CreatePaymentLinkInput {
  orderCode: number;
  amount: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  expiredAt?: number;
}

export interface PayOSBankInfo {
  accountNumber: string;
  accountName: string;
  bin: string;
  description: string;
}

export interface PaymentLinkResult {
  checkoutUrl: string;
  qrCode: string;
  providerResponse: unknown;
  bankInfo?: PayOSBankInfo;
}

export interface PaymentLinkStatusResult {
  orderCode: string;
  paymentLinkId: string | null;
  status: string;
  amount: number;
  amountPaid: number;
  providerResponse: unknown;
}

function sortObjectByKey(input: Record<string, unknown>) {
  return Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = input[key];
      return result;
    }, {});
}

function convertObjectToQueryString(input: Record<string, unknown>) {
  return Object.keys(input)
    .filter((key) => input[key] !== undefined)
    .map((key) => {
      let value = input[key];

      if (Array.isArray(value)) {
        value = JSON.stringify(
          value.map((item) => {
            if (item && typeof item === "object" && !Array.isArray(item)) {
              return sortObjectByKey(item as Record<string, unknown>);
            }

            return item;
          }),
        );
      }

      if ([null, undefined, "undefined", "null"].includes(value as never)) {
        value = "";
      }

      return `${key}=${String(value)}`;
    })
    .join("&");
}

export function buildPayOSSignature(
  payload: Record<string, unknown>,
  checksumKey: string,
) {
  const sortedPayload = sortObjectByKey(payload);
  const queryString = convertObjectToQueryString(sortedPayload);
  return createHmac("sha256", checksumKey).update(queryString).digest("hex");
}

export async function createPayOSPaymentLink(
  credentials: PayOSCredentials,
  input: CreatePaymentLinkInput,
): Promise<PaymentLinkResult> {
  const signature = buildPayOSSignature(
    {
      amount: input.amount,
      cancelUrl: input.cancelUrl,
      description: input.description,
      orderCode: input.orderCode,
      returnUrl: input.returnUrl,
    },
    credentials.checksumKey,
  );

  const response = await payosRequestWithRetry(
    () =>
      axios.post(
        PAYOS_API_URL,
        {
          orderCode: input.orderCode,
          amount: input.amount,
          description: input.description,
          returnUrl: input.returnUrl,
          cancelUrl: input.cancelUrl,
          expiredAt: input.expiredAt,
          signature,
        },
        {
          headers: {
            "x-client-id": credentials.clientId,
            "x-api-key": credentials.apiKey,
            "Content-Type": "application/json",
          },
          timeout: PAYOS_TIMEOUT_MS,
        },
      ),
    { retryOnNetwork: false }, // POST: don't retry on timeout — could duplicate the orderCode
  );

  const data = response.data?.data;

  if (
    response.data?.code !== "00" ||
    !data?.checkoutUrl ||
    !data?.qrCode
  ) {
    throw new Error(response.data?.desc || "PayOS returned an invalid response.");
  }

  const bankInfo: PayOSBankInfo | undefined =
    data.accountNumber
      ? {
          accountNumber: String(data.accountNumber || ""),
          accountName: String(data.accountName || ""),
          bin: String(data.bin || ""),
          description: String(data.description || ""),
        }
      : undefined;

  return {
    checkoutUrl: data.checkoutUrl,
    qrCode: data.qrCode,
    providerResponse: response.data,
    bankInfo,
  };
}

export async function getPayOSPaymentLinkStatus(
  credentials: PayOSCredentials,
  id: string | number,
): Promise<PaymentLinkStatusResult> {
  const response = await payosRequestWithRetry(
    () =>
      axios.get(
        `${PAYOS_API_URL}/${encodeURIComponent(String(id))}`,
        {
          headers: {
            "x-client-id": credentials.clientId,
            "x-api-key": credentials.apiKey,
            "Content-Type": "application/json",
          },
          timeout: PAYOS_TIMEOUT_MS,
        },
      ),
    { retryOnNetwork: true }, // GET status is idempotent → safe to retry on timeout/network too
  );

  const data = response.data?.data;

  if (!data || response.data?.code !== "00") {
    throw new Error(response.data?.desc || "PayOS returned an invalid payment status response.");
  }

  return {
    orderCode: String(data.orderCode || id),
    paymentLinkId: String(data.id || data.paymentLinkId || "").trim() || null,
    status: String(data.status || "UNKNOWN"),
    amount: Number(data.amount || 0),
    amountPaid: Number(data.amountPaid || 0),
    providerResponse: response.data,
  };
}

export function verifyPayOSWebhook(
  body: Record<string, unknown>,
  signature: string,
  checksumKey: string,
) {
  if (!signature || !checksumKey) {
    return false;
  }

  const expectedSignature = buildPayOSSignature(body, checksumKey);
  return expectedSignature.toLowerCase() === signature.toLowerCase();
}
