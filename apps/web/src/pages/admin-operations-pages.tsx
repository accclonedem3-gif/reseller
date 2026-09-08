import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bot, CheckCircle2, CircleDollarSign, RefreshCw, Search, ShieldAlert, Users, WalletCards, Workflow } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";

function Header({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-400">{eyebrow}</p><h1 className="mt-2 text-2xl font-black tracking-tight" style={{ color: "var(--tx)" }}>{title}</h1><p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--tx-m)" }}>{description}</p></div>;
}

function Metric({ label, value, icon: Icon, tone = "orange" }: { label: string; value: string | number; icon: typeof Activity; tone?: "orange" | "green" | "red" | "blue" }) {
  const colors = { orange: "text-orange-400 bg-orange-500/10", green: "text-emerald-400 bg-emerald-500/10", red: "text-red-400 bg-red-500/10", blue: "text-sky-400 bg-sky-500/10" };
  return <Card className="p-5"><div className={`flex size-10 items-center justify-center rounded-xl ${colors[tone]}`}><Icon className="size-5" /></div><p className="mt-4 text-xl font-black" style={{ color: "var(--tx)" }}>{value}</p><p className="mt-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>{label}</p></Card>;
}

type FinanceData = { summary: Record<string, number>; providers: Array<{ provider: string; status: string; count: number; amount: number }>; recentMovements: Array<{ id: string; sellerName: string; type: string; amount: number; balanceAfter: number; note: string | null; createdAt: string }> };

export function AdminFinancePage() {
  const { data, isLoading, refetch, isFetching } = useQuery<FinanceData>({ queryKey: ["admin", "finance"], queryFn: () => api.get("/admin/finance").then((r) => r.data) });
  const s = data?.summary ?? {};
  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4"><Header eyebrow="Financial operations" title="Trung tâm tài chính" description="Theo dõi dòng tiền, số dư lưu hành, lợi nhuận và trạng thái thanh toán trên toàn hệ thống." /><button onClick={() => refetch()} className="flex items-center gap-2 rounded-xl border border-[var(--bd)] px-3 py-2 text-sm font-semibold"><RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /> Làm mới</button></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={WalletCards} label="Ví seller" value={isLoading ? "…" : formatCurrency(s.sellerWalletBalance ?? 0)} /><Metric icon={Users} label="Ví nạp customer" value={formatCurrency(s.customerCashBalance ?? 0)} tone="blue" /><Metric icon={CircleDollarSign} label="Hoa hồng customer" value={formatCurrency(s.customerCommissionBalance ?? 0)} tone="green" /><Metric icon={AlertTriangle} label={`Chờ rút · ${s.pendingWithdrawCount ?? 0} lệnh`} value={formatCurrency(s.pendingWithdrawAmount ?? 0)} tone="red" /></div>
    <div className="grid gap-4 lg:grid-cols-3"><Metric icon={CircleDollarSign} label="Tổng doanh thu" value={formatCurrency(s.grossRevenue ?? 0)} tone="green" /><Metric icon={WalletCards} label="Giá vốn" value={formatCurrency(s.sourceCost ?? 0)} tone="blue" /><Metric icon={Activity} label="Lợi nhuận gộp" value={formatCurrency(s.grossProfit ?? 0)} /></div>
    <div className="grid gap-5 xl:grid-cols-[1fr_1.35fr]">
      <Card className="p-5"><h2 className="font-bold">Đối soát payment provider</h2><div className="mt-4 space-y-2">{data?.providers.map((p) => <div key={`${p.provider}-${p.status}`} className="flex items-center justify-between rounded-xl border border-[var(--bd)] p-3"><div><p className="text-sm font-bold">{p.provider}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>{p.status} · {p.count} giao dịch</p></div><p className="text-sm font-bold">{formatCurrency(p.amount)}</p></div>)}</div></Card>
      <Card className="overflow-hidden"><div className="border-b border-[var(--bd)] p-5"><h2 className="font-bold">Biến động ví gần đây</h2></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--bd)] text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--tx-f)" }}><th className="p-3">Seller</th><th className="p-3">Loại</th><th className="p-3">Số tiền</th><th className="p-3">Sau GD</th></tr></thead><tbody>{data?.recentMovements.map((m) => <tr key={m.id} className="border-b border-[var(--bd)]"><td className="p-3"><p className="font-semibold">{m.sellerName}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>{formatDate(m.createdAt)}</p></td><td className="p-3 text-xs">{m.type}</td><td className={`p-3 font-bold ${m.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatCurrency(m.amount)}</td><td className="p-3">{formatCurrency(m.balanceAfter)}</td></tr>)}</tbody></table></div></Card>
    </div>
  </div>;
}

