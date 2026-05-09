import type { AxiosError } from "axios";
import {
  Clock3,
  RefreshCcw,
  Send,
  ShieldCheck,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { Field } from "@/components/dashboard/field";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { CardHeader } from "@/components/ui/card-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";
import { hasSellerCapability } from "@/lib/seller-access";

const T = {
  vi: {
    gateTitle: "Tính năng chưa được kích hoạt cho tài khoản này",
    gateDesc: "FREE accounts stay read-only. PRO and ULTRA accounts can manage warranty cases when selling features are active.",
    title: "Warranty claims",
    desc: "Track claims by order code, resolve manual replacements, reject invalid requests, and keep owner-facing escalation work in one queue.",
    statOpen: "Open queue",
    statManual: "Manual",
    statResolved: "Resolved",
    refresh: "Refresh queue",
    filterAll: "Tất cả",
    filterPending: "Pending",
    filterStock: "Chờ stock",
    filterReview: "Chờ review",
    filterManual: "Manual",
    filterAutoDone: "Auto done",
    filterManualDone: "Manual done",
    filterRejected: "Rejected",
    emptyFilter: "Chưa có claim nào trong bộ lọc hiện tại. Claim sẽ xuất hiện khi khách gửi yêu cầu bảo hành qua bot.",
    noWarranty: "Không có BH",
    toastResolved: "Đã xử lý claim bảo hành thủ công.",
    toastRejected: "Đã từ chối claim bảo hành.",
    toastError: "Có lỗi xảy ra. Hãy thử lại.",
    labelCustomer: "Khách",
    labelTelegram: "Telegram",
    labelMode: "Mode",
    labelOrder: "Order",
    labelClaimCount: "Số claim",
    labelWarranty: "BH",
    labelUpdated: "Cập nhật",
    labelClosed: "Đóng",
    labelNote: "Ghi chú",
    resolveLabel: "Resolve manually",
    resolveDesc: "Paste replacement account info or delivery text when owner handles the claim manually.",
    resolvePh: "Tai khoan thay the / thong tin giao lai",
    resolveNotePh: "Ghi chu noi bo hoac thong diep gui lai cho khach",
    resolving: "Đang lưu...",
    resolveBtn: "Resolve manually",
    rejectLabel: "Reject claim",
    rejectDesc: "Use this when the claim is invalid, expired, duplicated, or cannot be accepted.",
    rejectPh: "Ly do tu choi claim",
    rejecting: "Đang lưu...",
    rejectBtn: "Reject claim",
  },
  en: {
    gateTitle: "This feature is not activated for this account",
    gateDesc: "FREE accounts stay read-only. PRO and ULTRA accounts can manage warranty cases when selling features are active.",
    title: "Warranty claims",
    desc: "Track claims by order code, resolve manual replacements, reject invalid requests, and keep owner-facing escalation work in one queue.",
    statOpen: "Open queue",
    statManual: "Manual",
    statResolved: "Resolved",
    refresh: "Refresh queue",
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
    labelCustomer: "Customer",
    labelTelegram: "Telegram",
    labelMode: "Mode",
    labelOrder: "Order",
    labelClaimCount: "Claims",
    labelWarranty: "Warranty",
    labelUpdated: "Updated",
    labelClosed: "Closed",
    labelNote: "Note",
    resolveLabel: "Resolve manually",
    resolveDesc: "Paste replacement account info or delivery text when owner handles the claim manually.",
    resolvePh: "Replacement account / delivery info",
    resolveNotePh: "Internal note or message to send back to customer",
    resolving: "Saving...",
    resolveBtn: "Resolve manually",
    rejectLabel: "Reject claim",
    rejectDesc: "Use this when the claim is invalid, expired, duplicated, or cannot be accepted.",
    rejectPh: "Reason for rejection",
    rejecting: "Saving...",
    rejectBtn: "Reject claim",
  },
  th: {
    gateTitle: "ฟีเจอร์นี้ยังไม่ได้เปิดใช้งานสำหรับบัญชีนี้",
    gateDesc: "บัญชี FREE อ่านได้อย่างเดียว บัญชี PRO และ ULTRA สามารถจัดการกรณีการรับประกันเมื่อฟีเจอร์การขายเปิดใช้งาน",
    title: "คำขอรับประกัน",
    desc: "ติดตามคำขอตามรหัสคำสั่งซื้อ แก้ไขการเปลี่ยนทดแทนด้วยตนเอง ปฏิเสธคำขอที่ไม่ถูกต้อง และจัดการงานยกระดับในคิวเดียว",
    statOpen: "คิวเปิด",
    statManual: "แมนนวล",
    statResolved: "แก้ไขแล้ว",
    refresh: "รีเฟรชคิว",
    filterAll: "ทั้งหมด",
    filterPending: "รอดำเนินการ",
    filterStock: "รอสต็อก",
    filterReview: "รอตรวจสอบ",
    filterManual: "แมนนวล",
    filterAutoDone: "จัดการอัตโนมัติ",
    filterManualDone: "จัดการแล้ว",
    filterRejected: "ปฏิเสธแล้ว",
    emptyFilter: "ยังไม่มีคำขอในตัวกรองปัจจุบัน คำขอจะปรากฏเมื่อลูกค้าส่งคำขอรับประกันผ่านบอท",
    noWarranty: "ไม่มีการรับประกัน",
    toastResolved: "ดำเนินการคำขอรับประกันด้วยตนเองแล้ว",
    toastRejected: "ปฏิเสธคำขอรับประกันแล้ว",
    toastError: "เกิดข้อผิดพลาด กรุณาลองใหม่",
    labelCustomer: "ลูกค้า",
    labelTelegram: "Telegram",
    labelMode: "โหมด",
    labelOrder: "คำสั่งซื้อ",
    labelClaimCount: "จำนวนคำขอ",
    labelWarranty: "การรับประกัน",
    labelUpdated: "อัปเดต",
    labelClosed: "ปิด",
    labelNote: "หมายเหตุ",
    resolveLabel: "แก้ไขด้วยตนเอง",
    resolveDesc: "วางข้อมูลบัญชีทดแทนหรือข้อความจัดส่งเมื่อเจ้าของจัดการคำขอด้วยตนเอง",
    resolvePh: "บัญชีทดแทน / ข้อมูลการจัดส่ง",
    resolveNotePh: "บันทึกภายในหรือข้อความส่งกลับให้ลูกค้า",
    resolving: "กำลังบันทึก...",
    resolveBtn: "แก้ไขด้วยตนเอง",
    rejectLabel: "ปฏิเสธคำขอ",
    rejectDesc: "ใช้เมื่อคำขอไม่ถูกต้อง หมดอายุ ซ้ำซ้อน หรือไม่สามารถรับได้",
    rejectPh: "เหตุผลในการปฏิเสธ",
    rejecting: "กำลังบันทึก...",
    rejectBtn: "ปฏิเสธคำขอ",
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

  if (Array.isArray(apiMessage)) {
    return apiMessage.join(", ");
  }

  if (typeof apiMessage === "string" && apiMessage.trim()) {
    return apiMessage;
  }

  return fallback;
}

function getTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = String(status || "").toLowerCase();

  if (["auto_resolved", "resolved_manual"].includes(normalized)) {
    return "success";
  }

  if (["pending", "pending_stock", "pending_manual", "pending_review"].includes(normalized)) {
    return "warning";
  }

  if (["rejected", "failed"].includes(normalized)) {
    return "danger";
  }

  return "neutral";
}

function isClosedClaim(status: string) {
  return ["auto_resolved", "resolved_manual", "rejected"].includes(
    String(status || "").toLowerCase(),
  );
}

export function WarrantyClaimsPage() {
  const { lang } = useLang();
  const t = T[lang];

  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [resolutionForms, setResolutionForms] = useState<
    Record<string, { deliveredAccountText: string; resolutionNote: string }>
  >({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const canManageWarranty = hasSellerCapability(session, "warranty_manage");

  const statusFilters = [
    { value: "all", label: t.filterAll },
    { value: "pending", label: t.filterPending },
    { value: "pending_stock", label: t.filterStock },
    { value: "pending_review", label: t.filterReview },
    { value: "pending_manual", label: t.filterManual },
    { value: "auto_resolved", label: t.filterAutoDone },
    { value: "resolved_manual", label: t.filterManualDone },
    { value: "rejected", label: t.filterRejected },
  ] as const;

  const claimsQuery = useQuery({
    queryKey: ["warranty", "claims", statusFilter],
    queryFn: async () =>
      (
        await api.get<WarrantyClaim[]>("/warranty/claims", {
          params: statusFilter !== "all" ? { status: statusFilter } : undefined,
        })
      ).data,
    enabled: canManageWarranty,
  });

  const refreshClaims = async () => {
    await queryClient.invalidateQueries({ queryKey: ["warranty", "claims"] });
  };

  const resolveMutation = useMutation({
    mutationFn: async (claimId: string) =>
      api.post(`/warranty/claims/${claimId}/resolve-manual`, {
        deliveredAccountText: resolutionForms[claimId]?.deliveredAccountText || "",
        resolutionNote: resolutionForms[claimId]?.resolutionNote || undefined,
      }),
    onSuccess: async (_response, claimId) => {
      showToast({
        tone: "success",
        message: t.toastResolved,
      });
      setResolutionForms((current) => ({
        ...current,
        [claimId]: { deliveredAccountText: "", resolutionNote: "" },
      }));
      await refreshClaims();
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getApiErrorMessage(error, t.toastError),
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (claimId: string) =>
      api.post(`/warranty/claims/${claimId}/reject`, {
        reason: rejectReasons[claimId] || "",
      }),
    onSuccess: async (_response, claimId) => {
      showToast({
        tone: "success",
        message: t.toastRejected,
      });
      setRejectReasons((current) => ({ ...current, [claimId]: "" }));
      await refreshClaims();
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getApiErrorMessage(error, t.toastError),
      });
    },
  });

  const claims = claimsQuery.data || [];
  const openCount = useMemo(
    () => claims.filter((claim) => !isClosedClaim(claim.status)).length,
    [claims],
  );
  const manualCount = useMemo(
    () => claims.filter((claim) => claim.status === "pending_manual").length,
    [claims],
  );
  const resolvedCount = useMemo(
    () =>
      claims.filter((claim) =>
        ["auto_resolved", "resolved_manual"].includes(claim.status),
      ).length,
    [claims],
  );

  if (!canManageWarranty) {
    return (
      <Card>
        <CardHeader icon={ShieldCheck} title="Warranty queue" iconCls="text-emerald-400" iconBg="bg-emerald-500/10" />
        <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>
          {t.gateTitle}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          {t.gateDesc}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Warranty"
        title={t.title}
        description={t.desc}
        gradient="emerald"
        stats={[
          { icon: Clock3, label: t.statOpen, value: openCount, iconCls: "text-emerald-400", bgCls: "bg-emerald-500/15" },
          { icon: ShieldQuestion, label: t.statManual, value: manualCount, iconCls: "text-amber-400", bgCls: "bg-amber-500/15" },
          { icon: ShieldCheck, label: t.statResolved, value: resolvedCount, iconCls: "text-sky-400", bgCls: "bg-sky-500/15" },
        ]}
        actions={
          <Button
            onClick={() => { void refreshClaims(); }}
            variant="secondary"
          >
            <RefreshCcw className="h-4 w-4" />
            {t.refresh}
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-3">
          {statusFilters.map((filter) => {
            const isActive = filter.value === statusFilter;

            return (
              <Button
                key={filter.value}
                className={isActive ? "" : "opacity-90"}
                onClick={() => setStatusFilter(filter.value)}
                variant={isActive ? "primary" : "secondary"}
              >
                {filter.label}
              </Button>
            );
          })}
        </div>
      </Card>

      {claims.length === 0 ? (
        <Card>
          <CardHeader icon={ShieldQuestion} title="Warranty queue" iconCls="text-amber-400" iconBg="bg-amber-500/10" />
          <p className="text-sm text-slate-500">
            {t.emptyFilter}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {claims.map((claim) => {
            const closed = isClosedClaim(claim.status);

            return (
              <Card key={claim.id}>
                {/* Claim header */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 mb-4" style={{ borderBottom: "1px solid var(--bd)" }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded-[7px] px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase"
                            style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                        {claim.orderCode}
                      </span>
                      <span className="text-[11px] text-slate-500">Claim #{claim.claimNumber} • {formatDate(claim.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-base font-semibold" style={{ color: "var(--tx)" }}>
                      {claim.productName}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={getTone(claim.status)}>{formatStatusLabel(claim.status)}</Badge>
                    <Badge tone="neutral">
                      {claim.warrantyPolicy ? formatStatusLabel(claim.warrantyPolicy) : t.noWarranty}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  {[
                    {
                      rows: [
                        `${t.labelCustomer}: ${claim.customer?.name || claim.customer?.telegramUsername || "-"}`,
                        `${t.labelTelegram}: ${claim.customer?.telegramUsername ? `@${claim.customer.telegramUsername}` : claim.customer?.telegramUserId || "-"}`,
                        `${t.labelMode}: ${formatStatusLabel(claim.deliveryMode)}`,
                      ],
                    },
                    {
                      rows: [
                        `${t.labelOrder}: ${formatStatusLabel(claim.order?.status)}`,
                        `${t.labelClaimCount}: ${claim.order?.warrantyClaimCount || 0}`,
                        `${t.labelWarranty}: ${formatDate(claim.order?.warrantyStartedAt)} → ${formatDate(claim.order?.warrantyExpiresAt)}`,
                      ],
                    },
                    {
                      rows: [
                        `${t.labelUpdated}: ${formatDate(claim.updatedAt)}`,
                        `${t.labelClosed}: ${formatDate(claim.resolvedAt)}`,
                        `${t.labelNote}: ${claim.resolutionNote || "-"}`,
                      ],
                    },
                  ].map((col, i) => (
                    <div
                      key={i}
                      className="rounded-[14px] px-3.5 py-3 space-y-1.5"
                      style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                    >
                      {col.rows.map((row) => (
                        <p key={row} className="text-[13px] leading-5 text-slate-500">{row}</p>
                      ))}
                    </div>
                  ))}
                </div>

                {claim.deliveredAccountText ? (
                  <div
                    className="mt-3 rounded-[14px] px-3.5 py-3"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">
                      Replacement / delivery info
                    </p>
                    <pre className="whitespace-pre-wrap font-mono text-xs" style={{ color: "var(--tx)" }}>
                      {claim.deliveredAccountText}
                    </pre>
                  </div>
                ) : null}

                {!closed ? (
                  <div className="mt-6 grid gap-4 xl:grid-cols-2">
                    <Field
                      label={t.resolveLabel}
                      description={t.resolveDesc}
                    >
                      <div className="space-y-3">
                        <Textarea
                          value={resolutionForms[claim.id]?.deliveredAccountText || ""}
                          onChange={(event) =>
                            setResolutionForms((current) => ({
                              ...current,
                              [claim.id]: {
                                deliveredAccountText: event.target.value,
                                resolutionNote: current[claim.id]?.resolutionNote || "",
                              },
                            }))
                          }
                          placeholder={t.resolvePh}
                        />
                        <Textarea
                          value={resolutionForms[claim.id]?.resolutionNote || ""}
                          onChange={(event) =>
                            setResolutionForms((current) => ({
                              ...current,
                              [claim.id]: {
                                deliveredAccountText: current[claim.id]?.deliveredAccountText || "",
                                resolutionNote: event.target.value,
                              },
                            }))
                          }
                          placeholder={t.resolveNotePh}
                        />
                        <Button
                          disabled={resolveMutation.isPending}
                          onClick={() => resolveMutation.mutate(claim.id)}
                        >
                          <Send className="h-4 w-4" />
                          {resolveMutation.isPending ? t.resolving : t.resolveBtn}
                        </Button>
                      </div>
                    </Field>

                    <Field
                      label={t.rejectLabel}
                      description={t.rejectDesc}
                    >
                      <div className="space-y-3">
                        <Textarea
                          value={rejectReasons[claim.id] || ""}
                          onChange={(event) =>
                            setRejectReasons((current) => ({
                              ...current,
                              [claim.id]: event.target.value,
                            }))
                          }
                          placeholder={t.rejectPh}
                        />
                        <Button
                          disabled={rejectMutation.isPending}
                          onClick={() => rejectMutation.mutate(claim.id)}
                          variant="danger"
                        >
                          <XCircle className="h-4 w-4" />
                          {rejectMutation.isPending ? t.rejecting : t.rejectBtn}
                        </Button>
                      </div>
                    </Field>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
