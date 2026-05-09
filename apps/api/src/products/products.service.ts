import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, SellerTier } from "@prisma/client";

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
  ) {}

  async listProducts(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const all = await this.shopsService.getCatalogViewForShop(shop.id);
    return all.filter((p) => p.available === null || p.available > 0);
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

    const normalizedDeliveryText = this.normalizeManualDeliveryText(dto.deliveryText);
    const deliveryEntries = this.parseManualDeliveryEntries(normalizedDeliveryText);
    const available =
      deliveryEntries.length > 0
        ? deliveryEntries.length
        : dto.available !== undefined
          ? dto.available
          : null;
    const businessFields =
      user.sellerTier === SellerTier.ULTRA
        ? this.buildSourceProductBusinessFields(dto)
        : {};

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
        ...businessFields,
        metadataJson: {
          manual: true,
          deliveryText: normalizedDeliveryText,
          deliveryEntries,
          hiddenDeliveredKeys: [],
          sourceDescription: dto.sourceDescription?.trim() || null,
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

    return this.getProduct(user, created.id);
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
    const businessFields =
      user.sellerTier === SellerTier.ULTRA
        ? this.buildSourceProductBusinessFields(dto)
        : {};

    if (isManual) {
      const currentMetadata = this.asRecord(product.metadataJson);
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
            deliveryText: normalizedDeliveryText,
            deliveryEntries,
            sourceDescription:
              dto.sourceDescription !== undefined
                ? dto.sourceDescription.trim() || null
                : currentMetadata.sourceDescription ?? product.sourceDescription ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    } else if (Object.keys(businessFields).length > 0) {
      await this.prisma.sourceProduct.update({
        where: { id: product.id },
        data: businessFields,
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
    }

    return this.getProduct(user, id);
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

  private buildSourceProductBusinessFields(
    dto: Partial<CreateManualProductDto & UpdateProductDto>,
  ): SourceProductBusinessFields {
    return {
      internalSourceEnabled: dto.internalSourceEnabled ?? undefined,
      internalSourcePrice:
        dto.internalSourcePrice !== undefined
          ? toDecimal(dto.internalSourcePrice)
          : undefined,
      productFamily: dto.productFamily ?? undefined,
      productFamilyOther:
        dto.productFamily === "OTHER"
          ? dto.productFamilyOther?.trim() || null
          : dto.productFamilyOther !== undefined
            ? null
            : undefined,
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

  private async triggerDownstreamSync(upstreamShopId: string) {
    const connections = await this.prisma.downstreamSourceConnection.findMany({
      where: { upstreamShopId, status: "ACTIVE" },
      select: { downstreamShopId: true },
    });
    for (const conn of connections) {
      await this.queueService.addSyncCatalogJob(conn.downstreamShopId);
    }
  }
}
