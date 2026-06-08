import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";
import type { CreateProductFamilyDto, UpdateProductFamilyDto } from "./product-family.dto";

@Injectable()
export class ProductFamilyService {
  constructor(private readonly prisma: PrismaService) {}

  /** For dropdowns — active families only, ordered. */
  listActive() {
    return this.prisma.productFamily.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { key: true, label: true, emoji: true, customEmojiId: true },
    });
  }

  /** Admin management — every family including inactive. */
  listAll() {
    return this.prisma.productFamily.findMany({
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
  }

  async create(dto: CreateProductFamilyDto) {
    const key = this.normalizeKey(dto.key);
    if (!key) {
      throw new BadRequestException("Mã dòng sản phẩm (key) không hợp lệ.");
    }
    const existing = await this.prisma.productFamily.findUnique({ where: { key } });
    if (existing) {
      throw new BadRequestException(`Dòng sản phẩm "${key}" đã tồn tại.`);
    }
    return this.prisma.productFamily.create({
      data: {
        key,
        label: dto.label.trim(),
        emoji: dto.emoji?.trim() || null,
        customEmojiId: dto.customEmojiId?.trim() || null,
        sortOrder: dto.sortOrder ?? 50,
        isActive: true,
        isBuiltin: false,
      },
    });
  }

  async update(id: string, dto: UpdateProductFamilyDto) {
    const family = await this.prisma.productFamily.findUnique({ where: { id } });
    if (!family) {
      throw new NotFoundException("Không tìm thấy dòng sản phẩm.");
    }
    return this.prisma.productFamily.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.emoji !== undefined ? { emoji: dto.emoji.trim() || null } : {}),
        ...(dto.customEmojiId !== undefined ? { customEmojiId: dto.customEmojiId.trim() || null } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(id: string) {
    const family = await this.prisma.productFamily.findUnique({ where: { id } });
    if (!family) {
      throw new NotFoundException("Không tìm thấy dòng sản phẩm.");
    }
    if (family.isBuiltin) {
      throw new BadRequestException("Không thể xoá dòng mặc định — hãy tắt (ẩn) thay vì xoá.");
    }
    const inUse = await this.prisma.sourceProduct.count({ where: { productFamily: family.key } });
    if (inUse > 0) {
      throw new BadRequestException(
        `Dòng này đang được dùng bởi ${inUse} sản phẩm. Đổi dòng cho chúng trước khi xoá.`,
      );
    }
    await this.prisma.productFamily.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Reject an unknown/inactive family key. `OTHER` and empty are always allowed
   * (empty = no family; OTHER pairs with the free-text productFamilyOther field).
   * Used by product/source DTOs at the service layer in place of the old @IsEnum.
   */
  async assertValidKey(key?: string | null) {
    const k = (key ?? "").trim();
    if (!k || k === "OTHER") {
      return;
    }
    const family = await this.prisma.productFamily.findUnique({ where: { key: k } });
    if (!family || !family.isActive) {
      throw new BadRequestException(`Dòng sản phẩm không hợp lệ: ${k}`);
    }
  }

  private normalizeKey(raw: string) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }
}
