import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  decryptSecret,
  isMockBotToken,
  telegramSendMessage,
} from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";

const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class StockAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockAlertService.name);
  private scanInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  onModuleInit() {
    this.scanInterval = setInterval(() => void this.scanAll(), SCAN_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  async checkAndAlert(sourceProductId: string): Promise<void> {
    try {
      const product = await this.prisma.sourceProduct.findUnique({
        where: { id: sourceProductId },
        include: { shop: { include: { botConfig: true } } },
      });

      if (!product || !product.stockAlertEnabled || product.available === null) return;
      if (product.available > product.stockAlertThreshold) return;

      const now = new Date();
      if (
        product.lastStockAlertAt &&
        now.getTime() - product.lastStockAlertAt.getTime() < ALERT_COOLDOWN_MS
      ) {
        return;
      }

      await this.prisma.sourceProduct.update({
        where: { id: product.id },
        data: { lastStockAlertAt: now },
      });

      await this.sendTelegramAlert(product.shop, product.sourceName, product.available);
    } catch (err) {
      this.logger.error(`checkAndAlert failed for product ${sourceProductId}:`, err);
    }
  }

  async scanAll(): Promise<void> {
    try {
      const products = await this.prisma.sourceProduct.findMany({
        where: {
          stockAlertEnabled: true,
          internalSourceEnabled: true,
          available: { not: null },
        },
        include: { shop: { include: { botConfig: true } } },
      });

      const now = new Date();
      for (const product of products) {
        if (product.available === null) continue;
        if (product.available > product.stockAlertThreshold) continue;
        if (
          product.lastStockAlertAt &&
          now.getTime() - product.lastStockAlertAt.getTime() < ALERT_COOLDOWN_MS
        ) {
          continue;
        }

        await this.prisma.sourceProduct.update({
          where: { id: product.id },
          data: { lastStockAlertAt: now },
        });

        await this.sendTelegramAlert(product.shop, product.sourceName, product.available);
      }
    } catch (err) {
      this.logger.error("scanAll failed:", err);
    }
  }

  private async sendTelegramAlert(
    shop: {
      id: string;
      supportTelegram: string | null;
      botConfig: { telegramBotTokenEncrypted: string } | null;
    },
    productName: string,
    available: number,
  ): Promise<void> {
    if (!shop.botConfig) return;

    const botToken = decryptSecret(
      shop.botConfig.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );
    if (!botToken || isMockBotToken(botToken)) return;

    // Only send to numeric chat IDs (user ID or group/channel ID)
    const rawChat = String(shop.supportTelegram || "").trim();
    if (!rawChat || !/^-?\d+$/.test(rawChat)) {
      this.logger.warn(
        `Stock alert for "${productName}" (shop ${shop.id}): ` +
          `supportTelegram is not a numeric chat ID — skipping Telegram notification`,
      );
      return;
    }

    const dashboardUrl = `${this.config.webPublicUrl}/source-network`;
    const text =
      `⚠️ *Kho sắp hết hàng*\n\n` +
      `Sản phẩm: *${productName}*\n` +
      `Còn lại: *${available}* account\n\n` +
      `→ Nhập thêm kho ngay để tránh gián đoạn đơn hàng PRO`;

    try {
      await telegramSendMessage(botToken, rawChat, text, {
        parse_mode: "Markdown",
        reply_markup: JSON.stringify({
          inline_keyboard: [
            [{ text: "📦 Nhập kho ngay", url: dashboardUrl }],
          ],
        }),
      });
    } catch (err) {
      this.logger.error(`Telegram alert failed for "${productName}":`, err);
    }
  }
}
