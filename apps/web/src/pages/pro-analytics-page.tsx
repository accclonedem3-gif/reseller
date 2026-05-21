import type { AxiosError } from "axios";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    title: "Phân tích ULTRA",
    subtitle: "Tổng sỉ · Báo cáo kinh doanh theo thời gian thực",
    periodToday: "Hôm nay",
    periodWeek: "Tuần này",
    periodMonth: "Tháng này",
    statRevenue: "Doanh thu sỉ",
    statCost: "Giá vốn",
    statGross: "Lãi gộp",
    statOrders: "Tổng đơn sỉ",
    statPRO: "PRO đang active",
    statStock: "Stock còn lại",
    statWarrantyCount: "Yêu cầu bảo hành",
    statWarrantyCost: "Chi phí bảo hành",
    chartRevenue: "Doanh thu theo ngày",
    chartProfit: "Lãi gộp / sản phẩm",
    topProductsTitle: "Thống kê lãi theo sản phẩm",
    topProductsEmpty: "Chưa có sản phẩm nguồn nào.",
    colProduct: "Sản phẩm",
    colSourcePrice: "Giá vốn",
    colWholesalePrice: "Giá sỉ",
    colProfitUnit: "Lãi/unit",
    colSold: "Đã bán",
    colRevenue: "Doanh thu",
    colTotalCost: "Giá vốn tổng",
    colGrossProfit: "Lãi gộp",
    colStock: "Tồn kho",
    warrantyTitle: "Lịch sử bảo hành từ PRO",
    warrantyAllProducts: "Tất cả sản phẩm",
    warrantyEmpty: "Chưa có yêu cầu bảo hành nào.",
    colOrderCode: "Mã đơn",
    colPRO: "PRO",
    colOriginalCost: "Giá vốn gốc",
    colWholesalePriceW: "Giá sỉ",
    colWarrantyCost: "Chi phí BH",
    colStatus: "Trạng thái",
    colTime: "Thời gian",
    warrantyTotal: (n: number) => `${n} yêu cầu`,
    connectionsTitle: "Danh sách kết nối PRO",
    connectionsEmpty: "Chưa có PRO nào kết nối.",
    colPROName: "Tên PRO",
    colShop: "Shop",
    colBalance: "Số dư ví",
    colTotalOrdersC: "Tổng đơn",
    colTotalRevenue: "Doanh thu",
    colLastOrder: "Đơn cuối",
    colStatusC: "Trạng thái",
    connectionCount: (n: number) => `${n} kết nối`,
    revokeConfirm: "Xác nhận",
    revokeCancel: "Hủy",
    revokeBtn: "Thu hồi",
    toastRevoked: "Đã thu hồi kết nối.",
    toastError: "Đã xảy ra lỗi. Vui lòng thử lại.",
    ordersTitle: "Đơn sỉ gần đây",
    ordersAllStatus: "Tất cả trạng thái",
    ordersEmpty: "Chưa có đơn nào.",
    colOrderCodeO: "Mã đơn",
    colPROO: "PRO",
    colProductO: "Sản phẩm",
    colAmountO: "Số tiền",
    colStatusO: "Trạng thái",
    colTimeO: "Thời gian",
    prevPage: "Trước",
    nextPage: "Sau",
    orderStatusPending: "Chờ xử lý",
    orderStatusProcessing: "Đang xử lý",
    orderStatusDelivered: "Đã giao",
    orderStatusFailed: "Thất bại",
    orderStatusCanceled: "Đã hủy",
    orderStatusPendingStock: "Chờ hàng",
    colWholesale: "Sỉ",
    loading: "Đang tải...",
    refresh: "Làm mới",
    totalLabel: "Tổng",
  },
  en: {
    title: "ULTRA Analytics",
    subtitle: "Wholesale · Real-time business report",
    periodToday: "Today",
    periodWeek: "This week",
    periodMonth: "This month",
    statRevenue: "Wholesale revenue",
    statCost: "Cost",
    statGross: "Gross profit",
    statOrders: "Total orders",
    statPRO: "Active PRO",
    statStock: "Remaining stock",
    statWarrantyCount: "Warranty requests",
    statWarrantyCost: "Warranty cost",
    chartRevenue: "Daily revenue",
    chartProfit: "Gross profit / product",
    topProductsTitle: "Profit by product",
    topProductsEmpty: "No source products yet.",
    colProduct: "Product",
    colSourcePrice: "Cost price",
    colWholesalePrice: "Wholesale price",
    colProfitUnit: "Profit/unit",
    colSold: "Sold",
    colRevenue: "Revenue",
    colTotalCost: "Total cost",
    colGrossProfit: "Gross profit",
    colStock: "Stock",
    warrantyTitle: "Warranty history from PRO",
    warrantyAllProducts: "All products",
    warrantyEmpty: "No warranty requests yet.",
    colOrderCode: "Order code",
    colPRO: "PRO",
    colOriginalCost: "Original cost",
    colWholesalePriceW: "Wholesale price",
    colWarrantyCost: "Warranty cost",
    colStatus: "Status",
    colTime: "Time",
    warrantyTotal: (n: number) => `${n} requests`,
    connectionsTitle: "PRO connections",
    connectionsEmpty: "No PRO connected yet.",
    colPROName: "PRO name",
    colShop: "Shop",
    colBalance: "Wallet balance",
    colTotalOrdersC: "Total orders",
    colTotalRevenue: "Revenue",
    colLastOrder: "Last order",
    colStatusC: "Status",
    connectionCount: (n: number) => `${n} connections`,
    revokeConfirm: "Confirm",
    revokeCancel: "Cancel",
    revokeBtn: "Revoke",
    toastRevoked: "Connection revoked.",
    toastError: "An error occurred. Please try again.",
    ordersTitle: "Recent wholesale orders",
    ordersAllStatus: "All statuses",
    ordersEmpty: "No orders yet.",
    colOrderCodeO: "Order code",
    colPROO: "PRO",
    colProductO: "Product",
    colAmountO: "Amount",
    colStatusO: "Status",
    colTimeO: "Time",
    prevPage: "Prev",
    nextPage: "Next",
    orderStatusPending: "Pending",
    orderStatusProcessing: "Processing",
    orderStatusDelivered: "Delivered",
    orderStatusFailed: "Failed",
    orderStatusCanceled: "Canceled",
    orderStatusPendingStock: "Pending stock",
    colWholesale: "Wholesale",
    loading: "Loading...",
    refresh: "Refresh",
    totalLabel: "Total",
  },
  th: {
    title: "การวิเคราะห์ ULTRA",
    subtitle: "ขายส่ง · รายงานธุรกิจแบบเรียลไทม์",
    periodToday: "วันนี้",
    periodWeek: "สัปดาห์นี้",
    periodMonth: "เดือนนี้",
    statRevenue: "รายได้ขายส่ง",
    statCost: "ต้นทุน",
    statGross: "กำไรขั้นต้น",
    statOrders: "คำสั่งซื้อรวม",
    statPRO: "PRO ที่ใช้งาน",
    statStock: "สต็อกที่เหลือ",
    statWarrantyCount: "คำขอรับประกัน",
    statWarrantyCost: "ค่าใช้จ่ายรับประกัน",
    chartRevenue: "รายได้รายวัน",
    chartProfit: "กำไรขั้นต้น / สินค้า",
    topProductsTitle: "กำไรตามสินค้า",
    topProductsEmpty: "ยังไม่มีสินค้าแหล่ง",
    colProduct: "สินค้า",
    colSourcePrice: "ราคาต้นทุน",
    colWholesalePrice: "ราคาขายส่ง",
    colProfitUnit: "กำไร/หน่วย",
    colSold: "ขายแล้ว",
    colRevenue: "รายได้",
    colTotalCost: "ต้นทุนรวม",
    colGrossProfit: "กำไรขั้นต้น",
    colStock: "สต็อก",
    warrantyTitle: "ประวัติการรับประกันจาก PRO",
    warrantyAllProducts: "สินค้าทั้งหมด",
    warrantyEmpty: "ยังไม่มีคำขอรับประกัน",
    colOrderCode: "รหัสคำสั่งซื้อ",
    colPRO: "PRO",
    colOriginalCost: "ต้นทุนเดิม",
    colWholesalePriceW: "ราคาขายส่ง",
    colWarrantyCost: "ค่าใช้จ่ายรับประกัน",
    colStatus: "สถานะ",
    colTime: "เวลา",
    warrantyTotal: (n: number) => `${n} คำขอ`,
    connectionsTitle: "การเชื่อมต่อ PRO",
    connectionsEmpty: "ยังไม่มี PRO เชื่อมต่อ",
    colPROName: "ชื่อ PRO",
    colShop: "ร้านค้า",
    colBalance: "ยอดเงินในกระเป๋า",
    colTotalOrdersC: "คำสั่งซื้อรวม",
    colTotalRevenue: "รายได้",
    colLastOrder: "คำสั่งซื้อล่าสุด",
    colStatusC: "สถานะ",
    connectionCount: (n: number) => `${n} การเชื่อมต่อ`,
    revokeConfirm: "ยืนยัน",
    revokeCancel: "ยกเลิก",
    revokeBtn: "เพิกถอน",
    toastRevoked: "เพิกถอนการเชื่อมต่อแล้ว",
    toastError: "เกิดข้อผิดพลาด กรุณาลองใหม่",
    ordersTitle: "คำสั่งซื้อขายส่งล่าสุด",
    ordersAllStatus: "ทุกสถานะ",
    ordersEmpty: "ยังไม่มีคำสั่งซื้อ",
    colOrderCodeO: "รหัสคำสั่งซื้อ",
    colPROO: "PRO",
    colProductO: "สินค้า",
    colAmountO: "จำนวนเงิน",
    colStatusO: "สถานะ",
    colTimeO: "เวลา",
    prevPage: "ก่อนหน้า",
    nextPage: "ถัดไป",
    orderStatusPending: "รอดำเนินการ",
    orderStatusProcessing: "กำลังดำเนินการ",
    orderStatusDelivered: "จัดส่งแล้ว",
    orderStatusFailed: "ล้มเหลว",
    orderStatusCanceled: "ยกเลิกแล้ว",
    orderStatusPendingStock: "รอสต็อก",
    colWholesale: "ขายส่ง",
    loading: "กำลังโหลด...",
    refresh: "รีเฟรช",
    totalLabel: "รวม",
  },
};

