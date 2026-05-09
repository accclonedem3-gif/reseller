import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Package, RefreshCw, Search, Sparkles, Tags } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Field } from "@/components/dashboard/field";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useLang } from "@/lib/lang";
import { localizeProductName } from "@/lib/product-name";

const T = {
  vi: {
    eyebrow: "Catalog studio",
    title: "Sản phẩm",
    desc: "Seller có thể điều chỉnh mặt hiển thị của catalog mà không đụng vào logic bot: đổi tên, chỉnh giá, ẩn sản phẩm hoặc thêm thông điệp khuyến mại.",
    listKicker: "Merged catalog",
    listTitle: "Danh sách sản phẩm",
    syncing: "Đang sync...",
    syncBtn: "Sync catalog",
    searchPh: "Tìm theo tên hiển thị hoặc tên nguồn",
    emptyTitle: "Chưa có sản phẩm phù hợp",
    emptyDesc: "Hãy thử sync catalog hoặc đổi từ khóa tìm kiếm để hiển thị lại danh sách.",
    colProduct: "Sản phẩm",
    colSourcePrice: "Giá gốc",
    colSalePrice: "Giá bán",
    colStock: "Tồn",
    colSold: "Đã bán",
    colStatus: "Trạng thái",
    statusActive: "Đang bán",
    statusOff: "Tạm tắt",
    badgeHidden: "Ẩn trên bot",
    editorKicker: "Override editor",
    sourceData: (name: string, price: string) => `Dữ liệu nguồn: ${name} • Giá gốc ${price}`,
    statStock: "Tồn kho",
    statSold: "Đã bán",
    fieldName: "Tên hiển thị",
    fieldNameHint: "Bot name",
    fieldNamePh: "Tên hiện thị trên bot",
    fieldPrice: "Giá bán",
    fieldPriceHint: "VND",
    fieldPricePh: "Giá bán cho khách",
    fieldPromo: "Thông điệp khuyến mại",
    fieldPromoHint: "Optional",
    fieldPromoDesc: "Dùng để làm nổi bật ưu đãi, bảo hành hoặc điểm khác biệt của sản phẩm.",
    fieldPromoPh: "Ví dụ: Bảo hành 24h, đổi lỗi trong ngày, ưu đãi tháng này...",
    toggleSellLabel: "Cho phép bán",
    toggleSellOn: "Sản phẩm đang mở",
    toggleSellOff: "Sản phẩm tạm tắt",
    badgeOn: "Bật",
    badgeOff: "Tắt",
    toggleHideLabel: "Ẩn trên bot",
    toggleHideOn: "Khách sẽ không thấy sản phẩm",
    toggleHideOff: "Đang hiển thị bình thường",
    badgeHide: "Ẩn",
    badgeShow: "Hiện",
    margin: "Biên lợi nhuận tạm tính",
    saving: "Đang lưu...",
    save: "Lưu cấu hình sản phẩm",
    selectTitle: "Chọn một sản phẩm",
    selectDesc: "Khi seller chọn một dòng trong catalog, khu vực chỉnh sửa override sẽ hiển thị đầy đủ ở đây.",
  },
  en: {
    eyebrow: "Catalog studio",
    title: "Products",
    desc: "Sellers can adjust the display of the catalog without touching the bot logic: rename, adjust prices, hide products, or add promotional messages.",
    listKicker: "Merged catalog",
    listTitle: "Product list",
    syncing: "Syncing...",
    syncBtn: "Sync catalog",
    searchPh: "Search by display name or source name",
    emptyTitle: "No matching products",
    emptyDesc: "Try syncing the catalog or changing the search keyword to restore the list.",
    colProduct: "Product",
    colSourcePrice: "Source price",
    colSalePrice: "Sale price",
    colStock: "Stock",
    colSold: "Sold",
    colStatus: "Status",
    statusActive: "Active",
    statusOff: "Disabled",
    badgeHidden: "Hidden on bot",
    editorKicker: "Override editor",
    sourceData: (name: string, price: string) => `Source: ${name} • Base price ${price}`,
    statStock: "Stock",
    statSold: "Sold",
    fieldName: "Display name",
    fieldNameHint: "Bot name",
    fieldNamePh: "Name shown on bot",
    fieldPrice: "Sale price",
    fieldPriceHint: "VND",
    fieldPricePh: "Price for customers",
    fieldPromo: "Promotional message",
    fieldPromoHint: "Optional",
    fieldPromoDesc: "Use to highlight deals, warranty, or product differentiators.",
    fieldPromoPh: "e.g. 24h warranty, same-day replacement, this month's promo...",
    toggleSellLabel: "Allow selling",
    toggleSellOn: "Product is active",
    toggleSellOff: "Product is disabled",
    badgeOn: "On",
    badgeOff: "Off",
    toggleHideLabel: "Hide on bot",
    toggleHideOn: "Customers won't see this product",
    toggleHideOff: "Currently visible",
    badgeHide: "Hidden",
    badgeShow: "Visible",
    margin: "Estimated margin",
    saving: "Saving...",
    save: "Save product config",
    selectTitle: "Select a product",
    selectDesc: "When a seller selects a row in the catalog, the override editor will appear here.",
  },
  th: {
    eyebrow: "Catalog studio",
    title: "สินค้า",
    desc: "ผู้ขายสามารถปรับการแสดงผลแคตาล็อกโดยไม่ต้องแตะต้องตรรกะของบอท: เปลี่ยนชื่อ ปรับราคา ซ่อนสินค้า หรือเพิ่มข้อความโปรโมชัน",
    listKicker: "Merged catalog",
    listTitle: "รายการสินค้า",
    syncing: "กำลังซิงค์...",
    syncBtn: "ซิงค์แคตาล็อก",
    searchPh: "ค้นหาตามชื่อที่แสดงหรือชื่อแหล่ง",
    emptyTitle: "ไม่พบสินค้าที่ตรงกัน",
    emptyDesc: "ลองซิงค์แคตาล็อกหรือเปลี่ยนคำค้นหาเพื่อแสดงรายการอีกครั้ง",
    colProduct: "สินค้า",
    colSourcePrice: "ราคาต้นทาง",
    colSalePrice: "ราคาขาย",
    colStock: "สต็อก",
    colSold: "ขายแล้ว",
    colStatus: "สถานะ",
    statusActive: "กำลังขาย",
    statusOff: "ปิดชั่วคราว",
    badgeHidden: "ซ่อนบนบอท",
    editorKicker: "Override editor",
    sourceData: (name: string, price: string) => `แหล่ง: ${name} • ราคาต้นทาง ${price}`,
    statStock: "สต็อก",
    statSold: "ขายแล้ว",
    fieldName: "ชื่อที่แสดง",
    fieldNameHint: "Bot name",
    fieldNamePh: "ชื่อที่แสดงบนบอท",
    fieldPrice: "ราคาขาย",
    fieldPriceHint: "VND",
    fieldPricePh: "ราคาสำหรับลูกค้า",
    fieldPromo: "ข้อความโปรโมชัน",
    fieldPromoHint: "Optional",
    fieldPromoDesc: "ใช้เพื่อเน้นโปรโมชัน การรับประกัน หรือจุดเด่นของสินค้า",
    fieldPromoPh: "เช่น รับประกัน 24 ชั่วโมง เปลี่ยนได้ในวันเดียวกัน โปรโมชันเดือนนี้...",
    toggleSellLabel: "อนุญาตให้ขาย",
    toggleSellOn: "สินค้าเปิดอยู่",
    toggleSellOff: "สินค้าปิดอยู่",
    badgeOn: "เปิด",
    badgeOff: "ปิด",
    toggleHideLabel: "ซ่อนบนบอท",
    toggleHideOn: "ลูกค้าจะไม่เห็นสินค้านี้",
    toggleHideOff: "กำลังแสดงตามปกติ",
    badgeHide: "ซ่อน",
    badgeShow: "แสดง",
    margin: "กำไรขั้นต้นประมาณการ",
    saving: "กำลังบันทึก...",
    save: "บันทึกการตั้งค่าสินค้า",
    selectTitle: "เลือกสินค้า",
    selectDesc: "เมื่อผู้ขายเลือกแถวในแคตาล็อก พื้นที่แก้ไขจะแสดงที่นี่",
  },
};

