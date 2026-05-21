import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

export interface UpsertIconDto {
  label?: string;
  imageUrl?: string;
  customEmojiId?: string;
  position?: number;
  isGlobal?: boolean;
}

@Injectable()
export class IconCatalogService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
  ) {}

  async listIcons(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.iconCatalog.findMany({
      where: { OR: [{ shopId: null }, { shopId: shop.id }] },
      orderBy: [{ shopId: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    });
  }

  async createIcon(user: AuthenticatedUser, dto: UpsertIconDto) {
    if (!dto.label?.trim() || !dto.imageUrl?.trim() || !dto.customEmojiId?.trim()) {
      throw new BadRequestException("label, imageUrl, customEmojiId are required.");
    }
    const isGlobal = dto.isGlobal === true && user.role === "SUPER_ADMIN";
    const shop = isGlobal ? null : await this.shopsService.getSellerShop(user.id);
    return this.prisma.iconCatalog.create({
      data: {
        shopId: shop?.id ?? null,
        label: dto.label.trim(),
        imageUrl: dto.imageUrl.trim(),
        customEmojiId: dto.customEmojiId.trim(),
        position: dto.position ?? 0,
      },
    });
  }

  async updateIcon(user: AuthenticatedUser, id: string, dto: UpsertIconDto) {
    const icon = await this.prisma.iconCatalog.findUnique({ where: { id } });
    if (!icon) throw new NotFoundException("Icon not found.");
    if (icon.shopId === null) {
      if (user.role !== "SUPER_ADMIN") {
        throw new ForbiddenException("Only super admin can edit global icons.");
      }
    } else {
      const shop = await this.shopsService.getSellerShop(user.id);
      if (icon.shopId !== shop.id) {
        throw new ForbiddenException("Icon does not belong to this shop.");
      }
    }
    return this.prisma.iconCatalog.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl.trim() } : {}),
        ...(dto.customEmojiId !== undefined ? { customEmojiId: dto.customEmojiId.trim() } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
      },
    });
  }

  async deleteIcon(user: AuthenticatedUser, id: string) {
    const icon = await this.prisma.iconCatalog.findUnique({ where: { id } });
    if (!icon) throw new NotFoundException("Icon not found.");
    if (icon.shopId === null) {
      if (user.role !== "SUPER_ADMIN") {
        throw new ForbiddenException("Only super admin can delete global icons.");
      }
    } else {
      const shop = await this.shopsService.getSellerShop(user.id);
      if (icon.shopId !== shop.id) {
        throw new ForbiddenException("Icon does not belong to this shop.");
      }
    }
    await this.prisma.iconCatalog.delete({ where: { id } });
    return { ok: true };
  }
}
