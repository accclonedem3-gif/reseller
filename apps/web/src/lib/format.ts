export function formatCurrency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(value || 0);
}

export function formatDate(value?: string | Date | null) {
  if (!value) {
    return "-";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export type StatusLang = "vi" | "en" | "th";

// Lang-aware enum→label maps. en/th added so non-Vietnamese sellers don't see Vietnamese pills
// (BUG-5). Unmapped keys fall back to a humanized enum (e.g. "pending review"), never to Vietnamese.
const enumLabelMap: Record<StatusLang, Record<string, string>> = {
  vi: {
    super_admin: "Quản trị hệ thống", seller: "Seller", free: "FREE", pro: "PRO", ultra: "ULTRA",
    disabled: "Đã tắt", pending: "Đang chờ", active: "Đang hoạt động", verified: "Đã xác minh",
    failed: "Thất bại", processing: "Đang xử lý", polling: "Polling", webhook: "Webhook",
    draft: "Nháp", suspended: "Tạm khóa", awaiting_payment: "Chờ thanh toán", paid: "Đã thanh toán",
    processing_purchase: "Đang mua nguồn", delivered: "Đã giao", paid_waiting_stock: "Chờ có hàng",
    refunded: "Đã hoàn tiền", unpaid: "Chưa thanh toán", topup: "Nạp tiền",
    debit_purchase: "Trừ tiền mua nguồn", refund_purchase: "Hoàn tiền mua nguồn", withdraw: "Rút tiền",
    adjust: "Điều chỉnh số dư", withdraw_reject_refund: "Hoàn tiền lệnh rút", confirmed: "Đã xác nhận",
    approved: "Đã duyệt", rejected: "Từ chối", queued: "Đang xếp hàng", sending: "Đang gửi",
    completed: "Hoàn tất", sent: "Đã gửi", canceled: "Đã hủy", cancelled: "Đã hủy", revoked: "Đã thu hồi",
    auto_resolved: "Tự xử lý xong", pending_stock: "Chờ có hàng bảo hành", pending_review: "Chờ duyệt thủ công",
    pending_manual: "Chờ xử lý thủ công", resolved_manual: "Đã xử lý thủ công", telegram_only: "Chỉ Telegram",
    hybrid: "Telegram + Web", web_only: "Chỉ Web", payos: "PayOS", pay2s: "Pay2s", web2m: "Web2m",
    binance: "Binance", okx: "OKX", binance_pay: "Binance Pay", usdt_trc20: "USDT (TRC20)", mock: "Mô phỏng",
  },
  en: {
    super_admin: "System Admin", seller: "Seller", free: "FREE", pro: "PRO", ultra: "ULTRA",
    disabled: "Disabled", pending: "Pending", active: "Active", verified: "Verified",
    failed: "Failed", processing: "Processing", polling: "Polling", webhook: "Webhook",
    draft: "Draft", suspended: "Suspended", awaiting_payment: "Awaiting payment", paid: "Paid",
    processing_purchase: "Sourcing", delivered: "Delivered", paid_waiting_stock: "Awaiting stock",
    refunded: "Refunded", unpaid: "Unpaid", topup: "Top-up",
    debit_purchase: "Source charge", refund_purchase: "Source refund", withdraw: "Withdraw",
    adjust: "Balance adjust", withdraw_reject_refund: "Withdraw refund", confirmed: "Confirmed",
    approved: "Approved", rejected: "Rejected", queued: "Queued", sending: "Sending",
    completed: "Completed", sent: "Sent", canceled: "Canceled", cancelled: "Canceled", revoked: "Revoked",
    auto_resolved: "Auto-resolved", pending_stock: "Awaiting replacement stock", pending_review: "Pending review",
    pending_manual: "Pending manual", resolved_manual: "Resolved manually", telegram_only: "Telegram only",
    hybrid: "Telegram + Web", web_only: "Web only", payos: "PayOS", pay2s: "Pay2s", web2m: "Web2m",
    binance: "Binance", okx: "OKX", binance_pay: "Binance Pay", usdt_trc20: "USDT (TRC20)", mock: "Mock",
  },
  th: {
    super_admin: "ผู้ดูแลระบบ", seller: "ผู้ขาย", free: "FREE", pro: "PRO", ultra: "ULTRA",
    disabled: "ปิดใช้งาน", pending: "รอดำเนินการ", active: "ใช้งานอยู่", verified: "ยืนยันแล้ว",
    failed: "ล้มเหลว", processing: "กำลังดำเนินการ", polling: "Polling", webhook: "Webhook",
    draft: "ฉบับร่าง", suspended: "ระงับชั่วคราว", awaiting_payment: "รอชำระเงิน", paid: "ชำระแล้ว",
    processing_purchase: "กำลังจัดหา", delivered: "จัดส่งแล้ว", paid_waiting_stock: "รอสินค้า",
    refunded: "คืนเงินแล้ว", unpaid: "ยังไม่ชำระ", topup: "เติมเงิน",
    debit_purchase: "หักค่าจัดหา", refund_purchase: "คืนค่าจัดหา", withdraw: "ถอนเงิน",
    adjust: "ปรับยอดเงิน", withdraw_reject_refund: "คืนเงินคำสั่งถอน", confirmed: "ยืนยันแล้ว",
    approved: "อนุมัติแล้ว", rejected: "ปฏิเสธ", queued: "อยู่ในคิว", sending: "กำลังส่ง",
    completed: "เสร็จสิ้น", sent: "ส่งแล้ว", canceled: "ยกเลิกแล้ว", cancelled: "ยกเลิกแล้ว", revoked: "เพิกถอนแล้ว",
    auto_resolved: "แก้ไขอัตโนมัติ", pending_stock: "รอสินค้าทดแทน", pending_review: "รอตรวจสอบ",
    pending_manual: "รอจัดการเอง", resolved_manual: "จัดการเองแล้ว", telegram_only: "Telegram เท่านั้น",
    hybrid: "Telegram + เว็บ", web_only: "เว็บเท่านั้น", payos: "PayOS", pay2s: "Pay2s", web2m: "Web2m",
    binance: "Binance", okx: "OKX", binance_pay: "Binance Pay", usdt_trc20: "USDT (TRC20)", mock: "จำลอง",
  },
};

function normalizeEnumValue(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function fallbackLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatStatusLabel(value?: string | null, lang: StatusLang = "vi") {
  if (!value) {
    return "-";
  }

  const normalized = normalizeEnumValue(value);
  const map = enumLabelMap[lang] || enumLabelMap.vi;
  // No translation for this lang → humanized enum (never leak Vietnamese to en/th users).
  return map[normalized] || fallbackLabel(value);
}

export function formatRoleLabel(value?: string | null, lang: StatusLang = "vi") {
  return formatStatusLabel(value, lang);
}
