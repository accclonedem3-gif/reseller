import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  Prisma,
  ProviderKind,
  StockExtractMethod,
  StockOperationType,
} from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import type { AuthenticatedUser } from "../types";

import type {
  ExtractSourceStockDto,
  SourceStockHistoryQueryDto,
} from "./source-stock.dto";

@Injectable()
export class SourceStockService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async uploadStock(
    user: AuthenticatedUser,
    productId: string,
    rawText: string | null | undefined,
  ) {
    const newEntries = this.parseStockText(rawText);

    if (newEntries.length === 0) {
      throw new BadRequestException("Không có dòng kho hợp lệ trong nội dung gửi lên.");
    }

    const product = await this.loadOwnedSourceProduct(user, productId);

    const preview = newEntries.slice(0, 3);

    const result = await this.prisma.$transaction(async (tx) => {
      // Row-level lock to prevent lost-update races with concurrent
      // extracts / worker deliveries / other uploads.
      await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM source_products WHERE id = ${product.id} FOR UPDATE`,
      );

      const fresh = await tx.sourceProduct.findUnique({
        where: { id: product.id },
        select: { metadataJson: true, available: true },
      });

      if (!fresh) {
        throw new NotFoundException("Sản phẩm không tồn tại.");
      }

      const freshMeta = this.asRecord(fresh.metadataJson);
      const freshEntries = this.readDeliveryEntries(freshMeta);
      const availableBefore = freshEntries.length;
      const mergedEntries = [...freshEntries, ...newEntries];
      const availableAfter = mergedEntries.length;
      const mergedDeliveryText = this.toDeliveryText(mergedEntries);

      await tx.sourceProduct.update({
        where: { id: product.id },
        data: {
          available: availableAfter,
          totalCount: Math.max(product.soldCount + availableAfter, product.totalCount),
          metadataJson: {
            ...freshMeta,
            manual: true,
            deliveryEntries: mergedEntries,
            deliveryText: mergedDeliveryText,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.productStockOperation.create({
        data: {
          sourceProductId: product.id,
          operationType: StockOperationType.UPLOAD,
          quantity: newEntries.length,
          availableBefore,
          availableAfter,
          payloadJson: { preview, scope: "source" } as Prisma.InputJsonValue,
        },
      });

      return { availableBefore, availableAfter };
    });

    return {
      added: newEntries.length,
      totalBefore: result.availableBefore,
      totalAfter: result.availableAfter,
      preview,
    };
  }

  async extractStock(
    user: AuthenticatedUser,
    productId: string,
    dto: ExtractSourceStockDto,
  ) {
    const quantity = Number(dto.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException("Quantity phải là số nguyên dương.");
    }

    const product = await this.loadOwnedSourceProduct(user, productId);

    const result = await this.prisma.$transaction(async (tx) => {
      // Row-level lock to prevent concurrent extracts
      await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM source_products WHERE id = ${product.id} FOR UPDATE`,
      );

      const locked = await tx.sourceProduct.findUnique({
        where: { id: product.id },
        select: {
          id: true,
          metadataJson: true,
          soldCount: true,
          totalCount: true,
        },
      });

      if (!locked) {
        throw new NotFoundException("Sản phẩm không tồn tại.");
      }

      const metadataBefore = this.asRecord(locked.metadataJson);
      const entries = this.readDeliveryEntries(metadataBefore);
      const availableBefore = entries.length;

      if (availableBefore < quantity) {
        throw new BadRequestException(
          `Kho không đủ. Hiện có ${availableBefore}, yêu cầu ${quantity}.`,
        );
      }

      const { extracted, remaining } = this.popByMethod(entries, quantity, dto.method);
      const availableAfter = remaining.length;
      const remainingDeliveryText = this.toDeliveryText(remaining);

      await tx.sourceProduct.update({
        where: { id: locked.id },
        data: {
          available: availableAfter,
          metadataJson: {
            ...metadataBefore,
            manual: true,
            deliveryEntries: remaining,
            deliveryText: remainingDeliveryText,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.productStockOperation.create({
        data: {
          sourceProductId: locked.id,
          operationType: StockOperationType.EXTRACT,
          extractMethod: dto.method,
          quantity,
          availableBefore,
          availableAfter,
          payloadJson: {
            preview: extracted.slice(0, 3),
            scope: "source",
          } as Prisma.InputJsonValue,
        },
      });

      return { extracted, availableBefore, availableAfter };
    });

    return {
      extracted: result.extracted,
      totalBefore: result.availableBefore,
      totalAfter: result.availableAfter,
      method: dto.method,
    };
  }

  async listHistory(
    user: AuthenticatedUser,
    productId: string,
    query: SourceStockHistoryQueryDto,
  ) {
    const product = await this.loadOwnedSourceProduct(user, productId);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productStockOperation.findMany({
        where: { sourceProductId: product.id },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.prisma.productStockOperation.count({
        where: { sourceProductId: product.id },
      }),
    ]);

    return { items, total };
  }

  /**
   * Loads a SourceProduct that the ULTRA user owns AS A SOURCE PROVIDER.
   * Ownership rules (all must hold):
   *  - shop.seller.userId === user.id
   *  - sourceProduct.internalSourceEnabled === true  (published to downstream PRO)
   *  - shop.providerConfig.providerKind === INTERNAL (shop acts as internal source)
   */
  private async loadOwnedSourceProduct(user: AuthenticatedUser, productId: string) {
    const product = await this.prisma.sourceProduct.findUnique({
      where: { id: productId },
      include: {
        shop: {
          select: {
            id: true,
            seller: {
              select: { id: true, userId: true },
            },
            providerConfig: {
              select: { providerKind: true },
            },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException("Sản phẩm không tồn tại.");
    }

    if (!product.shop?.seller || product.shop.seller.userId !== user.id) {
      throw new ForbiddenException("Bạn không có quyền truy cập sản phẩm này.");
    }

    if (!product.internalSourceEnabled) {
      throw new ForbiddenException(
        "Sản phẩm chưa được bật làm nguồn nội bộ. Bật 'internal source' trước khi quản lý kho nguồn.",
      );
    }

    if (product.shop.providerConfig?.providerKind !== ProviderKind.INTERNAL) {
      throw new ForbiddenException(
        "Shop của bạn chưa được cấu hình làm nguồn nội bộ (INTERNAL).",
      );
    }

    return product;
  }

  private parseStockText(rawText: string | null | undefined): string[] {
    if (rawText == null) return [];
    let text = String(rawText);
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
    text = text.replace(/\r\n/g, "\n").trim();
    if (!text) return [];

    const parts = text.includes("\n\n")
      ? text.split(/\n\n+/)
      : text.split(/\r?\n/);

    return parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }

  private popByMethod(
    entries: string[],
    quantity: number,
    method: StockExtractMethod,
  ): { extracted: string[]; remaining: string[] } {
    if (method === StockExtractMethod.FIFO) {
      return {
        extracted: entries.slice(0, quantity),
        remaining: entries.slice(quantity),
      };
    }

    if (method === StockExtractMethod.LIFO) {
      const tail = entries.slice(-quantity);
      return {
        extracted: tail.slice().reverse(),
        remaining: entries.slice(0, entries.length - quantity),
      };
    }

    // RANDOM — Fisher-Yates on indices, then split preserving uniqueness
    const indices = entries.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const tmp = indices[i]!;
      indices[i] = indices[j]!;
      indices[j] = tmp;
    }
    const pickedSet = new Set(indices.slice(0, quantity));
    const extracted: string[] = [];
    const remaining: string[] = [];
    indices.slice(0, quantity).forEach((idx) => extracted.push(entries[idx]!));
    entries.forEach((entry, idx) => {
      if (!pickedSet.has(idx)) remaining.push(entry);
    });
    return { extracted, remaining };
  }

  private readDeliveryEntries(metadata: Record<string, any>): string[] {
    if (Array.isArray(metadata.deliveryEntries)) {
      return metadata.deliveryEntries
        .map((entry: unknown) => String(entry || "").trim())
        .filter(Boolean);
    }

    if (typeof metadata.deliveryText === "string") {
      const normalized = metadata.deliveryText.replace(/\r\n/g, "\n").trim();
      if (!normalized) return [];
      const parts = normalized.includes("\n\n")
        ? normalized.split(/\n\n+/)
        : normalized.split(/\r?\n/);
      return parts.map((entry: string) => entry.trim()).filter(Boolean);
    }

    return [];
  }

  private toDeliveryText(entries: string[]): string | null {
    if (entries.length === 0) return null;
    return entries.join("\n\n");
  }

  private asRecord(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {} as Record<string, any>;
    }
    return value as Record<string, any>;
  }
}
