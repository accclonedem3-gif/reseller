import type { AxiosError } from "axios";
import {
  Check,
  Copy,
  Download,
  RefreshCcw,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";
import { hasSellerCapability } from "@/lib/seller-access";

const T = {
  vi: {
    gateTitle: "Tính năng chưa được kích hoạt cho tài khoản này",
    gateDesc: "FREE accounts stay read-only. PRO và ULTRA có thể quản lý bảo hành khi tính năng bán hàng được kích hoạt.",
    title: "Bảo hành",
    desc: "Quản lý yêu cầu bảo hành từ khách hàng",
    statTotal: "TẤT CẢ",
    statTotalDesc: "Tổng yêu cầu",
    statOpen: "ĐANG CHỜ",
    statOpenDesc: "Cần xử lý",
    statManual: "THỦ CÔNG",
    statManualDesc: "Chờ duyệt tay",
    statResolved: "HOÀN TẤT",
    statResolvedDesc: "Đã xử lý xong",
    refresh: "Làm mới",
    export: "Xuất báo cáo",
    filterAll: "Tất cả",
    filterPending: "Đang chờ",
    filterStock: "Chờ hàng",
    filterReview: "Chờ duyệt",
    filterManual: "Thủ công",
    filterAutoDone: "Tự động xong",
    filterManualDone: "Thủ công xong",
    filterRejected: "Từ chối",
    emptyFilter: "Chưa có claim nào trong bộ lọc này. Claim sẽ xuất hiện khi khách gửi yêu cầu bảo hành qua bot.",
    noWarranty: "Không có BH",
    toastResolved: "Đã xử lý claim bảo hành thủ công.",
    toastRejected: "Đã từ chối claim bảo hành.",
    toastError: "Có lỗi xảy ra. Hãy thử lại.",
    colCustomer: "KHÁCH HÀNG",
    colOrder: "ĐƠN HÀNG",
    colWarranty: "THỜI HẠN BẢO HÀNH",
    colClosed: "ĐÓNG LÚC",
    colDelivery: "THÔNG TIN GIAO THAY THẾ",
    copy: "Sao chép",
    copied: "Đã sao chép",
    totalClaims: (n: number) => `Tổng ${n} claim`,
    resolveLabel: "Xử lý thủ công",
    resolveDesc: "Dán thông tin tài khoản thay thế khi xử lý claim thủ công.",
    resolvePh: "Tài khoản thay thế / thông tin giao lại",
    resolveNotePh: "Ghi chú nội bộ hoặc tin nhắn gửi lại cho khách",
    resolving: "Đang lưu...",
    resolveBtn: "Xử lý thủ công",
    rejectLabel: "Từ chối claim",
    rejectDesc: "Dùng khi claim không hợp lệ, hết hạn hoặc trùng lặp.",
    rejectPh: "Lý do từ chối claim",
    rejecting: "Đang lưu...",
    rejectBtn: "Từ chối claim",
    warrantyUntil: "đến",
    modeLabel: "Mode",
  },
  en: {
    gateTitle: "This feature is not activated for this account",
    gateDesc: "FREE accounts stay read-only. PRO and ULTRA accounts can manage warranty cases when selling features are active.",
    title: "Warranty",
    desc: "Manage warranty claims from customers",
    statTotal: "ALL",
    statTotalDesc: "Total claims",
    statOpen: "PENDING",
    statOpenDesc: "Needs action",
    statManual: "MANUAL",
    statManualDesc: "Pending review",
    statResolved: "RESOLVED",
    statResolvedDesc: "Processed",
    refresh: "Refresh",
    export: "Export",
    filterAll: "All",
    filterPending: "Pending",
    filterStock: "Pending stock",
    filterReview: "Pending review",
    filterManual: "Manual",
    filterAutoDone: "Auto done",
    filterManualDone: "Manual done",
    filterRejected: "Rejected",
    emptyFilter: "No claims in the current filter. Claims will appear when customers submit warranty requests through the bot.",
    noWarranty: "No warranty",
    toastResolved: "Manual warranty claim processed.",
    toastRejected: "Warranty claim rejected.",
    toastError: "An error occurred. Please try again.",
    colCustomer: "CUSTOMER",
    colOrder: "ORDER",
    colWarranty: "WARRANTY PERIOD",
    colClosed: "CLOSED AT",
    colDelivery: "REPLACEMENT INFO",
    copy: "Copy",
    copied: "Copied",
    totalClaims: (n: number) => `${n} total claim${n !== 1 ? "s" : ""}`,
    resolveLabel: "Resolve manually",
    resolveDesc: "Paste replacement account info or delivery text when handling the claim manually.",
    resolvePh: "Replacement account / delivery info",
    resolveNotePh: "Internal note or message to send back to customer",
    resolving: "Saving...",
    resolveBtn: "Resolve manually",
    rejectLabel: "Reject claim",
    rejectDesc: "Use when the claim is invalid, expired, or cannot be accepted.",
    rejectPh: "Reason for rejection",
    rejecting: "Saving...",
    rejectBtn: "Reject claim",
    warrantyUntil: "until",
    modeLabel: "Mode",
  },
  th: {
    gateTitle: "ฟีเจอร์นี้ยังไม่ได้เปิดใช้งานสำหรับบัญชีนี้",
    gateDesc: "บัญชี FREE อ่านได้อย่างเดียว บัญชี PRO และ ULTRA สามารถจัดการกรณีการรับประกันได้",
    title: "การรับประกัน",
    desc: "จัดการคำขอรับประกันจากลูกค้า",
    statTotal: "ทั้งหมด",
    statTotalDesc: "คำขอทั้งหมด",
    statOpen: "รอดำเนินการ",
    statOpenDesc: "ต้องดำเนินการ",
    statManual: "แมนนวล",
    statManualDesc: "รอตรวจสอบ",
    statResolved: "เสร็จสิ้น",
    statResolvedDesc: "ดำเนินการแล้ว",
    refresh: "รีเฟรช",
    export: "ส่งออก",
    filterAll: "ทั้งหมด",
    filterPending: "รอดำเนินการ",
    filterStock: "รอสต็อก",
    filterReview: "รอตรวจสอบ",
    filterManual: "แมนนวล",
    filterAutoDone: "จัดการอัตโนมัติ",
    filterManualDone: "จัดการแล้ว",
    filterRejected: "ปฏิเสธแล้ว",
    emptyFilter: "ยังไม่มีคำขอในตัวกรองนี้",
    noWarranty: "ไม่มีการรับประกัน",
    toastResolved: "ดำเนินการคำขอรับประกันด้วยตนเองแล้ว",
    toastRejected: "ปฏิเสธคำขอรับประกันแล้ว",
    toastError: "เกิดข้อผิดพลาด กรุณาลองใหม่",
    colCustomer: "ลูกค้า",
    colOrder: "คำสั่งซื้อ",
    colWarranty: "ระยะเวลารับประกัน",
    colClosed: "ปิดเมื่อ",
    colDelivery: "ข้อมูลการส่งมอบทดแทน",
    copy: "คัดลอก",
    copied: "คัดลอกแล้ว",
    totalClaims: (n: number) => `ทั้งหมด ${n} คำขอ`,
    resolveLabel: "แก้ไขด้วยตนเอง",
    resolveDesc: "วางข้อมูลบัญชีทดแทนเมื่อจัดการคำขอด้วยตนเอง",
    resolvePh: "บัญชีทดแทน / ข้อมูลการจัดส่ง",
    resolveNotePh: "บันทึกภายในหรือข้อความส่งกลับให้ลูกค้า",
    resolving: "กำลังบันทึก...",
    resolveBtn: "แก้ไขด้วยตนเอง",
    rejectLabel: "ปฏิเสธคำขอ",
    rejectDesc: "ใช้เมื่อคำขอไม่ถูกต้องหรือหมดอายุ",
    rejectPh: "เหตุผลในการปฏิเสธ",
    rejecting: "กำลังบันทึก...",
    rejectBtn: "ปฏิเสธคำขอ",
    warrantyUntil: "ถึง",
    modeLabel: "โหมด",
  },
};

type WarrantyClaim = {
  id: string;
  orderId: string;
  orderCode: string;
  productName: string;
  claimNumber: number;
  status: string;
  warrantyPolicy: string | null;
  deliveryMode: string | null;
  deliveredAccountText: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  customer: {
    telegramUserId: string;
    telegramUsername: string | null;
    name: string | null;
  } | null;
  order: {
    status: string;
    warrantyClaimCount: number;
    warrantyStartedAt: string | null;
    warrantyExpiresAt: string | null;
  } | null;
};

function getApiErrorMessage(error: unknown, fallback: string) {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const apiMessage = axiosError.response?.data?.message;
  if (Array.isArray(apiMessage)) return apiMessage.join(", ");
  if (typeof apiMessage === "string" && apiMessage.trim()) return apiMessage;
  return fallback;
}

function getTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const s = String(status || "").toLowerCase();
  if (["auto_resolved", "resolved_manual"].includes(s)) return "success";
  if (["pending", "pending_stock", "pending_manual", "pending_review"].includes(s)) return "warning";
  if (["rejected", "failed"].includes(s)) return "danger";
  return "neutral";
}

