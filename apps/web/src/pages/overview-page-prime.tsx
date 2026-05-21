import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { RefreshCw, X, Check, Crown, Zap, Link2 } from "lucide-react";

import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { cn } from "@/lib/cn";

// ─── helpers ────────────────────────────────────────────────────────────────

function fillDays(series: any[], days: number) {
  const map = new Map(series.map((s: any) => [s.label, s]));
  const result: any[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toISOString().slice(0, 10);
    result.push(map.get(label) ?? { label, grossRevenue: 0, estimatedProfit: 0, deliveredOrders: 0 });
  }
  return result;
}

function shortCode(code: string) {
  const idx = code.lastIndexOf("-");
  if (idx === -1) return { prefix: "", suffix: code };
  return { prefix: code.slice(0, idx + 1), suffix: code.slice(idx + 1) };
}

function fmtTime(dateStr: string) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} · ${dd}/${mo}`;
}

function fmtAxisDate(label: string) {
  if (!label) return "";
  const parts = label.split("-");
  return `${parseInt(parts[2] ?? "0")}/${parseInt(parts[1] ?? "0")}`;
}

function fmtYAxis(v: number) {
  if (v === 0) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}

function statusInfo(status: string): { label: string; color: string; bg: string; dot: string } {
  const s = String(status || "").toLowerCase();
  if (s === "delivered") return { label: "Đã giao", color: "rgb(52,211,153)", bg: "rgba(52,211,153,0.12)", dot: "bg-emerald-400" };
  if (s === "paid") return { label: "Đã thanh toán", color: "rgb(56,189,248)", bg: "rgba(56,189,248,0.12)", dot: "bg-sky-400" };
  if (s === "awaiting_payment") return { label: "Chờ thanh toán", color: "rgb(251,191,36)", bg: "rgba(251,191,36,0.12)", dot: "bg-amber-400" };
  if (s === "failed" || s === "refunded") return { label: "Thất bại", color: "rgb(248,113,113)", bg: "rgba(248,113,113,0.12)", dot: "bg-red-400" };
  return { label: formatStatusLabel(status), color: "var(--tx-f)", bg: "var(--inp)", dot: "bg-slate-400" };
}

// ─── WelcomeOverlay ─────────────────────────────────────────────────────────

const WELCOME_FEATURES = {
  vi: {
    pro: ["Bot Telegram tự động 24/7", "Mở shop bán hàng riêng", "Thanh toán PayOS & Binance Pay", "Kết nối nguồn hàng Tổng sỉ"],
    ultra: ["Tất cả tính năng Pro", "Tạo kho sỉ riêng + API key", "Bảo hành tự động cho đại lý", "Báo cáo doanh thu realtime"],
  },
  en: {
    pro: ["24/7 Telegram bot automation", "Open your own shop", "PayOS & Binance Pay payments", "Connect wholesale source"],
    ultra: ["All Pro features", "Create your own wholesale + API key", "Automatic warranty for dealers", "Real-time revenue reports"],
  },
  th: {
    pro: ["บอท Telegram อัตโนมัติ 24/7", "เปิดร้านค้าของตัวเอง", "ชำระผ่าน PayOS & Binance Pay", "เชื่อมต่อแหล่งสินค้าส่ง"],
    ultra: ["ทุกฟีเจอร์ Pro", "สร้างคลังสินค้าส่ง + API key", "รับประกันอัตโนมัติสำหรับตัวแทน", "รายงานรายได้แบบเรียลไทม์"],
  },
};

function WelcomeOverlay({ tier, onDismiss }: { tier: string; onDismiss: () => void }) {
  const { lang } = useLang();
  const isDark = useDarkMode();
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [barShrunk, setBarShrunk] = useState(false);

  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      setShown(true);
      requestAnimationFrame(() => setBarShrunk(true));
    });
    const timer = setTimeout(() => handleDismiss(), 5000);
    return () => { cancelAnimationFrame(raf1); clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDismiss() { setLeaving(true); setTimeout(onDismiss, 350); }

  const isPro = tier === "pro";
  const tierLabel = isPro ? "Pro" : "Ultra";
  const features: string[] = WELCOME_FEATURES[lang]?.[isPro ? "pro" : "ultra"] ?? [];

  return createPortal(
    <div className={cn("fixed inset-0 z-[80] flex items-center justify-center px-4 transition-opacity duration-300", leaving ? "opacity-0 pointer-events-none" : "opacity-100")} style={{ background: "rgba(0,0,0,0.75)" }} onClick={handleDismiss}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={cn("absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-3xl", isPro ? "bg-emerald-500" : "bg-violet-500")} />
        <div className={cn("absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-15 blur-3xl", isPro ? "bg-teal-400" : "bg-purple-600")} />
      </div>
      <div className={cn("relative w-full max-w-sm rounded-[28px] p-7 text-center border shadow-[0_48px_120px_rgba(0,0,0,0.8)] transition-all duration-500 ease-out", shown && !leaving ? "scale-100 translate-y-0 opacity-100" : "scale-90 translate-y-6 opacity-0", isPro ? "border-emerald-400/30" : "border-violet-400/30", isDark && (isPro ? "bg-[linear-gradient(160deg,#0c1c14,#091510)]" : "bg-[linear-gradient(160deg,#100d1e,#0b0918)]"))} style={!isDark ? { backgroundColor: "var(--surface)" } : undefined} onClick={(e) => e.stopPropagation()}>
        <button onClick={handleDismiss} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-500 transition hover:text-white"><X className="h-4 w-4" /></button>
        <div className="mb-5 flex justify-center">
          <div className={cn("flex h-20 w-20 items-center justify-center rounded-[24px]", isPro ? "bg-[linear-gradient(135deg,#34D399,#10B981)] shadow-[0_0_48px_rgba(52,211,153,0.5)]" : "bg-[linear-gradient(135deg,#a78bfa,#7c3aed)] shadow-[0_0_48px_rgba(139,92,246,0.5)]")}>
            {isPro ? <Zap className="h-9 w-9 text-[#07131e]" /> : <Crown className="h-9 w-9 text-white" />}
          </div>
        </div>
        <h2 className="text-[1.6rem] font-black leading-tight text-white">Chào mừng đến với <span className={isPro ? "text-emerald-300" : "text-violet-300"}>{tierLabel}!</span></h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{`Gói ${tierLabel} đã được kích hoạt. Bắt đầu vận hành thôi!`}</p>
        <div className="mt-5 space-y-2.5 text-left">
          {features.map((f) => (
            <div key={f} className="flex items-center gap-2.5">
              <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", isPro ? "bg-emerald-500/20 text-emerald-300" : "bg-violet-500/20 text-violet-300")}><Check className="h-3 w-3 stroke-[2.5]" /></div>
              <span className="text-sm text-slate-300">{f}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className={cn("h-full rounded-full", isPro ? "bg-emerald-400" : "bg-violet-400")} style={{ width: barShrunk ? "0%" : "100%", transition: barShrunk ? "width 5000ms linear" : "none" }} />
        </div>
        <p className="mt-2 text-xs text-slate-600">Tự động đóng sau vài giây</p>
      </div>
    </div>,
    document.body,
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function OverviewPagePrime() {
  const { lang } = useLang();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const welcomeTier = searchParams.get("welcome");

  const [chartDays, setChartDays] = useState(7);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  function dismissWelcome() {
    setSearchParams((p) => { p.delete("welcome"); return p; });
  }

  const shopQuery = useQuery({ queryKey: ["shop"], queryFn: async () => (await api.get("/shops/current")).data });
  const sourceWalletQuery = useQuery({ queryKey: ["wallet", "source-balance", "overview"], queryFn: async () => (await api.get("/wallet/source-balance")).data, retry: false });
  const ordersQuery = useQuery({ queryKey: ["orders", "overview"], queryFn: async () => (await api.get("/orders")).data, refetchInterval: 30000 });
  const revenueQuery = useQuery({ queryKey: ["revenue", "overview"], queryFn: async () => (await api.get("/reports/revenue")).data });
  const topBuyersQuery = useQuery({ queryKey: ["top-buyers", "overview"], queryFn: async () => (await api.get("/reports/top-buyers")).data });
  const chartQuery = useQuery({
    queryKey: ["revenue", "chart", chartDays],
    queryFn: async () => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - chartDays + 1);
      const s = start.toISOString().slice(0, 10);
      const e = end.toISOString().slice(0, 10);
      return (await api.get(`/reports/revenue?startDate=${s}&endDate=${e}`)).data;
    },
  });

  const orders: any[] = ordersQuery.data || [];
  const topBuyers: any[] = topBuyersQuery.data || [];
  const deliveredOrders = orders.filter((o) => String(o.status || "").toLowerCase() === "delivered");
  const watchOrders = orders.filter((o) => ["awaiting_payment", "paid", "processing_purchase", "paid_waiting_stock"].includes(String(o.status || "").toLowerCase()));

  const chartSeries = fillDays(chartQuery.data?.series || [], chartDays);
  const chartTotal = chartSeries.reduce((s, d) => s + d.grossRevenue, 0);

  const sourceBalance = sourceWalletQuery.data?.walletCurrency === "VND"
    ? formatCurrency(Number(sourceWalletQuery.data?.balance || 0))
    : sourceWalletQuery.data?.balanceText || `${Number(sourceWalletQuery.data?.balance || 0)} ${sourceWalletQuery.data?.walletCurrency || ""}`.trim() || "—";

  const grossRevenue = revenueQuery.data?.summary?.grossRevenue || 0;

  const activeOrder = selectedOrder || orders[0];

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const monthYear = `Tháng ${now.getMonth() + 1} · ${now.getFullYear()}`;

  function refreshAll() {
    void Promise.all([shopQuery.refetch(), sourceWalletQuery.refetch(), ordersQuery.refetch(), revenueQuery.refetch(), topBuyersQuery.refetch(), chartQuery.refetch()]);
  }

  const statCard = (label: string, value: string | number, sub: string, valueColor: string, borderColor: string) => (
    <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: `3px solid ${borderColor}` }}>
      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
      <p className="mt-2 text-2xl font-black tabular-nums truncate" style={{ color: valueColor }}>{value}</p>
      <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>{sub}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {welcomeTier && <WelcomeOverlay tier={welcomeTier} onDismiss={dismissWelcome} />}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "rgb(249,115,22)" }}>Tổng quan bán hàng</h1>
          <p className="mt-1 flex items-center gap-1.5 text-[13px]" style={{ color: "var(--tx-f)" }}>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            {monthYear} · Cập nhật lúc {currentTime}
          </p>
        </div>
        <button type="button" onClick={refreshAll} disabled={ordersQuery.isFetching}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
          style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
          <RefreshCw className={`h-3.5 w-3.5 ${ordersQuery.isFetching ? "animate-spin" : ""}`} />
          Làm mới
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCard("Doanh thu tháng", formatCurrency(grossRevenue), "Tổng đơn đã thanh toán", "rgb(99,102,241)", "rgb(99,102,241)")}
        {statCard("Đơn đã giao", deliveredOrders.length, "Giao thành công", "rgb(249,115,22)", "rgb(249,115,22)")}
        {statCard("Ví bot nguồn", sourceWalletQuery.isLoading ? "..." : sourceBalance, "Số dư khả dụng", "rgb(52,211,153)", "rgb(52,211,153)")}
        {statCard("Đơn cần theo dõi", watchOrders.length, "Chờ xử lý / thanh toán", "rgb(248,113,113)", "rgb(239,68,68)")}
      </div>

      {/* Revenue chart */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Doanh thu theo ngày</h2>
          <div className="flex items-center gap-1">
            {([7, 14, 30] as const).map((d) => (
              <button key={d} type="button" onClick={() => setChartDays(d)}
                className="rounded-full px-3 py-1 text-[12px] font-black transition"
                style={{ background: chartDays === d ? "rgba(249,115,22,0.15)" : "transparent", border: `1px solid ${chartDays === d ? "rgba(249,115,22,0.5)" : "transparent"}`, color: chartDays === d ? "rgb(249,115,22)" : "var(--tx-f)" }}>
                {d} ngày
              </button>
            ))}
          </div>
          <span className="ml-auto text-[13px] font-black tabular-nums" style={{ color: "var(--tx-f)" }}>
            Tổng: <span style={{ color: "rgb(249,115,22)" }}>{formatCurrency(chartTotal)}</span>
          </span>
        </div>
        <div className="mt-4" style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartSeries} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgb(249,115,22)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="rgb(249,115,22)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tickFormatter={fmtAxisDate} tick={{ fontSize: 11, fill: "var(--tx-f)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtYAxis} tick={{ fontSize: 11, fill: "var(--tx-f)" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--bd)", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "var(--tx-f)", marginBottom: 4 }}
                formatter={(v: any) => [formatCurrency(v), "Doanh thu"]}
                labelFormatter={fmtAxisDate}
              />
              <Area type="monotone" dataKey="grossRevenue" stroke="rgb(249,115,22)" strokeWidth={2} fill="url(#chartGrad)" dot={false} activeDot={{ r: 4, fill: "rgb(249,115,22)" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom 2-col */}
      <div className="grid gap-4 xl:grid-cols-[1.5fr_0.5fr]">
        {/* Orders table */}
        <div className="overflow-hidden rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
          <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black" style={{ color: "var(--tx)" }}>Luồng đơn gần đây</h2>
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black" style={{ background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)" }}>
                {orders.length} đơn
              </span>
            </div>
            <button type="button" onClick={() => navigate("/orders")}
              className="text-[12px] font-black transition hover:opacity-70"
              style={{ color: "rgb(249,115,22)" }}>
              Xem tất cả →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 580 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                  {["MÃ ĐƠN", "SẢN PHẨM", "KHÁCH", "GIAO", "TIỀN"].map((col, i) => (
                    <th key={col} className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${i === 4 ? "text-right" : "text-left"}`} style={{ color: "var(--tx-f)" }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordersQuery.isLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-8 animate-pulse rounded-lg" style={{ background: "var(--inp)" }} /></td></tr>
                )) : orders.slice(0, 6).map((order: any) => {
                  const { prefix, suffix } = shortCode(order.orderCode || "");
                  const si = statusInfo(order.status);
                  const isActive = activeOrder?.id === order.id;
                  return (
                    <tr key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      className="cursor-pointer border-b transition-colors duration-100"
                      style={{ borderColor: "var(--bd)", background: isActive ? "rgba(249,115,22,0.05)" : "transparent" }}>
                      <td className="px-4 py-3">
                        <p className="font-mono text-[12px]" style={{ color: "var(--tx-f)" }}>
                          {prefix}<span className="font-black" style={{ color: "rgb(251,191,36)" }}>{suffix}</span>
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "rgb(249,115,22)" }}>
                          <Link2 className="h-2.5 w-2.5" /> Xem
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{order.productName || "—"}</p>
                        {String(order.status || "").toLowerCase() === "delivered" && (
                          <p className="mt-0.5 text-[11px] text-emerald-400">✓ Đã giao tài khoản</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px]" style={{ color: "var(--tx)" }}>
                          {order.customer?.telegramUsername ? `@${order.customer.telegramUsername}` : order.customer?.name || "—"}
                        </p>
                        {order.customer?.telegramChatId && (
                          <p className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--tx-f)" }}>{order.customer.telegramChatId}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black w-fit"
                          style={{ background: si.bg, color: si.color }}>
                          <span className={`h-1.5 w-1.5 rounded-full ${si.dot}`} /> {si.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-black tabular-nums" style={{ color: "var(--tx)" }}>
                        {formatCurrency(order.totalSaleAmount)}
                      </td>
                    </tr>
                  );
                })}
                {!ordersQuery.isLoading && orders.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: "var(--tx-f)" }}>Chưa có đơn hàng nào</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-3">
          {/* Order detail */}
          <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            {activeOrder ? (() => {
              const { prefix, suffix } = shortCode(activeOrder.orderCode || "");
              const si = statusInfo(activeOrder.status);
              return (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-[12px] leading-snug" style={{ color: "var(--tx-f)" }}>
                      {prefix}<span className="font-black" style={{ color: "rgb(251,191,36)" }}>{suffix}</span>
                    </p>
                    <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black"
                      style={{ background: si.bg, color: si.color }}>
                      <span className={`h-1.5 w-1.5 rounded-full ${si.dot}`} /> {si.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{fmtTime(activeOrder.createdAt)}</p>
                  <div className="mt-4 space-y-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Giá trị đơn</p>
                      <p className="mt-1 text-lg font-black tabular-nums" style={{ color: "rgb(249,115,22)" }}>{formatCurrency(activeOrder.totalSaleAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Khách mua</p>
                      <p className="mt-1 text-[13px] font-semibold" style={{ color: "var(--tx)" }}>
                        {activeOrder.customer?.telegramUsername ? `@${activeOrder.customer.telegramUsername}` : activeOrder.customer?.name || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Sản phẩm</p>
                      <p className="mt-1 text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{activeOrder.productName || "—"}</p>
                    </div>
                  </div>
                </>
              );
            })() : (
              <p className="text-[13px]" style={{ color: "var(--tx-f)" }}>Chưa có đơn</p>
            )}
          </div>

          {/* Top buyers */}
          <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <h3 className="text-[13px] font-black" style={{ color: "var(--tx)" }}>Khách giá trị cao</h3>
            <div className="mt-3 space-y-2">
              {topBuyers.slice(0, 4).map((buyer: any, idx: number) => (
                <div key={buyer.customerId} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-black tabular-nums shrink-0" style={{ color: "var(--tx-f)" }}>{String(idx + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold" style={{ color: "var(--tx)" }}>
                        {buyer.telegramUsername ? `@${buyer.telegramUsername}` : buyer.name}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>{buyer.totalOrders} đơn</p>
                    </div>
                  </div>
                  <p className="shrink-0 text-[12px] font-black tabular-nums text-emerald-400">{formatCurrency(buyer.totalSpent)}</p>
                </div>
              ))}
              {topBuyers.length === 0 && <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>Chưa có dữ liệu</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
