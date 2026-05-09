import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    title: "Doanh thu",
    gross: "Doanh thu gộp",
    grossDesc: "Tổng doanh thu trong tháng này.",
    profit: "Lợi nhuận ước tính",
    profitDesc: "Lợi nhuận ước tính sau khi trừ giá nhập.",
    delivered: "Đơn đã giao",
    deliveredDesc: "Số đơn đã giao thành công.",
    chartTitle: "Doanh thu 30 ngày gần đây",
    tooltipRevenue: "Doanh thu",
    dayPrefix: (label: string) => `Ngày ${label}`,
    million: "triệu",
    unit: "đ",
  },
  en: {
    title: "Revenue",
    gross: "Gross revenue",
    grossDesc: "Total revenue for this month.",
    profit: "Estimated profit",
    profitDesc: "Estimated profit after deducting cost price.",
    delivered: "Delivered orders",
    deliveredDesc: "Number of successfully delivered orders.",
    chartTitle: "Revenue — last 30 days",
    tooltipRevenue: "Revenue",
    dayPrefix: (label: string) => `Day ${label}`,
    million: "M",
    unit: "",
  },
  th: {
    title: "รายได้",
    gross: "รายได้รวม",
    grossDesc: "รายได้รวมในเดือนนี้",
    profit: "กำไรโดยประมาณ",
    profitDesc: "กำไรโดยประมาณหลังหักต้นทุน",
    delivered: "คำสั่งซื้อที่ส่งแล้ว",
    deliveredDesc: "จำนวนคำสั่งซื้อที่ส่งสำเร็จ",
    chartTitle: "รายได้ 30 วันล่าสุด",
    tooltipRevenue: "รายได้",
    dayPrefix: (label: string) => `วันที่ ${label}`,
    million: "ล้าน",
    unit: "₫",
  },
};

export function RevenuePage() {
  const { lang } = useLang();
  const t = T[lang];

  function formatYAxis(value: number) {
    if (value === 0) return `0${t.unit}`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("vi-VN")} ${t.million}`;
    return `${value.toLocaleString("vi-VN")}${t.unit}`;
  }

  const query = useQuery({
    queryKey: ["reports", "revenue"],
    queryFn: async () => (await api.get("/reports/revenue")).data,
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-bold text-white">{t.title}</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label={t.gross} value={formatCurrency(query.data?.summary?.grossRevenue || 0)} description={t.grossDesc} />
        <MetricCard label={t.profit} value={formatCurrency(query.data?.summary?.estimatedProfit || 0)} description={t.profitDesc} />
        <MetricCard label={t.delivered} value={String(query.data?.summary?.deliveredOrders || 0)} description={t.deliveredDesc} />
      </div>
      <Card>
        <p className="mb-4 text-xs font-bold tracking-widest text-slate-400 uppercase">
          {t.chartTitle}
        </p>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={query.data?.series || []} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="label"
                stroke="rgba(255,255,255,0)"
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={formatYAxis}
                stroke="rgba(255,255,255,0)"
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={72}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8 }}
                labelStyle={{ color: "#94a3b8", fontSize: 12 }}
                itemStyle={{ color: "#f97316" }}
                formatter={(value: number) => [formatCurrency(Number(value || 0)), t.tooltipRevenue]}
                labelFormatter={(label) => t.dayPrefix(String(label))}
              />
              <Line
                type="monotone"
                dataKey="grossRevenue"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#f97316" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
