import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, X, Copy, CheckCircle2, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/ui/toast";

type PlanKey = "monthly" | "quarterly" | "semi_annual" | "annual";
type TierKey = "pro" | "ultra";
type PaymentMethodKey = "PAYOS" | "USDT" | "WALLET_BALANCE";
type UsdtNetwork = "TRC20" | "SOL";

type TierQuote = {
  currentTier: string;
  currentTierExpiresAt: string | null;
  referralCode: string | null;
  walletBalance: number;
  affiliateUnlockedTier: number;
  autoRenewConfig?: { enabled?: boolean; plan?: PlanKey; useWallet?: boolean } | null;
  pro: { tier: "pro"; label: string; plans: Array<{ plan: PlanKey; label: string; priceVnd: number }> };
  ultra: { tier: "ultra"; label: string; plans: Array<{ plan: PlanKey; label: string; priceVnd: number }> } | null;
};

type PurchaseResponse = {
  paidFromWallet?: boolean;
  depositRequestId?: string;
  externalOrderCode?: string;
  checkoutUrl?: string;
  qrCode?: string;
  amount?: number;
  reconcileToken?: string;
  provider?: string;
  expiresAt?: string;
  providerPayload?: any;
  bankInfo?: { accountNumber?: string; accountName?: string; bin?: string; description?: string } | null;
  manualCrypto?: { address?: string | null; uid?: string | null; usdtAmount?: number; network?: string | null } | null;
};

const TIER_FEATURES = {
  pro: [
    "Bot Telegram đầy đủ tính năng",
    "Thanh toán tự động PayOS + USDT",
    "Quản lý sản phẩm + tồn kho",
    "Quản lý khách hàng + đơn hàng",
    "Catalog danh mục + icon động",
    "Webhook + bot polling 24/7",
    "Báo cáo doanh thu chi tiết",
    "Affiliate 2 cấp",
  ],
  ultra: [
    "Toàn bộ tính năng Pro",
    "Cấp API key cho CTV / downline",
    "Quản lý mạng lưới đại lý",
    "Auto sync catalog đa nguồn",
    "Multi-shop support",
    "Priority bot delivery",
    "Premium support 24/7",
    "Early access tính năng mới",
  ],
};

