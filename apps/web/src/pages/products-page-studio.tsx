import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  Crown,
  Eye,
  EyeOff,
  Package,
  PackagePlus,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Tag,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";

import { useAuth } from "@/auth/auth-provider";
import {
  StudioBadge,
  StudioButton,
  StudioCard,
  StudioInput,
  StudioMetric,
  StudioSectionIntro,
  StudioTextArea,
} from "@/components/studio/studio-ui";
import { InfoHint } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { useLang } from "@/lib/lang";
import { hasSellerCapability } from "@/lib/seller-access";

const T = {
  vi: {
    overview: "Tổng quan sản phẩm", totalLabel: "tổng", manualLabel: "sản phẩm riêng", activeLabel: "đang bán", soldLabel: "đã bán",
    loading: "Đang tải...", refresh: "Làm mới", searchPh: "Tìm tên sản phẩm...", clearFilter: "Xóa lọc",
    visibleOf: (n: number, tot: number) => `${n}/${tot} sản phẩm`,
    fAll: "Tất cả", fManual: "Sản phẩm riêng", fActive: "Đang bán", fHidden: "Ẩn trên bot", fPaused: "Tạm dừng",
    colName: "Tên sản phẩm", colSalePrice: "Giá bán", colSourcePrice: "Giá vốn", colUnsold: "Chưa bán", colSold: "Đã bán", colTotal: "Tổng", colActions: "Hành động",
    loadError: "Không tải được danh sách sản phẩm", loadErrorHint: "Hãy thử tải lại catalog sau ít phút nữa.",
    emptyTitle: "Chưa có sản phẩm phù hợp", emptyHint: "Đổi bộ lọc hoặc tạo sản phẩm riêng",
    bManual: "Riêng", bSource: "Nguồn", bOff: "Tắt", bHidden: "Ẩn", bShown: "Hiện", bOn: "Bật",
    aView: "Xem", aEdit: "Sửa", aStock: "Thêm TK", aPromo: "Khuyến mãi", aShow: "Hiện", aHide: "Ẩn", aDelete: "Xóa",
    confirmDel: (name: string) => `Xóa sản phẩm riêng "${name}" khỏi shop?`,
    confirmDelShort: (name: string) => `Xóa "${name}"?`,
    confirmPurge: "Xóa nhanh toàn bộ account đã giao?",
    mCreate: "Thêm mới", mInventory: "Kho account", mPromo: "Khuyến mãi", mView: "Chi tiết sản phẩm", mEdit: "Chỉnh sản phẩm", mCreateTitle: "Tạo sản phẩm riêng",
    bManualLong: "Sản phẩm riêng", bSynced: "Đồng bộ nguồn", bActive: "Đang bán", bPaused: "Tạm dừng", bHiddenLong: "Đang ẩn",
    statStock: "Tồn kho", statSold: "Đã bán", statSalePrice: "Giá bán", statSourcePrice: "Giá nguồn", statProfit: "Lợi nhuận ước tính", statImported: "Tổng đã nhập",
    selfManaged: "CTV quản lý", promoSection: "Khuyến mãi", editProductBtn: "Chỉnh sản phẩm", stockShortBtn: "Kho TK",
    fDisplayName: "Tên hiển thị", hBotName: "Tên trên bot", phDisplayName: "Tên công khai hiển thị cho khách",
    fSalePrice: "Giá bán", hVnd: "VND", phSalePrice: "Giá bán cho khách",
    fIntName: "Tên nội bộ", hShopSource: "Nguồn shop", phIntName: "Tên dùng để quản trị nội bộ",
    fStock: "Tồn kho", hAutoCalc: "Tự tính", hOptional: "Tùy chọn",
    phStockAuto: "Kho tự tính theo account", phStockManual: "Ví dụ: 15",
    dStockAuto: "Đang tự tính theo danh sách account ở phần nội dung giao tự động. Muốn tăng hoặc giảm kho, hãy thêm hoặc bớt account bên dưới.",
    dStockManual: "Để trống nếu đây là gói không giới hạn. Nhập 0 nếu muốn báo hết hàng.",
    fIntCost: "Chi phí nội bộ", phIntCost: "Mặc định có thể để 0", dIntCost: "Dùng để theo dõi lợi nhuận trong shop. Có thể để 0.",
    fIntDesc: "Mô tả nội bộ", phIntDesc: "Ví dụ: combo giao bằng text", dIntDesc: "Dùng để phân biệt các gói riêng hoặc lưu ghi chú ngắn.",
    fDelivery: "Nội dung giao tự động", hManualDelivery: "Manual delivery", dDelivery: "Mỗi dòng là một tài khoản. Ví dụ: email | mật khẩu. Nếu có sẵn dữ liệu cũ dạng JSON thì hệ thống vẫn đọc được.",
    fPromo: "Thông điệp khuyến mại", hBotDisplay: "Hiển thị trên bot",
    phPromo: "Ví dụ: Bảo hành nhanh, hỗ trợ cài đặt hoặc quà tặng kèm.",
    dPromo: "Thêm ghi chú ngắn về bảo hành, ưu đãi hoặc lời nhấn giúp tăng chuyển đổi.",
    dPromoDrawer: "Ghi chú ngắn về ưu đãi, bảo hành hoặc quà tặng kèm. Hiển thị ngay dưới tên sản phẩm khi khách xem.",
    langTitle: "Hiển thị theo ngôn ngữ", langDesc: "Kiểm soát sản phẩm nào hiện với khách Việt và khách quốc tế",
    viCustomer: "🇻🇳 Khách Việt", enCustomer: "🌍 Khách quốc tế",
    hiddenViOn: "Ẩn với người dùng tiếng Việt", hiddenViOff: "Hiển thị bình thường",
    hiddenEnOn: "Ẩn với người dùng tiếng Anh", hiddenEnOff: "Hiển thị bình thường",
    fUsd: "Giá USD (khách quốc tế)", phUsd: "Ví dụ: 3.99",
    dUsdActive: (p: string) => `Bot EN sẽ hiển thị $${p}`, dUsdEmpty: "Để trống → tự quy đổi từ giá VND theo tỉ giá cấu hình",
    wholesaleTitle: "Giá sỉ cho reseller PRO", wholesaleDesc: "Seller PRO kết nối với bạn sẽ nhập hàng theo giá này",
    fWholesale: "Giá sỉ (PRO)", phWholesale: "Giá bán cho seller PRO", allowProBuy: "Cho PRO mua",
    allowSale: "Cho phép bán", allowSaleDesc: "Bật hoặc tắt khả năng mua sản phẩm này trên bot.",
    allowSaleCreateDesc: "Tạo sản phẩm ở trạng thái mở bán ngay sau khi lưu.",
    hideOnBot: "Ẩn trên bot", hideOnBotDesc: "Giữ trong catalog nhưng tạm thời gỡ khỏi menu công khai.",
    hideOnBotCreateDesc: "Tạo sẵn trong catalog nhưng chưa hiển thị công khai cho khách.",
    syncedPriceLabel: "Giá nguồn hiện tại", syncedNote: "Sản phẩm đồng bộ chỉ cho phép đổi tên hiển thị, giá bán và trạng thái.",
    saving: "Đang lưu...", saveProduct: "Lưu cấu hình sản phẩm", savePromo: "Lưu khuyến mãi",
    createEyebrow: "Tự tạo catalog riêng", createHeading: "Tạo sản phẩm của shop",
    createSubhead: "Chỉ hiện phần cần thiết để bạn lên nhanh một gói riêng, combo nội bộ hoặc sản phẩm không nằm trong catalog nguồn.",
    hRequired: "Bắt buộc", hRequiredIfOn: "Bắt buộc nếu bật",
    phCreateName: "Ví dụ: Combo Canva + ChatGPT 30 ngày", phCreateStock: "Ví dụ: 10",
    phCreateStockAuto: "Kho tự tính theo account", phCreateIntName: "Tên riêng để quản trị nội bộ",
    phCreateIntDesc: "Ví dụ: giao bằng text, xử lý thủ công", phCreatePromo: "Ví dụ: hỗ trợ đổi lỗi nhanh trong 24h.",
    dCreateStockAuto: "Đang tự tính theo danh sách account ở phần nội dung giao tự động. Nếu muốn nhập kho tay thì để trống phần auto-giao.",
    dCreateStockManual: "Để trống nếu không muốn giới hạn. Nhập 0 nếu muốn tạo sẵn nhưng chưa bán.",
    dCreateIntName: "Nếu bỏ trống, hệ thống sẽ dùng luôn tên hiển thị.",
    dCreateIntDesc: "Có thể dùng để ghi loại tài khoản, nguồn giao hoặc quy cách gói.",
    dCreatePromo: "Xuất hiện cùng sản phẩm để tăng tỷ lệ chốt đơn.",
    createNotice: "Nếu điền nội dung giao tự động, hệ thống sẽ coi mỗi dòng là một account và tự trừ dần sau mỗi đơn. Nếu để trống, đơn manual sẽ chuyển sang chờ seller xử lý thủ công.",
    creating: "Đang tạo sản phẩm...", createBtn: "Tạo sản phẩm riêng",
    errNoProduct: "Hãy chọn một sản phẩm trước khi lưu.", errNoName: "Tên hiển thị không được để trống.",
    errNoManualName: "Tên sản phẩm riêng không được để trống.",
    savedProduct: "Đã lưu cấu hình sản phẩm.", errSaveFallback: "Không thể lưu thay đổi cho sản phẩm này.",
    createdProduct: (name: string) => `Đã tạo sản phẩm riêng "${name}". Chỉnh tiếp trong panel bên phải.`,
    errCreateFallback: "Không thể tạo sản phẩm riêng lúc này.",
    deletedProduct: "Đã xóa sản phẩm riêng khỏi shop.",
    errDeleteFallback: "Không thể xóa sản phẩm này. Nếu đã có đơn phát sinh, hãy ẩn hoặc tắt bán thay vì xóa.",
    errToggleFallback: "Không thể cập nhật trạng thái hiển thị.",
    purgedMsg: "Đã dọn dữ liệu tài khoản đã giao khỏi màn quản lý sản phẩm.", errPurgeFallback: "Không thể dọn dữ liệu tài khoản đã giao.",
    errRequired: (f: string) => `${f} không được để trống.`, errInvalidNum: (f: string) => `${f} phải là số từ 0 trở lên.`, errInvalidInt: (f: string) => `${f} phải là số nguyên từ 0 trở lên.`,
    efSalePrice: "Giá bán", efUsd: "Giá USD", efIntCost: "Chi phí nội bộ", efStock: "Tồn kho", efWholesale: "Giá sỉ",
    fieldNote: (label: string) => `Xem ghi chú cho ${label}`,
    invTitle: "Kho account của sản phẩm", invSubtitle: "Theo dõi account còn sẵn và account đã giao ngay tại đây.",
    invAvail: (n: number) => `Còn sẵn ${n}`, invDel: (n: number) => `Đã giao ${n}`, invPurged: (n: number) => `Đã dọn ${n}`,
    purgeBtnAll: "Xóa nhanh đã giao", panelAvail: "Account còn sẵn", panelDel: "Account đã giao",
    accountCount: (n: number) => `${n} account`, loadingAvail: "Đang tải kho account...", loadingDel: "Đang tải lịch sử đã giao...",
    accountNo: (n: number) => `Account #${n}`, readyBadge: "Sẵn sàng", deliveredBadge: "Đã giao",
    telegramCustomer: "Khách Telegram", deleteSingle: "Xóa",
    emptyAvail: "Chưa còn account sẵn trong kho tự động.", emptyDel: "Chưa có account nào được giao hoặc bạn đã dọn hết khỏi màn quản lý.",
    deliveryPh: "Ví dụ:\nbtceuhocdt@nyawit.id | Premium@123\nabc@gmail.com | Pass456\nxyz@mail.com | Pass789",
    addStockTitle: "Thêm account vào kho", addStockPh: "Dán account vào đây, mỗi dòng 1 account...", addStockBtn: "Thêm vào kho", addStockSaving: "Đang thêm...", addStockSuccess: "Đã thêm account vào kho.", addStockErr: "Không thể thêm account.",
  },
  en: {
    overview: "Product Overview", totalLabel: "total", manualLabel: "own products", activeLabel: "active", soldLabel: "sold",
    loading: "Loading...", refresh: "Refresh", searchPh: "Search products...", clearFilter: "Clear filters",
    visibleOf: (n: number, tot: number) => `${n}/${tot} products`,
    fAll: "All", fManual: "Own products", fActive: "Active", fHidden: "Hidden on bot", fPaused: "Paused",
    colName: "Product name", colSalePrice: "Sale price", colSourcePrice: "Cost", colUnsold: "In stock", colSold: "Sold", colTotal: "Total", colActions: "Actions",
    loadError: "Could not load products", loadErrorHint: "Try refreshing the catalog in a moment.",
    emptyTitle: "No matching products", emptyHint: "Change filters or create a custom product",
    bManual: "Own", bSource: "Source", bOff: "Off", bHidden: "Hidden", bShown: "Shown", bOn: "On",
    aView: "View", aEdit: "Edit", aStock: "Add stock", aPromo: "Promo", aShow: "Show", aHide: "Hide", aDelete: "Delete",
    confirmDel: (name: string) => `Delete own product "${name}" from shop?`,
    confirmDelShort: (name: string) => `Delete "${name}"?`,
    confirmPurge: "Delete all delivered accounts?",
    mCreate: "New", mInventory: "Inventory", mPromo: "Promo", mView: "Product details", mEdit: "Edit product", mCreateTitle: "Create own product",
    bManualLong: "Own product", bSynced: "Synced from source", bActive: "Active", bPaused: "Paused", bHiddenLong: "Currently hidden",
    statStock: "In stock", statSold: "Sold", statSalePrice: "Sale price", statSourcePrice: "Source price", statProfit: "Estimated profit", statImported: "Total imported",
    selfManaged: "Self-managed", promoSection: "Promo", editProductBtn: "Edit product", stockShortBtn: "Stock",
    fDisplayName: "Display name", hBotName: "Bot name", phDisplayName: "Public name shown to customers",
    fSalePrice: "Sale price", hVnd: "VND", phSalePrice: "Customer sale price",
    fIntName: "Internal name", hShopSource: "Shop source", phIntName: "Name for internal management",
    fStock: "Stock", hAutoCalc: "Auto", hOptional: "Optional",
    phStockAuto: "Auto-calculated from accounts", phStockManual: "e.g. 15",
    dStockAuto: "Automatically tracked from the account list in auto-delivery content. To increase or decrease stock, add or remove accounts below.",
    dStockManual: "Leave blank for unlimited. Enter 0 to mark as out of stock.",
    fIntCost: "Internal cost", phIntCost: "Can default to 0", dIntCost: "Used to track profit in shop. Can be 0.",
    fIntDesc: "Internal note", phIntDesc: "e.g. text delivery bundle", dIntDesc: "Used to distinguish product variants or store short notes.",
    fDelivery: "Auto-delivery content", hManualDelivery: "Manual delivery", dDelivery: "One account per line. e.g. email | password. Legacy JSON format is also supported.",
    fPromo: "Promo message", hBotDisplay: "Shown on bot",
    phPromo: "e.g. Fast warranty replacement, 24/7 setup support.",
    dPromo: "Short note about warranty, offer, or selling point to boost conversions.",
    dPromoDrawer: "Short note about offers, warranty, or bonuses. Shown directly below the product name when customers view it.",
    langTitle: "Display by language", langDesc: "Control which products show to Vietnamese and international customers",
    viCustomer: "🇻🇳 Vietnamese", enCustomer: "🌍 International",
    hiddenViOn: "Hidden from Vietnamese users", hiddenViOff: "Visible normally",
    hiddenEnOn: "Hidden from English users", hiddenEnOff: "Visible normally",
    fUsd: "USD price (international)", phUsd: "e.g. 3.99",
    dUsdActive: (p: string) => `EN bot will show $${p}`, dUsdEmpty: "Leave blank → auto-convert from VND using configured rate",
    wholesaleTitle: "Wholesale price for PRO resellers", wholesaleDesc: "PRO sellers connected to you will purchase at this price",
    fWholesale: "Wholesale (PRO)", phWholesale: "Price for PRO sellers", allowProBuy: "Allow PRO to buy",
    allowSale: "Allow sales", allowSaleDesc: "Enable or disable purchasing this product on the bot.",
    allowSaleCreateDesc: "Create the product in active selling state after saving.",
    hideOnBot: "Hide on bot", hideOnBotDesc: "Keep in catalog but temporarily remove from public menu.",
    hideOnBotCreateDesc: "Create in catalog but not yet publicly visible to customers.",
    syncedPriceLabel: "Current source price", syncedNote: "Synced products only allow changing the display name, price, and status.",
    saving: "Saving...", saveProduct: "Save product settings", savePromo: "Save promo",
    createEyebrow: "Custom catalog", createHeading: "Create shop product",
    createSubhead: "Only shows the essentials to quickly set up a custom package, internal bundle, or product not in the source catalog.",
    hRequired: "Required", hRequiredIfOn: "Required if enabled",
    phCreateName: "e.g. Canva + ChatGPT 30-day combo", phCreateStock: "e.g. 10",
    phCreateStockAuto: "Auto-calculated from accounts", phCreateIntName: "Internal management name",
    phCreateIntDesc: "e.g. text delivery, manual processing", phCreatePromo: "e.g. fast error replacement within 24h.",
    dCreateStockAuto: "Auto-tracked from the account list in auto-delivery. To enter stock manually, leave the auto-delivery section blank.",
    dCreateStockManual: "Leave blank for unlimited. Enter 0 to create but not yet sell.",
    dCreateIntName: "If blank, the system will use the display name.",
    dCreateIntDesc: "Can be used to note account type, delivery source, or package specs.",
    dCreatePromo: "Appears with the product to increase conversion rate.",
    createNotice: "If auto-delivery content is provided, the system treats each line as an account and deducts automatically after each order. If left blank, manual orders will queue for seller processing.",
    creating: "Creating product...", createBtn: "Create own product",
    errNoProduct: "Please select a product before saving.", errNoName: "Display name cannot be empty.",
    errNoManualName: "Own product name cannot be empty.",
    savedProduct: "Product settings saved.", errSaveFallback: "Could not save changes to this product.",
    createdProduct: (name: string) => `Own product "${name}" created. Continue editing in the right panel.`,
    errCreateFallback: "Could not create own product right now.",
    deletedProduct: "Own product removed from shop.",
    errDeleteFallback: "Could not delete this product. If orders exist, hide or pause it instead.",
    errToggleFallback: "Could not update visibility status.",
    purgedMsg: "Delivered account data cleared from product manager.", errPurgeFallback: "Could not clear delivered account data.",
    errRequired: (f: string) => `${f} is required.`, errInvalidNum: (f: string) => `${f} must be a number ≥ 0.`, errInvalidInt: (f: string) => `${f} must be a whole number ≥ 0.`,
    efSalePrice: "Sale price", efUsd: "USD price", efIntCost: "Internal cost", efStock: "Stock", efWholesale: "Wholesale price",
    fieldNote: (label: string) => `View notes for ${label}`,
    invTitle: "Product account inventory", invSubtitle: "Track available and delivered accounts here.",
    invAvail: (n: number) => `Available ${n}`, invDel: (n: number) => `Delivered ${n}`, invPurged: (n: number) => `Cleared ${n}`,
    purgeBtnAll: "Clear delivered", panelAvail: "Available accounts", panelDel: "Delivered accounts",
    accountCount: (n: number) => `${n} accounts`, loadingAvail: "Loading inventory...", loadingDel: "Loading delivery history...",
    accountNo: (n: number) => `Account #${n}`, readyBadge: "Ready", deliveredBadge: "Delivered",
    telegramCustomer: "Telegram customer", deleteSingle: "Delete",
    emptyAvail: "No available accounts in auto-stock.", emptyDel: "No accounts have been delivered, or you've cleared them all.",
    deliveryPh: "e.g.\nbtceuhocdt@nyawit.id | Premium@123\nabc@gmail.com | Pass456\nxyz@mail.com | Pass789",
    addStockTitle: "Add accounts to inventory", addStockPh: "Paste accounts here, one per line...", addStockBtn: "Add to inventory", addStockSaving: "Adding...", addStockSuccess: "Accounts added to inventory.", addStockErr: "Could not add accounts.",
  },
  th: {
    overview: "ภาพรวมสินค้า", totalLabel: "รวม", manualLabel: "สินค้าของร้าน", activeLabel: "กำลังขาย", soldLabel: "ขายแล้ว",
    loading: "กำลังโหลด...", refresh: "รีเฟรช", searchPh: "ค้นหาสินค้า...", clearFilter: "ล้างตัวกรอง",
    visibleOf: (n: number, tot: number) => `${n}/${tot} สินค้า`,
    fAll: "ทั้งหมด", fManual: "สินค้าของร้าน", fActive: "กำลังขาย", fHidden: "ซ่อนบนบอท", fPaused: "หยุดชั่วคราว",
    colName: "ชื่อสินค้า", colSalePrice: "ราคาขาย", colSourcePrice: "ต้นทุน", colUnsold: "คงเหลือ", colSold: "ขายแล้ว", colTotal: "รวม", colActions: "การดำเนินการ",
    loadError: "ไม่สามารถโหลดรายการสินค้าได้", loadErrorHint: "ลองรีเฟรชแคตาล็อกอีกครั้ง",
    emptyTitle: "ไม่มีสินค้าที่ตรงกัน", emptyHint: "เปลี่ยนตัวกรองหรือสร้างสินค้าของร้าน",
    bManual: "ของร้าน", bSource: "ซิงค์", bOff: "ปิด", bHidden: "ซ่อน", bShown: "แสดง", bOn: "เปิด",
    aView: "ดู", aEdit: "แก้ไข", aStock: "เพิ่มสต็อก", aPromo: "โปรโมชั่น", aShow: "แสดง", aHide: "ซ่อน", aDelete: "ลบ",
    confirmDel: (name: string) => `ลบสินค้า "${name}" ออกจากร้าน?`,
    confirmDelShort: (name: string) => `ลบ "${name}"?`,
    confirmPurge: "ลบข้อมูลบัญชีที่ส่งแล้วทั้งหมด?",
    mCreate: "สร้างใหม่", mInventory: "คลังสินค้า", mPromo: "โปรโมชั่น", mView: "รายละเอียดสินค้า", mEdit: "แก้ไขสินค้า", mCreateTitle: "สร้างสินค้าของร้าน",
    bManualLong: "สินค้าของร้าน", bSynced: "ซิงค์จากต้นทาง", bActive: "กำลังขาย", bPaused: "หยุดชั่วคราว", bHiddenLong: "ซ่อนอยู่",
    statStock: "คงเหลือ", statSold: "ขายแล้ว", statSalePrice: "ราคาขาย", statSourcePrice: "ราคาต้นทาง", statProfit: "กำไรโดยประมาณ", statImported: "นำเข้าทั้งหมด",
    selfManaged: "จัดการเอง", promoSection: "โปรโมชั่น", editProductBtn: "แก้ไขสินค้า", stockShortBtn: "สต็อก",
    fDisplayName: "ชื่อที่แสดง", hBotName: "ชื่อในบอท", phDisplayName: "ชื่อสาธารณะที่แสดงต่อลูกค้า",
    fSalePrice: "ราคาขาย", hVnd: "VND", phSalePrice: "ราคาขายให้ลูกค้า",
    fIntName: "ชื่อภายใน", hShopSource: "แหล่งที่มา", phIntName: "ชื่อสำหรับบริหารภายใน",
    fStock: "สต็อก", hAutoCalc: "อัตโนมัติ", hOptional: "ไม่บังคับ",
    phStockAuto: "คำนวณอัตโนมัติจากบัญชี", phStockManual: "เช่น 15",
    dStockAuto: "คำนวณอัตโนมัติจากรายการบัญชีในส่วนเนื้อหาจัดส่งอัตโนมัติ หากต้องการเพิ่มหรือลดสต็อก ให้เพิ่มหรือลบบัญชีด้านล่าง",
    dStockManual: "เว้นว่างสำหรับไม่จำกัด ใส่ 0 เพื่อแจ้งหมดสต็อก",
    fIntCost: "ต้นทุนภายใน", phIntCost: "ค่าเริ่มต้นใส่ 0 ได้", dIntCost: "ใช้ติดตามกำไรในร้าน สามารถใส่ 0 ได้",
    fIntDesc: "หมายเหตุภายใน", phIntDesc: "เช่น ส่งทางข้อความ", dIntDesc: "ใช้แยกแยะแพ็กเกจหรือจดบันทึกสั้น",
    fDelivery: "เนื้อหาจัดส่งอัตโนมัติ", hManualDelivery: "Manual delivery", dDelivery: "หนึ่งบัญชีต่อบรรทัด เช่น อีเมล | รหัสผ่าน รองรับรูปแบบ JSON เดิมด้วย",
    fPromo: "ข้อความโปรโมชั่น", hBotDisplay: "แสดงในบอท",
    phPromo: "เช่น รับประกันเร็ว ช่วยติดตั้ง 24/7",
    dPromo: "เพิ่มหมายเหตุสั้นเกี่ยวกับการรับประกัน ข้อเสนอ หรือจุดขาย",
    dPromoDrawer: "หมายเหตุสั้นเกี่ยวกับข้อเสนอ การรับประกัน หรือของแถม แสดงใต้ชื่อสินค้าเมื่อลูกค้าดู",
    langTitle: "แสดงตามภาษา", langDesc: "ควบคุมว่าสินค้าใดแสดงต่อลูกค้าไทยและต่างชาติ",
    viCustomer: "🇻🇳 ลูกค้าเวียดนาม", enCustomer: "🌍 ลูกค้าต่างชาติ",
    hiddenViOn: "ซ่อนจากผู้ใช้ภาษาเวียดนาม", hiddenViOff: "แสดงปกติ",
    hiddenEnOn: "ซ่อนจากผู้ใช้ภาษาอังกฤษ", hiddenEnOff: "แสดงปกติ",
    fUsd: "ราคา USD (ต่างชาติ)", phUsd: "เช่น 3.99",
    dUsdActive: (p: string) => `บอท EN จะแสดง $${p}`, dUsdEmpty: "เว้นว่าง → แปลงอัตโนมัติจาก VND ตามอัตราแลกเปลี่ยนที่ตั้งค่า",
    wholesaleTitle: "ราคาส่งสำหรับ PRO reseller", wholesaleDesc: "ผู้ขาย PRO ที่เชื่อมต่อกับคุณจะซื้อในราคานี้",
    fWholesale: "ราคาส่ง (PRO)", phWholesale: "ราคาสำหรับผู้ขาย PRO", allowProBuy: "อนุญาต PRO ซื้อ",
    allowSale: "อนุญาตขาย", allowSaleDesc: "เปิดหรือปิดการซื้อสินค้านี้บนบอท",
    allowSaleCreateDesc: "สร้างสินค้าในสถานะเปิดขายทันทีหลังบันทึก",
    hideOnBot: "ซ่อนในบอท", hideOnBotDesc: "เก็บไว้ในแคตาล็อกแต่นำออกจากเมนูสาธารณะชั่วคราว",
    hideOnBotCreateDesc: "สร้างในแคตาล็อกแต่ยังไม่แสดงต่อสาธารณะ",
    syncedPriceLabel: "ราคาต้นทางปัจจุบัน", syncedNote: "สินค้าที่ซิงค์อนุญาตให้เปลี่ยนได้เฉพาะชื่อ ราคา และสถานะ",
    saving: "กำลังบันทึก...", saveProduct: "บันทึกการตั้งค่าสินค้า", savePromo: "บันทึกโปรโมชั่น",
    createEyebrow: "สร้างแคตาล็อกของตัวเอง", createHeading: "สร้างสินค้าของร้าน",
    createSubhead: "แสดงเฉพาะส่วนที่จำเป็นเพื่อสร้างแพ็กเกจหรือสินค้าที่ไม่อยู่ในแคตาล็อกต้นทางได้อย่างรวดเร็ว",
    hRequired: "บังคับ", hRequiredIfOn: "บังคับถ้าเปิด",
    phCreateName: "เช่น Canva + ChatGPT 30 วัน", phCreateStock: "เช่น 10",
    phCreateStockAuto: "คำนวณอัตโนมัติจากบัญชี", phCreateIntName: "ชื่อสำหรับบริหารภายใน",
    phCreateIntDesc: "เช่น ส่งทางข้อความ ประมวลผลเอง", phCreatePromo: "เช่น เปลี่ยนเร็วภายใน 24 ชม.",
    dCreateStockAuto: "คำนวณอัตโนมัติจากรายการบัญชีในส่วนจัดส่งอัตโนมัติ หากต้องการนำเข้าสต็อกเอง ให้เว้นว่างส่วนจัดส่งอัตโนมัติ",
    dCreateStockManual: "เว้นว่างสำหรับไม่จำกัด ใส่ 0 เพื่อสร้างไว้แต่ยังไม่ขาย",
    dCreateIntName: "หากเว้นว่าง ระบบจะใช้ชื่อที่แสดงแทน",
    dCreateIntDesc: "สามารถใช้บันทึกประเภทบัญชี แหล่งจัดส่ง หรือรายละเอียดแพ็กเกจ",
    dCreatePromo: "แสดงพร้อมสินค้าเพื่อเพิ่มอัตราการขาย",
    createNotice: "หากใส่เนื้อหาจัดส่งอัตโนมัติ ระบบจะถือว่าแต่ละบรรทัดเป็นบัญชีหนึ่งรายการและหักออกหลังแต่ละออร์เดอร์ หากเว้นว่าง ออร์เดอร์ manual จะรอผู้ขายดำเนินการด้วยตนเอง",
    creating: "กำลังสร้างสินค้า...", createBtn: "สร้างสินค้าของร้าน",
    errNoProduct: "โปรดเลือกสินค้าก่อนบันทึก", errNoName: "ชื่อที่แสดงต้องไม่ว่าง",
    errNoManualName: "ชื่อสินค้าของร้านต้องไม่ว่าง",
    savedProduct: "บันทึกการตั้งค่าสินค้าแล้ว", errSaveFallback: "ไม่สามารถบันทึกการเปลี่ยนแปลงได้",
    createdProduct: (name: string) => `สร้างสินค้า "${name}" แล้ว ดำเนินการต่อในแผงด้านขวา`,
    errCreateFallback: "ไม่สามารถสร้างสินค้าได้ในขณะนี้",
    deletedProduct: "ลบสินค้าของร้านออกแล้ว",
    errDeleteFallback: "ไม่สามารถลบสินค้าได้ หากมีออร์เดอร์แล้ว ให้ซ่อนหรือปิดขายแทน",
    errToggleFallback: "ไม่สามารถอัปเดตสถานะการแสดงผลได้",
    purgedMsg: "ล้างข้อมูลบัญชีที่ส่งแล้วออกจากตัวจัดการสินค้าแล้ว", errPurgeFallback: "ไม่สามารถล้างข้อมูลบัญชีที่ส่งแล้วได้",
    errRequired: (f: string) => `${f} ต้องไม่ว่าง`, errInvalidNum: (f: string) => `${f} ต้องเป็นตัวเลข ≥ 0`, errInvalidInt: (f: string) => `${f} ต้องเป็นจำนวนเต็ม ≥ 0`,
    efSalePrice: "ราคาขาย", efUsd: "ราคา USD", efIntCost: "ต้นทุนภายใน", efStock: "สต็อก", efWholesale: "ราคาส่ง",
    fieldNote: (label: string) => `ดูหมายเหตุสำหรับ ${label}`,
    invTitle: "คลังบัญชีสินค้า", invSubtitle: "ติดตามบัญชีที่มีอยู่และที่ส่งแล้วที่นี่",
    invAvail: (n: number) => `คงเหลือ ${n}`, invDel: (n: number) => `ส่งแล้ว ${n}`, invPurged: (n: number) => `ล้างแล้ว ${n}`,
    purgeBtnAll: "ล้างที่ส่งแล้ว", panelAvail: "บัญชีที่มีอยู่", panelDel: "บัญชีที่ส่งแล้ว",
    accountCount: (n: number) => `${n} บัญชี`, loadingAvail: "กำลังโหลดคลังสินค้า...", loadingDel: "กำลังโหลดประวัติการส่ง...",
    accountNo: (n: number) => `บัญชี #${n}`, readyBadge: "พร้อม", deliveredBadge: "ส่งแล้ว",
    telegramCustomer: "ลูกค้า Telegram", deleteSingle: "ลบ",
    emptyAvail: "ไม่มีบัญชีในคลังอัตโนมัติ", emptyDel: "ยังไม่มีบัญชีที่ส่งหรือคุณล้างทั้งหมดแล้ว",
    deliveryPh: "เช่น:\nbtceuhocdt@nyawit.id | Premium@123\nabc@gmail.com | Pass456\nxyz@mail.com | Pass789",
    addStockTitle: "เพิ่มบัญชีในคลัง", addStockPh: "วางบัญชีที่นี่ หนึ่งบรรทัดต่อหนึ่งบัญชี...", addStockBtn: "เพิ่มในคลัง", addStockSaving: "กำลังเพิ่ม...", addStockSuccess: "เพิ่มบัญชีในคลังแล้ว", addStockErr: "ไม่สามารถเพิ่มบัญชีได้",
  },
} as const;
type TType = typeof T.vi;

