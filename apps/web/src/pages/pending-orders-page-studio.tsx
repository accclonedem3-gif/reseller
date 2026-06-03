import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Package, RefreshCw, Search, User, XCircle } from "lucide-react";

import { StudioBadge, StudioButton, StudioCard } from "@/components/studio/studio-ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    title: "Đơn chờ xử lý",
    openOrders: (n: number) => `${n} đơn mở`,
    paid: (n: number) => `${n} đã thanh toán`,
    total: "Tổng",
    refreshing: "Đang tải...",
    refresh: "Làm mới",
    emptyTitle: "Không có đơn chờ xử lý",
    emptyDesc: "Khi có đơn cần theo dõi, danh sách sẽ tự cập nhật",
    colOrder: "Mã đơn / Sản phẩm",
    colStatus: "Trạng thái",
    colValue: "Giá trị",
    colPayment: "Thanh toán",
    colCustomer: "Khách hàng",
    colIssue: "Vấn đề",
    colAction: "Thao tác",
    qty: "SL",
    waitingStock: "Chờ seller xử lý thủ công.",
    confirmDone: "Hoàn tất",
    processing: "Đang xử lý...",
    cancelOrder: "Hủy đơn",
    cancelling: "Đang hủy...",
    done: "Hoàn tất",
    cancel: "Hủy",
    confirmCancelMsg: (code: string) => `Hủy xử lý đơn ${code}?`,
    toastComplete: "Đơn đã được đánh dấu hoàn tất.",
    toastCancel: "Đơn đã được hủy xử lý.",
    toastCompleteErr: "Không thể xác nhận đơn hoàn tất.",
    toastCancelErr: "Không thể hủy đơn hàng này.",
    agoJust: "vừa xong",
    agoMin: (m: number) => `${m} phút trước`,
    agoHour: (h: number) => `${h} giờ trước`,
    agoDay: (d: number) => `${d} ngày trước`,
    searchPlaceholder: "Tìm mã đơn, sản phẩm, khách hàng...",
    noResults: "Không tìm thấy đơn nào",
  },
  en: {
    title: "Pending orders",
    openOrders: (n: number) => `${n} open`,
    paid: (n: number) => `${n} paid`,
    total: "Total",
    refreshing: "Loading...",
    refresh: "Refresh",
    emptyTitle: "No pending orders",
    emptyDesc: "When there are orders to monitor, the list will update automatically",
    colOrder: "Order / Product",
    colStatus: "Status",
    colValue: "Value",
    colPayment: "Payment",
    colCustomer: "Customer",
    colIssue: "Issue",
    colAction: "Action",
    qty: "Qty",
    waitingStock: "Waiting for seller to handle manually.",
    confirmDone: "Complete",
    processing: "Processing...",
    cancelOrder: "Cancel",
    cancelling: "Cancelling...",
    done: "Complete",
    cancel: "Cancel",
    confirmCancelMsg: (code: string) => `Cancel order ${code}?`,
    toastComplete: "Order marked as complete.",
    toastCancel: "Order has been cancelled.",
    toastCompleteErr: "Could not confirm order as complete.",
    toastCancelErr: "Could not cancel this order.",
    agoJust: "just now",
    agoMin: (m: number) => `${m}m ago`,
    agoHour: (h: number) => `${h}h ago`,
    agoDay: (d: number) => `${d}d ago`,
    searchPlaceholder: "Search order, product, customer...",
    noResults: "No orders found",
  },
  th: {
    title: "คำสั่งซื้อที่รอดำเนินการ",
    openOrders: (n: number) => `${n} รายการเปิด`,
    paid: (n: number) => `${n} ชำระแล้ว`,
    total: "รวม",
    refreshing: "กำลังโหลด...",
    refresh: "รีเฟรช",
    emptyTitle: "ไม่มีคำสั่งซื้อที่รอดำเนินการ",
    emptyDesc: "เมื่อมีคำสั่งซื้อที่ต้องติดตาม รายการจะอัปเดตโดยอัตโนมัติ",
    colOrder: "คำสั่งซื้อ / สินค้า",
    colStatus: "สถานะ",
    colValue: "มูลค่า",
    colPayment: "การชำระเงิน",
    colCustomer: "ลูกค้า",
    colIssue: "ปัญหา",
    colAction: "การดำเนินการ",
    qty: "จำนวน",
    waitingStock: "รอผู้ขายดำเนินการด้วยตนเอง",
    confirmDone: "เสร็จสิ้น",
    processing: "กำลังดำเนินการ...",
    cancelOrder: "ยกเลิก",
    cancelling: "กำลังยกเลิก...",
    done: "เสร็จสิ้น",
    cancel: "ยกเลิก",
    confirmCancelMsg: (code: string) => `ยกเลิกคำสั่งซื้อ ${code}?`,
    toastComplete: "คำสั่งซื้อถูกทำเครื่องหมายว่าเสร็จสิ้นแล้ว",
    toastCancel: "คำสั่งซื้อถูกยกเลิกแล้ว",
    toastCompleteErr: "ไม่สามารถยืนยันคำสั่งซื้อว่าเสร็จสิ้นได้",
    toastCancelErr: "ไม่สามารถยกเลิกคำสั่งซื้อนี้ได้",
    agoJust: "เมื่อกี้",
    agoMin: (m: number) => `${m} นาทีที่แล้ว`,
    agoHour: (h: number) => `${h} ชั่วโมงที่แล้ว`,
    agoDay: (d: number) => `${d} วันที่แล้ว`,
    searchPlaceholder: "ค้นหาคำสั่งซื้อ สินค้า ลูกค้า...",
    noResults: "ไม่พบคำสั่งซื้อ",
  },
};

