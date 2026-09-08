import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, CalendarClock, CircleDollarSign, ExternalLink, ShoppingBag, Store, Users, WalletCards } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";

type SellerDetail = {
  user: { id: string; email: string; recoveryEmail: string | null; status: string; createdAt: string };
  seller: { id: string; displayName: string; phone: string | null; status: string; tier: string; tierStartedAt: string | null; tierExpiresAt: string | null; referralCode: string | null; signupIp: string | null };
  metrics: { walletBalance: number; orders: number; customers: number; referrals: number; withdraws: number; revenue: number; sourceCost: number };
  shops: Array<{ id: string; name: string; slug: string; status: string; botUsername: string | null; webhookStatus: string | null; deliveryMode: string | null; paymentProvider: string | null; sourceProvider: string | null }>;
  ledgers: Array<{ id: string; type: string; amount: number; balanceAfter: number; note: string | null; createdAt: string }>;
  subscriptions: Array<{ id: string; tier: string; plan: string; status: string; priceVnd: number; startsAt: string; endsAt: string }>;
  recentOrders: Array<{ id: string; orderCode: string; productNameSnapshot: string; status: string; totalSaleAmount: number; createdAt: string }>;
};

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return <Card className="p-4"><Icon className="size-5 text-orange-400" /><p className="mt-3 text-xl font-black">{value}</p><p className="text-xs uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>{label}</p></Card>;
}

export function AdminSellerDetailPage() {
  const { userId = "" } = useParams();
  const { data, isLoading, isError } = useQuery<SellerDetail>({ queryKey: ["admin", "seller", userId], queryFn: () => api.get(`/admin/sellers/${userId}`).then((r) => r.data), enabled: Boolean(userId) });
  if (isLoading) return <div className="p-10 text-center">Đang tải Seller 360°…</div>;
  if (isError || !data) return <div className="p-10 text-center text-red-400">Không tìm thấy seller.</div>;
  const profit = data.metrics.revenue - data.metrics.sourceCost;
  return <div className="space-y-6">
    <Link to="/admin/ctv" className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--tx-m)" }}><ArrowLeft className="size-4" /> Tài khoản seller</Link>
    <Card className="relative overflow-hidden p-6"><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-amber-300 to-purple-500" /><div className="flex flex-col justify-between gap-5 md:flex-row md:items-start"><div><div className="flex items-center gap-3"><h1 className="text-2xl font-black">{data.seller.displayName}</h1><span className="rounded-full bg-orange-500/15 px-3 py-1 text-xs font-black text-orange-400">{data.seller.tier}</span><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-400">{data.seller.status}</span></div><p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>{data.user.email} · {data.seller.phone || "Chưa có SĐT"}</p><p className="mt-1 text-xs" style={{ color: "var(--tx-f)" }}>Tham gia {formatDate(data.user.createdAt)} · IP {data.seller.signupIp || "—"} · Ref {data.seller.referralCode || "—"}</p></div><div className="rounded-2xl border border-orange-500/20 bg-orange-500/[0.06] px-5 py-3"><p className="text-xs uppercase tracking-wider text-orange-400">Tier hết hạn</p><p className="mt-1 font-bold">{data.seller.tierExpiresAt ? formatDate(data.seller.tierExpiresAt) : "Không giới hạn"}</p></div></div></Card>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><Stat icon={WalletCards} label="Số dư" value={formatCurrency(data.metrics.walletBalance)} /><Stat icon={CircleDollarSign} label="Doanh thu" value={formatCurrency(data.metrics.revenue)} /><Stat icon={CircleDollarSign} label="Lợi nhuận gộp" value={formatCurrency(profit)} /><Stat icon={ShoppingBag} label="Đơn hàng" value={data.metrics.orders} /><Stat icon={Users} label="Customer" value={data.metrics.customers} /><Stat icon={Users} label="Giới thiệu" value={data.metrics.referrals} /></div>
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-5"><h2 className="flex items-center gap-2 font-bold"><Store className="size-4 text-orange-400" /> Shop và kết nối</h2><div className="mt-4 space-y-3">{data.shops.map((shop) => <div key={shop.id} className="rounded-2xl border border-[var(--bd)] p-4"><div className="flex justify-between"><div><p className="font-bold">{shop.name}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>/{shop.slug} · @{shop.botUsername || "chưa kết nối bot"}</p></div><span className="text-xs font-bold text-emerald-400">{shop.status}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4"><span>Webhook: <b>{shop.webhookStatus || "—"}</b></span><span>Mode: <b>{shop.deliveryMode || "—"}</b></span><span>Payment: <b>{shop.paymentProvider || "—"}</b></span><span>Source: <b>{shop.sourceProvider || "—"}</b></span></div></div>)}</div></Card>
      <Card className="p-5"><h2 className="flex items-center gap-2 font-bold"><CalendarClock className="size-4 text-orange-400" /> Lịch sử gói</h2><div className="mt-4 space-y-3">{data.subscriptions.length === 0 ? <p className="text-sm" style={{ color: "var(--tx-f)" }}>Chưa có subscription.</p> : data.subscriptions.map((s) => <div key={s.id} className="flex justify-between rounded-xl border border-[var(--bd)] p-3"><div><p className="font-bold">{s.tier} · {s.plan}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>{formatDate(s.startsAt)} → {formatDate(s.endsAt)}</p></div><div className="text-right"><p className="font-bold">{formatCurrency(s.priceVnd)}</p><p className="text-xs text-emerald-400">{s.status}</p></div></div>)}</div></Card>
    </div>
    <div className="grid gap-5 xl:grid-cols-2"><Card className="overflow-hidden"><div className="p-5"><h2 className="font-bold">Đơn gần đây</h2></div>{data.recentOrders.map((o) => <Link to={`/admin/orders?search=${o.orderCode}`} key={o.id} className="flex items-center justify-between border-t border-[var(--bd)] p-4 hover:bg-white/[0.02]"><div><p className="text-sm font-bold">{o.orderCode}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>{o.productNameSnapshot}</p></div><div className="text-right"><p className="text-sm font-bold">{formatCurrency(o.totalSaleAmount)}</p><p className="text-xs text-orange-400">{o.status}</p></div></Link>)}</Card><Card className="overflow-hidden"><div className="p-5"><h2 className="font-bold">Biến động ví</h2></div>{data.ledgers.map((l) => <div key={l.id} className="flex items-center justify-between border-t border-[var(--bd)] p-4"><div><p className="text-sm font-bold">{l.type}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>{l.note || formatDate(l.createdAt)}</p></div><div className="text-right"><p className={`text-sm font-bold ${l.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatCurrency(l.amount)}</p><p className="text-xs" style={{ color: "var(--tx-f)" }}>Còn {formatCurrency(l.balanceAfter)}</p></div></div>)}</Card></div>
  </div>;
}
