import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  OrderStatus,
  Prisma,
  SellerTier,
  SourceDeliveryMode,
  SourceWarrantyPolicy,
} from "@prisma/client";
import type { WarrantyClaimStatus } from "@prisma/client";
import {
  calculateWarrantyExpiry,
  decryptSecret,
  hasWarrantyWindowExpired,
  inferDeliveryMode,
  inferWarrantyPolicy,
  isMockBotToken,
  purchaseFromProvider,
  telegramSendMessage,
} from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { AdminNotifyService } from "../lib/admin-notify.service";
import { decimalToNumber } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

import type { OpenWarrantyClaimDto, PublicWarrantyClaimDto, PublicWarrantySearchDto, RejectWarrantyClaimDto, ResolveWarrantyClaimDto } from "./warranty.dto";

const WARRANTY_CLAIM_STATUS = {
  PENDING: "PENDING",
  AUTO_RESOLVED: "AUTO_RESOLVED",
  PENDING_STOCK: "PENDING_STOCK",
  PENDING_REVIEW: "PENDING_REVIEW",
  PENDING_MANUAL: "PENDING_MANUAL",
  REJECTED: "REJECTED",
  RESOLVED_MANUAL: "RESOLVED_MANUAL",
} satisfies Record<string, WarrantyClaimStatus>;

type ClaimDecision =
  | {
      nextStatus: typeof WARRANTY_CLAIM_STATUS.AUTO_RESOLVED;
      deliveredAccountText: string;
      resolutionNote: string;
      ownerAttentionRequired: false;
      customerMessage: string;
      manualStockUpdate?: { remainingEntries: string[] };
      internalSourceStockUpdate?: { sourceProductId: string; remainingEntries: string[] };
    }
  | {
      nextStatus:
        | typeof WARRANTY_CLAIM_STATUS.PENDING_STOCK
        | typeof WARRANTY_CLAIM_STATUS.PENDING_REVIEW
        | typeof WARRANTY_CLAIM_STATUS.PENDING_MANUAL
        | typeof WARRANTY_CLAIM_STATUS.REJECTED;
      deliveredAccountText: null;
      resolutionNote: string;
      ownerAttentionRequired: boolean;
      customerMessage: string;
      manualStockUpdate?: never;
      internalSourceStockUpdate?: never;
    };

