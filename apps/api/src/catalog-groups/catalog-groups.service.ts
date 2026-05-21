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
import type {
  BulkAssignGroupDto,
  CreateCatalogGroupDto,
  ReorderCatalogGroupsDto,
  UpdateCatalogGroupDto,
} from "./catalog-groups.dto";

@Injectable()
export class CatalogGroupsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
  ) {}

  async listGroups(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.shopCatalogGroup.findMany({
      where: { shopId: shop.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        _count: { select: { overrides: true } },
      },
    });
  }

  async createGroup(user: AuthenticatedUser, dto: CreateCatalogGroupDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const maxPos = await this.prisma.shopCatalogGroup.aggregate({
      where: { shopId: shop.id },
      _max: { position: true },
    });
    const position = dto.position ?? (maxPos._max.position ?? -1) + 1;
    return this.prisma.shopCatalogGroup.create({
      data: {
        shopId: shop.id,
        name: dto.name,
        position,
        icon: dto.icon ?? null,
        iconCustomEmojiId: dto.iconCustomEmojiId ?? null,
      },
    });
  }

  async updateGroup(user: AuthenticatedUser, id: string, dto: UpdateCatalogGroupDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const group = await this.prisma.shopCatalogGroup.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!group) throw new NotFoundException("Group not found.");

    return this.prisma.shopCatalogGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon || null } : {}),
        ...(dto.iconCustomEmojiId !== undefined ? { iconCustomEmojiId: dto.iconCustomEmojiId || null } : {}),
      },
    });
  }

  async deleteGroup(user: AuthenticatedUser, id: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const group = await this.prisma.shopCatalogGroup.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!group) throw new NotFoundException("Group not found.");

    // Unassign products before deletion (handled by SET NULL FK, but explicit for clarity)
    await this.prisma.shopCatalogGroup.delete({ where: { id } });
    return { ok: true };
  }

  async reorderGroups(user: AuthenticatedUser, dto: ReorderCatalogGroupsDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const groups = await this.prisma.shopCatalogGroup.findMany({
      where: { shopId: shop.id },
      select: { id: true },
    });
    const existingIds = new Set(groups.map((g) => g.id));

    for (const id of dto.orderedIds) {
      if (!existingIds.has(id)) throw new BadRequestException(`Group ${id} not found.`);
    }

    await this.prisma.$transaction(
      dto.orderedIds.map((id, idx) =>
        this.prisma.shopCatalogGroup.update({
          where: { id },
          data: { position: idx },
        }),
      ),
    );

    return { ok: true };
  }

  async bulkAssign(user: AuthenticatedUser, dto: BulkAssignGroupDto) {
    const shop = await this.shopsService.getSellerShop(user.id);

    if (dto.groupId) {
      const group = await this.prisma.shopCatalogGroup.findFirst({
        where: { id: dto.groupId, shopId: shop.id },
      });
      if (!group) throw new NotFoundException("Group not found.");
    }

    // Validate all products belong to this shop
    const overrides = await this.prisma.sellerProductOverride.findMany({
      where: {
        shopId: shop.id,
        sellerId: shop.sellerId,
        sourceProductId: { in: dto.productIds },
      },
      select: { id: true, sourceProductId: true },
    });

    if (overrides.length !== dto.productIds.length) {
      throw new BadRequestException("One or more products not found.");
    }

    await this.prisma.sellerProductOverride.updateMany({
      where: {
        shopId: shop.id,
        sellerId: shop.sellerId,
        sourceProductId: { in: dto.productIds },
      },
      data: { groupId: dto.groupId ?? null },
    });

    return { updated: overrides.length };
  }
}
