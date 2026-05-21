import { Boxes, Check, EyeOff, FolderOpen, GripVertical, Package, PackagePlus, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { hasSellerCapability } from "@/lib/seller-access";
import { useLang } from "@/lib/lang";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { StudioButton, StudioInput } from "@/components/studio/studio-ui";
import { ProductsPageStudio } from "./products-page-studio";
import { SourceProductsPage } from "./source-products-page-pro";

const T = {
  vi: {
    tabProducts: "Sản phẩm",
    tabSource: "Sản phẩm nguồn",
    tabCatalog: "Danh mục",
    addProduct: "Thêm sản phẩm",
    catTitle: "Quản lý danh mục",
    catSubtitle: "Tạo và sắp xếp nhóm danh mục để phân loại sản phẩm trên bot.",
    catNewPh: "Tên danh mục...",
    catNewLabel: "Tạo danh mục mới",
    catEmpty: "Chưa có danh mục nào. Tạo mới ở trên.",
    catDeleteConfirm: (name: string) => `Xóa danh mục "${name}"? Sản phẩm sẽ không bị xóa.`,
    catErrCreate: "Không thể tạo danh mục.",
    catErrUpdate: "Không thể cập nhật danh mục.",
    catErrDelete: "Không thể xóa danh mục.",
    catProducts: (n: number) => `${n} sản phẩm`,
    oosToggleTitle: "Sản phẩm hết hàng",
    oosToggleDesc: "Hiện sản phẩm hết hàng trên bot (mặc định ẩn). Khách vẫn không thể đặt, chỉ xem được danh sách.",
    oosToggleOn: "Đang hiện",
    oosToggleOff: "Đang ẩn",
  },
  en: {
    tabProducts: "Products",
    tabSource: "Source products",
    tabCatalog: "Catalog",
    addProduct: "Add product",
    catTitle: "Catalog management",
    catSubtitle: "Create and arrange catalog groups to organize products in your bot.",
    catNewPh: "Group name...",
    catNewLabel: "Create new group",
    catEmpty: "No groups yet. Create one above.",
    catDeleteConfirm: (name: string) => `Delete group "${name}"? Products will not be deleted.`,
    catErrCreate: "Could not create group.",
    catErrUpdate: "Could not update group.",
    catErrDelete: "Could not delete group.",
    catProducts: (n: number) => `${n} products`,
    oosToggleTitle: "Out-of-stock products",
    oosToggleDesc: "Show out-of-stock products in the bot catalog (hidden by default). Customers can view but not order them.",
    oosToggleOn: "Showing",
    oosToggleOff: "Hidden",
  },
  th: {
    tabProducts: "สินค้า",
    tabSource: "สินค้าต้นทาง",
    tabCatalog: "หมวดหมู่",
    addProduct: "เพิ่มสินค้า",
    catTitle: "จัดการหมวดหมู่",
    catSubtitle: "สร้างและจัดเรียงกลุ่มหมวดหมู่เพื่อจัดระเบียบสินค้าในบอทของคุณ",
    catNewPh: "ชื่อหมวดหมู่...",
    catNewLabel: "สร้างหมวดหมู่ใหม่",
    catEmpty: "ยังไม่มีหมวดหมู่ สร้างใหม่ด้านบน",
    catDeleteConfirm: (name: string) => `ลบหมวดหมู่ "${name}"? สินค้าจะไม่ถูกลบ`,
    catErrCreate: "ไม่สามารถสร้างหมวดหมู่ได้",
    catErrUpdate: "ไม่สามารถอัปเดตหมวดหมู่ได้",
    catErrDelete: "ไม่สามารถลบหมวดหมู่ได้",
    catProducts: (n: number) => `${n} สินค้า`,
    oosToggleTitle: "สินค้าหมดสต็อก",
    oosToggleDesc: "แสดงสินค้าหมดสต็อกในบอท (ซ่อนโดยค่าเริ่มต้น) ลูกค้าดูได้แต่สั่งไม่ได้",
    oosToggleOn: "กำลังแสดง",
    oosToggleOff: "ซ่อนอยู่",
  },
};

type Tab = "products" | "source" | "catalog";

export function ProductsManagementPage() {
  const { session } = useAuth();
  const { lang } = useLang();
  const t = T[lang];
  const isUltra = hasSellerCapability(session, "source_internal_manage");
  const [activeTab, setActiveTab] = useState<Tab>("products");
  const [createPending, setCreatePending] = useState(false);
  const queryClient = useQueryClient();

  const botConfigQuery = useQuery<{ showOutOfStock?: boolean }>({
    queryKey: ["bot-config"],
    queryFn: async () => (await api.get("/bot-config")).data,
    staleTime: 30_000,
  });
  const showOutOfStock = botConfigQuery.data?.showOutOfStock ?? false;

  const toggleOosMutation = useMutation({
    mutationFn: async (value: boolean) => api.put("/bot-config", { showOutOfStock: value }),
    onSuccess: (_, value) => {
      queryClient.setQueryData(["bot-config"], (cur: any) => ({ ...cur, showOutOfStock: value }));
    },
  });

  const handleAddProduct = () => {
    setActiveTab("products");
    setCreatePending(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-[16px] p-1.5" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--bd)", width: "fit-content" }}>
          <TabButton
            active={activeTab === "products"}
            onClick={() => setActiveTab("products")}
            icon={<Package className="h-3.5 w-3.5" />}
            label={t.tabProducts}
          />
          {isUltra && (
            <TabButton
              active={activeTab === "source"}
              onClick={() => setActiveTab("source")}
              icon={<Boxes className="h-3.5 w-3.5" />}
              label={t.tabSource}
              accent="violet"
            />
          )}
          <TabButton
            active={activeTab === "catalog"}
            onClick={() => setActiveTab("catalog")}
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label={t.tabCatalog}
            accent="indigo"
          />
        </div>

        <button
          type="button"
          onClick={handleAddProduct}
          className="flex items-center gap-2 rounded-[12px] px-4 py-2.5 text-sm font-bold transition hover:opacity-90"
          style={{ background: "rgb(249,115,22)", color: "white" }}
        >
          <PackagePlus className="h-4 w-4" />
          {t.addProduct}
        </button>
      </div>

      {activeTab === "products" && (
        <div
          className="flex items-center justify-between gap-4 rounded-[16px] px-4 py-3"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--bd)" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)" }}
            >
              <EyeOff className="h-3.5 w-3.5 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate" style={{ color: "var(--tx)" }}>{t.oosToggleTitle}</p>
              <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--tx-m)" }}>{t.oosToggleDesc}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={toggleOosMutation.isPending || botConfigQuery.isPending}
            onClick={() => toggleOosMutation.mutate(!showOutOfStock)}
            className="shrink-0 flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-xs font-bold transition hover:opacity-80"
            style={{
              background: showOutOfStock ? "rgba(99,102,241,0.15)" : "var(--inp)",
              color: showOutOfStock ? "rgb(129,140,248)" : "var(--tx-f)",
              border: `1px solid ${showOutOfStock ? "rgba(99,102,241,0.35)" : "var(--bd)"}`,
            }}
          >
            {showOutOfStock ? t.oosToggleOn : t.oosToggleOff}
          </button>
        </div>
      )}

      <div>
        {activeTab === "products" && (
          <ProductsPageStudio
            openCreate={createPending}
            onCreateOpened={() => setCreatePending(false)}
          />
        )}
        {activeTab === "source" && isUltra && (
          <SourceProductsPage
            openCreate={createPending}
            onCreateOpened={() => setCreatePending(false)}
          />
        )}
        {activeTab === "catalog" && <CatalogGroupsPage />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  accent = "orange",
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent?: "orange" | "violet" | "indigo";
}) {
  const activeCls =
    accent === "violet"
      ? "bg-violet-500/15 text-violet-300 border border-violet-400/25 shadow-[0_0_12px_rgba(139,92,246,0.15)]"
      : accent === "indigo"
        ? "bg-indigo-500/15 text-indigo-300 border border-indigo-400/25 shadow-[0_0_12px_rgba(99,102,241,0.15)]"
        : "bg-orange-500/15 text-orange-300 border border-orange-400/25 shadow-[0_0_12px_rgba(249,115,22,0.15)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-2 rounded-[12px] px-4 py-2 text-sm font-semibold transition-all duration-200",
        active ? activeCls : "border border-transparent hover:opacity-80",
      ].join(" ")}
      style={active ? undefined : { color: "var(--tx-m)" }}
    >
      {icon}
      {label}
    </button>
  );
}

