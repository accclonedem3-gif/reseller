import axios, { AxiosInstance } from "axios";
import { createHash } from "node:crypto";

import type {
  ProviderBalanceResult,
  ProviderCredentials,
  ProviderOrderStatusInput,
  ProviderOrderStatusResult,
  ProviderProduct,
  ProviderPurchaseInput,
  ProviderPurchaseResult,
} from "./provider";

const DEFAULT_BASE_URL = "https://doicard68.com";
const DEFAULT_CURRENCY = "VND";

export interface DoicardAuth {
  partnerId: string;
  partnerKey: string;
  walletNumber: string;
}

export function isDoicardBaseUrl(value?: string | null): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return (
      url.hostname.toLowerCase() === "doicard68.com" ||
      url.hostname.toLowerCase().endsWith(".doicard68.com")
    );
  } catch {
    return /(^|\/\/|\.)doicard68\.com(?::\d+)?(?=\/|$)/i.test(raw);
  }
}

export function isDoicardProvider(credentials: {
  baseUrl?: string | null;
  providerName?: string | null;
  buyerKey?: string | null;
}): boolean {
  const providerName = String(credentials.providerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (
    providerName === "doicard68" ||
    providerName === "doicard" ||
    isDoicardBaseUrl(credentials.baseUrl)
  );
}

function md5(str: string): string {
  return createHash("md5").update(str).digest("hex");
}

export function parseDoicardCredentials(buyerKey: string): DoicardAuth {
  const raw = String(buyerKey || "").trim();
  if (!raw) {
    throw new Error("Doicard68 credentials (Partner ID, Key, Wallet) are missing.");
  }

  // 1. JSON format: {"partnerId": "...", "partnerKey": "...", "walletNumber": "..."}
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const partnerId = String(
        parsed.partnerId ?? parsed.partner_id ?? parsed.id ?? "",
      ).trim();
      const partnerKey = String(
        parsed.partnerKey ?? parsed.partner_key ?? parsed.key ?? "",
      ).trim();
      const walletNumber = String(
        parsed.walletNumber ?? parsed.wallet_number ?? parsed.wallet ?? "",
      ).trim();

      if (partnerId && partnerKey) {
        return { partnerId, partnerKey, walletNumber };
      }
    } catch {
      // Fallback
    }
  }

  // 2. URL search params format: partner_id=...&partner_key=...&wallet_number=...
  if (raw.includes("=") && (raw.includes("partner_id") || raw.includes("partnerId"))) {
    try {
      const params = new URLSearchParams(raw);
      const partnerId = String(params.get("partner_id") || params.get("partnerId") || "").trim();
      const partnerKey = String(params.get("partner_key") || params.get("partnerKey") || "").trim();
      const walletNumber = String(params.get("wallet_number") || params.get("walletNumber") || "").trim();
      if (partnerId && partnerKey) {
        return { partnerId, partnerKey, walletNumber };
      }
    } catch {
      // Fallback
    }
  }

  // 3. Pipe / colon / semicolon / newline format: partner_id|partner_key|wallet_number
  const parts = raw.split(/[|:\n;,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      partnerId: parts[0] || "",
      partnerKey: parts[1] || "",
      walletNumber: parts[2] || "",
    };
  }

  // If only 1 part provided, assume it's partner_id or partner_key
  return {
    partnerId: parts[0] || "",
    partnerKey: parts[0] || "",
    walletNumber: "",
  };
}

