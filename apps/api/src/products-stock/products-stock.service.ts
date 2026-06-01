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
  StockExtractMethod,
  StockOperationType,
} from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import type { AuthenticatedUser } from "../types";

import type {
  ExtractStockDto,
  StockEntriesQueryDto,
  StockHistoryQueryDto,
} from "./products-stock.dto";

@Injectable()
export class ProductsStockService {
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

    const product = await this.loadOwnedProduct(user, productId);

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
          payloadJson: { preview } as Prisma.InputJsonValue,
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
    dto: ExtractStockDto,
  ) {
    if (!dto || !dto.mode) {
      throw new BadRequestException("mode là bắt buộc (FAST | RANGE | MANUAL).");
    }

    const dryRun = Boolean(dto.dryRun);
    const product = await this.loadOwnedProduct(user, productId);

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

      let extracted: string[] = [];
      let remaining: string[] = entries;
      let methodUsed: StockExtractMethod;

      if (dto.mode === "FAST") {
        const quantity = Number(dto.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new BadRequestException("Quantity phải là số nguyên dương.");
        }
        if (!dto.method) {
          throw new BadRequestException("method là bắt buộc cho mode FAST.");
        }
        if (availableBefore < quantity) {
          throw new BadRequestException(
            `Kho không đủ. Hiện có ${availableBefore}, yêu cầu ${quantity}.`,
          );
        }
        const popped = this.popByMethod(entries, quantity, dto.method);
        extracted = popped.extracted;
        remaining = popped.remaining;
        methodUsed = dto.method;
      } else if (dto.mode === "RANGE") {
        const fromIndex = Number(dto.fromIndex);
        const toIndex = Number(dto.toIndex);
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
          throw new BadRequestException(
            "fromIndex và toIndex là bắt buộc cho mode RANGE.",
          );
        }
        if (
          !(fromIndex >= 1 && fromIndex <= toIndex && toIndex <= availableBefore)
        ) {
          throw new BadRequestException(
            `Khoảng không hợp lệ. Yêu cầu 1 <= fromIndex (${fromIndex}) <= toIndex (${toIndex}) <= ${availableBefore}.`,
          );
        }
        extracted = entries.slice(fromIndex - 1, toIndex);
        remaining = entries.slice(0, fromIndex - 1).concat(entries.slice(toIndex));
        methodUsed = StockExtractMethod.RANGE;
      } else if (dto.mode === "MANUAL") {
        const indices = dto.selectedIndices;
        if (!Array.isArray(indices) || indices.length === 0) {
          throw new BadRequestException(
            "selectedIndices là bắt buộc và không được rỗng cho mode MANUAL.",
          );
        }
        const seen = new Set<number>();
        for (const raw of indices) {
          const idx = Number(raw);
          if (!Number.isInteger(idx) || idx < 1 || idx > availableBefore) {
            throw new BadRequestException(
              `selectedIndices chứa giá trị không hợp lệ (${raw}). Phải nằm trong 1..${availableBefore}.`,
            );
          }
          if (seen.has(idx)) {
            throw new BadRequestException(
              `selectedIndices không được trùng lặp (${idx}).`,
            );
          }
          seen.add(idx);
        }
        extracted = indices.map((i) => entries[i - 1] as string);
        remaining = entries.filter((_, idx) => !seen.has(idx + 1));
        methodUsed = StockExtractMethod.MANUAL;
      } else {
        throw new BadRequestException(
          `mode không hợp lệ: ${String((dto as any).mode)}.`,
        );
      }

      const quantityExtracted = extracted.length;

      if (dryRun) {
        await tx.productStockOperation.create({
          data: {
            sourceProductId: locked.id,
            operationType: StockOperationType.PREVIEW,
            extractMethod: methodUsed,
            quantity: quantityExtracted,
            availableBefore,
            availableAfter: availableBefore,
            payloadJson: {
              preview: extracted.slice(0, 3),
              dryRun: true,
              mode: dto.mode,
            } as Prisma.InputJsonValue,
          },
        });

        return {
          extracted,
          availableBefore,
          availableAfter: availableBefore,
          methodUsed,
        };
      }

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
          extractMethod: methodUsed,
          quantity: quantityExtracted,
          availableBefore,
          availableAfter,
          payloadJson: {
            preview: extracted.slice(0, 3),
            mode: dto.mode,
          } as Prisma.InputJsonValue,
        },
      });

      return { extracted, availableBefore, availableAfter, methodUsed };
    });

    return {
      extracted: result.extracted,
      totalBefore: result.availableBefore,
      totalAfter: result.availableAfter,
      method: result.methodUsed,
      dryRun,
    };
  }

  async listEntries(
    user: AuthenticatedUser,
    productId: string,
    query: StockEntriesQueryDto,
  ) {
    const product = await this.loadOwnedProduct(user, productId);
    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const searchRaw = typeof query.search === "string" ? query.search.trim() : "";
    const search = searchRaw.length > 0 ? searchRaw.toLowerCase() : null;

    const metadata = this.asRecord(product.metadataJson);
    const entries = this.readDeliveryEntries(metadata);
    const allItems = entries.map((text, idx) => ({ index: idx + 1, text }));
    const total = allItems.length;

    const filtered = search
      ? allItems.filter((item) => item.text.toLowerCase().includes(search))
      : allItems;
    const filteredTotal = filtered.length;

    const items = filtered.slice(offset, offset + limit);

    return { items, total, filteredTotal };
  }

  async listHistory(
    user: AuthenticatedUser,
    productId: string,
    query: StockHistoryQueryDto,
  ) {
    const product = await this.loadOwnedProduct(user, productId);
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

  private async loadOwnedProduct(user: AuthenticatedUser, productId: string) {
    const product = await this.prisma.sourceProduct.findUnique({
      where: { id: productId },
      include: {
        shop: {
          select: {
            id: true,
            seller: {
              select: { id: true, userId: true },
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
      const a = indices[i] as number;
      const b = indices[j] as number;
      indices[i] = b;
      indices[j] = a;
    }
    const pickedIndices = indices.slice(0, quantity);
    const pickedSet = new Set(pickedIndices);
    const extracted: string[] = [];
    const remaining: string[] = [];
    pickedIndices.forEach((idx) => {
      const value = entries[idx];
      if (value !== undefined) extracted.push(value);
    });
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
