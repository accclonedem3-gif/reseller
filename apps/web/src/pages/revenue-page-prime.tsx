import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    title: "Doanh thu",
    subtitle: "Phân tích tài chính",
    statRevenue: "Doanh thu gộp",
    statProfit: "Lợi nhuận ước tính",
    statDelivered: "Đơn đã giao",
    statAvg: "Trung bình / ngày",
    chartTitle: "Biểu đồ doanh thu",
    periodToday: "Hôm nay",
    periodWeek: "Tuần này",
    periodMonth: "Tháng này",
    periodCustom: "Tùy chỉnh",
    legendRevenue: "Doanh thu",
    legendProfit: "Lợi nhuận",
    legendAvg: (v: string) => `TB: ${v}`,
    loading: "Đang tải...",
    noDataTitle: "Không có dữ liệu trong khoảng này",
    noDataToday: "Hôm nay chưa có đơn hoàn thành.",
    noDataWeek: "Tuần này chưa có đơn hoàn thành.",
    noDataOther: "Thử chọn khoảng thời gian khác.",
    summaryBestDay: "Ngày tốt nhất",
    summaryAvgProfit: "LN trung bình / ngày",
    summaryAvgSub: (n: number) => `${n} ngày phát sinh`,
    summaryTotalProfit: "Tổng LN kỳ này",
    summaryTotalSub: (n: number) => `${n} đơn giao`,
    milestoneTitle: "Lãi theo mốc thời gian",
    milestoneToday: "Hôm nay",
    milestone7d: "7 ngày qua",
    milestone30d: "30 ngày qua",
    milestone90d: "90 ngày qua",
    milestoneAll: "Tất cả thời gian",
    dailyTitle: "Chi tiết theo ngày",
    dailyDays: (n: number) => `${n} ngày`,
    dailyEmpty: "Chưa có dữ liệu trong khoảng thời gian đã chọn.",
    dailySub: (orders: number, profit: string) => `${orders} đơn · LN ${profit}`,
    tooltipRevenue: "Doanh thu",
    tooltipProfit: "Lợi nhuận",
    exportReport: "Xuất báo cáo",
    refresh: "Làm mới",
  },
  en: {
    title: "Revenue",
    subtitle: "Financial analytics",
    statRevenue: "Gross revenue",
    statProfit: "Estimated profit",
    statDelivered: "Delivered orders",
    statAvg: "Average / day",
    chartTitle: "Revenue chart",
    periodToday: "Today",
    periodWeek: "This week",
    periodMonth: "This month",
    periodCustom: "Custom",
    legendRevenue: "Revenue",
    legendProfit: "Profit",
    legendAvg: (v: string) => `Avg: ${v}`,
    loading: "Loading...",
    noDataTitle: "No data in this range",
    noDataToday: "No completed orders today.",
    noDataWeek: "No completed orders this week.",
    noDataOther: "Try selecting a different time range.",
    summaryBestDay: "Best day",
    summaryAvgProfit: "Avg profit / day",
    summaryAvgSub: (n: number) => `${n} days with activity`,
    summaryTotalProfit: "Total profit this period",
    summaryTotalSub: (n: number) => `${n} delivered`,
    milestoneTitle: "Profit by milestone",
    milestoneToday: "Today",
    milestone7d: "Last 7 days",
    milestone30d: "Last 30 days",
    milestone90d: "Last 90 days",
    milestoneAll: "All time",
    dailyTitle: "Daily breakdown",
    dailyDays: (n: number) => `${n} days`,
    dailyEmpty: "No data in the selected time range.",
    dailySub: (orders: number, profit: string) => `${orders} orders · Profit ${profit}`,
    tooltipRevenue: "Revenue",
    tooltipProfit: "Profit",
    exportReport: "Export report",
    refresh: "Refresh",
  },
  th: {
    title: "รายได้",
    subtitle: "การวิเคราะห์การเงิน",
    statRevenue: "รายได้รวม",
    statProfit: "กำไรโดยประมาณ",
    statDelivered: "คำสั่งซื้อที่จัดส่งแล้ว",
    statAvg: "เฉลี่ย / วัน",
    chartTitle: "กราฟรายได้",
    periodToday: "วันนี้",
    periodWeek: "สัปดาห์นี้",
    periodMonth: "เดือนนี้",
    periodCustom: "กำหนดเอง",
    legendRevenue: "รายได้",
    legendProfit: "กำไร",
    legendAvg: (v: string) => `เฉลี่ย: ${v}`,
    loading: "กำลังโหลด...",
    noDataTitle: "ไม่มีข้อมูลในช่วงนี้",
    noDataToday: "วันนี้ยังไม่มีคำสั่งซื้อที่เสร็จสิ้น",
    noDataWeek: "สัปดาห์นี้ยังไม่มีคำสั่งซื้อที่เสร็จสิ้น",
    noDataOther: "ลองเลือกช่วงเวลาอื่น",
    summaryBestDay: "วันที่ดีที่สุด",
    summaryAvgProfit: "กำไรเฉลี่ย / วัน",
    summaryAvgSub: (n: number) => `${n} วันที่มีกิจกรรม`,
    summaryTotalProfit: "กำไรรวมในช่วงนี้",
    summaryTotalSub: (n: number) => `${n} จัดส่งแล้ว`,
    milestoneTitle: "กำไรตามช่วงเวลา",
    milestoneToday: "วันนี้",
    milestone7d: "7 วันที่แล้ว",
    milestone30d: "30 วันที่แล้ว",
    milestone90d: "90 วันที่แล้ว",
    milestoneAll: "ตลอดเวลา",
    dailyTitle: "รายละเอียดรายวัน",
    dailyDays: (n: number) => `${n} วัน`,
    dailyEmpty: "ไม่มีข้อมูลในช่วงเวลาที่เลือก",
    dailySub: (orders: number, profit: string) => `${orders} คำสั่ง · กำไร ${profit}`,
    tooltipRevenue: "รายได้",
    tooltipProfit: "กำไร",
    exportReport: "ส่งออกรายงาน",
    refresh: "รีเฟรช",
  },
};

