import type { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, Bot, Cable, Handshake, KeyRound, ScanSearch, ShieldCheck, Store, Wallet } from "lucide-react";

import { Field } from "@/components/dashboard/field";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/auth-provider";
import { api } from "@/lib/api";
import { formatStatusLabel } from "@/lib/format";
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
    fieldOwnerTelegramDesc: "Telegram User ID của bạn (chủ bot). Dùng để xác thực khi mở cài đặt bot trong Telegram.",
    phOwnerTelegramUserId: "VD: 123456789",
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
    markupLabel: "% tăng giá so với nguồn",
    markupDesc: "Giá bán = giá nguồn × (1 + %/100). Để trống = giá nguồn + 10.000đ.",
    markupPlaceholder: "VD: 15 (tức +15%)",
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
    fieldOwnerTelegramDesc: "Your Telegram User ID (bot owner). Used to authenticate when opening bot settings in Telegram.",
    phOwnerTelegramUserId: "e.g. 123456789",
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
    markupLabel: "Price markup % vs source",
    markupDesc: "Sale price = source price × (1 + %/100). Leave empty = source + 10,000₫.",
    markupPlaceholder: "e.g. 15 (= +15%)",
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
    fieldOwnerTelegramDesc: "Telegram User ID ของคุณ (เจ้าของบอท) ใช้ยืนยันตัวตนเมื่อเปิดการตั้งค่าบอทใน Telegram",
    phOwnerTelegramUserId: "เช่น 123456789",
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
    markupLabel: "% เพิ่มราคาจากแหล่งสินค้า",
    markupDesc: "ราคาขาย = ราคาต้นทุน × (1 + %/100). ว่าง = ต้นทุน + 10,000₫",
    markupPlaceholder: "เช่น 15 (= +15%)",
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
  ownerTelegramUserId: string;
  providerBaseUrl: string;
  providerBuyerKey: string;
  supportTelegram: string;
  supportZalo: string;
  logoUrl: string;
  sourceNotificationSyncEnabled: boolean;
  priceMarkupPercent: string;
  paymentProvider: string;
  payosClientId: string;
  payosApiKey: string;
  payosChecksumKey: string;
  pay2sPartnerCode: string;
  pay2sAccessKey: string;
  pay2sSecretKey: string;
  pay2sBankAccount: string;
  pay2sBankId: string;
  pay2sWebhookToken: string;
  web2mAccountNumber: string;
  web2mBankCode: string;
  web2mPassword: string;
  web2mToken: string;
  web2mAccessToken: string;
  binanceUid: string;
  okxUid: string;
  usdtTrc20Address: string;
  usdtSolanaAddress: string;
  usdtVndRateOverride: string;
  binancePersonalApiKey: string;
  binancePersonalSecretKey: string;
  binancePayApiKey: string;
  binancePaySecretKey: string;
  binancePayEnabled: boolean;
  okxPersonalApiKey: string;
  okxPersonalSecretKey: string;
  okxPersonalPassphrase: string;
  okxPersonalApiEnabled: boolean;
  usdtBep20Address: string;
};

function normalizeOptionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function buildBotConfigPayload(form: BotConfigForm) {
  const payload: Record<string, string | boolean | number | null> = {
    sourceNotificationSyncEnabled: form.sourceNotificationSyncEnabled,
    priceMarkupPercent: form.priceMarkupPercent.trim() === "" ? null : Number(form.priceMarkupPercent),
  };

  const fields: Array<[Exclude<keyof BotConfigForm, "sourceNotificationSyncEnabled" | "binancePayEnabled" | "okxPersonalApiEnabled" | "priceMarkupPercent">, string]> = [
    ["shopName", "shopName"],
    ["shopTagline", "shopTagline"],
    ["botToken", "botToken"],
    ["ownerTelegramUserId", "ownerTelegramUserId"],
    ["providerBaseUrl", "providerBaseUrl"],
    ["providerBuyerKey", "providerBuyerKey"],
    ["supportTelegram", "supportTelegram"],
    ["supportZalo", "supportZalo"],
    ["logoUrl", "logoUrl"],
    ["paymentProvider", "paymentProvider"],
    ["payosClientId", "payosClientId"],
    ["payosApiKey", "payosApiKey"],
    ["payosChecksumKey", "payosChecksumKey"],
    ["pay2sPartnerCode", "pay2sPartnerCode"],
    ["pay2sAccessKey", "pay2sAccessKey"],
    ["pay2sSecretKey", "pay2sSecretKey"],
    ["pay2sBankAccount", "pay2sBankAccount"],
    ["pay2sBankId", "pay2sBankId"],
    ["pay2sWebhookToken", "pay2sWebhookToken"],
    ["web2mAccountNumber", "web2mAccountNumber"],
    ["web2mBankCode", "web2mBankCode"],
    ["web2mPassword", "web2mPassword"],
    ["web2mToken", "web2mToken"],
    ["web2mAccessToken", "web2mAccessToken"],
    ["binanceUid", "binanceUid"],
    ["okxUid", "okxUid"],
    ["usdtTrc20Address", "usdtTrc20Address"],
    ["usdtSolanaAddress", "usdtSolanaAddress"],
    ["binancePersonalApiKey", "binancePersonalApiKey"],
    ["binancePersonalSecretKey", "binancePersonalSecretKey"],
    ["binancePayApiKey", "binancePayApiKey"],
    ["binancePaySecretKey", "binancePaySecretKey"],
    ["okxPersonalApiKey", "okxPersonalApiKey"],
    ["okxPersonalSecretKey", "okxPersonalSecretKey"],
    ["okxPersonalPassphrase", "okxPersonalPassphrase"],
    ["usdtBep20Address", "usdtBep20Address"],
  ];

  for (const [formKey, payloadKey] of fields) {
    payload[payloadKey] = normalizeOptionalValue(form[formKey] as string);
  }

  payload.binancePayEnabled = form.binancePayEnabled;
  payload.okxPersonalApiEnabled = form.okxPersonalApiEnabled;
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
    ownerTelegramUserId: "",
    providerBaseUrl: "https://canboso.com",
    providerBuyerKey: "",
    supportTelegram: "",
    supportZalo: "",
    logoUrl: "",
    sourceNotificationSyncEnabled: true,
    priceMarkupPercent: "",
    paymentProvider: "PAYOS",
    payosClientId: "",
    payosApiKey: "",
    payosChecksumKey: "",
    pay2sPartnerCode: "",
    pay2sAccessKey: "",
    pay2sSecretKey: "",
    pay2sBankAccount: "",
    pay2sBankId: "",
    pay2sWebhookToken: "",
    web2mAccountNumber: "",
    web2mBankCode: "",
    web2mPassword: "",
    web2mToken: "",
    web2mAccessToken: "",
    binanceUid: "",
    okxUid: "",
    usdtTrc20Address: "",
    usdtSolanaAddress: "",
    usdtVndRateOverride: "",
    binancePersonalApiKey: "",
    binancePersonalSecretKey: "",
    binancePayApiKey: "",
    binancePaySecretKey: "",
    binancePayEnabled: false,
    okxPersonalApiKey: "",
    okxPersonalSecretKey: "",
    okxPersonalPassphrase: "",
    okxPersonalApiEnabled: false,
    usdtBep20Address: "",
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
  const sellerTier = session?.user.sellerTier;
  const isUltra = sellerTier === "ultra";
  const isPro = sellerTier === "pro";
  const canUseSource = sellerTier === "pro" || sellerTier === "ultra";
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["bot-config"],
    queryFn: async () => (await api.get("/bot-config")).data,
  });
  const [form, setForm] = useState<BotConfigForm>(getInitialForm);
  const [simulationOutput, setSimulationOutput] = useState("");
  const [sourceKeyInput, setSourceKeyInput] = useState("");
  const [activeTab, setActiveTab] = useState<"shop" | "bot" | "payment" | "crypto" | "affiliate">("bot");
  const { showToast } = useToast();

  const sourceConnectionQuery = useQuery({
    queryKey: ["seller-source-connection"],
    queryFn: async () => (await api.get("/seller/source-connection")).data,
    enabled: canUseSource,
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
      ownerTelegramUserId: configQuery.data.ownerTelegramUserId || "",
      providerBaseUrl: configQuery.data.providerBaseUrl || "https://canboso.com",
      providerBuyerKey: "",
      supportTelegram: configQuery.data.supportTelegram || "",
      supportZalo: configQuery.data.supportZalo || "",
      logoUrl: configQuery.data.logoUrl || "",
      sourceNotificationSyncEnabled: configQuery.data.sourceNotificationSyncEnabled ?? true,
      priceMarkupPercent: configQuery.data.priceMarkupPercent != null ? String(configQuery.data.priceMarkupPercent) : "",
      paymentProvider: String((configQuery.data as any).paymentProvider || "PAYOS").toUpperCase(),
      payosClientId: "",
      payosApiKey: "",
      payosChecksumKey: "",
      pay2sPartnerCode: "",
      pay2sAccessKey: "",
      pay2sSecretKey: "",
      pay2sBankAccount: (configQuery.data as any).pay2sBankAccount || "",
      pay2sBankId: (configQuery.data as any).pay2sBankId || "",
      pay2sWebhookToken: "",
      web2mAccountNumber: (configQuery.data as any).web2mAccountNumber || "",
      web2mBankCode: (configQuery.data as any).web2mBankCode || "",
      web2mPassword: "",
      web2mToken: "",
      web2mAccessToken: "",
      binanceUid: configQuery.data.binanceUid || "",
      okxUid: configQuery.data.okxUid || "",
      usdtTrc20Address: configQuery.data.usdtTrc20Address || "",
      usdtSolanaAddress: (configQuery.data as any).usdtSolanaAddress || "",
      usdtVndRateOverride:
        configQuery.data.usdtVndRateOverride !== null && configQuery.data.usdtVndRateOverride !== undefined
          ? String(configQuery.data.usdtVndRateOverride)
          : "",
      binancePersonalApiKey: "",
      binancePersonalSecretKey: "",
      binancePayApiKey: "",
      binancePaySecretKey: "",
      binancePayEnabled: configQuery.data.binancePayEnabled ?? false,
      okxPersonalApiKey: "",
      okxPersonalSecretKey: "",
      okxPersonalPassphrase: "",
      okxPersonalApiEnabled: (configQuery.data as any).okxPersonalApiEnabled ?? false,
      usdtBep20Address: (configQuery.data as any).usdtBep20Address || "",
    });
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildBotConfigPayload(form);
      // The Source-key box is driven by `sourceKeyInput`, which can desync from
      // `form.providerBuyerKey` (the form re-seeds providerBuyerKey="" on every configQuery
      // refetch — e.g. window focus after copying the key from the canboso bot). Persist the
      // value actually shown in the box so a typed canboso buyer key isn't dropped on save.
      const sk = sourceKeyInput.trim();
      if (sk && !sk.startsWith("isk_")) payload.providerBuyerKey = sk;
      return api.put("/bot-config", payload);
    },
    onSuccess: async () => {
      showToast({ tone: "success", message: t.toastSaveSuccess });
      setSourceKeyInput("");
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
        // Switching to a canboso key disables the ULTRA connection server-side — refetch so the
        // Source-key box drops the "đổi key ULTRA" placeholder and shows the masked canboso key.
        queryClient.invalidateQueries({ queryKey: ["seller-source-connection"] }),
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

  const _ = simulationOutput; // suppress unused warning

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "rgb(249,115,22)" }}>{t.title}</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--tx-f)" }}>{t.eyebrow}</p>
        </div>
        <div className="flex items-center gap-2">
          {isUltra && (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black"
              style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", color: "rgb(167,139,250)" }}>
              ★ ULTRA · Tổng sỉ
            </span>
          )}
          <button type="button"
            onClick={async () => {
              if (!window.confirm("Reset bot về mặc định admin? Tất cả customize (welcome, label, emoji) sẽ bị xoá. Không reset product overrides.")) return;
              try {
                await api.post("/admin-template/reset", { alsoResetProductOverrides: false });
                showToast({ tone: "success", message: "Đã reset về mặc định admin." });
                queryClient.invalidateQueries({ queryKey: ["bot-config"] });
              } catch (err: any) {
                showToast({ tone: "error", message: err?.response?.data?.message || "Không reset được." });
              }
            }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
            ↻ Reset về mặc định
          </button>
          <button type="button" disabled={saveMutation.isPending}
            onClick={() => {
              const hasApiKey = form.binancePersonalApiKey.trim().length > 0;
              const hasSecretKey = form.binancePersonalSecretKey.trim().length > 0;
              if (hasApiKey !== hasSecretKey) { showToast({ tone: "error", message: t.errorBothKeys }); return; }
              saveMutation.mutate();
            }}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
            style={{ background: "rgb(249,115,22)", color: "#fff" }}>
            {saveMutation.isPending ? t.saving : t.saveAll}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: configQuery.data?.telegramWebhookStatus === "verified" ? "rgb(52,211,153)" : "rgb(248,113,113)" }} />
            <span className="text-[12px]" style={{ color: "var(--tx-f)" }}>Telegram</span>
            <span className="text-[12px] font-black" style={{ color: "var(--tx)" }}>
              {configQuery.data?.telegramBotUsername ? `@${configQuery.data.telegramBotUsername}` : t.telegramNotVerified}
            </span>
          </div>
          <div className="h-3 w-px" style={{ background: "var(--bd)" }} />
          <div className="flex items-center gap-1.5">
            {configQuery.data?.providerConnectionStatus === "verified"
              ? <span className="text-[12px] text-emerald-400 font-black">✓</span>
              : <span className="h-2 w-2 rounded-full bg-slate-500" />}
            <span className="text-[12px] font-black" style={{ color: "var(--tx)" }}>Nguồn</span>
          </div>
          <div className="h-3 w-px" style={{ background: "var(--bd)" }} />
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="text-[12px]" style={{ color: "var(--tx-f)" }}>Thanh toán</span>
            <span className="text-[12px] font-black" style={{ color: "var(--tx)" }}>
              {formatStatusLabel(configQuery.data?.paymentProvider) || "—"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={verifyTelegramMutation.isPending} onClick={() => verifyTelegramMutation.mutate()}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black transition hover:opacity-80 disabled:opacity-40"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}>
            <ScanSearch className="h-3.5 w-3.5" />
            {verifyTelegramMutation.isPending ? t.checkingTelegram : t.checkTelegram}
          </button>
          <button type="button" disabled={verifyProviderMutation.isPending} onClick={() => verifyProviderMutation.mutate()}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black transition hover:opacity-80 disabled:opacity-40"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}>
            <Cable className="h-3.5 w-3.5" />
            {verifyProviderMutation.isPending ? t.checkingSource : t.checkSource}
          </button>
          <button type="button" disabled={syncProductsMutation.isPending} onClick={() => syncProductsMutation.mutate()}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black transition hover:opacity-80 disabled:opacity-40"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}>
            <KeyRound className="h-3.5 w-3.5" />
            {syncProductsMutation.isPending ? t.syncing : t.syncProducts}
          </button>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 rounded-2xl p-1" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        {(["shop", "bot", "payment", "crypto", "affiliate"] as const).map((key) => {
          const label = { shop: "Shop", bot: "Bot & Nguồn", payment: "Thanh toán", crypto: "Crypto", affiliate: "Affiliate" }[key];
          const active = activeTab === key;
          return (
            <button key={key} type="button" onClick={() => setActiveTab(key)}
              className="relative flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-black transition"
              style={{ background: active ? "rgba(249,115,22,0.1)" : "transparent", color: active ? "rgb(249,115,22)" : "var(--tx-f)", border: active ? "1px solid rgba(249,115,22,0.25)" : "1px solid transparent" }}>
              {label}
              {key === "payment" && configQuery.data?.paymentProvider && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="rounded-2xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>

        {/* ── SHOP ── */}
        {activeTab === "shop" && (
          <div>
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(245,158,11,0.12)" }}>
                <Store className="h-4 w-4 text-amber-400" />
              </div>
              <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{t.cardShop}</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t.fieldShopName} hint="Required">
                <Input value={form.shopName} onChange={(e) => setForm((c) => ({ ...c, shopName: e.target.value }))} placeholder={t.phShopName} />
              </Field>
              <Field label="Logo URL" hint="Optional">
                <Input value={form.logoUrl} onChange={(e) => setForm((c) => ({ ...c, logoUrl: e.target.value }))} placeholder="https://..." />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t.fieldTagline} hint="Optional">
                  <Textarea className="min-h-[80px]" value={form.shopTagline} onChange={(e) => setForm((c) => ({ ...c, shopTagline: e.target.value }))} placeholder={t.phTagline} />
                </Field>
              </div>
              <Field label={t.fieldTelegramSupport}>
                <Input value={form.supportTelegram} onChange={(e) => setForm((c) => ({ ...c, supportTelegram: e.target.value }))} placeholder="@support_shop" />
              </Field>
              <Field label={t.fieldZaloSupport}>
                <Input value={form.supportZalo} onChange={(e) => setForm((c) => ({ ...c, supportZalo: e.target.value }))} placeholder={t.phZalo} />
              </Field>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}
                className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                {saveMutation.isPending ? t.saving : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        )}

        {/* ── BOT & NGUỒN ── */}
        {activeTab === "bot" && (
          <div>
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(56,189,248,0.12)" }}>
                <Bot className="h-4 w-4 text-sky-400" />
              </div>
              <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{t.cardBot}</h2>
            </div>
            <div className="grid gap-5">
              <Field label="BOT_TOKEN" hint={configQuery.data?.botTokenMasked ? "Đã mã hoá" : "Required"} description={t.fieldBotDesc}>
                <Input value={form.botToken} onChange={(e) => setForm((c) => ({ ...c, botToken: e.target.value }))} placeholder={configQuery.data?.botTokenMasked || t.phBotToken} />
              </Field>
              <Field label="OWNER_TELEGRAM_USER_ID" hint={configQuery.data?.ownerTelegramUserId ? "Đã lưu" : "Tùy chọn"} description={t.fieldOwnerTelegramDesc}>
                <Input value={form.ownerTelegramUserId} onChange={(e) => setForm((c) => ({ ...c, ownerTelegramUserId: e.target.value }))} placeholder={configQuery.data?.ownerTelegramUserId || t.phOwnerTelegramUserId} />
              </Field>
              {isUltra && (
                <div className="rounded-2xl px-4 py-4" style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}>
                  <p className="text-sm font-black" style={{ color: "rgb(196,181,253)" }}>{t.ultraTitle}</p>
                  <p className="mt-2 text-sm leading-6" style={{ color: "var(--tx-m)" }}>{t.ultraDesc}</p>
                </div>
              )}
              <Field label="Source key"
                hint={configQuery.data?.providerBuyerKeyMasked || sourceConnectionQuery.data?.status === "active" ? "Đã mã hoá" : isUltra ? "Optional" : "Required"}
                description={sourceConnectionQuery.data?.status === "active"
                  ? t.sourceConnectedDesc(sourceConnectionQuery.data.upstreamShop?.name ?? "", (sourceConnectionQuery.data.balance ?? 0).toLocaleString("vi-VN"))
                  : t.sourceKeyDesc}>
                <div className="flex gap-3">
                  <Input value={sourceKeyInput || form.providerBuyerKey}
                    onChange={(e) => { const val = e.target.value; setSourceKeyInput(val); if (!val.startsWith("isk_")) setForm((c) => ({ ...c, providerBuyerKey: val })); }}
                    placeholder={sourceConnectionQuery.data?.status === "active" ? t.phSourceConnected : configQuery.data?.providerBuyerKeyMasked || t.phSourceKey}
                    className="font-mono text-sm" />
                  {sourceKeyInput.trim().startsWith("isk_") && (
                    <Button type="button" onClick={() => connectSourceMutation.mutate(sourceKeyInput.trim())} disabled={connectSourceMutation.isPending}>
                      {connectSourceMutation.isPending ? t.connectingSource : sourceConnectionQuery.data?.status === "active" ? t.changeKey : t.connectKey}
                    </Button>
                  )}
                </div>
              </Field>
              <Field label={t.markupLabel} hint={t.markupDesc}>
                <Input type="number" min={0} max={500} step={0.1} value={form.priceMarkupPercent}
                  onChange={(e) => setForm((c) => ({ ...c, priceMarkupPercent: e.target.value }))} placeholder={t.markupPlaceholder} />
              </Field>
              <div className="flex flex-col gap-4 rounded-2xl px-4 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                <div>
                  <p className="font-semibold" style={{ color: "var(--tx)" }}>{t.notifSyncLabel}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--tx-f)" }}>{t.notifSyncDesc}</p>
                </div>
                <button type="button" role="switch" aria-checked={form.sourceNotificationSyncEnabled}
                  aria-busy={sourceNotificationSyncMutation.isPending} disabled={sourceNotificationSyncMutation.isPending}
                  onClick={toggleSourceNotificationSync}
                  className="inline-flex h-12 w-full shrink-0 items-center justify-between gap-3 rounded-2xl border px-3 text-sm font-semibold transition disabled:opacity-55 sm:w-[164px]"
                  style={form.sourceNotificationSyncEnabled
                    ? { borderColor: "rgba(249,115,22,0.3)", background: "rgba(249,115,22,0.08)", color: "var(--tx)" }
                    : { borderColor: "var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl transition"
                    style={form.sourceNotificationSyncEnabled ? { background: "rgb(249,115,22)", color: "white" } : { background: "var(--inp)", color: "var(--tx-f)" }}>
                    {form.sourceNotificationSyncEnabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  </span>
                  <span>{form.sourceNotificationSyncEnabled ? t.toggleOn : t.toggleOff}</span>
                </button>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}
                className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                {saveMutation.isPending ? t.saving : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        )}

        {/* ── THANH TOÁN ── */}
        {activeTab === "payment" && (
          <div>
            {/* Provider selector */}
            <div className="mb-6 rounded-2xl p-4" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
              <p className="mb-3 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Cổng thanh toán VNĐ</p>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {[
                  { key: "PAYOS", label: "PayOS", desc: "Nhanh, tin cậy. Phí cao." },
                  { key: "PAY2S", label: "Pay2s", desc: "Webhook. Phí thấp." },
                  { key: "WEB2M", label: "Web2m", desc: "Polling. Phí rẻ nhất." },
                ].map((opt) => {
                  const isSelected = form.paymentProvider === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setForm((c) => ({ ...c, paymentProvider: opt.key }))}
                      className="rounded-xl border-2 p-3 text-left transition"
                      style={{
                        borderColor: isSelected ? "rgb(249,115,22)" : "var(--bd)",
                        background: isSelected ? "rgba(249,115,22,0.08)" : "var(--surface)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-black" style={{ color: "var(--tx)" }}>{opt.label}</p>
                        {isSelected && <span className="text-xs font-bold text-orange-500">● ĐANG DÙNG</span>}
                      </div>
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {form.paymentProvider === "PAYOS" && (
            <>
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(99,102,241,0.12)" }}>
                <Wallet className="h-4 w-4 text-violet-400" />
              </div>
              <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>PayOS — VNĐ</h2>
            </div>
            <div className="mb-4 rounded-2xl px-4 py-3" style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.15)" }}>
              <p className="text-[12px]" style={{ color: "rgb(52,211,153)" }}>ⓘ {t.payosDesc}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Client ID" hint={configQuery.data?.payosClientIdMasked ? "Đã mã hoá" : "Optional"}>
                <Input value={form.payosClientId} onChange={(e) => setForm((c) => ({ ...c, payosClientId: e.target.value }))} placeholder={configQuery.data?.payosClientIdMasked || t.phClientId} />
              </Field>
              <Field label="API Key" hint={configQuery.data?.payosApiKeyMasked ? "Đã mã hoá" : "Optional"}>
                <Input value={form.payosApiKey} onChange={(e) => setForm((c) => ({ ...c, payosApiKey: e.target.value }))} placeholder={configQuery.data?.payosApiKeyMasked || t.phApiKey} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Checksum Key" hint={configQuery.data?.payosChecksumKeyMasked ? "Đã mã hoá" : "Optional"}>
                  <Input value={form.payosChecksumKey} onChange={(e) => setForm((c) => ({ ...c, payosChecksumKey: e.target.value }))} placeholder={configQuery.data?.payosChecksumKeyMasked || t.phChecksumKey} />
                </Field>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}
                className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                {saveMutation.isPending ? t.saving : "Lưu thay đổi"}
              </button>
            </div>
            </>
            )}

            {form.paymentProvider === "PAY2S" && (
            <div>
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(56,189,248,0.12)" }}>
                  <Wallet className="h-4 w-4 text-sky-400" />
                </div>
                <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Pay2s — VNĐ</h2>
              </div>
              <div className="mb-4 rounded-2xl px-4 py-3" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)" }}>
                <p className="text-[12px]" style={{ color: "rgb(56,189,248)" }}>ⓘ Nhập credentials Pay2s. Để dùng làm cổng thanh toán mặc định, đổi provider ở DB hoặc liên hệ admin.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Partner Code">
                  <Input value={form.pay2sPartnerCode} onChange={(e) => setForm((c) => ({ ...c, pay2sPartnerCode: e.target.value }))} placeholder={(configQuery.data as any)?.pay2sPartnerCodeMasked || "MOMOXXXX"} />
                </Field>
                <Field label="Access Key">
                  <Input value={form.pay2sAccessKey} onChange={(e) => setForm((c) => ({ ...c, pay2sAccessKey: e.target.value }))} placeholder={(configQuery.data as any)?.pay2sAccessKeyMasked || "AccessKey"} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Secret Key">
                    <Input value={form.pay2sSecretKey} onChange={(e) => setForm((c) => ({ ...c, pay2sSecretKey: e.target.value }))} placeholder={(configQuery.data as any)?.pay2sSecretKeyMasked || "SecretKey"} />
                  </Field>
                </div>
                <Field label="Số tài khoản ngân hàng">
                  <Input value={form.pay2sBankAccount} onChange={(e) => setForm((c) => ({ ...c, pay2sBankAccount: e.target.value }))} placeholder="9999000xxxx" />
                </Field>
                <Field label="Ngân hàng">
                  <select
                    value={form.pay2sBankId}
                    onChange={(e) => setForm((c) => ({ ...c, pay2sBankId: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                  >
                    <option value="">-- Chọn ngân hàng --</option>
                    <option value="VCB">Vietcombank (VCB)</option>
                    <option value="CTG">VietinBank (CTG)</option>
                    <option value="TCB">Techcombank (TCB)</option>
                    <option value="BIDV">BIDV</option>
                    <option value="ACB">ACB</option>
                    <option value="MBB">MBBank (MBB)</option>
                    <option value="TPB">TPBank (TPB)</option>
                    <option value="VPB">VPBank (VPB)</option>
                    <option value="STB">Sacombank (STB)</option>
                    <option value="AGRIBANK">Agribank</option>
                    <option value="VIB">VIB</option>
                    <option value="HDB">HDBank (HDB)</option>
                    <option value="MSB">MSB</option>
                    <option value="SHB">SHB</option>
                    <option value="OCB">OCB</option>
                    <option value="EIB">Eximbank (EIB)</option>
                    <option value="SCB">SCB</option>
                    <option value="NAB">Nam A Bank (NAB)</option>
                    <option value="SEAB">SeABank (SEAB)</option>
                    <option value="LPB">LPBank (LPB)</option>
                  </select>
                </Field>
                <Field label="Webhook Token (biến động số dư)">
                  <Input value={form.pay2sWebhookToken} onChange={(e) => setForm((c) => ({ ...c, pay2sWebhookToken: e.target.value }))} placeholder={(configQuery.data as any)?.pay2sWebhookTokenMasked || "Dán token webhook Pay2s"} />
                </Field>
              </div>
              <div className="mt-6 flex justify-end">
                <button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}
                  className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                  {saveMutation.isPending ? t.saving : "Lưu thay đổi"}
                </button>
              </div>
            </div>
            )}

            {form.paymentProvider === "WEB2M" && (
            <div>
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(245,158,11,0.12)" }}>
                  <Wallet className="h-4 w-4 text-amber-400" />
                </div>
                <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Web2m — VNĐ</h2>
              </div>
              <div className="mb-4 rounded-2xl px-4 py-3" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                <p className="text-[12px]" style={{ color: "rgb(245,158,11)" }}>ⓘ Tạo WebHook trên dashboard Web2m → URL: <code className="font-mono">https://api.altivoxai.com/api/v1/webhooks/web2m</code> → copy Access Token paste vào đây.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Số tài khoản" hint="STK đã đăng ký Web2m">
                  <Input value={form.web2mAccountNumber} onChange={(e) => setForm((c) => ({ ...c, web2mAccountNumber: e.target.value }))} placeholder="9999000xxxx" />
                </Field>
                <Field label="Ngân hàng" hint="Chọn bank Web2m hỗ trợ">
                  <select
                    value={form.web2mBankCode}
                    onChange={(e) => setForm((c) => ({ ...c, web2mBankCode: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
                  >
                    <option value="">-- Chọn ngân hàng --</option>
                    <option value="vcb">Vietcombank</option>
                    <option value="bidv">BIDV</option>
                    <option value="acb">ACB</option>
                    <option value="mb">MBBank</option>
                    <option value="tcb">Techcombank</option>
                    <option value="ctg">VietinBank</option>
                    <option value="tpb">TPBank</option>
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Access Token (Bearer)" hint={(configQuery.data as any)?.web2mAccessTokenMasked ? "Đã mã hoá" : "Copy từ webhook entry trên Web2m dashboard"}>
                    <Input value={form.web2mAccessToken} onChange={(e) => setForm((c) => ({ ...c, web2mAccessToken: e.target.value }))} placeholder={(configQuery.data as any)?.web2mAccessTokenMasked || "eyJ0eXAiOiJKV1QiLCJhbGciOiJ..."} />
                  </Field>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}
                  className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                  {saveMutation.isPending ? t.saving : "Lưu thay đổi"}
                </button>
              </div>
            </div>
            )}
          </div>
        )}

        {/* ── CRYPTO ── */}
        {activeTab === "crypto" && (
          <div>
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl text-amber-400 font-black text-sm" style={{ background: "rgba(245,158,11,0.12)" }}>$</div>
              <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>USDT / Crypto</h2>
            </div>
            <div className="mb-4 rounded-2xl px-4 py-3" style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.15)" }}>
              <p className="text-[12px]" style={{ color: "rgb(52,211,153)" }}>ⓘ {t.usdtDesc}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Binance UID" hint="Optional">
                <Input value={form.binanceUid} onChange={(e) => setForm((c) => ({ ...c, binanceUid: e.target.value }))} placeholder={t.phBinanceUid} />
              </Field>
              <Field label={t.fieldUsdtRate} hint="Optional" description={t.usdtRateDesc(configQuery.data?.defaultUsdtVndRate || 26000)}>
                <Input inputMode="decimal" value={form.usdtVndRateOverride} onChange={(e) => setForm((c) => ({ ...c, usdtVndRateOverride: e.target.value }))} placeholder={String(configQuery.data?.defaultUsdtVndRate || 26000)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t.fieldUsdtAddress} hint="Optional">
                  <Input value={form.usdtTrc20Address} onChange={(e) => setForm((c) => ({ ...c, usdtTrc20Address: e.target.value }))} placeholder={t.phUsdtAddress} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="USDT Solana Address" hint="Optional" description="Địa chỉ ví Solana nhận USDT (SPL). Bot sẽ tự dò giao dịch, không cần khách paste tx hash.">
                  <Input value={form.usdtSolanaAddress} onChange={(e) => setForm((c) => ({ ...c, usdtSolanaAddress: e.target.value }))} placeholder="Ví dụ: 7xKXtg2C...88 ký tự" />
                </Field>
              </div>
              <Field label="Personal API Key" hint={configQuery.data?.binancePersonalApiKeyMasked ? "Đã mã hoá" : "Optional"}>
                <Input value={form.binancePersonalApiKey} onChange={(e) => setForm((c) => ({ ...c, binancePersonalApiKey: e.target.value }))} placeholder={configQuery.data?.binancePersonalApiKeyMasked || t.phApiKey} />
              </Field>
              <Field label="Personal Secret Key" hint={configQuery.data?.binancePersonalSecretKeyMasked ? "Đã mã hoá" : "Optional"}>
                <Input value={form.binancePersonalSecretKey} onChange={(e) => setForm((c) => ({ ...c, binancePersonalSecretKey: e.target.value }))} placeholder={configQuery.data?.binancePersonalSecretKeyMasked || t.phApiKey} />
              </Field>
            </div>
            {/* Binance Pay Merchant — UI HIDDEN. Field giữ trong form state để không phá payload. */}
            {false && (
            <div className="mt-6" style={{ borderTop: "1px solid var(--bd)", paddingTop: 24 }}>
              <p className="mb-3 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Binance Pay Merchant (deprecated)</p>
            </div>
            )}

            <div className="mt-6" style={{ borderTop: "1px solid var(--bd)", paddingTop: 24 }}>
              <div className="mb-3 flex items-center gap-2">
                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>OKX Personal API</p>
                <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "rgba(56,189,248,0.12)", color: "rgb(56,189,248)" }}>Auto-detect USDT</span>
              </div>
              <p className="mb-3 text-[12px]" style={{ color: "var(--tx-f)" }}>
                Cấp Read-only API ở OKX (Funding → API). Bot sẽ tự dò deposit khi khách chuyển USDT (TRC20 / BEP20 / Solana).
              </p>
              <div className="mb-4 flex flex-col gap-4 rounded-2xl px-4 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                <div>
                  <p className="font-semibold" style={{ color: "var(--tx)" }}>Bật auto-detect OKX</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--tx-f)" }}>Khi bật, khách chọn OKX → bot sẽ check deposit history để verify.</p>
                </div>
                <button type="button" role="switch" aria-checked={form.okxPersonalApiEnabled}
                  onClick={() => setForm((c) => ({ ...c, okxPersonalApiEnabled: !c.okxPersonalApiEnabled }))}
                  className="inline-flex h-12 w-full shrink-0 items-center justify-between gap-3 rounded-2xl border px-3 text-sm font-semibold transition sm:w-[164px]"
                  style={form.okxPersonalApiEnabled
                    ? { borderColor: "rgba(56,189,248,0.3)", background: "rgba(56,189,248,0.08)", color: "var(--tx)" }
                    : { borderColor: "var(--bd)", background: "var(--surface)", color: "var(--tx-m)" }}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl transition"
                    style={form.okxPersonalApiEnabled ? { background: "rgb(56,189,248)", color: "white" } : { background: "var(--inp)", color: "var(--tx-f)" }}>⚪</span>
                  <span>{form.okxPersonalApiEnabled ? t.toggleOn : t.toggleOff}</span>
                </button>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="OKX UID" hint="Optional">
                  <Input value={form.okxUid} onChange={(e) => setForm((c) => ({ ...c, okxUid: e.target.value }))} placeholder="VD: 12345678" />
                </Field>
                <Field label="USDT BEP20 Address" hint="Optional">
                  <Input value={form.usdtBep20Address} onChange={(e) => setForm((c) => ({ ...c, usdtBep20Address: e.target.value }))} placeholder="0x..." />
                </Field>
                <Field label="OKX API Key" hint={(configQuery.data as any)?.okxPersonalApiKeyMasked ? "Đã mã hoá" : "Optional"}>
                  <Input value={form.okxPersonalApiKey} onChange={(e) => setForm((c) => ({ ...c, okxPersonalApiKey: e.target.value }))} placeholder={(configQuery.data as any)?.okxPersonalApiKeyMasked || t.phApiKey} />
                </Field>
                <Field label="OKX Secret Key" hint={(configQuery.data as any)?.okxPersonalSecretKeyMasked ? "Đã mã hoá" : "Optional"}>
                  <Input value={form.okxPersonalSecretKey} onChange={(e) => setForm((c) => ({ ...c, okxPersonalSecretKey: e.target.value }))} placeholder={(configQuery.data as any)?.okxPersonalSecretKeyMasked || t.phApiKey} />
                </Field>
                <Field label="OKX Passphrase" hint={(configQuery.data as any)?.okxPersonalPassphraseMasked ? "Đã mã hoá" : "Optional"} description="Passphrase do anh đặt khi tạo OKX API.">
                  <Input value={form.okxPersonalPassphrase} onChange={(e) => setForm((c) => ({ ...c, okxPersonalPassphrase: e.target.value }))} placeholder={(configQuery.data as any)?.okxPersonalPassphraseMasked || "•••••••"} />
                </Field>
                <div className="flex items-end">
                  <button type="button"
                    onClick={async () => {
                      try {
                        const res = await api.post("/bot-config/verify-okx-personal", {
                          apiKey: form.okxPersonalApiKey || undefined,
                          secretKey: form.okxPersonalSecretKey || undefined,
                          passphrase: form.okxPersonalPassphrase || undefined,
                        });
                        showToast({ tone: "success", message: `OKX OK — UID ${res.data?.uid || "(none)"}` });
                      } catch (e) {
                        showToast({ tone: "error", message: getApiErrorMessage(e, "Kết nối OKX thất bại.") });
                      }
                    }}
                    className="rounded-xl px-4 py-2.5 text-[12px] font-black transition hover:opacity-90"
                    style={{ background: "rgb(56,189,248)", color: "#fff" }}>
                    🧪 Kiểm tra kết nối
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}
                className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                {saveMutation.isPending ? t.saving : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        )}

        {/* ── AFFILIATE ── */}
        {activeTab === "affiliate" && (
          <div>
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(249,115,22,0.12)" }}>
                <Handshake className="h-4 w-4 text-orange-400" />
              </div>
              <h2 className="text-base font-black" style={{ color: "var(--tx)" }}>{t.cardAffiliate}</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <button type="button" onClick={() => setAffiliateForm((f) => ({ ...f, enabled: !f.enabled }))}
                className="flex items-center justify-between rounded-2xl px-4 py-3 transition-all"
                style={{ background: affiliateForm.enabled ? "rgba(249,115,22,0.08)" : "var(--inp)", border: `1px solid ${affiliateForm.enabled ? "rgba(249,115,22,0.4)" : "var(--bd)"}` }}>
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl text-sm transition-all"
                    style={{ background: affiliateForm.enabled ? "rgb(249,115,22)" : "var(--surface)", color: affiliateForm.enabled ? "white" : "var(--tx-f)" }}>
                    {affiliateForm.enabled ? "✓" : "○"}
                  </span>
                  <div className="text-left">
                    <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{affiliateForm.enabled ? t.affiliateActive : t.affiliateInactive}</p>
                    <p className="text-xs" style={{ color: "var(--tx-f)" }}>{t.affiliateToggleHint}</p>
                  </div>
                </div>
                <div className="h-5 w-9 rounded-full transition-all" style={{ background: affiliateForm.enabled ? "rgb(249,115,22)" : "var(--bd)" }}>
                  <div className="m-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ transform: affiliateForm.enabled ? "translateX(16px)" : "translateX(0)" }} />
                </div>
              </button>
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                <span className="text-sm font-medium" style={{ color: "var(--tx-f)" }}>{t.affiliateCommission}</span>
                <Input type="number" min={0} max={100} step={0.5} value={affiliateForm.commissionPct}
                  onChange={(e) => setAffiliateForm((f) => ({ ...f, commissionPct: e.target.value }))} className="w-20 text-center" />
                <span className="text-sm font-bold" style={{ color: "rgb(249,115,22)" }}>%</span>
              </div>
              <div className="sm:col-span-2">
                <Field label={t.affiliateProgramLabel} hint={t.affiliateProgramHint}>
                  <Textarea value={affiliateForm.programText} onChange={(e) => setAffiliateForm((f) => ({ ...f, programText: e.target.value }))}
                    placeholder={t.affiliateProgramPh(affiliateForm.commissionPct)} rows={3} />
                </Field>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" disabled={affiliateMutation.isPending} onClick={() => affiliateMutation.mutate()}
                className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                {affiliateMutation.isPending ? t.affiliateSaving : t.affiliateSave}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
