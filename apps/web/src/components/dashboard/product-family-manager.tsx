import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, X } from "lucide-react";

import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

type ProductFamilyRow = {
  id: string;
  key: string;
  label: string;
  emoji: string | null;
  customEmojiId: string | null;
  sortOrder: number;
  isActive: boolean;
  isBuiltin: boolean;
};

const inputCls = "h-9 w-full rounded-lg border px-2.5 text-[13px] outline-none";
const inputStyle = { background: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" } as const;

function getErrMsg(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "response" in err) {
    const msg = (err as any).response?.data?.message;
    if (typeof msg === "string") return msg;
    if (Array.isArray(msg)) return msg.join(", ");
  }
  return fallback;
}

export function ProductFamilyManager() {
  const { showToast } = useToast();
  const qc = useQueryClient();

  const query = useQuery<ProductFamilyRow[]>({
    queryKey: ["admin-product-families"],
    queryFn: async () => (await api.get("/admin/product-families")).data,
  });
  const families = query.data ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("");
  const [customEmojiId, setCustomEmojiId] = useState("");
  const [sortOrder, setSortOrder] = useState("50");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-product-families"] });
    qc.invalidateQueries({ queryKey: ["product-families"] }); // dropdowns
  };
  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setKey("");
    setLabel("");
    setEmoji("");
    setCustomEmojiId("");
    setSortOrder("50");
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        label: label.trim(),
        emoji: emoji.trim() || undefined,
        customEmojiId: customEmojiId.trim() || undefined,
        sortOrder: Number(sortOrder) || 0,
      };
      if (editingId) {
        return api.put(`/admin/product-families/${editingId}`, payload);
      }
      return api.post("/admin/product-families", { key: key.trim(), ...payload });
    },
    onSuccess: () => {
      refresh();
      resetForm();
      showToast({ tone:"success", message: "Đã lưu dòng sản phẩm." });
    },
    onError: (e) => showToast({ tone:"error", message: getErrMsg(e, "Lưu thất bại.") }),
  });

  const toggleMut = useMutation({
    mutationFn: async (f: ProductFamilyRow) =>
      api.put(`/admin/product-families/${f.id}`, { isActive: !f.isActive }),
    onSuccess: refresh,
    onError: (e) => showToast({ tone:"error", message: getErrMsg(e, "Cập nhật thất bại.") }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin/product-families/${id}`),
    onSuccess: () => {
      refresh();
      showToast({ tone:"success", message: "Đã xoá dòng sản phẩm." });
    },
    onError: (e) => showToast({ tone:"error", message: getErrMsg(e, "Xoá thất bại.") }),
  });

  function openEdit(f: ProductFamilyRow) {
    setEditingId(f.id);
    setShowForm(true);
    setKey(f.key);
    setLabel(f.label);
    setEmoji(f.emoji ?? "");
    setCustomEmojiId(f.customEmojiId ?? "");
    setSortOrder(String(f.sortOrder));
  }

  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-black" style={{ color: "var(--tx)" }}>Dòng sản phẩm (Product Family)</h3>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--tx-m)" }}>
            Thêm/sửa các dòng để hiện trong dropdown khi tạo sản phẩm. Dòng mặc định không xoá được (chỉ ẩn).
          </p>
        </div>
        {!showForm && (
          <button type="button" onClick={() => { resetForm(); setShowForm(true); }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold text-white transition hover:opacity-90"
            style={{ background: "rgb(249,115,22)" }}>
            <Plus className="h-3.5 w-3.5" /> Thêm dòng
          </button>
        )}
      </div>

      {showForm && (
        <div className="mt-4 grid gap-3 rounded-xl p-4 sm:grid-cols-2" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-m)" }}>Mã (key)</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} disabled={!!editingId}
              placeholder="VD: CURSOR" className={`${inputCls} font-mono ${editingId ? "opacity-60" : ""}`} style={inputStyle} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-m)" }}>Tên hiển thị</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Cursor" className={inputCls} style={inputStyle} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-m)" }}>Emoji (tùy chọn)</span>
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="💻" className={inputCls} style={inputStyle} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-m)" }}>Custom Emoji ID (Premium, tùy chọn)</span>
            <input value={customEmojiId} onChange={(e) => setCustomEmojiId(e.target.value)} placeholder="5391..." className={`${inputCls} font-mono`} style={inputStyle} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-m)" }}>Thứ tự</span>
            <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} inputMode="numeric" className={inputCls} style={inputStyle} />
          </label>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !label.trim() || (!editingId && !key.trim())}
              className="rounded-lg px-4 py-2 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-40"
              style={{ background: "rgb(16,185,129)" }}>
              {saveMut.isPending ? "Đang lưu…" : "Lưu"}
            </button>
            <button type="button" onClick={resetForm}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-bold transition hover:opacity-80"
              style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
              <X className="h-3.5 w-3.5" /> Hủy
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-1.5">
        {families.map((f) => (
          <div key={f.id} className="flex items-center gap-3 rounded-xl px-3 py-2"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", opacity: f.isActive ? 1 : 0.5 }}>
            <span className="w-6 shrink-0 text-center text-[15px]">{f.emoji || "•"}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-black" style={{ color: "var(--tx)" }}>{f.label}</p>
              <p className="truncate font-mono text-[11px]" style={{ color: "var(--tx-f)" }}>{f.key}{f.isBuiltin ? " · mặc định" : ""}</p>
            </div>
            <button type="button" onClick={() => toggleMut.mutate(f)}
              className="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold transition hover:opacity-80"
              style={f.isActive
                ? { background: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)" }
                : { background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
              {f.isActive ? "Đang hiện" : "Đang ẩn"}
            </button>
            <button type="button" onClick={() => openEdit(f)} title="Sửa"
              className="shrink-0 rounded-md p-1.5 transition hover:opacity-80" style={{ color: "var(--tx-m)" }}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {!f.isBuiltin && (
              <button type="button"
                onClick={() => { if (window.confirm(`Xoá dòng "${f.label}"?`)) deleteMut.mutate(f.id); }}
                title="Xoá" className="shrink-0 rounded-md p-1.5 transition hover:opacity-80" style={{ color: "rgb(239,68,68)" }}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {families.length === 0 && !query.isLoading && (
          <p className="py-4 text-center text-[13px]" style={{ color: "var(--tx-f)" }}>Chưa có dòng sản phẩm nào.</p>
        )}
      </div>
    </div>
  );
}
