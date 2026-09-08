import { SellerTier } from "@prisma/client";

export const PRO_COMMANDS = [
  { command: "start", description: "Trang chủ" },
  { command: "home", description: "Trang chủ" },
  { command: "products", description: "Xem sản phẩm" },
  { command: "orders", description: "Lịch sử đơn hàng" },
  { command: "wallet", description: "Xem số dư ví" },
  { command: "help", description: "Hướng dẫn mua hàng" },
  { command: "support", description: "Thông tin hỗ trợ" },
];

export const ULTRA_COMMANDS = [
  ...PRO_COMMANDS,
  { command: "warranty", description: "Yêu cầu bảo hành" },
  { command: "api", description: "Quản lý API key" },
];

export function commandsForTier(tier: SellerTier | null | undefined) {
  return tier === SellerTier.PRO || tier === SellerTier.ULTRA ? ULTRA_COMMANDS : PRO_COMMANDS;
}
