import { useEffect, useState } from "react";

export type ButtonsConfig = {
  labels: Record<string, Record<string, string>>;
  emojis: Record<string, string>;
  emojiIds: Record<string, string>;
};

type Lang = "vi" | "en" | "th";

type KeyDef = {
  key: string;
  emoji: string;
  label: Record<Lang, string>;
};

// Mirrors the bot's built-in defaults (telegram-bot.service.v2 replyKeyboardLabels +
// bot-render.helpers buttonLabel). Default label is WITHOUT the emoji — the bot prepends emoji.
const GROUPS: Array<{ title: string; keys: KeyDef[] }> = [
  {
    title: "Điều hướng / menu",
    keys: [
      { key: "home", emoji: "🏠", label: { vi: "Trang chủ", en: "Home", th: "หน้าหลัก" } },
      { key: "products", emoji: "🛍️", label: { vi: "Xem sản phẩm", en: "Products", th: "ดูสินค้า" } },
      { key: "productsShort", emoji: "🛍️", label: { vi: "Sản phẩm", en: "Products", th: "สินค้า" } },
      { key: "history", emoji: "📜", label: { vi: "Lịch sử mua", en: "Orders", th: "ประวัติคำสั่งซื้อ" } },
      { key: "orders", emoji: "📦", label: { vi: "Đơn hàng", en: "Orders", th: "คำสั่งซื้อ" } },
      { key: "wallet", emoji: "💳", label: { vi: "Ví", en: "Wallet", th: "กระเป๋าเงิน" } },
      { key: "support", emoji: "💬", label: { vi: "Liên hệ hỗ trợ", en: "Support", th: "ติดต่อฝ่ายช่วยเหลือ" } },
      { key: "supportShort", emoji: "💬", label: { vi: "Hỗ trợ", en: "Support", th: "ช่วยเหลือ" } },
      { key: "warranty", emoji: "🛡️", label: { vi: "Bảo hành", en: "Warranty", th: "การรับประกัน" } },
      { key: "language", emoji: "🌐", label: { vi: "Ngôn ngữ", en: "Language", th: "ภาษา" } },
      { key: "affiliate", emoji: "🤝", label: { vi: "Affiliate", en: "Affiliate", th: "แนะนำเพื่อน" } },
      { key: "guide", emoji: "📘", label: { vi: "Cách mua", en: "How to buy", th: "วิธีซื้อ" } },
      { key: "apiKey", emoji: "🔑", label: { vi: "API Key", en: "API Key", th: "API Key" } },
    ],
  },
  {
    title: "Mua hàng",
    keys: [
      { key: "buyNow", emoji: "🛒", label: { vi: "Mua ngay", en: "Buy now", th: "ซื้อเลย" } },
      { key: "refresh", emoji: "🔄", label: { vi: "Làm mới", en: "Refresh", th: "รีเฟรช" } },
      { key: "viewAll", emoji: "⬅️", label: { vi: "Xem tất cả", en: "All products", th: "สินค้าทั้งหมด" } },
      { key: "buyOther", emoji: "⬅️", label: { vi: "Chọn sản phẩm khác", en: "Choose another product", th: "เลือกสินค้าอื่น" } },
    ],
  },
  {
    title: "Thanh toán",
    keys: [
      { key: "payWallet", emoji: "💰", label: { vi: "Thanh toán bằng ví", en: "Pay with Wallet", th: "ชำระด้วยกระเป๋าเงิน" } },
      { key: "payQR", emoji: "💳", label: { vi: "Thanh toán QR / Chuyển khoản", en: "Pay with QR / Bank", th: "ชำระด้วย QR / โอนเงิน" } },
      { key: "payBinance", emoji: "🟡", label: { vi: "Thanh toán Binance", en: "Pay with Binance", th: "ชำระด้วย Binance" } },
      { key: "payUsdt", emoji: "", label: { vi: "Thanh toán USDT (TRC20)", en: "Pay with USDT (TRC20)", th: "ชำระด้วย USDT (TRC20)" } },
      { key: "paid", emoji: "✅", label: { vi: "Tôi đã thanh toán", en: "I've paid", th: "ฉันชำระแล้ว" } },
    ],
  },
  {
    title: "Khác (điều hướng / xác nhận)",
    keys: [
      { key: "back", emoji: "⬅️", label: { vi: "Quay lại", en: "Back", th: "กลับ" } },
      { key: "contactAdmin", emoji: "💬", label: { vi: "Liên hệ admin", en: "Contact admin", th: "ติดต่อแอดมิน" } },
      { key: "openCheckout", emoji: "💳", label: { vi: "Mở trang thanh toán", en: "Open payment page", th: "เปิดหน้าชำระเงิน" } },
      { key: "retry", emoji: "🔄", label: { vi: "Thử lại", en: "Retry", th: "ลองใหม่" } },
      { key: "txHash", emoji: "🧾", label: { vi: "Gửi TX hash", en: "Send TX hash", th: "ส่ง TX hash" } },
    ],
  },
];

interface Props {
  value: ButtonsConfig;
  onChange: (next: ButtonsConfig) => void;
  onSave: () => void;
  onReset: () => void;
  isSaving?: boolean;
}

