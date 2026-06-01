import { createHmac } from "crypto";
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decryptSecret } from "@reseller/shared/server";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";

export interface BotCustomization {
  welcomeMessage?: { vi?: string; en?: string; th?: string };
  footerBill?: { vi?: string; en?: string; th?: string };
  productNote?: { vi?: string; en?: string; th?: string };
  catalogText?: { vi?: string; en?: string; th?: string };
  homeFooter?: { vi?: string; en?: string; th?: string };
  homeIcon?: string;
  messageEmojiIds?: { welcomeMessage?: string; productNote?: string; footerBill?: string };
  labelEmojiIds?: { price?: string; stock?: string; sold?: string; format?: string; description?: string };
  outOfStockEmojiId?: string;
  showOutOfStock?: boolean;
  buttonEmojis?: Record<string, string>;
  buttonEmojiIds?: Record<string, string>;
  buttonLabels?: Record<string, { vi?: string; en?: string; th?: string }>;
}

@Injectable()
export class MiniAppService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  // Verify Telegram WebApp initData using HMAC-SHA256
  verifyInitData(initData: string, botToken: string): { userId: string; username?: string } {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) throw new UnauthorizedException("Missing hash.");

    const checkString = [...params.entries()]
      .filter(([k]) => k !== "hash")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const expectedHash = createHmac("sha256", secretKey).update(checkString).digest("hex");
    if (expectedHash !== hash) throw new UnauthorizedException("Invalid initData.");

    // Replay window: reject initData older than 24h so a captured payload can't be reused
    // indefinitely. Telegram stamps auth_date (unix seconds) inside the signed payload.
    const authDate = Number(params.get("auth_date"));
    if (!authDate || Date.now() / 1000 - authDate > 86400) {
      throw new UnauthorizedException("initData expired. Please reopen the app.");
    }

    const userData = JSON.parse(params.get("user") ?? "{}");
    if (!userData?.id) throw new UnauthorizedException("Missing user in initData.");
    return { userId: String(userData.id), username: userData.username };
  }

  // Find shop by verifying initData against all bot tokens where ownerTelegramUserId is set
  async resolveShopFromInitData(initData: string): Promise<{ shopId: string; customization: BotCustomization; isGlobalDefault: boolean; isSuperAdmin: boolean }> {
    const configs = await this.prisma.botConfig.findMany({
      where: { ownerTelegramUserId: { not: null } },
      select: {
        shopId: true,
        ownerTelegramUserId: true,
        telegramBotTokenEncrypted: true,
        customizationJson: true,
        isGlobalDefault: true,
        shop: { select: { seller: { select: { user: { select: { role: true } } } } } },
      },
    });

    for (const cfg of configs) {
      const token = decryptSecret(cfg.telegramBotTokenEncrypted, this.config.encryptionKey);
      if (!token) continue;
      try {
        const { userId } = this.verifyInitData(initData, token);
        if (userId === cfg.ownerTelegramUserId) {
          return {
            shopId: cfg.shopId,
            customization: (cfg.customizationJson as BotCustomization) ?? {},
            isGlobalDefault: cfg.isGlobalDefault,
            isSuperAdmin: cfg.shop?.seller?.user?.role === "SUPER_ADMIN",
          };
        }
      } catch {
        continue;
      }
    }
    throw new UnauthorizedException("No shop found for this account.");
  }

  async getSettings(initData: string) {
    return this.resolveShopFromInitData(initData);
  }

  async saveSettings(initData: string, customization: BotCustomization) {
    const { shopId } = await this.resolveShopFromInitData(initData);
    await this.prisma.botConfig.update({
      where: { shopId },
      data: { customizationJson: customization as Prisma.InputJsonValue },
    });
    return { success: true };
  }

  async setGlobalDefault(initData: string, enable: boolean) {
    const { shopId } = await this.resolveShopFromInitData(initData);
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { seller: { select: { user: { select: { role: true } } } } },
    });
    if (shop?.seller?.user?.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only SUPER_ADMIN can set global default.");
    }
    await this.prisma.$transaction(async (tx) => {
      if (enable) {
        await tx.botConfig.updateMany({ where: { isGlobalDefault: true }, data: { isGlobalDefault: false } });
      }
      await tx.botConfig.update({ where: { shopId }, data: { isGlobalDefault: enable } });
    });
    return { success: true, isGlobalDefault: enable };
  }

  async getGlobalDefaultStatus(initData: string) {
    const { shopId } = await this.resolveShopFromInitData(initData);
    const cfg = await this.prisma.botConfig.findUnique({ where: { shopId }, select: { isGlobalDefault: true } });
    return { isGlobalDefault: cfg?.isGlobalDefault ?? false };
  }

  async getProducts(initData: string) {
    const { shopId } = await this.resolveShopFromInitData(initData);
    const products = await this.prisma.sourceProduct.findMany({
      where: { shopId },
      select: {
        id: true,
        sourceName: true,
        sourceRawName: true,
        productIcon: true,
        iconCustomEmojiId: true,
        iconOutOfStockEmojiId: true,
        available: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return products.map((p) => ({
      id: p.id,
      name: p.sourceRawName || p.sourceName,
      productIcon: p.productIcon || null,
      iconCustomEmojiId: p.iconCustomEmojiId || null,
      iconOutOfStockEmojiId: p.iconOutOfStockEmojiId || null,
      available: p.available,
    }));
  }

  async saveProductIcons(
    initData: string,
    productIcons: Record<string, { iconCustomEmojiId?: string; iconOutOfStockEmojiId?: string }>,
  ) {
    const { shopId } = await this.resolveShopFromInitData(initData);
    await Promise.all(
      Object.entries(productIcons).map(([productId, icons]) =>
        this.prisma.sourceProduct.updateMany({
          where: { id: productId, shopId },
          data: {
            iconCustomEmojiId: icons.iconCustomEmojiId?.trim() || null,
            iconOutOfStockEmojiId: icons.iconOutOfStockEmojiId?.trim() || null,
            ...(icons.iconCustomEmojiId?.trim() ? { productIcon: null } : {}),
          },
        }),
      ),
    );
    return { success: true };
  }
}
