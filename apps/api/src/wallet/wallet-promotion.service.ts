import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { ShopsService } from "../shops/shops.service";
import { decimalToNumber, toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";

export type CreateWalletPromotionInput = {
  minAmount: number;
  imageUrl?: string;
  bonusPercent: number;
  startAt: string;
  endAt: string;
};

@Injectable()
export class WalletPromotionService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async getActivePromotion(shopId: string, amount: number) {
    const now = new Date();
    const promo = await this.prisma.walletPromotion.findFirst({
      where: {
        shopId,
        minAmount: { lte: toDecimal(amount) },
        startAt: { lte: now },
        endAt: { gte: now },
      },
      // Multiple tiers may run in the same period. Apply the highest threshold
      // reached by the top-up, then the highest percentage for duplicate tiers.
      orderBy: [
        { minAmount: "desc" },
        { bonusPercent: "desc" },
        { createdAt: "desc" },
      ],
    });
    if (!promo) return null;
    return this.mapPromotion(promo);
  }

  async listPromotions(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const promos = await this.prisma.walletPromotion.findMany({
      where: { shopId: shop.id },
      orderBy: { startAt: "desc" },
    });
    return promos.map(this.mapPromotion);
  }

  async listActivePromotions(shopId: string) {
    const now = new Date();
    const promos = await this.prisma.walletPromotion.findMany({
      where: { shopId, startAt: { lte: now }, endAt: { gte: now } },
      orderBy: [{ minAmount: "asc" }, { bonusPercent: "asc" }],
    });
    return promos.map((promo) => this.mapPromotion(promo));
  }

  async createPromotion(user: AuthenticatedUser, input: CreateWalletPromotionInput) {
    const shop = await this.shopsService.getSellerShop(user.id);
    if (input.bonusPercent <= 0 || input.bonusPercent > 100) {
      throw new BadRequestException("bonusPercent phải từ 0.01 đến 100.");
    }
    if (!Number.isFinite(input.minAmount) || input.minAmount < 0) {
      throw new BadRequestException("minAmount phải là số không âm.");
    }
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (endAt <= startAt) {
      throw new BadRequestException("endAt phải sau startAt.");
    }
    const promo = await this.prisma.walletPromotion.create({
      data: {
        shopId: shop.id,
        minAmount: toDecimal(input.minAmount),
        imageUrl: input.imageUrl?.trim() || null,
        bonusPercent: toDecimal(input.bonusPercent),
        startAt,
        endAt,
      },
    });
    return this.mapPromotion(promo);
  }

  async deletePromotion(user: AuthenticatedUser, promotionId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const promo = await this.prisma.walletPromotion.findFirst({
      where: { id: promotionId, shopId: shop.id },
    });
    if (!promo) throw new NotFoundException("Promotion not found.");
    await this.prisma.walletPromotion.delete({ where: { id: promotionId } });
    return { ok: true };
  }


  async uploadPromotionImage(user: AuthenticatedUser, file: Express.Multer.File) {
    await this.shopsService.getSellerShop(user.id);
    if (!file) throw new BadRequestException("Chưa chọn ảnh.");
    const ext = extname(file.originalname).toLowerCase() || ".jpg";
    const filename = `${randomUUID()}${ext}`;
    const dir = join(process.cwd(), "uploads", "wallet-promotions");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), file.buffer);
    return { url: `${this.config.appPublicUrl}/uploads/wallet-promotions/${filename}` };
  }

  private mapPromotion(p: { id: string; shopId: string; minAmount: unknown; bonusPercent: unknown; imageUrl: string | null; startAt: Date; endAt: Date; createdAt: Date }) {
    const now = new Date();
    const status = now < p.startAt ? "upcoming" : now > p.endAt ? "ended" : "active";
    return {
      id: p.id,
      shopId: p.shopId,
      minAmount: decimalToNumber(p.minAmount as Parameters<typeof decimalToNumber>[0]),
      bonusPercent: decimalToNumber(p.bonusPercent as Parameters<typeof decimalToNumber>[0]),
      imageUrl: p.imageUrl,
      startAt: p.startAt,
      endAt: p.endAt,
      status,
      createdAt: p.createdAt,
    };
  }
}
