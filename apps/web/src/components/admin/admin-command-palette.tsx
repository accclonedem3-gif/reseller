import { useQuery } from "@tanstack/react-query";
import { Search, ShoppingBag, Store, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

type SearchData = {
  sellers: Array<{ id: string; title: string; subtitle: string; status: string | null }>;
  customers: Array<{ id: string; title: string; subtitle: string }>;
  orders: Array<{ id: string; title: string; subtitle: string; status: string; amount: number }>;
};

export function AdminCommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen((value) => !value); } if (event.key === "Escape") setOpen(false); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  const { data, isFetching } = useQuery<SearchData>({ queryKey: ["admin", "global-search", query], queryFn: () => api.get("/admin/global-search", { params: { q: query } }).then((r) => r.data), enabled: open && query.trim().length >= 2, staleTime: 15000 });
  const go = (path: string) => { navigate(path); setOpen(false); setQuery(""); };
  return <>
    <button onClick={() => setOpen(true)} className="hidden min-w-[240px] items-center gap-2 rounded-xl border border-[var(--bd)] bg-[var(--surface)] px-3 py-2.5 text-sm xl:flex" style={{ color: "var(--tx-f)" }}><Search className="size-4" /><span className="flex-1 text-left">Tìm seller, customer, order…</span><kbd className="rounded border border-[var(--bd)] px-1.5 py-0.5 text-[10px]">Ctrl K</kbd></button>
    {open && createPortal(<div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/65 px-4 pt-[10vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}><div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#10182a] shadow-2xl" onMouseDown={(e) => e.stopPropagation()}><div className="flex items-center gap-3 border-b border-white/10 px-4"><Search className="size-5 text-orange-400" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nhập ít nhất 2 ký tự…" className="h-14 flex-1 bg-transparent text-sm text-white outline-none" /><button onClick={() => setOpen(false)}><X className="size-4 text-slate-400" /></button></div><div className="max-h-[60vh] overflow-y-auto p-3">{query.length < 2 ? <p className="p-8 text-center text-sm text-slate-500">Tìm xuyên toàn hệ thống bằng tên, email, Telegram ID hoặc mã đơn.</p> : isFetching ? <p className="p-8 text-center text-sm text-slate-400">Đang tìm kiếm…</p> : <div className="space-y-4">
      {data?.sellers.length ? <section><p className="px-2 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Seller</p>{data.sellers.map((item) => <button key={item.id} onClick={() => go(`/admin/ctv/${item.id}`)} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-white/5"><Store className="size-4 text-orange-400" /><span className="min-w-0 flex-1"><b className="block truncate text-sm text-white">{item.title}</b><span className="block truncate text-xs text-slate-500">{item.subtitle}</span></span><span className="text-[10px] text-emerald-400">{item.status}</span></button>)}</section> : null}
      {data?.customers.length ? <section><p className="px-2 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Customer</p>{data.customers.map((item) => <button key={item.id} onClick={() => go(`/admin/customers?search=${encodeURIComponent(item.title)}`)} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-white/5"><UserRound className="size-4 text-sky-400" /><span className="min-w-0"><b className="block truncate text-sm text-white">{item.title}</b><span className="block truncate text-xs text-slate-500">{item.subtitle}</span></span></button>)}</section> : null}
      {data?.orders.length ? <section><p className="px-2 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Đơn hàng</p>{data.orders.map((item) => <button key={item.id} onClick={() => go(`/admin/orders?search=${item.title}`)} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-white/5"><ShoppingBag className="size-4 text-purple-400" /><span className="min-w-0 flex-1"><b className="block truncate text-sm text-white">{item.title}</b><span className="block truncate text-xs text-slate-500">{item.subtitle}</span></span><span className="text-xs font-bold text-white">{formatCurrency(item.amount)}</span></button>)}</section> : null}
      {!data?.sellers.length && !data?.customers.length && !data?.orders.length ? <p className="p-8 text-center text-sm text-slate-500">Không tìm thấy kết quả.</p> : null}
    </div>}</div></div></div>, document.body)}
  </>;
}