type ProductFilter = "all" | "manual" | "active" | "hidden" | "paused";
type DrawerMode = "view" | "edit" | "create" | "inventory" | "promo" | null;

type Product = {
  id: string;
  sourceProductId: string;
  providerName: string;
  sourceName: string;
  displayName: string;
  description: string | null;
  sourcePrice: number;
  salePrice: number;
  salePriceUsd: number | null;
  available: number | null;
  soldCount: number;
  totalCount: number;
  enabled: boolean;
  hidden: boolean;
  hiddenVi: boolean;
  hiddenEn: boolean;
  promoText: string | null;
  isManual: boolean;
  deliveryText: string | null;
  syncedAt: string | null;
};

type ProductInventoryItem = {
  key: string;
  status: "available" | "delivered";
  content: string;
  orderCode?: string;
  deliveredAt?: string | null;
  customerLabel?: string | null;
};

type ProductInventory = {
  summary: {
    availableCount: number;
    deliveredCount: number;
    hiddenDeliveredCount: number;
  };
  availableItems: ProductInventoryItem[];
  deliveredItems: ProductInventoryItem[];
};

type ProductEditorForm = {
  displayName: string;
  salePrice: string;
  salePriceUsd: string;
  hidden: boolean;
  hiddenVi: boolean;
  hiddenEn: boolean;
  enabled: boolean;
  promoText: string;
  sourceName: string;
  sourceDescription: string;
  sourcePrice: string;
  available: string;
  deliveryText: string;
  internalSourceEnabled: boolean;
  internalSourcePrice: string;
};

