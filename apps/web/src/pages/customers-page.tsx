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
  createdAt: string;
  connectedBotUsername: string | null;
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
                  {[t.colCustomer, t.colChatId, t.colBalance, t.colOrders, t.colLang, t.colCtv].map((h) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
