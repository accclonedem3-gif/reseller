import { useState, useEffect, useCallback } from "react";

interface BotCustomization {
  welcomeMessage?: { vi?: string; en?: string };
  footerBill?: { vi?: string; en?: string };
  productNote?: { vi?: string; en?: string };
  catalogText?: { vi?: string; en?: string };
  homeFooter?: { vi?: string; en?: string };
  walletNote?: { vi?: string; en?: string };
  homeIcon?: string;
  messageEmojiIds?: {
    welcomeMessage?: string;
    productNote?: string;
    footerBill?: string;
    quantityInput?: string;
    orderCreated?: string;
    bankInfo?: string;
    catalog?: string;
    categories?: string;
    otherProducts?: string;
    stockAdded?: string;
  };
  labelEmojiIds?: { price?: string; stock?: string; sold?: string; format?: string; description?: string };
  labelEmojis?: { price?: string; stock?: string; sold?: string; format?: string; description?: string };
  outOfStockEmojiId?: string;
  buttonEmojis?: Record<string, string>;
  buttonEmojiIds?: Record<string, string>;
  buttonLabels?: Record<string, { vi?: string; en?: string }>;
}

const PRODUCT_LABEL_KEYS = ["price", "stock", "sold", "format", "description"] as const;
const PRODUCT_LABEL_DEFAULTS: Record<string, { vi: string; emoji: string }> = {
  price:       { vi: "Giá", emoji: "💳" },
  stock:       { vi: "Tồn kho", emoji: "📦" },
  sold:        { vi: "Đã bán", emoji: "📊" },
  format:      { vi: "Định dạng", emoji: "🔑" },
  description: { vi: "Mô tả", emoji: "💬" },
};

const BUTTON_KEYS = [
  "products", "orders", "wallet", "guide", "support", "warranty",
  "language", "home", "affiliate", "refresh", "viewAll", "buyOther",
  "apiKey", "payWallet", "payQR", "payBinance", "payOkx", "payUsdt", "paid", "buyNow",
] as const;

const DEFAULT_EMOJIS: Record<string, string> = {
  products: "🛍️", orders: "📦", wallet: "💳", guide: "📘", support: "💬",
  warranty: "🛡️", language: "🌐", home: "🏠", affiliate: "🤝", refresh: "🔄",
  viewAll: "⬅️", buyOther: "⬅️", apiKey: "🔑", payWallet: "💰", payQR: "💳",
  payBinance: "🟡", payOkx: "⚫", payUsdt: "", paid: "✅", buyNow: "🛒",
};

const BUTTON_LABELS_VI: Record<string, string> = {
  products: "Sản phẩm", orders: "Đơn hàng", wallet: "Ví", guide: "Cách mua",
  support: "Hỗ trợ", warranty: "Bảo hành", language: "Ngôn ngữ", home: "Trang chủ",
  refresh: "Làm mới", affiliate: "Affiliate", viewAll: "Xem tất cả",
  buyOther: "Chọn sản phẩm khác", apiKey: "API Key", payWallet: "Thanh toán bằng ví",
  payQR: "Thanh toán QR / Chuyển khoản", payBinance: "Thanh toán Binance",
  payOkx: "Thanh toán OKX", payUsdt: "Thanh toán USDT (TRC20)",
  paid: "Tôi đã thanh toán", buyNow: "Mua ngay",
};

const BUTTON_GROUPS: { label: string; keys: (typeof BUTTON_KEYS)[number][] }[] = [
  { label: "Điều hướng chính", keys: ["home", "products", "orders", "wallet", "guide", "support", "warranty", "language", "affiliate", "refresh"] },
  { label: "Danh mục / Chọn lại", keys: ["viewAll", "buyOther"] },
  { label: "Thanh toán", keys: ["payWallet", "payQR", "payBinance", "payOkx", "payUsdt", "paid"] },
  { label: "Mua hàng", keys: ["buyNow", "apiKey"] },
];

const DEFAULT_LABELS_VI = BUTTON_LABELS_VI;

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        themeParams?: Record<string, string>;
        ready?: () => void;
      };
    };
  }
}

type Tab = "messages" | "buttons" | "emoji" | "products";

interface ProductIconEntry {
  id: string;
  name: string;
  productIcon: string | null;
  iconCustomEmojiId: string | null;
  iconOutOfStockEmojiId: string | null;
  available: number | null;
}

