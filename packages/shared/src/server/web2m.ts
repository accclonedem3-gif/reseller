import axios from "axios";

export type Web2mBankCode = "vcb" | "bidv" | "acb" | "mb" | "tcb" | "ctg" | "tpb";

export interface Web2mCredentials {
  accountNumber: string;
  bankCode: Web2mBankCode | string;
  password: string;
  token: string;
}

export interface Web2mTransaction {
  id: string;
  amount: number;
  description: string;
  date: string | null;
  raw: Record<string, unknown>;
}

// VietQR BIN mapping for QR generation
export const VIETQR_BIN: Record<string, string> = {
  vcb: "970436",
  bidv: "970418",
  acb: "970416",
  mb: "970422",
  mbb: "970422",
  tcb: "970407",
  ctg: "970415",
  vietin: "970415",
  tpb: "970423",
  vpb: "970432",
  stb: "970403",
  agribank: "970405",
  vib: "970441",
  hdb: "970437",
  msb: "970426",
  shb: "970443",
  ocb: "970448",
  eib: "970431",
  scb: "970429",
  nab: "970428",
  seab: "970440",
  lpb: "970449",
};

function getWeb2mBaseUrl() {
  return process.env.WEB2M_BASE_URL || "https://api.web2m.com";
}

function buildEndpoint(bankCode: string) {
  const code = String(bankCode || "").toLowerCase();
  return `${getWeb2mBaseUrl()}/historyapi${code}v3`;
}

/**
 * Generate VietQR image URL for a transfer (used for WEB2M provider that doesn't make QR itself).
 */
export function buildVietQrImageUrl(input: {
  bankCode: string;
  accountNumber: string;
  amount: number;
  description: string;
  accountName?: string;
}): string {
  const bin = VIETQR_BIN[String(input.bankCode || "").toLowerCase()] || "";
  const base = `https://img.vietqr.io/image/${bin}-${encodeURIComponent(input.accountNumber)}-compact.png`;
  const qs = new URLSearchParams();
  qs.set("amount", String(Math.round(input.amount)));
  qs.set("addInfo", input.description);
  if (input.accountName) qs.set("accountName", input.accountName);
  return `${base}?${qs.toString()}`;
}

/**
 * Fetch recent transactions from Web2m. Field names defensively normalized
 * since Web2m response shape varies per bank.
 */
export async function fetchWeb2mTransactions(
  credentials: Web2mCredentials,
): Promise<Web2mTransaction[]> {
  if (!credentials.accountNumber || !credentials.password || !credentials.token) {
    throw new Error("Web2m credentials incomplete.");
  }

  const url = buildEndpoint(credentials.bankCode);
  const response = await axios.get(url, {
    params: {
      stk: credentials.accountNumber,
      password: credentials.password,
      token: credentials.token,
    },
    timeout: 15000,
  });

  const data = response.data;
  if (!data || (data.success === false && data.status !== true) || (data.status === false && data.success !== true)) {
    throw new Error(data?.message || data?.msg || "Web2m returned error.");
  }

  const list: unknown[] =
    (Array.isArray(data.transactions) && data.transactions) ||
    (Array.isArray(data.data) && data.data) ||
    (Array.isArray(data.history) && data.history) ||
    (Array.isArray(data) && data) ||
    [];

  return list.map((item, idx) => {
    const raw = item as Record<string, unknown>;
    const amount = Number(
      raw.amount ?? raw.value ?? raw.money ?? raw.creditAmount ?? raw.transferAmount ?? 0,
    );
    const description = String(
      raw.description ?? raw.content ?? raw.memo ?? raw.note ?? raw.detail ?? raw.message ?? "",
    );
    const id = String(
      raw.transactionID ?? raw.transactionId ?? raw.id ?? raw.refNo ?? raw.ref ?? `${idx}-${amount}-${description.slice(0, 20)}`,
    );
    const date = raw.date ? String(raw.date) : raw.transactionDate ? String(raw.transactionDate) : raw.time ? String(raw.time) : null;
    return { id, amount, description, date, raw };
  });
}
