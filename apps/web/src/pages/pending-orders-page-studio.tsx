import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Package, RefreshCw, XCircle } from "lucide-react";

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
    colOrder: "Mã đơn",
    colStatus: "Trạng thái",
    colValue: "Giá trị",
    colPayment: "Thanh toán",
    colIssue: "Vấn đề",
    colAction: "Thao tác",
    waitingStock: "Chờ upstream có hàng trở lại.",
    hideAccount: "Ẩn tài khoản",
    viewAccount: "Xem tài khoản",
    confirmDone: "Xác nhận đã xong",
    processing: "Đang xử lý...",
    cancelOrder: "Hủy đơn",
    cancelling: "Đang hủy...",
    done: "Xong",
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
    colOrder: "Order code",
    colStatus: "Status",
    colValue: "Value",
    colPayment: "Payment",
    colIssue: "Issue",
    colAction: "Action",
    waitingStock: "Waiting for upstream stock to return.",
    hideAccount: "Hide account",
    viewAccount: "View account",
    confirmDone: "Mark as done",
    processing: "Processing...",
    cancelOrder: "Cancel order",
    cancelling: "Cancelling...",
    done: "Done",
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
    colOrder: "รหัสคำสั่งซื้อ",
    colStatus: "สถานะ",
    colValue: "มูลค่า",
    colPayment: "การชำระเงิน",
    colIssue: "ปัญหา",
    colAction: "การดำเนินการ",
    waitingStock: "รอสต็อกจากต้นทางกลับมา",
    hideAccount: "ซ่อนบัญชี",
    viewAccount: "ดูบัญชี",
    confirmDone: "ยืนยันเสร็จสิ้น",
    processing: "กำลังดำเนินการ...",
    cancelOrder: "ยกเลิกคำสั่งซื้อ",
    cancelling: "กำลังยกเลิก...",
    done: "เสร็จ",
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
  },
};

const ACTION_COLORS = {
  green: { bg: "rgba(34,197,94,0.15)", color: "rgb(22,163,74)" },
  red:   { bg: "rgba(244,63,94,0.15)", color: "rgb(225,29,72)" },
} as const;

function ActionBtn({
  title,
  color,
  onClick,
  disabled,
  children,
}: {
  title: string;
  color: keyof typeof ACTION_COLORS;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { bg, color: clr } = ACTION_COLORS[color];
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-lg opacity-30 transition-all duration-150 hover:scale-110 hover:opacity-100 active:scale-95 disabled:pointer-events-none disabled:opacity-20 group-hover:opacity-100"
      style={{ backgroundColor: bg, color: clr }}
    >
      {children}
    </button>
  );
}

