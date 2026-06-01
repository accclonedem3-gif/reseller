import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Eye,
  FileText,
  Hash,
  History,
  ListChecks,
  Loader2,
  Package,
  PackageOpen,
  Search,
  Shuffle,
  Upload,
  X,
  Zap,
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
// 3) ExtractStockModal — v2 (FAST / RANGE / MANUAL + dry-run)
// ============================================================================

export type ExtractMode = "FAST" | "RANGE" | "MANUAL";

export type ExtractPayload = {
  mode: ExtractMode;
  dryRun: boolean;
  quantity?: number;
  method?: StockExtractMethod;
  fromIndex?: number;
  toIndex?: number;
  selectedIndices?: number[];
};

export type EntryListPage = {
  items: { index: number; text: string }[];
  total: number;
  filteredTotal: number;
};

type ExtractStockModalProps = {
  open: boolean;
  onClose: () => void;
  productName: string;
  currentStock: number;
  onExtract: (payload: ExtractPayload) => void;
  onListEntries?: (params: {
    limit: number;
    offset: number;
    search: string;
  }) => Promise<EntryListPage>;
  isExtracting?: boolean;
};

const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 12;
const OVERSCAN = 4;
const LIST_PAGE_SIZE = 200;

const TAB_DEFS: ReadonlyArray<{
  value: ExtractMode;
  label: string;
  icon: typeof Zap;
}> = [
  { value: "FAST", label: "⚡ Nhanh", icon: Zap },
  { value: "RANGE", label: "📏 Chọn dải", icon: Hash },
  { value: "MANUAL", label: "🎯 Chọn tay", icon: ListChecks },
];