type RevenuePoint = {
  label: string;
  grossRevenue: number;
  estimatedProfit: number;
  deliveredOrders: number;
};
type ProfitSummary = { today: number; last7d: number; last30d: number; last90d: number; allTime: number };
type RevenueResponse = {
  summary: { grossRevenue: number; estimatedProfit: number; deliveredOrders: number };
  series: RevenuePoint[];
  profitSummary: ProfitSummary;
};
type Period = "today" | "week" | "month" | "custom";

function pad(n: number) { return String(n).padStart(2, "0"); }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function getDateRange(period: Period, custom: { start: string; end: string }) {
  const now = new Date();
  if (period === "today") { const s = fmtDate(now); return { startDate: s, endDate: s }; }
  if (period === "week") {
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return { startDate: fmtDate(mon), endDate: fmtDate(now) };
  }
  if (period === "month") return { startDate: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: fmtDate(now) };
  const fb = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  return { startDate: custom.start || fb, endDate: custom.end || fmtDate(now) };
}

const compactFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
function fmtShort(label: string) { const d = new Date(`${label}T00:00:00`); return Number.isNaN(d.getTime()) ? label : compactFmt.format(d); }
function fmtFull(label: string) { const d = new Date(`${label}T00:00:00`); return Number.isNaN(d.getTime()) ? label : fullFmt.format(d); }

function ChartTooltip({ active, payload, label, t }: {
  active?: boolean; payload?: Array<{ dataKey?: string; value?: number }>; label?: string; t: typeof T["vi"];
}) {
  if (!active || !payload?.length || !label) return null;
  const rev = Number(payload.find((e) => e.dataKey === "grossRevenue")?.value || 0);
  const prof = Number(payload.find((e) => e.dataKey === "estimatedProfit")?.value || 0);
  return (
    <div className="min-w-[200px] rounded-2xl p-4 shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
      <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: "var(--tx-f)" }}>{fmtFull(label)}</p>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-[12px]" style={{ color: "var(--tx-f)" }}>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />{t.tooltipRevenue}
          </span>
          <span className="text-[12px] font-black text-emerald-400">{formatCurrency(rev)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-[12px]" style={{ color: "var(--tx-f)" }}>
            <span className="h-2 w-2 rounded-full bg-orange-400" />{t.tooltipProfit}
          </span>
          <span className="text-[12px] font-black text-orange-400">{formatCurrency(prof)}</span>
        </div>
      </div>
    </div>
  );
}

