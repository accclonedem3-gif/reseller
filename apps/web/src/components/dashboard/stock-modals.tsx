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

export type ExtractMode = "FAST" | "RANGE" | "MANUAL" | "MANUAL_BY_ID" | "BATCH";

export type ExtractPayload = {
  mode: ExtractMode;
  dryRun?: boolean;
  quantity?: number;
  method?: StockExtractMethod;
  fromIndex?: number;
  toIndex?: number;
  selectedIndices?: number[];
  entryIds?: string[];
  batchId?: string;
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

// ============================================================================
// CreateBatchModal — form to create a new stock batch (name + cost + expiresInDays + file)
// ============================================================================

export type CreateBatchPayload = {
  name: string;
  costPerAcc?: number;
  totalCost?: number;
  expiresInDays?: number | null;
  file?: File | null;
  text?: string | null;
};

export type CreateBatchResult = {
  batchId: string;
  batchName: string;
  added: number;
  totalAfter: number;
  preview: string[];
};

export function CreateBatchModal({
  open,
  onClose,
  productName,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  onSubmit: (payload: CreateBatchPayload) => Promise<void> | void;
  isSubmitting?: boolean;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [costMode, setCostMode] = useState<"per_acc" | "total">("per_acc");
  const [costPerAcc, setCostPerAcc] = useState<string>("");
  const [totalCost, setTotalCost] = useState<string>("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [textArea, setTextArea] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      setName(`Lô ${dd}/${mm} ${hh}:${mi}`);
      setCostMode("per_acc");
      setCostPerAcc("");
      setTotalCost("");
      setExpiresInDays("");
      setFile(null);
      setTextArea("");
    }
  }, [open]);

  const parsedCount = useMemo(() => {
    const src = file ? null : textArea;
    if (!src) return 0;
    const cleaned = src.replace(/\r\n/g, "\n").trim();
    if (!cleaned) return 0;
    const parts = cleaned.includes("\n\n") ? cleaned.split(/\n\n+/) : cleaned.split(/\r?\n/);
    return parts.map((p) => p.trim()).filter(Boolean).length;
  }, [file, textArea]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * MAX_UPLOAD_BYTES) {
      showToast({ tone: "error", message: "File quá lớn (max 2MB)." });
      e.target.value = "";
      return;
    }
    setFile(f);
    setTextArea("");
  }

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast({ tone: "error", message: "Tên lô không được trống." });
      return;
    }
    let cost: { costPerAcc?: number; totalCost?: number } = {};
    if (costMode === "per_acc") {
      const v = Number(costPerAcc);
      if (!Number.isFinite(v) || v < 0) {
        showToast({ tone: "error", message: "Giá vốn/acc không hợp lệ." });
        return;
      }
      cost.costPerAcc = v;
    } else {
      const v = Number(totalCost);
      if (!Number.isFinite(v) || v < 0) {
        showToast({ tone: "error", message: "Tổng tiền lô không hợp lệ." });
        return;
      }
      cost.totalCost = v;
    }
    let exp: number | null = null;
    if (expiresInDays.trim()) {
      const d = Number(expiresInDays);
      if (!Number.isInteger(d) || d < 1) {
        showToast({ tone: "error", message: "Hạn dùng phải là số nguyên dương." });
        return;
      }
      exp = d;
    }
    if (!file && !textArea.trim()) {
      showToast({ tone: "error", message: "Cần file .txt hoặc paste tài khoản vào ô." });
      return;
    }
    await onSubmit({
      name: trimmedName,
      ...cost,
      expiresInDays: exp,
      file,
      text: file ? null : textArea,
    });
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Tạo lô mới"
      kicker={productName}
      icon={<Package className="h-4 w-4" style={{ color: "rgb(249,115,22)" }} />}
      accentColor="rgb(249,115,22)"
      accentBg="rgba(249,115,22,0.1)"
      accentBorder="rgba(249,115,22,0.3)"
      maxWidth={640}
    >
      <div className="space-y-4 p-5">
        <div>
          <label className="mb-1.5 block text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
            🏷 Tên lô <span style={{ color: "rgb(239,68,68)" }}>*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
            placeholder="VD: Lô 02/06 từ VodicH"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
            💰 Giá vốn <span style={{ color: "rgb(239,68,68)" }}>*</span>
          </label>
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setCostMode("per_acc")}
              className="flex-1 rounded-xl px-3 py-1.5 text-[12px] font-black transition-all"
              style={{
                background: costMode === "per_acc" ? "rgba(249,115,22,0.15)" : "var(--inp)",
                border: `1px solid ${costMode === "per_acc" ? "rgba(249,115,22,0.4)" : "var(--bd)"}`,
                color: costMode === "per_acc" ? "rgb(249,115,22)" : "var(--tx-m)",
              }}
            >
              Giá / acc
            </button>
            <button
              type="button"
              onClick={() => setCostMode("total")}
              className="flex-1 rounded-xl px-3 py-1.5 text-[12px] font-black transition-all"
              style={{
                background: costMode === "total" ? "rgba(249,115,22,0.15)" : "var(--inp)",
                border: `1px solid ${costMode === "total" ? "rgba(249,115,22,0.4)" : "var(--bd)"}`,
                color: costMode === "total" ? "rgb(249,115,22)" : "var(--tx-m)",
              }}
            >
              Tổng lô
            </button>
          </div>
          {costMode === "per_acc" ? (
            <div className="relative">
              <input
                type="number"
                value={costPerAcc}
                onChange={(e) => setCostPerAcc(e.target.value)}
                className="w-full rounded-xl px-3 py-2 pr-12 text-[13px] outline-none"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                placeholder="VD: 13000"
                min={0}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: "var(--tx-f)" }}>đ/acc</span>
            </div>
          ) : (
            <div className="relative">
              <input
                type="number"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                className="w-full rounded-xl px-3 py-2 pr-12 text-[13px] outline-none"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                placeholder="VD: 390000"
                min={0}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: "var(--tx-f)" }}>đ tổng</span>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
            🕐 Hạn dùng (tùy chọn — không show khách)
          </label>
          <div className="relative">
            <input
              type="number"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="w-full rounded-xl px-3 py-2 pr-12 text-[13px] outline-none"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
              placeholder="Để trống = không có hạn"
              min={1}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: "var(--tx-f)" }}>ngày</span>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
            📁 Danh sách tài khoản
          </label>
          <div className="flex gap-2">
            <label
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-black transition-all hover:opacity-80"
              style={{ background: "var(--inp)", border: "1px dashed var(--bd)", color: "var(--tx-m)" }}
            >
              <Upload className="h-3.5 w-3.5" />
              {file ? `${file.name} (${(file.size / 1024).toFixed(1)}KB)` : "Chọn file .txt"}
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
            {file && (
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="rounded-xl px-3 py-2 text-[11px] font-black transition-all hover:opacity-80"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "rgb(239,68,68)" }}
              >
                Xóa
              </button>
            )}
          </div>
          {!file && (
            <>
              <p className="mt-2 mb-1 text-[10px]" style={{ color: "var(--tx-f)" }}>
                Hoặc paste trực tiếp ở đây:
              </p>
              <textarea
                value={textArea}
                onChange={(e) => setTextArea(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-[12px] outline-none font-mono"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)", minHeight: 120 }}
                placeholder={"acc1@vodich.com|pass1\nacc2@vodich.com|pass2\nacc3@vodich.com|pass3"}
              />
            </>
          )}
          {parsedCount > 0 && (
            <p className="mt-1.5 text-[11px] font-bold" style={{ color: "rgb(52,211,153)" }}>
              ✓ {parsedCount} tài khoản đã đọc
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--bd)", background: "var(--inp)" }}>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2 text-[12px] font-black transition-all hover:opacity-80"
          style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
        >
          Huỷ
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="rounded-xl px-4 py-2 text-[12px] font-black transition-all hover:opacity-90 disabled:opacity-40"
          style={{ background: "rgb(249,115,22)", color: "#fff" }}
        >
          {isSubmitting ? "Đang lưu..." : "📦 Tạo lô"}
        </button>
      </div>
    </ModalShell>
  );
}

