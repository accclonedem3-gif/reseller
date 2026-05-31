import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  Download,
  FileText,
  History,
  Loader2,
  Package,
  PackageOpen,
  Shuffle,
  Upload,
  X,
} from "lucide-react";

import { useToast } from "@/components/ui/toast";

const MAX_UPLOAD_BYTES = 1024 * 1024; // 1MB

export type StockExtractMethod = "FIFO" | "LIFO" | "RANDOM";

export const EXTRACT_METHOD_OPTIONS: ReadonlyArray<{
  value: StockExtractMethod;
  label: string;
  description: string;
  icon: typeof ArrowDown;
}> = [
  {
    value: "FIFO",
    label: "FIFO — Cũ nhất trước",
    description: "Lấy các account nhập vào sớm nhất.",
    icon: ArrowDown,
  },
  {
    value: "LIFO",
    label: "LIFO — Mới nhất trước",
    description: "Lấy các account vừa nhập gần nhất.",
    icon: ArrowUp,
  },
  {
    value: "RANDOM",
    label: "RANDOM — Ngẫu nhiên",
    description: "Lấy ngẫu nhiên không trùng lặp.",
    icon: Shuffle,
  },
];

export type StockOperation = {
  id: string;
  createdAt: string | Date;
  operationType: "UPLOAD" | "EXTRACT";
  extractMethod?: StockExtractMethod | null;
  quantity: number;
  availableBefore: number;
  availableAfter: number;
};

function methodLabel(method?: StockExtractMethod | null): string {
  if (!method) return "—";
  const found = EXTRACT_METHOD_OPTIONS.find((opt) => opt.value === method);
  return found?.label ?? method;
}

function formatDateTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// ============================================================================
// Shared Shell
// ============================================================================

type ModalShellProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  kicker?: string;
  icon: React.ReactNode;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  maxWidth?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

