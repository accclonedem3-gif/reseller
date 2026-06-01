import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";
import { decimalToNumber, toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";

const CODE_REGEX = /^[A-Z0-9_-]{3,32}$/;

@Injectable()
export class DiscountCodesService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async createDiscountCode(
    adminUser: AuthenticatedUser,
    input: {
      code: string;
      discountPercent: number;
      referrerSellerId: string;
      description?: string;
    },
  ) {
    if (adminUser.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only super admin can create discount codes.");
    }

    const code = input.code.trim().toUpperCase();
    if (!CODE_REGEX.test(code)) {
      throw new BadRequestException("Mã chỉ chấp nhận chữ in hoa, số, '_' và '-', dài 3-32 ký tự.");
    }

    const pct = Number(input.discountPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      throw new BadRequestException("Phần trăm giảm phải trong khoảng (0; 100].");
    }

    const referrer = await this.prisma.seller.findUnique({
      where: { id: input.referrerSellerId },
      select: { id: true },
    });
    if (!referrer) throw new BadRequestException("Referrer seller không tồn tại.");

    const existing = await this.prisma.discountCode.findUnique({ where: { code } });
    if (existing) throw new BadRequestException(`Mã '${code}' đã tồn tại.`);

    return this.prisma.discountCode.create({
      data: {
        code,
        discountPercent: toDecimal(pct),
        description: input.description?.trim() || null,
        referrerSellerId: input.referrerSellerId,
        createdByUserId: adminUser.id,
      },
    });
  }

  async listDiscountCodes(adminUser: AuthenticatedUser) {
    if (adminUser.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only super admin can list discount codes.");
    }
    return this.prisma.discountCode.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      include: {
        referrerSeller: {
          select: { id: true, displayName: true, user: { select: { email: true } } },
        },
        _count: { select: { usages: true } },
      },
      take: 200,
    });
  }

  async toggleActive(adminUser: AuthenticatedUser, codeId: string, active: boolean) {
    if (adminUser.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only super admin can update discount codes.");
    }
    const code = await this.prisma.discountCode.findUnique({ where: { id: codeId } });
    if (!code) throw new NotFoundException("Discount code not found.");
    return this.prisma.discountCode.update({
      where: { id: codeId },
      data: { active },
    });
  }

  /**
   * Validate a discount code for use by a seller.
   * Returns the code (with discountPercent, referrerSellerId) if usable, throws otherwise.
   * Does NOT mark it used — call applyAndMarkUsed inside the purchase transaction.
   */
  async validateForSeller(rawCode: string, sellerId: string) {
    const code = rawCode.trim().toUpperCase();
    const row = await this.prisma.discountCode.findUnique({
      where: { code },
      include: {
        usages: {
          where: { sellerId },
          select: { id: true },
        },
      },
    });
    if (!row) throw new BadRequestException("Mã giảm giá không tồn tại.");
    if (!row.active) throw new BadRequestException("Mã giảm giá đã bị vô hiệu hóa.");
    if (row.referrerSellerId === sellerId) {
      throw new BadRequestException("Không thể tự dùng mã của chính mình.");
    }
    if (row.usages.length > 0) {
      throw new BadRequestException("Bạn đã dùng mã này rồi.");
    }
    return {
      id: row.id,
      code: row.code,
      discountPercent: decimalToNumber(row.discountPercent),
      referrerSellerId: row.referrerSellerId,
    };
  }
}
