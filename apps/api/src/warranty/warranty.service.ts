import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
  telegramEditMessageText,
  telegramSendMessage,
} from "@reseller/shared/server";

import { WARRANTY_AUTO_CHECK_STATUS } from "@reseller/shared";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { IdempotencyService } from "../lib/idempotency.service";
import { decimalToNumber } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

import { WarrantyAutoCheckService } from "./warranty-auto-check.service";
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
      partialRefundCount?: number;
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
      // Only true when stock is genuinely exhausted (safe to auto-refund).
      // false/undefined = provider pending approval → do NOT auto-refund yet.
      isOutOfStock?: boolean;
    };

@Injectable()
export class WarrantyService {
  private readonly logger = new Logger(WarrantyService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(WarrantyAutoCheckService)
    private readonly autoCheckService: WarrantyAutoCheckService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Count warranty claims for an order that "consume a slot" — i.e. anything except
   * REJECTED. A rejected claim (auto or manual) MUST NOT count against the per-order cap,
   * otherwise a tool false-positive permanently locks the customer out of warranty even
   * when the account legitimately dies later.
   *
   * Note: claimNumber on the WarrantyClaim row is still monotonically increasing (sourced
   * from order.warrantyClaimCount) because of the @@unique([orderId, claimNumber]) index.
   * We don't decrement that field on rejection; we just count separately for cap checks.
   */
  private readonly ACTIVE_CLAIM_STATUSES = [
    WARRANTY_CLAIM_STATUS.PENDING,
    WARRANTY_CLAIM_STATUS.PENDING_MANUAL,
    WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
    WARRANTY_CLAIM_STATUS.PENDING_STOCK,
  ] as const;

  private async hasActiveClaimForAccount(orderId: string, targetEmail?: string | null): Promise<boolean> {
    const claim = await this.prisma.warrantyClaim.findFirst({
      where: {
        orderId,
        status: { in: this.ACTIVE_CLAIM_STATUSES as any },
        ...(targetEmail ? { targetAccountEmail: targetEmail.toLowerCase() } : {}),
      },
      select: { id: true },
    });
    return !!claim;
  }

  private async countNonRejectedClaims(orderId: string, tx?: Prisma.TransactionClient, targetEmail?: string | null): Promise<number> {
    const db = tx || this.prisma;
    return db.warrantyClaim.count({
      where: {
        orderId,
        status: { not: WARRANTY_CLAIM_STATUS.REJECTED },
        ...(targetEmail ? { targetAccountEmail: targetEmail.toLowerCase() } : {}),
      },
    });
  }

  /**
   * Shared auto-check claim creation path used by all three entry points:
   * {@link openClaim} (seller dashboard), {@link submitTelegramWarrantyClaim} (bot mini-app),
   * and {@link publicSubmitClaim} (public web form).
   *
   * Previously each callsite duplicated this ~50-line block, which is exactly how the
   * `customerProvidedNewPassword` guard drifted out of the Telegram flow (fixed earlier).
   * Keeping it in one helper so future fixes apply uniformly.
   *
   * Returns the queued claim row, the customer-visible access token, the enqueue result,
   * and previous-replacement display info — each caller composes its own response shape
   * around these.
   */
  private async createAutoCheckClaim(input: {
    order: { id: string; sellerId: string; shopId: string; customerId: string; orderCode: string; productNameSnapshot: string };
    snapshot: { warrantyPolicySnapshot: SourceWarrantyPolicy | null; warrantyDeliveryModeSnapshot: SourceDeliveryMode | null };
    autoCheckTool: "veo" | "grok" | "gpt";
    creds: { email: string; password: string; extra?: string | null };
    allCreds?: { email: string; password: string; extra?: string | null }[];
    customerMessage?: string | null;
    extraMetadata?: Record<string, unknown>;
    maxClaims: number;
    targetEmail?: string | null;
    cooldownDays?: number;
  }) {
    const { order, snapshot, autoCheckTool, creds, allCreds, customerMessage, extraMetadata = {}, maxClaims, targetEmail, cooldownDays } = input;
    const { token: accessToken, hash: accessTokenHash } = this.autoCheckService.generateAccessToken();
    const previousReplacement = await this.getPreviousReplacementInfo(order.id);

    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
      const lockedOrder = await tx.order.findUnique({
        where: { id: order.id },
        select: { warrantyClaimCount: true },
      });
      const safeClaimNumber = (lockedOrder?.warrantyClaimCount ?? 0) + 1;
      const slotsUsedTx = await this.countNonRejectedClaims(order.id, tx, creds.email);
      if (slotsUsedTx + 1 > maxClaims) {
        throw new BadRequestException("Too many warranty claims for this order.");
      }
      if (targetEmail) {
        const alreadyActive = await tx.warrantyClaim.findFirst({
          where: {
            orderId: order.id,
            status: { in: this.ACTIVE_CLAIM_STATUSES as any },
            targetAccountEmail: targetEmail.toLowerCase(),
          },
          select: { id: true },
        });
        if (alreadyActive) {
          throw new BadRequestException("Tài khoản này đang có yêu cầu bảo hành đang xử lý. Vui lòng chờ kết quả trước khi gửi yêu cầu mới.");
        }
      }
      if (cooldownDays && cooldownDays > 0) {
        // Per-account cooldown: filter by targetAccountEmail when known so account C is not
        // blocked because account A and B were both replaced in separate prior claims.
        // When no targetEmail (legacy path), fall back to per-order check.
        const recentResolved = await tx.warrantyClaim.findMany({
          where: {
            orderId: order.id,
            status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
            resolvedAt: { not: null },
            ...(targetEmail ? { targetAccountEmail: targetEmail.toLowerCase() } : {}),
          },
          orderBy: { resolvedAt: "desc" },
          take: 2,
          select: { resolvedAt: true },
        });
        if (recentResolved.length >= 2 && recentResolved[0]?.resolvedAt) {
          const blockedUntil = new Date(recentResolved[0].resolvedAt.getTime() + cooldownDays * 86400_000);
          if (blockedUntil.getTime() > Date.now()) {
            throw new BadRequestException("Đơn này đang trong thời gian cooldown bảo hành. Vui lòng liên hệ shop trực tiếp.");
          }
        }
      }
      const created = await tx.warrantyClaim.create({
        data: {
          orderId: order.id,
          sellerId: order.sellerId,
          shopId: order.shopId,
          customerId: order.customerId,
          claimNumber: safeClaimNumber,
          status: WARRANTY_CLAIM_STATUS.PENDING,
          orderCodeSnapshot: order.orderCode,
          productNameSnapshot: order.productNameSnapshot,
          warrantyPolicySnapshot: snapshot.warrantyPolicySnapshot,
          deliveryModeSnapshot: snapshot.warrantyDeliveryModeSnapshot,
          customerMessage: customerMessage?.trim() || null,
          deliveredAccountText: null,
          resolutionNote: "Auto-check pending.",
          autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.QUEUED,
          autoCheckTool,
          targetAccountEmail: creds.email.toLowerCase(),
          metadataJson: {
            autoCheckPending: true,
            accessTokenHash,
            ...extraMetadata,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { warrantyClaimCount: safeClaimNumber },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "warranty_claim_auto_check_queued",
          payloadJson: {
            warrantyClaimId: created.id,
            claimNumber: safeClaimNumber,
            tool: autoCheckTool,
          } as Prisma.InputJsonValue,
        },
      });
      return created;
    });

    const enq = await this.autoCheckService.tryEnqueueForClaim(
      claim.id,
      autoCheckTool,
      creds as { email: string; password: string; extra: string | null },
      order.shopId,
      allCreds as { email: string; password: string; extra: string | null }[] | undefined,
    );

    return { claim, accessToken, enq, previousReplacement };
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

    // Resolve target email for per-account checks before cooldown lookup.
    const _openClaimActiveAccText = await this.autoCheckService.getCurrentActiveAccountText(order.id);
    const _openClaimBaseCreds = this.autoCheckService.parseFirstCredential(_openClaimActiveAccText, null);
    const _openClaimTargetEmail = _openClaimBaseCreds?.email ?? null;

    const cooldownConfig = await this.autoCheckService.getConfig();
    const cooldownBlocker = await this.autoCheckService.findCooldownBlocker(order.id, cooldownConfig.cooldownDays, _openClaimTargetEmail);

    // Bumped 2 → 3 (matches submitTelegramWarrantyClaim). Customer self-retries cover most
    // ambiguous cases (typo'd password, transient CF block); only persistent failures hit MAX.
    const PUBLIC_MAX_CLAIMS = 3;
    const _existingSlotsUsed = await this.countNonRejectedClaims(order.id, undefined, _openClaimTargetEmail);
    if (_existingSlotsUsed + 1 > PUBLIC_MAX_CLAIMS) {
      throw new BadRequestException(
        "Đơn này đã đạt số lần bảo hành tối đa. Vui lòng liên hệ shop để được hỗ trợ thêm.",
      );
    }

    // Cooldown HARD reject — order already received a successful warranty replacement.
    if (cooldownBlocker) {
      const lastDate = cooldownBlocker.lastResolvedAt.toLocaleDateString("vi-VN");
      const untilDate = cooldownBlocker.blockedUntil.toLocaleDateString("vi-VN");
      throw new BadRequestException(
        `Đơn này đã được bảo hành thành công ngày ${lastDate}. Để tránh lạm dụng, hệ thống không nhận thêm yêu cầu cho đơn này đến ${untilDate}. Nếu tài khoản thay thế bị lỗi thật, vui lòng liên hệ shop trực tiếp.`,
      );
    }

    // Auto-check branch: if family supported + creds parseable + no cooldown active → enqueue check.
    const _autoCheckSourceProduct = internalSourceOrder?.sourceProduct ?? order.sourceProduct;
    const _autoCheckTool = this.autoCheckService.resolveToolForFamily(_autoCheckSourceProduct?.productFamily);
    const _autoCheckIsSupported = !!_autoCheckTool;
    const _autoCheckActiveAccText = await this.autoCheckService.getCurrentActiveAccountText(order.id);
    const _autoCheckBaseCreds = this.autoCheckService.parseFirstCredential(_autoCheckActiveAccText, null);
    const _autoCheckAllCreds = this.autoCheckService.parseAllCredentials(_autoCheckActiveAccText);
    const _autoCheckOverridePwd = (dto as any).currentPassword
      ? String((dto as any).currentPassword).trim()
      : undefined;
    const _autoCheckCreds = _autoCheckBaseCreds && _autoCheckOverridePwd
      ? { ..._autoCheckBaseCreds, password: _autoCheckOverridePwd }
      : _autoCheckBaseCreds;

    if (!cooldownBlocker && _autoCheckIsSupported && _autoCheckCreds && _autoCheckTool) {
      const { claim: _queuedClaim, accessToken: _qToken, enq: _enq, previousReplacement } =
        await this.createAutoCheckClaim({
          order,
          snapshot,
          autoCheckTool: _autoCheckTool,
          creds: _autoCheckCreds,
          allCreds: _autoCheckAllCreds,
          customerMessage: (dto as any).customerMessage,
          extraMetadata: _autoCheckOverridePwd ? { customerProvidedNewPassword: true } : {},
          maxClaims: PUBLIC_MAX_CLAIMS,
        });
      return {
        success: false,
        status: "auto_check_pending",
        claimId: _queuedClaim.id,
        claimNumber: _queuedClaim.claimNumber,
        accessToken: _qToken,
        message: _enq.enqueued
          ? `Hệ thống đang kiểm tra tài khoản tự động${_enq.queuePosition ? ` (vị trí xếp hàng #${_enq.queuePosition})` : ""}. Vui lòng chờ trong giây lát.`
          : "Hệ thống hiện đang quá tải kiểm tra tài khoản. Yêu cầu của bạn đã được tạo, shop sẽ xem xét thủ công trong ít phút tới.",
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        previousReplacement,
        autoCheck: {
          tool: _autoCheckTool,
          status: _enq.enqueued ? "queued" : "overloaded",
          queuePosition: _enq.queuePosition,
          queueLoad: _enq.queueLoad,
        },
      };
    }

    const claimNumber = order.warrantyClaimCount + 1;
    // Cooldown is hard-rejected above, so we never reach here with cooldownBlocker set.
    const decision: ClaimDecision = !_autoCheckIsSupported
      ? {
          nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
          deliveredAccountText: null,
          resolutionNote: "Product family not yet supported by auto-check.",
          ownerAttentionRequired: true,
          customerMessage:
            "Hệ thống chưa cập nhật kiểm tra tự động cho dòng sản phẩm này. Yêu cầu bảo hành đã được chuyển cho admin xem xét.",
        }
      : internalSourceOrder
        ? await this.decideInternalSourceClaimRoute(internalSourceOrder, claimNumber, "vi")
        : await this.decideClaimRoute(order, claimNumber, "vi");

    // Prefer the order's sourcePriceSnapshot (the cost recorded at delivery) so accounting
    // stays consistent with the original purchase even if catalog sourcePrice has drifted
    // between order time and warranty time. Fall back to current sourcePrice only when the
    // snapshot is missing (legacy/unmigrated rows).
    const replacementCostSource = decimalToNumber(order.sourcePriceSnapshot)
      || decimalToNumber(internalSourceOrder?.sourceProduct.sourcePrice ?? order.sourceProduct.sourcePrice);

    const createdClaim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
      const lockedOrderOpen = await tx.order.findUnique({ where: { id: order.id }, select: { warrantyClaimCount: true } });
      const safeClaimNumber = (lockedOrderOpen?.warrantyClaimCount ?? 0) + 1;
      const slotsUsedTxOpen = await this.countNonRejectedClaims(order.id, tx, _openClaimTargetEmail);
      if (slotsUsedTxOpen + 1 > PUBLIC_MAX_CLAIMS) {
        throw new BadRequestException("Đơn này đã đạt số lần bảo hành tối đa. Vui lòng liên hệ shop để được hỗ trợ thêm.");
      }
      if (_openClaimTargetEmail) {
        const alreadyActiveTxOpen = await tx.warrantyClaim.findFirst({
          where: { orderId: order.id, status: { in: this.ACTIVE_CLAIM_STATUSES as any }, targetAccountEmail: _openClaimTargetEmail.toLowerCase() },
          select: { id: true },
        });
        if (alreadyActiveTxOpen) {
          throw new BadRequestException("Tài khoản này đang có yêu cầu bảo hành đang xử lý. Vui lòng chờ kết quả trước khi gửi yêu cầu mới.");
        }
      }
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
          claimNumber: safeClaimNumber,
          status: decision.nextStatus,
          orderCodeSnapshot: order.orderCode,
          productNameSnapshot: order.productNameSnapshot,
          warrantyPolicySnapshot: snapshot.warrantyPolicySnapshot,
          deliveryModeSnapshot: snapshot.warrantyDeliveryModeSnapshot,
          customerMessage: dto.customerMessage?.trim() || null,
          deliveredAccountText: decision.deliveredAccountText,
          resolutionNote: decision.resolutionNote,
          targetAccountEmail: _openClaimTargetEmail ? _openClaimTargetEmail.toLowerCase() : null,
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
        data: { warrantyClaimCount: safeClaimNumber },
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
    }

    if (decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED && decision.partialRefundCount) {
      await this.applyPartialStockRefund(order, createdClaim.id, decision.partialRefundCount);
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
    // Show ALL claims to the seller (including soft-failed retryable ones) so they have full
    // visibility — only the natural `status` filter separates urgent vs in-progress. Soft-
    // failed claims live at status=PENDING so they appear in "Đang chờ" / "Tất cả" tabs but
    // NOT in "Chờ duyệt thủ công" (status=PENDING_REVIEW). The previous global filter
    // (NOT metadataJson autoCheckSoftFailed) was too aggressive — it hid them from every tab
    // including "Tất cả", which left sellers blind to claims still being worked on.
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
      // Race guard vs applyAutoCheckResult: lock row + recheck.
      await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${claim.id} FOR UPDATE`;
      const locked = await tx.warrantyClaim.findUnique({
        where: { id: claim.id },
        select: { status: true, metadataJson: true },
      });
      if (!locked) {
        throw new NotFoundException("Warranty claim not found.");
      }
      if (this.isResolvedClaim(locked.status)) {
        throw new BadRequestException("Warranty claim is already closed.");
      }
      const lockedMeta = locked.metadataJson && typeof locked.metadataJson === "object" && !Array.isArray(locked.metadataJson)
        ? (locked.metadataJson as Record<string, unknown>)
        : {};
      if (lockedMeta.autoApplyInProgress === true) {
        throw new BadRequestException(
          "Hệ thống đang tự động xử lý kết quả kiểm tra cho claim này. Vui lòng thử lại sau vài giây.",
        );
      }
      await tx.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          status: WARRANTY_CLAIM_STATUS.RESOLVED_MANUAL,
          deliveredAccountText,
          resolutionNote,
          resolvedAt: new Date(),
          replacementCostSnapshot: sourceProduct?.sourcePrice ?? null,
          // Once seller resolves manually, the auto-check pipeline is moot. Mark CANCELLED so
          // sweeps + status polling reflect reality (vs. leaving QUEUED/RUNNING forever).
          autoCheckStatus:
            locked.status === WARRANTY_CLAIM_STATUS.PENDING
              ? WARRANTY_AUTO_CHECK_STATUS.CANCELLED
              : undefined,
          metadataJson: {
            ...lockedMeta,
            autoCheckPending: false,
            autoApplyInProgress: false,
            resolvedManuallyOverridingAutoCheck: true,
          } as Prisma.InputJsonValue,
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
      // Race guard vs applyAutoCheckResult: lock row + recheck status + sentinel.
      await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${claim.id} FOR UPDATE`;
      const locked = await tx.warrantyClaim.findUnique({
        where: { id: claim.id },
        select: { status: true, metadataJson: true },
      });
      if (!locked) {
        throw new NotFoundException("Warranty claim not found.");
      }
      if (this.isResolvedClaim(locked.status)) {
        throw new BadRequestException("Warranty claim is already closed.");
      }
      const lockedMeta = locked.metadataJson && typeof locked.metadataJson === "object" && !Array.isArray(locked.metadataJson)
        ? (locked.metadataJson as Record<string, unknown>)
        : {};
      if (lockedMeta.autoApplyInProgress === true) {
        throw new BadRequestException(
          "Hệ thống đang tự động xử lý kết quả kiểm tra cho claim này. Vui lòng thử lại sau vài giây.",
        );
      }
      await tx.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          status: WARRANTY_CLAIM_STATUS.REJECTED,
          resolutionNote: reason,
          resolvedAt: new Date(),
          // Cancel any pending auto-check pipeline (see resolveClaimManually for rationale).
          autoCheckStatus:
            locked.status === WARRANTY_CLAIM_STATUS.PENDING
              ? WARRANTY_AUTO_CHECK_STATUS.CANCELLED
              : undefined,
          metadataJson: {
            ...lockedMeta,
            autoCheckPending: false,
            autoApplyInProgress: false,
            rejectedManuallyOverridingAutoCheck: true,
          } as Prisma.InputJsonValue,
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

  /**
   * Re-enqueue an auto-check for an existing claim. Used when the previous run produced
   * timeouts or unsatisfactory results and the seller wants a fresh attempt.
   *
   * Blocked when:
   * - Claim is resolved (AUTO_RESOLVED / RESOLVED_MANUAL / REJECTED) — recheck is moot.
   * - Auto-check is currently QUEUED or RUNNING — would create a parallel job.
   * - Source product family isn't supported by the auto-check tools.
   * - Credentials cannot be parsed from the order's delivered account text.
   *
   * The claim's status (PENDING / PENDING_REVIEW / etc.) is left untouched — only the
   * `autoCheck*` columns are reset before re-enqueue. The worker callback will re-apply
   * the result via `applyAutoCheckResult`.
   */
  async recheckClaim(user: AuthenticatedUser, id: string) {
    const claim = await this.getManagedClaim(user.id, id);

    if (this.isResolvedClaim(claim.status)) {
      throw new BadRequestException("Warranty claim is already closed.");
    }

    const inFlight = [
      WARRANTY_AUTO_CHECK_STATUS.QUEUED,
      WARRANTY_AUTO_CHECK_STATUS.RUNNING,
    ] as const;
    if (claim.autoCheckStatus && (inFlight as readonly string[]).includes(claim.autoCheckStatus)) {
      throw new BadRequestException(
        "Đang có một lượt kiểm tra tự động đang chạy cho claim này. Vui lòng đợi kết quả trước khi yêu cầu kiểm tra lại.",
      );
    }

    // Reload order with sourceProduct + linked internal-source order so we can resolve the tool.
    const order = await this.prisma.order.findUnique({
      where: { id: claim.orderId },
      select: {
        id: true,
        sellerId: true,
        shopId: true,
        customerId: true,
        orderCode: true,
        productNameSnapshot: true,
        deliveredAccountText: true,
        sourceProduct: { select: { productFamily: true } },
      },
    });
    if (!order) {
      throw new NotFoundException("Order not found for this claim.");
    }

    const internalSourceOrder = await this.findLinkedInternalSourceOrder(order.orderCode, order.shopId);
    const sourceProductForAutoCheck = internalSourceOrder?.sourceProduct ?? order.sourceProduct;
    const autoCheckTool = this.autoCheckService.resolveToolForFamily(sourceProductForAutoCheck?.productFamily);
    if (!autoCheckTool) {
      throw new BadRequestException(
        "Sản phẩm này không hỗ trợ kiểm tra tự động — không thể chạy lại auto-check.",
      );
    }

    // Use the same credential-resolution logic as submitTelegramWarrantyClaim: validate
    // against the CURRENT active account (the latest warranty replacement, falling back
    // to the original delivery) but enqueue all of the order's delivered accounts so the
    // worker re-checks each one in parallel.
    const activeAccountText = await this.autoCheckService.getCurrentActiveAccountText(order.id);
    const claimMeta = claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
      ? (claim.metadataJson as Record<string, unknown>)
      : {};
    const storedTargets = Array.isArray(claimMeta.targetUsernames) ? (claimMeta.targetUsernames as string[]) : [];
    const targetForCheck = (claim.targetAccountEmail || storedTargets[0]) ?? null;

    let baseCreds = this.autoCheckService.parseFirstCredential(activeAccountText, targetForCheck);
    let allCreds = this.autoCheckService.parseAllCredentials(order.deliveredAccountText);
    // Drop accounts already replaced by a prior resolved claim — re-checking would issue a
    // duplicate replacement.
    const _recheckReplacedSet = await this.autoCheckService.getReplacedEmailSet(order.id);
    allCreds = this.autoCheckService.filterOutReplaced(allCreds, _recheckReplacedSet);
    if (storedTargets.length > 0) {
      const targets = storedTargets.map((u) => String(u).toLowerCase().trim());
      const filtered = allCreds.filter((c) =>
        targets.some((t) => {
          const e = c.email.toLowerCase();
          return e === t || e.split("@")[0] === t || e.startsWith(t);
        }),
      );
      if (filtered.length > 0) allCreds = filtered;
    }
    if (!baseCreds && allCreds.length > 0) baseCreds = allCreds[0] ?? null;
    if (!baseCreds) {
      throw new BadRequestException(
        "Không phân tách được tài khoản từ đơn hàng — không có gì để kiểm tra lại.",
      );
    }

    await this.prisma.warrantyClaim.update({
      where: { id: claim.id },
      data: {
        autoCheckStatus: null,
        autoCheckResult: Prisma.JsonNull,
        autoCheckErrorMessage: null,
        autoCheckCompletedAt: null,
        autoCheckStartedAt: null,
        autoCheckJobId: null,
      },
    });
    this.autoCheckService.invalidateStatus(claim.id);

    const enq = await this.autoCheckService.tryEnqueueForClaim(
      claim.id,
      autoCheckTool,
      baseCreds as { email: string; password: string; extra: string | null },
      order.shopId,
      allCreds.length > 0 ? allCreds : undefined,
    );

    return {
      success: true,
      claimId: claim.id,
      tool: autoCheckTool,
      enqueued: enq.enqueued,
      reason: (enq as any).reason ?? null,
      queuePosition: enq.queuePosition,
      queueLoad: enq.queueLoad,
      accountCount: allCreds.length || 1,
    };
  }

  /**
   * Called by the internal worker callback once an auto-check job finished writing its result.
   * Reads the stored result, applies the auto-decide policy (if enabled), and notifies the customer.
   *
   * Concurrency: wraps the read of (status, autoCheckStatus) and the subsequent state
   * transition in a single transaction that locks the claim row with `SELECT ... FOR UPDATE`.
   * Without this lock, a seller who manually resolves/rejects the claim on the dashboard at
   * the same moment as the worker callback could race us — both code paths read status=PENDING,
   * both apply their own resolution, and the inventory/customer wallet could be double-charged
   * (e.g. seller cuts a replacement acc from stock while we also auto-cut one).
   */
  async applyAutoCheckResult(claimId: string): Promise<void> {
    // Bust the status cache up-front so the very next poll sees the post-callback state.
    this.autoCheckService.invalidateStatus(claimId);
    const claim = await this.prisma.$transaction(async (tx) => {
      // Lock the claim row first — blocks resolveClaimManually / rejectClaim until we're done.
      await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${claimId} FOR UPDATE`;
      const c = await tx.warrantyClaim.findUnique({
        where: { id: claimId },
        include: {
          customer: true,
          order: true,
          shop: { include: { botConfig: true } },
        },
      });
      if (!c) return null;
      if (
        c.autoCheckStatus !== WARRANTY_AUTO_CHECK_STATUS.COMPLETED &&
        c.autoCheckStatus !== WARRANTY_AUTO_CHECK_STATUS.FAILED
      ) {
        // CANCELLED means seller resolved/rejected first — ignore late callbacks for this claim.
        return null;
      }
      if (c.status !== WARRANTY_CLAIM_STATUS.PENDING) {
        return null; // already moved on (seller resolved/rejected first)
      }
      // Stamp a sentinel marker so any concurrent reader sees we've taken ownership of
      // this claim — combined with the row lock, this commits the "claim belongs to the
      // auto path" intent before we drop the lock and do slower work (provider RPCs, etc).
      await tx.warrantyClaim.update({
        where: { id: claimId },
        data: {
          metadataJson: {
            ...(c.metadataJson && typeof c.metadataJson === "object" && !Array.isArray(c.metadataJson)
              ? (c.metadataJson as Record<string, unknown>)
              : {}),
            autoApplyInProgress: true,
          } as Prisma.InputJsonValue,
        },
      });
      return c;
    });
    if (!claim) return;
    // Also enforce that seller has not concurrently resolved the claim. resolveClaimManually
    // and rejectClaim both check `isResolvedClaim(claim.status)`; they will see the row
    // lock release with status still PENDING but our autoApplyInProgress sentinel set →
    // they should bail (we also add that guard in those methods below).
    try {
    const result: any = claim.autoCheckResult || {};
    const lang: string = "vi";

    const resultLine = this.autoCheckService.buildResultMessage(result, lang as "vi" | "en" | "th");

    const planText = String(result.plan || result.tier || "").toLowerCase().trim();
    const statusText = String(result.status || "").toLowerCase().trim();
    // Free plan = explicit "free" verdict from tool. Credit=0 alone is NOT enough — a paid
    // user can exhaust their monthly quota and credit=0 while the subscription is still
    // active. Trust an explicit free verdict, not a heuristic.
    const looksFree =
      planText === "free" || /^free$/i.test(String(result.tier || ""));
    // Multi-account: inspect accounts array for any dead/free account.
    // The top-level result only reflects the primary account's verdict; a secondary
    // account that dropped to Free must also trigger warranty even if primary is still paid.
    const accountsArr: any[] = Array.isArray(result.accounts) ? result.accounts : [];
    // Multi-account batch: any single account confirmed dead triggers warranty for THAT acc
    // (other still-paid accs in the order stay). Mirror the top-level dead-detection so
    // expired SuperGrok / Inactive subscriptions count here too — not just explicit isDead.
    const anyAccountDeadInArr =
      accountsArr.length > 1 &&
      accountsArr.some((a: any) => {
        const aTier = String(a.tier || "").toLowerCase().trim();
        const aPlan = String(a.plan || "").toLowerCase().trim();
        const aStatus = String(a.status || "").toLowerCase().trim();
        const aDays = typeof a.daysRemaining === "number" ? a.daysRemaining : null;
        const aPaidTier = ["supergrok", "heavy", "ultra"].includes(aTier);
        const aPaidTierExpired = aPaidTier && aStatus !== "active" && aDays !== null && aDays <= 0;
        return (
          a.isDead === true ||
          aTier === "free" ||
          aPlan === "free" ||
          /\b(die|dead|cancelled|canceled|blocked|suspended|disabled|banned|deactivated|inactive|ended|terminated)\b/i.test(aStatus) ||
          aPaidTierExpired
        );
      });
    // SECURITY: when customer provided their OWN password (via "đã đổi mật khẩu" toggle),
    // a wrong_password result is ambiguous — could be customer typo OR could be abuse
    // (entering random pw to trick system into granting replacement). Refuse to treat
    // wrong_password as "confirmed dead" in that case → route to seller manual review.
    const customerProvidedNewPassword = (claim.metadataJson as any)?.customerProvidedNewPassword === true;
    const errorTypeLower = String(result.errorType || "").toLowerCase();
    const wrongPasswordWithCustomerInput =
      customerProvidedNewPassword && errorTypeLower === "wrong_password";

    // Account confirmed unusable: explicit isDead flag from tool, OR known dead error types,
    // OR plan/tier dropped to Free (lost paid plan). These count as warranty-triggering even
    // when result.ok is false (e.g. wrong_password is still a "confirmed dead" verdict).
    // Regex notes:
    // - `\bexpired\b` (NOT `session_expired`): session_expired = needs re-login, NOT dead.
    // - errorType list explicitly excludes `session_expired` for the same reason.
    // Catch x.ai's "Inactive" / generic subscription-ended verdicts that toolgrok.js DOESN'T
    // flag with errorType=blocked (it only sets blocked on hard bans). For grok, when an
    // acc's subscription period ends naturally, the API returns plan info BUT status=Inactive
    // and daysRemaining<=0 — that's a sold-but-expired acc which the shop must refund. This
    // path is critical for SuperGrok/Heavy resold-to-customer scenarios where the original
    // owner let the subscription lapse.
    const tierText = String(result.tier || "").toUpperCase();
    const daysRem = typeof result.daysRemaining === "number" ? result.daysRemaining : null;
    const paidTier = ["SUPERGROK", "HEAVY", "ULTRA"].includes(tierText);
    const paidTierWithExpiredWindow =
      paidTier && statusText !== "active" && daysRem !== null && daysRem <= 0;

    const isDeadConfirmed =
      (!wrongPasswordWithCustomerInput &&
        (result.isDead === true ||
          ["blocked", "expired", "cancelled", "disabled", "deactivated", "banned", "inactive", "ended", "terminated"].includes(errorTypeLower) ||
          /\b(die|dead|cancelled|canceled|blocked|suspended|disabled|banned|deactivated|inactive|ended|terminated)\b/i.test(statusText) ||
          /(^|[^_])\bexpired\b/i.test(statusText) ||
          looksFree ||
          paidTierWithExpiredWindow)) ||
      anyAccountDeadInArr;

    // Only treat as "tool failure → seller review" when we DIDN'T get a death verdict.
    if (
      !isDeadConfirmed &&
      (claim.autoCheckStatus === WARRANTY_AUTO_CHECK_STATUS.FAILED || !result.ok)
    ) {
      const noteReason = wrongPasswordWithCustomerInput
        ? `Customer provided their own password but the login failed (wrong_password). Could be a typo OR an abuse attempt to trick auto-replacement. Manual seller verification required.`
        : `Auto-check failed: ${claim.autoCheckErrorMessage || result.error || "unknown error"}. Manual review needed.`;

      // Soft-fail decision: if the customer still has retries left (slot count < 3), DON'T
      // escalate to PENDING_REVIEW — leave status as PENDING, mark `autoCheckSoftFailed:true`,
      // skip the seller notification. The customer sees "Bảo hành lại" button and self-retries.
      // Only on the LAST allowed slot (slot count == MAX) do we escalate so the seller picks
      // it up. Without this, every ambiguous result would clog the seller's manual queue with
      // claims the customer might fix themselves by retrying with the correct password.
      const MAX_CLAIMS_PER_ORDER_APPLY = 3;
      const claimSlotCount = await this.prisma.warrantyClaim.count({
        where: {
          orderId: claim.orderId,
          status: { notIn: [WARRANTY_CLAIM_STATUS.REJECTED] as any },
        },
      });
      const isLastSlot = claimSlotCount >= MAX_CLAIMS_PER_ORDER_APPLY;
      const metaBase = (claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
        ? (claim.metadataJson as Record<string, unknown>)
        : {});

      if (isLastSlot) {
        // Customer used all 3 attempts — now escalate to seller manual review queue.
        await this.prisma.warrantyClaim.update({
          where: { id: claim.id },
          data: {
            status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
            resolutionNote: noteReason,
            metadataJson: {
              ...metaBase,
              autoCheckPending: false,
              ownerAttentionRequired: true,
              autoCheckSoftFailed: false,    // explicit clear when we DO escalate
              autoCheckSlotsUsed: claimSlotCount,
            } as Prisma.InputJsonValue,
          },
        });
        await this.notifyOwnerAboutClaim({
          shopId: claim.shopId,
          orderCode: claim.orderCodeSnapshot,
          productName: claim.productNameSnapshot,
          claimNumber: claim.claimNumber,
          status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
          customerLabel:
            claim.customer.telegramUsername ||
            [claim.customer.firstName, claim.customer.lastName].filter(Boolean).join(" ") ||
            claim.customer.telegramUserId,
          customerMessage: claim.customerMessage || undefined,
        }).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
      } else {
        // Soft fail — keep PENDING, no seller notification. Customer-controlled retry phase.
        // Critical: ALSO clear `autoApplyInProgress` here. The `finally` block at the end of
        // this method has a safety-net that re-writes the metadata if the sentinel is still
        // set and status is still PENDING — without clearing it here, that block would wipe
        // our `autoCheckSoftFailed` flag with a stale-merge from `claim.metadataJson`.
        await this.prisma.warrantyClaim.update({
          where: { id: claim.id },
          data: {
            // status intentionally NOT changed — stays at PENDING (initial value).
            resolutionNote: noteReason,
            metadataJson: {
              ...metaBase,
              autoCheckPending: false,
              autoCheckSoftFailed: true,
              autoCheckSlotsUsed: claimSlotCount,
              ownerAttentionRequired: false,
              autoApplyInProgress: false,
              autoApplyFailed: false,
            } as Prisma.InputJsonValue,
          },
        });
        this.logger.log(
          `Claim ${claim.id}: auto-check soft-failed (slot ${claimSlotCount}/${MAX_CLAIMS_PER_ORDER_APPLY}). Customer may retry — not escalating to seller yet.`,
        );
      }
      await this.sendAutoCheckCustomerNotice(claim, resultLine, "pending_review");
      return;
    }

    // stillPaid: only trust the tool's explicit boolean. A heuristic on plan text caused
    // false positives like `"expired_pro"` or `"Pro (cancelled)"` matching `pro` → wrong
    // auto-reject. If the tool didn't explicitly say `stillPaid: true`, fall through to
    // the ambiguous-result branch (seller manual review) rather than rejecting outright.
    // Only reject if primary is still paid AND no other account in the array is dead.
    const stillPaid = !looksFree && result.stillPaid === true && !anyAccountDeadInArr;
    const isDead = isDeadConfirmed;

    if (stillPaid) {
      const reason = lang === "en"
        ? `Auto-check confirms the account is still active (${result.plan || result.tier || "paid"}). Warranty not applicable.`
        : `Hệ thống kiểm tra cho thấy tài khoản vẫn còn hạn (${result.plan || result.tier || "paid"}). Yêu cầu bảo hành chưa đủ điều kiện.`;
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.warrantyClaim.update({
          where: { id: claim.id },
          data: {
            status: WARRANTY_CLAIM_STATUS.REJECTED,
            resolutionNote: reason,
            resolvedAt: new Date(),
            metadataJson: {
              ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
                ? (claim.metadataJson as Record<string, unknown>)
                : {}),
              autoCheckPending: false,
              autoRejected: true,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: claim.orderId,
            eventType: "warranty_claim_auto_rejected",
            payloadJson: { warrantyClaimId: claim.id, reason, result } as Prisma.InputJsonValue,
          },
        });
        return tx.warrantyClaim.findUnique({
          where: { id: claim.id },
          include: { customer: true, order: true, shop: { include: { botConfig: true } } },
        });
      });
      if (updated) {
        await this.notifyCustomerAboutRejectedClaim(updated, reason);
      }
      return;
    }

    // isDead → run full replacement flow (mirror decideClaimRoute)
    if (isDead) {
      const fullOrder = await this.prisma.order.findUnique({
        where: { id: claim.orderId },
        include: {
          customer: true,
          sourceProduct: true,
          shop: { include: { providerConfig: true, botConfig: true } },
          warrantyClaims: true,
        },
      });
      if (fullOrder) {
        const claimMeta = claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
          ? (claim.metadataJson as Record<string, unknown>)
          : {};
        const claimTargetUsernames = claimMeta.targetUsernames as string[] | undefined;
        // Only replace dead accounts — accounts that are stillPaid don't need a replacement.
        // Also count Free-tier accounts as dead (plan dropped from paid = needs warranty replacement).
        // Per-account "needs replacement" check — kept in sync with the top-level
        // isDeadConfirmed logic so we replace the same accounts the top-level verdict counts.
        // Adds the expired-paid-subscription case: SuperGrok/Heavy/Ultra acc that's no longer
        // active (status=Inactive/Cancelled/Expired) with no days remaining.
        const isDeadAccount = (a: any) => {
          const aTier = String(a.tier || "").toLowerCase().trim();
          const aPlan = String(a.plan || "").toLowerCase().trim();
          const aStatus = String(a.status || "").toLowerCase().trim();
          const aDays = typeof a.daysRemaining === "number" ? a.daysRemaining : null;
          const aPaidTier = ["supergrok", "heavy", "ultra"].includes(aTier);
          const aPaidTierExpired = aPaidTier && aStatus !== "active" && aDays !== null && aDays <= 0;
          const aStatusDead = /\b(die|dead|cancelled|canceled|blocked|suspended|disabled|banned|deactivated|inactive|ended|terminated)\b/i.test(aStatus);
          return (
            a.isDead === true ||
            aTier === "free" ||
            aPlan === "free" ||
            aStatusDead ||
            aPaidTierExpired
          ) && a.stillPaid !== true;
        };
        const deadAccountEmails: string[] = accountsArr.length > 0
          ? accountsArr.filter(isDeadAccount).map((a: any) => String(a.email || "").toLowerCase().trim()).filter(Boolean)
          : [];
        const deadAccountCount = accountsArr.length > 0 ? deadAccountEmails.length : 0;
        const claimQuantityOverride = deadAccountCount > 0
          ? deadAccountCount
          : (claimTargetUsernames?.length && claimTargetUsernames.length > 0 ? claimTargetUsernames.length : 1);
        const linkedInternal = await this.findLinkedInternalSourceOrder(fullOrder.orderCode, fullOrder.shopId);
        const decision = linkedInternal
          ? await this.decideInternalSourceClaimRoute(linkedInternal, claim.claimNumber, lang as "vi" | "en" | "th", claimQuantityOverride)
          : await this.decideClaimRoute(fullOrder, claim.claimNumber, lang as "vi" | "en" | "th", claimQuantityOverride);
        // Prefer order's snapshot (see decideClaimRoute callers for rationale).
        const replacementCostSource =
          decimalToNumber(fullOrder.sourcePriceSnapshot) ||
          decimalToNumber(linkedInternal?.sourceProduct.sourcePrice ?? fullOrder.sourceProduct.sourcePrice);

        // Only auto-refund when stock is confirmed exhausted (isOutOfStock === true).
        // When provider is still pending approval, hold the claim — provider may still deliver.
        if (decision.nextStatus === WARRANTY_CLAIM_STATUS.PENDING_STOCK && decision.isOutOfStock === true) {
          await this.autoRefundForOutOfStock(fullOrder, claim, result);
          return;
        }

        await this.prisma.$transaction(async (tx) => {
          if (decision.manualStockUpdate) {
            const sourceMetadata = this.asRecord(fullOrder.sourceProduct.metadataJson);
            await tx.sourceProduct.update({
              where: { id: fullOrder.sourceProductId },
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
          await tx.warrantyClaim.update({
            where: { id: claim.id },
            data: {
              status: decision.nextStatus,
              deliveredAccountText: decision.deliveredAccountText,
              resolutionNote: `${decision.resolutionNote} (Auto-decided after auto-check.)`,
              resolvedAt:
                decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED ? new Date() : null,
              replacementCostSnapshot:
                decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED
                  ? replacementCostSource
                  : null,
              metadataJson: {
                ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
                  ? (claim.metadataJson as Record<string, unknown>)
                  : {}),
                autoCheckPending: false,
                autoResolved: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
                autoCheckResultSummary: resultLine,
                // Emails of accounts confirmed dead/Free — used by wasAccountSpecificallyReplaced
                // to distinguish "this account died" from "sibling account died in same claim".
                ...(deadAccountEmails.length > 0 ? { replacedAccountEmails: deadAccountEmails } : {}),
              } as Prisma.InputJsonValue,
            },
          });
          await tx.orderEvent.create({
            data: {
              orderId: claim.orderId,
              eventType: "warranty_claim_auto_resolved_after_check",
              payloadJson: {
                warrantyClaimId: claim.id,
                nextStatus: decision.nextStatus,
                autoCheckResult: result,
              } as Prisma.InputJsonValue,
            },
          });
        });

        if (decision.ownerAttentionRequired) {
          await this.notifyOwnerAboutClaim({
            shopId: claim.shopId,
            orderCode: claim.orderCodeSnapshot,
            productName: claim.productNameSnapshot,
            claimNumber: claim.claimNumber,
            status: decision.nextStatus,
            customerLabel:
              claim.customer.telegramUsername ||
              [claim.customer.firstName, claim.customer.lastName].filter(Boolean).join(" ") ||
              claim.customer.telegramUserId,
            customerMessage: claim.customerMessage || undefined,
          }).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
        }

        if (decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED && decision.deliveredAccountText) {
          await this.sendAutoResolvedCustomerNotice(
            claim,
            decision.deliveredAccountText,
            decision.customerMessage,
          );
          if (decision.partialRefundCount) {
            await this.applyPartialStockRefund(fullOrder, claim.id, decision.partialRefundCount);
          }
        } else {
          await this.sendAutoCheckCustomerNotice(claim, resultLine, "pending_review");
        }
        return;
      }
    }

    // Ambiguous result → seller manual review with result attached
    await this.prisma.warrantyClaim.update({
      where: { id: claim.id },
      data: {
        status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
        resolutionNote: "Auto-check completed but result is ambiguous. Seller review needed.",
        metadataJson: {
          ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
            ? (claim.metadataJson as Record<string, unknown>)
            : {}),
          autoCheckPending: false,
          ownerAttentionRequired: true,
          autoCheckResultSummary: resultLine,
        } as Prisma.InputJsonValue,
      },
    });
    await this.notifyOwnerAboutClaim({
      shopId: claim.shopId,
      orderCode: claim.orderCodeSnapshot,
      productName: claim.productNameSnapshot,
      claimNumber: claim.claimNumber,
      status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
      customerLabel:
        claim.customer.telegramUsername ||
        [claim.customer.firstName, claim.customer.lastName].filter(Boolean).join(" ") ||
        claim.customer.telegramUserId,
      customerMessage: claim.customerMessage || undefined,
    }).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
    await this.sendAutoCheckCustomerNotice(claim, resultLine, "pending_review");
    } finally {
      // Failsafe for crash mid-flight: if `autoApplyInProgress` sentinel is STILL set, clear
      // it + mark autoApplyFailed. Without this, the seller's manual resolve/reject would be
      // permanently blocked by the sentinel.
      //
      // Surgical: use jsonb_set so we ONLY touch those two keys — don't merge a stale
      // claim.metadataJson snapshot which could wipe in-flight updates like autoCheckSoftFailed.
      // WHERE clause filters by `autoApplyInProgress=true` so the update is a no-op on every
      // normal path (success / reject / soft-fail) that already cleared the sentinel.
      await this.prisma.$executeRawUnsafe(
        `UPDATE warranty_claims
           SET metadata_json = jsonb_set(
             jsonb_set(
               COALESCE(metadata_json, '{}'::jsonb),
               '{autoApplyInProgress}', 'false'::jsonb, true
             ),
             '{autoApplyFailed}', 'true'::jsonb, true
           )
         WHERE id = $1
           AND status = 'PENDING'
           AND COALESCE((metadata_json->>'autoApplyInProgress')::boolean, false) = true`,
        claim.id,
      ).catch((e) => this.logger.warn(`Failsafe metadata clear failed: ${e?.message ?? e}`));
    }
  }

  /**
   * Refund customer wallet when warranty cannot be honoured because replacement stock is unavailable.
   * Refund amount is prorated by the number of accounts being claimed (vs. order.quantity).
   * - Credits customer wallet via CustomerWalletLedger type=REFUND_ORDER
   * - Marks claim as RESOLVED_MANUAL with refund note
   * - If full order refunded, also marks order as REFUNDED
   * - Notifies customer via Telegram bot
   */
  private durationTypeToDays(durationType: string | null | undefined): number | null {
    switch (durationType) {
      case "DAY_1": return 1;
      case "DAY_7": return 7;
      case "MONTH_1": return 30;
      case "MONTH_3": return 90;
      case "MONTH_6": return 180;
      case "MONTH_12": return 365;
      default: return null; // LIFETIME, OTHER, null → no time proration
    }
  }

  private async autoRefundForOutOfStock(
    fullOrder: Prisma.OrderGetPayload<{
      include: {
        customer: true;
        sourceProduct: true;
        shop: { include: { providerConfig: true; botConfig: true } };
      };
    }>,
    claim: Prisma.WarrantyClaimGetPayload<{
      include: { customer: true; order: true; shop: { include: { botConfig: true } } };
    }>,
    autoCheckResult: any,
  ) {
    const targetUsernames = (claim.metadataJson as any)?.targetUsernames as string[] | undefined;
    const claimedCount = targetUsernames?.length && targetUsernames.length > 0 ? targetUsernames.length : fullOrder.quantity;
    const orderTotal = decimalToNumber(fullOrder.totalSaleAmount);

    // Quantity proration: only refund for accounts being claimed
    const baseRefundByQty = Math.round((orderTotal * claimedCount) / Math.max(1, fullOrder.quantity));

    // Time proration: refund only for remaining unused days
    const durationDays = this.durationTypeToDays(fullOrder.sourceProduct.durationType);
    let daysUsed: number | null = null;
    let daysRemaining: number | null = null;
    let timeRatio = 1;
    if (durationDays !== null && fullOrder.deliveredAt) {
      daysUsed = Math.floor((Date.now() - fullOrder.deliveredAt.getTime()) / 86400000);
      daysRemaining = Math.max(0, durationDays - daysUsed);
      timeRatio = daysRemaining / durationDays;
    }

    const refundAmount = Math.round(baseRefundByQty * timeRatio);
    const isFullRefund = claimedCount >= fullOrder.quantity;

    if (refundAmount <= 0) {
      // Edge case: zero refund (free order?). Just mark resolved.
      await this.prisma.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          status: WARRANTY_CLAIM_STATUS.RESOLVED_MANUAL,
          resolutionNote: "Stock unavailable; refund amount was 0.",
          resolvedAt: new Date(),
          metadataJson: {
            ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
              ? (claim.metadataJson as Record<string, unknown>)
              : {}),
            autoCheckPending: false,
            autoRefundedZero: true,
          } as Prisma.InputJsonValue,
        },
      });
      return;
    }

    // Auto-refund policy: refund the END CUSTOMER's wallet immediately (in the shop's scope),
    // AND cascade up the source chain to recoup the shop. End customers must NOT be left
    // waiting for a manual transfer — that was the original behavior and it created a hole
    // where shop owners could "forget" to refund. We refund first; cascade second.
    //
    // Idempotency: if a ledger entry with referenceType="warranty_refund" referenceId=claim.id
    // already exists for this claim, skip the refund (this method got retried).
    let creditedToCustomer = false;
    await this.prisma.$transaction(async (tx) => {
      // Safety: re-read the claim inside the transaction to ensure no account was delivered
      // between the out-of-stock decision and now (e.g. provider approved after a delay).
      const freshClaim = await tx.warrantyClaim.findUnique({
        where: { id: claim.id },
        select: { deliveredAccountText: true, status: true },
      });
      if (freshClaim?.deliveredAccountText || freshClaim?.status === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED) {
        return;
      }
      const existingRefund = await tx.customerWalletLedger.findFirst({
        where: {
          referenceType: "warranty_refund",
          referenceId: claim.id,
          customerId: fullOrder.customerId,
        },
        select: { id: true },
      });
      if (!existingRefund) {
        // Credit customer wallet in this shop's scope.
        let wallet = await tx.customerWallet.findUnique({
          where: { customerId: fullOrder.customerId },
        });
        if (!wallet) {
          wallet = await tx.customerWallet.create({
            data: { customerId: fullOrder.customerId, balance: 0 },
          });
        }
        await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`;
        const fresh = await tx.customerWallet.findUnique({ where: { id: wallet.id } });
        const balanceBefore = decimalToNumber(fresh?.balance ?? 0);
        const balanceAfter = balanceBefore + refundAmount;
        await tx.customerWallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter },
        });
        await tx.customerWalletLedger.create({
          data: {
            customerId: fullOrder.customerId,
            walletId: wallet.id,
            type: "REFUND_ORDER",
            currency: "VND",
            amount: refundAmount,
            balanceBefore,
            balanceAfter,
            referenceType: "warranty_refund",
            referenceId: claim.id,
            note: `Hoàn ví ${refundAmount.toLocaleString("vi-VN")}đ — đơn ${fullOrder.orderCode} hết hàng thay thế${claimedCount < fullOrder.quantity ? ` (${claimedCount}/${fullOrder.quantity} tài khoản)` : ""}${daysUsed !== null ? `, đã dùng ${daysUsed}/${durationDays} ngày` : ""}.`,
          },
        });
        creditedToCustomer = true;
      }

      if (isFullRefund) {
        await tx.order.update({
          where: { id: fullOrder.id },
          data: { status: "REFUNDED" },
        });
      }
      await tx.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          status: WARRANTY_CLAIM_STATUS.RESOLVED_MANUAL,
          resolutionNote: `Hết hàng thay thế. Hoàn ${refundAmount.toLocaleString("vi-VN")}đ vào ví khách (${claimedCount}/${fullOrder.quantity} tài khoản${daysUsed !== null ? `, ${daysRemaining}/${durationDays} ngày còn lại` : ""}). Shop sẽ được hoàn từ upstream qua cascade refund (nếu có).`,
          resolvedAt: new Date(),
          replacementCostSnapshot: refundAmount,
          metadataJson: {
            ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
              ? (claim.metadataJson as Record<string, unknown>)
              : {}),
            autoCheckPending: false,
            autoRefunded: true,
            refundAmount,
            refundedAccountsCount: claimedCount,
            ...(daysUsed !== null ? { daysUsed, daysRemaining, durationDays, timeProrated: true } : {}),
            customerRefundedToWallet: true,
            autoApplyInProgress: false,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: fullOrder.id,
          eventType: "warranty_auto_refunded_out_of_stock",
          payloadJson: {
            warrantyClaimId: claim.id,
            refundAmount,
            claimedCount,
            isFullRefund,
            autoCheckResult,
            customerCredited: creditedToCustomer,
            note: "Customer wallet credited; cascade upstream queued.",
          } as Prisma.InputJsonValue,
        },
      });
    });

    // Notify customer via Telegram bot: refund is already in their wallet.
    const token = decryptSecret(claim.shop.botConfig?.telegramBotTokenEncrypted, this.config.encryptionKey);
    if (token && claim.customer?.telegramChatId && !(this.config.mockTelegramEnabled && isMockBotToken(token))) {
      const timeNote = daysUsed !== null
        ? `Đã sử dụng ${daysUsed}/${durationDays} ngày, còn lại ${daysRemaining} ngày.`
        : null;
      const lines = [
        "💰 Bảo hành — hết hàng thay thế",
        `Mã đơn: ${claim.orderCodeSnapshot}`,
        "",
        "Hệ thống không còn tài khoản thay thế cho đơn này.",
        timeNote,
        `Đã hoàn ${refundAmount.toLocaleString("vi-VN")}đ vào ví của bạn. Bạn có thể dùng số dư này để mua đơn khác.`,
        "",
        this.buildSupportText(claim.shop.supportTelegram, claim.shop.supportZalo),
      ].filter(Boolean);
      await telegramSendMessage(token, claim.customer.telegramChatId, lines.join("\n")).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
    }

    // Notify shop owner — cascade refund to their upstream wallet runs below.
    await this.notifyOwnerAboutClaim({
      shopId: claim.shopId,
      orderCode: claim.orderCodeSnapshot,
      productName: claim.productNameSnapshot,
      claimNumber: claim.claimNumber,
      status: WARRANTY_CLAIM_STATUS.RESOLVED_MANUAL,
      customerLabel:
        claim.customer.telegramUsername ||
        [claim.customer.firstName, claim.customer.lastName].filter(Boolean).join(" ") ||
        claim.customer.telegramUserId,
      customerMessage: `Hết hàng thay thế. Đã hoàn ${refundAmount.toLocaleString("vi-VN")}đ vào ví khách hàng. Hệ thống đang chuyển hoàn ngược upstream cho bạn (nếu có).`,
    }).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));

    // Cascade refund UP the chain. Đại lý refunds CTV's wallet, Nguồn refunds Đại lý's wallet, etc.
    // Stops when reaching external provider (canboso) — admin reconciles those manually.
    await this.cascadeRefundUpstream(
      fullOrder.shopId,
      fullOrder.orderCode,
      claim.id,
      `Warranty out of stock for downstream order ${fullOrder.orderCode}`,
    ).catch((err) => {
      this.logger.error(`[warranty] Cascade refund failed for claim ${claim.id}: ${err?.message ?? err}`);
    });
  }

  private async applyPartialStockRefund(
    order: { id: string; quantity: number; totalSaleAmount: Prisma.Decimal | number; orderCode: string; customerId: string },
    claimId: string,
    partialRefundCount: number,
  ): Promise<void> {
    const orderTotal = decimalToNumber(order.totalSaleAmount as Prisma.Decimal);
    const refundAmount = Math.round(orderTotal * partialRefundCount / Math.max(1, order.quantity));
    if (refundAmount <= 0) return;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerWalletLedger.findFirst({
        where: { referenceType: "warranty_partial_refund", referenceId: claimId, customerId: order.customerId },
        select: { id: true },
      });
      if (existing) return;

      let wallet = await tx.customerWallet.findUnique({ where: { customerId: order.customerId } });
      if (!wallet) {
        wallet = await tx.customerWallet.create({ data: { customerId: order.customerId, balance: 0 } });
      }
      await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`;
      const fresh = await tx.customerWallet.findUnique({ where: { id: wallet.id } });
      const balanceBefore = decimalToNumber(fresh?.balance ?? 0);
      const balanceAfter = balanceBefore + refundAmount;
      await tx.customerWallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
      await tx.customerWalletLedger.create({
        data: {
          customerId: order.customerId,
          walletId: wallet.id,
          type: "REFUND_ORDER",
          currency: "VND",
          amount: refundAmount,
          balanceBefore,
          balanceAfter,
          referenceType: "warranty_partial_refund",
          referenceId: claimId,
          note: `Hoàn ví ${refundAmount.toLocaleString("vi-VN")}đ — đơn ${order.orderCode} thiếu hàng bảo hành ${partialRefundCount}/${order.quantity} tài khoản.`,
        },
      });
    });
  }

  /**
   * Walk up the source chain crediting each upstream seller's wallet for their lost revenue.
   * Each step finds the InternalSourceOrder linking downstream→upstream, credits the downstream
   * seller's customer wallet (in upstream's shop scope), records ledger entries, and recurses.
   * Stops when no internal upstream exists (external provider like canboso) — admin handles those manually.
   */
  private async cascadeRefundUpstream(
    currentShopId: string,
    currentOrderCode: string,
    rootClaimId: string,
    reason: string,
    depth: number = 0,
  ): Promise<void> {
    if (depth > 10) return; // safety guard against pathological loops
    const iso = await this.prisma.internalSourceOrder.findFirst({
      where: { downstreamShopId: currentShopId, downstreamOrderCode: currentOrderCode },
      include: { connection: true },
    });
    if (!iso) {
      // No internal upstream — the current shop sells to external provider (canboso, etc.)
      // Log so admin knows to reconcile manually with the external provider.
      this.logger.warn(
        `[warranty cascade] Reached external provider at shop ${currentShopId} for order ${currentOrderCode}. ` +
          `Reason: ${reason}. Admin should reconcile with external provider.`,
      );
      return;
    }
    const refundAmount = decimalToNumber(iso.totalAmount);
    if (refundAmount <= 0) return;
    const downstreamTelegramChatId = iso.connection.downstreamTelegramChatId;
    if (!downstreamTelegramChatId) {
      this.logger.warn(`[warranty cascade] Connection ${iso.connectionId} missing downstreamTelegramChatId.`);
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      // Idempotency: cascade can be re-fired by retries or sweep. Refuse to double-credit
      // the same upstream link for the same root claim. We scope by referenceType+referenceId
      // AND connectionId so distinct upstream hops are still independent.
      // NOTE: returning early here only exits the transaction callback; recursion below still runs.
      const existingCascade = await tx.internalSourceLedger.findFirst({
        where: {
          referenceType: "warranty_cascade_refund",
          referenceId: rootClaimId,
          connectionId: iso.connectionId,
        },
        select: { id: true },
      });
      if (existingCascade) {
        return; // already refunded this hop — recursion below ensures upstream hops are checked too
      }

      const customer = await tx.customer.findFirst({
        where: { shopId: iso.upstreamShopId, telegramChatId: downstreamTelegramChatId },
        include: { wallet: true },
      });
      if (!customer) {
        this.logger.warn(
          `[warranty cascade] Downstream seller not registered as customer in upstream shop ${iso.upstreamShopId}.`,
        );
        return;
      }
      let walletId = customer.wallet?.id;
      let balanceBefore = 0;
      if (walletId) {
        await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${walletId} FOR UPDATE`;
        const fresh = await tx.customerWallet.findUnique({ where: { id: walletId } });
        balanceBefore = decimalToNumber(fresh?.balance ?? 0);
      } else {
        const created = await tx.customerWallet.create({
          data: { customerId: customer.id, balance: 0 },
        });
        walletId = created.id;
        balanceBefore = 0;
      }
      const balanceAfter = balanceBefore + refundAmount;
      await tx.customerWallet.update({
        where: { id: walletId },
        data: { balance: balanceAfter },
      });
      await tx.customerWalletLedger.create({
        data: {
          customerId: customer.id,
          walletId,
          type: "REFUND_ORDER",
          currency: "VND",
          amount: refundAmount,
          balanceBefore,
          balanceAfter,
          referenceType: "warranty_cascade_refund",
          referenceId: rootClaimId,
          note: `Cascade refund ${refundAmount.toLocaleString("vi-VN")}đ cho đơn upstream ${iso.sourceOrderCode} (downstream order ${currentOrderCode}). ${reason}`,
        },
      });
      await tx.internalSourceLedger.create({
        data: {
          connectionId: iso.connectionId,
          type: "REFUND_ORDER",
          amount: refundAmount,
          balanceBefore,
          balanceAfter,
          referenceType: "warranty_cascade_refund",
          referenceId: rootClaimId,
          note: `Refund ${refundAmount.toLocaleString("vi-VN")}đ cho ${iso.sourceOrderCode} (cascade depth=${depth + 1})`,
        },
      });
      await tx.internalSourceOrder.update({
        where: { id: iso.id },
        data: {
          status: "CANCELED",
          failureReason: `Cascade refunded from downstream warranty: ${reason}`,
        },
      });
    });
    // Recurse: upstream shop also needs to recoup from ITS upstream (if any).
    await this.cascadeRefundUpstream(
      iso.upstreamShopId,
      iso.sourceOrderCode,
      rootClaimId,
      reason,
      depth + 1,
    );
  }

  /**
   * Saves the bot's initial "đang kiểm tra…" message id on the claim so that when the
   * auto-check finalizes we can EDIT that message in place (showing replacement account +
   * invoice) instead of sending yet another reply. Mirrors the web flow where one URL stays
   * up and refreshes as the check progresses.
   */
  async updateBotProgressContext(
    claimId: string,
    ctx: { shopId: string; chatId: number; messageId: number },
  ): Promise<void> {
    const existing = await this.prisma.warrantyClaim.findUnique({
      where: { id: claimId },
      select: { metadataJson: true },
    });
    if (!existing) return;
    const meta: Record<string, unknown> =
      existing.metadataJson && typeof existing.metadataJson === "object" && !Array.isArray(existing.metadataJson)
        ? { ...(existing.metadataJson as Record<string, unknown>) }
        : {};
    meta.botProgressContext = {
      shopId: ctx.shopId,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      anchoredAt: new Date().toISOString(),
    };
    await this.prisma.warrantyClaim.update({
      where: { id: claimId },
      data: { metadataJson: meta as Prisma.InputJsonValue },
    });
  }

  /**
   * Returns the bot's initial-reply (chatId, messageId) if the claim was started from
   * Telegram with a tracked message. Used by the auto-check notice helpers to decide between
   * edit-in-place and send-new.
   */
  private extractBotProgressContext(
    claim: Prisma.WarrantyClaimGetPayload<{ include: { customer: true; shop: { include: { botConfig: true } } } }>,
  ): { chatId: number; messageId: number } | null {
    const meta = claim.metadataJson;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
    const ctx = (meta as Record<string, unknown>).botProgressContext;
    if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return null;
    const obj = ctx as Record<string, unknown>;
    const chatId = Number(obj.chatId);
    const messageId = Number(obj.messageId);
    if (!Number.isFinite(chatId) || !Number.isFinite(messageId) || chatId === 0 || messageId === 0) return null;
    return { chatId, messageId };
  }

  /** HTML-escape (same rules used by the existing replacement-account block). */
  private escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /**
   * Compact warranty receipt for the customer's Telegram message — sandwiched between `━`
   * rules so it visually separates from the result header. Includes the buyer's Telegram
   * handle so the receipt is self-identifying when forwarded (or when the customer cross-
   * references with shop chat history).
   */
  private async buildClaimInvoiceMessage(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        productNameSnapshot: true,
        quantity: true,
        totalSaleAmount: true,
        warrantyExpiresAt: true,
        customer: { select: { telegramUsername: true, firstName: true, telegramChatId: true } },
        shop: { select: { supportTelegram: true, supportZalo: true } },
      },
    });
    if (!order) return null;
    const expiresLine = order.warrantyExpiresAt
      ? order.warrantyExpiresAt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
      : "vĩnh viễn";
    const total = Number(order.totalSaleAmount).toLocaleString("vi-VN");
    const product = this.escapeHtml(order.productNameSnapshot);
    const qty = order.quantity;
    const buyerLabel = order.customer?.telegramUsername
      ? `@${order.customer.telegramUsername}${order.customer.firstName ? ` (${order.customer.firstName})` : ""}`
      : order.customer?.firstName
        ? order.customer.firstName
        : order.customer?.telegramChatId
          ? `#${order.customer.telegramChatId}`
          : null;
    const support = order.shop.supportTelegram || order.shop.supportZalo || "";
    const supportLine = support ? `💬 ${this.escapeHtml(support)}` : "";
    const rule = "━━━━━━━━━━━━━━━━━";
    return [
      rule,
      `📦 ${product} · ${qty} acc · ${total}đ`,
      buyerLabel ? `👤 ${this.escapeHtml(buyerLabel)}` : null,
      `⏰ Hạn ${this.escapeHtml(expiresLine)}`,
      supportLine,
      rule,
    ].filter(Boolean).join("\n");
  }

  private formatWarrantyPolicyHuman(policy: string | null | undefined): string {
    if (!policy) return "Không có";
    switch (String(policy).toUpperCase()) {
      case "KBH":   return "Không bảo hành";
      case "BH24H": return "24 giờ";
      case "BH1M":  return "1 tháng";
      case "BH3M":  return "3 tháng";
      case "BH6M":  return "6 tháng";
      case "BH12M": return "12 tháng";
      case "BHF":   return "Vĩnh viễn";
      default:      return String(policy);
    }
  }

  /**
   * Single helper for both edit-in-place and fresh-send. Returns true if the message was
   * delivered (either by edit or send). Centralises the "anchor exists → edit, else send"
   * decision so the AUTO_RESOLVED and PENDING paths don't drift.
   */
  /**
   * Inline keyboard for the result message — gives the customer a one-tap path back into the
   * warranty flow for THE SAME ORDER, skipping the orderCode lookup step. The "Bảo hành lại"
   * button fires callback `warranty_claim:<orderCode>` (handled by telegram-bot.service.v2),
   * which jumps straight to the password Y/N prompt. Useful when:
   *   - 3-pass ambiguous check ran out and customer thinks they typed the wrong password
   *   - Auto-resolved acc is also bad (customer wants to try again on the replacement)
   *   - Customer disagrees with the verdict and wants a re-check
   */
  private buildResultKeyboard(claim: { orderCodeSnapshot: string }): Record<string, unknown> {
    return {
      inline_keyboard: [
        [{ text: "🛡 Bảo hành lại", callback_data: `warranty_claim:${claim.orderCodeSnapshot}` }],
        [{ text: "🔍 Tìm đơn bảo hành khác", callback_data: "warranty:start" }],
        [{ text: "🏠 Trang chủ", callback_data: "home:menu" }],
      ],
    };
  }

  private async deliverBotMessage(
    claim: Prisma.WarrantyClaimGetPayload<{ include: { customer: true; shop: { include: { botConfig: true } } } }>,
    token: string,
    text: string,
  ): Promise<boolean> {
    const replyMarkup = this.buildResultKeyboard(claim);
    const ctx = this.extractBotProgressContext(claim);
    if (ctx) {
      const edited = await telegramEditMessageText(token, ctx.chatId, ctx.messageId, text, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }).catch((e) => {
        this.logger.warn(`Telegram edit failed (${claim.id}): ${e?.message ?? e}`);
        return null;
      });
      if (edited) return true;
      // Edit can fail if the customer deleted the original message — fall through to send.
    }
    if (!claim.customer?.telegramChatId) return false;
    await telegramSendMessage(token, claim.customer.telegramChatId, text, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    }).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
    return true;
  }

  /**
   * AUTO_RESOLVED message (Style C — premium card layout). The icon header already says
   * "successful", and the credentials below say "here's your account", so we drop the
   * verbose customerMessage entirely — every word costs scanning time on mobile.
   *
   * Layout:
   *   ✨🎉 BẢO HÀNH ✓ 🎉✨
   *   📝 Mã đơn: ORD-...
   *   🔑 Tài khoản thay thế
   *   <pre>creds here</pre>
   *   ━━━━━━━━━━━━━━━━━
   *   📦 Product · N acc · price
   *   ⏰ Hạn dd/mm/yyyy
   *   💬 @support
   *   ━━━━━━━━━━━━━━━━━
   */
  private async sendAutoResolvedCustomerNotice(
    claim: Prisma.WarrantyClaimGetPayload<{ include: { customer: true; shop: { include: { botConfig: true } } } }>,
    deliveredAccountText: string,
    _customerMessage: string, // intentionally unused — header + creds convey the outcome
  ) {
    const token = decryptSecret(claim.shop.botConfig?.telegramBotTokenEncrypted, this.config.encryptionKey);
    if (!token || !claim.customer?.telegramChatId || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      return;
    }
    const invoice = await this.buildClaimInvoiceMessage(claim.orderId).catch(() => null);
    const text = [
      "✨🎉 <b>BẢO HÀNH</b> ✓ 🎉✨",
      "",
      `📝 Mã đơn: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`,
      "",
      "🔑 <b>Tài khoản thay thế</b>",
      `<pre>${this.escapeHtml(deliveredAccountText)}</pre>`,
      "",
      invoice || "",
    ].filter((s, i, arr) => s !== "" || (i > 0 && arr[i - 1] !== "")).join("\n").trimEnd();

    await this.deliverBotMessage(claim, token, text);
  }

  /**
   * Map tool errorType → customer-readable Vietnamese reason. Tells the customer WHAT
   * went wrong so they can decide whether retrying makes sense (e.g. wrong_password → check
   * the password they typed, 2fa → can't fix from bot side, cf_timeout → just retry).
   */
  private describeAutoCheckErrorReason(errorType: string | null | undefined): string {
    const et = String(errorType || "").toLowerCase();
    if (et === "wrong_password" || et === "login_stuck") return "Có thể sai mật khẩu hoặc tài khoản đã đổi mật khẩu";
    if (et === "2fa") return "Tài khoản yêu cầu xác thực 2 bước (OTP)";
    if (et === "proxy_die") return "Lỗi kết nối — vui lòng thử lại";
    if (et === "cf_timeout") return "Cloudflare chặn tạm thời — thử lại sau ít phút";
    if (et === "blocked") return "Tài khoản bị khoá";
    return "Hệ thống chưa kiểm chính xác — có thể do mạng chậm";
  }

  /**
   * Ambiguous-verdict message — auto-check couldn't conclude. Wording emphasises that the
   * customer can self-retry via the "Bảo hành lại" inline button (up to MAX_CLAIMS_PER_ORDER
   * attempts total), rather than passively waiting for seller manual review. Surfaces the
   * specific error reason (wrong password / 2fa / network) so customer knows WHY retrying
   * might help.
   */
  private async sendAutoCheckCustomerNotice(
    claim: Prisma.WarrantyClaimGetPayload<{ include: { customer: true; shop: { include: { botConfig: true } } } }>,
    _resultLine: string, // intentionally unused — header note above
    _nextStatus: string,
  ) {
    const token = decryptSecret(claim.shop.botConfig?.telegramBotTokenEncrypted, this.config.encryptionKey);
    if (!token || !claim.customer?.telegramChatId || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      return;
    }
    const invoice = await this.buildClaimInvoiceMessage(claim.orderId).catch(() => null);
    // Pull the specific error reason out of the auto-check result. The result lives on the
    // claim row by the time this notice is sent (worker wrote it before firing the callback).
    const autoResult = claim.autoCheckResult && typeof claim.autoCheckResult === "object" && !Array.isArray(claim.autoCheckResult)
      ? (claim.autoCheckResult as Record<string, unknown>)
      : null;
    const errorType = autoResult ? String(autoResult.errorType || "") : "";
    const reasonLine = this.describeAutoCheckErrorReason(errorType);
    const text = [
      "⚠ <b>Chưa xác minh được</b>",
      "",
      `📝 Mã đơn: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`,
      "",
      this.escapeHtml(reasonLine) + ".",
      "Bấm <b>🛡 Bảo hành lại</b> để thử thêm, hoặc shop sẽ xem xét nếu vẫn không xác minh được.",
      "",
      invoice || "",
    ].filter((s, i, arr) => s !== "" || (i > 0 && arr[i - 1] !== "")).join("\n").trimEnd();

    await this.deliverBotMessage(claim, token, text);
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

    // Cooldown hard-reject — already warrantied successfully recently.
    const _cdCfg = await this.autoCheckService.getConfig();
    const _cdBlock = await this.autoCheckService.findCooldownBlocker(order.id, _cdCfg.cooldownDays);
    if (_cdBlock) {
      const lastDate = _cdBlock.lastResolvedAt.toLocaleDateString(language === "en" ? "en-GB" : "vi-VN");
      const untilDate = _cdBlock.blockedUntil.toLocaleDateString(language === "en" ? "en-GB" : "vi-VN");
      return {
        eligible: false,
        status: "cooldown_already_warrantied",
        message: language === "en"
          ? `This order was already warrantied successfully on ${lastDate}. No further warranty claims are accepted until ${untilDate}. Please contact the shop if the replacement account is broken.`
          : language === "th"
            ? `คำสั่งซื้อนี้ได้รับการรับประกันสำเร็จเมื่อ ${lastDate} จะไม่รับคำขอเพิ่มจนถึง ${untilDate}`
            : `Đơn này đã được bảo hành thành công ngày ${lastDate}. Hệ thống không nhận thêm yêu cầu đến ${untilDate}. Vui lòng liên hệ shop nếu acc thay thế thực sự lỗi.`,
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
    currentPassword?: string;
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

    const _blockTargetEmail = this.autoCheckService.parseFirstCredential(
      order.deliveredAccountText, input.targetUsernames?.[0] ?? null
    )?.email ?? null;
    const _hasActiveForTarget = await this.hasActiveClaimForAccount(order.id, _blockTargetEmail);
    if (_hasActiveForTarget) {
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

    const cooldownConfig = await this.autoCheckService.getConfig();
    const cooldownBlocker = await this.autoCheckService.findCooldownBlocker(order.id, cooldownConfig.cooldownDays, _blockTargetEmail);

    let quantityOverride: number | undefined;
    if (input.targetUsernames && input.targetUsernames.length > 0) {
      const allAccounts = this.parseDeliveredAccounts(order.deliveredAccountText);
      const validUsernameSet = new Set(allAccounts.map((a) => this.extractUsername(a)));
      // Customers may type either the bare username ("kza56w5js2") or the full email
      // ("kza56w5js2@empva1.io.vn") or even the whole credential pair pasted from the bot
      // reply. Normalize each input down to the bare username before comparing — matches
      // the shape `extractUsername` produces for the order's account list.
      const normalize = (raw: string) => {
        const head = String(raw).trim().toLowerCase().split(/[\s|]+/)[0] ?? "";
        return head.split("@")[0] ?? head;
      };
      const invalid = input.targetUsernames.filter((u) => !validUsernameSet.has(normalize(u)));
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

    // Resolve active account text + target email sớm để count per-account thay vì per-order.
    const activeAccountText = await this.autoCheckService.getCurrentActiveAccountText(order.id);
    const _earlyTargetEmail = input.targetUsernames?.[0] ?? null;
    const _earlyBaseCreds = this.autoCheckService.parseFirstCredential(activeAccountText, _earlyTargetEmail);

    // Bumped 2 → 3 so customers can self-retry on ambiguous auto-check verdicts (typo'd
    // password, transient CF block, etc.) before falling back to seller manual review. With
    // 3 attempts, only persistently failing accounts end up needing seller intervention.
    const MAX_CLAIMS_PER_ORDER = 3;
    const slotsUsed = await this.countNonRejectedClaims(order.id, undefined, _earlyBaseCreds?.email ?? null);
    if (slotsUsed + 1 > MAX_CLAIMS_PER_ORDER) {
      return {
        success: false,
        status: "too_many_claims",
        message:
          lang === "en"
            ? "This order has reached the maximum number of warranty claims. Please contact the seller for further assistance."
            : lang === "th"
              ? "คำสั่งซื้อนี้ถึงจำนวนคำขอรับประกันสูงสุดแล้ว กรุณาติดต่อผู้ขายโดยตรง"
              : "Đơn này đã đạt số lần bảo hành tối đa. Vui lòng liên hệ shop để được hỗ trợ thêm.",
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
      };
    }

    const sourceProductForAutoCheck = internalSourceOrder?.sourceProduct ?? order.sourceProduct;
    const autoCheckTool = this.autoCheckService.resolveToolForFamily(sourceProductForAutoCheck?.productFamily);
    const autoCheckConfig = await this.autoCheckService.getConfig();
    const isSupportedFamily = !!autoCheckTool;
    const targetForCheck = input.targetUsernames?.[0] ?? null;
    const baseCredsRaw = this.autoCheckService.parseFirstCredential(activeAccountText, targetForCheck);
    // allCreds dùng deliveredAccountText (tài khoản gốc đầy đủ), không dùng activeAccountText
    // vì activeAccountText có thể là text thay thế (chỉ chứa 1-2 tk) → filter sẽ miss tài khoản còn lại.
    let allCreds = this.autoCheckService.parseAllCredentials(order.deliveredAccountText);
    const _allCredsCountRaw = allCreds.length;
    // Strip accounts already replaced by a prior resolved claim — re-warrantying them would
    // issue a duplicate replacement. Customer's "leave target empty = warranty whole order"
    // path used to include these silently; now we drop them up-front.
    const _replacedSet = await this.autoCheckService.getReplacedEmailSet(order.id);
    allCreds = this.autoCheckService.filterOutReplaced(allCreds, _replacedSet);
    // If target is empty AND every parseable original got dropped (= all already warrantied),
    // explain instead of falling through to a confusing "system doesn't support auto-check".
    if (!input.targetUsernames?.length && _allCredsCountRaw > 0 && allCreds.length === 0) {
      return {
        success: false,
        status: "all_accounts_replaced",
        claimId: null,
        claimNumber: null,
        message:
          lang === "en"
            ? "Every account on this order has already been warrantied and replaced. If a replacement account has an issue, please look it up using that new account."
            : lang === "th"
              ? "ทุกบัญชีในคำสั่งซื้อนี้ได้รับการรับประกันและเปลี่ยนแล้ว หากบัญชีทดแทนมีปัญหา กรุณาค้นหาด้วยบัญชีทดแทนนั้น"
              : "Tất cả tài khoản trong đơn này đều đã được bảo hành và thay thế. Nếu tài khoản thay thế có vấn đề, vui lòng tra cứu bằng tài khoản thay thế đó.",
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
      };
    }
    // Guard against parseFirstCredential's single-account fallback: if a target was specified but
    // the returned credential's email doesn't actually match, treat it as not found.
    const targetEmailMatch = !targetForCheck || !baseCredsRaw || (() => {
      const e = baseCredsRaw.email.toLowerCase();
      const t = targetForCheck.toLowerCase().trim();
      return e === t || e.split("@")[0] === t || e.startsWith(t);
    })();
    let baseCreds = targetEmailMatch ? baseCredsRaw : null;

    // targetForCheck not found in activeAccountText: check whether it's an original account that
    // was specifically replaced vs. just another account in a multi-account order whose sibling
    // was replaced. Only block when wasAccountSpecificallyReplaced; otherwise fall back to the
    // original delivery credential so the auto-check can proceed normally.
    if (targetForCheck && !baseCreds) {
      const originalCred = this.autoCheckService.parseFirstCredential(order.deliveredAccountText, targetForCheck);
      if (originalCred) {
        const wasReplaced = await this.autoCheckService.wasAccountSpecificallyReplaced(order.id, targetForCheck);
        if (wasReplaced) {
          return {
            success: false,
            status: "account_already_replaced",
            claimId: null,
            claimNumber: null,
            message:
              lang === "en"
                ? "This account has already been warrantied and replaced. Please use your current replacement account for warranty."
                : lang === "th"
                  ? "บัญชีนี้ได้รับการรับประกันและเปลี่ยนแล้ว กรุณาใช้บัญชีทดแทนปัจจุบัน"
                  : "Tài khoản này đã được bảo hành và thay thế rồi. Vui lòng dùng tài khoản thay thế hiện tại để bảo hành.",
            deliveredAccountText: null,
            orderCode: order.orderCode,
            supportTelegram: order.shop.supportTelegram,
            supportZalo: order.shop.supportZalo,
            supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
          };
        }
        // Not specifically replaced — fall back to original credential.
        // allCreds already built from deliveredAccountText; no need to reset — filter below picks targets.
        baseCreds = originalCred;
      }
    }

    // Customer named specific accounts → only check those, not the whole order.
    if (input.targetUsernames && input.targetUsernames.length > 0) {
      const targets = input.targetUsernames.map((u) => u.toLowerCase().trim());
      const filtered = allCreds.filter((c) =>
        targets.some((t) => { const e = c.email.toLowerCase(); return e === t || e.split("@")[0] === t || e.startsWith(t); }),
      );
      if (filtered.length > 0) allCreds = filtered;
    }

    // Fallback: nếu target[0] không parse được, dùng tk parseable đầu tiên trong allCreds.
    if (!baseCreds && allCreds.length > 0) {
      baseCreds = allCreds[0] ?? null;
    }

    // If customer reported they changed the password after delivery, override it for the check.
    const overridePassword = input.currentPassword?.trim();
    const creds = baseCreds && overridePassword
      ? { ...baseCreds, password: overridePassword }
      : baseCreds;

    // Áp password override lên primary account trong allCreds.
    if (creds) {
      allCreds = allCreds.map((c) =>
        c.email.toLowerCase() === creds.email.toLowerCase() ? creds : c,
      );
    }

    // Nếu customer chỉ định tài khoản có trong activeAccountText nhưng KHÔNG có trong
    // deliveredAccountText gốc → đây là tài khoản được cấp qua bảo hành trước.
    // Yêu cầu liên hệ shop / bảo hành tay thay vì tiếp tục auto flow.
    if (targetForCheck && baseCreds) {
      const isOriginalAccount = !!this.autoCheckService.parseFirstCredential(
        order.deliveredAccountText,
        targetForCheck,
      );
      if (!isOriginalAccount) {
        return {
          success: false,
          status: "replacement_account",
          claimId: null,
          claimNumber: null,
          message:
            lang === "en"
              ? "This account was provided as a warranty replacement. If it still has an issue, please contact the shop directly or submit a manual warranty request."
              : lang === "th"
                ? "บัญชีนี้ถูกมอบให้เป็นบัญชีทดแทนจากการรับประกัน หากยังมีปัญหากรุณาติดต่อร้านค้าโดยตรง"
                : "Tài khoản này được cấp qua bảo hành. Nếu vẫn gặp sự cố, vui lòng liên hệ shop trực tiếp hoặc gửi yêu cầu bảo hành thủ công.",
          deliveredAccountText: null,
          orderCode: order.orderCode,
          supportTelegram: order.shop.supportTelegram,
          supportZalo: order.shop.supportZalo,
          supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
        };
      }
    }

    // Cooldown HARD reject — order had a recent successful replacement.
    // Don't create a new claim; just reject outright. This prevents the abuse pattern
    // where a customer keeps re-submitting on the same (already-replaced) account.
    if (cooldownBlocker) {
      const lastDate = cooldownBlocker.lastResolvedAt.toLocaleDateString(lang === "en" ? "en-GB" : "vi-VN");
      const untilDate = cooldownBlocker.blockedUntil.toLocaleDateString(lang === "en" ? "en-GB" : "vi-VN");
      return {
        success: false,
        status: "cooldown_rejected",
        claimId: null,
        claimNumber: null,
        message:
          lang === "en"
            ? `This order was already warrantied successfully on ${lastDate}. To prevent abuse, no further warranty claims are accepted until ${untilDate}. If the replacement account is genuinely broken, please contact the shop directly via Telegram / Zalo.`
            : lang === "th"
              ? `คำสั่งซื้อนี้ได้รับการรับประกันสำเร็จแล้วเมื่อ ${lastDate} เพื่อป้องกันการละเมิด ระบบจะไม่รับคำขอเพิ่มจนถึง ${untilDate} หากบัญชีทดแทนเสียจริง กรุณาติดต่อร้านโดยตรง`
              : `Đơn này đã được bảo hành thành công ngày ${lastDate}. Để tránh lạm dụng, hệ thống không nhận thêm yêu cầu cho đơn này đến ${untilDate}. Nếu tài khoản thay thế bị lỗi thật, vui lòng liên hệ shop trực tiếp qua Telegram / Zalo.`,
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
      };
    }

    if (isSupportedFamily && creds && autoCheckTool) {
      const { claim: queuedClaim, accessToken: queuedAccessToken, enq, previousReplacement } =
        await this.createAutoCheckClaim({
          order,
          snapshot,
          autoCheckTool,
          creds,
          allCreds,
          customerMessage: input.customerMessage,
          extraMetadata: {
            ...(input.targetUsernames ? { targetUsernames: input.targetUsernames } : {}),
            ...(overridePassword ? { customerProvidedNewPassword: true } : {}),
          },
          maxClaims: MAX_CLAIMS_PER_ORDER,
          targetEmail: _blockTargetEmail,
          cooldownDays: cooldownConfig.cooldownDays,
        });

      const overloadedMessage = lang === "en"
        ? "The system is currently overloaded with account checks. Your request was created but the auto-check is paused — the seller will handle it manually shortly."
        : lang === "th"
          ? "ระบบกำลังตรวจสอบบัญชีจำนวนมาก ระบบจะให้ผู้ขายตรวจสอบให้คุณด้วยตนเอง"
          : "Hệ thống hiện đang quá tải kiểm tra tài khoản. Yêu cầu của bạn đã được tạo, shop sẽ xem xét thủ công trong ít phút tới — vui lòng chờ.";

      const queuedMessage = lang === "en"
        ? `Auto-check started${enq.queuePosition ? ` (queue position #${enq.queuePosition})` : ""}. Please wait a moment — the result will be sent here shortly.`
        : lang === "th"
          ? `ระบบเริ่มตรวจสอบบัญชีอัตโนมัติ${enq.queuePosition ? ` (คิว #${enq.queuePosition})` : ""}. กรุณารอสักครู่`
          : `Hệ thống đang kiểm tra tài khoản tự động${enq.queuePosition ? ` (vị trí xếp hàng #${enq.queuePosition})` : ""}. Vui lòng chờ trong giây lát — kết quả sẽ được gửi tại đây.`;

      const customerMessage = enq.enqueued ? queuedMessage : overloadedMessage;

      return {
        success: false,
        status: "auto_check_pending",
        claimId: queuedClaim.id,
        claimNumber: queuedClaim.claimNumber,
        accessToken: queuedAccessToken,
        message: customerMessage,
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
        previousReplacement,
        autoCheck: {
          tool: autoCheckTool,
          status: enq.enqueued ? "queued" : "overloaded",
          queuePosition: enq.queuePosition,
          queueLoad: enq.queueLoad,
        },
      };
    }

    if (!isSupportedFamily) {
      const unsupportedMessage = lang === "en"
        ? "Auto-check is not yet supported for this product family. Your warranty request has been forwarded to the shop owner for manual review. Please contact admin if needed."
        : lang === "th"
          ? "ระบบยังไม่รองรับการตรวจสอบอัตโนมัติสำหรับสินค้าประเภทนี้ คำขอของคุณถูกส่งไปให้เจ้าของร้านตรวจสอบ"
          : "Hệ thống chưa cập nhật kiểm tra tự động cho dòng sản phẩm này. Yêu cầu bảo hành đã được chuyển cho admin xem xét, vui lòng liên hệ quản trị viên nếu cần.";
      const { token: unsupportedAccessToken, hash: unsupportedTokenHash } = this.autoCheckService.generateAccessToken();
      const unsupportedClaim = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
        const lockedOrder = await tx.order.findUnique({
          where: { id: order.id },
          select: { warrantyClaimCount: true },
        });
        const safeClaimNumber = (lockedOrder?.warrantyClaimCount ?? 0) + 1;
        const slotsUsedTx = await this.countNonRejectedClaims(order.id, tx, _earlyBaseCreds?.email ?? null);
        if (slotsUsedTx + 1 > MAX_CLAIMS_PER_ORDER) {
          throw new BadRequestException("Too many warranty claims for this order.");
        }
        if (_blockTargetEmail) {
          const alreadyActiveTx = await tx.warrantyClaim.findFirst({
            where: {
              orderId: order.id,
              status: { in: this.ACTIVE_CLAIM_STATUSES as any },
              targetAccountEmail: _blockTargetEmail.toLowerCase(),
            },
            select: { id: true },
          });
          if (alreadyActiveTx) {
            throw new BadRequestException("Tài khoản này đang có yêu cầu bảo hành đang xử lý. Vui lòng chờ kết quả trước khi gửi yêu cầu mới.");
          }
        }
        const created = await tx.warrantyClaim.create({
          data: {
            orderId: order.id,
            sellerId: order.sellerId,
            shopId: order.shopId,
            customerId: order.customerId,
            claimNumber: safeClaimNumber,
            status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
            orderCodeSnapshot: order.orderCode,
            productNameSnapshot: order.productNameSnapshot,
            warrantyPolicySnapshot: snapshot.warrantyPolicySnapshot,
            deliveryModeSnapshot: snapshot.warrantyDeliveryModeSnapshot,
            customerMessage: input.customerMessage?.trim() || null,
            deliveredAccountText: null,
            targetAccountEmail: _blockTargetEmail ? _blockTargetEmail.toLowerCase() : null,
            resolutionNote: "Product family not yet supported by auto-check.",
            autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.UNSUPPORTED,
            metadataJson: {
              ownerAttentionRequired: true,
              unsupportedFamily: sourceProductForAutoCheck?.productFamily ?? null,
              accessTokenHash: unsupportedTokenHash,
              ...(input.targetUsernames ? { targetUsernames: input.targetUsernames } : {}),
            } as Prisma.InputJsonValue,
          },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { warrantyClaimCount: safeClaimNumber },
        });
        return created;
      });
      await this.notifyOwnerAboutClaim({
        shopId: order.shopId,
        orderCode: order.orderCode,
        productName: order.productNameSnapshot,
        claimNumber,
        status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
        customerLabel:
          order.customer.telegramUsername ||
          [order.customer.firstName, order.customer.lastName].filter(Boolean).join(" ") ||
          order.customer.telegramUserId,
        customerMessage: input.customerMessage,
      }).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
      return {
        success: false,
        status: "auto_check_unsupported",
        claimId: unsupportedClaim.id,
        claimNumber: unsupportedClaim.claimNumber,
        accessToken: unsupportedAccessToken,
        message: unsupportedMessage,
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        supportText: this.buildSupportText(order.shop.supportTelegram, order.shop.supportZalo),
      };
    }

    const decision = internalSourceOrder
      ? await this.decideInternalSourceClaimRoute(internalSourceOrder, claimNumber, lang, quantityOverride)
      : await this.decideClaimRoute(order, claimNumber, lang, quantityOverride);

    // Prefer the order's sourcePriceSnapshot (the cost recorded at delivery) so accounting
    // stays consistent with the original purchase even if catalog sourcePrice has drifted
    // between order time and warranty time. Fall back to current sourcePrice only when the
    // snapshot is missing (legacy/unmigrated rows).
    const replacementCostSource = decimalToNumber(order.sourcePriceSnapshot)
      || decimalToNumber(internalSourceOrder?.sourceProduct.sourcePrice ?? order.sourceProduct.sourcePrice);

    const createdClaim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
      const lockedOrderStateTg = await tx.order.findUnique({ where: { id: order.id }, select: { warrantyClaimCount: true } });
      const safeClaimNumber = (lockedOrderStateTg?.warrantyClaimCount ?? 0) + 1;
      const slotsUsedTx = await this.countNonRejectedClaims(order.id, tx, _earlyBaseCreds?.email ?? null);
      if (slotsUsedTx + 1 > MAX_CLAIMS_PER_ORDER) {
        throw new BadRequestException("Đơn này đã đạt số lần bảo hành tối đa. Vui lòng liên hệ shop để được hỗ trợ thêm.");
      }
      if (_blockTargetEmail) {
        const alreadyActiveTx = await tx.warrantyClaim.findFirst({
          where: {
            orderId: order.id,
            status: { in: this.ACTIVE_CLAIM_STATUSES as any },
            targetAccountEmail: _blockTargetEmail.toLowerCase(),
          },
          select: { id: true },
        });
        if (alreadyActiveTx) {
          throw new BadRequestException("Tài khoản này đang có yêu cầu bảo hành đang xử lý. Vui lòng chờ kết quả trước khi gửi yêu cầu mới.");
        }
      }
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
          claimNumber: safeClaimNumber,
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
          targetAccountEmail: _blockTargetEmail ? _blockTargetEmail.toLowerCase() : null,
          metadataJson: {
            ownerAttentionRequired: decision.ownerAttentionRequired,
            ...(input.targetUsernames ? { targetUsernames: input.targetUsernames } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { warrantyClaimCount: safeClaimNumber },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "warranty_claim_created",
          payloadJson: {
            warrantyClaimId: claim.id,
            claimNumber: safeClaimNumber,
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
      }).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
    }

    if (decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED && decision.partialRefundCount) {
      await this.applyPartialStockRefund(order, createdClaim.id, decision.partialRefundCount);
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
    // BUG-5 fix: also match orders whose latest warranty replacement contains the queried account.
    // (order.deliveredAccountText stays as original; replacement accounts live on warranty claims.)
    const orders = await this.prisma.order.findMany({
      where: {
        shopId: shop.id,
        status: OrderStatus.DELIVERED,
        OR: [
          { deliveredAccountText: { contains: accountText, mode: "insensitive" } },
          {
            warrantyClaims: {
              some: {
                status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
                deliveredAccountText: { contains: accountText, mode: "insensitive" },
              },
            },
          },
        ],
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

      // Per-account: "Đang có yêu cầu bảo hành" chỉ hiện khi ĐÚNG tài khoản này đang có claim active.
      const hasActiveClaim = await this.hasActiveClaimForAccount(order.id, accountText);

      // Detect if the searched account was REPLACED in a prior warranty claim.
      // i.e. accountText matched order.deliveredAccountText (original) but a resolved claim
      // has issued a replacement → the searched acc is stale.
      const originalMatches = (order.deliveredAccountText ?? "")
        .toLowerCase()
        .includes(accountText.toLowerCase());
      const latestResolvedClaim = await this.prisma.warrantyClaim.findFirst({
        where: {
          orderId: order.id,
          status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
          deliveredAccountText: { not: null },
        },
        orderBy: { resolvedAt: "desc" },
        select: { deliveredAccountText: true, resolvedAt: true },
      });
      const wasReplaced =
        originalMatches &&
        !!latestResolvedClaim &&
        !(latestResolvedClaim.deliveredAccountText || "")
          .toLowerCase()
          .includes(accountText.toLowerCase());
      const previousReplacement = wasReplaced && latestResolvedClaim?.resolvedAt
        ? {
            replacedAt: latestResolvedClaim.resolvedAt,
            // Return masked replacement (just username before @) for customer awareness without
            // exposing the full credentials.
            replacementUsernameMasked: this.maskAccountForDisplay(latestResolvedClaim.deliveredAccountText),
          }
        : null;

      // Account usernames for the per-account password-override grid on the warranty form.
      // Build from the order's original delivered text, then drop accounts already replaced
      // by a prior resolved claim — those won't be auto-checked again, so they shouldn't
      // appear as choices in the per-account password grid either.
      const _searchReplacedSet = await this.autoCheckService.getReplacedEmailSet(order.id);
      const accountUsernames = this.autoCheckService
        .filterOutReplaced(
          this.autoCheckService.parseAllCredentials(order.deliveredAccountText),
          _searchReplacedSet,
        )
        .map((c) => c.email);

      results.push({
        orderId: order.id,
        orderCode: order.orderCode,
        productName: order.productNameSnapshot,
        deliveredAt: order.deliveredAt,
        warrantyExpiresAt: snapshot.warrantyExpiresAt,
        warrantyPolicy: snapshot.warrantyPolicySnapshot?.toLowerCase(),
        hasActiveClaim,
        previousReplacement,
        accountUsernames,
      });
    }

    return {
      shop: { name: shop.name, supportTelegram: shop.supportTelegram, supportZalo: shop.supportZalo },
      orders: results,
    };
  }

  // Build a "warranty invoice" payload for the public-facing UI: the static order
  // info + a live count of resolved claims. Shown on the web result step so the
  // customer sees a professional receipt of what they bought + warranty state.
  private async buildPublicInvoice(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderCode: true,
        productNameSnapshot: true,
        quantity: true,
        totalSaleAmount: true,
        status: true,
        createdAt: true,
        deliveredAt: true,
        deliveredAccountText: true,
        warrantyPolicySnapshot: true,
        warrantyStartedAt: true,
        warrantyExpiresAt: true,
        customer: { select: { telegramUsername: true, firstName: true, telegramChatId: true } },
        shop: { select: { supportTelegram: true, name: true } },
        warrantyClaims: {
          where: { status: { in: [WARRANTY_CLAIM_STATUS.AUTO_RESOLVED, WARRANTY_CLAIM_STATUS.RESOLVED_MANUAL] as any } },
          select: { id: true },
        },
      },
    });
    if (!order) return null;
    return {
      orderCode:            order.orderCode,
      productName:          order.productNameSnapshot,
      sellerContact:        order.shop.supportTelegram || null,
      sellerShopName:       order.shop.name,
      buyerUsername:        order.customer?.telegramUsername || null,
      buyerName:            order.customer?.firstName || null,
      buyerTelegramId:      order.customer?.telegramChatId || null,
      deliveredAccountText: order.deliveredAccountText,
      quantity:             order.quantity,
      totalSaleAmount:      decimalToNumber(order.totalSaleAmount),
      warrantyPolicy:       order.warrantyPolicySnapshot,
      warrantyStartedAt:    order.warrantyStartedAt?.toISOString() || null,
      warrantyExpiresAt:    order.warrantyExpiresAt?.toISOString() || null,
      createdAt:            order.createdAt.toISOString(),
      deliveredAt:          order.deliveredAt?.toISOString() || null,
      orderStatus:          order.status,
      resolvedClaimCount:   order.warrantyClaims.length,
    };
  }

  async publicSubmitClaim(dto: PublicWarrantyClaimDto) {
    // Idempotency: cùng (shopSlug, idempotencyKey) trong 10 phút → trả lại response cũ
    // thay vì tạo claim mới. Bảo vệ khỏi double-click / mạng retry POST / back-forward.
    // Scope theo shopSlug để 2 shop khác nhau không đụng key. Không có key → run thẳng
    // (backward-compat cho client cũ chưa gửi).
    const cacheKey = dto.idempotencyKey ? `warranty:claim:${dto.shopSlug}:${dto.idempotencyKey}` : null;
    return this.idempotency.runOnce(cacheKey, () => this._publicSubmitClaimImpl(dto));
  }

  private async _publicSubmitClaimImpl(dto: PublicWarrantyClaimDto) {
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

    // Validate targetUsernames: mỗi username phải thuộc deliveredAccountText của đơn.
    if (dto.targetUsernames && dto.targetUsernames.length > 0) {
      const allDeliveredAccounts = this.parseDeliveredAccounts(order.deliveredAccountText);
      const validSet = new Set(allDeliveredAccounts.map((a) => this.extractUsername(a)));
      const notInOrder = (dto.targetUsernames as string[]).filter((u) => !validSet.has(((u ?? "").toLowerCase().trim().split("@")[0]) ?? ""));
      if (notInOrder.length > 0) {
        throw new BadRequestException(
          `Tài khoản sau không thuộc đơn hàng này nên không thể bảo hành: ${notInOrder.join(", ")}. Vui lòng kiểm tra lại.`,
        );
      }
    }

    // Resolve account text + target email before cooldown check so cooldown is per-account.
    const _autoCheckActiveAccText = await this.autoCheckService.getCurrentActiveAccountText(order.id);
    const _publicTargetEmailEarly = dto.targetUsernames?.[0] ?? null;
    const _earlyBaseCredsRaw = this.autoCheckService.parseFirstCredential(_autoCheckActiveAccText, _publicTargetEmailEarly);
    const _blockTargetEmail = _earlyBaseCredsRaw?.email ?? null;

    const cooldownConfig = await this.autoCheckService.getConfig();
    const cooldownBlocker = await this.autoCheckService.findCooldownBlocker(order.id, cooldownConfig.cooldownDays, _blockTargetEmail);
    const _hasActiveForTarget = await this.hasActiveClaimForAccount(order.id, _blockTargetEmail);
    if (_hasActiveForTarget) {
      throw new BadRequestException("Tài khoản này đang có yêu cầu bảo hành đang xử lý. Vui lòng chờ kết quả trước khi gửi yêu cầu mới.");
    }

    // Bumped 2 → 3 (matches submitTelegramWarrantyClaim + openClaim). Self-retry capacity.
    const PUBLIC_MAX_CLAIMS = 3;
    const _existingSlotsUsed = await this.countNonRejectedClaims(order.id, undefined, _earlyBaseCredsRaw?.email ?? null);
    if (_existingSlotsUsed + 1 > PUBLIC_MAX_CLAIMS) {
      throw new BadRequestException(
        "Đơn này đã đạt số lần bảo hành tối đa. Vui lòng liên hệ shop để được hỗ trợ thêm.",
      );
    }

    // Cooldown HARD reject — order already received a successful warranty replacement.
    if (cooldownBlocker) {
      const lastDate = cooldownBlocker.lastResolvedAt.toLocaleDateString("vi-VN");
      const untilDate = cooldownBlocker.blockedUntil.toLocaleDateString("vi-VN");
      throw new BadRequestException(
        `Đơn này đã được bảo hành thành công ngày ${lastDate}. Để tránh lạm dụng, hệ thống không nhận thêm yêu cầu cho đơn này đến ${untilDate}. Nếu tài khoản thay thế bị lỗi thật, vui lòng liên hệ shop trực tiếp.`,
      );
    }

    // Auto-check branch: if family supported + creds parseable + no cooldown active → enqueue check.
    const _autoCheckSourceProduct = internalSourceOrder?.sourceProduct ?? order.sourceProduct;
    const _autoCheckTool = this.autoCheckService.resolveToolForFamily(_autoCheckSourceProduct?.productFamily);
    const _autoCheckIsSupported = !!_autoCheckTool;
    const _autoCheckBaseCredsRaw = this.autoCheckService.parseFirstCredential(_autoCheckActiveAccText, dto.targetUsernames?.[0] ?? null);
    // allCreds dùng deliveredAccountText (tài khoản gốc đầy đủ), không dùng activeAccountText.
    let _autoCheckAllCreds = this.autoCheckService.parseAllCredentials(order.deliveredAccountText);
    const _publicAllCredsCountRaw = _autoCheckAllCreds.length;
    // Drop already-replaced accounts so empty-target ("warranty whole order") doesn't re-check
    // accounts that were already swapped via a prior resolved claim.
    const _publicReplacedSet = await this.autoCheckService.getReplacedEmailSet(order.id);
    _autoCheckAllCreds = this.autoCheckService.filterOutReplaced(_autoCheckAllCreds, _publicReplacedSet);
    if (
      !dto.targetUsernames?.length &&
      _publicAllCredsCountRaw > 0 &&
      _autoCheckAllCreds.length === 0
    ) {
      throw new BadRequestException(
        "Tất cả tài khoản trong đơn này đều đã được bảo hành và thay thế. Nếu tài khoản thay thế có vấn đề, vui lòng tra cứu bằng tài khoản thay thế đó.",
      );
    }
    const _publicTargetForCheck = dto.targetUsernames?.[0] ?? null;
    // Guard against single-account fallback in parseFirstCredential.
    const _autoCheckTargetMatch = !_publicTargetForCheck || !_autoCheckBaseCredsRaw || (() => {
      const e = _autoCheckBaseCredsRaw.email.toLowerCase();
      const t = _publicTargetForCheck.toLowerCase().trim();
      return e === t || e.split("@")[0] === t || e.startsWith(t);
    })();
    let _autoCheckBaseCreds = _autoCheckTargetMatch ? _autoCheckBaseCredsRaw : null;

    // Per-account checks: account đã bảo hành/thay thế, hoặc là tk được cấp qua bảo hành.
    if (_publicTargetForCheck) {
      if (!_autoCheckBaseCreds) {
        const originalCred = this.autoCheckService.parseFirstCredential(order.deliveredAccountText, _publicTargetForCheck);
        if (originalCred) {
          const wasReplaced = await this.autoCheckService.wasAccountSpecificallyReplaced(order.id, _publicTargetForCheck);
          if (wasReplaced) {
            throw new BadRequestException(
              "Tài khoản này đã được bảo hành và thay thế rồi. Vui lòng dùng tài khoản thay thế hiện tại để bảo hành.",
            );
          }
          // Not specifically replaced — fall back to original credential.
          // allCreds already from deliveredAccountText; filter below picks the targets.
          _autoCheckBaseCreds = originalCred;
        }
      } else {
        const isOriginalAccount = !!this.autoCheckService.parseFirstCredential(order.deliveredAccountText, _publicTargetForCheck);
        if (!isOriginalAccount) {
          throw new BadRequestException(
            "Tài khoản này được cấp qua bảo hành. Nếu vẫn gặp sự cố, vui lòng liên hệ shop trực tiếp hoặc gửi yêu cầu bảo hành thủ công.",
          );
        }
      }
    }

    const _autoCheckOverridePwd = (dto as any).currentPassword
      ? String((dto as any).currentPassword).trim()
      : undefined;
    const _autoCheckOverrides = (dto as any).passwordOverrides as Record<string, string> | undefined;

    // Filter allCreds to only accounts user specified — tránh check cả đơn khi chỉ nhập vài tk.
    // Chạy TRƯỚC khi xác định _autoCheckCreds để fallback hoạt động đúng.
    if (dto.targetUsernames && dto.targetUsernames.length > 0) {
      const targets = dto.targetUsernames.map((u) => u.toLowerCase().trim());
      const filtered = _autoCheckAllCreds.filter((c) =>
        targets.some((t) => { const e = c.email.toLowerCase(); return e === t || e.split("@")[0] === t || e.startsWith(t); }),
      );
      if (filtered.length > 0) _autoCheckAllCreds = filtered;
    }

    // Per-account password overrides (từ grid "đã đổi mật khẩu" trên form bảo hành). Ưu tiên hơn
    // `currentPassword` (legacy single-pwd). Khi cả 2 cùng có: per-account thắng, single chỉ áp
    // cho primary nếu primary chưa được map.
    const _hasPerAccountOverrides =
      !!_autoCheckOverrides && Object.values(_autoCheckOverrides).some((v) => typeof v === "string" && v.trim());
    if (_hasPerAccountOverrides) {
      _autoCheckAllCreds = this.autoCheckService.applyPasswordOverrides(_autoCheckAllCreds, _autoCheckOverrides);
    }

    // Fallback: nếu target[0] không parse được (vd không có password trong deliveredText),
    // dùng tk đầu tiên parseable từ allCreds thay vì bỏ qua auto-check hoàn toàn.
    if (!_autoCheckBaseCreds && _autoCheckAllCreds.length > 0) {
      _autoCheckBaseCreds = _autoCheckAllCreds[0] ?? null;
    }

    // Single-pwd path (legacy / khi chỉ có 1 account): chỉ áp khi không có per-account overrides.
    const _autoCheckCreds = _autoCheckBaseCreds && _autoCheckOverridePwd && !_hasPerAccountOverrides
      ? { ..._autoCheckBaseCreds, password: _autoCheckOverridePwd }
      : _autoCheckBaseCreds;

    // Đồng bộ baseCreds với allCreds (đảm bảo primary phản ánh override mới nhất, dù từ map
    // per-account hay single-pwd path).
    if (_autoCheckCreds) {
      if (_hasPerAccountOverrides) {
        const matched = _autoCheckAllCreds.find((c) => c.email.toLowerCase() === _autoCheckCreds.email.toLowerCase());
        if (matched) Object.assign(_autoCheckCreds, matched);
      } else {
        _autoCheckAllCreds = _autoCheckAllCreds.map((c) =>
          c.email.toLowerCase() === _autoCheckCreds.email.toLowerCase() ? _autoCheckCreds : c,
        );
      }
    }

    if (!cooldownBlocker && _autoCheckIsSupported && _autoCheckCreds && _autoCheckTool) {
      const { claim: _queuedClaim, accessToken: _qToken, enq: _enq, previousReplacement } =
        await this.createAutoCheckClaim({
          order,
          snapshot,
          autoCheckTool: _autoCheckTool,
          creds: _autoCheckCreds,
          allCreds: _autoCheckAllCreds,
          customerMessage: (dto as any).customerMessage,
          extraMetadata: {
            ...(_autoCheckOverridePwd ? { customerProvidedNewPassword: true } : {}),
            ...(dto.targetUsernames?.length ? { targetUsernames: dto.targetUsernames } : {}),
          },
          maxClaims: PUBLIC_MAX_CLAIMS,
          targetEmail: _blockTargetEmail,
          cooldownDays: cooldownConfig.cooldownDays,
        });
      return {
        success: false,
        status: "auto_check_pending",
        claimId: _queuedClaim.id,
        claimNumber: _queuedClaim.claimNumber,
        accessToken: _qToken,
        message: _enq.enqueued
          ? `Hệ thống đang kiểm tra tài khoản tự động${_enq.queuePosition ? ` (vị trí xếp hàng #${_enq.queuePosition})` : ""}. Vui lòng chờ trong giây lát.`
          : "Hệ thống hiện đang quá tải kiểm tra tài khoản. Yêu cầu của bạn đã được tạo, shop sẽ xem xét thủ công trong ít phút tới.",
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        previousReplacement,
        autoCheck: {
          tool: _autoCheckTool,
          status: _enq.enqueued ? "queued" : "overloaded",
          queuePosition: _enq.queuePosition,
          queueLoad: _enq.queueLoad,
        },
        invoice: await this.buildPublicInvoice(order.id),
      };
    }

    const claimNumber = order.warrantyClaimCount + 1;
    // Cooldown is hard-rejected above, so we never reach here with cooldownBlocker set.
    const decision: ClaimDecision = !_autoCheckIsSupported
      ? {
          nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
          deliveredAccountText: null,
          resolutionNote: "Product family not yet supported by auto-check.",
          ownerAttentionRequired: true,
          customerMessage:
            "Hệ thống chưa cập nhật kiểm tra tự động cho dòng sản phẩm này. Yêu cầu bảo hành đã được chuyển cho admin xem xét.",
        }
      : internalSourceOrder
        ? await this.decideInternalSourceClaimRoute(internalSourceOrder, claimNumber, "vi", dto.targetUsernames?.length || undefined)
        : await this.decideClaimRoute(order, claimNumber, "vi", dto.targetUsernames?.length || undefined);

    // Prefer the order's sourcePriceSnapshot (the cost recorded at delivery) so accounting
    // stays consistent with the original purchase even if catalog sourcePrice has drifted
    // between order time and warranty time. Fall back to current sourcePrice only when the
    // snapshot is missing (legacy/unmigrated rows).
    const replacementCostSource = decimalToNumber(order.sourcePriceSnapshot)
      || decimalToNumber(internalSourceOrder?.sourceProduct.sourcePrice ?? order.sourceProduct.sourcePrice);

    const createdClaim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
      const lockedOrderState = await tx.order.findUnique({ where: { id: order.id }, select: { warrantyClaimCount: true } });
      const safeClaimNumber = (lockedOrderState?.warrantyClaimCount ?? 0) + 1;
      const slotsUsedTx = await this.countNonRejectedClaims(order.id, tx, _earlyBaseCredsRaw?.email ?? null);
      if (slotsUsedTx + 1 > PUBLIC_MAX_CLAIMS) {
        throw new BadRequestException("Đơn này đã đạt số lần bảo hành tối đa. Vui lòng liên hệ shop để được hỗ trợ thêm.");
      }
      if (_blockTargetEmail) {
        const alreadyActiveTx = await tx.warrantyClaim.findFirst({
          where: {
            orderId: order.id,
            status: { in: this.ACTIVE_CLAIM_STATUSES as any },
            targetAccountEmail: _blockTargetEmail.toLowerCase(),
          },
          select: { id: true },
        });
        if (alreadyActiveTx) {
          throw new BadRequestException("Tài khoản này đang có yêu cầu bảo hành đang xử lý. Vui lòng chờ kết quả trước khi gửi yêu cầu mới.");
        }
      }
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
          claimNumber: safeClaimNumber,
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
          targetAccountEmail: _blockTargetEmail ? _blockTargetEmail.toLowerCase() : null,
          metadataJson: {
            ownerAttentionRequired: decision.ownerAttentionRequired,
            contactInfo: dto.contactInfo,
            source: "web",
          } as Prisma.InputJsonValue,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { warrantyClaimCount: safeClaimNumber },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "warranty_claim_created",
          payloadJson: {
            warrantyClaimId: claim.id,
            claimNumber: safeClaimNumber,
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
    }

    if (decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED && decision.partialRefundCount) {
      await this.applyPartialStockRefund(order, createdClaim.id, decision.partialRefundCount);
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
      invoice: await this.buildPublicInvoice(order.id),
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

    // Note: the per-order cap is now enforced at the caller via countNonRejectedClaims —
    // a stale `claimNumber > 2` check here would incorrectly route LEGITIMATE 1st/2nd claims
    // to PENDING_REVIEW when there were prior rejected claims (claimNumber is monotonic but
    // does not equal "slots used").

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

      if (deliveryEntries.length > 0) {
        const availableCount = deliveryEntries.length;
        const shortfall = qty - availableCount;
        return {
          nextStatus: WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
          deliveredAccountText: deliveryEntries.join("\n\n"),
          resolutionNote: `Partial replacement: ${availableCount}/${qty} accounts delivered from stock. Refund issued for remaining ${shortfall}.`,
          ownerAttentionRequired: false,
          customerMessage:
            language === "en"
              ? `Warranty partially approved. ${availableCount}/${qty} replacement account(s) delivered; refund for the remaining ${shortfall} added to your wallet.`
              : language === "th" ? `อนุมัติการรับประกันบางส่วน ส่งมอบบัญชีทดแทน ${availableCount}/${qty} บัญชี; คืนเงินสำหรับ ${shortfall} บัญชีที่เหลือเข้ากระเป๋าเงินของคุณ`
              : `Bảo hành được xử lý một phần. Đã cấp ${availableCount}/${qty} tài khoản thay thế; hoàn tiền ${shortfall} tài khoản không có hàng vào ví của bạn.`,
          manualStockUpdate: { remainingEntries: [] },
          partialRefundCount: shortfall,
        };
      }

      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_STOCK,
        deliveredAccountText: null,
        resolutionNote: "Replacement stock is not enough for automatic warranty delivery.",
        ownerAttentionRequired: true,
        isOutOfStock: true,
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
        // outOfStock = stock truly exhausted → safe to auto-refund.
        // pending = provider is still processing the order → NOT safe to auto-refund yet.
        isOutOfStock: !!replacement.outOfStock && !replacement.pending,
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
    ).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
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

    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await telegramSendMessage(
      token,
      claim.customer.telegramChatId,
      [
        "🛡️ <b>Bảo hành đã được xử lý</b>",
        `Mã đơn: <code>${esc(claim.orderCodeSnapshot)}</code>`,
        "",
        "Shop đã xử lý yêu cầu bảo hành của bạn.",
        claim.deliveredAccountText
          ? `\n🔑 <b>Tài khoản thay thế:</b>\n<pre>${esc(claim.deliveredAccountText)}</pre>`
          : null,
        claim.resolutionNote ? `💬 ${esc(claim.resolutionNote)}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      { parse_mode: "HTML" },
    ).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
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
    ).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
  }

  /**
   * Returns a masked label of the first account in a delivered text (for customer display
   * without leaking the full credentials). Example: "Bik***@hot***.com" from
   * "BikalMhadi43@hotmail.com|Bikalsnye8556#|kpgrok2026".
   */
  /** Look up the most recent resolved warranty replacement for an order, masked for display. */
  private async getPreviousReplacementInfo(orderId: string): Promise<{ replacedAt: Date; replacementUsernameMasked: string | null } | null> {
    const latest = await this.prisma.warrantyClaim.findFirst({
      where: {
        orderId,
        status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
        deliveredAccountText: { not: null },
      },
      orderBy: { resolvedAt: "desc" },
      select: { deliveredAccountText: true, resolvedAt: true },
    });
    if (!latest?.resolvedAt) return null;
    return {
      replacedAt: latest.resolvedAt,
      replacementUsernameMasked: this.maskAccountForDisplay(latest.deliveredAccountText),
    };
  }

  private maskAccountForDisplay(deliveredText: string | null | undefined): string | null {
    if (!deliveredText) return null;
    const firstLine = String(deliveredText).split(/\r?\n+/)[0] || "";
    const firstField = firstLine.split(/\s*[|:]\s*/)[0]?.trim();
    if (!firstField || !firstField.includes("@")) return null;
    const [user, domain] = firstField.split("@");
    if (!user || !domain) return null;
    const maskUser = user.length <= 3 ? user[0] + "***" : user.slice(0, 3) + "***";
    const domainParts = domain.split(".");
    const firstDomain = domainParts[0] || "";
    const rest = domainParts.slice(1).join(".");
    const maskDomain = firstDomain.length <= 3
      ? (firstDomain[0] || "") + "***." + rest
      : firstDomain.slice(0, 3) + "***." + rest;
    return `${maskUser}@${maskDomain}`;
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

    // Per-order cap enforced at the caller via countNonRejectedClaims. See comment in
    // decideClaimRoute — we intentionally do NOT gate on claimNumber here.

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

      if (deliveryEntries.length > 0) {
        const availableCount = deliveryEntries.length;
        const shortfall = qty - availableCount;
        return {
          nextStatus: WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
          deliveredAccountText: deliveryEntries.join("\n\n"),
          resolutionNote: `Partial replacement: ${availableCount}/${qty} accounts delivered from PRO source stock. Refund issued for remaining ${shortfall}.`,
          ownerAttentionRequired: false,
          customerMessage: language === "en"
            ? `Warranty partially approved. ${availableCount}/${qty} replacement account(s) delivered; refund for the remaining ${shortfall} added to your wallet.`
            : language === "th" ? `อนุมัติการรับประกันบางส่วน ส่งมอบบัญชีทดแทน ${availableCount}/${qty} บัญชี; คืนเงินสำหรับ ${shortfall} บัญชีที่เหลือเข้ากระเป๋าเงินของคุณ`
            : `Bảo hành được xử lý một phần. Đã cấp ${availableCount}/${qty} tài khoản thay thế; hoàn tiền ${shortfall} tài khoản không có hàng vào ví của bạn.`,
          internalSourceStockUpdate: {
            sourceProductId: sourceOrder.sourceProductId,
            remainingEntries: [],
          },
          partialRefundCount: shortfall,
        };
      }

      return {
        nextStatus: WARRANTY_CLAIM_STATUS.PENDING_STOCK,
        deliveredAccountText: null,
        resolutionNote: "PRO source stock insufficient for warranty replacement.",
        ownerAttentionRequired: true,
        isOutOfStock: true,
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
        isOutOfStock: !!replacement.outOfStock && !replacement.pending,
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
    // Account entries arrive in TWO formats depending on how the seller pasted stock:
    //   - pipe-separated:  "user@example.com|password"   (most common)
    //   - space-separated: "user@example.com password"   (manual paste, copy-from-csv etc.)
    // Splitting on EITHER pipe OR whitespace gets the email part for both. Falling back to
    // the trimmed original handles pathological entries (just a username, no password yet).
    const beforeSep = entry.split(/[\s|]+/)[0]?.trim() || entry.trim();
    const lower = beforeSep.toLowerCase();
    // Return just the prefix before @ so callers can match against user-entered usernames.
    return lower.split("@")[0] || lower;
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
      autoCheck: claim.autoCheckStatus
        ? {
            status: claim.autoCheckStatus,
            tool: claim.autoCheckTool,
            result: claim.autoCheckResult,
            startedAt: claim.autoCheckStartedAt,
            completedAt: claim.autoCheckCompletedAt,
            errorMessage: claim.autoCheckErrorMessage,
            attempts: claim.autoCheckAttempts,
          }
        : null,
    };
  }
}
