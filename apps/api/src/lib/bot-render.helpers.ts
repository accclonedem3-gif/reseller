import { Injectable } from "@nestjs/common";

export type BotLanguage = "vi" | "en" | "th" | "zh";

/**
 * Stateless presentation helpers for the Telegram bot: i18n string maps,
 * product-name translation (VI⇄EN), error-message localization, emoji
 * resolution, text escaping/formatting, and label builders.
 *
 * Pure functions only — no DB, no config, no Redis, no instance state.
 * Extracted verbatim from TelegramBotService; the bot delegates via thin
 * wrappers so behaviour is unchanged.
 */
@Injectable()
export class BotRenderHelpers {
  formatDateTime(value: Date) {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(new Date(value));
  }

  normalizeLanguage(value: unknown): BotLanguage {
    const v = String(value || "").toLowerCase();
    if (v === "en") return "en";
    if (v === "th") return "th";
    if (v === "zh" || v === "zh-cn" || v === "zh-hans" || v === "cn")
      return "zh";
    return "vi";
  }

  indentBlock(value: string) {
    return value
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n");
  }

  chunkButtons<T>(items: T[], size: number) {
    if (size <= 0) {
      return [items];
    }

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  escapeHtml(value: string) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Escape text characters (&, <, >) without double-encoding existing valid XML entities.
   */
  escapeHtmlText(value: string): string {
    return String(value || "")
      .replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[\da-f]+;)/gi, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Preserves valid Telegram HTML tags (<b>, <i>, <u>, <s>, <a>, <code>, <pre>, <blockquote>, <tg-spoiler>, <tg-emoji>)
   * while safely escaping raw characters (&, <, >) that are not part of valid tags.
   */
  sanitizeTelegramHtml(value: string): string {
    if (!value) return "";
    const raw = String(value);
    const validTagRegex =
      /<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler)\b[^>]*>|<a\s+href=["'][^"']*["'][^>]*>|<\/a>|<tg-emoji\s+emoji-id=["']\d+["'][^>]*>|<\/tg-emoji>|<span\s+class=["']tg-spoiler["'][^>]*>|<\/span>/gi;

    const parts: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = validTagRegex.exec(raw)) !== null) {
      const textBefore = raw.substring(lastIndex, match.index);
      if (textBefore) {
        parts.push(this.escapeHtmlText(textBefore));
      }
      parts.push(match[0]);
      lastIndex = validTagRegex.lastIndex;
    }

    const remaining = raw.substring(lastIndex);
    if (remaining) {
      parts.push(this.escapeHtmlText(remaining));
    }

