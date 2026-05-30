import { Check, Crown, Loader2, Sparkles, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/auth-provider";
import { api } from "@/lib/api";
import { useLang } from "@/lib/lang";

/* ─── Translation ───────────────────────────────────────────────── */

const T = {
  vi: {
    badge: "Nâng cấp tài khoản",
    heroTitle1: "Chọn gói ",
    heroTitle2: "phù hợp",
    heroDesc: "Thanh toán tự động qua PayOS hoặc Binance Pay. Tier được kích hoạt ngay sau khi xác nhận.",
    faq: [
      { q: "Khi nào tier được kích hoạt?", a: "Ngay lập tức sau khi hệ thống nhận xác nhận thanh toán từ cổng." },
      { q: "Thanh toán bằng gì?", a: "QR ngân hàng Việt Nam qua PayOS, hoặc USDT qua Binance Pay." },
      { q: "Cần hỗ trợ?", a: "Liên hệ @thaidem57 trên Telegram, phản hồi trong vài phút." },
    ],
    forever: "Mãi mãi",
    perMonth: "/ tháng",
    free: "Miễn phí",
    unlimited: "Không giới hạn",
    contactAdmin: "Liên hệ admin để được cấp",
    btnCurrent: "✓ Gói hiện tại",
    btnLower: "Gói thấp hơn",
    btnAdminOnly: "Chỉ Admin cấp",
    btnFreeCurrent: "Đang dùng miễn phí",
    btnUpgrade: (name: string) => `Nâng cấp lên ${name}`,
    planBadge: "Phổ biến",
    plans: {
      free: {
        tagline: "Khám phá nền tảng trước khi vận hành thật.",
        features: [
          "Vào dashboard ở chế độ read-only",
          "Xem sản phẩm & thống kê demo",
          "Mở shop bán hàng thật",
          "Bot Telegram tự động 24/7",
          "Nhận hàng từ Tổng sỉ",
          "Quản lý ví & thanh toán tự động",
          "Bảo hành đơn tự động",
          "Tạo kho sỉ & API key",
        ],
      },
      pro: {
        tagline: "Mở shop, bot tự chốt đơn, thanh toán tự động.",
        features: [
          "Tất cả tính năng Free",
          "Mở shop bán hàng riêng",
          "Bot Telegram tự động 24/7",
          "Thanh toán PayOS & Binance Pay",
          "Kết nối nguồn hàng Tổng sỉ",
          "Quản lý ví & lịch sử giao dịch",
          "Bảo hành đơn AUTO tự resolve",
        ],
      },
    },
    modal: {
      creating: "Đang tạo lệnh thanh toán...",
      confirming: "Đang xác nhận...",
      upgradeTitle: (name: string) => `Nâng cấp lên ${name}`,
      perMonth: "/ tháng",
      mockBadge: "Chế độ giả lập",
      mockDesc: "Môi trường dev — không cần thanh toán thật",
      mockConfirm: "Xác nhận thanh toán (giả lập)",
      qrAlt: "QR thanh toán",
      qrHint: "Quét bằng app ngân hàng để thanh toán",
      qrFail: "Không thể tải QR code",
      amount: "Số tiền",
      waiting: "Đang chờ xác nhận từ ngân hàng...",
      successTitle: "Nâng cấp thành công! 🎉",
      successDesc: (name: string) => `Gói ${name} đã được kích hoạt. Đang tải lại...`,
      errTitle: "Có lỗi xảy ra",
      retry: "Thử lại",
      timeout: "Hết thời gian chờ. Nếu đã thanh toán, vui lòng liên hệ hỗ trợ.",
      confirmErr: "Lỗi xác nhận.",
      defaultErr: "Có lỗi xảy ra. Vui lòng thử lại.",
    },
  },
  en: {
    badge: "Upgrade account",
    heroTitle1: "Choose ",
    heroTitle2: "your plan",
    heroDesc: "Auto-pay via PayOS or Binance Pay. Tier is activated immediately after confirmation.",
    faq: [
      { q: "When is the tier activated?", a: "Immediately after the payment gateway confirms the transaction." },
      { q: "What payment methods?", a: "Vietnamese bank QR via PayOS, or USDT via Binance Pay." },
      { q: "Need help?", a: "Contact @thaidem57 on Telegram — response within minutes." },
    ],
    forever: "Forever",
    perMonth: "/ month",
    free: "Free",
    unlimited: "Unlimited",
    contactAdmin: "Contact admin to be granted",
    btnCurrent: "✓ Current plan",
    btnLower: "Lower plan",
    btnAdminOnly: "Admin only",
    btnFreeCurrent: "Currently on free",
    btnUpgrade: (name: string) => `Upgrade to ${name}`,
    planBadge: "Popular",
    plans: {
      free: {
        tagline: "Explore the platform before going live.",
        features: [
          "Read-only dashboard access",
          "View products & demo stats",
          "Open a real shop",
          "24/7 automatic Telegram bot",
          "Receive stock from wholesale",
          "Wallet & auto-payment management",
          "Auto warranty resolution",
          "Create wholesale inventory & API keys",
        ],
      },
      pro: {
        tagline: "Open a shop, bot closes orders, payments auto-processed.",
        features: [
          "All Free features",
          "Your own shop",
          "24/7 automatic Telegram bot",
          "PayOS & Binance Pay payments",
          "Connect to wholesale source",
          "Wallet & transaction history",
          "AUTO warranty resolution",
        ],
      },
    },
    modal: {
      creating: "Creating payment order...",
      confirming: "Confirming...",
      upgradeTitle: (name: string) => `Upgrade to ${name}`,
      perMonth: "/ month",
      mockBadge: "Simulation mode",
      mockDesc: "Dev environment — no real payment needed",
      mockConfirm: "Confirm payment (simulation)",
      qrAlt: "Payment QR",
      qrHint: "Scan with your banking app to pay",
      qrFail: "Could not load QR code",
      amount: "Amount",
      waiting: "Waiting for bank confirmation...",
      successTitle: "Upgrade successful! 🎉",
      successDesc: (name: string) => `${name} plan activated. Reloading...`,
      errTitle: "An error occurred",
      retry: "Try again",
      timeout: "Timed out. If you already paid, please contact support.",
      confirmErr: "Confirmation error.",
      defaultErr: "An error occurred. Please try again.",
    },
  },
  th: {
    badge: "อัปเกรดบัญชี",
    heroTitle1: "เลือก ",
    heroTitle2: "แพ็กเกจ",
    heroDesc: "ชำระเงินอัตโนมัติผ่าน PayOS หรือ Binance Pay ระดับจะเปิดใช้งานทันทีหลังยืนยัน",
    faq: [
      { q: "ระดับจะเปิดใช้งานเมื่อไหร่?", a: "ทันทีหลังจากระบบได้รับการยืนยันการชำระเงินจากเกตเวย์" },
      { q: "ชำระเงินด้วยวิธีใดได้บ้าง?", a: "QR ธนาคารเวียดนามผ่าน PayOS หรือ USDT ผ่าน Binance Pay" },
      { q: "ต้องการความช่วยเหลือ?", a: "ติดต่อ @thaidem57 ทาง Telegram ตอบกลับภายในไม่กี่นาที" },
    ],
    forever: "ตลอดไป",
    perMonth: "/ เดือน",
    free: "ฟรี",
    unlimited: "ไม่จำกัด",
    contactAdmin: "ติดต่อแอดมินเพื่อรับสิทธิ์",
    btnCurrent: "✓ แพ็กเกจปัจจุบัน",
    btnLower: "แพ็กเกจที่ต่ำกว่า",
    btnAdminOnly: "แอดมินเท่านั้น",
    btnFreeCurrent: "กำลังใช้แผนฟรี",
    btnUpgrade: (name: string) => `อัปเกรดเป็น ${name}`,
    planBadge: "ยอดนิยม",
    plans: {
      free: {
        tagline: "สำรวจแพลตฟอร์มก่อนเริ่มใช้งานจริง",
        features: [
          "เข้าแดชบอร์ดในโหมดอ่านอย่างเดียว",
          "ดูสินค้าและสถิติตัวอย่าง",
          "เปิดร้านค้าจริง",
          "บอท Telegram อัตโนมัติ 24/7",
          "รับสินค้าจากขายส่ง",
          "จัดการกระเป๋าเงินและชำระเงินอัตโนมัติ",
          "การรับประกันอัตโนมัติ",
          "สร้างคลังสินค้าขายส่งและ API key",
        ],
      },
      pro: {
        tagline: "เปิดร้าน บอทปิดออเดอร์ ชำระเงินอัตโนมัติ",
        features: [
          "ฟีเจอร์ทั้งหมดของ Free",
          "ร้านค้าของคุณเอง",
          "บอท Telegram อัตโนมัติ 24/7",
          "ชำระเงินผ่าน PayOS และ Binance Pay",
          "เชื่อมต่อแหล่งสินค้าขายส่ง",
          "กระเป๋าเงินและประวัติธุรกรรม",
          "การรับประกันอัตโนมัติ AUTO",
        ],
      },
    },
    modal: {
      creating: "กำลังสร้างคำสั่งชำระเงิน...",
      confirming: "กำลังยืนยัน...",
      upgradeTitle: (name: string) => `อัปเกรดเป็น ${name}`,
      perMonth: "/ เดือน",
      mockBadge: "โหมดจำลอง",
      mockDesc: "สภาพแวดล้อม dev — ไม่ต้องชำระเงินจริง",
      mockConfirm: "ยืนยันการชำระเงิน (จำลอง)",
      qrAlt: "QR ชำระเงิน",
      qrHint: "สแกนด้วยแอปธนาคารเพื่อชำระเงิน",
      qrFail: "ไม่สามารถโหลด QR code ได้",
      amount: "จำนวนเงิน",
      waiting: "กำลังรอการยืนยันจากธนาคาร...",
      successTitle: "อัปเกรดสำเร็จ! 🎉",
      successDesc: (name: string) => `เปิดใช้งานแพ็กเกจ ${name} แล้ว กำลังโหลดใหม่...`,
      errTitle: "เกิดข้อผิดพลาด",
      retry: "ลองอีกครั้ง",
      timeout: "หมดเวลา ถ้าคุณชำระเงินแล้ว โปรดติดต่อฝ่ายสนับสนุน",
      confirmErr: "ข้อผิดพลาดในการยืนยัน",
      defaultErr: "เกิดข้อผิดพลาด กรุณาลองใหม่",
    },
  },
};

/* ─── Plan definitions ──────────────────────────────────────────── */

interface PlanFeature { text: string; included: boolean; highlight?: boolean }

interface Plan {
  id: "free" | "pro" | "ultra";
  name: string;
  badge?: string;
  priceVnd: number | null;
  period: string;
  tagline: string;
  accent: "neutral" | "emerald" | "violet";
  adminOnly?: boolean;
  features: PlanFeature[];
}

function getPlans(t: typeof T["vi"]): Plan[] {
  return [
    {
      id: "free",
      name: "Free",
      priceVnd: 0,
      period: t.forever,
      tagline: t.plans.free.tagline,
      accent: "neutral",
      features: t.plans.free.features.map((text, i) => ({
        text,
        included: i < 2,
      })),
    },
    {
      id: "pro",
      name: "Pro",
      badge: t.planBadge,
      priceVnd: 199000,
      period: t.perMonth,
      tagline: t.plans.pro.tagline,
      accent: "emerald",
      features: t.plans.pro.features.map((text, i) => ({
        text,
        included: true,
        highlight: i === 2 || i === 6,
      })),
    },
  ];
}

/* ─── Accent token maps ─────────────────────────────────────────── */

const ACCENT = {
  neutral: {
    border:   "var(--bd)",
    bg:       "transparent",
    icon:     { background: "var(--inp)", color: "var(--tx-m)" },
    badge:    { background: "var(--inp)", color: "var(--tx-m)" },
    btn:      { background: "var(--inp)", color: "var(--tx-m)", border: "1px solid var(--bd)" },
    check:    { background: "rgba(156,163,175,0.15)", color: "var(--tx-f)" },
    hlText:   "var(--tx)",
  },
  emerald: {
    border:   "rgba(16,185,129,0.3)",
    bg:       "rgba(16,185,129,0.03)",
    icon:     { background: "rgb(16,185,129)", color: "white" },
    badge:    { background: "rgb(16,185,129)", color: "white" },
    btn:      { background: "rgb(16,185,129)", color: "white" },
    check:    { background: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)" },
    hlText:   "rgb(16,185,129)",
  },
  violet: {
    border:   "rgba(139,92,246,0.3)",
    bg:       "rgba(139,92,246,0.03)",
    icon:     { background: "rgb(139,92,246)", color: "white" },
    badge:    { background: "rgb(139,92,246)", color: "white" },
    btn:      { background: "rgba(139,92,246,0.12)", color: "rgb(167,139,250)", border: "1px solid rgba(139,92,246,0.3)" },
    check:    { background: "rgba(139,92,246,0.15)", color: "rgb(139,92,246)" },
    hlText:   "rgb(167,139,250)",
  },
} satisfies Record<Plan["accent"], {
  border: string; bg: string;
  icon: React.CSSProperties; badge: React.CSSProperties;
  btn: React.CSSProperties; check: React.CSSProperties;
  hlText: string;
}>;

/* ─── Payment modal ─────────────────────────────────────────────── */

function PaymentModal({ plan, onClose, onSuccess }: { plan: Plan; onClose: () => void; onSuccess: () => void }) {
  const { lang } = useLang();
  const mt = T[lang].modal;
  type Step = "loading" | "payment" | "confirming" | "done" | "error";
  const [step, setStep] = useState<Step>("loading");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [externalOrderCode, setExternalOrderCode] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconcileTokenRef = useRef<string | null>(null);
  const ac = ACCENT[plan.accent];

  useEffect(() => {
    void initPayment();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function initPayment() {
    setStep("loading"); setErrorMsg(null);
    try {
      const { data } = await api.post("/upgrade/payment", { targetTier: plan.id });
      setQrCode(data.qrCode ?? null);
      setExternalOrderCode(data.externalOrderCode);
      reconcileTokenRef.current = data.reconcileToken ?? null;
      if (data.provider === "mock") { setIsMock(true); } else { startPolling(data.externalOrderCode, data.reconcileToken ?? null); }
      setStep("payment");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setErrorMsg(e?.response?.data?.message || e?.message || mt.defaultErr);
      setStep("error");
    }
  }

  function startPolling(code: string, rToken: string | null) {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const { data } = await api.get(`/upgrade/payment/${code}`);
        if (data.status === "confirmed") { clearInterval(pollRef.current!); setStep("done"); setTimeout(onSuccess, 1500); return; }
      } catch { /* ignore */ }
      if (rToken && attempts % 3 === 0) {
        try {
          const { data: rec } = await api.post(`/webhooks/payos/reconcile/${code}`, { token: rToken });
          if (rec.reconciled) { clearInterval(pollRef.current!); setStep("done"); setTimeout(onSuccess, 1500); return; }
        } catch { /* ignore */ }
      }
      if (attempts >= 72) { clearInterval(pollRef.current!); setErrorMsg(mt.timeout); setStep("error"); }
    }, 5000);
  }

  async function handleMockConfirm() {
    if (!externalOrderCode) return;
    setStep("confirming");
    try {
      await api.post(`/upgrade/mock-confirm/${externalOrderCode}`);
      setStep("done"); setTimeout(onSuccess, 1500);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setErrorMsg(e?.response?.data?.message || e?.message || mt.confirmErr); setStep("error");
    }
  }

  const formattedPrice = plan.priceVnd
    ? new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(plan.priceVnd)
    : "0₫";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-sm rounded-[24px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--bd)", boxShadow: "0 32px 80px rgba(0,0,0,0.2)" }}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-70"
          style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
        >
          <X className="h-4 w-4" />
        </button>

        {(step === "loading" || step === "confirming") && (
          <div className="flex flex-col items-center py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: ac.hlText }} />
            <p className="mt-4 text-sm font-medium" style={{ color: "var(--tx-m)" }}>
              {step === "loading" ? mt.creating : mt.confirming}
            </p>
          </div>
        )}

        {step === "payment" && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={ac.icon}>
                {plan.id === "pro" ? <Zap className="h-4 w-4" /> : <Crown className="h-4 w-4" />}
              </div>
              <div>
                <p className="font-bold" style={{ color: "var(--tx)" }}>{mt.upgradeTitle(plan.name)}</p>
                <p className="text-xs" style={{ color: "var(--tx-f)" }}>{formattedPrice} {mt.perMonth}</p>
              </div>
            </div>

            {isMock ? (
              <div className="rounded-[16px] border border-dashed p-5 text-center" style={{ borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.05)" }}>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: "rgb(245,158,11)" }}>{mt.mockBadge}</p>
                <p className="text-xs" style={{ color: "var(--tx-m)" }}>{mt.mockDesc}</p>
                <div className="my-4 mx-auto flex h-36 w-36 items-center justify-center rounded-[12px] text-5xl" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>💳</div>
                <button onClick={handleMockConfirm} className="w-full rounded-[12px] py-3 text-sm font-bold transition hover:opacity-90" style={ac.btn}>
                  {mt.mockConfirm}
                </button>
              </div>
            ) : (
              <>
                {qrCode ? (
                  <div className="flex flex-col items-center">
                    <div className="rounded-[14px] bg-white p-2 shadow-lg">
                      <img src={`https://quickchart.io/qr?size=208&text=${encodeURIComponent(qrCode)}`} alt={mt.qrAlt} className="h-52 w-52 rounded-[10px]" />
                    </div>
                    <p className="mt-2 text-xs" style={{ color: "var(--tx-f)" }}>{mt.qrHint}</p>
                  </div>
                ) : (
                  <div className="flex h-52 items-center justify-center rounded-[14px]" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                    <p className="text-sm" style={{ color: "var(--tx-f)" }}>{mt.qrFail}</p>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between rounded-[12px] px-3 py-2.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <span className="text-xs" style={{ color: "var(--tx-m)" }}>{mt.amount}</span>
                  <span className="text-sm font-bold" style={{ color: "var(--tx)" }}>{formattedPrice}</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: ac.hlText }} />
                  <span className="text-xs" style={{ color: "var(--tx-f)" }}>{mt.waiting}</span>
                </div>
              </>
            )}
          </>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)" }}>
              <Check className="h-8 w-8 stroke-[2.5]" />
            </div>
            <p className="mt-4 text-xl font-bold" style={{ color: "var(--tx)" }}>{mt.successTitle}</p>
            <p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>{mt.successDesc(plan.name)}</p>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "rgba(244,63,94,0.15)", color: "rgb(244,63,94)" }}>
              <X className="h-8 w-8" />
            </div>
            <p className="mt-4 font-bold" style={{ color: "var(--tx)" }}>{mt.errTitle}</p>
            <p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>{errorMsg}</p>
            <button
              onClick={() => void initPayment()}
              className="mt-5 rounded-[10px] px-4 py-2 text-sm font-semibold transition hover:opacity-80"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
            >
              {mt.retry}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Plan card ─────────────────────────────────────────────────── */