export function PendingOrdersPageStudio() {
  const { lang } = useLang();
  const t = T[lang];

  const queryClient = useQueryClient();
  const { showToast } = useToast();

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
                  <span className="font-black" style={{ color: "var(--tx)" }}>{orders.length}</span> {t.openOrders(orders.length).split(" ").slice(1).join(" ")}
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  <span className="font-black text-emerald-500">{paidCount}</span> {t.paid(paidCount).split(" ").slice(1).join(" ")}
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  {t.total} <span className="font-black text-amber-500">{formatCurrency(totalValue)}</span>
                </span>
              </div>
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

        {/* Table */}
        {ordersQuery.isLoading ? (
          <div className="space-y-0 px-5 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[68px] animate-pulse border-b last:border-0"
                style={{ borderColor: "var(--bd)" }}
              />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div
              className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: "var(--inp)" }}
            >
              <Package className="h-7 w-7 opacity-30" style={{ color: "var(--tx)" }} />
            </div>
            <p className="text-sm font-black uppercase tracking-[0.2em] opacity-40" style={{ color: "var(--tx)" }}>
              {t.emptyTitle}
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase opacity-20" style={{ color: "var(--tx)" }}>
              {t.emptyDesc}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="hidden w-full text-sm lg:table" style={{ tableLayout: "fixed", minWidth: "940px" }}>
              <colgroup>
                <col style={{ width: "32px" }} />
                <col style={{ width: "210px" }} />
                <col style={{ width: "148px" }} />
                <col style={{ width: "124px" }} />
                <col style={{ width: "158px" }} />
                <col />
                <col style={{ width: "88px" }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}>
                  <th className="py-2.5 pl-5 pr-2 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>#</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colOrder}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colStatus}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colValue}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colPayment}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colIssue}</th>
                  <th className="py-2.5 pl-3 pr-5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order: any, index: number) => (
                  <tr
                    key={order.id}
                    className="group border-b last:border-0 transition-colors duration-150"
                    style={{ borderColor: "var(--bd)" }}
                  >
                    <td className="py-3 pl-5 pr-2 text-xs font-bold tabular-nums" style={{ color: "var(--tx-f)" }}>{index + 1}</td>

                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                          style={{ backgroundColor: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
                        >
                          <Package className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                            {order.orderCode}
                          </p>
                          <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--tx-f)" }}>
                            {order.productName}
                            {(order.customer?.telegramUsername || order.customer?.name) && (
                              <> · @{order.customer?.telegramUsername || order.customer?.name}</>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      <StudioBadge tone="warning">{formatStatusLabel(order.status)}</StudioBadge>
                      <p className="mt-1.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
                        <Clock className="h-3 w-3" />
                        {timeAgo(order.createdAt)}
                      </p>
                    </td>

                    <td className="px-3 py-3 text-right">
                      <p className="text-sm font-black tabular-nums text-amber-500">{formatCurrency(order.totalSaleAmount)}</p>
                    </td>

                    <td className="px-3 py-3 text-right">
                      <p
                        className="text-sm font-semibold tabular-nums"
                        style={{
                          color: String(order.paymentStatus || "").toLowerCase() === "paid"
                            ? "rgb(52,211,153)"
                            : "var(--tx-f)",
                        }}
                      >
                        {formatStatusLabel(order.paymentStatus)}
                      </p>
                    </td>

                    <td className="px-3 py-3">
                      <p className="line-clamp-2 text-[12px] leading-5" style={{ color: "var(--tx-f)" }}>
                        {order.failureReason || t.waitingStock}
                      </p>
                    </td>

                    <td className="py-3 pl-3 pr-5">
                      <div className="flex items-center justify-end gap-0.5">
                        <ActionBtn
                          title={activeOrderId === order.id && completeMutation.isPending ? t.processing : t.confirmDone}
                          color="green"
                          disabled={isBusy}
                          onClick={() => completeMutation.mutate(order.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </ActionBtn>
                        <ActionBtn
                          title={activeOrderId === order.id && cancelMutation.isPending ? t.cancelling : t.cancelOrder}
                          color="red"
                          disabled={isBusy}
                          onClick={() => {
                            if (!window.confirm(t.confirmCancelMsg(order.orderCode))) return;
                            cancelMutation.mutate(order.id);
                          }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </ActionBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile list */}
            <div className="lg:hidden">
              {orders.map((order: any) => (
                <div
                  key={order.id}
                  className="flex items-start justify-between gap-3 border-b px-4 py-3.5 last:border-0"
                  style={{ borderColor: "var(--bd)" }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StudioBadge tone="warning">{formatStatusLabel(order.status)}</StudioBadge>
                      <span className="text-[11px]" style={{ color: "var(--tx-f)" }}>{timeAgo(order.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 text-sm font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>{order.orderCode}</p>
                    <p className="mt-0.5 truncate text-xs" style={{ color: "var(--tx-f)" }}>{order.productName}</p>
                    <p className="mt-1 text-sm font-black text-amber-500">{formatCurrency(order.totalSaleAmount)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => completeMutation.mutate(order.id)}
                      className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase disabled:opacity-40"
                      style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "rgb(22,163,74)" }}
                    >
                      {t.done}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        if (!window.confirm(t.confirmCancelMsg(order.orderCode))) return;
                        cancelMutation.mutate(order.id);
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase disabled:opacity-40"
                      style={{ backgroundColor: "rgba(244,63,94,0.15)", color: "rgb(225,29,72)" }}
                    >
                      {t.cancel}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </StudioCard>
    </div>
  );
}
