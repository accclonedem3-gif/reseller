import { useMutation } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Equal, Loader2, Wallet, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

export type AdjustBalanceTarget = {
  id: string; // userId or sellerId
  username: string;
  displayName?: string | null;
  walletBalance: number;
};

type AdjustAction = "topup" | "deduct" | "set";

const QUICK_AMOUNTS = [50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000];

export function AdjustBalanceModal({
  account,
  onClose,
  onSuccess,
}: {
  account: AdjustBalanceTarget;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const overlayRef = useRef<HTMLDivElement>(null);

  const [action, setAction] = useState<AdjustAction>("topup");
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");

  const currentBalance = account.walletBalance || 0;
  const parsedAmount = Math.max(0, Number(amountStr.replace(/[^0-9]/g, "")) || 0);

  const { newBalance, delta, isInvalidDeduct } = useMemo(() => {
    let next = currentBalance;
    let d = 0;
    let invalidDeduct = false;

    if (action === "topup") {
      d = parsedAmount;
      next = currentBalance + parsedAmount;
    } else if (action === "deduct") {
      d = -parsedAmount;
      next = currentBalance - parsedAmount;
      if (next < 0) {
        invalidDeduct = true;
      }
    } else if (action === "set") {
      d = parsedAmount - currentBalance;
      next = parsedAmount;
    }

    return { newBalance: next, delta: d, isInvalidDeduct: invalidDeduct };
  }, [action, currentBalance, parsedAmount]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        action,
        amount: parsedAmount,
        note: note.trim() || undefined,
      };
      const res = await api.post(`/admin/sellers/${account.id}/balance`, payload);
      return res.data;
    },
    onSuccess: (data) => {
      const actionText =
        action === "topup" ? "Cộng tiền thành công"
        : action === "deduct" ? "Trừ tiền thành công"
        : "Đặt số dư thành công";
      showToast({
        tone: "success",
        message: `${actionText}: ${account.displayName || account.username} có số dư mới là ${formatCurrency(data.balanceAfter)}.`,
      });
      onSuccess();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      showToast({
        tone: "error",
        message: typeof msg === "string" ? msg : "Không thể điều chỉnh số dư.",
      });
    },
  });

  const canSubmit =
    !mutation.isPending &&
    parsedAmount > 0 &&
    !isInvalidDeduct;

  function handleQuickAdd(val: number) {
    if (action === "set") {
      setAmountStr(val.toString());
    } else {
      const current = Number(amountStr.replace(/[^0-9]/g, "")) || 0;
      setAmountStr((current + val).toString());
    }
  }

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current && !mutation.isPending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#172238] p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Điều chỉnh số dư</h2>
              <p className="text-xs text-slate-400 truncate max-w-[240px]">
                {account.displayName || account.username} ({account.username})
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={onClose}
            className="text-slate-400 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Current Balance Card */}
        <div className="rounded-2xl border border-white/6 bg-[#0f172a] p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Số dư hiện tại
            </p>
            <p className="text-xl font-black text-white mt-0.5">
              {formatCurrency(currentBalance)}
            </p>
          </div>
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300">
            Ví Seller
          </span>
        </div>

        {/* Action Switcher */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Hành động
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setAction("topup")}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition ${
                action === "topup"
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 shadow-sm"
                  : "border-white/6 bg-[#111c30] text-slate-400 hover:text-white"
              }`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Cộng (+)
            </button>
            <button
              type="button"
              onClick={() => setAction("deduct")}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition ${
                action === "deduct"
                  ? "border-rose-500/50 bg-rose-500/15 text-rose-300 shadow-sm"
                  : "border-white/6 bg-[#111c30] text-slate-400 hover:text-white"
              }`}
            >
              <ArrowDownRight className="h-3.5 w-3.5" />
              Trừ (-)
            </button>
            <button
              type="button"
              onClick={() => setAction("set")}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition ${
                action === "set"
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-300 shadow-sm"
                  : "border-white/6 bg-[#111c30] text-slate-400 hover:text-white"
              }`}
            >
              <Equal className="h-3.5 w-3.5" />
              Đặt số dư (=)
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {action === "set" ? "Số dư mong muốn (VNĐ)" : "Số tiền điều chỉnh (VNĐ)"}
            </label>
            {parsedAmount > 0 && (
              <span className="text-xs font-bold text-emerald-400">
                {formatCurrency(parsedAmount)}
              </span>
            )}
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={amountStr}
            placeholder="Nhập số tiền..."
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, "");
              if (!raw) {
                setAmountStr("");
                return;
              }
              setAmountStr(Number(raw).toLocaleString("vi-VN"));
            }}
            className="w-full rounded-xl border border-white/10 bg-[#111c30] px-4 py-3 text-base font-semibold text-white outline-none focus:border-emerald-400/60 placeholder:text-slate-600"
          />

          {/* Quick buttons */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_AMOUNTS.map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => handleQuickAdd(val)}
                className="rounded-lg border border-white/6 bg-[#111c30] px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-white/15 hover:text-white transition"
              >
                +{val >= 1_000_000 ? `${val / 1_000_000}M` : `${val / 1_000}k`}
              </button>
            ))}
            {amountStr && (
              <button
                type="button"
                onClick={() => setAmountStr("")}
                className="rounded-lg border border-white/6 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20 transition"
              >
                Xóa
              </button>
            )}
          </div>
        </div>

        {/* Note / Reason */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Lý do / Ghi chú <span className="text-slate-500 font-normal">(tùy chọn)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="VD: Nạp bù đơn PayOS, khuyến mãi, hoàn tiền..."
            className="w-full rounded-xl border border-white/10 bg-[#111c30] px-3.5 py-2.5 text-xs text-white outline-none focus:border-emerald-400/60 placeholder:text-slate-600"
          />
        </div>

        {/* Dynamic Preview */}
        {parsedAmount > 0 && (
          <div
            className={`rounded-2xl border p-3.5 text-xs transition ${
              isInvalidDeduct
                ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                : "border-white/8 bg-[#0f172a]"
            }`}
          >
            {isInvalidDeduct ? (
              <p className="font-semibold text-rose-400">
                ⚠ Không thể trừ quá số dư hiện có ({formatCurrency(currentBalance)}).
              </p>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-400">Số dư sau khi lưu:</span>
                  <p className="text-base font-black text-white mt-0.5">
                    {formatCurrency(newBalance)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500">Biến động</span>
                  <p
                    className={`font-bold ${
                      delta > 0
                        ? "text-emerald-400"
                        : delta < 0
                        ? "text-rose-400"
                        : "text-slate-400"
                    }`}
                  >
                    {delta > 0 ? `+${formatCurrency(delta)}` : delta < 0 ? `-${formatCurrency(Math.abs(delta))}` : "0đ"}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Hủy
          </Button>
          <Button
            type="button"
            className={`flex-1 font-bold ${
              action === "deduct"
                ? "bg-rose-600 hover:bg-rose-500 text-white"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                Đang lưu...
              </>
            ) : (
              "Xác nhận lưu"
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
