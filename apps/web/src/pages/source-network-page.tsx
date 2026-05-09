import type { AxiosError } from "axios";
import {
  ArrowRightLeft,
  BadgeCheck,
  Bell,
  Cable,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  RefreshCcw,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
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
  lastCatalogSyncAt: string | null;
  lastOrderedAt: string | null;
  buyerApiBaseUrl: string;
  apiKey: {
    id: string;
    label: string;
    keyPrefix: string;
    status: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
  } | null;
  upstreamSeller: { id: string; displayName: string; tier: string };
  upstreamShop: { id: string; name: string; slug: string };
  downstreamSeller: { id: string; displayName: string } | null;
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

type LedgerEntry = {
  id: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
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
  downstreamSeller: { id: string; displayName: string };
  downstreamShop: { id: string; name: string; slug: string };
  connection: { id: string; balance: number; currency: string };
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3" style={{ borderTop: "1px solid var(--bd)" }}>
      <p className="text-[11px] font-black uppercase tracking-widest shrink-0" style={{ color: "var(--tx-f)" }}>{label}</p>
      <p className="text-sm font-semibold text-right" style={{ color: "var(--tx)" }}>{value}</p>
    </div>
  );
}

export function SourceNetworkPage() {
  const { lang } = useLang();
  const t = T[lang];

  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [connectKey, setConnectKey] = useState("");
  const [topupAmount, setTopupAmount] = useState("10000");
  const [manualDeliveries, setManualDeliveries] = useState<Record<string, string>>({});
  const [manualFailures, setManualFailures] = useState<Record<string, string>>({});
  const [alertInputs, setAlertInputs] = useState<Record<string, { threshold: string; enabled: boolean }>>({});
  const [expandedLedger, setExpandedLedger] = useState<string | null>(null);

  const canUseInternalSource   = hasSellerCapability(session, "source_internal_use");
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

  const ledgerQuery = useQuery({
    queryKey: ["source-network", "ledger", expandedLedger],
    queryFn: async () =>
      (await api.get<LedgerEntry[]>(`/source/connections/downstream/${expandedLedger}/ledger`)).data,
    enabled: !!expandedLedger && canManageInternalSource,
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

  const manualDeliverMutation = useMutation({
    mutationFn: async (orderId: string) =>
      api.post(`/source/orders/${orderId}/manual-deliver`, {
        deliveredAccountText: manualDeliveries[orderId] || "",
      }),
    onSuccess: async (_r, orderId) => {
      showToast({ tone: "success", message: t.toastManualDelivered });
      setManualDeliveries((c) => ({ ...c, [orderId]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["source-network", "source-orders"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e, t.toastError) }),
  });

  const manualFailMutation = useMutation({
    mutationFn: async (orderId: string) =>
      api.post(`/source/orders/${orderId}/mark-failed`, {
        reason: manualFailures[orderId] || "",
      }),
    onSuccess: async (_r, orderId) => {
      showToast({ tone: "success", message: t.toastManualFailed });
      setManualFailures((c) => ({ ...c, [orderId]: "" }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-network", "source-orders"] }),
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

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={isUltra ? t.descUltra : t.descPRO}
        gradient="violet"
        stats={[
          {
            icon: Cable,
            label: t.statConnections,
            value: isUltra ? downstreamConnections.length : currentConnection ? 1 : 0,
            iconCls: "text-violet-400",
            bgCls: "bg-violet-500/15",
          },
          {
            icon: BadgeCheck,
            label: t.statApiKeys,
            value: keys.length,
            iconCls: "text-emerald-400",
            bgCls: "bg-emerald-500/15",
          },
          {
            icon: PackageCheck,
            label: t.statOrders,
            value: sourceOrders.length,
            iconCls: "text-sky-400",
            bgCls: "bg-sky-500/15",
          },
          {
            icon: Bell,
            label: t.statPending,
            value: pendingOrders.length,
            iconCls: pendingOrders.length > 0 ? "text-amber-400" : "text-slate-400",
            bgCls: pendingOrders.length > 0 ? "bg-amber-500/15" : "bg-slate-500/10",
          },
        ]}
        actions={
          canUseInternalSource && !isUltra ? (
            <Button onClick={() => refreshSourceMutation.mutate()} variant="secondary">
              <RefreshCcw className="h-4 w-4" />
              {refreshSourceMutation.isPending ? t.syncing : t.syncBtn}
            </Button>
          ) : undefined
        }
      />

      {/* PRO: current connection */}
      {currentConnection ? (
        <Card>
          <CardHeader
            icon={Cable}
            title={t.currentConnectionTitle}
            iconCls="text-emerald-400"
            iconBg="bg-emerald-500/10"
            right={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={getTone(currentConnection.status)}>{currentConnection.status}</Badge>
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-emerald-400"
                  style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(52,211,153,0.2)" }}
                >
                  {formatCurrency(currentConnection.balance)}
                </span>
              </div>
            }
          />

          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--bd)" }}>
            <InfoRow label={t.infoSourceShop} value={currentConnection.upstreamShop.name} />
            <InfoRow label={t.infoSeller} value={`${currentConnection.upstreamSeller.displayName} (${currentConnection.upstreamSeller.tier})`} />
            <InfoRow label={t.infoApiKey} value={currentConnection.apiKey?.label || "—"} />
            <InfoRow label={t.infoLastSync} value={formatDate(currentConnection.lastCatalogSyncAt)} />
            <InfoRow label={t.infoLastOrder} value={formatDate(currentConnection.lastOrderedAt)} />
          </div>

          <div className="mt-4 rounded-2xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
            <div className="mb-3 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-500" />
              <p className="text-sm font-black uppercase tracking-wide text-emerald-500">{t.topupTitle}</p>
            </div>
            <p className="mb-4 text-xs leading-5" style={{ color: "var(--tx-f)" }}>
              {t.topupDesc}
            </p>

            <div className="mb-3 flex flex-wrap gap-2">
              {[50000, 100000, 200000, 500000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTopupAmount(String(preset))}
                  className="rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-150 active:scale-95"
                  style={
                    topupAmount === String(preset)
                      ? { backgroundColor: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)", border: "1px solid rgba(16,185,129,0.3)" }
                      : { backgroundColor: "var(--surface)", color: "var(--tx-f)", border: "1px solid var(--bd)" }
                  }
                >
                  {formatCurrency(preset)}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Input
                type="number"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                className="max-w-[180px]"
                placeholder={t.topupAmountPh}
              />
              <Button onClick={() => topupMutation.mutate()} disabled={topupMutation.isPending || !topupAmount || Number(topupAmount) <= 0}>
                <Wallet className="h-4 w-4" />
                {topupMutation.isPending ? t.topupLoading : t.topupBtn}
              </Button>
            </div>
          </div>
        </Card>
      ) : canUseInternalSource && !isUltra ? (
        <Card>
          <CardHeader icon={ArrowRightLeft} title={t.connectTitle} iconCls="text-sky-400" iconBg="bg-sky-500/10" />
          <p className="mb-4 text-sm" style={{ color: "var(--tx-m)" }}>
            {t.connectDesc}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                value={connectKey}
                onChange={(e) => setConnectKey(e.target.value)}
                placeholder={t.connectPh}
              />
            </div>
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending || !connectKey.trim()}
            >
              <ArrowRightLeft className="h-4 w-4" />
              {connectMutation.isPending ? t.connecting : t.connectBtn}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ULTRA: onboarding guide */}
      {canManageKeys && (
        <div
          className="rounded-[20px] p-5"
          style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.18)" }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-base"
              style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.2)" }}
            >
              🏪
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgb(167,139,250)" }}>
                {t.onboardKicker}
              </p>
              <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>
                {t.onboardTitle}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: t.onboardStep1Title,
                desc: t.onboardStep1Desc,
                accent: { bg: "rgba(139,92,246,0.1)", bd: "rgba(139,92,246,0.25)", tx: "rgb(167,139,250)" },
              },
              {
                step: "2",
                title: t.onboardStep2Title,
                desc: t.onboardStep2Desc,
                accent: { bg: "rgba(16,185,129,0.08)", bd: "rgba(52,211,153,0.2)", tx: "rgb(52,211,153)" },
              },
              {
                step: "3",
                title: t.onboardStep3Title,
                desc: t.onboardStep3Desc,
                accent: { bg: "rgba(56,189,248,0.08)", bd: "rgba(56,189,248,0.2)", tx: "rgb(56,189,248)" },
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-[14px] p-4"
                style={{ background: item.accent.bg, border: `1px solid ${item.accent.bd}` }}
              >
                <div
                  className="mb-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-black"
                  style={{ background: item.accent.bd, color: item.accent.tx }}
                >
                  {item.step}
                </div>
                <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>{item.title}</p>
                <p className="mt-1 text-xs leading-5" style={{ color: "var(--tx-m)" }}>{item.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--tx-f)" }}>
            {t.onboardFooter}
          </p>
        </div>
      )}

      {/* ULTRA: issued API keys */}
      {canManageKeys && (
        <Card>
          <CardHeader
            icon={BadgeCheck}
            title={t.keysTitle}
            iconCls="text-emerald-400"
            iconBg="bg-emerald-500/10"
            right={
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
              >
                {t.keyCount(keys.length)}
              </span>
            }
          />

          <p className="mb-4 text-sm" style={{ color: "var(--tx-m)" }}>
            {t.keysDesc(
              <code
                className="rounded-md px-1.5 py-0.5 font-mono text-xs"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
              >
                /api
              </code> as any
            )}
          </p>

          {keys.length === 0 ? (
            <div className="rounded-[16px] py-8 text-center" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
              <p className="text-sm" style={{ color: "var(--tx-f)" }}>
                {t.keysEmpty(
                  <code className="font-mono font-bold" style={{ color: "var(--tx)" }}>/api</code> as any
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="rounded-[16px] px-4 py-4"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>{key.label}</p>
                      <p
                        className="mt-0.5 font-mono text-xs"
                        style={{ color: "var(--tx-f)" }}
                      >
                        {key.keyPrefix}•••
                      </p>
                      {key.connection && (
                        <p className="mt-1.5 text-xs" style={{ color: "var(--tx-m)" }}>
                          {t.keyAgent}: {key.connection.downstreamSellerName || "—"} / {key.connection.downstreamShopName || "—"}
                          {" · "}{t.keyBalance}: <span className="font-semibold text-emerald-500">{formatCurrency(key.connection.balance)}</span>
                        </p>
                      )}
                      <p className="mt-1 text-xs" style={{ color: "var(--tx-f)" }}>
                        {t.keyLastUsed}: {formatDate(key.lastUsedAt)}
                        {key.expiresAt ? ` · ${t.keyExpires}: ${formatDate(key.expiresAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={getTone(key.status)}>{key.status}</Badge>
                      {key.status === "active" && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => revokeKeyMutation.mutate(key.id)}
                          disabled={revokeKeyMutation.isPending}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t.revokeBtn}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ULTRA: stock alerts */}
      {canManageKeys && sourceProducts.length > 0 && (
        <Card>
          <CardHeader
            icon={Bell}
            title={t.alertTitle}
            iconCls="text-amber-400"
            iconBg="bg-amber-500/10"
          />
          <p className="mb-4 text-sm" style={{ color: "var(--tx-m)" }}>
            {t.alertDesc}
          </p>

          <div className="space-y-2.5">
            {sourceProducts.map((product) => {
              const isEmpty = product.available === 0;
              const isLow = product.available !== null && product.available > 0 && product.available <= product.stockAlertThreshold;
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
                    border: `1px solid ${isEmpty ? "rgba(244,63,94,0.25)" : isLow ? "rgba(245,158,11,0.25)" : "var(--bd)"}`,
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>{product.sourceName}</p>
                      <p className={`mt-0.5 text-xs ${isEmpty ? "text-rose-400" : isLow ? "text-amber-400" : ""}`}
                         style={!isEmpty && !isLow ? { color: "var(--tx-f)" } : undefined}>
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
                      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--tx-m)" }}>
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) =>
                            setAlertInputs((prev) => ({ ...prev, [product.id]: { threshold, enabled: e.target.checked } }))
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
                            setAlertInputs((prev) => ({ ...prev, [product.id]: { threshold: e.target.value, enabled } }))
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

      {/* ULTRA: agent network */}
      {canManageInternalSource && (
        <Card>
          <CardHeader
            icon={Users}
            title={t.agentTitle}
            iconCls="text-violet-400"
            iconBg="bg-violet-500/10"
            right={
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
              >
                {t.agentCount(downstreamConnections.length)}
              </span>
            }
          />

          {downstreamConnections.length === 0 ? (
            <div className="rounded-[16px] py-8 text-center" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
              <p className="text-sm" style={{ color: "var(--tx-f)" }}>{t.agentEmpty}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {downstreamConnections.map((conn) => {
                const isExpanded = expandedLedger === conn.id;
                const entries = isExpanded ? (ledgerQuery.data || []) : [];

                return (
                  <div
                    key={conn.id}
                    className="rounded-[16px] overflow-hidden"
                    style={{ border: "1px solid var(--bd)" }}
                  >
                    <div className="px-4 py-4" style={{ background: "var(--inp)" }}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: "var(--tx)" }}>
                            {conn.downstreamSeller?.displayName || "—"}
                            {conn.downstreamShop?.name ? ` / ${conn.downstreamShop.name}` : ""}
                            {conn.downstreamShop?.telegramBotUsername
                              ? ` (@${conn.downstreamShop.telegramBotUsername})`
                              : ""}
                          </p>
                          <p className="mt-1 text-xs" style={{ color: "var(--tx-m)" }}>
                            {t.agentBalance}:{" "}
                            <span className="font-semibold text-emerald-500">{formatCurrency(conn.balance)}</span>
                            {" · "}{t.agentSynced}: {formatDate(conn.lastCatalogSyncAt)}
                            {conn.lastOrderedAt ? ` · ${t.agentLastOrder}: ${formatDate(conn.lastOrderedAt)}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge tone={getTone(conn.status)}>{conn.status}</Badge>
                          <span
                            className="rounded-md px-2 py-0.5 text-[11px] font-mono"
                            style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
                          >
                            {conn.apiKey?.label || t.agentNoKey}
                          </span>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setExpandedLedger(isExpanded ? null : conn.id)}
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {t.agentHistory}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ borderTop: "1px solid var(--bd)", background: "var(--surface)" }}>
                        {ledgerQuery.isLoading ? (
                          <p className="px-4 py-6 text-center text-sm" style={{ color: "var(--tx-f)" }}>{t.ledgerLoading}</p>
                        ) : entries.length === 0 ? (
                          <p className="px-4 py-6 text-center text-sm" style={{ color: "var(--tx-f)" }}>{t.ledgerEmpty}</p>
                        ) : (
                          <div>
                            <div
                              className="grid px-4 py-2 text-[10px] font-black uppercase tracking-widest"
                              style={{ gridTemplateColumns: "1fr 100px 110px 110px 130px", color: "var(--tx-f)", borderBottom: "1px solid var(--bd)" }}
                            >
                              <span>{t.ledgerNote}</span>
                              <span className="text-right">{t.ledgerAmount}</span>
                              <span className="text-right">{t.ledgerBefore}</span>
                              <span className="text-right">{t.ledgerAfter}</span>
                              <span className="text-right">{t.ledgerTime}</span>
                            </div>
                            {entries.map((entry) => {
                              const isTopup = entry.type === "topup";
                              return (
                                <div
                                  key={entry.id}
                                  className="grid px-4 py-2.5 text-xs"
                                  style={{
                                    gridTemplateColumns: "1fr 100px 110px 110px 130px",
                                    borderBottom: "1px solid var(--bd)",
                                    color: "var(--tx-m)",
                                  }}
                                >
                                  <span className="truncate pr-2" style={{ color: "var(--tx)" }}>
                                    {entry.note || (isTopup ? t.ledgerTopup : t.ledgerPurchase)}
                                  </span>
                                  <span className={`text-right font-semibold tabular-nums ${isTopup ? "text-emerald-500" : "text-rose-400"}`}>
                                    {isTopup ? "+" : ""}{formatCurrency(entry.amount)}
                                  </span>
                                  <span className="text-right tabular-nums">{formatCurrency(entry.balanceBefore)}</span>
                                  <span className="text-right tabular-nums">{formatCurrency(entry.balanceAfter)}</span>
                                  <span className="text-right">{formatDate(entry.createdAt)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ULTRA: incoming wholesale orders */}
      {canManageInternalSource && (
        <Card>
          <CardHeader
            icon={PackageCheck}
            title={t.ordersTitle}
            iconCls="text-sky-400"
            iconBg="bg-sky-500/10"
            right={
              <div className="flex items-center gap-2">
                {pendingOrders.length > 0 && (
                  <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-amber-400"
                        style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
                    {t.orderPendingCount(pendingOrders.length)}
                  </span>
                )}
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
                >
                  {t.orderCount(sourceOrders.length)}
                </span>
              </div>
            }
          />

          {sourceOrders.length === 0 ? (
            <div className="rounded-[16px] py-8 text-center" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
              <p className="text-sm" style={{ color: "var(--tx-f)" }}>{t.ordersEmpty}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sourceOrders.map((order) => {
                const needsAction = ["pending_manual", "pending_stock", "processing", "pending"].includes(order.status);

                return (
                  <div
                    key={order.id}
                    className="rounded-[16px] px-4 py-4"
                    style={{
                      background: needsAction ? "rgba(245,158,11,0.05)" : "var(--inp)",
                      border: `1px solid ${needsAction ? "rgba(245,158,11,0.2)" : "var(--bd)"}`,
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold" style={{ color: "var(--tx)" }}>
                          {order.product.sourceName}
                        </p>
                        <p className="mt-0.5 font-mono text-xs" style={{ color: "var(--tx-f)" }}>
                          {order.orderCode}
                        </p>
                        <p className="mt-1.5 text-xs" style={{ color: "var(--tx-m)" }}>
                          {t.orderAgent}: {order.downstreamSeller.displayName} / {order.downstreamShop.name}
                        </p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--tx-f)" }}>
                          {t.orderQty}: {order.quantity} · {formatCurrency(order.totalAmount)} · {formatDate(order.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={getTone(order.status)}>{order.status}</Badge>
                        {order.deliveredAt && (
                          <Badge tone="success">
                            <BadgeCheck className="mr-1 h-3 w-3" />
                            {t.delivered}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {order.failureReason && (
                      <p className="mt-2 text-xs text-amber-400">{order.failureReason}</p>
                    )}

                    {order.deliveredAccountText && (
                      <div
                        className="mt-3 rounded-[12px] px-3.5 py-3"
                        style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
                      >
                        <pre className="whitespace-pre-wrap font-mono text-xs" style={{ color: "var(--tx)" }}>
                          {order.deliveredAccountText}
                        </pre>
                      </div>
                    )}

                    {needsAction && (
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div>
                          <p className="mb-1.5 text-xs font-semibold" style={{ color: "var(--tx-m)" }}>{t.deliveryLabel}</p>
                          <Textarea
                            value={manualDeliveries[order.id] || ""}
                            onChange={(e) =>
                              setManualDeliveries((c) => ({ ...c, [order.id]: e.target.value }))
                            }
                            placeholder={t.deliveryPh}
                          />
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-semibold" style={{ color: "var(--tx-m)" }}>{t.failureLabel}</p>
                          <Textarea
                            value={manualFailures[order.id] || ""}
                            onChange={(e) =>
                              setManualFailures((c) => ({ ...c, [order.id]: e.target.value }))
                            }
                            placeholder={t.failurePh}
                          />
                        </div>
                        <div className="lg:col-span-2 flex flex-wrap gap-2.5">
                          <Button
                            onClick={() => manualDeliverMutation.mutate(order.id)}
                            disabled={manualDeliverMutation.isPending}
                          >
                            <PackageCheck className="h-4 w-4" />
                            {manualDeliverMutation.isPending ? t.deliverLoading : t.deliverBtn}
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => manualFailMutation.mutate(order.id)}
                            disabled={manualFailMutation.isPending}
                          >
                            <XCircle className="h-4 w-4" />
                            {manualFailMutation.isPending ? t.failLoading : t.failBtn}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