export function ExtractStockModal({
  open,
  onClose,
  productName,
  currentStock,
  onExtract,
  onListEntries,
  isExtracting,
}: ExtractStockModalProps) {
  const { showToast } = useToast();
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [mode, setMode] = useState<ExtractMode>("FAST");
  const [dryRun, setDryRun] = useState<boolean>(false);

  // FAST
  const [quantity, setQuantity] = useState<string>("1");
  const [method, setMethod] = useState<StockExtractMethod>("FIFO");

  // RANGE
  const [fromIndex, setFromIndex] = useState<string>("1");
  const [toIndex, setToIndex] = useState<string>("1");

  // MANUAL
  const [searchInput, setSearchInput] = useState<string>("");
  const [searchDebounced, setSearchDebounced] = useState<string>("");
  const [entries, setEntries] = useState<{ index: number; text: string }[]>([]);
  const [filteredTotal, setFilteredTotal] = useState<number>(0);
  const [isLoadingEntries, setIsLoadingEntries] = useState<boolean>(false);
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set());
  const [scrollTop, setScrollTop] = useState<number>(0);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep("form");
      setMode("FAST");
      setDryRun(false);
      setQuantity("1");
      setMethod("FIFO");
      setFromIndex("1");
      setToIndex("1");
      setSearchInput("");
      setSearchDebounced("");
      setEntries([]);
      setFilteredTotal(0);
      setSelectedSet(new Set());
      setScrollTop(0);
    }
  }, [open]);

  // Debounce search input (300ms)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput, open]);

  // Load entries when MANUAL tab active or search changes
  const loadEntries = useCallback(
    async (search: string) => {
      if (!onListEntries) return;
      setIsLoadingEntries(true);
      try {
        const res = await onListEntries({
          limit: LIST_PAGE_SIZE,
          offset: 0,
          search,
        });
        setEntries(res.items);
        setFilteredTotal(res.filteredTotal);
        if (listContainerRef.current) listContainerRef.current.scrollTop = 0;
        setScrollTop(0);
      } catch {
        showToast({ tone: "error", message: "Không tải được danh sách acc." });
        setEntries([]);
        setFilteredTotal(0);
      } finally {
        setIsLoadingEntries(false);
      }
    },
    [onListEntries, showToast],
  );

  useEffect(() => {
    if (!open) return;
    if (mode !== "MANUAL") return;
    void loadEntries(searchDebounced);
  }, [open, mode, searchDebounced, loadEntries]);

  async function loadMore() {
    if (!onListEntries) return;
    setIsLoadingEntries(true);
    try {
      const res = await onListEntries({
        limit: LIST_PAGE_SIZE,
        offset: entries.length,
        search: searchDebounced,
      });
      setEntries((prev) => [...prev, ...res.items]);
      setFilteredTotal(res.filteredTotal);
    } catch {
      showToast({ tone: "error", message: "Không tải thêm được." });
    } finally {
      setIsLoadingEntries(false);
    }
  }

  // FAST derived
  const numericQty = useMemo(() => {
    const n = Number(quantity);
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n);
  }, [quantity]);
  const validQtyFast =
    numericQty >= 1 && numericQty <= currentStock && currentStock > 0;
  const selectedMethod = EXTRACT_METHOD_OPTIONS.find((m) => m.value === method)!;

  // RANGE derived
  const fromNum = useMemo(() => {
    const n = Number(fromIndex);
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n);
  }, [fromIndex]);
  const toNum = useMemo(() => {
    const n = Number(toIndex);
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n);
  }, [toIndex]);
  const rangeCount = useMemo(() => {
    if (fromNum < 1 || toNum < fromNum || toNum > currentStock) return 0;
    return toNum - fromNum + 1;
  }, [fromNum, toNum, currentStock]);
  const validRange =
    currentStock > 0 &&
    fromNum >= 1 &&
    toNum >= fromNum &&
    toNum <= currentStock &&
    rangeCount > 0;

  // MANUAL derived
  const manualCount = selectedSet.size;
  const validManual = manualCount > 0 && manualCount <= currentStock;

  // Action quantity (for confirm copy)
  const actionCount =
    mode === "FAST" ? numericQty : mode === "RANGE" ? rangeCount : manualCount;

  const canProceed =
    (mode === "FAST" && validQtyFast) ||
    (mode === "RANGE" && validRange) ||
    (mode === "MANUAL" && validManual);

  function proceedToConfirm() {
    if (currentStock <= 0) {
      showToast({ tone: "error", message: "Kho trống — không thể bóc." });
      return;
    }
    if (mode === "FAST" && !validQtyFast) {
      showToast({
        tone: "warning",
        message: `Số lượng phải từ 1 đến ${currentStock}.`,
      });
      return;
    }
    if (mode === "RANGE" && !validRange) {
      showToast({
        tone: "warning",
        message: `Dải phải nằm trong 1..${currentStock} và from ≤ to.`,
      });
      return;
    }
    if (mode === "MANUAL" && !validManual) {
      showToast({ tone: "warning", message: "Chọn ít nhất 1 acc." });
      return;
    }
    setStep("confirm");
  }

  function handleConfirm() {
    if (!canProceed) return;
    if (mode === "FAST") {
      onExtract({ mode: "FAST", dryRun, quantity: numericQty, method });
    } else if (mode === "RANGE") {
      onExtract({
        mode: "RANGE",
        dryRun,
        fromIndex: fromNum,
        toIndex: toNum,
      });
    } else {
      onExtract({
        mode: "MANUAL",
        dryRun,
        selectedIndices: Array.from(selectedSet).sort((a, b) => a - b),
      });
    }
  }

  function toggleSelected(idx: number) {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function selectAllInPage() {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      for (const e of entries) next.add(e.index);
      return next;
    });
  }

  function clearSelected() {
    setSelectedSet(new Set());
  }

  // Virtual scroll math
  const totalRows = entries.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    totalRows,
    Math.ceil((scrollTop + ROW_HEIGHT * VISIBLE_ROWS) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleSlice = entries.slice(startIndex, endIndex);
  const topSpacer = startIndex * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (totalRows - endIndex) * ROW_HEIGHT);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      kicker={step === "form" ? "Bóc kho" : "Xác nhận"}
      title={step === "form" ? "Trích xuất tài khoản" : "Xác nhận bóc kho"}
      icon={<PackageOpen className="h-4 w-4" style={{ color: "rgb(249,115,22)" }} />}
      accentColor="rgb(249,115,22)"
      accentBg="rgba(249,115,22,0.12)"
      accentBorder="rgba(249,115,22,0.3)"
      maxWidth={mode === "MANUAL" ? 640 : 560}
      footer={
        step === "form" ? (
          <>
            <GhostButton onClick={onClose} disabled={isExtracting}>
              <X className="h-3.5 w-3.5" /> Hủy
            </GhostButton>
            <PrimaryButton
              onClick={proceedToConfirm}
              disabled={!canProceed || isExtracting}
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
              disabled={isExtracting || !canProceed}
              color="rgb(249,115,22)"
            >
              {isExtracting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isExtracting ? "Đang bóc..." : "Xác nhận"}
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
            {/* Dry-run toggle */}
            <label
              className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5"
              style={{
                background: dryRun
                  ? "rgba(56,189,248,0.08)"
                  : "var(--inp)",
                border: dryRun
                  ? "1px solid rgba(56,189,248,0.3)"
                  : "1px solid var(--bd)",
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Eye
                  className="h-4 w-4 shrink-0"
                  style={{
                    color: dryRun ? "rgb(56,189,248)" : "var(--tx-f)",
                  }}
                />
                <div className="min-w-0">
                  <p
                    className="text-[12px] font-black"
                    style={{ color: "var(--tx)" }}
                  >
                    Bóc không xóa (chỉ xem & copy)
                  </p>
                  <p
                    className="text-[10px]"
                    style={{ color: "var(--tx-f)" }}
                  >
                    Hiển thị acc nhưng kho không bị trừ.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={dryRun}
                onClick={() => setDryRun((v) => !v)}
                disabled={isExtracting}
                className="relative h-6 w-11 shrink-0 rounded-full transition"
                style={{
                  background: dryRun
                    ? "rgb(56,189,248)"
                    : "var(--bd)",
                }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                  style={{ left: dryRun ? "22px" : "2px" }}
                />
              </button>
            </label>

            {/* Tabs */}
            <div
              className="grid grid-cols-3 gap-1 rounded-xl p-1"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
            >
              {TAB_DEFS.map((tab) => {
                const active = mode === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setMode(tab.value)}
                    disabled={isExtracting}
                    className="rounded-lg px-2 py-1.5 text-[12px] font-black transition"
                    style={
                      active
                        ? {
                            background: "rgba(249,115,22,0.15)",
                            border: "1px solid rgba(249,115,22,0.3)",
                            color: "rgb(249,115,22)",
                          }
                        : {
                            background: "transparent",
                            border: "1px solid transparent",
                            color: "var(--tx-f)",
                          }
                    }
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* FAST */}
            {mode === "FAST" && (
              <>
                <div>
                  <p
                    className="mb-1.5 text-[11px] font-black uppercase tracking-widest"
                    style={{ color: "var(--tx-f)" }}
                  >
                    Số lượng cần bóc
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
            )}

            {/* RANGE */}
            {mode === "RANGE" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p
                      className="mb-1.5 text-[11px] font-black uppercase tracking-widest"
                      style={{ color: "var(--tx-f)" }}
                    >
                      Từ vị trí
                    </p>
                    <input
                      type="number"
                      min={1}
                      max={currentStock}
                      value={fromIndex}
                      onChange={(e) => setFromIndex(e.target.value)}
                      disabled={isExtracting}
                      placeholder="1"
                      className="w-full rounded-xl px-3 py-2 text-[14px] font-black outline-none"
                      style={{
                        background: "var(--inp)",
                        border: "1px solid var(--bd)",
                        color: "var(--tx)",
                      }}
                    />
                  </div>
                  <div>
                    <p
                      className="mb-1.5 text-[11px] font-black uppercase tracking-widest"
                      style={{ color: "var(--tx-f)" }}
                    >
                      Đến vị trí
                    </p>
                    <input
                      type="number"
                      min={fromNum || 1}
                      max={currentStock}
                      value={toIndex}
                      onChange={(e) => setToIndex(e.target.value)}
                      disabled={isExtracting}
                      placeholder={String(currentStock)}
                      className="w-full rounded-xl px-3 py-2 text-[14px] font-black outline-none"
                      style={{
                        background: "var(--inp)",
                        border: "1px solid var(--bd)",
                        color: "var(--tx)",
                      }}
                    />
                  </div>
                </div>
                <div
                  className="rounded-xl px-3 py-2.5 text-[12px]"
                  style={{
                    background: validRange
                      ? "rgba(249,115,22,0.08)"
                      : "var(--inp)",
                    border: validRange
                      ? "1px solid rgba(249,115,22,0.25)"
                      : "1px solid var(--bd)",
                    color: validRange ? "rgb(249,115,22)" : "var(--tx-f)",
                  }}
                >
                  {validRange ? (
                    <span className="font-black">
                      Sẽ bóc {rangeCount.toLocaleString("vi-VN")} acc (#{fromNum} đến #{toNum})
                    </span>
                  ) : (
                    <span>Nhập dải hợp lệ trong 1..{currentStock}.</span>
                  )}
                </div>
              </>
            )}

            {/* MANUAL */}
            {mode === "MANUAL" && (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search
                      className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                      style={{ color: "var(--tx-f)" }}
                    />
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      disabled={isExtracting}
                      placeholder="Tìm acc..."
                      className="w-full rounded-xl py-2 pl-8 pr-3 text-[13px] outline-none"
                      style={{
                        background: "var(--inp)",
                        border: "1px solid var(--bd)",
                        color: "var(--tx)",
                      }}
                    />
                  </div>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black"
                    style={{
                      background: "rgba(249,115,22,0.12)",
                      border: "1px solid rgba(249,115,22,0.3)",
                      color: "rgb(249,115,22)",
                    }}
                  >
                    Selected: {manualCount} / {filteredTotal.toLocaleString("vi-VN")}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllInPage}
                    disabled={isExtracting || entries.length === 0}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-black transition disabled:opacity-40"
                    style={{
                      background: "var(--inp)",
                      border: "1px solid var(--bd)",
                      color: "var(--tx-f)",
                    }}
                  >
                    Chọn tất cả trong trang
                  </button>
                  <button
                    type="button"
                    onClick={clearSelected}
                    disabled={isExtracting || manualCount === 0}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-black transition disabled:opacity-40"
                    style={{
                      background: "var(--inp)",
                      border: "1px solid var(--bd)",
                      color: "var(--tx-f)",
                    }}
                  >
                    Bỏ chọn
                  </button>
                </div>

                <div
                  className="rounded-xl"
                  style={{
                    background: "var(--inp)",
                    border: "1px solid var(--bd)",
                  }}
                >
                  <div
                    ref={listContainerRef}
                    onScroll={(e) =>
                      setScrollTop((e.target as HTMLDivElement).scrollTop)
                    }
                    style={{
                      height: ROW_HEIGHT * VISIBLE_ROWS,
                      overflowY: "auto",
                    }}
                  >
                    {entries.length === 0 ? (
                      <div
                        className="flex h-full items-center justify-center gap-2 text-[12px]"
                        style={{ color: "var(--tx-f)" }}
                      >
                        {isLoadingEntries ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Đang tải...
                          </>
                        ) : (
                          <span>Không có acc.</span>
                        )}
                      </div>
                    ) : (
                      <>
                        <div style={{ height: topSpacer }} />
                        {visibleSlice.map((entry) => {
                          const checked = selectedSet.has(entry.index);
                          return (
                            <label
                              key={entry.index}
                              className="flex cursor-pointer items-center gap-2 px-3"
                              style={{
                                height: ROW_HEIGHT,
                                borderTop: "1px solid var(--bd)",
                                background: checked
                                  ? "rgba(249,115,22,0.06)"
                                  : "transparent",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelected(entry.index)}
                                disabled={isExtracting}
                                className="h-3.5 w-3.5 shrink-0 cursor-pointer"
                              />
                              <span
                                className="w-10 shrink-0 font-mono text-[11px]"
                                style={{ color: "var(--tx-f)" }}
                              >
                                #{entry.index}
                              </span>
                              <span
                                className="min-w-0 flex-1 truncate font-mono text-[12px]"
                                style={{ color: "var(--tx)" }}
                                title={entry.text}
                              >
                                {entry.text}
                              </span>
                            </label>
                          );
                        })}
                        <div style={{ height: bottomSpacer }} />
                      </>
                    )}
                  </div>
                  {filteredTotal > entries.length && (
                    <div
                      className="flex items-center justify-center px-3 py-2"
                      style={{ borderTop: "1px solid var(--bd)" }}
                    >
                      <button
                        type="button"
                        onClick={() => void loadMore()}
                        disabled={isLoadingEntries}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-black transition disabled:opacity-40"
                        style={{
                          background: "rgba(56,189,248,0.12)",
                          border: "1px solid rgba(56,189,248,0.3)",
                          color: "rgb(56,189,248)",
                        }}
                      >
                        {isLoadingEntries ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        Load more ({entries.length}/{filteredTotal})
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
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
                  Xác nhận
                </p>
                <p
                  className="mt-1 text-[12px] leading-relaxed"
                  style={{ color: "var(--tx-m)" }}
                >
                  Sắp bóc{" "}
                  <span className="font-black" style={{ color: "rgb(249,115,22)" }}>
                    {actionCount.toLocaleString("vi-VN")} acc
                  </span>{" "}
                  theo{" "}
                  <span className="font-black" style={{ color: "rgb(249,115,22)" }}>
                    {mode}
                  </span>
                  .{" "}
                  {dryRun ? (
                    <>
                      Kho{" "}
                      <span className="font-black" style={{ color: "var(--tx)" }}>
                        {currentStock.toLocaleString("vi-VN")}
                      </span>{" "}
                      giữ nguyên.{" "}
                      <span
                        className="font-black"
                        style={{ color: "rgb(56,189,248)" }}
                      >
                        (KHÔNG xóa)
                      </span>
                    </>
                  ) : (
                    <>
                      Kho{" "}
                      <span className="font-black" style={{ color: "var(--tx)" }}>
                        {currentStock.toLocaleString("vi-VN")}
                      </span>{" "}
                      →{" "}
                      <span className="font-black" style={{ color: "var(--tx)" }}>
                        {(currentStock - actionCount).toLocaleString("vi-VN")}
                      </span>
                      .
                    </>
                  )}{" "}
                  Tiếp tục?
                </p>
                {!dryRun && (
                  <p className="mt-2 text-[11px]" style={{ color: "var(--tx-f)" }}>
                    Hành động này KHÔNG thể hoàn tác.
                  </p>
                )}
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
  dryRun?: boolean;
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
          {result.dryRun ? (
            <div
              className="flex items-start gap-2 rounded-xl px-3 py-2.5"
              style={{
                background: "rgba(56,189,248,0.08)",
                border: "1px solid rgba(56,189,248,0.3)",
              }}
            >
              <Eye
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ color: "rgb(56,189,248)" }}
              />
              <div className="min-w-0">
                <p
                  className="text-[12px] font-black"
                  style={{ color: "rgb(56,189,248)" }}
                >
                  PREVIEW — kho không bị trừ
                </p>
                <p
                  className="mt-0.5 text-[11px]"
                  style={{ color: "var(--tx-f)" }}
                >
                  Đây là chế độ xem thử. Acc vẫn còn trong kho.
                </p>
              </div>
            </div>
          ) : null}
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
