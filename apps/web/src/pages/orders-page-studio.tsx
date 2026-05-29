import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Copy,
  CreditCard,
  Download,
  KeyRound,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  XCircle,
} from "lucide-react";

import {
  StudioButton,
  StudioCard,
} from "@/components/studio/studio-ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const PAGE_SIZE = 10;

const T = {
  vi: {
    kicker: "Điều phối đơn hàng",
    title: "Toàn bộ giao dịch của seller",
    subtitle: "Theo dõi 100 đơn hàng gần nhất theo thời gian thực",
    metricTotal: "Tổng đơn",
    metricPaid: "Đã thanh toán",
    metricDelivered: "Đã giao hàng",
    metricFailed: "Đơn lỗi",
    metricTotalDesc: "Trong 30 ngày qua",
    metricPaidDesc: "Tỉ lệ chuyển đổi",
    metricDeliveredDesc: "Hoàn thành sau TT",
    metricFailedDesc: "Cần xử lý thủ công",
    tableTitle: "Nhật ký đơn hàng",
    filterAll: "Tất cả",
    filterDelivered: "Đã giao",
    filterPaid: "Đã thanh toán",
    filterPending: "Chờ xử lý",
    colOrder: "Mã đơn",
    colProduct: "Sản phẩm",
    colCustomer: "Khách hàng",
    colDelivery: "Giao hàng",
    colPayment: "Thanh toán",
    colDate: "Thời gian",
    colTotal: "Tổng tiền",
    colSourceLN: "Giá nguồn / LN",
    hideAccount: "Ẩn tài khoản",
    viewAccount: "Xem tài khoản",
    deliveredAccount: "Tài khoản đã giao",
    copied: "Đã copy",
    copy: "Sao chép",
    manualUSDT: "thanh toán thủ công",
    confirmUSDT: "Xác nhận đã nhận USDT",
    confirmUSDTMsg: (code: string) => `Xác nhận đã nhận USDT cho đơn ${code}?`,
    toastConfirmed: "Đã xác nhận thanh toán USDT.",
    toastErr: "Không thể xác nhận thanh toán.",
    searchPlaceholder: "Tìm đơn, khách, sản phẩm...",
    export: "Xuất",
    createOrder: "+ Tạo đơn",
    updatedAt: "Cập nhật lúc",
    showing: (from: number, to: number, total: number) => `Hiển thị ${from}–${to} / ${total} đơn hàng`,
    deliveredLabel: "✓ Đã giao tài khoản",
    allDays: "Tất cả ngày",
    today: "Hôm nay",
    last7: "7 ngày qua",
    last30: "30 ngày qua",
  },
  en: {
    kicker: "Order management",
    title: "All seller transactions",
    subtitle: "Track last 100 orders in real time",
    metricTotal: "Total orders",
    metricPaid: "Paid",
    metricDelivered: "Delivered",
    metricFailed: "Failed",
    metricTotalDesc: "Last 30 days",
    metricPaidDesc: "Conversion rate",
    metricDeliveredDesc: "Completed after payment",
    metricFailedDesc: "Needs manual handling",
    tableTitle: "Order log",
    filterAll: "All",
    filterDelivered: "Delivered",
    filterPaid: "Paid",
    filterPending: "Pending",
    colOrder: "Order",
    colProduct: "Product",
    colCustomer: "Customer",
    colDelivery: "Delivery",
    colPayment: "Payment",
    colDate: "Time",
    colTotal: "Total",
    colSourceLN: "Cost / Profit",
    hideAccount: "Hide account",
    viewAccount: "View account",
    deliveredAccount: "Delivered account",
    copied: "Copied",
    copy: "Copy",
    manualUSDT: "manual payment",
    confirmUSDT: "Confirm USDT received",
    confirmUSDTMsg: (code: string) => `Confirm USDT received for order ${code}?`,
    toastConfirmed: "USDT payment confirmed.",
    toastErr: "Could not confirm payment.",
    searchPlaceholder: "Search order, customer, product...",
    export: "Export",
    createOrder: "+ New order",
    updatedAt: "Updated at",
    showing: (from: number, to: number, total: number) => `Showing ${from}–${to} of ${total} orders`,
    deliveredLabel: "✓ Account delivered",
    allDays: "All time",
    today: "Today",
    last7: "Last 7 days",
    last30: "Last 30 days",
  },
  th: {
    kicker: "การจัดการคำสั่งซื้อ",
    title: "ธุรกรรมทั้งหมดของผู้ขาย",
    subtitle: "ติดตาม 100 คำสั่งซื้อล่าสุดแบบเรียลไทม์",
    metricTotal: "คำสั่งซื้อทั้งหมด",
    metricPaid: "ชำระแล้ว",
    metricDelivered: "จัดส่งแล้ว",
    metricFailed: "ล้มเหลว",
    metricTotalDesc: "ใน 30 วันที่ผ่านมา",
    metricPaidDesc: "อัตราการแปลง",
    metricDeliveredDesc: "เสร็จสิ้นหลังชำระ",
    metricFailedDesc: "ต้องจัดการด้วยตนเอง",
    tableTitle: "บันทึกคำสั่งซื้อ",
    filterAll: "ทั้งหมด",
    filterDelivered: "จัดส่งแล้ว",
    filterPaid: "ชำระแล้ว",
    filterPending: "รอดำเนินการ",
    colOrder: "คำสั่งซื้อ",
    colProduct: "สินค้า",
    colCustomer: "ลูกค้า",
    colDelivery: "การจัดส่ง",
    colPayment: "การชำระ",
    colDate: "เวลา",
    colTotal: "รวม",
    colSourceLN: "ราคาทุน / กำไร",
    hideAccount: "ซ่อนบัญชี",
    viewAccount: "ดูบัญชี",
    deliveredAccount: "บัญชีที่จัดส่ง",
    copied: "คัดลอกแล้ว",
    copy: "คัดลอก",
    manualUSDT: "ชำระด้วยตนเอง",
    confirmUSDT: "ยืนยันรับ USDT",
    confirmUSDTMsg: (code: string) => `ยืนยันรับ USDT สำหรับ ${code}?`,
    toastConfirmed: "ยืนยันการชำระแล้ว",
    toastErr: "ไม่สามารถยืนยันได้",
    searchPlaceholder: "ค้นหาคำสั่งซื้อ ลูกค้า สินค้า...",
    export: "ส่งออก",
    createOrder: "+ สร้างคำสั่งซื้อ",
    updatedAt: "อัปเดตเมื่อ",
    showing: (from: number, to: number, total: number) => `แสดง ${from}–${to} จาก ${total}`,
    deliveredLabel: "✓ ส่งมอบบัญชีแล้ว",
    allDays: "ทุกวัน",
    today: "วันนี้",
    last7: "7 วันที่ผ่านมา",
    last30: "30 วันที่ผ่านมา",
  },
};

