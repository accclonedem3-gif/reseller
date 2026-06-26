import type { AxiosError } from "axios";
import {
  Bell,
  Cable,
  RefreshCcw,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";
import { hasSellerCapability } from "@/lib/seller-access";

const T = {
  vi: {
    gateTitle: "Kết nối nguồn chưa được kích hoạt",
    gateDesc: "Tài khoản PRO có thể kết nối vào kho ULTRA hoặc tạo kho để PRO kết nối vào. Tài khoản FREE chỉ xem được.",
    eyebrow: "Mạng lưới nội bộ",
    title: "Kết nối nguồn",
    descUltra: "Cấp API key cho seller PRO kết nối vào kho của bạn. Theo dõi đại lý, xử lý đơn sỉ và nhận cảnh báo tồn kho.",
    descPRO: "Kết nối vào kho ULTRA để nhận catalog và giá sỉ tự động. Nạp số dư để đặt hàng.",
    statConnections: "Kết nối",
    statApiKeys: "API key",
    statOrders: "Đơn sỉ",
    statPending: "Chờ xử lý",
    syncBtn: "Xác thực & đồng bộ",
    syncing: "Đang đồng bộ...",
    toastSynced: "Đã xác thực và yêu cầu đồng bộ catalog.",
    toastConnected: "Đã kết nối vào nguồn nội bộ.",
    toastTopup: "Đã nạp số dư kết nối nguồn.",
    toastRevoked: "Đã thu hồi API key.",
    toastManualDelivered: "Đã giao hàng thủ công thành công.",
    toastManualFailed: "Đã đánh dấu thất bại và hoàn tiền.",
    toastAlertSaved: "Đã lưu cài đặt cảnh báo.",
    toastError: "Có lỗi xảy ra. Vui lòng thử lại.",
    currentConnectionTitle: "Nguồn đang kết nối",
    infoSourceShop: "Shop nguồn",
    infoSeller: "Seller",
    infoApiKey: "API key",
    infoLastSync: "Đồng bộ lần cuối",
    infoLastOrder: "Đặt hàng lần cuối",
    topupTitle: "Nạp số dư kết nối",
    topupDesc: "Chuyển từ ví seller vào số dư kết nối để đặt hàng sỉ tự động.",
    topupAmountPh: "Số tiền...",
    topupLoading: "Đang nạp...",
    topupBtn: "Nạp ngay",
    connectTitle: "Kết nối vào kho ULTRA",
    connectDesc: "Dán API key nhận từ tổng sỉ ULTRA để kết nối. Catalog và giá sỉ sẽ tự đồng bộ ngay sau khi kết nối thành công.",
    connectPh: "src_••••••••••••••••••••••••••••••••",
    connecting: "Đang kết nối...",
    connectBtn: "Kết nối nguồn",
    onboardKicker: "Tổng sỉ ULTRA",
    onboardTitle: "3 bước để PRO seller kết nối vào kho của bạn",
    onboardStep1Title: "Tạo API key",
    onboardStep1Desc: "Nhắn /api trong bot PRO. Key chỉ hiện 1 lần — copy ngay và lưu lại.",
    onboardStep2Title: "Gửi key cho PRO seller",
    onboardStep2Desc: "Chia sẻ chuỗi key (bắt đầu bằng src_) qua Telegram hoặc kênh bảo mật.",
    onboardStep3Title: "PRO dán key vào Source Network",
    onboardStep3Desc: "PRO vào Kết nối nguồn → dán key → bấm Kết nối. Catalog tự đồng bộ ngay lập tức.",
    onboardFooter: "Mỗi key có thể thu hồi bất cứ lúc nào. PRO seller sau khi kết nối sẽ thấy kho sản phẩm và đặt hàng tự động.",
    keysTitle: "API keys đã cấp",
    keysDesc: (cmd: string) => `Key được tạo tự động qua lệnh ${cmd} trong bot PRO.`,
    keysEmpty: (cmd: string) => `Chưa có key nào. Nhắn ${cmd} trong bot PRO để tạo key.`,
    keyCount: (n: number) => `${n} keys`,
    keyAgent: "Đại lý",
    keyBalance: "Số dư",
    keyLastUsed: "Dùng lần cuối",
    keyExpires: "Hết hạn",
    revokeBtn: "Thu hồi",
    alertTitle: "Cảnh báo tồn kho",
    alertDesc: "Nhận cảnh báo qua Telegram khi tồn kho xuống dưới ngưỡng. Cần cài Telegram chat ID trong cài đặt shop.",
    alertNotTracked: "Không theo dõi tồn kho",
    alertLow: (n: number) => `${n} account còn lại — sắp hết`,
    alertEmpty: (n: number) => `${n} account còn lại — hết hàng`,
    alertRemaining: (n: number) => `${n} account còn lại`,
    alertSold: (n: number) => `Đã bán: ${n}`,
    alertEnable: "Bật cảnh báo",
    alertWhenBelow: "Cảnh báo khi còn dưới",
    alertAccount: "account",
    alertSaving: "Đang lưu...",
    alertSave: "Lưu",
    agentTitle: "Mạng lưới đại lý",
    agentCount: (n: number) => `${n} shop`,
    agentEmpty: "Chưa có đại lý nào kết nối.",
    agentBalance: "Số dư",
    agentSynced: "Đồng bộ",
    agentLastOrder: "Đặt cuối",
    agentNoKey: "Chưa có key",
    agentHistory: "Lịch sử",
    ledgerLoading: "Đang tải...",
    ledgerEmpty: "Chưa có giao dịch nào.",
    ledgerNote: "Ghi chú",
    ledgerAmount: "Số tiền",
    ledgerBefore: "Trước",
    ledgerAfter: "Sau",
    ledgerTime: "Thời gian",
    ledgerTopup: "Nạp tiền",
    ledgerPurchase: "Mua hàng",
    ordersTitle: "Đơn sỉ nhận được",
    orderPendingCount: (n: number) => `${n} chờ xử lý`,
    orderCount: (n: number) => `${n} đơn`,
    ordersEmpty: "Chưa có đơn sỉ nào.",
    orderAgent: "Đại lý",
    orderQty: "SL",
    deliveryLabel: "Nội dung giao hàng thủ công",
    deliveryPh: "Dán thông tin tài khoản hoặc nội dung cần giao",
    failureLabel: "Lý do thất bại / ghi chú hoàn tiền",
    failurePh: "Lý do không thể xử lý đơn này",
    deliverLoading: "Đang giao...",
    deliverBtn: "Giao hàng thủ công",
    failLoading: "Đang xử lý...",
    failBtn: "Thất bại & hoàn tiền",
    delivered: "Đã giao",
  },
  en: {
    gateTitle: "Source connection not activated",
    gateDesc: "PRO accounts can connect to an ULTRA warehouse or create a warehouse for PRO connections. FREE accounts are read-only.",
    eyebrow: "Internal network",
    title: "Source connection",
    descUltra: "Issue API keys for PRO sellers to connect to your warehouse. Monitor agents, process wholesale orders, and receive stock alerts.",
    descPRO: "Connect to an ULTRA warehouse to receive catalog and wholesale prices automatically. Top up balance to place orders.",
    statConnections: "Connections",
    statApiKeys: "API keys",
    statOrders: "Wholesale orders",
    statPending: "Pending",
    syncBtn: "Verify & sync",
    syncing: "Syncing...",
    toastSynced: "Verified and requested catalog sync.",
    toastConnected: "Connected to internal source.",
    toastTopup: "Source connection balance topped up.",
    toastRevoked: "API key revoked.",
    toastManualDelivered: "Manual delivery successful.",
    toastManualFailed: "Marked as failed and refunded.",
    toastAlertSaved: "Alert settings saved.",
    toastError: "An error occurred. Please try again.",
    currentConnectionTitle: "Active source connection",
    infoSourceShop: "Source shop",
    infoSeller: "Seller",
    infoApiKey: "API key",
    infoLastSync: "Last synced",
    infoLastOrder: "Last order",
    topupTitle: "Top up connection balance",
    topupDesc: "Transfer from seller wallet to connection balance for automatic wholesale ordering.",
    topupAmountPh: "Amount...",
    topupLoading: "Topping up...",
    topupBtn: "Top up now",
    connectTitle: "Connect to ULTRA warehouse",
    connectDesc: "Paste the API key received from the ULTRA wholesaler to connect. Catalog and wholesale prices will sync automatically after a successful connection.",
    connectPh: "src_••••••••••••••••••••••••••••••••",
    connecting: "Connecting...",
    connectBtn: "Connect source",
    onboardKicker: "ULTRA wholesaler",
    onboardTitle: "3 steps for PRO sellers to connect to your warehouse",
    onboardStep1Title: "Create API key",
    onboardStep1Desc: "Send /api in the PRO bot. The key only shows once — copy and save it immediately.",
    onboardStep2Title: "Send key to PRO seller",
    onboardStep2Desc: "Share the key string (starting with src_) via Telegram or a secure channel.",
    onboardStep3Title: "PRO pastes key into Source Network",
    onboardStep3Desc: "PRO goes to Source Connection → pastes key → clicks Connect. Catalog syncs immediately.",
    onboardFooter: "Each key can be revoked at any time. PRO sellers after connecting will see the product warehouse and can order automatically.",
    keysTitle: "Issued API keys",
    keysDesc: (cmd: string) => `Keys are created automatically via the ${cmd} command in the PRO bot.`,
    keysEmpty: (cmd: string) => `No keys yet. Send ${cmd} in the PRO bot to create a key.`,
    keyCount: (n: number) => `${n} keys`,
    keyAgent: "Agent",
    keyBalance: "Balance",
    keyLastUsed: "Last used",
    keyExpires: "Expires",
    revokeBtn: "Revoke",
    alertTitle: "Stock alerts",
    alertDesc: "Receive Telegram alerts when stock drops below threshold. Requires Telegram chat ID in shop settings.",
    alertNotTracked: "Stock not tracked",
    alertLow: (n: number) => `${n} accounts remaining — running low`,
    alertEmpty: (n: number) => `${n} accounts remaining — out of stock`,
    alertRemaining: (n: number) => `${n} accounts remaining`,
    alertSold: (n: number) => `Sold: ${n}`,
    alertEnable: "Enable alerts",
    alertWhenBelow: "Alert when below",
    alertAccount: "accounts",
    alertSaving: "Saving...",
    alertSave: "Save",
    agentTitle: "Agent network",
    agentCount: (n: number) => `${n} shops`,
    agentEmpty: "No agents connected yet.",
    agentBalance: "Balance",
    agentSynced: "Synced",
    agentLastOrder: "Last order",
    agentNoKey: "No key",
    agentHistory: "History",
    ledgerLoading: "Loading...",
    ledgerEmpty: "No transactions yet.",
    ledgerNote: "Note",
    ledgerAmount: "Amount",
    ledgerBefore: "Before",
    ledgerAfter: "After",
    ledgerTime: "Time",
    ledgerTopup: "Top up",
    ledgerPurchase: "Purchase",
    ordersTitle: "Incoming wholesale orders",
    orderPendingCount: (n: number) => `${n} pending`,
    orderCount: (n: number) => `${n} orders`,
    ordersEmpty: "No wholesale orders yet.",
    orderAgent: "Agent",
    orderQty: "Qty",
    deliveryLabel: "Manual delivery content",
    deliveryPh: "Paste account info or content to deliver",
    failureLabel: "Failure reason / refund note",
    failurePh: "Reason this order cannot be processed",
    deliverLoading: "Delivering...",
    deliverBtn: "Manual deliver",
    failLoading: "Processing...",
    failBtn: "Fail & refund",
    delivered: "Delivered",
  },
  th: {
    gateTitle: "การเชื่อมต่อแหล่งยังไม่ได้เปิดใช้งาน",
    gateDesc: "บัญชี PRO สามารถเชื่อมต่อกับคลัง ULTRA หรือสร้างคลังสำหรับการเชื่อมต่อ PRO ได้ บัญชี FREE อ่านได้อย่างเดียว",
    eyebrow: "เครือข่ายภายใน",
    title: "การเชื่อมต่อแหล่ง",
    descUltra: "ออก API key สำหรับผู้ขาย PRO เพื่อเชื่อมต่อกับคลังของคุณ ติดตามตัวแทน ดำเนินการคำสั่งซื้อขายส่ง และรับการแจ้งเตือนสต็อก",
    descPRO: "เชื่อมต่อกับคลัง ULTRA เพื่อรับแคตาล็อกและราคาขายส่งโดยอัตโนมัติ เติมยอดคงเหลือเพื่อสั่งซื้อ",
    statConnections: "การเชื่อมต่อ",
    statApiKeys: "API key",
    statOrders: "คำสั่งซื้อขายส่ง",
    statPending: "รอดำเนินการ",
    syncBtn: "ตรวจสอบ & ซิงค์",
    syncing: "กำลังซิงค์...",
    toastSynced: "ตรวจสอบและร้องขอการซิงค์แคตาล็อกแล้ว",
    toastConnected: "เชื่อมต่อกับแหล่งภายในแล้ว",
    toastTopup: "เติมยอดคงเหลือการเชื่อมต่อแหล่งแล้ว",
    toastRevoked: "เพิกถอน API key แล้ว",
    toastManualDelivered: "จัดส่งด้วยตนเองสำเร็จ",
    toastManualFailed: "ทำเครื่องหมายว่าล้มเหลวและคืนเงินแล้ว",
    toastAlertSaved: "บันทึกการตั้งค่าการแจ้งเตือนแล้ว",
    toastError: "เกิดข้อผิดพลาด กรุณาลองใหม่",
    currentConnectionTitle: "การเชื่อมต่อแหล่งที่ใช้งาน",
    infoSourceShop: "ร้านค้าแหล่ง",
    infoSeller: "ผู้ขาย",
    infoApiKey: "API key",
    infoLastSync: "ซิงค์ล่าสุด",
    infoLastOrder: "สั่งล่าสุด",
    topupTitle: "เติมยอดคงเหลือการเชื่อมต่อ",
    topupDesc: "โอนจากกระเป๋าเงินผู้ขายไปยังยอดคงเหลือการเชื่อมต่อสำหรับการสั่งซื้อขายส่งอัตโนมัติ",
    topupAmountPh: "จำนวนเงิน...",
    topupLoading: "กำลังเติม...",
    topupBtn: "เติมเลย",
    connectTitle: "เชื่อมต่อกับคลัง ULTRA",
    connectDesc: "วาง API key ที่ได้รับจากผู้ขายส่ง ULTRA เพื่อเชื่อมต่อ แคตาล็อกและราคาขายส่งจะซิงค์โดยอัตโนมัติหลังจากเชื่อมต่อสำเร็จ",
    connectPh: "src_••••••••••••••••••••••••••••••••",
    connecting: "กำลังเชื่อมต่อ...",
    connectBtn: "เชื่อมต่อแหล่ง",
    onboardKicker: "ผู้ขายส่ง ULTRA",
    onboardTitle: "3 ขั้นตอนสำหรับผู้ขาย PRO เพื่อเชื่อมต่อกับคลังของคุณ",
    onboardStep1Title: "สร้าง API key",
    onboardStep1Desc: "ส่ง /api ในบอท PRO key จะแสดงเพียงครั้งเดียว — คัดลอกและบันทึกทันที",
    onboardStep2Title: "ส่ง key ให้ผู้ขาย PRO",
    onboardStep2Desc: "แชร์สตริง key (เริ่มด้วย src_) ผ่าน Telegram หรือช่องทางที่ปลอดภัย",
    onboardStep3Title: "PRO วาง key ใน Source Network",
    onboardStep3Desc: "PRO ไปที่ Source Connection → วาง key → คลิก Connect แคตาล็อกซิงค์ทันที",
    onboardFooter: "แต่ละ key สามารถเพิกถอนได้ตลอดเวลา ผู้ขาย PRO หลังจากเชื่อมต่อจะเห็นคลังสินค้าและสามารถสั่งซื้อได้โดยอัตโนมัติ",
    keysTitle: "API key ที่ออกแล้ว",
    keysDesc: (cmd: string) => `Key สร้างโดยอัตโนมัติผ่านคำสั่ง ${cmd} ในบอท PRO`,
    keysEmpty: (cmd: string) => `ยังไม่มี key ส่ง ${cmd} ในบอท PRO เพื่อสร้าง key`,
    keyCount: (n: number) => `${n} keys`,
    keyAgent: "ตัวแทน",
    keyBalance: "ยอดคงเหลือ",
    keyLastUsed: "ใช้ล่าสุด",
    keyExpires: "หมดอายุ",
    revokeBtn: "เพิกถอน",
    alertTitle: "การแจ้งเตือนสต็อก",
    alertDesc: "รับการแจ้งเตือน Telegram เมื่อสต็อกลดลงต่ำกว่าเกณฑ์ ต้องการ Telegram chat ID ในการตั้งค่าร้านค้า",
    alertNotTracked: "ไม่ติดตามสต็อก",
    alertLow: (n: number) => `เหลือ ${n} บัญชี — ใกล้หมด`,
    alertEmpty: (n: number) => `เหลือ ${n} บัญชี — หมดแล้ว`,
    alertRemaining: (n: number) => `เหลือ ${n} บัญชี`,
    alertSold: (n: number) => `ขายแล้ว: ${n}`,
    alertEnable: "เปิดการแจ้งเตือน",
    alertWhenBelow: "แจ้งเตือนเมื่อต่ำกว่า",
    alertAccount: "บัญชี",
    alertSaving: "กำลังบันทึก...",
    alertSave: "บันทึก",
    agentTitle: "เครือข่ายตัวแทน",
    agentCount: (n: number) => `${n} ร้านค้า`,
    agentEmpty: "ยังไม่มีตัวแทนเชื่อมต่อ",
    agentBalance: "ยอดคงเหลือ",
    agentSynced: "ซิงค์",
    agentLastOrder: "สั่งล่าสุด",
    agentNoKey: "ไม่มี key",
    agentHistory: "ประวัติ",
    ledgerLoading: "กำลังโหลด...",
    ledgerEmpty: "ยังไม่มีธุรกรรม",
    ledgerNote: "หมายเหตุ",
    ledgerAmount: "จำนวนเงิน",
    ledgerBefore: "ก่อน",
    ledgerAfter: "หลัง",
    ledgerTime: "เวลา",
    ledgerTopup: "เติมเงิน",
    ledgerPurchase: "ซื้อสินค้า",
    ordersTitle: "คำสั่งซื้อขายส่งที่เข้ามา",
    orderPendingCount: (n: number) => `${n} รอดำเนินการ`,
    orderCount: (n: number) => `${n} คำสั่ง`,
    ordersEmpty: "ยังไม่มีคำสั่งซื้อขายส่ง",
    orderAgent: "ตัวแทน",
    orderQty: "จำนวน",
    deliveryLabel: "เนื้อหาการจัดส่งด้วยตนเอง",
    deliveryPh: "วางข้อมูลบัญชีหรือเนื้อหาที่จะจัดส่ง",
    failureLabel: "เหตุผลความล้มเหลว / หมายเหตุการคืนเงิน",
    failurePh: "เหตุผลที่ไม่สามารถดำเนินการคำสั่งซื้อนี้ได้",
    deliverLoading: "กำลังจัดส่ง...",
    deliverBtn: "จัดส่งด้วยตนเอง",
    failLoading: "กำลังดำเนินการ...",
    failBtn: "ล้มเหลว & คืนเงิน",
    delivered: "จัดส่งแล้ว",
  },
};

type SourceConnection = {
  id: string;
  status: string;
  label: string | null;
  balance: number;
  currency: string;
  inheritSourceTemplate?: boolean;
  lastCatalogSyncAt: string | null;
  lastOrderedAt: string | null;
  buyerApiBaseUrl: string;
  apiKey: {
    id: string;
    label: string;
    keyPrefix: string;
    keySuffix: string | null;
    status: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
  } | null;
  upstreamSeller: { id: string; displayName: string; tier: string };
  upstreamShop: { id: string; name: string; slug: string };
  downstreamSeller: { id: string; displayName: string; telegramUsername: string | null } | null;
  downstreamShop: {
    id: string;
    name: string;
    slug: string;
    telegramBotUsername: string | null;
  } | null;
};

type SourceApiKey = {
  id: string;
  label: string;
  note: string | null;
  keyPrefix: string;
  status: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  connection: {
    id: string;
    status: string;
    downstreamSellerName: string | null;
    downstreamShopName: string | null;
    balance: number;
    currency: string;
  } | null;
};

type ProSourceProduct = {
  id: string;
  sourceName: string;
  available: number | null;
  internalSourceEnabled: boolean;
  internalSourcePrice: number | null;
  soldCount: number;
  stockAlertThreshold: number;
  stockAlertEnabled: boolean;
  lastStockAlertAt: string | null;
};

type InternalSourceOrder = {
  id: string;
  orderCode: string;
  downstreamOrderCode: string | null;
  status: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  deliveredAccountText: string | null;
  failureReason: string | null;
  createdAt: string;
  deliveredAt: string | null;
  product: { id: string; sourceName: string; providerName: string };
  downstreamSeller: { id: string; displayName: string } | null;
  downstreamShop: { id: string; name: string; slug: string } | null;
  connection: { id: string; balance: number; currency: string };
  endCustomer: {
    telegramUsername: string | null;
    telegramUserId: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

function getApiErrorMessage(error: unknown, fallback: string) {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const msg = axiosError.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string" && msg.trim()) return msg;
  return fallback;
}

function getTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const s = String(status || "").toLowerCase();
  if (["active", "delivered", "verified", "auto_resolved", "resolved_manual"].includes(s)) return "success";
  if (["pending", "pending_stock", "pending_manual", "pending_review", "processing"].includes(s)) return "warning";
  if (["failed", "disabled", "revoked", "rejected", "canceled"].includes(s)) return "danger";
  return "neutral";
}

export function SourceNetworkPage() {
  const { lang } = useLang();
  const t = T[lang];

  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [connectKey, setConnectKey] = useState("");
  const disconnectMutation = useMutation({
    mutationFn: async () => api.delete("/seller/source-connection"),
    onSuccess: async () => {
      showToast({ tone: "success", message: "Đã ngắt kết nối nguồn." });
      await queryClient.invalidateQueries({ queryKey: ["source-network", "current-connection"] });
    },
    onError: (e: any) => showToast({ tone: "error", message: e?.response?.data?.message || "Lỗi" }),
  });
  const [topupAmount, setTopupAmount] = useState("10000");
  const [alertInputs, setAlertInputs] = useState<Record<string, { threshold: string; enabled: boolean }>>({});
  const [popupConn, setPopupConn] = useState<SourceConnection | null>(null);
  const [popupOrderSearch, setPopupOrderSearch] = useState("");

  const canUseInternalSource    = hasSellerCapability(session, "source_internal_use");
  const canManageInternalSource = hasSellerCapability(session, "source_internal_manage");
  const canManageKeys           = hasSellerCapability(session, "source_key_manage");
  const isUltra                 = session?.user.sellerTier === "ultra";

  const currentConnectionQuery = useQuery({
    queryKey: ["source-network", "current-connection"],
    queryFn: async () => (await api.get<SourceConnection | null>("/source/connections/current")).data,
    enabled: canUseInternalSource,
  });
  const keysQuery = useQuery({
    queryKey: ["source-network", "keys"],
    queryFn: async () => (await api.get<SourceApiKey[]>("/source/keys")).data,
    enabled: canManageKeys,
  });
  const downstreamConnectionsQuery = useQuery({
    queryKey: ["source-network", "downstream-connections"],
    queryFn: async () => (await api.get<SourceConnection[]>("/source/connections/downstream")).data,
    enabled: canManageInternalSource,
  });
  const sourceOrdersQuery = useQuery({
    queryKey: ["source-network", "source-orders"],
    queryFn: async () => (await api.get<InternalSourceOrder[]>("/source/orders")).data,
    enabled: canManageInternalSource,
  });
  const sourceProductsQuery = useQuery({
    queryKey: ["source-network", "source-products"],
    queryFn: async () => (await api.get<ProSourceProduct[]>("/pro/source-products")).data,
    enabled: canManageKeys,
  });

  const refreshSourceMutation = useMutation({
    mutationFn: async () => {
      await api.post("/bot-config/verify-provider");
      await api.post("/bot-config/sync-products");
    },
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastSynced });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-network", "current-connection"] }),
        queryClient.invalidateQueries({ queryKey: ["source-products", "catalog"] }),
      ]);
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  const cloneInterfaceMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ ok: boolean; groupsCloned: number; productsMapped: number }>(
          "/source/connections/current/clone-interface",
        )
      ).data,
    onSuccess: async (res) => {
      showToast({
        tone: "success",
        message: `Đã đồng bộ giao diện bot từ nguồn (+${res?.groupsCloned ?? 0} danh mục).`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-network", "current-connection"] }),
        queryClient.invalidateQueries({ queryKey: ["source-products", "catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["source-network", "source-products"] }),
      ]);
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  // Inherited-template override editor (rename/reorder/hide categories + reorder products).
  const [editorOpen, setEditorOpen] = useState(false);
  const [edGroups, setEdGroups] = useState<{ id: string; name: string; position: number }[]>([]);
  const [edProducts, setEdProducts] = useState<{ id: string; name: string; position: number }[]>([]);
  const [groupOv, setGroupOv] = useState<Record<string, { name?: string; position?: number; hidden?: boolean }>>({});
  const [productOv, setProductOv] = useState<Record<string, { position?: number }>>({});

  const openOverrideEditor = async () => {
    try {
      const { data } = await api.get<{
        groups: { id: string; name: string; position: number }[];
        products: { id: string; name: string; position: number }[];
        overrides: { groups?: Record<string, any>; products?: Record<string, any> };
      }>("/source/connections/current/inherited-structure");
      setEdGroups(data.groups || []);
      setEdProducts(data.products || []);
      setGroupOv(data.overrides?.groups || {});
      setProductOv(data.overrides?.products || {});
      setEditorOpen(true);
    } catch (e) {
      showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) });
    }
  };

  const saveOverridesMutation = useMutation({
    mutationFn: async () =>
      api.post("/source/connections/current/template-overrides", {
        overrides: { groups: groupOv, products: productOv },
      }),
    onSuccess: async () => {
      showToast({ tone: "success", message: "Đã lưu tùy chỉnh hiển thị." });
      setEditorOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["source-network", "current-connection"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  const connectMutation = useMutation({
    mutationFn: async () => api.post("/source/connections/connect", { apiKey: connectKey.trim() }),
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastConnected });
      setConnectKey("");
      try {
        await api.post("/bot-config/verify-provider");
        await api.post("/bot-config/sync-products");
      } catch {}
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-network", "current-connection"] }),
        queryClient.invalidateQueries({ queryKey: ["source-products", "catalog"] }),
      ]);
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  const topupMutation = useMutation({
    mutationFn: async () =>
      api.post("/source/connections/current/topup", { amount: Number(topupAmount || 0) }),
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastTopup });
      await queryClient.invalidateQueries({ queryKey: ["source-network", "current-connection"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/source/keys/${id}/revoke`),
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastRevoked });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-network", "keys"] }),
        queryClient.invalidateQueries({ queryKey: ["source-network", "downstream-connections"] }),
      ]);
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  const updateAlertMutation = useMutation({
    mutationFn: async ({ id, threshold, enabled }: { id: string; threshold: number; enabled: boolean }) =>
      (await api.put<ProSourceProduct>(`/pro/source-products/${id}/alert-settings`, {
        stockAlertThreshold: threshold,
        stockAlertEnabled: enabled,
      })).data,
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["source-network", "source-products"] });
      setAlertInputs((prev) => { const next = { ...prev }; delete next[updated.id]; return next; });
      showToast({ tone: "success", message: t.toastAlertSaved });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  if (!canUseInternalSource && !canManageInternalSource && !canManageKeys) {
    return (
      <Card>
        <CardHeader icon={Cable} title={t.gateTitle} iconCls="text-orange-400" iconBg="bg-orange-500/10" />
        <p className="text-sm leading-7" style={{ color: "var(--tx-m)" }}>
          {t.gateDesc}
        </p>
      </Card>
    );
  }

  const currentConnection = currentConnectionQuery.data;
  const keys = keysQuery.data || [];
  const downstreamConnections = downstreamConnectionsQuery.data || [];
  const sourceOrders = sourceOrdersQuery.data || [];
  const sourceProducts = sourceProductsQuery.data || [];
  const pendingOrders = sourceOrders.filter((o) =>
    ["pending_manual", "pending_stock", "processing", "pending"].includes(o.status),
  );

  /* suppress unused var warning for connectKey / topupAmount when not rendered */
  void connectKey;
  void topupAmount;
  void connectMutation;
  void topupMutation;

  return (
    <div className="space-y-5">
      {isUltra ? (
        <>
          {/* ULTRA header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest mb-1" style={{ color: "rgb(249,115,22)" }}>
                Mạng lưới nội bộ ULTRA · Tổng sỉ
              </p>
              <h1 className="text-[22px] font-black leading-tight" style={{ color: "rgb(249,115,22)" }}>Kết nối nguồn</h1>
            </div>
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["source-network"] })}
              className="shrink-0 flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80"
              style={{ background: "rgb(249,115,22)", color: "#fff" }}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Đồng bộ toàn bộ
            </button>
          </div>

          {/* 4 stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "ĐẠI LÝ KẾT NỐI", value: downstreamConnections.length, color: "59,130,246" },
              { label: "API KEY ĐÃ CẤP", value: keys.length, color: "20,184,166" },
              { label: "ĐƠN SỈ", value: sourceOrders.length, color: "34,197,94" },
              {
                label: "CHỜ XỬ LÝ",
                value: pendingOrders.length,
                color: pendingOrders.length > 0 ? "245,158,11" : "100,116,139",
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl px-4 py-4"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--bd)",
                  borderLeft: `3px solid rgb(${stat.color})`,
                }}
              >
                <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: "var(--tx-f)" }}>
                  {stat.label}
                </p>
                <p className="text-2xl font-black tabular-nums" style={{ color: `rgb(${stat.color})` }}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Agent network table */}
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--bd)" }}>
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ background: "var(--surface)", borderBottom: "1px solid var(--bd)" }}
            >
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-black" style={{ color: "var(--tx)" }}>Đại lý đang kết nối</span>
              </div>
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
              >
                {downstreamConnections.length} shop
              </span>
            </div>

            {downstreamConnections.length === 0 ? (
              <div className="py-10 text-center" style={{ background: "var(--inp)" }}>
                <p className="text-sm" style={{ color: "var(--tx-f)" }}>Chưa có đại lý nào kết nối.</p>
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div
                  className="hidden sm:grid px-5 py-2.5 text-[10px] font-black uppercase tracking-widest"
                  style={{
                    gridTemplateColumns: "minmax(0,1fr) 230px 165px 185px 175px 100px",
                    background: "var(--inp)",
                    borderBottom: "1px solid var(--bd)",
                    color: "var(--tx-f)",
                  }}
                >
                  <span>SHOP / OWNER</span>
                  <span>API KEY</span>
                  <span className="text-right">SỐ DƯ</span>
                  <span className="text-right">ĐỒNG BỘ CUỐI</span>
                  <span className="text-right">DÙNG CUỐI</span>
                  <span />
                </div>

                {downstreamConnections.map((conn, idx) => {
                  const connOrders = sourceOrders.filter((o) => o.connection.id === conn.id);
                  const pendingConnOrders = connOrders.filter((o) =>
                    ["pending_manual", "pending_stock", "processing", "pending"].includes(o.status),
                  );

                  return (
                    <div
                      key={conn.id}
                      className="sm:grid px-5 py-3.5 cursor-pointer transition-colors hover:bg-orange-500/5"
                      style={{
                        gridTemplateColumns: "minmax(0,1fr) 230px 165px 185px 175px 100px",
                        alignItems: "center",
                        borderTop: idx === 0 ? "none" : "1px solid var(--bd)",
                      }}
                      onClick={() => { setPopupConn(conn); setPopupOrderSearch(""); }}
                    >
                      <div className="min-w-0 mb-2 sm:mb-0">
                        <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>
                          {conn.downstreamSeller?.displayName || "—"}
                          {conn.downstreamSeller?.telegramUsername && (
                            <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--tx-f)" }}>
                              @{conn.downstreamSeller.telegramUsername}
                            </span>
                          )}
                        </p>
                        <p className="text-xs" style={{ color: "var(--tx-f)" }}>
                          {conn.downstreamShop?.name || "—"}
                          {conn.downstreamShop?.telegramBotUsername
                            ? ` · @${conn.downstreamShop.telegramBotUsername}`
                            : ""}
                        </p>
                      </div>

                      <div className="mb-1 sm:mb-0">
                        <span
                          className="font-mono text-xs px-2 py-0.5 rounded-md"
                          style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
                        >
                          {conn.apiKey?.keyPrefix
                            ? `${conn.apiKey.keyPrefix}•••${conn.apiKey.keySuffix ?? ""}`
                            : "—"}
                        </span>
                      </div>

                      <div className="sm:text-right font-black tabular-nums text-sm mb-1 sm:mb-0" style={{ color: "rgb(249,115,22)" }}>
                        {formatCurrency(conn.balance)}
                        {pendingConnOrders.length > 0 && (
                          <span
                            className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(245,158,11,0.15)", color: "rgb(245,158,11)" }}
                          >
                            {pendingConnOrders.length}
                          </span>
                        )}
                      </div>

                      <div className="text-xs sm:text-right mb-1 sm:mb-0" style={{ color: "var(--tx-m)" }}>
                        {formatDate(conn.lastCatalogSyncAt) || "—"}
                      </div>

                      <div className="text-xs sm:text-right mb-2 sm:mb-0" style={{ color: "var(--tx-m)" }}>
                        {formatDate(conn.apiKey?.lastUsedAt) || "—"}
                      </div>

                      <div
                        className="flex items-center justify-end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {conn.apiKey && conn.apiKey.status === "active" && (
                          <button
                            type="button"
                            disabled={revokeKeyMutation.isPending}
                            onClick={() => {
                              if (confirm("Thu hồi key này?")) revokeKeyMutation.mutate(conn.apiKey!.id);
                            }}
                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-black transition hover:opacity-80 disabled:opacity-40"
                            style={{
                              background: "rgba(239,68,68,0.1)",
                              border: "1px solid rgba(239,68,68,0.25)",
                              color: "rgb(248,113,113)",
                            }}
                          >
                            <XCircle className="h-3 w-3" />
                            Thu hồi
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Order history popup */}
          {popupConn && (() => {
            const connOrders = sourceOrders.filter((o) => o.connection.id === popupConn.id);
            const q = popupOrderSearch.trim().toLowerCase();
            const filteredOrders = q
              ? connOrders.filter((o) =>
                  (o.orderCode || "").toLowerCase().includes(q) ||
                  (o.downstreamOrderCode || "").toLowerCase().includes(q) ||
                  (o.product?.sourceName || "").toLowerCase().includes(q) ||
                  (o.endCustomer?.telegramUsername || "").toLowerCase().includes(q) ||
                  [o.endCustomer?.firstName, o.endCustomer?.lastName].filter(Boolean).join(" ").toLowerCase().includes(q))
              : connOrders;
            return createPortal(
              <div
                className="fixed inset-0 z-[80] flex items-center justify-center p-4"
                style={{ background: "rgba(0,0,0,0.55)" }}
                onClick={() => setPopupConn(null)}
              >
                <div
                  className="w-full max-w-6xl max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
                  style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Popup header */}
                  <div
                    className="flex items-center justify-between px-5 py-4 shrink-0"
                    style={{ borderBottom: "1px solid var(--bd)" }}
                  >
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-widest mb-0.5" style={{ color: "rgb(249,115,22)" }}>
                        Lịch sử đơn sỉ
                      </p>
                      <p className="text-sm font-black" style={{ color: "var(--tx)" }}>
                        {popupConn.downstreamShop?.name || popupConn.downstreamSeller?.displayName || "—"}
                        {popupConn.downstreamShop?.telegramBotUsername
                          ? ` · @${popupConn.downstreamShop.telegramBotUsername}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={popupOrderSearch}
                        onChange={(e) => setPopupOrderSearch(e.target.value)}
                        placeholder="Tìm mã đơn / sản phẩm / khách"
                        className="w-56 rounded-[10px] px-3 py-1.5 text-xs focus:outline-none"
                        style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                      />
                      <button
                        type="button"
                        onClick={() => setPopupConn(null)}
                        className="flex h-8 w-8 items-center justify-center rounded-xl transition hover:opacity-70"
                        style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Popup body */}
                  <div className="overflow-y-auto">
                    {filteredOrders.length === 0 ? (
                      <p className="px-5 py-10 text-center text-sm" style={{ color: "var(--tx-f)" }}>
                        {q ? "Không tìm thấy đơn khớp." : "Chưa có đơn sỉ nào."}
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead style={{ background: "var(--inp)", position: "sticky", top: 0, zIndex: 1 }}>
                          <tr style={{ borderBottom: "1px solid var(--bd)" }}>
                            {["MÃ ĐƠN", "SẢN PHẨM", "KHÁCH CUỐI", "ACC ĐÃ GIAO", "SỐ TIỀN", "TRẠNG THÁI", "THỜI GIAN"].map((h, i) => (
                              <th
                                key={h}
                                className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${i === 4 ? "text-right" : "text-left"}`}
                                style={{ color: "var(--tx-f)" }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOrders.map((order) => {
                            const ec = order.endCustomer;
                            const ecLabel = ec
                              ? ec.telegramUsername
                                ? `@${ec.telegramUsername}`
                                : [ec.firstName, ec.lastName].filter(Boolean).join(" ").trim() ||
                                  (ec.telegramUserId ? `ID ${ec.telegramUserId}` : "—")
                              : "—";
                            const acc = order.deliveredAccountText?.trim() || "";
                            return (
                              <tr key={order.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                                <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--tx-m)" }}>
                                  <div>{order.orderCode}</div>
                                  {order.downstreamOrderCode && (
                                    <div className="text-[10px] mt-0.5" style={{ color: "var(--tx-f)" }}>
                                      PRO: {order.downstreamOrderCode}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3" style={{ color: "var(--tx-m)" }}>
                                  {order.product.sourceName}
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: "var(--tx-m)" }}>
                                  {ecLabel}
                                </td>
                                <td
                                  className="px-4 py-3 font-mono text-[11px]"
                                  style={{ color: "var(--tx-m)", maxWidth: 280, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                                  title={acc}
                                >
                                  {acc ? (acc.length > 120 ? `${acc.slice(0, 120)}…` : acc) : "—"}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-emerald-400">
                                  {formatCurrency(order.totalAmount)}
                                </td>
                                <td className="px-4 py-3">
                                  <Badge tone={getTone(order.status)}>{formatStatusLabel(order.status)}</Badge>
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: "var(--tx-f)" }}>
                                  {formatDate(order.createdAt)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>,
              document.body,
            );
          })()}

          {/* Stock alerts */}
          {sourceProducts.length > 0 && (
            <Card>
              <CardHeader icon={Bell} title={t.alertTitle} iconCls="text-amber-400" iconBg="bg-amber-500/10" />
              <p className="mb-4 text-sm" style={{ color: "var(--tx-m)" }}>{t.alertDesc}</p>
              <div className="space-y-2.5">
                {sourceProducts.map((product) => {
                  const isEmpty = product.available === 0;
                  const isLow =
                    product.available !== null &&
                    product.available > 0 &&
                    product.available <= product.stockAlertThreshold;
                  const input = alertInputs[product.id];
                  const threshold = input?.threshold ?? String(product.stockAlertThreshold);
                  const enabled = input?.enabled ?? product.stockAlertEnabled;
                  const isDirty = input !== undefined;

                  return (
                    <div
                      key={product.id}
                      className="rounded-[16px] px-4 py-4"
                      style={{
                        background: isEmpty
                          ? "rgba(244,63,94,0.06)"
                          : isLow
                            ? "rgba(245,158,11,0.06)"
                            : "var(--inp)",
                        border: `1px solid ${
                          isEmpty ? "rgba(244,63,94,0.25)" : isLow ? "rgba(245,158,11,0.25)" : "var(--bd)"
                        }`,
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>{product.sourceName}</p>
                          <p
                            className={`mt-0.5 text-xs ${isEmpty ? "text-rose-400" : isLow ? "text-amber-400" : ""}`}
                            style={!isEmpty && !isLow ? { color: "var(--tx-f)" } : undefined}
                          >
                            {product.available === null
                              ? t.alertNotTracked
                              : isEmpty
                                ? t.alertEmpty(product.available)
                                : isLow
                                  ? t.alertLow(product.available)
                                  : t.alertRemaining(product.available)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {product.available !== null && (
                            <Badge tone={isEmpty ? "danger" : isLow ? "warning" : "success"}>
                              {product.available}
                            </Badge>
                          )}
                          <Badge tone="neutral">{t.alertSold(product.soldCount)}</Badge>
                        </div>
                      </div>

                      {product.available !== null && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <label
                            className="flex items-center gap-2 text-sm cursor-pointer"
                            style={{ color: "var(--tx-m)" }}
                          >
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) =>
                                setAlertInputs((prev) => ({
                                  ...prev,
                                  [product.id]: { threshold, enabled: e.target.checked },
                                }))
                              }
                              className="h-4 w-4 accent-emerald-400"
                            />
                            {t.alertEnable}
                          </label>
                          <div className="flex items-center gap-2">
                            <span className="text-xs" style={{ color: "var(--tx-f)" }}>{t.alertWhenBelow}</span>
                            <Input
                              type="number"
                              value={threshold}
                              min={0}
                              onChange={(e) =>
                                setAlertInputs((prev) => ({
                                  ...prev,
                                  [product.id]: { threshold: e.target.value, enabled },
                                }))
                              }
                              className="w-20"
                            />
                            <span className="text-xs" style={{ color: "var(--tx-f)" }}>{t.alertAccount}</span>
                          </div>
                          {isDirty && (
                            <Button
                              size="sm"
                              onClick={() =>
                                updateAlertMutation.mutate({
                                  id: product.id,
                                  threshold: parseInt(threshold, 10) || 0,
                                  enabled,
                                })
                              }
                              disabled={updateAlertMutation.isPending}
                            >
                              {updateAlertMutation.isPending ? t.alertSaving : t.alertSave}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      ) : (
        /* PRO view */
        <>
          <div>
            <p
              className="text-[11px] font-black uppercase tracking-widest mb-1"
              style={{ color: "rgb(249,115,22)" }}
            >
              Kết nối nguồn
            </p>
            <h1 className="text-[22px] font-black leading-tight" style={{ color: "rgb(249,115,22)" }}>
              {currentConnection ? "Đang kết nối kho ULTRA" : "Chưa kết nối nguồn"}
            </h1>
          </div>

          {currentConnection ? (
            <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
              {/* Card header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-xl"
                    style={{ background: "rgba(249,115,22,0.12)" }}
                  >
                    <Cable className="h-4 w-4 text-orange-400" />
                  </div>
                  <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>
                    {t.currentConnectionTitle}
                  </h2>
                </div>
                <span
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black"
                  style={{
                    background: "rgba(52,211,153,0.1)",
                    border: "1px solid rgba(52,211,153,0.25)",
                    color: "rgb(52,211,153)",
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Đang hoạt động
                </span>
              </div>

              {/* Shop info */}
              <div
                className="flex items-center gap-3 rounded-2xl p-4 mb-4"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-orange-400"
                  style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.2)" }}
                >
                  <Cable className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-black" style={{ color: "var(--tx)" }}>
                    {currentConnection.upstreamShop.name}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
                    Key: {currentConnection.apiKey?.keyPrefix ? `${currentConnection.apiKey.keyPrefix}•••` : "—"}
                    {currentConnection.upstreamSeller.displayName
                      ? ` · Bot: @${currentConnection.upstreamSeller.displayName}`
                      : ""}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl px-4 py-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--tx-f)" }}>
                    SỐ DƯ KẾT NỐI
                  </p>
                  <p className="text-base font-black tabular-nums" style={{ color: "rgb(249,115,22)" }}>
                    {formatCurrency(currentConnection.balance)}
                  </p>
                </div>
                <div className="rounded-xl px-4 py-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--tx-f)" }}>
                    ĐỒNG BỘ CUỐI
                  </p>
                  <p className="text-base font-black" style={{ color: "var(--tx)" }}>
                    {formatDate(currentConnection.lastCatalogSyncAt) || "—"}
                  </p>
                </div>
                <div className="rounded-xl px-4 py-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--tx-f)" }}>
                    ĐẶT HÀNG CUỐI
                  </p>
                  <p className="text-base font-black" style={{ color: "var(--tx)" }}>
                    {formatDate(currentConnection.lastOrderedAt) || "—"}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={refreshSourceMutation.isPending}
                  onClick={() => refreshSourceMutation.mutate()}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgb(249,115,22)", color: "#fff" }}
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {refreshSourceMutation.isPending ? t.syncing : "Đồng bộ ngay"}
                </button>
                <button
                  type="button"
                  disabled={disconnectMutation.isPending}
                  onClick={() => {
                    if (confirm("Ngắt kết nối nguồn? Sản phẩm hiện tại vẫn giữ nguyên."))
                      disconnectMutation.mutate();
                  }}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.25)",
                    color: "rgb(248,113,113)",
                  }}
                >
                  {disconnectMutation.isPending ? "Đang ngắt..." : "Ngắt kết nối"}
                </button>
              </div>

              {/* Đồng bộ giao diện bot — one-press clone of the source's categories + bot template */}
              <div
                className="mt-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
              >
                <div>
                  <p className="text-[12px] font-black" style={{ color: "var(--tx)" }}>
                    Đồng bộ giao diện bot
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>
                    Copy danh mục + giao diện (welcome, nhãn nút) từ nguồn ULTRA về shop của bạn. Giá vẫn theo giá của bạn. Icon dùng dạng chữ (không cần Telegram Premium).
                  </p>
                </div>
                <button
                  type="button"
                  disabled={cloneInterfaceMutation.isPending}
                  onClick={() => {
                    if (
                      confirm(
                        "Đồng bộ giao diện bot? Sẽ copy danh mục + giao diện từ nguồn ULTRA về shop (thêm danh mục mới, merge giao diện).",
                      )
                    )
                      cloneInterfaceMutation.mutate();
                  }}
                  className="shrink-0 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgb(249,115,22)", color: "#fff" }}
                >
                  {cloneInterfaceMutation.isPending ? "Đang đồng bộ..." : "Đồng bộ giao diện"}
                </button>
              </div>

              {/* Override editor — only when inheriting */}
              {currentConnection.inheritSourceTemplate && (
                <div className="mt-3">
                  {!editorOpen ? (
                    <button
                      type="button"
                      onClick={openOverrideEditor}
                      className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80"
                      style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                    >
                      ✏️ Tùy chỉnh danh mục &amp; thứ tự
                    </button>
                  ) : (
                    <div className="rounded-xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                      <p className="text-[12px] font-black mb-2" style={{ color: "var(--tx)" }}>
                        Danh mục — đổi tên / thứ tự (#) / ẩn
                      </p>
                      {edGroups.length === 0 && (
                        <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>Nguồn chưa có danh mục.</p>
                      )}
                      {edGroups.map((g) => (
                        <div key={g.id} className="flex items-center gap-2 mb-1.5">
                          <input
                            value={groupOv[g.id]?.name ?? ""}
                            placeholder={g.name}
                            onChange={(e) => setGroupOv((s) => ({ ...s, [g.id]: { ...s[g.id], name: e.target.value } }))}
                            className="flex-1 rounded-lg px-2 py-1.5 text-[12px] outline-none"
                            style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                          />
                          <input
                            type="number"
                            placeholder="#"
                            value={groupOv[g.id]?.position ?? ""}
                            onChange={(e) => setGroupOv((s) => ({ ...s, [g.id]: { ...s[g.id], position: e.target.value === "" ? undefined : Number(e.target.value) } }))}
                            className="w-14 rounded-lg px-2 py-1.5 text-[12px] outline-none"
                            style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                          />
                          <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--tx-f)" }}>
                            <input
                              type="checkbox"
                              checked={!!groupOv[g.id]?.hidden}
                              onChange={(e) => setGroupOv((s) => ({ ...s, [g.id]: { ...s[g.id], hidden: e.target.checked } }))}
                            />
                            ẩn
                          </label>
                        </div>
                      ))}

                      <p className="text-[12px] font-black mt-4 mb-2" style={{ color: "var(--tx)" }}>
                        Sản phẩm — thứ tự (#)
                      </p>
                      <div className="max-h-64 overflow-y-auto">
                        {edProducts.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 mb-1.5">
                            <span className="flex-1 truncate text-[12px]" style={{ color: "var(--tx)" }}>{p.name}</span>
                            <input
                              type="number"
                              placeholder={String(p.position)}
                              value={productOv[p.id]?.position ?? ""}
                              onChange={(e) => setProductOv((s) => ({ ...s, [p.id]: { position: e.target.value === "" ? undefined : Number(e.target.value) } }))}
                              className="w-14 rounded-lg px-2 py-1.5 text-[12px] outline-none"
                              style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                            />
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={saveOverridesMutation.isPending}
                          onClick={() => saveOverridesMutation.mutate()}
                          className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                          style={{ background: "rgb(249,115,22)", color: "#fff" }}
                        >
                          {saveOverridesMutation.isPending ? "Đang lưu..." : "Lưu thay đổi"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorOpen(false)}
                          className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80"
                          style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                        >
                          Đóng
                        </button>
                      </div>
                      <p className="text-[10px] mt-2" style={{ color: "var(--tx-f)" }}>
                        Để trống = giữ theo nguồn ULTRA. Số thứ tự nhỏ hiện trước.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div
              className="rounded-2xl py-12 text-center"
              style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
            >
              <Cable className="mx-auto h-8 w-8 mb-3 text-orange-400 opacity-40" />
              <p className="text-sm font-semibold" style={{ color: "var(--tx-m)" }}>
                Chưa kết nối vào nguồn ULTRA.
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--tx-f)" }}>
                Cấu hình kết nối trong tab "Bot &amp; Nguồn" của trang Cài đặt Bot.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
