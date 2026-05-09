import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck, ShieldAlert, Search, CheckCircle, Loader2, AlertCircle, Clock, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    invalidLink: "Link bảo hành không hợp lệ.",
    shopWarranty: (name: string) => `${name} — Bảo hành`,
    warranty: "Bảo hành sản phẩm",
    formTitle: "Yêu cầu bảo hành",
    formDesc: "Điền thông tin để tra cứu đơn hàng và mở yêu cầu bảo hành",
    labelContact: "Thông tin liên hệ",
    phContact: "SĐT/Zalo hoặc @username Telegram",
    hintContact: "Để xác định bạn là người mua hàng",
    labelAccount: "Tài khoản đã mua",
    phAccount: "Nhập tên đăng nhập / email tài khoản đã nhận",
    hintAccount: "Tài khoản bạn đã nhận từ shop, dùng để tìm đơn hàng",
    errRequired: "Vui lòng điền đầy đủ thông tin.",
    errNotFound: "Không tìm thấy đơn hàng nào phù hợp hoặc đơn hàng đã hết hạn bảo hành.",
    errDefault: "Đã có lỗi xảy ra. Vui lòng thử lại.",
    errClaim: "Không thể gửi yêu cầu bảo hành. Vui lòng thử lại.",
    searchBtn: "Tra cứu đơn hàng",
    backBtn: "Tìm kiếm lại",
    selectTitle: "Chọn đơn hàng cần bảo hành",
    purchasedAt: (d: string) => `Mua ngày: ${d}`,
    expiresAt: (d: string) => `HSD bảo hành: ${d}`,
    activeClaim: "Đang có yêu cầu bảo hành",
    descTitle: "Mô tả vấn đề (tùy chọn)",
    descPh: "Mô tả lỗi hoặc vấn đề bạn gặp phải...",
    submitBtn: "Gửi yêu cầu bảo hành",
    successTitle: "Bảo hành đã được duyệt!",
    successOrder: (code: string) => `Đơn #${code}`,
    replacementLabel: "Tài khoản thay thế",
    pendingTitle: "Yêu cầu đã được ghi nhận",
    pendingDefault: "Shop sẽ xử lý và liên hệ lại với bạn sớm.",
    supportLabel: "Liên hệ hỗ trợ",
  },
  en: {
    invalidLink: "Invalid warranty link.",
    shopWarranty: (name: string) => `${name} — Warranty`,
    warranty: "Product warranty",
    formTitle: "Submit warranty claim",
    formDesc: "Fill in your details to look up your order and submit a warranty request",
    labelContact: "Contact information",
    phContact: "Phone/Zalo or @username Telegram",
    hintContact: "To verify you are the buyer",
    labelAccount: "Purchased account",
    phAccount: "Enter the username / email of the account you received",
    hintAccount: "The account you received from the shop, used to find your order",
    errRequired: "Please fill in all required fields.",
    errNotFound: "No matching order found or the warranty has expired.",
    errDefault: "An error occurred. Please try again.",
    errClaim: "Could not submit warranty claim. Please try again.",
    searchBtn: "Look up order",
    backBtn: "Search again",
    selectTitle: "Select the order to warranty",
    purchasedAt: (d: string) => `Purchased: ${d}`,
    expiresAt: (d: string) => `Warranty expires: ${d}`,
    activeClaim: "Active warranty claim",
    descTitle: "Describe the issue (optional)",
    descPh: "Describe the error or issue you encountered...",
    submitBtn: "Submit warranty claim",
    successTitle: "Warranty approved!",
    successOrder: (code: string) => `Order #${code}`,
    replacementLabel: "Replacement account",
    pendingTitle: "Request recorded",
    pendingDefault: "The shop will process and contact you soon.",
    supportLabel: "Contact support",
  },
  th: {
    invalidLink: "ลิงก์การรับประกันไม่ถูกต้อง",
    shopWarranty: (name: string) => `${name} — การรับประกัน`,
    warranty: "การรับประกันสินค้า",
    formTitle: "ส่งคำร้องขอรับประกัน",
    formDesc: "กรอกข้อมูลเพื่อค้นหาคำสั่งซื้อและส่งคำร้องขอรับประกัน",
    labelContact: "ข้อมูลติดต่อ",
    phContact: "เบอร์โทร/Zalo หรือ @username Telegram",
    hintContact: "เพื่อยืนยันว่าคุณเป็นผู้ซื้อ",
    labelAccount: "บัญชีที่ซื้อ",
    phAccount: "ใส่ชื่อผู้ใช้ / อีเมลของบัญชีที่ได้รับ",
    hintAccount: "บัญชีที่คุณได้รับจากร้านค้า ใช้สำหรับค้นหาคำสั่งซื้อ",
    errRequired: "กรุณากรอกข้อมูลให้ครบถ้วน",
    errNotFound: "ไม่พบคำสั่งซื้อที่ตรงกันหรือการรับประกันหมดอายุแล้ว",
    errDefault: "เกิดข้อผิดพลาด กรุณาลองใหม่",
    errClaim: "ไม่สามารถส่งคำร้องขอรับประกันได้ กรุณาลองใหม่",
    searchBtn: "ค้นหาคำสั่งซื้อ",
    backBtn: "ค้นหาใหม่",
    selectTitle: "เลือกคำสั่งซื้อที่ต้องการรับประกัน",
    purchasedAt: (d: string) => `วันที่ซื้อ: ${d}`,
    expiresAt: (d: string) => `การรับประกันหมดอายุ: ${d}`,
    activeClaim: "มีคำร้องขอรับประกันที่ใช้งานอยู่",
    descTitle: "อธิบายปัญหา (ไม่บังคับ)",
    descPh: "อธิบายข้อผิดพลาดหรือปัญหาที่คุณพบ...",
    submitBtn: "ส่งคำร้องขอรับประกัน",
    successTitle: "อนุมัติการรับประกันแล้ว!",
    successOrder: (code: string) => `คำสั่งซื้อ #${code}`,
    replacementLabel: "บัญชีทดแทน",
    pendingTitle: "บันทึกคำร้องแล้ว",
    pendingDefault: "ร้านค้าจะดำเนินการและติดต่อกลับเร็วๆ นี้",
    supportLabel: "ติดต่อสนับสนุน",
  },
};