type ManualProductForm = {
  displayName: string;
  salePrice: string;
  sourceName: string;
  sourceDescription: string;
  sourcePrice: string;
  available: string;
  promoText: string;
  deliveryText: string;
  hidden: boolean;
  enabled: boolean;
  internalSourceEnabled: boolean;
  internalSourcePrice: string;
};

type NoticeTone = "success" | "warning" | "danger";

const emptyEditorForm: ProductEditorForm = {
  displayName: "",
  salePrice: "",
  salePriceUsd: "",
  hidden: false,
  hiddenVi: false,
  hiddenEn: false,
  enabled: true,
  promoText: "",
  sourceName: "",
  sourceDescription: "",
  sourcePrice: "",
  available: "",
  deliveryText: "",
  internalSourceEnabled: false,
  internalSourcePrice: "",
};

const emptyManualForm: ManualProductForm = {
  displayName: "",
  salePrice: "",
  sourceName: "",
  sourceDescription: "",
  sourcePrice: "0",
  available: "",
  promoText: "",
  deliveryText: "",
  hidden: false,
  enabled: true,
  internalSourceEnabled: true,
  internalSourcePrice: "",
};

function Field({
  label,
  hint,
  description,
  children,
}: {
  label: string;
  hint?: string;
  description?: string;
  children: ReactNode;
}) {
  const { lang } = useLang();
  const t = T[lang];
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{label}</label>
          <InfoHint
            content={description}
            className="shrink-0"
            panelClassName="max-w-sm"
            label={t.fieldNote(label)}
          />
        </div>
        {hint ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

const NOTICE_STYLES: Record<NoticeTone, { bg: string; border: string }> = {
  success: { bg: "rgba(16,185,129,0.08)",  border: "rgba(16,185,129,0.2)" },
  warning: { bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)" },
  danger:  { bg: "rgba(244,63,94,0.08)",   border: "rgba(244,63,94,0.2)"  },
};

function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  const s = NOTICE_STYLES[tone];
  return (
    <div
      className="rounded-[18px] border px-4 py-3 text-sm leading-6"
      style={{ background: s.bg, borderColor: s.border, color: "var(--tx-m)" }}
    >
      {children}
    </div>
  );
}

function DeliveryTextArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { lang } = useLang();
  const t = T[lang];
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? "";
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
      onChange(value ? `${value}\n${lines}` : lines);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  return (
    <div className="relative">
      <StudioTextArea
        placeholder={t.deliveryPh}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input ref={fileRef} type="file" accept=".txt,.csv" className="hidden" onChange={handleFile} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[11px] font-bold uppercase transition hover:opacity-80"
        style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
      >
        <Upload className="h-3 w-3" />
        Import .txt
      </button>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data as
      | { message?: string | string[] }
      | undefined;
    const message =
      typeof responseData?.message === "string"
        ? responseData.message
        : Array.isArray(responseData?.message)
          ? responseData.message.join(", ")
          : error.message;

    if (message) {
      return message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function parseRequiredNumber(value: string, emptyMsg: string, invalidMsg: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(emptyMsg);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(invalidMsg);
  return parsed;
}

function parseOptionalInteger(value: string, invalidMsg: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(invalidMsg);
  return parsed;
}

function createEditorForm(product: Product): ProductEditorForm {
  return {
    displayName: product.displayName || "",
    salePrice: String(product.salePrice ?? ""),
    salePriceUsd: product.salePriceUsd != null ? String(product.salePriceUsd) : "",
    hidden: Boolean(product.hidden),
    hiddenVi: Boolean(product.hiddenVi),
    hiddenEn: Boolean(product.hiddenEn),
    enabled: Boolean(product.enabled),
    promoText: product.promoText || "",
    sourceName: product.sourceName || "",
    sourceDescription: product.description || "",
    sourcePrice: String(product.sourcePrice ?? 0),
    available: product.available === null ? "" : String(product.available),
    deliveryText: product.deliveryText || "",
    internalSourceEnabled: Boolean((product as any).internalSourceEnabled),
    internalSourcePrice: (product as any).internalSourcePrice != null ? String((product as any).internalSourcePrice) : "",
  };
}

function toUsdt(vnd: number, rate: number) {
  return (vnd / (rate > 0 ? rate : 26000)).toFixed(2);
}

const ACTION_COLORS = {
  indigo:  { bg: "rgba(99,102,241,0.15)",  color: "rgb(99,102,241)" },
  orange:  { bg: "rgba(249,115,22,0.15)",  color: "rgb(234,88,12)" },
  green:   { bg: "rgba(34,197,94,0.15)",   color: "rgb(22,163,74)" },
  pink:    { bg: "rgba(236,72,153,0.15)",  color: "rgb(219,39,119)" },
  violet:  { bg: "rgba(168,85,247,0.15)",  color: "rgb(147,51,234)" },
  red:     { bg: "rgba(244,63,94,0.15)",   color: "rgb(225,29,72)" },
  default: { bg: "transparent",            color: "var(--tx-f)" },
} as const;

function ActionBtn({
  title,
  color = "default",
  onClick,
  children,
}: {
  title: string;
  color?: keyof typeof ACTION_COLORS;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { bg, color: clr } = ACTION_COLORS[color];
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg opacity-30 group-hover:opacity-100 transition-all duration-150 hover:scale-110 active:scale-95"
      style={{ backgroundColor: bg, color: clr }}
    >
      {children}
    </button>
  );
}

function ManualInventoryPanel({
  inventory,
  isLoading,
  isPurging,
  onPurgeAll,
  onPurgeOne,
}: {
  inventory?: ProductInventory;
  isLoading: boolean;
  isPurging: boolean;
  onPurgeAll: () => void;
  onPurgeOne: (entryKey: string) => void;
}) {
  const { lang } = useLang();
  const t = T[lang];
  return (
    <div className="px-4 pb-4 pt-4 lg:px-5" style={{ borderTop: "1px solid var(--bd)" }}>
      <div
          className="rounded-[20px] border p-4 shadow-[0_18px_36px_rgba(0,0,0,0.12)] transition-[border-color,box-shadow,background-color] duration-300 ease-out lg:p-5"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--bd)" }}
        >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.invTitle}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>{t.invSubtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-emerald-400/18 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
              {t.invAvail(inventory?.summary.availableCount ?? 0)}
            </div>
            <div className="rounded-full border border-emerald-300/18 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
              {t.invDel(inventory?.summary.deliveredCount ?? 0)}
            </div>
            <div className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ border: "1px solid var(--bd)", background: "var(--inp)", color: "var(--tx-m)" }}>
              {t.invPurged(inventory?.summary.hiddenDeliveredCount ?? 0)}
            </div>
            <StudioButton
              size="sm"
              variant="danger"
              disabled={isPurging || !inventory?.deliveredItems?.length}
              onClick={onPurgeAll}
            >
              <Trash2 className="h-4 w-4" />
              {t.purgeBtnAll}
            </StudioButton>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-[18px] p-3" style={{ border: "1px solid var(--bd)", background: "var(--inp)" }}>
            <div className="flex items-center justify-between gap-3 pb-3" style={{ borderBottom: "1px solid var(--bd)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.panelAvail}</p>
              <StudioBadge tone="success">{t.accountCount(inventory?.summary.availableCount ?? 0)}</StudioBadge>
            </div>

            {isLoading ? (
              <div className="px-1 py-4 text-sm" style={{ color: "var(--tx-m)" }}>{t.loadingAvail}</div>
            ) : inventory?.availableItems.length ? (
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {inventory.availableItems.map((item, index) => (
                  <div
                    key={item.key}
                    className="rounded-[16px] px-3 py-3"
                    style={{ border: "1px solid var(--bd)", background: "var(--surface)" }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--tx-f)" }}>
                        {t.accountNo(index + 1)}
                      </p>
                      <StudioBadge tone="success">{t.readyBadge}</StudioBadge>
                    </div>
                    <code className="block whitespace-pre-wrap break-all text-[13px] leading-6" style={{ color: "var(--tx)" }}>
                      {item.content}
                    </code>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[16px] px-4 py-4 text-sm leading-6" style={{ border: "1px dashed var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }}>
                {t.emptyAvail}
              </div>
            )}
          </div>

          <div className="rounded-[18px] p-3" style={{ border: "1px solid var(--bd)", background: "var(--inp)" }}>
            <div className="flex items-center justify-between gap-3 pb-3" style={{ borderBottom: "1px solid var(--bd)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.panelDel}</p>
              <StudioBadge tone="neutral">{t.accountCount(inventory?.summary.deliveredCount ?? 0)}</StudioBadge>
            </div>

            {isLoading ? (
              <div className="px-1 py-4 text-sm" style={{ color: "var(--tx-m)" }}>{t.loadingDel}</div>
            ) : inventory?.deliveredItems.length ? (
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {inventory.deliveredItems.map((item) => (
                <div
                  key={item.key}
                  className="rounded-[16px] px-3 py-3"
                  style={{ border: "1px solid var(--bd)", background: "var(--surface)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StudioBadge tone="neutral">{t.deliveredBadge}</StudioBadge>
                        {item.orderCode ? (
                          <span className="text-[11px]" style={{ color: "var(--tx-f)" }}>{item.orderCode}</span>
                        ) : null}
                      </div>
                        <p className="mt-2 text-xs" style={{ color: "var(--tx-m)" }}>
                          {item.customerLabel || t.telegramCustomer} •{" "}
                          {item.deliveredAt ? formatDate(item.deliveredAt) : "-"}
                        </p>
                      </div>

                      <StudioButton
                        size="sm"
                        variant="danger"
                        disabled={isPurging}
                        onClick={() => onPurgeOne(item.key)}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t.deleteSingle}
                      </StudioButton>
                    </div>

                    <code className="mt-3 block whitespace-pre-wrap break-all text-[13px] leading-6" style={{ color: "var(--tx)" }}>
                      {item.content}
                    </code>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[16px] px-4 py-4 text-sm leading-6" style={{ border: "1px dashed var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }}>
                {t.emptyDel}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProductsPageStudio({
  openCreate,
  onCreateOpened,
}: {
  openCreate?: boolean;
  onCreateOpened?: () => void;
}) {
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { session } = useAuth();
  const isUltra = hasSellerCapability(session, "source_internal_manage");
  const productsQuery = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: async () => (await api.get("/products")).data,
  });

  const botConfigQuery = useQuery<{ usdtVndRateOverride: number | null; defaultUsdtVndRate: number }>({
    queryKey: ["bot-config"],
    queryFn: async () => (await api.get("/bot-config")).data,
  });
  const usdtVndRate = botConfigQuery.data?.usdtVndRateOverride ?? botConfigQuery.data?.defaultUsdtVndRate ?? 26000;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editorForm, setEditorForm] = useState<ProductEditorForm>(emptyEditorForm);
  const [createForm, setCreateForm] = useState<ManualProductForm>(emptyManualForm);
  const [addAccountsText, setAddAccountsText] = useState("");

  const products = productsQuery.data || [];

  const filteredProducts = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return products.filter((item) => {
      const matchesKeyword =
        !normalizedKeyword ||
        [item.displayName, item.sourceName, item.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedKeyword));

      const matchesFilter =
        filter === "all" ||
        (filter === "manual" && item.isManual) ||
        (filter === "active" && item.enabled && !item.hidden) ||
        (filter === "hidden" && item.hidden) ||
        (filter === "paused" && !item.enabled);

      return matchesKeyword && matchesFilter;
    });
  }, [filter, keyword, products]);

  useEffect(() => {
    if (filteredProducts.length === 0) {
      setSelectedId(null);
      return;
    }

    const stillExists = filteredProducts.some((item) => item.id === selectedId);
    const [firstProduct] = filteredProducts;
    if (!selectedId || !stillExists) {
      setSelectedId(firstProduct?.id ?? null);
    }
  }, [filteredProducts, selectedId]);

  const selectedProduct = products.find((item) => item.id === selectedId) || null;
  const editorUsesAutoStock =
    Boolean(selectedProduct?.isManual) && editorForm.deliveryText.trim().length > 0;
  const createUsesAutoStock = createForm.deliveryText.trim().length > 0;

  const inventoryQuery = useQuery<ProductInventory>({
    queryKey: ["products", selectedProduct?.id, "inventory"],
    enabled: Boolean(selectedProduct?.isManual),
    queryFn: async () =>
      (await api.get(`/products/${selectedProduct?.id}/inventory`)).data,
  });

  useEffect(() => {
    if (!selectedProduct) {
      setEditorForm(emptyEditorForm);
      return;
    }

    setEditorForm(createEditorForm(selectedProduct));
  }, [selectedProduct]);

  useEffect(() => {
    if (!drawerMode) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerMode(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawerMode]);

  useEffect(() => {
    if (!openCreate) return;
    setDrawerMode("create");
    onCreateOpened?.();
  }, [openCreate]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error(t.errNoProduct);
      const displayName = editorForm.displayName.trim();
      if (!displayName) throw new Error(t.errNoName);

      const payload: Record<string, unknown> = {
        displayName,
        salePrice: parseRequiredNumber(editorForm.salePrice, t.errRequired(t.efSalePrice), t.errInvalidNum(t.efSalePrice)),
        salePriceUsd: editorForm.salePriceUsd.trim()
          ? parseRequiredNumber(editorForm.salePriceUsd, t.errRequired(t.efUsd), t.errInvalidNum(t.efUsd))
          : 0,
        hidden: editorForm.hidden,
        hiddenVi: editorForm.hiddenVi,
        hiddenEn: editorForm.hiddenEn,
        enabled: editorForm.enabled,
        promoText: editorForm.promoText.trim(),
      };

      if (selectedProduct.isManual) {
        payload.sourceName = editorForm.sourceName.trim() || displayName;
        payload.sourceDescription = editorForm.sourceDescription.trim();
        payload.sourcePrice = parseRequiredNumber(editorForm.sourcePrice, t.errRequired(t.efIntCost), t.errInvalidNum(t.efIntCost));
        payload.deliveryText = editorForm.deliveryText.trim();

        if (!editorUsesAutoStock) {
          const available = parseOptionalInteger(editorForm.available, t.errInvalidInt(t.efStock));
          if (available !== undefined) payload.available = available;
        }

        if (isUltra) {
          payload.internalSourceEnabled = editorForm.internalSourceEnabled;
          payload.internalSourcePrice = editorForm.internalSourcePrice.trim()
            ? parseRequiredNumber(editorForm.internalSourcePrice, t.errRequired(t.efWholesale), t.errInvalidNum(t.efWholesale))
            : null;
        }
      }

      return api.put(`/products/${selectedProduct.id}`, payload);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["products", selectedProduct?.id, "inventory"] }),
      ]);
      showToast({ tone: "success", message: t.savedProduct });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getErrorMessage(error, t.errSaveFallback) });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const displayName = createForm.displayName.trim();
      if (!displayName) throw new Error(t.errNoManualName);

      const payload: Record<string, unknown> = {
        displayName,
        sourceName: createForm.sourceName.trim() || displayName,
        sourceDescription: createForm.sourceDescription.trim(),
        salePrice: parseRequiredNumber(createForm.salePrice, t.errRequired(t.efSalePrice), t.errInvalidNum(t.efSalePrice)),
        sourcePrice: parseRequiredNumber(createForm.sourcePrice, t.errRequired(t.efIntCost), t.errInvalidNum(t.efIntCost)),
        promoText: createForm.promoText.trim(),
        deliveryText: createForm.deliveryText.trim(),
        hidden: createForm.hidden,
        enabled: createForm.enabled,
      };

      if (!createUsesAutoStock) {
        const available = parseOptionalInteger(createForm.available, t.errInvalidInt(t.efStock));
        if (available !== undefined) payload.available = available;
      }

      if (isUltra) {
        payload.internalSourceEnabled = createForm.internalSourceEnabled;
        payload.internalSourcePrice = createForm.internalSourcePrice.trim()
          ? parseRequiredNumber(createForm.internalSourcePrice, t.errRequired(t.efWholesale), t.errInvalidNum(t.efWholesale))
          : null;
      }

      return api.post<Product>("/products/manual", payload);
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setCreateForm(emptyManualForm);
      setSelectedId(response.data.id);
      setDrawerMode("edit");
      showToast({ tone: "success", message: t.createdProduct(response.data.displayName) });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getErrorMessage(error, t.errCreateFallback) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (productId: string) => api.delete(`/products/${productId}`),
    onSuccess: async (_, productId) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      if (selectedId === productId) { setSelectedId(null); setDrawerMode(null); }
      showToast({ tone: "success", message: t.deletedProduct });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getErrorMessage(error, t.errDeleteFallback) });
    },
  });

  const toggleHiddenMutation = useMutation({
    mutationFn: async ({ id, hidden }: { id: string; hidden: boolean }) =>
      api.put(`/products/${id}`, { hidden }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getErrorMessage(error, t.errToggleFallback) });
    },
  });

  const purgeDeliveredMutation = useMutation({
    mutationFn: async (entryKeys?: string[]) =>
      (
        await api.post<ProductInventory>(
          `/products/${selectedProduct?.id}/inventory/purge-delivered`,
          entryKeys && entryKeys.length > 0 ? { entryKeys } : {},
        )
      ).data,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products", selectedProduct?.id, "inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
      showToast({ tone: "success", message: t.purgedMsg });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getErrorMessage(error, t.errPurgeFallback) });
    },
  });

  const addAccountsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct || !addAccountsText.trim()) return;
      const existing = (editorForm.deliveryText || "").trim();
      const combined = [existing, addAccountsText.trim()].filter(Boolean).join("\n");
      return api.put(`/products/${selectedProduct.id}`, { deliveryText: combined });
    },
    onSuccess: async () => {
      setAddAccountsText("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products", selectedProduct?.id, "inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
      showToast({ tone: "success", message: t.addStockSuccess });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getErrorMessage(error, t.addStockErr) });
    },
  });

  const activeCount = products.filter((item) => item.enabled && !item.hidden).length;
  const hiddenCount = products.filter((item) => item.hidden).length;
  const manualCount = products.filter((item) => item.isManual).length;
  const pausedCount = products.filter((item) => !item.enabled).length;
  const totalSales = products.reduce((sum, item) => sum + Number(item.soldCount || 0), 0);
  const sourceCount = Math.max(products.length - manualCount, 0);
  const visibleCount = filteredProducts.length;
  const manualInventory = inventoryQuery.data;

  const filters: { value: ProductFilter; label: string }[] = [
    { value: "all", label: t.fAll },
    { value: "manual", label: t.fManual },
    { value: "active", label: t.fActive },
    { value: "hidden", label: t.fHidden },
    { value: "paused", label: t.fPaused },
  ];

  const renderSelectedProductEditor = () => {
    if (!selectedProduct) {
      return null;
    }

    return (
      <div className="space-y-6 px-4 pb-4 pt-5 lg:px-5" style={{ borderTop: "1px solid var(--bd)" }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[22px] p-4" style={{ border: "1px solid var(--bd)", background: "var(--inp)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--tx-f)" }}>
              {t.statStock}
            </p>
            <p className="mt-3 text-2xl font-semibold" style={{ color: "var(--tx)" }}>
              {selectedProduct.available ?? "∞"}
            </p>
          </div>
          <div className="rounded-[22px] p-4" style={{ border: "1px solid var(--bd)", background: "var(--inp)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--tx-f)" }}>
              {t.statSold}
            </p>
            <p className="mt-3 text-2xl font-semibold" style={{ color: "var(--tx)" }}>{selectedProduct.soldCount}</p>
          </div>
          <div className="rounded-[22px] p-4" style={{ border: "1px solid var(--bd)", background: "var(--inp)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--tx-f)" }}>
              {t.statProfit}
            </p>
            <p className="mt-3 text-2xl font-semibold" style={{ color: "var(--tx)" }}>
              {formatCurrency(Number(editorForm.salePrice || 0) - Number(editorForm.sourcePrice || 0))}
            </p>
          </div>
        </div>

        <Field label={t.fDisplayName} hint={t.hBotName}>
          <StudioInput
            placeholder={t.phDisplayName}
            value={editorForm.displayName}
            onChange={(event) =>
              setEditorForm((current) => ({ ...current, displayName: event.target.value }))
            }
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.fSalePrice} hint={t.hVnd}>
            <StudioInput
              placeholder={t.phSalePrice}
              value={editorForm.salePrice}
              onChange={(event) =>
                setEditorForm((current) => ({ ...current, salePrice: event.target.value }))
              }
            />
          </Field>

          <Field
            label={t.fUsd}
            hint={t.hOptional}
            description={
              editorForm.salePriceUsd.trim()
                ? t.dUsdActive(editorForm.salePriceUsd)
                : t.dUsdEmpty
            }
          >
            <StudioInput
              placeholder={t.phUsd}
              value={editorForm.salePriceUsd}
              onChange={(e) => setEditorForm((c) => ({ ...c, salePriceUsd: e.target.value }))}
            />
          </Field>
        </div>

        {selectedProduct.isManual ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.fIntName} hint={t.hShopSource}>
                <StudioInput
                  placeholder={t.phIntName}
                  value={editorForm.sourceName}
                  onChange={(event) =>
                    setEditorForm((current) => ({
                      ...current,
                      sourceName: event.target.value,
                    }))
                  }
                />
              </Field>

              <Field
                label={t.fStock}
                hint={editorUsesAutoStock ? t.hAutoCalc : t.hOptional}
                description={editorUsesAutoStock ? t.dStockAuto : t.dStockManual}
              >
                <StudioInput
                  disabled={editorUsesAutoStock}
                  placeholder={editorUsesAutoStock ? t.phStockAuto : t.phStockManual}
                  value={editorForm.available}
                  onChange={(event) =>
                    setEditorForm((current) => ({
                      ...current,
                      available: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t.fIntCost}
                hint={t.hOptional}
                description={t.dIntCost}
              >
                <StudioInput
                  placeholder={t.phIntCost}
                  value={editorForm.sourcePrice}
                  onChange={(event) =>
                    setEditorForm((current) => ({
                      ...current,
                      sourcePrice: event.target.value,
                    }))
                  }
                />
              </Field>

              <Field
                label={t.fIntDesc}
                hint={t.hOptional}
                description={t.dIntDesc}
              >
                <StudioInput
                  placeholder={t.phIntDesc}
                  value={editorForm.sourceDescription}
                  onChange={(event) =>
                    setEditorForm((current) => ({
                      ...current,
                      sourceDescription: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <Field
              label={t.fDelivery}
              hint={t.hManualDelivery}
              description={t.dDelivery}
            >
              <DeliveryTextArea
                value={editorForm.deliveryText}
                onChange={(val) => setEditorForm((c) => ({ ...c, deliveryText: val }))}
              />
            </Field>
          </>
        ) : (
          <div className="rounded-[22px] p-4" style={{ border: "1px solid var(--bd)", background: "var(--inp)" }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[16px]" style={{ border: "1px solid var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }}>
                  <Wallet className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.syncedPriceLabel}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>{t.syncedNote}</p>
                </div>
              </div>
              <p className="text-2xl font-semibold" style={{ color: "var(--tx)" }}>
                {formatCurrency(selectedProduct.sourcePrice)}
              </p>
            </div>
          </div>
        )}

        <Field
          label={t.fPromo}
          hint={t.hOptional}
          description={t.dPromo}
        >
          <StudioTextArea
            placeholder={t.phPromo}
            value={editorForm.promoText}
            onChange={(event) =>
              setEditorForm((current) => ({ ...current, promoText: event.target.value }))
            }
          />
        </Field>

        {/* Language / market section */}
        <div className="rounded-[18px] p-4 space-y-4" style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.18)" }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl text-sm" style={{ background: "rgba(56,189,248,0.12)", color: "rgb(56,189,248)" }}>
              🌐
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: "rgb(56,189,248)" }}>{t.langTitle}</p>
              <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>{t.langDesc}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-[16px] border p-3.5 text-left transition"
              style={{
                borderColor: editorForm.hiddenVi ? "rgba(245,158,11,0.3)" : "var(--bd)",
                background: editorForm.hiddenVi ? "rgba(245,158,11,0.08)" : "var(--inp)",
              }}
              onClick={() => setEditorForm((c) => ({ ...c, hiddenVi: !c.hiddenVi }))}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.viCustomer}</p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>
                    {editorForm.hiddenVi ? t.hiddenViOn : t.hiddenViOff}
                  </p>
                </div>
                <StudioBadge tone={editorForm.hiddenVi ? "warning" : "success"}>
                  {editorForm.hiddenVi ? t.bHidden : t.bShown}
                </StudioBadge>
              </div>
            </button>

            <button
              type="button"
              className="rounded-[16px] border p-3.5 text-left transition"
              style={{
                borderColor: editorForm.hiddenEn ? "rgba(245,158,11,0.3)" : "var(--bd)",
                background: editorForm.hiddenEn ? "rgba(245,158,11,0.08)" : "var(--inp)",
              }}
              onClick={() => setEditorForm((c) => ({ ...c, hiddenEn: !c.hiddenEn }))}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.enCustomer}</p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>
                    {editorForm.hiddenEn ? t.hiddenEnOn : t.hiddenEnOff}
                  </p>
                </div>
                <StudioBadge tone={editorForm.hiddenEn ? "warning" : "success"}>
                  {editorForm.hiddenEn ? t.bHidden : t.bShown}
                </StudioBadge>
              </div>
            </button>
          </div>

        </div>

        {isUltra && selectedProduct.isManual && (
          <div className="rounded-[18px] p-4 space-y-4" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl" style={{ background: "rgba(139,92,246,0.15)", color: "rgb(167,139,250)" }}>
                <Crown className="h-3.5 w-3.5" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "rgb(167,139,250)" }}>{t.wholesaleTitle}</p>
                <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>{t.wholesaleDesc}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.fWholesale} hint={t.hOptional}>
                <StudioInput
                  placeholder={t.phWholesale}
                  value={editorForm.internalSourcePrice}
                  onChange={(e) => setEditorForm((c) => ({ ...c, internalSourcePrice: e.target.value }))}
                />
              </Field>

              <div className="flex flex-col justify-end">
                <button
                  type="button"
                  className="rounded-[18px] border p-3.5 text-left transition"
                  style={{
                    borderColor: editorForm.internalSourceEnabled ? "rgba(139,92,246,0.3)" : "var(--bd)",
                    background: editorForm.internalSourceEnabled ? "rgba(139,92,246,0.1)" : "var(--inp)",
                  }}
                  onClick={() => setEditorForm((c) => ({ ...c, internalSourceEnabled: !c.internalSourceEnabled }))}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.allowProBuy}</p>
                    <StudioBadge tone={editorForm.internalSourceEnabled ? "success" : "neutral"}>
                      {editorForm.internalSourceEnabled ? t.bOn : t.bOff}
                    </StudioBadge>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-[22px] border p-4 text-left transition"
            style={{
              borderColor: editorForm.enabled ? "rgba(52,211,153,0.18)" : "var(--bd)",
              background: editorForm.enabled ? "rgba(16,185,129,0.10)" : "var(--inp)",
            }}
            onClick={() => setEditorForm((current) => ({ ...current, enabled: !current.enabled }))}
            type="button"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.allowSale}</p>
                <p className="mt-1 text-sm leading-6" style={{ color: "var(--tx-m)" }}>{t.allowSaleDesc}</p>
              </div>
              <StudioBadge tone={editorForm.enabled ? "success" : "neutral"}>
                {editorForm.enabled ? t.bOn : t.bOff}
              </StudioBadge>
            </div>
          </button>

          <button
            className="rounded-[22px] border p-4 text-left transition"
            style={{
              borderColor: editorForm.hidden ? "rgba(52,211,153,0.18)" : "var(--bd)",
              background: editorForm.hidden ? "rgba(16,185,129,0.10)" : "var(--inp)",
            }}
            onClick={() => setEditorForm((current) => ({ ...current, hidden: !current.hidden }))}
            type="button"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.hideOnBot}</p>
                <p className="mt-1 text-sm leading-6" style={{ color: "var(--tx-m)" }}>{t.hideOnBotDesc}</p>
              </div>
              <StudioBadge tone={editorForm.hidden ? "warning" : "neutral"}>
                {editorForm.hidden ? t.bHidden : t.bShown}
              </StudioBadge>
            </div>
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <StudioButton
            className="min-h-[56px] flex-1"
            disabled={updateMutation.isPending || !selectedProduct}
            onClick={() => updateMutation.mutate()}
          >
            <Save className="h-4.5 w-4.5" />
            {updateMutation.isPending ? t.saving : t.saveProduct}
          </StudioButton>

        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <StudioCard className="overflow-hidden p-0">
        {/* Card header — title + stats + actions + search */}
        <div className="border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--bd)" }}>
          {/* Row 1: title + buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                {t.overview}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  <span className="font-black" style={{ color: "var(--tx)" }}>{products.length}</span> {t.totalLabel}
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  <span className="font-black text-amber-500">{manualCount}</span> {t.manualLabel}
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  <span className="font-black text-emerald-500">{activeCount}</span> {t.activeLabel}
                </span>
                <span className="text-xs" style={{ color: "var(--bd)" }}>·</span>
                <span className="text-xs font-semibold" style={{ color: "var(--tx-f)" }}>
                  <span className="font-black" style={{ color: "var(--tx)" }}>{totalSales}</span> {t.soldLabel}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StudioButton
                disabled={productsQuery.isFetching}
                variant="secondary"
                onClick={() => void productsQuery.refetch()}
              >
                <RefreshCw className="h-4 w-4" />
                {productsQuery.isFetching ? t.loading : t.refresh}
              </StudioButton>
            </div>
          </div>

          {/* Row 2: search + filters */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--tx-f)" }} />
              <StudioInput
                className="pl-10"
                placeholder={t.searchPh}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {filters.map((item) => (
                <StudioButton
                  key={item.value}
                  size="sm"
                  type="button"
                  variant={filter === item.value ? "primary" : "secondary"}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </StudioButton>
              ))}
              {(keyword || filter !== "all") && (
                <StudioButton size="sm" variant="ghost" onClick={() => { setKeyword(""); setFilter("all"); }}>
                  {t.clearFilter}
                </StudioButton>
              )}
            </div>
            <p className="text-xs shrink-0 sm:ml-auto" style={{ color: "var(--tx-f)" }}>
              {t.visibleOf(visibleCount, products.length)}
            </p>
          </div>
        </div>

          {/* Table body */}
          {productsQuery.isLoading ? (
            <div className="px-5 py-4 space-y-0">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-[72px] animate-pulse border-b last:border-0"
                  style={{ borderColor: "var(--bd)" }}
                />
              ))}
            </div>
          ) : productsQuery.isError ? (
            <div className="px-6 py-12 text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-[20px] mb-5" style={{ backgroundColor: "var(--inp)" }}>
                <Package className="h-7 w-7 text-rose-500" />
              </div>
              <p className="text-base font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                {t.loadError}
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>
                {getErrorMessage(productsQuery.error, t.loadErrorHint)}
              </p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-[20px] mb-5" style={{ backgroundColor: "var(--inp)" }}>
                <Package className="h-7 w-7 opacity-30" style={{ color: "var(--tx)" }} />
              </div>
              <p className="text-sm font-black uppercase tracking-[0.2em] opacity-40" style={{ color: "var(--tx)" }}>
                {t.emptyTitle}
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase opacity-20" style={{ color: "var(--tx)" }}>
                {t.emptyHint}
              </p>
            </div>
          ) : (
            <div>
              {/* Desktop table */}
              <div className="overflow-x-auto">
              <table className="hidden w-full text-sm lg:table" style={{ tableLayout: "fixed", minWidth: "920px" }}>
                <colgroup>
                  <col style={{ width: "32px" }} />
                  <col style={{ width: "260px" }} />
                  <col style={{ width: "136px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "72px" }} />
                  <col style={{ width: "60px" }} />
                  <col style={{ width: "180px" }} />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--bd)", backgroundColor: "var(--inp)" }}>
                    <th className="py-2.5 pl-5 pr-2 text-left text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>#</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colName}</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colSalePrice}</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colSourcePrice}</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colUnsold}</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colSold}</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colTotal}</th>
                    <th className="py-2.5 pl-3 pr-5 text-right text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product, index) => {
                    const isSelected = product.id === selectedId;
                    return (
                      <tr
                        key={product.id}
                        className="group border-b last:border-0 transition-colors duration-150"
                        style={{ borderColor: "var(--bd)", backgroundColor: isSelected ? "rgba(249,115,22,0.04)" : undefined }}
                      >
                        <td className="py-3 pl-5 pr-2 text-xs font-bold tabular-nums" style={{ color: "var(--tx-f)" }}>{index + 1}</td>

                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-200"
                              style={{
                                backgroundColor: isSelected ? "rgba(249,115,22,0.12)" : "var(--inp)",
                                border: `1px solid ${isSelected ? "rgba(249,115,22,0.3)" : "var(--bd)"}`,
                                color: isSelected ? "rgb(249,115,22)" : "var(--tx-f)",
                              }}
                            >
                              <Package className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                                {product.displayName}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <StudioBadge tone={product.isManual ? "warning" : "neutral"}>
                                  {product.isManual ? t.bManual : t.bSource}
                                </StudioBadge>
                                {!product.enabled && <StudioBadge tone="neutral">{t.bOff}</StudioBadge>}
                                {product.hidden && <StudioBadge tone="warning">{t.bHidden}</StudioBadge>}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3 text-right">
                          {lang === "th" ? (
                            <>
                              <p className="text-sm font-black tabular-nums text-emerald-500">${toUsdt(product.salePrice, usdtVndRate)}</p>
                              <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: "var(--tx-f)" }}>{formatCurrency(product.salePrice)}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-black tabular-nums text-emerald-500">{formatCurrency(product.salePrice)}</p>
                              <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: "var(--tx-f)" }}>${toUsdt(product.salePrice, usdtVndRate)}</p>
                            </>
                          )}
                        </td>

                        <td className="px-3 py-3 text-right text-sm tabular-nums" style={{ color: "var(--tx-f)" }}>
                          {lang === "th"
                            ? (product.sourcePrice ? `$${toUsdt(product.sourcePrice, usdtVndRate)}` : "—")
                            : (product.sourcePrice ? formatCurrency(product.sourcePrice) : "—")}
                        </td>

                        <td className="px-3 py-3 text-right">
                          <span className={`text-sm font-black tabular-nums ${product.available === 0 ? "text-rose-500" : "text-orange-400"}`}>
                            {product.available ?? "∞"}
                          </span>
                        </td>

                        <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: "var(--tx-m)" }}>
                          {product.soldCount}
                        </td>

                        <td className="px-3 py-3 text-right text-sm tabular-nums" style={{ color: "var(--tx-f)" }}>
                          {product.available !== null
                            ? (product.available ?? 0) + product.soldCount
                            : product.totalCount}
                        </td>

                        <td className="py-3 pl-3 pr-5">
                          <div className="flex items-center justify-end gap-0.5">
                            <ActionBtn title={t.aView} color="indigo" onClick={() => { setSelectedId(product.id); setDrawerMode("view"); }}>
                              <Eye className="h-4 w-4" />
                            </ActionBtn>
                            <ActionBtn title={t.aEdit} color="orange" onClick={() => { setSelectedId(product.id); setDrawerMode("edit"); }}>
                              <Pencil className="h-4 w-4" />
                            </ActionBtn>
                            {product.isManual && (
                              <ActionBtn title={t.aStock} color="green" onClick={() => { setSelectedId(product.id); setDrawerMode("inventory"); }}>
                                <PackagePlus className="h-4 w-4" />
                              </ActionBtn>
                            )}
                            <ActionBtn title={t.aPromo} color="pink" onClick={() => { setSelectedId(product.id); setDrawerMode("promo"); }}>
                              <Tag className="h-4 w-4" />
                            </ActionBtn>
                            <ActionBtn
                              title={product.hidden ? t.aShow : t.aHide}
                              color={product.hidden ? "violet" : "default"}
                              onClick={() => toggleHiddenMutation.mutate({ id: product.id, hidden: !product.hidden })}
                            >
                              {product.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                            </ActionBtn>
                            {product.isManual && (
                              <ActionBtn
                                title={t.aDelete}
                                color="red"
                                onClick={() => {
                                  if (window.confirm(t.confirmDel(product.displayName))) deleteMutation.mutate(product.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </ActionBtn>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              {/* Mobile list */}
              <div className="lg:hidden">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-start justify-between gap-3 border-b px-4 py-3 last:border-0"
                    style={{ borderColor: "var(--bd)" }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                        {product.displayName}
                      </p>
                      <p className="mt-0.5 text-xs font-black text-orange-400">{formatCurrency(product.salePrice)}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <StudioBadge tone={product.isManual ? "warning" : "neutral"}>
                          {product.isManual ? t.bManual : t.bSource}
                        </StudioBadge>
                        {!product.enabled && <StudioBadge tone="neutral">{t.bOff}</StudioBadge>}
                        {product.hidden && <StudioBadge tone="warning">{t.bHidden}</StudioBadge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase transition-opacity hover:opacity-80"
                        style={{ backgroundColor: "rgba(249,115,22,0.15)", color: "rgb(234,88,12)" }}
                        onClick={() => { setSelectedId(product.id); setDrawerMode("edit"); }}
                      >{t.aEdit}</button>
                      {product.isManual && (
                        <button
                          type="button"
                          className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase transition-opacity hover:opacity-80"
                          style={{ backgroundColor: "rgba(244,63,94,0.15)", color: "rgb(225,29,72)" }}
                          onClick={() => {
                            if (window.confirm(t.confirmDelShort(product.displayName))) deleteMutation.mutate(product.id);
                          }}
                        >{t.aDelete}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
      </StudioCard>

      {createPortal(
      <div
        className={`fixed inset-0 z-[200] flex items-center justify-center p-4 transition-all duration-300 ${drawerMode ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{ backgroundColor: drawerMode ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0)" }}
        onClick={() => setDrawerMode(null)}
      >
        <div
          className="relative flex w-full max-w-[680px] flex-col rounded-2xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--bd)",
            maxHeight: "90vh",
            transform: drawerMode ? "scale(1) translateY(0)" : "scale(0.96) translateY(16px)",
            opacity: drawerMode ? 1 : 0,
            transition: "transform 250ms cubic-bezier(0.4,0,0.2,1), opacity 250ms cubic-bezier(0.4,0,0.2,1)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
        {/* Modal header */}
        <div className="flex shrink-0 items-center justify-between gap-4 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.25)" }}
            >
              {drawerMode === "create" ? <PackagePlus className="h-4 w-4 text-orange-400" />
                : drawerMode === "inventory" ? <Boxes className="h-4 w-4 text-orange-400" />
                : drawerMode === "promo" ? <Tag className="h-4 w-4 text-orange-400" />
                : <Package className="h-4 w-4 text-orange-400" />}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
                {drawerMode === "create" ? t.mCreate
                  : drawerMode === "inventory" ? t.mInventory
                  : drawerMode === "promo" ? t.mPromo
                  : drawerMode === "view" ? t.mView
                  : t.mEdit}
              </p>
              <p className="mt-0.5 truncate text-sm font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                {drawerMode === "create" ? t.mCreateTitle : selectedProduct?.displayName ?? "—"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all hover:bg-rose-500/10 hover:text-rose-500"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
            onClick={() => setDrawerMode(null)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Drawer body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {drawerMode === "view" && selectedProduct && (
            <div className="px-5 py-5 space-y-5">
              {/* Product hero */}
              <div className="flex items-center gap-4 rounded-2xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl" style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.25)" }}>
                  <Package className="h-6 w-6 text-orange-400" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-black uppercase tracking-tight" style={{ color: "var(--tx)" }}>
                    {selectedProduct.displayName}
                  </p>
                  {selectedProduct.sourceName !== selectedProduct.displayName && (
                    <p className="mt-0.5 truncate text-xs" style={{ color: "var(--tx-f)" }}>{selectedProduct.sourceName}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StudioBadge tone={selectedProduct.isManual ? "warning" : "neutral"}>
                      {selectedProduct.isManual ? t.bManualLong : t.bSynced}
                    </StudioBadge>
                    <StudioBadge tone={selectedProduct.enabled ? "success" : "neutral"}>
                      {selectedProduct.enabled ? t.bActive : t.bPaused}
                    </StudioBadge>
                    {selectedProduct.hidden && <StudioBadge tone="warning">{t.bHiddenLong}</StudioBadge>}
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-[14px] p-3.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.statSalePrice}</p>
                  <p className="mt-2 text-base font-black tabular-nums text-emerald-500">{formatCurrency(selectedProduct.salePrice)}</p>
                </div>
                <div className="rounded-[14px] p-3.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.statStock}</p>
                  <p className={`mt-2 text-base font-black tabular-nums ${selectedProduct.available === 0 ? "text-rose-500" : "text-orange-400"}`}>
                    {selectedProduct.available ?? "∞"}
                  </p>
                </div>
                <div className="rounded-[14px] p-3.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.statSold}</p>
                  <p className="mt-2 text-base font-black tabular-nums" style={{ color: "var(--tx)" }}>{selectedProduct.soldCount}</p>
                </div>
              </div>

              {/* Secondary info */}
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--bd)" }}>
                {[
                  { label: t.statSourcePrice, value: selectedProduct.isManual ? t.selfManaged : formatCurrency(selectedProduct.sourcePrice) },
                  { label: t.statProfit, value: formatCurrency(selectedProduct.salePrice - selectedProduct.sourcePrice) },
                  { label: t.statImported, value: String(selectedProduct.totalCount) },
                ].map(({ label, value }, i) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                    style={{ borderTop: i > 0 ? "1px solid var(--bd)" : undefined, background: "var(--inp)" }}
                  >
                    <p className="text-[11px] font-black uppercase tracking-widest shrink-0" style={{ color: "var(--tx-f)" }}>{label}</p>
                    <p className="text-sm font-bold text-right" style={{ color: "var(--tx)" }}>{value}</p>
                  </div>
                ))}
              </div>

              {selectedProduct.promoText && (
                <div className="rounded-2xl p-4" style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2 text-orange-400">{t.promoSection}</p>
                  <p className="text-sm leading-6" style={{ color: "var(--tx-m)" }}>{selectedProduct.promoText}</p>
                </div>
              )}

              <div className="flex gap-2.5">
                <StudioButton className="flex-1" onClick={() => setDrawerMode("edit")}>
                  <Pencil className="h-4 w-4" /> {t.editProductBtn}
                </StudioButton>
                {selectedProduct.isManual && (
                  <StudioButton variant="secondary" onClick={() => setDrawerMode("inventory")}>
                    <PackagePlus className="h-4 w-4" /> {t.stockShortBtn}
                  </StudioButton>
                )}
              </div>
            </div>
          )}

          {drawerMode === "edit" && renderSelectedProductEditor()}

          {drawerMode === "inventory" && (
            <div className="space-y-5 px-5 py-5">
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--tx-f)" }}>
                  {t.addStockTitle}
                </p>
                <StudioTextArea
                  placeholder={t.addStockPh}
                  value={addAccountsText}
                  onChange={(e) => setAddAccountsText(e.target.value)}
                />
                <StudioButton
                  className="w-full"
                  disabled={addAccountsMutation.isPending || !addAccountsText.trim()}
                  onClick={() => addAccountsMutation.mutate()}
                >
                  <PackagePlus className="h-4 w-4" />
                  {addAccountsMutation.isPending ? t.addStockSaving : t.addStockBtn}
                </StudioButton>
              </div>

              <div style={{ borderTop: "1px solid var(--bd)" }} />

              <ManualInventoryPanel
                inventory={manualInventory}
                isLoading={inventoryQuery.isLoading}
                isPurging={purgeDeliveredMutation.isPending}
                onPurgeAll={() => { if (window.confirm(t.confirmPurge)) purgeDeliveredMutation.mutate(undefined); }}
                onPurgeOne={(entryKey) => purgeDeliveredMutation.mutate([entryKey])}
              />
            </div>
          )}

          {drawerMode === "promo" && selectedProduct && (
            <div className="space-y-5 px-5 py-5">
              <Field
                label={t.fPromo}
                hint={t.hBotDisplay}
                description={t.dPromoDrawer}
              >
                <StudioTextArea
                  placeholder={t.phPromo}
                  value={editorForm.promoText}
                  onChange={(e) => setEditorForm((cur) => ({ ...cur, promoText: e.target.value }))}
                />
              </Field>
              <StudioButton
                className="min-h-[52px] w-full"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate()}
              >
                <Save className="h-4.5 w-4.5" />
                {updateMutation.isPending ? t.saving : t.savePromo}
              </StudioButton>
            </div>
          )}

          {drawerMode === "create" && (
            <div className="space-y-6 px-5 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--tx-f)" }}>
                  {t.createEyebrow}
                </p>
                <h2 className="mt-3 text-2xl font-semibold" style={{ color: "var(--tx)" }}>{t.createHeading}</h2>
                <p className="mt-2 text-sm leading-7" style={{ color: "var(--tx-m)" }}>{t.createSubhead}</p>
              </div>

              <Field label={t.fDisplayName} hint={t.hRequired}>
                <StudioInput
                  placeholder={t.phCreateName}
                  value={createForm.displayName}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.fSalePrice} hint={t.hVnd}>
                  <StudioInput
                    placeholder={t.phSalePrice}
                    value={createForm.salePrice}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, salePrice: event.target.value }))
                    }
                  />
                </Field>

                <Field
                  label={t.fIntCost}
                  hint={t.hOptional}
                  description={t.dIntCost}
                >
                  <StudioInput
                    placeholder={t.phIntCost}
                    value={createForm.sourcePrice}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, sourcePrice: event.target.value }))
                    }
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t.fIntName}
                  hint={t.hOptional}
                  description={t.dCreateIntName}
                >
                  <StudioInput
                    placeholder={t.phCreateIntName}
                    value={createForm.sourceName}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, sourceName: event.target.value }))
                    }
                  />
                </Field>

                <Field
                  label={t.fStock}
                  hint={createUsesAutoStock ? t.hAutoCalc : t.hOptional}
                  description={createUsesAutoStock ? t.dCreateStockAuto : t.dCreateStockManual}
                >
                  <StudioInput
                    disabled={createUsesAutoStock}
                    placeholder={createUsesAutoStock ? t.phCreateStockAuto : t.phCreateStock}
                    value={createForm.available}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, available: event.target.value }))
                    }
                  />
                </Field>
              </div>

              <Field
                label={t.fIntDesc}
                hint={t.hOptional}
                description={t.dCreateIntDesc}
              >
                <StudioInput
                  placeholder={t.phCreateIntDesc}
                  value={createForm.sourceDescription}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      sourceDescription: event.target.value,
                    }))
                  }
                />
              </Field>

              <Field
                label={t.fPromo}
                hint={t.hOptional}
                description={t.dCreatePromo}
              >
                <StudioTextArea
                  placeholder={t.phCreatePromo}
                  value={createForm.promoText}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, promoText: event.target.value }))
                  }
                />
              </Field>

                <Field
                  label={t.fDelivery}
                  hint={t.hManualDelivery}
                  description={t.dDelivery}
                >
                  <DeliveryTextArea
                    value={createForm.deliveryText}
                    onChange={(val) => setCreateForm((c) => ({ ...c, deliveryText: val }))}
                  />
                </Field>

              {isUltra && (
                <div className="rounded-[18px] p-4 space-y-4" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}>
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl" style={{ background: "rgba(139,92,246,0.15)", color: "rgb(167,139,250)" }}>
                      <Crown className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold" style={{ color: "rgb(167,139,250)" }}>{t.wholesaleTitle}</p>
                      <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>{t.wholesaleDesc}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t.fWholesale} hint={t.hRequiredIfOn}>
                      <StudioInput
                        placeholder={t.phWholesale}
                        value={createForm.internalSourcePrice}
                        onChange={(e) => setCreateForm((c) => ({ ...c, internalSourcePrice: e.target.value }))}
                      />
                    </Field>

                    <div className="flex flex-col justify-end">
                      <button
                        type="button"
                        className="rounded-[18px] border p-3.5 text-left transition"
                        style={{
                          borderColor: createForm.internalSourceEnabled ? "rgba(139,92,246,0.3)" : "var(--bd)",
                          background: createForm.internalSourceEnabled ? "rgba(139,92,246,0.1)" : "var(--inp)",
                        }}
                        onClick={() => setCreateForm((c) => ({ ...c, internalSourceEnabled: !c.internalSourceEnabled }))}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.allowProBuy}</p>
                          <StudioBadge tone={createForm.internalSourceEnabled ? "success" : "neutral"}>
                            {createForm.internalSourceEnabled ? t.bOn : t.bOff}
                          </StudioBadge>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  className="rounded-[22px] border p-4 text-left transition"
                  style={{
                    borderColor: createForm.enabled ? "rgba(52,211,153,0.18)" : "var(--bd)",
                    background: createForm.enabled ? "rgba(16,185,129,0.10)" : "var(--inp)",
                  }}
                  onClick={() =>
                    setCreateForm((current) => ({ ...current, enabled: !current.enabled }))
                  }
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.allowSale}</p>
                      <p className="mt-1 text-sm leading-6" style={{ color: "var(--tx-m)" }}>{t.allowSaleCreateDesc}</p>
                    </div>
                    <StudioBadge tone={createForm.enabled ? "success" : "neutral"}>
                      {createForm.enabled ? t.bOn : t.bOff}
                    </StudioBadge>
                  </div>
                </button>

                <button
                  className="rounded-[22px] border p-4 text-left transition"
                  style={{
                    borderColor: createForm.hidden ? "rgba(52,211,153,0.18)" : "var(--bd)",
                    background: createForm.hidden ? "rgba(16,185,129,0.10)" : "var(--inp)",
                  }}
                  onClick={() =>
                    setCreateForm((current) => ({ ...current, hidden: !current.hidden }))
                  }
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{t.hideOnBot}</p>
                      <p className="mt-1 text-sm leading-6" style={{ color: "var(--tx-m)" }}>{t.hideOnBotCreateDesc}</p>
                    </div>
                    <StudioBadge tone={createForm.hidden ? "warning" : "neutral"}>
                      {createForm.hidden ? t.bHidden : t.bShown}
                    </StudioBadge>
                  </div>
                </button>
              </div>

              <Notice tone="warning">{t.createNotice}</Notice>

              <StudioButton
                className="min-h-[56px] w-full"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                <PackagePlus className="h-4.5 w-4.5" />
                {createMutation.isPending ? t.creating : t.createBtn}
              </StudioButton>
            </div>
          )}
        </div>
        </div>
      </div>
      , document.body)}
    </div>
  );
}
