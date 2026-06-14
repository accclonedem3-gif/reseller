import { telegramSendDocument, telegramSendMessage } from "./telegram";

export type InvoiceLanguage = "vi" | "en" | "th";

export interface InvoiceCustomEmojiIds {
  header?: string;
  order?: string;
  product?: string;
  quantity?: string;
  price?: string;
  warranty?: string;
  datetime?: string;
  shop?: string;
  accountBlock?: string;
}

export interface InvoiceTemplateConfig {
  header: { icon: string; text: string };
  fieldIcons: {
    order: string;
    product: string;
    quantity: string;
    price: string;
    warranty: string;
    datetime: string;
    shop: string;
  };
  accountBlock: { icon: string; labelTemplate: string };
  footer: string;
  inlineThreshold: number;
  customEmojiIds: InvoiceCustomEmojiIds;
}

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplateConfig = {
  header: { icon: "✅", text: "THANH TOÁN THÀNH CÔNG" },
  fieldIcons: {
    order: "🧾",
    product: "📦",
    quantity: "📊",
    price: "💰",
    warranty: "🛡️",
    datetime: "🕐",
    shop: "🏪",
  },
  accountBlock: { icon: "🎁", labelTemplate: "TÀI KHOẢN #{index}" },
  footer: "Cảm ơn bạn đã mua hàng! 🎉",
  inlineThreshold: 5,
  customEmojiIds: {},
};

export interface InvoiceRenderData {
  orderCode: string;
  productName: string;
  quantity: number;
  totalPriceText: string;
  customerName?: string | null;
  shopName?: string | null;
  dateTimeText?: string | null;
  warrantyText?: string | null;
  accountList: string[];
  language?: InvoiceLanguage;
  productIcon?: string | null;
  productIconCustomEmojiId?: string | null;
}

interface InvoiceLabels {
  order: string;
  product: string;
  quantity: string;
  price: string;
  warranty: string;
  datetime: string;
  shop: string;
  accountListHeading: string;
  deliveredCount: (n: number) => string;
  headerHint: string;
  fileTitle: string;
  fileLineOrder: string;
  fileLineProduct: string;
  fileLineQuantity: string;
  fileLineDate: string;
}

const LABELS: Record<InvoiceLanguage, InvoiceLabels> = {
  vi: {
    order: "Đơn hàng",
    product: "Sản phẩm",
    quantity: "Tổng số tài khoản",
    price: "Tổng tiền",
    warranty: "Bảo hành",
    datetime: "Ngày mua",
    shop: "Shop",
    accountListHeading: "DANH SÁCH TÀI KHOẢN",
    deliveredCount: (n: number) => `Đã giao ${n} tài khoản thành công!`,
    headerHint: "💬",
    fileTitle: "THÔNG TIN TÀI KHOẢN",
    fileLineOrder: "Đơn hàng",
    fileLineProduct: "Sản phẩm",
    fileLineQuantity: "Số lượng",
    fileLineDate: "Ngày mua",
  },
  en: {
    order: "Order",
    product: "Product",
    quantity: "Total accounts",
    price: "Total",
    warranty: "Warranty",
    datetime: "Purchase date",
    shop: "Shop",
    accountListHeading: "ACCOUNT LIST",
    deliveredCount: (n: number) => `Delivered ${n} accounts successfully!`,
    headerHint: "💬",
    fileTitle: "ACCOUNT INFORMATION",
    fileLineOrder: "Order",
    fileLineProduct: "Product",
    fileLineQuantity: "Quantity",
    fileLineDate: "Purchase date",
  },
  th: {
    order: "คำสั่งซื้อ",
    product: "สินค้า",
    quantity: "จำนวนบัญชี",
    price: "ยอดรวม",
    warranty: "การรับประกัน",
    datetime: "วันที่ซื้อ",
    shop: "ร้าน",
    accountListHeading: "รายการบัญชี",
    deliveredCount: (n: number) => `จัดส่ง ${n} บัญชีสำเร็จ!`,
    headerHint: "💬",
    fileTitle: "ข้อมูลบัญชี",
    fileLineOrder: "คำสั่งซื้อ",
    fileLineProduct: "สินค้า",
    fileLineQuantity: "จำนวน",
    fileLineDate: "วันที่ซื้อ",
  },
};

function escHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function resolveInvoiceTemplate(
  shopCust: Record<string, any> | null | undefined,
  adminCust: Record<string, any> | null | undefined,
): InvoiceTemplateConfig {
  const shopTpl = (shopCust?.invoiceTemplate ?? null) as Partial<InvoiceTemplateConfig> | null;
  const adminTpl = (adminCust?.invoiceTemplate ?? null) as Partial<InvoiceTemplateConfig> | null;
  const merged: InvoiceTemplateConfig = JSON.parse(JSON.stringify(DEFAULT_INVOICE_TEMPLATE));

  const apply = (src: Partial<InvoiceTemplateConfig> | null) => {
    if (!src || typeof src !== "object") return;
    if (src.header && typeof src.header === "object") {
      if (typeof src.header.icon === "string" && src.header.icon.trim()) merged.header.icon = src.header.icon;
      if (typeof src.header.text === "string") merged.header.text = src.header.text;
    }
    if (src.fieldIcons && typeof src.fieldIcons === "object") {
      for (const key of Object.keys(merged.fieldIcons) as Array<keyof typeof merged.fieldIcons>) {
        const v = (src.fieldIcons as any)[key];
        if (typeof v === "string" && v.trim()) merged.fieldIcons[key] = v;
      }
    }
    if (src.accountBlock && typeof src.accountBlock === "object") {
      if (typeof src.accountBlock.icon === "string" && src.accountBlock.icon.trim()) {
        merged.accountBlock.icon = src.accountBlock.icon;
      }
      if (typeof src.accountBlock.labelTemplate === "string") {
        merged.accountBlock.labelTemplate = src.accountBlock.labelTemplate;
      }
    }
    if (typeof src.footer === "string") merged.footer = src.footer;
    if (typeof src.inlineThreshold === "number" && Number.isFinite(src.inlineThreshold)) {
      merged.inlineThreshold = Math.max(1, Math.min(50, Math.floor(src.inlineThreshold)));
    }
    if (src.customEmojiIds && typeof src.customEmojiIds === "object") {
      for (const key of Object.keys(src.customEmojiIds) as Array<keyof InvoiceCustomEmojiIds>) {
        const v = (src.customEmojiIds as any)[key];
        if (typeof v === "string" && v.trim()) {
          merged.customEmojiIds[key] = v.trim();
        } else if (v === "" || v === null) {
          // explicit empty wipes inherited value
          delete merged.customEmojiIds[key];
        }
      }
    }
  };

  apply(adminTpl);
  apply(shopTpl);
  return merged;
}

function fillPlaceholders(
  raw: string,
  data: InvoiceRenderData,
): string {
  if (!raw) return "";
  return String(raw)
    .replace(/\{order_code\}/g, data.orderCode || "")
    .replace(/\{product_name\}/g, data.productName || "")
    .replace(/\{quantity\}/g, String(data.quantity ?? ""))
    .replace(/\{total_price\}/g, data.totalPriceText || "")
    .replace(/\{customer_name\}/g, data.customerName || "")
    .replace(/\{shop_name\}/g, data.shopName || "")
    .replace(/\{date_time\}/g, data.dateTimeText || "")
    .replace(/\{warranty_info\}/g, data.warrantyText || "");
}

function renderEmoji(fallback: string, customEmojiId?: string | null): string {
  const id = (customEmojiId || "").trim();
  const fb = fallback || "🔵";
  if (id) {
    return `<tg-emoji emoji-id="${escHtml(id)}">${escHtml(fb)}</tg-emoji>`;
  }
  return fb;
}

function buildHeaderLine(template: InvoiceTemplateConfig, data: InvoiceRenderData): string {
  const lang = data.language ?? "vi";
  const headerText = fillPlaceholders(template.header.text || "", data) || LABELS[lang].fileTitle;
  const icon = renderEmoji(template.header.icon, template.customEmojiIds.header);
  return `${icon} <b>${escHtml(headerText)}</b>`;
}

function buildInfoLines(
  template: InvoiceTemplateConfig,
  data: InvoiceRenderData,
): string[] {
  const lang = data.language ?? "vi";
  const L = LABELS[lang];
  const ids = template.customEmojiIds;
  const lines: string[] = [];
  lines.push(`${renderEmoji(template.fieldIcons.order, ids.order)} ${L.order}: <code>${escHtml(data.orderCode)}</code>`);
  const productIconText = (data.productIcon && data.productIcon.trim()) || template.fieldIcons.product;
  const productIconId = (data.productIconCustomEmojiId && data.productIconCustomEmojiId.trim()) || ids.product;
  lines.push(`${renderEmoji(productIconText, productIconId)} ${L.product}: <b>${escHtml(data.productName)}</b>`);
  lines.push(`${renderEmoji(template.fieldIcons.quantity, ids.quantity)} ${L.quantity}: <b>${data.quantity}</b>`);
  if (data.totalPriceText) {
    lines.push(`${renderEmoji(template.fieldIcons.price, ids.price)} ${L.price}: <b>${escHtml(data.totalPriceText)}</b>`);
  }
  if (data.warrantyText) {
    lines.push(`${renderEmoji(template.fieldIcons.warranty, ids.warranty)} ${L.warranty}: ${escHtml(data.warrantyText)}`);
  }
  if (data.dateTimeText) {
    lines.push(`${renderEmoji(template.fieldIcons.datetime, ids.datetime)} ${L.datetime}: ${escHtml(data.dateTimeText)}`);
  }
  if (data.shopName) {
    lines.push(`${renderEmoji(template.fieldIcons.shop, ids.shop)} ${L.shop}: ${escHtml(data.shopName)}`);
  }
  return lines;
}