function isClosedClaim(status: string) {
  return ["auto_resolved", "resolved_manual", "rejected"].includes(String(status || "").toLowerCase());
}

function StatusPill({ status }: { status: string }) {
  const tone = getTone(status);
  const style = {
    success: { dot: "bg-emerald-400", color: "rgb(52,211,153)", bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.2)" },
    warning: { dot: "bg-amber-400", color: "rgb(245,158,11)", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
    danger: { dot: "bg-rose-400", color: "rgb(248,113,113)", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)" },
    neutral: { dot: "bg-slate-400", color: "var(--tx-m)", bg: "var(--inp)", border: "var(--bd)" },
  }[tone];

  return (
    <span
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black"
      style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {formatStatusLabel(status)}
    </span>
  );
}

export function WarrantyClaimsPage() {
  const { lang } = useLang();
  const t = T[lang];

  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [copiedClaimId, setCopiedClaimId] = useState<string | null>(null);
  const [resolutionForms, setResolutionForms] = useState<
    Record<string, { deliveredAccountText: string; resolutionNote: string }>
  >({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const canManageWarranty = hasSellerCapability(session, "warranty_manage");

  const claimsQuery = useQuery({
    queryKey: ["warranty", "claims"],
    queryFn: async () => (await api.get<WarrantyClaim[]>("/warranty/claims")).data,
    enabled: canManageWarranty,
  });

  const allClaims = claimsQuery.data || [];

  const claims = useMemo(() => {
    if (statusFilter === "all") return allClaims;
    return allClaims.filter((c) => c.status === statusFilter);
  }, [allClaims, statusFilter]);

  const openCount    = useMemo(() => allClaims.filter((c) => !isClosedClaim(c.status)).length, [allClaims]);
  const manualCount  = useMemo(() => allClaims.filter((c) => c.status === "pending_manual").length, [allClaims]);
  const resolvedCount = useMemo(() => allClaims.filter((c) => ["auto_resolved", "resolved_manual"].includes(c.status)).length, [allClaims]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allClaims.length };
    for (const c of allClaims) counts[c.status] = (counts[c.status] || 0) + 1;
    return counts;
  }, [allClaims]);

  const statusFilters = [
    { value: "all",            label: t.filterAll },
    { value: "pending",        label: t.filterPending },
    { value: "pending_stock",  label: t.filterStock },
    { value: "pending_review", label: t.filterReview },
    { value: "pending_manual", label: t.filterManual },
    { value: "auto_resolved",  label: t.filterAutoDone },
    { value: "resolved_manual",label: t.filterManualDone },
    { value: "rejected",       label: t.filterRejected },
  ] as const;

  const resolveMutation = useMutation({
    mutationFn: async (claimId: string) =>
      api.post(`/warranty/claims/${claimId}/resolve-manual`, {
        deliveredAccountText: resolutionForms[claimId]?.deliveredAccountText || "",
        resolutionNote: resolutionForms[claimId]?.resolutionNote || undefined,
      }),
    onSuccess: async (_r, claimId) => {
      showToast({ tone: "success", message: t.toastResolved });
      setResolutionForms((c) => ({ ...c, [claimId]: { deliveredAccountText: "", resolutionNote: "" } }));
      await queryClient.invalidateQueries({ queryKey: ["warranty", "claims"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (claimId: string) =>
      api.post(`/warranty/claims/${claimId}/reject`, { reason: rejectReasons[claimId] || "" }),
    onSuccess: async (_r, claimId) => {
      showToast({ tone: "success", message: t.toastRejected });
      setRejectReasons((c) => ({ ...c, [claimId]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["warranty", "claims"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  const handleCopy = async (claimId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedClaimId(claimId);
      window.setTimeout(() => setCopiedClaimId((c) => (c === claimId ? null : c)), 1800);
    } catch {}
  };

  if (!canManageWarranty) {
    return (
      <Card>
        <CardHeader icon={ShieldCheck} title="Warranty queue" iconCls="text-emerald-400" iconBg="bg-emerald-500/10" />
        <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.gateTitle}</p>
        <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: "var(--tx-m)" }}>{t.gateDesc}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "rgb(249,115,22)" }}>{t.title}</h1>
          <p className="mt-1 text-[13px]" style={{ color: "var(--tx-m)" }}>{t.desc}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["warranty", "claims"] })}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {t.refresh}
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "rgba(20,184,166,0.15)", border: "1px solid rgba(20,184,166,0.3)", color: "rgb(20,184,166)" }}
          >
            <Download className="h-3.5 w-3.5" />
            {t.export}
          </button>
        </div>
      </div>

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t.statTotal,    desc: t.statTotalDesc,    value: allClaims.length, color: "var(--tx)",         border: "rgb(52,211,153)" },
          { label: t.statOpen,     desc: t.statOpenDesc,     value: openCount,        color: "rgb(249,115,22)",   border: "rgb(249,115,22)" },
          { label: t.statManual,   desc: t.statManualDesc,   value: manualCount,      color: "rgb(56,189,248)",   border: "rgb(56,189,248)" },
          { label: t.statResolved, desc: t.statResolvedDesc, value: resolvedCount,    color: "rgb(52,211,153)",   border: "rgb(52,211,153)" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl px-4 py-4"
            style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: `3px solid ${s.border}` }}
          >
            <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--tx-f)" }}>{s.label}</p>
            <p className="text-2xl font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
            <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5">
        {statusFilters.map((f) => {
          const active = f.value === statusFilter;
          const count = tabCounts[f.value] || 0;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-black transition"
              style={{
                background: active ? "rgba(249,115,22,0.15)" : "var(--surface)",
                border: `1px solid ${active ? "rgba(249,115,22,0.4)" : "var(--bd)"}`,
                color: active ? "rgb(249,115,22)" : "var(--tx-m)",
              }}
            >
              {f.label}
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums"
                style={{
                  background: active ? "rgba(249,115,22,0.2)" : "var(--inp)",
                  color: active ? "rgb(249,115,22)" : "var(--tx-f)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Claims list */}
      {claimsQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }} />
          ))}
        </div>
      ) : claims.length === 0 ? (
        <div className="rounded-2xl py-12 text-center" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
          <ShieldCheck className="mx-auto h-8 w-8 mb-3 opacity-20" style={{ color: "var(--tx)" }} />
          <p className="text-sm" style={{ color: "var(--tx-f)" }}>{t.emptyFilter}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {claims.map((claim) => {
            const closed = isClosedClaim(claim.status);
            const customerName = claim.customer?.name || claim.customer?.telegramUsername
              ? `${claim.customer?.name || ""}${claim.customer?.telegramUsername ? ` @${claim.customer.telegramUsername}` : ""}`.trim()
              : "—";
            const customerHandle = claim.customer?.telegramUsername ? `@${claim.customer.telegramUsername}` : claim.customer?.telegramUserId || "—";

            return (
              <div
                key={claim.id}
                className="rounded-2xl overflow-hidden"
                style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
              >
                {/* Row 1: order code + claim # + total + time */}
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ borderBottom: "1px solid var(--bd)" }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold"
                      style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
                    >
                      {claim.orderCode}
                    </span>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-black"
                      style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.2)", color: "rgb(249,115,22)" }}
                    >
                      Claim #{claim.claimNumber}
                    </span>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                      style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
                    >
                      {t.totalClaims(claim.order?.warrantyClaimCount || 1)}
                    </span>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "var(--tx-f)" }}>
                    {formatDate(claim.createdAt)}
                  </span>
                </div>

                {/* Row 2: product name + policy badge + status badge */}
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ borderBottom: "1px solid var(--bd)" }}
                >
                  <p className="text-[15px] font-black" style={{ color: "var(--tx)" }}>{claim.productName}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    {claim.warrantyPolicy && (
                      <span
                        className="rounded-md px-2.5 py-1 text-[11px] font-black uppercase"
                        style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
                      >
                        {formatStatusLabel(claim.warrantyPolicy)}
                      </span>
                    )}
                    <StatusPill status={claim.status} />
                  </div>
                </div>

                {/* Row 3: 4-column info grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0" style={{ borderBottom: "1px solid var(--bd)", "--tw-divide-opacity": 1, borderColor: "var(--bd)" } as any}>
                  {/* KHÁCH HÀNG */}
                  <div className="px-4 py-3" style={{ borderColor: "var(--bd)" }}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--tx-f)" }}>
                      {t.colCustomer}
                    </p>
                    <p className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{customerName}</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--tx-f)" }}>{customerHandle}</p>
                  </div>

                  {/* ĐƠN HÀNG */}
                  <div className="px-4 py-3" style={{ borderColor: "var(--bd)" }}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--tx-f)" }}>
                      {t.colOrder}
                    </p>
                    <p className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>
                      {formatStatusLabel(claim.order?.status)}
                    </p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--tx-f)" }}>
                      {t.modeLabel}: {formatStatusLabel(claim.deliveryMode)}
                    </p>
                  </div>

                  {/* THỜI HẠN BẢO HÀNH */}
                  <div className="px-4 py-3" style={{ borderColor: "var(--bd)" }}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--tx-f)" }}>
                      {t.colWarranty}
                    </p>
                    <p className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--tx)" }}>
                      {formatDate(claim.order?.warrantyStartedAt) || "—"}
                    </p>
                    {claim.order?.warrantyExpiresAt && (
                      <p className="mt-0.5 text-[12px] tabular-nums" style={{ color: "var(--tx-f)" }}>
                        {t.warrantyUntil} {formatDate(claim.order.warrantyExpiresAt)}
                      </p>
                    )}
                  </div>

                  {/* ĐÓNG LÚC */}
                  <div className="px-4 py-3" style={{ borderColor: "var(--bd)" }}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--tx-f)" }}>
                      {t.colClosed}
                    </p>
                    <p className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--tx)" }}>
                      {formatDate(claim.resolvedAt) || "—"}
                    </p>
                    {claim.resolutionNote && (
                      <p className="mt-0.5 line-clamp-1 text-[12px]" style={{ color: "var(--tx-f)" }}>
                        {claim.resolutionNote}
                      </p>
                    )}
                  </div>
                </div>

                {/* Row 4: delivered account text */}
                {claim.deliveredAccountText && (
                  <div
                    className="flex items-center justify-between gap-4 px-4 py-3"
                    style={{ borderBottom: !closed ? "1px solid var(--bd)" : undefined }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--tx-f)" }}>
                        {t.colDelivery}
                      </p>
                      <pre className="truncate font-mono text-[12px]" style={{ color: "var(--tx)" }}>
                        {claim.deliveredAccountText}
                      </pre>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(claim.id, claim.deliveredAccountText!)}
                      className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black transition hover:opacity-80 active:scale-95"
                      style={
                        copiedClaimId === claim.id
                          ? { background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)", color: "rgb(52,211,153)" }
                          : { background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }
                      }
                    >
                      {copiedClaimId === claim.id
                        ? <><Check className="h-3.5 w-3.5" /> {t.copied}</>
                        : <><Copy className="h-3.5 w-3.5" /> {t.copy}</>}
                    </button>
                  </div>
                )}

                {/* Action forms (only for open claims) */}
                {!closed && (
                  <div className="grid gap-4 px-4 py-4 xl:grid-cols-2">
                    {/* Resolve */}
                    <div>
                      <p className="text-[12px] font-black mb-0.5" style={{ color: "var(--tx)" }}>{t.resolveLabel}</p>
                      <p className="text-[11px] mb-2.5" style={{ color: "var(--tx-f)" }}>{t.resolveDesc}</p>
                      <div className="space-y-2.5">
                        <Textarea
                          value={resolutionForms[claim.id]?.deliveredAccountText || ""}
                          onChange={(e) =>
                            setResolutionForms((c) => ({
                              ...c,
                              [claim.id]: {
                                deliveredAccountText: e.target.value,
                                resolutionNote: c[claim.id]?.resolutionNote || "",
                              },
                            }))
                          }
                          placeholder={t.resolvePh}
                        />
                        <Textarea
                          value={resolutionForms[claim.id]?.resolutionNote || ""}
                          onChange={(e) =>
                            setResolutionForms((c) => ({
                              ...c,
                              [claim.id]: {
                                deliveredAccountText: c[claim.id]?.deliveredAccountText || "",
                                resolutionNote: e.target.value,
                              },
                            }))
                          }
                          placeholder={t.resolveNotePh}
                        />
                        <Button disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate(claim.id)}>
                          <Send className="h-4 w-4" />
                          {resolveMutation.isPending ? t.resolving : t.resolveBtn}
                        </Button>
                      </div>
                    </div>

                    {/* Reject */}
                    <div>
                      <p className="text-[12px] font-black mb-0.5" style={{ color: "var(--tx)" }}>{t.rejectLabel}</p>
                      <p className="text-[11px] mb-2.5" style={{ color: "var(--tx-f)" }}>{t.rejectDesc}</p>
                      <div className="space-y-2.5">
                        <Textarea
                          value={rejectReasons[claim.id] || ""}
                          onChange={(e) => setRejectReasons((c) => ({ ...c, [claim.id]: e.target.value }))}
                          placeholder={t.rejectPh}
                        />
                        <Button
                          variant="danger"
                          disabled={rejectMutation.isPending}
                          onClick={() => rejectMutation.mutate(claim.id)}
                        >
                          <XCircle className="h-4 w-4" />
                          {rejectMutation.isPending ? t.rejecting : t.rejectBtn}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