// ============================================================================
// ViewStockModal — Display stock entries grouped by batch with filter
// ============================================================================

export type StockBatchSummary = {
  id: string;
  name: string;
  costPerUnit: number | null;
  expiresAt: string | Date | null;
  priority: number;
  createdAt: string | Date;
  totalCount: number;
  availableCount: number;
  isExpired: boolean;
};

export type StockEntryItem = {
  id: string;
  text: string;
  status: "AVAILABLE" | "SOLD" | "EXTRACTED";
  uploadedAt: string | Date;
  soldAt: string | Date | null;
  extractedAt: string | Date | null;
  batchId: string | null;
  batchName: string | null;
  batchCost: number | null;
  batchExpiresAt: string | Date | null;
  soldToOrder: { id: string; code: string; deliveredAt: string | Date | null } | null;
  soldToCustomer: { id: string; telegramUsername: string | null; telegramUserId: string; firstName: string | null } | null;
};

export type ViewStockData = {
  items: StockEntryItem[];
  total: number;
  counts: { available: number; sold: number; extracted: number };
};

export function ViewStockModal({
  open,
  onClose,
  productName,
  data,
  batches,
  isLoading,
  statusFilter,
  onStatusChange,
  onExtractRequest,
  onCreateBatchRequest,
  onShowHistory,
  onDeleteBatch,
  onSetBatchPriority,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  data: ViewStockData | null;
  batches: { legacy: { availableCount: number }; batches: StockBatchSummary[] } | null;
  isLoading: boolean;
  statusFilter: "ALL" | "AVAILABLE" | "SOLD" | "EXTRACTED";
  onStatusChange: (s: "ALL" | "AVAILABLE" | "SOLD" | "EXTRACTED") => void;
  onExtractRequest: (selectedIds: string[]) => void;
  onCreateBatchRequest: () => void;
  onShowHistory: () => void;
  onDeleteBatch: (batchId: string) => void;
  onSetBatchPriority?: (batchId: string, priority: number) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setLastClickedIdx(null);
    }
  }, [open]);

  const batchMetaById = useMemo(() => {
    const m = new Map<string, StockBatchSummary>();
    for (const b of batches?.batches ?? []) m.set(b.id, b);
    return m;
  }, [batches]);

  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; cost: number | null; expiresAt: string | Date | null; priority: number; items: StockEntryItem[] }>;
    const map = new Map<string, { key: string; label: string; cost: number | null; expiresAt: string | Date | null; priority: number; items: StockEntryItem[] }>();
    for (const item of data.items) {
      const key = item.batchId ?? "__legacy__";
      if (!map.has(key)) {
        const meta = item.batchId ? batchMetaById.get(item.batchId) : null;
        map.set(key, {
          key,
          label: item.batchName ?? "🟢 Kho cũ",
          cost: item.batchCost,
          expiresAt: item.batchExpiresAt,
          priority: meta?.priority ?? 0,
          items: [],
        });
      }
      map.get(key)!.items.push(item);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === "__legacy__" && b.key !== "__legacy__") return -1;
      if (a.key !== "__legacy__" && b.key === "__legacy__") return 1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return 0;
    });
  }, [data, batchMetaById]);

  function toggleSelect(entryId: string, globalIndex: number, withShift: boolean) {
    if (!data) return;
    const next = new Set(selectedIds);
    if (withShift && lastClickedIdx !== null) {
      const start = Math.min(lastClickedIdx, globalIndex);
      const end = Math.max(lastClickedIdx, globalIndex);
      const shouldSelect = !next.has(entryId);
      for (let i = start; i <= end; i++) {
        const id = data.items[i]?.id;
        if (id && data.items[i]?.status === "AVAILABLE") {
          if (shouldSelect) next.add(id);
          else next.delete(id);
        }
      }
    } else {
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
    }
    setSelectedIds(next);
    setLastClickedIdx(globalIndex);
  }

  function selectAllInGroup(groupItems: StockEntryItem[]) {
    const next = new Set(selectedIds);
    const allAvailable = groupItems.filter((it) => it.status === "AVAILABLE");
    const allSelected = allAvailable.every((it) => next.has(it.id));
    if (allSelected) {
      for (const it of allAvailable) next.delete(it.id);
    } else {
      for (const it of allAvailable) next.add(it.id);
    }
    setSelectedIds(next);
  }

  function toggleCollapse(key: string) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  }

  const selectedCount = selectedIds.size;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Xem tài khoản"
      kicker={productName}
      icon={<Eye className="h-4 w-4" style={{ color: "rgb(56,189,248)" }} />}
      accentColor="rgb(56,189,248)"
      accentBg="rgba(56,189,248,0.1)"
      accentBorder="rgba(56,189,248,0.3)"
      maxWidth={900}
    >
      <div className="flex flex-col overflow-hidden" style={{ maxHeight: "70vh" }}>
        {/* Stats */}
        {data && (
          <div className="grid shrink-0 grid-cols-4 gap-2 border-b p-4" style={{ borderColor: "var(--bd)" }}>
            <StatTile label="Tổng" value={data.counts.available + data.counts.sold + data.counts.extracted} color="var(--tx)" />
            <StatTile label="Còn sẵn" value={data.counts.available} color="rgb(52,211,153)" />
            <StatTile label="Đã bán" value={data.counts.sold} color="rgb(239,68,68)" />
            <StatTile label="Đã bóc" value={data.counts.extracted} color="rgb(168,85,247)" />
          </div>
        )}

        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 p-3" style={{ borderBottom: "1px solid var(--bd)" }}>
          <StatusPill label="📊 Tất cả" active={statusFilter === "ALL"} onClick={() => onStatusChange("ALL")} />
          <StatusPill label="🟢 Còn sẵn" active={statusFilter === "AVAILABLE"} onClick={() => onStatusChange("AVAILABLE")} />
          <StatusPill label="🔴 Đã bán" active={statusFilter === "SOLD"} onClick={() => onStatusChange("SOLD")} />
          <StatusPill label="🟣 Đã bóc" active={statusFilter === "EXTRACTED"} onClick={() => onStatusChange("EXTRACTED")} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCreateBatchRequest}
            className="rounded-xl px-3 py-1.5 text-[11px] font-black transition-all hover:opacity-90"
            style={{ background: "rgb(249,115,22)", color: "#fff" }}
          >
            📦 Tạo lô mới
          </button>
          <button
            type="button"
            onClick={onShowHistory}
            className="rounded-xl px-3 py-1.5 text-[11px] font-black transition-all hover:opacity-80"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
          >
            🕐 Lịch sử
          </button>
        </div>

        {selectedCount > 0 && (
          <div
            className="flex shrink-0 items-center justify-between gap-2 px-4 py-2"
            style={{ background: "rgba(249,115,22,0.08)", borderBottom: "1px solid var(--bd)" }}
          >
            <p className="text-[12px] font-bold" style={{ color: "rgb(249,115,22)" }}>
              Đã chọn {selectedCount} tài khoản
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg px-3 py-1 text-[10px] font-black"
                style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
              >
                Bỏ chọn
              </button>
              <button
                type="button"
                onClick={() => onExtractRequest(Array.from(selectedIds))}
                className="rounded-lg px-3 py-1 text-[10px] font-black"
                style={{ background: "rgb(168,85,247)", color: "#fff" }}
              >
                🔪 Bóc {selectedCount} tài khoản
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading && !data ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--tx-f)" }} />
            </div>
          ) : grouped.length === 0 ? (
            <p className="py-8 text-center text-[12px]" style={{ color: "var(--tx-f)" }}>
              Không có dòng nào trong kho.
            </p>
          ) : (
            <div className="space-y-3">
              {grouped.map((group) => {
                const isCollapsed = collapsed.has(group.key);
                const groupStartIdx = data ? data.items.findIndex((it) => it.id === group.items[0]!.id) : 0;
                const isExpired = group.expiresAt ? new Date(group.expiresAt) < new Date() : false;
                return (
                  <div
                    key={group.key}
                    className="rounded-xl overflow-hidden"
                    style={{
                      border: "1px solid var(--bd)",
                      background: "var(--inp)",
                    }}
                  >
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 p-3 cursor-pointer"
                      onClick={() => toggleCollapse(group.key)}
                      style={{ background: "var(--surface)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px]" style={{ color: "var(--tx-f)" }}>
                          {isCollapsed ? "▶" : "▼"}
                        </span>
                        <span className="text-[12px] font-black" style={{ color: "var(--tx)" }}>
                          {group.label}
                        </span>
                        {group.cost !== null && (
                          <span
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                            style={{ background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)" }}
                          >
                            {group.cost.toLocaleString("vi-VN")}đ/acc
                          </span>
                        )}
                        {group.priority > 0 && (
                          <span
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                            style={{ background: "rgba(250,204,21,0.15)", color: "rgb(250,204,21)" }}
                            title={`Ưu tiên bán trước (priority=${group.priority})`}
                          >
                            ⭐ Ưu tiên {group.priority}
                          </span>
                        )}
                        {isExpired && (
                          <span
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                            style={{ background: "rgba(239,68,68,0.12)", color: "rgb(239,68,68)" }}
                          >
                            ⚠️ Hết hạn
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: "var(--tx-f)" }}>
                          {group.items.length} dòng
                        </span>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => selectAllInGroup(group.items)}
                          className="rounded-md px-2 py-1 text-[10px] font-bold transition-all hover:opacity-80"
                          style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
                        >
                          Chọn cả lô
                        </button>
                        {group.key !== "__legacy__" && onSetBatchPriority && (
                          <button
                            type="button"
                            onClick={() => {
                              const input = window.prompt(
                                `Đặt ưu tiên bán cho lô này.\nSố càng cao → bán càng trước. Hiện: ${group.priority}.\nVD: 0 = mặc định FIFO, 1-99 = ưu tiên cao.`,
                                String(group.priority),
                              );
                              if (input === null) return;
                              const num = Number(input.trim());
                              if (!Number.isFinite(num) || num < 0) {
                                return;
                              }
                              onSetBatchPriority(group.key, Math.floor(num));
                            }}
                            className="rounded-md px-2 py-1 text-[10px] font-bold transition-all hover:opacity-80"
                            style={{ background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.3)", color: "rgb(250,204,21)" }}
                          >
                            ⭐ Ưu tiên
                          </button>
                        )}
                        {group.key !== "__legacy__" && group.items.length === 0 && (
                          <button
                            type="button"
                            onClick={() => onDeleteBatch(group.key)}
                            className="rounded-md px-2 py-1 text-[10px] font-bold transition-all hover:opacity-80"
                            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "rgb(239,68,68)" }}
                          >
                            🗑 Xóa lô
                          </button>
                        )}
                      </div>
                    </div>
                    {!isCollapsed && (
                      <div className="divide-y" style={{ borderColor: "var(--bd)" }}>
                        {group.items.map((item, localIdx) => {
                          const globalIdx = groupStartIdx + localIdx;
                          const isSelected = selectedIds.has(item.id);
                          const isAvailable = item.status === "AVAILABLE";
                          return (
                            <div
                              key={item.id}
                              className="flex items-start gap-3 p-2.5 hover:bg-black/5 cursor-pointer"
                              onClick={(e) => {
                                if (!isAvailable) return;
                                toggleSelect(item.id, globalIdx, e.shiftKey);
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!isAvailable}
                                onChange={() => undefined}
                                className="mt-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <p
                                  className="break-all font-mono text-[11.5px]"
                                  style={{ color: item.status === "AVAILABLE" ? "var(--tx)" : "var(--tx-f)" }}
                                >
                                  {item.text}
                                </p>
                                <p className="mt-0.5 text-[10px]" style={{ color: "var(--tx-f)" }}>
                                  {item.status === "AVAILABLE" && <>🟢 Nhập {formatDateTime(item.uploadedAt)}</>}
                                  {item.status === "SOLD" && item.soldToOrder && (
                                    <>
                                      🔴 Bán {formatDateTime(item.soldToOrder.deliveredAt || item.soldAt!)}{" "}
                                      cho <b>@{item.soldToCustomer?.telegramUsername ?? item.soldToCustomer?.telegramUserId ?? "?"}</b>{" "}
                                      ({item.soldToOrder.code})
                                    </>
                                  )}
                                  {item.status === "EXTRACTED" && <>🟣 Đã bóc {item.extractedAt ? formatDateTime(item.extractedAt) : ""}</>}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-2" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
      <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
        {label}
      </p>
      <p className="mt-0.5 text-[18px] font-black" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function StatusPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-3 py-1.5 text-[11px] font-black transition-all"
      style={{
        background: active ? "rgba(56,189,248,0.15)" : "var(--inp)",
        border: `1px solid ${active ? "rgba(56,189,248,0.4)" : "var(--bd)"}`,
        color: active ? "rgb(56,189,248)" : "var(--tx-m)",
      }}
    >
      {label}
    </button>
  );
}
