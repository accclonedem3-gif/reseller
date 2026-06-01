import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  Prisma,
  SourceAccountType,
  SourceDeliveryMode,
  SourceDurationType,
  SourceProductFamily,
  SourceWarrantyPolicy,
} from "@prisma/client";
import { DownstreamSourceConnectionStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { PrismaService } from "../db/prisma.service";
import { QueueService } from "../lib/queue.service";
import { ShopsService } from "../shops/shops.service";
import { decimalToNumber, toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";
import type { CreateSourceProductDto, UpdateAlertSettingsDto, UpdateSourceProductDto } from "./source-product.dto";

type SourceProductRow = {
  id: string;
  productIcon: string | null;
  sourceName: string;
  sourceRawName: string | null;
  sourceDescription: string | null;
  sourcePrice: Prisma.Decimal;
  available: number | null;
  internalSourceEnabled: boolean;
  internalSourcePrice: Prisma.Decimal | null;
  productFamily: SourceProductFamily | null;
  productFamilyOther: string | null;
  accountType: SourceAccountType | null;
  accountTypeOther: string | null;
  durationType: SourceDurationType | null;
  durationTypeOther: string | null;
  sourceDeliveryMode: SourceDeliveryMode | null;
  warrantyPolicy: SourceWarrantyPolicy | null;
  stockAlertThreshold: number;
  stockAlertEnabled: boolean;
  lastStockAlertAt: Date | null;
  soldCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type OverridePartial = { salePrice?: Prisma.Decimal | null; displayName?: string | null } | null | undefined;

@Injectable()
export class SourceProductService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(QueueService)
    private readonly queueService: QueueService,
  ) {}

  async list(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const products = await this.prisma.sourceProduct.findMany({
      where: { shopId: shop.id, providerName: "pro_source" },
      include: { overrides: { where: { sellerId: shop.sellerId }, take: 1 } },
      orderBy: { createdAt: "desc" },
    });
    return products.map((p) => this.mapProduct(p, p.overrides[0]));
  }

  /**
   * Lookup admin template defaults — match family first, fallback to sourceName.
   * Returns null if no template or no match.
   */
  private async getAdminTemplateDefaults(args: { family?: string | null; sourceName?: string | null }) {
    try {
      const tpl = await this.prisma.shop.findFirst({
        where: { isTemplate: true },
        select: { botConfig: { select: { customizationJson: true } } },
      });
      const cust = (tpl?.botConfig?.customizationJson as Record<string, any>) ?? null;
      if (!cust) return null;
      if (args.family) {
        const byFamily = (cust.productDefaultsByFamily ?? {}) as Record<string, any>;
        if (byFamily[args.family]) return byFamily[args.family];
      }
      if (args.sourceName) {
        const byName = (cust.productDefaultsByName ?? {}) as Record<string, any>;
        if (byName[args.sourceName]) return byName[args.sourceName];
      }
      return null;
    } catch {
      return null;
    }
  }

  async create(user: AuthenticatedUser, dto: CreateSourceProductDto) {
    this.validateOtherFields(dto);
    const shop = await this.shopsService.getSellerShop(user.id);
    const cleanedName = dto.sourceName.trim();
    const templateDefault = await this.getAdminTemplateDefaults({ family: dto.productFamily as any, sourceName: cleanedName });
    // If admin set media as photo → use it as imageUrl. For video/animation, imageUrl stays null.
    const inheritedImageUrl =
      templateDefault?.media?.type === "photo" && typeof templateDefault.media.url === "string"
        ? (templateDefault.media.url as string)
        : null;
    const product = await this.prisma.sourceProduct.create({
      data: {
        shopId: shop.id,
        externalProductId: `pro_${randomBytes(8).toString("hex")}`,
        providerName: "pro_source",
        productIcon: dto.productIcon?.trim() || templateDefault?.icon || null,
        iconCustomEmojiId: templateDefault?.customEmojiId || null,
        imageUrl: inheritedImageUrl,
        sourceName: cleanedName,
        sourceRawName: dto.sourceRawName?.trim() || cleanedName,
        sourceDescription: dto.sourceDescription?.trim() || templateDefault?.description || null,
        sourcePrice: toDecimal(dto.sourcePrice),
        available: dto.available ?? null,
        internalSourceEnabled: dto.internalSourceEnabled ?? true,
        internalSourcePrice:
          dto.internalSourcePrice != null ? toDecimal(dto.internalSourcePrice) : null,
        productFamily: dto.productFamily,
        productFamilyOther:
          dto.productFamily === "OTHER" ? dto.productFamilyOther?.trim() || null : null,
        productPackage: dto.productPackage?.trim() || null,
        accountType: dto.accountType,
        accountTypeOther:
          dto.accountType === "OTHER" ? dto.accountTypeOther?.trim() || null : null,
        durationType: dto.durationType,
        durationTypeOther:
          dto.durationType === "OTHER" ? dto.durationTypeOther?.trim() || null : null,
        sourceDeliveryMode: dto.sourceDeliveryMode,
        warrantyPolicy: dto.warrantyPolicy,
      },
    });
    const retailPrice = dto.salePrice ?? dto.sourcePrice;
    const overrideDisplayName = dto.displayName?.trim() || dto.sourceName.trim();
    const override = await this.prisma.sellerProductOverride.upsert({
      where: { sellerId_sourceProductId: { sellerId: shop.sellerId, sourceProductId: product.id } },
      create: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        sourceProductId: product.id,
        displayName: overrideDisplayName,
        salePrice: toDecimal(retailPrice),
        hidden: false,
        enabled: true,
      },
      update: {
        displayName: overrideDisplayName,
        salePrice: toDecimal(retailPrice),
      },
    });
    this.triggerDownstreamSync(shop.id).catch(() => {});
    return this.mapProduct(product, override);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateSourceProductDto) {
    this.validateOtherFields(dto);
    const shop = await this.shopsService.getSellerShop(user.id);
    const product = await this.getOwnedProduct(id, shop.id);

    const updated = await this.prisma.sourceProduct.update({
      where: { id: product.id },
      data: {
        productIcon: dto.productIcon !== undefined ? (dto.productIcon?.trim() || null) : undefined,
        sourceName: dto.sourceName?.trim() || undefined,
        sourceRawName:
          dto.sourceRawName !== undefined ? dto.sourceRawName?.trim() || null : undefined,
        sourceDescription:
          dto.sourceDescription !== undefined
            ? dto.sourceDescription?.trim() || null
            : undefined,
        sourcePrice: dto.sourcePrice != null ? toDecimal(dto.sourcePrice) : undefined,
        available: dto.available !== undefined ? (dto.available ?? null) : undefined,
        internalSourceEnabled: dto.internalSourceEnabled ?? undefined,
        internalSourcePrice:
          dto.internalSourcePrice !== undefined
            ? dto.internalSourcePrice != null
              ? toDecimal(dto.internalSourcePrice)
              : null
            : undefined,
        productFamily: dto.productFamily ?? undefined,
        productFamilyOther:
          dto.productFamily === "OTHER"
            ? dto.productFamilyOther?.trim() || null
            : dto.productFamily != null
              ? null
              : undefined,
        productPackage: dto.productPackage !== undefined ? (dto.productPackage?.trim() || null) : undefined,
        accountType: dto.accountType ?? undefined,
        accountTypeOther:
          dto.accountType === "OTHER"
            ? dto.accountTypeOther?.trim() || null
            : dto.accountType != null
              ? null
              : undefined,
        durationType: dto.durationType ?? undefined,
        durationTypeOther:
          dto.durationType === "OTHER"
            ? dto.durationTypeOther?.trim() || null
            : dto.durationType != null
              ? null
              : undefined,
        sourceDeliveryMode: dto.sourceDeliveryMode ?? undefined,
        warrantyPolicy: dto.warrantyPolicy ?? undefined,
      },
    });
    const updatedOverride = await this.prisma.sellerProductOverride.upsert({
      where: { sellerId_sourceProductId: { sellerId: shop.sellerId, sourceProductId: updated.id } },
      create: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        sourceProductId: updated.id,
        displayName: dto.displayName?.trim() || updated.sourceName,
        salePrice: dto.salePrice != null ? toDecimal(dto.salePrice) : updated.sourcePrice,
        hidden: false,
        enabled: true,
      },
      update: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName?.trim() || null } : {}),
        ...(dto.salePrice !== undefined ? { salePrice: toDecimal(dto.salePrice) } : {}),
      },
    });
    this.triggerDownstreamSync(shop.id).catch(() => {});
    return this.mapProduct(updated, updatedOverride);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const product = await this.getOwnedProduct(id, shop.id);

    const orderCount = await this.prisma.order.count({
      where: { sourceProductId: product.id },
    });

    if (orderCount > 0) {
      throw new BadRequestException(
        "Sản phẩm này đã có đơn hàng. Không thể xóa.",
      );
    }

    await this.prisma.sourceProduct.delete({ where: { id: product.id } });
    this.triggerDownstreamSync(shop.id).catch(() => {});

    return { success: true, deletedId: id };
  }

  async updateAlertSettings(user: AuthenticatedUser, id: string, dto: UpdateAlertSettingsDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const product = await this.getOwnedProduct(id, shop.id);
    const updated = await this.prisma.sourceProduct.update({
      where: { id: product.id },
      data: {
        stockAlertThreshold: dto.stockAlertThreshold ?? undefined,
        stockAlertEnabled: dto.stockAlertEnabled ?? undefined,
      },
    });
    return this.mapProduct(updated);
  }

  private async getOwnedProduct(id: string, shopId: string) {
    const product = await this.prisma.sourceProduct.findFirst({
      where: { id, shopId, providerName: "pro_source" },
    });

    if (!product) {
      throw new NotFoundException("Source product not found.");
    }

    return product;
  }

  private validateOtherFields(dto: Partial<CreateSourceProductDto>) {
    if (dto.productFamily === "OTHER" && !dto.productFamilyOther?.trim()) {
      throw new BadRequestException(
        "productFamilyOther is required when productFamily is OTHER.",
      );
    }
    if (dto.accountType === "OTHER" && !dto.accountTypeOther?.trim()) {
      throw new BadRequestException(
        "accountTypeOther is required when accountType is OTHER.",
      );
    }
    if (dto.durationType === "OTHER" && !dto.durationTypeOther?.trim()) {
      throw new BadRequestException(
        "durationTypeOther is required when durationType is OTHER.",
      );
    }
  }

  private mapProduct(product: SourceProductRow, override?: OverridePartial) {
    const salePrice = override?.salePrice != null
      ? decimalToNumber(override.salePrice)
      : decimalToNumber(product.sourcePrice);
    const displayName = override?.displayName || product.sourceRawName || product.sourceName;
    return {
      id: product.id,
      productIcon: product.productIcon,
      sourceName: product.sourceName,
      displayName,
      sourceRawName: product.sourceRawName,
      sourceDescription: product.sourceDescription,
      sourcePrice: decimalToNumber(product.sourcePrice),
      salePrice,
      available: product.available,
      internalSourceEnabled: product.internalSourceEnabled,
      internalSourcePrice:
        product.internalSourcePrice != null
          ? decimalToNumber(product.internalSourcePrice)
          : null,
      productFamily: product.productFamily,
      productFamilyOther: product.productFamilyOther,
      productPackage: (product as any).productPackage ?? null,
      accountType: product.accountType,
      accountTypeOther: product.accountTypeOther,
      durationType: product.durationType,
      durationTypeOther: product.durationTypeOther,
      sourceDeliveryMode: product.sourceDeliveryMode,
      warrantyPolicy: product.warrantyPolicy,
      stockAlertThreshold: product.stockAlertThreshold,
      stockAlertEnabled: product.stockAlertEnabled,
      lastStockAlertAt: product.lastStockAlertAt,
      soldCount: product.soldCount,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private async triggerDownstreamSync(upstreamShopId: string) {
    const connections = await this.prisma.downstreamSourceConnection.findMany({
      where: {
        upstreamShopId,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      select: { downstreamShopId: true },
    });
    for (const conn of connections) {
      await this.queueService.addSyncCatalogJob(conn.downstreamShopId);
      this.shopsService.syncCatalogForShop(conn.downstreamShopId).catch(() => {});
    }
  }
}
