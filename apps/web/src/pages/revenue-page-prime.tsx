import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  CalendarRange,
  CircleDollarSign,
  PackageCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Phân tích tài chính",
    title: "Doanh thu",
    desc: "Theo dõi doanh thu và lợi nhuận theo khoảng thời gian tùy chỉnh.",
    statRevenue: "Doanh thu gộp",
    statProfit: "Lợi nhuận ước tính",
    statDelivered: "Đơn đã giao",
    statAvg: "TB / ngày",
    chartTitle: "Biểu đồ doanh thu",
    periodToday: "Hôm nay",
    periodWeek: "Tuần này",
    periodMonth: "Tháng này",
    periodCustom: "Tùy chỉnh",
    legendRevenue: "Doanh thu",
    legendProfit: "Lợi nhuận ước tính",
    legendAvg: (v: string) => `---- TB: ${v}`,
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
    dailySub: (orders: number, profit: string) => `${orders} đơn • LN ${profit}`,
    tooltipRevenue: "Doanh thu",
    tooltipProfit: "Lợi nhuận",
  },
  en: {
    eyebrow: "Financial analytics",
    title: "Revenue",
    desc: "Track revenue and profit over a custom time range.",
    statRevenue: "Gross revenue",
    statProfit: "Estimated profit",
    statDelivered: "Delivered orders",
    statAvg: "Avg / day",
    chartTitle: "Revenue chart",
    periodToday: "Today",
    periodWeek: "This week",
    periodMonth: "This month",
    periodCustom: "Custom",
    legendRevenue: "Revenue",
    legendProfit: "Estimated profit",
    legendAvg: (v: string) => `---- Avg: ${v}`,
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
    dailySub: (orders: number, profit: string) => `${orders} orders • Profit ${profit}`,
    tooltipRevenue: "Revenue",
    tooltipProfit: "Profit",
  },
  th: {
    eyebrow: "การวิเคราะห์การเงิน",
    title: "รายได้",
    desc: "ติดตามรายได้และกำไรตามช่วงเวลาที่กำหนดเอง",
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
    legendProfit: "กำไรโดยประมาณ",
    legendAvg: (v: string) => `---- เฉลี่ย: ${v}`,
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
    dailySub: (orders: number, profit: string) => `${orders} คำสั่ง • กำไร ${profit}`,
    tooltipRevenue: "รายได้",
    tooltipProfit: "กำไร",
  },
};

type RevenuePoint = {
  label: string;
  grossRevenue: number;
  estimatedProfit: number;
  deliveredOrders: number;
};

type ProfitSummary = {
  today: number;
  last7d: number;
  last30d: number;
  last90d: number;
  allTime: number;
};

type RevenueResponse = {
  summary: { grossRevenue: number; estimatedProfit: number; deliveredOrders: number };
  series: RevenuePoint[];
  profitSummary: ProfitSummary;
};

type Period = "today" | "week" | "month" | "custom";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function getDateRange(period: Period, custom: { start: string; end: string }) {
  const now = new Date();
  if (period === "today") {
    const s = fmtDate(now);
    return { startDate: s, endDate: s };
  }
  if (period === "week") {
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return { startDate: fmtDate(mon), endDate: fmtDate(now) };
  }
  if (period === "month") {
    return {
      startDate: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      endDate: fmtDate(now),
    };
  }
  const fallbackStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const fallbackEnd = fmtDate(now);
  return {
    startDate: custom.start || fallbackStart,
    endDate: custom.end || fallbackEnd,
  };
}

const compactFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

function fmtShort(label: string) {
  const d = new Date(`${label}T00:00:00`);
  return Number.isNaN(d.getTime()) ? label : compactFmt.format(d);
}
function fmtFull(label: string) {
  const d = new Date(`${label}T00:00:00`);
  return Number.isNaN(d.getTime()) ? label : fullFmt.format(d);
}