type CatalogGroup = {
  id: string;
  name: string;
  position: number;
  icon: string | null;
  iconCustomEmojiId: string | null;
  _count: { overrides: number };
};

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

function CatalogGroupsPage() {
  const { lang } = useLang();
  const t = T[lang];
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [iconPickerGroupId, setIconPickerGroupId] = useState<string | null>(null);
  const [showNewIconForm, setShowNewIconForm] = useState(false);
  const [newIconLabel, setNewIconLabel] = useState("");
  const [newIconImageUrl, setNewIconImageUrl] = useState("");
  const [newIconCustomEmojiId, setNewIconCustomEmojiId] = useState("");
  const [newIconUploading, setNewIconUploading] = useState(false);

  const groupsQuery = useQuery<CatalogGroup[]>({
    queryKey: ["catalog-groups"],
    queryFn: async () => (await api.get("/catalog-groups")).data,
  });
  const groups = groupsQuery.data || [];

  const iconCatalogQuery = useQuery<IconCatalogEntry[]>({
    queryKey: ["icon-catalog"],
    queryFn: async () => (await api.get("/icon-catalog")).data,
  });
  const iconCatalog = iconCatalogQuery.data || [];

  const createIconMutation = useMutation({
    mutationFn: async (dto: { label: string; imageUrl: string; customEmojiId: string }) =>
      (await api.post("/icon-catalog", dto)).data as IconCatalogEntry,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["icon-catalog"] });
      setShowNewIconForm(false);
      setNewIconLabel(""); setNewIconImageUrl(""); setNewIconCustomEmojiId("");
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không thể tạo icon.") }),
  });

  const deleteIconMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/icon-catalog/${id}`),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["icon-catalog"] }),
  });

  const setGroupIconMutation = useMutation({
    mutationFn: async ({ id, icon, iconCustomEmojiId }: { id: string; icon: string; iconCustomEmojiId: string }) =>
      api.put(`/catalog-groups/${id}`, { icon, iconCustomEmojiId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog-groups"] });
      setIconPickerGroupId(null);
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không thể đặt icon.") }),
  });

  const createGroupMutation = useMutation({
    mutationFn: async (name: string) => (await api.post("/catalog-groups", { name })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog-groups"] });
      setNewGroupName("");
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, t.catErrCreate) }),
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      api.put(`/catalog-groups/${id}`, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog-groups"] });
      setEditingGroupId(null);
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, t.catErrUpdate) }),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/catalog-groups/${id}`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, t.catErrDelete) }),
  });

  const reorderGroupsMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => api.put("/catalog-groups/reorder", { orderedIds }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["catalog-groups"] }),
  });

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragGroupId || dragGroupId === targetId) return;
    const sorted = [...groups].sort((a, b) => a.position - b.position);
    const fromIdx = sorted.findIndex((g) => g.id === dragGroupId);
    const toIdx = sorted.findIndex((g) => g.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...sorted];
    const spliced = reordered.splice(fromIdx, 1);
    if (!spliced[0]) return;
    reordered.splice(toIdx, 0, spliced[0]);
    reorderGroupsMutation.mutate(reordered.map((g) => g.id));
  };

  return (
    <div className="space-y-5">
      <div
        className="rounded-[20px] border p-5 shadow-[0_18px_36px_rgba(0,0,0,0.12)]"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--bd)" }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)" }}
          >
            <FolderOpen className="h-4.5 w-4.5 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>{t.catTitle}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--tx-m)" }}>{t.catSubtitle}</p>
          </div>
        </div>

        {/* Create new group */}
        <div className="mb-4">
          <p className="mb-2 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.catNewLabel}</p>
          <div className="flex gap-2">
            <StudioInput
              placeholder={t.catNewPh}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" && newGroupName.trim()) createGroupMutation.mutate(newGroupName.trim());
              }}
            />
            <StudioButton
              disabled={createGroupMutation.isPending || !newGroupName.trim()}
              onClick={() => createGroupMutation.mutate(newGroupName.trim())}
            >
              <Plus className="h-4 w-4" />
            </StudioButton>
          </div>
        </div>

        {/* Group list */}
        <div className="space-y-2">
          {groupsQuery.isPending ? (
            <p className="py-6 text-center text-sm" style={{ color: "var(--tx-f)" }}>...</p>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm" style={{ color: "var(--tx-f)" }}>{t.catEmpty}</p>
          ) : (
            groups.map((g) => (
              <div
                key={g.id}
                draggable
                onDragStart={() => setDragGroupId(g.id)}
                onDragOver={(e) => handleDragOver(e, g.id)}
                onDragEnd={() => setDragGroupId(null)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-3 transition-colors"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
              >
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab" style={{ color: "var(--tx-f)" }} />
                {(() => {
                  const matchedIcon = g.iconCustomEmojiId
                    ? iconCatalog.find((i) => i.customEmojiId === g.iconCustomEmojiId)
                    : null;
                  return (
                    <button
                      type="button"
                      onClick={() => setIconPickerGroupId(g.id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border hover:opacity-80"
                      style={{ borderColor: "var(--bd)", background: "var(--surface)" }}
                      title="Chọn icon"
                    >
                      {matchedIcon ? (
                        <img src={matchedIcon.imageUrl} alt="" className="h-5 w-5 object-contain" />
                      ) : g.icon ? (
                        <span className="text-base leading-none">{g.icon}</span>
                      ) : (
                        <Plus className="h-3.5 w-3.5" style={{ color: "var(--tx-f)" }} />
                      )}
                    </button>
                  );
                })()}
                {editingGroupId === g.id ? (
                  <input
                    className="flex-1 rounded-lg bg-transparent px-1 text-sm font-bold outline-none ring-1 ring-indigo-400"
                    style={{ color: "var(--tx)" }}
                    value={editingGroupName}
                    onChange={(e) => setEditingGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editingGroupName.trim()) updateGroupMutation.mutate({ id: g.id, name: editingGroupName.trim() });
                      if (e.key === "Escape") setEditingGroupId(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 text-sm font-bold" style={{ color: "var(--tx)" }}>{g.name}</span>
                )}
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", color: "var(--tx-f)", border: "1px solid var(--bd)" }}>
                  {t.catProducts(g._count.overrides)}
                </span>
                {editingGroupId === g.id ? (
                  <button
                    type="button"
                    onClick={() => editingGroupName.trim() && updateGroupMutation.mutate({ id: g.id, name: editingGroupName.trim() })}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-400 transition hover:bg-emerald-400/10"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setEditingGroupId(g.id); setEditingGroupName(g.name); }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-orange-500/10"
                    style={{ color: "var(--tx-f)" }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { if (window.confirm(t.catDeleteConfirm(g.name))) deleteGroupMutation.mutate(g.id); }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-rose-400 transition hover:bg-rose-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {iconPickerGroupId && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setIconPickerGroupId(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl overflow-hidden"
            style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest mb-0.5" style={{ color: "rgb(99,102,241)" }}>Chọn icon</p>
                <p className="text-sm font-black" style={{ color: "var(--tx)" }}>
                  {groups.find((g) => g.id === iconPickerGroupId)?.name || "—"}
                </p>
              </div>
              <button type="button" onClick={() => setIconPickerGroupId(null)} className="flex h-8 w-8 items-center justify-center rounded-xl transition hover:opacity-70" style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-4">
              {iconCatalog.length === 0 && !showNewIconForm && (
                <p className="text-center text-sm py-6" style={{ color: "var(--tx-f)" }}>Chưa có icon nào trong thư viện. Bấm "Thêm icon" để tạo.</p>
              )}
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                {iconCatalog.map((icon) => (
                  <div key={icon.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setGroupIconMutation.mutate({ id: iconPickerGroupId, icon: icon.label, iconCustomEmojiId: icon.customEmojiId })}
                      className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border transition hover:border-indigo-400/50 hover:bg-indigo-500/10"
                      style={{ borderColor: "var(--bd)", background: "var(--inp)" }}
                    >
                      <img src={icon.imageUrl} alt="" className="h-8 w-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }} />
                      <span className="text-[10px] font-bold truncate w-full px-1 text-center" style={{ color: "var(--tx-m)" }}>{icon.label}</span>
                    </button>
                    {icon.shopId !== null && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (window.confirm(`Xóa icon "${icon.label}"?`)) deleteIconMutation.mutate(icon.id); }}
                        className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white text-xs hover:bg-rose-600"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setShowNewIconForm(true)}
                  className="flex h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition hover:border-indigo-400/50 hover:bg-indigo-500/10"
                  style={{ borderColor: "var(--bd)", color: "var(--tx-f)" }}
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-[10px] font-bold">Thêm icon</span>
                </button>
              </div>

              {showNewIconForm && (
                <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>Thêm icon mới</p>
                  <div>
                    <p className="mb-1 text-xs" style={{ color: "var(--tx-m)" }}>Tên (ví dụ: CapCut)</p>
                    <input
                      value={newIconLabel}
                      onChange={(e) => setNewIconLabel(e.target.value)}
                      placeholder="CapCut"
                      className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs" style={{ color: "var(--tx-m)" }}>Ảnh logo</p>
                    <div className="flex gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-80" style={{ borderColor: "var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }}>
                        <Upload className="h-3.5 w-3.5" />
                        {newIconUploading ? "..." : "Upload"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={newIconUploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setNewIconUploading(true);
                            try {
                              const fd = new FormData();
                              fd.append("file", file);
                              const res = await api.post<{ url: string }>("/products/upload-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
                              setNewIconImageUrl(res.data.url);
                            } catch {
                              // ignore
                            } finally {
                              setNewIconUploading(false);
                              e.target.value = "";
                            }
                          }}
                        />
                      </label>
                      <input
                        value={newIconImageUrl}
                        onChange={(e) => setNewIconImageUrl(e.target.value)}
                        placeholder="https://... hoặc upload"
                        className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                      />
                    </div>
                    {newIconImageUrl && (
                      <img src={newIconImageUrl} alt="" className="mt-2 h-10 w-10 rounded-lg object-contain" />
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs" style={{ color: "var(--tx-m)" }}>Telegram Custom Emoji ID</p>
                    <input
                      value={newIconCustomEmojiId}
                      onChange={(e) => setNewIconCustomEmojiId(e.target.value)}
                      placeholder="5234567890123456789"
                      className="w-full rounded-lg px-3 py-2 font-mono text-sm outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                    />
                    <p className="mt-1 text-[11px]" style={{ color: "var(--tx-f)" }}>Lấy ID từ pack emoji premium trên Telegram</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => createIconMutation.mutate({ label: newIconLabel.trim(), imageUrl: newIconImageUrl.trim(), customEmojiId: newIconCustomEmojiId.trim() })}
                      disabled={!newIconLabel.trim() || !newIconImageUrl.trim() || !newIconCustomEmojiId.trim() || createIconMutation.isPending}
                      className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-600 disabled:opacity-50"
                    >
                      Lưu
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowNewIconForm(false); setNewIconLabel(""); setNewIconImageUrl(""); setNewIconCustomEmojiId(""); }}
                      className="rounded-lg border px-4 py-2 text-sm font-bold"
                      style={{ borderColor: "var(--bd)", color: "var(--tx-m)" }}
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
