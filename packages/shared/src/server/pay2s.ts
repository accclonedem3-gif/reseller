import axios from "axios";
import { createHmac } from "node:crypto";

const PAY2S_API_URL = process.env.PAY2S_API_URL || "https://payment.pay2s.vn/v1/gateway/api/create";

export interface Pay2sCredentials {
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  bankAccount: string;
  bankId: string;
}

export interface Pay2sBankInfo {
  bankId: string;
  accountNumber: string;
  accountName: string;
  qrUrl: string | null;
  qrBase64: string | null;
}

export interface CreatePay2sPaymentLinkInput {
  orderCode: string;          // unique request id
  orderId: string;            // platform order id
  amount: number;             // VND, integer
  description: string;        // orderInfo, 10–32 alphanumeric
  redirectUrl: string;
  ipnUrl: string;
  partnerName?: string;       // merchant display name (body only, NOT in signature)
}

export interface Pay2sPaymentLinkResult {
  checkoutUrl: string;
  qrCode: string | null;       // base64 PNG data URI
  bankInfo?: Pay2sBankInfo;
  providerResponse: unknown;
}

function buildPay2sSignature(
  payload: {
    accessKey: string;
    amount: number;
    bankAccounts: string;       // literal "Array"
    ipnUrl: string;
    orderId: string;
    orderInfo: string;
    partnerCode: string;
    redirectUrl: string;
    requestId: string;
    requestType: string;
  },
  secretKey: string,
) {
  const raw = `accessKey=${payload.accessKey}&amount=${payload.amount}&bankAccounts=${payload.bankAccounts}&ipnUrl=${payload.ipnUrl}&orderId=${payload.orderId}&orderInfo=${payload.orderInfo}&partnerCode=${payload.partnerCode}&redirectUrl=${payload.redirectUrl}&requestId=${payload.requestId}&requestType=${payload.requestType}`;
  return createHmac("sha256", secretKey).update(raw).digest("hex");
}

export async function createPay2sPaymentLink(
  credentials: Pay2sCredentials,
  input: CreatePay2sPaymentLinkInput,
): Promise<Pay2sPaymentLinkResult> {
  const requestType = "pay2s";
  const signature = buildPay2sSignature(
    {
      accessKey: credentials.accessKey,
      amount: input.amount,
      bankAccounts: "Array",
      ipnUrl: input.ipnUrl,
      orderId: input.orderId,
      orderInfo: input.description,
      partnerCode: credentials.partnerCode,
      redirectUrl: input.redirectUrl,
      requestId: input.orderCode,
      requestType,
    },
    credentials.secretKey,
  );

  const response = await axios.post(
    PAY2S_API_URL,
    {
      accessKey: credentials.accessKey,
      partnerCode: credentials.partnerCode,
      partnerName: input.partnerName || input.description,
      requestId: input.orderCode,
      amount: input.amount,
      orderId: input.orderId,
      orderInfo: input.description,
      // orderType mirrors requestType in Pay2S's documented body (not part of the signature)
      orderType: requestType,
      bankAccounts: [
        { account_number: credentials.bankAccount, bank_id: credentials.bankId },
      ],
      redirectUrl: input.redirectUrl,
      ipnUrl: input.ipnUrl,
      requestType,
      signature,
    },
    {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      timeout: 10000,
    },
  );

  const data = response.data;

  if (data?.resultCode !== 0 || !data?.payUrl) {
    throw new Error(data?.message || "Pay2s returned an invalid response.");
  }

  const firstQr = Array.isArray(data.qrList) ? data.qrList[0] : null;

  const bankInfo: Pay2sBankInfo | undefined = firstQr
    ? {
        bankId: String(firstQr.bank_id || credentials.bankId),
        accountNumber: String(firstQr.account_number || credentials.bankAccount),
        accountName: String(firstQr.account_name || ""),
        qrUrl: firstQr.qrUrl || null,
        qrBase64: firstQr.qrCode || null,
      }
    : undefined;

  return {
    checkoutUrl: data.payUrl,
    qrCode: firstQr?.qrCode || null,
    bankInfo,
    providerResponse: data,
  };
}

/**
 * Verify HMAC-SHA256 signature on a Pay2s payment-notification (IPN) payload.
 * Per Pay2s docs the IPN signature field is `m2signature`, and the raw string is (alphabetical):
 *   accessKey&amount&message&orderId&orderInfo&orderType&partnerCode&payType&requestId&responseTime&resultCode
 * (NO extraData, NO transId — those are NOT part of the signature.)
 */
export function verifyPay2sIpnSignature(
  payload: Record<string, unknown>,
  accessKey: string,
  secretKey: string,
  signatureField: "signature" | "m2signature" = "m2signature",
): boolean {
  const sigFromPayload = String(payload[signatureField] || "");
  if (!sigFromPayload) return false;

  const raw = `accessKey=${accessKey}&amount=${payload.amount}&message=${payload.message ?? ""}&orderId=${payload.orderId}&orderInfo=${payload.orderInfo}&orderType=${payload.orderType ?? ""}&partnerCode=${payload.partnerCode}&payType=${payload.payType ?? ""}&requestId=${payload.requestId}&responseTime=${payload.responseTime ?? ""}&resultCode=${payload.resultCode}`;

  const expected = createHmac("sha256", secretKey).update(raw).digest("hex");
  return expected === sigFromPayload;
}