type Step = "form" | "confirm" | "result";

type OrderResult = {
  orderId: string;
  orderCode: string;
  productName: string;
  deliveredAt: string | null;
  warrantyExpiresAt: string | null;
  warrantyPolicy: string | null;
  hasActiveClaim: boolean;
};

type SearchResponse = {
  shop: { name: string; supportTelegram: string | null; supportZalo: string | null };
  orders: OrderResult[];
};

type ClaimResponse = {
  success: boolean;
  status: string;
  claimId: string;
  orderCode: string;
  deliveredAccountText: string | null;
  message: string;
  supportTelegram: string | null;
  supportZalo: string | null;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function InputField({
  label,
  placeholder,
  value,
  onChange,
  hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold" style={{ color: "var(--tx)" }}>
        {label}
      </label>
      {hint && <p className="text-xs" style={{ color: "var(--tx-f)" }}>{hint}</p>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[10px] border px-3.5 py-2.5 text-sm outline-none transition-colors"
        style={{ background: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" }}
      />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}>
      {children}
    </div>
  );
}

export function WarrantyClaimPage() {
  const { lang } = useLang();
  const t = T[lang];
  const [searchParams] = useSearchParams();
  const shopSlug = searchParams.get("shop") || "";

  const [step, setStep] = useState<Step>("form");
  const [shopName, setShopName] = useState<string | null>(null);

  const [contactInfo, setContactInfo] = useState("");
  const [accountText, setAccountText] = useState("");
  const [message, setMessage] = useState("");

  const [orders, setOrders] = useState<OrderResult[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResponse | null>(null);

  useEffect(() => {
    if (!shopSlug) return;
    api
      .get(`/public/warranty/shop/${encodeURIComponent(shopSlug)}`)
      .then((r) => setShopName(r.data.name))
      .catch(() => setShopName(null));
  }, [shopSlug]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!contactInfo.trim() || !accountText.trim()) {
      setError(t.errRequired);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<SearchResponse>("/public/warranty/search", {
        shopSlug,
        accountText: accountText.trim(),
        contactInfo: contactInfo.trim(),
      });
      setOrders(res.data.orders);
      if (res.data.orders.length === 0) {
        setError(t.errNotFound);
      } else {
        setStep("confirm");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || t.errDefault);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitClaim() {
    if (!selectedOrder) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<ClaimResponse>("/public/warranty/claim", {
        orderId: selectedOrder.orderId,
        shopSlug,
        contactInfo: contactInfo.trim(),
        customerMessage: message.trim() || undefined,
      });
      setResult(res.data);
      setStep("result");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || t.errClaim);
    } finally {
      setLoading(false);
    }
  }

  if (!shopSlug) {
    return (
      <PageShell t={t}>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldAlert className="h-10 w-10" style={{ color: "var(--tx-f)" }} />
          <p style={{ color: "var(--tx-m)" }}>{t.invalidLink}</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell shopName={shopName} t={t}>
      {step === "form" && (
        <Card>
          <div className="mb-5 flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(16,185,129,0.12)" }}
            >
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: "var(--tx)" }}>{t.formTitle}</h2>
              <p className="text-xs" style={{ color: "var(--tx-f)" }}>{t.formDesc}</p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="space-y-4">
            <InputField
              label={t.labelContact}
              placeholder={t.phContact}
              value={contactInfo}
              onChange={setContactInfo}
              hint={t.hintContact}
            />
            <InputField
              label={t.labelAccount}
              placeholder={t.phAccount}
              value={accountText}
              onChange={setAccountText}
              hint={t.hintAccount}
            />

            {error && (
              <div
                className="flex items-start gap-2 rounded-[10px] px-3.5 py-3 text-sm"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgb(239,68,68)" }}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-bold transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "rgb(16,185,129)", color: "white" }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {t.searchBtn}
            </button>
          </form>
        </Card>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => { setStep("form"); setSelectedOrder(null); setError(null); }}
            className="flex items-center gap-1.5 text-sm transition hover:opacity-70"
            style={{ color: "var(--tx-m)" }}
          >
            <ArrowLeft className="h-4 w-4" />
            {t.backBtn}
          </button>

          <Card>
            <h2 className="mb-4 text-base font-bold" style={{ color: "var(--tx)" }}>
              {t.selectTitle}
            </h2>
            <div className="space-y-3">
              {orders.map((order) => (
                <button
                  key={order.orderId}
                  type="button"
                  disabled={order.hasActiveClaim}
                  onClick={() => setSelectedOrder(order.orderId === selectedOrder?.orderId ? null : order)}
                  className="w-full rounded-[12px] border p-4 text-left transition-all duration-150 disabled:opacity-50"
                  style={{
                    borderColor: selectedOrder?.orderId === order.orderId ? "rgb(16,185,129)" : "var(--bd)",
                    background: selectedOrder?.orderId === order.orderId ? "rgba(16,185,129,0.06)" : "var(--inp)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" style={{ color: "var(--tx)" }}>
                        {order.productName}
                      </p>
                      <p className="mt-0.5 text-xs font-mono" style={{ color: "var(--tx-m)" }}>
                        #{order.orderCode}
                      </p>
                    </div>
                    {selectedOrder?.orderId === order.orderId && (
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--tx-f)" }}>
                    <span>{t.purchasedAt(formatDate(order.deliveredAt))}</span>
                    {order.warrantyExpiresAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t.expiresAt(formatDate(order.warrantyExpiresAt))}
                      </span>
                    )}
                    {order.hasActiveClaim && (
                      <span className="font-medium text-amber-500">{t.activeClaim}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {selectedOrder && (
            <Card>
              <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--tx)" }}>
                {t.descTitle}
              </h3>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t.descPh}
                rows={3}
                className="w-full resize-none rounded-[10px] border px-3.5 py-2.5 text-sm outline-none"
                style={{ background: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" }}
              />
            </Card>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-[10px] px-3.5 py-3 text-sm"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgb(239,68,68)" }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={!selectedOrder || loading}
            onClick={handleSubmitClaim}
            className="flex w-full items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-bold transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "rgb(16,185,129)", color: "white" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t.submitBtn}
          </button>
        </div>
      )}

      {step === "result" && result && (
        <Card>
          {result.success ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(16,185,129,0.12)" }}>
                  <CheckCircle className="h-7 w-7 text-emerald-500" />
                </div>
                <div>
                  <p className="text-base font-bold" style={{ color: "var(--tx)" }}>{t.successTitle}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>{t.successOrder(result.orderCode)}</p>
                </div>
              </div>

              {result.deliveredAccountText && (
                <div
                  className="rounded-[12px] p-4"
                  style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}
                >
                  <p className="mb-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    {t.replacementLabel}
                  </p>
                  <pre className="whitespace-pre-wrap break-all text-sm font-mono" style={{ color: "var(--tx)" }}>
                    {result.deliveredAccountText}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(251,191,36,0.12)" }}>
                  <Clock className="h-7 w-7 text-amber-400" />
                </div>
                <div>
                  <p className="text-base font-bold" style={{ color: "var(--tx)" }}>{t.pendingTitle}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>
                    {result.message || t.pendingDefault}
                  </p>
                </div>
              </div>

              {(result.supportTelegram || result.supportZalo) && (
                <div
                  className="rounded-[12px] p-4 space-y-1.5"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                >
                  <p className="text-xs font-semibold" style={{ color: "var(--tx-m)" }}>{t.supportLabel}</p>
                  {result.supportTelegram && (
                    <p className="text-sm" style={{ color: "var(--tx)" }}>
                      Telegram: <span className="font-medium">{result.supportTelegram}</span>
                    </p>
                  )}
                  {result.supportZalo && (
                    <p className="text-sm" style={{ color: "var(--tx)" }}>
                      Zalo: <span className="font-medium">{result.supportZalo}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </PageShell>
  );
}

function PageShell({
  children,
  shopName,
  t,
}: {
  children: React.ReactNode;
  shopName?: string | null;
  t: typeof T["vi"];
}) {
  return (
    <div className="min-h-screen px-4 py-10" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-emerald-500" />
          <span className="text-sm font-bold" style={{ color: "var(--tx)" }}>
            {shopName ? t.shopWarranty(shopName) : t.warranty}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