type HealthData = { generatedAt: string; alerts: Record<string, number>; bots: Array<{ webhookStatus: string; deliveryMode: string; count: number }>; recentFailures: Array<{ id: string; orderCode: string; reason: string | null; shopName: string; updatedAt: string }> };

export function AdminHealthPage() {
  const { data, refetch, isFetching } = useQuery<HealthData>({ queryKey: ["admin", "health"], queryFn: () => api.get("/admin/system-health").then((r) => r.data), refetchInterval: 60000 });
  const a = data?.alerts ?? {};
  const alertRows = [{ label: "Payment lỗi 24h", value: a.failedPayments24h, critical: true }, { label: "Payment pending quá hạn", value: a.stalePendingPayments, critical: true }, { label: "Đơn lỗi 24h", value: a.failedOrders24h, critical: true }, { label: "Đơn xử lý quá lâu", value: a.staleProcessingOrders, critical: true }, { label: "Seller hết hạn trong 7 ngày", value: a.expiringSellers7d }, { label: "Sản phẩm tồn kho thấp", value: a.lowStockProducts }];
  return <div className="space-y-6"><div className="flex justify-between gap-4"><Header eyebrow="Observability" title="System Health" description="Theo dõi bot, webhook, thanh toán, đơn lỗi và các tín hiệu vận hành cần xử lý." /><button onClick={() => refetch()} className="rounded-xl border border-[var(--bd)] p-2.5"><RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /></button></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{alertRows.map((row) => <Card key={row.label} className="p-5"><div className="flex items-center justify-between"><div className={`flex size-10 items-center justify-center rounded-xl ${(row.value ?? 0) > 0 ? row.critical ? "bg-red-500/10 text-red-400" : "bg-orange-500/10 text-orange-400" : "bg-emerald-500/10 text-emerald-400"}`}>{(row.value ?? 0) > 0 ? <ShieldAlert className="size-5" /> : <CheckCircle2 className="size-5" />}</div><span className="text-2xl font-black">{row.value ?? 0}</span></div><p className="mt-4 text-sm font-semibold">{row.label}</p></Card>)}</div>
    <div className="grid gap-5 xl:grid-cols-2"><Card className="p-5"><h2 className="font-bold">Trạng thái bot</h2><div className="mt-4 space-y-2">{data?.bots.map((b, i) => <div key={i} className="flex items-center justify-between rounded-xl border border-[var(--bd)] p-3"><span className="flex items-center gap-2"><Bot className="size-4 text-sky-400" />{b.deliveryMode}</span><span className="text-sm font-bold">{b.webhookStatus} · {b.count}</span></div>)}</div></Card><Card className="p-5"><h2 className="font-bold">Lỗi đơn gần đây</h2><div className="mt-4 space-y-2">{data?.recentFailures.map((f) => <div key={f.id} className="rounded-xl border border-red-500/15 bg-red-500/[0.04] p-3"><div className="flex justify-between"><p className="text-sm font-bold">{f.orderCode}</p><span className="text-xs" style={{ color: "var(--tx-f)" }}>{f.shopName}</span></div><p className="mt-1 line-clamp-2 text-xs text-red-400">{f.reason || "Không có mô tả lỗi"}</p></div>)}</div></Card></div>
  </div>;
}

type CustomerRow = { id: string; telegramUserId: string; username: string | null; displayName: string; shopName: string; sellerName: string; preferredLanguage: string; isCtv: boolean; blacklisted: boolean; cashBalance: number; commissionBalance: number; orderCount: number; warrantyCount: number; createdAt: string };
type WebUserRow = { id: string; sellerId: string | null; username: string; displayName: string | null; shopName: string | null; referralCode: string | null; sellerTier: string | null; affiliateCommissionPercent: number | null };

