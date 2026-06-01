import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Search, Users } from "lucide-react";
import { useState } from "react";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { StudioBadge } from "@/components/studio/studio-ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Quản lý khách hàng",
    title: "Danh sách khách",
    desc: "Quản lý khách hàng đã tương tác với bot. Đánh dấu CTV để họ thấy giá sĩ trên bot.",
    search: "Tìm theo tên hoặc username...",
    colCustomer: "Khách hàng",
    colChatId: "Chat ID",
    colBalance: "Số dư ví",
    colOrders: "Đơn",
    colCtv: "CTV",
    colLang: "Ngôn ngữ",
    ctvOn: "CTV",
    ctvOff: "Thường",
    emptyTitle: "Chưa có khách nào",
    emptyDesc: "Khi khách tương tác với bot, họ sẽ xuất hiện ở đây.",
    totalCustomers: (n: number) => `${n} khách`,
    errToggle: "Không thể cập nhật trạng thái CTV.",
  },
  en: {
    eyebrow: "Customer management",
    title: "Customer list",
    desc: "Manage customers who have interacted with your bot. Mark as CTV to show wholesale prices.",
    search: "Search by name or username...",
    colCustomer: "Customer",
    colChatId: "Chat ID",
    colBalance: "Wallet balance",
    colOrders: "Orders",
    colCtv: "CTV",
    colLang: "Language",
    ctvOn: "CTV",
    ctvOff: "Regular",
    emptyTitle: "No customers yet",
    emptyDesc: "When customers interact with your bot, they will appear here.",
    totalCustomers: (n: number) => `${n} customers`,
    errToggle: "Could not update CTV status.",
  },
  th: {
    eyebrow: "จัดการลูกค้า",
    title: "รายชื่อลูกค้า",
    desc: "จัดการลูกค้าที่โต้ตอบกับบอต กำหนด CTV เพื่อแสดงราคาส่ง",
    search: "ค้นหาตามชื่อหรือ username...",
    colCustomer: "ลูกค้า",
    colChatId: "Chat ID",
    colBalance: "ยอดเงินในกระเป๋า",
    colOrders: "คำสั่งซื้อ",
    colCtv: "CTV",
    colLang: "ภาษา",
    ctvOn: "CTV",
    ctvOff: "ปกติ",
    emptyTitle: "ยังไม่มีลูกค้า",
    emptyDesc: "เมื่อลูกค้าโต้ตอบกับบอต พวกเขาจะปรากฏที่นี่",
    totalCustomers: (n: number) => `${n} คน`,
    errToggle: "ไม่สามารถอัปเดตสถานะ CTV ได้",
  },
};

interface Customer {
  id: string;
  telegramChatId: string;
  username: string | null;
  displayName: string;
  preferredLanguage: string;
  isCtv: boolean;
  walletBalance: number;
  commissionBalance: number;
  orderCount: number;
  totalSpent: number;
  createdAt: string;
  connectedBotUsername: string | null;
}

interface CustomerOrdersResponse {
  customer: {
    id: string;
    telegramUserId: string;
    telegramUsername: string | null;
    displayName: string;
    createdAt: string;
  };
  orders: Array<{
    id: string;
    orderCode: string;
    productName: string;
    quantity: number;
    salePrice: number;
    totalSaleAmount: number;
    totalSourceAmount: number;
    profit: number;
    status: string;
    paymentStatus: string;
    createdAt: string;
    paidAt: string | null;
    deliveredAt: string | null;
    hasDeliveredText: boolean;
  }>;
  total: number;
  summary: {
    totalSpent: number;
    totalCost: number;
    totalProfit: number;
  };
}

