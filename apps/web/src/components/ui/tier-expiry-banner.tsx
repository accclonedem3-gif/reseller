import { AlertTriangle, X } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/auth-provider";

const DISMISS_KEY_PREFIX = "tier_reminder_dismissed_";

function getDismissKey(sellerId: string, stage: string) {
  return `${DISMISS_KEY_PREFIX}${sellerId}_${stage}`;
}

function resolveStage(daysRemaining: number): "1d" | "3d" | "7d" | null {
  if (daysRemaining < 0) return null;
  if (daysRemaining <= 1) return "1d";
  if (daysRemaining <= 3) return "3d";
  if (daysRemaining <= 7) return "7d";
  return null;
}

export function TierExpiryBanner() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const info = useMemo(() => {
    if (!session?.user) return null;
    const tier = session.user.sellerTier;
    if (tier !== "pro" && tier !== "ultra") return null;
    const expiresAtRaw = session.user.sellerTierExpiresAt;
    if (!expiresAtRaw) return null;
    const expiresAt = new Date(expiresAtRaw);
    if (Number.isNaN(expiresAt.getTime())) return null;
    const now = Date.now();
    const remainingMs = expiresAt.getTime() - now;
    const daysRemaining = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    const stage = resolveStage(daysRemaining);
    if (!stage) return null;
    return { expiresAt, daysRemaining, stage, tier, sellerId: session.user.sellerId };
  }, [session]);

  useEffect(() => {
    if (!info?.sellerId) {
      setDismissed(false);
      return;
    }
    const key = getDismissKey(info.sellerId, info.stage);
    setDismissed(window.localStorage.getItem(key) === "1");
  }, [info?.sellerId, info?.stage]);

  if (!info || dismissed) return null;

  const { stage, daysRemaining, expiresAt, tier } = info;

  const color = stage === "1d"
    ? { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)", text: "rgb(248,113,113)" }
    : stage === "3d"
      ? { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", text: "rgb(245,158,11)" }
      : { bg: "rgba(99,102,241,0.10)", border: "rgba(99,102,241,0.25)", text: "rgb(129,140,248)" };

  const heading = stage === "1d"
    ? "Gói sắp hết hạn trong 24 giờ"
    : stage === "3d"
      ? `Gói còn ${daysRemaining} ngày`
      : `Gói sẽ hết hạn trong ${daysRemaining} ngày`;

  const expiryStr = `${String(expiresAt.getDate()).padStart(2, "0")}/${String(expiresAt.getMonth() + 1).padStart(2, "0")}/${expiresAt.getFullYear()} ${String(expiresAt.getHours()).padStart(2, "0")}:${String(expiresAt.getMinutes()).padStart(2, "0")}`;

  return (
    <div
      className="mb-4 flex items-center gap-3 rounded-2xl px-4 py-3"
      style={{ background: color.bg, border: `1px solid ${color.border}` }}
    >
      <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: color.text }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: color.text }}>{heading}</p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--tx-m)" }}>
          Gói {tier?.toUpperCase()} hết hạn vào <b>{expiryStr}</b>. Sau đó shop tự hạ về FREE — không thể tạo đơn mới.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/tier-pricing")}
        className="shrink-0 rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider transition hover:opacity-80"
        style={{ background: color.text, color: "#fff" }}
      >
        Gia hạn ngay
      </button>
      <button
        type="button"
        onClick={() => {
          if (info.sellerId) {
            window.localStorage.setItem(getDismissKey(info.sellerId, stage), "1");
          }
          setDismissed(true);
        }}
        className="shrink-0 rounded-lg p-1.5 transition hover:bg-black/10"
        style={{ color: color.text }}
        title="Ẩn"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
