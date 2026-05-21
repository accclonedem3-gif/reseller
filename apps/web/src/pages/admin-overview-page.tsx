import { useQuery } from "@tanstack/react-query";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { TrendingDown, TrendingUp, Users, ShoppingBag, DollarSign, UserCheck } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";

type Overview = {
  totalSellers: number;
  activeSellers: number;
  tierCounts: Record<string, number>;
  totalOrders: number;
  totalOrdersThisMonth: number;
  totalOrdersLastMonth: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
};

type ChartPoint = { date: string; revenue: number };
type RecentSeller = {
  id: string;
  username: string;
  displayName: string | null;
  tier: string | null;
  status: string;
  shopName: string | null;
  createdAt: string;
};

function pct(current: number, prev: number) {
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

function TierBadge({ tier }: { tier: string | null }) {
  if (tier === "ultra")
    return (
      <span className="inline-flex items-center rounded-full border border-yellow-500/30 bg-yellow-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-yellow-600 dark:text-yellow-300">
        ULTRA
      </span>
    );
  if (tier === "pro")
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        PRO
      </span>
    );
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
      style={{
        border: "1px solid var(--bd)",
        backgroundColor: "var(--inp)",
        color: "var(--tx-m)",
      }}
    >
      FREE
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  change,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  sub?: string;
  change?: number | null;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-[11px]"
          style={{ border: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}
        >
          <Icon className="h-4.5 w-4.5 text-orange-400" />
        </div>
        {change != null && (
          <div
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
              change >= 0
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                : "bg-red-500/15 text-red-600 dark:text-red-300"
            }`}
          >
            {change >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {change >= 0 ? "+" : ""}
            {change}%
          </div>
        )}
      </div>
      <p className="mt-4 text-2xl font-bold" style={{ color: "var(--tx)" }}>{value}</p>
      <p className="mt-1 text-sm font-medium" style={{ color: "var(--tx-m)" }}>{label}</p>
      {sub && <p className="mt-0.5 text-xs" style={{ color: "var(--tx-f)" }}>{sub}</p>}
    </Card>
  );
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-[12px] p-3 text-sm shadow-xl"
      style={{
        border: "1px solid var(--bd)",
        backgroundColor: "var(--surface)",
      }}
    >
      <p style={{ color: "var(--tx-m)" }}>{label}</p>
      <p className="mt-1 font-bold text-orange-400">{formatCurrency(payload[0]?.value ?? 0)}</p>
    </div>
  );
}

export function AdminOverviewPage() {
  const dark = useDarkMode();

  const { data: overview, isLoading: loadingOverview } = useQuery<Overview>({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get("/admin/overview").then((r) => r.data),
  });

  const { data: chart = [] } = useQuery<ChartPoint[]>({
    queryKey: ["admin", "revenue-chart"],
    queryFn: () => api.get("/admin/revenue-chart").then((r) => r.data),
  });

  const { data: recentSellers = [] } = useQuery<RecentSeller[]>({
    queryKey: ["admin", "recent-sellers"],
    queryFn: () => api.get("/admin/recent-sellers").then((r) => r.data),
  });

  const revChange = overview ? pct(overview.revenueThisMonth, overview.revenueLastMonth) : null;
  const orderChange = overview ? pct(overview.totalOrdersThisMonth, overview.totalOrdersLastMonth) : null;

  const gridStroke = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
  const tickFill = dark ? "#64748b" : "#9ca3af";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          icon={Users}
          label="Tổng CTV"
          value={loadingOverview ? "..." : (overview?.totalSellers ?? 0)}
          sub={`${overview?.activeSellers ?? 0} đang hoạt động`}
        />
        <MetricCard
          icon={UserCheck}
          label="Phân bổ gói"
          value={loadingOverview ? "..." : `${overview?.tierCounts["ultra"] ?? 0} ULTRA`}
          sub={`${overview?.tierCounts["pro"] ?? 0} PRO · ${overview?.tierCounts["free"] ?? 0} FREE`}
        />
        <MetricCard
          icon={ShoppingBag}
          label="Đơn tháng này"
          value={loadingOverview ? "..." : (overview?.totalOrdersThisMonth ?? 0)}
          sub={`Tháng trước: ${overview?.totalOrdersLastMonth ?? 0}`}
          change={orderChange}
        />
        <MetricCard
          icon={DollarSign}
          label="Doanh thu tháng này"
          value={loadingOverview ? "..." : formatCurrency(overview?.revenueThisMonth ?? 0)}
          sub={`Tháng trước: ${formatCurrency(overview?.revenueLastMonth ?? 0)}`}
          change={revChange}
        />
      </div>

      <Card className="p-5">
        <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--tx-m)" }}>
          Doanh thu 30 ngày gần đây
        </p>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5)}
                tick={{ fontSize: 11, fill: tickFill }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => formatCurrency(v)}
                tick={{ fontSize: 11, fill: tickFill }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#f97316" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--tx-m)" }}>
          CTV đăng ký gần đây
        </p>
        <div className="mt-4 space-y-3">
          {recentSellers.length === 0 && (
            <p className="text-sm" style={{ color: "var(--tx-f)" }}>Chưa có CTV nào.</p>
          )}
          {recentSellers.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-[12px] px-4 py-3"
              style={{ border: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" style={{ color: "var(--tx)" }}>
                  {s.displayName || s.username}
                </p>
                <p className="text-xs" style={{ color: "var(--tx-m)" }}>{s.username}</p>
                {s.shopName && (
                  <p className="text-xs" style={{ color: "var(--tx-f)" }}>{s.shopName}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <TierBadge tier={s.tier} />
                <p className="text-xs" style={{ color: "var(--tx-f)" }}>{formatDate(s.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