function getTimeout(credentials: ProviderCredentials, fallback = 30000): number {
  const timeout = Number(credentials.timeoutMs || fallback);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function client(credentials: ProviderCredentials): AxiosInstance {
  const raw = String(credentials.baseUrl || "").replace(/\/+$/, "");
  const baseURL = raw || DEFAULT_BASE_URL;

  return axios.create({
    baseURL,
    timeout: getTimeout(credentials),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

function formatMoneyVnd(num: number): string {
  return `${Number(num || 0).toLocaleString("vi-VN")} đ`;
}

interface DoicardProductItem {
  name: string;
  slug: string;
  service_code: string;
  image?: string;
  imgurl?: string;
  cardvalue: Array<{
    id: number | string;
    service_code?: string;
    value: number;
    discount?: string | number;
  }>;
}

export async function fetchDoicardStockQuantities(
  baseURL: string,
  slugs: string[] = [],
  timeoutMs = 8000,
): Promise<Map<string | number, number>> {
  const stockMap = new Map<string | number, number>();
  const base = String(baseURL || "").replace(/\/+$/, "") || DEFAULT_BASE_URL;

  // Any /card/<slug> page contains the full softcardProducts array with all categories and their items.
  const candidateSlugs = Array.from(
    new Set([...slugs, "the-viettel", "the-vinaphone", "the-garena", "the-zing"]),
  ).filter(Boolean);

  for (const slug of candidateSlugs) {
    try {
      const pageUrl = `${base}/card/${slug}`;
      const response = await axios.get(pageUrl, {
        timeout: timeoutMs,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (
        typeof response.data === "string" &&
        response.data.includes("softcardProducts")
      ) {
        const match = response.data.match(
          /const\s+softcardProducts\s*=\s*(\[[\s\S]*?\]);/,
        );
        if (match && match[1]) {
          let categories: any = null;
          try {
            categories = JSON.parse(match[1]);
          } catch {
            try {
              categories = new Function(`return ${match[1]}`)();
            } catch {
              categories = null;
            }
          }

          if (Array.isArray(categories)) {
            for (const cat of categories) {
              const catSlug = String(cat.slug || "").trim();
              const items = Array.isArray(cat.items) ? cat.items : [];
              for (const it of items) {
                const stock = Number(it.stock_quantity ?? it.stock);
                if (Number.isFinite(stock)) {
                  if (it.id != null) {
                    stockMap.set(String(it.id), stock);
                    stockMap.set(Number(it.id), stock);
                  }
                  if (catSlug && it.value != null) {
                    stockMap.set(`${catSlug}_${it.value}`, stock);
                  }
                }
              }
            }
            if (stockMap.size > 0) {
              break;
            }
          }
        }
      }
    } catch {
      continue;
    }
  }

  return stockMap;
}

export async function fetchDoicardProducts(
  credentials: ProviderCredentials,
): Promise<ProviderProduct[]> {
  const auth = parseDoicardCredentials(credentials.buyerKey);
  const http = client(credentials);

  const response = await http.get("/api/cardws/products", {
    params: {
      partner_id: auth.partnerId,
    },
  });

  const list = Array.isArray(response.data) ? (response.data as DoicardProductItem[]) : [];
  const products: ProviderProduct[] = [];

  const baseURL = String(credentials.baseUrl || "").replace(/\/+$/, "") || DEFAULT_BASE_URL;
  const slugs = list.map((item) => item.slug).filter(Boolean);
  const stockMap = await fetchDoicardStockQuantities(baseURL, slugs).catch(
    () => new Map<string | number, number>(),
  );

  for (const item of list) {
    const serviceCode = String(item.service_code || item.slug || "").trim();
    const serviceName = String(item.name || serviceCode).trim();
    const image = item.imgurl || item.image || null;
    const isGameCard = /garena|zing|vcoin|scoin|gate|funcard/i.test(serviceCode);

    const values = Array.isArray(item.cardvalue) ? item.cardvalue : [];
    for (const cv of values) {
      const denom = Number(cv.value);
      if (!Number.isFinite(denom) || denom <= 0) continue;

      const discountPercent = Number((cv as any).discount || 0);
      const costPrice = discountPercent > 0
        ? Math.round(denom * (1 - discountPercent / 100))
        : denom;

      let available = 99;
      if (cv.id != null && stockMap.has(cv.id)) {
        available = stockMap.get(cv.id)!;
      } else if (cv.id != null && stockMap.has(String(cv.id))) {
        available = stockMap.get(String(cv.id))!;
      } else if (item.slug && stockMap.has(`${item.slug}_${denom}`)) {
        available = stockMap.get(`${item.slug}_${denom}`)!;
      } else if (stockMap.size > 0) {
        available = 0;
      }

      const externalId = `${serviceCode}_${denom}`;
      const denomFormatted = formatMoneyVnd(denom);
      const displayName = `${serviceName} ${denomFormatted}`;

      products.push({
        externalId,
        sourceName: displayName,
        sourceRawName: `${serviceName} ${denom}`,
        description: `Thẻ cào điện tử ${serviceName} mệnh giá ${denomFormatted}. Giao mã thẻ (PIN) và Serial tự động sau khi thanh toán.`,
        rawDescription: null,
        price: costPrice,
        available,
        hidden: false,
        isSlotProduct: false,
        requiresCustomerEmail: false,
        requiresSlotMonths: false,
        slotDurations: [],
        quantityFixed: 1,
        walletCurrency: DEFAULT_CURRENCY,
        metadata: {
          provider: "doicard68",
          delivery_mode: "instant_items",
          service_code: serviceCode,
          value: denom,
          face_value: denom,
          discount_percent: discountPercent,
          cost_price: costPrice,
          card_id: cv.id,
          category: isGameCard ? "THE_GAME" : "THE_DIEN_THOAI",
          image_url: image,
          slug: item.slug,
          stock_quantity: available,
        },
      });
    }
  }

  return products;
}

export async function fetchDoicardBalance(
  credentials: ProviderCredentials,
): Promise<ProviderBalanceResult> {
  const auth = parseDoicardCredentials(credentials.buyerKey);
  const http = client(credentials);

  const command = "getbalance";
  const sign = md5(auth.partnerKey + auth.partnerId + command);

  try {
    const response = await http.post("/api/cardws", {
      command,
      partner_id: auth.partnerId,
      wallet_number: auth.walletNumber || undefined,
      sign,
    });

    const data = response.data || {};
    if (data.status === 108 || (data.status !== 1 && data.balance === undefined)) {
      try {
        const rechargewsRes = await http.post("/api/rechargews", {
          command,
          partner_id: auth.partnerId,
          wallet_number: auth.walletNumber || undefined,
          sign,
        });
        if (
          rechargewsRes.data?.status === "success" &&
          rechargewsRes.data?.data?.balance !== undefined
        ) {
          const bal = Number(rechargewsRes.data.data.balance || 0);
          const curr = String(rechargewsRes.data.data.currency || DEFAULT_CURRENCY);
          return {
            success: true,
            walletCurrency: curr,
            balance: bal,
            balanceVnd: bal,
            balanceUsd: null,
            balanceText: formatMoneyVnd(bal),
            usdtBalance: 0,
            updatedAt: new Date().toISOString(),
            requesterName: null,
            requesterChatId: null,
            botSource: null,
            rawPayload: rechargewsRes.data,
          };
        }
      } catch {
        // Continue with original status 108 handling
      }

      if (data.status === 108) {
        return {
          success: false,
          walletCurrency: DEFAULT_CURRENCY,
          balance: 0,
          balanceVnd: 0,
          balanceUsd: null,
          balanceText: "Tài khoản chưa kích hoạt module Softcard (Lỗi 108)",
          usdtBalance: 0,
          updatedAt: new Date().toISOString(),
          requesterName: null,
          requesterChatId: null,
          botSource: null,
          rawPayload: data,
        };
      }
    }

    const balanceNum = Number(data.balance ?? data.amount ?? 0);
    return {
      success: true,
      walletCurrency: String(data.currency_code || DEFAULT_CURRENCY),
      balance: balanceNum,
      balanceVnd: balanceNum,
      balanceUsd: null,
      balanceText: formatMoneyVnd(balanceNum),
      usdtBalance: 0,
      updatedAt: new Date().toISOString(),
      requesterName: null,
      requesterChatId: null,
      botSource: null,
      rawPayload: data,
    };
  } catch (error: any) {
    const msg = error.response?.data?.message || error.message || "Failed to fetch balance from Doicard68";
    return {
      success: false,
      walletCurrency: DEFAULT_CURRENCY,
      balance: 0,
      balanceVnd: 0,
      balanceUsd: null,
      balanceText: msg,
      usdtBalance: 0,
      updatedAt: new Date().toISOString(),
      requesterName: null,
      requesterChatId: null,
      botSource: null,
      rawPayload: error.response?.data || null,
    };
  }
}

export async function purchaseFromDoicard(
  credentials: ProviderCredentials,
  input: ProviderPurchaseInput,
): Promise<ProviderPurchaseResult> {
  const auth = parseDoicardCredentials(credentials.buyerKey);
  const http = client(credentials);

  // Parse service_code and value from externalId (e.g., "Viettel_50000" -> serviceCode: "Viettel", value: 50000)
  let serviceCode = "";
  let value = 0;

  const idParts = String(input.productId || "").split("_");
  if (idParts.length >= 2) {
    serviceCode = idParts[0] || "";
    value = Number(idParts[1]) || 0;
  } else {
    serviceCode = input.productId;
  }

  const requestId =
    String(input.clientOrderCode || "").trim() ||
    `CARD_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const command = "buycard";
  const sign = md5(auth.partnerKey + auth.partnerId + command + requestId);

  try {
    const response = await http.post("/api/cardws", {
      command,
      partner_id: auth.partnerId,
      request_id: requestId,
      service_code: serviceCode,
      value,
      qty: input.quantity || 1,
      wallet_number: auth.walletNumber || undefined,
      sign,
    });

    const data = response.data || {};
    const status = Number(data.status);

    // Status 1: Success
    if (status === 1) {
      const cardData = data.data || {};
      const cards = Array.isArray(cardData.cards) ? cardData.cards : [];
      const orderCode = String(cardData.order_code || requestId);

      let deliveredText = "";
      if (cards.length > 0) {
        deliveredText = cards
          .map((card: any, idx: number) => {
            const prefix = cards.length > 1 ? `[Thẻ ${idx + 1}]\n` : "";
            const name = card.name ? `Loại thẻ: ${card.name}\n` : "";
            const pin = card.code ? `Mã nạp (PIN): ${card.code}\n` : "";
            const serial = card.serial ? `Số Serial: ${card.serial}\n` : "";
            const expired = card.expired ? `Hạn dùng: ${card.expired}` : "";
            return `${prefix}${name}${pin}${serial}${expired}`.trim();
          })
          .join("\n\n────────────────\n\n");
      } else {
        deliveredText = `Đơn mua thẻ ${serviceCode} (${formatMoneyVnd(value)}) thành công.\nMã đơn: ${orderCode}`;
      }

      return {
        success: true,
        deliveredText,
        outOfStock: false,
        pending: false,
        providerOrderId: orderCode,
        providerOrderCode: requestId,
        rawPayload: data,
      };
    }

    // Status 2: Pending
    if (status === 2) {
      const cardData = data.data || {};
      const orderCode = String(cardData.order_code || requestId);
      return {
        success: true,
        deliveredText: null,
        outOfStock: false,
        pending: true,
        providerOrderId: orderCode,
        providerOrderCode: requestId,
        rawPayload: data,
        message: data.message || "Đơn hàng mua thẻ đang chờ xử lý từ Doicard68.",
      };
    }

    // Out of stock or supplier error
    const isOut = status === 118 || status === 130 || /hết|het|stock/i.test(data.message || "");
    return {
      success: false,
      deliveredText: null,
      outOfStock: isOut,
      pending: false,
      rawPayload: data,
      message: data.message || `Doicard68 error status ${status}`,
    };
  } catch (error: any) {
    const data = error.response?.data;
    const msg = data?.message || error.message || "Doicard68 purchase request failed.";
    const status = Number(data?.status || error.response?.status);
    const isOut = status === 118 || status === 130 || /hết|het|stock/i.test(msg);

    return {
      success: false,
      deliveredText: null,
      outOfStock: isOut,
      pending: false,
      rawPayload: data,
      message: msg,
    };
  }
}

export async function fetchDoicardOrderStatus(
  credentials: ProviderCredentials,
  input: ProviderOrderStatusInput,
): Promise<ProviderOrderStatusResult> {
  const auth = parseDoicardCredentials(credentials.buyerKey);
  const http = client(credentials);

  const requestId = String(input.orderCode || input.orderId || "").trim();
  if (!requestId) {
    throw new Error("Order reference (request_id) is required for Doicard68 status check.");
  }

  const command = "redownload";
  const sign = md5(auth.partnerKey + auth.partnerId + command + requestId);

  try {
    const response = await http.post("/api/cardws", {
      command,
      partner_id: auth.partnerId,
      request_id: requestId,
      sign,
    });

    const data = response.data || {};
    const status = Number(data.status);

    if (status === 1) {
      const cardData = data.data || {};
      const cards = Array.isArray(cardData.cards) ? cardData.cards : [];
      const orderCode = String(cardData.order_code || requestId);

      let deliveredText = "";
      if (cards.length > 0) {
        deliveredText = cards
          .map((card: any, idx: number) => {
            const prefix = cards.length > 1 ? `[Thẻ ${idx + 1}]\n` : "";
            const name = card.name ? `Loại thẻ: ${card.name}\n` : "";
            const pin = card.code ? `Mã nạp (PIN): ${card.code}\n` : "";
            const serial = card.serial ? `Số Serial: ${card.serial}\n` : "";
            const expired = card.expired ? `Hạn dùng: ${card.expired}` : "";
            return `${prefix}${name}${pin}${serial}${expired}`.trim();
          })
          .join("\n\n────────────────\n\n");
      } else {
        deliveredText = `Đơn hàng ${orderCode} hoàn tất.`;
      }

      return {
        success: true,
        status: "delivered",
        deliveredText,
        failureReason: null,
        providerOrderId: orderCode,
        providerOrderCode: orderCode,
        pending: false,
        outOfStock: false,
        rawPayload: data,
      };
    }

    if (status === 2) {
      return {
        success: true,
        status: "pending",
        deliveredText: null,
        failureReason: null,
        providerOrderId: requestId,
        providerOrderCode: requestId,
        pending: true,
        outOfStock: false,
        rawPayload: data,
      };
    }

    return {
      success: false,
      status: null,
      deliveredText: null,
      failureReason: data.message || `Status ${status}`,
      providerOrderId: requestId,
      providerOrderCode: requestId,
      pending: false,
      outOfStock: status === 118 || status === 130,
      rawPayload: data,
      message: data.message,
    };
  } catch (error: any) {
    const data = error.response?.data;
    const msg = data?.message || error.message || "Doicard68 order status request failed.";
    return {
      success: false,
      status: null,
      deliveredText: null,
      failureReason: msg,
      providerOrderId: requestId,
      providerOrderCode: requestId,
      pending: false,
      outOfStock: false,
      rawPayload: data,
      message: msg,
    };
  }
}
