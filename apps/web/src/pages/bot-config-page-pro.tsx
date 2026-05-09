import type { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, Bot, Cable, Handshake, KeyRound, ScanSearch, ShieldCheck, Store, Wallet } from "lucide-react";

import { Field } from "@/components/dashboard/field";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/auth-provider";
import { api } from "@/lib/api";
import { formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Thiết lập tự động",
    title: "Cấu hình bot",
    description: "Seller chỉ cần nhập những khóa bắt buộc. Toàn bộ phần verify bot, verify upstream, sync catalog và thiết lập pipeline sẽ được điều phối từ cùng một mặt điều khiển.",
    statShopEmpty: "Chưa đặt tên",
    statPayment: "Thanh toán",
    errorBothKeys: "Vui lòng nhập cả Personal API Key và Secret Key cùng lúc.",
    saving: "Đang lưu...",
    saveAll: "Lưu toàn bộ cấu hình",
    telegramNotVerified: "Chưa xác thực",
    labelSource: "Nguồn",
    labelPayment: "Thanh toán",
    checkingTelegram: "Đang kiểm tra...",
    checkTelegram: "Kiểm tra Telegram",
    checkingSource: "Đang kiểm tra...",
    checkSource: "Kiểm tra nguồn",
    syncing: "Đang đồng bộ...",
    syncProducts: "Đồng bộ sản phẩm",
    toastConnectSuccess: "Kết nối nguồn thành công! Đang đồng bộ sản phẩm...",
    toastSyncCatalog: (n: number) => `Đã đồng bộ ${n} sản phẩm từ nguồn.`,
    toastSaveSuccess: "Đã lưu cấu hình. Tất cả khóa bí mật seller tiếp tục được giữ trong database dưới dạng mã hóa.",
    toastFallbackError: "Có lỗi xảy ra. Hãy kiểm tra lại dữ liệu rồi thử lại.",
    toastTelegramVerified: (u: string) => `Telegram đã xác thực thành công với @${u}.`,
    toastProviderVerified: (n: number | null) => n !== null ? `API nguồn đã xác thực, hiện đọc được ${n} sản phẩm từ upstream.` : "API nguồn đã xác thực thành công.",
    toastSyncProducts: (n: number) => `Đã đồng bộ ${n} sản phẩm về shop seller.`,
    toastNotifOn: "Đã bật đồng bộ thông báo từ bot nguồn.",
    toastNotifOff: "Đã tắt đồng bộ thông báo từ bot nguồn.",
    toastAffiliateSaved: "Đã lưu cấu hình affiliate.",
    cardShop: "Cài đặt shop",
    fieldShopName: "Tên shop",
    fieldTagline: "Tagline",
    fieldTelegramSupport: "Telegram hỗ trợ",
    fieldZaloSupport: "Zalo hỗ trợ",
    phShopName: "Ví dụ: Premium Hub",
    phTagline: "Mô tả ngắn về shop và lời hứa dịch vụ",
    phZalo: "Số điện thoại Zalo",
    cardBot: "Kết nối bot & nguồn",
    fieldBotDesc: "Token bot seller. Chỉ cần nhập lại khi muốn thay mới.",
    phBotToken: "Nhập BOT_TOKEN",
    ultraTitle: "🏪 Tài khoản ULTRA — Bạn là Tổng sỉ",
    ultraDesc: "PRO seller kết nối kho của bạn qua API key tại trang Source Network. Nếu shop riêng cũng dùng nguồn ngoài, điền buyer key bên dưới.",
    sourceConnectedDesc: (name: string, balance: string) => `Đang kết nối ULTRA: ${name} — Số dư: ${balance}đ`,
    sourceKeyDesc: "Nhập buyer key (canboso) hoặc API key ULTRA (isk_...). Hệ thống tự nhận loại nguồn.",
    phSourceConnected: "isk_... (đổi key ULTRA)",
    phSourceKey: "buyer key hoặc isk_...",
    connectingSource: "Đang kết nối...",
    changeKey: "Đổi key",
    connectKey: "Kết nối",
    notifSyncLabel: "Đồng bộ thông báo từ bot nguồn",
    notifSyncDesc: "Bật để bot seller gửi thông báo khi nguồn báo có thêm hàng.",
    toggleOn: "Đang bật",
    toggleOff: "Đang tắt",
    cardPayment: "Cài đặt thanh toán",
    payosDesc: "Tạo link thanh toán VNĐ tự động. Lấy key tại dashboard PayOS.",
    phClientId: "Nhập Client ID",
    phApiKey: "Nhập API Key",
    phChecksumKey: "Nhập Checksum Key",
    usdtDesc: "Bot hiển thị UID/ví cho khách chuyển tay. Personal API tự xác minh lịch sử Pay.",
    phBinanceUid: "UID Binance nhận Pay",
    fieldUsdtRate: "Tỉ giá USDT/VND (tùy chỉnh)",
    usdtRateDesc: (rate: number) => `Mặc định ${rate} VND = 1 USDT`,
    fieldUsdtAddress: "Địa chỉ ví USDT TRC20",
    phUsdtAddress: "Địa chỉ ví TRC20 (TRON)",
    binancePayHint: "Khi bật, bot tự tạo checkout link và nhận webhook xác nhận thanh toán tự động. Khách không cần gửi mã giao dịch.",
    binancePayHintLabel: "Xem ghi chú Binance Pay Auto",
    binancePayAutoLabel: "Binance Pay Auto",
    binancePayAutoDesc: "Bật để dùng Merchant API thay cho chuyển USDT thủ công.",
    binancePayCertDesc: "Certificate SN từ Merchant Admin Portal.",
    binancePayEncDesc: "Được mã hóa trước khi lưu.",
    cardAffiliate: "Chương trình Affiliate",
    affiliateActive: "Đang hoạt động",
    affiliateInactive: "Chưa kích hoạt",
    affiliateToggleHint: "Bấm để chuyển trạng thái",
    affiliateCommission: "Hoa hồng / đơn",
    affiliateProgramLabel: "Nội dung hiển thị trong bot",
    affiliateProgramHint: "Khách bấm Affiliate sẽ thấy nội dung này",
    affiliateProgramPh: (pct: string) => `Ví dụ: Giới thiệu bạn bè — nhận ${pct || "X"}% hoa hồng mỗi đơn thành công. Hoa hồng tích lũy không giới hạn.`,
    affiliateSaving: "Đang lưu...",
    affiliateSave: "Lưu cấu hình",
  },
  en: {
    eyebrow: "Auto Setup",
    title: "Bot Configuration",
    description: "Just enter the required keys. Bot verification, upstream sync, catalog sync, and pipeline setup are all managed from this single control panel.",
    statShopEmpty: "Unnamed",
    statPayment: "Payment",
    errorBothKeys: "Please enter both Personal API Key and Secret Key together.",
    saving: "Saving...",
    saveAll: "Save All Config",
    telegramNotVerified: "Not verified",
    labelSource: "Source",
    labelPayment: "Payment",
    checkingTelegram: "Checking...",
    checkTelegram: "Check Telegram",
    checkingSource: "Checking...",
    checkSource: "Check Source",
    syncing: "Syncing...",
    syncProducts: "Sync Products",
    toastConnectSuccess: "Source connected! Syncing products...",
    toastSyncCatalog: (n: number) => `Synced ${n} products from source.`,
    toastSaveSuccess: "Config saved. All secret keys remain encrypted in the database.",
    toastFallbackError: "An error occurred. Please check your data and try again.",
    toastTelegramVerified: (u: string) => `Telegram verified with @${u}.`,
    toastProviderVerified: (n: number | null) => n !== null ? `Source API verified, reading ${n} products from upstream.` : "Source API verified successfully.",
    toastSyncProducts: (n: number) => `Synced ${n} products to seller shop.`,
    toastNotifOn: "Source notification sync enabled.",
    toastNotifOff: "Source notification sync disabled.",
    toastAffiliateSaved: "Affiliate config saved.",
    cardShop: "Shop Settings",
    fieldShopName: "Shop Name",
    fieldTagline: "Tagline",
    fieldTelegramSupport: "Telegram Support",
    fieldZaloSupport: "Zalo Support",
    phShopName: "e.g. Premium Hub",
    phTagline: "Short description of shop and service promise",
    phZalo: "Zalo phone number",
    cardBot: "Bot & Source Connection",
    fieldBotDesc: "Seller bot token. Only re-enter when changing.",
    phBotToken: "Enter BOT_TOKEN",
    ultraTitle: "🏪 ULTRA Account — You are a Wholesaler",
    ultraDesc: "PRO sellers connect to your inventory via API key on the Source Network page. If your own shop also uses an external source, enter the buyer key below.",
    sourceConnectedDesc: (name: string, balance: string) => `Connected to ULTRA: ${name} — Balance: ${balance}`,
    sourceKeyDesc: "Enter buyer key (canboso) or ULTRA API key (isk_...). The system auto-detects the source type.",
    phSourceConnected: "isk_... (change ULTRA key)",
    phSourceKey: "buyer key or isk_...",
    connectingSource: "Connecting...",
    changeKey: "Change Key",
    connectKey: "Connect",
    notifSyncLabel: "Source notification sync",
    notifSyncDesc: "Enable to forward stock notifications from the source bot to seller bot.",
    toggleOn: "On",
    toggleOff: "Off",
    cardPayment: "Payment Settings",
    payosDesc: "Auto-generate VND payment links. Get keys from PayOS dashboard.",
    phClientId: "Enter Client ID",
    phApiKey: "Enter API Key",
    phChecksumKey: "Enter Checksum Key",
    usdtDesc: "Bot displays UID/wallet for manual transfer. Personal API auto-verifies Pay history.",
    phBinanceUid: "Binance UID for Pay",
    fieldUsdtRate: "USDT/VND Rate (custom)",
    usdtRateDesc: (rate: number) => `Default ${rate} VND = 1 USDT`,
    fieldUsdtAddress: "USDT TRC20 Wallet Address",
    phUsdtAddress: "TRC20 wallet address (TRON)",
    binancePayHint: "When enabled, the bot auto-creates checkout links and receives webhook payment confirmations. Customers don't need to submit transaction codes.",
    binancePayHintLabel: "View Binance Pay Auto note",
    binancePayAutoLabel: "Binance Pay Auto",
    binancePayAutoDesc: "Enable to use Merchant API instead of manual USDT transfer.",
    binancePayCertDesc: "Certificate SN from Merchant Admin Portal.",
    binancePayEncDesc: "Encrypted before saving.",
    cardAffiliate: "Affiliate Program",
    affiliateActive: "Active",
    affiliateInactive: "Inactive",
    affiliateToggleHint: "Click to toggle",
    affiliateCommission: "Commission / order",
    affiliateProgramLabel: "Bot display content",
    affiliateProgramHint: "Customers see this when they tap Affiliate",
    affiliateProgramPh: (pct: string) => `e.g. Refer friends — earn ${pct || "X"}% commission per successful order. Unlimited accumulation.`,
    affiliateSaving: "Saving...",
    affiliateSave: "Save Config",
  },
  th: {
    eyebrow: "ตั้งค่าอัตโนมัติ",
    title: "ตั้งค่าบอท",
    description: "ใส่แค่คีย์ที่จำเป็น ระบบจะจัดการยืนยันบอท ซิงค์แหล่งข้อมูล และตั้งค่าไปป์ไลน์ให้เองจากแผงควบคุมเดียว",
    statShopEmpty: "ยังไม่ตั้งชื่อ",
    statPayment: "การชำระเงิน",
    errorBothKeys: "กรุณาใส่ทั้ง Personal API Key และ Secret Key พร้อมกัน",
    saving: "กำลังบันทึก...",
    saveAll: "บันทึกการตั้งค่าทั้งหมด",
    telegramNotVerified: "ยังไม่ยืนยัน",
    labelSource: "แหล่งสินค้า",
    labelPayment: "การชำระเงิน",
    checkingTelegram: "กำลังตรวจสอบ...",
    checkTelegram: "ตรวจสอบ Telegram",
    checkingSource: "กำลังตรวจสอบ...",
    checkSource: "ตรวจสอบแหล่งสินค้า",
    syncing: "กำลังซิงค์...",
    syncProducts: "ซิงค์สินค้า",
    toastConnectSuccess: "เชื่อมต่อแหล่งสินค้าสำเร็จ กำลังซิงค์สินค้า...",
    toastSyncCatalog: (n: number) => `ซิงค์ ${n} สินค้าจากแหล่งแล้ว`,
    toastSaveSuccess: "บันทึกการตั้งค่าแล้ว คีย์ลับทั้งหมดยังคงเข้ารหัสในฐานข้อมูล",
    toastFallbackError: "เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูลแล้วลองใหม่",
    toastTelegramVerified: (u: string) => `ยืนยัน Telegram สำเร็จกับ @${u}`,
    toastProviderVerified: (n: number | null) => n !== null ? `ยืนยัน API แหล่งสินค้าแล้ว อ่านได้ ${n} สินค้า` : "ยืนยัน API แหล่งสินค้าสำเร็จ",
    toastSyncProducts: (n: number) => `ซิงค์ ${n} สินค้าไปยังร้านค้าแล้ว`,
    toastNotifOn: "เปิดการซิงค์การแจ้งเตือนจากบอทแหล่งสินค้าแล้ว",
    toastNotifOff: "ปิดการซิงค์การแจ้งเตือนจากบอทแหล่งสินค้าแล้ว",
    toastAffiliateSaved: "บันทึกการตั้งค่า Affiliate แล้ว",
    cardShop: "ตั้งค่าร้านค้า",
    fieldShopName: "ชื่อร้านค้า",
    fieldTagline: "คำโปรย",
    fieldTelegramSupport: "Telegram สนับสนุน",
    fieldZaloSupport: "Zalo สนับสนุน",
    phShopName: "เช่น Premium Hub",
    phTagline: "คำอธิบายสั้นๆ เกี่ยวกับร้านและบริการ",
    phZalo: "เบอร์โทรศัพท์ Zalo",
    cardBot: "เชื่อมต่อบอทและแหล่งสินค้า",
    fieldBotDesc: "Token บอทผู้ขาย ใส่ใหม่เฉพาะเมื่อต้องการเปลี่ยน",
    phBotToken: "ใส่ BOT_TOKEN",
    ultraTitle: "🏪 บัญชี ULTRA — คุณคือผู้ค้าส่ง",
    ultraDesc: "ผู้ขาย PRO เชื่อมต่อคลังของคุณผ่าน API key ที่หน้า Source Network หากร้านของคุณใช้แหล่งภายนอกด้วย ให้ใส่ buyer key ด้านล่าง",
    sourceConnectedDesc: (name: string, balance: string) => `เชื่อมต่อ ULTRA: ${name} — ยอดคงเหลือ: ${balance}`,
    sourceKeyDesc: "ใส่ buyer key (canboso) หรือ ULTRA API key (isk_...) ระบบตรวจจับประเภทแหล่งสินค้าอัตโนมัติ",
    phSourceConnected: "isk_... (เปลี่ยน ULTRA key)",
    phSourceKey: "buyer key หรือ isk_...",
    connectingSource: "กำลังเชื่อมต่อ...",
    changeKey: "เปลี่ยน Key",
    connectKey: "เชื่อมต่อ",
    notifSyncLabel: "ซิงค์การแจ้งเตือนจากบอทแหล่งสินค้า",
    notifSyncDesc: "เปิดเพื่อให้บอทผู้ขายส่งการแจ้งเตือนเมื่อแหล่งสินค้ามีสินค้าเพิ่ม",
    toggleOn: "เปิด",
    toggleOff: "ปิด",
    cardPayment: "ตั้งค่าการชำระเงิน",
    payosDesc: "สร้างลิงก์ชำระเงิน VND อัตโนมัติ รับ key จาก dashboard PayOS",
    phClientId: "ใส่ Client ID",
    phApiKey: "ใส่ API Key",
    phChecksumKey: "ใส่ Checksum Key",
    usdtDesc: "บอทแสดง UID/กระเป๋าเงินให้ลูกค้าโอน Personal API ยืนยันประวัติการชำระอัตโนมัติ",
    phBinanceUid: "Binance UID สำหรับ Pay",
    fieldUsdtRate: "อัตรา USDT/VND (กำหนดเอง)",
    usdtRateDesc: (rate: number) => `ค่าเริ่มต้น ${rate} VND = 1 USDT`,
    fieldUsdtAddress: "ที่อยู่กระเป๋า USDT TRC20",
    phUsdtAddress: "ที่อยู่กระเป๋า TRC20 (TRON)",
    binancePayHint: "เมื่อเปิด บอทจะสร้างลิงก์ checkout และรับ webhook ยืนยันการชำระอัตโนมัติ ลูกค้าไม่ต้องส่งรหัสธุรกรรม",
    binancePayHintLabel: "ดูหมายเหตุ Binance Pay Auto",
    binancePayAutoLabel: "Binance Pay Auto",
    binancePayAutoDesc: "เปิดเพื่อใช้ Merchant API แทนการโอน USDT ด้วยตนเอง",
    binancePayCertDesc: "Certificate SN จาก Merchant Admin Portal",
    binancePayEncDesc: "เข้ารหัสก่อนบันทึก",
    cardAffiliate: "โปรแกรม Affiliate",
    affiliateActive: "กำลังทำงาน",
    affiliateInactive: "ยังไม่เปิดใช้",
    affiliateToggleHint: "แตะเพื่อเปลี่ยนสถานะ",
    affiliateCommission: "ค่าคอมมิชชัน / คำสั่ง",
    affiliateProgramLabel: "เนื้อหาแสดงในบอท",
    affiliateProgramHint: "ลูกค้าเห็นเนื้อหานี้เมื่อแตะ Affiliate",
    affiliateProgramPh: (pct: string) => `เช่น แนะนำเพื่อน — รับ ${pct || "X"}% ค่าคอมมิชชันทุกคำสั่งที่สำเร็จ สะสมไม่จำกัด`,
    affiliateSaving: "กำลังบันทึก...",
    affiliateSave: "บันทึกการตั้งค่า",
  },
};

