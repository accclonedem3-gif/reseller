import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Archive,
  ArchiveRestore,
  Ban,
  Boxes,
  Check,
  ChevronDown,
  Copy,
  Crown,
  Eye,
  EyeOff,
  FileUp,
  FolderOpen,
  GripVertical,
  History,
  MoreHorizontal,
  Package,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Tag,
  TrendingUp,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";

import { useAuth } from "@/auth/auth-provider";
import {
  CreateBatchModal,
  ExtractStockModal,
  ExtractStockResultModal,
  StockHistoryModal,
  UploadStockModal,
  UploadStockResultModal,
  ViewStockModal,
  type CreateBatchPayload,
  type EntryListPage,
  type ExtractPayload,
  type StockBatchSummary,
  type StockExtractMethod,
  type StockOperation,
  type ViewStockData,
} from "@/components/dashboard/stock-modals";
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
import { useProductFamilyOptions } from "@/hooks/use-product-families";
import {
  sourceProductFamilyOptions,
  sourceProductPackageOptions,
  sourceAccountTypeOptions,
  sourceDurationTypeOptions,
  sourceWarrantyPolicyOptions,
  sourceDeliveryModeOptions,
  buildAutoProductName,
} from "@/lib/source-product-options";

const T = {
  vi: {
    overview: "Tổng quan sản phẩm",
    totalLabel: "tổng",
    manualLabel: "sản phẩm riêng",
    activeLabel: "đang bán",
    soldLabel: "đã bán",
    loading: "Đang tải...",
    refresh: "Làm mới",
    searchPh: "Tìm tên sản phẩm...",
    clearFilter: "Xóa lọc",
    visibleOf: (n: number, tot: number) => `${n}/${tot} sản phẩm`,
    fAll: "Tất cả",
    fManual: "Sản phẩm riêng",
    fActive: "Đang bán",
    fHidden: "Ẩn trên bot",
    fPaused: "Tạm dừng",
    colName: "Tên sản phẩm",
    colSalePrice: "Giá bán",
    colSourcePrice: "Giá vốn",
    colCtvPrice: "Giá CTV",
    colUnsold: "Tồn kho",
    colSold: "Đã bán",
    colTotal: "Tổng",
    colActions: "Hành động",
    loadError: "Không tải được danh sách sản phẩm",
    loadErrorHint: "Hãy thử tải lại catalog sau ít phút nữa.",
    emptyTitle: "Chưa có sản phẩm phù hợp",
    emptyHint: "Đổi bộ lọc hoặc tạo sản phẩm riêng",
    bManual: "Riêng",
    bSource: "Nguồn",
    bOff: "Tắt",
    bHidden: "Ẩn",
    bShown: "Hiện",
    bOn: "Bật",
    aView: "Xem",
    aEdit: "Sửa",
    aStock: "Thêm TK",
    aPromo: "Khuyến mãi",
    aShow: "Hiện",
    aHide: "Ẩn",
    aDelete: "Xóa",
    aDuplicate: "Nhân bản",
    confirmDel: (name: string) => `Xóa sản phẩm riêng "${name}" khỏi shop?`,
    confirmDelShort: (name: string) => `Xóa "${name}"?`,
    confirmPurge: "Xóa nhanh toàn bộ account đã giao?",
    mCreate: "Thêm mới",
    mInventory: "Kho account",
    mPromo: "Khuyến mãi",
    mView: "Chi tiết sản phẩm",
    mEdit: "Chỉnh sản phẩm",
    mCreateTitle: "Tạo sản phẩm riêng",
    bManualLong: "Sản phẩm riêng",
    bSynced: "Đồng bộ nguồn",
    bActive: "Đang bán",
    bPaused: "Tạm dừng",
    bHiddenLong: "Đang ẩn",
    statStock: "Tồn kho",
    statSold: "Đã bán",
    statSalePrice: "Giá bán",
    statSourcePrice: "Giá nguồn",
    statProfit: "Lợi nhuận ước tính",
    statImported: "Tổng đã nhập",
    selfManaged: "CTV quản lý",
    promoSection: "Khuyến mãi",
    editProductBtn: "Chỉnh sản phẩm",
    stockShortBtn: "Kho TK",
    fDisplayName: "Tên hiển thị",
    hBotName: "Tên trên bot",
    phDisplayName: "Tên công khai hiển thị cho khách",
    fSalePrice: "Giá bán",
    hVnd: "VND",
    phSalePrice: "Giá bán cho khách",
    fIntName: "Tên nội bộ",
    hShopSource: "Nguồn shop",
    phIntName: "Tên dùng để quản trị nội bộ",
    fStock: "Tồn kho",
    hAutoCalc: "Tự tính",
    hOptional: "Tùy chọn",
    phStockAuto: "Kho tự tính theo account",
    phStockManual: "Ví dụ: 15",
    dStockAuto:
      "Đang tự tính theo danh sách account ở phần nội dung giao tự động. Muốn tăng hoặc giảm kho, hãy thêm hoặc bớt account bên dưới.",
    dStockManual:
      "Để trống nếu đây là gói không giới hạn. Nhập 0 nếu muốn báo hết hàng.",
    fIntCost: "Chi phí nội bộ",
    phIntCost: "Mặc định có thể để 0",
    dIntCost: "Dùng để theo dõi lợi nhuận trong shop. Có thể để 0.",
    fIntDesc: "Mô tả nội bộ",
    phIntDesc: "Ví dụ: combo giao bằng text",
    dIntDesc: "Dùng để phân biệt các gói riêng hoặc lưu ghi chú ngắn.",
    fDelivery: "Nội dung giao tự động",
    hManualDelivery: "Manual delivery",
    dDelivery:
      "Mỗi dòng là một tài khoản. Ví dụ: email | mật khẩu. Nếu có sẵn dữ liệu cũ dạng JSON thì hệ thống vẫn đọc được.",
    fDeliveryFormat: "Format giao tài khoản",
    dDeliveryFormat:
      "Ghi chú format để khách hiểu dữ liệu. Ví dụ: email | mật khẩu email | mật khẩu grok",
    phDeliveryFormat: "Ví dụ: email | mật khẩu email | mật khẩu grok",
    fPromo: "Thông điệp khuyến mại",
    hBotDisplay: "Hiển thị trên bot",
    phPromo: "Ví dụ: Bảo hành nhanh, hỗ trợ cài đặt hoặc quà tặng kèm.",
    dPromo:
      "Thêm ghi chú ngắn về bảo hành, ưu đãi hoặc lời nhấn giúp tăng chuyển đổi.",
    dPromoDrawer:
      "Ghi chú ngắn về ưu đãi, bảo hành hoặc quà tặng kèm. Hiển thị ngay dưới tên sản phẩm khi khách xem.",
    langTitle: "Hiển thị theo ngôn ngữ",
    langDesc: "Kiểm soát sản phẩm nào hiện với khách Việt và khách quốc tế",
    viCustomer: "🇻🇳 Khách Việt",
    enCustomer: "🌍 Khách quốc tế",
    hiddenViOn: "Ẩn với người dùng tiếng Việt",
    hiddenViOff: "Hiển thị bình thường",
    hiddenEnOn: "Ẩn với người dùng tiếng Anh",
    hiddenEnOff: "Hiển thị bình thường",
    fUsd: "Giá USD (khách quốc tế)",
    phUsd: "Ví dụ: 3.99",
    dUsdActive: (p: string) => `Bot EN sẽ hiển thị $${p}`,
    dUsdEmpty: "Để trống → tự quy đổi từ giá VND theo tỉ giá cấu hình",
    wholesaleTitle: "Giá sỉ cho reseller PRO",
    wholesaleDesc: "Seller PRO kết nối với bạn sẽ nhập hàng theo giá này",
    fWholesale: "Giá sỉ (PRO)",
    phWholesale: "Giá bán cho seller PRO",
    allowProBuy: "Cho PRO mua",
    allowSale: "Cho phép bán",
    allowSaleDesc: "Bật hoặc tắt khả năng mua sản phẩm này trên bot.",
    allowSaleCreateDesc: "Tạo sản phẩm ở trạng thái mở bán ngay sau khi lưu.",
    hideOnBot: "Ẩn trên bot",
    hideOnBotDesc: "Giữ trong catalog nhưng tạm thời gỡ khỏi menu công khai.",
    hideOnBotCreateDesc:
      "Tạo sẵn trong catalog nhưng chưa hiển thị công khai cho khách.",
    fDesc: "Mô tả sản phẩm",
    phDesc: "Nhập mô tả hiển thị cho khách khi bấm chọn sản phẩm...",
    dDesc: "Hiển thị trong card sản phẩm khi khách bấm mua. Hỗ trợ nhiều dòng.",
    syncedPriceLabel: "Giá nguồn hiện tại",
    syncedNote:
      "Sản phẩm đồng bộ chỉ cho phép đổi tên hiển thị, giá bán, mô tả và trạng thái.",
    saving: "Đang lưu...",
    saveProduct: "Lưu cấu hình sản phẩm",
    savePromo: "Lưu khuyến mãi",
    resetSource: "Khôi phục mặc định",
    resetting: "Đang khôi phục...",
    createEyebrow: "Tự tạo catalog riêng",
    createHeading: "Tạo sản phẩm của shop",
    createSubhead:
      "Chỉ hiện phần cần thiết để bạn lên nhanh một gói riêng, combo nội bộ hoặc sản phẩm không nằm trong catalog nguồn.",
    hRequired: "Bắt buộc",
    hRequiredIfOn: "Bắt buộc nếu bật",
    phCreateName: "Ví dụ: Combo Canva + ChatGPT 30 ngày",
    phCreateStock: "Ví dụ: 10",
    phCreateStockAuto: "Kho tự tính theo account",
    phCreateIntName: "Tên riêng để quản trị nội bộ",
    phCreateIntDesc: "Ví dụ: giao bằng text, xử lý thủ công",
    phCreatePromo: "Ví dụ: hỗ trợ đổi lỗi nhanh trong 24h.",
    dCreateStockAuto:
      "Đang tự tính theo danh sách account ở phần nội dung giao tự động. Nếu muốn nhập kho tay thì để trống phần auto-giao.",
    dCreateStockManual:
      "Để trống nếu không muốn giới hạn. Nhập 0 nếu muốn tạo sẵn nhưng chưa bán.",
    dCreateIntName: "Nếu bỏ trống, hệ thống sẽ dùng luôn tên hiển thị.",
    dCreateIntDesc:
      "Có thể dùng để ghi loại tài khoản, nguồn giao hoặc quy cách gói.",
    dCreatePromo: "Xuất hiện cùng sản phẩm để tăng tỷ lệ chốt đơn.",
    createNotice:
      "Nếu điền nội dung giao tự động, hệ thống sẽ coi mỗi dòng là một account và tự trừ dần sau mỗi đơn. Nếu để trống, đơn manual sẽ chuyển sang chờ seller xử lý thủ công.",
    creating: "Đang tạo sản phẩm...",
    createBtn: "Tạo sản phẩm riêng",
    errNoProduct: "Hãy chọn một sản phẩm trước khi lưu.",
    errNoName: "Tên hiển thị không được để trống.",
    errNoManualName: "Tên sản phẩm riêng không được để trống.",
    savedProduct: "Đã lưu cấu hình sản phẩm.",
    errSaveFallback: "Không thể lưu thay đổi cho sản phẩm này.",
    createdProduct: (name: string) =>
      `Đã tạo sản phẩm riêng "${name}". Chỉnh tiếp trong panel bên phải.`,
    errCreateFallback: "Không thể tạo sản phẩm riêng lúc này.",
    deletedProduct: "Đã xóa sản phẩm riêng khỏi shop.",
    errDeleteFallback:
      "Không thể xóa sản phẩm này. Nếu đã có đơn phát sinh, hãy ẩn hoặc tắt bán thay vì xóa.",
    errToggleFallback: "Không thể cập nhật trạng thái hiển thị.",
    purgedMsg: "Đã dọn dữ liệu tài khoản đã giao khỏi màn quản lý sản phẩm.",
    errPurgeFallback: "Không thể dọn dữ liệu tài khoản đã giao.",
    errRequired: (f: string) => `${f} không được để trống.`,
    errInvalidNum: (f: string) => `${f} phải là số từ 0 trở lên.`,
    errInvalidInt: (f: string) => `${f} phải là số nguyên từ 0 trở lên.`,
    efSalePrice: "Giá bán",
    efUsd: "Giá USD",
    efIntCost: "Chi phí nội bộ",
    efStock: "Tồn kho",
    efWholesale: "Giá sỉ",
    fieldNote: (label: string) => `Xem ghi chú cho ${label}`,
    invTitle: "Kho account của sản phẩm",
    invSubtitle: "Theo dõi account còn sẵn và account đã giao ngay tại đây.",
    invAvail: (n: number) => `Còn sẵn ${n}`,
    invDel: (n: number) => `Đã giao ${n}`,
    invPurged: (n: number) => `Đã dọn ${n}`,
    purgeBtnAll: "Xóa nhanh đã giao",
    panelAvail: "Account còn sẵn",
    panelDel: "Account đã giao",
    accountCount: (n: number) => `${n} account`,
    loadingAvail: "Đang tải kho account...",
    loadingDel: "Đang tải lịch sử đã giao...",
    accountNo: (n: number) => `Account #${n}`,
    readyBadge: "Sẵn sàng",
    deliveredBadge: "Đã giao",
    telegramCustomer: "Khách Telegram",
    deleteSingle: "Xóa",
    emptyAvail: "Chưa còn account sẵn trong kho tự động.",
    emptyDel:
      "Chưa có account nào được giao hoặc bạn đã dọn hết khỏi màn quản lý.",
    deliveryPh:
      "Ví dụ:\nbtceuhocdt@nyawit.id | Premium@123\nabc@gmail.com | Pass456\nxyz@mail.com | Pass789",
    addStockTitle: "Thêm account vào kho",
    addStockPh: "Dán account vào đây, mỗi dòng 1 account...",
    addStockBtn: "Thêm vào kho",
    addStockSaving: "Đang thêm...",
    addStockSuccess: "Đã thêm account vào kho.",
    addStockErr: "Không thể thêm account.",
    fImageUrl: "Ảnh sản phẩm (URL)",
    phImageUrl: "https://... dán link ảnh vào đây",
    dImageUrl:
      "Khi có ảnh, bot sẽ hiển thị ảnh kèm thông tin sản phẩm khi khách chọn mua.",
    fProductIcon: "Icon sản phẩm",
    phProductIcon: "Dán emoji vào đây, ví dụ: 🤖",
    dProductIcon:
      "Emoji hiện trước tên sản phẩm trong danh sách bot. Copy custom emoji từ Telegram rồi dán vào.",
    fUsageInstructions: "Hướng dẫn sử dụng",
    phUsageInstructions:
      "Ví dụ: Vào Settings → Account → đổi mật khẩu ngay sau khi đăng nhập.",
    dUsageInstructions:
      "Hiện ngay dưới nội dung tài khoản trong tin nhắn giao hàng. Để trống thì không hiện gì.",
    fGroup: "Thêm vào danh mục",
    phGroup: "— Không chọn —",
    deliveryModeLabel: "Loại nội dung giao",
    deliveryModeUnique: "Kho riêng — mỗi đơn 1 nội dung",
    deliveryModeShared: "Nội dung chung — tất cả đơn nhận cùng 1 nội dung",
    fSharedContent: "Nội dung giao chung",
    phSharedContent:
      "Dán nội dung vào đây. Mỗi khách mua đều nhận đúng nội dung này.",
    dSharedContent:
      "Nội dung này sẽ được giao cho TẤT CẢ khách mua. Tồn kho giảm dần sau mỗi đơn cho đến khi về 0 thì ngưng bán. Nội dung không bị xóa.",
    dStockShared:
      "Số lượt bán còn lại. Mỗi đơn thành công sẽ trừ 1. Về 0 thì ngưng bán.",
  },
  en: {
    overview: "Product Overview",
    totalLabel: "total",
    manualLabel: "own products",
    activeLabel: "active",
    soldLabel: "sold",
    loading: "Loading...",
    refresh: "Refresh",
    searchPh: "Search products...",
    clearFilter: "Clear filters",
    visibleOf: (n: number, tot: number) => `${n}/${tot} products`,
    fAll: "All",
    fManual: "Own products",
    fActive: "Active",
    fHidden: "Hidden on bot",
    fPaused: "Paused",
    colName: "Product name",
    colSalePrice: "Sale price",
    colSourcePrice: "Cost",
    colCtvPrice: "CTV price",
    colUnsold: "In stock",
    colSold: "Sold",
    colTotal: "Total",
    colActions: "Actions",
    loadError: "Could not load products",
    loadErrorHint: "Try refreshing the catalog in a moment.",
    emptyTitle: "No matching products",
    emptyHint: "Change filters or create a custom product",
    bManual: "Own",
    bSource: "Source",
    bOff: "Off",
    bHidden: "Hidden",
    bShown: "Shown",
    bOn: "On",
    aView: "View",
    aEdit: "Edit",
    aStock: "Add stock",
    aPromo: "Promo",
    aShow: "Show",
    aHide: "Hide",
    aDelete: "Delete",
    aDuplicate: "Duplicate",
    confirmDel: (name: string) => `Delete own product "${name}" from shop?`,
    confirmDelShort: (name: string) => `Delete "${name}"?`,
    confirmPurge: "Delete all delivered accounts?",
    mCreate: "New",
    mInventory: "Inventory",
    mPromo: "Promo",
    mView: "Product details",
    mEdit: "Edit product",
    mCreateTitle: "Create own product",
    bManualLong: "Own product",
    bSynced: "Synced from source",
    bActive: "Active",
    bPaused: "Paused",
    bHiddenLong: "Currently hidden",
    statStock: "In stock",
    statSold: "Sold",
    statSalePrice: "Sale price",
    statSourcePrice: "Source price",
    statProfit: "Estimated profit",
    statImported: "Total imported",
    selfManaged: "Self-managed",
    promoSection: "Promo",
    editProductBtn: "Edit product",
    stockShortBtn: "Stock",
    fDisplayName: "Display name",
    hBotName: "Bot name",
    phDisplayName: "Public name shown to customers",
    fSalePrice: "Sale price",
    hVnd: "VND",
    phSalePrice: "Customer sale price",
    fIntName: "Internal name",
    hShopSource: "Shop source",
    phIntName: "Name for internal management",
    fStock: "Stock",
    hAutoCalc: "Auto",
    hOptional: "Optional",
    phStockAuto: "Auto-calculated from accounts",
    phStockManual: "e.g. 15",
    dStockAuto:
      "Automatically tracked from the account list in auto-delivery content. To increase or decrease stock, add or remove accounts below.",
    dStockManual: "Leave blank for unlimited. Enter 0 to mark as out of stock.",
    fIntCost: "Internal cost",
    phIntCost: "Can default to 0",
    dIntCost: "Used to track profit in shop. Can be 0.",
    fIntDesc: "Internal note",
    phIntDesc: "e.g. text delivery bundle",
    dIntDesc: "Used to distinguish product variants or store short notes.",
    fDelivery: "Auto-delivery content",
    hManualDelivery: "Manual delivery",
    dDelivery:
      "One account per line. e.g. email | password. Legacy JSON format is also supported.",
    fDeliveryFormat: "Account delivery format",
    dDeliveryFormat:
      "Format hint shown to customers. e.g. email | email password | grok password",
    phDeliveryFormat: "e.g. email | email password | grok password",
    fPromo: "Promo message",
    hBotDisplay: "Shown on bot",
    phPromo: "e.g. Fast warranty replacement, 24/7 setup support.",
    dPromo:
      "Short note about warranty, offer, or selling point to boost conversions.",
    dPromoDrawer:
      "Short note about offers, warranty, or bonuses. Shown directly below the product name when customers view it.",
    langTitle: "Display by language",
    langDesc:
      "Control which products show to Vietnamese and international customers",
    viCustomer: "🇻🇳 Vietnamese",
    enCustomer: "🌍 International",
    hiddenViOn: "Hidden from Vietnamese users",
    hiddenViOff: "Visible normally",
    hiddenEnOn: "Hidden from English users",
    hiddenEnOff: "Visible normally",
    fUsd: "USD price (international)",
    phUsd: "e.g. 3.99",
    dUsdActive: (p: string) => `EN bot will show $${p}`,
    dUsdEmpty: "Leave blank → auto-convert from VND using configured rate",
    wholesaleTitle: "Wholesale price for PRO resellers",
    wholesaleDesc: "PRO sellers connected to you will purchase at this price",
    fWholesale: "Wholesale (PRO)",
    phWholesale: "Price for PRO sellers",
    allowProBuy: "Allow PRO to buy",
    allowSale: "Allow sales",
    allowSaleDesc: "Enable or disable purchasing this product on the bot.",
    allowSaleCreateDesc:
      "Create the product in active selling state after saving.",
    hideOnBot: "Hide on bot",
    hideOnBotDesc: "Keep in catalog but temporarily remove from public menu.",
    hideOnBotCreateDesc:
      "Create in catalog but not yet publicly visible to customers.",
    fDesc: "Product description",
    phDesc:
      "Enter description shown to customers when they select a product...",
    dDesc:
      "Shown in the product card when customers tap to buy. Supports multiple lines.",
    syncedPriceLabel: "Current source price",
    syncedNote:
      "Synced products only allow changing the display name, price, description, and status.",
    saving: "Saving...",
    saveProduct: "Save product settings",
    savePromo: "Save promo",
    resetSource: "Reset to source",
    resetting: "Resetting...",
    createEyebrow: "Custom catalog",
    createHeading: "Create shop product",
    createSubhead:
      "Only shows the essentials to quickly set up a custom package, internal bundle, or product not in the source catalog.",
    hRequired: "Required",
    hRequiredIfOn: "Required if enabled",
    phCreateName: "e.g. Canva + ChatGPT 30-day combo",
    phCreateStock: "e.g. 10",
    phCreateStockAuto: "Auto-calculated from accounts",
    phCreateIntName: "Internal management name",
    phCreateIntDesc: "e.g. text delivery, manual processing",
    phCreatePromo: "e.g. fast error replacement within 24h.",
    dCreateStockAuto:
      "Auto-tracked from the account list in auto-delivery. To enter stock manually, leave the auto-delivery section blank.",
    dCreateStockManual:
      "Leave blank for unlimited. Enter 0 to create but not yet sell.",
    dCreateIntName: "If blank, the system will use the display name.",
    dCreateIntDesc:
      "Can be used to note account type, delivery source, or package specs.",
    dCreatePromo: "Appears with the product to increase conversion rate.",
    createNotice:
      "If auto-delivery content is provided, the system treats each line as an account and deducts automatically after each order. If left blank, manual orders will queue for seller processing.",
    creating: "Creating product...",
    createBtn: "Create own product",
    errNoProduct: "Please select a product before saving.",
    errNoName: "Display name cannot be empty.",
    errNoManualName: "Own product name cannot be empty.",
    savedProduct: "Product settings saved.",
    errSaveFallback: "Could not save changes to this product.",
    createdProduct: (name: string) =>
      `Own product "${name}" created. Continue editing in the right panel.`,
    errCreateFallback: "Could not create own product right now.",
    deletedProduct: "Own product removed from shop.",
    errDeleteFallback:
      "Could not delete this product. If orders exist, hide or pause it instead.",
    errToggleFallback: "Could not update visibility status.",
    purgedMsg: "Delivered account data cleared from product manager.",
    errPurgeFallback: "Could not clear delivered account data.",
    errRequired: (f: string) => `${f} is required.`,
    errInvalidNum: (f: string) => `${f} must be a number ≥ 0.`,
    errInvalidInt: (f: string) => `${f} must be a whole number ≥ 0.`,
    efSalePrice: "Sale price",
    efUsd: "USD price",
    efIntCost: "Internal cost",
    efStock: "Stock",
    efWholesale: "Wholesale price",
    fieldNote: (label: string) => `View notes for ${label}`,
    invTitle: "Product account inventory",
    invSubtitle: "Track available and delivered accounts here.",
    invAvail: (n: number) => `Available ${n}`,
    invDel: (n: number) => `Delivered ${n}`,
    invPurged: (n: number) => `Cleared ${n}`,
    purgeBtnAll: "Clear delivered",
    panelAvail: "Available accounts",
    panelDel: "Delivered accounts",
    accountCount: (n: number) => `${n} accounts`,
    loadingAvail: "Loading inventory...",
    loadingDel: "Loading delivery history...",
    accountNo: (n: number) => `Account #${n}`,
    readyBadge: "Ready",
    deliveredBadge: "Delivered",
    telegramCustomer: "Telegram customer",
    deleteSingle: "Delete",
    emptyAvail: "No available accounts in auto-stock.",
    emptyDel: "No accounts have been delivered, or you've cleared them all.",
    deliveryPh:
      "e.g.\nbtceuhocdt@nyawit.id | Premium@123\nabc@gmail.com | Pass456\nxyz@mail.com | Pass789",
    addStockTitle: "Add accounts to inventory",
    addStockPh: "Paste accounts here, one per line...",
    addStockBtn: "Add to inventory",
    addStockSaving: "Adding...",
    addStockSuccess: "Accounts added to inventory.",
    addStockErr: "Could not add accounts.",
    fImageUrl: "Product image (URL)",
    phImageUrl: "https://... paste image link here",
    dImageUrl:
      "When set, the bot shows the image alongside product info when a customer selects it.",
    fProductIcon: "Product icon",
    phProductIcon: "Paste emoji here, e.g. 🤖",
    dProductIcon:
      "Emoji shown before the product name in the bot list. Copy a custom emoji from Telegram and paste it here.",
    fUsageInstructions: "Usage instructions",
    phUsageInstructions:
      "e.g. Go to Settings → Account → change your password after first login.",
    dUsageInstructions:
      "Shown right below the account content in the delivery message. Leave blank to show nothing.",
    fGroup: "Add to catalog",
    phGroup: "— None —",
    deliveryModeLabel: "Delivery content type",
    deliveryModeUnique: "Unique stock — one entry per order",
    deliveryModeShared: "Shared content — all orders receive the same content",
    fSharedContent: "Shared delivery content",
    phSharedContent:
      "Paste content here. Every buyer will receive exactly this.",
    dSharedContent:
      "This content is sent to ALL buyers. Stock decrements by 1 per order until it reaches 0. The content itself is not deleted.",
    dStockShared:
      "Remaining sale slots. Each successful order deducts 1. Stops selling at 0.",
  },
  th: {
    overview: "ภาพรวมสินค้า",
    totalLabel: "รวม",
    manualLabel: "สินค้าของร้าน",
    activeLabel: "กำลังขาย",
    soldLabel: "ขายแล้ว",
    loading: "กำลังโหลด...",
    refresh: "รีเฟรช",
    searchPh: "ค้นหาสินค้า...",
    clearFilter: "ล้างตัวกรอง",
    visibleOf: (n: number, tot: number) => `${n}/${tot} สินค้า`,
    fAll: "ทั้งหมด",
    fManual: "สินค้าของร้าน",
    fActive: "กำลังขาย",
    fHidden: "ซ่อนบนบอท",
    fPaused: "หยุดชั่วคราว",
    colName: "ชื่อสินค้า",
    colSalePrice: "ราคาขาย",
    colSourcePrice: "ต้นทุน",
    colCtvPrice: "ราคา CTV",
    colUnsold: "คงเหลือ",
    colSold: "ขายแล้ว",
    colTotal: "รวม",
    colActions: "การดำเนินการ",
    loadError: "ไม่สามารถโหลดรายการสินค้าได้",
    loadErrorHint: "ลองรีเฟรชแคตาล็อกอีกครั้ง",
    emptyTitle: "ไม่มีสินค้าที่ตรงกัน",
    emptyHint: "เปลี่ยนตัวกรองหรือสร้างสินค้าของร้าน",
    bManual: "ของร้าน",
    bSource: "ซิงค์",
    bOff: "ปิด",
    bHidden: "ซ่อน",
    bShown: "แสดง",
    bOn: "เปิด",
    aView: "ดู",
    aEdit: "แก้ไข",
    aStock: "เพิ่มสต็อก",
    aPromo: "โปรโมชั่น",
    aShow: "แสดง",
    aHide: "ซ่อน",
    aDelete: "ลบ",
    aDuplicate: "คัดลอก",
    confirmDel: (name: string) => `ลบสินค้า "${name}" ออกจากร้าน?`,
    confirmDelShort: (name: string) => `ลบ "${name}"?`,
    confirmPurge: "ลบข้อมูลบัญชีที่ส่งแล้วทั้งหมด?",
    mCreate: "สร้างใหม่",
    mInventory: "คลังสินค้า",
    mPromo: "โปรโมชั่น",
    mView: "รายละเอียดสินค้า",
    mEdit: "แก้ไขสินค้า",
    mCreateTitle: "สร้างสินค้าของร้าน",
    bManualLong: "สินค้าของร้าน",
    bSynced: "ซิงค์จากต้นทาง",
    bActive: "กำลังขาย",
    bPaused: "หยุดชั่วคราว",
    bHiddenLong: "ซ่อนอยู่",
    statStock: "คงเหลือ",
    statSold: "ขายแล้ว",
    statSalePrice: "ราคาขาย",
    statSourcePrice: "ราคาต้นทาง",
    statProfit: "กำไรโดยประมาณ",
    statImported: "นำเข้าทั้งหมด",
    selfManaged: "จัดการเอง",
    promoSection: "โปรโมชั่น",
    editProductBtn: "แก้ไขสินค้า",
    stockShortBtn: "สต็อก",
    fDisplayName: "ชื่อที่แสดง",
    hBotName: "ชื่อในบอท",
    phDisplayName: "ชื่อสาธารณะที่แสดงต่อลูกค้า",
    fSalePrice: "ราคาขาย",
    hVnd: "VND",
    phSalePrice: "ราคาขายให้ลูกค้า",
    fIntName: "ชื่อภายใน",
    hShopSource: "แหล่งที่มา",
    phIntName: "ชื่อสำหรับบริหารภายใน",
    fStock: "สต็อก",
    hAutoCalc: "อัตโนมัติ",
    hOptional: "ไม่บังคับ",
    phStockAuto: "คำนวณอัตโนมัติจากบัญชี",
    phStockManual: "เช่น 15",
    dStockAuto:
      "คำนวณอัตโนมัติจากรายการบัญชีในส่วนเนื้อหาจัดส่งอัตโนมัติ หากต้องการเพิ่มหรือลดสต็อก ให้เพิ่มหรือลบบัญชีด้านล่าง",
    dStockManual: "เว้นว่างสำหรับไม่จำกัด ใส่ 0 เพื่อแจ้งหมดสต็อก",
    fIntCost: "ต้นทุนภายใน",
    phIntCost: "ค่าเริ่มต้นใส่ 0 ได้",
    dIntCost: "ใช้ติดตามกำไรในร้าน สามารถใส่ 0 ได้",
    fIntDesc: "หมายเหตุภายใน",
    phIntDesc: "เช่น ส่งทางข้อความ",
    dIntDesc: "ใช้แยกแยะแพ็กเกจหรือจดบันทึกสั้น",
    fDelivery: "เนื้อหาจัดส่งอัตโนมัติ",
    hManualDelivery: "Manual delivery",
    dDelivery:
      "หนึ่งบัญชีต่อบรรทัด เช่น อีเมล | รหัสผ่าน รองรับรูปแบบ JSON เดิมด้วย",
    fDeliveryFormat: "รูปแบบการส่งมอบบัญชี",
    dDeliveryFormat:
      "คำแนะนำรูปแบบสำหรับลูกค้า เช่น อีเมล | รหัสผ่านอีเมล | รหัสผ่าน grok",
    phDeliveryFormat: "เช่น อีเมล | รหัสผ่านอีเมล | รหัสผ่าน grok",
    fPromo: "ข้อความโปรโมชั่น",
    hBotDisplay: "แสดงในบอท",
    phPromo: "เช่น รับประกันเร็ว ช่วยติดตั้ง 24/7",
    dPromo: "เพิ่มหมายเหตุสั้นเกี่ยวกับการรับประกัน ข้อเสนอ หรือจุดขาย",
    dPromoDrawer:
      "หมายเหตุสั้นเกี่ยวกับข้อเสนอ การรับประกัน หรือของแถม แสดงใต้ชื่อสินค้าเมื่อลูกค้าดู",
    langTitle: "แสดงตามภาษา",
    langDesc: "ควบคุมว่าสินค้าใดแสดงต่อลูกค้าไทยและต่างชาติ",
    viCustomer: "🇻🇳 ลูกค้าเวียดนาม",
    enCustomer: "🌍 ลูกค้าต่างชาติ",
    hiddenViOn: "ซ่อนจากผู้ใช้ภาษาเวียดนาม",
    hiddenViOff: "แสดงปกติ",
    hiddenEnOn: "ซ่อนจากผู้ใช้ภาษาอังกฤษ",
    hiddenEnOff: "แสดงปกติ",
    fUsd: "ราคา USD (ต่างชาติ)",
    phUsd: "เช่น 3.99",
    dUsdActive: (p: string) => `บอท EN จะแสดง $${p}`,
    dUsdEmpty: "เว้นว่าง → แปลงอัตโนมัติจาก VND ตามอัตราแลกเปลี่ยนที่ตั้งค่า",
    wholesaleTitle: "ราคาส่งสำหรับ PRO reseller",
    wholesaleDesc: "ผู้ขาย PRO ที่เชื่อมต่อกับคุณจะซื้อในราคานี้",
    fWholesale: "ราคาส่ง (PRO)",
    phWholesale: "ราคาสำหรับผู้ขาย PRO",
    allowProBuy: "อนุญาต PRO ซื้อ",
    allowSale: "อนุญาตขาย",
    allowSaleDesc: "เปิดหรือปิดการซื้อสินค้านี้บนบอท",
    allowSaleCreateDesc: "สร้างสินค้าในสถานะเปิดขายทันทีหลังบันทึก",
    hideOnBot: "ซ่อนในบอท",
    hideOnBotDesc: "เก็บไว้ในแคตาล็อกแต่นำออกจากเมนูสาธารณะชั่วคราว",
    hideOnBotCreateDesc: "สร้างในแคตาล็อกแต่ยังไม่แสดงต่อสาธารณะ",
    fDesc: "คำอธิบายสินค้า",
    phDesc: "ใส่คำอธิบายที่แสดงแก่ลูกค้าเมื่อเลือกสินค้า...",
    dDesc: "แสดงในการ์ดสินค้าเมื่อลูกค้ากดซื้อ รองรับหลายบรรทัด",
    syncedPriceLabel: "ราคาต้นทางปัจจุบัน",
    syncedNote:
      "สินค้าที่ซิงค์อนุญาตให้เปลี่ยนได้เฉพาะชื่อ ราคา คำอธิบาย และสถานะ",
    saving: "กำลังบันทึก...",
    saveProduct: "บันทึกการตั้งค่าสินค้า",
    savePromo: "บันทึกโปรโมชั่น",
    resetSource: "รีเซ็ตเป็นค่าต้นทาง",
    resetting: "กำลังรีเซ็ต...",
    createEyebrow: "สร้างแคตาล็อกของตัวเอง",
    createHeading: "สร้างสินค้าของร้าน",
    createSubhead:
      "แสดงเฉพาะส่วนที่จำเป็นเพื่อสร้างแพ็กเกจหรือสินค้าที่ไม่อยู่ในแคตาล็อกต้นทางได้อย่างรวดเร็ว",
    hRequired: "บังคับ",
    hRequiredIfOn: "บังคับถ้าเปิด",
    phCreateName: "เช่น Canva + ChatGPT 30 วัน",
    phCreateStock: "เช่น 10",
    phCreateStockAuto: "คำนวณอัตโนมัติจากบัญชี",
    phCreateIntName: "ชื่อสำหรับบริหารภายใน",
    phCreateIntDesc: "เช่น ส่งทางข้อความ ประมวลผลเอง",
    phCreatePromo: "เช่น เปลี่ยนเร็วภายใน 24 ชม.",
    dCreateStockAuto:
      "คำนวณอัตโนมัติจากรายการบัญชีในส่วนจัดส่งอัตโนมัติ หากต้องการนำเข้าสต็อกเอง ให้เว้นว่างส่วนจัดส่งอัตโนมัติ",
    dCreateStockManual:
      "เว้นว่างสำหรับไม่จำกัด ใส่ 0 เพื่อสร้างไว้แต่ยังไม่ขาย",
    dCreateIntName: "หากเว้นว่าง ระบบจะใช้ชื่อที่แสดงแทน",
    dCreateIntDesc:
      "สามารถใช้บันทึกประเภทบัญชี แหล่งจัดส่ง หรือรายละเอียดแพ็กเกจ",
    dCreatePromo: "แสดงพร้อมสินค้าเพื่อเพิ่มอัตราการขาย",
    createNotice:
      "หากใส่เนื้อหาจัดส่งอัตโนมัติ ระบบจะถือว่าแต่ละบรรทัดเป็นบัญชีหนึ่งรายการและหักออกหลังแต่ละออร์เดอร์ หากเว้นว่าง ออร์เดอร์ manual จะรอผู้ขายดำเนินการด้วยตนเอง",
    creating: "กำลังสร้างสินค้า...",
    createBtn: "สร้างสินค้าของร้าน",
    errNoProduct: "โปรดเลือกสินค้าก่อนบันทึก",
    errNoName: "ชื่อที่แสดงต้องไม่ว่าง",
    errNoManualName: "ชื่อสินค้าของร้านต้องไม่ว่าง",
    savedProduct: "บันทึกการตั้งค่าสินค้าแล้ว",
    errSaveFallback: "ไม่สามารถบันทึกการเปลี่ยนแปลงได้",
    createdProduct: (name: string) =>
      `สร้างสินค้า "${name}" แล้ว ดำเนินการต่อในแผงด้านขวา`,
    errCreateFallback: "ไม่สามารถสร้างสินค้าได้ในขณะนี้",
    deletedProduct: "ลบสินค้าของร้านออกแล้ว",
    errDeleteFallback:
      "ไม่สามารถลบสินค้าได้ หากมีออร์เดอร์แล้ว ให้ซ่อนหรือปิดขายแทน",
    errToggleFallback: "ไม่สามารถอัปเดตสถานะการแสดงผลได้",
    purgedMsg: "ล้างข้อมูลบัญชีที่ส่งแล้วออกจากตัวจัดการสินค้าแล้ว",
    errPurgeFallback: "ไม่สามารถล้างข้อมูลบัญชีที่ส่งแล้วได้",
    errRequired: (f: string) => `${f} ต้องไม่ว่าง`,
    errInvalidNum: (f: string) => `${f} ต้องเป็นตัวเลข ≥ 0`,
    errInvalidInt: (f: string) => `${f} ต้องเป็นจำนวนเต็ม ≥ 0`,
    efSalePrice: "ราคาขาย",
    efUsd: "ราคา USD",
    efIntCost: "ต้นทุนภายใน",
    efStock: "สต็อก",
    efWholesale: "ราคาส่ง",
    fieldNote: (label: string) => `ดูหมายเหตุสำหรับ ${label}`,
    invTitle: "คลังบัญชีสินค้า",
    invSubtitle: "ติดตามบัญชีที่มีอยู่และที่ส่งแล้วที่นี่",
    invAvail: (n: number) => `คงเหลือ ${n}`,
    invDel: (n: number) => `ส่งแล้ว ${n}`,
    invPurged: (n: number) => `ล้างแล้ว ${n}`,
    purgeBtnAll: "ล้างที่ส่งแล้ว",
    panelAvail: "บัญชีที่มีอยู่",
    panelDel: "บัญชีที่ส่งแล้ว",
    accountCount: (n: number) => `${n} บัญชี`,
    loadingAvail: "กำลังโหลดคลังสินค้า...",
    loadingDel: "กำลังโหลดประวัติการส่ง...",
    accountNo: (n: number) => `บัญชี #${n}`,
    readyBadge: "พร้อม",
    deliveredBadge: "ส่งแล้ว",
    telegramCustomer: "ลูกค้า Telegram",
    deleteSingle: "ลบ",
    emptyAvail: "ไม่มีบัญชีในคลังอัตโนมัติ",
    emptyDel: "ยังไม่มีบัญชีที่ส่งหรือคุณล้างทั้งหมดแล้ว",
    deliveryPh:
      "เช่น:\nbtceuhocdt@nyawit.id | Premium@123\nabc@gmail.com | Pass456\nxyz@mail.com | Pass789",
    addStockTitle: "เพิ่มบัญชีในคลัง",
    addStockPh: "วางบัญชีที่นี่ หนึ่งบรรทัดต่อหนึ่งบัญชี...",
    addStockBtn: "เพิ่มในคลัง",
    addStockSaving: "กำลังเพิ่ม...",
    addStockSuccess: "เพิ่มบัญชีในคลังแล้ว",
    addStockErr: "ไม่สามารถเพิ่มบัญชีได้",
    fImageUrl: "รูปสินค้า (URL)",
    phImageUrl: "https://... วางลิงก์รูปที่นี่",
    dImageUrl: "เมื่อมีรูป บอทจะแสดงรูปพร้อมข้อมูลสินค้าเมื่อลูกค้าเลือกซื้อ",
    fProductIcon: "ไอคอนสินค้า",
    phProductIcon: "วาง emoji ที่นี่ เช่น 🤖",
    dProductIcon:
      "Emoji แสดงหน้าชื่อสินค้าในรายการบอท คัดลอก custom emoji จาก Telegram แล้ววางที่นี่",
    fUsageInstructions: "คำแนะนำการใช้งาน",
    phUsageInstructions:
      "เช่น ไปที่ Settings → Account → เปลี่ยนรหัสผ่านทันทีหลังเข้าสู่ระบบ",
    dUsageInstructions:
      "แสดงใต้ข้อมูลบัญชีในข้อความจัดส่ง ว่างไว้ = ไม่แสดงอะไร",
    fGroup: "เพิ่มในหมวดหมู่",
    phGroup: "— ไม่เลือก —",
    deliveryModeLabel: "ประเภทเนื้อหาการส่ง",
    deliveryModeUnique: "สต็อกเฉพาะ — หนึ่งรายการต่อออเดอร์",
    deliveryModeShared: "เนื้อหาร่วม — ทุกออเดอร์ได้รับเนื้อหาเดียวกัน",
    fSharedContent: "เนื้อหาส่งร่วม",
    phSharedContent: "วางเนื้อหาที่นี่ ผู้ซื้อทุกคนจะได้รับสิ่งนี้",
    dSharedContent:
      "เนื้อหานี้จะถูกส่งให้ผู้ซื้อทุกคน สต็อกลดลง 1 ต่อออเดอร์จนถึง 0 จึงหยุดขาย เนื้อหาไม่ถูกลบ",
    dStockShared:
      "จำนวนครั้งที่ขายได้ ลด 1 ต่อออเดอร์ที่สำเร็จ หยุดขายเมื่อถึง 0",
  },
} as const;
type TType = typeof T.vi;