export function CustomersPage() {
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [keyword, setKeyword] = useState("");

  const query = useQuery<Customer[]>({
    queryKey: ["customers"],
    queryFn: async () => (await api.get("/customers")).data,
  });

  const ctvMutation = useMutation({
    mutationFn: async ({ id, isCtv }: { id: string; isCtv: boolean }) =>
      api.put(`/customers/${id}/ctv`, { isCtv }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: () => {
      showToast({ tone: "error", message: t.errToggle });
    },
  });

  const customers = query.data || [];
  const filtered = customers.filter((c) => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return true;
    return (
      c.displayName.toLowerCase().includes(kw) ||
      (c.username?.toLowerCase().includes(kw) ?? false) ||
      c.telegramChatId.includes(kw)
    );
  });

  const [historyCustomerId, setHistoryCustomerId] = useState<string | null>(null);
  const historyQuery = useQuery<CustomerOrdersResponse>({
    queryKey: ["customer-orders", historyCustomerId],
    enabled: Boolean(historyCustomerId),
    queryFn: async () => (await api.get(`/customers/${historyCustomerId}/orders`, { params: { limit: 100 } })).data,
  });

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc}
        gradient="emerald"
        stats={[
          {
            icon: Users,
            label: t.totalCustomers(customers.length),
            value: String(customers.length),
            iconCls: "text-emerald-400",
            bgCls: "bg-emerald-500/15",
          },
          {
            icon: Crown,
            label: "CTV",
            value: String(customers.filter((c) => c.isCtv).length),
            iconCls: "text-purple-400",
            bgCls: "bg-purple-500/15",
          },
        ]}
      />

      <div
        className="rounded-[20px] overflow-hidden"
        style={{ border: "1px solid var(--bd)", background: "var(--surface)" }}
      >
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--tx-f)" }} />
            <input
              className="w-full rounded-[12px] pl-9 pr-4 py-2.5 text-sm outline-none"
              style={{ background: "var(--inp)", color: "var(--tx)", border: "1px solid var(--bd)" }}
              placeholder={t.search}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>

        {query.isLoading ? (
          <div className="px-5 py-8 text-sm text-center" style={{ color: "var(--tx-m)" }}>...</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.emptyTitle}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>{t.emptyDesc}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                  {[t.colCustomer, t.colChatId, t.colBalance, t.colOrders, "Tổng chi", t.colLang, t.colCtv, "Lịch sử"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em]"
                      style={{ color: "var(--tx-f)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr
                    key={customer.id}
                    style={{ borderBottom: "1px solid var(--bd)" }}
                    className="transition-colors hover:bg-[rgba(255,255,255,0.02)]"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium" style={{ color: "var(--tx)" }}>{customer.displayName}</p>
                        {customer.username && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--tx-f)" }}>@{customer.username}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs" style={{ color: "var(--tx-m)" }}>{customer.telegramChatId}</span>
                      {customer.connectedBotUsername && (
                        <p className="text-xs mt-0.5 font-medium" style={{ color: "rgb(99,179,237)" }}>@{customer.connectedBotUsername}</p>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--tx)" }}>
                      {formatCurrency(customer.walletBalance)}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--tx-m)" }}>
                      {customer.orderCount}
                    </td>
                    <td className="px-4 py-3 font-semibold" style={{ color: "var(--tx)" }}>
                      {formatCurrency(customer.totalSpent ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      <StudioBadge tone="neutral">{customer.preferredLanguage.toUpperCase()}</StudioBadge>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => ctvMutation.mutate({ id: customer.id, isCtv: !customer.isCtv })}
                        disabled={ctvMutation.isPending}
                        className="rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all"
                        style={{
                          background: customer.isCtv ? "rgba(139,92,246,0.15)" : "var(--inp)",
                          color: customer.isCtv ? "rgb(167,139,250)" : "var(--tx-f)",
                          border: customer.isCtv ? "1px solid rgba(139,92,246,0.3)" : "1px solid var(--bd)",
                        }}
                      >
                        {customer.isCtv ? t.ctvOn : t.ctvOff}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setHistoryCustomerId(customer.id)}
                        className="rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
                        style={{
                          background: "rgba(56,189,248,0.12)",
                          color: "rgb(56,189,248)",
                          border: "1px solid rgba(56,189,248,0.3)",
                        }}
                      >
                        🕐 Lịch sử
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historyCustomerId && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setHistoryCustomerId(null)}
        >
          <div
            className="relative flex w-full flex-col rounded-2xl overflow-hidden"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--bd)",
              maxWidth: 900,
              maxHeight: "85vh",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex shrink-0 items-center justify-between gap-4 px-5 py-4"
              style={{ borderBottom: "1px solid var(--bd)" }}
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
                  Lịch sử mua hàng
                </p>
                <p className="text-sm font-black" style={{ color: "var(--tx)" }}>
                  {historyQuery.data?.customer.displayName ?? "Đang tải..."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryCustomerId(null)}
                className="rounded-xl px-3 py-1.5 text-[11px] font-bold"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
              >
                Đóng
              </button>
            </div>

            {historyQuery.isLoading ? (
              <div className="py-10 text-center text-sm" style={{ color: "var(--tx-f)" }}>Đang tải...</div>
            ) : historyQuery.data ? (
              <>
                <div className="grid grid-cols-4 gap-2 border-b p-4" style={{ borderColor: "var(--bd)" }}>
                  <StatBox label="Tổng đơn" value={String(historyQuery.data.total)} color="var(--tx)" />
                  <StatBox label="Đã chi" value={formatCurrency(historyQuery.data.summary.totalSpent)} color="rgb(52,211,153)" />
                  <StatBox label="Tổng vốn" value={formatCurrency(historyQuery.data.summary.totalCost)} color="rgb(249,115,22)" />
                  <StatBox label="Lãi" value={formatCurrency(historyQuery.data.summary.totalProfit)} color="rgb(168,85,247)" />
                </div>
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0" style={{ background: "var(--surface)" }}>
                      <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                        {["Ngày", "Mã đơn", "Sản phẩm", "SL", "Tiền", "Lãi", "Trạng thái"].map((h) => (
                          <th key={h} className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-widest"
                              style={{ color: "var(--tx-f)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historyQuery.data.orders.map((o) => (
                        <tr key={o.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                          <td className="px-4 py-2 text-[11px]" style={{ color: "var(--tx-m)" }}>
                            {new Date(o.createdAt).toLocaleString("vi-VN")}
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px]" style={{ color: "var(--tx)" }}>
                            {o.orderCode}
                          </td>
                          <td className="px-4 py-2 text-[11px]" style={{ color: "var(--tx)" }}>
                            {o.productName}
                          </td>
                          <td className="px-4 py-2 text-[11px]" style={{ color: "var(--tx-m)" }}>
                            {o.quantity}
                          </td>
                          <td className="px-4 py-2 font-semibold text-[11px]" style={{ color: "var(--tx)" }}>
                            {formatCurrency(o.totalSaleAmount)}
                          </td>
                          <td className="px-4 py-2 font-semibold text-[11px]" style={{ color: o.profit > 0 ? "rgb(52,211,153)" : "var(--tx-f)" }}>
                            {formatCurrency(o.profit)}
                          </td>
                          <td className="px-4 py-2 text-[11px]">
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                              style={{
                                background: o.status === "DELIVERED" ? "rgba(52,211,153,0.15)" : "rgba(249,115,22,0.15)",
                                color: o.status === "DELIVERED" ? "rgb(52,211,153)" : "rgb(249,115,22)",
                              }}
                            >
                              {o.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {historyQuery.data.orders.length === 0 && (
                    <p className="py-8 text-center text-sm" style={{ color: "var(--tx-f)" }}>
                      Khách chưa có đơn nào.
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-2" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
      <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
      <p className="mt-0.5 text-[14px] font-black" style={{ color }}>{value}</p>
    </div>
  );
}