type Period = "today" | "week" | "month";

type Overview = {
  period: Period;
  totalOrders: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  activeConnections: number;
  totalAvailableStock: number;
  warrantyTotal: number;
  warrantyAutoResolved: number;
  warrantyCost: number;
};

type DownstreamItem = {
  id: string;
  downstreamSellerName: string;
  shopName: string;
  balance: number;
  currency: string;
  status: string;
  totalOrders: number;
  totalRevenue: number;
  lastOrderedAt: string | null;
  createdAt: string;
};

type SourceOrderItem = {
  id: string;
  orderCode: string;
  downstreamSellerName: string;
  productName: string;
  quantity: number;
  totalAmount: number;
  status: string;
  createdAt: string;
};

type OrdersResponse = {
  total: number;
  page: number;
  limit: number;
  items: SourceOrderItem[];
};

type TopProduct = {
  id: string;
  productIcon: string | null;
  name: string;
  sourcePrice: number;
  internalPrice: number;
  profitPerUnit: number;
  available: number;
  soldCount: number;
  revenue: number;
  cost: number;
  grossProfit: number;
};

type WarrantyClaimItem = {
  id: string;
  claimNumber: number;
  status: string;
  orderCode: string;
  productName: string;
  productIcon: string | null;
  downstreamSeller: string | null;
  sourceOrderCode: string | null;
  unitPrice: number;
  sourcePriceSnapshot: number;
  quantity: number;
  replacementCost: number | null;
  createdAt: string;
};

