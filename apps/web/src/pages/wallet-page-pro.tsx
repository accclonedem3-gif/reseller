import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Download, Gift, Handshake, Plus, RefreshCw, Search, Trash2, TrendingUp, Users, X } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useLang } from "@/lib/lang";

type WalletItem = {
  id: string;
  customerId: string;
  balance: number;
  commissionBalance: number;
  balanceUsdt: number;
  telegramUsername: string | null;
  telegramUserId: string;
  telegramChatId: string;
  isApiConnected: boolean;
  name: string | null;
  isCtv: boolean;
  blacklisted: boolean;
  discountPercent: number;
  lastTopupAt: string | null;
  lastTopupAmount: number | null;
  totalSpent: number;
  orderCount: number;
};

type CustomerOrdersResp = {
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
  summary: { totalSpent: number; totalCost: number; totalProfit: number };
};

type LeaderboardRow = {
  rank: number;
  id: string;
  name: string;
  telegramUsername: string | null;
  downlineCount: number;
  totalCommission: number;
};

function displayName(w: WalletItem) {
  return w.telegramUsername ? `@${w.telegramUsername}` : w.name || w.telegramUserId || "—";
}

function avatarInitials(w: WalletItem) {
  const raw = w.telegramUsername || w.name || w.telegramUserId || "?";
  const clean = raw.replace(/^@/, "");
  return clean.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "rgb(139,92,246)", "rgb(59,130,246)", "rgb(16,185,129)",
  "rgb(245,158,11)", "rgb(239,68,68)", "rgb(236,72,153)",
];
function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, activeColor = "rgb(139,92,246)" }: {
  value: boolean; onChange: (v: boolean) => void; activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="relative h-5 w-9 shrink-0 overflow-hidden rounded-full transition-colors"
      style={{ background: value ? activeColor : "var(--bd)" }}
    >
      <span
        className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

// ─── CustomerPopup ────────────────────────────────────────────────────────────

function CustomerPopup({ customer, onClose, defaultTopup }: {
  customer: WalletItem; onClose: () => void; defaultTopup?: boolean;
}) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [isCtv, setIsCtv] = useState(customer.isCtv);
  const [blacklisted, setBlacklisted] = useState(customer.blacklisted);
  const [discountPercent, setDiscountPercent] = useState(customer.discountPercent);
  const [action, setAction] = useState(defaultTopup ? "topup" : "topup");
  const [currency, setCurrency] = useState("VND");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const name = displayName(customer);

  async function handleSaveAndClose() {
    setSaving(true);
    const calls: Promise<any>[] = [];

    if (isCtv !== customer.isCtv)
      calls.push(api.put(`/customers/${customer.customerId}/ctv`, { isCtv }));
    if (blacklisted !== customer.blacklisted)
      calls.push(api.put(`/customers/${customer.customerId}/blacklist`, { blacklisted }));
    if (discountPercent !== customer.discountPercent)
      calls.push(api.put(`/customers/${customer.customerId}/discount`, { discountPercent }));

    const n = Number(amount);
    if (amount && n > 0)
      calls.push(api.put(`/wallet/customer-wallets/${customer.customerId}/adjust`, { action, amount: n, currency }));

    try {
      if (calls.length > 0) await Promise.all(calls);
      await queryClient.invalidateQueries({ queryKey: ["wallet", "customer-wallets"] });
      showToast({ message: calls.length > 0 ? "Đã lưu thay đổi" : "Không có thay đổi", tone: "success" });
      onClose();
    } catch (err: any) {
      showToast({ message: err?.response?.data?.message || "Lỗi khi lưu", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const selBtn = (active: boolean) => ({
    background: active ? "rgba(139,92,246,0.2)" : "var(--inp)",
    border: `1px solid ${active ? "rgba(139,92,246,0.4)" : "var(--bd)"}`,
    color: active ? "rgb(167,139,250)" : "var(--tx-f)",
  });

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[81] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-black text-white" style={{ background: avatarColor(customer.customerId) }}>
              {avatarInitials(customer)}
            </div>
            <div>
              <p className="text-base font-black" style={{ color: "var(--tx)" }}>{name}</p>
              <p className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--tx-f)" }}>ID: {customer.telegramChatId}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 transition hover:opacity-70" style={{ color: "var(--tx-f)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Balances */}
        <div className="grid grid-cols-2 gap-4 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>VND</p>
            <p className="mt-1 text-xl font-black tabular-nums text-emerald-400">{formatCurrency(customer.balance)}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>USD</p>
            <p className="mt-1 text-xl font-black tabular-nums text-sky-400">${customer.balanceUsdt.toFixed(2)}</p>
          </div>
        </div>

        {/* CTV / Blacklist / Discount */}
        <div className="space-y-3 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Toggle value={isCtv} onChange={setIsCtv} activeColor="rgb(139,92,246)" />
              <span className="text-[12px] font-semibold" style={{ color: "var(--tx)" }}>CTV</span>
            </div>
            <div className="flex items-center gap-2">
              <Toggle value={blacklisted} onChange={setBlacklisted} activeColor="rgb(239,68,68)" />
              <span className="text-[12px] font-semibold" style={{ color: "var(--tx)" }}>Blacklist</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold" style={{ color: "var(--tx-f)" }}>Giảm giá</span>
            <input
              type="number" min="0" max="100" step="1"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
              className="w-16 rounded-lg px-2 py-1.5 text-center text-[13px] font-bold outline-none"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
            />
            <span className="text-[12px]" style={{ color: "var(--tx-f)" }}>%</span>
          </div>
        </div>

        {/* Adjust form */}
        <div className="space-y-3 px-5 py-4">
          <div className="flex items-center gap-2">
            {(["topup", "deduct", "set"] as const).map((a) => (
              <button key={a} type="button" onClick={() => setAction(a)}
                className="rounded-lg px-3 py-1.5 text-[11px] font-black uppercase transition hover:opacity-80"
                style={selBtn(action === a)}>
                {a === "topup" ? "Nạp" : a === "deduct" ? "Trừ" : "Set"}
              </button>
            ))}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="ml-auto rounded-lg px-2 py-1.5 text-[12px] outline-none"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}>
              <option value="VND">VND</option>
              <option value="USDT">USDT</option>
            </select>
          </div>
          <input type="number" min="0" step={currency === "USDT" ? "0.0001" : "1000"}
            placeholder={currency === "USDT" ? "Ví dụ: 10.5" : "Ví dụ: 100000"}
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
          />
          <button type="button" disabled={saving} onClick={handleSaveAndClose}
            className="w-full rounded-xl py-2.5 text-[13px] font-black uppercase tracking-wide transition hover:opacity-80 disabled:opacity-40"
            style={{ background: "var(--primary)", color: "#fff" }}>
            {saving ? "Đang lưu..." : "Lưu & Đóng"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── WalletPage ───────────────────────────────────────────────────────────────

type FilterTab = "all" | "balance" | "ctv";
type PageTab = "users" | "top-buyers" | "top-referrers";

type Promotion = {
  id: string;
  bonusPercent: number;
  startAt: string;
  endAt: string;
  status: "upcoming" | "active" | "ended";
};

function fmtDate(d: string) {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

export function WalletPage() {
  const { lang } = useLang();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [pageTab, setPageTab] = useState<PageTab>("users");
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [selectedCustomer, setSelectedCustomer] = useState<WalletItem | null>(null);
  const [historyCustomerId, setHistoryCustomerId] = useState<string | null>(null);
  const [defaultTopup, setDefaultTopup] = useState(false);
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [promoForm, setPromoForm] = useState({ bonusPercent: "", startAt: "", endAt: "" });

  const customerWalletsQuery = useQuery({
    queryKey: ["wallet", "customer-wallets"],
    queryFn: async () => (await api.get("/wallet/customer-wallets")).data,
    refetchInterval: 30000,
  });

  const promotionsQuery = useQuery({
    queryKey: ["wallet", "promotions"],
    queryFn: async () => (await api.get<Promotion[]>("/wallet/promotions")).data,
  });

  const topBuyersQuery = useQuery({
    queryKey: ["reports", "top-buyers"],
    queryFn: async () => (await api.get("/reports/top-buyers")).data,
  });

  const referrersQuery = useQuery({
    queryKey: ["affiliate-leaderboard"],
    queryFn: async () => (await api.get("/affiliate/leaderboard")).data as LeaderboardRow[],
  });

  const historyQuery = useQuery<CustomerOrdersResp>({
    queryKey: ["customer-orders", historyCustomerId],
    enabled: Boolean(historyCustomerId),
    queryFn: async () => (await api.get(`/customers/${historyCustomerId}/orders`, { params: { limit: 100 } })).data,
  });

  const createPromoMutation = useMutation({
    mutationFn: (data: { bonusPercent: number; startAt: string; endAt: string }) =>
      api.post("/wallet/promotions", data).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet", "promotions"] });
      setPromoForm({ bonusPercent: "", startAt: "", endAt: "" });
      setShowPromoForm(false);
      showToast({ tone: "success", message: "Đã tạo chương trình khuyến mãi." });
    },
    onError: () => showToast({ tone: "error", message: "Không thể tạo chương trình." }),
  });

  const deletePromoMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/wallet/promotions/${id}`).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet", "promotions"] });
      showToast({ tone: "success", message: "Đã xóa chương trình khuyến mãi." });
    },
    onError: () => showToast({ tone: "error", message: "Không thể xóa." }),
  });

  const wallets: WalletItem[] = customerWalletsQuery.data?.items || [];

  const filtered = wallets.filter((w) => {
    if (filterTab === "balance" && w.balance <= 0) return false;
    if (filterTab === "ctv" && !w.isCtv) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${w.telegramUsername}${w.name}${w.telegramChatId}${w.telegramUserId}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const withBalance = wallets.filter((w) => w.balance > 0).length;
  const ctvCount = wallets.filter((w) => w.isCtv).length;
  const referrersCount = referrersQuery.data?.length ?? 0;

  const filterTabBtn = (key: FilterTab, label: string, dot?: string) => {
    const active = filterTab === key;
    return (
      <button key={key} type="button" onClick={() => setFilterTab(key)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-black transition"
        style={{ background: active ? "rgba(249,115,22,0.15)" : "transparent", border: `1px solid ${active ? "rgba(249,115,22,0.4)" : "transparent"}`, color: active ? "rgb(249,115,22)" : "var(--tx-f)" }}>
        {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        {label}
      </button>
    );
  };

  const statCard = (label: string, value: string | number, desc: string, color: string, borderColor: string) => (
    <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: `3px solid ${borderColor}` }}>
      <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
      <p className="mt-2 text-3xl font-black tabular-nums" style={{ color }}>{value}</p>
      <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>{desc}</p>
    </div>
  );

  const buyers: any[] = topBuyersQuery.data || [];
  const totalBuyerSpent = buyers.reduce((s: number, b: any) => s + Number(b.totalSpent || 0), 0);

  return (
    <div className="space-y-4">
      {selectedCustomer && (
        <CustomerPopup customer={selectedCustomer} defaultTopup={defaultTopup} onClose={() => { setSelectedCustomer(null); setDefaultTopup(false); }} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "rgb(249,115,22)" }}>Quản lý người dùng bot</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--tx-f)" }}>Số dư tài khoản và danh sách người dùng truy cập bot</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
            <Download className="h-3.5 w-3.5" /> Xuất danh sách
          </button>
          <button type="button" onClick={() => { setDefaultTopup(true); if (wallets[0]) setSelectedCustomer(wallets[0]); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "var(--primary)", color: "#fff" }}>
            <Plus className="h-3.5 w-3.5" /> Nạp tiền
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCard("Tổng người dùng", wallets.length, "Truy cập bot", "var(--tx)", "rgb(52,211,153)")}
        {statCard("Có số dư", withBalance, "Ví đang có tiền", "rgb(56,189,248)", "rgb(56,189,248)")}
        {statCard("CTV / Đại lý", ctvCount, "Tài khoản CTV", "rgb(245,158,11)", "rgb(245,158,11)")}
        {statCard("Top giới thiệu", referrersCount, "Người giới thiệu có cấp dưới", "rgb(167,139,250)", "rgb(139,92,246)")}
      </div>

      {/* Page tabs */}
      <div className="flex items-center gap-3">
        {([
          { key: "users" as PageTab, label: "Tất cả người dùng" },
          { key: "top-buyers" as PageTab, label: "Top người mua" },
          { key: "top-referrers" as PageTab, label: "Top giới thiệu" },
        ] as const).map(({ key, label }) => {
          const active = pageTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPageTab(key)}
              className="rounded-full px-5 py-2 text-[13px] font-black transition"
              style={active
                ? { border: "1.5px solid rgb(249,115,22)", color: "rgb(249,115,22)", background: "transparent" }
                : { border: "1.5px solid transparent", color: "var(--tx-f)", background: "transparent" }
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab: Tất cả người dùng */}
      {pageTab === "users" && (
        <>
          {/* Wallet Promotions */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4" style={{ color: "rgb(249,115,22)" }} />
                <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Chương trình khuyến mãi nạp ví</h2>
                {promotionsQuery.data?.some((p) => p.status === "active") && (
                  <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black animate-pulse" style={{ background: "rgba(249,115,22,0.15)", color: "rgb(249,115,22)" }}>
                    Đang chạy
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowPromoForm((v) => !v)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-black transition hover:opacity-80"
                style={{ background: showPromoForm ? "rgba(249,115,22,0.15)" : "var(--inp)", border: `1px solid ${showPromoForm ? "rgba(249,115,22,0.4)" : "var(--bd)"}`, color: showPromoForm ? "rgb(249,115,22)" : "var(--tx-f)" }}
              >
                <Plus className="h-3.5 w-3.5" /> Tạo chương trình
              </button>
            </div>

            {showPromoForm && (
              <div className="px-5 py-4 flex flex-wrap items-end gap-3" style={{ borderBottom: "1px solid var(--bd)", background: "rgba(249,115,22,0.04)" }}>
                <div>
                  <p className="mb-1 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Bonus %</p>
                  <input
                    type="number" min="0.01" max="100" step="0.01" placeholder="10"
                    value={promoForm.bonusPercent}
                    onChange={(e) => setPromoForm((f) => ({ ...f, bonusPercent: e.target.value }))}
                    className="w-24 rounded-xl px-3 py-2 text-[13px] font-black outline-none"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                  />
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Bắt đầu</p>
                  <input
                    type="datetime-local"
                    value={promoForm.startAt}
                    onChange={(e) => setPromoForm((f) => ({ ...f, startAt: e.target.value }))}
                    className="rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                  />
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Kết thúc</p>
                  <input
                    type="datetime-local"
                    value={promoForm.endAt}
                    onChange={(e) => setPromoForm((f) => ({ ...f, endAt: e.target.value }))}
                    className="rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                  />
                </div>
                <button
                  type="button"
                  disabled={createPromoMutation.isPending || !promoForm.bonusPercent || !promoForm.startAt || !promoForm.endAt}
                  onClick={() => createPromoMutation.mutate({
                    bonusPercent: parseFloat(promoForm.bonusPercent),
                    startAt: new Date(promoForm.startAt).toISOString(),
                    endAt: new Date(promoForm.endAt).toISOString(),
                  })}
                  className="rounded-xl px-4 py-2 text-[13px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgb(249,115,22)", color: "#fff" }}
                >
                  {createPromoMutation.isPending ? "Đang tạo..." : "Tạo"}
                </button>
              </div>
            )}

            <div className="divide-y" style={{ borderColor: "var(--bd)" }}>
              {promotionsQuery.isLoading ? (
                <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>Đang tải...</p>
              ) : !promotionsQuery.data?.length ? (
                <p className="px-5 py-4 text-sm" style={{ color: "var(--tx-f)" }}>Chưa có chương trình khuyến mãi nào.</p>
              ) : (
                promotionsQuery.data.map((promo) => {
                  const statusColor = promo.status === "active" ? "rgb(52,211,153)" : promo.status === "upcoming" ? "rgb(245,158,11)" : "var(--tx-f)";
                  const statusLabel = promo.status === "active" ? "Đang chạy" : promo.status === "upcoming" ? "Sắp diễn ra" : "Đã kết thúc";
                  return (
                    <div key={promo.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl text-base font-black" style={{ background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)" }}>
                          +{promo.bonusPercent}%
                        </div>
                        <div>
                          <p className="text-[13px] font-black" style={{ color: "var(--tx)" }}>
                            Nạp ví được thêm <span style={{ color: "rgb(249,115,22)" }}>+{promo.bonusPercent}%</span>
                          </p>
                          <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>
                            {fmtDate(promo.startAt)} → {fmtDate(promo.endAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-black" style={{ color: statusColor }}>{statusLabel}</span>
                        <button
                          type="button"
                          onClick={() => deletePromoMutation.mutate(promo.id)}
                          disabled={deletePromoMutation.isPending}
                          className="rounded-lg p-1.5 transition hover:opacity-70 disabled:opacity-40"
                          style={{ background: "var(--inp)", color: "rgb(248,113,113)" }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Customer table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Danh sách người truy cập Bot</h2>
                  <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black" style={{ background: "rgba(52,211,153,0.12)", color: "rgb(52,211,153)" }}>
                    {wallets.length} người dùng
                  </span>
                </div>
                <button type="button" disabled={customerWalletsQuery.isFetching} onClick={() => void customerWalletsQuery.refetch()}
                  className="rounded-xl p-2 transition hover:opacity-70" style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                  <RefreshCw className={`h-3.5 w-3.5 ${customerWalletsQuery.isFetching ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--tx-f)" }} />
                  <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm theo tên hoặc chat ID..."
                    className="rounded-xl py-2 pl-9 pr-3 text-[13px] outline-none"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)", width: 220 }} />
                </div>
                <div className="flex items-center gap-1">
                  {filterTabBtn("all", "Tất cả")}
                  {filterTabBtn("balance", "Có số dư", "bg-sky-400")}
                  {filterTabBtn("ctv", "CTV", "bg-purple-400")}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                    {["KHÁCH HÀNG", "CHAT ID", "SỐ DƯ VÍ (đ)", "SỐ DƯ USD", "TỔNG ĐƠN", "TỔNG CHI", "PHÂN LOẠI", "THAO TÁC"].map((col, i) => (
                      <th key={col} className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${i === 0 ? "text-left" : "text-center"}`}
                        style={{ color: "var(--tx-f)" }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customerWalletsQuery.isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-8 animate-pulse rounded-lg" style={{ background: "var(--inp)" }} /></td></tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-[13px]" style={{ color: "var(--tx-f)" }}>Chưa có khách nào</td></tr>
                  ) : filtered.map((w) => {
                    const name = displayName(w);
                    return (
                      <tr key={w.id} className="group border-b transition-colors duration-100 hover:bg-[rgba(52,211,153,0.04)]"
                        style={{ borderColor: "var(--bd)" }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white"
                              style={{ background: avatarColor(w.customerId) }}>
                              {avatarInitials(w)}
                            </div>
                            <span className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-[12px] tabular-nums" style={{ color: "var(--tx-f)" }}>{w.telegramChatId}</td>
                        <td className="px-4 py-3 text-center text-[13px] font-black tabular-nums text-emerald-400">{formatCurrency(w.balance)}</td>
                        <td className="px-4 py-3 text-center text-[12px] tabular-nums text-sky-400">${w.balanceUsdt.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center text-[12px] tabular-nums" style={{ color: "var(--tx-m)" }}>{w.orderCount ?? 0}</td>
                        <td className="px-4 py-3 text-center text-[13px] font-black tabular-nums" style={{ color: "var(--tx)" }}>{formatCurrency(w.totalSpent ?? 0)}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {w.isCtv && (
                              <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black"
                                style={{ background: "rgba(139,92,246,0.15)", color: "rgb(167,139,250)", border: "1px solid rgba(139,92,246,0.3)" }}>
                                <span className="h-1.5 w-1.5 rounded-full bg-purple-400" /> CTV
                              </span>
                            )}
                            {w.blacklisted && (
                              <span className="rounded-full px-2 py-0.5 text-[11px] font-black"
                                style={{ background: "rgba(239,68,68,0.15)", color: "rgb(248,113,113)" }}>Blocked</span>
                            )}
                            {w.discountPercent > 0 && (
                              <span className="rounded-full px-2 py-0.5 text-[11px] font-black"
                                style={{ background: "rgba(245,158,11,0.15)", color: "rgb(251,191,36)" }}>-{w.discountPercent}%</span>
                            )}
                            {!w.isCtv && !w.blacklisted && w.discountPercent === 0 && (
                              <span style={{ color: "var(--tx-f)" }}>—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                            <button type="button"
                              onClick={() => { setDefaultTopup(false); setSelectedCustomer(w); }}
                              className="rounded-lg px-2.5 py-1.5 text-[11px] font-black transition hover:opacity-80"
                              style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: "rgb(52,211,153)" }}>
                              Chỉnh sửa
                            </button>
                            <button type="button"
                              onClick={() => { setDefaultTopup(true); setSelectedCustomer(w); }}
                              className="rounded-lg px-2.5 py-1.5 text-[11px] font-black transition hover:opacity-80"
                              style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.3)", color: "rgb(56,189,248)" }}>
                              Nạp ví
                            </button>
                            <button type="button"
                              onClick={() => setHistoryCustomerId(w.customerId)}
                              className="rounded-lg px-2.5 py-1.5 text-[11px] font-black transition hover:opacity-80"
                              style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)", color: "rgb(168,85,247)" }}>
                              🕐 Lịch sử
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Tab: Top người mua */}
      {pageTab === "top-buyers" && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: "3px solid rgb(245,158,11)" }}>
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Khách dẫn đầu</p>
              <p className="mt-2 text-xl font-black truncate" style={{ color: "rgb(245,158,11)" }}>
                {buyers[0]?.name || "—"}
              </p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: "3px solid rgb(52,211,153)" }}>
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Tổng doanh thu</p>
              <p className="mt-2 text-xl font-black tabular-nums text-emerald-400">{formatCurrency(totalBuyerSpent)}</p>
            </div>
            <div className="col-span-2 xl:col-span-1 rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: "3px solid rgb(56,189,248)" }}>
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Tổng đơn</p>
              <p className="mt-2 text-xl font-black tabular-nums text-sky-400">
                {buyers.reduce((s: number, b: any) => s + Number(b.totalOrders || 0), 0)}
              </p>
            </div>
          </div>

          {/* Buyers list */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-400" />
                <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Bảng xếp hạng khách mua</h2>
                <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black" style={{ background: "rgba(245,158,11,0.12)", color: "rgb(245,158,11)" }}>
                  {buyers.length} khách
                </span>
              </div>
              <button type="button" onClick={() => void topBuyersQuery.refetch()}
                className="rounded-xl p-2 transition hover:opacity-70" style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                <RefreshCw className={`h-3.5 w-3.5 ${topBuyersQuery.isFetching ? "animate-spin" : ""}`} />
              </button>
            </div>

            {topBuyersQuery.isLoading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl" style={{ background: "var(--inp)" }} />
                ))}
              </div>
            ) : buyers.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <span className="text-4xl">👑</span>
                <p className="font-black" style={{ color: "var(--tx)" }}>Chưa có dữ liệu top buyer</p>
                <p className="text-sm" style={{ color: "var(--tx-f)" }}>Khi seller bắt đầu có đơn thanh toán thành công, hệ thống sẽ tự xếp hạng tại đây.</p>
              </div>
            ) : (
              <div className="space-y-2 p-4">
                {buyers.map((buyer: any, index: number) => (
                  <div key={buyer.customerId}
                    className="flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-3"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[11px] font-bold tabular-nums"
                        style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{buyer.name}</p>
                        <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>
                          @{buyer.telegramUsername || "—"} · {buyer.totalOrders} đơn
                        </p>
                      </div>
                    </div>
                    <p className="text-[13px] font-black tabular-nums text-emerald-400">{formatCurrency(buyer.totalSpent)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Top giới thiệu */}
      {pageTab === "top-referrers" && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: "3px solid rgb(20,184,166)" }}>
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-3.5 w-3.5" style={{ color: "rgb(20,184,166)" }} />
                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Tổng CTV</p>
              </div>
              <p className="text-3xl font-black tabular-nums" style={{ color: "rgb(20,184,166)" }}>{referrersQuery.data?.length ?? 0}</p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: "3px solid rgb(245,158,11)" }}>
              <div className="flex items-center gap-2 mb-1">
                <Handshake className="h-3.5 w-3.5 text-amber-400" />
                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Tổng cấp dưới</p>
              </div>
              <p className="text-3xl font-black tabular-nums text-amber-400">
                {referrersQuery.data?.reduce((s, r) => s + r.downlineCount, 0) ?? 0}
              </p>
            </div>
            <div className="col-span-2 xl:col-span-1 rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: "3px solid rgb(248,113,113)" }}>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-3.5 w-3.5 text-rose-400" />
                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Tổng hoa hồng</p>
              </div>
              <p className="text-3xl font-black tabular-nums text-rose-400">
                {(() => {
                  const total = referrersQuery.data?.reduce((s, r) => s + r.totalCommission, 0) ?? 0;
                  return total > 0 ? total.toLocaleString("vi-VN") + " ₫" : "—";
                })()}
              </p>
            </div>
          </div>

          {/* Referrers table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4 text-amber-400" />
                <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Bảng xếp hạng</h2>
              </div>
              <button type="button" onClick={() => void referrersQuery.refetch()}
                className="rounded-xl p-2 transition hover:opacity-70" style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                <RefreshCw className={`h-3.5 w-3.5 ${referrersQuery.isFetching ? "animate-spin" : ""}`} />
              </button>
            </div>

            {referrersQuery.isLoading ? (
              <div className="flex h-48 items-center justify-center">
                <p className="text-sm" style={{ color: "var(--tx-f)" }}>Đang tải...</p>
              </div>
            ) : !referrersQuery.data?.length ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <span className="text-4xl">🤝</span>
                <p className="font-black" style={{ color: "var(--tx)" }}>Chưa có ai giới thiệu thành công</p>
                <p className="text-sm" style={{ color: "var(--tx-f)" }}>Khi khách hàng đầu tiên dùng link ref để mua hàng, bảng xếp hạng sẽ xuất hiện tại đây.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                      {["#", "Người giới thiệu", "Cấp dưới", "Hoa hồng tích lũy"].map((col, i) => (
                        <th key={col} className={`px-5 py-3 text-[10px] font-black uppercase tracking-widest ${i === 0 || i === 1 ? "text-left" : "text-right"}`}
                          style={{ color: "var(--tx-f)" }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {referrersQuery.data.map((row, i) => (
                      <tr key={row.id} className="border-b" style={{ borderColor: i < referrersQuery.data!.length - 1 ? "var(--bd)" : "transparent" }}>
                        <td className="px-5 py-3.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                            style={{
                              background: row.rank === 1 ? "rgba(251,191,36,0.2)" : row.rank === 2 ? "rgba(148,163,184,0.15)" : row.rank === 3 ? "rgba(180,83,9,0.15)" : "var(--inp)",
                              color: row.rank === 1 ? "rgb(245,158,11)" : row.rank === 2 ? "rgb(148,163,184)" : row.rank === 3 ? "rgb(180,83,9)" : "var(--tx-f)",
                            }}>
                            {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="font-semibold" style={{ color: "var(--tx)" }}>{row.name}</p>
                          {row.telegramUsername && (
                            <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>@{row.telegramUsername}</p>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                            style={{ background: "rgba(20,184,166,0.1)", color: "rgb(20,184,166)" }}>
                            {row.downlineCount} người
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right font-semibold tabular-nums" style={{ color: "var(--tx)" }}>
                          {row.totalCommission > 0
                            ? row.totalCommission.toLocaleString("vi-VN") + " ₫"
                            : <span style={{ color: "var(--tx-f)" }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {historyCustomerId && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setHistoryCustomerId(null)}
        >
          <div
            className="relative flex w-full flex-col overflow-hidden rounded-2xl"
            style={{ backgroundColor: "var(--surface)", border: "1px solid var(--bd)", maxWidth: 980, maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Lịch sử mua hàng</p>
                <p className="text-sm font-black" style={{ color: "var(--tx)" }}>
                  {historyQuery.data?.customer.displayName ?? "Đang tải..."}
                </p>
              </div>
              <button type="button" onClick={() => setHistoryCustomerId(null)}
                className="rounded-xl px-3 py-1.5 text-[11px] font-bold"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
                Đóng
              </button>
            </div>
            {historyQuery.isLoading ? (
              <div className="py-10 text-center text-sm" style={{ color: "var(--tx-f)" }}>Đang tải...</div>
            ) : historyQuery.data ? (
              <>
                <div className="grid grid-cols-4 gap-2 border-b p-4" style={{ borderColor: "var(--bd)" }}>
                  {[
                    { label: "Tổng đơn", value: String(historyQuery.data.total), color: "var(--tx)" },
                    { label: "Đã chi", value: formatCurrency(historyQuery.data.summary.totalSpent), color: "rgb(52,211,153)" },
                    { label: "Vốn", value: formatCurrency(historyQuery.data.summary.totalCost), color: "rgb(249,115,22)" },
                    { label: "Lãi", value: formatCurrency(historyQuery.data.summary.totalProfit), color: "rgb(168,85,247)" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl p-2" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                      <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{s.label}</p>
                      <p className="mt-0.5 text-[14px] font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
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
                          <td className="px-4 py-2 text-[11px]" style={{ color: "var(--tx-m)" }}>{new Date(o.createdAt).toLocaleString("vi-VN")}</td>
                          <td className="px-4 py-2 font-mono text-[11px]" style={{ color: "var(--tx)" }}>{o.orderCode}</td>
                          <td className="px-4 py-2 text-[11px]" style={{ color: "var(--tx)" }}>{o.productName}</td>
                          <td className="px-4 py-2 text-[11px] tabular-nums" style={{ color: "var(--tx-m)" }}>{o.quantity}</td>
                          <td className="px-4 py-2 font-semibold text-[11px] tabular-nums" style={{ color: "var(--tx)" }}>{formatCurrency(o.totalSaleAmount)}</td>
                          <td className="px-4 py-2 font-semibold text-[11px] tabular-nums" style={{ color: o.profit > 0 ? "rgb(52,211,153)" : "var(--tx-f)" }}>{formatCurrency(o.profit)}</td>
                          <td className="px-4 py-2 text-[11px]">
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                              style={{
                                background: o.status === "DELIVERED" ? "rgba(52,211,153,0.15)" : "rgba(249,115,22,0.15)",
                                color: o.status === "DELIVERED" ? "rgb(52,211,153)" : "rgb(249,115,22)",
                              }}>
                              {o.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {historyQuery.data.orders.length === 0 && (
                    <p className="py-8 text-center text-sm" style={{ color: "var(--tx-f)" }}>Khách chưa có đơn nào.</p>
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