export function ProductsPage() {
  const { lang } = useLang();
  const t = T[lang];

  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get("/products")).data,
  });
  const syncMutation = useMutation({
    mutationFn: async () => (await api.post("/seller/source-connection/sync-catalog")).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [form, setForm] = useState({
    displayName: "",
    salePrice: "",
    hidden: false,
    enabled: true,
    promoText: "",
  });

  const filteredProducts = useMemo(() => {
    const items = productsQuery.data || [];
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (!normalizedKeyword) {
      return items;
    }

    return items.filter((item: any) =>
      [item.displayName, item.sourceName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedKeyword)),
    );
  }, [keyword, productsQuery.data]);

  useEffect(() => {
    const firstId = filteredProducts?.[0]?.id;
    if (!selectedId && firstId) {
      setSelectedId(firstId);
    }
  }, [filteredProducts, selectedId]);

  const selectedProduct = (productsQuery.data || []).find((item: any) => item.id === selectedId);

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }

    setForm({
      displayName: selectedProduct.displayName || "",
      salePrice: String(selectedProduct.salePrice || ""),
      hidden: Boolean(selectedProduct.hidden),
      enabled: Boolean(selectedProduct.enabled),
      promoText: selectedProduct.promoText || "",
    });
  }, [selectedProduct?.id]);

  const updateMutation = useMutation({
    mutationFn: async () =>
      api.put(`/products/${selectedId}`, {
        displayName: form.displayName,
        salePrice: Number(form.salePrice || 0),
        hidden: form.hidden,
        enabled: form.enabled,
        promoText: form.promoText,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc}
      />

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="app-kicker">{t.listKicker}</p>
              <h2 className="mt-3 font-display text-3xl font-semibold text-white">
                {t.listTitle}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                {syncMutation.isPending ? t.syncing : t.syncBtn}
              </Button>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  className="pl-11"
                  placeholder={t.searchPh}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </div>
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                title={t.emptyTitle}
                description={t.emptyDesc}
              />
            </div>
          ) : (
            <div className="mt-6 app-table-wrap">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>{t.colProduct}</th>
                    <th>{t.colSourcePrice}</th>
                    <th>{t.colSalePrice}</th>
                    <th>{t.colStock}</th>
                    <th>{t.colSold}</th>
                    <th>{t.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product: any) => (
                    <tr
                      key={product.id}
                      className={selectedId === product.id ? "bg-white/[0.03]" : undefined}
                      onClick={() => setSelectedId(product.id)}
                    >
                      <td className="cursor-pointer">
                        <div className="flex items-center gap-3">
                          <div className="glass-chip flex h-11 w-11 items-center justify-center rounded-2xl">
                            <Package className="h-4 w-4 text-cyan-100" />
                          </div>
                          <div>
                            <p className="font-semibold text-white">{localizeProductName(product.displayName, lang)}</p>
                            <p className="mt-1 text-sm text-slate-500">{localizeProductName(product.sourceName, lang)}</p>
                          </div>
                        </div>
                      </td>
                      <td>{formatCurrency(product.sourcePrice)}</td>
                      <td className="font-semibold text-emerald-300">
                        {formatCurrency(product.salePrice)}
                      </td>
                      <td>{product.available ?? "-"}</td>
                      <td>{product.soldCount}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone={product.enabled ? "success" : "neutral"}>
                            {product.enabled ? t.statusActive : t.statusOff}
                          </Badge>
                          {product.hidden ? <Badge tone="warning">{t.badgeHidden}</Badge> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          {selectedProduct ? (
            <div className="space-y-6">
              <div>
                <p className="app-kicker">{t.editorKicker}</p>
                <h2 className="mt-3 font-display text-3xl font-semibold text-white">
                  {localizeProductName(selectedProduct.displayName, lang)}
                </h2>
                <p className="mt-2 text-sm leading-7 text-slate-400">
                  {t.sourceData(localizeProductName(selectedProduct.sourceName, lang), formatCurrency(selectedProduct.sourcePrice))}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="glass-chip rounded-[22px] p-4">
                  <p className="app-kicker">{t.statStock}</p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {selectedProduct.available ?? "-"}
                  </p>
                </div>
                <div className="glass-chip rounded-[22px] p-4">
                  <p className="app-kicker">{t.statSold}</p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {selectedProduct.soldCount}
                  </p>
                </div>
              </div>

              <Field label={t.fieldName} hint={t.fieldNameHint}>
                <Input
                  value={form.displayName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder={t.fieldNamePh}
                />
              </Field>

              <Field label={t.fieldPrice} hint={t.fieldPriceHint}>
                <Input
                  value={form.salePrice}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, salePrice: event.target.value }))
                  }
                  placeholder={t.fieldPricePh}
                />
              </Field>

              <Field
                label={t.fieldPromo}
                hint={t.fieldPromoHint}
                description={t.fieldPromoDesc}
              >
                <Textarea
                  value={form.promoText}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, promoText: event.target.value }))
                  }
                  placeholder={t.fieldPromoPh}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  className={`glass-chip flex items-center justify-between rounded-[24px] px-4 py-4 text-left transition ${
                    form.enabled ? "border-emerald-300/25 bg-emerald-500/10" : ""
                  }`}
                  onClick={() => setForm((current) => ({ ...current, enabled: !current.enabled }))}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-4.5 w-4.5 text-emerald-200" />
                    <div>
                      <p className="font-semibold text-white">{t.toggleSellLabel}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {form.enabled ? t.toggleSellOn : t.toggleSellOff}
                      </p>
                    </div>
                  </div>
                  <Badge tone={form.enabled ? "success" : "neutral"}>
                    {form.enabled ? t.badgeOn : t.badgeOff}
                  </Badge>
                </button>

                <button
                  className={`glass-chip flex items-center justify-between rounded-[24px] px-4 py-4 text-left transition ${
                    form.hidden ? "border-amber-300/25 bg-amber-500/10" : ""
                  }`}
                  onClick={() => setForm((current) => ({ ...current, hidden: !current.hidden }))}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    {form.hidden ? (
                      <EyeOff className="h-4.5 w-4.5 text-amber-200" />
                    ) : (
                      <Eye className="h-4.5 w-4.5 text-cyan-100" />
                    )}
                    <div>
                      <p className="font-semibold text-white">{t.toggleHideLabel}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {form.hidden ? t.toggleHideOn : t.toggleHideOff}
                      </p>
                    </div>
                  </div>
                  <Badge tone={form.hidden ? "warning" : "neutral"}>
                    {form.hidden ? t.badgeHide : t.badgeShow}
                  </Badge>
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="glass-chip rounded-[22px] p-4">
                  <div className="flex items-center gap-2 text-slate-200">
                    <Tags className="h-4 w-4 text-amber-100" />
                    <span className="text-sm">{t.margin}</span>
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {formatCurrency(Number(form.salePrice || 0) - Number(selectedProduct.sourcePrice || 0))}
                  </p>
                </div>
                <Button
                  className="h-full min-h-[98px] w-full"
                  disabled={updateMutation.isPending || !selectedId}
                  onClick={() => updateMutation.mutate()}
                >
                  {updateMutation.isPending ? t.saving : t.save}
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              title={t.selectTitle}
              description={t.selectDesc}
            />
          )}
        </Card>
      </section>
    </div>
  );
}
