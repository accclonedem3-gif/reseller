import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, History, Package, RefreshCw, Users, Wallet } from "lucide-react";

import { StudioBadge, StudioButton, StudioCard } from "@/components/studio/studio-ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    modalHistory: "Lịch sử nạp",
    modalEmpty: "Chưa có lần nạp nào",
    ultraWallet: "Ví nguồn ULTRA",
    connectedWith: "Kết nối với",
    tableTitle: "Ví khách dùng bot",
    wallets: (n: number) => `${n} ví`,
    total: "Tổng",
    sourceWallet: "Ví nguồn",
    refreshing: "Đang tải...",
    refresh: "Làm mới",
    emptyTitle: "Chưa có khách nào nạp ví",
    emptyDesc: "Ví sẽ xuất hiện khi khách nạp tiền qua bot",
    colUsername: "Username TG",
    colLastTopup: "Lần nạp gần nhất",
    colBalance: "Số dư hiện tại",
    colAction: "Hành động",
    lastTopup: "Nạp gần nhất:",
    historyBtn: "Lịch sử",
    viewHistory: "Xem lịch sử nạp",
  },
  en: {
    modalHistory: "Topup history",
    modalEmpty: "No topups yet",
    ultraWallet: "ULTRA source wallet",
    connectedWith: "Connected to",
    tableTitle: "Customer bot wallets",
    wallets: (n: number) => `${n} wallets`,
    total: "Total",
    sourceWallet: "Source wallet",
    refreshing: "Loading...",
    refresh: "Refresh",
    emptyTitle: "No customers have topped up yet",
    emptyDesc: "Wallets will appear when customers top up through the bot",
    colUsername: "TG Username",
    colLastTopup: "Last top-up",
    colBalance: "Current balance",
    colAction: "Actions",
    lastTopup: "Last topup:",
    historyBtn: "History",
    viewHistory: "View topup history",
  },
  th: {
    modalHistory: "ประวัติการเติมเงิน",
    modalEmpty: "ยังไม่มีการเติมเงิน",
    ultraWallet: "กระเป๋าเงินแหล่ง ULTRA",
    connectedWith: "เชื่อมต่อกับ",
    tableTitle: "กระเป๋าเงินลูกค้าบอท",
    wallets: (n: number) => `${n} กระเป๋า`,
    total: "รวม",
    sourceWallet: "กระเป๋าแหล่ง",
    refreshing: "กำลังโหลด...",
    refresh: "รีเฟรช",
    emptyTitle: "ยังไม่มีลูกค้าเติมเงิน",
    emptyDesc: "กระเป๋าเงินจะปรากฏเมื่อลูกค้าเติมเงินผ่านบอท",
    colUsername: "ชื่อผู้ใช้ TG",
    colLastTopup: "เติมเงินล่าสุด",
    colBalance: "ยอดคงเหลือ",
    colAction: "การดำเนินการ",
    lastTopup: "เติมล่าสุด:",
    historyBtn: "ประวัติ",
    viewHistory: "ดูประวัติการเติมเงิน",
  },
};