export function MiniAppSettingsPage() {
  const [sdkReady, setSdkReady] = useState(false);
  const [initData, setInitData] = useState<string | null>(null);
  const [themeParams, setThemeParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("messages");
  const [products, setProducts] = useState<ProductIconEntry[]>([]);
  const [productIcons, setProductIcons] = useState<Record<string, { iconCustomEmojiId: string; iconOutOfStockEmojiId: string }>>({});
  const [savingProducts, setSavingProducts] = useState(false);
  const [saveProductsSuccess, setSaveProductsSuccess] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [isGlobalDefault, setIsGlobalDefault] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalDefaultSaved, setGlobalDefaultSaved] = useState(false);

  const [customization, setCustomization] = useState<BotCustomization>({
    welcomeMessage: { vi: "", en: "" },
    footerBill: { vi: "", en: "" },
    productNote: { vi: "", en: "" },
    catalogText: { vi: "", en: "" },
    homeFooter: { vi: "", en: "" },
    walletNote: { vi: "", en: "" },
    homeIcon: undefined,
    messageEmojiIds: {},
    labelEmojiIds: {},
    labelEmojis: {},
    outOfStockEmojiId: "",
    buttonEmojis: { ...DEFAULT_EMOJIS },
    buttonEmojiIds: {},
    buttonLabels: Object.fromEntries(BUTTON_KEYS.map((k) => [k, { vi: DEFAULT_LABELS_VI[k], en: "" }])),
  });

  useEffect(() => {
    const existing = document.getElementById("telegram-webapp-sdk");
    if (existing) { setSdkReady(true); return; }
    const script = document.createElement("script");
    script.id = "telegram-webapp-sdk";
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => setSdkReady(true);
    script.onerror = () => setError("Failed to load Telegram SDK.");
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!sdkReady) return;
    const twa = window.Telegram?.WebApp;
    if (twa?.ready) twa.ready();
    setInitData(twa?.initData || null);
    const tp = twa?.themeParams || {};
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(tp)) {
      if (typeof v === "string") mapped[k] = v;
    }
    setThemeParams(mapped);
  }, [sdkReady]);

  const fetchSettings = useCallback(async () => {
    if (initData === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/mini-app/settings`, { headers: { "x-twa-init-data": initData } });
      if (res.status === 401 || res.status === 403) { setError("Xác thực thất bại. Vui lòng mở trong Telegram."); return; }
      if (!res.ok) { setError(`Lỗi máy chủ: ${res.status}`); return; }
      const data = await res.json();
      if (typeof data?.isGlobalDefault === "boolean") setIsGlobalDefault(data.isGlobalDefault);
      if (typeof data?.isSuperAdmin === "boolean") setIsSuperAdmin(data.isSuperAdmin);
      if (data?.customization) {
        setCustomization((prev) => ({
          welcomeMessage: { vi: "", en: "", ...prev.welcomeMessage, ...data.customization.welcomeMessage },
          footerBill: { vi: "", en: "", ...prev.footerBill, ...data.customization.footerBill },
          productNote: { vi: "", en: "", ...prev.productNote, ...data.customization.productNote },
          catalogText: { vi: "", en: "", ...prev.catalogText, ...data.customization.catalogText },
          homeFooter: { vi: "", en: "", ...prev.homeFooter, ...data.customization.homeFooter },
          walletNote: { vi: "", en: "", ...prev.walletNote, ...data.customization.walletNote },
          homeIcon: data.customization.homeIcon !== undefined ? data.customization.homeIcon : prev.homeIcon,
          messageEmojiIds: { ...prev.messageEmojiIds, ...data.customization.messageEmojiIds },
          labelEmojiIds: { ...prev.labelEmojiIds, ...data.customization.labelEmojiIds },
          labelEmojis: { ...prev.labelEmojis, ...data.customization.labelEmojis },
          outOfStockEmojiId: data.customization.outOfStockEmojiId ?? prev.outOfStockEmojiId ?? "",
          buttonEmojis: { ...DEFAULT_EMOJIS, ...data.customization.buttonEmojis },
          buttonEmojiIds: { ...data.customization.buttonEmojiIds },
          buttonLabels: {
            ...Object.fromEntries(BUTTON_KEYS.map((k) => [k, { vi: DEFAULT_LABELS_VI[k], en: "" }])),
            ...data.customization.buttonLabels,
          },
        }));
      }
    } catch (err) {
      setError(`Lỗi mạng: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [initData]);

  const fetchProducts = useCallback(async () => {
    if (initData === null) return;
    try {
      const res = await fetch(`${API_BASE}/mini-app/products`, { headers: { "x-twa-init-data": initData } });
      if (!res.ok) return;
      const data: ProductIconEntry[] = await res.json();
      setProducts(data);
      setProductIcons(Object.fromEntries(
        data.map((p) => [p.id, { iconCustomEmojiId: p.iconCustomEmojiId || "", iconOutOfStockEmojiId: p.iconOutOfStockEmojiId || "" }])
      ));
    } catch {}
  }, [initData]);

  const handleSaveProducts = async () => {
    if (!initData) return;
    setSavingProducts(true);
    setSaveProductsSuccess(false);
    try {
      const res = await fetch(`${API_BASE}/mini-app/product-icons`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-twa-init-data": initData },
        body: JSON.stringify({ productIcons }),
      });
      if (res.ok) {
        setSaveProductsSuccess(true);
        setTimeout(() => setSaveProductsSuccess(false), 2500);
        fetchProducts();
      }
    } catch {}
    setSavingProducts(false);
  };

  useEffect(() => {
    if (sdkReady && initData !== null) {
      fetchSettings();
      fetchProducts();
    } else if (sdkReady && initData === "") {
      setLoading(false);
      setError("Không tìm thấy dữ liệu Telegram. Vui lòng mở trong Telegram.");
    }
  }, [sdkReady, initData, fetchSettings, fetchProducts]);

  const handleSave = async () => {
    if (!initData) return;
    setSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/mini-app/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-twa-init-data": initData },
        body: JSON.stringify({ customization }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message || `Lưu thất bại: ${res.status}`);
        return;
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch {
      setError("Lỗi mạng. Không thể lưu cài đặt.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleGlobalDefault = async (enable: boolean) => {
    if (!initData) return;
    setSavingGlobal(true);
    setGlobalDefaultSaved(false);
    try {
      const res = await fetch(`${API_BASE}/mini-app/global-default`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-twa-init-data": initData },
        body: JSON.stringify({ enable }),
      });
      if (res.ok) {
        setIsGlobalDefault(enable);
        setGlobalDefaultSaved(true);
        setTimeout(() => setGlobalDefaultSaved(false), 2500);
      }
    } catch {}
    setSavingGlobal(false);
  };

  const bg = themeParams.bg_color || "#18181b";
  const secondaryBg = themeParams.secondary_bg_color || "#27272a";
  const textColor = themeParams.text_color || "#fafafa";
  const hintColor = themeParams.hint_color || "#71717a";
  const buttonColor = themeParams.button_color || "#3b82f6";
  const buttonTextColor = themeParams.button_text_color || "#ffffff";
  const linkColor = themeParams.link_color || "#60a5fa";

  const isDark = bg.toLowerCase() < "#888888";
  const cardBg = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const successColor = "#22c55e";
  const dangerColor = "#ef4444";

  const inp: React.CSSProperties = {
    backgroundColor: cardBg,
    color: textColor,
    border: `1px solid ${borderColor}`,
    borderRadius: "10px",
    padding: "10px 12px",
    width: "100%",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "system-ui, -apple-system, sans-serif",
  };

  const lbl: React.CSSProperties = {
    color: hintColor,
    fontSize: "12px",
    marginBottom: "5px",
    display: "block",
    fontWeight: 500,
    letterSpacing: "0.3px",
  };

  const card: React.CSSProperties = {
    backgroundColor: secondaryBg,
    borderRadius: "14px",
    padding: "14px 16px",
    marginBottom: "10px",
    border: `1px solid ${borderColor}`,
  };

  const sectionTitle = (icon: string, text: string, hint?: string) => (
    <div style={{ marginBottom: hint ? "10px" : "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "18px" }}>{icon}</span>
        <span style={{ color: textColor, fontWeight: 700, fontSize: "15px" }}>{text}</span>
      </div>
      {hint && <div style={{ color: hintColor, fontSize: "12px", marginTop: "4px", paddingLeft: "26px" }}>{hint}</div>}
    </div>
  );

  const idInput = (
    value: string,
    onChange: (val: string) => void,
    label?: string,
    placeholder = "document_id — VD: 5364339557712020484",
  ) => (
    <div style={{ marginTop: label ? "0" : "0" }}>
      {label && <label style={lbl}>{label}</label>}
      <div style={{ position: "relative" }}>
        <input
          type="text"
          inputMode="numeric"
          style={{ ...inp, paddingRight: value ? "36px" : "12px" }}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        />
        {value && (
          <button
            onClick={() => onChange("")}
            style={{
              position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: hintColor, cursor: "pointer",
              fontSize: "16px", lineHeight: 1, padding: "2px 4px",
            }}
          >×</button>
        )}
        {value && (
          <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: successColor, display: "inline-block" }} />
            <span style={{ color: successColor, fontSize: "11px" }}>ID đã set</span>
          </div>
        )}
      </div>
    </div>
  );

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: "messages", icon: "✉️", label: "Tin nhắn" },
    { key: "buttons", icon: "🔘", label: "Nút bấm" },
    { key: "emoji", icon: "✨", label: "Emoji" },
    { key: "products", icon: "📦", label: "Sản phẩm" },
  ];

  const spinnerStyle: React.CSSProperties = {
    width: "28px", height: "28px",
    border: `3px solid ${borderColor}`,
    borderTopColor: buttonColor,
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
    margin: "0 auto 12px",
  };

  if (!sdkReady || loading) {
    return (
      <div style={{ backgroundColor: bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={spinnerStyle} />
          <div style={{ color: hintColor, fontSize: "14px" }}>Đang tải...</div>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div style={{ backgroundColor: bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div style={{ ...card, textAlign: "center", maxWidth: "300px", width: "100%" }}>
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>⚠️</div>
          <div style={{ color: textColor, marginBottom: "16px", fontSize: "14px", lineHeight: 1.5 }}>{error}</div>
          <button onClick={fetchSettings} style={{ backgroundColor: buttonColor, color: buttonTextColor, border: "none", borderRadius: "10px", padding: "10px 24px", fontSize: "15px", cursor: "pointer", fontWeight: 600 }}>
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()));

  return (
    <div style={{ backgroundColor: bg, color: textColor, minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "15px" }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        input::placeholder{color:${hintColor};opacity:0.7}
        textarea::placeholder{color:${hintColor};opacity:0.7}
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {/* Tab bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, backgroundColor: bg, borderBottom: `1px solid ${borderColor}`, padding: "8px 12px 0" }}>
        <div style={{ display: "flex", gap: "2px" }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1, padding: "8px 4px 10px", border: "none", background: "none",
                  color: active ? buttonColor : hintColor,
                  fontSize: "11px", fontWeight: active ? 700 : 500, cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
                  borderBottom: active ? `2.5px solid ${buttonColor}` : "2.5px solid transparent",
                  transition: "color 0.15s, border-color 0.15s",
                  marginBottom: "-1px",
                }}
              >
                <span style={{ fontSize: "18px" }}>{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div key={activeTab} style={{ padding: "14px 12px 120px", animation: "fadeIn 0.18s ease" }}>

        {/* ── Tab: Tin nhắn ── */}
        {activeTab === "messages" && (
          <div>
            {isSuperAdmin && (
              <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: textColor, fontWeight: 600, fontSize: "14px" }}>Mẫu mặc định hệ thống</div>
                  <div style={{ color: hintColor, fontSize: "12px", marginTop: "2px" }}>Bot chưa cài sẽ dùng giao diện này</div>
                  {globalDefaultSaved && <div style={{ color: successColor, fontSize: "12px", marginTop: "3px" }}>✓ Đã lưu</div>}
                </div>
                <button
                  onClick={() => handleToggleGlobalDefault(!isGlobalDefault)}
                  disabled={savingGlobal}
                  style={{
                    position: "relative", width: "50px", height: "28px", borderRadius: "14px", border: "none",
                    backgroundColor: isGlobalDefault ? successColor : hintColor,
                    cursor: savingGlobal ? "not-allowed" : "pointer", flexShrink: 0,
                    transition: "background-color 0.2s",
                  }}
                >
                  <span style={{
                    position: "absolute", top: "3px", left: isGlobalDefault ? "25px" : "3px",
                    width: "22px", height: "22px", borderRadius: "50%", backgroundColor: "#fff",
                    transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }} />
                </button>
              </div>
            )}

            {/* Welcome message */}
            <div style={card}>
              {sectionTitle("👋", "Tin nhắn chào mừng", "Hiện khi khách gõ /start lần đầu")}
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇻🇳 Tiếng Việt</label>
                <textarea rows={3} style={{ ...inp, resize: "vertical" }} placeholder="Chào mừng bạn đến với shop..." value={customization.welcomeMessage?.vi || ""} onChange={(e) => setCustomization((p) => ({ ...p, welcomeMessage: { ...p.welcomeMessage, vi: e.target.value } }))} />
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇺🇸 English</label>
                <textarea rows={3} style={{ ...inp, resize: "vertical" }} placeholder="Welcome to our shop..." value={customization.welcomeMessage?.en || ""} onChange={(e) => setCustomization((p) => ({ ...p, welcomeMessage: { ...p.welcomeMessage, en: e.target.value } }))} />
              </div>
              {idInput(
                customization.messageEmojiIds?.welcomeMessage || "",
                (val) => setCustomization((p) => ({ ...p, messageEmojiIds: { ...p.messageEmojiIds, welcomeMessage: val } })),
                "✨ Icon động (document_id)",
              )}
            </div>

            {/* Footer bill */}
            <div style={card}>
              {sectionTitle("🧾", "Chân hóa đơn", "Hiện cuối tin nhắn sau khi tạo đơn")}
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇻🇳 Tiếng Việt</label>
                <textarea rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Cảm ơn bạn đã mua hàng..." value={customization.footerBill?.vi || ""} onChange={(e) => setCustomization((p) => ({ ...p, footerBill: { ...p.footerBill, vi: e.target.value } }))} />
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇺🇸 English</label>
                <textarea rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Thank you for your order..." value={customization.footerBill?.en || ""} onChange={(e) => setCustomization((p) => ({ ...p, footerBill: { ...p.footerBill, en: e.target.value } }))} />
              </div>
              {idInput(
                customization.messageEmojiIds?.footerBill || "",
                (val) => setCustomization((p) => ({ ...p, messageEmojiIds: { ...p.messageEmojiIds, footerBill: val } })),
                "✨ Icon động (document_id)",
              )}
            </div>

            {/* Product note */}
            <div style={card}>
              {sectionTitle("📝", "Ghi chú sản phẩm", "Hiện dưới info sản phẩm khi khách chọn mua")}
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇻🇳 Tiếng Việt</label>
                <textarea rows={2} style={{ ...inp, resize: "vertical" }} placeholder="VD: Tài khoản bảo hành 30 ngày..." value={customization.productNote?.vi || ""} onChange={(e) => setCustomization((p) => ({ ...p, productNote: { ...p.productNote, vi: e.target.value } }))} />
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇺🇸 English</label>
                <textarea rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Account is warranted for 30 days..." value={customization.productNote?.en || ""} onChange={(e) => setCustomization((p) => ({ ...p, productNote: { ...p.productNote, en: e.target.value } }))} />
              </div>
              {idInput(
                customization.messageEmojiIds?.productNote || "",
                (val) => setCustomization((p) => ({ ...p, messageEmojiIds: { ...p.messageEmojiIds, productNote: val } })),
                "✨ Icon động (document_id)",
              )}
            </div>

            {/* Home icon */}
            <div style={card}>
              {sectionTitle("🔥", "Icon trước tên shop", "Để trống = ẩn icon, mặc định là 🔥")}
              <input
                type="text"
                style={inp}
                placeholder="🔥"
                value={customization.homeIcon ?? ""}
                onChange={(e) => setCustomization((p) => ({ ...p, homeIcon: e.target.value }))}
              />
            </div>

            {/* Home footer */}
            <div style={card}>
              {sectionTitle("🏠", "Dòng kêu gọi trang chủ", "Dòng cuối màn hình chính (để trống = dùng mặc định)")}
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇻🇳 Tiếng Việt</label>
                <textarea rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Chọn sản phẩm bên dưới để bắt đầu nhé ↘️" value={customization.homeFooter?.vi || ""} onChange={(e) => setCustomization((p) => ({ ...p, homeFooter: { ...p.homeFooter, vi: e.target.value } }))} />
              </div>
              <div>
                <label style={lbl}>🇺🇸 English</label>
                <textarea rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Choose a product below to start ↘️" value={customization.homeFooter?.en || ""} onChange={(e) => setCustomization((p) => ({ ...p, homeFooter: { ...p.homeFooter, en: e.target.value } }))} />
              </div>
            </div>

            {/* Catalog text */}
            <div style={card}>
              {sectionTitle("🛒", "Nội dung danh sách sản phẩm", "Hiện trên màn hình /products (để trống = chỉ hiện tiêu đề)")}
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇻🇳 Tiếng Việt</label>
                <textarea rows={3} style={{ ...inp, resize: "vertical" }} placeholder="VD: Chọn sản phẩm bên dưới để mua..." value={customization.catalogText?.vi || ""} onChange={(e) => setCustomization((p) => ({ ...p, catalogText: { ...p.catalogText, vi: e.target.value } }))} />
              </div>
              <div>
                <label style={lbl}>🇺🇸 English</label>
                <textarea rows={3} style={{ ...inp, resize: "vertical" }} placeholder="Choose a product below to purchase..." value={customization.catalogText?.en || ""} onChange={(e) => setCustomization((p) => ({ ...p, catalogText: { ...p.catalogText, en: e.target.value } }))} />
              </div>
            </div>

            {/* Wallet note */}
            <div style={card}>
              {sectionTitle("💳", "Ghi chú ví", "Hiện ngay đầu màn hình Ví khi khách bấm xem ví (để trống = không hiện)")}
              <div style={{ marginBottom: "10px" }}>
                <label style={lbl}>🇻🇳 Tiếng Việt</label>
                <textarea rows={3} style={{ ...inp, resize: "vertical" }} placeholder="VD: Nạp ví để mua nhanh hơn — số dư dùng cho mọi đơn." value={customization.walletNote?.vi || ""} onChange={(e) => setCustomization((p) => ({ ...p, walletNote: { ...p.walletNote, vi: e.target.value } }))} />
              </div>
              <div>
                <label style={lbl}>🇺🇸 English</label>
                <textarea rows={3} style={{ ...inp, resize: "vertical" }} placeholder="Top up your wallet for faster checkout..." value={customization.walletNote?.en || ""} onChange={(e) => setCustomization((p) => ({ ...p, walletNote: { ...p.walletNote, en: e.target.value } }))} />
              </div>
            </div>

            {/* System message icons */}
            <div style={card}>
              {sectionTitle("🎨", "Icon tin nhắn hệ thống", "Thay emoji tĩnh bằng animated icon")}
              {([
                { key: "catalog", label: "🛒 Tiêu đề danh sách sản phẩm" },
                { key: "categories", label: "📂 Tiêu đề mục Danh mục" },
                { key: "otherProducts", label: "📦 Tiêu đề mục Sản phẩm khác" },
                { key: "quantityInput", label: "✏️ Nhập số lượng mua" },
                { key: "orderCreated", label: "✅ Tạo đơn hàng thành công" },
                { key: "bankInfo", label: "🏦 Thông tin chuyển khoản" },
                { key: "stockAdded", label: "➕ Số lượng thêm (thông báo kho)" },
              ] as { key: keyof NonNullable<BotCustomization["messageEmojiIds"]>; label: string }[]).map(({ key, label }, i, arr) => (
                <div key={key} style={{ marginBottom: i < arr.length - 1 ? "12px" : "0" }}>
                  {idInput(
                    customization.messageEmojiIds?.[key] || "",
                    (val) => setCustomization((p) => ({ ...p, messageEmojiIds: { ...p.messageEmojiIds, [key]: val } })),
                    label,
                  )}
                </div>
              ))}
            </div>

            {/* Label icons */}
            <div style={card}>
              {sectionTitle("🏷️", "Icon label trong card sản phẩm", "Chỉ chỉnh emoji động (Premium document_id). Emoji thường dùng mặc định hệ thống.")}
              {PRODUCT_LABEL_KEYS.map((key, i) => {
                const def = PRODUCT_LABEL_DEFAULTS[key]!;
                return (
                  <div key={key} style={{ marginBottom: i < PRODUCT_LABEL_KEYS.length - 1 ? "12px" : "0" }}>
                    {idInput(
                      customization.labelEmojiIds?.[key] || "",
                      (val) => setCustomization((p) => ({ ...p, labelEmojiIds: { ...p.labelEmojiIds, [key]: val } })),
                      `${def.emoji} ${def.vi}`,
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Tab: Nút bấm ── */}
        {activeTab === "buttons" && (
          <div>
            {BUTTON_GROUPS.map((group) => (
              <div key={group.label} style={card}>
                {sectionTitle("🔘", group.label)}
                {group.keys.map((key, i) => (
                  <div key={key} style={{
                    paddingBottom: i < group.keys.length - 1 ? "12px" : "0",
                    marginBottom: i < group.keys.length - 1 ? "12px" : "0",
                    borderBottom: i < group.keys.length - 1 ? `1px solid ${borderColor}` : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span style={{ fontSize: "18px", width: "24px", textAlign: "center" }}>
                        {customization.buttonEmojis?.[key] || DEFAULT_EMOJIS[key] || "•"}
                      </span>
                      <span style={{ color: textColor, fontSize: "13px", fontWeight: 600 }}>{BUTTON_LABELS_VI[key]}</span>
                      <span style={{ color: hintColor, fontSize: "11px", marginLeft: "auto", fontFamily: "monospace" }}>{key}</span>
                    </div>
                    <input
                      type="text"
                      style={inp}
                      placeholder={DEFAULT_LABELS_VI[key]}
                      value={customization.buttonLabels?.[key]?.vi || ""}
                      onChange={(e) => setCustomization((p) => ({
                        ...p,
                        buttonLabels: { ...p.buttonLabels, [key]: { ...p.buttonLabels?.[key], vi: e.target.value } },
                      }))}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: Emoji / ID ── */}
        {activeTab === "emoji" && (
          <div>
            {BUTTON_GROUPS.map((group) => (
              <div key={group.label} style={card}>
                {sectionTitle("✨", group.label)}
                {group.keys.map((key, i) => {
                  const emoji = customization.buttonEmojis?.[key] ?? DEFAULT_EMOJIS[key] ?? "";
                  const emojiId = customization.buttonEmojiIds?.[key] || "";
                  return (
                    <div key={key} style={{
                      paddingBottom: i < group.keys.length - 1 ? "14px" : "0",
                      marginBottom: i < group.keys.length - 1 ? "14px" : "0",
                      borderBottom: i < group.keys.length - 1 ? `1px solid ${borderColor}` : "none",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                        <div style={{
                          width: "36px", height: "36px", borderRadius: "10px",
                          backgroundColor: emojiId ? buttonColor + "22" : cardBg,
                          border: `1px solid ${emojiId ? buttonColor + "44" : borderColor}`,
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0,
                        }}>
                          {emoji || "·"}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: textColor, fontSize: "13px", fontWeight: 600 }}>{BUTTON_LABELS_VI[key]}</div>
                          <div style={{ color: hintColor, fontSize: "11px", fontFamily: "monospace" }}>{key}</div>
                        </div>
                        {emojiId && <span style={{ fontSize: "10px", backgroundColor: buttonColor + "22", color: linkColor, borderRadius: "6px", padding: "2px 6px", fontWeight: 600 }}>ID ✓</span>}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                        <div>
                          <label style={lbl}>Emoji Unicode</label>
                          <input
                            type="text"
                            style={inp}
                            placeholder={DEFAULT_EMOJIS[key] || "—"}
                            value={emoji}
                            onChange={(e) => setCustomization((p) => ({ ...p, buttonEmojis: { ...p.buttonEmojis, [key]: e.target.value } }))}
                          />
                        </div>
                        <div>
                          <label style={lbl}>Animated ID</label>
                          <div style={{ position: "relative" }}>
                            <input
                              type="text"
                              inputMode="numeric"
                              style={{ ...inp, paddingRight: emojiId ? "28px" : "12px" }}
                              placeholder="document_id"
                              value={emojiId}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, "");
                                setCustomization((p) => ({ ...p, buttonEmojiIds: { ...p.buttonEmojiIds, [key]: val } }));
                              }}
                            />
                            {emojiId && (
                              <button onClick={() => setCustomization((p) => ({ ...p, buttonEmojiIds: { ...p.buttonEmojiIds, [key]: "" } }))}
                                style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: hintColor, cursor: "pointer", fontSize: "15px", padding: "2px" }}>
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: Sản phẩm ── */}
        {activeTab === "products" && (
          <div>
            {/* Global OOS icon */}
            <div style={card}>
              {sectionTitle("🚫", "Icon hết hàng (toàn shop)", "Áp dụng cho tất cả sản phẩm khi available = 0")}
              {idInput(
                customization.outOfStockEmojiId || "",
                (val) => setCustomization((p) => ({ ...p, outOfStockEmojiId: val })),
                undefined,
              )}
              <div style={{ color: hintColor, fontSize: "11px", marginTop: "6px" }}>
                Lưu bằng nút "Lưu cài đặt" bên dưới
              </div>
            </div>

            {/* Per-product icons */}
            <div style={card}>
              {sectionTitle("🎯", "Icon từng sản phẩm")}
              <div style={{ position: "relative", marginBottom: "12px" }}>
                <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: hintColor, fontSize: "14px" }}>🔍</span>
                <input
                  type="text"
                  style={{ ...inp, paddingLeft: "34px" }}
                  placeholder="Tìm sản phẩm..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>

              {products.length === 0 && (
                <div style={{ textAlign: "center", color: hintColor, fontSize: "13px", padding: "20px 0" }}>Chưa có sản phẩm nào.</div>
              )}

              {filteredProducts.map((p, i) => {
                const icons = productIcons[p.id];
                const hasCustom = !!(icons?.iconCustomEmojiId);
                const isOos = p.available !== null && p.available <= 0;

                return (
                  <div key={p.id} style={{
                    paddingBottom: i < filteredProducts.length - 1 ? "14px" : "0",
                    marginBottom: i < filteredProducts.length - 1 ? "14px" : "0",
                    borderBottom: i < filteredProducts.length - 1 ? `1px solid ${borderColor}` : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <div style={{
                        width: "38px", height: "38px", borderRadius: "10px", flexShrink: 0,
                        backgroundColor: hasCustom ? buttonColor + "22" : cardBg,
                        border: `1px solid ${hasCustom ? buttonColor + "55" : borderColor}`,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px",
                      }}>
                        {hasCustom ? "✨" : (p.productIcon || "📦")}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: textColor, fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "2px", flexWrap: "wrap" }}>
                          {hasCustom && <span style={{ fontSize: "10px", backgroundColor: buttonColor + "22", color: linkColor, borderRadius: "5px", padding: "1px 5px", fontWeight: 600 }}>custom emoji ✓</span>}
                          {isOos && <span style={{ fontSize: "10px", backgroundColor: dangerColor + "22", color: dangerColor, borderRadius: "5px", padding: "1px 5px", fontWeight: 600 }}>Hết hàng</span>}
                          {!isOos && p.available !== null && <span style={{ fontSize: "10px", color: hintColor }}>Còn {p.available}</span>}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label style={lbl}>✨ Icon có hàng (document_id)</label>
                      <div style={{ position: "relative" }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          style={{ ...inp, paddingRight: icons?.iconCustomEmojiId ? "32px" : "12px" }}
                          placeholder="VD: 5364339557712020484"
                          value={icons?.iconCustomEmojiId || ""}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "");
                            setProductIcons((prev) => ({ ...prev, [p.id]: { iconCustomEmojiId: val, iconOutOfStockEmojiId: prev[p.id]?.iconOutOfStockEmojiId ?? "" } }));
                          }}
                        />
                        {icons?.iconCustomEmojiId && (
                          <button
                            onClick={() => setProductIcons((prev) => ({ ...prev, [p.id]: { iconCustomEmojiId: "", iconOutOfStockEmojiId: prev[p.id]?.iconOutOfStockEmojiId ?? "" } }))}
                            style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: hintColor, cursor: "pointer", fontSize: "16px", padding: "2px" }}>
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Save products button */}
            {saveProductsSuccess && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", color: successColor, fontSize: "14px", marginBottom: "10px", fontWeight: 600 }}>
                <span>✓</span> Đã lưu icon sản phẩm!
              </div>
            )}
            <button
              onClick={handleSaveProducts}
              disabled={savingProducts}
              style={{
                width: "100%", padding: "14px", border: "none", borderRadius: "14px",
                backgroundColor: savingProducts ? hintColor : buttonColor,
                color: buttonTextColor, fontSize: "15px", fontWeight: 700,
                cursor: savingProducts ? "not-allowed" : "pointer",
                boxShadow: savingProducts ? "none" : `0 4px 14px ${buttonColor}44`,
                transition: "all 0.2s",
              }}
            >
              {savingProducts ? "Đang lưu..." : "💾 Lưu icon sản phẩm"}
            </button>
          </div>
        )}
      </div>

      {/* Fixed bottom save bar — only for non-products tabs */}
      {activeTab !== "products" && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          padding: "10px 12px 12px",
          backgroundColor: bg,
          borderTop: `1px solid ${borderColor}`,
          backdropFilter: "blur(12px)",
        }}>
          {saveSuccess && (
            <div style={{ textAlign: "center", color: successColor, fontSize: "13px", marginBottom: "6px", fontWeight: 600 }}>
              ✓ Đã lưu thành công!
            </div>
          )}
          {error && !loading && (
            <div style={{ textAlign: "center", color: dangerColor, fontSize: "12px", marginBottom: "6px" }}>{error}</div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: "100%", padding: "14px", border: "none", borderRadius: "14px",
              backgroundColor: saving ? hintColor : buttonColor,
              color: buttonTextColor, fontSize: "15px", fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              boxShadow: saving ? "none" : `0 4px 14px ${buttonColor}44`,
              transition: "all 0.2s",
            }}
          >
            {saving ? "Đang lưu..." : "💾 Lưu cài đặt"}
          </button>
        </div>
      )}
    </div>
  );
}
