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
        description: dto.description?.trim() || null,
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

    const updated = await this.prisma.shopCatalogGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon || null } : {}),
        ...(dto.iconCustomEmojiId !== undefined ? { iconCustomEmojiId: dto.iconCustomEmojiId || null } : {}),
      },
    });

    const effectiveCustomEmojiId =
      dto.iconCustomEmojiId !== undefined
        ? dto.iconCustomEmojiId?.trim() || null
        : group.iconCustomEmojiId;
    const effectiveIcon =
      dto.icon !== undefined ? dto.icon?.trim() || null : group.icon;

    // Khi danh mục đã set custom emoji, tất cả sản phẩm trong danh mục cũng sẽ thừa kế emoji đó
    if (effectiveCustomEmojiId) {
      const overrides = await this.prisma.sellerProductOverride.findMany({
        where: { shopId: shop.id, groupId: id },
        select: { sourceProductId: true },
      });
      const productIds = overrides.map((o) => o.sourceProductId);
      if (productIds.length > 0) {
        await this.prisma.sourceProduct.updateMany({
          where: { id: { in: productIds }, shopId: shop.id },
          data: {
            iconCustomEmojiId: effectiveCustomEmojiId,
            ...(effectiveIcon ? { productIcon: effectiveIcon } : {}),
          },
        });
      }
    }

    return updated;
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

    let targetGroup: {
      id: string;
      icon: string | null;
      iconCustomEmojiId: string | null;
    } | null = null;
    if (dto.groupId) {
      targetGroup = await this.prisma.shopCatalogGroup.findFirst({
        where: { id: dto.groupId, shopId: shop.id },
      });
      if (!targetGroup) throw new NotFoundException("Group not found.");
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

    // Khi thêm vào danh mục đã set custom emoji, sản phẩm cũng thừa kế emoji đó
    if (targetGroup?.iconCustomEmojiId) {
      await this.prisma.sourceProduct.updateMany({
        where: {
          id: { in: dto.productIds },
          shopId: shop.id,
        },
        data: {
          iconCustomEmojiId: targetGroup.iconCustomEmojiId,
          ...(targetGroup.icon ? { productIcon: targetGroup.icon } : {}),
        },
      });
    }

    return { updated: overrides.length };
  }
}