type WarrantyResponse = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: WarrantyClaimItem[];
};

type ChartDay = { label: string; revenue: number; grossProfit: number };

function getApiError(error: unknown, fallback: string) {
  const e = error as AxiosError<{ message?: string | string[] }>;
  const msg = e.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string" && msg.trim()) return msg;
  return fallback;
}

function connectionStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status.toLowerCase();
  if (s === "active") return "success";
  if (s === "revoked" || s === "disabled") return "danger";
  return "warning";
}

function orderStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status.toLowerCase();
  if (s === "delivered") return "success";
  if (s === "failed" || s === "canceled") return "danger";
  return "warning";
}

function warrantyStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status.toLowerCase();
  if (s === "auto_resolved" || s === "resolved_manual") return "success";
  if (s === "rejected") return "danger";
  if (s === "pending_stock" || s === "pending_review" || s === "pending_manual") return "warning";
  return "neutral";
}

function fmtAxisDate(label: string) {
  if (!label) return "";
  const parts = label.split("-");
  return `${parseInt(parts[2] ?? "0")}/${parseInt(parts[1] ?? "0")}`;
}

function fmtY(v: number) {
  if (v === 0) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}

function SCard({
  label,
  value,
  sub,
  valueColor,
  borderColor,
}: {
  label: string;
  value: string | number;
  sub: string;
  valueColor: string;
  borderColor: string;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: `3px solid ${borderColor}` }}
    >
      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
      <p className="mt-2 text-2xl font-black tabular-nums truncate" style={{ color: valueColor }}>{value}</p>
      <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>{sub}</p>
    </div>
  );
}

