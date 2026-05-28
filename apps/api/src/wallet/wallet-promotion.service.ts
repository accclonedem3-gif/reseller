import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";
import { ShopsService } from "../shops/shops.service";
import { decimalToNumber, toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";

export type CreateWalletPromotionInput = {
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
  ) {}

  async getActivePromotion(shopId: string) {
    const now = new Date();
    const promo = await this.prisma.walletPromotion.findFirst({
      where: {
        shopId,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      orderBy: { createdAt: "desc" },
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

  async createPromotion(user: AuthenticatedUser, input: CreateWalletPromotionInput) {
    const shop = await this.shopsService.getSellerShop(user.id);
    if (input.bonusPercent <= 0 || input.bonusPercent > 100) {
      throw new BadRequestException("bonusPercent phải từ 0.01 đến 100.");
    }
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (endAt <= startAt) {
      throw new BadRequestException("endAt phải sau startAt.");
    }
    const promo = await this.prisma.walletPromotion.create({
      data: {
        shopId: shop.id,
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

  private mapPromotion(p: { id: string; shopId: string; bonusPercent: unknown; startAt: Date; endAt: Date; createdAt: Date }) {
    const now = new Date();
    const status = now < p.startAt ? "upcoming" : now > p.endAt ? "ended" : "active";
    return {
      id: p.id,
      shopId: p.shopId,
      bonusPercent: decimalToNumber(p.bonusPercent as Parameters<typeof decimalToNumber>[0]),
      startAt: p.startAt,
      endAt: p.endAt,
      status,
      createdAt: p.createdAt,
    };
  }
}
