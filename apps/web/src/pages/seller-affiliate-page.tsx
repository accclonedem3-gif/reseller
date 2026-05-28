import { useQuery } from "@tanstack/react-query";
import { Copy, TrendingUp, Users, Sparkles, Award } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/ui/toast";

type AffiliateStats = {
  referralCode: string | null;
  unlockedTier: number;
  unlockedTier2At: string | null;
  unlockedTier3At: string | null;
  effectiveRate: number;
  activity90d: number;
  activity30d: number;
  allTimeCommission: number;
  currentMonthCommission: number;
  level1Count: number;
  level1ActiveCount: number;
  level2Count: number;
  level2ActiveCount: number;
  level1Referrals: Array<{
    id: string;
    displayName: string;
    tier: string;
    tierExpiresAt: string | null;
    createdAt: string;
  }>;
  level2Referrals: Array<{
    id: string;
    displayName: string;
    tier: string;
    tierExpiresAt: string | null;
    createdAt: string;
  }>;
  recentLedger: Array<{
    id: string;
    type: string;
    amount: number;
    note: string | null;
    createdAt: string;
  }>;
  monthlyChart: Array<{ month: string; total: number }>;
};

const TIER_LABELS: Record<number, { label: string; rate: string; color: string; emoji: string }> = {
  1: { label: "BẬC 1 — Khởi đầu", rate: "10%", color: "rgb(148,163,184)", emoji: "🥉" },
  2: { label: "BẬC 2 — Phát triển", rate: "15%", color: "rgb(99,102,241)", emoji: "🥈" },
  3: { label: "BẬC 3 — Pro", rate: "20%", color: "rgb(234,179,8)", emoji: "🥇" },
};

const UNLOCK_THRESHOLDS = { 2: 10_000_000, 3: 30_000_000 };
const MAINTAIN_THRESHOLDS = { 2: 1_000_000, 3: 3_000_000 };

