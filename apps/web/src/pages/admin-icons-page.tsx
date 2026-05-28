import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Upload, X } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";

type IconCatalogEntry = {
  id: string;
  shopId: string | null;
  label: string;
  imageUrl: string;
  customEmojiId: string;
  position: number;
};

function getErrMsg(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "response" in error) {
    const msg = (error as any).response?.data?.message;
    if (typeof msg === "string") return msg;
    if (Array.isArray(msg)) return msg.join(", ");
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export function AdminIconsPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [customEmojiId, setCustomEmojiId] = useState("");
  const [uploading, setUploading] = useState(false);

  const query = useQuery<IconCatalogEntry[]>({
    queryKey: ["icon-catalog"],
    queryFn: async () => (await api.get("/icon-catalog")).data,
  });
  const allIcons = query.data || [];
  const globalIcons = allIcons.filter((i) => i.shopId === null);

  const resetForm = () => {
    setEditingId(null);
    setLabel("");
    setImageUrl("");
    setCustomEmojiId("");
    setShowForm(false);
  };

  const createMutation = useMutation({
    mutationFn: async () => (await api.post("/icon-catalog", { label: label.trim(), imageUrl: imageUrl.trim(), customEmojiId: customEmojiId.trim(), isGlobal: true })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["icon-catalog"] });
      resetForm();
      showToast({ tone: "success", message: "Đã tạo icon global." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không tạo được icon.") }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => api.put(`/icon-catalog/${editingId}`, { label: label.trim(), imageUrl: imageUrl.trim(), customEmojiId: customEmojiId.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["icon-catalog"] });
      resetForm();
      showToast({ tone: "success", message: "Đã cập nhật." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không cập nhật được.") }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/icon-catalog/${id}`),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["icon-catalog"] }),
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không xóa được.") }),
  });

  return (
    <div className="space-y-5 p-6">
      <div>
        <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "rgb(99,102,241)" }}>SUPER ADMIN</p>
        <h1 className="text-2xl font-black" style={{ color: "var(--tx)" }}>Quản lý icon global</h1>
        <p className="text-sm mt-1" style={{ color: "var(--tx-m)" }}>
          Icon ở đây hiện cho tất cả seller. Mỗi seller vẫn có thể thêm icon riêng trong shop của họ.
        </p>
      </div>

      <button
        type="button"
        onClick={() => { resetForm(); setShowForm(true); }}
        className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-600"
      >
        <Plus className="h-4 w-4" />
        Thêm icon global
      </button>

      {showForm && (
        <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>{editingId ? "Sửa icon" : "Tạo icon mới"}</p>
            <button type="button" onClick={resetForm} className="text-slate-400 hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <p className="mb-1 text-xs" style={{ color: "var(--tx-m)" }}>Tên (VD: CapCut)</p>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="CapCut" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
          </div>
          <div>
            <p className="mb-1 text-xs" style={{ color: "var(--tx-m)" }}>Ảnh logo</p>
            <div className="flex gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-80" style={{ borderColor: "var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }}>
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "..." : "Upload"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await api.post<{ url: string }>("/products/upload-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
                      setImageUrl(res.data.url);
                    } catch {
                      showToast({ tone: "error", message: "Upload thất bại." });
                    } finally {
                      setUploading(false);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
              <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://... hoặc upload" className="flex-1 rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
            </div>
            {imageUrl && <img src={imageUrl} alt="" className="mt-2 h-12 w-12 rounded-lg object-contain" />}
          </div>
          <div>
            <p className="mb-1 text-xs" style={{ color: "var(--tx-m)" }}>Telegram Custom Emoji ID</p>
            <input value={customEmojiId} onChange={(e) => setCustomEmojiId(e.target.value)} placeholder="5234567890123456789" className="w-full rounded-lg px-3 py-2 font-mono text-sm outline-none" style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!label.trim() || !imageUrl.trim() || !customEmojiId.trim() || createMutation.isPending || updateMutation.isPending}
              onClick={() => editingId ? updateMutation.mutate() : createMutation.mutate()}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              {editingId ? "Lưu" : "Tạo"}
            </button>
            <button type="button" onClick={resetForm} className="rounded-lg border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--bd)", color: "var(--tx-m)" }}>
              Hủy
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <p className="mb-3 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
          Icon global ({globalIcons.length})
        </p>
        {globalIcons.length === 0 ? (
          <p className="text-center py-8 text-sm" style={{ color: "var(--tx-f)" }}>Chưa có icon global nào.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {globalIcons.map((icon) => (
              <div key={icon.id} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(icon.id);
                    setLabel(icon.label);
                    setImageUrl(icon.imageUrl);
                    setCustomEmojiId(icon.customEmojiId);
                    setShowForm(true);
                  }}
                  className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border transition hover:border-indigo-400/50 hover:bg-indigo-500/10"
                  style={{ borderColor: "var(--bd)", background: "var(--inp)" }}
                >
                  <img src={icon.imageUrl} alt="" className="h-10 w-10 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }} />
                  <span className="text-[11px] font-bold truncate w-full px-1 text-center" style={{ color: "var(--tx-m)" }}>{icon.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { if (window.confirm(`Xóa "${icon.label}"?`)) deleteMutation.mutate(icon.id); }}
                  className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white hover:bg-rose-600"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
