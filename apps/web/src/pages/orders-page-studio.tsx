import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleDollarSign,
  Copy,
  KeyRound,
  PackageCheck,
  ShoppingCart,
} from "lucide-react";

import {
  StudioBadge,
  StudioButton,
  StudioCard,
  StudioMetric,
  StudioSectionIntro,
} from "@/components/studio/studio-ui";
import { InfoHint } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    kicker: "Điều phối đơn hàng",
    title: "Toàn bộ giao dịch của seller",
    desc: "Theo dõi trạng thái thanh toán, tiến độ mua upstream, giao account và các lỗi phát sinh trên cùng một bảng đọc nhanh.",
    metricTotal: "Tổng số đơn",
    metricTotalDesc: "Toàn bộ đơn hàng hiện có trong workspace seller.",
    metricPaid: "Đơn đã thanh toán",
    metricPaidDesc: "Những đơn đã ghi nhận tiền thành công trong hệ thống.",
    metricDelivered: "Đơn đã giao",
    metricDeliveredDesc: "Các đơn đã hoàn tất luồng giao account cho khách.",
    metricFailed: "Đơn lỗi",
    metricFailedDesc: "Bao gồm lỗi upstream, hoàn tiền và các ca seller cần xử lý.",
    tableKicker: "Nhật ký đơn hàng",
    tableTitle: "Bảng theo dõi 100 đơn gần nhất",
    tableHint: "Ưu tiên hiển thị đúng các thông tin seller cần để xử lý nhanh từng đơn.",
    tableHintLabel: "Xem ghi chú cho Nhật ký đơn hàng",
    colOrder: "Mã đơn",
    colProduct: "Sản phẩm",
    colCustomer: "Khách hàng",
    colStatus: "Trạng thái",
    colPayment: "Thanh toán",
    colDate: "Tạo lúc",
    colTotal: "Tổng",
    hideAccount: "Ẩn tài khoản",
    viewAccount: "Xem tài khoản",
    deliveredAccount: "Tài khoản đã giao",
    copied: "Đã copy",
    copy: "Copy",
    manualUSDT: "thanh toán thủ công",
    confirmUSDT: "Xác nhận đã nhận USDT",
    confirmUSDTMsg: (code: string) => `Xác nhận đã nhận USDT cho đơn ${code}?`,
    toastConfirmed: "Đã xác nhận thanh toán USDT và đưa đơn vào luồng xử lý.",
    toastErr: "Không thể xác nhận thanh toán.",
  },
  en: {
    kicker: "Order management",
    title: "All seller transactions",
    desc: "Track payment status, upstream purchase progress, account delivery, and errors from one quick-read table.",
    metricTotal: "Total orders",
    metricTotalDesc: "All orders currently in the seller workspace.",
    metricPaid: "Paid orders",
    metricPaidDesc: "Orders with successful payment recorded in the system.",
    metricDelivered: "Delivered orders",
    metricDeliveredDesc: "Orders that completed the account delivery flow.",
    metricFailed: "Failed orders",
    metricFailedDesc: "Includes upstream errors, refunds, and cases requiring seller attention.",
    tableKicker: "Order log",
    tableTitle: "Last 100 orders",
    tableHint: "Prioritizes information sellers need to quickly process each order.",
    tableHintLabel: "View notes for Order log",
    colOrder: "Order code",
    colProduct: "Product",
    colCustomer: "Customer",
    colStatus: "Status",
    colPayment: "Payment",
    colDate: "Created",
    colTotal: "Total",
    hideAccount: "Hide account",
    viewAccount: "View account",
    deliveredAccount: "Delivered account",
    copied: "Copied",
    copy: "Copy",
    manualUSDT: "manual payment",
    confirmUSDT: "Confirm USDT received",
    confirmUSDTMsg: (code: string) => `Confirm USDT received for order ${code}?`,
    toastConfirmed: "USDT payment confirmed and order moved to processing.",
    toastErr: "Could not confirm payment.",
  },
  th: {
    kicker: "การจัดการคำสั่งซื้อ",
    title: "ธุรกรรมทั้งหมดของผู้ขาย",
    desc: "ติดตามสถานะการชำระเงิน ความคืบหน้าการซื้อต้นทาง การส่งมอบบัญชี และข้อผิดพลาดจากตารางเดียว",
    metricTotal: "คำสั่งซื้อทั้งหมด",
    metricTotalDesc: "คำสั่งซื้อทั้งหมดในพื้นที่ทำงานของผู้ขาย",
    metricPaid: "คำสั่งซื้อที่ชำระแล้ว",
    metricPaidDesc: "คำสั่งซื้อที่บันทึกการชำระเงินสำเร็จในระบบ",
    metricDelivered: "คำสั่งซื้อที่จัดส่งแล้ว",
    metricDeliveredDesc: "คำสั่งซื้อที่เสร็จสิ้นขั้นตอนการส่งมอบบัญชีแล้ว",
    metricFailed: "คำสั่งซื้อที่ล้มเหลว",
    metricFailedDesc: "รวมข้อผิดพลาดต้นทาง การคืนเงิน และกรณีที่ต้องการความสนใจจากผู้ขาย",
    tableKicker: "บันทึกคำสั่งซื้อ",
    tableTitle: "100 คำสั่งซื้อล่าสุด",
    tableHint: "แสดงข้อมูลที่ผู้ขายต้องการเพื่อดำเนินการแต่ละคำสั่งซื้ออย่างรวดเร็ว",
    tableHintLabel: "ดูบันทึกสำหรับบันทึกคำสั่งซื้อ",
    colOrder: "รหัสคำสั่งซื้อ",
    colProduct: "สินค้า",
    colCustomer: "ลูกค้า",
    colStatus: "สถานะ",
    colPayment: "การชำระเงิน",
    colDate: "สร้างเมื่อ",
    colTotal: "รวม",
    hideAccount: "ซ่อนบัญชี",
    viewAccount: "ดูบัญชี",
    deliveredAccount: "บัญชีที่จัดส่งแล้ว",
    copied: "คัดลอกแล้ว",
    copy: "คัดลอก",
    manualUSDT: "ชำระเงินด้วยตนเอง",
    confirmUSDT: "ยืนยันได้รับ USDT แล้ว",
    confirmUSDTMsg: (code: string) => `ยืนยันได้รับ USDT สำหรับคำสั่งซื้อ ${code}?`,
    toastConfirmed: "ยืนยันการชำระเงิน USDT แล้วและย้ายคำสั่งซื้อไปประมวลผล",
    toastErr: "ไม่สามารถยืนยันการชำระเงินได้",
  },
};