function TopupHistoryModal({
  customerId,
  displayName,
  onClose,
  t,
}: {
  customerId: string;
  displayName: string;
  onClose: () => void;
  t: typeof T["vi"];
}) {
  const topupsQuery = useQuery({
    queryKey: ["wallet", "customer-topups", customerId],
    queryFn: async () => (await api.get(`/wallet/customer-wallets/${customerId}/topups`)).data,
  });

  const topups = topupsQuery.data || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--bd)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-violet-500" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.modalHistory}</p>
              <p className="text-sm font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>{displayName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-lg font-bold transition hover:opacity-60"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
          >
            ×
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {topupsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl" style={{ backgroundColor: "var(--inp)" }} />
              ))}
            </div>
          ) : topups.length === 0 ? (
            <div className="py-10 text-center">
              <Package className="mx-auto mb-3 h-8 w-8 opacity-20" style={{ color: "var(--tx)" }} />
              <p className="text-sm opacity-40" style={{ color: "var(--tx)" }}>{t.modalEmpty}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topups.map((topup: any) => (
                <div
                  key={topup.id}
                  className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                  style={{ backgroundColor: "var(--inp)", border: "1px solid var(--bd)" }}
                >
                  <div>
                    <p className="text-sm font-black text-emerald-500">+{formatCurrency(topup.amount)}</p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{formatDate(topup.createdAt)}</p>
                  </div>
                  <StudioBadge tone={topup.status === "PAID" ? "success" : "neutral"}>
                    {formatStatusLabel(topup.status)}
                  </StudioBadge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function WalletPage() {
  const { lang } = useLang();
  const t = T[lang];

  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null);

  const sourceWalletQuery = useQuery({
    queryKey: ["wallet", "source-balance"],
    queryFn: async () => (await api.get("/wallet/source-balance")).data,
    refetchInterval: 15000,
    retry: false,
  });
  const sourceConnectionQuery = useQuery({
    queryKey: ["seller-source-connection"],
    queryFn: async () => (await api.get("/seller/source-connection")).data,
    refetchInterval: 30000,
    retry: false,
  });
  const customerWalletsQuery = useQuery({
    queryKey: ["wallet", "customer-wallets"],
    queryFn: async () => (await api.get("/wallet/customer-wallets")).data,
    refetchInterval: 30000,
  });

  const wallets: any[] = customerWalletsQuery.data || [];
  const totalCustomerBalance = wallets.reduce((s: number, w: any) => s + Number(w.balance || 0), 0);

  const sourceBalance =
    sourceWalletQuery.data?.walletCurrency === "VND"
      ? formatCurrency(Number(sourceWalletQuery.data?.balance || 0))
      : sourceWalletQuery.data?.balanceText || "—";

  const internalConnection = sourceConnectionQuery.data?.status === "active" ? sourceConnectionQuery.data : null;

  return (
    <div className="space-y-4">
      {internalConnection && (
        <StudioCard>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.ultraWallet}</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-emerald-400">
                {formatCurrency(internalConnection.balance ?? 0)}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--tx-f)" }}>
                {t.connectedWith} <span className="font-semibold" style={{ color: "var(--tx)" }}>{internalConnection.upstreamShop?.name}</span>
              </p>
            </div>
            <Package className="h-8 w-8 opacity-20" style={{ color: "var(--tx)" }} />
          </div>
        </StudioCard>
      )}
      <StudioCard className="overflow-hidden p-0">
        {/* Header */}
        <div className="border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--bd)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                {t.tableTitle}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  <span className="font-black" style={{ color: "var(--tx)" }}>{wallets.length}</span> {t.wallets(wallets.length).split(" ")[1]}
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  {t.total} <span className="font-black text-emerald-500">{formatCurrency(totalCustomerBalance)}</span>
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  {t.sourceWallet}{" "}
                  <span className="font-black text-amber-500">
                    {sourceWalletQuery.isLoading ? "…" : sourceBalance}
                  </span>
                </span>
              </div>
            </div>
            <StudioButton
              variant="secondary"
              disabled={customerWalletsQuery.isFetching}
              onClick={() => void customerWalletsQuery.refetch()}
            >
              <RefreshCw className="h-4 w-4" />
              {customerWalletsQuery.isFetching ? t.refreshing : t.refresh}
            </StudioButton>
          </div>
        </div>

        {/* Table */}
        {customerWalletsQuery.isLoading ? (
          <div className="space-y-0 px-5 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[56px] animate-pulse border-b last:border-0" style={{ borderColor: "var(--bd)" }} />
            ))}
          </div>
        ) : wallets.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-[20px]" style={{ backgroundColor: "var(--inp)" }}>
              <Users className="h-7 w-7 opacity-30" style={{ color: "var(--tx)" }} />
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
            {/* Desktop table */}
            <table className="hidden w-full text-sm lg:table" style={{ tableLayout: "fixed", minWidth: "720px" }}>
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ width: "220px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "160px" }} />
                <col style={{ width: "100px" }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}>
                  <th className="py-2.5 pl-5 pr-2 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>#</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colUsername}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colLastTopup}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colBalance}</th>
                  <th className="py-2.5 pl-3 pr-5 text-center text-[10px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--tx-f)" }}>{t.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((w: any, index: number) => {
                  const displayName = w.telegramUsername ? `@${w.telegramUsername}` : w.name || w.telegramUserId || "—";
                  return (
                    <tr
                      key={w.id}
                      className="group border-b last:border-0 transition-colors duration-150"
                      style={{ borderColor: "var(--bd)" }}
                    >
                      <td className="py-3 pl-5 pr-2 text-center text-xs font-bold tabular-nums" style={{ color: "var(--tx-f)" }}>{index + 1}</td>

                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black"
                            style={{ backgroundColor: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
                          >
                            {(w.telegramUsername || w.name || "?")[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-black tracking-tight" style={{ color: "var(--tx)" }}>
                              {displayName}
                            </p>
                            <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--tx-f)" }}>
                              ID: {w.telegramUserId || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-center">
                        {w.lastTopupAt ? (
                          <>
                            <p className="text-[13px] font-semibold text-emerald-500">+{formatCurrency(w.lastTopupAmount)}</p>
                            <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
                              <Clock className="h-3 w-3" />
                              {formatDate(w.lastTopupAt)}
                            </p>
                          </>
                        ) : (
                          <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>—</p>
                        )}
                      </td>

                      <td className="px-3 py-3 text-center">
                        <p className="text-sm font-black tabular-nums text-emerald-500">{formatCurrency(w.balance)}</p>
                      </td>

                      <td className="py-3 pl-3 pr-5 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedCustomer({ id: w.customerId, name: displayName })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg opacity-30 transition-all duration-150 hover:scale-110 hover:opacity-100 active:scale-95 group-hover:opacity-100 mx-auto"
                          style={{ backgroundColor: "rgba(139,92,246,0.15)", color: "rgb(139,92,246)" }}
                          title={t.viewHistory}
                        >
                          <History className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile list */}
            <div className="lg:hidden">
              {wallets.map((w: any) => {
                const displayName = w.telegramUsername ? `@${w.telegramUsername}` : w.name || w.telegramUserId || "—";
                return (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-3 border-b px-4 py-3.5 last:border-0"
                    style={{ borderColor: "var(--bd)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-black tracking-tight" style={{ color: "var(--tx)" }}>{displayName}</p>
                      {w.lastTopupAt && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--tx-f)" }}>{t.lastTopup} {formatDate(w.lastTopupAt)}</p>
                      )}
                      <p className="mt-1 text-sm font-black text-emerald-500">{formatCurrency(w.balance)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedCustomer({ id: w.customerId, name: displayName })}
                      className="rounded-xl px-3 py-1.5 text-[11px] font-bold uppercase"
                      style={{ backgroundColor: "rgba(139,92,246,0.15)", color: "rgb(139,92,246)" }}
                    >
                      {t.historyBtn}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </StudioCard>

      {selectedCustomer && (
        <TopupHistoryModal
          customerId={selectedCustomer.id}
          displayName={selectedCustomer.name}
          onClose={() => setSelectedCustomer(null)}
          t={t}
        />
      )}
    </div>
  );
}
