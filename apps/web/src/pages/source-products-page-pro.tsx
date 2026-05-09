import type { AxiosError } from "axios";
import {
  Boxes,
  ChevronDown,
  Crown,
  Eye,
  EyeOff,
  PackagePlus,
  Save,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { Field } from "@/components/dashboard/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { hasSellerCapability } from "@/lib/seller-access";
import { useLang } from "@/lib/lang";
import { localizeProductName } from "@/lib/product-name";
import {
  sourceAccountTypeOptions,
  sourceDeliveryModeOptions,
  sourceDurationTypeOptions,
  sourceProductFamilyOptions,
  sourceWarrantyPolicyOptions,
} from "@/lib/source-product-options";

const T = {
  vi: {
    gateTitle: "Tính năng dành riêng cho ULTRA",
    gateDesc: "Trang này quản lý catalog nguồn hàng nội bộ. Liên hệ Admin để được nâng cấp lên ULTRA.",
    eyebrow: "ULTRA Internal Source",
    title: "Quản lý sản phẩm nguồn",
    desc: "Publish catalog cho PRO downstream — kiểm soát giá sỉ/lẻ toàn diện",
    statCatalog: "Catalog",
    statPublished: "Đang publish",
    statManual: "Thủ công",
    listEyebrow: "Catalog",
    listTitle: "Sản phẩm nguồn",
    emptyTitle: "Chưa có sản phẩm nào",
    emptyDesc: "Tạo sản phẩm thủ công bên dưới",
    retail: "Lẻ",
    wholesale: "Sỉ",
    stock: (n: number | null) => n === null ? "∞ kho" : `còn ${n}`,
    editing: "Đang chỉnh sửa",
    noSelection: "Chọn sản phẩm để chỉnh sửa",
    noSelectionDesc: "Chọn một sản phẩm từ danh sách bên trái",
    createKicker: "Sản phẩm nguồn",
    createTitle: "Tạo sản phẩm mới",
    toastUpdated: "Đã cập nhật cài đặt sản phẩm.",
    toastCreated: "Đã tạo sản phẩm mới.",
    errDefault: "Có lỗi xảy ra. Hãy kiểm tra lại dữ liệu rồi thử lại.",
    saveLabel: "Lưu cài đặt",
    createLabel: "Tạo sản phẩm",
    // ProductForm
    publishToggle: "Publish cho PRO downstream",
    publishOn: "Hiện đang publish — CTV có thể đặt hàng",
    publishOff: "Đang ẩn — CTV không thấy sản phẩm này",
    secPrice: "Giá",
    fieldRetailPrice: "Giá lẻ (bot khách)",
    fieldSourcePrice: "Giá nhập nguồn (cost)",
    wholesaleToggle: "Giá sỉ riêng cho CTV (API)",
    wholesaleOn: "CTV đặt hàng qua API thấy giá sỉ này",
    wholesaleOff: "Tắt — CTV thấy giá bằng giá nhập nguồn",
    fieldWholesalePrice: "Giá sỉ (hiển thị cho CTV qua API)",
    secInfo: "Thông tin",
    fieldIcon: "Icon",
    fieldDisplayName: "Tên hiển thị",
    phDisplayName: "Tên hiển thị trong bot & dashboard",
    fieldSourceName: "Tên nguồn gốc",
    fieldDesc: "Mô tả",
    phDesc: "Mô tả ngắn (không bắt buộc)",
    secCategory: "Phân loại",
    fieldFamily: "Dòng sản phẩm",
    phFamily: "Chọn dòng SP",
    fieldAccountType: "Loại tài khoản",
    phAccountType: "Chọn loại TK",
    fieldDuration: "Thời hạn",
    phDuration: "Chọn thời hạn",
    fieldFamilyOther: "Tên dòng sản phẩm khác",
    phFamilyOther: "Netflix, Spotify...",
    fieldAccountTypeOther: "Loại tài khoản khác",
    phAccountTypeOther: "Business, Education...",
    fieldDurationOther: "Thời hạn khác",
    phDurationOther: "2 tháng, 90 ngày...",
    secDelivery: "Giao hàng & Bảo hành",
    fieldDeliveryMode: "Hình thức giao hàng",
    phDeliveryMode: "Chọn hình thức",
    fieldWarranty: "Chính sách bảo hành",
    phWarranty: "Chọn bảo hành",
    fieldAvailable: "Số lượng còn lại",
    fieldAvailableDesc: "Để trống nếu sản phẩm có nội dung giao tự động — hệ thống sẽ tự tính theo số dòng trong kho (mỗi dòng = 1 sản phẩm).",
    fieldAvailableDescManual: "Bot ẩn sản phẩm khi về 0. Để trống = không giới hạn.",
    phAvailable: "Để trống = Không giới hạn",
    secInventory: "Kho hàng",
    fieldDeliveryText: "Nội dung kho (mỗi dòng = 1 tài khoản)",
    hintDeliveryText: "Dùng khi giao tự động từ kho nội bộ.",
    phDeliveryText: "email1@gmail.com:password1\nemail2@gmail.com:password2",
    importFile: "📂 Tải file .txt",
    lineCount: (n: number) => `${n} dòng`,
    // delivery mode hints
    hintAutoApi: "Tự gọi API nhà cung cấp khi có đơn, không cần nhập kho.",
    hintAutoStock: "Lấy từ danh sách tài khoản bạn nhập sẵn bên dưới.",
    hintManual: "Bạn tự giao tài khoản cho khách sau khi có đơn.",
    iconTitle: "Chọn icon",
    saving: "Đang lưu...",
  },
  en: {
    gateTitle: "ULTRA-only feature",
    gateDesc: "This page manages the internal source catalog. Contact Admin to upgrade to ULTRA.",
    eyebrow: "ULTRA Internal Source",
    title: "Source product management",
    desc: "Publish catalog for PRO downstream — full wholesale/retail price control",
    statCatalog: "Catalog",
    statPublished: "Published",
    statManual: "Manual",
    listEyebrow: "Catalog",
    listTitle: "Source products",
    emptyTitle: "No products yet",
    emptyDesc: "Create a product manually below",
    retail: "Retail",
    wholesale: "Wholesale",
    stock: (n: number | null) => n === null ? "∞ stock" : `${n} left`,
    editing: "Editing",
    noSelection: "Select a product to edit",
    noSelectionDesc: "Choose a product from the list on the left",
    createKicker: "Source product",
    createTitle: "Create new product",
    toastUpdated: "Product settings updated.",
    toastCreated: "New product created.",
    errDefault: "An error occurred. Please check the data and try again.",
    saveLabel: "Save settings",
    createLabel: "Create product",
    publishToggle: "Publish to PRO downstream",
    publishOn: "Currently published — agents can place orders",
    publishOff: "Hidden — agents cannot see this product",
    secPrice: "Pricing",
    fieldRetailPrice: "Retail price (customer bot)",
    fieldSourcePrice: "Source cost",
    wholesaleToggle: "Custom wholesale price for agents (API)",
    wholesaleOn: "Agents ordering via API see this wholesale price",
    wholesaleOff: "Off — agents see the source cost price",
    fieldWholesalePrice: "Wholesale price (shown to agents via API)",
    secInfo: "Information",
    fieldIcon: "Icon",
    fieldDisplayName: "Display name",
    phDisplayName: "Name shown in bot & dashboard",
    fieldSourceName: "Source name",
    fieldDesc: "Description",
    phDesc: "Short description (optional)",
    secCategory: "Category",
    fieldFamily: "Product family",
    phFamily: "Select family",
    fieldAccountType: "Account type",
    phAccountType: "Select type",
    fieldDuration: "Duration",
    phDuration: "Select duration",
    fieldFamilyOther: "Other product family name",
    phFamilyOther: "Netflix, Spotify...",
    fieldAccountTypeOther: "Other account type",
    phAccountTypeOther: "Business, Education...",
    fieldDurationOther: "Other duration",
    phDurationOther: "2 months, 90 days...",
    secDelivery: "Delivery & Warranty",
    fieldDeliveryMode: "Delivery mode",
    phDeliveryMode: "Select mode",
    fieldWarranty: "Warranty policy",
    phWarranty: "Select warranty",
    fieldAvailable: "Available quantity",
    fieldAvailableDesc: "Leave blank if auto-delivery — system counts stock lines automatically.",
    fieldAvailableDescManual: "Bot hides the product at 0. Leave blank = unlimited.",
    phAvailable: "Blank = unlimited",
    secInventory: "Inventory",
    fieldDeliveryText: "Inventory content (one line = one account)",
    hintDeliveryText: "Used for automatic delivery from internal stock.",
    phDeliveryText: "email1@gmail.com:password1\nemail2@gmail.com:password2",
    importFile: "📂 Import .txt",
    lineCount: (n: number) => `${n} lines`,
    hintAutoApi: "Automatically calls provider API on each order — no stock entry needed.",
    hintAutoStock: "Pulls from the account list you entered below.",
    hintManual: "You manually deliver the account to the customer after each order.",
    iconTitle: "Pick icon",
    saving: "Saving...",
  },
  th: {
    gateTitle: "ฟีเจอร์สำหรับ ULTRA เท่านั้น",
    gateDesc: "หน้านี้จัดการแคตตาล็อกแหล่งสินค้าภายใน ติดต่อแอดมินเพื่ออัปเกรดเป็น ULTRA",
    eyebrow: "ULTRA Internal Source",
    title: "จัดการสินค้าต้นทาง",
    desc: "เผยแพร่แคตตาล็อกสำหรับ PRO downstream — ควบคุมราคาขายส่ง/ขายปลีกเต็มรูปแบบ",
    statCatalog: "แคตตาล็อก",
    statPublished: "เผยแพร่แล้ว",
    statManual: "ด้วยตนเอง",
    listEyebrow: "แคตตาล็อก",
    listTitle: "สินค้าต้นทาง",
    emptyTitle: "ยังไม่มีสินค้า",
    emptyDesc: "สร้างสินค้าด้วยตนเองด้านล่าง",
    retail: "ปลีก",
    wholesale: "ส่ง",
    stock: (n: number | null) => n === null ? "∞ สต็อก" : `เหลือ ${n}`,
    editing: "กำลังแก้ไข",
    noSelection: "เลือกสินค้าเพื่อแก้ไข",
    noSelectionDesc: "เลือกสินค้าจากรายการทางซ้าย",
    createKicker: "สินค้าต้นทาง",
    createTitle: "สร้างสินค้าใหม่",
    toastUpdated: "อัปเดตการตั้งค่าสินค้าแล้ว",
    toastCreated: "สร้างสินค้าใหม่แล้ว",
    errDefault: "เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูลและลองใหม่",
    saveLabel: "บันทึกการตั้งค่า",
    createLabel: "สร้างสินค้า",
    publishToggle: "เผยแพร่ให้ PRO downstream",
    publishOn: "กำลังเผยแพร่อยู่ — ตัวแทนสามารถสั่งซื้อได้",
    publishOff: "ซ่อนอยู่ — ตัวแทนมองไม่เห็นสินค้านี้",
    secPrice: "ราคา",
    fieldRetailPrice: "ราคาปลีก (บอทลูกค้า)",
    fieldSourcePrice: "ต้นทุนแหล่งสินค้า",
    wholesaleToggle: "ราคาขายส่งพิเศษสำหรับตัวแทน (API)",
    wholesaleOn: "ตัวแทนที่สั่งผ่าน API จะเห็นราคานี้",
    wholesaleOff: "ปิด — ตัวแทนเห็นราคาเท่ากับต้นทุน",
    fieldWholesalePrice: "ราคาขายส่ง (แสดงให้ตัวแทนผ่าน API)",
    secInfo: "ข้อมูล",
    fieldIcon: "ไอคอน",
    fieldDisplayName: "ชื่อที่แสดง",
    phDisplayName: "ชื่อที่แสดงในบอทและแดชบอร์ด",
    fieldSourceName: "ชื่อต้นทาง",
    fieldDesc: "คำอธิบาย",
    phDesc: "คำอธิบายสั้น (ไม่บังคับ)",
    secCategory: "หมวดหมู่",
    fieldFamily: "กลุ่มสินค้า",
    phFamily: "เลือกกลุ่ม",
    fieldAccountType: "ประเภทบัญชี",
    phAccountType: "เลือกประเภท",
    fieldDuration: "ระยะเวลา",
    phDuration: "เลือกระยะเวลา",
    fieldFamilyOther: "ชื่อกลุ่มสินค้าอื่น",
    phFamilyOther: "Netflix, Spotify...",
    fieldAccountTypeOther: "ประเภทบัญชีอื่น",
    phAccountTypeOther: "Business, Education...",
    fieldDurationOther: "ระยะเวลาอื่น",
    phDurationOther: "2 เดือน, 90 วัน...",
    secDelivery: "การจัดส่งและการรับประกัน",
    fieldDeliveryMode: "โหมดการจัดส่ง",
    phDeliveryMode: "เลือกโหมด",
    fieldWarranty: "นโยบายการรับประกัน",
    phWarranty: "เลือกการรับประกัน",
    fieldAvailable: "จำนวนที่มีอยู่",
    fieldAvailableDesc: "เว้นว่างถ้าจัดส่งอัตโนมัติ — ระบบนับแถวในคลังสินค้าเองโดยอัตโนมัติ",
    fieldAvailableDescManual: "บอทซ่อนสินค้าเมื่อถึง 0 เว้นว่าง = ไม่จำกัด",
    phAvailable: "เว้นว่าง = ไม่จำกัด",
    secInventory: "คลังสินค้า",
    fieldDeliveryText: "เนื้อหาคลังสินค้า (แต่ละบรรทัด = 1 บัญชี)",
    hintDeliveryText: "ใช้สำหรับการจัดส่งอัตโนมัติจากคลังภายใน",
    phDeliveryText: "email1@gmail.com:password1\nemail2@gmail.com:password2",
    importFile: "📂 นำเข้าไฟล์ .txt",
    lineCount: (n: number) => `${n} บรรทัด`,
    hintAutoApi: "เรียก API ผู้ให้บริการโดยอัตโนมัติเมื่อมีออเดอร์ ไม่ต้องนำเข้าคลัง",
    hintAutoStock: "ดึงจากรายการบัญชีที่คุณป้อนไว้ด้านล่าง",
    hintManual: "คุณส่งบัญชีให้ลูกค้าด้วยตนเองหลังจากมีออเดอร์",
    iconTitle: "เลือกไอคอน",
    saving: "กำลังบันทึก...",
  },
};

type SourceProduct = {
  id: string;
  productIcon?: string | null;
  sourceProductId: string;
  providerName: string;
  sourceName: string;
  displayName: string;
  description: string | null;
  sourcePrice: number;
  salePrice: number;
  available: number | null;
  soldCount: number;
  totalCount: number;
  enabled: boolean;
  hidden: boolean;
  promoText: string | null;
  isManual: boolean;
  deliveryText: string | null;
  syncedAt: string | null;
  internalSourceEnabled?: boolean;
  internalSourcePrice?: number | null;
  productFamily?: string | null;
  productFamilyOther?: string | null;
  accountType?: string | null;
  accountTypeOther?: string | null;
  durationType?: string | null;
  durationTypeOther?: string | null;
  sourceDeliveryMode?: string | null;
  warrantyPolicy?: string | null;
};

type SourceProductForm = {
  productIcon: string;
  displayName: string;
  sourceName: string;
  sourceDescription: string;
  sourcePrice: string;
  salePrice: string;
  wholesalePriceEnabled: boolean;
  internalSourcePrice: string;
  available: string;
  deliveryText: string;
  internalSourceEnabled: boolean;
  productFamily: string;
  productFamilyOther: string;
  accountType: string;
  accountTypeOther: string;
  durationType: string;
  durationTypeOther: string;
  sourceDeliveryMode: string;
  warrantyPolicy: string;
};

const emptyForm: SourceProductForm = {
  productIcon: "",
  displayName: "",
  sourceName: "",
  sourceDescription: "",
  sourcePrice: "0",
  salePrice: "0",
  wholesalePriceEnabled: false,
  internalSourcePrice: "",
  available: "",
  deliveryText: "",
  internalSourceEnabled: true,
  productFamily: "",
  productFamilyOther: "",
  accountType: "",
  accountTypeOther: "",
  durationType: "",
  durationTypeOther: "",
  sourceDeliveryMode: "MANUAL",
  warrantyPolicy: "KBH",
};

function getApiErrorMessage(error: unknown, fallback: string) {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const apiMessage = axiosError.response?.data?.message;
  if (Array.isArray(apiMessage)) return apiMessage.join(", ");
  if (typeof apiMessage === "string" && apiMessage.trim() !== "") return apiMessage;
  return fallback;
}

function normalizeEnumValue(value: string) {
  const normalized = value.trim();
  return normalized ? normalized.toUpperCase() : undefined;
}

function buildSourcePayload(form: SourceProductForm) {
  return {
    productIcon: form.productIcon.trim() || undefined,
    displayName: form.displayName.trim() || undefined,
    sourceName: form.sourceName.trim() || undefined,
    sourceDescription: form.sourceDescription.trim() || undefined,
    sourcePrice: Number(form.sourcePrice || 0),
    salePrice: Number(form.salePrice || form.sourcePrice || 0),
    available: form.available.trim() ? Number(form.available) : undefined,
    deliveryText: form.deliveryText.trim() || undefined,
    internalSourceEnabled: form.internalSourceEnabled,
    internalSourcePrice: form.wholesalePriceEnabled
      ? form.internalSourcePrice.trim() ? Number(form.internalSourcePrice) : undefined
      : null,
    productFamily: normalizeEnumValue(form.productFamily),
    productFamilyOther:
      form.productFamily === "OTHER" ? form.productFamilyOther.trim() || undefined : undefined,
    accountType: normalizeEnumValue(form.accountType),
    accountTypeOther:
      form.accountType === "OTHER" ? form.accountTypeOther.trim() || undefined : undefined,
    durationType: normalizeEnumValue(form.durationType),
    durationTypeOther:
      form.durationType === "OTHER" ? form.durationTypeOther.trim() || undefined : undefined,
    sourceDeliveryMode: normalizeEnumValue(form.sourceDeliveryMode),
    warrantyPolicy: normalizeEnumValue(form.warrantyPolicy),
  };
}

function buildFormFromProduct(product: SourceProduct): SourceProductForm {
  const hasWholesalePrice =
    product.internalSourcePrice != null && product.internalSourcePrice !== undefined;
  return {
    productIcon: product.productIcon || "",
    displayName: product.displayName || "",
    sourceName: product.sourceName || "",
    sourceDescription: product.description || "",
    sourcePrice: String(product.sourcePrice || 0),
    salePrice: String(product.salePrice || 0),
    wholesalePriceEnabled: hasWholesalePrice,
    internalSourcePrice: hasWholesalePrice ? String(product.internalSourcePrice) : "",
    available: product.available === null || product.available === undefined ? "" : String(product.available),
    deliveryText: product.deliveryText || "",
    internalSourceEnabled: Boolean(product.internalSourceEnabled),
    productFamily: product.productFamily?.toUpperCase() || "",
    productFamilyOther: product.productFamilyOther || "",
    accountType: product.accountType?.toUpperCase() || "",
    accountTypeOther: product.accountTypeOther || "",
    durationType: product.durationType?.toUpperCase() || "",
    durationTypeOther: product.durationTypeOther || "",
    sourceDeliveryMode: product.sourceDeliveryMode?.toUpperCase() || "MANUAL",
    warrantyPolicy: product.warrantyPolicy?.toUpperCase() || "KBH",
  };
}

const PRODUCT_EMOJIS = [
  "🤖","🧠","✨","💎","🔥","⚡","🌟","💫","🎯","🚀",
  "🎨","🖼️","🎬","🎵","🎭","🎪","🌈","🏆","⭐","💡",
  "🔑","🛡️","🔮","🎁","📦","💻","📱","🌐","📊","💰",
  "🤩","😎","🦋","🌺","🍀","🦄","🐉","👑","🏅","🎖️",
] as const;

function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const { lang } = useLang();
  const t = T[lang];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-violet-400/20 bg-violet-500/10 text-lg transition hover:border-violet-400/40 hover:bg-violet-500/20"
        title={t.iconTitle}
      >
        😊
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 grid w-64 grid-cols-8 gap-1 rounded-[16px] border border-violet-400/20 bg-[#0d1525] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
          {PRODUCT_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => { onPick(emoji); setOpen(false); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition hover:bg-violet-500/20"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  sublabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sublabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        "flex w-full items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition",
        checked
          ? "border-emerald-400/25 bg-emerald-500/8"
          : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]",
      ].join(" ")}
    >
      <div
        className={[
          "relative h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-emerald-500" : "bg-white/15",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-md transition-transform duration-200",
            checked ? "translate-x-4" : "translate-x-0.5",
          ].join(" ")}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--tx)" }}>{label}</p>
        {sublabel && <p className="mt-0.5 text-xs" style={{ color: "var(--tx-f)" }}>{sublabel}</p>}
      </div>
    </button>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--tx-m)" }}>
        {label}
      </p>
      <div className="h-px flex-1" style={{ background: "var(--bd)" }} />
    </div>
  );
}

