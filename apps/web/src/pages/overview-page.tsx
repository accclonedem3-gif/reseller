import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    section: "Tổng quan",
    loading: "Đang tải dashboard",
    desc: "Theo dõi sức khỏe shop, ví reseller và hàng đợi đơn hàng từ một màn hình.",
    lastSync: "Lần đồng bộ catalog gần nhất:",
    wallet: "Số dư ví",
    walletDesc: "Số dư hiện tại để mua hàng từ nguồn.",
    revenue: "Doanh thu tháng",
    revenueDesc: "Tổng doanh thu từ các đơn đã thanh toán.",
    pending: "Đơn đang chờ",
    pendingDesc: "Bao gồm chờ thanh toán, đang mua hoặc chờ có hàng.",
    delivered: "Đơn đã giao",
    deliveredDesc: "Tổng số đơn giao thành công trong dữ liệu hiện tại.",
    latestOrders: "Đơn hàng mới nhất",
    latestOrdersDesc: "Nhìn nhanh vòng đời đơn hàng gần đây.",
    colOrder: "Mã đơn",
    colProduct: "Sản phẩm",
    colCustomer: "Khách",
    colStatus: "Trạng thái",
    colAmount: "Số tiền",
    topBuyers: "Top người mua",
    topBuyersDesc: "Khách hàng có tổng chi tiêu cao nhất.",
    orders: "đơn",
  },
  en: {
    section: "Overview",
    loading: "Loading dashboard",
    desc: "Monitor shop health, reseller wallet, and order queue from one screen.",
    lastSync: "Last catalog sync:",
    wallet: "Wallet Balance",
    walletDesc: "Current balance for purchasing from source.",
    revenue: "Monthly Revenue",
    revenueDesc: "Total revenue from paid orders.",
    pending: "Pending Orders",
    pendingDesc: "Includes awaiting payment, purchasing, or waiting for stock.",
    delivered: "Delivered Orders",
    deliveredDesc: "Total successfully delivered orders in current data.",
    latestOrders: "Latest Orders",
    latestOrdersDesc: "Quick view of recent order lifecycle.",
    colOrder: "Order Code",
    colProduct: "Product",
    colCustomer: "Customer",
    colStatus: "Status",
    colAmount: "Amount",
    topBuyers: "Top Buyers",
    topBuyersDesc: "Customers with the highest total spending.",
    orders: "orders",
  },
  th: {
    section: "ภาพรวม",
    loading: "กำลังโหลดแดชบอร์ด",
    desc: "ติดตามสุขภาพร้านค้า กระเป๋าเงิน และคิวคำสั่งซื้อจากหน้าจอเดียว",
    lastSync: "ซิงค์แคตาล็อกล่าสุด:",
    wallet: "ยอดเงินในกระเป๋า",
    walletDesc: "ยอดคงเหลือสำหรับซื้อสินค้าจากแหล่ง",
    revenue: "รายได้เดือนนี้",
    revenueDesc: "รายได้รวมจากคำสั่งซื้อที่ชำระแล้ว",
    pending: "คำสั่งซื้อรอดำเนินการ",
    pendingDesc: "รวมรอชำระเงิน กำลังซื้อ หรือรอสต็อก",
    delivered: "คำสั่งซื้อที่จัดส่งแล้ว",
    deliveredDesc: "จำนวนคำสั่งซื้อที่จัดส่งสำเร็จในข้อมูลปัจจุบัน",
    latestOrders: "คำสั่งซื้อล่าสุด",
    latestOrdersDesc: "ดูภาพรวมวงจรคำสั่งซื้อล่าสุด",
    colOrder: "รหัสคำสั่งซื้อ",
    colProduct: "สินค้า",
    colCustomer: "ลูกค้า",
    colStatus: "สถานะ",
    colAmount: "จำนวนเงิน",
    topBuyers: "ผู้ซื้อสูงสุด",
    topBuyersDesc: "ลูกค้าที่มียอดใช้จ่ายรวมสูงสุด",
    orders: "คำสั่ง",
  },
};

export function OverviewPage() {
  const { lang } = useLang();
  const t = T[lang];

  const shopQuery = useQuery({
    queryKey: ["shop"],
    queryFn: async () => (await api.get("/shops/current")).data,
  });
  const walletQuery = useQuery({
    queryKey: ["wallet"],
    queryFn: async () => (await api.get("/wallet")).data,
  });
  const ordersQuery = useQuery({
    queryKey: ["orders", "overview"],
    queryFn: async () => (await api.get("/orders")).data,
  });
  const revenueQuery = useQuery({
    queryKey: ["revenue", "overview"],
    queryFn: async () => (await api.get("/reports/revenue")).data,
  });
  const topBuyersQuery = useQuery({
    queryKey: ["top-buyers", "overview"],
    queryFn: async () => (await api.get("/reports/top-buyers")).data,
  });

  const orders = ordersQuery.data || [];
  const deliveredOrders = orders.filter((item: any) => item.status === "delivered");
  const pendingOrders = orders.filter((item: any) =>
    ["awaiting_payment", "paid", "processing_purchase", "paid_waiting_stock"].includes(
      item.status,
    ),
  );

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-brand/20 via-emerald-400/10 to-transparent p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t.section}</p>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-4xl font-bold text-white">
              {shopQuery.data?.name || t.loading}
            </h1>
            <p className="mt-3 max-w-2xl text-slate-300">{t.desc}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
            {t.lastSync} {formatDate(shopQuery.data?.lastCatalogSyncAt)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t.wallet}
          value={formatCurrency(walletQuery.data?.balance || 0)}
          description={t.walletDesc}
        />
        <MetricCard
          label={t.revenue}
          value={formatCurrency(revenueQuery.data?.summary?.grossRevenue || 0)}
          description={t.revenueDesc}
        />
        <MetricCard
          label={t.pending}
          value={String(pendingOrders.length)}
          description={t.pendingDesc}
        />
        <MetricCard
          label={t.delivered}
          value={String(deliveredOrders.length)}
          description={t.deliveredDesc}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="mb-4">
            <h2 className="font-display text-2xl font-bold text-white">{t.latestOrders}</h2>
            <p className="text-sm text-slate-400">{t.latestOrdersDesc}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-3">{t.colOrder}</th>
                  <th className="pb-3">{t.colProduct}</th>
                  <th className="pb-3">{t.colCustomer}</th>
                  <th className="pb-3">{t.colStatus}</th>
                  <th className="pb-3 text-right">{t.colAmount}</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 6).map((order: any) => (
                  <tr key={order.id} className="border-t border-white/5 text-slate-300">
                    <td className="py-3">{order.orderCode}</td>
                    <td className="py-3">{order.productName}</td>
                    <td className="py-3">{order.customer?.telegramUsername || "-"}</td>
                    <td className="py-3 uppercase tracking-[0.18em] text-xs text-slate-400">
                      {formatStatusLabel(order.status)}
                    </td>
                    <td className="py-3 text-right">{formatCurrency(order.totalSaleAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="mb-4">
            <h2 className="font-display text-2xl font-bold text-white">{t.topBuyers}</h2>
            <p className="text-sm text-slate-400">{t.topBuyersDesc}</p>
          </div>
          <div className="space-y-3">
            {(topBuyersQuery.data || []).slice(0, 5).map((buyer: any, index: number) => (
              <div
                key={buyer.customerId}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-white">
                    {index + 1}. {buyer.name}
                  </p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {buyer.totalOrders} {t.orders}
                  </p>
                </div>
                <p className="font-semibold text-emerald-300">
                  {formatCurrency(buyer.totalSpent)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