export function AdminCustomersPage() {
  const queryClient = useQueryClient();
  const [urlParams] = useSearchParams();
  const [search, setSearch] = useState(() => urlParams.get("search") || "");
  const [commissionDrafts, setCommissionDrafts] = useState<Record<string, string>>({});

  const webUsersQuery = useQuery<WebUserRow[]>({
    queryKey: ["admin", "web-users", search],
    queryFn: () => api.get("/admin/sellers", { params: search ? { search } : {} }).then((r) => r.data),
  });
  const customersQuery = useQuery<CustomerRow[]>({
    queryKey: ["admin", "customers", search],
    queryFn: () => api.get("/admin/customers", { params: search ? { search } : {} }).then((r) => r.data),
  });
  const commissionMutation = useMutation({
    mutationFn: ({ userId, percent }: { userId: string; percent: number | null }) =>
      api.put(`/admin/sellers/${userId}/affiliate-commission`, { affiliateCommissionPercent: percent }),
    onSuccess: (_data, vars) => {
      setCommissionDrafts((current) => {
        const next = { ...current };
        delete next[vars.userId];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "web-users"] });
    },
  });

  const saveCommission = (user: WebUserRow, automatic = false) => {
    const raw = commissionDrafts[user.id] ?? (user.affiliateCommissionPercent == null ? "" : String(user.affiliateCommissionPercent));
    if (automatic || raw.trim() === "") {
      commissionMutation.mutate({ userId: user.id, percent: null });
      return;
    }
    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    commissionMutation.mutate({ userId: user.id, percent });
  };

  return <div className="space-y-6">
    <Header eyebrow="Customer intelligence" title="User & khách hàng toàn hệ thống" description="Quản lý user dùng web, % hoa hồng giới thiệu riêng và khách Telegram của các shop." />

    <Card className="overflow-hidden">
      <div className="border-b border-[var(--bd)] p-4">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" style={{ color: "var(--tx-f)" }} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Email, tên user, Telegram ID hoặc username…" className="w-full rounded-xl border border-[var(--bd)] bg-[var(--inp)] py-2.5 pl-9 pr-3 text-sm outline-none" /></div>
      </div>
    </Card>

    <Card className="overflow-hidden">
      <div className="border-b border-[var(--bd)] p-5"><h2 className="font-bold">User web & hoa hồng giới thiệu</h2><p className="mt-1 text-xs" style={{ color: "var(--tx-f)" }}>Để trống hoặc bấm “Về tự động” để tiếp tục dùng % theo mốc. Mức riêng chỉ ghi đè hoa hồng cấp 1.</p></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--bd)] text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--tx-f)" }}><th className="p-3">User web</th><th className="p-3">Shop / Gói</th><th className="p-3">Mã giới thiệu</th><th className="p-3">% hoa hồng riêng</th></tr></thead><tbody>
        {webUsersQuery.isLoading ? <tr><td colSpan={4} className="p-10 text-center">Đang tải…</td></tr> : (webUsersQuery.data ?? []).map((u) => {
          const value = commissionDrafts[u.id] ?? (u.affiliateCommissionPercent == null ? "" : String(u.affiliateCommissionPercent));
          return <tr key={u.id} className="border-b border-[var(--bd)]"><td className="p-3"><p className="font-bold">{u.displayName || "Chưa đặt tên"}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>{u.username}</p></td><td className="p-3"><p>{u.shopName || "Chưa có shop"}</p><p className="text-xs uppercase" style={{ color: "var(--tx-f)" }}>{u.sellerTier || "—"}</p></td><td className="p-3 font-mono text-xs">{u.referralCode || "—"}</td><td className="p-3"><div className="flex min-w-[270px] items-center gap-2"><input type="number" min={0} max={100} step={0.01} value={value} onChange={(e) => setCommissionDrafts((current) => ({ ...current, [u.id]: e.target.value }))} placeholder="Tự động theo mốc" className="w-36 rounded-lg border border-[var(--bd)] bg-[var(--inp)] px-3 py-2 text-sm outline-none" /><button onClick={() => saveCommission(u)} disabled={commissionMutation.isPending} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Lưu</button><button onClick={() => saveCommission(u, true)} disabled={commissionMutation.isPending || u.affiliateCommissionPercent == null} className="rounded-lg border border-[var(--bd)] px-3 py-2 text-xs font-semibold disabled:opacity-40">Về tự động</button></div>{u.affiliateCommissionPercent != null && <p className="mt-1 text-xs text-emerald-400">Đang dùng mức riêng {u.affiliateCommissionPercent}%</p>}</td></tr>;
        })}
      </tbody></table></div>
    </Card>

    <Card className="overflow-hidden">
      <div className="border-b border-[var(--bd)] p-5"><h2 className="font-bold">Khách Telegram của các shop</h2></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--bd)] text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--tx-f)" }}><th className="p-3">Customer</th><th className="p-3">Seller / Shop</th><th className="p-3">Số dư nạp</th><th className="p-3">Hoa hồng</th><th className="p-3">Đơn</th><th className="p-3">Trạng thái</th></tr></thead><tbody>{customersQuery.isLoading ? <tr><td colSpan={6} className="p-10 text-center">Đang tải…</td></tr> : (customersQuery.data ?? []).map((c) => <tr key={c.id} className="border-b border-[var(--bd)]"><td className="p-3"><p className="font-bold">{c.displayName}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>@{c.username || "—"} · {c.telegramUserId}</p></td><td className="p-3"><p>{c.sellerName}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>{c.shopName}</p></td><td className="p-3 font-semibold">{formatCurrency(c.cashBalance)}</td><td className="p-3 font-semibold text-emerald-400">{formatCurrency(c.commissionBalance)}</td><td className="p-3">{c.orderCount}<span className="block text-xs" style={{ color: "var(--tx-f)" }}>{c.warrantyCount} bảo hành</span></td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${c.blacklisted ? "bg-red-500/15 text-red-400" : c.isCtv ? "bg-purple-500/15 text-purple-400" : "bg-emerald-500/15 text-emerald-400"}`}>{c.blacklisted ? "BLACKLIST" : c.isCtv ? "CTV" : "ACTIVE"}</span></td></tr>)}</tbody></table></div>
    </Card>
  </div>;
}

