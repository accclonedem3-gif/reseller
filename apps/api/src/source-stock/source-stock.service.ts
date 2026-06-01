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
  StockEntryStatus,
  StockExtractMethod,
  StockOperationType,
} from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import { TelegramBotService } from "../lib/telegram-bot.service.v2";
import type { AuthenticatedUser } from "../types";

import type {
  CreateSourceBatchDto,
  ExtractSourceStockDto,
  SourceStockEntriesQueryDto,
  SourceStockHistoryQueryDto,
} from "./source-stock.dto";

@Injectable()
export class SourceStockService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TelegramBotService)
    private readonly telegramBotService: TelegramBotService,
  ) {}

  // ============================================================
  // BATCHES
  // ============================================================

  async listBatches(user: AuthenticatedUser, productId: string) {
    const product = await this.loadOwnedSourceProduct(user, productId);
    const batches = await this.prisma.stockBatch.findMany({
      where: { sourceProductId: product.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { entries: true } } },
    });
    const batchIds = batches.map((b) => b.id);
    const availableCounts = batchIds.length > 0
      ? await this.prisma.stockEntry.groupBy({
          by: ["batchId"],
          where: {
            sourceProductId: product.id,
            batchId: { in: batchIds },
            status: StockEntryStatus.AVAILABLE,
          },
          _count: { _all: true },
        })
      : [];
    const availableByBatch = new Map<string, number>();
    for (const row of availableCounts) {
      if (row.batchId) availableByBatch.set(row.batchId, row._count._all);
    }
    const legacyAvailable = await this.prisma.stockEntry.count({
      where: {
        sourceProductId: product.id,
        batchId: null,
        status: StockEntryStatus.AVAILABLE,
      },
    });

    return {
      legacy: { availableCount: legacyAvailable },
      batches: batches.map((b) => ({
        id: b.id,
        name: b.name,
        costPerUnit: b.costPerUnit ? Number(b.costPerUnit) : null,
        expiresAt: b.expiresAt,
        createdAt: b.createdAt,
        totalCount: b._count.entries,
        availableCount: availableByBatch.get(b.id) ?? 0,
        isExpired: !!b.expiresAt && b.expiresAt < new Date(),
      })),
    };
  }

  async createBatch(user: AuthenticatedUser, productId: string, dto: CreateSourceBatchDto) {
    const product = await this.loadOwnedSourceProduct(user, productId);
    const entries = this.parseStockText(dto.text);
    if (entries.length === 0) {
      throw new BadRequestException("Chưa có dòng tài khoản hợp lệ trong nội dung.");
    }
    const name = String(dto.name || "").trim();
    if (!name) throw new BadRequestException("Cần tên lô.");
    const costPerUnit = this.resolveCostPerUnit(dto, entries.length);

    let expiresAt: Date | null = null;
    if (typeof dto.expiresInDays === "number" && Number.isFinite(dto.expiresInDays) && dto.expiresInDays > 0) {
      expiresAt = new Date(Date.now() + Math.floor(dto.expiresInDays) * 24 * 60 * 60 * 1000);
    } else if (dto.expiresAt) {
      const parsed = new Date(dto.expiresAt);
      if (!Number.isNaN(parsed.getTime())) expiresAt = parsed;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM source_products WHERE id = ${product.id} FOR UPDATE`,
      );

      const batch = await tx.stockBatch.create({
        data: {
          sourceProductId: product.id,
          name,
          costPerUnit: costPerUnit !== null ? new Prisma.Decimal(costPerUnit) : null,
          expiresAt,
        },
      });

      const uploadedAt = new Date();
      await tx.stockEntry.createMany({
        data: entries.map((text) => ({
          sourceProductId: product.id,
          batchId: batch.id,
          text,
          status: StockEntryStatus.AVAILABLE,
          uploadedAt,
        })),
      });

      const availableTotal = await tx.stockEntry.count({
        where: { sourceProductId: product.id, status: StockEntryStatus.AVAILABLE },
      });
      await tx.sourceProduct.update({
        where: { id: product.id },
        data: { available: availableTotal },
      });

      await tx.productStockOperation.create({
        data: {
          sourceProductId: product.id,
          operationType: StockOperationType.UPLOAD,
          quantity: entries.length,
          availableBefore: availableTotal - entries.length,
          availableAfter: availableTotal,
          payloadJson: {
            preview: entries.slice(0, 3),
            scope: "source",
            batchId: batch.id,
            batchName: name,
            costPerUnit,
            expiresAt: expiresAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      return { batch, addedCount: entries.length, availableTotal };
    });

    this.telegramBotService
      .sendCatalogStockUpdateMessages(product.shopId, [
        {
          externalProductId: product.externalProductId,
          displayName: product.sourceName,
          addedQuantity: result.addedCount,
          available: result.availableTotal,
        },
      ])
      .catch(() => undefined);

    return {
      batchId: result.batch.id,
      batchName: result.batch.name,
      added: result.addedCount,
      totalAfter: result.availableTotal,
      preview: entries.slice(0, 3),
    };
  }

  async deleteBatch(user: AuthenticatedUser, productId: string, batchId: string) {
    const product = await this.loadOwnedSourceProduct(user, productId);
    const batch = await this.prisma.stockBatch.findFirst({
      where: { id: batchId, sourceProductId: product.id, deletedAt: null },
    });
    if (!batch) throw new NotFoundException("Lô không tồn tại.");

    const remaining = await this.prisma.stockEntry.count({
      where: { batchId: batch.id, status: StockEntryStatus.AVAILABLE },
    });
    if (remaining > 0) {
      throw new BadRequestException(
        `Lô còn ${remaining} tài khoản chưa bán. Hãy bóc hết hoặc đợi bán hết trước khi xóa.`,
      );
    }
    await this.prisma.stockBatch.update({
      where: { id: batch.id },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  async uploadStock(user: AuthenticatedUser, productId: string, rawText: string) {
    return this.createBatch(user, productId, {
      name: `Lô ${this.formatDateForName(new Date())}`,
      text: rawText,
      costPerAcc: 0,
    });
  }

  // ============================================================
  // EXTRACT
  // ============================================================

  async extractStock(user: AuthenticatedUser, productId: string, dto: ExtractSourceStockDto) {
    const product = await this.loadOwnedSourceProduct(user, productId);
    const dryRun = !!dto.dryRun;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM source_products WHERE id = ${product.id} FOR UPDATE`,
      );

      const availableEntries = await tx.stockEntry.findMany({
        where: { sourceProductId: product.id, status: StockEntryStatus.AVAILABLE },
        orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
        select: { id: true, text: true, batchId: true, uploadedAt: true },
      });
      const availableBefore = availableEntries.length;

      let pickedIds: string[] = [];
      let methodUsed: StockExtractMethod;

      if (dto.mode === "FAST") {
        const quantity = Number(dto.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new BadRequestException("quantity phải là số nguyên dương.");
        }
        if (availableBefore < quantity) {
          throw new BadRequestException(`Kho không đủ. Hiện có ${availableBefore}, yêu cầu ${quantity}.`);
        }
        const method = dto.method ?? StockExtractMethod.FIFO;
        methodUsed = method;
        pickedIds = this.pickIdsByMethod(availableEntries, quantity, method);
      } else if (dto.mode === "RANGE") {
        const fromIndex = Number(dto.fromIndex);
        const toIndex = Number(dto.toIndex);
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
          throw new BadRequestException("fromIndex và toIndex là bắt buộc cho mode RANGE.");
        }
        if (!(fromIndex >= 1 && fromIndex <= toIndex && toIndex <= availableBefore)) {
          throw new BadRequestException(
            `Khoảng không hợp lệ. Yêu cầu 1 ≤ fromIndex (${fromIndex}) ≤ toIndex (${toIndex}) ≤ ${availableBefore}.`,
          );
        }
        pickedIds = availableEntries.slice(fromIndex - 1, toIndex).map((e) => e.id);
        methodUsed = StockExtractMethod.RANGE;
      } else if (dto.mode === "MANUAL_BY_INDEX") {
        const indices = Array.isArray(dto.selectedIndices) ? dto.selectedIndices : [];
        if (indices.length === 0) {
          throw new BadRequestException("selectedIndices không được rỗng.");
        }
        const uniq = new Set<number>();
        for (const raw of indices) {
          const idx = Number(raw);
          if (!Number.isInteger(idx) || idx < 1 || idx > availableBefore) {
            throw new BadRequestException(`Index không hợp lệ: ${idx}.`);
          }
          uniq.add(idx);
        }
        if (uniq.size !== indices.length) {
          throw new BadRequestException("selectedIndices chứa giá trị trùng lặp.");
        }
        pickedIds = Array.from(uniq).sort((a, b) => a - b).map((i) => availableEntries[i - 1]!.id);
        methodUsed = StockExtractMethod.MANUAL;
      } else if (dto.mode === "MANUAL_BY_ID") {
        const ids = Array.isArray(dto.entryIds) ? dto.entryIds : [];
        if (ids.length === 0) {
          throw new BadRequestException("entryIds không được rỗng.");
        }
        const idSet = new Set(ids);
        if (idSet.size !== ids.length) {
          throw new BadRequestException("entryIds chứa giá trị trùng lặp.");
        }
        const availableIds = new Set(availableEntries.map((e) => e.id));
        for (const id of idSet) {
          if (!availableIds.has(id)) {
            throw new BadRequestException(`Entry ${id} không có trong kho available.`);
          }
        }
        pickedIds = availableEntries.filter((e) => idSet.has(e.id)).map((e) => e.id);
        methodUsed = StockExtractMethod.MANUAL;
      } else if (dto.mode === "BATCH") {
        if (!dto.batchId) {
          throw new BadRequestException("batchId bắt buộc cho mode BATCH.");
        }
        const batchEntries = availableEntries.filter((e) => e.batchId === dto.batchId);
        if (batchEntries.length === 0) {
          throw new BadRequestException("Lô này không còn tài khoản available.");
        }
        pickedIds = batchEntries.map((e) => e.id);
        methodUsed = StockExtractMethod.MANUAL;
      } else {
        throw new BadRequestException("mode không hợp lệ.");
      }

      const extracted = availableEntries
        .filter((e) => pickedIds.includes(e.id))
        .map((e) => e.text);

      if (!dryRun) {
        await tx.stockEntry.updateMany({
          where: { id: { in: pickedIds } },
          data: {
            status: StockEntryStatus.EXTRACTED,
            extractedAt: new Date(),
          },
        });
      }

      const availableAfter = dryRun ? availableBefore : availableBefore - pickedIds.length;

      if (!dryRun) {
        await tx.sourceProduct.update({
          where: { id: product.id },
          data: { available: availableAfter },
        });
        await this.autoCleanEmptyBatches(tx, product.id);
      }

      await tx.productStockOperation.create({
        data: {
          sourceProductId: product.id,
          operationType: dryRun ? StockOperationType.PREVIEW : StockOperationType.EXTRACT,
          extractMethod: methodUsed,
          quantity: pickedIds.length,
          availableBefore,
          availableAfter,
          payloadJson: {
            preview: extracted.slice(0, 3),
            scope: "source",
            mode: dto.mode,
            dryRun,
            ...(dto.batchId ? { batchId: dto.batchId } : {}),
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

  // ============================================================
  // ENTRIES
  // ============================================================

  async listEntries(
    user: AuthenticatedUser,
    productId: string,
    query: SourceStockEntriesQueryDto,
  ) {
    const product = await this.loadOwnedSourceProduct(user, productId);
    const limit = Math.min(Math.max(Number(query.limit) || 500, 1), 2000);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const searchRaw = typeof query.search === "string" ? query.search.trim() : "";
    const search = searchRaw.length > 0 ? searchRaw : null;
    const status = (query.status as StockEntryStatus | undefined) ?? null;

    const where: Prisma.StockEntryWhereInput = { sourceProductId: product.id };
    if (status) where.status = status;
    if (query.batchId) where.batchId = query.batchId;
    if (search) where.text = { contains: search, mode: "insensitive" };

    const [items, total, available, sold, extractedCount] = await Promise.all([
      this.prisma.stockEntry.findMany({
        where,
        orderBy: [
          { batchId: { sort: "asc", nulls: "first" } },
          { uploadedAt: "asc" },
          { id: "asc" },
        ],
        skip: offset,
        take: limit,
        include: {
          batch: { select: { id: true, name: true, costPerUnit: true, expiresAt: true } },
          soldToOrder: { select: { id: true, orderCode: true, deliveredAt: true } },
          soldToCustomer: {
            select: { id: true, telegramUsername: true, telegramUserId: true, firstName: true },
          },
        },
      }),
      this.prisma.stockEntry.count({ where }),
      this.prisma.stockEntry.count({
        where: { sourceProductId: product.id, status: StockEntryStatus.AVAILABLE },
      }),
      this.prisma.stockEntry.count({
        where: { sourceProductId: product.id, status: StockEntryStatus.SOLD },
      }),
      this.prisma.stockEntry.count({
        where: { sourceProductId: product.id, status: StockEntryStatus.EXTRACTED },
      }),
    ]);

    return {
      items: items.map((e) => ({
        id: e.id,
        text: e.text,
        status: e.status,
        uploadedAt: e.uploadedAt,
        soldAt: e.soldAt,
        extractedAt: e.extractedAt,
        batchId: e.batchId,
        batchName: e.batch?.name ?? null,
        batchCost: e.batch?.costPerUnit ? Number(e.batch.costPerUnit) : null,
        batchExpiresAt: e.batch?.expiresAt ?? null,
        soldToOrder: e.soldToOrder
          ? {
              id: e.soldToOrder.id,
              code: e.soldToOrder.orderCode,
              deliveredAt: e.soldToOrder.deliveredAt,
            }
          : null,
        soldToCustomer: e.soldToCustomer
          ? {
              id: e.soldToCustomer.id,
              telegramUsername: e.soldToCustomer.telegramUsername,
              telegramUserId: e.soldToCustomer.telegramUserId,
              firstName: e.soldToCustomer.firstName,
            }
          : null,
      })),
      total,
      counts: { available, sold, extracted: extractedCount },
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
      this.prisma.productStockOperation.count({ where: { sourceProductId: product.id } }),
    ]);

    return { items, total };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async loadOwnedSourceProduct(user: AuthenticatedUser, productId: string) {
    const product = await this.prisma.sourceProduct.findUnique({
      where: { id: productId },
      include: {
        shop: {
          select: {
            id: true,
            seller: { select: { id: true, userId: true } },
            providerConfig: { select: { providerKind: true } },
          },
        },
      },
    });
    if (!product) throw new NotFoundException("Sản phẩm không tồn tại.");
    if (!product.shop?.seller || product.shop.seller.userId !== user.id) {
      throw new ForbiddenException("Bạn không có quyền truy cập sản phẩm này.");
    }
    if (!product.internalSourceEnabled) {
      throw new ForbiddenException(
        "Sản phẩm chưa được bật làm nguồn nội bộ. Bật 'internal source' trước.",
      );
    }
    if (product.shop.providerConfig?.providerKind !== ProviderKind.INTERNAL) {
      throw new ForbiddenException("Shop chưa cấu hình làm nguồn nội bộ (INTERNAL).");
    }
    return product;
  }

  private parseStockText(rawText: string | null | undefined): string[] {
    if (rawText == null) return [];
    let text = String(rawText);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.replace(/\r\n/g, "\n").trim();
    if (!text) return [];
    const parts = text.includes("\n\n") ? text.split(/\n\n+/) : text.split(/\r?\n/);
    return parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }

  private resolveCostPerUnit(dto: CreateSourceBatchDto, entryCount: number): number | null {
    if (typeof dto.costPerAcc === "number" && Number.isFinite(dto.costPerAcc) && dto.costPerAcc >= 0) {
      return Math.round(dto.costPerAcc * 100) / 100;
    }
    if (
      typeof dto.totalCost === "number" &&
      Number.isFinite(dto.totalCost) &&
      dto.totalCost >= 0 &&
      entryCount > 0
    ) {
      return Math.round((dto.totalCost / entryCount) * 100) / 100;
    }
    return null;
  }

  private formatDateForName(d: Date): string {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm} ${hh}:${mi}`;
  }

  private pickIdsByMethod(
    entries: { id: string; text: string }[],
    quantity: number,
    method: StockExtractMethod,
  ): string[] {
    if (method === StockExtractMethod.FIFO) {
      return entries.slice(0, quantity).map((e) => e.id);
    }
    if (method === StockExtractMethod.LIFO) {
      return entries.slice(-quantity).reverse().map((e) => e.id);
    }
    const indices = entries.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const a = indices[i] as number;
      const b = indices[j] as number;
      indices[i] = b;
      indices[j] = a;
    }
    const picked = indices.slice(0, quantity);
    return picked.map((idx) => entries[idx]!.id);
  }

  private async autoCleanEmptyBatches(
    tx: Prisma.TransactionClient,
    sourceProductId: string,
  ): Promise<void> {
    const candidates = await tx.stockBatch.findMany({
      where: { sourceProductId, deletedAt: null },
      select: {
        id: true,
        _count: { select: { entries: { where: { status: StockEntryStatus.AVAILABLE } } } },
      },
    });
    const emptyIds = candidates.filter((b) => b._count.entries === 0).map((b) => b.id);
    if (emptyIds.length > 0) {
      await tx.stockBatch.updateMany({
        where: { id: { in: emptyIds } },
        data: { deletedAt: new Date() },
      });
    }
  }
}
