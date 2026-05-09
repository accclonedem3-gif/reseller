import { useQuery } from "@tanstack/react-query";
import { Crown, Users, Wallet } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Audience intelligence",
    title: "Top người mua",
    desc: "Danh sách khách mang lại nhiều doanh thu nhất cho seller. Dùng khu vực này để ưu tiên hỗ trợ, chăm sóc lại và lên broadcast đúng nhóm.",
    statLead: "Khách dẫn đầu",
    statNone: "Chưa có",
    statRevenue: "Tổng doanh thu",
    statOrders: "Tổng đơn",
    emptyTitle: "Chưa có dữ liệu top buyer",
    emptyDesc: "Khi seller bắt đầu có đơn thanh toán thành công, hệ thống sẽ tự xếp hạng khách mua mạnh nhất ở đây.",
    tableTitle: "Bảng xếp hạng khách mua",
    buyerCount: (n: number) => `${n} khách`,
    orders: (n: number) => `${n} đơn`,
  },
  en: {
    eyebrow: "Audience intelligence",
    title: "Top Buyers",
    desc: "Customers who generated the most revenue for this seller. Use this section to prioritize support, re-engage, and target broadcasts.",
    statLead: "Top customer",
    statNone: "None yet",
    statRevenue: "Total revenue",
    statOrders: "Total orders",
    emptyTitle: "No top buyer data yet",
    emptyDesc: "When the seller gets their first successful orders, the system will automatically rank top buyers here.",
    tableTitle: "Buyer leaderboard",
    buyerCount: (n: number) => `${n} buyers`,
    orders: (n: number) => `${n} orders`,
  },
  th: {
    eyebrow: "Audience intelligence",
    title: "ผู้ซื้อสูงสุด",
    desc: "รายชื่อลูกค้าที่สร้างรายได้สูงสุดให้กับผู้ขาย ใช้ส่วนนี้เพื่อจัดลำดับความสำคัญของการสนับสนุนและการออกอากาศ",
    statLead: "ผู้นำ",
    statNone: "ยังไม่มี",
    statRevenue: "รายได้รวม",
    statOrders: "คำสั่งซื้อรวม",
    emptyTitle: "ยังไม่มีข้อมูลผู้ซื้อสูงสุด",
    emptyDesc: "เมื่อผู้ขายมีคำสั่งซื้อที่ชำระเงินสำเร็จ ระบบจะจัดอันดับผู้ซื้อสูงสุดที่นี่โดยอัตโนมัติ",
    tableTitle: "กระดานผู้ซื้อ",
    buyerCount: (n: number) => `${n} คน`,
    orders: (n: number) => `${n} คำสั่ง`,
  },
};

export function TopBuyersPage() {
  const { lang } = useLang();
  const t = T[lang];

  const query = useQuery({
    queryKey: ["reports", "top-buyers"],
    queryFn: async () => (await api.get("/reports/top-buyers")).data,
  });

  const buyers = query.data || [];
  const leadBuyer = buyers[0];
  const totalSpent = buyers.reduce((sum: number, item: any) => sum + Number(item.totalSpent || 0), 0);
  const totalOrders = buyers.reduce((sum: number, item: any) => sum + Number(item.totalOrders || 0), 0);

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc}
        gradient="amber"
        stats={[
          { icon: Crown, label: t.statLead, value: leadBuyer?.name || t.statNone, iconCls: "text-amber-400", bgCls: "bg-amber-500/15" },
          { icon: Wallet, label: t.statRevenue, value: formatCurrency(totalSpent), iconCls: "text-emerald-400", bgCls: "bg-emerald-500/15" },
          { icon: Users, label: t.statOrders, value: String(totalOrders), iconCls: "text-sky-400", bgCls: "bg-sky-500/15" },
        ]}
      />

      {buyers.length === 0 ? (
        <EmptyState
          title={t.emptyTitle}
          description={t.emptyDesc}
        />
      ) : (
        <Card>
          <CardHeader
            icon={Crown}
            title={t.tableTitle}
            iconCls="text-amber-400"
            iconBg="bg-amber-500/10"
            right={
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
                {t.buyerCount(buyers.length)}
              </span>
            }
          />

          <div className="space-y-2">
            {buyers.map((buyer: any, index: number) => (
              <div
                key={buyer.customerId}
                className="flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-3"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[11px] font-bold tabular-nums"
                    style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{buyer.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      @{buyer.telegramUsername || "—"} • {t.orders(buyer.totalOrders)}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-bold tabular-nums text-emerald-400">
                  {formatCurrency(buyer.totalSpent)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
