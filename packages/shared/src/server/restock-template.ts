// Restock ("Thông báo nhập kho") notification template — admin-configurable, mirrors the invoice
// template system. Rendering lives here in @reseller/shared so ALL three build paths use it:
//   - apps/api shops.service.notifyCatalogStockUpdates  (catalog sync from the API)
//   - apps/api telegram-bot.service.sendCatalogStockUpdateMessages (manual / stock-page uploads)
//   - apps/worker main.ts notifyCatalogStockUpdates       (the periodic worker sync)
// The "Mua ngay" button is already templated via buttonLabels.buyNow, so this only owns the
// message BODY (header + product line + added/stock lines + footer + custom emoji).

export type RestockLanguage = "vi" | "en" | "th";

export interface RestockCustomEmojiIds {
  header?: string;
  product?: string;
  added?: string;
  stock?: string;
  price?: string;
}

export interface RestockTemplateConfig {
  header: { icon: string; text: string };
  fieldIcons: { product: string; added: string; stock: string; price: string };
  // Empty string → fall back to the built-in per-language label (keeps multi-language default).
  labels: { added: string; stock: string; price: string };
  footer: string;
  customEmojiIds: RestockCustomEmojiIds;
}

// Defaults render EXACTLY like the legacy hardcoded message, so unconfigured shops are unchanged.
// Empty text/label/footer → the per-language fallbacks in LABELS below.
export const DEFAULT_RESTOCK_TEMPLATE: RestockTemplateConfig = {
  header: { icon: "📢", text: "" },
  fieldIcons: { product: "📦", added: "➕", stock: "📦", price: "💳" },
  labels: { added: "", stock: "", price: "" },
  footer: "",
  customEmojiIds: {},
};

export interface RestockRenderData {
  productName: string;
  addedQuantity: number;
  available: number;
  /** Sale price in VND (nullable → the price line is skipped when null/undefined). */
  price?: number | null;
  /** VND per USDT. A valid value adds an indicative USDT amount beside the VND price. */
  usdtVndRate?: number | null;
  productIcon?: string | null;
  productIconCustomEmojiId?: string | null;
  language?: RestockLanguage;
}

interface RestockLabels {
  header: string;
  added: string;
  stock: string;
  price: string;
}

const LABELS: Record<RestockLanguage, RestockLabels> = {
  vi: { header: "Thông báo nhập kho!", added: "Thêm", stock: "Tồn kho hiện tại", price: "Giá" },
  en: { header: "Restock notification!", added: "Added", stock: "Current stock", price: "Price" },
  th: { header: "แจ้งเตือนสินค้าเข้าใหม่!", added: "เพิ่ม", stock: "สต็อกปัจจุบัน", price: "ราคา" },
};

function formatPrice(value: number | null | undefined, lang: RestockLanguage): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const n = Number(value);
  try {
    return `${n.toLocaleString(lang === "en" ? "en-US" : lang === "th" ? "th-TH" : "vi-VN")}₫`;
  } catch {
    return `${n}₫`;
  }
}