function ModalShell({
  open,
  onClose,
  title,
  kicker,
  icon,
  accentColor: _accentColor,
  accentBg,
  accentBorder,
  maxWidth = 560,
  children,
  footer,
}: ModalShellProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-4 transition-all duration-300 ${
        open ? "pointer-events-auto" : "pointer-events-none"
      }`}
      style={{ backgroundColor: open ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0)" }}
      onClick={onClose}
    >
      <div
        className="relative flex w-full flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{
          backgroundColor: "var(--surface)",
          border: `1px solid ${accentBorder}`,
          maxWidth,
          maxHeight: "90vh",
          transform: open ? "scale(1) translateY(0)" : "scale(0.96) translateY(16px)",
          opacity: open ? 1 : 0,
          transition: "transform 250ms cubic-bezier(0.4,0,0.2,1), opacity 250ms cubic-bezier(0.4,0,0.2,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-4 px-5 py-4"
          style={{ borderBottom: "1px solid var(--bd)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: accentBg, border: `1px solid ${accentBorder}` }}
            >
              {icon}
            </div>
            <div>
              {kicker ? (
                <p
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: "var(--tx-f)" }}
                >
                  {kicker}
                </p>
              ) : null}
              <p
                className="text-sm font-black uppercase tracking-tight"
                style={{ color: "var(--tx)" }}
              >
                {title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all hover:opacity-70"
            style={{
              background: "var(--inp)",
              border: "1px solid var(--bd)",
              color: "var(--tx-f)",
            }}
            aria-label="Đóng"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

        {footer ? (
          <div
            className="flex shrink-0 items-center justify-end gap-2 px-5 py-4"
            style={{ borderTop: "1px solid var(--bd)", background: "var(--inp)" }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function StockBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black"
      style={{
        background: "rgba(56,189,248,0.12)",
        border: "1px solid rgba(56,189,248,0.3)",
        color: "rgb(56,189,248)",
      }}
    >
      <Package className="h-3 w-3" />
      Tồn: {count.toLocaleString("vi-VN")}
    </span>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  color = "rgb(16,185,129)",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  color?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: color, color: "#fff" }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--bd)",
        color: "var(--tx-f)",
      }}
    >
      {children}
    </button>
  );
}

// ============================================================================
// 1) UploadStockModal
// ============================================================================

type UploadStockModalProps = {
  open: boolean;
  onClose: () => void;
  productName: string;
  currentStock: number;
  onUpload: (file: File) => void;
  isUploading?: boolean;
};

export function UploadStockModal({
  open,
  onClose,
  productName,
  currentStock,
  onUpload,
  isUploading,
}: UploadStockModalProps) {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setErrorMsg(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [open]);

  function handlePick(picked: File | null | undefined) {
    if (!picked) {
      setFile(null);
      return;
    }
    if (!/\.txt$/i.test(picked.name)) {
      setErrorMsg("Chỉ chấp nhận file .txt");
      setFile(null);
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setErrorMsg(
        `File quá lớn (${(picked.size / 1024).toFixed(1)} KB). Giới hạn 1MB.`,
      );
      setFile(null);
      return;
    }
    setErrorMsg(null);
    setFile(picked);
  }

  function handleSubmit() {
    if (!file) {
      showToast({ tone: "warning", message: "Hãy chọn file .txt trước." });
      return;
    }
    onUpload(file);
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      kicker="Nhập kho"
      title="Upload tài khoản"
      icon={<Upload className="h-4 w-4" style={{ color: "rgb(16,185,129)" }} />}
      accentColor="rgb(16,185,129)"
      accentBg="rgba(16,185,129,0.12)"
      accentBorder="rgba(16,185,129,0.3)"
      footer={
        <>
          <GhostButton onClick={onClose} disabled={isUploading}>
            <X className="h-3.5 w-3.5" /> Hủy
          </GhostButton>
          <PrimaryButton
            onClick={handleSubmit}
            disabled={!file || isUploading}
            color="rgb(16,185,129)"
          >
            {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {isUploading ? "Đang upload..." : "Upload file"}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <div
          className="rounded-xl p-3"
          style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
        >
          <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
            Sản phẩm
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="truncate text-[13px] font-black" style={{ color: "var(--tx)" }}>
              {productName}
            </p>
            <StockBadge count={currentStock} />
          </div>
        </div>

        <label
          className="block cursor-pointer rounded-xl p-5 text-center transition hover:opacity-90"
          style={{
            background: "var(--inp)",
            border: "1px dashed var(--bd)",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            disabled={isUploading}
            onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
          />
          <div
            className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{
              background: "rgba(16,185,129,0.12)",
              border: "1px solid rgba(16,185,129,0.3)",
            }}
          >
            <FileText className="h-5 w-5" style={{ color: "rgb(16,185,129)" }} />
          </div>
          <p className="text-[13px] font-black" style={{ color: "var(--tx)" }}>
            {file ? file.name : "Chọn file .txt"}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
            {file
              ? `${(file.size / 1024).toFixed(1)} KB · Bấm để chọn file khác`
              : "Mỗi dòng một tài khoản · Tối đa 1MB"}
          </p>
        </label>

        {errorMsg ? (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]"
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "rgb(239,68,68)",
            }}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}

// ============================================================================
// 2) UploadStockResultModal
// ============================================================================

type UploadResult = {
  added: number;
  totalBefore: number;
  totalAfter: number;
  preview: string[];
};

type UploadStockResultModalProps = {
  open: boolean;
  onClose: () => void;
  result: UploadResult | null;
};

export function UploadStockResultModal({
  open,
  onClose,
  result,
}: UploadStockResultModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      kicker="Hoàn tất"
      title="Đã nhập kho"
      icon={<CheckCircle2 className="h-4 w-4" style={{ color: "rgb(16,185,129)" }} />}
      accentColor="rgb(16,185,129)"
      accentBg="rgba(16,185,129,0.12)"
      accentBorder="rgba(16,185,129,0.3)"
      footer={
        <PrimaryButton onClick={onClose} color="rgb(16,185,129)">
          <CheckCircle2 className="h-3.5 w-3.5" /> Xong
        </PrimaryButton>
      }
    >
      {!result ? (
        <p className="text-center text-[12px]" style={{ color: "var(--tx-f)" }}>
          Không có kết quả.
        </p>
      ) : (
        <div className="space-y-4">
          <div
            className="rounded-xl p-4 text-center"
            style={{
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.25)",
            }}
          >
            <p
              className="text-[11px] font-black uppercase tracking-widest"
              style={{ color: "rgb(16,185,129)" }}
            >
              Đã thêm
            </p>
            <p
              className="mt-1 text-3xl font-black"
              style={{ color: "rgb(16,185,129)" }}
            >
              +{result.added.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
              tài khoản mới
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div
              className="rounded-xl p-3"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
            >
              <p
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: "var(--tx-f)" }}
              >
                Tồn trước
              </p>
              <p className="mt-1 text-lg font-black" style={{ color: "var(--tx)" }}>
                {result.totalBefore.toLocaleString("vi-VN")}
              </p>
            </div>
            <div
              className="rounded-xl p-3"
              style={{
                background: "rgba(56,189,248,0.08)",
                border: "1px solid rgba(56,189,248,0.25)",
              }}
            >
              <p
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: "rgb(56,189,248)" }}
              >
                Tồn sau
              </p>
              <p
                className="mt-1 text-lg font-black"
                style={{ color: "rgb(56,189,248)" }}
              >
                {result.totalAfter.toLocaleString("vi-VN")}
              </p>
            </div>
          </div>

          {result.preview && result.preview.length > 0 ? (
            <div>
              <p
                className="mb-1.5 text-[11px] font-black uppercase tracking-widest"
                style={{ color: "var(--tx-f)" }}
              >
                Preview (3 dòng đầu)
              </p>
              <div
                className="rounded-xl p-3 font-mono text-[12px]"
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx)",
                }}
              >
                {result.preview.slice(0, 3).map((line, i) => (
                  <div
                    key={i}
                    className="truncate"
                    style={{ color: "var(--tx-m)" }}
                    title={line}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </ModalShell>
  );
}

// ============================================================================
// 3) ExtractStockModal
// ============================================================================

type ExtractStockModalProps = {
  open: boolean;
  onClose: () => void;
  productName: string;
  currentStock: number;
  onExtract: (quantity: number, method: StockExtractMethod) => void;
  isExtracting?: boolean;
};

export function ExtractStockModal({
  open,
  onClose,
  productName,
  currentStock,
  onExtract,
  isExtracting,
}: ExtractStockModalProps) {
  const { showToast } = useToast();
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [quantity, setQuantity] = useState<string>("1");
  const [method, setMethod] = useState<StockExtractMethod>("FIFO");

  useEffect(() => {
    if (!open) {
      setStep("form");
      setQuantity("1");
      setMethod("FIFO");
    }
  }, [open]);

  const numericQty = useMemo(() => {
    const n = Number(quantity);
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n);
  }, [quantity]);

  const validQty =
    numericQty >= 1 && numericQty <= currentStock && currentStock > 0;

  const selectedMethod = EXTRACT_METHOD_OPTIONS.find((m) => m.value === method)!;

  function proceedToConfirm() {
    if (currentStock <= 0) {
      showToast({ tone: "error", message: "Kho trống — không thể rút." });
      return;
    }
    if (!validQty) {
      showToast({
        tone: "warning",
        message: `Số lượng phải từ 1 đến ${currentStock}.`,
      });
      return;
    }
    setStep("confirm");
  }

  function handleConfirm() {
    if (!validQty) return;
    onExtract(numericQty, method);
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      kicker={step === "form" ? "Rút kho" : "Xác nhận"}
      title={step === "form" ? "Trích xuất tài khoản" : "Xác nhận rút kho"}
      icon={<PackageOpen className="h-4 w-4" style={{ color: "rgb(249,115,22)" }} />}
      accentColor="rgb(249,115,22)"
      accentBg="rgba(249,115,22,0.12)"
      accentBorder="rgba(249,115,22,0.3)"
      footer={
        step === "form" ? (
          <>
            <GhostButton onClick={onClose} disabled={isExtracting}>
              <X className="h-3.5 w-3.5" /> Hủy
            </GhostButton>
            <PrimaryButton
              onClick={proceedToConfirm}
              disabled={!validQty || isExtracting}
              color="rgb(249,115,22)"
            >
              <Download className="h-3.5 w-3.5" /> Tiếp tục
            </PrimaryButton>
          </>
        ) : (
          <>
            <GhostButton
              onClick={() => setStep("form")}
              disabled={isExtracting}
            >
              <X className="h-3.5 w-3.5" /> Quay lại
            </GhostButton>
            <PrimaryButton
              onClick={handleConfirm}
              disabled={isExtracting || !validQty}
              color="rgb(249,115,22)"
            >
              {isExtracting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isExtracting ? "Đang rút..." : "Xác nhận rút"}
            </PrimaryButton>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div
          className="rounded-xl p-3"
          style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
        >
          <p
            className="text-[11px] font-black uppercase tracking-widest"
            style={{ color: "var(--tx-f)" }}
          >
            Sản phẩm
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="truncate text-[13px] font-black" style={{ color: "var(--tx)" }}>
              {productName}
            </p>
            <StockBadge count={currentStock} />
          </div>
        </div>

        {step === "form" ? (
          <>
            <div>
              <p
                className="mb-1.5 text-[11px] font-black uppercase tracking-widest"
                style={{ color: "var(--tx-f)" }}
              >
                Số lượng cần rút
              </p>
              <input
                type="number"
                min={1}
                max={currentStock}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={isExtracting}
                placeholder="VD: 5"
                className="w-full rounded-xl px-3 py-2 text-[14px] font-black outline-none"
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx)",
                }}
              />
              <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
                Tối đa {currentStock.toLocaleString("vi-VN")} tài khoản.
              </p>
            </div>

            <div>
              <p
                className="mb-1.5 text-[11px] font-black uppercase tracking-widest"
                style={{ color: "var(--tx-f)" }}
              >
                Phương pháp
              </p>
              <select
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as StockExtractMethod)
                }
                disabled={isExtracting}
                className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx)",
                }}
              >
                {EXTRACT_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
                {selectedMethod.description}
              </p>
            </div>
          </>
        ) : (
          <div
            className="rounded-xl p-4"
            style={{
              background: "rgba(249,115,22,0.08)",
              border: "1px solid rgba(249,115,22,0.25)",
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: "rgba(249,115,22,0.15)",
                  border: "1px solid rgba(249,115,22,0.3)",
                }}
              >
                <AlertTriangle
                  className="h-4 w-4"
                  style={{ color: "rgb(249,115,22)" }}
                />
              </div>
              <div className="min-w-0">
                <p
                  className="text-[13px] font-black"
                  style={{ color: "var(--tx)" }}
                >
                  Xác nhận trích xuất
                </p>
                <p
                  className="mt-1 text-[12px] leading-relaxed"
                  style={{ color: "var(--tx-m)" }}
                >
                  Sẽ rút{" "}
                  <span className="font-black" style={{ color: "rgb(249,115,22)" }}>
                    {numericQty.toLocaleString("vi-VN")} tài khoản
                  </span>{" "}
                  khỏi kho theo phương pháp{" "}
                  <span className="font-black" style={{ color: "rgb(249,115,22)" }}>
                    {selectedMethod.label}
                  </span>
                  . Tồn còn lại:{" "}
                  <span className="font-black" style={{ color: "var(--tx)" }}>
                    {(currentStock - numericQty).toLocaleString("vi-VN")}
                  </span>
                  .
                </p>
                <p className="mt-2 text-[11px]" style={{ color: "var(--tx-f)" }}>
                  Hành động này KHÔNG thể hoàn tác.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ============================================================================
// 4) ExtractStockResultModal
// ============================================================================

type ExtractResult = {
  extracted: string[];
  totalBefore: number;
  totalAfter: number;
  method: StockExtractMethod;
};

type ExtractStockResultModalProps = {
  open: boolean;
  onClose: () => void;
  result: ExtractResult | null;
};

export function ExtractStockResultModal({
  open,
  onClose,
  result,
}: ExtractStockResultModalProps) {
  const { showToast } = useToast();
  const text = useMemo(
    () => (result ? result.extracted.join("\n") : ""),
    [result],
  );

  async function copyAll() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast({
        tone: "success",
        message: `Đã copy ${result?.extracted.length ?? 0} tài khoản.`,
      });
    } catch {
      showToast({ tone: "error", message: "Không copy được vào clipboard." });
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      kicker="Hoàn tất"
      title="Đã rút kho"
      icon={<CheckCircle2 className="h-4 w-4" style={{ color: "rgb(249,115,22)" }} />}
      accentColor="rgb(249,115,22)"
      accentBg="rgba(249,115,22,0.12)"
      accentBorder="rgba(249,115,22,0.3)"
      maxWidth={640}
      footer={
        <>
          <GhostButton onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Đóng
          </GhostButton>
          <PrimaryButton onClick={copyAll} color="rgb(249,115,22)" disabled={!text}>
            <Copy className="h-3.5 w-3.5" /> Copy tất cả
          </PrimaryButton>
        </>
      }
    >
      {!result ? (
        <p className="text-center text-[12px]" style={{ color: "var(--tx-f)" }}>
          Không có kết quả.
        </p>
      ) : (
        <div className="space-y-4">
          <div
            className="rounded-xl p-4 text-center"
            style={{
              background: "rgba(249,115,22,0.08)",
              border: "1px solid rgba(249,115,22,0.25)",
            }}
          >
            <p
              className="text-[11px] font-black uppercase tracking-widest"
              style={{ color: "rgb(249,115,22)" }}
            >
              Đã rút
            </p>
            <p
              className="mt-1 text-3xl font-black"
              style={{ color: "rgb(249,115,22)" }}
            >
              {result.extracted.length.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
              tài khoản
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div
              className="rounded-xl p-3 text-center"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
            >
              <p
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: "var(--tx-f)" }}
              >
                Trước
              </p>
              <p className="mt-1 text-base font-black" style={{ color: "var(--tx)" }}>
                {result.totalBefore.toLocaleString("vi-VN")}
              </p>
            </div>
            <div
              className="rounded-xl p-3 text-center"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
            >
              <p
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: "var(--tx-f)" }}
              >
                Sau
              </p>
              <p className="mt-1 text-base font-black" style={{ color: "var(--tx)" }}>
                {result.totalAfter.toLocaleString("vi-VN")}
              </p>
            </div>
            <div
              className="rounded-xl p-3 text-center"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
            >
              <p
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: "var(--tx-f)" }}
              >
                Method
              </p>
              <p className="mt-1 text-base font-black" style={{ color: "var(--tx)" }}>
                {result.method}
              </p>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p
                className="text-[11px] font-black uppercase tracking-widest"
                style={{ color: "var(--tx-f)" }}
              >
                Danh sách tài khoản
              </p>
              <button
                type="button"
                onClick={copyAll}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black transition hover:opacity-80"
                style={{
                  background: "rgba(56,189,248,0.12)",
                  border: "1px solid rgba(56,189,248,0.3)",
                  color: "rgb(56,189,248)",
                }}
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <textarea
              readOnly
              value={text}
              spellCheck={false}
              className="w-full rounded-xl px-3 py-2.5 font-mono text-[12px] outline-none"
              style={{
                background: "var(--inp)",
                border: "1px solid var(--bd)",
                color: "var(--tx)",
                minHeight: 200,
                maxHeight: 360,
                resize: "vertical",
              }}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ============================================================================
// 5) StockHistoryModal
// ============================================================================

type StockHistoryModalProps = {
  open: boolean;
  onClose: () => void;
  productName: string;
  items: StockOperation[];
  isLoading?: boolean;
};

export function StockHistoryModal({
  open,
  onClose,
  productName,
  items,
  isLoading,
}: StockHistoryModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      kicker="Lịch sử"
      title="Nhập / Rút kho"
      icon={<History className="h-4 w-4" style={{ color: "rgb(139,92,246)" }} />}
      accentColor="rgb(139,92,246)"
      accentBg="rgba(139,92,246,0.12)"
      accentBorder="rgba(139,92,246,0.3)"
      maxWidth={860}
      footer={
        <GhostButton onClick={onClose}>
          <X className="h-3.5 w-3.5" /> Đóng
        </GhostButton>
      }
    >
      <div className="space-y-3">
        <div
          className="rounded-xl p-3"
          style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
        >
          <p
            className="text-[11px] font-black uppercase tracking-widest"
            style={{ color: "var(--tx-f)" }}
          >
            Sản phẩm
          </p>
          <p
            className="mt-1 truncate text-[13px] font-black"
            style={{ color: "var(--tx)" }}
          >
            {productName}
          </p>
        </div>

        {isLoading ? (
          <div
            className="flex items-center justify-center gap-2 rounded-xl py-10 text-[12px]"
            style={{
              background: "var(--inp)",
              border: "1px solid var(--bd)",
              color: "var(--tx-f)",
            }}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải lịch sử...
          </div>
        ) : items.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 rounded-xl py-10 text-center text-[12px]"
            style={{
              background: "var(--inp)",
              border: "1px solid var(--bd)",
              color: "var(--tx-f)",
            }}
          >
            <ClipboardList className="h-5 w-5 opacity-50" />
            Chưa có thao tác nhập/rút nào.
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-xl"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{
                      color: "var(--tx-f)",
                      background: "var(--surface)",
                    }}
                  >
                    <th className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" /> Thời gian
                      </div>
                    </th>
                    <th className="px-3 py-2.5">Loại</th>
                    <th className="px-3 py-2.5">Method</th>
                    <th className="px-3 py-2.5 text-right">Số acc</th>
                    <th className="px-3 py-2.5 text-right">Trước</th>
                    <th className="px-3 py-2.5 text-right">Sau</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const isUpload = it.operationType === "UPLOAD";
                    return (
                      <tr
                        key={it.id}
                        style={{ borderTop: "1px solid var(--bd)" }}
                      >
                        <td
                          className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]"
                          style={{ color: "var(--tx-m)" }}
                        >
                          {formatDateTime(it.createdAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
                            style={
                              isUpload
                                ? {
                                    background: "rgba(16,185,129,0.12)",
                                    border: "1px solid rgba(16,185,129,0.3)",
                                    color: "rgb(16,185,129)",
                                  }
                                : {
                                    background: "rgba(249,115,22,0.12)",
                                    border: "1px solid rgba(249,115,22,0.3)",
                                    color: "rgb(249,115,22)",
                                  }
                            }
                          >
                            {isUpload ? (
                              <Upload className="h-2.5 w-2.5" />
                            ) : (
                              <Download className="h-2.5 w-2.5" />
                            )}
                            {isUpload ? "Upload" : "Extract"}
                          </span>
                        </td>
                        <td
                          className="px-3 py-2.5 text-[11px]"
                          style={{ color: "var(--tx-m)" }}
                        >
                          {isUpload ? (
                            <span style={{ color: "var(--tx-f)" }}>—</span>
                          ) : (
                            <span className="font-black">
                              {methodLabel(it.extractMethod)}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-3 py-2.5 text-right font-black"
                          style={{
                            color: isUpload
                              ? "rgb(16,185,129)"
                              : "rgb(249,115,22)",
                          }}
                        >
                          {isUpload ? "+" : "-"}
                          {it.quantity.toLocaleString("vi-VN")}
                        </td>
                        <td
                          className="px-3 py-2.5 text-right font-mono text-[11px]"
                          style={{ color: "var(--tx-f)" }}
                        >
                          {it.availableBefore.toLocaleString("vi-VN")}
                        </td>
                        <td
                          className="px-3 py-2.5 text-right font-mono text-[11px]"
                          style={{ color: "var(--tx)" }}
                        >
                          {it.availableAfter.toLocaleString("vi-VN")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