export function PendingOrdersPageStudio() {
  const { lang } = useLang();
  const t = T[lang];

  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return t.agoJust;
    if (m < 60) return t.agoMin(m);
    const h = Math.floor(m / 60);
    if (h < 24) return t.agoHour(h);
    return t.agoDay(Math.floor(h / 24));
  }

  const ordersQuery = useQuery({
    queryKey: ["orders", "pending"],
    queryFn: async () =>
      (await api.get("/orders", { params: { status: "PAID_WAITING_STOCK" } })).data,
  });

  const completeMutation = useMutation({
    mutationFn: async (orderId: string) =>
      (await api.post(`/orders/${orderId}/manual-complete`)).data,
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastComplete });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders", "pending"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
    },
    onError: (error: any) => {
      showToast({ tone: "error", message: error?.response?.data?.message || t.toastCompleteErr });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) =>
      (await api.post(`/orders/${orderId}/manual-cancel`)).data,
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastCancel });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders", "pending"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
    },
    onError: (error: any) => {
      showToast({ tone: "error", message: error?.response?.data?.message || t.toastCancelErr });
    },
  });

  const activeOrderId = useMemo(
    () =>
      completeMutation.isPending
        ? (completeMutation.variables as string | undefined)
        : cancelMutation.isPending
          ? (cancelMutation.variables as string | undefined)
          : undefined,
    [cancelMutation.isPending, cancelMutation.variables, completeMutation.isPending, completeMutation.variables],
  );

  const orders = ordersQuery.data || [];
  const totalValue = orders.reduce((sum: number, o: any) => sum + Number(o.totalSaleAmount || 0), 0);
  const paidCount = orders.filter((o: any) => String(o.paymentStatus || "").toLowerCase() === "paid").length;
  const isBusy = completeMutation.isPending || cancelMutation.isPending;

  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter((o: any) =>
      (o.orderCode || "").toLowerCase().includes(q) ||
      (o.productName || "").toLowerCase().includes(q) ||
      (o.customer?.telegramUsername || "").toLowerCase().includes(q) ||
      (o.customer?.name || "").toLowerCase().includes(q) ||
      (o.customer?.telegramChatId || "").includes(q),
    );
  }, [orders, search]);

  return (
    <div className="space-y-4">
      <StudioCard className="overflow-hidden p-0">
        {/* Header */}
        <div className="border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--bd)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                {t.title}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  <span className="font-black" style={{ color: "var(--tx)" }}>{orders.length}</span>{" "}
                  {t.openOrders(orders.length).split(" ").slice(1).join(" ")}
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  <span className="font-black text-emerald-500">{paidCount}</span>{" "}
                  {t.paid(paidCount).split(" ").slice(1).join(" ")}
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  {t.total} <span className="font-black text-amber-500">{formatCurrency(totalValue)}</span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--tx-f)" }} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="rounded-xl py-2 pl-9 pr-3 text-[13px] outline-none"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)", width: 240 }}
                />
              </div>
              <StudioButton
                variant="secondary"
                disabled={ordersQuery.isFetching}
                onClick={() => void ordersQuery.refetch()}
              >
                <RefreshCw className="h-4 w-4" />
                {ordersQuery.isFetching ? t.refreshing : t.refresh}
              </StudioButton>
            </div>
          </div>
        </div>

        {/* Table */}
        {ordersQuery.isLoading ? (
          <div className="space-y-0 px-5 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[80px] animate-pulse border-b last:border-0"
                style={{ borderColor: "var(--bd)" }}
              />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div
              className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: "var(--inp)" }}
            >
              <Package className="h-7 w-7 opacity-30" style={{ color: "var(--tx)" }} />
            </div>
            <p className="text-sm font-black uppercase tracking-[0.2em] opacity-40" style={{ color: "var(--tx)" }}>
              {search.trim() ? t.noResults : t.emptyTitle}
            </p>
            {!search.trim() && (
              <p className="mt-1 text-[10px] font-bold uppercase opacity-20" style={{ color: "var(--tx)" }}>
                {t.emptyDesc}
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Desktop table */}
            <table className="hidden w-full text-sm lg:table" style={{ tableLayout: "fixed", minWidth: "980px" }}>
              <colgroup>
                <col style={{ width: "32px" }} />
                <col style={{ width: "240px" }} />
                <col style={{ width: "140px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "170px" }} />
                <col />
                <col style={{ width: "160px" }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}>
                  <th className="py-2.5 pl-5 pr-2 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>#</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colOrder}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colStatus}</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colValue}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colPayment}</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colCustomer}</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colIssue}</th>
                  <th className="py-2.5 pl-3 pr-5 text-center text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order: any, index: number) => {
                  const isActive = activeOrderId === order.id;
                  const isCompleting = isActive && completeMutation.isPending;
                  const isCancelling = isActive && cancelMutation.isPending;
                  const customerName = order.customer?.telegramUsername
                    ? `@${order.customer.telegramUsername}`
                    : order.customer?.name || null;

                  return (
                    <tr
                      key={order.id}
                      className="group border-b last:border-0 transition-colors duration-150"
                      style={{ borderColor: "var(--bd)" }}
                    >
                      <td className="py-4 pl-5 pr-2 text-xs font-bold tabular-nums" style={{ color: "var(--tx-f)" }}>{index + 1}</td>

                      {/* Order + Product */}
                      <td className="px-3 py-4">
                        <div className="flex items-start gap-2.5">
                          <div
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                            style={{ backgroundColor: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
                          >
                            <Package className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                              {order.orderCode}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] font-semibold" style={{ color: "var(--accent, #f97316)" }}>
                              {order.productName}
                            </p>
                            <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>
                              {t.qty}: <span className="font-bold">{order.quantity}</span>
                              {" · "}{timeAgo(order.createdAt)}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-4 text-center">
                        <StudioBadge tone="warning">Chờ xử lý</StudioBadge>
                      </td>

                      {/* Value */}
                      <td className="px-3 py-4 text-right">
                        <p className="text-sm font-black tabular-nums text-amber-500">{formatCurrency(order.totalSaleAmount)}</p>
                        {order.quantity > 1 && (
                          <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: "var(--tx-f)" }}>
                            {formatCurrency(order.salePrice)}/sp
                          </p>
                        )}
                      </td>

                      {/* Payment */}
                      <td className="px-3 py-4 text-center">
                        <span
                          className="text-xs font-bold"
                          style={{
                            color: String(order.paymentStatus || "").toLowerCase() === "paid"
                              ? "rgb(52,211,153)"
                              : "var(--tx-f)",
                          }}
                        >
                          {String(order.paymentStatus || "").toLowerCase() === "paid" ? "Đã TT" : formatStatusLabel(order.paymentStatus)}
                        </span>
                        {order.paymentTransaction?.provider && (
                          <p className="mt-0.5 text-[10px] uppercase" style={{ color: "var(--tx-f)" }}>
                            {String(order.paymentTransaction.provider).toLowerCase() === "wallet" ? "VÍ" : order.paymentTransaction.provider}
                          </p>
                        )}
                      </td>

                      {/* Customer */}
                      <td className="px-3 py-4">
                        {customerName ? (
                          <div className="flex items-center gap-1.5">
                            <User className="h-3 w-3 shrink-0" style={{ color: "var(--tx-f)" }} />
                            <span className="truncate text-[12px] font-semibold" style={{ color: "var(--tx)" }}>
                              {customerName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px]" style={{ color: "var(--tx-f)" }}>—</span>
                        )}
                        {order.customer?.name && order.customer?.telegramUsername && (
                          <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--tx-f)" }}>
                            {order.customer.name}
                          </p>
                        )}
                      </td>

                      {/* Issue */}
                      <td className="px-3 py-4">
                        <p className="line-clamp-2 text-[12px] leading-5" style={{ color: "var(--tx-f)" }}>
                          {order.failureReason || t.waitingStock}
                        </p>
                      </td>

                      {/* Actions */}
                      <td className="py-4 pl-3 pr-5">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            title={isCompleting ? t.processing : t.confirmDone}
                            disabled={isBusy}
                            onClick={() => completeMutation.mutate(order.id)}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold uppercase transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
                            style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "rgb(22,163,74)" }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isCompleting ? "..." : t.done}
                          </button>
                          <button
                            type="button"
                            title={isCancelling ? t.cancelling : t.cancelOrder}
                            disabled={isBusy}
                            onClick={() => {
                              if (!window.confirm(t.confirmCancelMsg(order.orderCode))) return;
                              cancelMutation.mutate(order.id);
                            }}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold uppercase transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
                            style={{ backgroundColor: "rgba(244,63,94,0.15)", color: "rgb(225,29,72)" }}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {isCancelling ? "..." : t.cancel}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile list */}
            <div className="lg:hidden">
              {filteredOrders.map((order: any) => {
                const isActive = activeOrderId === order.id;
                const isCompleting = isActive && completeMutation.isPending;
                const isCancelling = isActive && cancelMutation.isPending;
                const customerName = order.customer?.telegramUsername
                  ? `@${order.customer.telegramUsername}`
                  : order.customer?.name || null;

                return (
                  <div
                    key={order.id}
                    className="border-b px-4 py-4 last:border-0"
                    style={{ borderColor: "var(--bd)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StudioBadge tone="warning">Chờ xử lý</StudioBadge>
                          <span className="text-[11px]" style={{ color: "var(--tx-f)" }}>{timeAgo(order.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 text-sm font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>{order.orderCode}</p>
                        <p className="mt-0.5 truncate text-xs font-semibold" style={{ color: "var(--accent, #f97316)" }}>{order.productName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--tx-f)" }}>
                          <span>{t.qty}: <b>{order.quantity}</b></span>
                          {customerName && <span>· {customerName}</span>}
                          {order.paymentTransaction?.provider && <span>· {String(order.paymentTransaction.provider).toLowerCase() === "wallet" ? "VÍ" : order.paymentTransaction.provider}</span>}
                        </div>
                        <p className="mt-1.5 text-base font-black text-amber-500">{formatCurrency(order.totalSaleAmount)}</p>
                        {order.failureReason && (
                          <p className="mt-1 text-[11px] leading-4" style={{ color: "var(--tx-f)" }}>{order.failureReason}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => completeMutation.mutate(order.id)}
                          className="flex items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-bold uppercase disabled:opacity-40"
                          style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "rgb(22,163,74)" }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {isCompleting ? "..." : t.done}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            if (!window.confirm(t.confirmCancelMsg(order.orderCode))) return;
                            cancelMutation.mutate(order.id);
                          }}
                          className="flex items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-bold uppercase disabled:opacity-40"
                          style={{ backgroundColor: "rgba(244,63,94,0.15)", color: "rgb(225,29,72)" }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {isCancelling ? "..." : t.cancel}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </StudioCard>
    </div>
  );
}
