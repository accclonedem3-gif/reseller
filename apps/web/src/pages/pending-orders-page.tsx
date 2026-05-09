import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Watch queue",
    title: "Đơn hàng chờ",
    waiting: "Đang chờ hệ thống mua lại khi có stock.",
    total: (v: string) => `Tổng đơn: ${v}`,
  },
  en: {
    eyebrow: "Watch queue",
    title: "Pending orders",
    waiting: "Waiting for stock to become available.",
    total: (v: string) => `Total: ${v}`,
  },
  th: {
    eyebrow: "Watch queue",
    title: "คำสั่งซื้อรอดำเนินการ",
    waiting: "กำลังรอสต็อกเพื่อดำเนินการ",
    total: (v: string) => `ยอดรวม: ${v}`,
  },
};

export function PendingOrdersPage() {
  const { lang } = useLang();
  const t = T[lang];
  const ordersQuery = useQuery({
    queryKey: ["orders", "pending"],
    queryFn: async () =>
      (await api.get("/orders", { params: { status: "PAID_WAITING_STOCK" } })).data,
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{t.eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-white">{t.title}</h1>
      </div>
      <Card>
        <div className="space-y-3">
          {(ordersQuery.data || []).map((order: any) => (
            <div
              key={order.id}
              className="rounded-3xl border border-white/10 bg-white/5 p-5"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="font-semibold text-white">{order.orderCode}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {order.productName} • {order.customer?.telegramUsername || "-"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="warning">{order.status}</Badge>
                  <span className="text-sm text-slate-500">{formatDate(order.createdAt)}</span>
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-300">
                {order.failureReason || t.waiting}
              </p>
              <p className="mt-3 text-sm text-amber-300">
                {t.total(formatCurrency(order.totalSaleAmount))}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
