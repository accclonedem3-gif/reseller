import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Power, PowerOff } from "lucide-react";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";

type SellerLite = {
  id: string;
  displayName: string | null;
  referralCode: string | null;
  user: { email: string } | null;
};

type DiscountCodeRow = {
  id: string;
  code: string;
  discountPercent: string | number;
  description: string | null;
  active: boolean;
  createdAt: string;
  referrerSeller: SellerLite | null;
  _count: { usages: number };
};

export function AdminDiscountCodesPage() {
  const queryClient = useQueryClient();

  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("20");
  const [referrerId, setReferrerId] = useState("");
  const [description, setDescription] = useState("");
  const [sellerSearch, setSellerSearch] = useState("");

  const codesQuery = useQuery<DiscountCodeRow[]>({
    queryKey: ["admin", "discount-codes"],
    queryFn: () => api.get("/admin/discount-codes").then((r) => r.data),
  });

  const sellersQuery = useQuery<Array<{ id: string; sellerId: string | null; username: string; displayName: string | null; referralCode: string | null }>>({
    queryKey: ["admin", "sellers", "all"],
    queryFn: () => api.get("/admin/sellers").then((r) => r.data),
  });

  const filteredSellers = useMemo(() => {
    const list = (sellersQuery.data || []).filter((s) => s.sellerId);
    if (!sellerSearch.trim()) return list.slice(0, 50);
    const q = sellerSearch.trim().toLowerCase();
    return list.filter((s) =>
      (s.displayName || "").toLowerCase().includes(q) ||
      s.username.toLowerCase().includes(q) ||
      (s.referralCode ?? "").toLowerCase().includes(q),
    ).slice(0, 50);
  }, [sellersQuery.data, sellerSearch]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/admin/discount-codes", {
        code: code.trim().toUpperCase(),
        discountPercent: Number(percent),
        referrerSellerId: referrerId,
        description: description.trim() || undefined,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "discount-codes"] });
      setCode("");
      setDescription("");
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.message || "Tạo mã thất bại.");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/admin/discount-codes/${id}/toggle`, { active }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "discount-codes"] }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !referrerId || !percent) {
      window.alert("Vui lòng nhập mã, % giảm, và chọn referrer.");
      return;
    }
    createMutation.mutate();
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
  };

  const rows = codesQuery.data || [];

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Quản trị marketing"
        title="Mã giảm giá"
        description="Tạo mã giảm giá kèm referrer. Mỗi seller chỉ được dùng 1 mã 1 lần khi mua tier subscription."
      />

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-white">Tạo mã mới</p>
        <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-12">
          <div className="sm:col-span-3">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mã (A-Z, 0-9, _, -)</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WELCOME20" maxLength={32}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#18233c] px-3 py-2 font-mono text-sm uppercase text-white outline-none focus:border-emerald-300/40" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">% giảm</label>
            <input type="number" min={1} max={100} step={1} value={percent} onChange={(e) => setPercent(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#18233c] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/40" />
          </div>
          <div className="sm:col-span-7">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Referrer (seller nhận hoa hồng khi mã được dùng)</label>
            <input type="text" value={sellerSearch} onChange={(e) => setSellerSearch(e.target.value)}
              placeholder="Tìm seller theo tên / email / referralCode..."
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#18233c] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/40" />
            {filteredSellers.length > 0 && (
              <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-[#0e1626]">
                {filteredSellers.map((s) => (
                  <button key={s.sellerId} type="button"
                    onClick={() => {
                      if (!s.sellerId) return;
                      setReferrerId(s.sellerId);
                      setSellerSearch(`${s.displayName || "(no name)"} (${s.username})`);
                    }}
                    className={`block w-full px-3 py-2 text-left text-xs transition hover:bg-white/5 ${referrerId === s.sellerId ? "bg-emerald-500/10" : ""}`}>
                    <span className="text-white">{s.displayName || "(no name)"}</span>
                    <span className="ml-2 text-slate-400">{s.username}</span>
                    {s.referralCode && <span className="ml-2 font-mono text-emerald-400">ref:{s.referralCode}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="sm:col-span-10">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ghi chú (tuỳ chọn)</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Vd: Mã KOL tháng 5/2026"
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#18233c] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/40" />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit" variant="primary" disabled={createMutation.isPending} className="w-full">
              {createMutation.isPending ? "Đang tạo..." : "Tạo mã"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">Chưa có mã nào.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/6">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mã</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">% Giảm</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Referrer</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ghi chú</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Đã dùng</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Trạng thái</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tạo</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/4">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-white/5 px-2 py-1 font-mono text-emerald-400">{row.code}</code>
                        <button type="button" onClick={() => copy(row.code)} title="Copy">
                          <Copy className="h-3.5 w-3.5 text-slate-400 hover:text-white" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-white tabular-nums">{Number(row.discountPercent)}%</td>
                    <td className="px-4 py-3">
                      <p className="text-white">{row.referrerSeller?.displayName || "—"}</p>
                      <p className="text-xs text-slate-500">{row.referrerSeller?.user?.email || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{row.description || "—"}</td>
                    <td className="px-4 py-3 text-right text-white tabular-nums">{row._count.usages}</td>
                    <td className="px-4 py-3">
                      <Badge tone={row.active ? "success" : "neutral"}>
                        {row.active ? "Đang dùng" : "Đã tắt"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary"
                        onClick={() => toggleMutation.mutate({ id: row.id, active: !row.active })}
                        disabled={toggleMutation.isPending}>
                        {row.active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                        {row.active ? " Tắt" : " Bật"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
