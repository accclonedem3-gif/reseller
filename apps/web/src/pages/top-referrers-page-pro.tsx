import { useQuery } from "@tanstack/react-query";
import { Handshake, TrendingUp, Users } from "lucide-react";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { api } from "@/lib/api";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Affiliate",
    title: "Top người giới thiệu",
    desc: "Bảng xếp hạng CTV theo số người cấp dưới và hoa hồng tích lũy. Dùng dữ liệu này để trao ưu đãi cho những người đóng góp nhiều nhất.",
    statCTV: "Tổng CTV",
    statDownline: "Tổng cấp dưới",
    statCommission: "Tổng hoa hồng",
    tableTitle: "Bảng xếp hạng",
    refresh: "Làm mới",
    loading: "Đang tải...",
    emptyTitle: "Chưa có ai giới thiệu thành công",
    emptyDesc: "Khi khách hàng đầu tiên dùng link ref để mua hàng, bảng xếp hạng sẽ xuất hiện tại đây.",
    colRank: "#",
    colReferrer: "Người giới thiệu",
    colDownline: "Cấp dưới",
    colCommission: "Hoa hồng tích lũy",
    people: (n: number) => `${n} người`,
  },
  en: {
    eyebrow: "Affiliate",
    title: "Top Referrers",
    desc: "Leaderboard of affiliates ranked by downline count and accumulated commission. Use this data to reward top contributors.",
    statCTV: "Total affiliates",
    statDownline: "Total downlines",
    statCommission: "Total commission",
    tableTitle: "Leaderboard",
    refresh: "Refresh",
    loading: "Loading...",
    emptyTitle: "No successful referrals yet",
    emptyDesc: "When the first customer makes a purchase using a referral link, the leaderboard will appear here.",
    colRank: "#",
    colReferrer: "Referrer",
    colDownline: "Downlines",
    colCommission: "Accumulated commission",
    people: (n: number) => `${n} people`,
  },
  th: {
    eyebrow: "Affiliate",
    title: "ผู้แนะนำสูงสุด",
    desc: "กระดานอันดับพันธมิตรตามจำนวนสมาชิกและค่าคอมมิชชันสะสม ใช้ข้อมูลนี้เพื่อมอบรางวัลแก่ผู้มีส่วนร่วมสูงสุด",
    statCTV: "พันธมิตรทั้งหมด",
    statDownline: "สมาชิกทั้งหมด",
    statCommission: "คอมมิชชันรวม",
    tableTitle: "กระดานอันดับ",
    refresh: "รีเฟรช",
    loading: "กำลังโหลด...",
    emptyTitle: "ยังไม่มีการแนะนำที่สำเร็จ",
    emptyDesc: "เมื่อลูกค้าคนแรกซื้อสินค้าผ่านลิงค์แนะนำ กระดานอันดับจะปรากฏที่นี่",
    colRank: "#",
    colReferrer: "ผู้แนะนำ",
    colDownline: "สมาชิก",
    colCommission: "คอมมิชชันสะสม",
    people: (n: number) => `${n} คน`,
  },
};

type LeaderboardRow = {
  rank: number;
  id: string;
  name: string;
  telegramUsername: string | null;
  downlineCount: number;
  totalCommission: number;
};

export function TopReferrersPage() {
  const { lang } = useLang();
  const t = T[lang];

  const query = useQuery({
    queryKey: ["affiliate-leaderboard"],
    queryFn: async () => (await api.get("/affiliate/leaderboard")).data as LeaderboardRow[],
  });

  const totalDownlines = query.data?.reduce((s, r) => s + r.downlineCount, 0) ?? 0;
  const totalCommission = query.data?.reduce((s, r) => s + r.totalCommission, 0) ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc}
        gradient="rose"
        stats={[
          { icon: Users, label: t.statCTV, value: String(query.data?.length ?? "—"), iconCls: "text-teal-400", bgCls: "bg-teal-500/15" },
          { icon: Handshake, label: t.statDownline, value: String(totalDownlines || "—"), iconCls: "text-amber-400", bgCls: "bg-amber-500/15" },
          { icon: TrendingUp, label: t.statCommission, value: totalCommission > 0 ? totalCommission.toLocaleString("vi-VN") + " ₫" : "—", iconCls: "text-rose-400", bgCls: "bg-rose-500/15" },
        ]}
      />

      <Card>
        <div className="flex items-center justify-between">
          <CardHeader icon={Handshake} title={t.tableTitle} iconCls="text-amber-400" iconBg="bg-amber-500/10" />
          <button
            type="button"
            onClick={() => query.refetch()}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{ color: "var(--tx-f)", background: "var(--inp)", border: "1px solid var(--bd)" }}
          >
            {t.refresh}
          </button>
        </div>

        {query.isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm" style={{ color: "var(--tx-f)" }}>{t.loading}</p>
          </div>
        ) : !query.data || query.data.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3">
            <span className="text-4xl">🤝</span>
            <p className="font-semibold" style={{ color: "var(--tx)" }}>{t.emptyTitle}</p>
            <p className="text-sm" style={{ color: "var(--tx-f)" }}>{t.emptyDesc}</p>
          </div>
        ) : (
          <div className="mt-2 overflow-hidden rounded-2xl" style={{ border: "1px solid var(--bd)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--bd)" }}>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colRank}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colReferrer}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colDownline}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colCommission}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((row, i) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: i < query.data!.length - 1 ? "1px solid var(--bd)" : undefined }}
                  >
                    <td className="px-4 py-3.5">
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                        style={{
                          background: row.rank === 1 ? "rgba(251,191,36,0.2)" : row.rank === 2 ? "rgba(148,163,184,0.15)" : row.rank === 3 ? "rgba(180,83,9,0.15)" : "var(--inp)",
                          color: row.rank === 1 ? "rgb(245,158,11)" : row.rank === 2 ? "rgb(148,163,184)" : row.rank === 3 ? "rgb(180,83,9)" : "var(--tx-f)",
                        }}
                      >
                        {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-medium" style={{ color: "var(--tx)" }}>{row.name}</p>
                      {row.telegramUsername && (
                        <p className="text-xs" style={{ color: "var(--tx-f)" }}>@{row.telegramUsername}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ background: "rgba(20,184,166,0.1)", color: "rgb(20,184,166)" }}
                      >
                        {t.people(row.downlineCount)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold tabular-nums" style={{ color: "var(--tx)" }}>
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
      </Card>
    </div>
  );
}
