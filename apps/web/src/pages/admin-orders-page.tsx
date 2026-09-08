import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Search, X, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";

type OrderRow = {
  id: string;
  orderCode: string;
  status: string;
  productName: string;
  totalAmount: number;
  quantity: number;
  sellerName: string | null;
  shopName: string | null;
  createdAt: string;
};

type OrderDetail = OrderRow & {
  paymentStatus: string;
  unitPrice: number;
  deliveredAccountText: string | null;
  customerTelegramId: string | null;
  customerName: string | null;
  customerWalletBalance: number;
  refundedAmount: number;
  warrantyPolicy: string | null;
  warrantyClaims: Array<{
    id: string;
    claimNumber: number;
    status: string;
    customerMessage: string | null;
    createdAt: string;
  }>;
  sourceProviderKind: string | null;
  updatedAt: string;
};

type PaginatedOrders = {
  data: OrderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function statusTone(status: string) {
  if (status === "delivered") return "success" as const;
  if (status === "paid" || status === "processing_purchase") return "neutral" as const;
  if (status === "failed" || status === "refunded") return "warning" as const;
  return "neutral" as const;
}

function DetailDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [refundAmount, setRefundAmount] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const { data, isLoading } = useQuery<OrderDetail>({
    queryKey: ["admin", "order-detail", orderId],
    queryFn: () => api.get(`/admin/orders/${orderId}`).then((r) => r.data),
  });

  const refundMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(refundAmount);
      return (await api.post(`/admin/orders/${orderId}/refund`, {
        amount,
        note: refundNote.trim() || undefined,
      })).data as { amount: number; balanceAfter: number; remaining: number; isFullRefund: boolean };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "order-detail", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
      setRefundAmount("");
      setRefundNote("");
      showToast({
        tone: "success",
        message: `Đã hoàn ${formatCurrency(result.amount)} vào ví khách. Số dư mới: ${formatCurrency(result.balanceAfter)}.`,
      });
    },
    onError: (error: any) => showToast({
      tone: "error",
      message: error?.response?.data?.message || "Không thể hoàn tiền vào ví khách.",
    }),
  });

  const remainingRefund = data && data.paymentStatus === "paid" ? Math.max(0, data.totalAmount - data.refundedAmount) : 0;
  const parsedRefundAmount = Number(refundAmount);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-[#121a2e] border-l border-white/8 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold text-white">Chi tiết đơn hàng</p>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading && <p className="mt-6 text-sm text-slate-400">Đang tải...</p>}

        {data && (
          <div className="mt-6 space-y-5">
            <div className="rounded-[14px] border border-white/8 bg-[#18233c] p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Mã đơn</p>
              <p className="mt-1 font-mono text-base font-semibold text-white">{data.orderCode}</p>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone={statusTone(data.status)}>{formatStatusLabel(data.status)}</Badge>
                {data.sourceProviderKind && (
                  <span className="inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                    {data.sourceProviderKind}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Sản phẩm", value: data.productName },
                { label: "Số lượng", value: String(data.quantity) },
                { label: "Đơn giá", value: formatCurrency(data.unitPrice) },
                { label: "Tổng tiền", value: formatCurrency(data.totalAmount) },
                { label: "Seller", value: data.sellerName || "—" },
                { label: "Shop", value: data.shopName || "—" },
                { label: "Khách hàng", value: data.customerName || "—" },
                { label: "Telegram ID", value: data.customerTelegramId || "—" },
                { label: "Bảo hành", value: data.warrantyPolicy || "—" },
                { label: "Ngày tạo", value: formatDate(data.createdAt) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-[12px] border border-white/6 bg-[#121a2e] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 text-sm font-medium text-slate-200 break-words">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[14px] border border-amber-400/20 bg-amber-400/[0.06] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Hoàn tiền vào ví khách</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Ví hiện tại: {formatCurrency(data.customerWalletBalance)} · Đã hoàn: {formatCurrency(data.refundedAmount)} · Còn có thể hoàn: {formatCurrency(remainingRefund)}
                  </p>
                </div>
                <RotateCcw className="h-5 w-5 shrink-0 text-amber-300" />
              </div>

              {data.paymentStatus !== "paid" && data.status !== "refunded" ? (
                <p className="mt-3 rounded-[10px] bg-slate-400/10 px-3 py-2 text-xs font-semibold text-slate-300">
                  Chỉ có thể hoàn tiền cho đơn đã thanh toán.
                </p>
              ) : remainingRefund > 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      max={remainingRefund}
                      step={1}
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                      placeholder="Số tiền hoàn (VND)"
                      className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-[#121a2e] px-3 py-2 text-sm text-white outline-none focus:border-amber-300/40"
                    />
                    <button
                      type="button"
                      onClick={() => setRefundAmount(String(remainingRefund))}
                      className="rounded-[10px] border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
                    >
                      Hoàn đủ
                    </button>
                  </div>
                  <input
                    value={refundNote}
                    onChange={(event) => setRefundNote(event.target.value)}
                    maxLength={500}
                    placeholder="Lý do / ghi chú (không bắt buộc)"
                    className="w-full rounded-[10px] border border-white/10 bg-[#121a2e] px-3 py-2 text-sm text-white outline-none focus:border-amber-300/40"
                  />
                  <button
                    type="button"
                    disabled={refundMutation.isPending || !Number.isInteger(parsedRefundAmount) || parsedRefundAmount < 1 || parsedRefundAmount > remainingRefund}
                    onClick={() => {
                      if (window.confirm(`Xác nhận hoàn ${formatCurrency(parsedRefundAmount)} vào số dư ví của khách?`)) {
                        refundMutation.mutate();
                      }
                    }}
                    className="w-full rounded-[10px] bg-amber-400 px-3 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {refundMutation.isPending ? "Đang hoàn tiền..." : "Xác nhận hoàn vào ví"}
                  </button>
                </div>
              ) : (
                <p className="mt-3 rounded-[10px] bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-300">
                  Đơn này đã được hoàn đủ vào ví khách.
                </p>
              )}
            </div>

            {data.deliveredAccountText && (
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Tài khoản đã giao</p>
                <pre className="mt-2 rounded-[12px] border border-white/8 bg-[#18233c] p-3 text-xs text-emerald-300 whitespace-pre-wrap break-words">
                  {data.deliveredAccountText}
                </pre>
              </div>
            )}

            {data.warrantyClaims.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Yêu cầu bảo hành ({data.warrantyClaims.length})
                </p>
                <div className="mt-2 space-y-2">
                  {data.warrantyClaims.map((claim) => (
                    <div key={claim.id} className="rounded-[12px] border border-white/6 bg-[#18233c] p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-white">
                          Yêu cầu #{claim.claimNumber}
                        </p>
                        <Badge tone="neutral">{formatStatusLabel(claim.status)}</Badge>
                      </div>
                      {claim.customerMessage && (
                        <p className="mt-1 text-xs text-slate-400">{claim.customerMessage}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">{formatDate(claim.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function AdminOrdersPage() {
  const [urlParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => urlParams.get("search") || "");
  const [filterStatus, setFilterStatus] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const query = useQuery<PaginatedOrders>({
    queryKey: ["admin", "orders", { page, search, filterStatus }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      if (filterStatus) params.set("status", filterStatus.toUpperCase());
      return api.get(`/admin/orders?${params}`).then((r) => r.data);
    },
  });

  const orders = query.data?.data || [];
  const exportCurrentPage = () => {
    const rows = [["Mã đơn", "Sản phẩm", "Trạng thái", "Tổng tiền", "Seller", "Shop", "Ngày tạo"], ...orders.map((order) => [order.orderCode, order.productName, order.status, String(order.totalAmount), order.sellerName || "", order.shopName || "", order.createdAt])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `orders-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Quản trị hệ thống"
        title="Đơn hàng hệ thống"
        description="Toàn bộ đơn hàng trên nền tảng."
      />

      {selectedOrderId && (
        <DetailDrawer
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className="w-full rounded-[12px] border border-white/10 bg-[#18233c] py-2.5 pl-9 pr-4 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-300/40"
            placeholder="Tìm mã đơn hoặc tên sản phẩm..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="rounded-[12px] border border-white/10 bg-[#18233c] px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/40"
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
        >
          <option value="" className="bg-slate-950">Tất cả trạng thái</option>
          <option value="delivered" className="bg-slate-950">Delivered</option>
          <option value="paid" className="bg-slate-950">Paid</option>
          <option value="processing_purchase" className="bg-slate-950">Processing</option>
          <option value="failed" className="bg-slate-950">Failed</option>
          <option value="refunded" className="bg-slate-950">Refunded</option>
          <option value="awaiting_payment" className="bg-slate-950">Awaiting payment</option>
        </select>
        <Button variant="secondary" onClick={exportCurrentPage}><Download className="mr-2 size-4" /> Xuất CSV</Button>
      </div>

      <div className="flex flex-wrap gap-2">{[{ value: "", label: "Tất cả" }, { value: "failed", label: "Đơn lỗi" }, { value: "processing_purchase", label: "Đang xử lý" }, { value: "awaiting_payment", label: "Chờ thanh toán" }, { value: "refunded", label: "Đã hoàn" }].map((item) => <button key={item.value} onClick={() => { setFilterStatus(item.value); setPage(1); }} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${filterStatus === item.value ? "border-orange-500/40 bg-orange-500/15 text-orange-300" : "border-white/10 text-slate-400 hover:text-white"}`}>{item.label}</button>)}</div>

      <Card className="p-0 overflow-hidden">
        {orders.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">Không có đơn hàng nào.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/6">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mã đơn</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sản phẩm</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Trạng thái</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tổng tiền</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Seller</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ngày tạo</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-white/4 cursor-pointer transition hover:bg-white/[0.03]"
                    onClick={() => setSelectedOrderId(order.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{order.orderCode}</td>
                    <td className="px-4 py-3">
                      <p className="text-white">{order.productName}</p>
                      <p className="text-xs text-slate-500">×{order.quantity}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(order.status)}>{formatStatusLabel(order.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-white">
                      {formatCurrency(order.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{order.sellerName || "—"}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400">
                      {formatDate(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {query.data && query.data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {query.data.total} đơn · trang {query.data.page}/{query.data.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPage((p) => Math.min(query.data!.totalPages, p + 1))}
              disabled={page === query.data.totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
