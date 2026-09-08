import { Prisma } from "@prisma/client";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function formatError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.message;
  }
  if (typeof AggregateError !== "undefined" && error instanceof AggregateError) {
    return error.errors
      .map((item) => formatError(item))
      .filter(Boolean)
      .join(" | ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export function normalizeManualDeliveryText(value: unknown): string | null {
  const normalized = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  return normalized || null;
}

export function unwrapManualDeliveryEnvelope(value: unknown): string {
  const normalized = String(value || "").trim();
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

export function sanitizeDeliveryEntry(value: string): string {
  return value
    .trim()
    .replace(/^[{[]+/, "")
    .replace(/[}\],;]+$/, "")
    .trim();
}

export function normalizeJsonDeliveryEntry(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry.trim() || null;
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const account = [
    record.account,
    record.email,
    record.username,
    record.user,
    record.login,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  const password = [record.password, record.pass, record.pwd]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  if (account && password) {
    return `${account} | ${password}`;
  }
  return null;
}

export function parseJsonDeliveryEntries(normalized: string): string[] {
  if (!normalized.startsWith("[")) {
    return [];
  }
  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeJsonDeliveryEntry(entry))
      .filter((entry): entry is string => Boolean(entry));
  } catch {
    return [];
  }
}

export function parseManualDeliveryEntries(value: unknown): string[] {
  const normalized = unwrapManualDeliveryEnvelope(
    normalizeManualDeliveryText(value),
  );
  if (!normalized) {
    return [];
  }
  const jsonEntries = parseJsonDeliveryEntries(normalized);
  if (jsonEntries.length > 0) {
    return jsonEntries;
  }
  return normalized
    .split("\n")
    .map((entry) => sanitizeDeliveryEntry(entry))
    .filter(Boolean);
}

export function readManualDeliveryEntries(
  metadata: { deliveryEntries?: unknown; deliveryText?: unknown } | Record<string, unknown> | null | undefined,
): string[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const meta = metadata as Record<string, unknown>;
  if (Array.isArray(meta.deliveryEntries)) {
    return meta.deliveryEntries
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }
  if (typeof meta.deliveryText === "string") {
    return parseManualDeliveryEntries(meta.deliveryText);
  }
  return [];
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function normalizeLanguage(value: unknown): "vi" | "en" {
  return String(value || "")
    .trim()
    .toLowerCase() === "en"
    ? "en"
    : "vi";
}

export function formatLocalizedDateTime(
  value: Date | number,
  language: "vi" | "en" | string = "vi",
): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export function formatVndMoney(
  value: unknown,
  language: "vi" | "en" | string = "vi",
): string {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(decimalToNumber(value));
}

export function extractTextValue(value: unknown): string | null {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

export function extractMetadataText(
  metadata: unknown,
  keys: string[],
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const normalized = extractTextValue(value);
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

export function normalizeWarrantyPhrase(value: unknown): string | null {
  const normalized = extractTextValue(value);
  if (!normalized) {
    return null;
  }
  if (/no\s*warranty|không\s*bảo\s*hành|khong\s*bao\s*hanh/i.test(normalized)) {
    return "__NO_WARRANTY__";
  }
  if (
    /full\s*warranty|bảo\s*hành\s*(full|đầy\s*đủ)|bao\s*hanh\s*(full|day\s*du)/i.test(
      normalized,
    )
  ) {
    return "__FULL_WARRANTY__";
  }
  const match = normalized.match(
    /(?:hỗ\s*trợ\s*)?(?:bảo\s*hành|bao\s*hanh|warranty|bh)\s*[:\-]?\s*([^.!,\n]+)/i,
  );
  if (match?.[1]) {
    return extractTextValue(match[1]);
  }
  if (/(bảo\s*hành|bao\s*hanh|warranty|\bbh\b)/i.test(normalized)) {
    return (
      normalized
        .replace(
          /(?:hỗ\s*trợ\s*)?(?:bảo\s*hành|bao\s*hanh|warranty|bh)\s*[:\-]?\s*/gi,
          "",
        )
        .replace(/[.!,;:]+$/g, "")
        .trim() || normalized
    );
  }
  return null;
}

export function translateWarrantyPhrase(
  value: string | null,
  language: "vi" | "en" | string = "vi",
): string {
  if (!value) {
    return language === "en"
      ? "According to product policy"
      : "Theo chính sách sản phẩm";
  }
  if (value === "__NO_WARRANTY__") {
    return language === "en" ? "No warranty" : "Không bảo hành";
  }
  if (value === "__FULL_WARRANTY__") {
    return language === "en" ? "Full warranty" : "Bảo hành đầy đủ";
  }
  let normalized = String(value);
  if (language === "en") {
    normalized = normalized
      .replace(/\b(\d+)\s*giờ\b/gi, (_match, amount) => `${amount} hours`)
      .replace(/\b(\d+)\s*gio\b/gi, (_match, amount) => `${amount} hours`)
      .replace(/\b(\d+)\s*ngày\b/gi, (_match, amount) => `${amount} days`)
      .replace(/\b(\d+)\s*ngay\b/gi, (_match, amount) => `${amount} days`)
      .replace(/\b(\d+)\s*tháng\b/gi, (_match, amount) => `${amount} months`)
      .replace(/\b(\d+)\s*thang\b/gi, (_match, amount) => `${amount} months`)
      .replace(/\b(\d+)\s*năm\b/gi, (_match, amount) => `${amount} years`)
      .replace(/\b(\d+)\s*nam\b/gi, (_match, amount) => `${amount} years`)
      .replace(/\bbảo\s*hành\b/gi, "warranty")
      .replace(/\bbao\s*hanh\b/gi, "warranty")
      .replace(/\bđầy\s*đủ\b/gi, "full")
      .replace(/\bday\s*du\b/gi, "full")
      .replace(/\bkhông\b/gi, "no")
      .replace(/\bkhong\b/gi, "no")
      .replace(/\blỗi\b/gi, "fault")
      .replace(/\bdoi\s*1\s*doi\s*1\b/gi, "1-to-1 replacement")
      .replace(/\bđổi\s*1\s*đổi\s*1\b/gi, "1-to-1 replacement");
  } else {
    normalized = normalized
      .replace(/\b(\d+)\s*hours?\b/gi, (_match, amount) => `${amount} giờ`)
      .replace(/\b(\d+)\s*days?\b/gi, (_match, amount) => `${amount} ngày`)
      .replace(/\b(\d+)\s*months?\b/gi, (_match, amount) => `${amount} tháng`)
      .replace(/\b(\d+)\s*years?\b/gi, (_match, amount) => `${amount} năm`)
      .replace(/\bno\s*warranty\b/gi, "không bảo hành")
      .replace(/\bfull\s*warranty\b/gi, "bảo hành đầy đủ")
      .replace(/\bwarranty\b/gi, "bảo hành");
  }
  return (
    extractTextValue(normalized) ||
    (language === "en"
      ? "According to product policy"
      : "Theo chính sách sản phẩm")
  );
}

export const WARRANTY_POLICY_LABELS: Record<string, { vi: string; en: string }> = {
  KBH: { vi: "Không bảo hành", en: "No warranty" },
  BH24H: { vi: "Bảo hành 24 giờ", en: "24-hour warranty" },
  BH1M: { vi: "Bảo hành 1 tháng", en: "1-month warranty" },
  BH3M: { vi: "Bảo hành 3 tháng", en: "3-month warranty" },
  BH6M: { vi: "Bảo hành 6 tháng", en: "6-month warranty" },
  BH12M: { vi: "Bảo hành 12 tháng", en: "12-month warranty" },
  BHF: { vi: "Bảo hành Full (BHF)", en: "Full warranty" },
};

export function resolveWarrantyText(input: {
  warrantyPolicy?: string | null;
  language?: string | null;
  metadata?: unknown;
  sourceDescription?: string | null;
  productName?: string | null;
}): string {
  const warrantyPolicyKey = String(input.warrantyPolicy || "").toUpperCase();
  const policy = WARRANTY_POLICY_LABELS[warrantyPolicyKey];
  if (policy) {
    const lang = input.language === "en" ? "en" : "vi";
    return policy[lang];
  }
  const metadata =
    input.metadata &&
    typeof input.metadata === "object" &&
    !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : {};
  const candidates = [
    extractMetadataText(metadata, [
      "warranty",
      "warrantyTime",
      "warrantyPeriod",
      "warranty_period",
      "warranty_time",
      "baoHanh",
      "bao_hanh",
      "baoHanhText",
      "bao_hanh_text",
      "guarantee",
      "guaranteeText",
      "guarantee_text",
      "bh",
    ]),
    input.sourceDescription,
    input.productName,
  ];
  for (const candidate of candidates) {
    const warrantyPhrase = normalizeWarrantyPhrase(candidate);
    if (warrantyPhrase) {
      return translateWarrantyPhrase(warrantyPhrase, input.language || "vi");
    }
  }
  return input.language === "en"
    ? "According to product policy"
    : "Theo chính sách sản phẩm";
}

export function normalizeSupportTelegram(value: unknown): string | null {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized;
  }
  if (normalized.startsWith("@")) {
    return normalized;
  }
  return `@${normalized}`;
}

export function normalizeSupportZalo(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function buildSupportContactLines(
  shop: { supportTelegram?: unknown; supportZalo?: unknown } | null | undefined,
  language: "vi" | "en" | string = "vi",
): string[] {
  const supportTelegram = normalizeSupportTelegram(shop?.supportTelegram);
  const supportZalo = normalizeSupportZalo(shop?.supportZalo);
  if (!supportTelegram && !supportZalo) {
    return [
      language === "en"
        ? "Support: reply in this chat if you need help."
        : "Hỗ trợ: hãy phản hồi trong chat này nếu bạn cần trợ giúp.",
    ];
  }
  const lines = [language === "en" ? "Support contact:" : "Liên hệ hỗ trợ:"];
  if (supportTelegram) {
    lines.push(
      `${language === "en" ? "Telegram" : "Telegram"}: ${supportTelegram}`,
    );
  }
  if (supportZalo) {
    lines.push(`${language === "en" ? "Zalo" : "Zalo"}: ${supportZalo}`);
  }
  return lines;
}

export function buildDeliveredAccountMessage(input: {
  metadata?: { deliveryFormatHint?: string; usageInstructions?: unknown } | null;
  language?: string | null;
  orderCode: string | number;
  productName: string;
  quantity: string | number;
  deliveredText: string;
}): string {
  const formatHint =
    typeof input.metadata?.deliveryFormatHint === "string" &&
    input.metadata.deliveryFormatHint.trim()
      ? input.metadata.deliveryFormatHint.trim()
      : null;
  const lines =
    input.language === "en"
      ? [
          "✅ Payment confirmed",
          `Order code: ${input.orderCode}`,
          `Product: ${input.productName}`,
          `Quantity: ${input.quantity}`,
          "",
          "🔐 Account information:",
          ...(formatHint
            ? [`Format: ${escapeTelegramHtml(formatHint)}`, ""]
            : []),
          `<pre>${escapeTelegramHtml(input.deliveredText)}</pre>`,
          ...(input.metadata?.usageInstructions
            ? ["", escapeTelegramHtml(String(input.metadata.usageInstructions))]
            : []),
          "",
          "A detailed bill will be sent in the next message.",
        ]
      : [
          "✅ Thanh toán đã được xác nhận",
          `Mã đơn: ${input.orderCode}`,
          `Sản phẩm: ${input.productName}`,
          `Số lượng: ${input.quantity}`,
          "",
          "🔐 Thông tin tài khoản:",
          ...(formatHint
            ? [`Format: ${escapeTelegramHtml(formatHint)}`, ""]
            : []),
          `<pre>${escapeTelegramHtml(input.deliveredText)}</pre>`,
          ...(input.metadata?.usageInstructions
            ? ["", escapeTelegramHtml(String(input.metadata.usageInstructions))]
            : []),
          "",
          "Hóa đơn chi tiết sẽ được gửi ở tin nhắn tiếp theo.",
        ];
  return lines.join("\n");
}

export function buildDeliveredBillMessage(input: {
  shop?: { supportTelegram?: unknown; supportZalo?: unknown } | null;
  language?: string | null;
  orderCode: string | number;
  productName: string;
  quantity: string | number;
  amount: unknown;
  deliveredAt: Date | number;
  sourceDescription?: string | null;
  metadata?: unknown;
}): string {
  const supportLines = buildSupportContactLines(input.shop, input.language || "vi");
  const warrantyText = resolveWarrantyText({
    productName: input.productName,
    sourceDescription: input.sourceDescription,
    metadata: input.metadata,
    language: input.language,
  });
  const lines =
    input.language === "en"
      ? [
          "🧾 Order bill",
          `Order code: ${input.orderCode}`,
          `Product: ${input.productName}`,
          `Quantity: ${input.quantity}`,
          `Paid amount: ${formatVndMoney(input.amount, input.language || "en")}`,
          `Delivered at: ${formatLocalizedDateTime(input.deliveredAt, input.language || "en")} (GMT+7)`,
          `Warranty: ${warrantyText}`,
          "",
          ...supportLines,
        ]
      : [
          "🧾 Hóa đơn đơn hàng",
          `Mã đơn: ${input.orderCode}`,
          `Sản phẩm: ${input.productName}`,
          `Số lượng: ${input.quantity}`,
          `Thanh toán: ${formatVndMoney(input.amount, input.language || "vi")}`,
          `Thời gian giao: ${formatLocalizedDateTime(input.deliveredAt, input.language || "vi")} (GMT+7)`,
          `Thời gian bảo hành: ${warrantyText}`,
          "",
          ...supportLines,
        ];
  return lines.join("\n");
}

export function buildManualPendingMessage(input: {
  shop?: { supportTelegram?: unknown; supportZalo?: unknown } | null;
  language?: string | null;
  addMail?: boolean;
  shortage?: boolean;
  orderCode: string | number;
  productName: string;
  quantity: string | number;
}): string {
  const supportLines = buildSupportContactLines(input.shop, input.language || "vi");
  const bodyLines = input.addMail
    ? input.language === "en"
      ? [
          "Your order is being activated manually by the seller.",
          "The email submitted with this order has been recorded. You do not need to send it again.",
        ]
      : [
          "Đơn hàng đang được seller xử lý kích hoạt thủ công.",
          "Email bạn đã nhập trong đơn đã được ghi nhận, bạn không cần gửi lại.",
        ]
    : input.shortage
      ? input.language === "en"
        ? [
            "The payment has been recorded successfully.",
            "The auto stock is temporarily lower than your requested quantity.",
            "The seller will check and deliver the remaining account(s) manually within a few minutes.",
          ]
        : [
            "Thanh toán đã được ghi nhận thành công.",
            "Kho giao tự động hiện tạm thời chưa đủ đúng số lượng bạn đặt.",
            "Seller sẽ kiểm tra và giao bù thủ công trong ít phút tới.",
          ]
      : input.language === "en"
        ? [
            "The payment has been recorded successfully.",
            "Please contact admin and send your email to upgrade your account 👇",
          ]
        : [
            "Thanh toán đã được ghi nhận thành công.",
            "Vui lòng liên hệ admin và gửi email để được nâng cấp chính chủ 👇",
          ];
  return [
    input.language === "en"
      ? "✅ Payment confirmed"
      : "✅ Thanh toán thành công",
    input.language === "en"
      ? `Order code: ${input.orderCode}`
      : `Mã đơn: ${input.orderCode}`,
    input.language === "en"
      ? `Product: ${input.productName}`
      : `Sản phẩm: ${input.productName}`,
    input.language === "en"
      ? `Quantity: ${input.quantity}`
      : `Số lượng: ${input.quantity}`,
    "",
    ...bodyLines,
    "",
    ...supportLines,
  ].join("\n");
}
