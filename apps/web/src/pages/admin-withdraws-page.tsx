import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";

type WithdrawStatus = "PENDING" | "APPROVED" | "REJECTED";

type WithdrawRow = {
  id: string;
  amount: string | number;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  note: string | null;
  status: WithdrawStatus;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  seller: {
    id: string;
    displayName: string | null;
    user: { email: string } | null;
    wallet: { balance: string | number } | null;
  } | null;
  reviewedBy: { id: string; email: string } | null;
};

function statusTone(status: WithdrawStatus) {
  if (status === "APPROVED") return "success" as const;
  if (status === "REJECTED") return "danger" as const;
  return "warning" as const;
}

export function AdminWithdrawsPage() {
  const [filterStatus, setFilterStatus] = useState<WithdrawStatus | "">("PENDING");
  const queryClient = useQueryClient();

  const query = useQuery<WithdrawRow[]>({
    queryKey: ["admin", "withdraw-requests", filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      return api.get(`/admin/withdraw-requests?${params}`).then((r) => r.data);
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api.post(`/admin/withdraw-requests/${id}/approve`, { note }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "withdraw-requests"] });
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.message || "Duyệt thất bại.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/admin/withdraw-requests/${id}/reject`, { reason }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "withdraw-requests"] });
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.message || "Từ chối thất bại.");
    },
  });

  const handleApprove = (row: WithdrawRow) => {
    const note = window.prompt(
      `Duyệt lệnh rút ${formatCurrency(Number(row.amount))} cho ${row.seller?.displayName ?? "?"}?\n\n` +
      `Chuyển khoản tới:\n${row.bankName} | ${row.bankAccountNumber} | ${row.bankAccountName}\n\n` +
      `Ghi chú (tuỳ chọn, ví dụ mã giao dịch ngân hàng):`,
      "",
    );
    if (note === null) return;
    approveMutation.mutate({ id: row.id, note: note.trim() || undefined });
  };

  const handleReject = (row: WithdrawRow) => {
    const reason = window.prompt(
      `Từ chối lệnh rút ${formatCurrency(Number(row.amount))} của ${row.seller?.displayName ?? "?"}?\n\nLý do từ chối:`,
      "",
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      window.alert("Lý do từ chối phải tối thiểu 3 ký tự.");
      return;
    }
    rejectMutation.mutate({ id: row.id, reason: trimmed });
  };

  const rows = query.data || [];

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Quản trị tài chính"
        title="Lệnh rút tiền của seller"
        description="Duyệt hoặc từ chối các lệnh rút từ ví seller. Khi duyệt, số dư ví seller sẽ bị trừ ngay và ledger ghi nhận."
      />

      <div className="flex items-center gap-2">
        {(["PENDING", "APPROVED", "REJECTED", ""] as const).map((s) => (
          <Button
            key={s || "all"}
            size="sm"
            variant={filterStatus === s ? "primary" : "secondary"}
            onClick={() => setFilterStatus(s)}
          >
            {s === "" ? "Tất cả" : s === "PENDING" ? "Chờ duyệt" : s === "APPROVED" ? "Đã duyệt" : "Đã từ chối"}
          </Button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">Không có lệnh rút nào.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/6">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Seller</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Số tiền</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ngân hàng</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Trạng thái</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tạo lúc</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/4">
                    <td className="px-4 py-3">
                      <p className="text-white">{row.seller?.displayName || "—"}</p>
                      <p className="text-xs text-slate-500">{row.seller?.user?.email || "—"}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Ví hiện tại: {formatCurrency(Number(row.seller?.wallet?.balance || 0))}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-white tabular-nums">
                      {formatCurrency(Number(row.amount))}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white">{row.bankName || "—"}</p>
                      <p className="font-mono text-xs text-slate-300">{row.bankAccountNumber}</p>
                      <p className="text-xs text-slate-500">{row.bankAccountName}</p>
                      {row.note && <p className="mt-1 text-[11px] italic text-slate-400">Ghi chú: {row.note}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(row.status)}>
                        {row.status === "PENDING" ? "Chờ duyệt" : row.status === "APPROVED" ? "Đã duyệt" : "Đã từ chối"}
                      </Badge>
                      {row.status === "REJECTED" && row.rejectReason && (
                        <p className="mt-1 max-w-[200px] text-[11px] text-rose-400">{row.rejectReason}</p>
                      )}
                      {row.reviewedBy && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          bởi {row.reviewedBy.email}
                          {row.reviewedAt && ` · ${formatDate(row.reviewedAt)}`}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400 tabular-nums">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === "PENDING" ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleApprove(row)}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            <Check className="h-3.5 w-3.5" /> Duyệt
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleReject(row)}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            <X className="h-3.5 w-3.5" /> Từ chối
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
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