function ChartTooltip({
  active,
  payload,
  label,
  t,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number }>;
  label?: string;
  t: typeof T["vi"];
}) {
  if (!active || !payload?.length || !label) return null;
  const rev = Number(payload.find((e) => e.dataKey === "grossRevenue")?.value || 0);
  const prof = Number(payload.find((e) => e.dataKey === "estimatedProfit")?.value || 0);
  return (
    <div className="min-w-[220px] rounded-[18px] border border-white/10 bg-[#0a1220]/95 p-4 shadow-[0_24px_70px_rgba(2,6,23,0.42)] backdrop-blur-xl">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">{fmtFull(label)}</p>
      <div className="mt-3 space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            {t.tooltipRevenue}
          </span>
          <span className="text-sm font-semibold text-white">{formatCurrency(rev)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm text-slate-300">
            <span className="h-2 w-2 rounded-full bg-orange-400" />
            {t.tooltipProfit}
          </span>
          <span className="text-sm font-semibold text-orange-400">{formatCurrency(prof)}</span>
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
    queryFn: async () =>
      (await api.get("/reports/revenue", { params: { startDate, endDate } })).data,
    enabled: period !== "custom" || (!!custom.start && !!custom.end),
  });

  const PERIOD_LABELS: Record<Period, string> = {
    today: t.periodToday,
    week: t.periodWeek,
    month: t.periodMonth,
    custom: t.periodCustom,
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

  const averageRevenue =
    chartData.length > 0
      ? Math.round(chartData.reduce((s, i) => s + Number(i.grossRevenue || 0), 0) / chartData.length)
      : 0;

  const averageProfit =
    chartData.length > 0
      ? Math.round(chartData.reduce((s, i) => s + Number(i.estimatedProfit || 0), 0) / chartData.length)
      : 0;

  const bestDay = useMemo(
    () => chartData.reduce<(typeof chartData)[number] | null>(
      (cur, item) => (!cur || item.grossRevenue > cur.grossRevenue ? item : cur),
      null,
    ),
    [chartData],
  );

  const summary = query.data?.summary;
  const ps = query.data?.profitSummary;

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc}
        gradient="amber"
        stats={[
          { icon: CircleDollarSign, label: t.statRevenue, value: formatCurrency(summary?.grossRevenue || 0), iconCls: "text-amber-400", bgCls: "bg-amber-500/15" },
          { icon: BarChart3, label: t.statProfit, value: formatCurrency(summary?.estimatedProfit || 0), iconCls: "text-orange-400", bgCls: "bg-orange-500/15" },
          { icon: PackageCheck, label: t.statDelivered, value: String(summary?.deliveredOrders || 0), iconCls: "text-sky-400", bgCls: "bg-sky-500/15" },
          { icon: CalendarRange, label: t.statAvg, value: formatCurrency(averageRevenue), iconCls: "text-violet-400", bgCls: "bg-violet-500/15" },
        ]}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        {/* ── Chart card ── */}
        <Card className="overflow-hidden">
          <CardHeader
            icon={TrendingUp}
            title={t.chartTitle}
            iconCls="text-amber-400"
            iconBg="bg-amber-500/10"
          />

          {/* Period selector */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(["today", "week", "month", "custom"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className="rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-all"
                style={
                  period === p
                    ? { background: "rgb(249,115,22)", color: "#fff", border: "1px solid transparent" }
                    : { background: "var(--inp)", color: "var(--tx-m)", border: "1px solid var(--bd)" }
                }
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}

            {period === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={custom.start}
                  onChange={(e) => setCustom((r) => ({ ...r, start: e.target.value }))}
                  className="rounded-xl px-3 py-1.5 text-xs font-medium outline-none"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                />
                <span className="text-xs" style={{ color: "var(--tx-f)" }}>→</span>
                <input
                  type="date"
                  value={custom.end}
                  onChange={(e) => setCustom((r) => ({ ...r, end: e.target.value }))}
                  className="rounded-xl px-3 py-1.5 text-xs font-medium outline-none"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                />
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/35 px-3 py-1.5 text-slate-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {t.legendRevenue}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/35 px-3 py-1.5 text-slate-200">
              <span className="h-2 w-2 rounded-full bg-orange-400" />
              {t.legendProfit}
            </span>
            {averageRevenue > 0 && (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/35 px-3 py-1.5 text-slate-400">
                {t.legendAvg(formatCurrency(averageRevenue))}
              </span>
            )}
          </div>

          {/* Chart */}
          <div className="mt-5 h-[360px]">
            {query.isLoading ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm" style={{ color: "var(--tx-f)" }}>{t.loading}</p>
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-white/10 bg-slate-950/25 text-center">
                <span className="text-4xl">📊</span>
                <p className="font-semibold text-white">{t.noDataTitle}</p>
                <p className="max-w-xs text-sm text-slate-400">
                  {period === "today"
                    ? t.noDataToday
                    : period === "week"
                      ? t.noDataWeek
                      : t.noDataOther}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRenderData} margin={{ top: 12, right: 18, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.10)" vertical={false} />
                  <XAxis
                    dataKey="shortLabel"
                    stroke="rgba(148,163,184,0.72)"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => v || ""}
                  />
                  <YAxis
                    stroke="rgba(148,163,184,0.72)"
                    tickLine={false}
                    axisLine={false}
                    width={70}
                    tickFormatter={(v) =>
                      v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}tr` : v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
                    }
                  />
                  {averageRevenue > 0 && (
                    <ReferenceLine y={averageRevenue} stroke="rgba(52,211,153,0.28)" strokeDasharray="6 6" />
                  )}
                  <Tooltip content={<ChartTooltip t={t} />} />
                  <Line
                    type="monotone"
                    dataKey="grossRevenue"
                    stroke="#34D399"
                    strokeWidth={2.8}
                    dot={{ r: 3.5, fill: "#34D399", stroke: "#121A2E", strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: "#34D399", stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="estimatedProfit"
                    stroke="#f97316"
                    strokeWidth={2.2}
                    dot={{ r: 3, fill: "#f97316", stroke: "#121A2E", strokeWidth: 2 }}
                    activeDot={{ r: 5.5, fill: "#f97316", stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Best day + avg summary row */}
          {chartData.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: t.summaryBestDay, value: bestDay ? formatCurrency(bestDay.grossRevenue) : "—", sub: bestDay?.fullLabel },
                { label: t.summaryAvgProfit, value: formatCurrency(averageProfit), sub: t.summaryAvgSub(chartData.length) },
                { label: t.summaryTotalProfit, value: formatCurrency(summary?.estimatedProfit || 0), sub: t.summaryTotalSub(summary?.deliveredOrders || 0), accent: true },
              ].map(({ label, value, sub, accent }) => (
                <div
                  key={label}
                  className="rounded-[14px] px-3.5 py-3"
                  style={{
                    background: accent ? "rgba(249,115,22,0.06)" : "var(--inp)",
                    border: `1px solid ${accent ? "rgba(249,115,22,0.22)" : "var(--bd)"}`,
                  }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
                  <p
                    className="mt-1.5 text-sm font-bold tabular-nums"
                    style={{ color: accent ? "rgb(249,115,22)" : "var(--tx)" }}
                  >
                    {value}
                  </p>
                  {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Right column ── */}
        <div className="space-y-5">
          {/* Profit by fixed periods */}
          <Card>
            <CardHeader
              icon={Sparkles}
              title={t.milestoneTitle}
              iconCls="text-orange-400"
              iconBg="bg-orange-500/10"
            />
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {([
                { label: t.milestoneToday, value: ps?.today ?? 0 },
                { label: t.milestone7d, value: ps?.last7d ?? 0 },
                { label: t.milestone30d, value: ps?.last30d ?? 0 },
                { label: t.milestone90d, value: ps?.last90d ?? 0 },
              ] as const).map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-[14px] px-3.5 py-3"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
                  <p
                    className="mt-1.5 text-sm font-bold tabular-nums"
                    style={{ color: value > 0 ? "rgb(249,115,22)" : "var(--tx-f)" }}
                  >
                    {value > 0 ? formatCurrency(value) : "—"}
                  </p>
                </div>
              ))}
            </div>
            <div
              className="mt-2.5 flex items-center justify-between rounded-[14px] px-3.5 py-3"
              style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)" }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-orange-400">
                {t.milestoneAll}
              </p>
              <p className="text-sm font-bold tabular-nums text-orange-400">
                {(ps?.allTime ?? 0) > 0 ? formatCurrency(ps!.allTime) : "—"}
              </p>
            </div>
          </Card>

          {/* Daily breakdown */}
          <Card>
            <CardHeader
              icon={CalendarRange}
              title={t.dailyTitle}
              iconCls="text-violet-400"
              iconBg="bg-violet-500/10"
              right={
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
                >
                  {t.dailyDays(chartData.length)}
                </span>
              }
            />
            <div className="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar pr-0.5">
              {chartData.length === 0 ? (
                <p className="py-3 text-sm text-slate-500">
                  {t.dailyEmpty}
                </p>
              ) : (
                [...chartData].reverse().map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-3"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                  >
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>
                        {item.fullLabel}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {t.dailySub(item.deliveredOrders, formatCurrency(item.estimatedProfit || 0))}
                      </p>
                    </div>
                    <p className="text-base font-bold tabular-nums text-emerald-400">
                      {formatCurrency(item.grossRevenue || 0)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
