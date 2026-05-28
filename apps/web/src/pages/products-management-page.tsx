import { Boxes, Check, Eye, EyeOff, FolderOpen, GripVertical, Package, PackagePlus, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
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
    catView: "Xem sản phẩm",
    catViewTitle: "Sản phẩm trong danh mục",
    catViewEmpty: "Danh mục này chưa có sản phẩm nào.",
    catRemoveSelected: "Loại khỏi danh mục",
    catSelectAll: "Chọn tất cả",
    catSelected: (n: number) => `${n} đã chọn`,
    catRemoveConfirm: (n: number) => `Loại ${n} sản phẩm khỏi danh mục? Sản phẩm không bị xoá.`,
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
    catView: "View products",
    catViewTitle: "Products in group",
    catViewEmpty: "This group has no products.",
    catRemoveSelected: "Remove from group",
    catSelectAll: "Select all",
    catSelected: (n: number) => `${n} selected`,
    catRemoveConfirm: (n: number) => `Remove ${n} products from this group? Products will not be deleted.`,
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
    catView: "ดูสินค้า",
    catViewTitle: "สินค้าในหมวดหมู่",
    catViewEmpty: "หมวดหมู่นี้ยังไม่มีสินค้า",
    catRemoveSelected: "นำออกจากหมวดหมู่",
    catSelectAll: "เลือกทั้งหมด",
    catSelected: (n: number) => `เลือกแล้ว ${n}`,
    catRemoveConfirm: (n: number) => `นำสินค้า ${n} รายการออกจากหมวดหมู่? สินค้าจะไม่ถูกลบ`,
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

type GroupProduct = {
  id: string;
  displayName: string;
  salePrice: number;
  available: number | null;
  groupId: string | null;
  imageUrl?: string | null;
  productIcon?: string | null;
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
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

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

  const productsQuery = useQuery<GroupProduct[]>({
    queryKey: ["products"],
    queryFn: async () => (await api.get("/products")).data,
    enabled: viewingGroupId !== null,
  });
  const productsInGroup = (productsQuery.data || []).filter((p) => p.groupId === viewingGroupId);

  const bulkRemoveMutation = useMutation({
    mutationFn: async (productIds: string[]) =>
      api.post("/catalog-groups/bulk-assign", { productIds, groupId: null }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
      setSelectedProductIds(new Set());
      showToast({ tone: "success", message: "Đã loại khỏi danh mục." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không thể loại sản phẩm.") }),
  });

  const viewingGroup = groups.find((g) => g.id === viewingGroupId);
  const toggleSelectProduct = (id: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedProductIds.size === productsInGroup.length) {
      setSelectedProductIds(new Set());
    } else {
      setSelectedProductIds(new Set(productsInGroup.map((p) => p.id)));
    }
  };
  const handleRemoveSelected = () => {
    if (selectedProductIds.size === 0) return;
    if (!window.confirm(t.catRemoveConfirm(selectedProductIds.size))) return;
    bulkRemoveMutation.mutate(Array.from(selectedProductIds));
  };
  const closeViewModal = () => {
    setViewingGroupId(null);
    setSelectedProductIds(new Set());
  };

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

  const totalProducts = groups.reduce((sum, g) => sum + g._count.overrides, 0);
  const populatedGroups = groups.filter((g) => g._count.overrides > 0).length;

  return (
    <div className="space-y-5">
      {/* Hero header with gradient */}
      <div
        className="relative overflow-hidden rounded-[20px] border p-6 sm:p-7"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--bd)",
          backgroundImage: "radial-gradient(circle at top right, rgba(99,102,241,0.12), transparent 50%)",
        }}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-lg"
              style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.18))", border: "1px solid rgba(99,102,241,0.35)" }}
            >
              <FolderOpen className="h-6 w-6 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "rgb(129,140,248)" }}>Catalog</p>
              <h2 className="mt-1 text-xl sm:text-2xl font-black tracking-tight" style={{ color: "var(--tx)" }}>{t.catTitle}</h2>
              <p className="mt-1.5 text-xs sm:text-sm leading-relaxed" style={{ color: "var(--tx-m)" }}>{t.catSubtitle}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 shrink-0">
            <StatChip label="Tổng" value={groups.length} accent="indigo" />
            <StatChip label="Có SP" value={populatedGroups} accent="emerald" />
            <StatChip label="Sản phẩm" value={totalProducts} accent="orange" />
          </div>
        </div>
      </div>

      {/* Create new group card */}
      <div
        className="rounded-[20px] border p-5 transition-all"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--bd)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Plus className="h-3.5 w-3.5 text-orange-400" />
          <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.catNewLabel}</p>
        </div>
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
      <div
        className="rounded-[20px] border p-3 sm:p-4"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--bd)" }}
      >
        {groupsQuery.isPending ? (
          <p className="py-12 text-center text-sm" style={{ color: "var(--tx-f)" }}>Đang tải...</p>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl mb-3" style={{ background: "rgba(99,102,241,0.08)", border: "1px dashed rgba(99,102,241,0.3)" }}>
              <FolderOpen className="h-7 w-7" style={{ color: "rgba(99,102,241,0.5)" }} />
            </div>
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--tx-m)" }}>{t.catEmpty}</p>
            <p className="text-xs" style={{ color: "var(--tx-f)" }}>Nhập tên ở trên rồi nhấn ➕ để tạo danh mục đầu tiên.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {groups.map((g) => {
              const matchedIcon = g.iconCustomEmojiId
                ? iconCatalog.find((i) => i.customEmojiId === g.iconCustomEmojiId)
                : null;
              const isEditing = editingGroupId === g.id;
              return (
                <div
                  key={g.id}
                  draggable
                  onDragStart={() => setDragGroupId(g.id)}
                  onDragOver={(e) => handleDragOver(e, g.id)}
                  onDragEnd={() => setDragGroupId(null)}
                  className="group flex items-center gap-2 sm:gap-3 rounded-2xl px-2.5 sm:px-3.5 py-2.5 sm:py-3 transition-all hover:shadow-md"
                  style={{
                    background: "var(--inp)",
                    border: "1px solid var(--bd)",
                    cursor: dragGroupId === g.id ? "grabbing" : "default",
                    opacity: dragGroupId === g.id ? 0.5 : 1,
                  }}
                >
                  <GripVertical
                    className="h-4 w-4 shrink-0 cursor-grab transition-colors group-hover:text-indigo-400"
                    style={{ color: "var(--tx-f)" }}
                  />
                  <button
                    type="button"
                    onClick={() => setIconPickerGroupId(g.id)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 transition-all hover:scale-105 hover:border-indigo-400/50"
                    style={{
                      borderColor: matchedIcon || g.icon ? "rgba(99,102,241,0.3)" : "var(--bd)",
                      background: matchedIcon || g.icon ? "rgba(99,102,241,0.08)" : "var(--surface)",
                    }}
                    title="Chọn icon"
                  >
                    {matchedIcon ? (
                      <img src={matchedIcon.imageUrl} alt="" className="h-6 w-6 object-contain" />
                    ) : g.icon ? (
                      <span className="text-lg leading-none">{g.icon}</span>
                    ) : (
                      <Plus className="h-4 w-4" style={{ color: "var(--tx-f)" }} />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        className="w-full rounded-lg bg-transparent px-2 py-1 text-sm font-bold outline-none ring-2 ring-indigo-400"
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
                      <p className="truncate text-sm sm:text-[15px] font-black" style={{ color: "var(--tx)" }}>{g.name}</p>
                    )}
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{
                          background: g._count.overrides > 0 ? "rgba(16,185,129,0.12)" : "rgba(148,163,184,0.1)",
                          color: g._count.overrides > 0 ? "rgb(52,211,153)" : "var(--tx-f)",
                          border: `1px solid ${g._count.overrides > 0 ? "rgba(16,185,129,0.25)" : "var(--bd)"}`,
                        }}
                      >
                        <Package className="h-2.5 w-2.5" />
                        {t.catProducts(g._count.overrides)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => editingGroupName.trim() && updateGroupMutation.mutate({ id: g.id, name: editingGroupName.trim() })}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-emerald-400 transition hover:bg-emerald-500/15"
                          title="Lưu"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingGroupId(null)}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-rose-400 transition hover:bg-rose-500/15"
                          title="Hủy"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => { setViewingGroupId(g.id); setSelectedProductIds(new Set()); }}
                          disabled={g._count.overrides === 0}
                          className="flex h-8 w-8 items-center justify-center rounded-xl transition hover:bg-indigo-500/15 hover:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ color: "var(--tx-f)" }}
                          title={t.catView}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingGroupId(g.id); setEditingGroupName(g.name); }}
                          className="flex h-8 w-8 items-center justify-center rounded-xl transition hover:bg-orange-500/15 hover:text-orange-400"
                          style={{ color: "var(--tx-f)" }}
                          title="Sửa tên"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { if (window.confirm(t.catDeleteConfirm(g.name))) deleteGroupMutation.mutate(g.id); }}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-rose-400 transition hover:bg-rose-500/15"
                          title="Xóa"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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

      {viewingGroupId && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 transition-all duration-200"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={closeViewModal}
        >
          <div
            className="relative flex w-full max-w-2xl flex-col rounded-[20px] overflow-hidden shadow-2xl"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--bd)",
              maxHeight: "85vh",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex shrink-0 items-center justify-between gap-3 px-5 sm:px-6 py-4"
              style={{
                borderBottom: "1px solid var(--bd)",
                backgroundImage: "linear-gradient(135deg, rgba(99,102,241,0.08), transparent)",
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}
                >
                  {(() => {
                    const matched = viewingGroup?.iconCustomEmojiId
                      ? iconCatalog.find((i) => i.customEmojiId === viewingGroup.iconCustomEmojiId)
                      : null;
                    if (matched) return <img src={matched.imageUrl} alt="" className="h-6 w-6 object-contain" />;
                    if (viewingGroup?.icon) return <span className="text-lg leading-none">{viewingGroup.icon}</span>;
                    return <FolderOpen className="h-5 w-5 text-indigo-300" />;
                  })()}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "rgb(129,140,248)" }}>{t.catViewTitle}</p>
                  <p className="truncate text-lg font-black mt-0.5" style={{ color: "var(--tx)" }}>{viewingGroup?.name || "—"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeViewModal}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition hover:bg-rose-500/15 hover:text-rose-400"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Toolbar */}
            {productsInGroup.length > 0 && (
              <div
                className="flex shrink-0 items-center justify-between gap-3 px-5 sm:px-6 py-3"
                style={{ borderBottom: "1px solid var(--bd)", background: "var(--inp)" }}
              >
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition hover:bg-indigo-500/10"
                  style={{ color: "var(--tx-m)" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedProductIds.size > 0 && selectedProductIds.size === productsInGroup.length}
                    ref={(el) => { if (el) el.indeterminate = selectedProductIds.size > 0 && selectedProductIds.size < productsInGroup.length; }}
                    onChange={() => { /* handled by button click */ }}
                    className="h-3.5 w-3.5 cursor-pointer accent-indigo-500"
                  />
                  {t.catSelectAll}
                </button>
                <div className="flex items-center gap-2">
                  {selectedProductIds.size > 0 && (
                    <span className="text-[11px] font-bold" style={{ color: "rgb(129,140,248)" }}>{t.catSelected(selectedProductIds.size)}</span>
                  )}
                  <button
                    type="button"
                    onClick={handleRemoveSelected}
                    disabled={selectedProductIds.size === 0 || bulkRemoveMutation.isPending}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: selectedProductIds.size > 0 ? "rgba(244,63,94,0.15)" : "transparent",
                      color: selectedProductIds.size > 0 ? "rgb(248,113,113)" : "var(--tx-f)",
                      border: `1px solid ${selectedProductIds.size > 0 ? "rgba(244,63,94,0.3)" : "var(--bd)"}`,
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t.catRemoveSelected}
                  </button>
                </div>
              </div>
            )}

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-4 py-3">
              {productsQuery.isPending ? (
                <p className="py-12 text-center text-sm" style={{ color: "var(--tx-f)" }}>Đang tải...</p>
              ) : productsInGroup.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Package className="h-10 w-10 mb-3" style={{ color: "var(--tx-f)" }} />
                  <p className="text-sm" style={{ color: "var(--tx-m)" }}>{t.catViewEmpty}</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {productsInGroup.map((p) => {
                    const isSelected = selectedProductIds.has(p.id);
                    const isOos = p.available !== null && p.available <= 0;
                    return (
                      <label
                        key={p.id}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition cursor-pointer"
                        style={{
                          background: isSelected ? "rgba(99,102,241,0.1)" : "var(--inp)",
                          border: `1px solid ${isSelected ? "rgba(99,102,241,0.35)" : "var(--bd)"}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectProduct(p.id)}
                          className="h-4 w-4 shrink-0 cursor-pointer accent-indigo-500"
                        />
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg overflow-hidden"
                          style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
                        >
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : p.productIcon ? (
                            <span className="text-lg leading-none">{p.productIcon}</span>
                          ) : (
                            <Package className="h-4 w-4" style={{ color: "var(--tx-f)" }} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold" style={{ color: "var(--tx)" }}>{p.displayName}</p>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--tx-f)" }}>
                            <span className="tabular-nums font-semibold" style={{ color: "rgb(52,211,153)" }}>
                              {p.salePrice.toLocaleString("vi-VN")}đ
                            </span>
                            <span>·</span>
                            <span className={isOos ? "text-rose-400" : ""}>
                              {p.available === null ? "∞" : p.available} còn
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
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

function StatChip({ label, value, accent }: { label: string; value: number; accent: "indigo" | "emerald" | "orange" }) {
  const colors = {
    indigo: { bg: "rgba(99,102,241,0.1)", bd: "rgba(99,102,241,0.25)", text: "rgb(129,140,248)" },
    emerald: { bg: "rgba(16,185,129,0.1)", bd: "rgba(16,185,129,0.25)", text: "rgb(52,211,153)" },
    orange: { bg: "rgba(249,115,22,0.1)", bd: "rgba(249,115,22,0.25)", text: "rgb(251,146,60)" },
  };
  const c = colors[accent];
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl px-2 sm:px-3 py-2 sm:py-2.5 min-w-[64px] sm:min-w-[80px]"
      style={{ background: c.bg, border: `1px solid ${c.bd}` }}
    >
      <span className="text-base sm:text-xl font-black tabular-nums" style={{ color: c.text }}>{value}</span>
      <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: "var(--tx-f)" }}>{label}</span>
    </div>
  );
}