export function TierPricingPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<PlanKey>("annual");
  const [modalTier, setModalTier] = useState<TierKey | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodKey>("PAYOS");
  const [usdtNetwork, setUsdtNetwork] = useState<UsdtNetwork>("TRC20");
  const [referralCode, setReferralCode] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [paymentResponse, setPaymentResponse] = useState<PurchaseResponse | null>(null);

  const quoteQuery = useQuery<TierQuote>({
    queryKey: ["tier-quote"],
    queryFn: async () => (await api.get("/tiers/quote")).data,
  });
  const quote = quoteQuery.data;

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!modalTier) throw new Error("No tier selected");
      const backendMethod = paymentMethod === "USDT"
        ? (usdtNetwork === "TRC20" ? "USDT_TRC20" : "USDT_SOL")
        : paymentMethod;
      // Single code field — backend tries discount table first, then seller.referralCode.
      // We send it as BOTH so each handler gets a shot:
      //  - discountCode → applies % off if it matches an active DiscountCode
      //  - referralCode → sets referrer if it matches Seller.referralCode OR DiscountCode.code
      const trimmedCode = (discountCode || referralCode).trim() || undefined;
      const { data } = await api.post<PurchaseResponse>("/tiers/purchase", {
        tier: modalTier,
        plan: billingCycle,
        paymentMethod: backendMethod,
        referralCode: trimmedCode,
        discountCode: trimmedCode,
      });
      return data;
    },
    onSuccess: (data) => {
      if (data.paidFromWallet) {
        queryClient.invalidateQueries({ queryKey: ["tier-quote"] });
        const tier = modalTier;
        closeModal();
        if (tier) navigate(`/?welcome=${tier}`);
      } else {
        setPaymentResponse(data);
      }
    },
    onError: (error: any) => {
      showToast({ tone: "error", message: error?.response?.data?.message || error?.message || "Thanh toán thất bại" });
    },
  });

  // Poll payment status
  useEffect(() => {
    if (!paymentResponse?.externalOrderCode) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/tiers/quote`);
        // Check if tier was renewed (tierExpiresAt updated)
        if (data.currentTierExpiresAt && quote?.currentTierExpiresAt !== data.currentTierExpiresAt) {
          queryClient.invalidateQueries({ queryKey: ["tier-quote"] });
          const tier = modalTier;
          closeModal();
          if (tier) navigate(`/?welcome=${tier}`);
        }
      } catch {}
    }, 4000);
    return () => clearInterval(interval);
  }, [paymentResponse?.externalOrderCode]);

  const closeModal = () => {
    setModalTier(null);
    setPaymentResponse(null);
    setReferralCode("");
    setDiscountCode("");
    setPaymentMethod("PAYOS");
  };

  if (quoteQuery.isPending) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm" style={{ color: "var(--tx-f)" }}>Đang tải...</div>;
  }
  if (!quote) {
    return <div className="p-10 text-center text-rose-400">Không lấy được thông tin gói.</div>;
  }

  const currentTierLower = quote.currentTier.toLowerCase();
  const getPlan = (tier: TierKey) => {
    const t = tier === "pro" ? quote.pro : quote.ultra;
    return t?.plans.find((p) => p.plan === billingCycle) ?? t?.plans[0];
  };
  const proPlan = getPlan("pro");
  const ultraPlan = getPlan("ultra");
  const pricePerMonth = (p: number) => {
    const divisor = billingCycle === "monthly" ? 1 : billingCycle === "quarterly" ? 3 : billingCycle === "semi_annual" ? 6 : 12;
    return Math.round(p / divisor);
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      <div className="text-center">
        <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl" style={{ color: "var(--tx)", letterSpacing: "-0.02em" }}>Nâng cấp gói</h1>
        <p className="mx-auto mt-4 max-w-lg text-base sm:text-lg" style={{ color: "var(--tx-m)" }}>Chọn gói phù hợp với quy mô shop của bạn.</p>
      </div>

      <div className="mt-10 flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-full p-1" style={{ background: "var(--inp)" }}>
          {(["monthly", "quarterly", "semi_annual", "annual"] as PlanKey[]).map((p) => {
            const isActive = billingCycle === p;
            const label = p === "monthly" ? "Hàng tháng" : p === "quarterly" ? "3 tháng" : p === "semi_annual" ? "6 tháng" : "Hàng năm";
            const savings = p === "quarterly" ? "-3%" : p === "semi_annual" ? "-7%" : p === "annual" ? "-16%" : null;
            return (
              <button key={p} type="button" onClick={() => setBillingCycle(p)}
                className="relative flex items-center gap-1.5 rounded-full px-5 py-2 text-[13px] font-medium transition-all"
                style={{ background: isActive ? "var(--tx)" : "transparent", color: isActive ? "var(--surface)" : "var(--tx-m)" }}>
                {label}
                {savings && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: isActive ? "rgba(16,185,129,0.18)" : "rgba(16,185,129,0.12)", color: "rgb(16,185,129)" }}>{savings}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`mt-14 grid gap-6 ${quote.ultra ? "lg:grid-cols-2" : "mx-auto max-w-md"}`}>
        {proPlan && (
          <TierCard tierKey="pro" label="Pro" tagline="Cho shop kinh doanh chuyên nghiệp"
            priceVnd={proPlan.priceVnd} pricePerMonth={pricePerMonth(proPlan.priceVnd)} features={TIER_FEATURES.pro}
            isCurrent={currentTierLower === "pro"} featured={false}
            onPurchase={() => { setModalTier("pro"); setPaymentMethod("PAYOS"); }}
            currentExpiresAt={currentTierLower === "pro" ? quote.currentTierExpiresAt : null} />
        )}
        {ultraPlan && (
          <TierCard tierKey="ultra" label="Ultra" tagline="Cho seller có mạng lưới CTV"
            priceVnd={ultraPlan.priceVnd} pricePerMonth={pricePerMonth(ultraPlan.priceVnd)} features={TIER_FEATURES.ultra}
            isCurrent={currentTierLower === "ultra"} featured={true}
            onPurchase={() => { setModalTier("ultra"); setPaymentMethod("PAYOS"); }}
            currentExpiresAt={currentTierLower === "ultra" ? quote.currentTierExpiresAt : null} />
        )}
      </div>

      {/* Auto-renew section */}
      {(currentTierLower === "pro" || currentTierLower === "ultra") && (
        <AutoRenewCard quote={quote} />
      )}

      <div className="mt-16 text-center text-sm" style={{ color: "var(--tx-f)" }}>
        Có câu hỏi? Liên hệ <span style={{ color: "var(--tx)" }}>@thaidem57</span> trên Telegram.
      </div>

      {modalTier && (
        <PaymentModal
          tier={modalTier}
          plan={billingCycle}
          priceVnd={getPlan(modalTier)?.priceVnd ?? 0}
          walletBalance={quote.walletBalance}
          showReferralInput={!quote.currentTierExpiresAt}
          paymentMethod={paymentMethod}
          usdtNetwork={usdtNetwork}
          referralCode={referralCode}
          discountCode={discountCode}
          isPending={purchaseMutation.isPending}
          paymentResponse={paymentResponse}
          onChangePaymentMethod={setPaymentMethod}
          onChangeUsdtNetwork={setUsdtNetwork}
          onChangeReferralCode={setReferralCode}
          onChangeDiscountCode={setDiscountCode}
          onClose={closeModal}
          onConfirm={() => purchaseMutation.mutate()}
        />
      )}
    </div>
  );
}

function AutoRenewCard({ quote }: { quote: TierQuote }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const cfg = quote.autoRenewConfig || {};
  const [enabled, setEnabled] = useState<boolean>(Boolean(cfg.enabled));
  const [plan, setPlan] = useState<PlanKey>((cfg.plan as PlanKey) || "monthly");

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/tiers/auto-renew", { enabled, plan, useWallet: true });
      return data;
    },
    onSuccess: () => {
      showToast({ tone: "success", message: enabled ? "Đã bật tự động gia hạn." : "Đã tắt tự động gia hạn." });
      queryClient.invalidateQueries({ queryKey: ["tier-quote"] });
    },
    onError: (err: any) => {
      showToast({ tone: "error", message: err?.response?.data?.message || "Không lưu được cấu hình." });
    },
  });

  const currentTier = quote.currentTier.toLowerCase();
  const isUltra = currentTier === "ultra";
  const planPrices = isUltra ? quote.ultra?.plans : quote.pro.plans;
  const selectedPrice = planPrices?.find((p) => p.plan === plan)?.priceVnd ?? 0;
  const insufficient = quote.walletBalance < selectedPrice;

  return (
    <div className="mt-12 rounded-3xl p-7 sm:p-8" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "rgba(16,185,129,0.12)", color: "rgb(16,185,129)" }}>
            <Check className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-lg font-semibold" style={{ color: "var(--tx)" }}>Tự động gia hạn</h3>
            <p className="mt-0.5 text-[13px]" style={{ color: "var(--tx-m)" }}>
              Hệ thống sẽ trừ tiền từ <span style={{ color: "var(--tx)" }}>ví seller</span> để gia hạn gói {currentTier.toUpperCase()} trước hạn 3 ngày.
            </p>
          </div>
        </div>
        <label className="relative inline-flex shrink-0 cursor-pointer items-center">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="peer sr-only" />
          <div className="h-6 w-11 rounded-full transition" style={{ background: enabled ? "rgb(16,185,129)" : "var(--inp)", border: "1px solid var(--bd)" }}>
            <div className="h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: enabled ? "translate(22px, 1px)" : "translate(2px, 1px)" }} />
          </div>
        </label>
      </div>

      {enabled && (
        <div className="mt-5 space-y-3">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--tx-f)" }}>Chu kỳ gia hạn</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(["monthly", "quarterly", "semi_annual", "annual"] as PlanKey[]).map((p) => {
                const isActive = plan === p;
                const label = p === "monthly" ? "Hàng tháng" : p === "quarterly" ? "3 tháng" : p === "semi_annual" ? "6 tháng" : "Hàng năm";
                const price = planPrices?.find((x) => x.plan === p)?.priceVnd ?? 0;
                return (
                  <button key={p} type="button" onClick={() => setPlan(p)}
                    className="rounded-xl px-3 py-2.5 text-center text-[12px] font-semibold transition"
                    style={{
                      background: isActive ? "rgba(16,185,129,0.10)" : "var(--inp)",
                      border: `1.5px solid ${isActive ? "rgba(16,185,129,0.5)" : "transparent"}`,
                      color: isActive ? "rgb(16,185,129)" : "var(--tx-m)",
                    }}>
                    <div>{label}</div>
                    <div className="mt-0.5 text-[11px] tabular-nums" style={{ color: "var(--tx-f)" }}>{formatCurrency(price)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl px-4 py-3 text-[12px]"
            style={insufficient
              ? { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "rgb(239,68,68)" }
              : { background: "var(--inp)", color: "var(--tx-m)" }}>
            Số dư ví hiện tại: <span className="font-semibold" style={{ color: "var(--tx)" }}>{formatCurrency(quote.walletBalance)}</span> · Phí gia hạn: <span className="font-semibold" style={{ color: "var(--tx)" }}>{formatCurrency(selectedPrice)}</span>
            {insufficient && <span className="ml-1.5">— không đủ, hãy nạp thêm</span>}
          </div>
        </div>
      )}

      <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}
        className="mt-5 w-full rounded-2xl py-3 text-[14px] font-semibold transition hover:opacity-90 disabled:opacity-40"
        style={{ background: enabled ? "rgb(16,185,129)" : "var(--inp)", border: "1px solid var(--bd)", color: enabled ? "white" : "var(--tx-m)" }}>
        {mutation.isPending ? "Đang lưu..." : "Lưu cấu hình"}
      </button>
    </div>
  );
}

function TierCard({ tierKey, label, tagline, priceVnd, pricePerMonth, features, isCurrent, featured, onPurchase, currentExpiresAt }: {
  tierKey: TierKey; label: string; tagline: string; priceVnd: number; pricePerMonth: number; features: string[];
  isCurrent: boolean; featured: boolean; onPurchase: () => void; currentExpiresAt: string | null;
}) {
  return (
    <div className="relative flex flex-col rounded-3xl p-8 sm:p-10" style={{
      background: featured ? "linear-gradient(180deg, rgba(99,102,241,0.06), transparent 60%), var(--surface)" : "var(--surface)",
      border: `1px solid ${featured ? "rgba(99,102,241,0.35)" : "var(--bd)"}`,
    }}>
      {isCurrent && <span className="absolute right-6 top-6 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ background: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)" }}>Gói hiện tại</span>}
      {featured && !isCurrent && <span className="absolute right-6 top-6 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ background: "rgba(99,102,241,0.15)", color: "rgb(129,140,248)" }}>Khuyên dùng</span>}

      <div>
        <h3 className="text-2xl font-semibold" style={{ color: "var(--tx)" }}>{label}</h3>
        <p className="mt-1.5 text-sm" style={{ color: "var(--tx-m)" }}>{tagline}</p>
      </div>

      <div className="mt-8">
        <div className="flex items-baseline gap-1">
          <span className="text-6xl font-semibold tracking-tight" style={{ color: "var(--tx)", letterSpacing: "-0.04em" }}>{Math.round(priceVnd / 1000)}</span>
          <span className="text-2xl font-medium" style={{ color: "var(--tx-m)" }}>k</span>
        </div>
        {pricePerMonth !== priceVnd && <p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>Tương đương <span className="font-semibold" style={{ color: "var(--tx)" }}>{formatCurrency(pricePerMonth)}/tháng</span></p>}
      </div>

      <button type="button" onClick={onPurchase}
        className="mt-8 w-full rounded-2xl py-3.5 text-[15px] font-semibold transition-all hover:opacity-90"
        style={{ background: featured ? "rgb(99,102,241)" : "var(--tx)", color: featured ? "white" : "var(--surface)" }}>
        {isCurrent ? "Gia hạn" : tierKey === "ultra" ? "Nâng cấp Ultra" : "Chọn gói Pro"}
      </button>

      {isCurrent && currentExpiresAt && <p className="mt-3 text-center text-xs" style={{ color: "var(--tx-f)" }}>Hết hạn {new Date(currentExpiresAt).toLocaleDateString("vi-VN")}</p>}

      <div className="mt-8 space-y-3">
        {features.map((f, i) => (
          <div key={i} className="flex items-start gap-3 text-[14px]">
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: featured ? "rgb(129,140,248)" : "var(--tx-m)" }} strokeWidth={2.5} />
            <span style={{ color: "var(--tx-m)" }}>{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentModal({
  tier, plan, priceVnd, walletBalance, showReferralInput,
  paymentMethod, usdtNetwork, referralCode, discountCode, isPending, paymentResponse,
  onChangePaymentMethod, onChangeUsdtNetwork, onChangeReferralCode, onChangeDiscountCode, onClose, onConfirm,
}: {
  tier: TierKey; plan: PlanKey; priceVnd: number; walletBalance: number; showReferralInput: boolean;
  paymentMethod: PaymentMethodKey; usdtNetwork: UsdtNetwork; referralCode: string; discountCode: string; isPending: boolean;
  paymentResponse: PurchaseResponse | null;
  onChangePaymentMethod: (m: PaymentMethodKey) => void;
  onChangeUsdtNetwork: (n: UsdtNetwork) => void;
  onChangeReferralCode: (c: string) => void;
  onChangeDiscountCode: (c: string) => void;
  onClose: () => void; onConfirm: () => void;
}) {
  const tierLabel = tier === "ultra" ? "Ultra" : "Pro";
  const planLabel = plan === "monthly" ? "Hàng tháng" : plan === "quarterly" ? "3 tháng" : plan === "semi_annual" ? "6 tháng" : "Hàng năm";
  const insufficientWallet = walletBalance < priceVnd;
  const accent = tier === "ultra" ? "rgb(139,92,246)" : "rgb(99,102,241)";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }} onClick={onClose}>
      <div
        className="relative w-full max-w-md overflow-hidden rounded-[28px] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)]"
        style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gradient accent */}
        <div
          className="relative px-7 pt-7 pb-5"
          style={{
            background: `linear-gradient(180deg, ${accent}14 0%, transparent 100%)`,
            borderBottom: "1px solid var(--bd)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-rose-500/15"
            style={{ background: "var(--inp)", color: "var(--tx-f)" }}
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ background: `${accent}22`, color: accent }}
            >
              {tierLabel}
            </span>
            <span className="text-xs" style={{ color: "var(--tx-m)" }}>{planLabel}</span>
          </div>

          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-4xl font-semibold tracking-tight" style={{ color: "var(--tx)", letterSpacing: "-0.025em" }}>
              {formatCurrency(priceVnd)}
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--tx-f)" }}>
            Kích hoạt tức thì sau khi thanh toán thành công
          </p>
        </div>

        {!paymentResponse ? (
          <div className="px-7 py-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--tx-f)" }}>
              Phương thức thanh toán
            </p>
            <div className="space-y-2">
              <PaymentMethodOption
                icon="🏦"
                label="Chuyển khoản VND"
                description="PayOS — QR ngân hàng"
                isSelected={paymentMethod === "PAYOS"}
                onClick={() => onChangePaymentMethod("PAYOS")}
              />
              <PaymentMethodOption
                icon="💰"
                label="Số dư ví"
                description={insufficientWallet ? "Không đủ — vui lòng nạp thêm" : "Trừ trực tiếp, kích hoạt ngay"}
                subValue={formatCurrency(walletBalance)}
                isSelected={paymentMethod === "WALLET_BALANCE"}
                disabled={insufficientWallet}
                onClick={() => !insufficientWallet && onChangePaymentMethod("WALLET_BALANCE")}
              />
            </div>

            {/* Mã giới thiệu / Mã giảm giá (1 ô duy nhất) */}
            <div className="mt-5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--tx-f)" }}>
                Mã giới thiệu / giảm giá (tuỳ chọn)
              </label>
              <input
                type="text"
                value={discountCode}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  onChangeDiscountCode(v);
                  onChangeReferralCode(v);
                }}
                placeholder="VD: LAMTHANHTHIEN hoặc E4360EEA"
                maxLength={32}
                className="mt-1.5 w-full rounded-xl px-4 py-3 font-mono text-sm uppercase tracking-wider outline-none"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
              />
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--tx-f)" }}>
                Mã hợp lệ sẽ tự áp dụng giảm giá (nếu có) và ghi nhận người giới thiệu.
              </p>
            </div>

            {/* Summary */}
            <div className="mt-6 rounded-2xl p-4" style={{ background: "var(--inp)" }}>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--tx-m)" }}>Tổng cộng</span>
                <span className="text-lg font-semibold" style={{ color: "var(--tx)" }}>{formatCurrency(priceVnd)}</span>
              </div>
              {discountCode.trim() && (
                <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
                  ℹ️ Giá cuối có thể thấp hơn nếu mã có % giảm.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-semibold transition hover:opacity-90 disabled:opacity-50"
              style={{ background: accent, color: "white" }}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang xử lý...
                </>
              ) : (
                <>Xác nhận thanh toán</>
              )}
            </button>

            <p className="mt-3 text-center text-[11px]" style={{ color: "var(--tx-f)" }}>
              Bằng cách tiếp tục, bạn đồng ý với điều khoản dịch vụ
            </p>
          </div>
        ) : (
          <div className="px-7 py-6">
            <QrPaymentView
              paymentMethod={paymentMethod}
              usdtNetwork={usdtNetwork}
              response={paymentResponse}
              priceVnd={priceVnd}
              onCancel={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentMethodOption({ icon, label, description, subValue, isSelected, disabled, onClick }: {
  icon: string; label: string; description?: string; subValue?: string; isSelected: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition ${
        disabled ? "opacity-40 cursor-not-allowed" : "hover:scale-[1.01]"
      }`}
      style={{
        background: isSelected ? "rgba(99,102,241,0.08)" : "var(--inp)",
        border: `1.5px solid ${isSelected ? "rgba(99,102,241,0.6)" : "transparent"}`,
      }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: "var(--surface)" }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold" style={{ color: "var(--tx)" }}>{label}</p>
        {description && (
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{description}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {subValue && (
          <span className="text-[12px] font-semibold tabular-nums" style={{ color: disabled ? "rgb(244,63,94)" : "var(--tx-m)" }}>
            {subValue}
          </span>
        )}
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{
            background: isSelected ? "rgb(99,102,241)" : "transparent",
            border: `1.5px solid ${isSelected ? "rgb(99,102,241)" : "var(--bd)"}`,
          }}
        >
          {isSelected && <CheckCircle2 className="h-3 w-3 text-white" strokeWidth={3} />}
        </div>
      </div>
    </button>
  );
}