export function ButtonsEditor({ value, onChange, onSave, onReset, isSaving }: Props) {
  const [lang, setLang] = useState<Lang>("vi");
  const [local, setLocal] = useState<ButtonsConfig>(normalize(value));

  useEffect(() => {
    setLocal(normalize(value));
  }, [JSON.stringify(value)]);

  function commit(next: ButtonsConfig) {
    setLocal(next);
    onChange(next);
  }

  function setLabel(key: string, text: string) {
    const entry: Record<string, string> = { ...(local.labels[key] ?? {}) };
    if (text.trim()) entry[lang] = text;
    else delete entry[lang];
    const labels = { ...local.labels };
    if (Object.keys(entry).length === 0) delete labels[key];
    else labels[key] = entry;
    commit({ ...local, labels });
  }

  function setEmoji(key: string, v: string) {
    const emojis = { ...local.emojis };
    if (v.trim()) emojis[key] = v;
    else delete emojis[key];
    commit({ ...local, emojis });
  }

  function setEmojiId(key: string, v: string) {
    const emojiIds = { ...local.emojiIds };
    if (v.trim()) emojiIds[key] = v.trim();
    else delete emojiIds[key];
    commit({ ...local, emojiIds });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Ngôn ngữ nhãn:</span>
        {(["vi", "en", "th"] as Lang[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className="rounded-lg px-3 py-1 text-[12px] font-black uppercase transition"
            style={
              lang === l
                ? { background: "rgb(16,185,129)", color: "#fff" }
                : { background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }
            }
          >
            {l}
          </button>
        ))}
        <span className="text-[10px]" style={{ color: "var(--tx-f)" }}>
          (để trống nhãn = dùng mặc định theo ngôn ngữ; emoji để trống = dùng emoji mặc định)
        </span>
      </div>

      {GROUPS.map((group) => (
        <div key={group.title} className="rounded-xl p-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
          <p className="mb-2 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{group.title}</p>
          <div className="space-y-2">
            {/* header row */}
            <div className="hidden gap-2 px-1 text-[10px] font-bold uppercase tracking-wider sm:grid" style={{ gridTemplateColumns: "92px 1fr 60px 150px 1fr", color: "var(--tx-f)" }}>
              <span>Nút</span><span>Nhãn ({lang})</span><span>Emoji</span><span>Custom emoji ID</span><span>Preview</span>
            </div>
            {group.keys.map((def) => {
              const label = local.labels[def.key]?.[lang] ?? "";
              const emoji = local.emojis[def.key] ?? "";
              const emojiId = local.emojiIds[def.key] ?? "";
              const previewEmoji = emoji.trim() || def.emoji;
              const previewLabel = label.trim() || def.label[lang];
              return (
                <div key={def.key} className="grid items-center gap-2" style={{ gridTemplateColumns: "92px 1fr 60px 150px 1fr" }}>
                  <span className="font-mono text-[11px]" style={{ color: "var(--tx-m)" }}>{def.key}</span>
                  <input
                    value={label}
                    onChange={(e) => setLabel(def.key, e.target.value)}
                    placeholder={def.label[lang]}
                    className={inputCls}
                    style={inputStyle}
                  />
                  <input
                    value={emoji}
                    onChange={(e) => setEmoji(def.key, e.target.value)}
                    placeholder={def.emoji || "—"}
                    className="rounded-lg px-1 py-1.5 text-center text-[14px] outline-none"
                    style={inputStyle}
                  />
                  <input
                    value={emojiId}
                    onChange={(e) => setEmojiId(def.key, e.target.value)}
                    placeholder="cusid (vd 5391...)"
                    className="rounded-lg px-2 py-1.5 font-mono text-[11px] outline-none"
                    style={inputStyle}
                  />
                  <span className="flex items-center gap-1 truncate text-[12.5px]" style={{ color: "var(--tx)" }}>
                    <span className="truncate rounded-md px-2 py-1" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
                      {`${previewEmoji} ${previewLabel}`.trim()}
                    </span>
                    {emojiId ? (
                      <span className="shrink-0 rounded px-1 text-[9px] font-black" style={{ background: "rgba(168,85,247,0.15)", color: "rgb(168,85,247)" }}>ID</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-xl px-4 py-2 text-[13px] font-black transition hover:opacity-90 disabled:opacity-40"
          style={{ background: "rgb(16,185,129)", color: "#fff" }}
        >
          {isSaving ? "Đang lưu..." : "💾 Lưu"}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
          style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
        >
          🔄 Xoá hết tuỳ chỉnh (về mặc định)
        </button>
      </div>

      <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>
        Custom emoji ID = icon động Telegram Premium. Mỗi bot inherit từ đây; shop tự sửa riêng vẫn được ưu tiên hơn.
        Nút "Mua ngay" (buyNow) cũng là nút trong thông báo nhập kho.
      </p>
    </div>
  );
}

function normalize(v: ButtonsConfig): ButtonsConfig {
  return {
    labels: v?.labels ? JSON.parse(JSON.stringify(v.labels)) : {},
    emojis: { ...(v?.emojis ?? {}) },
    emojiIds: { ...(v?.emojiIds ?? {}) },
  };
}

const inputCls = "w-full rounded-lg px-2.5 py-1.5 text-[13px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--bd)",
  color: "var(--tx)",
};
