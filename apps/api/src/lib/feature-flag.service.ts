import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";

export type FeatureFlagKey =
  | "orders"
  | "wallet_topups"
  | "tier_purchases"
  | "withdrawals"
  | "affiliate_commissions"
  | "payment_bank"
  | "payment_trc20"
  | "payment_bep20"
  | "payment_solana"
  | "payment_ton";

export const FEATURE_DEFINITIONS: Array<{
  key: FeatureFlagKey;
  name: string;
  description: string;
  group: "commerce" | "payments" | "finance";
  impact: string;
  critical?: boolean;
}> = [
  { key: "orders", name: "Nhận đơn hàng mới", description: "Cho phép khách tạo đơn mới từ bot.", group: "commerce", impact: "Không ảnh hưởng đơn đã thanh toán.", critical: true },
  { key: "wallet_topups", name: "Tạo lệnh nạp ví", description: "Cho phép khách tạo yêu cầu nạp ví mới.", group: "commerce", impact: "Worker vẫn đối soát lệnh đã tạo.", critical: true },
  { key: "tier_purchases", name: "Mua và gia hạn gói", description: "Cho phép user mua PRO/ULTRA hoặc gia hạn.", group: "commerce", impact: "Không ảnh hưởng gói đang hoạt động." },
  { key: "affiliate_commissions", name: "Đơn gói có hoa hồng", description: "Cho phép tạo đơn mua gói có người giới thiệu.", group: "finance", impact: "Giao dịch cũ vẫn hoàn tất và được ghi nhận hoa hồng.", critical: true },
  { key: "withdrawals", name: "Tạo yêu cầu rút tiền", description: "Cho phép user gửi yêu cầu rút tiền mới.", group: "finance", impact: "Yêu cầu đang chờ vẫn được giữ nguyên." },
  { key: "payment_bank", name: "Thanh toán ngân hàng", description: "Tạo QR/chuyển khoản ngân hàng mới.", group: "payments", impact: "Webhook vẫn nhận tiền cho giao dịch cũ." },
  { key: "payment_trc20", name: "USDT TRC20", description: "Tạo và tự động xác nhận USDT trên mạng TRON.", group: "payments", impact: "Dừng tạo mới và dừng worker xác nhận giao dịch TRC20 cũ." },
  { key: "payment_bep20", name: "USDT BEP20", description: "Tạo và tự động xác nhận USDT trên BNB Smart Chain.", group: "payments", impact: "Dừng tạo mới, webhook và worker xác nhận giao dịch BEP20 cũ." },
  { key: "payment_solana", name: "USDT Solana", description: "Tạo và tự động xác nhận USDT trên Solana.", group: "payments", impact: "Dừng tạo mới và dừng worker xác nhận giao dịch Solana cũ." },
  { key: "payment_ton", name: "USDT TON", description: "Tạo và tự động xác nhận USDT trên TON.", group: "payments", impact: "Dừng tạo mới và dừng worker xác nhận giao dịch TON cũ." },
];

@Injectable()
export class FeatureFlagService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async assertEnabled(key: FeatureFlagKey, fallbackMessage?: string): Promise<void> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: [`feature.${key}.enabled`, `feature.${key}.message`] } },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    if (values.get(`feature.${key}.enabled`) === "false") {
      throw new ServiceUnavailableException(
        values.get(`feature.${key}.message`)?.trim() || fallbackMessage || "Chức năng đang bảo trì. Vui lòng thử lại sau.",
      );
    }
  }

  async list() {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: "feature." } },
      select: { key: true, value: true, updatedAt: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const updated = new Map(rows.map((row) => [row.key, row.updatedAt]));
    return FEATURE_DEFINITIONS.map((definition) => ({
      ...definition,
      enabled: values.get(`feature.${definition.key}.enabled`) !== "false",
      message: values.get(`feature.${definition.key}.message`) || "Chức năng đang bảo trì. Vui lòng thử lại sau.",
      updatedAt: updated.get(`feature.${definition.key}.enabled`) || null,
    }));
  }
}
