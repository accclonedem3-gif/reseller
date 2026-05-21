import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Image as ImageIcon, RefreshCw, RotateCcw, Send, Trash2, X } from "lucide-react";

import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} · ${dd}/${mo}`;
}

function statusChip(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "COMPLETED") return { label: "Hoàn tất", color: "rgb(52,211,153)", bg: "rgba(52,211,153,0.12)", dot: "bg-emerald-400" };
  if (s === "FAILED") return { label: "Thất bại", color: "rgb(248,113,113)", bg: "rgba(248,113,113,0.12)", dot: "bg-red-400" };
  if (s === "SENDING") return { label: "Đang gửi", color: "rgb(56,189,248)", bg: "rgba(56,189,248,0.12)", dot: "bg-sky-400" };
  if (s === "SCHEDULED") return { label: "Đã lên lịch", color: "rgb(167,139,250)", bg: "rgba(167,139,250,0.12)", dot: "bg-violet-400" };
  if (s === "QUEUED") return { label: "Đang queue", color: "rgb(251,191,36)", bg: "rgba(251,191,36,0.12)", dot: "bg-amber-400" };
  return { label: status, color: "var(--tx-f)", bg: "var(--inp)", dot: "bg-slate-400" };
}

// ─── FailedRecipientsPanel ───────────────────────────────────────────────────

function FailedRecipientsPanel({ broadcastId }: { broadcastId: string }) {
  const q = useQuery({
    queryKey: ["broadcasts", broadcastId, "failed"],
    queryFn: async () => (await api.get(`/broadcasts/${broadcastId}/failed`)).data,
  });
  if (q.isLoading) return <p className="mt-2 text-[12px]" style={{ color: "var(--tx-f)" }}>Đang tải...</p>;
  const list: any[] = q.data || [];
  if (!list.length) return <p className="mt-2 text-[12px]" style={{ color: "var(--tx-f)" }}>Không có lỗi.</p>;
  return (
    <div className="mt-2 space-y-1">
      {list.map((r) => (
        <div key={r.customerId} className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
          <span className="text-[12px] font-semibold" style={{ color: "var(--tx)" }}>
            {r.telegramUsername ? `@${r.telegramUsername}` : r.name || r.telegramChatId}
          </span>
          <span className="truncate max-w-[180px] text-[11px] text-rose-400" title={r.errorMessage || ""}>{r.errorMessage || "Lỗi không xác định"}</span>
        </div>
      ))}
    </div>
  );
}

// ─── BroadcastCard ───────────────────────────────────────────────────────────

function BroadcastPreviewPopup({ item, onClose }: { item: any; onClose: () => void }) {
  const chip = statusChip(item.status);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[80]" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[81] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(52,211,153,0.12)" }}>
              <Send className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div>
              <p className="text-[13px] font-black" style={{ color: "var(--tx)" }}>{item.title || "Thông báo mới"}</p>
              <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>{fmtDate(item.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: chip.bg, color: chip.color }}>
              <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} /> {chip.label}
            </span>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 transition hover:opacity-70" style={{ color: "var(--tx-f)" }}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Image */}
        {item.imageUrl && (
          <img src={item.imageUrl} alt="" className="max-h-48 w-full object-cover" />
        )}

        {/* Message */}
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: "var(--tx)" }}>{item.message}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 px-5 py-4">
          {[
            { label: "Người nhận", value: item.totalTargets, cls: "" },
            { label: "Đã gửi", value: item.sentCount, cls: "text-emerald-400" },
            { label: "Lỗi", value: item.failedCount, cls: item.failedCount > 0 ? "text-rose-400" : "" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className={`text-xl font-black tabular-nums ${s.cls}`} style={!s.cls ? { color: "var(--tx)" } : undefined}>{s.value}</p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}

function BroadcastCard({ item, onRetry, onResend, retrying }: { item: any; onRetry: () => void; onResend: () => void; retrying: boolean }) {
  const [showFailed, setShowFailed] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const chip = statusChip(item.status);

  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
      <div className="flex items-start gap-3">
        {/* icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.2)" }}>
          <Send className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-black" style={{ color: "var(--tx)" }}>{item.title || "Thông báo mới"}</p>
            <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black"
              style={{ background: chip.bg, color: chip.color }}>
              <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} /> {chip.label}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--tx-f)" }}>{item.message}</p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{fmtDate(item.createdAt)}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: "NGƯỜI NHẬN", value: item.totalTargets, cls: "" },
          { label: "ĐÃ GỬI", value: item.sentCount, cls: "text-emerald-400" },
          { label: "LỖI", value: item.failedCount, cls: item.failedCount > 0 ? "text-rose-400" : "" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl px-3 py-2" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{s.label}</p>
            <p className={`mt-1 text-base font-black tabular-nums ${s.cls}`} style={!s.cls ? { color: "var(--tx)" } : undefined}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {item.failedCount > 0 && (
            <button type="button" onClick={() => setShowFailed(!showFailed)}
              className="flex items-center gap-1 text-[11px] font-black transition hover:opacity-70"
              style={{ color: "rgb(251,191,36)" }}>
              ⚠ {showFailed ? "Ẩn" : `Xem ${item.failedCount} lỗi`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-black transition hover:opacity-80"
            style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
            Xem
          </button>
          <button
            type="button"
            disabled={retrying || item.status === "SENDING"}
            onClick={item.failedCount > 0 ? onRetry : onResend}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-black transition hover:opacity-80 disabled:opacity-40"
            style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", color: "rgb(52,211,153)" }}>
            <RotateCcw className="h-3 w-3" /> Đăng lại
          </button>
        </div>
      </div>
      {showFailed && <FailedRecipientsPanel broadcastId={item.id} />}
      {showPreview && <BroadcastPreviewPopup item={item} onClose={() => setShowPreview(false)} />}
    </div>
  );
}

// ─── ScheduleCard ────────────────────────────────────────────────────────────

function ScheduleCard({ item, onToggle, onDelete, toggling, deleting }: { item: any; onToggle: () => void; onDelete: () => void; toggling: boolean; deleting: boolean }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.2)" }}>
          <Calendar className="h-4 w-4 text-violet-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-black" style={{ color: "var(--tx)" }}>{item.title || "Lịch gửi tự động"}</p>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" disabled={toggling} onClick={onToggle}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black transition hover:opacity-80 disabled:opacity-40"
                style={{ background: item.isActive ? "rgba(52,211,153,0.12)" : "var(--surface)", border: `1px solid ${item.isActive ? "rgba(52,211,153,0.3)" : "var(--bd)"}`, color: item.isActive ? "rgb(52,211,153)" : "var(--tx-f)" }}>
                <span className={`h-1.5 w-1.5 rounded-full ${item.isActive ? "bg-emerald-400" : "bg-slate-500"}`} />
                {item.isActive ? "Đang bật" : "Đã tắt"}
              </button>
              <button type="button" disabled={deleting} onClick={onDelete}
                className="rounded-lg p-1.5 transition hover:opacity-70 disabled:opacity-40"
                style={{ color: "var(--tx-f)" }}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--tx-f)" }}>{item.message}</p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
            {item.frequency === "daily" ? "Hằng ngày" : `Hằng tuần · ${["CN","T2","T3","T4","T5","T6","T7"][item.repeatDay ?? 1]}`} · {item.sendTime}
            {item.lastRunAt && ` · Chạy lần cuối: ${fmtDate(item.lastRunAt)}`}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type Mode = "immediate" | "scheduled" | "recurring";
type HistoryTab = "all" | "scheduled" | "failed";

const MODES: { key: Mode; icon: any; label: string; desc: string }[] = [
  { key: "immediate", icon: Send, label: "Gửi ngay", desc: "Broadcast tới tất cả người dùng ngay lập tức" },
  { key: "scheduled", icon: Calendar, label: "Lên lịch", desc: "Chọn ngày & giờ gửi cụ thể trong tương lai" },
  { key: "recurring", icon: RefreshCw, label: "Lặp lại", desc: "Tự động gửi định kỳ hàng ngày hoặc tuần" },
];

export function BroadcastsPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("immediate");
  const [historyTab, setHistoryTab] = useState<HistoryTab>("all");

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [sendTime, setSendTime] = useState("09:00");
  const [frequency, setFrequency] = useState("daily");
  const [repeatDay, setRepeatDay] = useState(1);
  const [uploadingImage, setUploadingImage] = useState(false);

  const broadcastsQuery = useQuery({
    queryKey: ["broadcasts"],
    queryFn: async () => (await api.get("/broadcasts")).data,
    refetchInterval: 10000,
  });
  const schedulesQuery = useQuery({
    queryKey: ["broadcasts", "schedules"],
    queryFn: async () => (await api.get("/broadcasts/schedules")).data,
    refetchInterval: 30000,
  });

  const broadcasts: any[] = broadcastsQuery.data || [];
  const schedules: any[] = schedulesQuery.data || [];

  const completedCount = broadcasts.filter((b) => b.status === "COMPLETED").length;
  const queueCount = broadcasts.filter((b) => b.status === "QUEUED" || b.status === "SENDING").length;
  const scheduledCount = schedules.length + broadcasts.filter((b) => b.status === "SCHEDULED").length;

  const filteredBroadcasts = broadcasts.filter((b) => {
    if (historyTab === "scheduled") return b.status === "SCHEDULED";
    if (historyTab === "failed") return b.failedCount > 0 || b.status === "FAILED";
    return true;
  });

  function resetForm() {
    setTitle(""); setMessage(""); setImageUrl("");
    setScheduledAt(""); setSendTime("09:00"); setFrequency("daily"); setRepeatDay(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleImageFile(file: File) {
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post("/broadcasts/upload-image", form);
      setImageUrl(res.data.url);
    } catch {
      showToast({ message: "Upload ảnh thất bại", tone: "error" });
    } finally {
      setUploadingImage(false);
    }
  }

  const createMutation = useMutation({
    mutationFn: async () => api.post("/broadcasts", {
      title: title || undefined,
      message,
      imageUrl: imageUrl || undefined,
      mode,
      scheduledAt: mode === "scheduled" ? scheduledAt : undefined,
      sendTime: mode === "recurring" ? sendTime : undefined,
      frequency: mode === "recurring" ? frequency : undefined,
      repeatDay: mode === "recurring" && frequency === "weekly" ? repeatDay : undefined,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
      showToast({ message: mode === "recurring" ? "Đã tạo lịch gửi tự động" : mode === "scheduled" ? "Đã lên lịch broadcast" : "Broadcast đã vào hàng chờ", tone: "success" });
      resetForm();
    },
    onError: (err: any) => showToast({ message: err?.response?.data?.message || "Lỗi", tone: "error" }),
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/broadcasts/${id}/retry`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["broadcasts"] }),
    onError: (err: any) => showToast({ message: err?.response?.data?.message || "Lỗi khi gửi lại", tone: "error" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => api.put(`/broadcasts/schedules/${id}/toggle`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["broadcasts", "schedules"] }),
    onError: (err: any) => showToast({ message: err?.response?.data?.message || "Lỗi", tone: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/broadcasts/schedules/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["broadcasts", "schedules"] }),
    onError: (err: any) => showToast({ message: err?.response?.data?.message || "Lỗi", tone: "error" }),
  });

  const canSubmit = message.trim().length > 0 && !createMutation.isPending &&
    (mode !== "scheduled" || Boolean(scheduledAt));

  const submitLabel = createMutation.isPending
    ? "Đang xử lý..."
    : mode === "recurring" ? "Lưu & bật tự động"
    : mode === "scheduled" ? "Lên lịch gửi"
    : "Gửi ngay";

  const statCards = [
    { label: "TỔNG CHIẾN DỊCH", value: broadcasts.length, sub: "Đã tạo", color: "var(--tx)", border: "rgb(99,102,241)" },
    { label: "HOÀN TẤT", value: completedCount, sub: "Gửi thành công", color: "rgb(52,211,153)", border: "rgb(52,211,153)" },
    { label: "ĐANG QUEUE", value: queueCount, sub: "Chờ xử lý", color: "rgb(251,191,36)", border: "rgb(251,191,36)" },
    { label: "ĐÃ LÊN LỊCH", value: scheduledCount, sub: "Sắp gửi tự động", color: "rgb(167,139,250)", border: "rgb(167,139,250)" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "rgb(249,115,22)" }}>Thông báo bot</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--tx-f)" }}>Gửi thông báo đồng loạt đến toàn bộ khách hàng bot</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setHistoryTab("scheduled")}
            className="rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
            Xem toàn bộ lịch sử
          </button>
          <button type="button" onClick={() => { resetForm(); setMode("immediate"); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "rgb(249,115,22)", color: "#fff" }}>
            + Tạo chiến dịch
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCards.map((c) => (
          <div key={c.label} className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)", borderLeft: `3px solid ${c.border}` }}>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{c.label}</p>
            <p className="mt-2 text-3xl font-black tabular-nums" style={{ color: c.color }}>{c.value}</p>
            <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Main 2-col */}
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        {/* Left: Compose */}
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
          <div className="flex items-center gap-2 mb-5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(249,115,22,0.12)" }}>
              <Send className="h-3.5 w-3.5 text-orange-400" />
            </div>
            <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Soạn & gửi broadcast</h2>
          </div>

          {/* Mode selector */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {MODES.map(({ key, icon: Icon, label, desc }) => {
              const active = mode === key;
              return (
                <button key={key} type="button" onClick={() => setMode(key)}
                  className="rounded-2xl p-4 text-left transition hover:opacity-90"
                  style={{ background: active ? "rgba(249,115,22,0.08)" : "var(--inp)", border: `1.5px solid ${active ? "rgb(249,115,22)" : "var(--bd)"}` }}>
                  <Icon className={`h-4 w-4 mb-2 ${active ? "text-orange-400" : ""}`} style={!active ? { color: "var(--tx-f)" } : undefined} />
                  <p className="text-[13px] font-black" style={{ color: active ? "rgb(249,115,22)" : "var(--tx)" }}>{label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--tx-f)" }}>{desc}</p>
                </button>
              );
            })}
          </div>

          {/* Mode-specific config */}
          {mode === "scheduled" && (
            <div className="mb-4 rounded-2xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
              <div className="mb-2 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-violet-400" />
                <p className="text-[12px] font-black" style={{ color: "var(--tx)" }}>Thời gian gửi</p>
              </div>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
            </div>
          )}
          {mode === "recurring" && (
            <div className="mb-4 rounded-2xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
              <div className="mb-3 flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
                <p className="text-[12px] font-black" style={{ color: "var(--tx)" }}>Cấu hình lặp lại</p>
              </div>
              <div className={`grid gap-3 ${frequency === "weekly" ? "grid-cols-3" : "grid-cols-2"}`}>
                <div>
                  <p className="mb-1 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Gửi lúc</p>
                  <input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Tần suất</p>
                  <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}>
                    <option value="daily">Hằng ngày</option>
                    <option value="weekly">Hằng tuần</option>
                  </select>
                </div>
                {frequency === "weekly" && (
                  <div>
                    <p className="mb-1 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Vào thứ</p>
                    <select value={repeatDay} onChange={(e) => setRepeatDay(Number(e.target.value))}
                      className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}>
                      <option value={1}>Thứ 2</option>
                      <option value={2}>Thứ 3</option>
                      <option value={3}>Thứ 4</option>
                      <option value={4}>Thứ 5</option>
                      <option value={5}>Thứ 6</option>
                      <option value={6}>Thứ 7</option>
                      <option value={0}>Chủ nhật</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Form fields */}
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[12px] font-black" style={{ color: "var(--tx)" }}>Tiêu đề chiến dịch</p>
                <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>TUỲ CHỌN</p>
              </div>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Khuyến mãi flash sale tháng 5"
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[12px] font-black" style={{ color: "var(--tx)" }}>Nội dung tin nhắn</p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black text-rose-400">BẮT BUỘC</span>
                  <span className="text-[11px]" style={{ color: "var(--tx-f)" }}>{message.length} / 4096</span>
                </div>
              </div>
              <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 4096))}
                placeholder="Nhập nội dung broadcast tới toàn bộ người dùng bot..."
                rows={5}
                className="w-full resize-none rounded-xl px-3 py-2.5 text-[13px] outline-none"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[12px] font-black" style={{ color: "var(--tx)" }}>Ảnh đính kèm</p>
                <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>TUỲ CHỌN</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }} />
              {imageUrl ? (
                <div className="relative overflow-hidden rounded-xl" style={{ border: "1px solid var(--bd)" }}>
                  <img src={imageUrl} alt="preview" className="max-h-36 w-full object-cover" />
                  <button type="button" onClick={() => { setImageUrl(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button type="button" disabled={uploadingImage} onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl py-5 transition"
                  style={{ background: "var(--inp)", border: "1px dashed var(--bd)" }}>
                  <ImageIcon className="h-5 w-5" style={{ color: "var(--tx-f)" }} />
                  <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
                    Kéo thả hoặc{" "}
                    <span style={{ color: "rgb(249,115,22)" }}>chọn ảnh từ thiết bị</span>
                  </p>
                </button>
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="mt-5 flex items-center gap-2">
            <button type="button" disabled={!canSubmit} onClick={() => createMutation.mutate()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-black transition hover:opacity-80 disabled:opacity-40"
              style={{ background: "rgb(249,115,22)", color: "#fff" }}>
              <Send className="h-4 w-4" /> {submitLabel}
            </button>
            <button type="button" onClick={resetForm}
              className="flex items-center gap-1.5 rounded-xl px-4 py-3 text-[12px] font-black transition hover:opacity-80"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
              <ImageIcon className="h-3.5 w-3.5" /> Lưu nháp
            </button>
          </div>
        </div>

        {/* Right: History */}
        <div className="flex flex-col gap-0 overflow-hidden rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
          {/* History header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--bd)" }}>
            <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Lịch sử chiến dịch</h2>
            <span className="text-[12px]" style={{ color: "var(--tx-f)" }}>{broadcasts.length} chiến dịch</span>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 px-4 py-2.5" style={{ borderBottom: "1px solid var(--bd)" }}>
            {[
              { key: "all" as HistoryTab, label: "Tất cả", dot: "" },
              { key: "scheduled" as HistoryTab, label: "Đã lên lịch", dot: "bg-violet-400" },
              { key: "failed" as HistoryTab, label: "Thất bại", dot: "bg-rose-400" },
            ].map(({ key, label, dot }) => {
              const active = historyTab === key;
              return (
                <button key={key} type="button" onClick={() => setHistoryTab(key)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-black transition"
                  style={{ background: active ? "rgba(52,211,153,0.1)" : "transparent", border: `1px solid ${active ? "rgba(52,211,153,0.3)" : "transparent"}`, color: active ? "rgb(52,211,153)" : "var(--tx-f)" }}>
                  {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
                  {label}
                </button>
              );
            })}
          </div>

          {/* List */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 600 }}>
            {/* Recurring schedules (always show in "all" and "scheduled" tabs) */}
            {(historyTab === "all" || historyTab === "scheduled") && schedules.map((s) => (
              <ScheduleCard key={s.id} item={s}
                onToggle={() => toggleMutation.mutate(s.id)}
                onDelete={() => deleteMutation.mutate(s.id)}
                toggling={toggleMutation.isPending}
                deleting={deleteMutation.isPending}
              />
            ))}

            {/* One-time broadcasts */}
            {broadcastsQuery.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl" style={{ background: "var(--inp)" }} />
              ))
            ) : filteredBroadcasts.length === 0 && schedules.length === 0 ? (
              <p className="py-10 text-center text-[13px]" style={{ color: "var(--tx-f)" }}>Chưa có chiến dịch nào</p>
            ) : filteredBroadcasts.map((item) => (
              <BroadcastCard key={item.id} item={item}
                onRetry={() => retryMutation.mutate(item.id)}
                onResend={() => {
                  setTitle(item.title || "");
                  setMessage(item.message || "");
                  setImageUrl(item.imageUrl || "");
                  setMode("immediate");
                }}
                retrying={retryMutation.isPending}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
