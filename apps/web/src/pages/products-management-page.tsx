import { Boxes, Package, PackagePlus } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/auth/auth-provider";
import { hasSellerCapability } from "@/lib/seller-access";
import { useLang } from "@/lib/lang";
import { ProductsPageStudio } from "./products-page-studio";
import { SourceProductsPage } from "./source-products-page-pro";

const T = {
  vi: {
    tabProducts: "Sản phẩm",
    tabSource: "Sản phẩm nguồn",
    addProduct: "Thêm sản phẩm",
  },
  en: {
    tabProducts: "Products",
    tabSource: "Source products",
    addProduct: "Add product",
  },
  th: {
    tabProducts: "สินค้า",
    tabSource: "สินค้าต้นทาง",
    addProduct: "เพิ่มสินค้า",
  },
};

type Tab = "products" | "source";

export function ProductsManagementPage() {
  const { session } = useAuth();
  const { lang } = useLang();
  const t = T[lang];
  const isUltra = hasSellerCapability(session, "source_internal_manage");
  const [activeTab, setActiveTab] = useState<Tab>("products");
  const [createPending, setCreatePending] = useState(false);

  const handleAddProduct = () => {
    if (isUltra) setActiveTab("source");
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

      <div>
        {activeTab === "products" && (
          <ProductsPageStudio
            openCreate={createPending && !isUltra}
            onCreateOpened={() => setCreatePending(false)}
          />
        )}
        {activeTab === "source" && isUltra && (
          <SourceProductsPage
            openCreate={createPending}
            onCreateOpened={() => setCreatePending(false)}
          />
        )}
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
  accent?: "orange" | "violet";
}) {
  const activeCls =
    accent === "violet"
      ? "bg-violet-500/15 text-violet-300 border border-violet-400/25 shadow-[0_0_12px_rgba(139,92,246,0.15)]"
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