type BotConfigForm = {
  shopName: string;
  shopTagline: string;
  botToken: string;
  providerBaseUrl: string;
  providerBuyerKey: string;
  supportTelegram: string;
  supportZalo: string;
  logoUrl: string;
  sourceNotificationSyncEnabled: boolean;
  payosClientId: string;
  payosApiKey: string;
  payosChecksumKey: string;
  binanceUid: string;
  okxUid: string;
  usdtTrc20Address: string;
  usdtVndRateOverride: string;
  binancePersonalApiKey: string;
  binancePersonalSecretKey: string;
  binancePayApiKey: string;
  binancePaySecretKey: string;
  binancePayEnabled: boolean;
};

function normalizeOptionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function buildBotConfigPayload(form: BotConfigForm) {
  const payload: Record<string, string | boolean> = {
    sourceNotificationSyncEnabled: form.sourceNotificationSyncEnabled,
  };

  const fields: Array<[Exclude<keyof BotConfigForm, "sourceNotificationSyncEnabled" | "binancePayEnabled">, string]> = [
    ["shopName", "shopName"],
    ["shopTagline", "shopTagline"],
    ["botToken", "botToken"],
    ["providerBaseUrl", "providerBaseUrl"],
    ["providerBuyerKey", "providerBuyerKey"],
    ["supportTelegram", "supportTelegram"],
    ["supportZalo", "supportZalo"],
    ["logoUrl", "logoUrl"],
    ["payosClientId", "payosClientId"],
    ["payosApiKey", "payosApiKey"],
    ["payosChecksumKey", "payosChecksumKey"],
    ["binanceUid", "binanceUid"],
    ["okxUid", "okxUid"],
    ["usdtTrc20Address", "usdtTrc20Address"],
    ["binancePersonalApiKey", "binancePersonalApiKey"],
    ["binancePersonalSecretKey", "binancePersonalSecretKey"],
    ["binancePayApiKey", "binancePayApiKey"],
    ["binancePaySecretKey", "binancePaySecretKey"],
  ];

  for (const [formKey, payloadKey] of fields) {
    const nextValue = normalizeOptionalValue(form[formKey] as string);
    if (nextValue !== undefined) {
      payload[payloadKey] = nextValue;
    }
  }

  payload.binancePayEnabled = form.binancePayEnabled;
  payload.usdtVndRateOverride = form.usdtVndRateOverride.trim();

  return payload;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const apiMessage = axiosError.response?.data?.message;
  if (Array.isArray(apiMessage)) return apiMessage.join(", ");
  if (typeof apiMessage === "string" && apiMessage.trim() !== "") return apiMessage;
  return fallback;
}

