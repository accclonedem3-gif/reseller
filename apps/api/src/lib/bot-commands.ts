import { SellerTier } from "@prisma/client";

export const PRO_COMMANDS = [
  { command: "start", description: "Trang chủ" },
  { command: "home", description: "Trang chủ" },
  { command: "products", description: "Xem sản phẩm" },
  { command: "help", description: "Hướng dẫn mua hàng" },
  { command: "support", description: "Thông tin hỗ trợ" },
];

export const ULTRA_COMMANDS = [
  ...PRO_COMMANDS,
  { command: "warranty", description: "Yêu cầu bảo hành" },
  { command: "api", description: "Quản lý API key" },
];

export function commandsForTier(tier: SellerTier | null | undefined) {
  return tier === SellerTier.ULTRA ? ULTRA_COMMANDS : PRO_COMMANDS;
}