export function RevenuePagePrime() {
  const { lang } = useLang();
  const t = T[lang];

  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState({ start: "", end: "" });

  const { startDate, endDate } = useMemo(() => getDateRange(period, custom), [period, custom]);

  const query = useQuery<RevenueResponse>({
    queryKey: ["reports", "revenue", startDate, endDate],
    queryFn: async () => (await api.get("/reports/revenue", { params: { startDate, endDate } })).data,
    enabled: period !== "custom" || (!!custom.start && !!custom.end),
  });

  const PERIOD_LABELS: Record<Period, string> = {
    today: t.periodToday, week: t.periodWeek, month: t.periodMonth, custom: t.periodCustom,
  };

  const series = query.data?.series || [];
  const chartData = useMemo(
    () => series.map((item) => ({ ...item, shortLabel: fmtShort(item.label), fullLabel: fmtFull(item.label) })),
    [series],
  );
  const chartRenderData = useMemo(() => {
    if (chartData.length !== 1) return chartData;
    const [pt] = chartData;
    return [
      { ...pt, shortLabel: "", axisKey: "lead", isSynthetic: true },
      { ...pt, axisKey: "main", isSynthetic: false },
      { ...pt, shortLabel: "", axisKey: "tail", isSynthetic: true },
    ];
  }, [chartData]);

  const averageRevenue = chartData.length > 0
    ? Math.round(chartData.reduce((s, i) => s + Number(i.grossRevenue || 0), 0) / chartData.length) : 0;
  const averageProfit = chartData.length > 0
    ? Math.round(chartData.reduce((s, i) => s + Number(i.estimatedProfit || 0), 0) / chartData.length) : 0;
  const bestDay = useMemo(
    () => chartData.reduce<(typeof chartData)[number] | null>(
      (cur, item) => (!cur || item.grossRevenue > cur.grossRevenue ? item : cur), null,
    ), [chartData],
  );

  const summary = query.data?.summary;
  const ps = query.data?.profitSummary;

  const periodBtn = (p: Period) => {
    const active = period === p;
    return (
      <button key={p} type="button" onClick={() => setPeriod(p)}
        className="rounded-full px-4 py-1.5 text-[12px] font-black transition"
        style={active
          ? { border: "1.5px solid rgb(249,115,22)", color: "rgb(249,115,22)", background: "transparent" }
          : { border: "1.5px solid transparent", color: "var(--tx-f)", background: "transparent" }
        }>
        {PERIOD_LABELS[p]}
      </button>
    );
  };

  const statCard = (label: string, value: string, desc: string, valueColor: string, borderColor: string) => (
    <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: `3px solid ${borderColor}` }}>
      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
      <p className="mt-2 text-2xl font-black tabular-nums" style={{ color: valueColor }}>{value}</p>
      <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>{desc}</p>
    </div>
  );

  const periodLabel = (() => {
    if (period === "today") return "Hôm nay";
    if (period === "week") { const now = new Date(); return `Tháng ${now.getMonth() + 1} · ${now.getFullYear()}`; }
    if (period === "month") { const now = new Date(); return `Tháng ${now.getMonth() + 1} · ${now.getFullYear()}`; }
    return custom.start ? `${fmtShort(custom.start)} → ${fmtShort(custom.end)}` : "—";
  })();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "rgb(249,115,22)" }}>{t.title}</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--tx-f)" }}>{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(["today", "week", "month", "custom"] as Period[]).map(periodBtn)}
          {period === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={custom.start} onChange={(e) => setCustom((r) => ({ ...r, start: e.target.value }))}
                className="rounded-xl px-3 py-1.5 text-[12px] outline-none"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
              <span className="text-[12px]" style={{ color: "var(--tx-f)" }}>→</span>
              <input type="date" value={custom.end} onChange={(e) => setCustom((r) => ({ ...r, end: e.target.value }))}
                className="rounded-xl px-3 py-1.5 text-[12px] outline-none"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
            </div>
          )}
          <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}
            className="ml-1 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "var(--primary)", color: "#fff" }}>
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            {t.refresh}
          </button>
        </div>
      </div>

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCard(t.statRevenue, formatCurrency(summary?.grossRevenue || 0), periodLabel, "rgb(52,211,153)", "rgb(52,211,153)")}
        {statCard(t.statProfit, formatCurrency(summary?.estimatedProfit || 0), "Sau khi trừ giá vốn", "rgb(249,115,22)", "rgb(249,115,22)")}
        {statCard(t.statDelivered, String(summary?.deliveredOrders || 0), "Trong kỳ này", "rgb(56,189,248)", "rgb(56,189,248)")}
        {statCard(t.statAvg, formatCurrency(averageRevenue), `${chartData.length} ngày có phát sinh`, "rgb(167,139,250)", "rgb(139,92,246)")}
      </div>

      {/* Main 2-col layout */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">

        {/* Chart card */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
          {/* Card header */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
            <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{t.chartTitle}</h2>
            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <span className="flex items-center gap-1.5" style={{ color: "var(--tx-f)" }}>
                <span className="inline-block h-[2px] w-5 rounded-full bg-emerald-400" />
                {t.legendRevenue}
              </span>
              <span className="flex items-center gap-1.5" style={{ color: "var(--tx-f)" }}>
                <span className="inline-block h-[2px] w-5 rounded-full bg-orange-400" />
                {t.legendProfit}
              </span>
              {averageRevenue > 0 && (
                <span className="flex items-center gap-1.5" style={{ color: "var(--tx-f)" }}>
                  <span className="inline-block h-[2px] w-5 rounded-full opacity-60" style={{ background: "rgb(249,115,22)", borderTop: "2px dashed rgb(249,115,22)" }} />
                  {t.legendAvg(formatCurrency(averageRevenue))}
                </span>
              )}
            </div>
          </div>

          {/* Chart area */}
          <div className="px-2 pt-4 pb-2" style={{ height: 320 }}>
            {query.isLoading ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm" style={{ color: "var(--tx-f)" }}>{t.loading}</p>
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl" style={{ border: "1px dashed var(--bd)" }}>
                <span className="text-4xl">📊</span>
                <p className="font-black" style={{ color: "var(--tx)" }}>{t.noDataTitle}</p>
                <p className="text-sm" style={{ color: "var(--tx-f)" }}>
                  {period === "today" ? t.noDataToday : period === "week" ? t.noDataWeek : t.noDataOther}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartRenderData} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgb(52,211,153)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="rgb(52,211,153)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgb(249,115,22)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="rgb(249,115,22)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="shortLabel" stroke="rgba(148,163,184,0.5)" tickLine={false} axisLine={false}
                    tickFormatter={(v) => v || ""} style={{ fontSize: 11 }} />
                  <YAxis stroke="rgba(148,163,184,0.5)" tickLine={false} axisLine={false} width={64}
                    style={{ fontSize: 11 }}
                    tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}tr` : v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
                  {averageRevenue > 0 && (
                    <ReferenceLine y={averageRevenue} stroke="rgba(249,115,22,0.4)" strokeDasharray="6 4" />
                  )}
                  <Tooltip content={<ChartTooltip t={t} />} />
                  <Area type="monotone" dataKey="grossRevenue" stroke="rgb(52,211,153)" strokeWidth={2.5}
                    fill="url(#gradRevenue)" dot={false} activeDot={{ r: 5, fill: "rgb(52,211,153)", stroke: "#fff", strokeWidth: 2 }} />
                  <Area type="monotone" dataKey="estimatedProfit" stroke="rgb(249,115,22)" strokeWidth={2}
                    fill="url(#gradProfit)" dot={false} activeDot={{ r: 4.5, fill: "rgb(249,115,22)", stroke: "#fff", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Bottom 3 mini-cards */}
          {chartData.length > 0 && (
            <div className="grid grid-cols-3 gap-0" style={{ borderTop: "1px solid var(--bd)" }}>
              {[
                { label: t.summaryBestDay, value: bestDay ? formatCurrency(bestDay.grossRevenue) : "—", sub: bestDay?.fullLabel, color: "rgb(52,211,153)" },
                { label: t.summaryAvgProfit, value: formatCurrency(averageProfit), sub: t.summaryAvgSub(chartData.length), color: "var(--tx)" },
                { label: t.summaryTotalProfit, value: formatCurrency(summary?.estimatedProfit || 0), sub: t.summaryTotalSub(summary?.deliveredOrders || 0), color: "rgb(249,115,22)" },
              ].map(({ label, value, sub, color }, i) => (
                <div key={label} className="px-5 py-4"
                  style={{ borderRight: i < 2 ? "1px solid var(--bd)" : undefined }}>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
                  <p className="mt-1.5 text-[15px] font-black tabular-nums" style={{ color }}>{value}</p>
                  {sub && <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{sub}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Milestone card */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{t.milestoneTitle}</h2>
            </div>
            <div className="p-4 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {([
                  { label: t.milestoneToday, value: ps?.today ?? 0 },
                  { label: t.milestone7d, value: ps?.last7d ?? 0 },
                  { label: t.milestone30d, value: ps?.last30d ?? 0 },
                  { label: t.milestone90d, value: ps?.last90d ?? 0 },
                ] as const).map(({ label, value }) => (
                  <div key={label} className="rounded-xl px-3.5 py-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                    <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
                    <p className="mt-1.5 text-[13px] font-black tabular-nums"
                      style={{ color: value > 0 ? "rgb(249,115,22)" : "var(--tx-f)" }}>
                      {value > 0 ? formatCurrency(value) : "—"}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-xl px-3.5 py-3"
                style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)" }}>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">{t.milestoneAll}</p>
                <p className="text-[15px] font-black tabular-nums text-orange-400">
                  {(ps?.allTime ?? 0) > 0 ? formatCurrency(ps!.allTime) : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Daily breakdown */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{t.dailyTitle}</h2>
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                {t.dailyDays(chartData.length)}
              </span>
            </div>
            <div className="max-h-[420px] overflow-y-auto custom-scrollbar divide-y" style={{ borderColor: "var(--bd)" }}>
              {chartData.length === 0 ? (
                <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.dailyEmpty}</p>
              ) : (
                [...chartData].reverse().map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div>
                      <p className="text-[13px] font-black" style={{ color: "var(--tx)" }}>{item.fullLabel}</p>
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>
                        {t.dailySub(item.deliveredOrders, formatCurrency(item.estimatedProfit || 0))}
                      </p>
                    </div>
                    <p className="text-[14px] font-black tabular-nums text-emerald-400">
                      {formatCurrency(item.grossRevenue || 0)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