function SelectBox({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex w-full items-center justify-between rounded-[14px] border px-4 py-3 text-sm font-medium outline-none transition",
          open ? "border-violet-400/45 shadow-[0_0_0_3px_rgba(167,139,250,0.10)]" : "hover:border-violet-400/25",
        ].join(" ")}
        style={{ backgroundColor: "var(--inp)", borderColor: open ? undefined : "var(--bd)", color: selectedLabel ? "var(--tx)" : "var(--tx-f)" }}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronDown className={`ml-2 h-4 w-4 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} style={{ color: "var(--tx-f)" }} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-[14px] border border-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.22)]"
          style={{ backgroundColor: "var(--surface)" }}
        >
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className="flex w-full items-center px-4 py-2.5 text-sm transition hover:bg-violet-500/8"
            style={{ color: "var(--tx-f)" }}
          >
            {placeholder}
          </button>
          <div className="mx-3 h-px" style={{ backgroundColor: "var(--bd)" }} />
          <div className="py-1 max-h-52 overflow-y-auto">
            {options.map((opt) => {
              const isActive = value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={[
                    "flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition",
                    isActive ? "bg-violet-500/10 text-violet-300" : "hover:bg-violet-500/6",
                  ].join(" ")}
                  style={!isActive ? { color: "var(--tx)" } : undefined}
                >
                  <span className={`h-4 w-4 flex-shrink-0 rounded-full border text-[10px] flex items-center justify-center ${isActive ? "border-violet-400 bg-violet-400 text-white" : "border-white/15"}`}>
                    {isActive && "✓"}
                  </span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryModeHint({ mode }: { mode: string }) {
  const { lang } = useLang();
  const t = T[lang];
  if (mode === "AUTO_API")
    return (
      <div className="flex items-start gap-2 rounded-[12px] border border-blue-400/20 bg-blue-500/8 px-3 py-2.5">
        <span className="mt-px text-sm">🔗</span>
        <p className="text-xs leading-5 text-blue-300">{t.hintAutoApi}</p>
      </div>
    );
  if (mode === "AUTO_STOCK")
    return (
      <div className="flex items-start gap-2 rounded-[12px] border border-emerald-400/20 bg-emerald-500/8 px-3 py-2.5">
        <span className="mt-px text-sm">📦</span>
        <p className="text-xs leading-5 text-emerald-300">{t.hintAutoStock}</p>
      </div>
    );
  if (mode === "MANUAL")
    return (
      <div className="flex items-start gap-2 rounded-[12px] border border-amber-400/20 bg-amber-500/8 px-3 py-2.5">
        <span className="mt-px text-sm">✋</span>
        <p className="text-xs leading-5 text-amber-300">{t.hintManual}</p>
      </div>
    );
  return null;
}

function TierGate() {
  const { lang } = useLang();
  const t = T[lang];
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,#a78bfa,#7c3aed)] shadow-[0_0_48px_rgba(124,58,237,0.35)]">
          <Crown className="h-9 w-9 text-white" />
        </div>
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-300">
          <Sparkles className="h-3 w-3" /> ULTRA Only
        </div>
        <h2 className="mt-4 text-2xl font-bold text-white">{t.gateTitle}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">{t.gateDesc}</p>
      </div>
    </div>
  );
}

function StatChip({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number | string; accent?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-white/8 px-4 py-3" style={{ backgroundColor: "var(--surface)" }}>
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] ${accent || "bg-violet-500/15"}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium" style={{ color: "var(--tx-f)" }}>{label}</p>
        <p className="text-xl font-bold" style={{ color: "var(--tx)" }}>{value}</p>
      </div>
    </div>
  );
}

function ProductForm({
  form,
  setForm,
  isPending,
  onSubmit,
  submitLabel,
  mode,
}: {
  form: SourceProductForm;
  setForm: React.Dispatch<React.SetStateAction<SourceProductForm>>;
  isPending: boolean;
  onSubmit: () => void;
  submitLabel: string;
  mode: "edit" | "create";
}) {
  const { lang } = useLang();
  const t = T[lang];
  const set = <K extends keyof SourceProductForm>(key: K, value: SourceProductForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-4">
      <Toggle
        checked={form.internalSourceEnabled}
        onChange={(v) => set("internalSourceEnabled", v)}
        label={t.publishToggle}
        sublabel={form.internalSourceEnabled ? t.publishOn : t.publishOff}
      />

      <SectionDivider label={t.secPrice} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.fieldRetailPrice}>
          <Input type="number" value={form.salePrice} onChange={(e) => set("salePrice", e.target.value)} placeholder="119000" />
        </Field>
        <Field label={t.fieldSourcePrice}>
          <Input type="number" value={form.sourcePrice} onChange={(e) => set("sourcePrice", e.target.value)} placeholder="85000" />
        </Field>
      </div>

      <Toggle
        checked={form.wholesalePriceEnabled}
        onChange={(v) => {
          set("wholesalePriceEnabled", v);
          if (v && !form.internalSourcePrice) set("internalSourcePrice", form.sourcePrice);
        }}
        label={t.wholesaleToggle}
        sublabel={form.wholesalePriceEnabled ? t.wholesaleOn : t.wholesaleOff}
      />

      {form.wholesalePriceEnabled && (
        <Field label={t.fieldWholesalePrice}>
          <Input type="number" value={form.internalSourcePrice} onChange={(e) => set("internalSourcePrice", e.target.value)} placeholder="95000" />
        </Field>
      )}

      <SectionDivider label={t.secInfo} />

      <div className="grid gap-3 sm:grid-cols-[64px_1fr]">
        <Field label={t.fieldIcon}>
          <div className="flex gap-2">
            <input
              value={form.productIcon}
              onChange={(e) => set("productIcon", e.target.value)}
              placeholder="🤖"
              maxLength={8}
              className="w-full rounded-[14px] border px-3 py-3 text-center text-2xl outline-none transition focus:border-violet-400/50 focus:shadow-[0_0_0_3px_rgba(167,139,250,0.12)]"
              style={{ backgroundColor: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" }}
            />
            <EmojiPicker onPick={(emoji) => set("productIcon", emoji)} />
          </div>
        </Field>
        <Field label={t.fieldDisplayName}>
          <Input value={form.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder={t.phDisplayName} />
        </Field>
      </div>

      {mode === "edit" && (
        <Field label={t.fieldSourceName}>
          <Input value={form.sourceName} onChange={(e) => set("sourceName", e.target.value)} />
        </Field>
      )}

      <Field label={t.fieldDesc}>
        <Textarea value={form.sourceDescription} onChange={(e) => set("sourceDescription", e.target.value)} placeholder={t.phDesc} />
      </Field>

      <SectionDivider label={t.secCategory} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t.fieldFamily}>
          <SelectBox
            value={form.productFamily}
            onChange={(v) => setForm((f) => ({ ...f, productFamily: v, productFamilyOther: v === "OTHER" ? f.productFamilyOther : "" }))}
            options={sourceProductFamilyOptions}
            placeholder={t.phFamily}
          />
        </Field>
        <Field label={t.fieldAccountType}>
          <SelectBox
            value={form.accountType}
            onChange={(v) => setForm((f) => ({ ...f, accountType: v, accountTypeOther: v === "OTHER" ? f.accountTypeOther : "" }))}
            options={sourceAccountTypeOptions}
            placeholder={t.phAccountType}
          />
        </Field>
        <Field label={t.fieldDuration}>
          <SelectBox
            value={form.durationType}
            onChange={(v) => setForm((f) => ({ ...f, durationType: v, durationTypeOther: v === "OTHER" ? f.durationTypeOther : "" }))}
            options={sourceDurationTypeOptions}
            placeholder={t.phDuration}
          />
        </Field>
      </div>

      {form.productFamily === "OTHER" && (
        <Field label={t.fieldFamilyOther}>
          <Input value={form.productFamilyOther} onChange={(e) => set("productFamilyOther", e.target.value)} placeholder={t.phFamilyOther} />
        </Field>
      )}
      {form.accountType === "OTHER" && (
        <Field label={t.fieldAccountTypeOther}>
          <Input value={form.accountTypeOther} onChange={(e) => set("accountTypeOther", e.target.value)} placeholder={t.phAccountTypeOther} />
        </Field>
      )}
      {form.durationType === "OTHER" && (
        <Field label={t.fieldDurationOther}>
          <Input value={form.durationTypeOther} onChange={(e) => set("durationTypeOther", e.target.value)} placeholder={t.phDurationOther} />
        </Field>
      )}

      <SectionDivider label={t.secDelivery} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Field label={t.fieldDeliveryMode}>
            <SelectBox value={form.sourceDeliveryMode} onChange={(v) => set("sourceDeliveryMode", v)} options={sourceDeliveryModeOptions} placeholder={t.phDeliveryMode} />
          </Field>
          <DeliveryModeHint mode={form.sourceDeliveryMode} />
        </div>
        <div className="space-y-3">
          <Field label={t.fieldWarranty}>
            <SelectBox value={form.warrantyPolicy} onChange={(v) => set("warrantyPolicy", v)} options={sourceWarrantyPolicyOptions} placeholder={t.phWarranty} />
          </Field>
          {form.sourceDeliveryMode !== "MANUAL" && (
            <Field label={t.fieldAvailable} description={t.fieldAvailableDesc} hintPlacement="top">
              <Input type="number" value={form.available} onChange={(e) => set("available", e.target.value)} placeholder={t.phAvailable} />
            </Field>
          )}
        </div>
      </div>

      {form.sourceDeliveryMode === "MANUAL" && (
        <Field label={t.fieldAvailable} description={t.fieldAvailableDescManual}>
          <Input type="number" value={form.available} onChange={(e) => set("available", e.target.value)} placeholder={t.phAvailable} />
        </Field>
      )}

      {(form.sourceDeliveryMode === "AUTO_STOCK" || form.sourceDeliveryMode === "MANUAL") && (
        <>
          <SectionDivider label={t.secInventory} />
          <div className="space-y-2">
            <Field label={t.fieldDeliveryText} hint={t.hintDeliveryText}>
              <Textarea value={form.deliveryText} onChange={(e) => set("deliveryText", e.target.value)} placeholder={t.phDeliveryText} />
            </Field>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer rounded-[10px] border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-slate-400 transition hover:border-violet-300/30 hover:bg-white/[0.06]">
                <input
                  type="file"
                  accept=".txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const text = String(ev.target?.result || "").trim();
                      setForm((f) => ({ ...f, deliveryText: f.deliveryText.trim() ? f.deliveryText.trim() + "\n" + text : text }));
                    };
                    reader.readAsText(file);
                    e.target.value = "";
                  }}
                />
                {t.importFile}
              </label>
              {form.deliveryText.trim() && (
                <span className="text-xs" style={{ color: "var(--tx-f)" }}>
                  {t.lineCount(form.deliveryText.trim().split("\n").filter(Boolean).length)}
                </span>
              )}
            </div>
          </div>
        </>
      )}

      <div className="pt-2">
        <Button disabled={isPending} onClick={onSubmit}>
          {mode === "edit" ? <Save className="h-4 w-4" /> : <PackagePlus className="h-4 w-4" />}
          {isPending ? t.saving : submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function SourceProductsPage({
  openCreate,
  onCreateOpened,
}: {
  openCreate?: boolean;
  onCreateOpened?: () => void;
}) {
  const { session } = useAuth();
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<SourceProductForm>(emptyForm);
  const [manualForm, setManualForm] = useState<SourceProductForm>({ ...emptyForm, internalSourceEnabled: true });
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!openCreate) return;
    setCreateOpen(true);
    onCreateOpened?.();
  }, [openCreate]);

  const canManageInternalSource = hasSellerCapability(session, "source_internal_manage");

  const productsQuery = useQuery({
    queryKey: ["source-products", "catalog"],
    queryFn: async () => (await api.get<SourceProduct[]>("/products")).data,
    enabled: canManageInternalSource,
  });

  const products = productsQuery.data || [];
  const selectedProduct = products.find((item) => item.id === selectedId) || null;

  useEffect(() => {
    if (!products.length) { setSelectedId(null); return; }
    setSelectedId((current) => current || products[0]?.id || null);
  }, [products]);

  useEffect(() => {
    if (!selectedProduct) { setEditor(emptyForm); return; }
    setEditor(buildFormFromProduct(selectedProduct));
  }, [selectedProduct]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error("No source product selected.");
      return api.put(`/products/${selectedProduct.id}`, buildSourcePayload(editor));
    },
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastUpdated });
      await queryClient.invalidateQueries({ queryKey: ["source-products", "catalog"] });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, t.errDefault) }),
  });

  const createMutation = useMutation({
    mutationFn: async () => api.post("/products/manual", buildSourcePayload(manualForm)),
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastCreated });
      setManualForm({ ...emptyForm, internalSourceEnabled: true });
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["source-products", "catalog"] });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, t.errDefault) }),
  });

  const publishedCount = useMemo(() => products.filter((p) => p.internalSourceEnabled).length, [products]);
  const manualCount = useMemo(() => products.filter((p) => p.isManual).length, [products]);

  if (!canManageInternalSource) return <TierGate />;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[24px] border border-violet-400/15 p-6" style={{ background: "linear-gradient(135deg, rgba(109,40,217,0.12) 0%, rgba(167,139,250,0.06) 50%, transparent 100%)", backgroundColor: "var(--surface)" }}>
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: "radial-gradient(ellipse 60% 80% at 90% 0%, rgba(139,92,246,0.25), transparent)" }} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-violet-300">
              <Crown className="h-3 w-3" />
              {t.eyebrow}
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">{t.title}</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--tx-f)" }}>{t.desc}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <StatChip icon={<Boxes className="h-4 w-4 text-violet-300" />} label={t.statCatalog} value={products.length} accent="bg-violet-500/15" />
            <StatChip icon={<Zap className="h-4 w-4 text-emerald-300" />} label={t.statPublished} value={publishedCount} accent="bg-emerald-500/15" />
            <StatChip icon={<TrendingUp className="h-4 w-4 text-sky-300" />} label={t.statManual} value={manualCount} accent="bg-sky-500/15" />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="flex flex-col rounded-[22px] border border-white/8 p-5" style={{ backgroundColor: "var(--surface)" }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400">{t.listEyebrow}</p>
              <h2 className="mt-0.5 text-base font-bold" style={{ color: "var(--tx)" }}>{t.listTitle}</h2>
            </div>
            <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs font-semibold" style={{ color: "var(--tx-f)", backgroundColor: "var(--inp)" }}>
              {products.length}
            </span>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto pr-0.5" style={{ maxHeight: 560 }}>
            {products.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-[16px] border border-dashed border-white/8 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-violet-400/20 bg-violet-500/10">
                  <PackagePlus className="h-5 w-5 text-violet-300" />
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--tx)" }}>{t.emptyTitle}</p>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--tx-f)" }}>{t.emptyDesc}</p>
                </div>
              </div>
            ) : products.map((product) => {
              const isSelected = product.id === selectedId;
              const icon = product.productIcon || (product.isManual ? "📦" : "🔄");
              const wholesalePrice = product.internalSourcePrice ?? product.sourcePrice;
              const hasCustomWholesale = product.internalSourcePrice != null;

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => setSelectedId(product.id)}
                  className={[
                    "group w-full rounded-[16px] border px-4 py-3.5 text-left transition-all duration-200",
                    isSelected
                      ? "border-violet-400/35 bg-[linear-gradient(135deg,rgba(109,40,217,0.12),rgba(167,139,250,0.06))] shadow-[0_0_20px_rgba(109,40,217,0.15)]"
                      : "border-white/6 hover:border-violet-400/20 hover:bg-violet-500/5",
                  ].join(" ")}
                  style={!isSelected ? { backgroundColor: "var(--inp)" } : undefined}
                >
                  <div className="flex items-start gap-3">
                    <div className={[
                      "mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-lg leading-none transition-all",
                      isSelected ? "bg-violet-500/20" : "bg-white/[0.06] group-hover:bg-violet-500/10",
                    ].join(" ")}>
                      {icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold" style={{ color: "var(--tx)" }}>
                          {localizeProductName(product.displayName, lang)}
                        </p>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {product.internalSourceEnabled ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-2 py-px text-[10px] font-semibold text-emerald-300">
                            <Eye className="h-2.5 w-2.5" /> Published
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-px text-[10px] font-semibold text-slate-500">
                            <EyeOff className="h-2.5 w-2.5" /> Draft
                          </span>
                        )}
                        {product.isManual && (
                          <span className="inline-flex rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-px text-[10px] font-semibold text-amber-400">
                            Manual
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0 text-[11px]" style={{ color: "var(--tx-f)" }}>
                        <span>{t.retail} {formatCurrency(product.salePrice || product.sourcePrice)}</span>
                        <span className={hasCustomWholesale ? "font-semibold text-violet-300" : ""}>
                          {t.wholesale} {formatCurrency(wholesalePrice)}{hasCustomWholesale && " ✦"}
                        </span>
                        <span className="text-slate-600">{t.stock(product.available)}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="flex-shrink-0 self-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[22px] border border-white/8 overflow-hidden" style={{ backgroundColor: "var(--surface)" }}>
          {selectedProduct ? (
            <>
              <div className="relative border-b border-white/8 px-6 py-5" style={{ background: "linear-gradient(135deg, rgba(109,40,217,0.08), transparent)" }}>
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[16px] border border-violet-400/20 bg-violet-500/10 text-3xl leading-none">
                    {selectedProduct.productIcon || (selectedProduct.isManual ? "📦" : "🔄")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-white">{localizeProductName(selectedProduct.displayName, lang)}</h2>
                      {selectedProduct.internalSourceEnabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                          <ShieldCheck className="h-3 w-3" /> Published
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
                          Draft
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: "var(--tx-f)" }}>
                      <span>{t.retail} {formatCurrency(selectedProduct.salePrice || selectedProduct.sourcePrice)}</span>
                      <span>{t.wholesale} {formatCurrency(selectedProduct.internalSourcePrice ?? selectedProduct.sourcePrice)}</span>
                      {selectedProduct.syncedAt && <span>Sync {formatDate(selectedProduct.syncedAt)}</span>}
                    </div>
                  </div>
                  <p className="hidden shrink-0 text-right text-xs text-slate-600 sm:block">{t.editing}</p>
                </div>
              </div>
              <div className="p-6">
                <ProductForm
                  form={editor}
                  setForm={setEditor}
                  isPending={updateMutation.isPending}
                  onSubmit={() => updateMutation.mutate()}
                  submitLabel={t.saveLabel}
                  mode="edit"
                />
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-[20px] border border-dashed border-white/10 text-3xl">
                📋
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--tx)" }}>{t.noSelection}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--tx-f)" }}>{t.noSelectionDesc}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {createPortal(
        <div
          className={`fixed inset-0 z-[200] flex items-center justify-center p-4 transition-all duration-300 ${createOpen ? "pointer-events-auto" : "pointer-events-none"}`}
          style={{ backgroundColor: createOpen ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0)" }}
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="relative flex w-full max-w-[700px] flex-col rounded-2xl shadow-2xl overflow-hidden"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid rgba(139,92,246,0.25)",
              maxHeight: "90vh",
              transform: createOpen ? "scale(1) translateY(0)" : "scale(0.96) translateY(16px)",
              opacity: createOpen ? 1 : 0,
              transition: "transform 250ms cubic-bezier(0.4,0,0.2,1), opacity 250ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.25)" }}>
                  <PackagePlus className="h-4 w-4 text-violet-400" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.createKicker}</p>
                  <p className="text-sm font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>{t.createTitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all hover:opacity-70"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <ProductForm
                form={manualForm}
                setForm={setManualForm}
                isPending={createMutation.isPending}
                onSubmit={() => createMutation.mutate()}
                submitLabel={t.createLabel}
                mode="create"
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
