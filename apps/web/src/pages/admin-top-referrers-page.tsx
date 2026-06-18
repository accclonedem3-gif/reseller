import { useQuery } from "@tanstack/react-query";
import { Trophy, Users, UserCheck, Coins } from "lucide-react";

import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

type TopReferrer = {
  sellerId: string;
  displayName: string | null;
  email: string | null;
  tier: string | null;
  referralCode: string | null;
  referredCount: number;
  activeReferredCount: number;
  commissionVnd: number;
};

function TierBadge({ tier }: { tier: string | null }) {
  if (tier === "ultra")
    return (
      <span className="inline-flex items-center rounded-full border border-yellow-500/30 bg-yellow-500/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-600 dark:text-yellow-300">
        ULTRA
      </span>
    );
  if (tier === "pro")
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        PRO
      </span>
    );
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ border: "1px solid var(--bd)", backgroundColor: "var(--inp)", color: "var(--tx-m)" }}
    >
      {(tier || "free").toUpperCase()}
    </span>
  );
}

function rankBadge(i: number) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return `${i + 1}`;
}

export function AdminTopReferrersPage() {
  const { data = [], isLoading } = useQuery<TopReferrer[]>({
    queryKey: ["admin", "top-referrers"],
    queryFn: () => api.get("/admin/top-referrers").then((r) => r.data),
  });

  const totalReferred = data.reduce((s, r) => s + r.referredCount, 0);
  const totalActive = data.reduce((s, r) => s + r.activeReferredCount, 0);
  const totalCommission = data.reduce((s, r) => s + r.commissionVnd, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-[12px]"
          style={{ border: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}
        >
          <Trophy className="h-5 w-5 text-orange-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--tx)" }}>Top người giới thiệu</h1>
          <p className="text-sm" style={{ color: "var(--tx-m)" }}>
            Xếp hạng CTV theo số người giới thiệu, số đang còn gói, và hoa hồng đã nhận.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat icon={Users} label="Tổng lượt giới thiệu" value={totalReferred} />
        <Stat icon={UserCheck} label="Đang còn gói (active)" value={totalActive} />
        <Stat icon={Coins} label="Tổng hoa hồng" value={formatCurrency(totalCommission)} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">#</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">CTV</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Gói</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider">Đã giới thiệu</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider">Đang active</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider">Hoa hồng</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: "var(--tx-f)" }}>Đang tải…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: "var(--tx-f)" }}>Chưa có dữ liệu giới thiệu.</td></tr>
              ) : (
                data.map((r, i) => (
                  <tr key={r.sellerId} style={{ borderBottom: "1px solid var(--bd)" }}>
                    <td className="px-4 py-3 text-base" style={{ color: "var(--tx-m)" }}>{rankBadge(i)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: "var(--tx)" }}>{r.displayName || "—"}</div>
                      <div className="text-xs" style={{ color: "var(--tx-f)" }}>
                        {r.email || ""}{r.referralCode ? ` · ${r.referralCode}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3"><TierBadge tier={r.tier} /></td>
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: "var(--tx)" }}>{r.referredCount}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-300">{r.activeReferredCount}</td>
                    <td className="px-4 py-3 text-right font-semibold text-orange-500 dark:text-orange-300">{formatCurrency(r.commissionVnd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <Card className="p-5">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-[11px]"
        style={{ border: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}
      >
        <Icon className="h-4.5 w-4.5 text-orange-400" />
      </div>
      <p className="mt-4 text-2xl font-bold" style={{ color: "var(--tx)" }}>{value}</p>
      <p className="mt-1 text-sm font-medium" style={{ color: "var(--tx-m)" }}>{label}</p>
    </Card>
  );
}