@Injectable()
export class WarrantyService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(AdminNotifyService)
    private readonly adminNotify: AdminNotifyService,
  ) {}

  /** Ping admin Telegram when a warranty claim needs human review. */
  private async notifyAdminOfClaim(claimId: string) {
    const claim = await this.prisma.warrantyClaim.findUnique({
      where: { id: claimId },
      select: {
        status: true,
        claimNumber: true,
        orderCodeSnapshot: true,
        productNameSnapshot: true,
        customerMessage: true,
        shop: { select: { name: true, seller: { select: { displayName: true } } } },
        customer: { select: { telegramUsername: true } },
      },
    });
    if (!claim) return;
    // Only ping admin for statuses that require human action
    if (claim.status !== "PENDING_REVIEW" && claim.status !== "PENDING_MANUAL") return;

    const esc = (s: string | null | undefined) => this.adminNotify.escape(s);
    const statusLabel = claim.status === "PENDING_REVIEW"
      ? "⚠️ Cần review (đã yêu cầu BH >2 lần)"
      : "📞 Cần xử lý thủ công";

    const text = [
      `🛡️ <b>Khiếu nại bảo hành mới</b>`,
      `Trạng thái: <b>${statusLabel}</b>`,
      ``,
      `Đơn: <code>${esc(claim.orderCodeSnapshot)}</code>`,
      `Sản phẩm: ${esc(claim.productNameSnapshot)}`,
      `Lần khiếu nại thứ: ${claim.claimNumber}`,
      `Shop: ${esc(claim.shop.name)} (${esc(claim.shop.seller.displayName)})`,
      `Khách: @${esc(claim.customer.telegramUsername || "?")}`,
      ``,
      `💬 ${esc(claim.customerMessage || "(không có lời nhắn)")}`,
    ].join("\n");
    const level = claim.status === "PENDING_REVIEW" ? "warning" : "info";
    this.adminNotify.send(text, { level, service: "Warranty" }).catch(() => undefined);
  }

  async snapshotWarrantyForDeliveredOrder(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || this.prisma;
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        sourceProduct: true,
      },
    });

    if (!order?.deliveredAt || order.status !== OrderStatus.DELIVERED) {
      return null;
    }

    if (order.warrantyStartedAt && order.warrantyDeliveryModeSnapshot) {
      return {
        warrantyPolicySnapshot: order.warrantyPolicySnapshot,
        warrantyDeliveryModeSnapshot: order.warrantyDeliveryModeSnapshot,
        warrantyStartedAt: order.warrantyStartedAt,
        warrantyExpiresAt: order.warrantyExpiresAt,
      };
    }

    const sourceMetadata = this.asRecord(order.sourceProduct.metadataJson);
    const inferredPolicy = inferWarrantyPolicy({
      productName: order.productNameSnapshot,
      sourceDescription: order.sourceProduct.sourceDescription,
      warrantyPolicy: order.sourceProduct.warrantyPolicy,
      sourceDeliveryMode: order.sourceProduct.sourceDeliveryMode,
      providerName: order.sourceProduct.providerName,
      metadata: sourceMetadata,
    });
    const inferredDeliveryMode = inferDeliveryMode({
      productName: order.productNameSnapshot,
      sourceDescription: order.sourceProduct.sourceDescription,
      warrantyPolicy: order.sourceProduct.warrantyPolicy,
      sourceDeliveryMode: order.sourceProduct.sourceDeliveryMode,
      providerName: order.sourceProduct.providerName,
      metadata: sourceMetadata,
    });
    const warrantyExpiresAt = calculateWarrantyExpiry(
      inferredPolicy,
      order.deliveredAt,
    );

    const snapshot = {
      warrantyPolicySnapshot: inferredPolicy as SourceWarrantyPolicy | null,
      warrantyDeliveryModeSnapshot: inferredDeliveryMode as SourceDeliveryMode | null,
      warrantyStartedAt: order.deliveredAt,
      warrantyExpiresAt,
    };

    await db.order.update({
      where: { id: order.id },
      data: snapshot,
    });

    return snapshot;
  }

  async openClaim(dto: OpenWarrantyClaimDto) {
    const normalizedCode = String(dto.orderCode || "").trim().toUpperCase();

    const order = await this.prisma.order.findFirst({
      where: { orderCode: normalizedCode },
      include: {
        customer: true,
        sourceProduct: true,
        seller: { select: { tier: true } },
        shop: {
          include: {
            providerConfig: true,
            botConfig: true,
          },
        },
        warrantyClaims: {
          where: {
            status: {
              in: [
                WARRANTY_CLAIM_STATUS.PENDING,
                WARRANTY_CLAIM_STATUS.PENDING_MANUAL,
                WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
                WARRANTY_CLAIM_STATUS.PENDING_STOCK,
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    const isPro = order.seller?.tier === SellerTier.PRO;
    const isUltra = order.seller?.tier === SellerTier.ULTRA;

    if (!isPro && !isUltra) {
      throw new BadRequestException("Warranty is not available for this shop.");
    }

    const internalSourceOrder = isPro
      ? await this.findLinkedInternalSourceOrder(order.orderCode, order.shopId)
      : null;

    if (isPro && !internalSourceOrder) {
      throw new BadRequestException("Warranty is only available for orders fulfilled via ULTRA source.");
    }

    if (order.status !== OrderStatus.DELIVERED || !order.deliveredAt) {
      throw new BadRequestException("Order is not delivered yet.");
    }

    if (order.warrantyClaims.length > 0) {
      throw new BadRequestException("A warranty claim for this order is already being processed.");
    }

    const snapshot =
      order.warrantyStartedAt && order.warrantyDeliveryModeSnapshot
        ? {
            warrantyPolicySnapshot: order.warrantyPolicySnapshot,
            warrantyDeliveryModeSnapshot: order.warrantyDeliveryModeSnapshot,
            warrantyStartedAt: order.warrantyStartedAt,
            warrantyExpiresAt: order.warrantyExpiresAt,
          }
        : await this.snapshotWarrantyForDeliveredOrder(order.id);

    if (!snapshot?.warrantyPolicySnapshot || snapshot.warrantyPolicySnapshot === SourceWarrantyPolicy.KBH) {
      throw new BadRequestException("This order does not have an active warranty policy.");
    }

    if (hasWarrantyWindowExpired(snapshot.warrantyExpiresAt)) {
      throw new BadRequestException("The warranty window for this order has expired.");
    }

    const claimNumber = order.warrantyClaimCount + 1;
    const decision = internalSourceOrder
      ? await this.decideInternalSourceClaimRoute(internalSourceOrder, claimNumber, "vi")
      : await this.decideClaimRoute(order, claimNumber, "vi");

    const replacementCostSource = internalSourceOrder?.sourceProduct.sourcePrice ?? order.sourceProduct.sourcePrice;

    const createdClaim = await this.prisma.$transaction(async (tx) => {
      if (decision.manualStockUpdate) {
        const sourceMetadata = this.asRecord(order.sourceProduct.metadataJson);
        await tx.sourceProduct.update({
          where: { id: order.sourceProductId },
          data: {
            available: decision.manualStockUpdate.remainingEntries.length,
            metadataJson: {
              ...sourceMetadata,
              manual: true,
              deliveryEntries: decision.manualStockUpdate.remainingEntries,
              deliveryText: this.normalizeManualDeliveryText(
                decision.manualStockUpdate.remainingEntries.join("\n\n"),
              ),
            } as Prisma.InputJsonValue,
          },
        });
      }

      if (decision.internalSourceStockUpdate) {
        const { sourceProductId, remainingEntries } = decision.internalSourceStockUpdate;
        const proProduct = await tx.sourceProduct.findUnique({
          where: { id: sourceProductId },
          select: { metadataJson: true },
        });
        const meta = this.asRecord(proProduct?.metadataJson);
        await tx.sourceProduct.update({
          where: { id: sourceProductId },
          data: {
            available: remainingEntries.length,
            metadataJson: {
              ...meta,
              manual: true,
              deliveryEntries: remainingEntries,
              deliveryText: this.normalizeManualDeliveryText(remainingEntries.join("\n\n")),
            } as Prisma.InputJsonValue,
          },
        });
      }

      const claim = await tx.warrantyClaim.create({
        data: {
          orderId: order.id,
          sellerId: order.sellerId,
          shopId: order.shopId,
          customerId: order.customerId,
          claimNumber,
          status: decision.nextStatus,
          orderCodeSnapshot: order.orderCode,
          productNameSnapshot: order.productNameSnapshot,
          warrantyPolicySnapshot: snapshot.warrantyPolicySnapshot,
          deliveryModeSnapshot: snapshot.warrantyDeliveryModeSnapshot,
          customerMessage: dto.customerMessage?.trim() || null,
          deliveredAccountText: decision.deliveredAccountText,
          resolutionNote: decision.resolutionNote,
          resolvedAt: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED ? new Date() : null,
          replacementCostSnapshot: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED
            ? replacementCostSource
            : null,
          metadataJson: {
            ownerAttentionRequired: decision.ownerAttentionRequired,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { warrantyClaimCount: claimNumber },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "warranty_claim_created",
          payloadJson: {
            warrantyClaimId: claim.id,
            claimNumber,
            status: decision.nextStatus,
          } as Prisma.InputJsonValue,
        },
      });

      return claim;
    });

    if (decision.ownerAttentionRequired) {
      await this.notifySellerClaimOpened(order.shopId, {
        orderCode: order.orderCode,
        productName: order.productNameSnapshot,
        claimNumber,
        status: decision.nextStatus,
        customerMessage: dto.customerMessage,
      });
      this.notifyAdminOfClaim(createdClaim.id).catch(() => undefined);
    }

    return {
      success: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
      status: decision.nextStatus.toLowerCase(),
      claimId: createdClaim.id,
      orderCode: order.orderCode,
      deliveredAccountText: decision.deliveredAccountText,
      supportTelegram: order.shop.supportTelegram,
      supportZalo: order.shop.supportZalo,
    };
  }

  async listClaims(user: AuthenticatedUser, status?: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const claims = await this.prisma.warrantyClaim.findMany({
      where: {
        shopId: shop.id,
        status: status
          ? (String(status || "").trim().toUpperCase() as WarrantyClaimStatus)
          : undefined,
      },
      include: {
        customer: true,
        order: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return claims.map((claim) => this.mapClaim(claim));
  }

  async getClaim(user: AuthenticatedUser, id: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const claim = await this.prisma.warrantyClaim.findFirst({
      where: {
        id,
        shopId: shop.id,
      },
      include: {
        customer: true,
        order: true,
      },
    });

    if (!claim) {
      throw new NotFoundException("Warranty claim not found.");
    }

    return this.mapClaim(claim);
  }

  async resolveClaimManually(
    user: AuthenticatedUser,
    id: string,
    dto: ResolveWarrantyClaimDto,
  ) {
    const claim = await this.getManagedClaim(user.id, id);

    if (this.isResolvedClaim(claim.status)) {
      throw new BadRequestException("Warranty claim is already closed.");
    }

    const deliveredAccountText = dto.deliveredAccountText.trim();
    const resolutionNote =
      dto.resolutionNote?.trim() || "Seller resolved the warranty claim manually.";

    const sourceProduct = await this.prisma.sourceProduct.findUnique({
      where: { id: claim.order.sourceProductId },
      select: { sourcePrice: true },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          status: WARRANTY_CLAIM_STATUS.RESOLVED_MANUAL,
          deliveredAccountText,
          resolutionNote,
          resolvedAt: new Date(),
          replacementCostSnapshot: sourceProduct?.sourcePrice ?? null,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          eventType: "warranty_claim_resolved_manual",
          payloadJson: {
            warrantyClaimId: claim.id,
            claimNumber: claim.claimNumber,
          } as Prisma.InputJsonValue,
        },
      });

      return tx.warrantyClaim.findUnique({
        where: { id: claim.id },
        include: {
          customer: true,
          order: true,
          shop: {
            include: {
              botConfig: true,
            },
          },
        },
      });
    });

    if (!updated) {
      throw new NotFoundException("Warranty claim not found.");
    }

    await this.notifyCustomerAboutResolvedClaim(updated);

    return this.mapClaim(updated);
  }

  async rejectClaim(
    user: AuthenticatedUser,
    id: string,
    dto: RejectWarrantyClaimDto,
  ) {
    const claim = await this.getManagedClaim(user.id, id);

    if (this.isResolvedClaim(claim.status)) {
      throw new BadRequestException("Warranty claim is already closed.");
    }

    const reason = dto.reason.trim();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          status: WARRANTY_CLAIM_STATUS.REJECTED,
          resolutionNote: reason,
          resolvedAt: new Date(),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          eventType: "warranty_claim_rejected",
          payloadJson: {
            warrantyClaimId: claim.id,
            claimNumber: claim.claimNumber,
            reason,
          } as Prisma.InputJsonValue,
        },
      });

      return tx.warrantyClaim.findUnique({
        where: { id: claim.id },
        include: {
          customer: true,
          order: true,
          shop: {
            include: {
              botConfig: true,
            },
          },
        },
      });
    });

    if (!updated) {
      throw new NotFoundException("Warranty claim not found.");
    }

    await this.notifyCustomerAboutRejectedClaim(updated, reason);

    return this.mapClaim(updated);
  }

  async checkTelegramWarrantyEligibility(input: {
    shopId: string;
    telegramUserId: string;
    orderCode: string;
    language?: "vi" | "en" | "th";
  }): Promise<{ eligible: true; orderCode: string; accounts: string[] } | { eligible: false; status: string; message: string }> {
    const normalizedOrderCode = String(input.orderCode || "").trim().toUpperCase();
    const language = input.language || "vi";

    if (!normalizedOrderCode) {
      return {
        eligible: false,
        status: "invalid",
        message: language === "en"
          ? "Please enter a valid order code."
          : language === "th" ? "กรุณาระบุรหัสคำสั่งซื้อที่ถูกต้อง"
          : "Vui lòng nhập mã đơn hàng hợp lệ.",
      };
    }

    const order = await this.prisma.order.findFirst({
      where: {
        shopId: input.shopId,
        orderCode: normalizedOrderCode,
        customer: { telegramUserId: input.telegramUserId },
      },
      include: {
        seller: { select: { tier: true } },
        warrantyClaims: {
          where: {
            status: {
              in: [
                WARRANTY_CLAIM_STATUS.PENDING,
                WARRANTY_CLAIM_STATUS.PENDING_MANUAL,
                WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
                WARRANTY_CLAIM_STATUS.PENDING_STOCK,
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!order) {
      return {
        eligible: false,
        status: "not_found",
        message: language === "en"
          ? "We could not find a delivered order with this code in your account."
          : language === "th" ? "ไม่พบคำสั่งซื้อที่จัดส่งแล้วด้วยรหัสนี้ในบัญชีของคุณ"
          : "Không tìm thấy đơn đã giao nào với mã này trong tài khoản của bạn.",
      };
    }

    if (order.seller?.tier === SellerTier.PRO) {
      const linked = await this.findLinkedInternalSourceOrder(normalizedOrderCode, input.shopId);
      if (!linked) {
        return {
          eligible: false,
          status: "no_warranty",
          message: language === "en"
            ? "This order does not have warranty coverage."
            : language === "th" ? "คำสั่งซื้อนี้ไม่มีการรับประกัน"
            : "Đơn hàng này không có bảo hành.",
        };
      }
    } else if (order.seller?.tier !== SellerTier.ULTRA) {
      return {
        eligible: false,
        status: "no_warranty",
        message: language === "en"
          ? "Warranty is not available for this shop."
          : language === "th" ? "ฟีเจอร์การรับประกันไม่พร้อมใช้งานสำหรับร้านนี้"
          : "Tính năng bảo hành không khả dụng với shop này.",
      };
    }

    if (order.status !== OrderStatus.DELIVERED || !order.deliveredAt) {
      return {
        eligible: false,
        status: "not_delivered",
        message: language === "en"
          ? "This order is not delivered yet, so warranty is not available."
          : language === "th" ? "คำสั่งซื้อนี้ยังไม่ได้จัดส่ง ไม่สามารถเปิดการรับประกันได้"
          : "Đơn hàng này chưa giao xong nên chưa thể mở bảo hành.",
      };
    }

    if (order.warrantyClaims.length > 0) {
      return {
        eligible: false,
        status: "already_open",
        message: language === "en"
          ? "A warranty claim for this order is already being processed."
          : language === "th" ? "คำสั่งซื้อนี้มีคำขอรับประกันที่กำลังดำเนินการอยู่แล้ว"
          : "Đơn này đã có một yêu cầu bảo hành đang được xử lý.",
      };
    }

    const snapshot =
      order.warrantyStartedAt && order.warrantyDeliveryModeSnapshot
        ? {
            warrantyPolicySnapshot: order.warrantyPolicySnapshot,
            warrantyExpiresAt: order.warrantyExpiresAt,
          }
        : await this.snapshotWarrantyForDeliveredOrder(order.id);

    if (!snapshot?.warrantyPolicySnapshot || snapshot.warrantyPolicySnapshot === SourceWarrantyPolicy.KBH) {
      return {
        eligible: false,
        status: "no_warranty",
        message: language === "en"
          ? "This order does not have an active warranty policy."
          : language === "th" ? "คำสั่งซื้อนี้ไม่มีนโยบายรับประกันที่ใช้งานได้"
          : "Đơn hàng này không có chính sách bảo hành hợp lệ.",
      };
    }

    if (hasWarrantyWindowExpired(snapshot.warrantyExpiresAt)) {
      return {
        eligible: false,
        status: "expired",
        message: language === "en"
          ? "The warranty window for this order has expired."
          : language === "th" ? "ระยะเวลารับประกันของคำสั่งซื้อนี้หมดอายุแล้ว"
          : "Thời gian bảo hành của đơn này đã hết hạn.",
      };
    }

    return {
      eligible: true,
      orderCode: normalizedOrderCode,
      accounts: this.parseDeliveredAccounts(order.deliveredAccountText),
    };
  }

  async submitTelegramWarrantyClaim(input: {
    shopId: string;
    telegramUserId: string;
    telegramChatId: string;
    orderCode: string;
    customerMessage?: string;
    targetUsernames?: string[];
    language?: "vi" | "en" | "th";
  }) {
    const normalizedOrderCode = String(input.orderCode || "").trim().toUpperCase();

    if (!normalizedOrderCode) {
      return {
        success: false,
        status: "rejected",
        message:
          input.language === "en"
            ? "Please enter a valid order code."
            : input.language === "th" ? "กรุณาระบุรหัสคำสั่งซื้อที่ถูกต้อง"
            : "Vui lòng nhập mã đơn hàng hợp lệ.",
      };
    }

    const order = await this.prisma.order.findFirst({
      where: {
        shopId: input.shopId,
        orderCode: normalizedOrderCode,
        customer: {
          telegramUserId: input.telegramUserId,
        },
      },
      include: {
        customer: true,
        sourceProduct: true,
        seller: { select: { tier: true } },
        shop: {
          include: {
            providerConfig: true,
            botConfig: true,
          },
        },
        warrantyClaims: {
          where: {
            status: {
              in: [
                WARRANTY_CLAIM_STATUS.PENDING,
                WARRANTY_CLAIM_STATUS.PENDING_MANUAL,
                WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
                WARRANTY_CLAIM_STATUS.PENDING_STOCK,
              ],
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!order) {
      return {
        success: false,
        status: "not_found",
        message:
          input.language === "en"
            ? "We could not find a delivered order with this code in your account."
            : input.language === "th" ? "ไม่พบคำสั่งซื้อที่จัดส่งแล้วด้วยรหัสนี้ในบัญชีของคุณ"
            : "Không tìm thấy đơn đã giao nào với mã này trong tài khoản của bạn.",
      };
    }

    const isPro = order.seller?.tier === SellerTier.PRO;
    const isUltra = order.seller?.tier === SellerTier.ULTRA;

    if (!isPro && !isUltra) {
      return {
        success: false,
        status: "not_available",
        message: input.language === "en"
          ? "Warranty is not available for this shop."
          : input.language === "th" ? "ฟีเจอร์การรับประกันไม่พร้อมใช้งานสำหรับร้านนี้"
          : "Tính năng bảo hành không khả dụng với shop này.",
      };
    }

    const internalSourceOrder = isPro
      ? await this.findLinkedInternalSourceOrder(order.orderCode, order.shopId)
      : null;

    if (isPro && !internalSourceOrder) {
      return {
        success: false,
        status: "not_available",
        message: input.language === "en"
          ? "Warranty is only available for orders fulfilled via ULTRA source."
          : input.language === "th" ? "การรับประกันใช้ได้เฉพาะคำสั่งซื้อที่จัดส่งผ่านแหล่งที่มา ULTRA เท่านั้น"
          : "Bảo hành chỉ khả dụng với đơn hàng được xử lý qua nguồn ULTRA.",
      };
    }

    if (order.status !== OrderStatus.DELIVERED || !order.deliveredAt) {
      return {
        success: false,
        status: "not_delivered",
        message:
          input.language === "en"
            ? "This order is not delivered yet, so warranty is not available."
            : input.language === "th" ? "คำสั่งซื้อนี้ยังไม่ได้จัดส่ง ไม่สามารถเปิดการรับประกันได้"
            : "Đơn hàng này chưa giao xong nên chưa thể mở bảo hành.",
      };
    }

    if (order.warrantyClaims.length > 0) {
      return {
        success: false,
        status: "already_open",
        message:
          input.language === "en"
            ? "A warranty claim for this order is already being processed."
            : input.language === "th" ? "คำสั่งซื้อนี้มีคำขอรับประกันที่กำลังดำเนินการอยู่แล้ว"
            : "Đơn này đã có một yêu cầu bảo hành đang được xử lý.",
      };
    }

    const snapshot =
      order.warrantyStartedAt && order.warrantyDeliveryModeSnapshot
        ? {
            warrantyPolicySnapshot: order.warrantyPolicySnapshot,
            warrantyDeliveryModeSnapshot: order.warrantyDeliveryModeSnapshot,
            warrantyStartedAt: order.warrantyStartedAt,
            warrantyExpiresAt: order.warrantyExpiresAt,
          }
        : await this.snapshotWarrantyForDeliveredOrder(order.id);

    if (!snapshot?.warrantyPolicySnapshot || snapshot.warrantyPolicySnapshot === SourceWarrantyPolicy.KBH) {
      return {
        success: false,
        status: "no_warranty",
        message:
          input.language === "en"
            ? "This order does not have an active warranty policy."
            : input.language === "th" ? "คำสั่งซื้อนี้ไม่มีนโยบายรับประกันที่ใช้งานได้"
            : "Đơn hàng này không có chính sách bảo hành hợp lệ.",
      };
    }

    if (hasWarrantyWindowExpired(snapshot.warrantyExpiresAt)) {
      return {
        success: false,
        status: "expired",
        message:
          input.language === "en"
            ? "The warranty window for this order has expired."
            : input.language === "th" ? "ระยะเวลารับประกันของคำสั่งซื้อนี้หมดอายุแล้ว"
            : "Thời gian bảo hành của đơn này đã hết hạn.",
      };
    }

    let quantityOverride: number | undefined;
    if (input.targetUsernames && input.targetUsernames.length > 0) {
      const allAccounts = this.parseDeliveredAccounts(order.deliveredAccountText);
      const validUsernameSet = new Set(allAccounts.map((a) => this.extractUsername(a)));
      const invalid = input.targetUsernames.filter((u) => !validUsernameSet.has(u.toLowerCase()));
      if (invalid.length > 0) {
        const lang = input.language || "vi";
        return {
          success: false,
          status: "invalid_usernames",
          claimId: null,
          claimNumber: null,
          message: lang === "en"
            ? `Account not found in this order: ${invalid.join(", ")}`
            : lang === "th" ? `ไม่พบบัญชีในคำสั่งซื้อนี้: ${invalid.join(", ")}`
            : `Không tìm thấy tài khoản trong đơn này: ${invalid.join(", ")}`,
          deliveredAccountText: null,
          orderCode: order.orderCode,
          supportTelegram: order.shop.supportTelegram,
          supportZalo: order.shop.supportZalo,
          supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
        };
      }
      quantityOverride = input.targetUsernames.length;
    }

    const claimNumber = order.warrantyClaimCount + 1;
    const lang = input.language || "vi";
    const decision = internalSourceOrder
      ? await this.decideInternalSourceClaimRoute(internalSourceOrder, claimNumber, lang, quantityOverride)
      : await this.decideClaimRoute(order, claimNumber, lang, quantityOverride);

    const replacementCostSource = internalSourceOrder?.sourceProduct.sourcePrice ?? order.sourceProduct.sourcePrice;

    const createdClaim = await this.prisma.$transaction(async (tx) => {
      if (decision.manualStockUpdate) {
        const sourceMetadata = this.asRecord(order.sourceProduct.metadataJson);
        await tx.sourceProduct.update({
          where: { id: order.sourceProductId },
          data: {
            available: decision.manualStockUpdate.remainingEntries.length,
            metadataJson: {
              ...sourceMetadata,
              manual: true,
              deliveryEntries: decision.manualStockUpdate.remainingEntries,
              deliveryText: this.normalizeManualDeliveryText(
                decision.manualStockUpdate.remainingEntries.join("\n\n"),
              ),
            } as Prisma.InputJsonValue,
          },
        });
      }

      if (decision.internalSourceStockUpdate) {
        const { sourceProductId, remainingEntries } = decision.internalSourceStockUpdate;
        const proProduct = await tx.sourceProduct.findUnique({
          where: { id: sourceProductId },
          select: { metadataJson: true },
        });
        const meta = this.asRecord(proProduct?.metadataJson);
        await tx.sourceProduct.update({
          where: { id: sourceProductId },
          data: {
            available: remainingEntries.length,
            metadataJson: {
              ...meta,
              manual: true,
              deliveryEntries: remainingEntries,
              deliveryText: this.normalizeManualDeliveryText(remainingEntries.join("\n\n")),
            } as Prisma.InputJsonValue,
          },
        });
      }

      const claim = await tx.warrantyClaim.create({
        data: {
          orderId: order.id,
          sellerId: order.sellerId,
          shopId: order.shopId,
          customerId: order.customerId,
          claimNumber,
          status: decision.nextStatus,
          orderCodeSnapshot: order.orderCode,
          productNameSnapshot: order.productNameSnapshot,
          warrantyPolicySnapshot: snapshot.warrantyPolicySnapshot,
          deliveryModeSnapshot: snapshot.warrantyDeliveryModeSnapshot,
          customerMessage: input.customerMessage?.trim() || null,
          deliveredAccountText: decision.deliveredAccountText,
          resolutionNote: decision.resolutionNote,
          resolvedAt: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED ? new Date() : null,
          replacementCostSnapshot: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED
            ? replacementCostSource
            : null,
          metadataJson: {
            ownerAttentionRequired: decision.ownerAttentionRequired,
            ...(input.targetUsernames ? { targetUsernames: input.targetUsernames } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { warrantyClaimCount: claimNumber },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "warranty_claim_created",
          payloadJson: {
            warrantyClaimId: claim.id,
            claimNumber,
            status: decision.nextStatus,
          } as Prisma.InputJsonValue,
        },
      });

      return claim;
    });

    if (decision.ownerAttentionRequired) {
      await this.notifyOwnerAboutClaim({
        shopId: order.shopId,
        orderCode: order.orderCode,
        productName: order.productNameSnapshot,
        claimNumber,
        status: decision.nextStatus,
        customerLabel:
          order.customer.telegramUsername ||
          [order.customer.firstName, order.customer.lastName].filter(Boolean).join(" ") ||
          order.customer.telegramUserId,
        customerMessage: input.customerMessage,
      });
    }

    return {
      success: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
      status: decision.nextStatus.toLowerCase(),
      claimId: createdClaim.id,
      claimNumber,
      message: decision.customerMessage,
      deliveredAccountText: decision.deliveredAccountText,
      orderCode: order.orderCode,
      supportTelegram: order.shop.supportTelegram,
      supportZalo: order.shop.supportZalo,
      supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
    };
  }

  async publicGetShopInfo(slug: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { slug },
      select: { name: true, supportTelegram: true, supportZalo: true },
    });

    if (!shop) {
      throw new NotFoundException("Shop not found.");
    }

    return shop;
  }

  async publicSearchOrders(dto: PublicWarrantySearchDto) {
    const shop = await this.prisma.shop.findFirst({
      where: { slug: dto.shopSlug },
      include: { seller: { select: { tier: true } } },
    });

    if (!shop) {
      throw new NotFoundException("Shop not found.");
    }

    const tier = shop.seller?.tier;
    if (tier !== SellerTier.PRO && tier !== SellerTier.ULTRA) {
      throw new BadRequestException("This shop does not have warranty coverage.");
    }

    const accountText = (dto.accountText || "").trim();
    if (!accountText || accountText.length < 3) {
      throw new BadRequestException("Vui lòng nhập ít nhất 3 ký tự để tra cứu.");
    }
    const orders = await this.prisma.order.findMany({
      where: {
        shopId: shop.id,
        status: OrderStatus.DELIVERED,
        deliveredAccountText: { contains: accountText, mode: "insensitive" },
      },
      orderBy: { deliveredAt: "desc" },
      take: 5,
    });

    const results = [];
    for (const order of orders) {
      const snapshot =
        order.warrantyStartedAt && order.warrantyDeliveryModeSnapshot
          ? {
              warrantyPolicySnapshot: order.warrantyPolicySnapshot,
              warrantyExpiresAt: order.warrantyExpiresAt,
            }
          : await this.snapshotWarrantyForDeliveredOrder(order.id);

      if (!snapshot?.warrantyPolicySnapshot || snapshot.warrantyPolicySnapshot === SourceWarrantyPolicy.KBH) continue;
      if (hasWarrantyWindowExpired(snapshot.warrantyExpiresAt)) continue;

      if (tier === SellerTier.PRO) {
        const linked = await this.findLinkedInternalSourceOrder(order.orderCode, order.shopId);
        if (!linked) continue;
      }

      const activeClaim = await this.prisma.warrantyClaim.findFirst({
        where: {
          orderId: order.id,
          status: {
            in: [
              WARRANTY_CLAIM_STATUS.PENDING,
              WARRANTY_CLAIM_STATUS.PENDING_MANUAL,
              WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
              WARRANTY_CLAIM_STATUS.PENDING_STOCK,
            ],
          },
        },
      });

      results.push({
        orderId: order.id,
        orderCode: order.orderCode,
        productName: order.productNameSnapshot,
        deliveredAt: order.deliveredAt,
        warrantyExpiresAt: snapshot.warrantyExpiresAt,
        warrantyPolicy: snapshot.warrantyPolicySnapshot?.toLowerCase(),
        hasActiveClaim: !!activeClaim,
      });
    }

    return {
      shop: { name: shop.name, supportTelegram: shop.supportTelegram, supportZalo: shop.supportZalo },
      orders: results,
    };
  }

  async publicSubmitClaim(dto: PublicWarrantyClaimDto) {
    const shop = await this.prisma.shop.findFirst({
      where: { slug: dto.shopSlug },
      select: { id: true },
    });

    if (!shop) {
      throw new NotFoundException("Shop not found.");
    }

    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, shopId: shop.id },
      include: {
        customer: true,
        sourceProduct: true,
        seller: { select: { tier: true } },
        shop: {
          include: {
            providerConfig: true,
            botConfig: true,
          },
        },
        warrantyClaims: {
          where: {
            status: {
              in: [
                WARRANTY_CLAIM_STATUS.PENDING,
                WARRANTY_CLAIM_STATUS.PENDING_MANUAL,
                WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
                WARRANTY_CLAIM_STATUS.PENDING_STOCK,
              ],
            },
          },
          take: 1,
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    const isPro = order.seller?.tier === SellerTier.PRO;
    const isUltra = order.seller?.tier === SellerTier.ULTRA;

    if (!isPro && !isUltra) {
      throw new BadRequestException("Warranty is not available for this shop.");
    }

    const internalSourceOrder = isPro
      ? await this.findLinkedInternalSourceOrder(order.orderCode, order.shopId)
      : null;

    if (isPro && !internalSourceOrder) {
      throw new BadRequestException("Warranty is only available for orders fulfilled via ULTRA source.");
    }

    if (order.status !== OrderStatus.DELIVERED || !order.deliveredAt) {
      throw new BadRequestException("Order is not delivered yet.");
    }

    if (order.warrantyClaims.length > 0) {
      throw new BadRequestException("A warranty claim for this order is already being processed.");
    }

    const snapshot =
      order.warrantyStartedAt && order.warrantyDeliveryModeSnapshot
        ? {
            warrantyPolicySnapshot: order.warrantyPolicySnapshot,
            warrantyDeliveryModeSnapshot: order.warrantyDeliveryModeSnapshot,
            warrantyStartedAt: order.warrantyStartedAt,
            warrantyExpiresAt: order.warrantyExpiresAt,
          }
        : await this.snapshotWarrantyForDeliveredOrder(order.id);

    if (!snapshot?.warrantyPolicySnapshot || snapshot.warrantyPolicySnapshot === SourceWarrantyPolicy.KBH) {
      throw new BadRequestException("This order does not have an active warranty policy.");
    }

    if (hasWarrantyWindowExpired(snapshot.warrantyExpiresAt)) {
      throw new BadRequestException("The warranty window for this order has expired.");
    }

    const claimNumber = order.warrantyClaimCount + 1;
    const decision = internalSourceOrder
      ? await this.decideInternalSourceClaimRoute(internalSourceOrder, claimNumber, "vi")
      : await this.decideClaimRoute(order, claimNumber, "vi");

    const replacementCostSource = internalSourceOrder?.sourceProduct.sourcePrice ?? order.sourceProduct.sourcePrice;

    const createdClaim = await this.prisma.$transaction(async (tx) => {
      if (decision.manualStockUpdate) {
        const sourceMetadata = this.asRecord(order.sourceProduct.metadataJson);
        await tx.sourceProduct.update({
          where: { id: order.sourceProductId },
          data: {
            available: decision.manualStockUpdate.remainingEntries.length,
            metadataJson: {
              ...sourceMetadata,
              manual: true,
              deliveryEntries: decision.manualStockUpdate.remainingEntries,
              deliveryText: this.normalizeManualDeliveryText(decision.manualStockUpdate.remainingEntries.join("\n\n")),
            } as Prisma.InputJsonValue,
          },
        });
      }

      if (decision.internalSourceStockUpdate) {
        const { sourceProductId, remainingEntries } = decision.internalSourceStockUpdate;
        const proProduct = await tx.sourceProduct.findUnique({
          where: { id: sourceProductId },
          select: { metadataJson: true },
        });
        const meta = this.asRecord(proProduct?.metadataJson);
        await tx.sourceProduct.update({
          where: { id: sourceProductId },
          data: {
            available: remainingEntries.length,
            metadataJson: {
              ...meta,
              manual: true,
              deliveryEntries: remainingEntries,
              deliveryText: this.normalizeManualDeliveryText(remainingEntries.join("\n\n")),
            } as Prisma.InputJsonValue,
          },
        });
      }

      const claim = await tx.warrantyClaim.create({
        data: {
          orderId: order.id,
          sellerId: order.sellerId,
          shopId: order.shopId,
          customerId: order.customerId,
          claimNumber,
          status: decision.nextStatus,
          orderCodeSnapshot: order.orderCode,
          productNameSnapshot: order.productNameSnapshot,
          warrantyPolicySnapshot: snapshot.warrantyPolicySnapshot,
          deliveryModeSnapshot: snapshot.warrantyDeliveryModeSnapshot,
          customerMessage: dto.customerMessage?.trim() || null,
          deliveredAccountText: decision.deliveredAccountText,
          resolutionNote: decision.resolutionNote,
          resolvedAt: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED ? new Date() : null,
          replacementCostSnapshot: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED
            ? replacementCostSource
            : null,
          metadataJson: {
            ownerAttentionRequired: decision.ownerAttentionRequired,
            contactInfo: dto.contactInfo,
            source: "web",
          } as Prisma.InputJsonValue,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { warrantyClaimCount: claimNumber },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "warranty_claim_created",
          payloadJson: {
            warrantyClaimId: claim.id,
            claimNumber,
            status: decision.nextStatus,
            source: "web",
          } as Prisma.InputJsonValue,
        },
      });

      return claim;
    });

    if (decision.ownerAttentionRequired) {
      await this.notifyOwnerAboutClaim({
        shopId: order.shopId,
        orderCode: order.orderCode,
        productName: order.productNameSnapshot,
        claimNumber,
        status: decision.nextStatus,
        customerLabel: dto.contactInfo,
        customerMessage: dto.customerMessage,
      });
      this.notifyAdminOfClaim(createdClaim.id).catch(() => undefined);
    }

    return {
      success: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
      status: decision.nextStatus.toLowerCase(),
      claimId: createdClaim.id,
      orderCode: order.orderCode,
      deliveredAccountText: decision.deliveredAccountText,
      message: decision.customerMessage,
      supportTelegram: order.shop.supportTelegram,
      supportZalo: order.shop.supportZalo,
    };
  }

  private async decideClaimRoute(
    order: Prisma.OrderGetPayload<{
      include: {
        customer: true;
        sourceProduct: true;
        shop: {
          include: {
            providerConfig: true;
            botConfig: true;
          };
        };
        warrantyClaims: true;
      };
    }>,
    claimNumber: number,
    language: "vi" | "en" | "th",
    quantityOverride?: number,
  ): Promise<ClaimDecision> {
    const qty = quantityOverride ?? order.quantity;
    const deliveryMode = order.warrantyDeliveryModeSnapshot || SourceDeliveryMode.AUTO_API;

    if (deliveryMode === SourceDeliveryMode.MANUAL) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_MANUAL,
        deliveredAccountText: null,
        resolutionNote: "Manual-order warranty requires seller handling.",
        ownerAttentionRequired: true,
        customerMessage:
          language === "en"
            ? "The order was delivered manually. We created a warranty request and shared the shop contact below."
            : language === "th" ? "คำสั่งซื้อนี้จัดส่งด้วยตนเอง ระบบได้สร้างคำขอรับประกันและแชร์ข้อมูลติดต่อร้านค้าด้านล่าง"
            : "Đơn này giao thủ công. Hệ thống đã tạo yêu cầu bảo hành và gửi thông tin liên hệ chủ shop bên dưới.",
      };
    }

    if (claimNumber > 2) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
        deliveredAccountText: null,
        resolutionNote: "Claim count is greater than 2 and needs owner review.",
        ownerAttentionRequired: true,
        customerMessage:
          language === "en"
            ? "This warranty request needs owner review because the claim count is already above 2."
            : language === "th" ? "คำขอรับประกันนี้ต้องการให้เจ้าของตรวจสอบ เนื่องจากจำนวนครั้งที่ขอเกิน 2 แล้ว"
            : "Yêu cầu bảo hành này cần chủ shop xem lại vì số lần claim đã vượt quá 2.",
      };
    }

    if (deliveryMode === SourceDeliveryMode.AUTO_STOCK) {
      const sourceMetadata = this.asRecord(order.sourceProduct.metadataJson);
      const deliveryEntries = this.readManualDeliveryEntries(sourceMetadata);

      if (deliveryEntries.length >= qty) {
        const deliveredEntries = deliveryEntries.slice(0, qty);
        const remainingEntries = deliveryEntries.slice(qty);

        return {
          nextStatus: WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
          deliveredAccountText: deliveredEntries.join("\n\n"),
          resolutionNote: "Replacement stock delivered automatically from manual inventory.",
          ownerAttentionRequired: false,
          customerMessage:
            language === "en"
              ? "Warranty approved. The replacement account is ready below."
              : language === "th" ? "อนุมัติการรับประกันแล้ว บัญชีทดแทนพร้อมด้านล่าง"
              : "Bảo hành đã được duyệt. Tài khoản thay thế đã sẵn sàng ở bên dưới.",
          manualStockUpdate: {
            remainingEntries,
          },
        };
      }

      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_STOCK,
        deliveredAccountText: null,
        resolutionNote: "Replacement stock is not enough for automatic warranty delivery.",
        ownerAttentionRequired: true,
        customerMessage:
          language === "en"
            ? "We created the warranty request, but replacement stock is not enough right now. The owner will handle it shortly."
            : language === "th" ? "ระบบได้สร้างคำขอรับประกันแล้ว แต่สต็อกทดแทนไม่เพียงพอในขณะนี้ เจ้าของจะดำเนินการโดยเร็ว"
            : "Hệ thống đã tạo yêu cầu bảo hành nhưng kho thay thế hiện chưa đủ. Chủ shop sẽ xử lý thêm sớm.",
      };
    }

    const providerConfig = order.shop.providerConfig;
    const buyerKey = decryptSecret(
      providerConfig?.buyerKeyEncrypted,
      this.config.encryptionKey,
    );

    if (!providerConfig || !buyerKey) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
        deliveredAccountText: null,
        resolutionNote: "Provider config is missing for automatic warranty processing.",
        ownerAttentionRequired: true,
        customerMessage:
          language === "en"
            ? "We created the warranty request, but the owner needs to review it manually."
            : language === "th" ? "ระบบได้สร้างคำขอรับประกันแล้ว แต่เจ้าของต้องตรวจสอบด้วยตนเอง"
            : "Hệ thống đã tạo yêu cầu bảo hành nhưng chủ shop cần xem và xử lý thủ công.",
      };
    }

    const replacement = await purchaseFromProvider(
      {
        baseUrl: providerConfig.baseUrl,
        buyerKey,
        providerName: providerConfig.providerName,
      },
      {
        productId: order.sourceProduct.externalProductId,
        quantity: qty,
        clientOrderCode: `WRT-${order.orderCode}-${claimNumber}`,
      },
    );

    if (replacement.success && replacement.deliveredText) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
        deliveredAccountText: replacement.deliveredText,
        resolutionNote: "Automatic provider warranty replacement succeeded.",
        ownerAttentionRequired: false,
        customerMessage:
          language === "en"
            ? "Warranty approved. The replacement account is ready below."
            : "Bao hanh da duoc duyet. Tai khoan thay the da san sang o ben duoi.",
      };
    }

    if (replacement.outOfStock || replacement.pending) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_STOCK,
        deliveredAccountText: null,
        resolutionNote:
          replacement.message || "Replacement stock is not enough right now.",
        ownerAttentionRequired: true,
        customerMessage:
          language === "en"
            ? "We created the warranty request, but replacement stock is not enough right now. The owner will handle it shortly."
            : language === "th" ? "ระบบได้สร้างคำขอรับประกันแล้ว แต่สต็อกทดแทนไม่เพียงพอในขณะนี้ เจ้าของจะดำเนินการโดยเร็ว"
            : "Hệ thống đã tạo yêu cầu bảo hành nhưng kho thay thế hiện chưa đủ. Chủ shop sẽ xử lý thêm sớm.",
      };
    }

    return {
      nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
      deliveredAccountText: null,
      resolutionNote:
        replacement.message || "Automatic warranty flow failed and needs owner review.",
      ownerAttentionRequired: true,
      customerMessage:
        language === "en"
          ? "We created the warranty request, but the owner needs to review it manually."
          : "He thong da tao yeu cau bao hanh nhung chu shop can xem va xu ly thu cong.",
    };
  }

  private async getManagedClaim(userId: string, id: string) {
    const shop = await this.shopsService.getSellerShop(userId);
    const claim = await this.prisma.warrantyClaim.findFirst({
      where: {
        id,
        shopId: shop.id,
      },
      include: {
        customer: true,
        order: true,
        shop: {
          include: {
            botConfig: true,
          },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException("Warranty claim not found.");
    }

    return claim;
  }

  private isResolvedClaim(status: WarrantyClaimStatus) {
    const closedStatuses: WarrantyClaimStatus[] = [
      WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
      WARRANTY_CLAIM_STATUS.RESOLVED_MANUAL,
      WARRANTY_CLAIM_STATUS.REJECTED,
    ];

    return closedStatuses.includes(status);
  }

  private async notifySellerClaimOpened(
    shopId: string,
    payload: { orderCode: string; productName: string; claimNumber: number; status: WarrantyClaimStatus; customerMessage?: string },
  ) {
    await this.notifyOwnerAboutClaim({
      shopId,
      orderCode: payload.orderCode,
      productName: payload.productName,
      claimNumber: payload.claimNumber,
      status: payload.status,
      customerLabel: "Khách hàng",
      customerMessage: payload.customerMessage,
    });
  }

  private async notifySellerStockExhausted(
    _shopId: string,
    _payload: { orderCode: string; productName: string; claimNumber: number },
  ) {}

  private async notifySellerPendingReview(
    _shopId: string,
    _payload: { orderCode: string; productName: string; claimNumber: number },
  ) {}

  private async notifyOwnerAboutClaim(input: {
    shopId: string;
    orderCode: string;
    productName: string;
    claimNumber: number;
    status: WarrantyClaimStatus;
    customerLabel: string;
    customerMessage?: string;
  }) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: input.shopId },
      include: {
        botConfig: true,
      },
    });

    if (!shop?.botConfig?.telegramBotTokenEncrypted || !shop.supportTelegram) {
      return;
    }

    const chatId = String(shop.supportTelegram || "").trim();
    const token = decryptSecret(
      shop.botConfig.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (
      !token ||
      !chatId ||
      (this.config.mockTelegramEnabled && isMockBotToken(token))
    ) {
      return;
    }

    await telegramSendMessage(
      token,
      chatId,
      [
        "🛡️ Có yêu cầu bảo hành mới",
        `Đơn: ${input.orderCode}`,
        `Sản phẩm: ${input.productName}`,
        `Claim #${input.claimNumber} — ${input.status}`,
        `Khách: ${input.customerLabel}`,
        input.customerMessage ? `Vấn đề: ${input.customerMessage}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch(() => undefined);
  }

  private async notifyCustomerAboutResolvedClaim(
    claim: Prisma.WarrantyClaimGetPayload<{
      include: {
        customer: true;
        order: true;
        shop: {
          include: {
            botConfig: true;
          };
        };
      };
    }>,
  ) {
    const token = decryptSecret(
      claim.shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (
      !token ||
      !claim.customer?.telegramChatId ||
      (this.config.mockTelegramEnabled && isMockBotToken(token))
    ) {
      return;
    }

    await telegramSendMessage(
      token,
      claim.customer.telegramChatId,
      [
        "Warranty claim updated",
        `Order code: ${claim.orderCodeSnapshot}`,
        "",
        "The seller has resolved your warranty request manually.",
        claim.deliveredAccountText
          ? `Replacement info:\n${claim.deliveredAccountText}`
          : null,
        claim.resolutionNote ? `Note: ${claim.resolutionNote}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch(() => undefined);
  }

  private async notifyCustomerAboutRejectedClaim(
    claim: Prisma.WarrantyClaimGetPayload<{
      include: {
        customer: true;
        order: true;
        shop: {
          include: {
            botConfig: true;
          };
        };
      };
    }>,
    reason: string,
  ) {
    const token = decryptSecret(
      claim.shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (
      !token ||
      !claim.customer?.telegramChatId ||
      (this.config.mockTelegramEnabled && isMockBotToken(token))
    ) {
      return;
    }

    await telegramSendMessage(
      token,
      claim.customer.telegramChatId,
      [
        "Warranty claim updated",
        `Order code: ${claim.orderCodeSnapshot}`,
        "",
        "The seller rejected this warranty request.",
        `Reason: ${reason}`,
        this.buildSupportText(claim.shop.supportTelegram, claim.shop.supportZalo),
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch(() => undefined);
  }

  private buildSupportText(
    supportTelegram: string | null | undefined,
    supportZalo: string | null | undefined,
  ) {
    const lines = [
      supportTelegram ? `Telegram: ${supportTelegram}` : null,
      supportZalo ? `Zalo: ${supportZalo}` : null,
    ].filter(Boolean);

    if (lines.length === 0) {
      return "Please reply in this chat if you need more help.";
    }

    return ["Support contact:", ...lines].join("\n");
  }

  private async findLinkedInternalSourceOrder(orderCode: string, shopId: string) {
    return this.prisma.internalSourceOrder.findFirst({
      where: { downstreamOrderCode: orderCode, downstreamShopId: shopId },
      include: { sourceProduct: true },
    });
  }

  private async decideInternalSourceClaimRoute(
    sourceOrder: Prisma.InternalSourceOrderGetPayload<{ include: { sourceProduct: true } }>,
    claimNumber: number,
    language: "vi" | "en" | "th",
    quantityOverride?: number,
  ): Promise<ClaimDecision> {
    const qty = quantityOverride ?? sourceOrder.quantity;
    const deliveryMode = sourceOrder.sourceProduct.sourceDeliveryMode ?? SourceDeliveryMode.AUTO_API;

    if (claimNumber > 2) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
        deliveredAccountText: null,
        resolutionNote: "Claim count exceeds 2. Needs PRO owner review.",
        ownerAttentionRequired: true,
        customerMessage: language === "en"
          ? "Your warranty request requires manual review due to multiple prior claims."
          : language === "th" ? "คำขอรับประกันของคุณต้องการการตรวจสอบด้วยตนเองเนื่องจากมีคำขอก่อนหน้าหลายครั้ง"
          : "Yêu cầu bảo hành cần được xem xét thủ công do số lần claim đã vượt quá giới hạn.",
      };
    }

    if (deliveryMode === SourceDeliveryMode.MANUAL) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_MANUAL,
        deliveredAccountText: null,
        resolutionNote: "PRO source is manual delivery. Requires seller handling.",
        ownerAttentionRequired: true,
        customerMessage: language === "en"
          ? "Warranty request created. Please contact the shop for support."
          : language === "th" ? "สร้างคำขอรับประกันแล้ว กรุณาติดต่อร้านค้าเพื่อขอความช่วยเหลือ"
          : "Yêu cầu bảo hành đã được tạo. Vui lòng liên hệ shop để được hỗ trợ.",
      };
    }

    if (deliveryMode === SourceDeliveryMode.AUTO_STOCK) {
      const sourceMetadata = this.asRecord(sourceOrder.sourceProduct.metadataJson);
      const deliveryEntries = this.readManualDeliveryEntries(sourceMetadata);

      if (deliveryEntries.length >= qty) {
        const deliveredEntries = deliveryEntries.slice(0, qty);
        const remainingEntries = deliveryEntries.slice(qty);

        return {
          nextStatus: WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
          deliveredAccountText: deliveredEntries.join("\n\n"),
          resolutionNote: "Replacement from PRO source stock delivered automatically.",
          ownerAttentionRequired: false,
          customerMessage: language === "en"
            ? "Warranty approved. Your replacement account is ready."
            : language === "th" ? "อนุมัติการรับประกันแล้ว บัญชีทดแทนของคุณพร้อมแล้ว"
            : "Bảo hành đã được duyệt. Tài khoản thay thế đã sẵn sàng.",
          internalSourceStockUpdate: {
            sourceProductId: sourceOrder.sourceProductId,
            remainingEntries,
          },
        };
      }

      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_STOCK,
        deliveredAccountText: null,
        resolutionNote: "PRO source stock insufficient for warranty replacement.",
        ownerAttentionRequired: true,
        customerMessage: language === "en"
          ? "Warranty request created. The shop will process it shortly."
          : language === "th" ? "สร้างคำขอรับประกันแล้ว ร้านค้าจะดำเนินการโดยเร็ว"
          : "Yêu cầu bảo hành đã được tạo. Shop sẽ xử lý trong thời gian sớm nhất.",
      };
    }

    // AUTO_API: use PRO's provider config
    const proShop = await this.prisma.shop.findUnique({
      where: { id: sourceOrder.upstreamShopId },
      include: { providerConfig: true },
    });

    const providerConfig = proShop?.providerConfig;
    const buyerKey = decryptSecret(providerConfig?.buyerKeyEncrypted, this.config.encryptionKey);

    if (!providerConfig || !buyerKey) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
        deliveredAccountText: null,
        resolutionNote: "PRO source provider config missing. Needs manual handling.",
        ownerAttentionRequired: true,
        customerMessage: language === "en"
          ? "Warranty request created. The shop will process it shortly."
          : language === "th" ? "สร้างคำขอรับประกันแล้ว ร้านค้าจะดำเนินการโดยเร็ว"
          : "Yêu cầu bảo hành đã được tạo. Shop sẽ xử lý trong thời gian sớm nhất.",
      };
    }

    const replacement = await purchaseFromProvider(
      { baseUrl: providerConfig.baseUrl, buyerKey, providerName: providerConfig.providerName },
      {
        productId: sourceOrder.sourceProduct.externalProductId,
        quantity: qty,
        clientOrderCode: `WRT-SRC-${sourceOrder.sourceOrderCode}-${claimNumber}`,
      },
    );

    if (replacement.success && replacement.deliveredText) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
        deliveredAccountText: replacement.deliveredText,
        resolutionNote: "PRO source automatic warranty replacement succeeded.",
        ownerAttentionRequired: false,
        customerMessage: language === "en"
          ? "Warranty approved. Your replacement account is ready."
          : "Bao hanh da duoc duyet. Tai khoan thay the da san sang.",
      };
    }

    if (replacement.outOfStock || replacement.pending) {
      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_STOCK,
        deliveredAccountText: null,
        resolutionNote: replacement.message || "PRO source stock exhausted.",
        ownerAttentionRequired: true,
        customerMessage: language === "en"
          ? "Warranty request created. The shop will process it shortly."
          : language === "th" ? "สร้างคำขอรับประกันแล้ว ร้านค้าจะดำเนินการโดยเร็ว"
          : "Yêu cầu bảo hành đã được tạo. Shop sẽ xử lý trong thời gian sớm nhất.",
      };
    }

    return {
      nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
      deliveredAccountText: null,
      resolutionNote: replacement.message || "PRO source warranty failed. Needs manual review.",
      ownerAttentionRequired: true,
      customerMessage: language === "en"
        ? "Warranty request created. The shop will process it shortly."
        : "Yeu cau bao hanh da duoc tao. Shop se xu ly trong thoi gian som nhat.",
    };
  }

  private parseDeliveredAccounts(text: string | null | undefined): string[] {
    if (!text) return [];
    return text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  }

  private extractUsername(entry: string): string {
    return (entry.split("|")[0] || entry).trim().toLowerCase();
  }

  private asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private normalizeManualDeliveryText(value: string | null | undefined) {
    const normalized = String(value || "")
      .replace(/\r\n/g, "\n")
      .trim();

    return normalized || null;
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
      .replace(/[}\],;]+$/g, "")
      .trim();
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

  private readManualDeliveryEntries(metadata: Record<string, unknown>) {
    if (Array.isArray(metadata.deliveryEntries)) {
      return metadata.deliveryEntries
        .map((entry: unknown) => String(entry || "").trim())
        .filter(Boolean);
    }

    if (typeof metadata.deliveryText === "string") {
      const normalized = this.unwrapManualDeliveryEnvelope(
        this.normalizeManualDeliveryText(metadata.deliveryText),
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

    return [] as string[];
  }

  private mapClaim(
    claim: Prisma.WarrantyClaimGetPayload<{
      include: {
        customer: true;
        order: true;
      };
    }>,
  ) {
    return {
      id: claim.id,
      orderId: claim.orderId,
      orderCode: claim.orderCodeSnapshot,
      productName: claim.productNameSnapshot,
      claimNumber: claim.claimNumber,
      status: claim.status.toLowerCase(),
      warrantyPolicy: claim.warrantyPolicySnapshot?.toLowerCase() || null,
      deliveryMode: claim.deliveryModeSnapshot?.toLowerCase() || null,
      deliveredAccountText: claim.deliveredAccountText,
      resolutionNote: claim.resolutionNote,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      resolvedAt: claim.resolvedAt,
      customer: claim.customer
        ? {
            telegramUserId: claim.customer.telegramUserId,
            telegramUsername: claim.customer.telegramUsername,
            name:
              [claim.customer.firstName, claim.customer.lastName]
                .filter(Boolean)
                .join(" ") || null,
          }
        : null,
      order: claim.order
        ? {
            status: claim.order.status.toLowerCase(),
            warrantyClaimCount: claim.order.warrantyClaimCount,
            warrantyStartedAt: claim.order.warrantyStartedAt,
            warrantyExpiresAt: claim.order.warrantyExpiresAt,
          }
        : null,
    };
  }
}
