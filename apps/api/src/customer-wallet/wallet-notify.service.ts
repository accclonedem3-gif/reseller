import { Inject, Injectable } from "@nestjs/common";
import { decryptSecret, isMockBotToken, telegramSendMessage } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { formatCurrency } from "../lib/utils";

type WalletChangeType =
  | "AFFILIATE_COMMISSION"
  | "REFUND_ORDER"
  | "ADJUST"
  | "TOPUP"
  | "SPEND_ORDER";

type BotLanguage = "vi" | "en" | "th";

/**
 * Best-effort Telegram notification to a bot customer when their bot wallet
 * (CustomerWallet) changes — commission earned/clawed back, admin adjustment, etc.
 * Standalone (Prisma + config only) so it can be injected anywhere without DI cycles.
 */
@Injectable()
export class WalletNotifyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async notifyCustomerWalletChange(
    customerId: string,
    change: {
      type: WalletChangeType;
      amount: number;
      balanceAfter?: number | null;
      commissionBalanceAfter?: number | null;
    },
  ): Promise<void> {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          telegramChatId: true,
          preferredLanguage: true,
          shop: { select: { botConfig: { select: { telegramBotTokenEncrypted: true } } } },
        },
      });
      const chatId = customer?.telegramChatId;
      const enc = customer?.shop?.botConfig?.telegramBotTokenEncrypted;
      if (!chatId || !enc) return;

      const token = decryptSecret(enc, this.config.encryptionKey);
      if (!token || isMockBotToken(token)) return;

      const raw = String(customer?.preferredLanguage || "vi").toLowerCase();
      const lang: BotLanguage = raw === "en" ? "en" : raw === "th" ? "th" : "vi";
      await telegramSendMessage(token, chatId, this.buildText(change, lang), {
        parse_mode: "HTML",
      }).catch(() => undefined);
    } catch {
      // notify is best-effort — never block the wallet mutation
    }
  }

  private buildText(
    change: { type: WalletChangeType; amount: number; balanceAfter?: number | null; commissionBalanceAfter?: number | null },
    lang: BotLanguage,
  ): string {
    const heads: Record<WalletChangeType, Record<BotLanguage, string>> = {
      AFFILIATE_COMMISSION: { vi: "🎁 Bạn vừa nhận hoa hồng", en: "🎁 You earned a commission", th: "🎁 คุณได้รับค่าคอมมิชชั่น" },
      REFUND_ORDER: { vi: "↩️ Hoa hồng bị thu hồi (đơn hoàn/hủy)", en: "↩️ Commission clawed back (order refunded)", th: "↩️ ค่าคอมถูกเรียกคืน" },
      ADJUST: { vi: "⚙️ Số dư ví được điều chỉnh", en: "⚙️ Your wallet balance was adjusted", th: "⚙️ ยอดกระเป๋าเงินถูกปรับ" },
      TOPUP: { vi: "🟢 Nạp ví thành công", en: "🟢 Top-up successful", th: "🟢 เติมเงินสำเร็จ" },
      SPEND_ORDER: { vi: "🛒 Đã trừ tiền mua hàng", en: "🛒 Purchase charged", th: "🛒 หักเงินซื้อสินค้า" },
    };
    const sign = change.amount >= 0 ? "+" : "−";
    const head = heads[change.type][lang];
    const lines: string[] = [`${head}: <b>${sign}${formatCurrency(Math.abs(change.amount))}</b>`];
    if (change.commissionBalanceAfter != null) {
      lines.push(
        (lang === "en" ? "Commission balance: " : lang === "th" ? "ยอดค่าคอม: " : "Số dư hoa hồng: ") +
          formatCurrency(change.commissionBalanceAfter),
      );
    }
    if (change.balanceAfter != null) {
      lines.push(
        (lang === "en" ? "Wallet balance: " : lang === "th" ? "ยอดกระเป๋าเงิน: " : "Số dư ví: ") +
          formatCurrency(change.balanceAfter),
      );
    }
    return lines.join("\n");
  }
}
