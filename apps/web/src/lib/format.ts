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

const enumLabelMap: Record<string, string> = {
  super_admin: "Quản trị hệ thống",
  seller: "Seller",
  free: "FREE",
  pro: "PRO",
  ultra: "ULTRA",
  disabled: "Đã tắt",
  pending: "Đang chờ",
  active: "Đang hoạt động",
  verified: "Đã xác minh",
  failed: "Thất bại",
  processing: "Đang xử lý",
  polling: "Polling",
  webhook: "Webhook",
  draft: "Nháp",
  suspended: "Tạm khóa",
  awaiting_payment: "Chờ thanh toán",
  paid: "Đã thanh toán",
  processing_purchase: "Đang mua nguồn",
  delivered: "Đã giao",
  paid_waiting_stock: "Chờ có hàng",
  refunded: "Đã hoàn tiền",
  unpaid: "Chưa thanh toán",
  topup: "Nạp tiền",
  debit_purchase: "Trừ tiền mua nguồn",
  refund_purchase: "Hoàn tiền mua nguồn",
  withdraw: "Rút tiền",
  adjust: "Điều chỉnh số dư",
  withdraw_reject_refund: "Hoàn tiền lệnh rút",
  confirmed: "Đã xác nhận",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  queued: "Đang xếp hàng",
  sending: "Đang gửi",
  completed: "Hoàn tất",
  sent: "Đã gửi",
  canceled: "Đã hủy",
  cancelled: "Đã hủy",
  revoked: "Đã thu hồi",
  auto_resolved: "Tự xử lý xong",
  pending_stock: "Chờ có hàng bảo hành",
  pending_review: "Chờ duyệt thủ công",
  pending_manual: "Chờ xử lý thủ công",
  resolved_manual: "Đã xử lý thủ công",
  telegram_only: "Chỉ Telegram",
  hybrid: "Telegram + Web",
  web_only: "Chỉ Web",
  payos: "PayOS",
  binance: "Binance",
  okx: "OKX",
  binance_pay: "Binance Pay",
  usdt_trc20: "USDT (TRC20)",
  mock: "Mô phỏng",
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

export function formatStatusLabel(value?: string | null) {
  if (!value) {
    return "-";
  }

  const normalized = normalizeEnumValue(value);
  return enumLabelMap[normalized] || fallbackLabel(value);
}

export function formatRoleLabel(value?: string | null) {
  return formatStatusLabel(value);
}