function PlanCard({ plan, currentTier, onUpgrade, t }: { plan: Plan; currentTier?: string | null; onUpgrade: (plan: Plan) => void; t: typeof T["vi"] }) {
  const ac = ACCENT[plan.accent];
  const isCurrent = currentTier === plan.id;
  const isDowngrade =
    (plan.id === "pro" && currentTier === "ultra") ||
    (plan.id === "free" && (currentTier === "pro" || currentTier === "ultra"));
  const canUpgrade = !isCurrent && !isDowngrade && plan.priceVnd !== null && plan.priceVnd > 0;

  const formattedPrice = plan.priceVnd
    ? new Intl.NumberFormat("vi-VN").format(plan.priceVnd)
    : null;

  return (
    <div
      className="relative flex flex-col rounded-[24px] p-6 transition-all duration-300 lg:p-7"
      style={{
        backgroundColor: "var(--surface)",
        border: `1px solid ${ac.border}`,
        boxShadow: plan.accent !== "neutral" ? `0 0 40px ${ac.bg}` : undefined,
      }}
    >
      {plan.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider" style={ac.badge}>
            {plan.id === "pro" && <Zap className="h-3 w-3" />}
            {plan.id === "ultra" && <Crown className="h-3 w-3" />}
            {plan.badge}
          </span>
        </div>
      )}

      <div className="mb-5">
        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[10px]" style={ac.icon}>
          {plan.id === "free" && <Sparkles className="h-4 w-4" />}
          {plan.id === "pro" && <Zap className="h-4 w-4" />}
          {plan.id === "ultra" && <Crown className="h-4 w-4" />}
        </div>
        <h2 className="text-xl font-bold" style={{ color: plan.accent === "neutral" ? "var(--tx)" : ac.hlText }}>{plan.name}</h2>
        <p className="mt-1 text-sm leading-5" style={{ color: "var(--tx-f)" }}>{plan.tagline}</p>
      </div>

      <div className="mb-5 pb-5" style={{ borderBottom: "1px solid var(--bd)" }}>
        {plan.priceVnd === 0 ? (
          <>
            <span className="text-4xl font-black tracking-tight" style={{ color: "var(--tx)" }}>{t.free}</span>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.unlimited}</p>
          </>
        ) : plan.priceVnd !== null ? (
          <>
            <div className="flex items-end gap-1">
              <span className="mb-2 text-[11px] font-semibold" style={{ color: "var(--tx-f)" }}>VND</span>
              <span className="text-4xl font-black leading-none tracking-tight" style={{ color: "var(--tx)" }}>{formattedPrice}</span>
            </div>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{plan.period}</p>
          </>
        ) : (
          <p className="text-sm font-semibold" style={{ color: "var(--tx-f)" }}>{t.contactAdmin}</p>
        )}
      </div>

      <button
        disabled={!canUpgrade}
        onClick={() => canUpgrade && onUpgrade(plan)}
        className="mb-5 w-full rounded-[12px] py-3 text-[0.875rem] font-bold transition hover:opacity-90 disabled:cursor-default disabled:opacity-70"
        style={canUpgrade ? ac.btn : { background: "var(--inp)", color: "var(--tx-f)", border: "1px solid var(--bd)" }}
      >
        {isCurrent ? t.btnCurrent
          : isDowngrade ? t.btnLower
          : plan.adminOnly ? t.btnAdminOnly
          : plan.priceVnd === 0 ? t.btnFreeCurrent
          : t.btnUpgrade(plan.name)}
      </button>

      <ul className="flex-1 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f.text} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={f.included ? ac.check : { background: "var(--inp)", color: "var(--tx-f)" }}>
              <Check className="h-3 w-3 stroke-[2.5]" />
            </span>
            <span
              className="text-sm leading-5"
              style={f.included
                ? { color: f.highlight ? ac.hlText : "var(--tx-m)", fontWeight: f.highlight ? 600 : undefined }
                : { color: "var(--tx-f)", textDecoration: "line-through" }}
            >
              {f.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────── */

export function UpgradePage() {
  const { lang } = useLang();
  const t = T[lang];
  const { session, refreshSession } = useAuth();
  const currentTier = session?.user.sellerTier || null;
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const plans = getPlans(t);

  async function handleSuccess() {
    await refreshSession();
    window.location.href = `/?welcome=${selectedPlan?.id ?? "pro"}`;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-12 text-center">
        <div
          className="mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold"
          style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.2)", color: "rgb(249,115,22)" }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t.badge}
        </div>
        <h1 className="text-4xl font-black sm:text-5xl" style={{ color: "var(--tx)" }}>
          {t.heroTitle1}
          <span style={{ background: "linear-gradient(135deg,rgb(16,185,129),rgb(139,92,246))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            {t.heroTitle2}
          </span>
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-base leading-7" style={{ color: "var(--tx-m)" }}>
          {t.heroDesc}
        </p>
      </div>

      <div className="mx-auto grid max-w-2xl gap-5 md:grid-cols-2">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} currentTier={currentTier} onUpgrade={setSelectedPlan} t={t} />
        ))}
      </div>

      <div className="mt-10 rounded-[20px] p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="grid gap-4 sm:grid-cols-3">
          {t.faq.map((item) => (
            <div key={item.q}>
              <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{item.q}</p>
              <p className="mt-1 text-sm leading-6" style={{ color: "var(--tx-f)" }}>{item.a}</p>
            </div>
          ))}
        </div>
      </div>

      {selectedPlan && (
        <PaymentModal plan={selectedPlan} onClose={() => setSelectedPlan(null)} onSuccess={handleSuccess} />
      )}
    </div>
  );
}
