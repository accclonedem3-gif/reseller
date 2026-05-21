import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { Prisma, SellerTier } from "@prisma/client";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";
import { ShopsService } from "../shops/shops.service";
import { QueueService } from "../lib/queue.service";

import type { CreateManualProductDto, UpdateProductDto } from "./products.dto";

type SourceProductBusinessFields = {
  internalSourceEnabled?: boolean;
  internalSourcePrice?: Prisma.Decimal;
  productFamily?: CreateManualProductDto["productFamily"];
  productFamilyOther?: string | null;
  productPackage?: string | null;
  accountType?: CreateManualProductDto["accountType"];
  accountTypeOther?: string | null;
  durationType?: CreateManualProductDto["durationType"];
  durationTypeOther?: string | null;
  sourceDeliveryMode?: CreateManualProductDto["sourceDeliveryMode"];
  warrantyPolicy?: CreateManualProductDto["warrantyPolicy"];
};

@Injectable()
export class ProductsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(QueueService)
    private readonly queueService: QueueService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async listProducts(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.shopsService.getCatalogViewForShop(shop.id);
  }

  async getProduct(user: AuthenticatedUser, id: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const product = await this.prisma.sourceProduct.findFirst({
      where: {
        id,
        shopId: shop.id,
      },
      include: {
        overrides: {
          where: {
            sellerId: shop.sellerId,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException("Product not found.");
    }

    const [view] = (
      await this.shopsService.getCatalogViewForShop(shop.id)
    ).filter((item) => item.id === product.id);

    return view;
  }

  async getProductInventory(user: AuthenticatedUser, id: string) {
    const { product } = await this.getManualProductForSeller(user.id, id);
    return this.buildManualInventoryView(product);
  }

  async purgeDeliveredInventory(
    user: AuthenticatedUser,
    id: string,
    dto: { entryKeys?: string[] },
  ) {
    const { product } = await this.getManualProductForSeller(user.id, id);
    const metadata = this.asRecord(product.metadataJson);
    const currentInventory = await this.buildManualInventoryView(product);
    const keysToHide =
      Array.isArray(dto.entryKeys) && dto.entryKeys.length > 0
        ? dto.entryKeys
        : currentInventory.deliveredItems.map((item) => item.key);

    if (keysToHide.length === 0) {
      return currentInventory;
    }

    const nextHiddenKeys = Array.from(
      new Set([...this.readHiddenDeliveredKeys(metadata), ...keysToHide]),
    );

    await this.prisma.sourceProduct.update({
      where: { id: product.id },
      data: {
        metadataJson: {
          ...metadata,
          manual: true,
          hiddenDeliveredKeys: nextHiddenKeys,
        } as Prisma.InputJsonValue,
      },
    });

    const refreshed = await this.prisma.sourceProduct.findUnique({
      where: { id: product.id },
    });

    if (!refreshed) {
      throw new NotFoundException("Product not found.");
    }

    return this.buildManualInventoryView(refreshed);
  }

  async createManualProduct(user: AuthenticatedUser, dto: CreateManualProductDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const displayName = dto.displayName.trim();

    if (!displayName) {
      throw new BadRequestException("Display name is required.");
    }

    const isShared = dto.isShared === true && !!dto.sharedContent?.trim();
    const normalizedDeliveryText = isShared ? null : this.normalizeManualDeliveryText(dto.deliveryText);
    const deliveryEntries = isShared ? [] : this.parseManualDeliveryEntries(normalizedDeliveryText);
    const available = isShared
      ? (dto.available ?? 0)
      : deliveryEntries.length > 0
        ? deliveryEntries.length
        : dto.available !== undefined
          ? dto.available
          : null;
    const classificationFields = this.buildClassificationFields(dto);
    if (classificationFields.sourceDeliveryMode === undefined) {
      classificationFields.sourceDeliveryMode = this.deriveSourceDeliveryMode(isShared, deliveryEntries.length);
    }
    const wholesaleFields =
      user.sellerTier === SellerTier.ULTRA
        ? {
            ...this.buildWholesaleFields(dto),
            internalSourceEnabled: dto.internalSourceEnabled ?? true,
          }
        : {};
    const businessFields = { ...classificationFields, ...wholesaleFields };

    const created = await this.prisma.sourceProduct.create({
      data: {
        shopId: shop.id,
        externalProductId: `manual_${randomBytes(8).toString("hex")}`,
        providerName: "manual",
        sourceName: dto.sourceName?.trim() || displayName,
        sourceRawName: dto.sourceName?.trim() || displayName,
        sourceDescription: dto.sourceDescription?.trim() || null,
        sourcePrice: toDecimal(dto.sourcePrice ?? 0),
        available,
        totalCount: available ?? 0,
        imageUrl: dto.imageUrl?.trim() || null,
        productIcon: dto.productIcon?.trim() || null,
        iconCustomEmojiId: dto.iconCustomEmojiId?.trim() || null,
        ...businessFields,
        metadataJson: {
          manual: true,
          shared: isShared,
          sharedContent: isShared ? dto.sharedContent!.trim() : undefined,
          deliveryText: normalizedDeliveryText,
          deliveryEntries,
          deliveryFormatHint: dto.deliveryFormatHint?.trim() || null,
          hiddenDeliveredKeys: [],
          sourceDescription: dto.sourceDescription?.trim() || null,
          usageInstructions: dto.usageInstructions?.trim() || null,
        } as Prisma.InputJsonValue,
      },
    });

    await this.prisma.sellerProductOverride.create({
      data: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        sourceProductId: created.id,
        displayName,
        salePrice: toDecimal(dto.salePrice),
        hidden: dto.hidden ?? false,
        enabled: dto.enabled ?? true,
        promoText: dto.promoText?.trim() || null,
      },
    });

    if (user.sellerTier === SellerTier.ULTRA) {
      this.triggerDownstreamSync(shop.id).catch(() => {});
    }

    return this.getProduct(user, created.id);
  }

  async reorderProducts(user: AuthenticatedUser, items: { id: string; position: number }[]) {
    if (!items.length) return { ok: true, updated: 0 };
    const shop = await this.shopsService.getSellerShop(user.id);
    const productIds = items.map((i) => i.id);
    const products = await this.prisma.sourceProduct.findMany({
      where: { id: { in: productIds }, shopId: shop.id },
      select: { id: true },
    });
    const ownedIds = new Set(products.map((p) => p.id));
    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (!ownedIds.has(item.id)) continue;
        await tx.sellerProductOverride.upsert({
          where: {
            sellerId_sourceProductId: {
              sellerId: shop.sellerId,
              sourceProductId: item.id,
            },
          },
          update: { position: item.position },
          create: {
            sellerId: shop.sellerId,
            shopId: shop.id,
            sourceProductId: item.id,
            position: item.position,
          },
        });
        updated += 1;
      }
    });
    return { ok: true, updated };
  }

  async updateProduct(user: AuthenticatedUser, id: string, dto: UpdateProductDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const product = await this.prisma.sourceProduct.findFirst({
      where: {
        id,
        shopId: shop.id,
      },
    });

    if (!product) {
      throw new NotFoundException("Product not found.");
    }

    const isManual = this.isManualProduct(product);
    const classificationFields = this.buildClassificationFields(dto);
    const wholesaleFields =
      user.sellerTier === SellerTier.ULTRA ? this.buildWholesaleFields(dto) : {};
    const businessFields = { ...classificationFields, ...wholesaleFields };

    let newAvailable: number | null | undefined = undefined;

    if (isManual) {
      const currentMetadata = this.asRecord(product.metadataJson);
      const currentlyShared = currentMetadata.shared === true;
      const wantShared = dto.isShared !== undefined ? dto.isShared === true : currentlyShared;

      if (wantShared) {
        const sharedContent =
          dto.sharedContent !== undefined
            ? dto.sharedContent.trim()
            : (typeof currentMetadata.sharedContent === "string" ? currentMetadata.sharedContent : "");
        const available = dto.available !== undefined ? dto.available : (product.available ?? 0);
        newAvailable = available;

        await this.prisma.sourceProduct.update({
          where: { id: product.id },
          data: {
            sourceName: dto.sourceName?.trim() || undefined,
            sourceRawName: dto.sourceName?.trim() || undefined,
            sourceDescription: dto.sourceDescription?.trim() || undefined,
            sourcePrice: dto.sourcePrice !== undefined ? toDecimal(dto.sourcePrice) : undefined,
            available,
            totalCount: Math.max(product.soldCount + available, product.totalCount),
            ...businessFields,
            metadataJson: {
              ...currentMetadata,
              manual: true,
              shared: true,
              sharedContent,
              deliveryFormatHint:
                dto.deliveryFormatHint !== undefined
                  ? (dto.deliveryFormatHint?.trim() || null)
                  : (currentMetadata.deliveryFormatHint as string | null | undefined) ?? null,
              sourceDescription:
                dto.sourceDescription !== undefined
                  ? (dto.sourceDescription?.trim() || null)
                  : currentMetadata.sourceDescription ?? product.sourceDescription ?? null,
              usageInstructions:
                dto.usageInstructions !== undefined
                  ? (dto.usageInstructions?.trim() || null)
                  : (currentMetadata.usageInstructions as string | null | undefined) ?? null,
            } as Prisma.InputJsonValue,
          },
        });
      } else {
      const normalizedDeliveryText =
        dto.deliveryText !== undefined
          ? this.normalizeManualDeliveryText(dto.deliveryText)
          : typeof currentMetadata.deliveryText === "string"
            ? this.normalizeManualDeliveryText(currentMetadata.deliveryText)
            : null;
      const deliveryEntries =
        dto.deliveryText !== undefined
          ? this.parseManualDeliveryEntries(normalizedDeliveryText)
          : this.readManualDeliveryEntries(currentMetadata);
      const hasAutoDelivery = deliveryEntries.length > 0;
      const available = hasAutoDelivery
        ? deliveryEntries.length
        : dto.available !== undefined
          ? dto.available
          : dto.deliveryText !== undefined
            ? null
            : undefined;
      newAvailable = available;

      await this.prisma.sourceProduct.update({
        where: { id: product.id },
        data: {
          sourceName: dto.sourceName?.trim() || undefined,
          sourceRawName: dto.sourceName?.trim() || undefined,
          sourceDescription: dto.sourceDescription?.trim() || undefined,
          sourcePrice:
            dto.sourcePrice !== undefined ? toDecimal(dto.sourcePrice) : undefined,
          available,
          totalCount:
            available != null
              ? Math.max(product.soldCount + available, product.totalCount)
              : undefined,
          ...businessFields,
          metadataJson: {
            ...currentMetadata,
            manual: true,
            shared: false,
            sharedContent: undefined,
            deliveryText: normalizedDeliveryText,
            deliveryEntries,
            deliveryFormatHint:
              dto.deliveryFormatHint !== undefined
                ? (dto.deliveryFormatHint?.trim() || null)
                : (currentMetadata.deliveryFormatHint as string | null | undefined) ?? null,
            sourceDescription:
              dto.sourceDescription !== undefined
                ? (dto.sourceDescription?.trim() || null)
                : currentMetadata.sourceDescription ?? product.sourceDescription ?? null,
            usageInstructions:
              dto.usageInstructions !== undefined
                ? (dto.usageInstructions?.trim() || null)
                : (currentMetadata.usageInstructions as string | null | undefined) ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      }
    } else if (dto.resetToSource === true) {
      await this.prisma.sourceProduct.update({
        where: { id: product.id },
        data: { sourceDescriptionLocked: false, sourceDescription: null },
      });
      await this.prisma.sellerProductOverride.updateMany({
        where: { sellerId: shop.sellerId, sourceProductId: product.id },
        data: {
          displayName: product.sourceRawName || product.sourceName,
          displayNameLocked: false,
          salePriceLocked: false,
        },
      });
    } else {
      const externalUpdate: Record<string, unknown> = { ...businessFields };
      if (dto.sourceDescription !== undefined) {
        externalUpdate.sourceDescription = dto.sourceDescription?.trim() || null;
        externalUpdate.sourceDescriptionLocked = true;
      }
      if (dto.usageInstructions !== undefined) {
        const currentMeta = this.asRecord(product.metadataJson);
        externalUpdate.metadataJson = {
          ...currentMeta,
          usageInstructions: dto.usageInstructions?.trim() || null,
        };
      }
      if (Object.keys(externalUpdate).length > 0) {
        await this.prisma.sourceProduct.update({
          where: { id: product.id },
          data: externalUpdate,
        });
      }
    }

    if (
      dto.imageUrl !== undefined ||
      dto.productIcon !== undefined ||
      dto.iconCustomEmojiId !== undefined ||
      dto.promoType !== undefined ||
      dto.promoBuyN !== undefined ||
      dto.promoGetM !== undefined ||
      dto.promoBulkMinQty !== undefined ||
      dto.promoBulkDiscountPct !== undefined ||
      dto.promoStartAt !== undefined ||
      dto.promoEndAt !== undefined ||
      dto.promoBannerUrl !== undefined
    ) {
      await this.prisma.sourceProduct.update({
        where: { id: product.id },
        data: {
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl?.trim() || null } : {}),
          ...(dto.productIcon !== undefined ? { productIcon: dto.productIcon?.trim() || null } : {}),
          ...(dto.iconCustomEmojiId !== undefined ? { iconCustomEmojiId: dto.iconCustomEmojiId?.trim() || null } : {}),
          ...(dto.promoType !== undefined ? { promoType: dto.promoType?.trim() || null } : {}),
          ...(dto.promoBuyN !== undefined ? { promoBuyN: dto.promoBuyN || null } : {}),
          ...(dto.promoGetM !== undefined ? { promoGetM: dto.promoGetM || null } : {}),
          ...(dto.promoBulkMinQty !== undefined ? { promoBulkMinQty: dto.promoBulkMinQty || null } : {}),
          ...(dto.promoBulkDiscountPct !== undefined ? { promoBulkDiscountPct: dto.promoBulkDiscountPct != null ? toDecimal(dto.promoBulkDiscountPct) : null } : {}),
          ...(dto.promoStartAt !== undefined ? { promoStartAt: dto.promoStartAt ? new Date(dto.promoStartAt) : null } : {}),
          ...(dto.promoEndAt !== undefined ? { promoEndAt: dto.promoEndAt ? new Date(dto.promoEndAt) : null } : {}),
          ...(dto.promoBannerUrl !== undefined ? { promoBannerUrl: dto.promoBannerUrl?.trim() || null } : {}),
        },
      });
    }

    await this.prisma.sellerProductOverride.upsert({
      where: {
        sellerId_sourceProductId: {
          sellerId: shop.sellerId,
          sourceProductId: product.id,
        },
      },
      update: {
        displayName: dto.displayName ?? undefined,
        ...(dto.displayName != null ? { displayNameLocked: true } : {}),
        ...(dto.salePrice !== undefined ? { salePriceLocked: true } : {}),
        salePrice:
          dto.salePrice !== undefined ? toDecimal(dto.salePrice) : undefined,
        salePriceUsd:
          dto.salePriceUsd !== undefined
            ? dto.salePriceUsd === 0 ? null : toDecimal(dto.salePriceUsd)
            : undefined,
        hidden: dto.hidden ?? undefined,
        hiddenVi: dto.hiddenVi ?? undefined,
        hiddenEn: dto.hiddenEn ?? undefined,
        enabled: dto.enabled ?? undefined,
        promoText: dto.promoText ?? undefined,
      },
      create: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        sourceProductId: product.id,
        displayName: dto.displayName || product.sourceName,
        displayNameLocked: dto.displayName != null,
        salePriceLocked: dto.salePrice !== undefined,
        salePrice:
          dto.salePrice !== undefined
            ? toDecimal(dto.salePrice)
            : product.sourcePrice,
        salePriceUsd:
          dto.salePriceUsd !== undefined && dto.salePriceUsd > 0
            ? toDecimal(dto.salePriceUsd)
            : null,
        hidden: dto.hidden ?? false,
        hiddenVi: dto.hiddenVi ?? false,
        hiddenEn: dto.hiddenEn ?? false,
        enabled: dto.enabled ?? true,
        promoText: dto.promoText ?? null,
      },
    });

    if (user.sellerTier === SellerTier.ULTRA) {
      this.triggerDownstreamSync(shop.id).catch(() => {});

      if (
        newAvailable != null &&
        product.available != null &&
        shop.providerConfig?.sourceNotificationSyncEnabled &&
        shop.botConfig?.telegramBotTokenEncrypted
      ) {
        const addedQty = Math.max(0, newAvailable - Number(product.available));
        if (addedQty > 0) {
          const displayName = dto.displayName ?? product.sourceName ?? product.sourceRawName ?? "";
          this.shopsService.notifyCatalogStockUpdates(
            shop.id,
            shop.botConfig.telegramBotTokenEncrypted,
            [{ sourceProductId: product.id, displayName, addedQuantity: addedQty, available: newAvailable }],
          ).catch(() => {});
        }
      }
    }

    return this.getProduct(user, id);
  }

  async duplicateProduct(user: AuthenticatedUser, id: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const product = await this.prisma.sourceProduct.findFirst({
      where: { id, shopId: shop.id },
      include: { overrides: { where: { sellerId: shop.sellerId } } },
    });

    if (!product) throw new NotFoundException("Product not found.");
    if (!this.isManualProduct(product)) throw new BadRequestException("Only manual products can be duplicated.");

    const override = product.overrides[0];
    const metadata = this.asRecord(product.metadataJson);

    const created = await this.prisma.sourceProduct.create({
      data: {
        shopId: shop.id,
        externalProductId: `manual_${randomBytes(8).toString("hex")}`,
        providerName: "manual",
        sourceName: `${product.sourceName} copy`,
        sourceRawName: product.sourceRawName ? `${product.sourceRawName} copy` : null,
        sourceDescription: product.sourceDescription,
        sourcePrice: product.sourcePrice,
        available: null,
        totalCount: 0,
        imageUrl: product.imageUrl,
        productIcon: product.productIcon,
        internalSourceEnabled: product.internalSourceEnabled,
        internalSourcePrice: product.internalSourcePrice,
        productFamily: product.productFamily,
        productFamilyOther: product.productFamilyOther,
        accountType: product.accountType,
        accountTypeOther: product.accountTypeOther,
        durationType: product.durationType,
        durationTypeOther: product.durationTypeOther,
        sourceDeliveryMode: product.sourceDeliveryMode,
        warrantyPolicy: product.warrantyPolicy,
        metadataJson: {
          manual: true,
          deliveryText: null,
          deliveryEntries: [],
          deliveryFormatHint: metadata.deliveryFormatHint ?? null,
          hiddenDeliveredKeys: [],
          sourceDescription: metadata.sourceDescription ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    await this.prisma.sellerProductOverride.create({
      data: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        sourceProductId: created.id,
        displayName: override ? `${override.displayName} copy` : `${product.sourceName} copy`,
        salePrice: override?.salePrice ?? product.sourcePrice,
        hidden: false,
        enabled: true,
        promoText: override?.promoText ?? null,
      },
    });

    if (user.sellerTier === SellerTier.ULTRA) {
      this.triggerDownstreamSync(shop.id).catch(() => {});
    }

    return this.getProduct(user, created.id);
  }

  async deleteProduct(user: AuthenticatedUser, id: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const product = await this.prisma.sourceProduct.findFirst({
      where: {
        id,
        shopId: shop.id,
      },
    });

    if (!product) {
      throw new NotFoundException("Product not found.");
    }

    if (!this.isManualProduct(product)) {
      throw new BadRequestException("Only manual products can be deleted.");
    }

    const relatedOrders = await this.prisma.order.count({
      where: {
        sourceProductId: product.id,
      },
    });

    if (relatedOrders > 0) {
      throw new BadRequestException(
        "San pham nay da phat sinh don hang. Hay tat hoac an san pham thay vi xoa.",
      );
    }

    await this.prisma.sourceProduct.delete({
      where: {
        id: product.id,
      },
    });

    return {
      success: true,
      deletedId: product.id,
    };
  }

  private async getManualProductForSeller(userId: string, productId: string) {
    const shop = await this.shopsService.getSellerShop(userId);
    const product = await this.prisma.sourceProduct.findFirst({
      where: {
        id: productId,
        shopId: shop.id,
      },
    });

    if (!product) {
      throw new NotFoundException("Product not found.");
    }

    if (!this.isManualProduct(product)) {
      throw new BadRequestException("Only manual products support inventory management.");
    }

    return { shop, product };
  }

  private async buildManualInventoryView(product: {
    id: string;
    metadataJson?: Prisma.JsonValue | null;
  }) {
    const metadata = this.asRecord(product.metadataJson);
    const availableEntries = this.readManualDeliveryEntries(metadata).map((content, index) => ({
      key: this.buildManualInventoryKey("available", `${product.id}:${index}:${content}`),
      status: "available" as const,
      content,
    }));

    const hiddenDeliveredKeys = new Set(this.readHiddenDeliveredKeys(metadata));
    const deliveredOrders = await this.prisma.order.findMany({
      where: {
        sourceProductId: product.id,
        status: "DELIVERED",
        deliveredAccountText: {
          not: null,
        },
      },
      orderBy: {
        deliveredAt: "desc",
      },
      select: {
        id: true,
        orderCode: true,
        deliveredAt: true,
        deliveredAccountText: true,
        customer: {
          select: {
            telegramUsername: true,
            firstName: true,
            lastName: true,
            telegramUserId: true,
          },
        },
      },
    });

    const deliveredItems = deliveredOrders
      .flatMap((order) => {
        const entries = this.parseManualDeliveryEntries(order.deliveredAccountText);
        return entries.map((content, index) => {
          const key = this.buildManualInventoryKey(
            "delivered",
            `${order.id}:${index}:${content}`,
          );

          return {
            key,
            status: "delivered" as const,
            content,
            orderCode: order.orderCode,
            deliveredAt: order.deliveredAt,
            customerLabel:
              [order.customer?.firstName, order.customer?.lastName]
                .filter(Boolean)
                .join(" ") ||
              order.customer?.telegramUsername ||
              order.customer?.telegramUserId ||
              "Khách Telegram",
          };
        });
      })
      .filter((item) => !hiddenDeliveredKeys.has(item.key));

    return {
      summary: {
        availableCount: availableEntries.length,
        deliveredCount: deliveredItems.length,
        hiddenDeliveredCount: hiddenDeliveredKeys.size,
      },
      availableItems: availableEntries,
      deliveredItems,
    };
  }

  private isManualProduct(product: {
    providerName: string;
    metadataJson?: Prisma.JsonValue | null;
  }) {
    if (String(product.providerName || "").toLowerCase() === "manual") {
      return true;
    }

    const metadata = this.asRecord(product.metadataJson);
    return metadata.manual === true;
  }

  private asRecord(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {} as Record<string, any>;
    }

    return value as Record<string, any>;
  }

  private normalizeManualDeliveryText(value: string | null | undefined) {
    const normalized = String(value || "")
      .replace(/\r\n/g, "\n")
      .trim();

    return normalized || null;
  }

  private parseManualDeliveryEntries(value: string | null | undefined) {
    const normalized = this.unwrapManualDeliveryEnvelope(
      this.normalizeManualDeliveryText(value),
    );

    if (!normalized) {
      return [] as string[];
    }

    const jsonEntries = this.parseJsonDeliveryEntries(normalized);
    if (jsonEntries.length > 0) {
      return jsonEntries;
    }

    return normalized
      .split("\n")
      .map((entry) => this.sanitizeDeliveryEntry(entry))
      .filter(Boolean);
  }

  private readManualDeliveryEntries(metadata: Record<string, any>) {
    if (Array.isArray(metadata.deliveryEntries)) {
      return metadata.deliveryEntries
        .map((entry: unknown) => String(entry || "").trim())
        .filter(Boolean);
    }

    if (typeof metadata.deliveryText === "string") {
      return this.parseManualDeliveryEntries(metadata.deliveryText);
    }

    return [] as string[];
  }

  private readHiddenDeliveredKeys(metadata: Record<string, any>) {
    if (!Array.isArray(metadata.hiddenDeliveredKeys)) {
      return [] as string[];
    }

    return metadata.hiddenDeliveredKeys
      .map((entry: unknown) => String(entry || "").trim())
      .filter(Boolean);
  }

  private parseJsonDeliveryEntries(normalized: string) {
    if (!normalized.startsWith("[")) {
      return [] as string[];
    }

    try {
      const parsed = JSON.parse(normalized);
      if (!Array.isArray(parsed)) {
        return [] as string[];
      }

      return parsed
        .map((entry) => this.normalizeJsonDeliveryEntry(entry))
        .filter(Boolean) as string[];
    } catch {
      return [] as string[];
    }
  }

  private normalizeJsonDeliveryEntry(entry: unknown) {
    if (typeof entry === "string") {
      return entry.trim() || null;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    const record = entry as Record<string, unknown>;
    const account = [record.account, record.email, record.username, record.user, record.login]
      .map((value) => String(value || "").trim())
      .find(Boolean);
    const password = [record.password, record.pass, record.pwd]
      .map((value) => String(value || "").trim())
      .find(Boolean);

    if (account && password) {
      return `${account} | ${password}`;
    }

    return null;
  }

  private unwrapManualDeliveryEnvelope(value: string | null | undefined) {
    const normalized = String(value || "").trim();

    if (normalized.startsWith("{") && normalized.endsWith("}")) {
      return normalized.slice(1, -1).trim();
    }

    return normalized;
  }

  private sanitizeDeliveryEntry(value: string) {
    return value
      .trim()
      .replace(/^[{[]+/, "")
      .replace(/[}\],;]+$/, "")
      .trim();
  }

  private buildManualInventoryKey(prefix: string, seed: string) {
    return `${prefix}_${createHash("sha1").update(seed).digest("hex").slice(0, 16)}`;
  }

  private buildClassificationFields(
    dto: Partial<CreateManualProductDto & UpdateProductDto>,
  ): SourceProductBusinessFields {
    return {
      productFamily: dto.productFamily ?? undefined,
      productFamilyOther:
        dto.productFamily === "OTHER"
          ? dto.productFamilyOther?.trim() || null
          : dto.productFamilyOther !== undefined
            ? null
            : undefined,
      productPackage: dto.productPackage !== undefined ? (dto.productPackage?.trim() || null) : undefined,
      accountType: dto.accountType ?? undefined,
      accountTypeOther:
        dto.accountType === "OTHER"
          ? dto.accountTypeOther?.trim() || null
          : dto.accountTypeOther !== undefined
            ? null
            : undefined,
      durationType: dto.durationType ?? undefined,
      durationTypeOther:
        dto.durationType === "OTHER"
          ? dto.durationTypeOther?.trim() || null
          : dto.durationTypeOther !== undefined
            ? null
            : undefined,
      sourceDeliveryMode: dto.sourceDeliveryMode ?? undefined,
      warrantyPolicy: dto.warrantyPolicy ?? undefined,
    };
  }

  private buildWholesaleFields(
    dto: Partial<CreateManualProductDto & UpdateProductDto>,
  ): SourceProductBusinessFields {
    return {
      internalSourceEnabled: dto.internalSourceEnabled ?? undefined,
      internalSourcePrice:
        dto.internalSourcePrice !== undefined
          ? toDecimal(dto.internalSourcePrice)
          : undefined,
    };
  }

  private deriveSourceDeliveryMode(
    isShared: boolean,
    deliveryEntryCount: number,
  ): CreateManualProductDto["sourceDeliveryMode"] {
    if (!isShared && deliveryEntryCount > 0) return "AUTO_STOCK";
    return "MANUAL";
  }

  async uploadProductImage(_user: AuthenticatedUser, file: Express.Multer.File): Promise<{ url: string }> {
    if (!file) throw new BadRequestException("No file uploaded.");
    const ext = extname(file.originalname).toLowerCase() || ".jpg";
    const filename = `${randomUUID()}${ext}`;
    const dir = join(process.cwd(), "uploads", "products");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), file.buffer);
    return { url: `${this.config.appPublicUrl}/uploads/products/${filename}` };
  }

  private async triggerDownstreamSync(upstreamShopId: string) {
    const connections = await this.prisma.downstreamSourceConnection.findMany({
      where: { upstreamShopId, status: "ACTIVE" },
      select: { downstreamShopId: true },
    });
    for (const conn of connections) {
      await this.queueService.addSyncCatalogJob(conn.downstreamShopId);
      this.shopsService.syncCatalogForShop(conn.downstreamShopId).catch(() => {});
    }
  }
}