function QrPaymentView({ paymentMethod, usdtNetwork, response, onCancel }: {
  paymentMethod: PaymentMethodKey; usdtNetwork: UsdtNetwork; response: PurchaseResponse; priceVnd: number; onCancel: () => void;
}) {
  const { showToast } = useToast();
  const [now, setNow] = useState(Date.now());
  const [canceling, setCanceling] = useState(false);
  const manualCrypto = response.manualCrypto || (response.providerPayload as any)?.manualCrypto;
  const bankInfo = response.bankInfo;
  const address = manualCrypto?.address;
  const usdtAmount = manualCrypto?.usdtAmount;
  const network = usdtNetwork === "TRC20" ? "TRC20 (Tron)" : "Solana";

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const expiresAtMs = response.expiresAt ? new Date(response.expiresAt).getTime() : null;
  const remainingMs = expiresAtMs ? Math.max(0, expiresAtMs - now) : null;
  const remainingMin = remainingMs !== null ? Math.floor(remainingMs / 60000) : null;
  const remainingSec = remainingMs !== null ? Math.floor((remainingMs % 60000) / 1000) : null;
  const expired = remainingMs !== null && remainingMs <= 0;

  let qrImageUrl: string | null = null;
  let qrCaption = "";

  if (paymentMethod === "PAYOS" && response.qrCode) {
    // PayOS trả về raw VietQR text — phải encode qua QR generator
    qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(response.qrCode)}`;
    qrCaption = "Quét QR bằng app ngân hàng";
  } else if (paymentMethod === "USDT" && address) {
    qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(address)}`;
    qrCaption = `Quét QR hoặc copy địa chỉ ví ${network}`;
  }

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast({ tone: "success", message: `Đã copy ${label}` });
  };

  async function handleCancel() {
    if (!response.depositRequestId) { onCancel(); return; }
    if (!window.confirm("Hủy đơn thanh toán này?")) return;
    try {
      setCanceling(true);
      await api.delete(`/wallet/deposit-requests/${response.depositRequestId}`);
      showToast({ tone: "success", message: "Đã hủy đơn." });
      onCancel();
    } catch (err: any) {
      showToast({ tone: "error", message: err?.response?.data?.message || "Không thể hủy đơn." });
    } finally {
      setCanceling(false);
    }
  }

  return (
    <div className="mt-2 space-y-4">
      {qrImageUrl && (
        <div className="flex flex-col items-center">
          <div className="rounded-2xl bg-white p-3 shadow-lg">
            <img src={qrImageUrl} alt="QR Code" className="h-52 w-52" />
          </div>
          <p className="mt-2.5 text-center text-[11px]" style={{ color: "var(--tx-m)" }}>{qrCaption}</p>
        </div>
      )}

      {paymentMethod === "PAYOS" && bankInfo && (
        <div className="space-y-2.5 rounded-2xl p-4" style={{ background: "var(--inp)" }}>
          {bankInfo.accountName && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Chủ TK</p>
              <p className="mt-0.5 text-sm font-semibold" style={{ color: "var(--tx)" }}>{bankInfo.accountName}</p>
            </div>
          )}
          {bankInfo.accountNumber && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>STK</p>
              <button type="button" onClick={() => copy(bankInfo.accountNumber!, "STK")} className="mt-0.5 flex items-center gap-2 text-sm font-mono font-bold" style={{ color: "var(--tx)" }}>
                {bankInfo.accountNumber} <Copy className="h-3 w-3" />
              </button>
            </div>
          )}
          {bankInfo.description && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Nội dung CK</p>
              <button type="button" onClick={() => copy(bankInfo.description!, "nội dung")} className="mt-0.5 flex items-center gap-2 text-[12px] font-mono" style={{ color: "var(--tx)" }}>
                {bankInfo.description} <Copy className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {paymentMethod === "USDT" && address && (
        <div className="space-y-3 rounded-2xl p-4" style={{ background: "var(--inp)" }}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Mạng</p>
            <p className="mt-0.5 text-sm font-semibold" style={{ color: "var(--tx)" }}>{network}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Số tiền cần chuyển</p>
            <button type="button" onClick={() => copy(String(usdtAmount), "số tiền")} className="mt-0.5 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--tx)" }}>
              {usdtAmount} USDT <Copy className="h-3 w-3" />
            </button>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Địa chỉ ví</p>
            <button type="button" onClick={() => copy(address, "địa chỉ")} className="mt-0.5 flex w-full items-center gap-2 break-all rounded-xl px-2 py-1.5 text-left text-xs font-mono transition hover:bg-white/5" style={{ color: "var(--tx)" }}>
              <span className="flex-1">{address}</span>
              <Copy className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>
      )}

      {response.externalOrderCode && (
        <div className="rounded-2xl p-3 text-center" style={{ background: "var(--inp)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Mã đơn</p>
          <button type="button" onClick={() => copy(response.externalOrderCode!, "mã đơn")} className="mt-0.5 inline-flex items-center gap-2 text-xs font-mono" style={{ color: "var(--tx)" }}>
            {response.externalOrderCode} <Copy className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-center gap-2 rounded-2xl py-3"
        style={expired
          ? { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }
          : { background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.3)" }}>
        {expired ? (
          <span className="text-sm font-medium" style={{ color: "rgb(239,68,68)" }}>
            Hết hạn — vui lòng tạo đơn mới
          </span>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "rgb(129,140,248)" }} />
            <span className="text-sm font-medium" style={{ color: "rgb(129,140,248)" }}>
              Đang chờ thanh toán
              {remainingMin !== null && (
                <span className="ml-1.5 tabular-nums">· còn {remainingMin}:{String(remainingSec).padStart(2, "0")}</span>
              )}
            </span>
          </>
        )}
      </div>

      <button type="button" onClick={handleCancel} disabled={canceling}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-[13px] font-semibold transition hover:opacity-90 disabled:opacity-40"
        style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", color: "rgb(239,68,68)" }}>
        {canceling ? <><Loader2 className="h-4 w-4 animate-spin" /> Đang hủy...</> : "Hủy đơn"}
      </button>
    </div>
  );
}