function formatUsdtPrice(
  price: number | null | undefined,
  usdtVndRate: number | null | undefined,
): string {
  const numericPrice = Number(price);
  const numericRate = Number(usdtVndRate);
  if (
    !Number.isFinite(numericPrice) ||
    numericPrice < 0 ||
    !Number.isFinite(numericRate) ||
    numericRate <= 0
  ) {
    return "";
  }

  return (numericPrice / numericRate).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** "<tg-emoji emoji-id=ID>FB</tg-emoji>" when a custom emoji id is set, else the plain fallback. */
function renderEmoji(fallback: string, customEmojiId?: string | null): string {
  const id = (customEmojiId || "").trim();
  const fb = fallback || "📦";
  if (id) return `<tg-emoji emoji-id="${escHtml(id)}">${escHtml(fb)}</tg-emoji>`;
  return fb;
}

function fillPlaceholders(raw: string, data: RestockRenderData): string {
  if (!raw) return "";
  const lang: RestockLanguage = data.language ?? "vi";
  return String(raw)
    .replace(/\{product_name\}/g, data.productName || "")
    .replace(/\{added\}/g, String(data.addedQuantity ?? ""))
    .replace(/\{current_stock\}/g, String(data.available ?? ""))
    .replace(/\{price_usdt\}/g, formatUsdtPrice(data.price, data.usdtVndRate))
    .replace(/\{price\}/g, formatPrice(data.price, lang));
}

/** Merge admin template → shop override → defaults (shop wins), same precedence as the invoice. */
export function resolveRestockTemplate(
  shopCust: Record<string, any> | null | undefined,
  adminCust: Record<string, any> | null | undefined,
): RestockTemplateConfig {
  const merged: RestockTemplateConfig = JSON.parse(JSON.stringify(DEFAULT_RESTOCK_TEMPLATE));

  const apply = (src: Partial<RestockTemplateConfig> | null | undefined) => {
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
    if (src.labels && typeof src.labels === "object") {
      if (typeof src.labels.added === "string") merged.labels.added = src.labels.added;
      if (typeof src.labels.stock === "string") merged.labels.stock = src.labels.stock;
      if (typeof src.labels.price === "string") merged.labels.price = src.labels.price;
    }
    if (typeof src.footer === "string") merged.footer = src.footer;
    if (src.customEmojiIds && typeof src.customEmojiIds === "object") {
      for (const key of Object.keys(src.customEmojiIds) as Array<keyof RestockCustomEmojiIds>) {
        const v = (src.customEmojiIds as any)[key];
        if (typeof v === "string" && v.trim()) merged.customEmojiIds[key] = v.trim();
        else if (v === "" || v === null) delete merged.customEmojiIds[key];
      }
    }
  };

  apply((adminCust?.restockTemplate ?? null) as Partial<RestockTemplateConfig> | null);
  apply((shopCust?.restockTemplate ?? null) as Partial<RestockTemplateConfig> | null);
  return merged;
}

export interface RenderedRestock {
  text: string;
  /** True when the body carries <tg-emoji> entities → caller must send with parse_mode "HTML". */
  hasHtml: boolean;
}

/** Render the restock message body. Caller adds the (already-templated) "Mua ngay" button. */
export function renderRestockHtml(
  template: RestockTemplateConfig,
  data: RestockRenderData,
): RenderedRestock {
  const lang: RestockLanguage = data.language ?? "vi";
  const L = LABELS[lang];
  const headerText = (template.header.text || "").trim() || L.header;
  const addedLabel = (template.labels.added || "").trim() || L.added;
  const stockLabel = (template.labels.stock || "").trim() || L.stock;
  const priceLabel = (template.labels.price || "").trim() || L.price;

  const headerIcon = renderEmoji(template.header.icon, template.customEmojiIds.header);
  // Per-product icon (from the product itself) takes priority over the template's product icon.
  // When a cusid exists, keep the template emoji as the HTML entity placeholder. Telegram validates
  // that inner glyph separately; productIcon is suitable as plain fallback but may not be a valid
  // <tg-emoji> placeholder even though the same cusid works on an inline-keyboard button.
  const productIcon = renderEmoji(
    data.productIconCustomEmojiId
      ? template.fieldIcons.product
      : data.productIcon || template.fieldIcons.product,
    data.productIconCustomEmojiId || template.customEmojiIds.product,
  );
  const addedIcon = renderEmoji(template.fieldIcons.added, template.customEmojiIds.added);
  const stockIcon = renderEmoji(template.fieldIcons.stock, template.customEmojiIds.stock);
  const priceIcon = renderEmoji(template.fieldIcons.price, template.customEmojiIds.price);

  const priceText = formatPrice(data.price, lang);
  const usdtPriceText = formatUsdtPrice(data.price, data.usdtVndRate);

  const lines = [
    `${headerIcon} ${escHtml(fillPlaceholders(headerText, data))}`,
    "",
    `${productIcon} ${escHtml(data.productName)}`,
    `${addedIcon} ${escHtml(addedLabel)}: ${data.addedQuantity}`,
    `${stockIcon} ${escHtml(stockLabel)}: ${data.available}`,
  ];
  if (priceText) {
    lines.push(
      `${priceIcon} ${escHtml(priceLabel)}: ${priceText}${usdtPriceText ? ` (~${usdtPriceText} USDT)` : ""}`,
    );
  }
  const footer = fillPlaceholders(template.footer, data).trim();
  if (footer) {
    lines.push("", escHtml(footer));
  }

  const text = lines.join("\n");
  return { text, hasHtml: /<tg-emoji /.test(text) };
}

export function stripRestockCustomEmojiHtml(html: string): string {
  return html.replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi, "$1");
}

export function buildSampleRestockData(overrides?: Partial<RestockRenderData>): RestockRenderData {
  return {
    productName: "Slot X Premium 3 tháng | BHF",
    addedQuantity: 50,
    available: 87,
    price: 89000,
    usdtVndRate: 27000,
    language: "vi",
    ...(overrides || {}),
  };
}