type FeatureFlag = {
  key: string;
  name: string;
  description: string;
  group: "commerce" | "payments" | "finance";
  impact: string;
  critical?: boolean;
  enabled: boolean;
  message: string;
  updatedAt: string | null;
};
type ControlCenterData = { generatedAt: string; total: number; active: number; maintenance: number; flags: FeatureFlag[] };

const CONTROL_GROUPS = [
  { key: "commerce", title: "Bán hàng & dịch vụ", subtitle: "Cầu dao cho các thao tác tạo mới của khách", icon: Workflow, color: "orange" },
  { key: "payments", title: "Kênh thanh toán", subtitle: "Tắt nhận giao dịch mới theo từng kênh", icon: WalletCards, color: "blue" },
  { key: "finance", title: "Tài chính & hoa hồng", subtitle: "Kiểm soát các nghiệp vụ ảnh hưởng số dư", icon: CircleDollarSign, color: "green" },
] as const;

export function AdminAutomationsPage() {
  const queryClient = useQueryClient();
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const { data, isLoading, isFetching, refetch } = useQuery<ControlCenterData>({
    queryKey: ["admin", "automations"],
    queryFn: () => api.get("/admin/automations").then((r) => r.data),
    refetchInterval: 30_000,
  });
  const mutation = useMutation({
    mutationFn: (configs: Record<string, string>) => api.put("/admin/system-config", { configs }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "automations"] }),
  });

  const updateFlag = (flag: FeatureFlag, enabled: boolean) => {
    const message = messageDrafts[flag.key] ?? flag.message;
    mutation.mutate({
      [`feature.${flag.key}.enabled`]: String(enabled),
      [`feature.${flag.key}.message`]: message.trim() || "Chức năng đang bảo trì. Vui lòng thử lại sau.",
    });
  };
  const saveMessage = (flag: FeatureFlag) => mutation.mutate({
    [`feature.${flag.key}.message`]: (messageDrafts[flag.key] ?? flag.message).trim() || "Chức năng đang bảo trì. Vui lòng thử lại sau.",
  });
  const setCommerceMaintenance = (enabled: boolean) => {
    if (!enabled && !window.confirm("Tạm dừng toàn bộ thao tác tạo đơn, nạp ví, mua gói và kênh thanh toán mới? Giao dịch cũ vẫn được đối soát.")) return;
    const configs: Record<string, string> = {};
    for (const flag of data?.flags ?? []) {
      if (flag.group === "commerce" || flag.group === "payments") configs[`feature.${flag.key}.enabled`] = String(enabled);
    }
    mutation.mutate(configs);
  };

  const flags = data?.flags ?? [];
  return <div className="space-y-6">
    <div className="relative overflow-hidden rounded-[28px] border border-orange-500/20 bg-gradient-to-br from-orange-500/[0.14] via-[var(--card)] to-violet-500/[0.08] p-6 md:p-8">
      <div className="absolute -right-16 -top-20 size-64 rounded-full bg-orange-500/10 blur-3xl" />
      <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
        <div><div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/20"><Workflow className="size-6" /></div><p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-400">System Control Center</p><h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Điều khiển vận hành</h1><p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: "var(--tx-m)" }}>Tạm khóa chức năng đang sửa mà không dừng worker đối soát. Các giao dịch khách đã chuyển vẫn tiếp tục được kiểm tra và ghi nhận.</p></div>
        <div className="flex flex-wrap gap-2"><button onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-xl border border-[var(--bd)] bg-[var(--card)] px-4 py-2.5 text-sm font-bold"><RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /> Làm mới</button><button onClick={() => setCommerceMaintenance(false)} disabled={mutation.isPending} className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-black text-red-400 disabled:opacity-50">Tạm dừng giao dịch mới</button><button onClick={() => setCommerceMaintenance(true)} disabled={mutation.isPending} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-500/20 disabled:opacity-50">Bật lại giao dịch</button></div>
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-3">
      <Metric icon={Activity} label="Tổng chức năng" value={isLoading ? "…" : data?.total ?? 0} tone="blue" />
      <Metric icon={CheckCircle2} label="Đang hoạt động" value={data?.active ?? 0} tone="green" />
      <Metric icon={AlertTriangle} label="Đang bảo trì" value={data?.maintenance ?? 0} tone={(data?.maintenance ?? 0) > 0 ? "red" : "orange"} />
    </div>

    {(data?.maintenance ?? 0) > 0 && <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] p-4 text-amber-300"><AlertTriangle className="mt-0.5 size-5 shrink-0" /><div><p className="font-bold">Hệ thống đang có {data?.maintenance} chức năng bảo trì</p><p className="mt-1 text-xs text-amber-200/70">Khách sẽ nhận đúng thông báo đã cấu hình bên dưới khi thao tác.</p></div></div>}

    {CONTROL_GROUPS.map((group) => {
      const Icon = group.icon;
      const groupFlags = flags.filter((flag) => flag.group === group.key);
      return <section key={group.key} className="space-y-3">
        <div className="flex items-center gap-3 px-1"><div className={`flex size-10 items-center justify-center rounded-xl ${group.color === "orange" ? "bg-orange-500/10 text-orange-400" : group.color === "blue" ? "bg-sky-500/10 text-sky-400" : "bg-emerald-500/10 text-emerald-400"}`}><Icon className="size-5" /></div><div><h2 className="font-black">{group.title}</h2><p className="text-xs" style={{ color: "var(--tx-f)" }}>{group.subtitle}</p></div></div>
        <div className="grid gap-4 xl:grid-cols-2">{groupFlags.map((flag) => <Card key={flag.key} className={`overflow-hidden border p-0 transition ${flag.enabled ? "border-[var(--bd)]" : "border-amber-500/30 bg-amber-500/[0.035]"}`}>
          <div className="p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{flag.name}</h3>{flag.critical && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-red-400">Quan trọng</span>}<span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${flag.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{flag.enabled ? "Hoạt động" : "Bảo trì"}</span></div><p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>{flag.description}</p><p className="mt-2 text-xs" style={{ color: "var(--tx-f)" }}>{flag.impact}</p></div><button aria-label={`${flag.enabled ? "Tắt" : "Bật"} ${flag.name}`} onClick={() => updateFlag(flag, !flag.enabled)} disabled={mutation.isPending} className={`relative h-8 w-14 shrink-0 rounded-full transition-all disabled:opacity-50 ${flag.enabled ? "bg-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-amber-500"}`}><span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${flag.enabled ? "left-7" : "left-1"}`} /></button></div></div>
          <div className="border-t border-[var(--bd)] bg-black/[0.04] p-4"><label className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Thông báo khi bảo trì</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input value={messageDrafts[flag.key] ?? flag.message} onChange={(e) => setMessageDrafts((current) => ({ ...current, [flag.key]: e.target.value }))} maxLength={240} className="min-w-0 flex-1 rounded-xl border border-[var(--bd)] bg-[var(--inp)] px-3 py-2.5 text-sm outline-none focus:border-orange-500/50" /><button onClick={() => saveMessage(flag)} disabled={mutation.isPending || messageDrafts[flag.key] === undefined} className="rounded-xl border border-[var(--bd)] px-4 py-2 text-xs font-bold disabled:opacity-40">Lưu lời nhắn</button></div></div>
        </Card>)}</div>
      </section>;
    })}
  </div>;
}