function buildAccountBlocks(
  template: InvoiceTemplateConfig,
  data: InvoiceRenderData,
): string[] {
  const lang = data.language ?? "vi";
  const L = LABELS[lang];
  const ids = template.customEmojiIds;
  const lines: string[] = [];
  lines.push(`${L.headerHint} <b>${L.accountListHeading}:</b>`);
  data.accountList.forEach((acc, idx) => {
    const labelRaw = (template.accountBlock.labelTemplate || "TÀI KHOẢN #{index}").replace(/\{index\}/g, String(idx + 1));
    const blockIcon = renderEmoji(template.accountBlock.icon, ids.accountBlock);
    lines.push("");
    lines.push(`${blockIcon} <b>${escHtml(labelRaw)}:</b>`);
    lines.push(`<code>${escHtml(acc)}</code>`);
  });
  lines.push("");
  lines.push(`${escHtml(L.deliveredCount(data.accountList.length))}`);
  return lines;
}

function buildFooterLine(template: InvoiceTemplateConfig, data: InvoiceRenderData): string | null {
  const raw = fillPlaceholders(template.footer || "", data).trim();
  if (!raw) return null;
  return escHtml(raw);
}

export function renderInvoiceInlineHtml(
  template: InvoiceTemplateConfig,
  data: InvoiceRenderData,
): string {
  const lines: string[] = [];
  lines.push(buildHeaderLine(template, data));
  lines.push(...buildInfoLines(template, data));
  lines.push("");
  lines.push(...buildAccountBlocks(template, data));
  const footer = buildFooterLine(template, data);
  if (footer) {
    lines.push("");
    lines.push(footer);
  }
  return lines.join("\n");
}

export function renderInvoiceCaptionHtml(
  template: InvoiceTemplateConfig,
  data: InvoiceRenderData,
): string {
  const lang = data.language ?? "vi";
  const L = LABELS[lang];
  const lines: string[] = [];
  lines.push(buildHeaderLine(template, data));
  lines.push(...buildInfoLines(template, data));
  lines.push("");
  lines.push(`${escHtml(L.deliveredCount(data.accountList.length))}`);
  lines.push(`📎 ${escHtml(data.accountList.length.toString())} accounts → file <b>${escHtml(data.orderCode)}.txt</b>`);
  const footer = buildFooterLine(template, data);
  if (footer) {
    lines.push("");
    lines.push(footer);
  }
  return lines.join("\n");
}

export function renderAccountsFileText(
  data: InvoiceRenderData,
): string {
  const lang = data.language ?? "vi";
  const L = LABELS[lang];
  const sep = "=".repeat(40);
  const lines: string[] = [];
  lines.push(`=== ${L.fileTitle} ===`);
  lines.push(`${L.fileLineOrder}: ${data.orderCode}`);
  lines.push(`${L.fileLineProduct}: ${data.productName}`);
  lines.push(`${L.fileLineQuantity}: ${data.quantity}`);
  if (data.dateTimeText) lines.push(`${L.fileLineDate}: ${data.dateTimeText}`);
  lines.push(sep);
  for (const acc of data.accountList) {
    lines.push(acc);
  }
  lines.push(sep);
  return lines.join("\n") + "\n";
}

export interface SendInvoiceOptions {
  botToken: string;
  chatId: string | number;
  template: InvoiceTemplateConfig;
  data: InvoiceRenderData;
  warrantyButton?: { text: string; callback_data: string } | null;
  buyMoreButton?: { text: string; callback_data: string } | null;
  /**
   * Whether this bot can emit custom-emoji (tg-emoji) entities. Non-premium bots cannot —
   * Telegram rejects the WHOLE message with CUSTOM_EMOJI_INVALID. Default true. When false,
   * cusid is stripped up-front (skips the doomed first attempt). Regardless of this flag, a
   * failed cusid send is retried with cusid stripped so the buyer always receives the invoice.
   */
  canEmitCusid?: boolean;
}