function TableWrap({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
      <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
        <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{title}</h2>
        {right}
      </div>
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  );
}

const ORDER_STATUSES_LIST = ["", "PENDING", "PROCESSING", "DELIVERED", "FAILED", "CANCELED", "PENDING_STOCK"];

export function ProAnalyticsPage() {
  const { lang } = useLang();
  const t = T[lang];

  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("month");
  const [orderStatus, setOrderStatus] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [warrantyPage, setWarrantyPage] = useState(1);
  const [warrantyProductId, setWarrantyProductId] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const PERIOD_LABELS: Record<Period, string> = {
    today: t.periodToday,
    week: t.periodWeek,
    month: t.periodMonth,
  };

  const ORDER_STATUS_LABELS: Record<string, string> = {
    "": t.ordersAllStatus,
    PENDING: t.orderStatusPending,
    PROCESSING: t.orderStatusProcessing,
    DELIVERED: t.orderStatusDelivered,
    FAILED: t.orderStatusFailed,
    CANCELED: t.orderStatusCanceled,
    PENDING_STOCK: t.orderStatusPendingStock,
  };

  const overviewQuery = useQuery({
    queryKey: ["pro-analytics-overview", period],
    queryFn: () => api.get<Overview>("/pro/analytics/overview", { params: { period } }).then((r) => r.data),
  });

  const downstreamQuery = useQuery({
    queryKey: ["pro-analytics-downstream"],
    queryFn: () => api.get<DownstreamItem[]>("/pro/analytics/downstream").then((r) => r.data),
  });

  const ordersQuery = useQuery({
    queryKey: ["pro-analytics-orders", orderStatus, orderPage],
    queryFn: () =>
      api.get<OrdersResponse>("/pro/analytics/orders", {
        params: { status: orderStatus || undefined, page: orderPage, limit: 20 },
      }).then((r) => r.data),
  });

  const topProductsQuery = useQuery({
    queryKey: ["pro-analytics-top-products"],
    queryFn: () => api.get<TopProduct[]>("/pro/analytics/top-products").then((r) => r.data),
  });

  const warrantyQuery = useQuery({
    queryKey: ["pro-analytics-warranty", warrantyPage, warrantyProductId],
    queryFn: () =>
      api.get<WarrantyResponse>("/pro/analytics/warranty-history", {
        params: { page: warrantyPage, productId: warrantyProductId || undefined },
      }).then((r) => r.data),
  });

  const chartQuery = useQuery({
    queryKey: ["pro-analytics-chart"],
    queryFn: () => api.get<ChartDay[]>("/pro/analytics/chart", { params: { days: 30 } }).then((r) => r.data),
  });

  const revokeMutation = useMutation({
    mutationFn: (connectionId: string) =>
      api.delete(`/pro/analytics/connections/${connectionId}`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pro-analytics-downstream"] });
      queryClient.invalidateQueries({ queryKey: ["pro-analytics-overview"] });
      setConfirmRevoke(null);
      showToast({ tone: "success", message: t.toastRevoked });
    },
    onError: (err) => {
      setConfirmRevoke(null);
      showToast({ tone: "error", message: getApiError(err, t.toastError) });
    },
  });

  function refreshAll() {
    void Promise.all([
      overviewQuery.refetch(),
      topProductsQuery.refetch(),
      chartQuery.refetch(),
      downstreamQuery.refetch(),
    ]);
  }

  const ov = overviewQuery.data;
  const periodLabel = PERIOD_LABELS[period];
  const chartData: ChartDay[] = chartQuery.data ?? [];
  const chartTotal = chartData.reduce((s, d) => s + d.revenue, 0);

  const productChartData = (topProductsQuery.data ?? [])
    .slice(0, 8)
    .map((p) => ({ name: p.productIcon ? `${p.productIcon} ${p.name}` : p.name, grossProfit: p.grossProfit }))
    .sort((a, b) => b.grossProfit - a.grossProfit);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "rgb(249,115,22)" }}>{t.title}</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--tx-f)" }}>{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period picker */}
          <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
            {(["today", "week", "month"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-black transition"
                style={
                  period === p
                    ? { background: "rgb(249,115,22)", color: "#fff" }
                    : { color: "var(--tx-f)" }
                }
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={refreshAll}
            disabled={overviewQuery.isFetching}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${overviewQuery.isFetching ? "animate-spin" : ""}`} />
            {t.refresh}
          </button>
        </div>
      </div>

      {/* Stat cards row 1 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SCard label={t.statRevenue} value={ov ? formatCurrency(ov.revenue) : "—"} sub={periodLabel} valueColor="rgb(52,211,153)" borderColor="rgb(52,211,153)" />
        <SCard label={t.statCost} value={ov ? formatCurrency(ov.cost) : "—"} sub={t.totalLabel} valueColor="var(--tx-f)" borderColor="var(--bd)" />
        <SCard label={t.statGross} value={ov ? formatCurrency(ov.grossProfit) : "—"} sub={`${t.statRevenue} − ${t.statCost}`} valueColor="rgb(52,211,153)" borderColor="rgb(52,211,153)" />
        <SCard label={t.statOrders} value={ov ? ov.totalOrders : "—"} sub={t.totalLabel} valueColor="rgb(99,102,241)" borderColor="rgb(99,102,241)" />
      </div>

      {/* Stat cards row 2 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SCard label={t.statPRO} value={ov ? ov.activeConnections : "—"} sub="Đại lý kết nối" valueColor="rgb(56,189,248)" borderColor="rgb(56,189,248)" />
        <SCard label={t.statStock} value={ov ? ov.totalAvailableStock.toLocaleString() : "—"} sub="Tổng tất cả sản phẩm" valueColor="rgb(245,158,11)" borderColor="rgb(245,158,11)" />
        <SCard label={t.statWarrantyCount} value={ov ? ov.warrantyTotal : "—"} sub={periodLabel} valueColor={ov && ov.warrantyTotal > 0 ? "rgb(248,113,113)" : "var(--tx-f)"} borderColor={ov && ov.warrantyTotal > 0 ? "rgb(248,113,113)" : "var(--bd)"} />
        <SCard label={t.statWarrantyCost} value={ov ? formatCurrency(ov.warrantyCost) : "—"} sub={`${ov?.warrantyAutoResolved ?? 0} auto`} valueColor={ov && ov.warrantyCost > 0 ? "rgb(248,113,113)" : "var(--tx-f)"} borderColor={ov && ov.warrantyCost > 0 ? "rgb(248,113,113)" : "var(--bd)"} />
      </div>

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Daily revenue area chart */}
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{t.chartRevenue}</h2>
            <span className="text-[13px] font-black tabular-nums" style={{ color: "var(--tx-f)" }}>
              {t.totalLabel}: <span style={{ color: "rgb(249,115,22)" }}>{formatCurrency(chartTotal)}</span>
            </span>
          </div>
          <div className="mt-4" style={{ height: 180 }}>
            {chartQuery.isLoading ? (
              <div className="h-full animate-pulse rounded-xl" style={{ background: "var(--inp)" }} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ultraChartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgb(249,115,22)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="rgb(249,115,22)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tickFormatter={fmtAxisDate} tick={{ fontSize: 11, fill: "var(--tx-f)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtY} tick={{ fontSize: 11, fill: "var(--tx-f)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--bd)", borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: "var(--tx-f)", marginBottom: 4 }}
                    formatter={(v: unknown) => [formatCurrency(v as number), t.statRevenue]}
                    labelFormatter={fmtAxisDate}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="rgb(249,115,22)" strokeWidth={2} fill="url(#ultraChartGrad)" dot={false} activeDot={{ r: 4, fill: "rgb(249,115,22)" }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Product gross profit horizontal bar chart */}
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
          <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{t.chartProfit}</h2>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{(topProductsQuery.data?.length ?? 0)} sản phẩm</p>
          <div className="mt-4" style={{ height: 180 }}>
            {topProductsQuery.isLoading ? (
              <div className="h-full animate-pulse rounded-xl" style={{ background: "var(--inp)" }} />
            ) : productChartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--tx-f)" }}>{t.topProductsEmpty}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productChartData} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <XAxis type="number" tickFormatter={fmtY} tick={{ fontSize: 10, fill: "var(--tx-f)" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "var(--tx-f)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--bd)", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: unknown) => [formatCurrency(v as number), t.colGrossProfit]}
                  />
                  <Bar dataKey="grossProfit" radius={[0, 6, 6, 0]}>
                    {productChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.grossProfit >= 0 ? "rgb(52,211,153)" : "rgb(248,113,113)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Product stats table */}
      <TableWrap title={t.topProductsTitle}>
        {topProductsQuery.isLoading ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.loading}</p>
        ) : !topProductsQuery.data?.length ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.topProductsEmpty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                {[t.colProduct, t.colSourcePrice, t.colWholesalePrice, t.colProfitUnit, t.colSold, t.colRevenue, t.colTotalCost, t.colGrossProfit, t.colStock].map((h, i) => (
                  <th key={h} className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${i === 0 ? "text-left" : "text-right"}`} style={{ color: "var(--tx-f)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topProductsQuery.data.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                  <td className="px-4 py-3 font-medium" style={{ color: "var(--tx)" }}>
                    {p.productIcon ? `${p.productIcon} ` : ""}{p.name}
                  </td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--tx-f)" }}>{formatCurrency(p.sourcePrice)}</td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--tx-m)" }}>{formatCurrency(p.internalPrice)}</td>
                  <td className="px-4 py-3 text-right font-semibold" style={{ color: p.profitPerUnit >= 0 ? "rgb(52,211,153)" : "rgb(248,113,113)" }}>
                    {p.profitPerUnit >= 0 ? "+" : ""}{formatCurrency(p.profitPerUnit)}
                  </td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--tx-m)" }}>{p.soldCount}</td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--tx-m)" }}>{formatCurrency(p.revenue)}</td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--tx-f)" }}>{formatCurrency(p.cost)}</td>
                  <td className="px-4 py-3 text-right font-bold" style={{ color: p.grossProfit >= 0 ? "rgb(52,211,153)" : "rgb(248,113,113)" }}>
                    {p.grossProfit >= 0 ? "+" : ""}{formatCurrency(p.grossProfit)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span style={{ color: p.available === 0 ? "rgb(248,113,113)" : "var(--tx-m)" }}>{p.available}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableWrap>

      {/* Warranty history */}
      <TableWrap
        title={t.warrantyTitle}
        right={
          <select
            value={warrantyProductId}
            onChange={(e) => { setWarrantyProductId(e.target.value); setWarrantyPage(1); }}
            className="rounded-[10px] px-3 py-1.5 text-xs font-medium focus:outline-none"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
          >
            <option value="">{t.warrantyAllProducts}</option>
            {topProductsQuery.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.productIcon ? `${p.productIcon} ` : ""}{p.name}</option>
            ))}
          </select>
        }
      >
        {warrantyQuery.isLoading ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.loading}</p>
        ) : !warrantyQuery.data?.items.length ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.warrantyEmpty}</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                  {[t.colOrderCode, t.colProduct, t.colPRO, t.colOriginalCost, t.colWholesalePriceW, t.colWarrantyCost, t.colStatus, t.colTime].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${i >= 3 && i <= 5 ? "text-right" : "text-left"}`} style={{ color: "var(--tx-f)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {warrantyQuery.data.items.map((c) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs" style={{ color: "var(--tx-m)" }}>{c.orderCode}</p>
                      {c.sourceOrderCode && <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>{t.colWholesale}: {c.sourceOrderCode}</p>}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--tx-m)" }}>{c.productIcon ? `${c.productIcon} ` : ""}{c.productName}</td>
                    <td className="px-4 py-3" style={{ color: "var(--tx-f)" }}>{c.downstreamSeller || "—"}</td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--tx-f)" }}>{formatCurrency(c.sourcePriceSnapshot)}</td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--tx-m)" }}>{formatCurrency(c.unitPrice)}</td>
                    <td className="px-4 py-3 text-right">
                      {c.replacementCost != null
                        ? <span className="font-semibold text-rose-400">{formatCurrency(c.replacementCost)}</span>
                        : <span style={{ color: "var(--tx-f)" }}>—</span>}
                    </td>
                    <td className="px-4 py-3"><Badge tone={warrantyStatusTone(c.status)}>{formatStatusLabel(c.status)}</Badge></td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--tx-f)" }}>{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {warrantyQuery.data.totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 text-sm" style={{ borderTop: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                <span>{t.warrantyTotal(warrantyQuery.data.total)}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={warrantyPage <= 1} onClick={() => setWarrantyPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="secondary" disabled={warrantyPage >= warrantyQuery.data.totalPages} onClick={() => setWarrantyPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </TableWrap>

      {/* PRO connections */}
      <TableWrap
        title={t.connectionsTitle}
        right={
          downstreamQuery.data?.length ? (
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
              {t.connectionCount(downstreamQuery.data.length)}
            </span>
          ) : undefined
        }
      >
        {downstreamQuery.isLoading ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.loading}</p>
        ) : !downstreamQuery.data?.length ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.connectionsEmpty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                {[t.colPROName, t.colShop, t.colBalance, t.colTotalOrdersC, t.colTotalRevenue, t.colLastOrder, t.colStatusC, ""].map((h, i) => (
                  <th key={i} className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${i >= 2 && i <= 4 ? "text-right" : "text-left"}`} style={{ color: "var(--tx-f)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {downstreamQuery.data.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                  <td className="px-4 py-3 font-medium" style={{ color: "var(--tx)" }}>{item.downstreamSellerName}</td>
                  <td className="px-4 py-3" style={{ color: "var(--tx-m)" }}>{item.shopName}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-400">{formatCurrency(item.balance)}</td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--tx-m)" }}>{item.totalOrders}</td>
                  <td className="px-4 py-3 text-right" style={{ color: "var(--tx-m)" }}>{formatCurrency(item.totalRevenue)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--tx-f)" }}>{item.lastOrderedAt ? formatDate(item.lastOrderedAt) : "—"}</td>
                  <td className="px-4 py-3"><Badge tone={connectionStatusTone(item.status)}>{formatStatusLabel(item.status)}</Badge></td>
                  <td className="px-4 py-3">
                    {item.status !== "REVOKED" &&
                      (confirmRevoke === item.id ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="danger" onClick={() => revokeMutation.mutate(item.id)} disabled={revokeMutation.isPending}>
                            {t.revokeConfirm}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirmRevoke(null)}>
                            {t.revokeCancel}
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setConfirmRevoke(item.id)}>
                          {t.revokeBtn}
                        </Button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableWrap>

      {/* Recent wholesale orders */}
      <TableWrap
        title={t.ordersTitle}
        right={
          <select
            value={orderStatus}
            onChange={(e) => { setOrderStatus(e.target.value); setOrderPage(1); }}
            className="rounded-[10px] px-3 py-1.5 text-xs font-medium focus:outline-none"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
          >
            {ORDER_STATUSES_LIST.map((s) => (
              <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
            ))}
          </select>
        }
      >
        {ordersQuery.isLoading ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.loading}</p>
        ) : !ordersQuery.data?.items.length ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>{t.ordersEmpty}</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                  {[t.colOrderCodeO, t.colPROO, t.colProductO, t.colAmountO, t.colStatusO, t.colTimeO].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${i === 3 ? "text-right" : "text-left"}`} style={{ color: "var(--tx-f)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordersQuery.data.items.map((o) => (
                  <tr key={o.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--tx-m)" }}>{o.orderCode}</td>
                    <td className="px-4 py-3" style={{ color: "var(--tx-m)" }}>{o.downstreamSellerName}</td>
                    <td className="px-4 py-3" style={{ color: "var(--tx-m)" }}>{o.productName}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-400">{formatCurrency(o.totalAmount)}</td>
                    <td className="px-4 py-3"><Badge tone={orderStatusTone(o.status)}>{formatStatusLabel(o.status)}</Badge></td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--tx-f)" }}>{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ordersQuery.data.total > 20 && (
              <div className="flex items-center justify-between px-5 py-3 text-sm" style={{ borderTop: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                <span>{(orderPage - 1) * 20 + 1}–{Math.min(orderPage * 20, ordersQuery.data.total)} / {ordersQuery.data.total}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={orderPage <= 1} onClick={() => setOrderPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="secondary" disabled={orderPage * 20 >= ordersQuery.data.total} onClick={() => setOrderPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </TableWrap>
    </div>
  );
}