type ProductFilter =
  | "all"
  | "manual"
  | "pending"
  | "active"
  | "hidden"
  | "paused"
  | "archived";
type DrawerMode = "view" | "edit" | "create" | "inventory" | "promo" | null;

type CatalogGroup = {
  id: string;
  name: string;
  description: string | null;
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

type ProductPromoType =
  | "NONE"
  | "BUY_N_GET_M"
  | "BUY_N_PAY_M"
  | "BULK_DISCOUNT"
  | "PERCENT_DISCOUNT"
  | "TIER_PRICE";

type Product = {
  id: string;
  sourceProductId: string;
  providerSourceId: string | null;
  sourceScope: string;
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
  archivedAt: string | null;
  promoText: string | null;
  isManual: boolean;
  isShared: boolean;
  sharedContent: string | null;
  usageInstructions: string | null;
  deliveryText: string | null;
  deliveryFormatHint: string | null;
  sourceDeliveryMode?: string | null;
  imageUrl: string | null;
  productIcon: string | null;
  syncedAt: string | null;
  groupId: string | null;
  position: number;
  iconCustomEmojiId: string | null;
  promoType: ProductPromoType | null;
  promoBuyN: number | null;
  promoGetM: number | null;
  promoTiers: Array<{ buy: number; get: number }>;
  promoPriceTiers: Array<{ minQty: number; price: number }>;
  promoBulkMinQty: number | null;
  promoBulkDiscountPct: number | null;
  promoStartAt: string | null;
  promoEndAt: string | null;
  promoBannerUrl: string | null;
  productFamily?: string | null;
  productPackage?: string | null;
  accountType?: string | null;
  durationType?: string | null;
  warrantyPolicy?: string | null;
  preorderEnabled: boolean;
  preorderFeePercent: number;
  internalSourceEnabled?: boolean;
  internalSourcePrice?: number | null;
};

type ProviderSourceSummary = {
  id: string;
  label: string;
  providerName: string;
  enabled: boolean;
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
  isShared: boolean;
  sharedContent: string;
  usageInstructions: string;
  deliveryText: string;
  deliveryFormatHint: string;
  sourceDeliveryMode: string;
  internalSourceEnabled: boolean;
  internalSourcePrice: string;
  imageUrl: string;
  productIcon: string;
  iconCustomEmojiId: string;
  promoType: ProductPromoType;
  promoBuyN: string;
  promoGetM: string;
  promoTiers: Array<{ buy: string; get: string }>;
  promoPriceTiers: Array<{ minQty: string; price: string }>;
  promoBulkMinQty: string;
  promoBulkDiscountPct: string;
  promoStartAt: string;
  promoEndAt: string;
  promoBannerUrl: string;
  productFamily: string;
  productPackage: string;
  accountType: string;
  durationType: string;
  warrantyPolicy: string;
  preorderEnabled: boolean;
  preorderFeePercent: string;
};

type ManualProductForm = {
  displayName: string;
  salePrice: string;
  salePriceUsd: string;
  sourceName: string;
  sourceDescription: string;
  sourcePrice: string;
  available: string;
  promoText: string;
  isShared: boolean;
  sharedContent: string;
  usageInstructions: string;
  deliveryText: string;
  deliveryFormatHint: string;
  sourceDeliveryMode: string;
  hidden: boolean;
  hiddenVi: boolean;
  hiddenEn: boolean;
  enabled: boolean;
  internalSourceEnabled: boolean;
  internalSourcePrice: string;
  imageUrl: string;
  productIcon: string;
  iconCustomEmojiId: string;
  groupId: string | null;
  productFamily: string;
  productPackage: string;
  accountType: string;
  durationType: string;
  warrantyPolicy: string;
  preorderEnabled: boolean;
  preorderFeePercent: string;
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
  isShared: false,
  sharedContent: "",
  usageInstructions: "",
  deliveryText: "",
  deliveryFormatHint: "",
  sourceDeliveryMode: "MANUAL",
  internalSourceEnabled: false,
  internalSourcePrice: "",
  imageUrl: "",
  productIcon: "",
  iconCustomEmojiId: "",
  promoType: "NONE",
  promoBuyN: "",
  promoGetM: "",
  promoTiers: [{ buy: "", get: "" }],
  promoPriceTiers: [
    { minQty: "1", price: "" },
    { minQty: "100", price: "" },
    { minQty: "1000", price: "" },
  ],
  promoBulkMinQty: "",
  promoBulkDiscountPct: "",
  promoStartAt: "",
  promoEndAt: "",
  promoBannerUrl: "",
  productFamily: "",
  productPackage: "",
  accountType: "",
  durationType: "",
  warrantyPolicy: "KBH",
  preorderEnabled: false,
  preorderFeePercent: "0",
};

const emptyManualForm: ManualProductForm = {
  displayName: "",
  salePrice: "",
  salePriceUsd: "",
  sourceName: "",
  sourceDescription: "",
  sourcePrice: "0",
  available: "",
  promoText: "",
  isShared: false,
  sharedContent: "",
  usageInstructions: "",
  deliveryText: "",
  deliveryFormatHint: "",
  sourceDeliveryMode: "MANUAL",
  hidden: false,
  hiddenVi: false,
  hiddenEn: false,
  enabled: true,
  internalSourceEnabled: true,
  internalSourcePrice: "",
  imageUrl: "",
  productIcon: "",
  iconCustomEmojiId: "",
  groupId: null,
  productFamily: "",
  productPackage: "",
  accountType: "",
  durationType: "",
  warrantyPolicy: "KBH",
  preorderEnabled: false,
  preorderFeePercent: "0",
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
          <label
            className="text-sm font-semibold"
            style={{ color: "var(--tx)" }}
          >
            {label}
          </label>
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

function PreorderSettings({
  enabled,
  feePercent,
  disabled = false,
  onEnabledChange,
  onFeeChange,
}: {
  enabled: boolean;
  feePercent: string;
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onFeeChange: (value: string) => void;
}) {
  const { lang } = useLang();
  const copy =
    lang === "en"
      ? {
          title: "Allow pre-orders when out of stock",
          fee: "Pre-order fee (%)",
          note: "Customers pay the item price plus this fee. Paid orders are delivered automatically in FIFO order when stock arrives.",
          unavailable: "Pre-orders are unavailable for Add Mail products.",
        }
      : lang === "th"
        ? {
            title: "อนุญาตให้สั่งจองเมื่อสินค้าหมด",
            fee: "ค่าจองล่วงหน้า (%)",
            note: "ลูกค้าชำระค่าสินค้าพร้อมค่าจอง และบอทจะจัดส่งอัตโนมัติตามลำดับ FIFO เมื่อมีสินค้า",
            unavailable: "สินค้าแบบ Add Mail ไม่รองรับการสั่งจอง",
          }
        : {
            title: "Cho phép đặt trước khi hết hàng",
            fee: "Phí đặt trước (%)",
            note: "Khách thanh toán giá hàng + phí. Đơn đã trả tiền được bot tự giao theo thứ tự FIFO khi hàng về.",
            unavailable: "Sản phẩm Add Mail không hỗ trợ đặt trước.",
          };

  return (
    <div
      className="space-y-3 rounded-2xl border p-4"
      style={{
        borderColor: enabled ? "rgba(249,115,22,0.35)" : "var(--bd)",
        background: enabled ? "rgba(249,115,22,0.06)" : "var(--inp)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>
            🕒 {copy.title}
          </p>
          <p
            className="mt-1 text-xs leading-5"
            style={{ color: "var(--tx-f)" }}
          >
            {disabled ? copy.unavailable : copy.note}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled && !disabled}
          disabled={disabled}
          onClick={() => onEnabledChange(!enabled)}
          className="shrink-0 rounded-xl border px-3 py-2 text-xs font-black uppercase transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: enabled ? "rgba(249,115,22,0.45)" : "var(--bd)",
            background: enabled ? "rgba(249,115,22,0.16)" : "var(--bg)",
            color: enabled ? "rgb(249,115,22)" : "var(--tx-f)",
          }}
        >
          {enabled && !disabled ? "ON" : "OFF"}
        </button>
      </div>
      {enabled && !disabled ? (
        <Field label={copy.fee} hint="0–100%">
          <StudioInput
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={feePercent}
            onChange={(event) => onFeeChange(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

const NOTICE_STYLES: Record<NoticeTone, { bg: string; border: string }> = {
  success: { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)" },
  warning: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" },
  danger: { bg: "rgba(244,63,94,0.08)", border: "rgba(244,63,94,0.2)" },
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
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
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
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.csv"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[11px] font-bold uppercase transition hover:opacity-80"
        style={{
          background: "var(--inp)",
          border: "1px solid var(--bd)",
          color: "var(--tx-f)",
        }}
      >
        <Upload className="h-3 w-3" />
        Import .txt
      </button>
    </div>
  );
}

function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const cleaned = (String(url).split("?")[0] ?? "").toLowerCase();
  return /\.(mp4|mov|webm|m4v)$/i.test(cleaned);
}

function MediaPreview({ url, className }: { url: string; className?: string }) {
  if (isVideoUrl(url)) {
    return (
      <video
        src={url}
        className={className}
        muted
        playsInline
        controls={false}
        loop
        autoPlay
        onError={(e) => {
          (e.target as HTMLVideoElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      className={className}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
      onLoad={(e) => {
        (e.target as HTMLImageElement).style.display = "block";
      }}
    />
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

function parseRequiredNumber(
  value: string,
  emptyMsg: string,
  invalidMsg: string,
) {
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

function parsePercentage(value: string, label: string) {
  const parsed = Number(value.trim() || "0");
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${label} phải nằm trong khoảng 0–100%.`);
  }
  return parsed;
}

function createEditorForm(product: Product): ProductEditorForm {
  return {
    displayName: product.displayName || "",
    salePrice: String(product.salePrice ?? ""),
    salePriceUsd:
      product.salePriceUsd != null ? String(product.salePriceUsd) : "",
    hidden: Boolean(product.hidden),
    hiddenVi: Boolean(product.hiddenVi),
    hiddenEn: Boolean(product.hiddenEn),
    enabled: Boolean(product.enabled),
    promoText: product.promoText || "",
    sourceName: product.sourceName || "",
    sourceDescription: product.description || "",
    sourcePrice: String(product.sourcePrice ?? 0),
    available: product.available === null ? "" : String(product.available),
    isShared: Boolean(product.isShared),
    sharedContent: product.sharedContent || "",
    usageInstructions: product.usageInstructions || "",
    deliveryText: product.deliveryText || "",
    deliveryFormatHint: product.deliveryFormatHint || "",
    sourceDeliveryMode: (product.sourceDeliveryMode || "MANUAL")
      .toString()
      .toUpperCase(),
    internalSourceEnabled: Boolean((product as any).internalSourceEnabled),
    internalSourcePrice:
      (product as any).internalSourcePrice != null
        ? String((product as any).internalSourcePrice)
        : "",
    imageUrl: product.imageUrl || "",
    productIcon: product.productIcon || "",
    iconCustomEmojiId: product.iconCustomEmojiId || "",
    promoType: (product.promoType as ProductPromoType) || "NONE",
    promoBuyN: product.promoBuyN != null ? String(product.promoBuyN) : "",
    promoGetM: product.promoGetM != null ? String(product.promoGetM) : "",
    promoTiers: product.promoTiers?.length
      ? product.promoTiers.map((tier) => ({
          buy: String(tier.buy),
          get: String(tier.get),
        }))
      : [
          {
            buy: product.promoBuyN != null ? String(product.promoBuyN) : "",
            get: product.promoGetM != null ? String(product.promoGetM) : "",
          },
        ],
    promoPriceTiers: product.promoPriceTiers?.length
      ? product.promoPriceTiers.map((tier) => ({
          minQty: String(tier.minQty),
          price: String(tier.price),
        }))
      : [
          { minQty: "1", price: "" },
          { minQty: "100", price: "" },
          { minQty: "1000", price: "" },
        ],
    promoBulkMinQty:
      product.promoBulkMinQty != null ? String(product.promoBulkMinQty) : "",
    promoBulkDiscountPct:
      product.promoBulkDiscountPct != null
        ? String(product.promoBulkDiscountPct)
        : "",
    promoStartAt: product.promoStartAt
      ? new Date(product.promoStartAt).toISOString().slice(0, 16)
      : "",
    promoEndAt: product.promoEndAt
      ? new Date(product.promoEndAt).toISOString().slice(0, 16)
      : "",
    promoBannerUrl: product.promoBannerUrl || "",
    productFamily: (product.productFamily || "").toString().toUpperCase(),
    productPackage: product.productPackage || "",
    accountType: (product.accountType || "").toString().toUpperCase(),
    durationType: (product.durationType || "").toString().toUpperCase(),
    warrantyPolicy: (product.warrantyPolicy || "KBH").toString().toUpperCase(),
    preorderEnabled: Boolean(product.preorderEnabled),
    preorderFeePercent: String(product.preorderFeePercent ?? 0),
  };
}

function toUsdt(vnd: number, rate: number) {
  return (vnd / (rate > 0 ? rate : 26000)).toFixed(2);
}

const ACTION_COLORS = {
  indigo: { bg: "rgba(99,102,241,0.15)", color: "rgb(99,102,241)" },
  orange: { bg: "rgba(249,115,22,0.15)", color: "rgb(234,88,12)" },
  green: { bg: "rgba(34,197,94,0.15)", color: "rgb(22,163,74)" },
  pink: { bg: "rgba(236,72,153,0.15)", color: "rgb(219,39,119)" },
  violet: { bg: "rgba(168,85,247,0.15)", color: "rgb(147,51,234)" },
  red: { bg: "rgba(244,63,94,0.15)", color: "rgb(225,29,72)" },
  default: { bg: "transparent", color: "var(--tx-f)" },
} as const;

function ActionBtn({
  title,
  color = "default",
  onClick,
  children,
}: {
  title: string;
  color?: keyof typeof ACTION_COLORS;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
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

function OverflowItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-semibold transition-colors hover:opacity-80"
      style={{ color: danger ? "rgb(225,29,72)" : "var(--tx)" }}
    >
      {icon}
      {label}
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
    <div
      className="px-4 pb-4 pt-4 lg:px-5"
      style={{ borderTop: "1px solid var(--bd)" }}
    >
      <div
        className="rounded-[20px] border p-4 shadow-[0_18px_36px_rgba(0,0,0,0.12)] transition-[border-color,box-shadow,background-color] duration-300 ease-out lg:p-5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--bd)" }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>
              {t.invTitle}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>
              {t.invSubtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-emerald-400/18 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
              {t.invAvail(inventory?.summary.availableCount ?? 0)}
            </div>
            <div className="rounded-full border border-emerald-300/18 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
              {t.invDel(inventory?.summary.deliveredCount ?? 0)}
            </div>
            <div
              className="rounded-full px-3 py-1.5 text-xs font-semibold"
              style={{
                border: "1px solid var(--bd)",
                background: "var(--inp)",
                color: "var(--tx-m)",
              }}
            >
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
          <div
            className="rounded-[18px] p-3"
            style={{ border: "1px solid var(--bd)", background: "var(--inp)" }}
          >
            <div
              className="flex items-center justify-between gap-3 pb-3"
              style={{ borderBottom: "1px solid var(--bd)" }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--tx)" }}
              >
                {t.panelAvail}
              </p>
              <StudioBadge tone="success">
                {t.accountCount(inventory?.summary.availableCount ?? 0)}
              </StudioBadge>
            </div>

            {isLoading ? (
              <div
                className="px-1 py-4 text-sm"
                style={{ color: "var(--tx-m)" }}
              >
                {t.loadingAvail}
              </div>
            ) : inventory?.availableItems.length ? (
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {inventory.availableItems.map((item, index) => (
                  <div
                    key={item.key}
                    className="rounded-[16px] px-3 py-3"
                    style={{
                      border: "1px solid var(--bd)",
                      background: "var(--surface)",
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p
                        className="text-[11px] font-semibold uppercase tracking-[0.14em]"
                        style={{ color: "var(--tx-f)" }}
                      >
                        {t.accountNo(index + 1)}
                      </p>
                      <StudioBadge tone="success">{t.readyBadge}</StudioBadge>
                    </div>
                    <code
                      className="block whitespace-pre-wrap break-all text-[13px] leading-6"
                      style={{ color: "var(--tx)" }}
                    >
                      {item.content}
                    </code>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="mt-3 rounded-[16px] px-4 py-4 text-sm leading-6"
                style={{
                  border: "1px dashed var(--bd)",
                  background: "var(--surface)",
                  color: "var(--tx-m)",
                }}
              >
                {t.emptyAvail}
              </div>
            )}
          </div>

          <div
            className="rounded-[18px] p-3"
            style={{ border: "1px solid var(--bd)", background: "var(--inp)" }}
          >
            <div
              className="flex items-center justify-between gap-3 pb-3"
              style={{ borderBottom: "1px solid var(--bd)" }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--tx)" }}
              >
                {t.panelDel}
              </p>
              <StudioBadge tone="neutral">
                {t.accountCount(inventory?.summary.deliveredCount ?? 0)}
              </StudioBadge>
            </div>

            {isLoading ? (
              <div
                className="px-1 py-4 text-sm"
                style={{ color: "var(--tx-m)" }}
              >
                {t.loadingDel}
              </div>
            ) : inventory?.deliveredItems.length ? (
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {inventory.deliveredItems.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-[16px] px-3 py-3"
                    style={{
                      border: "1px solid var(--bd)",
                      background: "var(--surface)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StudioBadge tone="neutral">
                            {t.deliveredBadge}
                          </StudioBadge>
                          {item.orderCode ? (
                            <span
                              className="text-[11px]"
                              style={{ color: "var(--tx-f)" }}
                            >
                              {item.orderCode}
                            </span>
                          ) : null}
                        </div>
                        <p
                          className="mt-2 text-xs"
                          style={{ color: "var(--tx-m)" }}
                        >
                          {item.customerLabel || t.telegramCustomer} •{" "}
                          {item.deliveredAt
                            ? formatDate(item.deliveredAt)
                            : "-"}
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

                    <code
                      className="mt-3 block whitespace-pre-wrap break-all text-[13px] leading-6"
                      style={{ color: "var(--tx)" }}
                    >
                      {item.content}
                    </code>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="mt-3 rounded-[16px] px-4 py-4 text-sm leading-6"
                style={{
                  border: "1px dashed var(--bd)",
                  background: "var(--surface)",
                  color: "var(--tx-m)",
                }}
              >
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
  const canUseExternalSource = hasSellerCapability(
    session,
    "source_external_use",
  );
  const familyOptions = useProductFamilyOptions();
  const productsQuery = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: async () => (await api.get("/products")).data,
    refetchInterval: 10_000,
    refetchOnWindowFocus: "always",
  });

  const botConfigQuery = useQuery<{
    usdtVndRateOverride: number | null;
    defaultUsdtVndRate: number;
  }>({
    queryKey: ["bot-config"],
    queryFn: async () => (await api.get("/bot-config")).data,
  });
  const usdtVndRate =
    botConfigQuery.data?.usdtVndRateOverride ??
    botConfigQuery.data?.defaultUsdtVndRate ??
    26000;

  const groupsQuery = useQuery<CatalogGroup[]>({
    queryKey: ["catalog-groups"],
    queryFn: async () => (await api.get("/catalog-groups")).data,
  });
  const groups = groupsQuery.data || [];

  const providerSourcesQuery = useQuery<ProviderSourceSummary[]>({
    queryKey: ["source-network", "provider-sources"],
    queryFn: async () => (await api.get("/provider-sources")).data,
    enabled: canUseExternalSource,
  });
  const providerSources = providerSourcesQuery.data || [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [providerSourceFilter, setProviderSourceFilter] = useState("all");
  const [catalogGroupFilter, setCatalogGroupFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<"all" | "available" | "out">(
    "all",
  );
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editorForm, setEditorForm] =
    useState<ProductEditorForm>(emptyEditorForm);
  const [createForm, setCreateForm] =
    useState<ManualProductForm>(emptyManualForm);
  const [createImageUploading, setCreateImageUploading] = useState(false);
  const [editorImageUploading, setEditorImageUploading] = useState(false);
  const [promoBannerUploading, setPromoBannerUploading] = useState(false);
  const [addAccountsText, setAddAccountsText] = useState("");
  const [stockModal, setStockModal] = useState<
    | "upload"
    | "uploadResult"
    | "extract"
    | "extractResult"
    | "history"
    | "createBatch"
    | "viewStock"
    | null
  >(null);
  const [stockStatusFilter, setStockStatusFilter] = useState<
    "ALL" | "AVAILABLE" | "SOLD" | "EXTRACTED"
  >("AVAILABLE");
  const [stockSearch, setStockSearch] = useState("");
  const [createBatchResult, setCreateBatchResult] = useState<{
    batchId: string;
    batchName: string;
    added: number;
    totalAfter: number;
    preview: string[];
  } | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    added: number;
    totalBefore: number;
    totalAfter: number;
    preview: string[];
  } | null>(null);
  const [extractResult, setExtractResult] = useState<{
    extracted: string[];
    totalBefore: number;
    totalAfter: number;
    method: StockExtractMethod;
    dryRun?: boolean;
  } | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingGroupDescription, setEditingGroupDescription] = useState("");
  const [editingGroupIcon, setEditingGroupIcon] = useState("");
  const [iconPickerGroupId, setIconPickerGroupId] = useState<string | null>(
    null,
  );
  // "editor" → editorForm, "create" → createForm
  const [iconPickerTarget, setIconPickerTarget] = useState<
    "editor" | "create" | null
  >(null);
  const [showNewIconForm, setShowNewIconForm] = useState(false);
  const [newIconLabel, setNewIconLabel] = useState("");
  const [newIconImageUrl, setNewIconImageUrl] = useState("");
  const [newIconCustomEmojiId, setNewIconCustomEmojiId] = useState("");
  const [newIconUploading, setNewIconUploading] = useState(false);

  const iconCatalogQuery = useQuery<IconCatalogEntry[]>({
    queryKey: ["icon-catalog"],
    queryFn: async () => (await api.get("/icon-catalog")).data,
  });
  const iconCatalog = iconCatalogQuery.data || [];

  const createIconMutation = useMutation({
    mutationFn: async (dto: {
      label: string;
      imageUrl: string;
      customEmojiId: string;
    }) => (await api.post("/icon-catalog", dto)).data as IconCatalogEntry,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["icon-catalog"] });
      setShowNewIconForm(false);
      setNewIconLabel("");
      setNewIconImageUrl("");
      setNewIconCustomEmojiId("");
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không thể tạo icon."),
      }),
  });

  const deleteIconMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/icon-catalog/${id}`),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["icon-catalog"] }),
  });

  const setGroupIconMutation = useMutation({
    mutationFn: async ({
      id,
      icon,
      iconCustomEmojiId,
    }: {
      id: string;
      icon: string;
      iconCustomEmojiId: string;
    }) => api.put(`/catalog-groups/${id}`, { icon, iconCustomEmojiId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog-groups"] });
      setIconPickerGroupId(null);
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không thể đặt icon."),
      }),
  });
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);

  const products = productsQuery.data || [];

  const filteredProducts = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return products.filter((item) => {
      const matchesKeyword =
        !normalizedKeyword ||
        [item.displayName, item.sourceName, item.description]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(normalizedKeyword),
          );

      const matchesFilter =
        (filter === "archived" && Boolean(item.archivedAt)) ||
        (!item.archivedAt &&
          (filter === "all" ||
            (filter === "manual" && item.isManual) ||
            (filter === "pending" &&
              Boolean(item.providerSourceId) &&
              (!item.enabled || item.hidden)) ||
            (filter === "active" && item.enabled && !item.hidden) ||
            (filter === "hidden" && item.hidden) ||
            (filter === "paused" && !item.enabled)));

      const matchesProviderSource =
        providerSourceFilter === "all" ||
        item.providerSourceId === providerSourceFilter;
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "available" &&
          (item.available === null || item.available > 0)) ||
        (stockFilter === "out" && item.available === 0);
      const matchesCatalogGroup =
        catalogGroupFilter === "all" || item.groupId === catalogGroupFilter;

      return (
        matchesKeyword &&
        matchesFilter &&
        matchesProviderSource &&
        matchesCatalogGroup &&
        matchesStock
      );
    });
  }, [
    filter,
    catalogGroupFilter,
    keyword,
    products,
    providerSourceFilter,
    stockFilter,
  ]);

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

  const selectedProduct =
    products.find((item) => item.id === selectedId) || null;

  useEffect(() => {
    setStockSearch("");
  }, [selectedProduct?.id]);

  const editorIsShared =
    Boolean(selectedProduct?.isManual) && editorForm.isShared;
  const editorIsAddMail =
    Boolean(selectedProduct?.isManual) &&
    editorForm.sourceDeliveryMode === "ADD_MAIL";
  const editorUsesAutoStock =
    Boolean(selectedProduct?.isManual) &&
    !editorIsShared &&
    !editorIsAddMail &&
    editorForm.deliveryText.trim().length > 0;
  const createIsAddMail = createForm.sourceDeliveryMode === "ADD_MAIL";
  const createIsShared = !createIsAddMail && createForm.isShared;
  const createUsesAutoStock =
    !createIsShared &&
    !createIsAddMail &&
    createForm.deliveryText.trim().length > 0;
  const inventoryPrompt =
    lang === "en"
      ? "Add accounts to "
      : lang === "th"
        ? "เพิ่มบัญชีไปยัง "
        : "Thêm tài khoản vào ";
  const inventoryLinkLabel =
    lang === "en"
      ? "Account inventory"
      : lang === "th"
        ? "คลังบัญชี"
        : "Kho tài khoản";
  const savingBeforeInventory =
    lang === "en"
      ? "Saving..."
      : lang === "th"
        ? "กำลังบันทึก..."
        : "Đang lưu...";

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
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerMode(null);
    };
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
        salePrice: parseRequiredNumber(
          editorForm.salePrice,
          t.errRequired(t.efSalePrice),
          t.errInvalidNum(t.efSalePrice),
        ),
        salePriceUsd: editorForm.salePriceUsd.trim()
          ? parseRequiredNumber(
              editorForm.salePriceUsd,
              t.errRequired(t.efUsd),
              t.errInvalidNum(t.efUsd),
            )
          : 0,
        hidden: editorForm.hidden,
        hiddenVi: editorForm.hiddenVi,
        hiddenEn: editorForm.hiddenEn,
        enabled: editorForm.enabled,
        promoText: editorForm.promoText.trim(),
        imageUrl: editorForm.imageUrl.trim() || "",
        productIcon: editorForm.productIcon.trim() || "",
        iconCustomEmojiId: editorForm.iconCustomEmojiId.trim() || "",
        sourceDescription: editorForm.sourceDescription.trim(),
        promoType: editorForm.promoType === "NONE" ? "" : editorForm.promoType,
        promoBuyN: editorForm.promoBuyN.trim()
          ? Number(editorForm.promoBuyN)
          : 0,
        promoGetM: editorForm.promoGetM.trim()
          ? Number(editorForm.promoGetM)
          : 0,
        promoTiers: editorForm.promoTiers
          .map((tier) => ({ buy: Number(tier.buy), get: Number(tier.get) }))
          .filter((tier) => tier.buy > 0 && tier.get > 0),
        promoPriceTiers: editorForm.promoPriceTiers
          .map((tier) => ({
            minQty: Number(tier.minQty),
            price: Number(tier.price),
          }))
          .filter((tier) => tier.minQty > 0 && tier.price > 0),
        promoBulkMinQty: editorForm.promoBulkMinQty.trim()
          ? Number(editorForm.promoBulkMinQty)
          : 0,
        promoBulkDiscountPct: editorForm.promoBulkDiscountPct.trim()
          ? Number(editorForm.promoBulkDiscountPct)
          : 0,
        promoStartAt: editorForm.promoStartAt
          ? new Date(editorForm.promoStartAt).toISOString()
          : "",
        promoEndAt: editorForm.promoEndAt
          ? new Date(editorForm.promoEndAt).toISOString()
          : "",
        promoBannerUrl: editorForm.promoBannerUrl.trim() || "",
        preorderEnabled: !editorIsAddMail && editorForm.preorderEnabled,
        preorderFeePercent:
          editorForm.preorderEnabled && !editorIsAddMail
            ? parsePercentage(editorForm.preorderFeePercent, "Phí đặt trước")
            : 0,
      };

      payload.usageInstructions = editorForm.usageInstructions.trim() || "";

      if (selectedProduct.isManual) {
        payload.sourceName = editorForm.sourceName.trim() || displayName;
        payload.sourcePrice = parseRequiredNumber(
          editorForm.sourcePrice,
          t.errRequired(t.efIntCost),
          t.errInvalidNum(t.efIntCost),
        );
        payload.sourceDeliveryMode = editorForm.sourceDeliveryMode;
        payload.isShared = editorIsAddMail ? false : editorForm.isShared;
        if (editorIsAddMail) {
          payload.deliveryText = "";
          payload.deliveryFormatHint = null;
          const available = parseOptionalInteger(
            editorForm.available,
            t.errInvalidInt(t.efStock),
          );
          if (available !== undefined) payload.available = available;
        } else if (editorIsShared) {
          payload.sharedContent = editorForm.sharedContent.trim();
          const available = parseOptionalInteger(
            editorForm.available,
            t.errInvalidInt(t.efStock),
          );
          if (available !== undefined) payload.available = available;
        } else {
          payload.deliveryText = editorForm.deliveryText.trim();
          payload.deliveryFormatHint =
            editorForm.deliveryFormatHint.trim() || null;
          if (!editorUsesAutoStock) {
            const available = parseOptionalInteger(
              editorForm.available,
              t.errInvalidInt(t.efStock),
            );
            if (available !== undefined) payload.available = available;
          }
        }
      }

      // ULTRA wholesale fields áp dụng cho cả manual và source product
      if (isUltra) {
        payload.internalSourceEnabled = editorForm.internalSourceEnabled;
        payload.internalSourcePrice = editorForm.internalSourcePrice.trim()
          ? parseRequiredNumber(
              editorForm.internalSourcePrice,
              t.errRequired(t.efWholesale),
              t.errInvalidNum(t.efWholesale),
            )
          : null;
      }

      if (editorForm.productFamily)
        payload.productFamily = editorForm.productFamily;
      if (editorForm.productPackage)
        payload.productPackage = editorForm.productPackage;
      if (editorIsAddMail) payload.accountType = "ADD_FAMILY";
      else if (editorForm.accountType)
        payload.accountType = editorForm.accountType;
      if (editorForm.durationType)
        payload.durationType = editorForm.durationType;
      if (editorForm.warrantyPolicy)
        payload.warrantyPolicy = editorForm.warrantyPolicy;

      return api.put(`/products/${selectedProduct.id}`, payload);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({
          queryKey: ["products", selectedProduct?.id, "inventory"],
        }),
      ]);
      showToast({ tone: "success", message: t.savedProduct });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.errSaveFallback),
      });
    },
  });

  const resetToSourceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error(t.errNoProduct);
      await api.put(`/products/${selectedProduct.id}`, { resetToSource: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({
          queryKey: ["products", selectedProduct.id, "inventory"],
        }),
      ]);
      showToast({ tone: "success", message: t.savedProduct });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.errSaveFallback),
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const capturedGroupId = createForm.groupId;
      const displayName = createForm.displayName.trim();
      if (!displayName) throw new Error(t.errNoManualName);

      const payload: Record<string, unknown> = {
        displayName,
        sourceName: createForm.sourceName.trim() || displayName,
        sourceDescription: createForm.sourceDescription.trim(),
        salePrice: parseRequiredNumber(
          createForm.salePrice,
          t.errRequired(t.efSalePrice),
          t.errInvalidNum(t.efSalePrice),
        ),
        salePriceUsd: createForm.salePriceUsd.trim()
          ? parseRequiredNumber(
              createForm.salePriceUsd,
              t.errRequired(t.efUsd),
              t.errInvalidNum(t.efUsd),
            )
          : 0,
        sourcePrice: parseRequiredNumber(
          createForm.sourcePrice,
          t.errRequired(t.efIntCost),
          t.errInvalidNum(t.efIntCost),
        ),
        sourceDeliveryMode: createForm.sourceDeliveryMode,
        promoText: createForm.promoText.trim(),
        usageInstructions: createForm.usageInstructions.trim() || "",
        isShared: createIsAddMail ? false : createForm.isShared,
        hidden: createForm.hidden,
        hiddenVi: createForm.hiddenVi,
        hiddenEn: createForm.hiddenEn,
        enabled: createForm.enabled,
        preorderEnabled: !createIsAddMail && createForm.preorderEnabled,
        preorderFeePercent:
          createForm.preorderEnabled && !createIsAddMail
            ? parsePercentage(createForm.preorderFeePercent, "Phí đặt trước")
            : 0,
      };

      if (createIsAddMail) {
        payload.deliveryText = "";
        payload.deliveryFormatHint = null;
        const available = parseOptionalInteger(
          createForm.available,
          t.errInvalidInt(t.efStock),
        );
        if (available !== undefined) payload.available = available;
      } else if (createIsShared) {
        payload.sharedContent = createForm.sharedContent.trim();
        const available = parseOptionalInteger(
          createForm.available,
          t.errInvalidInt(t.efStock),
        );
        if (available !== undefined) payload.available = available;
      } else {
        payload.deliveryText = createForm.deliveryText.trim();
        payload.deliveryFormatHint =
          createForm.deliveryFormatHint.trim() || null;
        if (!createUsesAutoStock) {
          const available = parseOptionalInteger(
            createForm.available,
            t.errInvalidInt(t.efStock),
          );
          if (available !== undefined) payload.available = available;
        }
      }

      if (isUltra) {
        payload.internalSourceEnabled = createForm.internalSourceEnabled;
        payload.internalSourcePrice = createForm.internalSourcePrice.trim()
          ? parseRequiredNumber(
              createForm.internalSourcePrice,
              t.errRequired(t.efWholesale),
              t.errInvalidNum(t.efWholesale),
            )
          : null;
      }

      if (createForm.imageUrl.trim())
        payload.imageUrl = createForm.imageUrl.trim();
      if (createForm.productIcon.trim())
        payload.productIcon = createForm.productIcon.trim();
      if (createForm.iconCustomEmojiId.trim())
        payload.iconCustomEmojiId = createForm.iconCustomEmojiId.trim();
      if (createForm.productFamily)
        payload.productFamily = createForm.productFamily;
      if (createForm.productPackage)
        payload.productPackage = createForm.productPackage;
      if (createIsAddMail) payload.accountType = "ADD_FAMILY";
      else if (createForm.accountType)
        payload.accountType = createForm.accountType;
      if (createForm.durationType)
        payload.durationType = createForm.durationType;
      if (createForm.warrantyPolicy)
        payload.warrantyPolicy = createForm.warrantyPolicy;

      const response = await api.post<Product>("/products/manual", payload);
      if (capturedGroupId) {
        try {
          await api.post("/catalog-groups/bulk-assign", {
            productIds: [response.data.id],
            groupId: capturedGroupId,
          });
        } catch {
          /* ignore, product already created */
        }
      }
      return response;
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setCreateForm(emptyManualForm);
      setSelectedId(response.data.id);
      setDrawerMode("edit");
      showToast({
        tone: "success",
        message: t.createdProduct(response.data.displayName),
      });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.errCreateFallback),
      });
    },
  });

  const openInventoryAfterUpdate = async () => {
    if (!selectedProduct || updateMutation.isPending) return;
    try {
      await updateMutation.mutateAsync();
      setStockStatusFilter("AVAILABLE");
      setDrawerMode(null);
      setStockModal("viewStock");
    } catch {
      // The mutation already shows the validation/API error; keep the editor open.
    }
  };

  const openInventoryAfterCreate = async () => {
    if (createMutation.isPending) return;
    try {
      const response = await createMutation.mutateAsync();
      setSelectedId(response.data.id);
      setStockStatusFilter("AVAILABLE");
      setDrawerMode(null);
      setStockModal("viewStock");
    } catch {
      // The mutation already shows the validation/API error; keep the create form open.
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (productId: string) =>
      api.delete(`/products/${productId}`),
    onSuccess: async (_, productId) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      if (selectedId === productId) {
        setSelectedId(null);
        setDrawerMode(null);
      }
      showToast({ tone: "success", message: t.deletedProduct });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.errDeleteFallback),
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (productId: string) =>
      api.post(`/products/${productId}/archive`),
    onSuccess: async (_, productId) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      if (selectedId === productId) {
        setSelectedId(null);
        setDrawerMode(null);
      }
      showToast({
        tone: "success",
        message:
          lang === "en"
            ? "Product archived."
            : lang === "th"
              ? "เก็บสินค้าแล้ว"
              : "Đã lưu trữ sản phẩm.",
      });
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(
          error,
          lang === "en"
            ? "Could not archive this product."
            : "Không thể lưu trữ sản phẩm này.",
        ),
      }),
  });

  const restoreMutation = useMutation({
    mutationFn: async (productId: string) =>
      api.post(`/products/${productId}/restore`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      showToast({
        tone: "success",
        message:
          lang === "en"
            ? "Product restored."
            : lang === "th"
              ? "กู้คืนสินค้าแล้ว"
              : "Đã khôi phục sản phẩm.",
      });
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(
          error,
          lang === "en"
            ? "Could not restore this product."
            : "Không thể khôi phục sản phẩm này.",
        ),
      }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (productId: string) =>
      (await api.post<{ id: string }>(`/products/${productId}/duplicate`)).data,
    onSuccess: async (newProduct) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setSelectedId(newProduct.id);
      setDrawerMode("edit");
      showToast({ tone: "success", message: t.aDuplicate + " thành công" });
    },
    onError: () => {
      showToast({ tone: "error", message: "Không thể nhân bản sản phẩm." });
    },
  });

  const toggleHiddenMutation = useMutation({
    mutationFn: async ({ id, hidden }: { id: string; hidden: boolean }) =>
      api.put(`/products/${id}`, { hidden }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.errToggleFallback),
      });
    },
  });

  const visibilityEverywhereMutation = useMutation({
    mutationFn: async ({
      productId,
      show,
    }: {
      productId: string;
      show: boolean;
    }) =>
      api.post(
        `/products/${productId}/${show ? "show-everywhere" : "hide-everywhere"}`,
      ),
    onSuccess: async (_, { productId, show }) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      if (selectedId === productId) {
        setEditorForm((current) => ({
          ...current,
          hidden: !show,
          enabled: show,
          internalSourceEnabled: show,
        }));
      }
      showToast({
        tone: "success",
        message: show
          ? lang === "en"
            ? "Product shown on the bot and enabled for all resellers."
            : lang === "th"
              ? "แสดงสินค้าบนบอทและเปิดขายให้ตัวแทนทั้งหมดแล้ว"
              : "Đã hiện sản phẩm trên bot và bật bán cho toàn bộ đại lý."
          : lang === "en"
            ? "Product hidden from the bot and all resellers."
            : lang === "th"
              ? "ซ่อนสินค้าจากบอทและตัวแทนทั้งหมดแล้ว"
              : "Đã ẩn sản phẩm khỏi bot và toàn bộ đại lý.",
      });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.errToggleFallback),
      });
    },
  });

  const isHiddenEverywhere = (product: Product) =>
    product.hidden &&
    !product.enabled &&
    product.internalSourceEnabled === false;

  const toggleEverywhere = (product: Product) => {
    const show = isHiddenEverywhere(product);
    const message = show
      ? lang === "en"
        ? `Show "${product.displayName}" on the bot and enable it for all resellers?`
        : lang === "th"
          ? `แสดง "${product.displayName}" บนบอทและเปิดขายให้ตัวแทนทั้งหมดหรือไม่?`
          : `Hiện "${product.displayName}" lại trên bot và bật bán cho toàn bộ đại lý?`
      : lang === "en"
        ? `Hide "${product.displayName}" from the bot and all resellers?`
        : lang === "th"
          ? `ซ่อน "${product.displayName}" จากบอทและตัวแทนทั้งหมดหรือไม่?`
          : `Ẩn "${product.displayName}" khỏi bot và ngừng bán cho toàn bộ đại lý?`;
    if (window.confirm(message)) {
      visibilityEverywhereMutation.mutate({ productId: product.id, show });
    }
  };

  const reorderMutation = useMutation({
    mutationFn: async (items: { id: string; position: number }[]) =>
      api.post(`/products/reorder`, { items }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.errToggleFallback),
      });
    },
  });
  const [draggedProductId, setDraggedProductId] = useState<string | null>(null);
  const handleProductDrop = (targetId: string) => {
    if (!draggedProductId || draggedProductId === targetId) {
      setDraggedProductId(null);
      return;
    }
    const fromIdx = filteredProducts.findIndex(
      (p) => p.id === draggedProductId,
    );
    const toIdx = filteredProducts.findIndex((p) => p.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDraggedProductId(null);
      return;
    }
    const next = [...filteredProducts];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) {
      setDraggedProductId(null);
      return;
    }
    next.splice(toIdx, 0, moved);
    reorderMutation.mutate(next.map((p, i) => ({ id: p.id, position: i })));
    setDraggedProductId(null);
  };

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
        queryClient.invalidateQueries({
          queryKey: ["products", selectedProduct?.id, "inventory"],
        }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
      showToast({ tone: "success", message: t.purgedMsg });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.errPurgeFallback),
      });
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: async ({
      name,
      description,
    }: {
      name: string;
      description: string;
    }) => (await api.post("/catalog-groups", { name, description })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog-groups"] });
      setNewGroupName("");
      setNewGroupDescription("");
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không thể tạo danh mục."),
      }),
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      description,
      icon,
    }: {
      id: string;
      name?: string;
      description?: string;
      icon?: string;
    }) =>
      api.put(`/catalog-groups/${id}`, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(icon !== undefined ? { icon } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog-groups"] });
      setEditingGroupId(null);
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không thể cập nhật danh mục."),
      }),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/catalog-groups/${id}`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không thể xóa danh mục."),
      }),
  });

  const reorderGroupsMutation = useMutation({
    mutationFn: async (orderedIds: string[]) =>
      api.put("/catalog-groups/reorder", { orderedIds }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["catalog-groups"] }),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({
      productIds,
      groupId,
    }: {
      productIds: string[];
      groupId: string | null;
    }) => api.post("/catalog-groups/bulk-assign", { productIds, groupId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setCheckedIds(new Set());
      setShowAssignDropdown(false);
      showToast({ tone: "success", message: "Đã cập nhật danh mục." });
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không thể gán danh mục."),
      }),
  });

  const bulkSourceStatusMutation = useMutation({
    mutationFn: async (action: "PUBLISH" | "PENDING") => {
      const productIds = Array.from(checkedIds).filter((id) =>
        products.some(
          (product) => product.id === id && Boolean(product.providerSourceId),
        ),
      );
      return (
        await api.post<{
          updated: number;
          skipped: number;
        }>("/products/source-warehouse/bulk-status", {
          productIds,
          action,
        })
      ).data;
    },
    onSuccess: async (result, action) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setCheckedIds(new Set());
      showToast({
        tone: "success",
        message:
          action === "PUBLISH"
            ? `Đã duyệt bán ${result.updated} sản phẩm nguồn.`
            : `Đã đưa ${result.updated} sản phẩm về chờ duyệt.`,
      });
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(
          error,
          "Không thể cập nhật trạng thái sản phẩm nguồn.",
        ),
      }),
  });

  const addAccountsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct || !addAccountsText.trim()) return;
      const existing = (editorForm.deliveryText || "").trim();
      // Filter empty lines from new input
      const newLines = addAccountsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
      const combined = [existing, newLines].filter(Boolean).join("\n");
      // Force isShared: false — inventory drawer is for unique-delivery products only
      return api.put(`/products/${selectedProduct.id}`, {
        deliveryText: combined,
        isShared: false,
      });
    },
    onSuccess: async () => {
      setAddAccountsText("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["products", selectedProduct?.id, "inventory"],
        }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
      showToast({ tone: "success", message: t.addStockSuccess });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, t.addStockErr),
      });
    },
  });

  // === Manual stock: upload / extract / history (per source product) ===
  const uploadStockMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedProduct) throw new Error(t.errNoProduct);
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post<{
        added: number;
        totalBefore: number;
        totalAfter: number;
        preview: string[];
      }>(`/products/source-products/${selectedProduct.id}/stock/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return res.data;
    },
    onSuccess: async (data) => {
      setUploadResult(data);
      setStockModal("uploadResult");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({
          queryKey: ["products", selectedProduct?.id, "inventory"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["stock-history", selectedProduct?.id],
        }),
      ]);
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không thể upload kho."),
      });
    },
  });

  const extractStockMutation = useMutation({
    mutationFn: async (payload: ExtractPayload) => {
      if (!selectedProduct) throw new Error(t.errNoProduct);
      // Map legacy frontend mode "MANUAL" to backend "MANUAL_BY_INDEX"
      const apiPayload: any = { ...payload };
      if (apiPayload.mode === "MANUAL") apiPayload.mode = "MANUAL_BY_INDEX";
      const res = await api.post<{
        extracted: string[];
        totalBefore: number;
        totalAfter: number;
        method: StockExtractMethod;
        dryRun?: boolean;
      }>(
        `/products/source-products/${selectedProduct.id}/stock/extract`,
        apiPayload,
      );
      return { ...res.data, dryRun: res.data.dryRun ?? payload.dryRun };
    },
    onSuccess: async (data) => {
      setExtractResult(data);
      setStockModal("extractResult");
      if (!data.dryRun) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["products"] }),
          queryClient.invalidateQueries({
            queryKey: ["products", selectedProduct?.id, "inventory"],
          }),
          queryClient.invalidateQueries({
            queryKey: ["stock-history", selectedProduct?.id],
          }),
        ]);
      }
    },
    onError: (error) => {
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không thể bóc kho."),
      });
    },
  });

  const listStockEntries = useCallback(
    async (params: {
      limit: number;
      offset: number;
      search: string;
    }): Promise<EntryListPage> => {
      if (!selectedProduct) {
        return { items: [], total: 0, filteredTotal: 0 };
      }
      const res = await api.get<EntryListPage>(
        `/products/source-products/${selectedProduct.id}/stock/entries`,
        { params },
      );
      return res.data;
    },
    [selectedProduct],
  );

  const createBatchMutation = useMutation({
    mutationFn: async (payload: CreateBatchPayload) => {
      if (!selectedProduct) throw new Error("No product");
      const fd = new FormData();
      fd.append("name", payload.name);
      if (payload.costPerAcc !== undefined)
        fd.append("costPerAcc", String(payload.costPerAcc));
      if (payload.totalCost !== undefined)
        fd.append("totalCost", String(payload.totalCost));
      if (payload.expiresInDays != null)
        fd.append("expiresInDays", String(payload.expiresInDays));
      if (payload.file) fd.append("file", payload.file);
      else if (payload.text) fd.append("text", payload.text);
      const res = await api.post(
        `/products/source-products/${selectedProduct.id}/stock/batches`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return res.data as {
        batchId: string;
        batchName: string;
        added: number;
        totalAfter: number;
        preview: string[];
      };
    },
    onSuccess: async (data) => {
      setCreateBatchResult(data);
      setStockModal(null);
      showToast({
        tone: "success",
        message: `Đã tạo lô "${data.batchName}" — thêm ${data.added} acc.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({
          queryKey: ["stock-batches", selectedProduct?.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["stock-view", selectedProduct?.id],
        }),
      ]);
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không tạo được lô."),
      }),
  });

  const stockBatchesQuery = useQuery<{
    legacy: { availableCount: number };
    batches: StockBatchSummary[];
  }>({
    queryKey: ["stock-batches", selectedProduct?.id],
    enabled: Boolean(selectedProduct?.id) && stockModal === "viewStock",
    queryFn: async () =>
      (
        await api.get(
          `/products/source-products/${selectedProduct?.id}/stock/batches`,
        )
      ).data,
  });

  const stockViewQuery = useQuery<ViewStockData>({
    queryKey: [
      "stock-view",
      selectedProduct?.id,
      stockStatusFilter,
      stockSearch,
    ],
    enabled: Boolean(selectedProduct?.id) && stockModal === "viewStock",
    queryFn: async () => {
      // Load the complete inventory so totals and whole-batch selection are not
      // silently capped at 1,000 rows.
      const params: Record<string, any> = { limit: 100000 };
      if (stockStatusFilter !== "ALL") params.status = stockStatusFilter;
      if (stockSearch) params.search = stockSearch;
      const res = await api.get(
        `/products/source-products/${selectedProduct?.id}/stock/entries`,
        { params },
      );
      return res.data;
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: async (batchId: string) => {
      if (!selectedProduct) throw new Error("No product");
      const res = await api.delete(
        `/products/source-products/${selectedProduct.id}/stock/batches/${batchId}`,
      );
      return res.data;
    },
    onSuccess: async () => {
      showToast({ tone: "success", message: "Đã xóa lô." });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["stock-batches", selectedProduct?.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["stock-view", selectedProduct?.id],
        }),
      ]);
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không xóa được lô."),
      }),
  });

  const setBatchPriorityMutation = useMutation({
    mutationFn: async ({
      batchId,
      priority,
    }: {
      batchId: string;
      priority: number;
    }) => {
      if (!selectedProduct) throw new Error("No product");
      const res = await api.patch(
        `/products/source-products/${selectedProduct.id}/stock/batches/${batchId}`,
        { priority },
      );
      return res.data;
    },
    onSuccess: async () => {
      showToast({ tone: "success", message: "Đã cập nhật ưu tiên." });
      await queryClient.invalidateQueries({
        queryKey: ["stock-batches", selectedProduct?.id],
      });
    },
    onError: (error) =>
      showToast({
        tone: "error",
        message: getErrorMessage(error, "Không cập nhật được ưu tiên."),
      }),
  });

  const stockHistoryQuery = useQuery<{
    items: StockOperation[];
    total: number;
  }>({
    queryKey: ["stock-history", selectedProduct?.id],
    enabled: Boolean(selectedProduct?.id) && stockModal === "history",
    queryFn: async () =>
      (
        await api.get(
          `/products/source-products/${selectedProduct?.id}/stock/history`,
          {
            params: { limit: 100 },
          },
        )
      ).data,
  });

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCheckAll = () => {
    const filteredIds = filteredProducts.map((product) => product.id);
    const allFilteredChecked =
      filteredIds.length > 0 &&
      filteredIds.every((productId) => checkedIds.has(productId));
    setCheckedIds((previous) => {
      const next = new Set(previous);
      for (const productId of filteredIds) {
        if (allFilteredChecked) next.delete(productId);
        else next.add(productId);
      }
      return next;
    });
  };

  const handleDragStart = (id: string) => setDragGroupId(id);
  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragGroupId || dragGroupId === targetId) return;
    const currentOrder = [...groups].sort((a, b) => a.position - b.position);
    const fromIdx = currentOrder.findIndex((g) => g.id === dragGroupId);
    const toIdx = currentOrder.findIndex((g) => g.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...currentOrder];
    const spliced = reordered.splice(fromIdx, 1);
    const moved = spliced[0];
    if (!moved) return;
    reordered.splice(toIdx, 0, moved);
    reorderGroupsMutation.mutate(reordered.map((g) => g.id));
  };

  const currentProducts = products.filter((item) => !item.archivedAt);
  const activeCount = currentProducts.filter(
    (item) => item.enabled && !item.hidden,
  ).length;
  const hiddenCount = currentProducts.filter((item) => item.hidden).length;
  const manualCount = currentProducts.filter((item) => item.isManual).length;
  const pausedCount = currentProducts.filter((item) => !item.enabled).length;
  const pendingCount = currentProducts.filter(
    (item) => item.providerSourceId && (!item.enabled || item.hidden),
  ).length;
  const archivedCount = products.filter((item) =>
    Boolean(item.archivedAt),
  ).length;
  const totalSales = products.reduce(
    (sum, item) => sum + Number(item.soldCount || 0),
    0,
  );
  const sourceCount = Math.max(currentProducts.length - manualCount, 0);
  const visibleCount = filteredProducts.length;
  const checkedProviderProductCount = Array.from(checkedIds).filter((id) =>
    products.some(
      (product) => product.id === id && Boolean(product.providerSourceId),
    ),
  ).length;
  const filteredCheckedCount = filteredProducts.filter((product) =>
    checkedIds.has(product.id),
  ).length;
  const manualInventory = inventoryQuery.data;

  const filters: { value: ProductFilter; label: string }[] = [
    { value: "all", label: t.fAll },
    { value: "manual", label: t.fManual },
    {
      value: "pending",
      label: `${lang === "en" ? "Pending review" : lang === "th" ? "รอตรวจสอบ" : "Chờ duyệt"} (${pendingCount})`,
    },
    { value: "active", label: t.fActive },
    { value: "hidden", label: t.fHidden },
    { value: "paused", label: t.fPaused },
    {
      value: "archived",
      label: `${lang === "en" ? "Archived" : lang === "th" ? "เก็บถาวร" : "Đã lưu trữ"} (${archivedCount})`,
    },
  ];

  const renderSelectedProductEditor = () => {
    if (!selectedProduct) {
      return null;
    }

    return (
      <div
        className="space-y-6 px-4 pb-4 pt-5 lg:px-5"
        style={{ borderTop: "1px solid var(--bd)" }}
      >
        <div
          className={`grid gap-2 ${selectedProduct.isManual ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}
        >
          {/* Tồn kho */}
          <div
            className="rounded-xl px-3 py-2.5 flex items-center gap-2.5"
            style={{
              background: "var(--inp)",
              borderLeft: "3px solid rgb(56,189,248)",
            }}
          >
            <Package
              className="h-4 w-4 shrink-0"
              style={{ color: "rgb(56,189,248)" }}
            />
            <div className="min-w-0">
              <p
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--tx-f)" }}
              >
                {t.statStock}
              </p>
              <p
                className="text-base font-black tabular-nums"
                style={{ color: "var(--tx)" }}
              >
                {selectedProduct.available ?? "∞"}
              </p>
            </div>
          </div>

          {/* Đã bán */}
          <div
            className="rounded-xl px-3 py-2.5 flex items-center gap-2.5"
            style={{
              background: "var(--inp)",
              borderLeft: "3px solid rgb(167,139,250)",
            }}
          >
            <PackageCheck
              className="h-4 w-4 shrink-0"
              style={{ color: "rgb(167,139,250)" }}
            />
            <div className="min-w-0">
              <p
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--tx-f)" }}
              >
                {t.statSold}
              </p>
              <p
                className="text-base font-black tabular-nums"
                style={{ color: "var(--tx)" }}
              >
                {selectedProduct.soldCount}
              </p>
            </div>
          </div>

          {/* Lợi nhuận */}
          <div
            className="rounded-xl px-3 py-2.5 flex items-center gap-2.5"
            style={{
              background: "var(--inp)",
              borderLeft: "3px solid rgb(52,211,153)",
            }}
          >
            <TrendingUp
              className="h-4 w-4 shrink-0"
              style={{ color: "rgb(52,211,153)" }}
            />
            <div className="min-w-0">
              <p
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--tx-f)" }}
              >
                {t.statProfit}
              </p>
              <p className="text-base font-black tabular-nums truncate text-emerald-400">
                {formatCurrency(
                  Number(editorForm.salePrice || 0) -
                    Number(editorForm.sourcePrice || 0),
                )}
              </p>
            </div>
          </div>

          {/* Giá nguồn — chỉ synced */}
          {!selectedProduct.isManual && (
            <div
              className="rounded-xl px-3 py-2.5 flex items-center gap-2.5"
              style={{
                background: "var(--inp)",
                borderLeft: "3px solid rgb(148,163,184)",
              }}
              title={t.syncedNote}
            >
              <Wallet
                className="h-4 w-4 shrink-0"
                style={{ color: "rgb(148,163,184)" }}
              />
              <div className="min-w-0">
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: "var(--tx-f)" }}
                >
                  {t.statSourcePrice}
                </p>
                <p
                  className="text-base font-black tabular-nums truncate"
                  style={{ color: "var(--tx-m)" }}
                >
                  {formatCurrency(selectedProduct.sourcePrice)}
                </p>
              </div>
            </div>
          )}
        </div>

        <Field label={t.fDisplayName} hint={t.hBotName}>
          <StudioInput
            placeholder={t.phDisplayName}
            value={editorForm.displayName}
            onChange={(event) =>
              setEditorForm((current) => ({
                ...current,
                displayName: event.target.value,
              }))
            }
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.fSalePrice} hint={t.hVnd}>
            <StudioInput
              placeholder={t.phSalePrice}
              value={editorForm.salePrice}
              onChange={(event) =>
                setEditorForm((current) => ({
                  ...current,
                  salePrice: event.target.value,
                }))
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
              onChange={(e) =>
                setEditorForm((c) => ({ ...c, salePriceUsd: e.target.value }))
              }
            />
          </Field>
        </div>

        <PreorderSettings
          enabled={editorForm.preorderEnabled}
          feePercent={editorForm.preorderFeePercent}
          disabled={editorIsAddMail}
          onEnabledChange={(preorderEnabled) =>
            setEditorForm((current) => ({ ...current, preorderEnabled }))
          }
          onFeeChange={(preorderFeePercent) =>
            setEditorForm((current) => ({ ...current, preorderFeePercent }))
          }
        />

        {isUltra && (
          <div
            className="rounded-[14px] px-3 py-2.5 space-y-2"
            style={{
              background: "rgba(139,92,246,0.06)",
              border: "1px solid rgba(139,92,246,0.2)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5"
                style={{ color: "rgb(167,139,250)" }}
              >
                <Crown className="h-3 w-3" /> {t.wholesaleTitle}
              </p>
              <button
                type="button"
                onClick={() =>
                  setEditorForm((c) => ({
                    ...c,
                    internalSourceEnabled: !c.internalSourceEnabled,
                  }))
                }
                className="rounded-lg px-2.5 py-1 text-[11px] font-bold transition"
                style={{
                  borderColor: editorForm.internalSourceEnabled
                    ? "rgba(139,92,246,0.3)"
                    : "var(--bd)",
                  background: editorForm.internalSourceEnabled
                    ? "rgba(139,92,246,0.15)"
                    : "var(--inp)",
                  color: editorForm.internalSourceEnabled
                    ? "rgb(167,139,250)"
                    : "var(--tx-f)",
                  border: "1px solid",
                }}
              >
                {t.allowProBuy}:{" "}
                {editorForm.internalSourceEnabled ? t.bOn : t.bOff}
              </button>
            </div>
            <StudioInput
              placeholder={t.phWholesale}
              value={editorForm.internalSourcePrice}
              onChange={(e) =>
                setEditorForm((c) => ({
                  ...c,
                  internalSourcePrice: e.target.value,
                }))
              }
            />
          </div>
        )}

        {selectedProduct.isManual && (
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
                description={
                  editorUsesAutoStock
                    ? t.dStockAuto
                    : editorIsShared
                      ? t.dStockShared
                      : t.dStockManual
                }
              >
                <StudioInput
                  disabled={editorUsesAutoStock}
                  placeholder={
                    editorUsesAutoStock ? t.phStockAuto : t.phStockManual
                  }
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
                <StudioTextArea
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

            <Field label="Loại giao hàng" hint={t.hRequired}>
              <select
                value={editorForm.sourceDeliveryMode}
                onChange={(e) => {
                  const sourceDeliveryMode = e.target.value;
                  setEditorForm((c) => ({
                    ...c,
                    sourceDeliveryMode,
                    accountType:
                      sourceDeliveryMode === "ADD_MAIL"
                        ? "ADD_FAMILY"
                        : c.accountType,
                    isShared:
                      sourceDeliveryMode === "ADD_MAIL" ? false : c.isShared,
                    deliveryText:
                      sourceDeliveryMode === "ADD_MAIL" ? "" : c.deliveryText,
                    preorderEnabled:
                      sourceDeliveryMode === "ADD_MAIL"
                        ? false
                        : c.preorderEnabled,
                  }));
                }}
                className="h-11 w-full rounded-[14px] border px-3 text-sm"
                style={{
                  borderColor: "var(--bd)",
                  background: "var(--inp)",
                  color: "var(--tx)",
                }}
              >
                {sourceDeliveryModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Kiểu nội dung giao hàng" hint={t.hManualDelivery}>
              <div className="flex flex-col gap-2">
                {(
                  [
                    ["unique", t.deliveryModeUnique],
                    ["shared", t.deliveryModeShared],
                  ] as const
                ).map(([mode, label]) => (
                  <label
                    key={mode}
                    className="flex items-start gap-2.5 cursor-pointer select-none"
                  >
                    <input
                      type="radio"
                      name="editor-delivery-mode"
                      checked={
                        mode === "shared"
                          ? editorForm.isShared
                          : !editorForm.isShared
                      }
                      disabled={editorIsAddMail}
                      onChange={() =>
                        setEditorForm((c) => ({
                          ...c,
                          isShared: mode === "shared",
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span className="text-sm" style={{ color: "var(--tx-m)" }}>
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            {editorIsAddMail ? (
              <div
                className="rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-3 text-sm"
                style={{ color: "var(--tx-m)" }}
              >
                Bot sẽ yêu cầu khách nhập email trước khi thanh toán. Email được
                hiển thị trong mục Đơn chờ xử lý để seller copy và thêm vào
                Family.
              </div>
            ) : editorIsShared ? (
              <Field
                label={t.fSharedContent}
                hint={t.hRequired}
                description={t.dSharedContent}
              >
                <StudioTextArea
                  placeholder={t.phSharedContent}
                  value={editorForm.sharedContent}
                  onChange={(e) =>
                    setEditorForm((c) => ({
                      ...c,
                      sharedContent: e.target.value,
                    }))
                  }
                />
              </Field>
            ) : (
              <>
                <Field
                  label={t.fDeliveryFormat}
                  hint={t.hOptional}
                  description={t.dDeliveryFormat}
                >
                  <StudioInput
                    placeholder={t.phDeliveryFormat}
                    value={editorForm.deliveryFormatHint}
                    onChange={(e) =>
                      setEditorForm((c) => ({
                        ...c,
                        deliveryFormatHint: e.target.value,
                      }))
                    }
                  />
                </Field>
                <div
                  className="rounded-xl border px-4 py-3 text-sm"
                  style={{
                    borderColor: "rgba(249,115,22,0.28)",
                    background: "rgba(249,115,22,0.08)",
                    color: "var(--tx-m)",
                  }}
                >
                  {inventoryPrompt}
                  <button
                    type="button"
                    onClick={openInventoryAfterUpdate}
                    disabled={updateMutation.isPending}
                    className="font-black text-orange-400 underline decoration-orange-400/50 underline-offset-4 transition hover:text-orange-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updateMutation.isPending
                      ? savingBeforeInventory
                      : inventoryLinkLabel}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        <div
          className="space-y-4 rounded-2xl border p-4"
          style={{ borderColor: "var(--bd)", background: "var(--inp)" }}
        >
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.24em]"
            style={{ color: "var(--tx-f)" }}
          >
            Phân loại sản phẩm
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Dòng sản phẩm" hint={t.hOptional}>
              <select
                value={editorForm.productFamily}
                onChange={(e) => {
                  const newFamily = e.target.value;
                  setEditorForm((c) => ({
                    ...c,
                    productFamily: newFamily,
                    productPackage:
                      c.productFamily === newFamily ? c.productPackage : "",
                  }));
                }}
                className="h-11 w-full rounded-[14px] border px-3 text-sm"
                style={{
                  borderColor: "var(--bd)",
                  background: "var(--inp)",
                  color: "var(--tx)",
                }}
              >
                <option value="">— Chọn —</option>
                {familyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Gói sản phẩm" hint={t.hOptional}>
              <select
                value={editorForm.productPackage}
                disabled={
                  !editorForm.productFamily ||
                  editorForm.productFamily === "OTHER"
                }
                onChange={(e) =>
                  setEditorForm((c) => ({
                    ...c,
                    productPackage: e.target.value,
                  }))
                }
                className="h-11 w-full rounded-[14px] border px-3 text-sm disabled:opacity-50"
                style={{
                  borderColor: "var(--bd)",
                  background: "var(--inp)",
                  color: "var(--tx)",
                }}
              >
                <option value="">— Chọn —</option>
                {(
                  sourceProductPackageOptions[editorForm.productFamily] || []
                ).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Loại tài khoản" hint={t.hOptional}>
              <select
                value={editorForm.accountType}
                disabled={editorIsAddMail}
                onChange={(e) =>
                  setEditorForm((c) => ({ ...c, accountType: e.target.value }))
                }
                className="h-11 w-full rounded-[14px] border px-3 text-sm"
                style={{
                  borderColor: "var(--bd)",
                  background: "var(--inp)",
                  color: "var(--tx)",
                }}
              >
                <option value="">— Chọn —</option>
                {sourceAccountTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Thời hạn" hint={t.hOptional}>
              <select
                value={editorForm.durationType}
                onChange={(e) =>
                  setEditorForm((c) => ({ ...c, durationType: e.target.value }))
                }
                className="h-11 w-full rounded-[14px] border px-3 text-sm"
                style={{
                  borderColor: "var(--bd)",
                  background: "var(--inp)",
                  color: "var(--tx)",
                }}
              >
                <option value="">— Chọn —</option>
                {sourceDurationTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div
          className="space-y-4 rounded-2xl border p-4"
          style={{ borderColor: "var(--bd)", background: "var(--inp)" }}
        >
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.24em]"
            style={{ color: "var(--tx-f)" }}
          >
            Bảo hành
          </p>
          <Field label="Chính sách bảo hành" hint={t.hOptional}>
            <select
              value={editorForm.warrantyPolicy}
              onChange={(e) =>
                setEditorForm((c) => ({ ...c, warrantyPolicy: e.target.value }))
              }
              className="h-11 w-full rounded-[14px] border px-3 text-sm"
              style={{
                borderColor: "var(--bd)",
                background: "var(--inp)",
                color: "var(--tx)",
              }}
            >
              {sourceWarrantyPolicyOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {!selectedProduct.isManual && (
          <Field label={t.fDesc} hint={t.hOptional} description={t.dDesc}>
            <StudioTextArea
              placeholder={t.phDesc}
              value={editorForm.sourceDescription}
              onChange={(event) =>
                setEditorForm((current) => ({
                  ...current,
                  sourceDescription: event.target.value,
                }))
              }
            />
          </Field>
        )}

        <Field
          label={t.fUsageInstructions}
          hint={t.hOptional}
          description={t.dUsageInstructions}
        >
          <StudioTextArea
            placeholder={t.phUsageInstructions}
            value={editorForm.usageInstructions}
            onChange={(e) =>
              setEditorForm((c) => ({
                ...c,
                usageInstructions: e.target.value,
              }))
            }
          />
        </Field>

        <Field
          label={t.fProductIcon}
          hint={t.hOptional}
          description={t.dProductIcon}
        >
          <div className="flex items-center gap-2">
            {(() => {
              const matched = editorForm.iconCustomEmojiId
                ? iconCatalog.find(
                    (i) => i.customEmojiId === editorForm.iconCustomEmojiId,
                  )
                : null;
              return (
                <button
                  type="button"
                  onClick={() => setIconPickerTarget("editor")}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border hover:opacity-80"
                  style={{ borderColor: "var(--bd)", background: "var(--inp)" }}
                  title="Chọn icon từ thư viện"
                >
                  {matched ? (
                    <img
                      src={matched.imageUrl}
                      alt=""
                      className="h-7 w-7 object-contain"
                    />
                  ) : editorForm.productIcon ? (
                    <span className="text-xl leading-none">
                      {editorForm.productIcon}
                    </span>
                  ) : (
                    <Plus
                      className="h-4 w-4"
                      style={{ color: "var(--tx-f)" }}
                    />
                  )}
                </button>
              );
            })()}
            <StudioInput
              placeholder={t.phProductIcon}
              value={editorForm.productIcon}
              onChange={(event) =>
                setEditorForm((current) => ({
                  ...current,
                  productIcon: event.target.value,
                }))
              }
            />
            {editorForm.iconCustomEmojiId && (
              <button
                type="button"
                onClick={() =>
                  setEditorForm((c) => ({ ...c, iconCustomEmojiId: "" }))
                }
                className="text-xs text-rose-400 hover:underline"
              >
                bỏ icon
              </button>
            )}
          </div>
        </Field>

        <Field label={t.fImageUrl} hint={t.hOptional} description={t.dImageUrl}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-[14px] border px-3 py-2 text-sm font-medium transition hover:opacity-80"
                style={{
                  borderColor: "var(--bd)",
                  background: "var(--inp)",
                  color: "var(--tx-m)",
                }}
              >
                <Upload className="h-3.5 w-3.5" />
                {editorImageUploading
                  ? "..."
                  : lang === "vi"
                    ? "Tải ảnh lên"
                    : "Upload"}
                <input
                  type="file"
                  accept="image/*,video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  disabled={editorImageUploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setEditorImageUploading(true);
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await api.post<{ url: string }>(
                        "/products/upload-image",
                        fd,
                        { headers: { "Content-Type": "multipart/form-data" } },
                      );
                      setEditorForm((c) => ({ ...c, imageUrl: res.data.url }));
                    } catch {
                      // keep existing URL on error
                    } finally {
                      setEditorImageUploading(false);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
              <StudioInput
                placeholder={t.phImageUrl}
                value={editorForm.imageUrl}
                onChange={(event) =>
                  setEditorForm((current) => ({
                    ...current,
                    imageUrl: event.target.value,
                  }))
                }
              />
            </div>
            {editorForm.imageUrl.trim() && (
              <MediaPreview
                url={editorForm.imageUrl}
                className="h-16 w-16 rounded-xl object-cover"
              />
            )}
          </div>
        </Field>

        {/* Language toggle — chỉ 2 chip nhỏ inline */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[11px] font-bold uppercase tracking-wide"
            style={{ color: "var(--tx-f)" }}
          >
            Hiển thị:
          </span>
          <button
            type="button"
            onClick={() =>
              setEditorForm((c) => ({ ...c, hiddenVi: !c.hiddenVi }))
            }
            className="rounded-md px-2 py-0.5 text-[11px] font-bold transition"
            style={{
              background: editorForm.hiddenVi
                ? "rgba(100,116,139,0.15)"
                : "rgba(52,211,153,0.15)",
              color: editorForm.hiddenVi ? "var(--tx-f)" : "rgb(52,211,153)",
              border: `1px solid ${editorForm.hiddenVi ? "var(--bd)" : "rgba(52,211,153,0.3)"}`,
            }}
            title={editorForm.hiddenVi ? t.hiddenViOn : t.hiddenViOff}
          >
            🇻🇳 {editorForm.hiddenVi ? "ẩn" : "✓"}
          </button>
          <button
            type="button"
            onClick={() =>
              setEditorForm((c) => ({ ...c, hiddenEn: !c.hiddenEn }))
            }
            className="rounded-md px-2 py-0.5 text-[11px] font-bold transition"
            style={{
              background: editorForm.hiddenEn
                ? "rgba(100,116,139,0.15)"
                : "rgba(52,211,153,0.15)",
              color: editorForm.hiddenEn ? "var(--tx-f)" : "rgb(52,211,153)",
              border: `1px solid ${editorForm.hiddenEn ? "var(--bd)" : "rgba(52,211,153,0.3)"}`,
            }}
            title={editorForm.hiddenEn ? t.hiddenEnOn : t.hiddenEnOff}
          >
            🌍 {editorForm.hiddenEn ? "ẩn" : "✓"}
          </button>
        </div>

        <button
          className="w-full rounded-xl border px-3 py-2.5 text-left transition"
          style={{
            borderColor:
              editorForm.enabled && !editorForm.hidden
                ? "rgba(52,211,153,0.25)"
                : "var(--bd)",
            background:
              editorForm.enabled && !editorForm.hidden
                ? "rgba(16,185,129,0.08)"
                : "var(--inp)",
          }}
          onClick={() => {
            const willShow = !(editorForm.enabled && !editorForm.hidden);
            setEditorForm((current) => ({
              ...current,
              enabled: willShow,
              hidden: !willShow,
            }));
          }}
          type="button"
          title="Bật/tắt sản phẩm trên bot"
        >
          <div className="flex items-center justify-between gap-2">
            <p
              className="text-[13px] font-semibold"
              style={{ color: "var(--tx)" }}
            >
              Hiển thị trên bot
            </p>
            <StudioBadge
              tone={
                editorForm.enabled && !editorForm.hidden ? "success" : "neutral"
              }
            >
              {editorForm.enabled && !editorForm.hidden ? t.bOn : t.bOff}
            </StudioBadge>
          </div>
        </button>

        {isUltra && selectedProduct && (
          <button
            className="w-full rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor:
                editorForm.hidden &&
                !editorForm.enabled &&
                !editorForm.internalSourceEnabled
                  ? "rgba(16,185,129,0.3)"
                  : "rgba(244,63,94,0.3)",
              background:
                editorForm.hidden &&
                !editorForm.enabled &&
                !editorForm.internalSourceEnabled
                  ? "rgba(16,185,129,0.08)"
                  : "rgba(244,63,94,0.08)",
            }}
            onClick={() => toggleEverywhere(selectedProduct)}
            type="button"
            disabled={visibilityEverywhereMutation.isPending}
            title={
              editorForm.hidden &&
              !editorForm.enabled &&
              !editorForm.internalSourceEnabled
                ? lang === "en"
                  ? "Show on the retail bot and enable distribution to every reseller"
                  : lang === "th"
                    ? "แสดงบนบอทและเปิดขายให้ตัวแทนทั้งหมด"
                    : "Hiện lại trên bot bán lẻ và bật phân phối cho toàn bộ đại lý"
                : lang === "en"
                  ? "Hide from the retail bot and stop distribution to every reseller"
                  : lang === "th"
                    ? "ซ่อนจากบอทและหยุดขายให้ตัวแทนทั้งหมด"
                    : "Ẩn khỏi bot bán lẻ và ngừng phân phối cho toàn bộ đại lý"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {editorForm.hidden &&
                !editorForm.enabled &&
                !editorForm.internalSourceEnabled ? (
                  <Eye className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Ban className="h-4 w-4 text-rose-500" />
                )}
                <div>
                  <p
                    className={`text-[13px] font-semibold ${
                      editorForm.hidden &&
                      !editorForm.enabled &&
                      !editorForm.internalSourceEnabled
                        ? "text-emerald-500"
                        : "text-rose-500"
                    }`}
                  >
                    {editorForm.hidden &&
                    !editorForm.enabled &&
                    !editorForm.internalSourceEnabled
                      ? lang === "en"
                        ? "Show everywhere"
                        : lang === "th"
                          ? "แสดงทั้งหมด"
                          : "Hiện toàn bộ"
                      : lang === "en"
                        ? "Hide everywhere"
                        : lang === "th"
                          ? "ซ่อนทั้งหมด"
                          : "Ẩn toàn bộ"}
                  </p>
                  <p
                    className="mt-0.5 text-[11px]"
                    style={{ color: "var(--tx-f)" }}
                  >
                    {editorForm.hidden &&
                    !editorForm.enabled &&
                    !editorForm.internalSourceEnabled
                      ? lang === "en"
                        ? "Show on the bot and enable selling for every F2 reseller."
                        : lang === "th"
                          ? "แสดงบนบอทและเปิดขายให้ตัวแทน F2 ทั้งหมด"
                          : "Hiện lại trên bot và bật bán cho toàn bộ đại lý F2."
                      : lang === "en"
                        ? "Hide from the bot and stop selling to every F2 reseller."
                        : lang === "th"
                          ? "ซ่อนจากบอทและหยุดขายให้ตัวแทน F2 ทั้งหมด"
                          : "Ẩn khỏi bot và ngừng bán ngay cho toàn bộ đại lý F2."}
                  </p>
                </div>
              </div>
              <StudioBadge
                tone={
                  editorForm.hidden &&
                  !editorForm.enabled &&
                  !editorForm.internalSourceEnabled
                    ? "success"
                    : "danger"
                }
              >
                {lang === "en" ? "Bot + F2" : "Bot + F2"}
              </StudioBadge>
            </div>
          </button>
        )}

        <div className="flex items-center gap-2">
          <StudioButton
            className="h-10 flex-1 text-sm"
            disabled={
              updateMutation.isPending ||
              resetToSourceMutation.isPending ||
              !selectedProduct
            }
            onClick={() => updateMutation.mutate()}
          >
            <Save className="h-4 w-4" />
            {updateMutation.isPending ? t.saving : t.saveProduct}
          </StudioButton>

          {selectedProduct && !selectedProduct.isManual && (
            <StudioButton
              className="h-10 px-3 text-sm"
              variant="secondary"
              disabled={
                resetToSourceMutation.isPending || updateMutation.isPending
              }
              onClick={() => {
                if (
                  !window.confirm(
                    "Khôi phục tên và mô tả về mặc định từ nguồn?",
                  )
                )
                  return;
                resetToSourceMutation.mutate();
              }}
            >
              {resetToSourceMutation.isPending ? t.resetting : t.resetSource}
            </StudioButton>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <StudioCard className="overflow-hidden p-0">
        {/* Card header — title + stats + actions + search */}
        <div
          className="border-b px-3 py-4 sm:px-6"
          style={{ borderColor: "var(--bd)" }}
        >
          {/* Row 1: title + buttons */}
          <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2
                className="text-base font-black uppercase tracking-tight sm:text-xl"
                style={{ color: "var(--tx)" }}
              >
                {t.overview}
              </h2>
              <div className="mt-3 grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
                {[
                  {
                    value: currentProducts.length,
                    label: t.totalLabel,
                    color: "var(--tx)",
                  },
                  {
                    value: manualCount,
                    label: t.manualLabel,
                    color: "rgb(245,158,11)",
                  },
                  {
                    value: activeCount,
                    label: t.activeLabel,
                    color: "rgb(16,185,129)",
                  },
                  {
                    value: totalSales,
                    label: t.soldLabel,
                    color: "var(--tx)",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="min-w-0 rounded-xl px-1.5 py-2 text-center sm:flex sm:items-center sm:gap-1.5 sm:px-3 sm:py-1.5"
                    style={{
                      background: "var(--inp)",
                      border: "1px solid var(--bd)",
                    }}
                  >
                    <p
                      className="text-sm font-black tabular-nums sm:text-xs"
                      style={{ color: stat.color }}
                    >
                      {stat.value}
                    </p>
                    <p
                      className="truncate text-[8px] font-bold uppercase tracking-wide sm:text-[10px]"
                      style={{ color: "var(--tx-f)" }}
                    >
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <StudioButton
                className="w-full sm:w-auto"
                variant="secondary"
                onClick={() => setShowCategoryPanel(true)}
              >
                <FolderOpen className="h-4 w-4" />
                Danh mục{" "}
                {groups.length > 0 && (
                  <span className="ml-1 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-black text-orange-400">
                    {groups.length}
                  </span>
                )}
              </StudioButton>
              <StudioButton
                className="w-full sm:w-auto"
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
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div
                className={`relative h-10 shrink-0 transition-[width] duration-300 ease-out ${searchExpanded || keyword ? "w-full sm:w-64" : "w-10"}`}
              >
              <input
                ref={searchInputRef}
                className={`h-10 w-full rounded-xl border py-0 pl-10 pr-10 text-sm font-medium outline-none transition-[opacity,box-shadow] duration-200 focus:shadow-[0_0_0_3px_rgba(249,115,22,0.12)] ${searchExpanded || keyword ? "opacity-100" : "pointer-events-none opacity-0"}`}
                style={{
                  backgroundColor: "var(--inp)",
                  borderColor: "var(--bd)",
                  color: "var(--tx)",
                }}
                placeholder={t.searchPh}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !keyword) {
                    setSearchExpanded(false);
                  }
                }}
              />
              <button
                type="button"
                aria-label={t.searchPh}
                aria-expanded={searchExpanded || Boolean(keyword)}
                className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-200"
                style={{
                  background:
                    searchExpanded || keyword ? "transparent" : "var(--inp)",
                  border:
                    searchExpanded || keyword
                      ? "1px solid transparent"
                      : "1px solid var(--bd)",
                  color: "var(--tx-m)",
                }}
                onClick={() => {
                  setSearchExpanded(true);
                  window.requestAnimationFrame(() =>
                    searchInputRef.current?.focus(),
                  );
                }}
              >
                <Search className="h-4 w-4" />
              </button>
              {(searchExpanded || keyword) && (
                <button
                  type="button"
                  aria-label={lang === "en" ? "Close search" : "Đóng tìm kiếm"}
                  className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
                  style={{ color: "var(--tx-f)" }}
                  onClick={() => {
                    setKeyword("");
                    setSearchExpanded(false);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              </div>
            {canUseExternalSource && providerSources.length > 0 && (
              <select
                value={providerSourceFilter}
                onChange={(event) =>
                  setProviderSourceFilter(event.target.value)
                }
                className={`${searchExpanded || keyword ? "hidden sm:block" : "block"} h-10 w-auto min-w-[140px] shrink-0 rounded-xl px-3 text-xs font-bold outline-none`}
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx)",
                }}
              >
                <option value="all">Tất cả provider</option>
                {providerSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label} · {source.providerName}
                  </option>
                ))}
              </select>
            )}
            {groups.length > 0 && (
              <select
                value={catalogGroupFilter}
                onChange={(event) => setCatalogGroupFilter(event.target.value)}
                className={`${searchExpanded || keyword ? "hidden sm:block" : "block"} h-10 w-auto min-w-[140px] shrink-0 rounded-xl px-3 text-xs font-bold outline-none`}
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx)",
                }}
              >
                <option value="all">Tất cả danh mục</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            )}
            {canUseExternalSource && (
              <select
                value={stockFilter}
                onChange={(event) =>
                  setStockFilter(
                    event.target.value as "all" | "available" | "out",
                  )
                }
                className={`${searchExpanded || keyword ? "hidden sm:block" : "block"} h-10 w-auto min-w-[120px] shrink-0 rounded-xl px-3 text-xs font-bold outline-none`}
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx)",
                }}
              >
                <option value="all">Mọi tồn kho</option>
                <option value="available">Còn hàng</option>
                <option value="out">Hết hàng</option>
              </select>
            )}
            </div>
            <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {filters.map((item) => (
                <StudioButton
                  className="shrink-0 whitespace-nowrap !rounded-xl !px-3 !py-2"
                  key={item.value}
                  size="sm"
                  type="button"
                  variant={filter === item.value ? "primary" : "secondary"}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </StudioButton>
              ))}
              {(keyword ||
                filter !== "all" ||
                providerSourceFilter !== "all" ||
                catalogGroupFilter !== "all" ||
                stockFilter !== "all") && (
                <StudioButton
                  className="shrink-0 whitespace-nowrap !rounded-xl !px-3 !py-2"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setKeyword("");
                    setFilter("all");
                    setProviderSourceFilter("all");
                    setCatalogGroupFilter("all");
                    setStockFilter("all");
                    setSearchExpanded(false);
                  }}
                >
                  {t.clearFilter}
                </StudioButton>
              )}
            </div>
            <p
              className="text-right text-[11px] font-semibold"
              style={{ color: "var(--tx-f)" }}
            >
              {t.visibleOf(
                visibleCount,
                filter === "archived" ? archivedCount : currentProducts.length,
              )}
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
            <div
              className="inline-flex h-16 w-16 items-center justify-center rounded-[20px] mb-5"
              style={{ backgroundColor: "var(--inp)" }}
            >
              <Package className="h-7 w-7 text-rose-500" />
            </div>
            <p
              className="text-base font-black uppercase tracking-tight"
              style={{ color: "var(--tx)" }}
            >
              {t.loadError}
            </p>
            <p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>
              {getErrorMessage(productsQuery.error, t.loadErrorHint)}
            </p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div
              className="inline-flex h-16 w-16 items-center justify-center rounded-[20px] mb-5"
              style={{ backgroundColor: "var(--inp)" }}
            >
              <Package
                className="h-7 w-7 opacity-30"
                style={{ color: "var(--tx)" }}
              />
            </div>
            <p
              className="text-sm font-black uppercase tracking-[0.2em] opacity-40"
              style={{ color: "var(--tx)" }}
            >
              {t.emptyTitle}
            </p>
            <p
              className="mt-1 text-[10px] font-bold uppercase opacity-20"
              style={{ color: "var(--tx)" }}
            >
              {t.emptyHint}
            </p>
          </div>
        ) : (
          <div>
            {/* Desktop table */}
            <div
              className={`hidden overflow-x-auto transition-[padding] lg:block ${openMenuId ? "lg:pb-56" : "lg:pb-0"}`}
            >
              <table
                className="hidden w-full text-sm lg:table"
                style={{
                  tableLayout: "fixed",
                  minWidth: isUltra ? "1060px" : "960px",
                }}
              >
                <colgroup>
                  <col style={{ width: "36px" }} />
                  <col style={{ width: "40px" }} />
                  <col style={{ width: isUltra ? "14%" : "18%" }} />
                  <col style={{ width: isUltra ? "15%" : "16%" }} />
                  <col style={{ width: isUltra ? "12%" : "13%" }} />
                  {isUltra && <col style={{ width: "12%" }} />}
                  <col style={{ width: isUltra ? "11%" : "12%" }} />
                  <col style={{ width: isUltra ? "11%" : "12%" }} />
                  <col style={{ width: isUltra ? "11%" : "12%" }} />
                  <col style={{ width: isUltra ? "14%" : "17%" }} />
                </colgroup>
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--bd)",
                      backgroundColor: "var(--inp)",
                    }}
                  >
                    <th className="py-2.5 pl-4 pr-1">
                      <input
                        type="checkbox"
                        checked={
                          filteredProducts.length > 0 &&
                          filteredCheckedCount === filteredProducts.length
                        }
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              filteredCheckedCount > 0 &&
                              filteredCheckedCount < filteredProducts.length;
                        }}
                        onChange={toggleCheckAll}
                        className="h-3.5 w-3.5 cursor-pointer rounded accent-orange-500"
                      />
                    </th>
                    <th
                      className="py-2.5 pr-2 text-left text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                      style={{ color: "var(--tx-f)", width: "1%" }}
                    >
                      #
                    </th>
                    <th
                      className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest"
                      style={{ color: "var(--tx-f)", width: "100%" }}
                    >
                      {t.colName}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                      style={{ color: "var(--tx-f)", width: "1%" }}
                    >
                      {t.colSalePrice}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                      style={{ color: "var(--tx-f)", width: "1%" }}
                    >
                      {t.colSourcePrice}
                    </th>
                    {isUltra && (
                      <th
                        className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                        style={{ color: "var(--tx-f)", width: "1%" }}
                      >
                        {t.colCtvPrice}
                      </th>
                    )}
                    <th
                      className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                      style={{ color: "var(--tx-f)", width: "1%" }}
                    >
                      {t.colUnsold}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                      style={{ color: "var(--tx-f)", width: "1%" }}
                    >
                      {t.colSold}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                      style={{ color: "var(--tx-f)", width: "1%" }}
                    >
                      {t.colTotal}
                    </th>
                    <th
                      className="py-2.5 pl-3 pr-5 text-right text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
                      style={{ color: "var(--tx-f)", width: "1%" }}
                    >
                      {t.colActions}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product, index) => {
                    const isSelected = product.id === selectedId;
                    const isChecked = checkedIds.has(product.id);
                    const isDragging = draggedProductId === product.id;
                    const productGroup = groups.find(
                      (g) => g.id === product.groupId,
                    );
                    const providerSource = providerSources.find(
                      (source) => source.id === product.providerSourceId,
                    );
                    return (
                      <tr
                        key={product.id}
                        draggable
                        onDragStart={(e) => {
                          setDraggedProductId(product.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleProductDrop(product.id);
                        }}
                        onDragEnd={() => setDraggedProductId(null)}
                        className={`group border-b last:border-0 transition-colors duration-150 cursor-move ${isDragging ? "opacity-40" : ""}`}
                        style={{
                          borderColor: "var(--bd)",
                          backgroundColor: isChecked
                            ? "rgba(249,115,22,0.07)"
                            : isSelected
                              ? "rgba(249,115,22,0.04)"
                              : undefined,
                        }}
                      >
                        <td className="py-3 pl-4 pr-1">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCheck(product.id)}
                            className="h-3.5 w-3.5 cursor-pointer rounded accent-orange-500"
                          />
                        </td>
                        <td
                          className="py-3 pr-2 text-xs font-bold tabular-nums"
                          style={{ color: "var(--tx-f)" }}
                        >
                          {index + 1}
                        </td>

                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-200"
                              style={{
                                backgroundColor: isSelected
                                  ? "rgba(249,115,22,0.12)"
                                  : "var(--inp)",
                                border: `1px solid ${isSelected ? "rgba(249,115,22,0.3)" : "var(--bd)"}`,
                                color: isSelected
                                  ? "rgb(249,115,22)"
                                  : "var(--tx-f)",
                              }}
                            >
                              <Package className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p
                                className="line-clamp-2 break-words text-[13px] font-black uppercase tracking-tight leading-tight"
                                style={{ color: "var(--tx)" }}
                              >
                                {product.displayName}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <StudioBadge
                                  tone={
                                    product.isManual ? "warning" : "neutral"
                                  }
                                >
                                  {product.isManual ? t.bManual : t.bSource}
                                </StudioBadge>
                                {providerSource && (
                                  <StudioBadge tone="neutral">
                                    {providerSource.label}
                                  </StudioBadge>
                                )}
                                {product.providerSourceId &&
                                  (!product.enabled || product.hidden) && (
                                    <StudioBadge tone="warning">
                                      {lang === "en"
                                        ? "Pending review"
                                        : lang === "th"
                                          ? "รอตรวจสอบ"
                                          : "Chờ duyệt"}
                                    </StudioBadge>
                                  )}
                                {!product.enabled && (
                                  <StudioBadge tone="neutral">
                                    {t.bOff}
                                  </StudioBadge>
                                )}
                                {product.hidden && (
                                  <StudioBadge tone="warning">
                                    {t.bHidden}
                                  </StudioBadge>
                                )}
                                {product.archivedAt && (
                                  <StudioBadge tone="neutral">
                                    {lang === "en"
                                      ? "Archived"
                                      : lang === "th"
                                        ? "เก็บถาวร"
                                        : "Lưu trữ"}
                                  </StudioBadge>
                                )}
                                {productGroup && (
                                  <span
                                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                                    style={{
                                      background: "rgba(99,102,241,0.12)",
                                      color: "rgb(99,102,241)",
                                    }}
                                  >
                                    <FolderOpen className="h-2.5 w-2.5" />
                                    {productGroup.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3 text-right">
                          {lang === "th" ? (
                            <>
                              <p className="text-sm font-black tabular-nums text-emerald-500">
                                ${toUsdt(product.salePrice, usdtVndRate)}
                              </p>
                              <p
                                className="mt-0.5 text-[11px] tabular-nums"
                                style={{ color: "var(--tx-f)" }}
                              >
                                {formatCurrency(product.salePrice)}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-black tabular-nums text-emerald-500">
                                {formatCurrency(product.salePrice)}
                              </p>
                              <p
                                className="mt-0.5 text-[11px] tabular-nums"
                                style={{ color: "var(--tx-f)" }}
                              >
                                ${toUsdt(product.salePrice, usdtVndRate)}
                              </p>
                            </>
                          )}
                        </td>

                        <td
                          className="px-3 py-3 text-right text-sm tabular-nums"
                          style={{ color: "var(--tx-f)" }}
                        >
                          {lang === "th"
                            ? product.sourcePrice
                              ? `$${toUsdt(product.sourcePrice, usdtVndRate)}`
                              : "—"
                            : product.sourcePrice
                              ? formatCurrency(product.sourcePrice)
                              : "—"}
                        </td>

                        {isUltra && (
                          <td className="px-3 py-3 text-right text-sm tabular-nums">
                            {(() => {
                              const ctvEnabled = (product as any)
                                .internalSourceEnabled;
                              if (!ctvEnabled) {
                                return (
                                  <span style={{ color: "var(--tx-f)" }}>
                                    —
                                  </span>
                                );
                              }
                              const ctvPrice = (product as any)
                                .internalSourcePrice;
                              const effective = ctvPrice ?? product.salePrice;
                              const isDefault = !ctvPrice;
                              const display =
                                lang === "th"
                                  ? `$${toUsdt(effective, usdtVndRate)}`
                                  : formatCurrency(effective);
                              return (
                                <span
                                  style={{
                                    color: isDefault
                                      ? "var(--tx-f)"
                                      : "rgb(167,139,250)",
                                  }}
                                  title={
                                    isDefault
                                      ? "Chưa set giá CTV → dùng giá bán"
                                      : undefined
                                  }
                                >
                                  {display}
                                </span>
                              );
                            })()}
                          </td>
                        )}

                        <td className="px-3 py-3 text-right">
                          <span
                            className={`text-sm font-black tabular-nums ${product.available === 0 ? "text-rose-500" : "text-orange-400"}`}
                          >
                            {product.available ?? "∞"}
                          </span>
                        </td>

                        <td
                          className="px-3 py-3 text-right text-sm font-semibold tabular-nums"
                          style={{ color: "var(--tx-m)" }}
                        >
                          {product.soldCount}
                        </td>

                        <td
                          className="px-3 py-3 text-right text-sm tabular-nums"
                          style={{ color: "var(--tx-f)" }}
                        >
                          {product.totalCount}
                        </td>

                        <td className="py-3 pl-3 pr-5">
                          <div className="flex items-center justify-end gap-0.5">
                            <ActionBtn
                              title={t.aEdit}
                              color="orange"
                              onClick={() => {
                                setSelectedId(product.id);
                                setDrawerMode("edit");
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </ActionBtn>
                            <ActionBtn
                              title={product.hidden ? t.aShow : t.aHide}
                              color={product.hidden ? "violet" : "default"}
                              onClick={() =>
                                toggleHiddenMutation.mutate({
                                  id: product.id,
                                  hidden: !product.hidden,
                                })
                              }
                            >
                              {product.hidden ? (
                                <Eye className="h-4 w-4" />
                              ) : (
                                <EyeOff className="h-4 w-4" />
                              )}
                            </ActionBtn>
                            <div className="relative">
                              <ActionBtn
                                title="Thêm"
                                color="default"
                                onClick={() =>
                                  setOpenMenuId(
                                    openMenuId === product.id
                                      ? null
                                      : product.id,
                                  )
                                }
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </ActionBtn>
                              {openMenuId === product.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setOpenMenuId(null)}
                                  />
                                  <div
                                    className="absolute right-0 top-9 z-20 min-w-[140px] rounded-xl py-1 shadow-xl"
                                    style={{
                                      background: "var(--surface)",
                                      border: "1px solid var(--bd)",
                                    }}
                                  >
                                    <OverflowItem
                                      icon={<Eye className="h-3.5 w-3.5" />}
                                      label={t.aView}
                                      onClick={() => {
                                        setSelectedId(product.id);
                                        setDrawerMode("view");
                                        setOpenMenuId(null);
                                      }}
                                    />
                                    {isUltra && (
                                      <OverflowItem
                                        icon={
                                          isHiddenEverywhere(product) ? (
                                            <Eye className="h-3.5 w-3.5" />
                                          ) : (
                                            <Ban className="h-3.5 w-3.5" />
                                          )
                                        }
                                        label={
                                          isHiddenEverywhere(product)
                                            ? lang === "en"
                                              ? "Show everywhere"
                                              : lang === "th"
                                                ? "แสดงทั้งหมด"
                                                : "Hiện toàn bộ"
                                            : lang === "en"
                                              ? "Hide everywhere"
                                              : lang === "th"
                                                ? "ซ่อนทั้งหมด"
                                                : "Ẩn toàn bộ"
                                        }
                                        danger={!isHiddenEverywhere(product)}
                                        onClick={() => {
                                          setOpenMenuId(null);
                                          toggleEverywhere(product);
                                        }}
                                      />
                                    )}
                                    {product.isManual && (
                                      <OverflowItem
                                        icon={
                                          <PackagePlus className="h-3.5 w-3.5" />
                                        }
                                        label="Kho tài khoản"
                                        onClick={() => {
                                          setSelectedId(product.id);
                                          setStockStatusFilter("AVAILABLE");
                                          setStockModal("viewStock");
                                          setOpenMenuId(null);
                                        }}
                                      />
                                    )}
                                    {product.isManual && (
                                      <OverflowItem
                                        icon={<Copy className="h-3.5 w-3.5" />}
                                        label={t.aDuplicate}
                                        onClick={() => {
                                          duplicateMutation.mutate(product.id);
                                          setOpenMenuId(null);
                                        }}
                                      />
                                    )}
                                    <OverflowItem
                                      icon={<Tag className="h-3.5 w-3.5" />}
                                      label={t.aPromo}
                                      onClick={() => {
                                        setSelectedId(product.id);
                                        setDrawerMode("promo");
                                        setOpenMenuId(null);
                                      }}
                                    />
                                    <div
                                      className="my-1 mx-2 border-t"
                                      style={{ borderColor: "var(--bd)" }}
                                    />
                                    {product.archivedAt ? (
                                      <>
                                        <OverflowItem
                                          icon={
                                            <ArchiveRestore className="h-3.5 w-3.5" />
                                          }
                                          label={
                                            lang === "en"
                                              ? "Restore"
                                              : lang === "th"
                                                ? "กู้คืน"
                                                : "Khôi phục"
                                          }
                                          onClick={() => {
                                            restoreMutation.mutate(product.id);
                                            setOpenMenuId(null);
                                          }}
                                        />
                                        {product.isManual && (
                                          <OverflowItem
                                            icon={
                                              <Trash2 className="h-3.5 w-3.5" />
                                            }
                                            label={t.aDelete}
                                            danger
                                            onClick={() => {
                                              setOpenMenuId(null);
                                              if (
                                                window.confirm(
                                                  t.confirmDel(
                                                    product.displayName,
                                                  ),
                                                )
                                              )
                                                deleteMutation.mutate(
                                                  product.id,
                                                );
                                            }}
                                          />
                                        )}
                                      </>
                                    ) : (
                                      <OverflowItem
                                        icon={
                                          <Archive className="h-3.5 w-3.5" />
                                        }
                                        label={
                                          lang === "en"
                                            ? "Archive"
                                            : lang === "th"
                                              ? "เก็บถาวร"
                                              : "Lưu trữ"
                                        }
                                        danger
                                        onClick={() => {
                                          setOpenMenuId(null);
                                          if (
                                            window.confirm(
                                              lang === "en"
                                                ? `Archive "${product.displayName}"?`
                                                : `Lưu trữ "${product.displayName}"?`,
                                            )
                                          )
                                            archiveMutation.mutate(product.id);
                                        }}
                                      />
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div
              className={`space-y-2.5 px-2.5 py-3 lg:hidden ${checkedIds.size > 0 ? "pb-32" : ""}`}
              style={{ background: "var(--inp)" }}
            >
              {filteredProducts.map((product, mobileIndex) => (
                <div
                  key={product.id}
                  className="rounded-2xl border p-3 shadow-sm transition-colors"
                  style={{
                    borderColor: checkedIds.has(product.id)
                      ? "rgba(249,115,22,0.45)"
                      : "var(--bd)",
                    background: checkedIds.has(product.id)
                      ? "rgba(249,115,22,0.06)"
                      : "var(--surface)",
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={checkedIds.has(product.id)}
                      onChange={() => toggleCheck(product.id)}
                      className="mt-2.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-orange-500"
                    />
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
                      style={{
                        background: "rgba(249,115,22,0.1)",
                        color: "rgb(249,115,22)",
                      }}
                    >
                      {product.productIcon || <Package className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p
                        className="line-clamp-2 break-words text-[12px] font-black uppercase leading-[1.35] tracking-tight"
                        style={{ color: "var(--tx)" }}
                      >
                        {product.displayName}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-sm font-black tabular-nums text-orange-500">
                          {formatCurrency(product.salePrice)}
                        </p>
                        <span
                          className="text-[9px] font-bold tabular-nums"
                          style={{ color: "var(--tx-f)" }}
                        >
                          #{mobileIndex + 1}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={t.aEdit}
                      title={t.aEdit}
                      className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl transition active:scale-95 sm:flex"
                      style={{
                        backgroundColor: "rgba(249,115,22,0.15)",
                        color: "rgb(234,88,12)",
                      }}
                      onClick={() => {
                        setSelectedId(product.id);
                        setDrawerMode("edit");
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={t.colActions}
                        title={t.colActions}
                        className="flex h-9 w-9 items-center justify-center rounded-xl transition active:scale-95"
                        style={{
                          backgroundColor: "var(--inp)",
                          border: "1px solid var(--bd)",
                          color: "var(--tx-m)",
                        }}
                        onClick={() =>
                          setOpenMenuId(
                            openMenuId === product.id ? null : product.id,
                          )
                        }
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {openMenuId === product.id && (
                        <>
                          <div
                            className="fixed inset-0 z-[390] bg-black/45 backdrop-blur-[2px]"
                            onClick={() => setOpenMenuId(null)}
                          />
                          <div
                            className="fixed inset-x-0 bottom-0 z-[400] max-h-[82dvh] overflow-y-auto overscroll-contain rounded-t-[28px] shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[300px] sm:rounded-2xl"
                            style={{
                              background: "var(--surface)",
                              border: "1px solid var(--bd)",
                              WebkitOverflowScrolling: "touch",
                            }}
                          >
                            <div
                              className="sticky top-0 z-10 px-4 pb-2 pt-2"
                              style={{ background: "var(--surface)" }}
                            >
                              <div
                                className="mx-auto mb-3 h-1 w-10 rounded-full"
                                style={{ background: "var(--bd)" }}
                              />
                              <p
                                className="text-[10px] font-black uppercase tracking-[0.16em]"
                                style={{ color: "var(--tx-f)" }}
                              >
                                {lang === "en" ? "Product actions" : "Thao tác sản phẩm"}
                              </p>
                              <p
                                className="mt-1 truncate text-sm font-black"
                                style={{ color: "var(--tx)" }}
                              >
                                {product.displayName}
                              </p>
                            </div>
                            <div className="px-2 pb-4 [&>button]:min-h-11 [&>button]:rounded-xl [&>button]:px-3 [&>button]:text-[13px]">
                            <OverflowItem
                              icon={<Eye className="h-3.5 w-3.5" />}
                              label={t.aView}
                              onClick={() => {
                                setSelectedId(product.id);
                                setDrawerMode("view");
                                setOpenMenuId(null);
                              }}
                            />
                            <OverflowItem
                              icon={<Pencil className="h-3.5 w-3.5" />}
                              label={t.aEdit}
                              onClick={() => {
                                setSelectedId(product.id);
                                setDrawerMode("edit");
                                setOpenMenuId(null);
                              }}
                            />
                            <OverflowItem
                              icon={
                                product.hidden ? (
                                  <Eye className="h-3.5 w-3.5" />
                                ) : (
                                  <EyeOff className="h-3.5 w-3.5" />
                                )
                              }
                              label={product.hidden ? t.aShow : t.aHide}
                              onClick={() => {
                                toggleHiddenMutation.mutate({
                                  id: product.id,
                                  hidden: !product.hidden,
                                });
                                setOpenMenuId(null);
                              }}
                            />
                            {isUltra && (
                              <OverflowItem
                                icon={
                                  isHiddenEverywhere(product) ? (
                                    <Eye className="h-3.5 w-3.5" />
                                  ) : (
                                    <Ban className="h-3.5 w-3.5" />
                                  )
                                }
                                label={
                                  isHiddenEverywhere(product)
                                    ? lang === "en"
                                      ? "Show everywhere"
                                      : lang === "th"
                                        ? "แสดงทั้งหมด"
                                        : "Hiện toàn bộ"
                                    : lang === "en"
                                      ? "Hide everywhere"
                                      : lang === "th"
                                        ? "ซ่อนทั้งหมด"
                                        : "Ẩn toàn bộ"
                                }
                                danger={!isHiddenEverywhere(product)}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  toggleEverywhere(product);
                                }}
                              />
                            )}
                            {product.isManual && (
                              <OverflowItem
                                icon={<PackagePlus className="h-3.5 w-3.5" />}
                                label="Kho tài khoản"
                                onClick={() => {
                                  setSelectedId(product.id);
                                  setStockStatusFilter("AVAILABLE");
                                  setStockModal("viewStock");
                                  setOpenMenuId(null);
                                }}
                              />
                            )}
                            {product.isManual && (
                              <OverflowItem
                                icon={<Copy className="h-3.5 w-3.5" />}
                                label={t.aDuplicate}
                                onClick={() => {
                                  duplicateMutation.mutate(product.id);
                                  setOpenMenuId(null);
                                }}
                              />
                            )}
                            <OverflowItem
                              icon={<Tag className="h-3.5 w-3.5" />}
                              label={t.aPromo}
                              onClick={() => {
                                setSelectedId(product.id);
                                setDrawerMode("promo");
                                setOpenMenuId(null);
                              }}
                            />
                            <div
                              className="mx-2 my-1 border-t"
                              style={{ borderColor: "var(--bd)" }}
                            />
                            {product.archivedAt ? (
                              <>
                                <OverflowItem
                                  icon={
                                    <ArchiveRestore className="h-3.5 w-3.5" />
                                  }
                                  label={
                                    lang === "en"
                                      ? "Restore"
                                      : lang === "th"
                                        ? "กู้คืน"
                                        : "Khôi phục"
                                  }
                                  onClick={() => {
                                    restoreMutation.mutate(product.id);
                                    setOpenMenuId(null);
                                  }}
                                />
                                {product.isManual && (
                                  <OverflowItem
                                    icon={<Trash2 className="h-3.5 w-3.5" />}
                                    label={t.aDelete}
                                    danger
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      if (
                                        window.confirm(
                                          t.confirmDelShort(
                                            product.displayName,
                                          ),
                                        )
                                      )
                                        deleteMutation.mutate(product.id);
                                    }}
                                  />
                                )}
                              </>
                            ) : (
                              <OverflowItem
                                icon={<Archive className="h-3.5 w-3.5" />}
                                label={
                                  lang === "en"
                                    ? "Archive"
                                    : lang === "th"
                                      ? "เก็บถาวร"
                                      : "Lưu trữ"
                                }
                                danger
                                onClick={() => {
                                  setOpenMenuId(null);
                                  if (
                                    window.confirm(
                                      lang === "en"
                                        ? `Archive "${product.displayName}"?`
                                        : `Lưu trữ "${product.displayName}"?`,
                                    )
                                  )
                                    archiveMutation.mutate(product.id);
                                }}
                              />
                            )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {[
                      {
                        label: t.colUnsold,
                        value: product.available ?? "∞",
                        color:
                          product.available === 0
                            ? "rgb(244,63,94)"
                            : "rgb(249,115,22)",
                      },
                      {
                        label: t.colSold,
                        value: product.soldCount,
                        color: "var(--tx)",
                      },
                      {
                        label: t.colTotal,
                        value: product.totalCount,
                        color: "var(--tx)",
                      },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-xl px-2 py-2 text-center"
                        style={{ background: "var(--inp)" }}
                      >
                        <p
                          className="truncate text-[8px] font-black uppercase tracking-wide"
                          style={{ color: "var(--tx-f)" }}
                        >
                          {stat.label}
                        </p>
                        <p
                          className="mt-0.5 text-xs font-black tabular-nums"
                          style={{ color: stat.color }}
                        >
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    <StudioBadge
                      tone={product.isManual ? "warning" : "neutral"}
                    >
                      {product.isManual ? t.bManual : t.bSource}
                    </StudioBadge>
                    {product.providerSourceId && (
                      <StudioBadge tone="neutral">
                        {providerSources.find(
                          (source) => source.id === product.providerSourceId,
                        )?.label || product.providerName}
                      </StudioBadge>
                    )}
                    {product.groupId &&
                      groups.find((group) => group.id === product.groupId) && (
                        <StudioBadge tone="neutral">
                          {
                            groups.find(
                              (group) => group.id === product.groupId,
                            )?.name
                          }
                        </StudioBadge>
                      )}
                    {product.archivedAt ? (
                      <StudioBadge tone="neutral">
                        {lang === "en"
                          ? "Archived"
                          : lang === "th"
                            ? "เก็บถาวร"
                            : "Lưu trữ"}
                      </StudioBadge>
                    ) : product.providerSourceId &&
                      (!product.enabled || product.hidden) ? (
                      <StudioBadge tone="warning">
                        {lang === "en"
                          ? "Pending review"
                          : lang === "th"
                            ? "รอตรวจสอบ"
                            : "Chờ duyệt"}
                      </StudioBadge>
                    ) : !product.enabled ? (
                      <StudioBadge tone="neutral">{t.bOff}</StudioBadge>
                    ) : product.hidden ? (
                      <StudioBadge tone="warning">{t.bHidden}</StudioBadge>
                    ) : (
                      <StudioBadge tone="success">{t.fActive}</StudioBadge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </StudioCard>

      {/* Bulk action bar */}
      {checkedIds.size > 0 &&
        createPortal(
          <div className="fixed inset-x-2 bottom-2 z-[300] flex justify-center sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2">
            <div
              className="flex w-full max-w-xl flex-wrap items-center justify-center gap-1.5 overflow-visible rounded-[22px] px-2.5 py-2.5 shadow-2xl sm:w-auto sm:max-w-none sm:flex-nowrap sm:justify-start sm:gap-2 sm:px-4 sm:py-3"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--bd)",
              }}
            >
              <span
                className="rounded-xl px-2.5 py-2 text-xs font-black sm:whitespace-nowrap sm:text-sm"
                style={{
                  background: "rgba(249,115,22,0.12)",
                  color: "rgb(249,115,22)",
                }}
              >
                {checkedIds.size} sản phẩm
              </span>
              {checkedProviderProductCount > 0 && (
                <>
                  <button
                    type="button"
                    disabled={bulkSourceStatusMutation.isPending}
                    onClick={() => bulkSourceStatusMutation.mutate("PUBLISH")}
                    className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[11px] font-bold transition hover:opacity-80 disabled:opacity-50 sm:px-3 sm:text-[13px]"
                    style={{
                      background: "rgba(34,197,94,0.15)",
                      color: "rgb(34,197,94)",
                    }}
                  >
                    <Check className="h-4 w-4" />
                    Duyệt bán ({checkedProviderProductCount})
                  </button>
                  <button
                    type="button"
                    disabled={bulkSourceStatusMutation.isPending}
                    onClick={() => bulkSourceStatusMutation.mutate("PENDING")}
                    className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[11px] font-bold transition hover:opacity-80 disabled:opacity-50 sm:px-3 sm:text-[13px]"
                    style={{
                      background: "rgba(245,158,11,0.15)",
                      color: "rgb(245,158,11)",
                    }}
                  >
                    <EyeOff className="h-4 w-4" />
                    Chờ duyệt
                  </button>
                </>
              )}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAssignDropdown((v) => !v)}
                  className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[11px] font-bold transition-all hover:opacity-80 sm:px-3 sm:text-[13px]"
                  style={{
                    background: "rgba(99,102,241,0.15)",
                    color: "rgb(99,102,241)",
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                  Gán danh mục
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showAssignDropdown && (
                  <div
                    className="fixed inset-x-2 bottom-28 z-[310] mb-2 max-h-[50vh] overflow-y-auto rounded-2xl shadow-xl sm:absolute sm:inset-x-auto sm:bottom-full sm:left-0 sm:mb-2 sm:min-w-[180px] sm:rounded-xl"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--bd)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        bulkAssignMutation.mutate({
                          productIds: Array.from(checkedIds),
                          groupId: null,
                        })
                      }
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-left hover:bg-orange-500/10 transition-colors"
                      style={{ color: "var(--tx-m)" }}
                    >
                      <X className="h-3.5 w-3.5" /> Bỏ danh mục
                    </button>
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          bulkAssignMutation.mutate({
                            productIds: Array.from(checkedIds),
                            groupId: g.id,
                          })
                        }
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-left hover:bg-orange-500/10 transition-colors"
                        style={{ color: "var(--tx)" }}
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-indigo-400" />{" "}
                        {g.name}
                      </button>
                    ))}
                    {groups.length === 0 && (
                      <p
                        className="px-3 py-2.5 text-[12px]"
                        style={{ color: "var(--tx-f)" }}
                      >
                        Chưa có danh mục. Tạo trong "Danh mục".
                      </p>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCheckedIds(new Set())}
                className="flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:bg-rose-500/10 hover:text-rose-500"
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx-f)",
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* Category management panel */}
      {createPortal(
        <div
          className={`fixed inset-0 z-[80] flex items-center justify-center p-4 transition-all duration-300 ${showCategoryPanel ? "pointer-events-auto" : "pointer-events-none"}`}
          style={{
            backgroundColor: showCategoryPanel
              ? "rgba(0,0,0,0.45)"
              : "rgba(0,0,0,0)",
          }}
          onClick={() => setShowCategoryPanel(false)}
        >
          <div
            className="relative flex w-full max-w-sm flex-col rounded-2xl shadow-2xl overflow-hidden"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--bd)",
              maxHeight: "80vh",
              transform: showCategoryPanel
                ? "scale(1) translateY(0)"
                : "scale(0.96) translateY(16px)",
              opacity: showCategoryPanel ? 1 : 0,
              transition:
                "transform 250ms cubic-bezier(0.4,0,0.2,1), opacity 250ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex shrink-0 items-center justify-between gap-4 px-5 py-4"
              style={{ borderBottom: "1px solid var(--bd)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: "rgba(99,102,241,0.12)",
                    border: "1px solid rgba(99,102,241,0.25)",
                  }}
                >
                  <FolderOpen className="h-4 w-4 text-indigo-400" />
                </div>
                <p
                  className="text-sm font-black uppercase tracking-tight"
                  style={{ color: "var(--tx)" }}
                >
                  Quản lý danh mục
                </p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all hover:bg-rose-500/10 hover:text-rose-500"
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx-f)",
                }}
                onClick={() => setShowCategoryPanel(false)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Create new group */}
              <div
                className="px-4 py-4"
                style={{ borderBottom: "1px solid var(--bd)" }}
              >
                <p
                  className="mb-2 text-[11px] font-black uppercase tracking-widest"
                  style={{ color: "var(--tx-f)" }}
                >
                  Tạo danh mục mới
                </p>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <StudioInput
                      placeholder="Tên danh mục..."
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter" && newGroupName.trim()) {
                          createGroupMutation.mutate({
                            name: newGroupName.trim(),
                            description: newGroupDescription,
                          });
                        }
                      }}
                    />
                    <StudioButton
                      disabled={
                        createGroupMutation.isPending || !newGroupName.trim()
                      }
                      onClick={() =>
                        createGroupMutation.mutate({
                          name: newGroupName.trim(),
                          description: newGroupDescription,
                        })
                      }
                    >
                      <Plus className="h-4 w-4" />
                    </StudioButton>
                  </div>
                  <StudioTextArea
                    placeholder="Mô tả ngắn về sản phẩm trong danh mục..."
                    value={newGroupDescription}
                    maxLength={1000}
                    className="min-h-[82px] resize-y"
                    onChange={(e) => setNewGroupDescription(e.target.value)}
                  />
                  <p
                    className="text-right text-[10px]"
                    style={{ color: "var(--tx-f)" }}
                  >
                    {newGroupDescription.length}/1000
                  </p>
                </div>
              </div>

              {/* Group list */}
              <div className="px-4 py-3 space-y-1">
                {groups.length === 0 ? (
                  <p
                    className="py-6 text-center text-sm"
                    style={{ color: "var(--tx-f)" }}
                  >
                    Chưa có danh mục nào
                  </p>
                ) : (
                  groups.map((g) => (
                    <div
                      key={g.id}
                      draggable
                      onDragStart={() => handleDragStart(g.id)}
                      onDragOver={(e) => handleDragOver(e, g.id)}
                      onDragEnd={() => setDragGroupId(null)}
                      className="flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors"
                      style={{
                        background: "var(--inp)",
                        border: "1px solid var(--bd)",
                      }}
                    >
                      <GripVertical
                        className="h-4 w-4 shrink-0 cursor-grab"
                        style={{ color: "var(--tx-f)" }}
                      />
                      {(() => {
                        const matchedIcon = g.iconCustomEmojiId
                          ? iconCatalog.find(
                              (i) => i.customEmojiId === g.iconCustomEmojiId,
                            )
                          : null;
                        return (
                          <button
                            type="button"
                            onClick={() => setIconPickerGroupId(g.id)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border hover:opacity-80"
                            style={{
                              borderColor: "var(--bd)",
                              background: "var(--inp)",
                            }}
                            title="Chọn icon"
                          >
                            {matchedIcon ? (
                              <img
                                src={matchedIcon.imageUrl}
                                alt=""
                                className="h-5 w-5 object-contain"
                              />
                            ) : g.icon ? (
                              <span className="text-base leading-none">
                                {g.icon}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500">+</span>
                            )}
                          </button>
                        );
                      })()}
                      <div className="min-w-0 flex-1">
                        {editingGroupId === g.id ? (
                          <div className="space-y-2">
                            <input
                              className="w-full rounded-lg bg-transparent px-1 text-sm font-bold outline-none ring-1 ring-indigo-400"
                              style={{ color: "var(--tx)" }}
                              value={editingGroupName}
                              onChange={(e) =>
                                setEditingGroupName(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingGroupId(null);
                              }}
                              autoFocus
                            />
                            <textarea
                              className="min-h-[70px] w-full resize-y rounded-lg px-2 py-1.5 text-xs outline-none"
                              style={{
                                background: "var(--surface)",
                                border: "1px solid var(--bd)",
                                color: "var(--tx)",
                              }}
                              placeholder="Mô tả danh mục..."
                              value={editingGroupDescription}
                              maxLength={1000}
                              onChange={(e) =>
                                setEditingGroupDescription(e.target.value)
                              }
                            />
                          </div>
                        ) : (
                          <>
                            <p
                              className="truncate text-sm font-bold"
                              style={{ color: "var(--tx)" }}
                            >
                              {g.name}
                            </p>
                            {g.description && (
                              <p
                                className="mt-0.5 line-clamp-2 whitespace-pre-line text-[11px] leading-relaxed"
                                style={{ color: "var(--tx-m)" }}
                              >
                                {g.description}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      <span
                        className="text-[11px] font-bold"
                        style={{ color: "var(--tx-f)" }}
                      >
                        {g._count.overrides}
                      </span>
                      {editingGroupId === g.id ? (
                        <button
                          type="button"
                          onClick={() =>
                            editingGroupName.trim() &&
                            updateGroupMutation.mutate({
                              id: g.id,
                              name: editingGroupName.trim(),
                              description: editingGroupDescription,
                            })
                          }
                          className="flex h-6 w-6 items-center justify-center rounded-lg text-emerald-400 transition hover:bg-emerald-400/10"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGroupId(g.id);
                            setEditingGroupName(g.name);
                            setEditingGroupDescription(g.description || "");
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-lg transition hover:bg-orange-500/10"
                          style={{ color: "var(--tx-f)" }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Xóa danh mục "${g.name}"? Sản phẩm sẽ không bị xóa.`,
                            )
                          )
                            deleteGroupMutation.mutate(g.id);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-rose-400 transition hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {createPortal(
        <div
          className={`fixed inset-0 z-[80] flex items-center justify-center p-4 transition-all duration-300 ${drawerMode ? "pointer-events-auto" : "pointer-events-none"}`}
          style={{
            backgroundColor: drawerMode ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0)",
          }}
          onClick={() => setDrawerMode(null)}
        >
          <div
            className="relative flex w-full max-w-[680px] flex-col rounded-2xl shadow-2xl overflow-hidden"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--bd)",
              maxHeight: "90vh",
              transform: drawerMode
                ? "scale(1) translateY(0)"
                : "scale(0.96) translateY(16px)",
              opacity: drawerMode ? 1 : 0,
              transition:
                "transform 250ms cubic-bezier(0.4,0,0.2,1), opacity 250ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              className="flex shrink-0 items-center justify-between gap-4 px-5 py-4"
              style={{ borderBottom: "1px solid var(--bd)" }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: "rgba(249,115,22,0.12)",
                    border: "1px solid rgba(249,115,22,0.25)",
                  }}
                >
                  {drawerMode === "create" ? (
                    <PackagePlus className="h-4 w-4 text-orange-400" />
                  ) : drawerMode === "inventory" ? (
                    <Boxes className="h-4 w-4 text-orange-400" />
                  ) : drawerMode === "promo" ? (
                    <Tag className="h-4 w-4 text-orange-400" />
                  ) : (
                    <Package className="h-4 w-4 text-orange-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <p
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: "var(--tx-f)" }}
                  >
                    {drawerMode === "create"
                      ? t.mCreate
                      : drawerMode === "inventory"
                        ? t.mInventory
                        : drawerMode === "promo"
                          ? t.mPromo
                          : drawerMode === "view"
                            ? t.mView
                            : t.mEdit}
                  </p>
                  <p
                    className="mt-0.5 truncate text-sm font-black uppercase tracking-tight"
                    style={{ color: "var(--tx)" }}
                  >
                    {drawerMode === "create"
                      ? t.mCreateTitle
                      : (selectedProduct?.displayName ?? "—")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all hover:bg-rose-500/10 hover:text-rose-500"
                style={{
                  background: "var(--inp)",
                  border: "1px solid var(--bd)",
                  color: "var(--tx-f)",
                }}
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
                  <div
                    className="flex items-center gap-4 rounded-2xl p-4"
                    style={{
                      background: "var(--inp)",
                      border: "1px solid var(--bd)",
                    }}
                  >
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
                      style={{
                        background: "rgba(249,115,22,0.12)",
                        border: "1px solid rgba(249,115,22,0.25)",
                      }}
                    >
                      <Package className="h-6 w-6 text-orange-400" />
                    </div>
                    <div className="min-w-0">
                      <p
                        className="truncate text-base font-black uppercase tracking-tight"
                        style={{ color: "var(--tx)" }}
                      >
                        {selectedProduct.displayName}
                      </p>
                      {selectedProduct.sourceName !==
                        selectedProduct.displayName && (
                        <p
                          className="mt-0.5 truncate text-xs"
                          style={{ color: "var(--tx-f)" }}
                        >
                          {selectedProduct.sourceName}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <StudioBadge
                          tone={
                            selectedProduct.isManual ? "warning" : "neutral"
                          }
                        >
                          {selectedProduct.isManual ? t.bManualLong : t.bSynced}
                        </StudioBadge>
                        <StudioBadge
                          tone={selectedProduct.enabled ? "success" : "neutral"}
                        >
                          {selectedProduct.enabled ? t.bActive : t.bPaused}
                        </StudioBadge>
                        {selectedProduct.hidden && (
                          <StudioBadge tone="warning">
                            {t.bHiddenLong}
                          </StudioBadge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div
                      className="rounded-[14px] p-3.5"
                      style={{
                        background: "var(--inp)",
                        border: "1px solid var(--bd)",
                      }}
                    >
                      <p
                        className="text-[10px] font-black uppercase tracking-widest"
                        style={{ color: "var(--tx-f)" }}
                      >
                        {t.statSalePrice}
                      </p>
                      <p className="mt-2 text-base font-black tabular-nums text-emerald-500">
                        {formatCurrency(selectedProduct.salePrice)}
                      </p>
                    </div>
                    <div
                      className="rounded-[14px] p-3.5"
                      style={{
                        background: "var(--inp)",
                        border: "1px solid var(--bd)",
                      }}
                    >
                      <p
                        className="text-[10px] font-black uppercase tracking-widest"
                        style={{ color: "var(--tx-f)" }}
                      >
                        {t.statStock}
                      </p>
                      <p
                        className={`mt-2 text-base font-black tabular-nums ${selectedProduct.available === 0 ? "text-rose-500" : "text-orange-400"}`}
                      >
                        {selectedProduct.available ?? "∞"}
                      </p>
                    </div>
                    <div
                      className="rounded-[14px] p-3.5"
                      style={{
                        background: "var(--inp)",
                        border: "1px solid var(--bd)",
                      }}
                    >
                      <p
                        className="text-[10px] font-black uppercase tracking-widest"
                        style={{ color: "var(--tx-f)" }}
                      >
                        {t.statSold}
                      </p>
                      <p
                        className="mt-2 text-base font-black tabular-nums"
                        style={{ color: "var(--tx)" }}
                      >
                        {selectedProduct.soldCount}
                      </p>
                    </div>
                  </div>

                  {/* Secondary info */}
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{ border: "1px solid var(--bd)" }}
                  >
                    {[
                      {
                        label: t.statSourcePrice,
                        value: selectedProduct.isManual
                          ? t.selfManaged
                          : formatCurrency(selectedProduct.sourcePrice),
                      },
                      {
                        label: t.statProfit,
                        value: formatCurrency(
                          selectedProduct.salePrice -
                            selectedProduct.sourcePrice,
                        ),
                      },
                      {
                        label: t.statImported,
                        value: String(selectedProduct.totalCount),
                      },
                    ].map(({ label, value }, i) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                        style={{
                          borderTop: i > 0 ? "1px solid var(--bd)" : undefined,
                          background: "var(--inp)",
                        }}
                      >
                        <p
                          className="text-[11px] font-black uppercase tracking-widest shrink-0"
                          style={{ color: "var(--tx-f)" }}
                        >
                          {label}
                        </p>
                        <p
                          className="text-sm font-bold text-right"
                          style={{ color: "var(--tx)" }}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {selectedProduct.promoText && (
                    <div
                      className="rounded-2xl p-4"
                      style={{
                        background: "rgba(249,115,22,0.06)",
                        border: "1px solid rgba(249,115,22,0.2)",
                      }}
                    >
                      <p className="text-[10px] font-black uppercase tracking-widest mb-2 text-orange-400">
                        {t.promoSection}
                      </p>
                      <p
                        className="text-sm leading-6"
                        style={{ color: "var(--tx-m)" }}
                      >
                        {selectedProduct.promoText}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2.5">
                    <StudioButton
                      className="flex-1"
                      onClick={() => setDrawerMode("edit")}
                    >
                      <Pencil className="h-4 w-4" /> {t.editProductBtn}
                    </StudioButton>
                    {selectedProduct.isManual && (
                      <StudioButton
                        variant="secondary"
                        onClick={() => {
                          setStockStatusFilter("AVAILABLE");
                          setDrawerMode(null);
                          setStockModal("viewStock");
                        }}
                      >
                        <PackagePlus className="h-4 w-4" /> {t.stockShortBtn}
                      </StudioButton>
                    )}
                  </div>
                </div>
              )}

              {drawerMode === "edit" && renderSelectedProductEditor()}

              {drawerMode === "inventory" && (
                <div className="space-y-4 px-5 py-5">
                  {/* Stats summary */}
                  {selectedProduct && (
                    <div className="grid grid-cols-3 gap-2">
                      <div
                        className="rounded-xl px-3 py-2.5"
                        style={{
                          background: "rgba(52,211,153,0.08)",
                          borderLeft: "3px solid rgb(52,211,153)",
                        }}
                      >
                        <p
                          className="text-[10px] font-black uppercase tracking-wider"
                          style={{ color: "var(--tx-f)" }}
                        >
                          Còn sẵn
                        </p>
                        <p className="text-lg font-black tabular-nums text-emerald-400">
                          {manualInventory?.summary?.availableCount ?? 0}
                        </p>
                      </div>
                      <div
                        className="rounded-xl px-3 py-2.5"
                        style={{
                          background: "rgba(167,139,250,0.08)",
                          borderLeft: "3px solid rgb(167,139,250)",
                        }}
                      >
                        <p
                          className="text-[10px] font-black uppercase tracking-wider"
                          style={{ color: "var(--tx-f)" }}
                        >
                          Đã giao
                        </p>
                        <p
                          className="text-lg font-black tabular-nums"
                          style={{ color: "rgb(167,139,250)" }}
                        >
                          {manualInventory?.summary?.deliveredCount ?? 0}
                        </p>
                      </div>
                      <div
                        className="rounded-xl px-3 py-2.5"
                        style={{
                          background: "rgba(148,163,184,0.06)",
                          borderLeft: "3px solid rgb(148,163,184)",
                        }}
                      >
                        <p
                          className="text-[10px] font-black uppercase tracking-wider"
                          style={{ color: "var(--tx-f)" }}
                        >
                          Đã dọn
                        </p>
                        <p
                          className="text-lg font-black tabular-nums"
                          style={{ color: "var(--tx-m)" }}
                        >
                          {manualInventory?.summary?.hiddenDeliveredCount ?? 0}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p
                        className="text-[11px] font-black uppercase tracking-widest"
                        style={{ color: "rgb(249,115,22)" }}
                      >
                        ➕ Thêm tài khoản
                      </p>
                      <span
                        className="text-[11px] font-bold"
                        style={{ color: "var(--tx-f)" }}
                      >
                        {
                          addAccountsText.split("\n").filter((l) => l.trim())
                            .length
                        }{" "}
                        dòng mới
                      </span>
                    </div>

                    {/* Excel-style table */}
                    <div
                      className="overflow-hidden rounded-xl"
                      style={{
                        border: "1px solid var(--bd)",
                        background: "var(--inp)",
                      }}
                    >
                      <div
                        className="grid grid-cols-[40px_1fr_36px] items-center px-2 py-1.5 text-[10px] font-black uppercase tracking-wider"
                        style={{
                          background: "var(--surface)",
                          borderBottom: "1px solid var(--bd)",
                          color: "var(--tx-f)",
                        }}
                      >
                        <div className="text-center">#</div>
                        <div>Nội dung tài khoản</div>
                        <div></div>
                      </div>
                      <div className="max-h-[340px] overflow-y-auto">
                        {(() => {
                          const lines = addAccountsText.split("\n");
                          // ensure at least 1 empty row to edit
                          const rows = lines.length === 0 ? [""] : lines;
                          return rows.map((line, idx) => (
                            <div
                              key={idx}
                              className="grid grid-cols-[40px_1fr_36px] items-center px-2 py-1"
                              style={{
                                borderTop:
                                  idx > 0 ? "1px solid var(--bd)" : undefined,
                              }}
                            >
                              <div
                                className="text-center text-[11px] tabular-nums"
                                style={{ color: "var(--tx-f)" }}
                              >
                                {idx + 1}
                              </div>
                              <input
                                type="text"
                                value={line}
                                onChange={(e) => {
                                  const next = [...rows];
                                  next[idx] = e.target.value;
                                  setAddAccountsText(next.join("\n"));
                                }}
                                onPaste={(e) => {
                                  const pasted =
                                    e.clipboardData.getData("text");
                                  if (
                                    pasted.includes("\n") ||
                                    pasted.includes("\t")
                                  ) {
                                    e.preventDefault();
                                    // Convert tabs to | so columns from Excel get preserved
                                    const pastedLines = pasted
                                      .replace(/\r/g, "")
                                      .split("\n")
                                      .map((l) => l.replace(/\t/g, "|"));
                                    const next = [...rows];
                                    next.splice(idx, 1, ...pastedLines);
                                    setAddAccountsText(next.join("\n"));
                                  }
                                }}
                                placeholder={
                                  idx === 0 ? "user|pass|note..." : ""
                                }
                                className="w-full bg-transparent px-2 py-1 text-sm font-mono outline-none"
                                style={{ color: "var(--tx)" }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = rows.filter((_, i) => i !== idx);
                                  setAddAccountsText(next.join("\n"));
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-rose-400 hover:bg-rose-500/10"
                                title="Xóa dòng"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ));
                        })()}
                      </div>
                      <div
                        className="flex items-center gap-3 px-2 py-1.5"
                        style={{
                          borderTop: "1px solid var(--bd)",
                          background: "var(--surface)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setAddAccountsText((c) => (c ? c + "\n" : "\n"))
                          }
                          className="text-[11px] font-bold text-orange-400 hover:text-orange-300"
                        >
                          + Thêm dòng
                        </button>
                        <label className="cursor-pointer text-[11px] font-bold text-sky-400 hover:text-sky-300">
                          <Upload className="inline h-3 w-3 mr-0.5" />
                          Upload .txt
                          <input
                            type="file"
                            accept=".txt,text/plain,.csv"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const text = await file.text();
                                const fileLines = text
                                  .replace(/\r/g, "")
                                  .split("\n")
                                  .map((l) => l.replace(/\t/g, "|"));
                                setAddAccountsText((current) => {
                                  const existing = current
                                    ? current.split("\n")
                                    : [];
                                  const merged = [
                                    ...existing,
                                    ...fileLines,
                                  ].filter(
                                    (l, i, arr) =>
                                      l.trim() || i < arr.length - 1,
                                  );
                                  return merged.join("\n");
                                });
                              } catch {
                                // ignore read error
                              } finally {
                                e.target.value = "";
                              }
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("Xóa tất cả dòng đang nhập?"))
                              setAddAccountsText("");
                          }}
                          className="ml-auto text-[11px] font-bold text-rose-400 hover:text-rose-300"
                        >
                          Xóa hết
                        </button>
                      </div>
                    </div>

                    <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>
                      💡 Mẹo: copy nhiều dòng từ Excel → paste vào 1 ô → tự tách
                      thành nhiều dòng. Tab giữa cột Excel tự đổi thành `|`.
                    </p>

                    <StudioButton
                      className="w-full"
                      disabled={
                        addAccountsMutation.isPending || !addAccountsText.trim()
                      }
                      onClick={() => addAccountsMutation.mutate()}
                    >
                      <PackagePlus className="h-4 w-4" />
                      {addAccountsMutation.isPending
                        ? t.addStockSaving
                        : t.addStockBtn}
                    </StudioButton>
                  </div>

                  <div style={{ borderTop: "1px solid var(--bd)" }} />

                  <ManualInventoryPanel
                    inventory={manualInventory}
                    isLoading={inventoryQuery.isLoading}
                    isPurging={purgeDeliveredMutation.isPending}
                    onPurgeAll={() => {
                      if (window.confirm(t.confirmPurge))
                        purgeDeliveredMutation.mutate(undefined);
                    }}
                    onPurgeOne={(entryKey) =>
                      purgeDeliveredMutation.mutate([entryKey])
                    }
                  />
                </div>
              )}

              {drawerMode === "promo" && selectedProduct && (
                <div className="space-y-5 px-5 py-5">
                  {/* Premium banner */}
                  <div
                    className="relative overflow-hidden rounded-2xl p-5"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(249,115,22,0.18) 0%, rgba(217,70,239,0.12) 50%, rgba(99,102,241,0.18) 100%)",
                      border: "1px solid rgba(249,115,22,0.3)",
                    }}
                  >
                    <div
                      className="absolute -top-12 -right-12 h-32 w-32 rounded-full"
                      style={{
                        background: "rgba(249,115,22,0.15)",
                        filter: "blur(40px)",
                      }}
                    />
                    <div className="relative flex items-start gap-3">
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-xl"
                        style={{
                          background: "rgba(249,115,22,0.25)",
                          border: "1px solid rgba(249,115,22,0.4)",
                        }}
                      >
                        ✨
                      </div>
                      <div>
                        <p
                          className="text-[11px] font-black uppercase tracking-widest"
                          style={{ color: "rgb(249,115,22)" }}
                        >
                          Khuyến mãi đặc biệt
                        </p>
                        <p
                          className="mt-1 text-sm font-bold"
                          style={{ color: "var(--tx)" }}
                        >
                          {selectedProduct.displayName}
                        </p>
                        <p
                          className="mt-1 text-[12px]"
                          style={{ color: "var(--tx-m)" }}
                        >
                          Hiện ngay dưới tên sản phẩm trên bot Telegram, in đậm
                          như highlight.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Chế độ khuyến mãi */}
                  <div>
                    <p
                      className="mb-2 text-[11px] font-black uppercase tracking-widest"
                      style={{ color: "var(--tx-f)" }}
                    >
                      Chế độ khuyến mãi
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {(
                        [
                          {
                            key: "NONE",
                            label: "❌ Không",
                            desc: "Không có khuyến mãi",
                          },
                          {
                            key: "BUY_N_GET_M",
                            label: "🎁 Mua M tặng N",
                            desc: "Mỗi M sản phẩm → tặng N",
                          },
                          {
                            key: "BUY_N_PAY_M",
                            label: "💸 Mua M tính tiền N",
                            desc: "Nhận M sản phẩm, chỉ trả tiền N",
                          },
                          {
                            key: "BULK_DISCOUNT",
                            label: "🔥 Mua nhiều giảm %",
                            desc: "Mua ≥ X → giảm Y%",
                          },
                          {
                            key: "PERCENT_DISCOUNT",
                            label: "⚡ Giảm % toàn đơn",
                            desc: "Giảm Y% không cần số lượng tối thiểu",
                          },
                          {
                            key: "TIER_PRICE",
                            label: "🏷️ Giá theo số lượng",
                            desc: "Mỗi khoảng số lượng có giá cố định",
                          },
                        ] as const
                      ).map((opt) => {
                        const active = editorForm.promoType === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() =>
                              setEditorForm((cur) => ({
                                ...cur,
                                promoType: opt.key,
                              }))
                            }
                            className="rounded-xl border-2 p-2.5 text-left transition"
                            style={{
                              borderColor: active
                                ? "rgb(249,115,22)"
                                : "var(--bd)",
                              background: active
                                ? "rgba(249,115,22,0.08)"
                                : "var(--inp)",
                            }}
                          >
                            <p
                              className="text-[12px] font-black"
                              style={{ color: "var(--tx)" }}
                            >
                              {opt.label}
                            </p>
                            <p
                              className="mt-0.5 text-[10px]"
                              style={{ color: "var(--tx-f)" }}
                            >
                              {opt.desc}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Config Buy N Get M */}
                  {editorForm.promoType === "BUY_N_GET_M" && (
                    <div
                      className="rounded-xl p-4 space-y-3"
                      style={{
                        background: "rgba(52,211,153,0.06)",
                        border: "1px solid rgba(52,211,153,0.25)",
                      }}
                    >
                      <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
                        🎁 Mua M tặng N
                      </p>
                      <div className="space-y-2">
                        {editorForm.promoTiers.map((tier, index) => (
                          <div
                            key={index}
                            className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
                          >
                            <Field
                              label={"Mua (M) — mốc " + (index + 1)}
                              hint="Số lượng để được tặng"
                            >
                              <StudioInput
                                placeholder={index === 0 ? "5" : "10"}
                                value={tier.buy}
                                onChange={(e) =>
                                  setEditorForm((current) => ({
                                    ...current,
                                    promoBuyN:
                                      index === 0
                                        ? e.target.value.replace(/[^0-9]/g, "")
                                        : current.promoBuyN,
                                    promoTiers: current.promoTiers.map(
                                      (item, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...item,
                                              buy: e.target.value.replace(
                                                /[^0-9]/g,
                                                "",
                                              ),
                                            }
                                          : item,
                                    ),
                                  }))
                                }
                              />
                            </Field>
                            <Field label="Tặng (N)" hint="Quà của mốc này">
                              <StudioInput
                                placeholder={index === 0 ? "1" : "3"}
                                value={tier.get}
                                onChange={(e) =>
                                  setEditorForm((current) => ({
                                    ...current,
                                    promoGetM:
                                      index === 0
                                        ? e.target.value.replace(/[^0-9]/g, "")
                                        : current.promoGetM,
                                    promoTiers: current.promoTiers.map(
                                      (item, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...item,
                                              get: e.target.value.replace(
                                                /[^0-9]/g,
                                                "",
                                              ),
                                            }
                                          : item,
                                    ),
                                  }))
                                }
                              />
                            </Field>
                            <button
                              type="button"
                              aria-label={
                                index === editorForm.promoTiers.length - 1
                                  ? "Thêm mốc"
                                  : "Xóa mốc"
                              }
                              onClick={() =>
                                setEditorForm((current) =>
                                  index === current.promoTiers.length - 1
                                    ? {
                                        ...current,
                                        promoTiers: [
                                          ...current.promoTiers,
                                          { buy: "", get: "" },
                                        ],
                                      }
                                    : {
                                        ...current,
                                        promoTiers: current.promoTiers.filter(
                                          (_, itemIndex) => itemIndex !== index,
                                        ),
                                      },
                                )
                              }
                              className="h-[42px] min-w-[42px] rounded-xl border text-lg font-black transition hover:brightness-125"
                              style={{
                                borderColor:
                                  index === editorForm.promoTiers.length - 1
                                    ? "rgba(52,211,153,.5)"
                                    : "rgba(244,63,94,.45)",
                                color:
                                  index === editorForm.promoTiers.length - 1
                                    ? "rgb(52,211,153)"
                                    : "rgb(251,113,133)",
                                background: "var(--inp)",
                              }}
                            >
                              {index === editorForm.promoTiers.length - 1
                                ? "+"
                                : "−"}
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-[12px] text-emerald-400">
                        → Hệ thống chọn mốc hợp lệ tặng nhiều nhất; mỗi mốc vẫn
                        tự nhân theo bội số.
                      </p>
                    </div>
                  )}

                  {/* Config Buy M Pay N */}
                  {editorForm.promoType === "BUY_N_PAY_M" && (
                    <div
                      className="rounded-xl p-4 space-y-3"
                      style={{
                        background: "rgba(56,189,248,0.06)",
                        border: "1px solid rgba(56,189,248,0.25)",
                      }}
                    >
                      <p className="text-[11px] font-black uppercase tracking-widest text-sky-400">
                        💸 Mua M tính tiền N
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Nhận (M)" hint="Số sản phẩm khách nhận">
                          <StudioInput
                            placeholder="3"
                            value={editorForm.promoBuyN}
                            onChange={(e) =>
                              setEditorForm((c) => ({
                                ...c,
                                promoBuyN: e.target.value.replace(
                                  /[^0-9]/g,
                                  "",
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Trả tiền (N)" hint="N phải nhỏ hơn M">
                          <StudioInput
                            placeholder="2"
                            value={editorForm.promoGetM}
                            onChange={(e) =>
                              setEditorForm((c) => ({
                                ...c,
                                promoGetM: e.target.value.replace(
                                  /[^0-9]/g,
                                  "",
                                ),
                              }))
                            }
                          />
                        </Field>
                      </div>
                      {editorForm.promoBuyN && editorForm.promoGetM && (
                        <p className="text-[12px] text-sky-400">
                          → Cứ nhận <b>{editorForm.promoBuyN}</b> sản phẩm chỉ
                          tính tiền <b>{editorForm.promoGetM}</b> sản phẩm; ưu
                          đãi tự nhân theo bội số.
                        </p>
                      )}
                    </div>
                  )}

                  {editorForm.promoType === "TIER_PRICE" && (
                    <div
                      className="rounded-xl p-4 space-y-3"
                      style={{
                        background: "rgba(14,165,233,0.06)",
                        border: "1px solid rgba(14,165,233,0.25)",
                      }}
                    >
                      <p className="text-[11px] font-black uppercase tracking-widest text-sky-400">
                        🏷️ Giá cố định theo số lượng
                      </p>
                      <div className="space-y-2">
                        {editorForm.promoPriceTiers.map((tier, index) => (
                          <div
                            key={index}
                            className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
                          >
                            <Field
                              label={`Mua từ — mốc ${index + 1}`}
                              hint="Số lượng tối thiểu"
                            >
                              <StudioInput
                                value={tier.minQty}
                                placeholder={index === 0 ? "1" : "100"}
                                onChange={(e) =>
                                  setEditorForm((current) => ({
                                    ...current,
                                    promoPriceTiers:
                                      current.promoPriceTiers.map(
                                        (item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                minQty: e.target.value.replace(
                                                  /[^0-9]/g,
                                                  "",
                                                ),
                                              }
                                            : item,
                                      ),
                                  }))
                                }
                              />
                            </Field>
                            <Field label="Giá / sản phẩm" hint="VNĐ">
                              <StudioInput
                                value={tier.price}
                                placeholder="10000"
                                onChange={(e) =>
                                  setEditorForm((current) => ({
                                    ...current,
                                    promoPriceTiers:
                                      current.promoPriceTiers.map(
                                        (item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                price: e.target.value.replace(
                                                  /[^0-9]/g,
                                                  "",
                                                ),
                                              }
                                            : item,
                                      ),
                                  }))
                                }
                              />
                            </Field>
                            <button
                              type="button"
                              aria-label={
                                index === editorForm.promoPriceTiers.length - 1
                                  ? "Thêm mốc"
                                  : "Xóa mốc"
                              }
                              onClick={() =>
                                setEditorForm((current) =>
                                  index === current.promoPriceTiers.length - 1
                                    ? {
                                        ...current,
                                        promoPriceTiers: [
                                          ...current.promoPriceTiers,
                                          { minQty: "", price: "" },
                                        ],
                                      }
                                    : {
                                        ...current,
                                        promoPriceTiers:
                                          current.promoPriceTiers.filter(
                                            (_, itemIndex) =>
                                              itemIndex !== index,
                                          ),
                                      },
                                )
                              }
                              className="h-[42px] min-w-[42px] rounded-xl border text-lg font-black"
                              style={{
                                borderColor: "var(--bd)",
                                color: "rgb(56,189,248)",
                                background: "var(--inp)",
                              }}
                            >
                              {index === editorForm.promoPriceTiers.length - 1
                                ? "+"
                                : "−"}
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1 text-[12px] text-sky-400">
                        {editorForm.promoPriceTiers
                          .filter((tier) => tier.minQty && tier.price)
                          .sort((a, b) => Number(a.minQty) - Number(b.minQty))
                          .map((tier, index, tiers) => (
                            <p key={`${tier.minQty}-${index}`}>
                              → Mua từ{" "}
                              <b>
                                {tier.minQty}
                                {tiers[index + 1]
                                  ? `-${Number(tiers[index + 1]?.minQty) - 1}`
                                  : "+"}
                              </b>
                              :{" "}
                              <b>
                                {Number(tier.price).toLocaleString("vi-VN")}
                                đ/sản phẩm
                              </b>
                            </p>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Thời hạn — chỉ hiện khi có promo type */}
                  {editorForm.promoType !== "NONE" && (
                    <div
                      className="rounded-xl p-4 space-y-3"
                      style={{
                        background: "rgba(99,102,241,0.06)",
                        border: "1px solid rgba(99,102,241,0.25)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-black uppercase tracking-widest text-indigo-400">
                          ⏰ Thời hạn áp dụng
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setEditorForm((c) => ({
                              ...c,
                              promoStartAt: "",
                              promoEndAt: "",
                            }))
                          }
                          className="text-[10px] font-bold text-rose-400 hover:text-rose-300"
                        >
                          Xóa thời hạn
                        </button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Bắt đầu" hint="Để trống = bắt đầu ngay">
                          <input
                            type="datetime-local"
                            value={editorForm.promoStartAt}
                            onChange={(e) =>
                              setEditorForm((c) => ({
                                ...c,
                                promoStartAt: e.target.value,
                              }))
                            }
                            className="w-full rounded-[14px] px-3 py-2.5 text-sm outline-none"
                            style={{
                              background: "var(--inp)",
                              border: "1px solid var(--bd)",
                              color: "var(--tx)",
                            }}
                          />
                        </Field>
                        <Field
                          label="Kết thúc"
                          hint="Để trống = không giới hạn"
                        >
                          <input
                            type="datetime-local"
                            value={editorForm.promoEndAt}
                            onChange={(e) =>
                              setEditorForm((c) => ({
                                ...c,
                                promoEndAt: e.target.value,
                              }))
                            }
                            className="w-full rounded-[14px] px-3 py-2.5 text-sm outline-none"
                            style={{
                              background: "var(--inp)",
                              border: "1px solid var(--bd)",
                              color: "var(--tx)",
                            }}
                          />
                        </Field>
                      </div>
                      {(() => {
                        const now = new Date();
                        const start = editorForm.promoStartAt
                          ? new Date(editorForm.promoStartAt)
                          : null;
                        const end = editorForm.promoEndAt
                          ? new Date(editorForm.promoEndAt)
                          : null;
                        const active =
                          (!start || now >= start) && (!end || now <= end);
                        if (!start && !end)
                          return (
                            <p className="text-[12px] text-indigo-400">
                              → Không giới hạn thời gian (luôn áp dụng)
                            </p>
                          );
                        return (
                          <p
                            className={`text-[12px] ${active ? "text-emerald-400" : "text-amber-400"}`}
                          >
                            {active
                              ? "✓ Đang trong thời gian áp dụng"
                              : "⏸ Hiện chưa/đã ngoài thời gian"}
                          </p>
                        );
                      })()}
                    </div>
                  )}

                  {/* Config Bulk Discount */}
                  {editorForm.promoType === "BULK_DISCOUNT" && (
                    <div
                      className="rounded-xl p-4 space-y-3"
                      style={{
                        background: "rgba(249,115,22,0.06)",
                        border: "1px solid rgba(249,115,22,0.25)",
                      }}
                    >
                      <p className="text-[11px] font-black uppercase tracking-widest text-orange-400">
                        🔥 Mua nhiều giảm %
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Số lượng tối thiểu (X)"
                          hint="Mua từ X trở lên"
                        >
                          <StudioInput
                            placeholder="3"
                            value={editorForm.promoBulkMinQty}
                            onChange={(e) =>
                              setEditorForm((c) => ({
                                ...c,
                                promoBulkMinQty: e.target.value.replace(
                                  /[^0-9]/g,
                                  "",
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Giảm giá (Y%)" hint="0-100">
                          <StudioInput
                            placeholder="10"
                            value={editorForm.promoBulkDiscountPct}
                            onChange={(e) =>
                              setEditorForm((c) => ({
                                ...c,
                                promoBulkDiscountPct: e.target.value.replace(
                                  /[^0-9.]/g,
                                  "",
                                ),
                              }))
                            }
                          />
                        </Field>
                      </div>
                      {editorForm.promoBulkMinQty &&
                        editorForm.promoBulkDiscountPct && (
                          <p className="text-[12px] text-orange-400">
                            → Khách mua ≥ <b>{editorForm.promoBulkMinQty}</b>{" "}
                            sản phẩm sẽ được giảm{" "}
                            <b>{editorForm.promoBulkDiscountPct}%</b> tổng giá.
                          </p>
                        )}
                    </div>
                  )}

                  {/* Config Percent Discount */}
                  {editorForm.promoType === "PERCENT_DISCOUNT" && (
                    <div
                      className="rounded-xl p-4 space-y-3"
                      style={{
                        background: "rgba(168,85,247,0.06)",
                        border: "1px solid rgba(168,85,247,0.25)",
                      }}
                    >
                      <p className="text-[11px] font-black uppercase tracking-widest text-purple-400">
                        ⚡ Giảm % toàn đơn
                      </p>
                      <Field
                        label="Giảm giá (Y%)"
                        hint="Áp dụng từ 1 sản phẩm, nhập 0-100"
                      >
                        <StudioInput
                          placeholder="10"
                          value={editorForm.promoBulkDiscountPct}
                          onChange={(e) =>
                            setEditorForm((c) => ({
                              ...c,
                              promoBulkDiscountPct: e.target.value.replace(
                                /[^0-9.]/g,
                                "",
                              ),
                            }))
                          }
                        />
                      </Field>
                      {editorForm.promoBulkDiscountPct && (
                        <p className="text-[12px] text-purple-400">
                          → Mọi đơn hàng được giảm{" "}
                          <b>{editorForm.promoBulkDiscountPct}%</b>.
                        </p>
                      )}
                    </div>
                  )}

                  <Field
                    label={t.fPromo}
                    hint={`${editorForm.promoText.length}/200`}
                    description={t.dPromoDrawer}
                  >
                    <StudioTextArea
                      placeholder={t.phPromo}
                      value={editorForm.promoText}
                      onChange={(e) =>
                        setEditorForm((cur) => ({
                          ...cur,
                          promoText: e.target.value.slice(0, 200),
                        }))
                      }
                    />
                  </Field>

                  {/* Banner image upload */}
                  <div>
                    <p
                      className="mb-2 text-[11px] font-black uppercase tracking-widest"
                      style={{ color: "var(--tx-f)" }}
                    >
                      🖼️ Ảnh / video banner khuyến mãi
                    </p>
                    <p
                      className="mb-2 text-[11px]"
                      style={{ color: "var(--tx-f)" }}
                    >
                      Khi khách xem danh sách sản phẩm, bot sẽ gửi ảnh/video này
                      như 1 tin nhắn riêng kèm caption khuyến mãi.
                    </p>
                    <div className="flex gap-2">
                      <label
                        className="flex cursor-pointer items-center gap-1.5 rounded-[14px] border px-3 py-2 text-sm font-medium transition hover:opacity-80"
                        style={{
                          borderColor: "var(--bd)",
                          background: "var(--inp)",
                          color: "var(--tx-m)",
                        }}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {promoBannerUploading ? "..." : "Tải lên"}
                        <input
                          type="file"
                          accept="image/*,video/mp4,video/quicktime,video/webm"
                          className="hidden"
                          disabled={promoBannerUploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setPromoBannerUploading(true);
                            try {
                              const fd = new FormData();
                              fd.append("file", file);
                              const res = await api.post<{ url: string }>(
                                "/products/upload-image",
                                fd,
                                {
                                  headers: {
                                    "Content-Type": "multipart/form-data",
                                  },
                                },
                              );
                              setEditorForm((c) => ({
                                ...c,
                                promoBannerUrl: res.data.url,
                              }));
                            } catch {
                              // ignore
                            } finally {
                              setPromoBannerUploading(false);
                              e.target.value = "";
                            }
                          }}
                        />
                      </label>
                      <StudioInput
                        placeholder="https://... hoặc upload"
                        value={editorForm.promoBannerUrl}
                        onChange={(e) =>
                          setEditorForm((c) => ({
                            ...c,
                            promoBannerUrl: e.target.value,
                          }))
                        }
                      />
                      {editorForm.promoBannerUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditorForm((c) => ({ ...c, promoBannerUrl: "" }))
                          }
                          className="text-xs text-rose-400 hover:underline px-2"
                        >
                          Xóa
                        </button>
                      )}
                    </div>
                    {editorForm.promoBannerUrl && (
                      <MediaPreview
                        url={editorForm.promoBannerUrl}
                        className="mt-2 max-h-48 rounded-xl object-contain"
                      />
                    )}
                  </div>

                  {/* Preview */}
                  {editorForm.promoText.trim() && (
                    <div>
                      <p
                        className="mb-2 text-[11px] font-black uppercase tracking-widest"
                        style={{ color: "var(--tx-f)" }}
                      >
                        Xem trước trên bot
                      </p>
                      <div
                        className="rounded-2xl p-4"
                        style={{
                          background: "var(--inp)",
                          border: "1px solid var(--bd)",
                        }}
                      >
                        <p
                          className="text-sm font-bold"
                          style={{ color: "var(--tx)" }}
                        >
                          {selectedProduct.displayName}
                        </p>
                        <p className="mt-1.5 text-sm font-bold text-orange-400 whitespace-pre-wrap">
                          {editorForm.promoText}
                        </p>
                        <p
                          className="mt-1.5 text-sm"
                          style={{ color: "var(--tx-m)" }}
                        >
                          {formatCurrency(
                            Number(
                              editorForm.salePrice || selectedProduct.salePrice,
                            ),
                          )}
                        </p>
                      </div>
                    </div>
                  )}

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
                <div className="space-y-5 px-5 py-5">
                  <Field label={t.fDisplayName} hint={t.hRequired}>
                    <StudioInput
                      placeholder={t.phCreateName}
                      value={createForm.displayName}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          displayName: event.target.value,
                        }))
                      }
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.fSalePrice} hint={t.hVnd}>
                      <StudioInput
                        placeholder={t.phSalePrice}
                        value={createForm.salePrice}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            salePrice: event.target.value,
                          }))
                        }
                      />
                    </Field>

                    <Field
                      label={t.fUsd}
                      hint={t.hOptional}
                      description={
                        createForm.salePriceUsd.trim()
                          ? t.dUsdActive(createForm.salePriceUsd)
                          : t.dUsdEmpty
                      }
                    >
                      <StudioInput
                        placeholder={t.phUsd}
                        value={createForm.salePriceUsd}
                        onChange={(e) =>
                          setCreateForm((c) => ({
                            ...c,
                            salePriceUsd: e.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>

                  <PreorderSettings
                    enabled={createForm.preorderEnabled}
                    feePercent={createForm.preorderFeePercent}
                    disabled={createIsAddMail}
                    onEnabledChange={(preorderEnabled) =>
                      setCreateForm((current) => ({
                        ...current,
                        preorderEnabled,
                      }))
                    }
                    onFeeChange={(preorderFeePercent) =>
                      setCreateForm((current) => ({
                        ...current,
                        preorderFeePercent,
                      }))
                    }
                  />

                  {isUltra && (
                    <div
                      className="rounded-[14px] px-3 py-2.5 space-y-2"
                      style={{
                        background: "rgba(139,92,246,0.06)",
                        border: "1px solid rgba(139,92,246,0.2)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5"
                          style={{ color: "rgb(167,139,250)" }}
                        >
                          <Crown className="h-3 w-3" /> {t.wholesaleTitle}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setCreateForm((c) => ({
                              ...c,
                              internalSourceEnabled: !c.internalSourceEnabled,
                            }))
                          }
                          className="rounded-lg px-2.5 py-1 text-[11px] font-bold transition"
                          style={{
                            borderColor: createForm.internalSourceEnabled
                              ? "rgba(139,92,246,0.3)"
                              : "var(--bd)",
                            background: createForm.internalSourceEnabled
                              ? "rgba(139,92,246,0.15)"
                              : "var(--inp)",
                            color: createForm.internalSourceEnabled
                              ? "rgb(167,139,250)"
                              : "var(--tx-f)",
                            border: "1px solid",
                          }}
                        >
                          {t.allowProBuy}:{" "}
                          {createForm.internalSourceEnabled ? t.bOn : t.bOff}
                        </button>
                      </div>
                      <StudioInput
                        placeholder={t.phWholesale}
                        value={createForm.internalSourcePrice}
                        onChange={(e) =>
                          setCreateForm((c) => ({
                            ...c,
                            internalSourcePrice: e.target.value,
                          }))
                        }
                      />
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={t.fIntCost}
                      hint={t.hOptional}
                      description={t.dIntCost}
                    >
                      <StudioInput
                        placeholder={t.phIntCost}
                        value={createForm.sourcePrice}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            sourcePrice: event.target.value,
                          }))
                        }
                      />
                    </Field>

                    <Field
                      label={t.fStock}
                      hint={createUsesAutoStock ? t.hAutoCalc : t.hOptional}
                      description={
                        createUsesAutoStock
                          ? t.dCreateStockAuto
                          : createIsShared
                            ? t.dStockShared
                            : t.dCreateStockManual
                      }
                    >
                      <StudioInput
                        disabled={createUsesAutoStock}
                        placeholder={
                          createUsesAutoStock
                            ? t.phCreateStockAuto
                            : t.phCreateStock
                        }
                        value={createForm.available}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            available: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>

                  <Field
                    label={t.fDesc}
                    hint={t.hOptional}
                    description={t.dDesc}
                  >
                    <StudioTextArea
                      placeholder={t.phDesc}
                      value={createForm.sourceDescription}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          sourceDescription: event.target.value,
                        }))
                      }
                    />
                  </Field>

                  <div
                    className="space-y-4 rounded-2xl border p-4"
                    style={{
                      borderColor: "var(--bd)",
                      background: "var(--inp)",
                    }}
                  >
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.24em]"
                      style={{ color: "var(--tx-f)" }}
                    >
                      Phân loại sản phẩm
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Dòng sản phẩm" hint={t.hOptional}>
                        <select
                          value={createForm.productFamily}
                          onChange={(e) => {
                            const newFamily = e.target.value;
                            setCreateForm((c) => {
                              const next: ManualProductForm = {
                                ...c,
                                productFamily: newFamily,
                                productPackage:
                                  c.productFamily === newFamily
                                    ? c.productPackage
                                    : "",
                              };
                              if (!c.displayName.trim()) {
                                const autoName = buildAutoProductName({
                                  productFamily: newFamily,
                                  productPackage: next.productPackage,
                                  durationType: next.durationType,
                                  warrantyPolicy: next.warrantyPolicy,
                                });
                                if (autoName) next.displayName = autoName;
                              }
                              return next;
                            });
                          }}
                          className="h-11 w-full rounded-[14px] border px-3 text-sm"
                          style={{
                            borderColor: "var(--bd)",
                            background: "var(--inp)",
                            color: "var(--tx)",
                          }}
                        >
                          <option value="">— Chọn —</option>
                          {familyOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label="Gói sản phẩm" hint={t.hOptional}>
                        <select
                          value={createForm.productPackage}
                          disabled={
                            !createForm.productFamily ||
                            createForm.productFamily === "OTHER"
                          }
                          onChange={(e) => {
                            const newPkg = e.target.value;
                            setCreateForm((c) => {
                              const next: ManualProductForm = {
                                ...c,
                                productPackage: newPkg,
                              };
                              if (!c.displayName.trim()) {
                                const autoName = buildAutoProductName({
                                  productFamily: c.productFamily,
                                  productPackage: newPkg,
                                  durationType: c.durationType,
                                  warrantyPolicy: c.warrantyPolicy,
                                });
                                if (autoName) next.displayName = autoName;
                              }
                              return next;
                            });
                          }}
                          className="h-11 w-full rounded-[14px] border px-3 text-sm disabled:opacity-50"
                          style={{
                            borderColor: "var(--bd)",
                            background: "var(--inp)",
                            color: "var(--tx)",
                          }}
                        >
                          <option value="">— Chọn —</option>
                          {(
                            sourceProductPackageOptions[
                              createForm.productFamily
                            ] || []
                          ).map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label="Loại tài khoản" hint={t.hOptional}>
                        <select
                          value={createForm.accountType}
                          disabled={createIsAddMail}
                          onChange={(e) =>
                            setCreateForm((c) => ({
                              ...c,
                              accountType: e.target.value,
                            }))
                          }
                          className="h-11 w-full rounded-[14px] border px-3 text-sm"
                          style={{
                            borderColor: "var(--bd)",
                            background: "var(--inp)",
                            color: "var(--tx)",
                          }}
                        >
                          <option value="">— Chọn —</option>
                          {sourceAccountTypeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label="Thời hạn" hint={t.hOptional}>
                        <select
                          value={createForm.durationType}
                          onChange={(e) => {
                            const newDur = e.target.value;
                            setCreateForm((c) => {
                              const next: ManualProductForm = {
                                ...c,
                                durationType: newDur,
                              };
                              if (!c.displayName.trim()) {
                                const autoName = buildAutoProductName({
                                  productFamily: c.productFamily,
                                  productPackage: c.productPackage,
                                  durationType: newDur,
                                  warrantyPolicy: c.warrantyPolicy,
                                });
                                if (autoName) next.displayName = autoName;
                              }
                              return next;
                            });
                          }}
                          className="h-11 w-full rounded-[14px] border px-3 text-sm"
                          style={{
                            borderColor: "var(--bd)",
                            background: "var(--inp)",
                            color: "var(--tx)",
                          }}
                        >
                          <option value="">— Chọn —</option>
                          {sourceDurationTypeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  </div>

                  <div
                    className="space-y-4 rounded-2xl border p-4"
                    style={{
                      borderColor: "var(--bd)",
                      background: "var(--inp)",
                    }}
                  >
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.24em]"
                      style={{ color: "var(--tx-f)" }}
                    >
                      Bảo hành
                    </p>
                    <Field label="Chính sách bảo hành" hint={t.hOptional}>
                      <select
                        value={createForm.warrantyPolicy}
                        onChange={(e) => {
                          const newWarranty = e.target.value;
                          setCreateForm((c) => {
                            const next: ManualProductForm = {
                              ...c,
                              warrantyPolicy: newWarranty,
                            };
                            if (!c.displayName.trim()) {
                              const autoName = buildAutoProductName({
                                productFamily: c.productFamily,
                                productPackage: c.productPackage,
                                durationType: c.durationType,
                                warrantyPolicy: newWarranty,
                              });
                              if (autoName) next.displayName = autoName;
                            }
                            return next;
                          });
                        }}
                        className="h-11 w-full rounded-[14px] border px-3 text-sm"
                        style={{
                          borderColor: "var(--bd)",
                          background: "var(--inp)",
                          color: "var(--tx)",
                        }}
                      >
                        {sourceWarrantyPolicyOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <Field
                    label={t.fUsageInstructions}
                    hint={t.hOptional}
                    description={t.dUsageInstructions}
                  >
                    <StudioTextArea
                      placeholder={t.phUsageInstructions}
                      value={createForm.usageInstructions}
                      onChange={(e) =>
                        setCreateForm((c) => ({
                          ...c,
                          usageInstructions: e.target.value,
                        }))
                      }
                    />
                  </Field>

                  <Field
                    label={t.fProductIcon}
                    hint={t.hOptional}
                    description={t.dProductIcon}
                  >
                    <div className="flex items-center gap-2">
                      {(() => {
                        const matched = createForm.iconCustomEmojiId
                          ? iconCatalog.find(
                              (i) =>
                                i.customEmojiId ===
                                createForm.iconCustomEmojiId,
                            )
                          : null;
                        return (
                          <button
                            type="button"
                            onClick={() => setIconPickerTarget("create")}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border hover:opacity-80"
                            style={{
                              borderColor: "var(--bd)",
                              background: "var(--inp)",
                            }}
                            title="Chọn icon từ thư viện"
                          >
                            {matched ? (
                              <img
                                src={matched.imageUrl}
                                alt=""
                                className="h-7 w-7 object-contain"
                              />
                            ) : createForm.productIcon ? (
                              <span className="text-xl leading-none">
                                {createForm.productIcon}
                              </span>
                            ) : (
                              <Plus
                                className="h-4 w-4"
                                style={{ color: "var(--tx-f)" }}
                              />
                            )}
                          </button>
                        );
                      })()}
                      <StudioInput
                        placeholder={t.phProductIcon}
                        value={createForm.productIcon}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            productIcon: event.target.value,
                          }))
                        }
                      />
                      {createForm.iconCustomEmojiId && (
                        <button
                          type="button"
                          onClick={() =>
                            setCreateForm((c) => ({
                              ...c,
                              iconCustomEmojiId: "",
                            }))
                          }
                          className="text-xs text-rose-400 hover:underline"
                        >
                          bỏ icon
                        </button>
                      )}
                    </div>
                  </Field>

                  <Field
                    label={t.fImageUrl}
                    hint={t.hOptional}
                    description={t.dImageUrl}
                  >
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <label
                          className="flex cursor-pointer items-center gap-1.5 rounded-[14px] border px-3 py-2 text-sm font-medium transition hover:opacity-80"
                          style={{
                            borderColor: "var(--bd)",
                            background: "var(--inp)",
                            color: "var(--tx-m)",
                          }}
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {createImageUploading
                            ? "..."
                            : lang === "vi"
                              ? "Tải ảnh lên"
                              : "Upload"}
                          <input
                            type="file"
                            accept="image/*,video/mp4,video/quicktime,video/webm"
                            className="hidden"
                            disabled={createImageUploading}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setCreateImageUploading(true);
                              try {
                                const fd = new FormData();
                                fd.append("file", file);
                                const res = await api.post<{ url: string }>(
                                  "/products/upload-image",
                                  fd,
                                  {
                                    headers: {
                                      "Content-Type": "multipart/form-data",
                                    },
                                  },
                                );
                                setCreateForm((c) => ({
                                  ...c,
                                  imageUrl: res.data.url,
                                }));
                              } catch {
                                // keep existing URL on error
                              } finally {
                                setCreateImageUploading(false);
                                e.target.value = "";
                              }
                            }}
                          />
                        </label>
                        <StudioInput
                          placeholder={t.phImageUrl}
                          value={createForm.imageUrl}
                          onChange={(event) =>
                            setCreateForm((current) => ({
                              ...current,
                              imageUrl: event.target.value,
                            }))
                          }
                        />
                      </div>
                      {createForm.imageUrl.trim() && (
                        <MediaPreview
                          url={createForm.imageUrl}
                          className="h-16 w-16 rounded-xl object-cover"
                        />
                      )}
                    </div>
                  </Field>

                  <Field label="Loại giao hàng" hint={t.hRequired}>
                    <select
                      value={createForm.sourceDeliveryMode}
                      onChange={(e) => {
                        const sourceDeliveryMode = e.target.value;
                        setCreateForm((c) => ({
                          ...c,
                          sourceDeliveryMode,
                          accountType:
                            sourceDeliveryMode === "ADD_MAIL"
                              ? "ADD_FAMILY"
                              : c.accountType,
                          isShared:
                            sourceDeliveryMode === "ADD_MAIL"
                              ? false
                              : c.isShared,
                          deliveryText:
                            sourceDeliveryMode === "ADD_MAIL"
                              ? ""
                              : c.deliveryText,
                          preorderEnabled:
                            sourceDeliveryMode === "ADD_MAIL"
                              ? false
                              : c.preorderEnabled,
                        }));
                      }}
                      className="h-11 w-full rounded-[14px] border px-3 text-sm"
                      style={{
                        borderColor: "var(--bd)",
                        background: "var(--inp)",
                        color: "var(--tx)",
                      }}
                    >
                      {sourceDeliveryModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="Kiểu nội dung giao hàng"
                    hint={t.hManualDelivery}
                  >
                    <div className="flex flex-col gap-2">
                      {(
                        [
                          ["unique", t.deliveryModeUnique],
                          ["shared", t.deliveryModeShared],
                        ] as const
                      ).map(([mode, label]) => (
                        <label
                          key={mode}
                          className="flex items-start gap-2.5 cursor-pointer select-none"
                        >
                          <input
                            type="radio"
                            name="create-delivery-mode"
                            checked={
                              mode === "shared"
                                ? createForm.isShared
                                : !createForm.isShared
                            }
                            disabled={createIsAddMail}
                            onChange={() =>
                              setCreateForm((c) => ({
                                ...c,
                                isShared: mode === "shared",
                              }))
                            }
                            className="mt-0.5"
                          />
                          <span
                            className="text-sm"
                            style={{ color: "var(--tx-m)" }}
                          >
                            {label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </Field>

                  {createIsAddMail ? (
                    <div
                      className="rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-3 text-sm"
                      style={{ color: "var(--tx-m)" }}
                    >
                      Bot sẽ yêu cầu khách nhập email trước khi thanh toán.
                      Email được hiển thị trong mục Đơn chờ xử lý để seller copy
                      và thêm vào Family.
                    </div>
                  ) : createIsShared ? (
                    <Field
                      label={t.fSharedContent}
                      hint={t.hRequired}
                      description={t.dSharedContent}
                    >
                      <StudioTextArea
                        placeholder={t.phSharedContent}
                        value={createForm.sharedContent}
                        onChange={(e) =>
                          setCreateForm((c) => ({
                            ...c,
                            sharedContent: e.target.value,
                          }))
                        }
                      />
                    </Field>
                  ) : (
                    <>
                      <Field
                        label={t.fDeliveryFormat}
                        hint={t.hOptional}
                        description={t.dDeliveryFormat}
                      >
                        <StudioInput
                          placeholder={t.phDeliveryFormat}
                          value={createForm.deliveryFormatHint}
                          onChange={(e) =>
                            setCreateForm((c) => ({
                              ...c,
                              deliveryFormatHint: e.target.value,
                            }))
                          }
                        />
                      </Field>
                      <div
                        className="rounded-xl border px-4 py-3 text-sm"
                        style={{
                          borderColor: "rgba(249,115,22,0.28)",
                          background: "rgba(249,115,22,0.08)",
                          color: "var(--tx-m)",
                        }}
                      >
                        {inventoryPrompt}
                        <button
                          type="button"
                          onClick={openInventoryAfterCreate}
                          disabled={createMutation.isPending}
                          className="font-black text-orange-400 underline decoration-orange-400/50 underline-offset-4 transition hover:text-orange-300 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {createMutation.isPending
                            ? savingBeforeInventory
                            : inventoryLinkLabel}
                        </button>
                      </div>
                    </>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[11px] font-bold uppercase tracking-wide"
                      style={{ color: "var(--tx-f)" }}
                    >
                      Hiển thị:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCreateForm((c) => ({ ...c, hiddenVi: !c.hiddenVi }))
                      }
                      className="rounded-md px-2 py-0.5 text-[11px] font-bold transition"
                      style={{
                        background: createForm.hiddenVi
                          ? "rgba(100,116,139,0.15)"
                          : "rgba(52,211,153,0.15)",
                        color: createForm.hiddenVi
                          ? "var(--tx-f)"
                          : "rgb(52,211,153)",
                        border: `1px solid ${createForm.hiddenVi ? "var(--bd)" : "rgba(52,211,153,0.3)"}`,
                      }}
                      title={createForm.hiddenVi ? t.hiddenViOn : t.hiddenViOff}
                    >
                      🇻🇳 {createForm.hiddenVi ? "ẩn" : "✓"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCreateForm((c) => ({ ...c, hiddenEn: !c.hiddenEn }))
                      }
                      className="rounded-md px-2 py-0.5 text-[11px] font-bold transition"
                      style={{
                        background: createForm.hiddenEn
                          ? "rgba(100,116,139,0.15)"
                          : "rgba(52,211,153,0.15)",
                        color: createForm.hiddenEn
                          ? "var(--tx-f)"
                          : "rgb(52,211,153)",
                        border: `1px solid ${createForm.hiddenEn ? "var(--bd)" : "rgba(52,211,153,0.3)"}`,
                      }}
                      title={createForm.hiddenEn ? t.hiddenEnOn : t.hiddenEnOff}
                    >
                      🌍 {createForm.hiddenEn ? "ẩn" : "✓"}
                    </button>
                  </div>

                  <button
                    className="w-full rounded-xl border px-3 py-2.5 text-left transition"
                    style={{
                      borderColor:
                        createForm.enabled && !createForm.hidden
                          ? "rgba(52,211,153,0.25)"
                          : "var(--bd)",
                      background:
                        createForm.enabled && !createForm.hidden
                          ? "rgba(16,185,129,0.08)"
                          : "var(--inp)",
                    }}
                    onClick={() => {
                      const willShow = !(
                        createForm.enabled && !createForm.hidden
                      );
                      setCreateForm((current) => ({
                        ...current,
                        enabled: willShow,
                        hidden: !willShow,
                      }));
                    }}
                    type="button"
                    title="Bật/tắt sản phẩm trên bot"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className="text-[13px] font-semibold"
                        style={{ color: "var(--tx)" }}
                      >
                        Hiển thị trên bot
                      </p>
                      <StudioBadge
                        tone={
                          createForm.enabled && !createForm.hidden
                            ? "success"
                            : "neutral"
                        }
                      >
                        {createForm.enabled && !createForm.hidden
                          ? t.bOn
                          : t.bOff}
                      </StudioBadge>
                    </div>
                  </button>

                  {groups.length > 0 && (
                    <Field label={t.fGroup} hint={t.hOptional}>
                      <select
                        value={createForm.groupId ?? ""}
                        onChange={(e) =>
                          setCreateForm((c) => ({
                            ...c,
                            groupId: e.target.value || null,
                          }))
                        }
                        className="w-full rounded-[14px] border px-3 py-2.5 text-sm font-medium transition"
                        style={{
                          backgroundColor: "var(--inp)",
                          borderColor: "var(--bd)",
                          color: "var(--tx)",
                        }}
                      >
                        <option value="">{t.phGroup}</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}

                  <Notice tone="warning">{t.createNotice}</Notice>

                  <StudioButton
                    size="sm"
                    className="h-10 w-full text-[11px]"
                    disabled={createMutation.isPending}
                    onClick={() => createMutation.mutate()}
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    {createMutation.isPending ? t.creating : t.createBtn}
                  </StudioButton>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Icon Picker Modal */}
      {(iconPickerGroupId || iconPickerTarget) &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={() => {
              setIconPickerGroupId(null);
              setIconPickerTarget(null);
            }}
          >
            <div
              className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl overflow-hidden"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--bd)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between px-5 py-4 shrink-0"
                style={{ borderBottom: "1px solid var(--bd)" }}
              >
                <div>
                  <p
                    className="text-[11px] font-black uppercase tracking-widest mb-0.5"
                    style={{ color: "rgb(99,102,241)" }}
                  >
                    Chọn icon
                  </p>
                  <p
                    className="text-sm font-black"
                    style={{ color: "var(--tx)" }}
                  >
                    {iconPickerGroupId
                      ? groups.find((g) => g.id === iconPickerGroupId)?.name ||
                        "—"
                      : iconPickerTarget === "editor"
                        ? editorForm.displayName || "Sản phẩm"
                        : "Sản phẩm mới"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIconPickerGroupId(null);
                    setIconPickerTarget(null);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-xl transition hover:opacity-70"
                  style={{
                    background: "var(--inp)",
                    border: "1px solid var(--bd)",
                    color: "var(--tx-f)",
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="overflow-y-auto p-5 space-y-4">
                {iconCatalog.length === 0 && !showNewIconForm && (
                  <p
                    className="text-center text-sm py-6"
                    style={{ color: "var(--tx-f)" }}
                  >
                    Chưa có icon nào trong thư viện. Bấm "Thêm icon mới" để tạo.
                  </p>
                )}
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                  {iconCatalog.map((icon) => (
                    <div key={icon.id} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (iconPickerGroupId) {
                            setGroupIconMutation.mutate({
                              id: iconPickerGroupId,
                              icon: icon.label,
                              iconCustomEmojiId: icon.customEmojiId,
                            });
                          } else if (iconPickerTarget === "editor") {
                            setEditorForm((c) => ({
                              ...c,
                              productIcon: icon.label,
                              iconCustomEmojiId: icon.customEmojiId,
                            }));
                            setIconPickerTarget(null);
                          } else if (iconPickerTarget === "create") {
                            setCreateForm((c) => ({
                              ...c,
                              productIcon: icon.label,
                              iconCustomEmojiId: icon.customEmojiId,
                            }));
                            setIconPickerTarget(null);
                          }
                        }}
                        className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border transition hover:border-indigo-400/50 hover:bg-indigo-500/10"
                        style={{
                          borderColor: "var(--bd)",
                          background: "var(--inp)",
                        }}
                      >
                        <img
                          src={icon.imageUrl}
                          alt=""
                          className="h-8 w-8 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.opacity =
                              "0.3";
                          }}
                        />
                        <span
                          className="text-[10px] font-bold truncate w-full px-1 text-center"
                          style={{ color: "var(--tx-m)" }}
                        >
                          {icon.label}
                        </span>
                      </button>
                      {icon.shopId !== null && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Xóa icon "${icon.label}"?`))
                              deleteIconMutation.mutate(icon.id);
                          }}
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
                  <div
                    className="rounded-xl p-4 space-y-3"
                    style={{
                      background: "var(--inp)",
                      border: "1px solid var(--bd)",
                    }}
                  >
                    <p
                      className="text-sm font-bold"
                      style={{ color: "var(--tx)" }}
                    >
                      Thêm icon mới
                    </p>
                    <div>
                      <p
                        className="mb-1 text-xs"
                        style={{ color: "var(--tx-m)" }}
                      >
                        Tên (ví dụ: CapCut)
                      </p>
                      <input
                        value={newIconLabel}
                        onChange={(e) => setNewIconLabel(e.target.value)}
                        placeholder="CapCut"
                        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--bd)",
                          color: "var(--tx)",
                        }}
                      />
                    </div>
                    <div>
                      <p
                        className="mb-1 text-xs"
                        style={{ color: "var(--tx-m)" }}
                      >
                        Ảnh logo
                      </p>
                      <div className="flex gap-2">
                        <label
                          className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-80"
                          style={{
                            borderColor: "var(--bd)",
                            background: "var(--surface)",
                            color: "var(--tx-m)",
                          }}
                        >
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
                                const res = await api.post<{ url: string }>(
                                  "/products/upload-image",
                                  fd,
                                  {
                                    headers: {
                                      "Content-Type": "multipart/form-data",
                                    },
                                  },
                                );
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
                          style={{
                            background: "var(--surface)",
                            border: "1px solid var(--bd)",
                            color: "var(--tx)",
                          }}
                        />
                      </div>
                      {newIconImageUrl && (
                        <img
                          src={newIconImageUrl}
                          alt=""
                          className="mt-2 h-10 w-10 rounded-lg object-contain"
                        />
                      )}
                    </div>
                    <div>
                      <p
                        className="mb-1 text-xs"
                        style={{ color: "var(--tx-m)" }}
                      >
                        Telegram Custom Emoji ID
                      </p>
                      <input
                        value={newIconCustomEmojiId}
                        onChange={(e) =>
                          setNewIconCustomEmojiId(e.target.value)
                        }
                        placeholder="5234567890123456789"
                        className="w-full rounded-lg px-3 py-2 font-mono text-sm outline-none"
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--bd)",
                          color: "var(--tx)",
                        }}
                      />
                      <p
                        className="mt-1 text-[11px]"
                        style={{ color: "var(--tx-f)" }}
                      >
                        Lấy ID từ pack emoji premium trên Telegram
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          createIconMutation.mutate({
                            label: newIconLabel.trim(),
                            imageUrl: newIconImageUrl.trim(),
                            customEmojiId: newIconCustomEmojiId.trim(),
                          })
                        }
                        disabled={
                          !newIconLabel.trim() ||
                          !newIconImageUrl.trim() ||
                          !newIconCustomEmojiId.trim() ||
                          createIconMutation.isPending
                        }
                        className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-600 disabled:opacity-50"
                      >
                        Lưu
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewIconForm(false);
                          setNewIconLabel("");
                          setNewIconImageUrl("");
                          setNewIconCustomEmojiId("");
                        }}
                        className="rounded-lg border px-4 py-2 text-sm font-bold"
                        style={{
                          borderColor: "var(--bd)",
                          color: "var(--tx-m)",
                        }}
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

      {/* Manual stock: upload / extract / history modals */}
      <UploadStockModal
        open={stockModal === "upload"}
        onClose={() => setStockModal(null)}
        productName={selectedProduct?.displayName ?? ""}
        currentStock={
          manualInventory?.summary?.availableCount ??
          selectedProduct?.available ??
          0
        }
        isUploading={uploadStockMutation.isPending}
        onUpload={(file) => uploadStockMutation.mutate(file)}
      />
      <UploadStockResultModal
        open={stockModal === "uploadResult"}
        onClose={() => {
          setStockModal(null);
          setUploadResult(null);
        }}
        result={uploadResult}
      />
      <ExtractStockModal
        open={stockModal === "extract"}
        onClose={() => setStockModal(null)}
        productName={selectedProduct?.displayName ?? ""}
        currentStock={
          manualInventory?.summary?.availableCount ??
          selectedProduct?.available ??
          0
        }
        isExtracting={extractStockMutation.isPending}
        onExtract={(payload) => extractStockMutation.mutate(payload)}
        onListEntries={listStockEntries}
      />
      <ExtractStockResultModal
        open={stockModal === "extractResult"}
        onClose={() => {
          setStockModal(null);
          setExtractResult(null);
        }}
        result={extractResult}
      />
      <StockHistoryModal
        open={stockModal === "history"}
        onClose={() => setStockModal(null)}
        productName={selectedProduct?.displayName ?? ""}
        items={stockHistoryQuery.data?.items ?? []}
        isLoading={stockHistoryQuery.isLoading}
      />
      <CreateBatchModal
        open={stockModal === "createBatch"}
        onClose={() => setStockModal(null)}
        productName={selectedProduct?.displayName ?? ""}
        isSubmitting={createBatchMutation.isPending}
        onSubmit={(payload) => createBatchMutation.mutate(payload)}
      />
      <ViewStockModal
        open={stockModal === "viewStock"}
        onClose={() => setStockModal(null)}
        productName={selectedProduct?.displayName ?? ""}
        data={stockViewQuery.data ?? null}
        batches={stockBatchesQuery.data ?? null}
        isLoading={stockViewQuery.isLoading || stockBatchesQuery.isLoading}
        statusFilter={stockStatusFilter}
        onStatusChange={(s) => setStockStatusFilter(s)}
        searchValue={stockSearch}
        onSearchChange={setStockSearch}
        onCreateBatchRequest={() => setStockModal("createBatch")}
        onShowHistory={() => setStockModal("history")}
        onExtractRequest={(ids, wholeBatchId) => {
          if (ids.length === 0) return;
          extractStockMutation.mutate(
            wholeBatchId
              ? ({ mode: "BATCH", batchId: wholeBatchId } as any)
              : ({ mode: "MANUAL_BY_ID", entryIds: ids } as any),
          );
        }}
        onDeleteBatch={(batchId) => {
          if (window.confirm("Xóa lô này?"))
            deleteBatchMutation.mutate(batchId);
        }}
        onSetBatchPriority={(batchId, priority) =>
          setBatchPriorityMutation.mutate({ batchId, priority })
        }
      />
    </div>
  );
}