function getInitialForm(): BotConfigForm {
  return {
    shopName: "",
    shopTagline: "",
    botToken: "",
    providerBaseUrl: "https://canboso.com",
    providerBuyerKey: "",
    supportTelegram: "",
    supportZalo: "",
    logoUrl: "",
    sourceNotificationSyncEnabled: true,
    payosClientId: "",
    payosApiKey: "",
    payosChecksumKey: "",
    binanceUid: "",
    okxUid: "",
    usdtTrc20Address: "",
    usdtVndRateOverride: "",
    binancePersonalApiKey: "",
    binancePersonalSecretKey: "",
    binancePayApiKey: "",
    binancePaySecretKey: "",
    binancePayEnabled: false,
  };
}

function toneByStatus(value?: string | null) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "verified" || normalized === "active" || normalized === "mock") return "success" as const;
  if (normalized === "failed") return "danger" as const;
  if (normalized === "pending" || normalized === "polling") return "warning" as const;
  return "neutral" as const;
}

export function BotConfigPage() {
  const { lang } = useLang();
  const t = T[lang];

  const { session } = useAuth();
  const isUltra = session?.user.sellerTier === "ultra";
  const isPro = !isUltra;
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["bot-config"],
    queryFn: async () => (await api.get("/bot-config")).data,
  });
  const [form, setForm] = useState<BotConfigForm>(getInitialForm);
  const [simulationOutput, setSimulationOutput] = useState("");
  const [sourceKeyInput, setSourceKeyInput] = useState("");
  const { showToast } = useToast();

  const sourceConnectionQuery = useQuery({
    queryKey: ["seller-source-connection"],
    queryFn: async () => (await api.get("/seller/source-connection")).data,
    enabled: isPro,
  });

  const connectSourceMutation = useMutation({
    mutationFn: async (apiKey: string) =>
      (await api.post("/seller/source-connection", { apiKey })).data,
    onSuccess: async () => {
      setSourceKeyInput("");
      showToast({ tone: "success", message: t.toastConnectSuccess });
      queryClient.invalidateQueries({ queryKey: ["seller-source-connection"] });
      try {
        const syncResult = await api.post<{ synced: number }>("/seller/source-connection/sync-catalog");
        showToast({ tone: "success", message: t.toastSyncCatalog(syncResult.data.synced) });
      } catch { /* worker syncs later */ }
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, t.toastFallbackError) }),
  });

  useEffect(() => {
    if (!configQuery.data) return;
    setForm({
      shopName: configQuery.data.shopName || "",
      shopTagline: configQuery.data.shopTagline || "",
      botToken: "",
      providerBaseUrl: configQuery.data.providerBaseUrl || "https://canboso.com",
      providerBuyerKey: "",
      supportTelegram: configQuery.data.supportTelegram || "",
      supportZalo: configQuery.data.supportZalo || "",
      logoUrl: configQuery.data.logoUrl || "",
      sourceNotificationSyncEnabled: configQuery.data.sourceNotificationSyncEnabled ?? true,
      payosClientId: "",
      payosApiKey: "",
      payosChecksumKey: "",
      binanceUid: configQuery.data.binanceUid || "",
      okxUid: configQuery.data.okxUid || "",
      usdtTrc20Address: configQuery.data.usdtTrc20Address || "",
      usdtVndRateOverride:
        configQuery.data.usdtVndRateOverride !== null && configQuery.data.usdtVndRateOverride !== undefined
          ? String(configQuery.data.usdtVndRateOverride)
          : "",
      binancePersonalApiKey: "",
      binancePersonalSecretKey: "",
      binancePayApiKey: "",
      binancePaySecretKey: "",
      binancePayEnabled: configQuery.data.binancePayEnabled ?? false,
    });
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => api.put("/bot-config", buildBotConfigPayload(form)),
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastSaveSuccess });
      setForm((current) => ({
        ...current,
        botToken: "",
        providerBuyerKey: "",
        payosClientId: "",
        payosApiKey: "",
        payosChecksumKey: "",
        binancePersonalApiKey: "",
        binancePersonalSecretKey: "",
        binancePayApiKey: "",
        binancePaySecretKey: "",
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bot-config"] }),
        queryClient.invalidateQueries({ queryKey: ["shop"] }),
      ]);
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, t.toastFallbackError) }),
  });

  const verifyTelegramMutation = useMutation({
    mutationFn: async () => api.post("/bot-config/verify-telegram"),
    onSuccess: async (response) => {
      showToast({ tone: "success", message: t.toastTelegramVerified(response.data.telegramBotUsername || "bot") });
      await queryClient.invalidateQueries({ queryKey: ["bot-config"] });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, t.toastFallbackError) }),
  });

  const verifyProviderMutation = useMutation({
    mutationFn: async () => api.post("/bot-config/verify-provider"),
    onSuccess: async (response) => {
      const sampleSize = response.data.providerSampleSize;
      showToast({
        tone: "success",
        message: t.toastProviderVerified(typeof sampleSize === "number" ? sampleSize : null),
      });
      await queryClient.invalidateQueries({ queryKey: ["bot-config"] });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, t.toastFallbackError) }),
  });

  const syncProductsMutation = useMutation({
    mutationFn: async () => api.post("/bot-config/sync-products"),
    onSuccess: async (response) => {
      showToast({ tone: "success", message: t.toastSyncProducts(response.data.synced || 0) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bot-config"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, t.toastFallbackError) }),
  });

  const sourceNotificationSyncMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      api.put("/bot-config", { sourceNotificationSyncEnabled: enabled }),
    onSuccess: async (_response, enabled) => {
      queryClient.setQueryData(["bot-config"], (current: any) =>
        current ? { ...current, sourceNotificationSyncEnabled: enabled } : current,
      );
      showToast({ tone: "success", message: enabled ? t.toastNotifOn : t.toastNotifOff });
    },
    onError: (error, enabled) => {
      setForm((current) => ({ ...current, sourceNotificationSyncEnabled: !enabled }));
      showToast({ tone: "error", message: getApiErrorMessage(error, t.toastFallbackError) });
    },
  });

  function toggleSourceNotificationSync() {
    const nextEnabled = !form.sourceNotificationSyncEnabled;
    setForm((current) => ({ ...current, sourceNotificationSyncEnabled: nextEnabled }));
    sourceNotificationSyncMutation.mutate(nextEnabled);
  }

  const simulateMutation = useMutation({
    mutationFn: async (payload: { text?: string; callbackData?: string }) =>
      api.post(`/dev/telegram/${configQuery.data.shopId}/simulate`, payload),
    onSuccess: (response) => setSimulationOutput(JSON.stringify(response.data.actions, null, 2)),
    onError: (error) => setSimulationOutput(getApiErrorMessage(error, t.toastFallbackError)),
  });

  const affiliateQuery = useQuery({
    queryKey: ["affiliate-config"],
    queryFn: async () => (await api.get("/affiliate/config")).data,
  });
  const [affiliateForm, setAffiliateForm] = useState({
    enabled: false,
    commissionPct: "0",
    programText: "",
  });
  useEffect(() => {
    if (!affiliateQuery.data) return;
    setAffiliateForm({
      enabled: affiliateQuery.data.enabled ?? false,
      commissionPct: String(affiliateQuery.data.commissionPct ?? "0"),
      programText: affiliateQuery.data.programText ?? "",
    });
  }, [affiliateQuery.data]);
  const affiliateMutation = useMutation({
    mutationFn: async () =>
      api.put("/affiliate/config", {
        enabled: affiliateForm.enabled,
        commissionPct: parseFloat(affiliateForm.commissionPct) || 0,
        programText: affiliateForm.programText.trim() || undefined,
      }),
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastAffiliateSaved });
      await queryClient.invalidateQueries({ queryKey: ["affiliate-config"] });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, t.toastFallbackError) }),
  });

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.description}
        gradient="orange"
        stats={[
          { icon: Store, label: "Shop", value: configQuery.data?.shopName || t.statShopEmpty, iconCls: "text-amber-400", bgCls: "bg-amber-500/15" },
          { icon: Bot, label: "Telegram", value: formatStatusLabel(configQuery.data?.telegramWebhookStatus), iconCls: "text-sky-400", bgCls: "bg-sky-500/15" },
          { icon: Cable, label: "Provider", value: formatStatusLabel(configQuery.data?.providerConnectionStatus), iconCls: "text-emerald-400", bgCls: "bg-emerald-500/15" },
          { icon: Wallet, label: t.statPayment, value: formatStatusLabel(configQuery.data?.paymentProvider), iconCls: "text-violet-400", bgCls: "bg-violet-500/15" },
        ]}
        actions={
          <Button className="min-w-[220px]" disabled={saveMutation.isPending} onClick={() => {
            const hasApiKey = form.binancePersonalApiKey.trim().length > 0;
            const hasSecretKey = form.binancePersonalSecretKey.trim().length > 0;
            if (hasApiKey !== hasSecretKey) {
              showToast({ tone: "error", message: t.errorBothKeys });
              return;
            }
            saveMutation.mutate();
          }}>
            {saveMutation.isPending ? t.saving : t.saveAll}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] px-4 py-3" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--tx-f)" }}>Telegram</span>
            <span className="text-xs font-medium" style={{ color: "var(--tx)" }}>
              {configQuery.data?.telegramBotUsername ? `@${configQuery.data.telegramBotUsername}` : t.telegramNotVerified}
            </span>
            <Badge tone={toneByStatus(configQuery.data?.telegramWebhookStatus)}>
              {formatStatusLabel(configQuery.data?.telegramWebhookStatus)}
            </Badge>
          </div>
          <div className="h-3.5 w-px" style={{ background: "var(--bd)" }} />
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--tx-f)" }}>{t.labelSource}</span>
            <Badge tone={toneByStatus(configQuery.data?.providerConnectionStatus)}>
              {formatStatusLabel(configQuery.data?.providerConnectionStatus)}
            </Badge>
          </div>
          <div className="h-3.5 w-px" style={{ background: "var(--bd)" }} />
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--tx-f)" }}>{t.labelPayment}</span>
            <Badge tone={toneByStatus(configQuery.data?.paymentProvider)}>
              {formatStatusLabel(configQuery.data?.paymentProvider)}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={verifyTelegramMutation.isPending} onClick={() => verifyTelegramMutation.mutate()}>
            <ScanSearch className="h-3.5 w-3.5" />
            {verifyTelegramMutation.isPending ? t.checkingTelegram : t.checkTelegram}
          </Button>
          <Button variant="secondary" disabled={verifyProviderMutation.isPending} onClick={() => verifyProviderMutation.mutate()}>
            <Cable className="h-3.5 w-3.5" />
            {verifyProviderMutation.isPending ? t.checkingSource : t.checkSource}
          </Button>
          <Button variant="secondary" disabled={syncProductsMutation.isPending} onClick={() => syncProductsMutation.mutate()}>
            <KeyRound className="h-3.5 w-3.5" />
            {syncProductsMutation.isPending ? t.syncing : t.syncProducts}
          </Button>
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader icon={Store} title={t.cardShop} iconCls="text-amber-400" iconBg="bg-amber-500/10" />
            <div className="mt-0 grid gap-5 sm:grid-cols-2">
              <Field label={t.fieldShopName} hint="Required">
                <Input
                  value={form.shopName}
                  onChange={(e) => setForm((c) => ({ ...c, shopName: e.target.value }))}
                  placeholder={t.phShopName}
                />
              </Field>
              <Field label="Logo URL" hint="Optional">
                <Input
                  value={form.logoUrl}
                  onChange={(e) => setForm((c) => ({ ...c, logoUrl: e.target.value }))}
                  placeholder="https://..."
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t.fieldTagline} hint="Optional">
                  <Textarea
                    className="min-h-[80px]"
                    value={form.shopTagline}
                    onChange={(e) => setForm((c) => ({ ...c, shopTagline: e.target.value }))}
                    placeholder={t.phTagline}
                  />
                </Field>
              </div>
              <Field label={t.fieldTelegramSupport}>
                <Input
                  value={form.supportTelegram}
                  onChange={(e) => setForm((c) => ({ ...c, supportTelegram: e.target.value }))}
                  placeholder="@support_shop"
                />
              </Field>
              <Field label={t.fieldZaloSupport}>
                <Input
                  value={form.supportZalo}
                  onChange={(e) => setForm((c) => ({ ...c, supportZalo: e.target.value }))}
                  placeholder={t.phZalo}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader icon={Bot} title={t.cardBot} iconCls="text-sky-400" iconBg="bg-sky-500/10" />
            <div className="mt-0 grid gap-5">
              <Field
                label="BOT_TOKEN"
                hint={configQuery.data?.botTokenMasked ? "Encrypted" : "Required"}
                description={t.fieldBotDesc}
              >
                <Input
                  value={form.botToken}
                  onChange={(e) => setForm((c) => ({ ...c, botToken: e.target.value }))}
                  placeholder={configQuery.data?.botTokenMasked || t.phBotToken}
                />
              </Field>

              {isUltra && (
                <div className="rounded-[16px] border border-violet-400/20 bg-violet-500/10 p-4">
                  <p className="text-sm font-semibold" style={{ color: "rgb(196,181,253)" }}>{t.ultraTitle}</p>
                  <p className="mt-2 text-sm leading-6" style={{ color: "var(--tx-m)" }}>
                    {t.ultraDesc}
                  </p>
                </div>
              )}

              <Field
                label="Source key"
                hint={configQuery.data?.providerBuyerKeyMasked || sourceConnectionQuery.data?.status === "active" ? "Encrypted" : isUltra ? "Optional" : "Required"}
                description={
                  sourceConnectionQuery.data?.status === "active"
                    ? t.sourceConnectedDesc(
                        sourceConnectionQuery.data.upstreamShop?.name ?? "",
                        (sourceConnectionQuery.data.balance ?? 0).toLocaleString("vi-VN"),
                      )
                    : t.sourceKeyDesc
                }
              >
                <div className="flex gap-3">
                  <Input
                    value={sourceKeyInput || form.providerBuyerKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSourceKeyInput(val);
                      if (!val.startsWith("isk_")) {
                        setForm((c) => ({ ...c, providerBuyerKey: val }));
                      }
                    }}
                    placeholder={
                      sourceConnectionQuery.data?.status === "active"
                        ? t.phSourceConnected
                        : configQuery.data?.providerBuyerKeyMasked || t.phSourceKey
                    }
                    className="font-mono text-sm"
                  />
                  {sourceKeyInput.trim().startsWith("isk_") && (
                    <Button
                      type="button"
                      onClick={() => connectSourceMutation.mutate(sourceKeyInput.trim())}
                      disabled={connectSourceMutation.isPending}
                    >
                      {connectSourceMutation.isPending
                        ? t.connectingSource
                        : sourceConnectionQuery.data?.status === "active"
                        ? t.changeKey
                        : t.connectKey}
                    </Button>
                  )}
                </div>
              </Field>

              <div className="flex flex-col gap-4 rounded-[22px] px-4 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                <div className="min-w-0">
                  <p className="font-semibold" style={{ color: "var(--tx)" }}>{t.notifSyncLabel}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--tx-f)" }}>{t.notifSyncDesc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.sourceNotificationSyncEnabled}
                  aria-busy={sourceNotificationSyncMutation.isPending}
                  disabled={sourceNotificationSyncMutation.isPending}
                  onClick={toggleSourceNotificationSync}
                  className="inline-flex h-12 w-full shrink-0 items-center justify-between gap-3 rounded-[14px] border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 sm:w-[164px]"
                  style={form.sourceNotificationSyncEnabled
                    ? { borderColor: "rgba(249,115,22,0.3)", background: "rgba(249,115,22,0.08)", color: "var(--tx)" }
                    : { borderColor: "var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }
                  }
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-[10px] transition"
                    style={form.sourceNotificationSyncEnabled
                      ? { background: "rgb(249,115,22)", color: "white" }
                      : { background: "var(--inp)", color: "var(--tx-f)" }
                    }
                  >
                    {form.sourceNotificationSyncEnabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  </span>
                  <span>{form.sourceNotificationSyncEnabled ? t.toggleOn : t.toggleOff}</span>
                </button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={Wallet} title={t.cardPayment} iconCls="text-violet-400" iconBg="bg-violet-500/10" />

            <div className="mt-0">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>PayOS — VNĐ</p>
              <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>{t.payosDesc}</p>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Field label="Client ID" hint={configQuery.data?.payosClientIdMasked ? "Encrypted" : "Optional"}>
                  <Input
                    value={form.payosClientId}
                    onChange={(e) => setForm((c) => ({ ...c, payosClientId: e.target.value }))}
                    placeholder={configQuery.data?.payosClientIdMasked || t.phClientId}
                  />
                </Field>
                <Field label="API Key" hint={configQuery.data?.payosApiKeyMasked ? "Encrypted" : "Optional"}>
                  <Input
                    value={form.payosApiKey}
                    onChange={(e) => setForm((c) => ({ ...c, payosApiKey: e.target.value }))}
                    placeholder={configQuery.data?.payosApiKeyMasked || t.phApiKey}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Checksum Key" hint={configQuery.data?.payosChecksumKeyMasked ? "Encrypted" : "Optional"}>
                    <Input
                      value={form.payosChecksumKey}
                      onChange={(e) => setForm((c) => ({ ...c, payosChecksumKey: e.target.value }))}
                      placeholder={configQuery.data?.payosChecksumKeyMasked || t.phChecksumKey}
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="my-6" style={{ borderTop: "1px solid var(--bd)" }} />

            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>USDT / Crypto</p>
              <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>{t.usdtDesc}</p>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Field label="Binance UID" hint="Optional">
                  <Input
                    value={form.binanceUid}
                    onChange={(e) => setForm((c) => ({ ...c, binanceUid: e.target.value }))}
                    placeholder={t.phBinanceUid}
                  />
                </Field>
                <Field
                  label={t.fieldUsdtRate}
                  hint="Optional"
                  description={t.usdtRateDesc(configQuery.data?.defaultUsdtVndRate || 26000)}
                >
                  <Input
                    inputMode="decimal"
                    value={form.usdtVndRateOverride}
                    onChange={(e) => setForm((c) => ({ ...c, usdtVndRateOverride: e.target.value }))}
                    placeholder={String(configQuery.data?.defaultUsdtVndRate || 26000)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t.fieldUsdtAddress} hint="Optional">
                    <Input
                      value={form.usdtTrc20Address}
                      onChange={(e) => setForm((c) => ({ ...c, usdtTrc20Address: e.target.value }))}
                      placeholder={t.phUsdtAddress}
                    />
                  </Field>
                </div>
                <Field label="Personal API Key" hint={configQuery.data?.binancePersonalApiKeyMasked ? "Encrypted" : "Optional"}>
                  <Input
                    value={form.binancePersonalApiKey}
                    onChange={(e) => setForm((c) => ({ ...c, binancePersonalApiKey: e.target.value }))}
                    placeholder={configQuery.data?.binancePersonalApiKeyMasked || t.phApiKey}
                  />
                </Field>
                <Field label="Personal Secret Key" hint={configQuery.data?.binancePersonalSecretKeyMasked ? "Encrypted" : "Optional"}>
                  <Input
                    value={form.binancePersonalSecretKey}
                    onChange={(e) => setForm((c) => ({ ...c, binancePersonalSecretKey: e.target.value }))}
                    placeholder={configQuery.data?.binancePersonalSecretKeyMasked || t.phApiKey}
                  />
                </Field>
              </div>
            </div>

            <div className="my-6" style={{ borderTop: "1px solid var(--bd)" }} />

            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Binance Pay Merchant</p>
              <div className="mt-3">
                <InfoHint content={t.binancePayHint} label={t.binancePayHintLabel} />
              </div>
              <div className="mt-4 grid gap-5">
                <div className="flex flex-col gap-4 rounded-[22px] px-4 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <div className="min-w-0">
                    <p className="font-semibold" style={{ color: "var(--tx)" }}>{t.binancePayAutoLabel}</p>
                    <p className="mt-1 text-sm" style={{ color: "var(--tx-f)" }}>{t.binancePayAutoDesc}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.binancePayEnabled}
                    onClick={() => setForm((c) => ({ ...c, binancePayEnabled: !c.binancePayEnabled }))}
                    className="inline-flex h-12 w-full shrink-0 items-center justify-between gap-3 rounded-[14px] border px-3 text-sm font-semibold transition sm:w-[164px]"
                    style={form.binancePayEnabled
                      ? { borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.08)", color: "var(--tx)" }
                      : { borderColor: "var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }
                    }
                  >
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-[10px] transition"
                      style={form.binancePayEnabled
                        ? { background: "rgb(245,158,11)", color: "white" }
                        : { background: "var(--inp)", color: "var(--tx-f)" }
                      }
                    >🟡</span>
                    <span>{form.binancePayEnabled ? t.toggleOn : t.toggleOff}</span>
                  </button>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Binance Pay API Key"
                    hint={configQuery.data?.binancePayApiKeyMasked ? "Encrypted" : "Optional"}
                    description={t.binancePayCertDesc}
                  >
                    <Input
                      value={form.binancePayApiKey}
                      onChange={(e) => setForm((c) => ({ ...c, binancePayApiKey: e.target.value }))}
                      placeholder={configQuery.data?.binancePayApiKeyMasked || t.phApiKey}
                    />
                  </Field>
                  <Field
                    label="Binance Pay Secret Key"
                    hint={configQuery.data?.binancePaySecretKeyMasked ? "Encrypted" : "Optional"}
                    description={t.binancePayEncDesc}
                  >
                    <Input
                      value={form.binancePaySecretKey}
                      onChange={(e) => setForm((c) => ({ ...c, binancePaySecretKey: e.target.value }))}
                      placeholder={configQuery.data?.binancePaySecretKeyMasked || t.phApiKey}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader icon={Handshake} title={t.cardAffiliate} iconCls="text-orange-400" iconBg="bg-orange-500/10" />

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setAffiliateForm((f) => ({ ...f, enabled: !f.enabled }))}
            className="flex items-center justify-between rounded-2xl px-4 py-3 transition-all"
            style={{
              background: affiliateForm.enabled ? "rgba(249,115,22,0.08)" : "var(--inp)",
              border: `1px solid ${affiliateForm.enabled ? "rgba(249,115,22,0.4)" : "var(--bd)"}`,
            }}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl text-sm transition-all"
                style={{ background: affiliateForm.enabled ? "rgb(249,115,22)" : "var(--surface)", color: affiliateForm.enabled ? "white" : "var(--tx-f)" }}>
                {affiliateForm.enabled ? "✓" : "○"}
              </span>
              <div className="text-left">
                <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>
                  {affiliateForm.enabled ? t.affiliateActive : t.affiliateInactive}
                </p>
                <p className="text-xs" style={{ color: "var(--tx-f)" }}>{t.affiliateToggleHint}</p>
              </div>
            </div>
            <div className="h-5 w-9 rounded-full transition-all" style={{ background: affiliateForm.enabled ? "rgb(249,115,22)" : "var(--bd)" }}>
              <div className="m-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ transform: affiliateForm.enabled ? "translateX(16px)" : "translateX(0)" }} />
            </div>
          </button>

          <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
            <span className="text-sm font-medium" style={{ color: "var(--tx-f)" }}>{t.affiliateCommission}</span>
            <Input
              type="number" min={0} max={100} step={0.5}
              value={affiliateForm.commissionPct}
              onChange={(e) => setAffiliateForm((f) => ({ ...f, commissionPct: e.target.value }))}
              className="w-20 text-center"
            />
            <span className="text-sm font-bold" style={{ color: "rgb(249,115,22)" }}>%</span>
          </div>

          <div className="sm:col-span-2">
            <Field label={t.affiliateProgramLabel} hint={t.affiliateProgramHint}>
              <Textarea
                value={affiliateForm.programText}
                onChange={(e) => setAffiliateForm((f) => ({ ...f, programText: e.target.value }))}
                placeholder={t.affiliateProgramPh(affiliateForm.commissionPct)}
                rows={3}
              />
            </Field>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button disabled={affiliateMutation.isPending} onClick={() => affiliateMutation.mutate()}>
            {affiliateMutation.isPending ? t.affiliateSaving : t.affiliateSave}
          </Button>
        </div>
      </Card>
    </div>
  );
}