    return parts.join("");
  }

  truncateLabel(value: string, maxLength: number) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 1).trimEnd()}…`;
  }

  formatStock(available: number | null, language: BotLanguage = "vi") {
    if (available === null) {
      return language === "en"
        ? "Unlimited"
        : language === "th"
          ? "ไม่จำกัด"
          : "Không giới hạn";
    }

    return String(available);
  }

  formatCatalogButtonMoney(value: number) {
    const amount = Number(value || 0);
    const roundedAmount = Number.isFinite(amount) ? Math.round(amount) : 0;

    // Never abbreviate prices on product buttons. Values such as 1,500 and
    // 2,000 become ambiguous when rendered as "2k", and customers need the
    // exact amount before opening the product detail.
    return `${roundedAmount.toLocaleString("vi-VN")}đ`;
  }

  compactProductName(value: string) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  normalizeTranslationSource(value: string) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[đĐ]/g, (character) => (character === "đ" ? "d" : "D"))
      .replace(/\s+/g, " ")
      .trim();
  }

  formatEnglishCount(rawAmount: string, unit: "day" | "month" | "year") {
    const amount = Number(rawAmount || 0);
    return `${rawAmount} ${amount === 1 ? unit : `${unit}s`}`;
  }

  applyProductNameReplacements(
    value: string,
    replacements: Array<
      [RegExp, string | ((match: string, ...groups: string[]) => string)]
    >,
  ) {
    let result = String(value || "");

    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement as never);
    }

    return result.replace(/\s+/g, " ").trim();
  }

  translateProductNameToVietnamese(value: string) {
    const withLongDurations = this.applyProductNameReplacements(value, [
      [/\b(\d+)\s*years?\b/gi, (_match, amount: string) => `${amount} năm`],
      [/\b(\d+)\s*months?\b/gi, (_match, amount: string) => `${amount} tháng`],
      [/\b(\d+)\s*days?\b/gi, (_match, amount: string) => `${amount} ngày`],
      [/\b(\d+)\s*yrs?\b/gi, (_match, amount: string) => `${amount} năm`],
      [/\b(\d+)\s*mos?\b/gi, (_match, amount: string) => `${amount} tháng`],
    ]);

    const withShortDurations = this.applyProductNameReplacements(
      withLongDurations,
      [
        [/\b(\d+)\s*y\b/gi, (_match, amount: string) => `${amount} năm`],
        [/\b(\d+)\s*m\b/gi, (_match, amount: string) => `${amount} tháng`],
        [/\b(\d+)\s*d\b/gi, (_match, amount: string) => `${amount} ngày`],
      ],
    );

    return this.applyProductNameReplacements(withShortDurations, [
      [/\bpersonal account\b/gi, "TK chính chủ"],
      [/\bowner account\b/gi, "TK chính chủ"],
      [/\bmain account\b/gi, "TK chính chủ"],
      [/\bpersonal\b/gi, "chính chủ"],
      [/\baccount\b/gi, "TK"],
      [/\bpackage\b/gi, "gói"],
      [/\blifetime\b/gi, "vĩnh viễn"],
      [/\bpermanent\b/gi, "vĩnh viễn"],
      [/\bfull warranty\b/gi, "bảo hành full"],
      [/\bno warranty\b/gi, "không bảo hành"],
      [/\bstock mail\b/gi, "mail có sẵn"],
      [/\brandom\b/gi, "ngẫu nhiên"],
      [/\badd family\b/gi, "add family"],
      [/\badd fam\b/gi, "add fam"],
      [/\bwarranty\b/gi, "bảo hành"],
    ]);
  }

  translateProductNameToEnglish(value: string) {
    const normalized = this.normalizeTranslationSource(value);

    const withDurations = this.applyProductNameReplacements(normalized, [
      [
        /\b(\d+)\s*năm\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "year"),
      ],
      [
        /\b(\d+)\s*nam\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "year"),
      ],
      [
        /\b(\d+)\s*tháng\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "month"),
      ],
      [
        /\b(\d+)\s*thang\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "month"),
      ],
      [
        /\b(\d+)\s*ngày\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "day"),
      ],
      [
        /\b(\d+)\s*ngay\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "day"),
      ],
      [
        /\b(\d+)\s*t\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "month"),
      ],
      [
        /\b(\d+)\s*th\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "month"),
      ],
      [
        /\b(\d+)\s*n\b/gi,
        (_match, amount: string) => this.formatEnglishCount(amount, "year"),
      ],
    ]);

    const translated = this.applyProductNameReplacements(withDurations, [
      [/\btài\s*khoản\s*chính\s*chủ\b/gi, "personal account"],
      [/\btai\s*khoan\s*chinh\s*chu\b/gi, "personal account"],
      [/\btk\s*chính\s*chủ\b/gi, "personal account"],
      [/\btk\s*chinh\s*chu\b/gi, "personal account"],
      [/\bchính\s*chủ\b/gi, "personal"],
      [/\bchinh\s*chu\b/gi, "personal"],
      [/\btk\b/gi, "account"],
      [/\btài\s*khoản\b/gi, "account"],
      [/\btai\s*khoan\b/gi, "account"],
      [/\bgói\b/gi, "package"],
      [/\bgoi\b/gi, "package"],
      [/\bvĩnh\s*viễn\b/gi, "lifetime"],
      [/\bvinh\s*vien\b/gi, "lifetime"],
      [/\btrọn\s*đời\b/gi, "lifetime"],
      [/\btron\s*doi\b/gi, "lifetime"],
      [/\bkhông\s*bảo\s*hành\b/gi, "no warranty"],
      [/\bkhong\s*bao\s*hanh\b/gi, "no warranty"],
      [/\bbảo\s*hành\s*đầy\s*đủ\b/gi, "full warranty"],
      [/\bbao\s*hanh\s*day\s*du\b/gi, "full warranty"],
      [/\bbảo\s*hành\s*full\b/gi, "full warranty"],
      [/\bbao\s*hanh\s*full\b/gi, "full warranty"],
      [/\bfull\s*bảo\s*hành\b/gi, "full warranty"],
      [/\bfull\s*bao\s*hanh\b/gi, "full warranty"],
      [/\bmail\s*có\s*sẵn\b/gi, "stock mail"],
      [/\bmail\s*co\s*san\b/gi, "stock mail"],
      [/\bngẫu\s*nhiên\b/gi, "random"],
      [/\bngau\s*nhien\b/gi, "random"],
      [/\bthêm\s*family\b/gi, "add family"],
      [/\bthem\s*family\b/gi, "add family"],
      [/\bthêm\s*fam\b/gi, "add fam"],
      [/\bthem\s*fam\b/gi, "add fam"],
      [/\bbảo\s*hành\b/gi, "warranty"],
      [/\bbao\s*hanh\b/gi, "warranty"],
    ]);

    return this.applyProductNameReplacements(translated, [
      [/\baccount\s+personal\b/gi, "personal account"],
      [/\bpackage\s+team(\d+)\b/gi, "team $1 package"],
      [/\bteam(\d+)\b/gi, "team $1"],
    ]);
  }

  localizeProductName(value: string, language: BotLanguage = "vi") {
    const normalized = String(value || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return normalized;
    }

    if (language === "en" || language === "th") {
      return this.translateProductNameToEnglish(normalized);
    }
    return normalized;
  }

  isLikelyVietnameseText(value: string) {
    return (
      /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(
        value,
      ) ||
      /\b(khong|không|san pham|sản phẩm|vui long|vui lòng|so du|số dư|nap|nạp|don hang|đơn hàng)\b/i.test(
        value,
      )
    );
  }

  localizeBotErrorMessage(
    error: unknown,
    language: BotLanguage,
    fallbackMessage?: string,
  ) {
    const fallback =
      fallbackMessage ||
      (language === "en"
        ? "Something went wrong. Please try again."
        : language === "th"
          ? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"
          : "Đã có lỗi xảy ra, vui lòng thử lại.");

    if (!(error instanceof Error)) {
      return fallback;
    }

    const rawMessage = String(error.message || "").trim();
    if (!rawMessage) {
      return fallback;
    }

    const normalized =
      this.normalizeTranslationSource(rawMessage).toLowerCase();
    const onlyLeftMatch = normalized.match(
      /only\s+(\d+)\s+item(?:\(s\))?\s+left\s+in\s+stock/,
    );

    if (onlyLeftMatch) {
      return language === "en"
        ? `Only ${onlyLeftMatch[1]} item(s) left in stock.`
        : `Chỉ còn ${onlyLeftMatch[1]} sản phẩm trong kho.`;
    }

    if (/san pham.*khong kha dung|product is not available/.test(normalized)) {
      return language === "en"
        ? "This product is not available right now."
        : "Sản phẩm hiện không khả dụng.";
    }

    if (/product not found/.test(normalized)) {
      return language === "en"
        ? "Product not found."
        : language === "th"
          ? "ไม่พบสินค้า"
          : "Không tìm thấy sản phẩm.";
    }

    if (/san pham.*het hang|product is out of stock/.test(normalized)) {
      return language === "en"
        ? "This product is out of stock."
        : language === "th"
          ? "สินค้าหมดสต็อก"
          : "Sản phẩm đã hết hàng.";
    }

    if (/khong du ton kho|does not have enough stock/.test(normalized)) {
      return language === "en"
        ? "This product does not have enough stock to create an order."
        : "Sản phẩm hiện không đủ tồn kho để tạo đơn.";
    }

    if (
      /quantity must be a positive integer|so luong.*so nguyen duong/.test(
        normalized,
      )
    ) {
      return language === "en"
        ? "Quantity must be a positive integer."
        : "Số lượng phải là số nguyên dương.";
    }

    if (/wallet balance is not enough|so du vi.*khong du/.test(normalized)) {
      return language === "en"
        ? "Your wallet balance is not enough. Please top up first."
        : "Số dư ví của bạn không đủ. Vui lòng nạp thêm trước.";
    }

    if (/customer wallet not found/.test(normalized)) {
      return language === "en"
        ? "Customer wallet not found."
        : "Không tìm thấy ví khách hàng.";
    }

    if (/shop not found/.test(normalized)) {
      return language === "en"
        ? "Shop not found."
        : language === "th"
          ? "ไม่พบร้านค้า"
          : "Không tìm thấy shop.";
    }

    if (
      /so tien nap.*1000d|top-up amount must be an integer from 1,000 vnd/.test(
        normalized,
      )
    ) {
      return language === "en"
        ? "Top-up amount must be an integer from 1,000 VND."
        : "Số tiền nạp phải là số nguyên từ 1.000đ trở lên.";
    }

    if (
      /shop seller hien khong du so du vi nguon|source wallet.*not have enough balance/.test(
        normalized,
      )
    ) {
      return language === "en"
        ? "The seller's source wallet does not have enough balance to process this order right now. Please contact support."
        : "Shop seller hiện không đủ số dư ví nguồn để xử lý đơn này. Vui lòng liên hệ hỗ trợ.";
    }

    if (/please send a tx hash|invalid tx hash format/.test(normalized)) {
      return language === "en"
        ? "Invalid tx hash format. Please paste the full transaction hash."
        : "TX hash chưa đúng định dạng. Vui lòng dán đầy đủ mã giao dịch.";
    }

    if (
      /could not find a confirmed usdt trc20 transfer|payment transaction not found/.test(
        normalized,
      )
    ) {
      return language === "en"
        ? "We could not find a confirmed USDT TRC20 transfer for this tx hash yet."
        : "Chưa tìm thấy giao dịch USDT TRC20 đã xác nhận cho tx hash này.";
    }

    if (/tx hash has already been used/.test(normalized)) {
      return language === "en"
        ? "This tx hash was already used for another order."
        : "TX hash này đã được dùng cho một đơn khác.";
    }

    if (
      /does not transfer usdt to the configured trc20 address/.test(normalized)
    ) {
      return language === "en"
        ? "This tx hash does not send USDT to the configured TRC20 address."
        : "TX hash này không chuyển USDT tới đúng địa chỉ TRC20 đã cấu hình.";
    }

    if (/transferred usdt amount is lower than required/.test(normalized)) {
      return language === "en"
        ? "The transferred USDT amount is lower than required for this order."
        : "Số USDT đã chuyển thấp hơn mức cần thiết cho đơn này.";
    }

    if (/transaction is not confirmed yet/.test(normalized)) {
      return language === "en"
        ? "This transaction is not confirmed yet. Please wait a bit and try again."
        : "Giao dịch này chưa đủ xác nhận. Chờ thêm một chút rồi gửi lại nhé.";
    }

    if (
      /this order has already been confirmed with a different tx hash/.test(
        normalized,
      )
    ) {
      return language === "en"
        ? "This order was already confirmed with a different tx hash."
        : "Đơn này đã được xác nhận bằng một tx hash khác.";
    }

    if (language === "en" && this.isLikelyVietnameseText(rawMessage)) {
      return fallback;
    }

    return rawMessage;
  }

  resolveProductEmoji(displayName: string, sourceName?: string | null) {
    const normalized = `${displayName || ""} ${sourceName || ""}`.toLowerCase();

    // AI & productivity
    if (/chatgpt|gpt/.test(normalized)) return "✨";
    if (/grok/.test(normalized)) return "⚡";
    if (/gemini/.test(normalized)) return "🔮";
    if (/claude/.test(normalized)) return "🧬";
    if (/copilot/.test(normalized)) return "🪄";
    if (/midjourney/.test(normalized)) return "🖼️";
    if (/elevenlabs/.test(normalized)) return "🎙️";
    if (/suno/.test(normalized)) return "🎶";
    if (/notion/.test(normalized)) return "📝";
    if (/perplexity/.test(normalized)) return "🔍";
    if (/cursor/.test(normalized)) return "💻";

    // Video & media
    if (/veo/.test(normalized)) return "🎬";
    if (/kling/.test(normalized)) return "🎥";
    if (/youtube/.test(normalized)) return "▶️";
    if (/netflix/.test(normalized)) return "🍿";
    if (/capcut/.test(normalized)) return "✂️";

    // Creative tools
    if (/canva/.test(normalized)) return "🎨";
    if (/adobe/.test(normalized)) return "🅰️";
    if (/figma/.test(normalized)) return "🎯";
    if (/meitu/.test(normalized)) return "💄";
    if (/fotor/.test(normalized)) return "📸";
    if (/freepik/.test(normalized)) return "🖌️";

    // Communication & cloud
    if (/gmail|google(?!\s*play)/.test(normalized)) return "📧";
    if (/spotify/.test(normalized)) return "🎵";
    if (/discord/.test(normalized)) return "💬";
    if (/zoom/.test(normalized)) return "📹";
    if (/vpn|express/.test(normalized)) return "🔒";
    if (/fam\b/.test(normalized)) return "👨‍👩‍👧";

    return "🛍️";
  }

  resolveCustomEmojiId(
    displayName: string,
    sourceName?: string | null,
  ): { char: string; id: string } | null {
    const normalized = `${displayName || ""} ${sourceName || ""}`.toLowerCase();
    if (/capcut|capcat/.test(normalized))
      return { char: "📱", id: "5364339557712020484" };
    if (/\bveo\b/.test(normalized))
      return { char: "😭", id: "6178962311072456422" };
    if (/chatgpt|gpt/.test(normalized))
      return { char: "😺", id: "5796185041717433060" };
    return null;
  }

  buttonLabel(
    key:
      | "products"
      | "productsShort"
      | "guide"
      | "history"
      | "wallet"
      | "support"
      | "supportShort"
      | "warranty"
      | "language"
      | "home"
      | "affiliate"
      | "apiKey"
      | "viewAll"
      | "buyOther"
      | "payWallet"
      | "payQR"
      | "payBinance"
      | "payUsdt"
      | "paySol"
      | "payTon"
      | "paid"
      | "buyNow"
      | "back"
      | "contactAdmin"
      | "openCheckout"
      | "retry"
      | "txHash",
    language: BotLanguage,
  ) {
    const labels: Record<string, Partial<Record<BotLanguage, string>>> = {
      products: {
        vi: "🛍️ Xem sản phẩm",
        en: "🛍️ Products",
        th: "🛍️ ดูสินค้า",
        zh: "🛍️ 查看商品",
      },
      productsShort: {
        vi: "🛍️ Sản phẩm",
        en: "🛍️ Products",
        th: "🛍️ สินค้า",
        zh: "🛍️ 商品",
      },
      guide: {
        vi: "📘 Cách mua",
        en: "📘 How to buy",
        th: "📘 วิธีซื้อ",
        zh: "📘 购买指南",
      },
      history: {
        vi: "📜 Lịch sử mua",
        en: "📜 Orders",
        th: "📜 ประวัติคำสั่งซื้อ",
        zh: "📜 我的订单",
      },
      wallet: {
        vi: "💳 Ví",
        en: "💳 Wallet",
        th: "💳 กระเป๋าเงิน",
        zh: "💳 钱包",
      },
      support: {
        vi: "💬 Liên hệ hỗ trợ",
        en: "💬 Support",
        th: "💬 ติดต่อฝ่ายช่วยเหลือ",
        zh: "💬 联系客服",
      },
      supportShort: {
        vi: "💬 Hỗ trợ",
        en: "💬 Support",
        th: "💬 ช่วยเหลือ",
        zh: "💬 客服",
      },
      warranty: {
        vi: "🛡️ Bảo hành",
        en: "🛡️ Warranty",
        th: "🛡️ การรับประกัน",
        zh: "🛡️ 售后保障",
      },
      language: {
        vi: "🌐 Ngôn ngữ",
        en: "🌐 Language",
        th: "🌐 ภาษา",
        zh: "🌐 语言",
      },
      home: {
        vi: "🏠 Trang chủ",
        en: "🏠 Home",
        th: "🏠 หน้าหลัก",
        zh: "🏠 首页",
      },
      affiliate: {
        vi: "🤝 Affiliate",
        en: "🤝 Affiliate",
        th: "🤝 แนะนำเพื่อน",
        zh: "🤝 推广返佣",
      },
      apiKey: {
        vi: "🔑 API Key",
        en: "🔑 API Key",
        th: "🔑 API Key",
        zh: "🔑 API 密钥",
      },
      viewAll: {
        vi: "⬅️ Xem tất cả",
        en: "⬅️ All products",
        th: "⬅️ สินค้าทั้งหมด",
        zh: "⬅️ 全部商品",
      },
      buyOther: {
        vi: "⬅️ Chọn sản phẩm khác",
        en: "⬅️ Choose another product",
        th: "⬅️ เลือกสินค้าอื่น",
        zh: "⬅️ 选择其他商品",
      },
      payWallet: {
        vi: "💰 Thanh toán bằng ví",
        en: "💰 Pay with Wallet",
        th: "💰 ชำระด้วยกระเป๋าเงิน",
        zh: "💰 钱包支付",
      },
      payQR: {
        vi: "💳 Thanh toán QR / Chuyển khoản",
        en: "💳 Pay with QR / Bank",
        th: "💳 ชำระด้วย QR / โอนเงิน",
        zh: "💳 二维码 / 银行转账",
      },
      payBinance: {
        vi: "🟡 Thanh toán Binance",
        en: "🟡 Pay with Binance",
        th: "🟡 ชำระด้วย Binance",
        zh: "🟡 Binance 支付",
      },
      payUsdt: {
        vi: "Thanh toán USDT (TRC20)",
        en: "Pay with USDT (TRC20)",
        th: "ชำระด้วย USDT (TRC20)",
      },
      paySol: {
        vi: "Thanh toán USDT (Solana)",
        en: "Pay with USDT (Solana)",
        th: "ชำระด้วย USDT (Solana)",
      },
      payTon: {
        vi: "Thanh toán USDT (TON)",
        en: "Pay with USDT (TON)",
        th: "ชำระด้วย USDT (TON)",
      },
      payPaypal: {
        vi: "🅿️ Thanh toán PayPal",
        en: "🅿️ Pay with PayPal",
        th: "🅿️ ชำระด้วย PayPal",
      },
      paid: {
        vi: "✅ Tôi đã thanh toán",
        en: "✅ I've paid",
        th: "✅ ฉันชำระแล้ว",
        zh: "✅ 我已付款",
      },
      buyNow: {
        vi: "🛒 Mua ngay",
        en: "🛒 Buy now",
        th: "🛒 ซื้อเลย",
        zh: "🛒 立即购买",
      },
      back: { vi: "⬅️ Quay lại", en: "⬅️ Back", th: "⬅️ กลับ", zh: "⬅️ 返回" },
      contactAdmin: {
        vi: "💬 Liên hệ admin",
        en: "💬 Contact admin",
        th: "💬 ติดต่อแอดมิน",
        zh: "💬 联系管理员",
      },
      openCheckout: {
        vi: "💳 Mở trang thanh toán",
        en: "💳 Open payment page",
        th: "💳 เปิดหน้าชำระเงิน",
        zh: "💳 打开支付页面",
      },
      retry: {
        vi: "🔄 Thử lại",
        en: "🔄 Retry",
        th: "🔄 ลองใหม่",
        zh: "🔄 重试",
      },
      txHash: {
        vi: "🧾 Gửi TX hash",
        en: "🧾 Send TX hash",
        th: "🧾 ส่ง TX hash",
        zh: "🧾 提交交易哈希",
      },
    };

    return labels[key]?.[language] ?? labels[key]?.["en"] ?? key;
  }

  buildSupportText(
    shopName: string,
    supportTelegram: string | null,
    supportZalo: string | null,
    language: BotLanguage = "vi",
    supportNote?: string | null,
  ) {
    const note = supportNote?.trim()
      ? this.sanitizeTelegramHtml(supportNote.trim())
      : null;
    if (language === "en") {
      return [
        `💬 Support | ${shopName}`,
        "",
        note ? note : null,
        note ? "" : null,
        supportTelegram ? `Telegram: ${supportTelegram}` : null,
        supportZalo ? `Zalo: ${supportZalo}` : null,
        !supportTelegram && !supportZalo
          ? "Please reply right here in this chat — the shop will assist you."
          : null,
        "",
        "When you need help, please include your order code so support can check faster.",
      ]
        .filter((l) => l !== null)
        .join("\n");
    }

    if (language === "th") {
      return [
        `💬 ช่วยเหลือ | ${shopName}`,
        "",
        note ? note : null,
        note ? "" : null,
        supportTelegram ? `Telegram: ${supportTelegram}` : null,
        supportZalo ? `Zalo: ${supportZalo}` : null,
        !supportTelegram && !supportZalo
          ? "กรุณาตอบกลับในแชทนี้ ทางร้านจะช่วยเหลือคุณ"
          : null,
        "",
        "เมื่อต้องการความช่วยเหลือ กรุณาแนบรหัสคำสั่งซื้อเพื่อให้ทีมงานตรวจสอบได้รวดเร็วขึ้น",
      ]
        .filter((l) => l !== null)
        .join("\n");
    }

    if (language === "zh") {
      return [
        `💬 客服 | ${shopName}`,
        "",
        note ? note : null,
        note ? "" : null,
        supportTelegram ? `Telegram: ${supportTelegram}` : null,
        supportZalo ? `Zalo: ${supportZalo}` : null,
        !supportTelegram && !supportZalo
          ? "请直接在此聊天中回复，商家会为您提供帮助。"
          : null,
        "",
        "需要帮助时，请附上订单号，以便客服更快处理。",
      ]
        .filter((l) => l !== null)
        .join("\n");
    }

    return [
      `💬 Hỗ trợ | ${shopName}`,
      "",
      note ? note : null,
      note ? "" : null,
      supportTelegram ? `Telegram: ${supportTelegram}` : null,
      supportZalo ? `Zalo: ${supportZalo}` : null,
      !supportTelegram && !supportZalo
        ? "Bạn cứ nhắn ngay trong khung chat này — shop sẽ hỗ trợ bạn."
        : null,
      "",
      "Khi cần hỗ trợ, vui lòng gửi kèm mã đơn hàng để được xử lý nhanh hơn.",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  buildHomeText(
    shopName: string,
    tagline: string,
    productCount: number,
    availableCount: number,
    language: BotLanguage = "vi",
    footerOverride?: string,
    iconOverride?: string,
  ) {
    const safeName = this.escapeHtml(shopName);
    const safeTagline = this.sanitizeTelegramHtml(tagline);
    const icon = iconOverride !== undefined ? iconOverride.trim() : "🔥";
    const title = icon ? `${icon} <b>${safeName}</b>` : `<b>${safeName}</b>`;

    if (language === "en") {
      const footer =
        footerOverride != null
          ? this.sanitizeTelegramHtml(footerOverride)
          : "Choose a product below to start ↘️";
      return [title, safeTagline, ...(footer ? ["", footer] : [])].join("\n");
    }

    if (language === "th") {
      const footer =
        footerOverride != null
          ? this.sanitizeTelegramHtml(footerOverride)
          : "เลือกสินค้าด้านล่างเพื่อเริ่มต้น ↘️";
      return [title, safeTagline, ...(footer ? ["", footer] : [])].join("\n");
    }

    if (language === "zh") {
      const footer =
        footerOverride != null
          ? this.sanitizeTelegramHtml(footerOverride)
          : "请选择下方商品开始购买 ↘️";
      return [title, safeTagline, ...(footer ? ["", footer] : [])].join("\n");
    }

    const footer =
      footerOverride != null
        ? this.sanitizeTelegramHtml(footerOverride)
        : "Chọn sản phẩm bên dưới để bắt đầu nhé ↘️";
    return [title, safeTagline, ...(footer ? ["", footer] : [])].join("\n");
  }

  buildGuideText(shopName: string, language: BotLanguage = "vi") {
    if (language === "en") {
      return [
        `📘 Buying guide | ${shopName}`,
        "",
        "1. Open the product list.",
        "2. Choose the package you want.",
        "3. Reply with the quantity.",
        "4. Choose a payment method.",
        "5. For USDT TRC20, transfer to the shown address then send the tx hash.",
        "6. Auto-verified payments deliver right after confirmation.",
      ].join("\n");
    }

    if (language === "th") {
      return [
        `📘 คู่มือการซื้อ | ${shopName}`,
        "",
        "1. เปิดรายการสินค้า",
        "2. เลือกแพ็กเกจที่ต้องการ",
        "3. ตอบกลับด้วยจำนวนที่ต้องการ",
        "4. เลือกวิธีชำระเงิน",
        "5. สำหรับ USDT TRC20 ให้โอนไปยังที่อยู่ที่แสดงแล้วส่ง tx hash",
        "6. การชำระเงินที่ยืนยันอัตโนมัติจะจัดส่งทันทีหลังยืนยัน",
      ].join("\n");
    }

    if (language === "zh") {
      return [
        `📘 购买指南 | ${shopName}`,
        "",
        "1. 打开商品列表。",
        "2. 选择所需套餐。",
        "3. 回复购买数量。",
        "4. 选择付款方式。",
        "5. 使用 USDT TRC20 时，请转账到显示的地址并发送交易哈希。",
        "6. 自动验证付款后，系统会立即发货。",
      ].join("\n");
    }

    return [
      `📘 Hướng dẫn mua hàng | ${shopName}`,
      "",
      "1. Bấm vào danh sách sản phẩm.",
      "2. Chọn gói bạn muốn mua.",
      "3. Nhắn số lượng cần mua vào khung chat.",
      "4. Chọn phương thức thanh toán.",
      "5. Với USDT TRC20, chuyển vào địa chỉ bot hiển thị rồi gửi tx hash.",
      "6. Đơn được xác minh tự động sẽ giao ngay sau khi khớp thanh toán.",
    ].join("\n");
  }
}