export interface SendInvoiceResult {
  /** The invoice (or at least the account list) reached the buyer. */
  sent: boolean;
  /** Custom-emoji entities had to be stripped for the message to go through (bot can't emit cusid). */
  strippedCusid: boolean;
}

/** Strip `<tg-emoji emoji-id="X">FB</tg-emoji>` down to its fallback `FB` (for non-premium bots). */
function stripCustomEmojiHtml(html: string): string {
  return html.replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi, "$1");
}

/**
 * Send an HTML message resiliently. If it carries custom-emoji entities and the bot can't emit
 * them (known up-front, or discovered on a 400), retry with those stripped to plain fallback
 * chars so a non-premium bot's buyer still gets the message. Never throws.
 */
async function sendHtmlResilient(
  botToken: string,
  chatId: string | number,
  text: string,
  extra: Record<string, unknown>,
  canEmitCusid: boolean,
): Promise<SendInvoiceResult> {
  const hasCusid = /<tg-emoji\b/i.test(text);
  if (hasCusid && !canEmitCusid) {
    try {
      await telegramSendMessage(botToken, chatId, stripCustomEmojiHtml(text), extra);
      return { sent: true, strippedCusid: true };
    } catch {
      return { sent: false, strippedCusid: true };
    }
  }
  try {
    await telegramSendMessage(botToken, chatId, text, extra);
    return { sent: true, strippedCusid: false };
  } catch {
    if (!hasCusid) return { sent: false, strippedCusid: false };
    try {
      await telegramSendMessage(botToken, chatId, stripCustomEmojiHtml(text), extra);
      return { sent: true, strippedCusid: true };
    } catch {
      return { sent: false, strippedCusid: false };
    }
  }
}

export async function sendInvoiceMessages(opts: SendInvoiceOptions): Promise<SendInvoiceResult> {
  const { botToken, chatId, template, data, warrantyButton, buyMoreButton } = opts;
  const canEmitCusid = opts.canEmitCusid !== false;
  const threshold = Math.max(1, template.inlineThreshold || 5);
  const inlineKb: any[][] = [];
  if (buyMoreButton) inlineKb.push([buyMoreButton]);
  if (warrantyButton) inlineKb.push([warrantyButton]);
  const replyMarkup = inlineKb.length > 0 ? { inline_keyboard: inlineKb } : undefined;
  const lang = data.language ?? "vi";

  if (data.accountList.length <= threshold) {
    const text = renderInvoiceInlineHtml(template, data);
    const res = await sendHtmlResilient(botToken, chatId, text, {
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }, canEmitCusid);
    if (!res.sent) {
      // Last-ditch: a bare plain-text message (no HTML, no cusid) so the buyer still gets
      // their account even if the formatted invoice failed for any reason.
      const plain = `${LABELS[lang].accountListHeading}:\n${data.accountList.join("\n")}`;
      await telegramSendMessage(botToken, chatId, plain, {
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }).catch(() => undefined);
    }
    return res;
  }

  const caption = renderInvoiceCaptionHtml(template, data);
  const res = await sendHtmlResilient(botToken, chatId, caption, {
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, canEmitCusid);

  const fileText = renderAccountsFileText(data);
  const filename = `${(data.orderCode || "order").replace(/[^A-Za-z0-9_-]+/g, "_")}.txt`;
  const buf = Buffer.from(fileText, "utf-8");
  await telegramSendDocument(botToken, chatId, buf, filename).catch(() => undefined);
  return res;
}

export function buildSampleInvoiceData(overrides?: Partial<InvoiceRenderData>): InvoiceRenderData {
  return {
    orderCode: "DH510277926",
    productName: "Grok Super 3 Tháng | BHF",
    quantity: 2,
    totalPriceText: "180.000đ",
    customerName: "Khách mẫu",
    shopName: "Shop của bạn",
    dateTimeText: "22/05/2026 17:28:15",
    warrantyText: "Bảo hành 3 ngày",
    accountList: [
      "renaude@vodich1.com|Giare#123",
      "lokrjjfi@vodich1.com|Giare#123",
    ],
    language: "vi",
    ...(overrides || {}),
  };
}

export function buildSampleInvoiceDataLarge(): InvoiceRenderData {
  const base = buildSampleInvoiceData();
  const accs = Array.from({ length: 6 }, (_, i) => `acc${i + 1}@vodich1.com|Giare#${100 + i}`);
  return { ...base, quantity: accs.length, accountList: accs };
}
