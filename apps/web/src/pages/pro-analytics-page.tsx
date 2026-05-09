import type { AxiosError } from "axios";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Package,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Tổng sỉ ULTRA",
    title: "Phân tích ULTRA",
    desc: "Doanh thu sỉ, lãi ròng và lịch sử bảo hành từ mạng lưới ULTRA.",
    statRevenue: "Doanh thu",
    statOrders: "Tổng đơn",
    statPRO: "PRO active",
    statWarranty: "BH phát sinh",
    periodToday: "Hôm nay",
    periodWeek: "Tuần này",
    periodMonth: "Tháng này",
    miniWholesaleRevenue: "Doanh thu sỉ",
    miniCost: "Giá vốn",
    miniGrossProfit: (period: string) => `Lãi gộp • ${period}`,
    miniTotalOrders: "Tổng đơn sỉ",
    miniActivePRO: "PRO đang active",
    miniStock: "Stock còn lại",
    miniWarrantyCount: "Yêu cầu bảo hành",
    miniWarrantyCost: (auto: number) => `Chi phí bảo hành • ${auto} auto`,
    topProductsTitle: "Thống kê lãi theo sản phẩm",
    topProductsLoading: "Đang tải...",
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
    warrantyLoading: "Đang tải...",
    warrantyEmpty: "Chưa có yêu cầu bảo hành nào.",
    colOrderCode: "Mã đơn",
    colWholesale: "Sỉ",
    colPRO: "PRO",
    colOriginalCost: "Giá vốn gốc",
    colWholesalePriceW: "Giá sỉ",
    colWarrantyCost: "Chi phí BH",
    colStatus: "Trạng thái",
    colTime: "Thời gian",
    warrantyTotal: (n: number) => `${n} yêu cầu`,
    connectionsTitle: "Danh sách kết nối PRO",
    connectionsLoading: "Đang tải...",
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
    ordersLoading: "Đang tải...",
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
  },
  en: {
    eyebrow: "ULTRA wholesale",
    title: "ULTRA analytics",
    desc: "Wholesale revenue, net profit, and warranty history from the ULTRA network.",
    statRevenue: "Revenue",
    statOrders: "Total orders",
    statPRO: "Active PRO",
    statWarranty: "Warranty claims",
    periodToday: "Today",
    periodWeek: "This week",
    periodMonth: "This month",
    miniWholesaleRevenue: "Wholesale revenue",
    miniCost: "Cost",
    miniGrossProfit: (period: string) => `Gross profit • ${period}`,
    miniTotalOrders: "Total wholesale orders",
    miniActivePRO: "Active PRO",
    miniStock: "Remaining stock",
    miniWarrantyCount: "Warranty requests",
    miniWarrantyCost: (auto: number) => `Warranty cost • ${auto} auto`,
    topProductsTitle: "Profit by product",
    topProductsLoading: "Loading...",
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
    warrantyLoading: "Loading...",
    warrantyEmpty: "No warranty requests yet.",
    colOrderCode: "Order code",
    colWholesale: "Wholesale",
    colPRO: "PRO",
    colOriginalCost: "Original cost",
    colWholesalePriceW: "Wholesale price",
    colWarrantyCost: "Warranty cost",
    colStatus: "Status",
    colTime: "Time",
    warrantyTotal: (n: number) => `${n} requests`,
    connectionsTitle: "PRO connections",
    connectionsLoading: "Loading...",
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
    ordersLoading: "Loading...",
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
  },
  th: {
    eyebrow: "ขายส่ง ULTRA",
    title: "การวิเคราะห์ ULTRA",
    desc: "รายได้ขายส่ง กำไรสุทธิ และประวัติการรับประกันจากเครือข่าย ULTRA",
    statRevenue: "รายได้",
    statOrders: "คำสั่งซื้อรวม",
    statPRO: "PRO ที่ใช้งาน",
    statWarranty: "คำขอรับประกัน",
    periodToday: "วันนี้",
    periodWeek: "สัปดาห์นี้",
    periodMonth: "เดือนนี้",
    miniWholesaleRevenue: "รายได้ขายส่ง",
    miniCost: "ต้นทุน",
    miniGrossProfit: (period: string) => `กำไรขั้นต้น • ${period}`,
    miniTotalOrders: "คำสั่งซื้อขายส่งรวม",
    miniActivePRO: "PRO ที่ใช้งาน",
    miniStock: "สต็อกที่เหลือ",
    miniWarrantyCount: "คำขอรับประกัน",
    miniWarrantyCost: (auto: number) => `ค่าใช้จ่ายรับประกัน • ${auto} อัตโนมัติ`,
    topProductsTitle: "กำไรตามสินค้า",
    topProductsLoading: "กำลังโหลด...",
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
    warrantyLoading: "กำลังโหลด...",
    warrantyEmpty: "ยังไม่มีคำขอรับประกัน",
    colOrderCode: "รหัสคำสั่งซื้อ",
    colWholesale: "ขายส่ง",
    colPRO: "PRO",
    colOriginalCost: "ต้นทุนเดิม",
    colWholesalePriceW: "ราคาขายส่ง",
    colWarrantyCost: "ค่าใช้จ่ายรับประกัน",
    colStatus: "สถานะ",
    colTime: "เวลา",
    warrantyTotal: (n: number) => `${n} คำขอ`,
    connectionsTitle: "การเชื่อมต่อ PRO",
    connectionsLoading: "กำลังโหลด...",
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
    ordersLoading: "กำลังโหลด...",
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
  downstreamOrderCode: string | null;
  downstreamSellerName: string;
  productName: string;
  quantity: number;
  totalAmount: number;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
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
  customerMessage: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

type WarrantyResponse = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: WarrantyClaimItem[];
};

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

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="rounded-[14px] px-3.5 py-3"
      style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p
        className={`mt-1.5 text-sm font-bold tabular-nums ${highlight ? "text-emerald-400" : ""}`}
        style={!highlight ? { color: "var(--tx)" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

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

  const ORDER_STATUSES = [
    { value: "", label: t.ordersAllStatus },
    { value: "PENDING", label: t.orderStatusPending },
    { value: "PROCESSING", label: t.orderStatusProcessing },
    { value: "DELIVERED", label: t.orderStatusDelivered },
    { value: "FAILED", label: t.orderStatusFailed },
    { value: "CANCELED", label: t.orderStatusCanceled },
    { value: "PENDING_STOCK", label: t.orderStatusPendingStock },
  ];

  const overviewQuery = useQuery({
    queryKey: ["pro-analytics-overview", period],
    queryFn: () =>
      api.get<Overview>("/pro/analytics/overview", { params: { period } }).then((r) => r.data),
  });

  const downstreamQuery = useQuery({
    queryKey: ["pro-analytics-downstream"],
    queryFn: () => api.get<DownstreamItem[]>("/pro/analytics/downstream").then((r) => r.data),
  });

  const ordersQuery = useQuery({
    queryKey: ["pro-analytics-orders", orderStatus, orderPage],
    queryFn: () =>
      api
        .get<OrdersResponse>("/pro/analytics/orders", {
          params: { status: orderStatus || undefined, page: orderPage, limit: 20 },
        })
        .then((r) => r.data),
  });

  const topProductsQuery = useQuery({
    queryKey: ["pro-analytics-top-products"],
    queryFn: () => api.get<TopProduct[]>("/pro/analytics/top-products").then((r) => r.data),
  });

  const warrantyQuery = useQuery({
    queryKey: ["pro-analytics-warranty", warrantyPage, warrantyProductId],
    queryFn: () =>
      api
        .get<WarrantyResponse>("/pro/analytics/warranty-history", {
          params: {
            page: warrantyPage,
            productId: warrantyProductId || undefined,
          },
        })
        .then((r) => r.data),
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

  const ov = overviewQuery.data;
  const periodLabel = PERIOD_LABELS[period];

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc}
        gradient="violet"
        stats={[
          { icon: TrendingUp, label: t.statRevenue, value: ov ? formatCurrency(ov.revenue) : "—", iconCls: "text-emerald-400", bgCls: "bg-emerald-500/15" },
          { icon: BarChart3, label: t.statOrders, value: ov ? String(ov.totalOrders) : "—", iconCls: "text-violet-400", bgCls: "bg-violet-500/15" },
          { icon: Users, label: t.statPRO, value: ov ? String(ov.activeConnections) : "—", iconCls: "text-sky-400", bgCls: "bg-sky-500/15" },
          { icon: ShieldAlert, label: t.statWarranty, value: ov ? String(ov.warrantyTotal) : "—", iconCls: "text-orange-400", bgCls: "bg-orange-500/15" },
        ]}
      />

      {/* Period picker */}
      <div className="flex gap-2">
        {(["today", "week", "month"] as Period[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className="rounded-[10px] px-4 py-2 text-sm font-medium transition"
            style={
              period === p
                ? { background: "var(--inp)", border: "1px solid var(--accent, #6366f1)", color: "var(--tx)" }
                : { background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }
            }
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Overview stats — row 1 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label={t.miniWholesaleRevenue} value={ov ? formatCurrency(ov.revenue) : "—"} />
        <MiniStat label={t.miniCost} value={ov ? formatCurrency(ov.cost) : "—"} />
        <MiniStat label={t.miniGrossProfit(periodLabel)} value={ov ? formatCurrency(ov.grossProfit) : "—"} highlight />
        <MiniStat label={t.miniTotalOrders} value={ov ? String(ov.totalOrders) : "—"} />
      </div>

      {/* Overview stats — row 2 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label={t.miniActivePRO} value={ov ? String(ov.activeConnections) : "—"} />
        <MiniStat label={t.miniStock} value={ov ? String(ov.totalAvailableStock) : "—"} />
        <MiniStat label={t.miniWarrantyCount} value={ov ? String(ov.warrantyTotal) : "—"} />
        <MiniStat
          label={t.miniWarrantyCost(ov?.warrantyAutoResolved ?? 0)}
          value={ov ? formatCurrency(ov.warrantyCost) : "—"}
        />
      </div>

      {/* Top products */}
      <Card>
        <CardHeader icon={Package} title={t.topProductsTitle} iconCls="text-emerald-400" iconBg="bg-emerald-500/10" />
        {topProductsQuery.isLoading ? (
          <p className="text-sm text-slate-400">{t.topProductsLoading}</p>
        ) : !topProductsQuery.data?.length ? (
          <p className="text-sm text-slate-400">{t.topProductsEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500" style={{ borderBottom: "1px solid var(--bd)" }}>
                  <th className="pb-3 pr-4 font-medium">{t.colProduct}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colSourcePrice}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colWholesalePrice}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colProfitUnit}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colSold}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colRevenue}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colTotalCost}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colGrossProfit}</th>
                  <th className="pb-3 font-medium text-right">{t.colStock}</th>
                </tr>
              </thead>
              <tbody>
                {topProductsQuery.data.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                    <td className="py-3 pr-4 font-medium" style={{ color: "var(--tx)" }}>
                      {p.productIcon ? `${p.productIcon} ` : ""}{p.name}
                    </td>
                    <td className="py-3 pr-4 text-right text-slate-400">{formatCurrency(p.sourcePrice)}</td>
                    <td className="py-3 pr-4 text-right" style={{ color: "var(--tx-m)" }}>{formatCurrency(p.internalPrice)}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-emerald-400">+{formatCurrency(p.profitPerUnit)}</td>
                    <td className="py-3 pr-4 text-right" style={{ color: "var(--tx-m)" }}>{p.soldCount}</td>
                    <td className="py-3 pr-4 text-right" style={{ color: "var(--tx-m)" }}>{formatCurrency(p.revenue)}</td>
                    <td className="py-3 pr-4 text-right text-slate-400">{formatCurrency(p.cost)}</td>
                    <td className="py-3 pr-4 text-right font-bold text-emerald-400">{formatCurrency(p.grossProfit)}</td>
                    <td className="py-3 text-right">
                      <span className={p.available === 0 ? "text-rose-400" : "text-slate-400"}>{p.available}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Warranty history */}
      <Card>
        <CardHeader
          icon={ShieldAlert}
          title={t.warrantyTitle}
          iconCls="text-orange-400"
          iconBg="bg-orange-500/10"
          right={
            <select
              value={warrantyProductId}
              onChange={(e) => { setWarrantyProductId(e.target.value); setWarrantyPage(1); }}
              className="rounded-[10px] px-3 py-1.5 text-xs font-medium focus:outline-none"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
            >
              <option value="">{t.warrantyAllProducts}</option>
              {topProductsQuery.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productIcon ? `${p.productIcon} ` : ""}{p.name}
                </option>
              ))}
            </select>
          }
        />
        {warrantyQuery.isLoading ? (
          <p className="text-sm text-slate-400">{t.warrantyLoading}</p>
        ) : !warrantyQuery.data?.items.length ? (
          <p className="text-sm text-slate-400">{t.warrantyEmpty}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500" style={{ borderBottom: "1px solid var(--bd)" }}>
                    <th className="pb-3 pr-4 font-medium">{t.colOrderCode}</th>
                    <th className="pb-3 pr-4 font-medium">{t.colProduct}</th>
                    <th className="pb-3 pr-4 font-medium">{t.colPRO}</th>
                    <th className="pb-3 pr-4 font-medium text-right">{t.colOriginalCost}</th>
                    <th className="pb-3 pr-4 font-medium text-right">{t.colWholesalePriceW}</th>
                    <th className="pb-3 pr-4 font-medium text-right">{t.colWarrantyCost}</th>
                    <th className="pb-3 pr-4 font-medium">{t.colStatus}</th>
                    <th className="pb-3 font-medium">{t.colTime}</th>
                  </tr>
                </thead>
                <tbody>
                  {warrantyQuery.data.items.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                      <td className="py-3 pr-4">
                        <p className="font-mono text-xs" style={{ color: "var(--tx-m)" }}>{c.orderCode}</p>
                        {c.sourceOrderCode && (
                          <p className="text-[10px] text-slate-500">{t.colWholesale}: {c.sourceOrderCode}</p>
                        )}
                      </td>
                      <td className="py-3 pr-4" style={{ color: "var(--tx-m)" }}>
                        {c.productIcon ? `${c.productIcon} ` : ""}{c.productName}
                      </td>
                      <td className="py-3 pr-4 text-slate-400">{c.downstreamSeller || "—"}</td>
                      <td className="py-3 pr-4 text-right text-slate-400">{formatCurrency(c.sourcePriceSnapshot)}</td>
                      <td className="py-3 pr-4 text-right" style={{ color: "var(--tx-m)" }}>{formatCurrency(c.unitPrice)}</td>
                      <td className="py-3 pr-4 text-right">
                        {c.replacementCost != null
                          ? <span className="font-semibold text-rose-400">{formatCurrency(c.replacementCost)}</span>
                          : <span className="text-slate-500">—</span>}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={warrantyStatusTone(c.status)}>{formatStatusLabel(c.status)}</Badge>
                      </td>
                      <td className="py-3 text-xs text-slate-400">{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {warrantyQuery.data.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
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
      </Card>

      {/* PRO connections */}
      <Card>
        <CardHeader
          icon={Users}
          title={t.connectionsTitle}
          iconCls="text-sky-400"
          iconBg="bg-sky-500/10"
          right={
            downstreamQuery.data?.length ? (
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
              >
                {t.connectionCount(downstreamQuery.data.length)}
              </span>
            ) : undefined
          }
        />
        {downstreamQuery.isLoading ? (
          <p className="text-sm text-slate-400">{t.connectionsLoading}</p>
        ) : !downstreamQuery.data?.length ? (
          <p className="text-sm text-slate-400">{t.connectionsEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500" style={{ borderBottom: "1px solid var(--bd)" }}>
                  <th className="pb-3 pr-4 font-medium">{t.colPROName}</th>
                  <th className="pb-3 pr-4 font-medium">{t.colShop}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colBalance}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colTotalOrdersC}</th>
                  <th className="pb-3 pr-4 font-medium text-right">{t.colTotalRevenue}</th>
                  <th className="pb-3 pr-4 font-medium">{t.colLastOrder}</th>
                  <th className="pb-3 pr-4 font-medium">{t.colStatusC}</th>
                  <th className="pb-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {downstreamQuery.data.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                    <td className="py-3 pr-4 font-medium" style={{ color: "var(--tx)" }}>{item.downstreamSellerName}</td>
                    <td className="py-3 pr-4" style={{ color: "var(--tx-m)" }}>{item.shopName}</td>
                    <td className="py-3 pr-4 text-right font-mono text-emerald-400">{formatCurrency(item.balance)}</td>
                    <td className="py-3 pr-4 text-right" style={{ color: "var(--tx-m)" }}>{item.totalOrders}</td>
                    <td className="py-3 pr-4 text-right" style={{ color: "var(--tx-m)" }}>{formatCurrency(item.totalRevenue)}</td>
                    <td className="py-3 pr-4 text-slate-400">{item.lastOrderedAt ? formatDate(item.lastOrderedAt) : "—"}</td>
                    <td className="py-3 pr-4">
                      <Badge tone={connectionStatusTone(item.status)}>{formatStatusLabel(item.status)}</Badge>
                    </td>
                    <td className="py-3">
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
          </div>
        )}
      </Card>

      {/* Recent wholesale orders */}
      <Card>
        <CardHeader
          icon={BarChart3}
          title={t.ordersTitle}
          iconCls="text-violet-400"
          iconBg="bg-violet-500/10"
          right={
            <select
              value={orderStatus}
              onChange={(e) => { setOrderStatus(e.target.value); setOrderPage(1); }}
              className="rounded-[10px] px-3 py-1.5 text-xs font-medium focus:outline-none"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          }
        />
        {ordersQuery.isLoading ? (
          <p className="text-sm text-slate-400">{t.ordersLoading}</p>
        ) : !ordersQuery.data?.items.length ? (
          <p className="text-sm text-slate-400">{t.ordersEmpty}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500" style={{ borderBottom: "1px solid var(--bd)" }}>
                    <th className="pb-3 pr-4 font-medium">{t.colOrderCodeO}</th>
                    <th className="pb-3 pr-4 font-medium">{t.colPROO}</th>
                    <th className="pb-3 pr-4 font-medium">{t.colProductO}</th>
                    <th className="pb-3 pr-4 font-medium text-right">{t.colAmountO}</th>
                    <th className="pb-3 pr-4 font-medium">{t.colStatusO}</th>
                    <th className="pb-3 font-medium">{t.colTimeO}</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersQuery.data.items.map((o) => (
                    <tr key={o.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                      <td className="py-3 pr-4 font-mono text-xs" style={{ color: "var(--tx-m)" }}>{o.orderCode}</td>
                      <td className="py-3 pr-4" style={{ color: "var(--tx-m)" }}>{o.downstreamSellerName}</td>
                      <td className="py-3 pr-4" style={{ color: "var(--tx-m)" }}>{o.productName}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-emerald-400">{formatCurrency(o.totalAmount)}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={orderStatusTone(o.status)}>{formatStatusLabel(o.status)}</Badge>
                      </td>
                      <td className="py-3 text-slate-400">{formatDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ordersQuery.data.total > 20 && (
              <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
                <span>
                  {(orderPage - 1) * 20 + 1}–{Math.min(orderPage * 20, ordersQuery.data.total)} / {ordersQuery.data.total}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={orderPage <= 1} onClick={() => setOrderPage((p) => p - 1)}>
                    {t.prevPage}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={orderPage * 20 >= ordersQuery.data.total} onClick={() => setOrderPage((p) => p + 1)}>
                    {t.nextPage}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
