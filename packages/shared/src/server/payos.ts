import axios from "axios";
import { createHmac } from "node:crypto";

const PAYOS_API_URL = "https://api-merchant.payos.vn/v2/payment-requests";

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

export interface PaymentLinkResult {
  checkoutUrl: string;
  qrCode: string;
  providerResponse: unknown;
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

  const response = await axios.post(
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
      timeout: 10000,
    },
  );

  const data = response.data?.data;

  if (
    response.data?.code !== "00" ||
    !data?.checkoutUrl ||
    !data?.qrCode
  ) {
    throw new Error(response.data?.desc || "PayOS returned an invalid response.");
  }

  return {
    checkoutUrl: data.checkoutUrl,
    qrCode: data.qrCode,
    providerResponse: response.data,
  };
}

export async function getPayOSPaymentLinkStatus(
  credentials: PayOSCredentials,
  id: string | number,
): Promise<PaymentLinkStatusResult> {
  const response = await axios.get(
    `${PAYOS_API_URL}/${encodeURIComponent(String(id))}`,
    {
      headers: {
        "x-client-id": credentials.clientId,
        "x-api-key": credentials.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    },
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