function pct(num: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((num / total) * 100)}%`;
}

function shortOrderCode(code: string) {
  const parts = code.split("-");
  const suffix = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).join("-");
  return { prefix, suffix };
}

function formatOrderDate(dateStr: string) {
  const d = new Date(dateStr);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} · ${day}/${month}/${String(d.getFullYear()).slice(2)}`;
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

type FilterTab = "all" | "delivered" | "paid" | "pending";
type DateRange = "all" | "today" | "last7" | "last30";

export function OrdersPageStudio() {
  const { lang } = useLang();
  const t = T[lang];

  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [page, setPage] = useState(1);
  const [lastUpdated, setLastUpdated] = useState(nowTime());

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const data = (await api.get("/orders")).data;
      setLastUpdated(nowTime());
      return data;
    },
    refetchInterval: 30000,
  });

  const orders: any[] = ordersQuery.data || [];

  const confirmManualPaymentMutation = useMutation({
    mutationFn: async (orderId: string) => api.post(`/orders/${orderId}/manual-payment-confirm`),
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastConfirmed });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["orders", "pending"] }),
      ]);
    },
    onError: (error: any) => {
      showToast({ tone: "error", message: error?.response?.data?.message || t.toastErr });
    },
  });

  const paidOrders = orders.filter((o) => String(o.paymentStatus || "").toLowerCase() === "paid");
  const deliveredOrders = orders.filter((o) => String(o.status || "").toLowerCase() === "delivered");
  const failedOrders = orders.filter((o) => ["failed", "refunded"].includes(String(o.status || "").toLowerCase()));
  const pendingOrders = orders.filter((o) => ["pending", "paid_waiting_stock", "processing"].includes(String(o.status || "").toLowerCase()));

  const filtered = useMemo(() => {
    let list = orders;

    if (filter === "delivered") list = list.filter((o) => String(o.status || "").toLowerCase() === "delivered");
    else if (filter === "paid") list = list.filter((o) => String(o.paymentStatus || "").toLowerCase() === "paid");
    else if (filter === "pending") list = list.filter((o) => ["pending", "paid_waiting_stock", "processing"].includes(String(o.status || "").toLowerCase()));

    const now = Date.now();
    if (dateRange === "today") list = list.filter((o) => new Date(o.createdAt).toDateString() === new Date().toDateString());
    else if (dateRange === "last7") list = list.filter((o) => now - new Date(o.createdAt).getTime() < 7 * 86400000);
    else if (dateRange === "last30") list = list.filter((o) => now - new Date(o.createdAt).getTime() < 30 * 86400000);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((o) =>
        (o.orderCode || "").toLowerCase().includes(q) ||
        (o.productName || "").toLowerCase().includes(q) ||
        (o.customer?.telegramUsername || "").toLowerCase().includes(q) ||
        (o.customer?.name || "").toLowerCase().includes(q) ||
        (o.customer?.telegramChatId || "").includes(q),
      );
    }

    return list;
  }, [orders, filter, search, dateRange]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleCopy = async (orderId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOrderId(orderId);
      window.setTimeout(() => setCopiedOrderId((c) => (c === orderId ? null : c)), 1800);
    } catch {
      setCopiedOrderId(null);
    }
  };

  const filterTabs: { key: FilterTab; label: string; dot?: string }[] = [
    { key: "all", label: t.filterAll },
    { key: "delivered", label: t.filterDelivered, dot: "bg-emerald-400" },
    { key: "paid", label: t.filterPaid, dot: "bg-sky-400" },
    { key: "pending", label: t.filterPending, dot: "bg-amber-400" },
  ];

  const dateOptions: { key: DateRange; label: string }[] = [
    { key: "all", label: t.allDays },
    { key: "today", label: t.today },
    { key: "last7", label: t.last7 },
    { key: "last30", label: t.last30 },
  ];

  const statCard = (label: string, value: number, total: number, desc: string, color: string, borderColor: string) => (
    <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: `3px solid ${borderColor}` }}>
      <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
      <p className="mt-2 text-3xl font-black tabular-nums" style={{ color }}>{value}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>{desc}</p>
        <span className="text-[11px] font-black" style={{ color: "var(--tx-f)" }}>{pct(value, total)}</span>
      </div>
    </div>
  );

  const tabBtn = (tab: FilterTab, label: string, dot?: string) => {
    const active = filter === tab;
    return (
      <button
        key={tab}
        type="button"
        onClick={() => { setFilter(tab); setPage(1); }}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-black transition"
        style={{
          background: active ? "rgba(249,115,22,0.15)" : "transparent",
          border: `1px solid ${active ? "rgba(249,115,22,0.4)" : "transparent"}`,
          color: active ? "rgb(249,115,22)" : "var(--tx-f)",
        }}
      >
        {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.kicker}</p>
          <h1 className="mt-1 text-2xl font-black uppercase" style={{ color: "rgb(249,115,22)" }}>{t.title}</h1>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>{t.subtitle}</p>
            <span className="flex items-center gap-1 text-[11px] text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t.updatedAt} {lastUpdated}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
          >
            <Download className="h-3.5 w-3.5" /> {t.export}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCard(t.metricTotal, orders.length, orders.length, t.metricTotalDesc, "var(--tx)", "rgb(52,211,153)")}
        {statCard(t.metricPaid, paidOrders.length, orders.length, t.metricPaidDesc, "rgb(56,189,248)", "rgb(56,189,248)")}
        {statCard(t.metricDelivered, deliveredOrders.length, paidOrders.length || 1, t.metricDeliveredDesc, "rgb(52,211,153)", "rgb(245,158,11)")}
        {statCard(t.metricFailed, failedOrders.length, orders.length, t.metricFailedDesc, "rgb(248,113,113)", "rgb(52,211,153)")}
      </div>

      {/* Table card */}
      <StudioCard className="overflow-hidden p-0">
        {/* Table header controls */}
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black" style={{ color: "var(--tx)" }}>{t.tableTitle}</h2>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-black" style={{ background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)" }}>
                {filtered.length} đơn
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--tx-f)" }} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder={t.searchPlaceholder}
                  className="rounded-xl py-2 pl-9 pr-3 text-[13px] outline-none"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)", width: 220 }}
                />
              </div>
              <select
                value={dateRange}
                onChange={(e) => { setDateRange(e.target.value as DateRange); setPage(1); }}
                className="rounded-xl px-3 py-2 text-[12px] outline-none"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
              >
                {dateOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => void ordersQuery.refetch()}
                className="rounded-xl p-2 transition hover:opacity-70"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${ordersQuery.isFetching ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1">
            {filterTabs.map((f) => tabBtn(f.key, f.label, f.dot))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 980 }}>
            <thead>
              <tr style={{ background: "var(--inp)", borderBottom: "1px solid var(--bd)" }}>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colOrder}</th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colProduct}</th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colCustomer}</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" title={t.colDelivery} style={{ color: "var(--tx-f)" }}>
                  <span className="inline-flex justify-center"><Truck className="h-4 w-4" aria-label={t.colDelivery} /></span>
                </th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" title={t.colPayment} style={{ color: "var(--tx-f)" }}>
                  <span className="inline-flex justify-center"><CreditCard className="h-4 w-4" aria-label={t.colPayment} /></span>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colDate}</th>
                <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colTotal}</th>
                <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colSourceLN}</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[13px]" style={{ color: "var(--tx-f)" }}>
                    Không có đơn hàng nào
                  </td>
                </tr>
              ) : pageItems.map((order: any) => {
                const hasAccount = Boolean(order.deliveredAccountText);
                const isExpanded = expandedOrderId === order.id;
                const { prefix, suffix } = shortOrderCode(order.orderCode || "");
                const status = String(order.status || "").toLowerCase();
                const payStatus = String(order.paymentStatus || "").toLowerCase();

                return (
                  <>
                    <tr
                      key={order.id}
                      className="border-b transition-colors duration-100 hover:bg-[rgba(139,92,246,0.04)]"
                      style={{ borderColor: "var(--bd)", cursor: hasAccount ? "pointer" : undefined }}
                      onClick={hasAccount ? () => setExpandedOrderId((p) => p === order.id ? null : order.id) : undefined}
                    >
                      {/* Mã đơn */}
                      <td className="px-4 py-3 align-top">
                        <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
                          {prefix}-<span className="font-black" style={{ color: "rgb(52,211,153)" }}>{suffix}</span>
                        </p>
                        {order.failureReason && (
                          <p className="mt-1 max-w-[200px] text-[11px] leading-4 text-rose-400">{order.failureReason}</p>
                        )}
                        {hasAccount && (
                          <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                            <KeyRound className="h-3 w-3" />
                            {isExpanded ? "Ẩn" : "Xem"}
                          </p>
                        )}
                      </td>

                      {/* Sản phẩm */}
                      <td className="px-4 py-3 align-top">
                        <p className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{order.productName}</p>
                        {status === "delivered" && (
                          <p className="mt-0.5 text-[11px] text-emerald-400">✓ Đã giao tài khoản</p>
                        )}
                      </td>

                      {/* Khách hàng */}
                      <td className="px-4 py-3 align-top">
                        <p className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>
                          {order.customer?.telegramUsername ? `@${order.customer.telegramUsername}` : order.customer?.name || "—"}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--tx-f)" }}>
                          {order.customer?.telegramChatId || order.customer?.telegramUserId || ""}
                        </p>
                      </td>

                      {/* Giao hàng */}
                      <td className="px-4 py-3 align-top text-center">
                        <span title={formatStatusLabel(order.status)} className="inline-flex">
                          {status === "delivered" ? (
                            <CheckCircle2 className="h-5 w-5" style={{ color: "rgb(52,211,153)" }} />
                          ) : status === "failed" || status === "refunded" ? (
                            <XCircle className="h-5 w-5" style={{ color: "rgb(248,113,113)" }} />
                          ) : status === "paid_waiting_stock" ? (
                            <AlertTriangle className="h-5 w-5" style={{ color: "rgb(251,191,36)" }} />
                          ) : (
                            <Clock className="h-5 w-5" style={{ color: "var(--tx-f)" }} />
                          )}
                        </span>
                      </td>

                      {/* Thanh toán */}
                      <td className="px-4 py-3 align-top text-center">
                        <span title={formatStatusLabel(order.paymentStatus)} className="inline-flex">
                          {payStatus === "paid" ? (
                            <CheckCircle2 className="h-5 w-5" style={{ color: "rgb(52,211,153)" }} />
                          ) : payStatus === "failed" || payStatus === "refunded" ? (
                            <XCircle className="h-5 w-5" style={{ color: "rgb(248,113,113)" }} />
                          ) : (
                            <Clock className="h-5 w-5" style={{ color: "rgb(251,191,36)" }} />
                          )}
                        </span>
                        {["binance", "okx", "usdt_trc20"].includes(String(order.paymentTransaction?.provider || "").toLowerCase()) &&
                          payStatus !== "paid" && (
                          <div className="mt-2 space-y-1.5">
                            <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>
                              {formatStatusLabel(order.paymentTransaction?.provider)} {t.manualUSDT}
                            </p>
                            <button
                              type="button"
                              disabled={confirmManualPaymentMutation.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(t.confirmUSDTMsg(order.orderCode))) {
                                  confirmManualPaymentMutation.mutate(order.id);
                                }
                              }}
                              className="rounded-lg px-2.5 py-1 text-[11px] font-black transition hover:opacity-80 disabled:opacity-40"
                              style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", color: "rgb(251,191,36)" }}
                            >
                              {t.confirmUSDT}
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Thời gian */}
                      <td className="px-4 py-3 align-top text-[12px] tabular-nums" style={{ color: "var(--tx-f)" }}>
                        {formatOrderDate(order.createdAt)}
                      </td>

                      {/* Tổng */}
                      <td className="px-4 py-3 text-right align-top">
                        <span className="text-[13px] font-black tabular-nums" style={{ color: "var(--tx)" }}>
                          {formatCurrency(order.totalSaleAmount)}
                        </span>
                      </td>

                      {/* Giá nguồn / LN */}
                      <td className="px-4 py-3 text-right align-top">
                        {(() => {
                          const sourceAmount = Number(order.totalSourceAmount) || 0;
                          if (sourceAmount <= 0) {
                            return <span className="text-[13px]" style={{ color: "var(--tx-f)" }}>—</span>;
                          }
                          const profit = Number(order.totalSaleAmount || 0) - sourceAmount;
                          return (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--tx)" }}>
                                {formatCurrency(sourceAmount)}
                              </span>
                              <span
                                className="text-[11px] font-bold tabular-nums"
                                style={{ color: profit >= 0 ? "rgb(52,211,153)" : "rgb(248,113,113)" }}
                              >
                                {profit >= 0 ? "+" : ""}{formatCurrency(profit)}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>

                    {hasAccount && isExpanded && (
                      <tr key={`${order.id}-expand`}>
                        <td colSpan={8} className="px-4 pb-3 pt-0">
                          <div className="rounded-2xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
                                  {t.deliveredAccount}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void handleCopy(order.id, order.deliveredAccountText); }}
                                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black uppercase transition active:scale-95"
                                style={
                                  copiedOrderId === order.id
                                    ? { background: "rgba(52,211,153,0.12)", color: "rgb(52,211,153)", border: "1px solid rgba(52,211,153,0.25)" }
                                    : { background: "var(--surface)", color: "var(--tx-f)", border: "1px solid var(--bd)" }
                                }
                              >
                                {copiedOrderId === order.id
                                  ? <><Check className="h-3.5 w-3.5" /> {t.copied}</>
                                  : <><Copy className="h-3.5 w-3.5" /> {t.copy}</>}
                              </button>
                            </div>
                            <pre
                              className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl px-4 py-3 text-[13px] leading-6"
                              style={{ background: "var(--surface)", color: "var(--tx)", border: "1px solid var(--bd)", fontFamily: "monospace" }}
                            >
                              {order.deliveredAccountText}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-4 px-5 py-3" style={{ borderTop: "1px solid var(--bd)" }}>
          <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
            {t.showing(
              filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1,
              Math.min(currentPage * PAGE_SIZE, filtered.length),
              filtered.length,
            )}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg px-2 py-1 text-[12px] font-black transition disabled:opacity-30"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
            >
              ‹
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className="h-7 w-7 rounded-lg text-[12px] font-black transition"
                  style={{
                    background: p === currentPage ? "var(--primary)" : "var(--inp)",
                    border: `1px solid ${p === currentPage ? "var(--primary)" : "var(--bd)"}`,
                    color: p === currentPage ? "#fff" : "var(--tx)",
                  }}
                >
                  {p}
                </button>
              );
            })}
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg px-2 py-1 text-[12px] font-black transition disabled:opacity-30"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
            >
              ›
            </button>
          </div>
        </div>
      </StudioCard>
    </div>
  );
}