function statusTone(status: string) {
  if (status === "delivered") return "success" as const;
  if (status === "failed" || status === "refunded") return "danger" as const;
  if (status === "paid_waiting_stock") return "warning" as const;
  return "neutral" as const;
}

export function OrdersPageStudio() {
  const { lang } = useLang();
  const t = T[lang];

  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: async () => (await api.get("/orders")).data,
  });

  const orders = ordersQuery.data || [];

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

  const paidOrders = orders.filter((o: any) => String(o.paymentStatus || "").toLowerCase() === "paid");
  const deliveredOrders = orders.filter((o: any) => String(o.status || "").toLowerCase() === "delivered");
  const failedOrders = orders.filter((o: any) => ["failed", "refunded"].includes(String(o.status || "").toLowerCase()));

  const handleCopy = async (orderId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOrderId(orderId);
      window.setTimeout(() => setCopiedOrderId((c) => (c === orderId ? null : c)), 1800);
    } catch {
      setCopiedOrderId(null);
    }
  };

  const toggleExpand = (orderId: string) => {
    setExpandedOrderId((prev) => (prev === orderId ? null : orderId));
  };

  const COL_COUNT = 7;

  return (
    <div className="space-y-6">
      <StudioSectionIntro
        kicker={t.kicker}
        title={t.title}
        description={t.desc}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StudioMetric label={t.metricTotal} value={String(orders.length)} description={t.metricTotalDesc} icon={ShoppingCart} tone="amber" />
        <StudioMetric label={t.metricPaid} value={String(paidOrders.length)} description={t.metricPaidDesc} icon={CircleDollarSign} tone="amber" />
        <StudioMetric label={t.metricDelivered} value={String(deliveredOrders.length)} description={t.metricDeliveredDesc} icon={PackageCheck} tone="amber" />
        <StudioMetric label={t.metricFailed} value={String(failedOrders.length)} description={t.metricFailedDesc} icon={AlertTriangle} tone="violet" />
      </section>

      <StudioCard>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{t.tableKicker}</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">{t.tableTitle}</h2>
          </div>
          <InfoHint content={t.tableHint} label={t.tableHintLabel} />
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <th className="pb-3 pr-4">{t.colOrder}</th>
                <th className="pb-3 pr-4">{t.colProduct}</th>
                <th className="pb-3 pr-4">{t.colCustomer}</th>
                <th className="pb-3 pr-4">{t.colStatus}</th>
                <th className="pb-3 pr-4">{t.colPayment}</th>
                <th className="pb-3 pr-4">{t.colDate}</th>
                <th className="pb-3 text-right">{t.colTotal}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => {
                const hasAccount = Boolean(order.deliveredAccountText);
                const isExpanded = expandedOrderId === order.id;

                return (
                  <>
                    <tr
                      key={order.id}
                      className="text-sm text-slate-300 transition-colors duration-150"
                      style={hasAccount ? { cursor: "pointer" } : undefined}
                      onClick={hasAccount ? () => toggleExpand(order.id) : undefined}
                    >
                      <td className="border-t border-white/8 py-4 pr-4 align-top">
                        <p className="font-semibold text-white">{order.orderCode}</p>
                        {order.failureReason && (
                          <p className="mt-1 max-w-[240px] text-xs leading-5 text-rose-300/80">
                            {order.failureReason}
                          </p>
                        )}
                        {hasAccount && (
                          <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: "rgb(52,211,153)" }}>
                            <KeyRound className="h-3 w-3" />
                            {isExpanded ? t.hideAccount : t.viewAccount}
                          </p>
                        )}
                      </td>
                      <td className="border-t border-white/8 py-4 pr-4 align-top">
                        <p className="font-medium text-white">{order.productName}</p>
                        <p className="mt-1 text-sm text-slate-500">{order.product?.sourceName || "-"}</p>
                      </td>
                      <td className="border-t border-white/8 py-4 pr-4 align-top">
                        <p>{order.customer?.telegramUsername || order.customer?.name || "-"}</p>
                        <p className="mt-1 text-sm text-slate-500">{order.customer?.telegramUserId || "-"}</p>
                      </td>
                      <td className="border-t border-white/8 py-4 pr-4 align-top">
                        <StudioBadge tone={statusTone(order.status)}>{formatStatusLabel(order.status)}</StudioBadge>
                      </td>
                      <td className="border-t border-white/8 py-4 pr-4 align-top">
                        <StudioBadge tone={String(order.paymentStatus || "").toLowerCase() === "paid" ? "success" : "neutral"}>
                          {formatStatusLabel(order.paymentStatus)}
                        </StudioBadge>
                        {["binance", "okx", "usdt_trc20"].includes(String(order.paymentTransaction?.provider || "").toLowerCase()) &&
                          String(order.paymentStatus || "").toLowerCase() !== "paid" && (
                          <div className="mt-3 space-y-2">
                            <p className="text-xs text-slate-500">{formatStatusLabel(order.paymentTransaction?.provider)} {t.manualUSDT}</p>
                            <StudioButton
                              disabled={confirmManualPaymentMutation.isPending}
                              size="sm"
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(t.confirmUSDTMsg(order.orderCode))) {
                                  confirmManualPaymentMutation.mutate(order.id);
                                }
                              }}
                            >
                              {t.confirmUSDT}
                            </StudioButton>
                          </div>
                        )}
                        {order.paymentTransaction?.cryptoTxHash && (
                          <div className="mt-3 rounded-[14px] border border-white/8 bg-white/[0.03] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">TX Hash</p>
                            <p className="mt-2 break-all text-xs text-slate-200">{order.paymentTransaction.cryptoTxHash}</p>
                          </div>
                        )}
                      </td>
                      <td className="border-t border-white/8 py-4 pr-4 align-top text-slate-400">{formatDate(order.createdAt)}</td>
                      <td className="border-t border-white/8 py-4 text-right align-top font-semibold text-white">{formatCurrency(order.totalSaleAmount)}</td>
                    </tr>

                    {hasAccount && isExpanded && (
                      <tr key={`${order.id}-expand`}>
                        <td colSpan={COL_COUNT} className="border-t-0 pb-3 pt-0">
                          <div
                            className="rounded-2xl p-4"
                            style={{ backgroundColor: "var(--inp)", border: "1px solid var(--bd)" }}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <KeyRound className="h-3.5 w-3.5 text-emerald-500" />
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-500">
                                  {t.deliveredAccount}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void handleCopy(order.id, order.deliveredAccountText); }}
                                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all duration-150 active:scale-95"
                                style={
                                  copiedOrderId === order.id
                                    ? { backgroundColor: "rgba(16,185,129,0.12)", color: "rgb(16,185,129)", border: "1px solid rgba(16,185,129,0.25)" }
                                    : { backgroundColor: "var(--surface)", color: "var(--tx-f)", border: "1px solid var(--bd)" }
                                }
                              >
                                {copiedOrderId === order.id
                                  ? <><Check className="h-3.5 w-3.5" /> {t.copied}</>
                                  : <><Copy className="h-3.5 w-3.5" /> {t.copy}</>
                                }
                              </button>
                            </div>
                            <pre
                              className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl px-4 py-3 text-[13px] leading-6"
                              style={{
                                backgroundColor: "var(--surface)",
                                color: "var(--tx)",
                                border: "1px solid var(--bd)",
                                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                              }}
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
      </StudioCard>
    </div>
  );
}
