import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  Gauge,
  Network,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

type Granularity = "hour" | "minute";

type WarrantyMetrics = {
  queue: { waiting: number; active: number; delayed: number; total: number };
  proxy: { total: number; live: number; dead: number };
  tool24h: { completed: number; failed: number; total: number; successRate: number | null };
  redisCircuitOpen: boolean;
};

type Bucket = {
  t: string;
  total: number;
  refunded: number;
  replaced: number;
  rejected: number;
  pending: number;
};

type WarrantyStats = {
  date: string;
  granularity: Granularity;
  timezone: string;
  rates: { lastMinute: number; lastHour: number; last24h: number };
  summary: {
    total: number;
    pending: number;
    rejected: number;
    refundClaims: number;
    replaceClaims: number;
    accountsRefunded: number;
    accountsReplaced: number;
    refundTotalVnd: number;
    peakBucket: { t: string; count: number } | null;
  };
  buckets: Bucket[];
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nf(n: number) {
  return n.toLocaleString("vi-VN");
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-3xl p-5"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--bd)",
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-[11px]"
          style={{ border: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}
        >
          <Icon className="h-4.5 w-4.5" style={{ color: accent }} />
        </div>
      </div>
      <p className="mt-4 text-2xl font-bold tabular-nums" style={{ color: "var(--tx)" }}>
        {value}
      </p>
      <p className="mt-1 text-sm font-medium" style={{ color: "var(--tx-m)" }}>
        {label}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs" style={{ color: "var(--tx-f)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Bucket }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const b = payload[0]?.payload;
  if (!b) return null;
  return (
    <div
      className="min-w-[180px] rounded-[12px] p-3 text-sm shadow-xl"
      style={{ border: "1px solid var(--bd)", backgroundColor: "var(--surface)" }}
    >
      <p className="font-semibold" style={{ color: "var(--tx)" }}>
        {label}
      </p>
      <div className="mt-2 space-y-1 text-[12px]">
        <Row color="#f97316" name="Tổng đơn" value={b.total} />
        <Row color="#10b981" name="Thay acc mới" value={b.replaced} />
        <Row color="#3b82f6" name="Hoàn tiền" value={b.refunded} />
        <Row color="#eab308" name="Chờ xử lý" value={b.pending} />
        <Row color="#ef4444" name="Từ chối" value={b.rejected} />
      </div>
    </div>
  );
}

function Row({ color, name, value }: { color: string; name: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2" style={{ color: "var(--tx-f)" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {name}
      </span>
      <span className="font-bold tabular-nums" style={{ color: "var(--tx)" }}>
        {value}
      </span>
    </div>
  );
}

export function AdminWarrantyStatsPage() {
  const dark = useDarkMode();
  const [date, setDate] = useState(todayStr());
  const [granularity, setGranularity] = useState<Granularity>("hour");

  const query = useQuery<WarrantyStats>({
    queryKey: ["admin", "warranty-stats", date, granularity],
    queryFn: () =>
      api.get("/admin/warranty-stats", { params: { date, granularity } }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const metricsQuery = useQuery<WarrantyMetrics>({
    queryKey: ["admin", "warranty-metrics"],
    queryFn: () => api.get("/admin/warranty-metrics").then((r) => r.data),
    refetchInterval: 15_000,
  });

  const data = query.data;
  const rates = data?.rates;
  const s = data?.summary;
  const m = metricsQuery.data;

  const gridStroke = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
  const tickFill = dark ? "#64748b" : "#9ca3af";

  // Minute = 1440 điểm → dùng area mượt + chỉ hiện nhãn mỗi giờ.
  const isMinute = granularity === "minute";
  const tickInterval = isMinute ? 59 : 0;

  const buckets = data?.buckets ?? [];
  const hasData = useMemo(() => buckets.some((b) => b.total > 0), [buckets]);

  const granBtn = (g: Granularity, label: string) => {
    const active = granularity === g;
    return (
      <button
        key={g}
        type="button"
        onClick={() => setGranularity(g)}
        className="rounded-full px-4 py-1.5 text-[12px] font-black transition"
        style={
          active
            ? { border: "1.5px solid rgb(249,115,22)", color: "rgb(249,115,22)", background: "transparent" }
            : { border: "1.5px solid transparent", color: "var(--tx-f)", background: "transparent" }
        }
      >
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "rgb(249,115,22)" }}>
            Quản lý bảo hành
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--tx-f)" }}>
            Số lượng bảo hành theo giờ/phút · acc hoàn tiền & thay mới · giờ VN (GMT+7)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl px-3 py-1.5 text-[12px] outline-none"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
          />
          <div className="flex items-center rounded-full p-0.5" style={{ border: "1px solid var(--bd)" }}>
            {granBtn("hour", "Theo giờ")}
            {granBtn("minute", "Theo phút")}
          </div>
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-black text-white transition hover:opacity-80"
            style={{ background: "var(--primary)" }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            Làm mới
          </button>
        </div>
      </div>

      {/* Sức khỏe hệ thống (giám sát vận hành) — cảnh báo to khi proxy sống = 0 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HealthChip
          icon={Network}
          label="Proxy sống"
          value={m ? `${m.proxy.live}/${m.proxy.total}` : "—"}
          tone={m ? (m.proxy.live === 0 ? "danger" : m.proxy.live < 3 ? "warn" : "ok") : "neutral"}
          hint={m && m.proxy.live === 0 ? "⚠ KHÔNG còn proxy sống — bảo hành sẽ chờ duyệt!" : "không Redis-dead"}
        />
        <HealthChip
          icon={Database}
          label="Hàng đợi check"
          value={m ? `${m.queue.total}` : "—"}
          tone={m ? (m.queue.total > 12 ? "warn" : "ok") : "neutral"}
          hint={m ? `${m.queue.active} đang chạy · ${m.queue.waiting} chờ` : ""}
        />
        <HealthChip
          icon={Gauge}
          label="Tool thành công 24h"
          value={m && m.tool24h.successRate != null ? `${m.tool24h.successRate}%` : "—"}
          tone={m && m.tool24h.successRate != null ? (m.tool24h.successRate < 70 ? "warn" : "ok") : "neutral"}
          hint={m ? `${m.tool24h.completed}/${m.tool24h.total} có verdict` : "chưa có dữ liệu"}
        />
        <HealthChip
          icon={ServerCog}
          label="Redis"
          value={m ? (m.redisCircuitOpen ? "DEGRADED" : "OK") : "—"}
          tone={m ? (m.redisCircuitOpen ? "danger" : "ok") : "neutral"}
          hint={m && m.redisCircuitOpen ? "circuit mở — đang bỏ qua cache" : "circuit đóng"}
        />
      </div>

      {/* Tốc độ phát sinh (cuộn theo thời gian thực) */}
      <div>
        <p className="mb-2 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
          Tốc độ phát sinh (thời gian thực) · tự refresh 30s
        </p>
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Activity} accent="#f97316" label="Bảo hành / 1 phút" value={rates?.lastMinute ?? "—"} sub="60 giây gần nhất" />
          <StatCard icon={Clock} accent="#3b82f6" label="Bảo hành / 1 giờ" value={rates?.lastHour ?? "—"} sub="60 phút gần nhất" />
          <StatCard icon={Clock} accent="#8b5cf6" label="Bảo hành / 24 giờ" value={rates?.last24h ?? "—"} sub="24 giờ gần nhất" />
        </div>
      </div>

      {/* Tổng kết ngày đã chọn */}
      <div>
        <p className="mb-2 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
          Tổng kết ngày {data?.date ?? date}
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard icon={ShieldCheck} accent="#f97316" label="Tổng đơn BH" value={nf(s?.total ?? 0)} sub={s?.peakBucket ? `Cao điểm ${s.peakBucket.t} (${s.peakBucket.count})` : "Trong ngày"} />
          <StatCard icon={RotateCcw} accent="#10b981" label="Acc thay mới" value={nf(s?.accountsReplaced ?? 0)} sub={`${nf(s?.replaceClaims ?? 0)} đơn`} />
          <StatCard icon={Wallet} accent="#3b82f6" label="Acc hoàn tiền" value={nf(s?.accountsRefunded ?? 0)} sub={`${nf(s?.refundClaims ?? 0)} đơn`} />
          <StatCard icon={Wallet} accent="#3b82f6" label="Tổng tiền hoàn" value={formatCurrency(s?.refundTotalVnd ?? 0)} sub="Vào ví khách" />
          <StatCard icon={Clock} accent="#eab308" label="Chờ xử lý" value={nf(s?.pending ?? 0)} sub="Đơn trong ngày" />
          <StatCard icon={AlertTriangle} accent="#ef4444" label="Từ chối" value={nf(s?.rejected ?? 0)} sub="Acc còn sống" />
        </div>
      </div>

      {/* Biểu đồ theo giờ/phút */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--tx-m)" }}>
            Số đơn bảo hành {isMinute ? "theo phút" : "theo giờ"} · {data?.date ?? date}
          </p>
          {query.isError && <span className="text-xs text-red-400">Lỗi tải dữ liệu</span>}
        </div>
        <div className="mt-4 h-72">
          {!hasData && !query.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--tx-f)" }}>
              Không có đơn bảo hành nào trong ngày này.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {isMinute ? (
                <AreaChart data={buckets}>
                  <defs>
                    <linearGradient id="whGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="t" interval={tickInterval} tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="total" stroke="#f97316" strokeWidth={2} fill="url(#whGrad)" />
                </AreaChart>
              ) : (
                <BarChart data={buckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="t" interval={tickInterval} tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip cursor={{ fill: "rgba(249,115,22,0.08)" }} content={<ChartTooltip />} />
                  <Bar dataKey="replaced" stackId="a" fill="#10b981" />
                  <Bar dataKey="refunded" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="pending" stackId="a" fill="#eab308" />
                  <Bar dataKey="rejected" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
        {!isMinute && (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px]" style={{ color: "var(--tx-f)" }}>
            <Legend color="#10b981" name="Thay acc mới" />
            <Legend color="#3b82f6" name="Hoàn tiền" />
            <Legend color="#eab308" name="Chờ xử lý" />
            <Legend color="#ef4444" name="Từ chối" />
          </div>
        )}
      </Card>
    </div>
  );
}

function HealthChip({
  icon: Icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string | number;
  tone: "ok" | "warn" | "danger" | "neutral";
  hint?: string;
}) {
  const c = {
    ok: { accent: "#10b981", bg: "transparent" },
    warn: { accent: "#eab308", bg: "rgba(234,179,8,0.06)" },
    danger: { accent: "#ef4444", bg: "rgba(239,68,68,0.08)" },
    neutral: { accent: "var(--tx-f)", bg: "transparent" },
  }[tone];
  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: c.bg, border: "1px solid var(--bd)", borderLeft: `3px solid ${c.accent}` }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: c.accent }} />
        <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--tx-f)" }}>
          {label}
        </span>
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums" style={{ color: tone === "neutral" ? "var(--tx)" : c.accent }}>
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px]" style={{ color: tone === "danger" ? c.accent : "var(--tx-f)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Legend({ color, name }: { color: string; name: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {name}
    </span>
  );
}