export function SellerAffiliatePage() {
  const { showToast } = useToast();
  const statsQuery = useQuery<AffiliateStats>({
    queryKey: ["affiliate-stats"],
    queryFn: async () => (await api.get("/tiers/affiliate-stats")).data,
  });
  const s = statsQuery.data;

  if (statsQuery.isPending || !s) {
    return <div className="p-10 text-center text-slate-400">Đang tải...</div>;
  }

  const effectivePercent = (s.effectiveRate * 100).toFixed(0);
  const tierInfo = TIER_LABELS[s.unlockedTier] ?? TIER_LABELS[1]!;

  // Progress to next tier
  const allTime = s.allTimeCommission;
  const next = s.unlockedTier < 3 ? s.unlockedTier + 1 : null;
  const progressToNextUnlock = next
    ? Math.min(100, (allTime / UNLOCK_THRESHOLDS[next as 2 | 3]) * 100)
    : 100;

  // Effective tier maintenance check
  const maintainTier = s.unlockedTier >= 3 && s.activity90d < MAINTAIN_THRESHOLDS[3] ? 2 : null;
  const stillNeedToMaintain = s.unlockedTier >= 3
    ? MAINTAIN_THRESHOLDS[3] - s.activity90d
    : s.unlockedTier >= 2
      ? MAINTAIN_THRESHOLDS[2] - s.activity90d
      : 0;

  const handleCopyLink = () => {
    if (!s.referralCode) return;
    const url = `${window.location.origin}/?ref=${s.referralCode}`;
    navigator.clipboard.writeText(url);
    showToast({ tone: "success", message: "Đã copy link giới thiệu" });
  };

  const handleCopyCode = () => {
    if (!s.referralCode) return;
    navigator.clipboard.writeText(s.referralCode);
    showToast({ tone: "success", message: "Đã copy mã" });
  };

  return (
    <div className="space-y-5 p-6">
      {/* Hero - Tier status */}
      <div
        className="relative overflow-hidden rounded-3xl p-6"
        style={{
          background: `linear-gradient(135deg, ${tierInfo.color}22, transparent)`,
          border: `1px solid ${tierInfo.color}44`,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: tierInfo.color }}>
              AFFILIATE PROGRAM
            </p>
            <h1 className="mt-2 text-3xl font-black" style={{ color: "var(--tx)" }}>
              {tierInfo.emoji} {tierInfo.label}
            </h1>
            <p className="mt-2 text-lg font-bold" style={{ color: tierInfo.color }}>
              Tỷ lệ hiện tại: {effectivePercent}%
            </p>
            {maintainTier && (
              <p className="mt-1 text-xs" style={{ color: "rgb(234,179,8)" }}>
                ⚠️ Đã unlock Bậc {s.unlockedTier} nhưng hoạt động 90 ngày chưa đủ để hưởng rate cao
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>
              Tích luỹ all-time
            </p>
            <p className="text-2xl font-black" style={{ color: "var(--tx)" }}>
              {formatCurrency(allTime)}
            </p>
          </div>
        </div>

        {/* Progress bars */}
        {next && (
          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span style={{ color: "var(--tx-m)" }}>
                Tiến độ unlock Bậc {next} ({TIER_LABELS[next]?.rate ?? ""})
              </span>
              <span className="font-bold" style={{ color: "var(--tx)" }}>
                {formatCurrency(allTime)} / {formatCurrency(UNLOCK_THRESHOLDS[next as 2 | 3]!)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progressToNextUnlock}%`, background: tierInfo.color }}
              />
            </div>
          </div>
        )}

        {s.unlockedTier >= 2 && stillNeedToMaintain > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span style={{ color: "var(--tx-m)" }}>
                Duy trì 90 ngày (cần {formatCurrency(MAINTAIN_THRESHOLDS[s.unlockedTier >= 3 ? 3 : 2])})
              </span>
              <span className="font-bold" style={{ color: "var(--tx)" }}>
                {formatCurrency(s.activity90d)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (s.activity90d / MAINTAIN_THRESHOLDS[s.unlockedTier >= 3 ? 3 : 2]) * 100)}%`,
                  background: "rgb(34,197,94)",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Referral link */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>
          Link giới thiệu của bạn
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex flex-1 items-center gap-2 rounded-xl px-4 py-3 text-sm font-mono"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)", minWidth: 280 }}
          >
            {s.referralCode ? `${window.location.origin}/?ref=${s.referralCode}` : "(chưa có)"}
          </div>
          <button
            type="button"
            onClick={handleCopyLink}
            disabled={!s.referralCode}
            className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            Copy Link
          </button>
          <button
            type="button"
            onClick={handleCopyCode}
            disabled={!s.referralCode}
            className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
          >
            <Copy className="h-4 w-4" />
            Mã: <strong>{s.referralCode || "—"}</strong>
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="90 ngày"
          value={formatCurrency(s.activity90d)}
          color="rgb(34,197,94)"
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          label="30 ngày"
          value={formatCurrency(s.activity30d)}
          color="rgb(99,102,241)"
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Cấp 1"
          value={`${s.level1ActiveCount}/${s.level1Count}`}
          subValue="active / tổng"
          color="rgb(249,115,22)"
        />
        <StatCard
          icon={<Award className="h-4 w-4" />}
          label="Cấp 2"
          value={`${s.level2ActiveCount}/${s.level2Count}`}
          subValue="active / tổng"
          color="rgb(139,92,246)"
        />
      </div>

      {/* Chart */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>
          📊 Hoa hồng 12 tháng gần nhất
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={s.monthlyChart}>
              <XAxis dataKey="month" tick={{ fill: "var(--tx-f)", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "var(--tx-f)", fontSize: 11 }}
                tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`}
              />
              <Tooltip
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--bd)", borderRadius: 8 }}
                labelStyle={{ color: "var(--tx)" }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Bar dataKey="total" fill={tierInfo.color} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent ledger */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>
          📜 Lịch sử hoa hồng gần đây
        </p>
        {s.recentLedger.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: "var(--tx-f)" }}>
            Chưa có hoa hồng nào.
          </p>
        ) : (
          <div className="space-y-2">
            {s.recentLedger.slice(0, 15).map((l) => {
              const isPositive = l.amount > 0;
              const typeLabel =
                l.type === "AFFILIATE_LEVEL_1"
                  ? "Cấp 1"
                  : l.type === "AFFILIATE_LEVEL_2"
                    ? "Cấp 2"
                    : l.type === "AFFILIATE_CLAWBACK"
                      ? "Claw back"
                      : l.type;
              return (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{
                          background: isPositive ? "rgba(34,197,94,0.15)" : "rgba(244,63,94,0.15)",
                          color: isPositive ? "rgb(34,197,94)" : "rgb(244,63,94)",
                        }}
                      >
                        {typeLabel}
                      </span>
                      <span className="text-[11px]" style={{ color: "var(--tx-f)" }}>
                        {new Date(l.createdAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                      </span>
                    </div>
                    {l.note && (
                      <p className="mt-0.5 truncate text-xs" style={{ color: "var(--tx-m)" }}>{l.note}</p>
                    )}
                  </div>
                  <p
                    className="text-sm font-black tabular-nums"
                    style={{ color: isPositive ? "rgb(34,197,94)" : "rgb(244,63,94)" }}
                  >
                    {isPositive ? "+" : ""}
                    {formatCurrency(l.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Downline tabs */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>
          👥 Downline cấp 1
        </p>
        {s.level1Referrals.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: "var(--tx-f)" }}>
            Chưa có ai đăng ký qua link của bạn.
          </p>
        ) : (
          <div className="space-y-1.5">
            {s.level1Referrals.map((r) => {
              const isActive = r.tier !== "FREE" && r.tierExpiresAt && new Date(r.tierExpiresAt) > new Date();
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                >
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>{r.displayName}</p>
                    <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>
                      Tham gia: {new Date(r.createdAt).toLocaleDateString("vi-VN")}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{
                        background: isActive ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.15)",
                        color: isActive ? "rgb(34,197,94)" : "rgb(148,163,184)",
                      }}
                    >
                      {r.tier} {isActive ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, subValue, color }: { icon: React.ReactNode; label: string; value: string; subValue?: string; color: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
      <div className="flex items-center gap-2" style={{ color }}>
        {icon}
        <p className="text-[10px] font-black uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-2 text-xl font-black" style={{ color: "var(--tx)" }}>{value}</p>
      {subValue && <p className="mt-0.5 text-[10px]" style={{ color: "var(--tx-f)" }}>{subValue}</p>}
    </div>
  );
}
