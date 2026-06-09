import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { extractAccountEmails } from "../lib/utils";
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
import { countResolvedWarrantyAccounts, decimalToNumber } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

import { WarrantyAutoCheckService } from "./warranty-auto-check.service";
import { WarrantyAbuseService } from "./warranty-abuse.service";
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
      // `expectedAvailableBefore` = the stock count this decision sliced from, read OUTSIDE any
      // lock. Consumers MUST re-lock the product row, re-read `available`, and abort if it drifted
      // (a concurrent claim cut stock) before writing `remainingEntries` — else two claims on the
      // same lot double-spend the same inventory entry.
      manualStockUpdate?: { remainingEntries: string[]; expectedAvailableBefore: number };
      internalSourceStockUpdate?: { sourceProductId: string; remainingEntries: string[]; expectedAvailableBefore: number };
      // NEW stock system (StockBatch/StockEntry): replacement acc rút FIFO theo lô (lô cũ trước).
      // `totalCost` = Σ batch.costPerUnit CỦA ĐÚNG các acc lấy ra → giá vốn THẬT theo từng lô
      // (cùng 1 SP nhập nhiều lô giá vốn khác nhau). `entryIds` được re-validate AVAILABLE dưới
      // lock trước khi mark SOLD → không double-spend giữa các claim/đơn đồng thời.
      stockEntryReplacement?: { entryIds: string[]; totalCost: number; sourceProductId: string; expectedAvailableBefore: number };
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
      stockEntryReplacement?: never;
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
    @Inject(WarrantyAbuseService)
    private readonly abuse: WarrantyAbuseService,
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
    const claims = await this.prisma.warrantyClaim.findMany({
      where: {
        orderId,
        status: { in: this.ACTIVE_CLAIM_STATUSES as any },
        ...(targetEmail ? { targetAccountEmail: targetEmail.toLowerCase() } : {}),
      },
      select: { id: true, status: true, metadataJson: true },
    });
    return claims.some((claim) => {
      const meta = claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
        ? (claim.metadataJson as Record<string, unknown>)
        : {};
      return !(claim.status === WARRANTY_CLAIM_STATUS.PENDING && meta.autoCheckSoftFailed === true);
    });
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
  /**
   * Map the product "Thời hạn" (durationType) to the number of days the lot is expected to live.
   * Enum terms map directly (DAY_1→1, DAY_7→7, MONTH_1→30…); OTHER falls back to parsing the
   * free-text `durationTypeOther` (e.g. "10 ngày", "2 tháng", "45 days"). LIFETIME / unparseable
   * → null (never pre-expire → always run the real tool). Single source of truth: the seller sets
   * the term once; there is NO separate batch-lifetime field.
   */
  private resolveBatchLifetimeDays(
    durationType: string | null | undefined,
    durationTypeOther?: string | null,
  ): number | null {
    if (durationType === "LIFETIME") return null;
    const fromEnum = this.durationTypeToDays(durationType);
    if (fromEnum != null) return fromEnum;
    const raw = String(durationTypeOther ?? "").toLowerCase();
    const m = raw.match(/(\d+(?:\.\d+)?)\s*(ngày|ngay|days?|d|tháng|thang|months?|mo|m|năm|nam|years?|y|giờ|gio|hours?|h)\b/);
    if (!m) return null;
    // Reject a negative term ("-5 ngày") — \d+ would otherwise silently capture the positive part.
    const idx = m.index ?? 0;
    if (idx > 0 && raw[idx - 1] === "-") return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = m[2] ?? "";
    if (/^(giờ|gio|hours?|h)$/.test(unit)) return n / 24;       // "24h" → 1 day
    if (/^(tháng|thang|months?|mo|m)$/.test(unit)) return n * 30;
    if (/^(năm|nam|years?|y)$/.test(unit)) return n * 365;
    return n; // days
  }

  /**
   * Compute whether a delivered order's lot has already passed its "Thời hạn" (durationType).
   * Once now > (batch-start + term days) the account is expected-dead, so warranty claims are
   * auto-resolved with a synthetic isDead verdict WITHOUT spawning the ~25-60s check tool.
   * Anchor = `accBatchStartedAt` (when the seller imported/refilled the lot); if unset → null →
   * caller runs the real check. Never anchors on deliveredAt (a batch sold over many days would
   * mis-measure). Returns synthetic payload so applyAutoCheckResult treats it like a real isDead.
   */
  private computeBatchLifetimeBypass(
    order: { deliveredAt: Date | null },
    sourceProduct: {
      accBatchStartedAt?: Date | null | undefined;
      durationType?: string | null | undefined;
      durationTypeOther?: string | null | undefined;
      productFamily: string | null;
      metadataJson?: Prisma.JsonValue | null | undefined;
    } | null | undefined,
    autoCheckTool: "veo" | "grok" | "gpt",
    accountText?: string | null,
  ): { errorType: string; note: string; expiredOn: Date; days: number } | null {
    const days = this.resolveBatchLifetimeDays(sourceProduct?.durationType, sourceProduct?.durationTypeOther);
    if (!days || days <= 0) return null;
    // MONEY-SAFETY (#15): only skip the real tool check when we have the AUTHORITATIVE batch
    // anchor (accBatchStartedAt = when the seller imported/refilled the batch; re-stamped on
    // every refill so a fresh batch never inherits an old, earlier expiry). NEVER anchor on
    // deliveredAt — for a batch sold over many days that measures from when THIS customer
    // received the account, so (deliveredAt + term) can flag a still-ALIVE account as dead.
    // When accBatchStartedAt is unset we return null → caller runs the real check (slower, safe).
    // PER-ACCOUNT anchor (preferred): each account's "Thời hạn" clock starts the day IT was added
    // to stock (products.service accountAddedAt map), so accounts added on different days into the
    // SAME lot/term expire on their own schedule. Use it ONLY when EVERY delivered account has a
    // recorded date, and take the LATEST (max) date so a mixed order never bypasses while its newest
    // account is still within term (conservative = never flags a still-young acc dead). When the
    // map is missing/partial (legacy stock, pre-feature), fall back to the lot-level accBatchStartedAt.
    let perAccountAnchor: Date | null = null;
    let anchorSource = "lot";
    const _meta = sourceProduct?.metadataJson;
    const _addedAt = _meta && typeof _meta === "object" && !Array.isArray(_meta)
      ? ((_meta as Record<string, unknown>).accountAddedAt as Record<string, unknown> | undefined)
      : undefined;
    if (_addedAt && typeof _addedAt === "object" && !Array.isArray(_addedAt)) {
      const emails = extractAccountEmails(accountText ?? null);
      if (emails.length > 0) {
        const ts = emails.map((e) => {
          const v = (_addedAt as Record<string, unknown>)[e];
          return typeof v === "string" ? Date.parse(v) : NaN;
        });
        if (ts.every((t) => Number.isFinite(t))) {
          perAccountAnchor = new Date(Math.max(...ts));
          anchorSource = "per-account";
        }
      }
    }
    const anchor = perAccountAnchor ?? sourceProduct?.accBatchStartedAt;
    if (!anchor) return null;
    const expiredOn = new Date(anchor.getTime() + days * 86400_000);
    if (Date.now() <= expiredOn.getTime()) return null;
    return {
      errorType: "batch_lifetime_expired",
      note: `Term (${sourceProduct?.productFamily ?? autoCheckTool}) is ${days} day(s) from ${anchorSource} anchor (${anchor.toISOString()}). Claim arrived ${Math.round((Date.now() - expiredOn.getTime()) / 86400_000)} day(s) past expiry → auto-resolved without tool check.`,
      expiredOn,
      days,
    };
  }

  /**
   * NEW batch-expiry bypass driven by main's StockBatch system. The seller sets an absolute
   * `StockBatch.expiresAt` per lot in the stock UI; an account sold from a lot whose expiresAt is
   * in the past is treated as expired → auto-resolve WITHOUT a real tool check (instant replace).
   *
   * Matches the claimed account email(s) to the StockEntry sold for THIS order, reads that entry's
   * batch.expiresAt. Money-safe: only bypasses when EVERY matched lot is actually expired (never
   * auto-kills a still-valid lot). When no expiring StockBatch matches (legacy products with no
   * stock batches), falls back to the legacy durationType + accBatchStartedAt path.
   */
  private async computeBatchExpiryBypass(
    order: { id: string; deliveredAt: Date | null },
    sourceProduct: {
      accBatchStartedAt?: Date | null | undefined;
      durationType?: string | null | undefined;
      durationTypeOther?: string | null | undefined;
      productFamily: string | null;
      metadataJson?: Prisma.JsonValue | null | undefined;
    } | null | undefined,
    autoCheckTool: "veo" | "grok" | "gpt",
    accountText?: string | null,
  ): Promise<{ errorType: string; note: string; expiredOn: Date; days: number } | null> {
    try {
      const entries = await this.prisma.stockEntry.findMany({
        where: { soldToOrderId: order.id, batch: { is: { expiresAt: { not: null } } } },
        select: { text: true, batch: { select: { expiresAt: true, createdAt: true } } },
      });
      if (entries.length > 0) {
        const now = Date.now();
        const emails = extractAccountEmails(accountText ?? null);
        // Entries whose batch applies to the claimed account(s) (or all sold entries for a
        // whole-order claim with no specific target).
        const relevant = entries.filter((e) => {
          if (!e.batch?.expiresAt) return false;
          if (emails.length === 0) return true;
          const t = (e.text || "").toLowerCase();
          return emails.some((em) => t.includes(em));
        });
        if (relevant.length > 0) {
          const expired = relevant.filter((e) => {
            const d = e.batch?.expiresAt;
            return !!d && d.getTime() < now;
          });
          // Bypass ONLY if every matched lot is past its expiresAt (don't kill a still-valid one).
          if (expired.length === relevant.length) {
            // earliest-expiring matched lot (for the customer-facing message)
            let earliestEntry = expired[0];
            for (const e of expired) {
              if (e.batch?.expiresAt && earliestEntry?.batch?.expiresAt && e.batch.expiresAt < earliestEntry.batch.expiresAt) {
                earliestEntry = e;
              }
            }
            const earliest = earliestEntry?.batch?.expiresAt;
            if (!earliest) return null;
            const created = earliestEntry?.batch?.createdAt ?? null;
            const days = created
              ? Math.max(1, Math.round((earliest.getTime() - created.getTime()) / 86400_000))
              : 0;
            return {
              errorType: "batch_lifetime_expired",
              note: `StockBatch expiresAt ${earliest.toISOString()} is in the past → lot reached seller-declared end-of-life. Auto-resolved without tool check (${Math.round((now - earliest.getTime()) / 86400_000)} day(s) past expiry).`,
              expiredOn: earliest,
              days,
            };
          }
          // Matched lot(s) still valid → do NOT bypass via the new path (and skip legacy too: the
          // authoritative per-lot date says the account is in-window). Return null → real check.
          return null;
        }
      }
    } catch (e: any) {
      this.logger.warn(`computeBatchExpiryBypass (StockBatch) failed, using legacy: ${e?.message ?? e}`);
    }
    // No StockBatch info for this order → legacy durationType + accBatchStartedAt path.
    return this.computeBatchLifetimeBypass(order, sourceProduct, autoCheckTool, accountText);
  }

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
    // When set, the claim is created with autoCheckStatus=COMPLETED + this synthetic result
    // instead of enqueuing the tool. applyAutoCheckResult is invoked inline so the customer
    // gets the verdict and replacement immediately. Used by the batch-lifetime-expired path.
    syntheticBypass?: {
      errorType: string;
      note: string;
      // Builds the per-account verdict array for the result so downstream multi-account
      // logic (anyAccountDeadInArr) sees every account as dead, not just the primary.
      accountEmails: string[];
    };
  }) {
    const { order, snapshot, autoCheckTool, creds, allCreds, customerMessage, extraMetadata = {}, maxClaims, targetEmail, cooldownDays, syntheticBypass } = input;
    const { token: accessToken, hash: accessTokenHash } = this.autoCheckService.generateAccessToken();
    const previousReplacement = await this.getPreviousReplacementInfo(order.id);

    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
      const lockedOrder = await tx.order.findUnique({
        where: { id: order.id },
        select: { warrantyClaimCount: true, quantity: true },
      });
      const safeClaimNumber = (lockedOrder?.warrantyClaimCount ?? 0) + 1;
      const slotsUsedTx = await this.countNonRejectedClaims(order.id, tx, creds.email);
      if (slotsUsedTx + 1 > maxClaims) {
        throw new BadRequestException("Too many warranty claims for this order.");
      }
      // PER-ORDER TOTAL cap (not just per-account). The per-account cap above + the cooldown both
      // key on targetAccountEmail, but every replacement is issued under a NEW email — so on a
      // batch-lifetime-bypass lot (auto-resolve without a tool check) a customer could chain
      // claim → replacement → claim that replacement → ... and drain the whole lot, since each new
      // email resets the per-account guards. Bound the TOTAL non-rejected claims for the order to
      // quantity × maxClaims so a Q-account order yields at most that many replacements regardless
      // of email churn. Legit multi-account warranty (≤ maxClaims per purchased account) still fits.
      const orderClaimsTotal = await this.countNonRejectedClaims(order.id, tx);
      const perOrderCap = Math.max(maxClaims, (lockedOrder?.quantity ?? 1) * maxClaims);
      if (orderClaimsTotal + 1 > perOrderCap) {
        throw new BadRequestException(
          "Đơn này đã đạt số lần bảo hành tối đa. Vui lòng liên hệ shop để được hỗ trợ thêm.",
        );
      }
      let _inheritedSlots: number | undefined;
      if (targetEmail) {
        const alreadyActive = await tx.warrantyClaim.findFirst({
          where: {
            orderId: order.id,
            status: { in: this.ACTIVE_CLAIM_STATUSES as any },
            targetAccountEmail: targetEmail.toLowerCase(),
          },
          select: { id: true, status: true, metadataJson: true },
        });
        const activeMeta = alreadyActive?.metadataJson && typeof alreadyActive.metadataJson === "object" && !Array.isArray(alreadyActive.metadataJson)
          ? (alreadyActive.metadataJson as Record<string, unknown>)
          : {};
        if (alreadyActive) {
          const isSoftFailPending = alreadyActive.status === WARRANTY_CLAIM_STATUS.PENDING && activeMeta.autoCheckSoftFailed === true;
          if (!isSoftFailPending) {
            throw new BadRequestException("Tài khoản này đang có yêu cầu bảo hành đang xử lý. Vui lòng chờ kết quả trước khi gửi yêu cầu mới.");
          }
          // Close the superseded soft-fail so its PENDING status doesn't inflate slot counts
          // on subsequent retries. Carry the attempt counter so applyAutoCheckResult can
          // enforce MAX_CLAIMS across claim supersession.
          _inheritedSlots = typeof activeMeta.autoCheckSlotsUsed === "number" ? activeMeta.autoCheckSlotsUsed : 1;
          await tx.warrantyClaim.update({
            where: { id: alreadyActive.id },
            data: { status: WARRANTY_CLAIM_STATUS.REJECTED, resolutionNote: "Superseded by customer retry.", resolvedAt: new Date() },
          });
        }
      }
      if (cooldownDays && cooldownDays > 0) {
        // Per-account cooldown — TRANSACTIONAL re-check (the pre-tx findCooldownBlocker has a
        // TOCTOU gap two concurrent submits can slip through). Must use the SAME "is this prior
        // claim for THIS account?" predicate as findCooldownBlocker, otherwise the two disagree:
        // a resolved claim's targetAccountEmail column holds the NEW replacement email, but the
        // account the customer is re-claiming matches the OLD email recorded in metadata
        // (replacedAccountEmails / targetUsernames). Match on metadata so the gap is closed.
        const recentResolvedRaw = await tx.warrantyClaim.findMany({
          where: {
            orderId: order.id,
            status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
            resolvedAt: { not: null },
          },
          orderBy: { resolvedAt: "desc" },
          take: targetEmail ? 20 : 2,
          select: { resolvedAt: true, metadataJson: true, targetAccountEmail: true },
        });
        let recentResolved = recentResolvedRaw;
        if (targetEmail) {
          const want = targetEmail.toLowerCase().trim();
          recentResolved = recentResolvedRaw.filter((c) => {
            const meta = (c.metadataJson && typeof c.metadataJson === "object" && !Array.isArray(c.metadataJson))
              ? (c.metadataJson as Record<string, unknown>)
              : null;
            const replacedEmails = meta?.replacedAccountEmails as string[] | undefined;
            if (Array.isArray(replacedEmails) && replacedEmails.length > 0) {
              return replacedEmails.some((e) => { const s = String(e).toLowerCase().trim(); return s === want || s.split("@")[0] === want; });
            }
            const targets = meta?.targetUsernames as string[] | undefined;
            if (Array.isArray(targets) && targets.length > 0) {
              return targets.some((t) => { const s = String(t).toLowerCase().trim(); return s === want || s.split("@")[0] === want || s.startsWith(want); });
            }
            // Last-resort fallback for old claims with neither metadata field: the column.
            return (c.targetAccountEmail || "").toLowerCase() === want;
          });
        }
        if (recentResolved.length >= 2 && recentResolved[0]?.resolvedAt) {
          const blockedUntil = new Date(recentResolved[0].resolvedAt.getTime() + cooldownDays * 86400_000);
          if (blockedUntil.getTime() > Date.now()) {
            throw new BadRequestException("Đơn này đang trong thời gian cooldown bảo hành. Vui lòng liên hệ shop trực tiếp.");
          }
        }
      }
      // Build the synthetic auto-check result for the batch-lifetime bypass path. Shape mirrors
      // what the worker writes when the tool returns isDead=true, so applyAutoCheckResult
      // downstream cannot tell the difference between a synthetic and a real verdict.
      const syntheticResult = syntheticBypass
        ? {
            ok: true,
            tool: autoCheckTool,
            isDead: true,
            stillPaid: false,
            errorType: syntheticBypass.errorType,
            note: syntheticBypass.note,
            tier: "FREE",
            plan: "Free",
            status: "die",
            accounts: syntheticBypass.accountEmails.map((email) => ({
              email,
              ok: true,
              isDead: true,
              stillPaid: false,
              errorType: syntheticBypass.errorType,
            })),
          }
        : null;
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
          resolutionNote: syntheticBypass ? "Auto-resolved: batch lifetime expired." : "Auto-check pending.",
          autoCheckStatus: syntheticBypass ? WARRANTY_AUTO_CHECK_STATUS.COMPLETED : WARRANTY_AUTO_CHECK_STATUS.QUEUED,
          autoCheckTool,
          autoCheckStartedAt: syntheticBypass ? new Date() : null,
          autoCheckCompletedAt: syntheticBypass ? new Date() : null,
          autoCheckResult: syntheticResult as Prisma.InputJsonValue | undefined,
          targetAccountEmail: creds.email.toLowerCase(),
          metadataJson: {
            autoCheckPending: !syntheticBypass,
            accessTokenHash,
            ...extraMetadata,
            ...(typeof _inheritedSlots === "number" ? { autoCheckSlotsUsed: _inheritedSlots } : {}),
            ...(syntheticBypass ? { batchLifetimeBypass: true } : {}),
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

    // Synthetic bypass path: claim already has COMPLETED + isDead result. Skip enqueue;
    // fire applyAutoCheckResult inline so the customer gets the verdict + replacement now
    // (no polling, no queue position). Returns a fake "enq" shape so callers don't branch.
    if (syntheticBypass) {
      // Fire-and-forget — replacement flow includes potentially-slow provider RPCs we don't
      // want to block submission on. .catch keeps the submission response fast even if a
      // downstream provider misbehaves.
      void this.applyAutoCheckResult(claim.id).catch((err) =>
        this.logger.error(`batch-lifetime auto-resolve for claim ${claim.id} failed: ${err?.message || err}`),
      );
      return {
        claim,
        accessToken,
        enq: { enqueued: false, reason: "batch_lifetime_expired" as const, queuePosition: null, queueLoad: 0 },
        previousReplacement,
      };
    }

    const enq = await this.autoCheckService.tryEnqueueForClaim(
      claim.id,
      autoCheckTool,
      creds as { email: string; password: string; extra: string | null },
      order.shopId,
      allCreds as { email: string; password: string; extra: string | null }[] | undefined,
    );

    // M4: queue saturated → tryEnqueueForClaim left the claim PENDING + autoCheckStatus=OVERLOADED
    // with NO job enqueued. The worker sweep only covers QUEUED/RUNNING, so without this the claim
    // sits stuck forever and the "shop will review manually" message we return is a lie. Escalate to
    // seller manual review + notify, mirroring the UNSUPPORTED path. Money-safe: manual handling, never
    // an auto-resolve. Guarded on status=PENDING so a concurrent recheck/resolve isn't clobbered.
    if (!enq.enqueued) {
      const escalated = await this.prisma.warrantyClaim.updateMany({
        where: { id: claim.id, status: WARRANTY_CLAIM_STATUS.PENDING },
        data: {
          status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
          resolutionNote: "Hàng đợi kiểm tra tự động quá tải — chuyển shop duyệt tay.",
          metadataJson: {
            ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
              ? (claim.metadataJson as Record<string, unknown>)
              : {}),
            autoCheckPending: false,
            ownerAttentionRequired: true,
          } as Prisma.InputJsonValue,
        },
      });
      if (escalated.count > 0) {
        this.autoCheckService.invalidateStatus(claim.id);
        const cust = await this.prisma.customer.findUnique({
          where: { id: order.customerId },
          select: { telegramUsername: true, firstName: true, lastName: true, telegramUserId: true },
        });
        const customerLabel =
          cust?.telegramUsername ||
          [cust?.firstName, cust?.lastName].filter(Boolean).join(" ") ||
          cust?.telegramUserId ||
          order.customerId;
        await this.notifyOwnerAboutClaim({
          shopId: claim.shopId,
          orderCode: claim.orderCodeSnapshot,
          productName: claim.productNameSnapshot,
          claimNumber: claim.claimNumber,
          status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
          customerLabel,
          customerMessage: claim.customerMessage || undefined,
        }).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
      }
    }

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

  async openClaim(dto: OpenWarrantyClaimDto, user: AuthenticatedUser) {
    const normalizedCode = String(dto.orderCode || "").trim().toUpperCase();

    // Scope the lookup to the calling seller's own shop so one seller cannot open warranty
    // claims against another shop's orders. `user` is REQUIRED (the controller route is
    // authenticated) — a missing-user fallback would silently revert to an all-shops lookup
    // and re-open the unauth hole, so we always resolve and enforce the shop id.
    const _scopedShopId = (await this.shopsService.getSellerShop(user.id)).id;

    const order = await this.prisma.order.findFirst({
      where: { orderCode: normalizedCode, shopId: _scopedShopId },
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

    // Batch-lifetime bypass: if the seller declared an accLifetimeDays for this product and
    // the claim arrives past (deliveredAt + lifetime), short-circuit the tool — the seller
    // already knows the batch is dead. createAutoCheckClaim creates the claim with a synthetic
    // isDead verdict and applyAutoCheckResult fires inline → customer sees replacement instantly.
    const _openClaimBatchBypass = _autoCheckTool
      ? await this.computeBatchExpiryBypass(order, _autoCheckSourceProduct, _autoCheckTool, _autoCheckActiveAccText)
      : null;

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
          // M8 parity: pass the per-account key + cooldown so createAutoCheckClaim's in-tx
          // duplicate-account guard and cooldown re-check (TOCTOU backstop) actually run here too.
          targetEmail: _openClaimTargetEmail,
          cooldownDays: cooldownConfig.cooldownDays,
          ...(_openClaimBatchBypass
            ? {
                syntheticBypass: {
                  errorType: _openClaimBatchBypass.errorType,
                  note: _openClaimBatchBypass.note,
                  accountEmails: _autoCheckAllCreds.map((c) => c.email),
                },
              }
            : {}),
        });
      return {
        success: false,
        status: _openClaimBatchBypass ? "auto_resolved_pending" : "auto_check_pending",
        claimId: _queuedClaim.id,
        claimNumber: _queuedClaim.claimNumber,
        accessToken: _qToken,
        message: _openClaimBatchBypass
          ? `Lô tài khoản này đã hết hạn theo lịch shop công bố (giao ${order.deliveredAt?.toLocaleDateString("vi-VN")}, hạn ${_openClaimBatchBypass?.days} ngày). Đang cấp tài khoản thay thế...`
          : _enq.enqueued
            ? `Hệ thống đang kiểm tra tài khoản tự động${_enq.queuePosition ? ` (vị trí xếp hàng #${_enq.queuePosition})` : ""}. Vui lòng chờ trong giây lát.`
            : "Hệ thống hiện đang quá tải kiểm tra tài khoản. Yêu cầu của bạn đã được tạo, shop sẽ xem xét thủ công trong ít phút tới.",
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        previousReplacement,
        autoCheck: {
          tool: _autoCheckTool,
          status: _openClaimBatchBypass ? "completed" : (_enq.enqueued ? "queued" : "overloaded"),
          queuePosition: _enq.queuePosition,
          queueLoad: _enq.queueLoad,
        },
      };
    }

    const claimNumber = order.warrantyClaimCount + 1;
    // Cooldown is hard-rejected above, so we never reach here with cooldownBlocker set.
    // Route to manual review when EITHER the family is unsupported OR the auto-check could not
    // actually run because credentials were unparseable. The enqueue gate above requires
    // _autoCheckCreds, so reaching here on a supported family means no tool verified the account —
    // auto-issuing a replacement via decideClaimRoute would hand out a free account with NO death
    // proof (farmable when a seller delivers accounts in a non email:password format). Be conservative.
    const decision: ClaimDecision = (!_autoCheckIsSupported || !_autoCheckCreds)
      ? {
          nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
          deliveredAccountText: null,
          resolutionNote: !_autoCheckIsSupported
            ? "Product family not yet supported by auto-check."
            : "Auto-check could not run (account credentials unparseable) — manual review required.",
          ownerAttentionRequired: true,
          customerMessage: !_autoCheckIsSupported
            ? "Loại sản phẩm này chưa hỗ trợ kiểm tra bảo hành tự động. Yêu cầu của bạn đã được chuyển cho shop/admin xem xét thủ công."
            : "Hệ thống chưa thể kiểm tra tự động yêu cầu này. Yêu cầu bảo hành đã được chuyển cho admin xem xét.",
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
      if (decision.stockEntryReplacement) {
        const okSE = await this.commitStockEntryReplacement(tx, decision.stockEntryReplacement, order.id, order.customerId);
        if (!okSE) {
          throw new BadRequestException("Kho vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
      }
      if (decision.manualStockUpdate) {
        // CROSS-CLAIM STOCK RACE: remainingEntries was sliced from a snapshot read OUTSIDE this tx.
        // Lock the product row + re-validate `available` against the snapshot; if a concurrent claim
        // already cut stock, abort (rollback) instead of overwriting with a stale list → no double-spend.
        await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${order.sourceProductId} FOR UPDATE`;
        const _freshSP = await tx.sourceProduct.findUnique({ where: { id: order.sourceProductId }, select: { available: true } });
        if (!_freshSP || _freshSP.available !== decision.manualStockUpdate.expectedAvailableBefore) {
          throw new BadRequestException("Kho vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
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
        // #3: retire the issued accounts from the stock_entries pool too, so a legacy-metadata
        // fallback replacement can't stay AVAILABLE and be re-sold to a later buyer (no-op when the
        // product has no matching stock_entries — pure-legacy products keep the available above).
        await this.consumeMatchingStockEntries(tx, order.sourceProductId, decision.deliveredAccountText, order.id, order.customerId);
      }

      if (decision.internalSourceStockUpdate) {
        const { sourceProductId, remainingEntries, expectedAvailableBefore } = decision.internalSourceStockUpdate;
        await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${sourceProductId} FOR UPDATE`;
        const proProduct = await tx.sourceProduct.findUnique({
          where: { id: sourceProductId },
          select: { metadataJson: true, available: true },
        });
        if (!proProduct || proProduct.available !== expectedAvailableBefore) {
          throw new BadRequestException("Kho nguồn vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
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
        // Finding G: retire the issued accounts from the UPSTREAM product's stock_entries too, so a
        // legacy-metadata fallback on the ULTRA source can't leave them AVAILABLE and re-sellable.
        await this.consumeMatchingStockEntries(tx, sourceProductId, decision.deliveredAccountText, order.id, order.customerId);
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
            ? (decision.stockEntryReplacement ? decision.stockEntryReplacement.totalCost : replacementCostSource)
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

    // Giá vốn acc thay khi seller resolve TAY = đơn giá vốn (ưu tiên snapshot lúc bán) × SỐ acc
    // thực giao trong text này (KHÔNG còn cứng ×1 → trước đây under-count cost đơn nhiều acc).
    // Seller dán acc tự do (không cắt StockEntry) nên dùng đơn giá làm proxy, nhân số dòng acc.
    const _manualUnitCost =
      decimalToNumber(claim.order.sourcePriceSnapshot) || decimalToNumber(sourceProduct?.sourcePrice) || 0;
    const _manualReplCount = Math.max(
      1,
      Math.min(
        claim.order.quantity || 1,
        deliveredAccountText.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).length || 1,
      ),
    );
    const _manualReplCost = _manualUnitCost > 0 ? _manualUnitCost * _manualReplCount : null;

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
      // Best-effort: cắt kho StockEntry nếu acc seller dán trùng tồn kho (chống bán trùng) + lấy
      // giá vốn lô thật. Acc khớp dùng giá vốn lô; phần dán ngoài hệ thống dùng proxy đơn giá.
      const consumed = await this.consumeMatchingStockEntries(
        tx, claim.order.sourceProductId, deliveredAccountText, claim.orderId, claim.customerId,
      );
      let finalReplCost = _manualReplCost;
      if (consumed) {
        const unmatched = Math.max(0, _manualReplCount - consumed.matchedCount);
        finalReplCost = consumed.totalCost + unmatched * _manualUnitCost;
      }
      await tx.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          status: WARRANTY_CLAIM_STATUS.RESOLVED_MANUAL,
          deliveredAccountText,
          resolutionNote,
          resolvedAt: new Date(),
          resolvedById: user.id, // audit: who manually resolved this claim
          replacementCostSnapshot: finalReplCost,
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
            resolvedById: user.id,       // audit: acting user
            resolvedByEmail: user.email, // audit: acting user (human-readable)
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
          resolvedById: user.id, // audit: who manually rejected this claim
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
            resolvedById: user.id,       // audit: acting user
            resolvedByEmail: user.email, // audit: acting user (human-readable)
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

    // Reset the auto-check columns + CLEAR the autoApplyInProgress sentinel — but UNDER A ROW LOCK,
    // and only when the sentinel is genuinely stale. If a prior applyAutoCheckResult was hard-killed
    // (OOM/SIGKILL/redeploy) after stamping the sentinel but before a terminal write, the claim is
    // wedged (status=PENDING + autoApplyInProgress=true + autoCheckStatus=COMPLETED/FAILED) and the
    // QUEUED/RUNNING-only sweep never recovers it → recheck is the self-heal path. BUT clearing the
    // sentinel while a callback's applyAutoCheckResult is still mid-flight (it sets the sentinel,
    // drops the lock to do slow RPCs, then re-locks to write) would let a concurrent/late callback
    // re-enter and apply a DUPLICATE replacement/refund. So: take the lock, re-check, and refuse if
    // the sentinel was set recently (a live apply); only heal it when it's old (truly hard-killed).
    const APPLY_SENTINEL_STALE_MS = 5 * 60 * 1000;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${claim.id} FOR UPDATE`;
      const fresh = await tx.warrantyClaim.findUnique({
        where: { id: claim.id },
        select: { status: true, autoCheckStatus: true, autoCheckCompletedAt: true, metadataJson: true },
      });
      if (!fresh) throw new NotFoundException("Warranty claim not found.");
      if (this.isResolvedClaim(fresh.status)) {
        throw new BadRequestException("Warranty claim is already closed.");
      }
      if (fresh.autoCheckStatus && (inFlight as readonly string[]).includes(fresh.autoCheckStatus)) {
        throw new BadRequestException(
          "Đang có một lượt kiểm tra tự động đang chạy cho claim này. Vui lòng đợi kết quả trước khi yêu cầu kiểm tra lại.",
        );
      }
      const _recheckMeta = (fresh.metadataJson && typeof fresh.metadataJson === "object" && !Array.isArray(fresh.metadataJson))
        ? (fresh.metadataJson as Record<string, unknown>)
        : {};
      if (_recheckMeta.autoApplyInProgress === true) {
        const completedAt = fresh.autoCheckCompletedAt?.getTime() ?? 0;
        const stale = !completedAt || Date.now() - completedAt > APPLY_SENTINEL_STALE_MS;
        if (!stale) {
          throw new BadRequestException(
            "Hệ thống đang áp dụng kết quả kiểm tra cho claim này. Vui lòng thử lại sau ít giây.",
          );
        }
        // else: sentinel is old → a hard-killed apply left it wedged → safe to clear (self-heal).
      }
      // M3: a recheck of a PENDING_REVIEW (or other non-terminal, non-PENDING) claim must demote it
      // back to PENDING, else the fresh callback's applyAutoCheckResult bails on its status===PENDING
      // guard and the new verdict (isDead→replace / stillPaid→reject) is never acted on. We already
      // re-checked isResolvedClaim above, so this only touches still-open claims. Clear the
      // owner-attention flag so it leaves the seller's manual-review queue while the recheck runs;
      // the fresh verdict re-escalates to PENDING_REVIEW if needed.
      const _demoteToPending =
        fresh.status === WARRANTY_CLAIM_STATUS.PENDING_REVIEW ||
        fresh.status === WARRANTY_CLAIM_STATUS.PENDING_STOCK ||
        fresh.status === WARRANTY_CLAIM_STATUS.PENDING_MANUAL;
      await tx.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          ...(_demoteToPending ? { status: WARRANTY_CLAIM_STATUS.PENDING } : {}),
          autoCheckStatus: null,
          autoCheckResult: Prisma.JsonNull,
          autoCheckErrorMessage: null,
          autoCheckCompletedAt: null,
          autoCheckStartedAt: null,
          autoCheckJobId: null,
          metadataJson: {
            ..._recheckMeta,
            autoApplyInProgress: false,
            ...(_demoteToPending ? { ownerAttentionRequired: false } : {}),
          } as Prisma.InputJsonValue,
        },
      });
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
      // IDEMPOTENCY (#4): callback có thể tới nhiều lần (retry backoff + sweep + inline). Status
      // vẫn PENDING tới tận transaction B (đổi AUTO_RESOLVED chạy SAU, ngoài lock này), nên 2
      // callback đua nhau đều qua được check status → apply 2 lần (đền/cấp 2 lần). Chốt bằng cờ
      // autoApplyInProgress: dưới row-lock này, callback ĐẦU set cờ, callback SAU thấy cờ → bail.
      const _meta0 = (c.metadataJson && typeof c.metadataJson === "object" && !Array.isArray(c.metadataJson))
        ? (c.metadataJson as Record<string, unknown>) : {};
      if (_meta0.autoApplyInProgress === true) {
        return null; // đã có 1 lần apply đang chạy → bỏ qua (idempotent)
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
    // Localize the async result to the customer's saved language (was hard-coded "vi" — en/th
    // customers got the verdict + replacement credentials entirely in Vietnamese).
    const _cl = String(claim.customer?.preferredLanguage || "").toLowerCase();
    const lang: "vi" | "en" | "th" = _cl === "en" ? "en" : _cl === "th" ? "th" : "vi";

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
      const metaBase = (claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
        ? (claim.metadataJson as Record<string, unknown>)
        : {});
      // When metadata carries an inherited slot count (set by createAutoCheckClaim when it
      // closes superseded soft-fail claims), use it +1 for this check. This is accurate even
      // though old soft-fail claims are now REJECTED and would no longer appear in the DB count.
      // Fall back to DB count for legacy claims that predate this tracking.
      const _inheritedMeta = typeof metaBase.autoCheckSlotsUsed === "number" ? metaBase.autoCheckSlotsUsed : null;
      // A PROXY/CONNECTION failure means the check couldn't run through no fault of the customer —
      // it must NOT consume one of their warranty attempts (else a dead proxy could eat all 3).
      // The dead proxy is already (a) retried on a live proxy within this job and (b) marked dead
      // in Redis so the NEXT attempt skips it — so the retry only stays a proxy failure when ALL
      // proxies are down. Keep the slot count UNCHANGED so the customer can retry once proxies
      // recover without losing an attempt.
      const _infraFail =
        errorTypeLower === "proxy_die" ||
        /econnreset|econnrefused|etimedout|err_connection|err_timed_out|net::err_|err_tunnel|\bproxy[_ ]?die\b|no_proxy|no[_ ]raw[_ ]fallback/i.test(
          String(claim.autoCheckErrorMessage || result.error || "").toLowerCase(),
        );
      const claimSlotCount = _infraFail
        ? (_inheritedMeta ?? 0) // infra failure → do NOT count this attempt against the cap
        : _inheritedMeta !== null
          ? _inheritedMeta + 1
          : await this.prisma.warrantyClaim.count({
              where: {
                orderId: claim.orderId,
                status: { notIn: [WARRANTY_CLAIM_STATUS.REJECTED] as any },
                ...(claim.targetAccountEmail ? { targetAccountEmail: claim.targetAccountEmail } : {}),
              },
            });
      // Never escalate to seller on an infra failure alone (proxies need fixing, not manual review);
      // let the customer retry. Only a genuine ambiguous result that exhausts the 3 attempts escalates.
      const isLastSlot = !_infraFail && claimSlotCount >= MAX_CLAIMS_PER_ORDER_APPLY;

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
              autoApplyInProgress: false,    // explicit clear (don't rely on the pre-sentinel snapshot)
            } as Prisma.InputJsonValue,
          },
        });
        // Notify seller with the account + customer contact (so they can reach the customer), not the
        // old generic "yêu cầu mới" label.
        await this.notifySellerWarrantyResult(claim, "review", claim.customerMessage || undefined);
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
      await this.sendAutoCheckCustomerNotice(claim, resultLine, "pending_review", isLastSlot, lang);
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
              autoApplyInProgress: false,    // explicit clear (don't rely on the pre-sentinel snapshot)
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
        const stillPaidAccounts = Array.isArray(result?.accounts)
          ? (result.accounts as any[]).filter((a: any) => a.stillPaid === true)
          : [];
        await this.notifyCustomerAboutRejectedClaim(updated, reason, stillPaidAccounts.length ? stillPaidAccounts : undefined);
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
          ? [...new Set(accountsArr.filter(isDeadAccount).map((a: any) => String(a.email || "").toLowerCase().trim()).filter(Boolean))]
          : [];
        const deadAccountCount = deadAccountEmails.length;
        // Clamp the replacement count to order.quantity (and dedupe) — a delivered text with
        // duplicate / extra account lines must not issue MORE replacements than the customer bought.
        const _dedupTargets = claimTargetUsernames?.length
          ? new Set(claimTargetUsernames.map((u) => String(u).toLowerCase().trim()).filter(Boolean)).size
          : 0;
        const claimQuantityOverride = Math.min(
          fullOrder.quantity,
          deadAccountCount > 0 ? deadAccountCount : (_dedupTargets > 0 ? _dedupTargets : 1),
        ) || 1;
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
          await this.autoRefundForOutOfStock(fullOrder, claim, result, deadAccountEmails);
          return;
        }

        let _resolveAborted = false;
        let _stockRaceReview = false;
        await this.prisma.$transaction(async (tx) => {
          // #3 RE-LOCK: decideClaimRoute đọc stock NGOÀI lock (transaction A đã commit + nhả lock).
          // Seller có thể resolve/reject tay xen vào → nếu cấp tiếp sẽ cắt kho + cấp acc 2 lần.
          // Lock lại row + re-check PENDING ngay trước khi ghi; đổi rồi thì abort (không cắt/cấp).
          await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${claim.id} FOR UPDATE`;
          const _fresh = await tx.warrantyClaim.findUnique({ where: { id: claim.id }, select: { status: true } });
          if (!_fresh || _fresh.status !== WARRANTY_CLAIM_STATUS.PENDING) { _resolveAborted = true; return; }
          // #3 CROSS-CLAIM STOCK RACE: decision.manualStockUpdate.remainingEntries was computed from a
          // sourceProduct snapshot read OUTSIDE any lock. Two claims on the SAME product resolving
          // concurrently (e.g. a batch-expired multi-account order via 2 entry points, or concurrency>1)
          // would each write `available` from their own stale snapshot → lost update + the same entry
          // issued twice. Lock the product row (serializes the apply txs) and re-validate the snapshot;
          // if stock moved under us, route THIS claim to seller review instead of cutting/issuing stale.
          if (decision.manualStockUpdate) {
            await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${fullOrder.sourceProductId} FOR UPDATE`;
            const _freshSP = await tx.sourceProduct.findUnique({
              where: { id: fullOrder.sourceProductId },
              select: { available: true },
            });
            if (!_freshSP || _freshSP.available !== decision.manualStockUpdate.expectedAvailableBefore) {
              await tx.warrantyClaim.update({
                where: { id: claim.id },
                data: {
                  status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
                  resolutionNote: "Auto-check confirmed dead, nhưng kho thay đổi trong lúc xử lý đồng thời — chuyển shop duyệt tay để tránh cấp trùng tài khoản.",
                  metadataJson: {
                    ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
                      ? (claim.metadataJson as Record<string, unknown>)
                      : {}),
                    autoCheckPending: false,
                    ownerAttentionRequired: true,
                    autoCheckResultSummary: resultLine,
                    autoApplyInProgress: false,
                  } as Prisma.InputJsonValue,
                },
              });
              _stockRaceReview = true;
              return;
            }
          }
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
            // #3: retire the issued accounts from the stock_entries pool too (no-op if none match)
            // so a legacy-metadata fallback replacement can't stay AVAILABLE and be re-sold.
            await this.consumeMatchingStockEntries(tx, fullOrder.sourceProductId, decision.deliveredAccountText, fullOrder.id, fullOrder.customerId);
          }
          if (decision.stockEntryReplacement) {
            const okSE = await this.commitStockEntryReplacement(
              tx, decision.stockEntryReplacement, fullOrder.id, fullOrder.customerId,
            );
            if (!okSE) {
              await tx.warrantyClaim.update({
                where: { id: claim.id },
                data: {
                  status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
                  resolutionNote: "Auto-check confirmed dead, nhưng kho thay đổi trong lúc xử lý đồng thời — chuyển shop duyệt tay để tránh cấp trùng tài khoản.",
                  metadataJson: {
                    ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
                      ? (claim.metadataJson as Record<string, unknown>)
                      : {}),
                    autoCheckPending: false,
                    ownerAttentionRequired: true,
                    autoCheckResultSummary: resultLine,
                    autoApplyInProgress: false,
                  } as Prisma.InputJsonValue,
                },
              });
              _stockRaceReview = true;
              return;
            }
          }
          if (decision.internalSourceStockUpdate) {
            const { sourceProductId, remainingEntries, expectedAvailableBefore } = decision.internalSourceStockUpdate;
            // Mirror the manual-stock guard for the PRO source product: the cut was decided OUTSIDE
            // this lock, so lock the row + re-validate `available` vs the decision snapshot before
            // writing. Two concurrent claims on the same PRO source would otherwise double-issue the
            // same replacement account (cross-order inventory double-spend). On drift → seller review.
            await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${sourceProductId} FOR UPDATE`;
            const proProduct = await tx.sourceProduct.findUnique({
              where: { id: sourceProductId },
              select: { metadataJson: true, available: true },
            });
            if (!proProduct || proProduct.available !== expectedAvailableBefore) {
              await tx.warrantyClaim.update({
                where: { id: claim.id },
                data: {
                  status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
                  resolutionNote: "Auto-check confirmed dead, nhưng kho nguồn (PRO) thay đổi trong lúc xử lý đồng thời — chuyển shop duyệt tay để tránh cấp trùng tài khoản.",
                  metadataJson: {
                    ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
                      ? (claim.metadataJson as Record<string, unknown>)
                      : {}),
                    autoCheckPending: false,
                    ownerAttentionRequired: true,
                    autoCheckResultSummary: resultLine,
                    autoApplyInProgress: false,
                  } as Prisma.InputJsonValue,
                },
              });
              _stockRaceReview = true;
              return;
            }
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
            // Finding G: retire the issued accounts from the UPSTREAM product's stock_entries too.
            await this.consumeMatchingStockEntries(tx, sourceProductId, decision.deliveredAccountText, fullOrder.id, fullOrder.customerId);
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
                  ? (decision.stockEntryReplacement ? decision.stockEntryReplacement.totalCost : replacementCostSource)
                  : null,
              metadataJson: {
                ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
                  ? (claim.metadataJson as Record<string, unknown>)
                  : {}),
                autoCheckPending: false,
                autoResolved: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
                autoCheckResultSummary: resultLine,
                autoApplyInProgress: false,    // explicit clear (don't rely on the pre-sentinel snapshot)
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

        if (_resolveAborted) {
          this.logger.warn(`Claim ${claim.id}: trạng thái đổi trước khi auto-resolve commit (seller xử lý song song) — bỏ cấp acc thay (chống double).`);
          return;
        }

        if (_stockRaceReview) {
          this.logger.warn(`Claim ${claim.id}: kho đổi giữa lúc xử lý đồng thời — chuyển PENDING_REVIEW (chống cấp trùng acc).`);
          await this.notifySellerWarrantyResult(claim, "review", claim.customerMessage || undefined);
          await this.sendAutoCheckCustomerNotice(claim, resultLine, "pending_review", false, lang).catch(() => undefined);
          return;
        }

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
            decision.partialRefundCount || 0, // BUG-3: tell the customer which accounts were refunded
            lang,
          );
          if (decision.partialRefundCount) {
            await this.applyPartialStockRefund(fullOrder, claim.id, decision.partialRefundCount);
          }
        } else if (decision.nextStatus === WARRANTY_CLAIM_STATUS.PENDING_STOCK) {
          // BUG-2: account CONFIRMED DEAD but replacement stock is temporarily out (provider still
          // processing — NOT exhausted, so no refund). Do NOT send the ambiguous "chưa xác minh
          // được — bấm Bảo hành lại" notice: it's wrong (it WAS verified dead) and makes the
          // customer waste a warranty slot retrying. Tell them it's confirmed + awaiting replacement.
          await this.sendConfirmedDeadAwaitingStockNotice(claim, decision.customerMessage, lang);
        } else {
          await this.sendAutoCheckCustomerNotice(claim, resultLine, "pending_review", false, lang);
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
          autoApplyInProgress: false,    // explicit clear (don't rely on the pre-sentinel snapshot)
        } as Prisma.InputJsonValue,
      },
    });
    await this.notifySellerWarrantyResult(claim, "review", claim.customerMessage || undefined);
    await this.sendAutoCheckCustomerNotice(claim, resultLine, "pending_review", false, lang);
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

  /**
   * Warranty refund time-proration ratio ∈ [0,1]: how much of the paid warranty window is unused.
   * Shared by BOTH refund paths (out-of-stock + partial-stock) so they agree on the amount for the
   * same economic event. durationType LIFETIME/OTHER/null → ratio 1 (no proration). The upper clamp
   * (Math.min) is REQUIRED so a future/backfilled deliveredAt can never yield ratio > 1 (over-refund).
   */
  private computeWarrantyTimeRatio(
    durationType: string | null | undefined,
    deliveredAt: Date | null,
    durationTypeOther?: string | null,
  ): { timeRatio: number; daysUsed: number | null; daysRemaining: number | null; durationDays: number | null } {
    // resolveBatchLifetimeDays parses BOTH the fixed enums AND free-text OTHER ("10 ngày", "2 tháng",
    // "24h"), so an OTHER-term order now prorates by unused days like enum terms instead of refunding
    // the full price. LIFETIME / unparseable / non-positive → null → timeRatio 1 (no proration).
    const durationDays = this.resolveBatchLifetimeDays(durationType, durationTypeOther);
    if (durationDays === null || durationDays <= 0 || !deliveredAt) {
      return { timeRatio: 1, daysUsed: null, daysRemaining: null, durationDays };
    }
    const daysUsed = Math.floor((Date.now() - deliveredAt.getTime()) / 86400000);
    const daysRemaining = Math.max(0, Math.min(durationDays, durationDays - daysUsed));
    return { timeRatio: daysRemaining / durationDays, daysUsed, daysRemaining, durationDays };
  }

  /**
   * Split a refund credit back into non-withdrawable commission vs withdrawable main, proportional to
   * how the customer originally PAID for the order (purchases debit commission-first via
   * splitWalletDebit). Without this, refunds all land in withdrawable `balance` → a customer who spent
   * affiliate commission launders it into cash via a warranty round-trip (M5). Reads the order's
   * SPEND_ORDER ledger (referenceType=order, set in orders.service) and uses the commission DELTA as
   * the source of truth (the ledger.amount sign differs across code paths). Falls back to all-main when
   * no SPEND ledger / null commission fields (legacy orders) so nothing breaks. commissionShare is
   * capped at what was actually spent from commission so repeated/partial refunds never over-restore;
   * mainShare absorbs rounding so the total credited == refundAmount exactly (no money created).
   */
  private async computeRefundCommissionSplit(
    tx: Prisma.TransactionClient,
    customerId: string,
    referenceId: string,
    refundAmount: number,
    referenceType: string = "order",
  ): Promise<{ commissionShare: number; mainShare: number }> {
    // referenceType "order" = end-customer purchase (orders.service SPEND_ORDER);
    // "internal_source_order" = a downstream seller's B2B purchase (internal-source.service) — used
    // by the cascade refund so the reseller chain doesn't launder commission into cash either.
    const spend = await tx.customerWalletLedger.findFirst({
      where: { referenceType, referenceId, customerId, type: "SPEND_ORDER" },
      select: { commissionBalanceBefore: true, commissionBalanceAfter: true, amount: true },
      orderBy: { createdAt: "asc" },
    });
    if (!spend || spend.commissionBalanceBefore == null || spend.commissionBalanceAfter == null) {
      return { commissionShare: 0, mainShare: refundAmount };
    }
    const fromCommission =
      decimalToNumber(spend.commissionBalanceBefore) - decimalToNumber(spend.commissionBalanceAfter);
    const paidTotal = Math.abs(decimalToNumber(spend.amount));
    if (fromCommission <= 0 || paidTotal <= 0) return { commissionShare: 0, mainShare: refundAmount };
    let commissionShare = Math.round(refundAmount * (fromCommission / paidTotal));
    commissionShare = Math.max(0, Math.min(commissionShare, fromCommission, refundAmount));
    return { commissionShare, mainShare: refundAmount - commissionShare };
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
    deadAccountEmails?: string[],
  ) {
    const targetUsernames = (claim.metadataJson as any)?.targetUsernames as string[] | undefined;
    // Refund only the accounts the tool actually confirmed DEAD (passed in by applyAutoCheckResult),
    // NOT every account the customer named. On a multi-account claim where the customer claims 3 but
    // only 1 is dead and stock is out, refunding `targetUsernames.length` would pay back 2 still-alive
    // accounts. Fall back to targetUsernames / quantity only when no per-account verdict was provided.
    // Dedupe (a delivered-text with duplicate / extra account lines, or repeated targetUsernames,
    // must not inflate the count) and CLAMP to quantity — otherwise baseRefundByQty below can exceed
    // the order total and we'd refund more than the customer paid.
    const _uniq = (arr?: string[]) =>
      new Set((arr ?? []).map((s) => String(s).toLowerCase().trim()).filter(Boolean)).size;
    const claimedCount = Math.min(
      fullOrder.quantity,
      deadAccountEmails && deadAccountEmails.length > 0
        ? _uniq(deadAccountEmails)
        : targetUsernames?.length && targetUsernames.length > 0
          ? _uniq(targetUsernames)
          : fullOrder.quantity,
    );
    const orderTotal = decimalToNumber(fullOrder.totalSaleAmount);

    // Quantity proration: only refund for accounts being claimed
    const baseRefundByQty = Math.round((orderTotal * claimedCount) / Math.max(1, fullOrder.quantity));

    // Time proration: refund only for remaining unused days (shared helper, clamped to [0,1]).
    const { timeRatio, daysUsed, daysRemaining, durationDays } = this.computeWarrantyTimeRatio(
      fullOrder.sourceProduct.durationType,
      fullOrder.deliveredAt,
      fullOrder.sourceProduct.durationTypeOther,
    );

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

    // False-dead guard (configurable): a single auto-check verdict triggers an IRREVERSIBLE wallet
    // refund with no human in the loop, so a confidently-wrong "dead" reading + out-of-stock pays
    // the customer cash while they keep a working account. If the operator set a review threshold
    // (warranty.refund.reviewAboveVnd > 0) and this refund exceeds it, DON'T auto-credit — route to
    // seller review so a human confirms before money moves. Money-safe: nothing credited, no cascade.
    const _refundCfg = await this.autoCheckService.getConfig();
    if (_refundCfg.refundReviewAboveVnd > 0 && refundAmount > _refundCfg.refundReviewAboveVnd) {
      await this.prisma.warrantyClaim.update({
        where: { id: claim.id },
        data: {
          status: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
          resolutionNote: `Tool báo tài khoản chết + hết hàng thay. Tiền hoàn dự kiến ${refundAmount.toLocaleString("vi-VN")}đ vượt ngưỡng auto-hoàn (${_refundCfg.refundReviewAboveVnd.toLocaleString("vi-VN")}đ) → chờ shop duyệt tay trước khi hoàn.`,
          metadataJson: {
            ...(claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
              ? (claim.metadataJson as Record<string, unknown>)
              : {}),
            autoCheckPending: false,
            ownerAttentionRequired: true,
            autoApplyInProgress: false,
            refundHeldForReview: true,
            refundHeldAmount: refundAmount,
          } as Prisma.InputJsonValue,
        },
      });
      await this.notifySellerWarrantyResult(claim, "review", claim.customerMessage || undefined).catch(() => undefined);
      this.logger.warn(
        `Claim ${claim.id}: out-of-stock refund ${refundAmount}đ > review threshold ${_refundCfg.refundReviewAboveVnd}đ — held for seller review (NOT auto-refunded).`,
      );
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
      // Serialize all refund attempts for THIS claim: lock the claim row first so the
      // existingRefund idempotency check below is atomic (two concurrent callbacks/sweeps
      // can no longer both pass findFirst and double-credit the wallet).
      await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${claim.id} FOR UPDATE`;
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
        const commissionBefore = decimalToNumber(fresh?.commissionBalance ?? 0);
        // M5: restore the commission-paid portion back to non-withdrawable commissionBalance instead
        // of dumping the whole refund into withdrawable balance (would launder commission into cash).
        const { commissionShare, mainShare } = await this.computeRefundCommissionSplit(
          tx, fullOrder.customerId, fullOrder.id, refundAmount,
        );
        const balanceAfter = balanceBefore + mainShare;
        const commissionAfter = commissionBefore + commissionShare;
        await tx.customerWallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter, commissionBalance: commissionAfter },
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
            commissionBalanceBefore: commissionBefore,
            commissionBalanceAfter: commissionAfter,
            referenceType: "warranty_refund",
            referenceId: claim.id,
            note: `Hoàn ví ${refundAmount.toLocaleString("vi-VN")}đ — đơn ${fullOrder.orderCode} hết hàng thay thế${claimedCount < fullOrder.quantity ? ` (${claimedCount}/${fullOrder.quantity} tài khoản)` : ""}${daysUsed !== null ? `, đã dùng ${daysUsed}/${durationDays} ngày` : ""}${commissionShare > 0 ? `, hoàn HH ${commissionShare.toLocaleString("vi-VN")}đ` : ""}.`,
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
      // #2 fix: a refund SETTLES the warranty for the claimed account(s) — the customer was
      // compensated in cash. Stamp them into replacedAccountEmails so getReplacedEmailSet /
      // wasAccountSpecificallyReplaced / findCooldownBlocker treat them as resolved and BLOCK a
      // later re-claim (which would be a refund-then-free-replacement double-dip once stock returns).
      // Without this marker, the refund claim has deliveredAccountText=null, so the targetUsernames
      // fallback in those guards is skipped and the account stays re-claimable.
      // Prefer the tool-confirmed dead accounts (what we actually refunded); fall back to the
      // customer-named targets, then the full delivered set. Keeps the double-dip block scoped to
      // the accounts that were genuinely compensated.
      const _refundedAccountEmails = deadAccountEmails && deadAccountEmails.length > 0
        ? deadAccountEmails
        : Array.isArray(targetUsernames) && targetUsernames.length > 0
          ? targetUsernames
          : this.autoCheckService.parseAllCredentials(fullOrder.deliveredAccountText).map((c) => c.email);
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
            ...(_refundedAccountEmails.length > 0 ? { replacedAccountEmails: _refundedAccountEmails } : {}),
            refundedAccountEmails: _refundedAccountEmails,
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
      const _acctScoped = !!(claim as any).targetAccountEmail;
      const _rl = String(claim.customer?.preferredLanguage || "").toLowerCase();
      const rLang: "vi" | "en" | "th" = _rl === "en" ? "en" : _rl === "th" ? "th" : "vi";
      const invoice = await this.buildClaimInvoiceMessage(claim.orderId, _acctScoped).catch(() => null);
      const timeNote = daysUsed !== null
        ? (rLang === "en" ? `⏳ Used ${daysUsed}/${durationDays} days (${daysRemaining} left).`
          : rLang === "th" ? `⏳ ใช้ไปแล้ว ${daysUsed}/${durationDays} วัน (เหลือ ${daysRemaining} วัน)`
          : `⏳ Đã sử dụng ${daysUsed}/${durationDays} ngày (còn ${daysRemaining} ngày).`)
        : null;
      const orderLabel = rLang === "en" ? "Order" : rLang === "th" ? "รหัสคำสั่งซื้อ" : "Mã đơn";
      const productLabel = rLang === "en" ? "Product" : rLang === "th" ? "สินค้า" : "Sản phẩm";
      const parts: (string | null)[] = [
        rLang === "en" ? "💰 <b>Warranty — refunded to wallet</b>" : rLang === "th" ? "💰 <b>การรับประกัน — คืนเงินเข้ากระเป๋า</b>" : "💰 <b>Bảo hành — hoàn tiền vào ví</b>",
        "",
        _acctScoped ? null : `📝 ${orderLabel}: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`,
        `📦 ${productLabel}: ${this.escapeHtml(claim.productNameSnapshot)}`,
        `🔢 Claim #${claim.claimNumber}`,
        ...this.claimIdentityLines(claim as any),
        "",
        rLang === "en" ? "There is no replacement account left for this order." : rLang === "th" ? "ไม่มีบัญชีทดแทนสำหรับคำสั่งซื้อนี้แล้ว" : "Hệ thống không còn tài khoản thay thế cho đơn này.",
        timeNote,
        rLang === "en"
          ? `💵 Refunded <b>${refundAmount.toLocaleString("vi-VN")}đ</b> to your wallet. You can use this balance for another order.`
          : rLang === "th"
            ? `💵 คืนเงิน <b>${refundAmount.toLocaleString("vi-VN")}đ</b> เข้ากระเป๋าของคุณแล้ว ใช้ยอดนี้สั่งซื้อรายการอื่นได้`
            : `💵 Đã hoàn <b>${refundAmount.toLocaleString("vi-VN")}đ</b> vào ví của bạn. Bạn có thể dùng số dư này để mua đơn khác.`,
      ];
      if (invoice) parts.push("", invoice);
      const text = parts.filter((s) => s !== null).join("\n").trimEnd();
      await telegramSendMessage(token, claim.customer.telegramChatId, text, { parse_mode: "HTML" })
        .catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
    }

    // Notify shop owner — with the account + customer contact — that we refunded (cascade upstream
    // runs below). Replaces the old generic "yêu cầu mới" notify.
    await this.notifySellerWarrantyResult(
      claim,
      "refunded",
      `Hết hàng thay thế. Đã hoàn ${refundAmount.toLocaleString("vi-VN")}đ vào ví khách. Hệ thống đang chuyển hoàn ngược upstream cho bạn (nếu có).`,
    );

    // Cascade refund UP the chain. Đại lý refunds CTV's wallet, Nguồn refunds Đại lý's wallet, etc.
    // Stops when reaching external provider (canboso) — admin reconciles those manually.
    await this.cascadeRefundUpstream(
      fullOrder.shopId,
      fullOrder.orderCode,
      claim.id,
      `Warranty out of stock for downstream order ${fullOrder.orderCode}`,
      // #3: prorate the upstream cascade by the SAME fraction we refunded the customer (only the
      // dead/claimed accounts), not the whole B2B order — else a 2-of-5 claim over-refunds upstream.
      claimedCount / Math.max(1, fullOrder.quantity),
    ).catch((err) => {
      this.logger.error(`[warranty] Cascade refund failed for claim ${claim.id}: ${err?.message ?? err}`);
    });
  }

  private async applyPartialStockRefund(
    order: { id: string; quantity: number; totalSaleAmount: Prisma.Decimal | number; orderCode: string; customerId: string; deliveredAt: Date | null; sourceProduct: { durationType: string | null; durationTypeOther: string | null } },
    claimId: string,
    partialRefundCount: number,
  ): Promise<void> {
    // Clamp defensively to [0, quantity] so a caller passing an inflated count (dup/extra account
    // lines) can never refund more than the order total.
    const safeCount = Math.min(Math.max(0, Math.floor(partialRefundCount)), order.quantity);
    if (safeCount <= 0) return;
    const orderTotal = decimalToNumber(order.totalSaleAmount as Prisma.Decimal);
    const baseRefund = Math.round(orderTotal * safeCount / Math.max(1, order.quantity));
    // M6: prorate by remaining warranty days — SAME economic event as autoRefundForOutOfStock
    // (an un-replaceable account), so the amount must match. Without this the partial path refunded
    // the full per-account price even near expiry → over-refund vs the out-of-stock path. Shared
    // helper includes the [0,1] clamp so a future deliveredAt can't push the refund over 100%.
    const { timeRatio } = this.computeWarrantyTimeRatio(order.sourceProduct.durationType, order.deliveredAt, order.sourceProduct.durationTypeOther);
    const refundAmount = Math.round(baseRefund * timeRatio);
    if (refundAmount <= 0) return;

    await this.prisma.$transaction(async (tx) => {
      // Lock the claim row first so the idempotency check is atomic per-claim (prevents
      // concurrent double partial-refund — same reasoning as autoRefundForOutOfStock).
      await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${claimId} FOR UPDATE`;
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
      const commissionBefore = decimalToNumber(fresh?.commissionBalance ?? 0);
      // M5: restore commission-paid portion to commissionBalance (see autoRefundForOutOfStock).
      const { commissionShare, mainShare } = await this.computeRefundCommissionSplit(
        tx, order.customerId, order.id, refundAmount,
      );
      const balanceAfter = balanceBefore + mainShare;
      const commissionAfter = commissionBefore + commissionShare;
      await tx.customerWallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter, commissionBalance: commissionAfter } });
      await tx.customerWalletLedger.create({
        data: {
          customerId: order.customerId,
          walletId: wallet.id,
          type: "REFUND_ORDER",
          currency: "VND",
          amount: refundAmount,
          balanceBefore,
          balanceAfter,
          commissionBalanceBefore: commissionBefore,
          commissionBalanceAfter: commissionAfter,
          referenceType: "warranty_partial_refund",
          referenceId: claimId,
          note: `Hoàn ví ${refundAmount.toLocaleString("vi-VN")}đ — đơn ${order.orderCode} thiếu hàng bảo hành ${safeCount}/${order.quantity} tài khoản${commissionShare > 0 ? `, hoàn HH ${commissionShare.toLocaleString("vi-VN")}đ` : ""}.`,
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
    refundRatio: number = 1,
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
    // #3: refund the upstream only for the fraction of accounts actually refunded downstream (the
    // dead/claimed ones), not the whole B2B order. ratio==1 = full order → safe to CANCEL the ISO;
    // a partial ratio leaves the ISO active (its other accounts are still valid).
    const ratio = Math.min(1, Math.max(0, refundRatio));
    const isFullCascade = ratio >= 1;
    const refundAmount = Math.round(decimalToNumber(iso.totalAmount) * ratio);
    if (refundAmount <= 0) return;
    const downstreamTelegramChatId = iso.connection.downstreamTelegramChatId;
    if (!downstreamTelegramChatId) {
      this.logger.warn(`[warranty cascade] Connection ${iso.connectionId} missing downstreamTelegramChatId.`);
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent cascades for the same root claim BEFORE the idempotency check so that
      // check-then-insert is atomic. InternalSourceLedger has no unique constraint on
      // (referenceType, referenceId, connectionId), so without this lock two cascades fired
      // concurrently (retry + sweep + recheck self-heal) could BOTH pass findFirst and double-credit
      // the upstream seller. Mirrors the customer-refund paths (autoRefund/applyPartialStockRefund),
      // which lock the claim row first for the same reason.
      await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${rootClaimId} FOR UPDATE`;
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
      let commissionBefore = 0;
      if (walletId) {
        await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${walletId} FOR UPDATE`;
        const fresh = await tx.customerWallet.findUnique({ where: { id: walletId } });
        balanceBefore = decimalToNumber(fresh?.balance ?? 0);
        commissionBefore = decimalToNumber(fresh?.commissionBalance ?? 0);
      } else {
        const created = await tx.customerWallet.create({
          data: { customerId: customer.id, balance: 0 },
        });
        walletId = created.id;
        balanceBefore = 0;
      }
      // M5-B: split the cascade refund back to commission vs withdrawable main, keyed on the
      // downstream seller's B2B purchase (internal_source_order SPEND ledger) — same anti-laundering
      // logic as the end-customer refund paths, applied to the reseller chain. iso.id is the
      // InternalSourceOrder this hop is refunding.
      const { commissionShare, mainShare } = await this.computeRefundCommissionSplit(
        tx, customer.id, iso.id, refundAmount, "internal_source_order",
      );
      const balanceAfter = balanceBefore + mainShare;
      const commissionAfter = commissionBefore + commissionShare;
      await tx.customerWallet.update({
        where: { id: walletId },
        data: { balance: balanceAfter, commissionBalance: commissionAfter },
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
          commissionBalanceBefore: commissionBefore,
          commissionBalanceAfter: commissionAfter,
          referenceType: "warranty_cascade_refund",
          referenceId: rootClaimId,
          note: `Cascade refund ${refundAmount.toLocaleString("vi-VN")}đ cho đơn upstream ${iso.sourceOrderCode} (downstream order ${currentOrderCode})${commissionShare > 0 ? `, hoàn HH ${commissionShare.toLocaleString("vi-VN")}đ` : ""}. ${reason}`,
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
      // Only CANCEL the upstream order when the WHOLE order was refunded. A partial cascade (some
      // accounts still valid) must leave the ISO active so its remaining accounts aren't voided.
      if (isFullCascade) {
        await tx.internalSourceOrder.update({
          where: { id: iso.id },
          data: {
            status: "CANCELED",
            failureReason: `Cascade refunded from downstream warranty: ${reason}`,
          },
        });
      }
    });
    // Recurse: upstream shop also needs to recoup from ITS upstream (if any) — same proration ratio.
    await this.cascadeRefundUpstream(
      iso.upstreamShopId,
      iso.sourceOrderCode,
      rootClaimId,
      reason,
      ratio,
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
  // Identity lines for bot warranty notices: WHICH account is being warrantied + the contact the
  // customer entered. Lets a reseller handling several per-account (lẻ) warranties tell them apart.
  private claimIdentityLines(claim: {
    targetAccountEmail?: string | null;
    metadataJson?: Prisma.JsonValue | null;
    customer?: { telegramUsername?: string | null; firstName?: string | null; telegramChatId?: string | null } | null;
  }): string[] {
    const lines: string[] = [];
    const acc = claim.targetAccountEmail ? String(claim.targetAccountEmail).trim() : "";
    if (acc) lines.push(`🎯 Tài khoản: <code>${this.escapeHtml(acc)}</code>`);
    const meta = claim.metadataJson && typeof claim.metadataJson === "object" && !Array.isArray(claim.metadataJson)
      ? (claim.metadataJson as Record<string, unknown>)
      : null;
    // Prefer the contact the customer typed (web); fall back to their Telegram handle (bot claims
    // carry no typed contact) so the reseller can always tell who/which a lẻ warranty belongs to.
    let contact = meta && typeof meta.contactInfo === "string" ? meta.contactInfo.trim() : "";
    if (!contact && claim.customer) {
      contact = claim.customer.telegramUsername
        ? `@${claim.customer.telegramUsername}`
        : (claim.customer.firstName || (claim.customer.telegramChatId ? `#${claim.customer.telegramChatId}` : ""));
    }
    if (contact) lines.push(`📞 Liên hệ: ${this.escapeHtml(contact)}`);
    return lines;
  }

  private async buildClaimInvoiceMessage(orderId: string, accountScoped = false): Promise<string | null> {
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
    // Actionable CTA (not just a bare handle): a customer whose replacement later dies needs to know
    // exactly who to message to re-warranty. Shown on every warranty-result notice (this invoice
    // block is appended to all of them).
    const supportLine = support ? `💬 Cần bảo hành lại? Nhắn ${this.escapeHtml(support)}` : "";
    const rule = "━━━━━━━━━━━━━━━━━";
    // Per-account (retail) view hides order-level economics (qty·total) + the buyer's identity —
    // one order may be resold to several different end-customers (mirrors the web invoice scoping).
    return [
      rule,
      accountScoped ? `📦 ${product}` : `📦 ${product} · ${qty} acc · ${total}đ`,
      (!accountScoped && buyerLabel) ? `👤 ${this.escapeHtml(buyerLabel)}` : null,
      `⏰ Hạn bảo hành ${this.escapeHtml(expiresLine)}`,
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
   * which re-runs the eligibility check + re-submits using the password ON FILE (the bot has no
   * password-input step). Useful when:
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
   *   ⏰ Hạn bảo hành dd/mm/yyyy
   *   💬 @support
   *   ━━━━━━━━━━━━━━━━━
   */
  private async sendAutoResolvedCustomerNotice(
    claim: Prisma.WarrantyClaimGetPayload<{ include: { customer: true; shop: { include: { botConfig: true } } } }>,
    deliveredAccountText: string,
    _customerMessage: string, // intentionally unused — header + creds convey the outcome
    partialRefundCount = 0, // BUG-3: when some accounts had no replacement stock, they were refunded
    lang: "vi" | "en" | "th" = "vi",
  ) {
    const token = decryptSecret(claim.shop.botConfig?.telegramBotTokenEncrypted, this.config.encryptionKey);
    if (!token || !claim.customer?.telegramChatId || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      return;
    }
    const accountScoped = !!(claim as any).targetAccountEmail;
    const invoice = await this.buildClaimInvoiceMessage(claim.orderId, accountScoped).catch(() => null);
    const orderLabel = lang === "en" ? "Order" : lang === "th" ? "รหัสคำสั่งซื้อ" : "Mã đơn";
    const replacementHeader =
      lang === "en" ? "🔑 <b>Replacement account</b>"
      : lang === "th" ? "🔑 <b>บัญชีทดแทน</b>"
      : "🔑 <b>Tài khoản thay thế</b>";
    const refundNote = (n: number) =>
      lang === "en"
        ? `💰 ${n} account(s) were out of replacement stock and have been <b>refunded to your wallet</b>. Use the balance for another order.`
        : lang === "th"
          ? `💰 ${n} บัญชีไม่มีสต๊อกทดแทนและได้ <b>คืนเงินเข้ากระเป๋า</b>ของคุณแล้ว ใช้ยอดนี้สั่งซื้อรายการอื่นได้`
          : `💰 ${n} tài khoản không còn hàng thay đã được <b>hoàn tiền vào ví</b> của bạn. Dùng số dư này để mua đơn khác.`;
    const header =
      lang === "en" ? "✨🎉 <b>WARRANTY</b> ✓ 🎉✨"
      : lang === "th" ? "✨🎉 <b>การรับประกัน</b> ✓ 🎉✨"
      : "✨🎉 <b>BẢO HÀNH</b> ✓ 🎉✨";
    const text = [
      header,
      "",
      // Order code hidden on a per-account (retail) warranty — they only need their replacement.
      ...(accountScoped ? [] : [`📝 ${orderLabel}: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`]),
      ...this.claimIdentityLines(claim),
      "",
      replacementHeader,
      `<pre>${this.escapeHtml(deliveredAccountText)}</pre>`,
      // BUG-3: partial — some accounts had no replacement stock and were refunded to the wallet.
      // Previously this was silent: the customer only saw the replacement accounts.
      ...(partialRefundCount > 0 ? ["", refundNote(partialRefundCount)] : []),
      "",
      invoice || "",
    ].filter((s, i, arr) => s !== "" || (i > 0 && arr[i - 1] !== "")).join("\n").trimEnd();

    await this.deliverBotMessage(claim, token, text);
    // Let the seller know a replacement was issued (with which account + the customer's contact) so
    // they can follow up — success had no seller notification before.
    await this.notifySellerWarrantyResult(claim, "resolved");
  }

  /**
   * BUG-2: account CONFIRMED DEAD by auto-check but replacement stock is temporarily out (the
   * provider is still processing — NOT exhausted, so the claim sits at PENDING_STOCK and no refund
   * is issued yet). The customer must be told it's confirmed and a replacement is on the way —
   * NOT the ambiguous "chưa xác minh được, bấm Bảo hành lại" message, which is wrong here and
   * makes them waste a warranty slot retrying a verdict that already succeeded.
   */
  private async sendConfirmedDeadAwaitingStockNotice(
    claim: Prisma.WarrantyClaimGetPayload<{ include: { customer: true; shop: { include: { botConfig: true } } } }>,
    customerMessage?: string | null,
    lang: "vi" | "en" | "th" = "vi",
  ) {
    const token = decryptSecret(claim.shop.botConfig?.telegramBotTokenEncrypted, this.config.encryptionKey);
    if (!token || !claim.customer?.telegramChatId || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      return;
    }
    const accountScoped = !!(claim as any).targetAccountEmail;
    const invoice = await this.buildClaimInvoiceMessage(claim.orderId, accountScoped).catch(() => null);
    const orderLabel = lang === "en" ? "Order" : lang === "th" ? "รหัสคำสั่งซื้อ" : "Mã đơn";
    const defaultBody =
      lang === "en"
        ? "Your account was confirmed faulty. Replacement stock is momentarily out — the shop will process it and deliver a new account soon."
        : lang === "th"
          ? "ยืนยันแล้วว่าบัญชีของคุณใช้งานไม่ได้ สต๊อกทดแทนหมดชั่วคราว ทางร้านจะดำเนินการและส่งบัญชีใหม่ให้เร็ว ๆ นี้"
          : "Tài khoản của bạn đã được xác nhận hỏng. Kho thay thế tạm hết — shop sẽ xử lý và giao tài khoản mới sớm.";
    const header =
      lang === "en" ? "🛠 <b>Confirmed faulty — awaiting replacement</b>"
      : lang === "th" ? "🛠 <b>ยืนยันว่าใช้งานไม่ได้ — กำลังรอบัญชีทดแทน</b>"
      : "🛠 <b>Đã xác nhận lỗi — đang chờ tài khoản thay</b>";
    const body =
      customerMessage && customerMessage.trim()
        ? this.escapeHtml(customerMessage.trim())
        : defaultBody;
    const text = [
      header,
      "",
      ...(accountScoped ? [] : [`📝 ${orderLabel}: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`]),
      ...this.claimIdentityLines(claim),
      "",
      body,
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
  private describeAutoCheckErrorReason(errorType: string | null | undefined, lang: "vi" | "en" | "th" = "vi"): string {
    const et = String(errorType || "").toLowerCase();
    const T: Record<string, { vi: string; en: string; th: string }> = {
      wrong_password: { vi: "Mật khẩu không đúng", en: "Wrong password", th: "รหัสผ่านไม่ถูกต้อง" },
      login_stuck: { vi: "Mật khẩu không đúng hoặc lỗi đăng nhập", en: "Wrong password or login error", th: "รหัสผ่านไม่ถูกต้องหรือเข้าสู่ระบบผิดพลาด" },
      "2fa": { vi: "Tài khoản yêu cầu xác thực 2 bước (OTP)", en: "Account requires two-factor (OTP)", th: "บัญชีต้องยืนยันตัวตนสองชั้น (OTP)" },
      proxy_die: { vi: "Lỗi kết nối — vui lòng thử lại", en: "Connection error — please retry", th: "การเชื่อมต่อผิดพลาด กรุณาลองใหม่" },
      cf_timeout: { vi: "Cloudflare chặn tạm thời — thử lại sau ít phút", en: "Cloudflare temporarily blocked — retry in a few minutes", th: "Cloudflare บล็อกชั่วคราว ลองใหม่ในอีกสักครู่" },
      blocked: { vi: "Tài khoản bị khoá", en: "Account is locked", th: "บัญชีถูกล็อก" },
    };
    const fallback = { vi: "Hệ thống chưa kiểm chính xác — có thể do mạng chậm", en: "Could not verify accurately — possibly a slow network", th: "ระบบยังตรวจสอบไม่ได้แน่ชัด อาจเป็นเพราะเครือข่ายช้า" };
    return (T[et] || fallback)[lang];
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
    isLastSlot = false,
    lang: "vi" | "en" | "th" = "vi",
  ) {
    const token = decryptSecret(claim.shop.botConfig?.telegramBotTokenEncrypted, this.config.encryptionKey);
    if (!token || !claim.customer?.telegramChatId || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      return;
    }
    const _acctScoped = !!(claim as any).targetAccountEmail;
    const invoice = await this.buildClaimInvoiceMessage(claim.orderId, _acctScoped).catch(() => null);
    const autoResult = claim.autoCheckResult && typeof claim.autoCheckResult === "object" && !Array.isArray(claim.autoCheckResult)
      ? (claim.autoCheckResult as Record<string, unknown>)
      : null;
    const errorType = autoResult ? String(autoResult.errorType || "") : "";
    const isWrongPassword = errorType === "wrong_password";
    const reasonLine = this.describeAutoCheckErrorReason(errorType, lang);
    const orderLabel = lang === "en" ? "Order" : lang === "th" ? "รหัสคำสั่งซื้อ" : "Mã đơn";
    const supportHandle = claim.shop.supportTelegram ? `@${claim.shop.supportTelegram.replace(/^@/, "")}` : null;
    let header: string;
    let actionLine: string;
    if (isLastSlot) {
      header = lang === "en" ? "❌ <b>Warranty unsuccessful</b>" : lang === "th" ? "❌ <b>การรับประกันไม่สำเร็จ</b>" : "❌ <b>Bảo hành không thành công</b>";
      actionLine = supportHandle
        ? (lang === "en" ? `Please contact ${supportHandle} for assistance.` : lang === "th" ? `กรุณาติดต่อ ${supportHandle} เพื่อขอความช่วยเหลือ` : `Vui lòng liên hệ ${supportHandle} để được hỗ trợ.`)
        : (lang === "en" ? "Please contact the shop for assistance." : lang === "th" ? "กรุณาติดต่อร้านเพื่อขอความช่วยเหลือ" : "Vui lòng liên hệ shop để được hỗ trợ.");
    } else if (isWrongPassword) {
      header = lang === "en" ? "🔑 <b>Wrong password</b>" : lang === "th" ? "🔑 <b>รหัสผ่านไม่ถูกต้อง</b>" : "🔑 <b>Mật khẩu không đúng</b>";
      // The bot re-checks with the password ON FILE — it cannot accept a new password typed in chat.
      // So the honest guidance is: retry (in case it was transient), else contact the shop to update.
      actionLine = lang === "en"
        ? "Tap <b>🛡 Warranty again</b> to recheck. If you changed the account password, please contact the shop to update it."
        : lang === "th" ? "กด <b>🛡 รับประกันอีกครั้ง</b> เพื่อตรวจสอบใหม่ หากคุณเปลี่ยนรหัสผ่านบัญชี กรุณาติดต่อร้านเพื่ออัปเดต"
        : "Bấm <b>🛡 Bảo hành lại</b> để kiểm tra lại. Nếu bạn đã đổi mật khẩu tài khoản, vui lòng liên hệ shop để cập nhật.";
    } else {
      header = lang === "en" ? "⚠ <b>Could not verify</b>" : lang === "th" ? "⚠ <b>ตรวจสอบไม่ได้</b>" : "⚠ <b>Chưa xác minh được</b>";
      actionLine = lang === "en"
        ? "Tap <b>🛡 Warranty again</b> to retry, or the shop will review if it still can't be verified."
        : lang === "th" ? "กด <b>🛡 รับประกันอีกครั้ง</b> เพื่อลองใหม่ หรือทางร้านจะตรวจสอบหากยังยืนยันไม่ได้"
        : "Bấm <b>🛡 Bảo hành lại</b> để thử thêm, hoặc shop sẽ xem xét nếu vẫn không xác minh được.";
    }
    const _idLines = this.claimIdentityLines(claim);
    const text = [
      header,
      "",
      ...(_acctScoped ? [] : [`📝 ${orderLabel}: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`]),
      ..._idLines,
      "",
      this.escapeHtml(reasonLine) + ".",
      actionLine,
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
  }): Promise<{ eligible: true; orderCode: string; accounts: string[]; issuedReplacements?: string[]; replacedAccounts?: string[]; wrongPasswordRetry?: boolean } | { eligible: false; status: string; message: string }> {
    const rawQuery = String(input.orderCode || "").trim();
    const language = input.language || "vi";

    if (!rawQuery || rawQuery.length < 3) {
      return {
        eligible: false,
        status: "invalid",
        message: language === "en"
          ? "Please enter a valid order code or account email."
          : language === "th" ? "กรุณาระบุรหัสคำสั่งซื้อหรืออีเมลบัญชีที่ถูกต้อง"
          : "Vui lòng nhập mã đơn hàng hoặc email tài khoản hợp lệ.",
      };
    }

    // Accept EITHER an order code (ORD-…) OR the account the customer is using — same UX as the web
    // search. Account lookup is scoped to THIS customer's Telegram identity (ownership) and matched
    // as a FULL account token (mirror of publicSearchOrders) so a fragment can't pull a wrong order.
    const isOrderCode = /^ORD-[0-9]/i.test(rawQuery);
    const normalizedOrderCode = rawQuery.toUpperCase();

    let order = isOrderCode
      ? await this.prisma.order.findFirst({
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
        })
      : null;

    if (!isOrderCode) {
      const candidates = await this.prisma.order.findMany({
        where: {
          shopId: input.shopId,
          customer: { telegramUserId: input.telegramUserId },
          status: OrderStatus.DELIVERED,
          OR: [
            { deliveredAccountText: { contains: rawQuery, mode: "insensitive" } },
            {
              warrantyClaims: {
                some: {
                  status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
                  deliveredAccountText: { contains: rawQuery, mode: "insensitive" },
                },
              },
            },
          ],
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
        orderBy: { deliveredAt: "desc" },
        take: 5,
      });
      const _q = rawQuery.toLowerCase();
      const _matchesFullAccount = (text: string | null | undefined): boolean => {
        if (!text) return false;
        for (const c of this.autoCheckService.parseAllCredentials(text)) {
          const email = c.email.toLowerCase().trim();
          if (!email) continue;
          const prefix = email.split("@")[0] || email;
          if (_q === email || _q === prefix || _q.includes(email)) return true;
        }
        return false;
      };
      for (const o of candidates) {
        if (_matchesFullAccount(o.deliveredAccountText)) { order = o; break; }
        const repl = await this.prisma.warrantyClaim.findMany({
          where: {
            orderId: o.id,
            status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
            deliveredAccountText: { not: null },
          },
          select: { deliveredAccountText: true },
        });
        if (repl.some((r) => _matchesFullAccount(r.deliveredAccountText))) { order = o; break; }
      }
    }

    if (!order) {
      return {
        eligible: false,
        status: "not_found",
        message: language === "en"
          ? "We could not find a delivered order matching this order code / account in your account."
          : language === "th" ? "ไม่พบคำสั่งซื้อที่จัดส่งแล้วซึ่งตรงกับรหัสคำสั่งซื้อ/บัญชีนี้ในบัญชีของคุณ"
          : "Không tìm thấy đơn đã giao nào khớp mã đơn / email tài khoản này trong tài khoản của bạn.",
      };
    }

    if (order.seller?.tier === SellerTier.PRO) {
      const linked = await this.findLinkedInternalSourceOrder(order.orderCode, input.shopId);
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
      const activeClaim = order.warrantyClaims[0]!;
      const meta = activeClaim.metadataJson && typeof activeClaim.metadataJson === "object" && !Array.isArray(activeClaim.metadataJson)
        ? (activeClaim.metadataJson as Record<string, unknown>)
        : {};
      const isSoftFailed = activeClaim.status === WARRANTY_CLAIM_STATUS.PENDING && meta.autoCheckSoftFailed === true;
      if (!isSoftFailed) {
        return {
          eligible: false,
          status: "already_open",
          message: language === "en"
            ? "A warranty claim for this order is already being processed."
            : language === "th" ? "คำสั่งซื้อนี้มีคำขอรับประกันที่กำลังดำเนินการอยู่แล้ว"
            : "Đơn này đã có một yêu cầu bảo hành đang được xử lý.",
        };
      }
      // Soft-failed claim: allow customer to retry. Check if it was a wrong_password result
      // so the bot can skip the Y/N prompt and go straight to password input.
      const autoResult = activeClaim.autoCheckResult && typeof activeClaim.autoCheckResult === "object" && !Array.isArray(activeClaim.autoCheckResult)
        ? (activeClaim.autoCheckResult as Record<string, unknown>)
        : null;
      const softFailErrorType = autoResult ? String(autoResult.errorType || "") : "";
      const _accView = await this.buildCurrentAccountView(order.id, order.deliveredAccountText);
      return {
        eligible: true,
        orderCode: order.orderCode, // resolved real code (input may have been an account, not a code)
        accounts: _accView.active, // current accounts (replacements swapped in, dead originals dropped)
        issuedReplacements: _accView.issuedReplacements,
        replacedAccounts: _accView.replacedOriginals,
        wrongPasswordRetry: softFailErrorType === "wrong_password",
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

    const _accView = await this.buildCurrentAccountView(order.id, order.deliveredAccountText);
    return {
      eligible: true,
      orderCode: order.orderCode, // resolved real code (input may have been an account, not a code)
      accounts: _accView.active, // current accounts (replacements swapped in, dead originals dropped)
      issuedReplacements: _accView.issuedReplacements,
      replacedAccounts: _accView.replacedOriginals,
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
      // Valid usernames = original delivery + every replacement issued via prior claims.
      // Customer may be warrantying the replacement account they just received, so we can't
      // limit validation to the original delivered text.
      const validUsernameSet = await this.collectValidOrderUsernames(order.id, order.deliveredAccountText);
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
      // Dedupe + clamp to order.quantity so duplicate entries can't farm extra replacements.
      quantityOverride = Math.min(
        order.quantity,
        new Set(input.targetUsernames.map((u) => normalize(u)).filter(Boolean)).size,
      ) || undefined;
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

    // The account being validated (baseCreds) must be one of the ORIGINAL delivered accounts.
    // If it isn't, it's a warranty-ISSUED replacement (A2/A3…) — auto-issuing yet another
    // replacement here is the unbounded replacement-chain abuse (cap+cooldown key on the rotated
    // email so they never trip). Route to manual review so the seller decides. EXACT membership
    // (no parseFirstCredential single-cred fallback, which always returned creds[0] on a 1-account
    // order and made this guard never fire). Runs whenever baseCreds resolved, target or not.
    if (baseCreds) {
      const isOriginalAccount = this.autoCheckService.isOriginalDeliveredEmail(
        order.deliveredAccountText,
        baseCreds.email,
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

    // Batch-lifetime bypass — seller's declared lifetime expired → synthetic isDead result,
    // applyAutoCheckResult fires inline so the customer gets the replacement instantly
    // instead of waiting 25-60s for the tool to confirm what the seller already knows.
    const _telegramBatchBypass = autoCheckTool
      ? await this.computeBatchExpiryBypass(order, sourceProductForAutoCheck, autoCheckTool, activeAccountText)
      : null;

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
          ...(_telegramBatchBypass
            ? {
                syntheticBypass: {
                  errorType: _telegramBatchBypass.errorType,
                  note: _telegramBatchBypass.note,
                  accountEmails: allCreds.map((c) => c.email),
                },
              }
            : {}),
        });

      // Batch-lifetime bypass message — customer sees a clear "lô đã hết hạn" reason instead
      // of generic "đang kiểm tra". Replacement flow runs in background via applyAutoCheckResult.
      const batchBypassMessage = _telegramBatchBypass
        ? (lang === "en"
            ? `This batch has reached its declared lifetime (delivered ${order.deliveredAt?.toLocaleDateString("en-GB")}, batch lifetime ${_telegramBatchBypass?.days} days). Issuing your replacement now…`
            : lang === "th"
              ? `บัญชีในล็อตนี้หมดอายุตามที่ผู้ขายประกาศแล้ว กำลังส่งบัญชีทดแทนให้คุณ…`
              : `Lô tài khoản này đã hết hạn theo lịch shop công bố (giao ${order.deliveredAt?.toLocaleDateString("vi-VN")}, hạn ${_telegramBatchBypass?.days} ngày). Đang cấp tài khoản thay thế...`)
        : null;

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

      const customerMessage = batchBypassMessage ?? (enq.enqueued ? queuedMessage : overloadedMessage);

      return {
        success: false,
        status: _telegramBatchBypass ? "auto_resolved_pending" : "auto_check_pending",
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
          status: _telegramBatchBypass ? "completed" : (enq.enqueued ? "queued" : "overloaded"),
          queuePosition: enq.queuePosition,
          queueLoad: enq.queueLoad,
        },
      };
    }

    // Route to manual review when the family is unsupported OR the auto-check could not run because
    // credentials are unparseable — never fall through to decideClaimRoute and auto-issue a
    // replacement with NO death verdict (mirror the openClaim + public paths). The enqueue gate
    // above requires `creds`, so reaching here with `!creds` means no tool verified the account.
    if (!isSupportedFamily || !creds) {
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
            resolutionNote: !isSupportedFamily
              ? "Product family not yet supported by auto-check."
              : "Auto-check could not run (account credentials unparseable) — manual review required.",
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
      if (decision.stockEntryReplacement) {
        const okSE = await this.commitStockEntryReplacement(tx, decision.stockEntryReplacement, order.id, order.customerId);
        if (!okSE) {
          throw new BadRequestException("Kho vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
      }
      if (decision.manualStockUpdate) {
        // CROSS-CLAIM STOCK RACE: remainingEntries was sliced from a snapshot read OUTSIDE this tx.
        // Lock the product row + re-validate `available` against the snapshot; if a concurrent claim
        // already cut stock, abort (rollback) instead of overwriting with a stale list → no double-spend.
        await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${order.sourceProductId} FOR UPDATE`;
        const _freshSP = await tx.sourceProduct.findUnique({ where: { id: order.sourceProductId }, select: { available: true } });
        if (!_freshSP || _freshSP.available !== decision.manualStockUpdate.expectedAvailableBefore) {
          throw new BadRequestException("Kho vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
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
        // #3: retire the issued accounts from the stock_entries pool too, so a legacy-metadata
        // fallback replacement can't stay AVAILABLE and be re-sold to a later buyer (no-op when the
        // product has no matching stock_entries — pure-legacy products keep the available above).
        await this.consumeMatchingStockEntries(tx, order.sourceProductId, decision.deliveredAccountText, order.id, order.customerId);
      }

      if (decision.internalSourceStockUpdate) {
        const { sourceProductId, remainingEntries, expectedAvailableBefore } = decision.internalSourceStockUpdate;
        await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${sourceProductId} FOR UPDATE`;
        const proProduct = await tx.sourceProduct.findUnique({
          where: { id: sourceProductId },
          select: { metadataJson: true, available: true },
        });
        if (!proProduct || proProduct.available !== expectedAvailableBefore) {
          throw new BadRequestException("Kho nguồn vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
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
        // Finding G: retire the issued accounts from the UPSTREAM product's stock_entries too, so a
        // legacy-metadata fallback on the ULTRA source can't leave them AVAILABLE and re-sellable.
        await this.consumeMatchingStockEntries(tx, sourceProductId, decision.deliveredAccountText, order.id, order.customerId);
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
            ? (decision.stockEntryReplacement ? decision.stockEntryReplacement.totalCost : replacementCostSource)
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

  /**
   * Ownership gate for the public warranty flow. `stored` is the per-order warrantyClaimCode
   * shown to the buyer at delivery; `provided` is what the claimant typed on the web form.
   * - stored is null/empty (legacy orders predating the feature) → allow (back-compat).
   * - stored present → require an exact, length-safe, timing-safe match.
   * Case-insensitive + trimmed because the code is human-typed off a Telegram message.
   */
  private claimCodeMatches(provided: string | undefined | null, stored: string | null | undefined): boolean {
    if (!stored) return true; // legacy order: no code on file → no ownership check possible
    const a = Buffer.from(String(provided ?? "").trim().toUpperCase(), "utf8");
    const b = Buffer.from(String(stored).trim().toUpperCase(), "utf8");
    if (a.length !== b.length) return false; // timingSafeEqual requires equal length
    return timingSafeEqual(a, b);
  }

  async publicSearchOrders(dto: PublicWarrantySearchDto, clientIp?: string | null) {
    // Anti-enumeration: a scanner guessing order codes piles up empty lookups → gets locked out
    // (iPhone-style escalating block). Legit customers hit their real order on the first try.
    await this.abuse.assertNotBlocked(clientIp);

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
    // Two lookup modes:
    //  - ORDER-CODE (input starts with the order-code prefix): the reseller who owns the order
    //    enters its code → return the FULL invoice + every account (they pick which to warranty).
    //  - ACCOUNT (default): a retail end-customer enters the account they're using → return ONLY
    //    that account, and DON'T reveal the order code (one order may have been split across
    //    several different retail customers, so each only sees/warranties their own account).
    const isOrderCodeSearch = /^ORD-[0-9]/i.test(accountText);
    const orders = await this.prisma.order.findMany({
      where: {
        shopId: shop.id,
        status: OrderStatus.DELIVERED,
        ...(isOrderCodeSearch
          ? { orderCode: { equals: accountText, mode: "insensitive" } }
          : {
              // also match orders whose latest replacement contains the queried account
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
            }),
      },
      include: { sourceProduct: { select: { imageUrl: true, productIcon: true, iconCustomEmojiId: true } } },
      orderBy: { deliveredAt: "desc" },
      take: isOrderCodeSearch ? 1 : 5,
    });

    // #21 anti-harvest: the DB query above uses a loose `contains` (good for indexing), but a
    // 3-char fragment like "@gmail.com" or "abc" would otherwise match — and leak — every order's
    // account list. Require the query to correspond to a FULL account token the searcher already
    // knows: a complete email, the complete username-before-@, or a longer string that CONTAINS
    // the full email (e.g. "user@x.com:password"). A strict substring of an email never matches.
    const _q = accountText.toLowerCase();
    const _matchesFullAccount = (text: string | null | undefined): boolean => {
      if (!text) return false;
      for (const c of this.autoCheckService.parseAllCredentials(text)) {
        const email = c.email.toLowerCase().trim();
        if (!email) continue;
        const prefix = email.split("@")[0] || email;
        if (_q === email || _q === prefix || _q.includes(email)) return true;
      }
      return false;
    };

    const results = [];
    for (const order of orders) {
      // ORDER-CODE mode: the exact code already proves which order → no per-account token gate.
      // ACCOUNT mode: the query must be a FULL account token in the original delivery OR in a
      // resolved replacement for this order — otherwise it's a fragment match → skip (no enumeration).
      if (!isOrderCodeSearch) {
        let _orderTokenMatch = _matchesFullAccount(order.deliveredAccountText);
        if (!_orderTokenMatch) {
          const _replResolved = await this.prisma.warrantyClaim.findMany({
            where: {
              orderId: order.id,
              status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
              deliveredAccountText: { not: null },
            },
            select: { deliveredAccountText: true },
          });
          _orderTokenMatch = _replResolved.some((r) => _matchesFullAccount(r.deliveredAccountText));
        }
        if (!_orderTokenMatch) continue;
      }

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
      const _allOriginalCreds = this.autoCheckService.parseAllCredentials(order.deliveredAccountText);
      const _allOriginalUsernames = _allOriginalCreds.map((c) => c.email).filter(Boolean);
      const _stillValidUsernames = this.autoCheckService
        .filterOutReplaced(_allOriginalCreds, _searchReplacedSet)
        .map((c) => c.email)
        .filter(Boolean);
      // Original accounts already replaced by a prior warranty → returned so the UI can SHOW them
      // greyed-out/disabled (instead of hiding them), so the customer sees the full history.
      const _isReplacedUsername = (e: string) => {
        const em = e.toLowerCase().trim();
        const local = em.split("@")[0];
        return _searchReplacedSet.has(em) || (!!local && _searchReplacedSet.has(local));
      };
      const replacedUsernames = _allOriginalUsernames.filter(_isReplacedUsername);
      // ORDER-CODE mode: show ALL original accounts (replaced ones greyed via replacedUsernames).
      // ACCOUNT mode: scope to ONLY the searched account (retail customer warranties just their own).
      const accountUsernames = isOrderCodeSearch
        ? _allOriginalUsernames
        : (() => {
            const m = _stillValidUsernames.filter((e) => {
              const em = e.toLowerCase();
              return em === _q || (em.split("@")[0] || em) === _q || _q.includes(em);
            });
            return m.length > 0 ? m : [accountText];
          })();

      const _prodIcon = order.sourceProduct?.imageUrl || order.sourceProduct?.productIcon || null;

      // Already-issued replacement account(s), surfaced so a customer who didn't copy their
      // replacement in time can re-copy it by searching again. Proof of ownership = knowing the
      // account / order code (same as the rest of this public flow). Scoped: account mode → only
      // the replacement(s) tied to the searched account; order mode → all the order's replacements.
      const _resolvedClaims = await this.prisma.warrantyClaim.findMany({
        where: {
          orderId: order.id,
          status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
          deliveredAccountText: { not: null },
        },
        orderBy: { resolvedAt: "asc" },
        select: { deliveredAccountText: true, targetAccountEmail: true, resolvedAt: true },
      });
      const _qBare = _q.split("@")[0] || _q;
      const resolvedAccounts = Array.from(
        new Set(
          _resolvedClaims
            .filter((c) => {
              if (isOrderCodeSearch) return true;
              const tgt = (c.targetAccountEmail || "").toLowerCase();
              const tgtBare = tgt.split("@")[0] || tgt;
              const dat = (c.deliveredAccountText || "").toLowerCase();
              // replacement issued FOR the searched account, OR the customer searched the
              // replacement text itself (re-copy the account they currently hold).
              return tgt === _q || tgtBare === _qBare || dat.includes(_q);
            })
            .map((c) => (c.deliveredAccountText || "").trim())
            .filter(Boolean),
        ),
      );

      results.push({
        orderId: order.id,
        // Hide the order code from retail (account) searchers — they only know/need their own account.
        orderCode: isOrderCodeSearch ? order.orderCode : null,
        searchMode: isOrderCodeSearch ? "order" : "account",
        productName: order.productNameSnapshot,
        productImageUrl: _prodIcon,
        deliveredAt: order.deliveredAt,
        warrantyExpiresAt: snapshot.warrantyExpiresAt,
        warrantyPolicy: snapshot.warrantyPolicySnapshot?.toLowerCase(),
        hasActiveClaim,
        previousReplacement,
        accountUsernames,
        // Original accounts already warrantied (replaced) → UI shows them greyed/disabled.
        replacedUsernames: isOrderCodeSearch ? replacedUsernames : [],
        // Full replacement credentials already issued (for re-copy). May be empty.
        resolvedAccounts,
      });
    }

    // Feed the abuse guard: empty result = a guess/typo (counts toward lockout); a hit clears
    // the IP's miss streak (a real customer who found their order is not an enumerator).
    if (results.length === 0) {
      await this.abuse.recordMiss(clientIp);
    } else {
      await this.abuse.recordHit(clientIp);
    }

    return {
      shop: { name: shop.name, supportTelegram: shop.supportTelegram, supportZalo: shop.supportZalo },
      orders: results,
    };
  }

  // Build a "warranty invoice" payload for the public-facing UI: the static order
  // info + a live count of resolved claims. Shown on the web result step so the
  // customer sees a professional receipt of what they bought + warranty state.
  // #1: strip secrets from an invoice before returning it in an UNAUTHENTICATED submit response.
  // buildPublicInvoice carries the ORIGINAL delivered account (creds) + buyer PII; the token-gated
  // status endpoint sanitizes these, but the submit body has no token, so null them here. The client
  // gets credentials only via the token-gated poll.
  private stripInvoiceSecretsForSubmit(
    inv: Awaited<ReturnType<WarrantyService["buildPublicInvoice"]>>,
    accountScoped = false,
  ) {
    if (!inv) return inv;
    const base = { ...inv, deliveredAccountText: null, buyerUsername: null, buyerName: null, buyerTelegramId: null };
    // Account-scoped (retail customer warranting their own account on a possibly-split order):
    // also hide the order code + economics — they only need product + warranty status. Matches the
    // scoping the token-gated status poll applies.
    if (accountScoped) {
      return { ...base, orderCode: null, quantity: null, totalSaleAmount: null, resolvedAccountCount: null, resolvedClaimCount: null };
    }
    return base;
  }

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
          select: { id: true, metadataJson: true },
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
      // Number of ACCOUNTS resolved (refunded/replaced), not claims — a single multi-account
      // claim covers many accounts. Matches the "/quantity" denominator the UI shows.
      resolvedAccountCount: countResolvedWarrantyAccounts(order.warrantyClaims, order.quantity),
    };
  }

  async publicSubmitClaim(dto: PublicWarrantyClaimDto, clientIp?: string | null) {
    // Block a flagged enumerator before doing any work (same lockout as search).
    await this.abuse.assertNotBlocked(clientIp);
    // Idempotency: cùng (shopSlug, idempotencyKey) trong 10 phút → trả lại response cũ
    // thay vì tạo claim mới. Bảo vệ khỏi double-click / mạng retry POST / back-forward.
    // Scope theo shopSlug + orderId để 2 shop / 2 đơn khác nhau không đụng key. orderId trong key
    // ngăn replay một response thành công đã cache sang đơn khác (sẽ bỏ qua cổng kiểm mã bảo hành
    // chạy bên trong fn). Không có key → run thẳng (backward-compat cho client cũ chưa gửi).
    const cacheKey = dto.idempotencyKey
      ? `warranty:claim:${dto.shopSlug}:${dto.orderId}:${dto.idempotencyKey}`
      : null;
    return this.idempotency.runOnce(cacheKey, () => this._publicSubmitClaimImpl(dto, clientIp));
  }

  private async _publicSubmitClaimImpl(dto: PublicWarrantyClaimDto, clientIp?: string | null) {
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
      // Submitting against a non-existent order id = probing → counts toward lockout.
      await this.abuse.recordMiss(clientIp);
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

    // Validate targetUsernames: mỗi username phải thuộc đơn — tính cả tài khoản gốc
    // VÀ mọi tài khoản thay thế đã cấp qua bảo hành trước. Không có vế thứ 2 thì customer
    // sau khi nhận replacement không thể bảo hành chính replacement đó (báo "không thuộc đơn").
    if (dto.targetUsernames && dto.targetUsernames.length > 0) {
      const validSet = await this.collectValidOrderUsernames(order.id, order.deliveredAccountText);
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

    // Replacement-chain guard (EXACT membership): the account being validated must be one of the
    // ORIGINAL delivered accounts. A warranty-ISSUED replacement (A2/A3…) is never in the original
    // set → route to manual review instead of auto-issuing yet another replacement (unbounded
    // chain abuse — cap+cooldown key on the rotated email so they never trip). Mirrors the Telegram
    // path; uses isOriginalDeliveredEmail (no parseFirstCredential single-cred fallback).
    if (_autoCheckBaseCreds && !this.autoCheckService.isOriginalDeliveredEmail(order.deliveredAccountText, _autoCheckBaseCreds.email)) {
      throw new BadRequestException(
        "Tài khoản này được cấp qua bảo hành. Nếu vẫn gặp sự cố, vui lòng liên hệ shop trực tiếp hoặc gửi yêu cầu bảo hành thủ công.",
      );
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

    // Batch-lifetime bypass — see computeBatchLifetimeBypass for rationale. Same pattern as
    // the seller-admin and Telegram bot paths so the 3 entry points behave consistently.
    const _publicBatchBypass = _autoCheckTool
      ? await this.computeBatchExpiryBypass(order, _autoCheckSourceProduct, _autoCheckTool, _autoCheckActiveAccText)
      : null;

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
            // Lưu SĐT/contact khách tự nhập từ web vào metadata → claimIdentityLines hiện
            // "📞 Liên hệ: <contact>" trong thông báo bot cho seller. THIẾU dòng này nên web
            // auto-check (grok/veo) trước đây rơi về telegram handle, không thấy SĐT web.
            contactInfo: dto.contactInfo,
            source: "web",
            ...(_autoCheckOverridePwd ? { customerProvidedNewPassword: true } : {}),
            ...(dto.targetUsernames?.length ? { targetUsernames: dto.targetUsernames } : {}),
          },
          maxClaims: PUBLIC_MAX_CLAIMS,
          targetEmail: _blockTargetEmail,
          cooldownDays: cooldownConfig.cooldownDays,
          ...(_publicBatchBypass
            ? {
                syntheticBypass: {
                  errorType: _publicBatchBypass.errorType,
                  note: _publicBatchBypass.note,
                  accountEmails: _autoCheckAllCreds.map((c) => c.email),
                },
              }
            : {}),
        });
      return {
        success: false,
        status: _publicBatchBypass ? "auto_resolved_pending" : "auto_check_pending",
        claimId: _queuedClaim.id,
        claimNumber: _queuedClaim.claimNumber,
        accessToken: _qToken,
        message: _publicBatchBypass
          ? `Lô tài khoản này đã hết hạn theo lịch shop công bố (giao ${order.deliveredAt?.toLocaleDateString("vi-VN")}, hạn ${_publicBatchBypass?.days} ngày). Đang cấp tài khoản thay thế...`
          : _enq.enqueued
            ? `Hệ thống đang kiểm tra tài khoản tự động${_enq.queuePosition ? ` (vị trí xếp hàng #${_enq.queuePosition})` : ""}. Vui lòng chờ trong giây lát.`
            : "Hệ thống hiện đang quá tải kiểm tra tài khoản. Yêu cầu của bạn đã được tạo, shop sẽ xem xét thủ công trong ít phút tới.",
        deliveredAccountText: null,
        orderCode: order.orderCode,
        supportTelegram: order.shop.supportTelegram,
        supportZalo: order.shop.supportZalo,
        previousReplacement,
        autoCheck: {
          tool: _autoCheckTool,
          status: _publicBatchBypass ? "completed" : (_enq.enqueued ? "queued" : "overloaded"),
          queuePosition: _enq.queuePosition,
          queueLoad: _enq.queueLoad,
        },
        invoice: this.stripInvoiceSecretsForSubmit(await this.buildPublicInvoice(order.id), !!(dto.targetUsernames && dto.targetUsernames.length > 0)),
      };
    }

    const claimNumber = order.warrantyClaimCount + 1;
    // Dedupe + clamp the replacement quantity so duplicate / extra targetUsernames can't farm more
    // replacements than the order holds.
    const _publicQtyOverride = dto.targetUsernames?.length
      ? Math.min(
          order.quantity,
          new Set(dto.targetUsernames.map((u) => String(u).toLowerCase().trim()).filter(Boolean)).size,
        ) || undefined
      : undefined;
    // Cooldown is hard-rejected above, so we never reach here with cooldownBlocker set.
    // Route to manual review when the family is unsupported OR auto-check could not run (creds
    // unparseable) — never auto-issue a replacement without a death verdict (see openClaim path).
    const decision: ClaimDecision = (!_autoCheckIsSupported || !_autoCheckCreds)
      ? {
          nextStatus: WARRANTY_CLAIM_STATUS.PENDING_REVIEW,
          deliveredAccountText: null,
          resolutionNote: !_autoCheckIsSupported
            ? "Product family not yet supported by auto-check."
            : "Auto-check could not run (account credentials unparseable) — manual review required.",
          ownerAttentionRequired: true,
          customerMessage: !_autoCheckIsSupported
            ? "Loại sản phẩm này chưa hỗ trợ kiểm tra bảo hành tự động. Yêu cầu của bạn đã được chuyển cho shop/admin xem xét thủ công."
            : "Hệ thống chưa thể kiểm tra tự động yêu cầu này. Yêu cầu bảo hành đã được chuyển cho admin xem xét.",
        }
      : internalSourceOrder
        ? await this.decideInternalSourceClaimRoute(internalSourceOrder, claimNumber, "vi", _publicQtyOverride)
        : await this.decideClaimRoute(order, claimNumber, "vi", _publicQtyOverride);

    // Prefer the order's sourcePriceSnapshot (the cost recorded at delivery) so accounting
    // stays consistent with the original purchase even if catalog sourcePrice has drifted
    // between order time and warranty time. Fall back to current sourcePrice only when the
    // snapshot is missing (legacy/unmigrated rows).
    const replacementCostSource = decimalToNumber(order.sourcePriceSnapshot)
      || decimalToNumber(internalSourceOrder?.sourceProduct.sourcePrice ?? order.sourceProduct.sourcePrice);

    // #1: mint an access token so the synchronous AUTO_RESOLVED path can hand back ONLY the token
    // (not the live replacement credentials) — the client fetches the account via the token-gated
    // status endpoint, same as the async path. Keeps creds out of the unauthenticated submit body.
    const { token: _syncAccessToken, hash: _syncAccessTokenHash } = this.autoCheckService.generateAccessToken();
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
      if (decision.stockEntryReplacement) {
        const okSE = await this.commitStockEntryReplacement(tx, decision.stockEntryReplacement, order.id, order.customerId);
        if (!okSE) {
          throw new BadRequestException("Kho vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
      }
      if (decision.manualStockUpdate) {
        // CROSS-CLAIM STOCK RACE: lock + re-validate available before cutting (see openClaim path).
        await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${order.sourceProductId} FOR UPDATE`;
        const _freshSP = await tx.sourceProduct.findUnique({ where: { id: order.sourceProductId }, select: { available: true } });
        if (!_freshSP || _freshSP.available !== decision.manualStockUpdate.expectedAvailableBefore) {
          throw new BadRequestException("Kho vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
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
        // #3: retire the issued accounts from the stock_entries pool too (no-op if none match)
        // so a legacy-metadata fallback replacement can't stay AVAILABLE and be re-sold.
        await this.consumeMatchingStockEntries(tx, order.sourceProductId, decision.deliveredAccountText, order.id, order.customerId);
      }

      if (decision.internalSourceStockUpdate) {
        const { sourceProductId, remainingEntries, expectedAvailableBefore } = decision.internalSourceStockUpdate;
        await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${sourceProductId} FOR UPDATE`;
        const proProduct = await tx.sourceProduct.findUnique({
          where: { id: sourceProductId },
          select: { metadataJson: true, available: true },
        });
        if (!proProduct || proProduct.available !== expectedAvailableBefore) {
          throw new BadRequestException("Kho nguồn vừa thay đổi trong lúc xử lý — vui lòng gửi lại yêu cầu bảo hành.");
        }
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
        // Finding G: retire the issued accounts from the UPSTREAM product's stock_entries too, so a
        // legacy-metadata fallback on the ULTRA source can't leave them AVAILABLE and re-sellable.
        await this.consumeMatchingStockEntries(tx, sourceProductId, decision.deliveredAccountText, order.id, order.customerId);
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
            ? (decision.stockEntryReplacement ? decision.stockEntryReplacement.totalCost : replacementCostSource)
            : null,
          targetAccountEmail: _blockTargetEmail ? _blockTargetEmail.toLowerCase() : null,
          metadataJson: {
            ownerAttentionRequired: decision.ownerAttentionRequired,
            contactInfo: dto.contactInfo,
            source: "web",
            accessTokenHash: _syncAccessTokenHash, // #1: gate credential retrieval via the status endpoint
            // Stamp the claimed usernames so the cooldown / double-dip guard (findCooldownBlocker +
            // the in-tx re-check) can match EVERY account on a multi-account claim, not just the
            // single targetAccountEmail column — otherwise accounts 2..N could be re-claimed freely.
            ...(dto.targetUsernames?.length ? { targetUsernames: dto.targetUsernames } : {}),
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

    // Always tell the seller a NEW WEB warranty came in, WITH the buyer's typed contact — not only
    // when ownerAttentionRequired. A web claim carries NO Telegram identity, so this typed contact
    // is the ONLY way the seller knows who is claiming; without this, auto-checked / auto-resolved
    // web claims reached the seller with no contact (or no notification at all).
    await this.notifyOwnerAboutClaim({
      shopId: order.shopId,
      orderCode: order.orderCode,
      productName: order.productNameSnapshot,
      claimNumber,
      status: decision.nextStatus,
      customerLabel: dto.contactInfo,
      customerMessage: dto.customerMessage,
    });

    if (decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED && decision.partialRefundCount) {
      await this.applyPartialStockRefund(order, createdClaim.id, decision.partialRefundCount);
    }

    // #1: when this resolved with a replacement, DON'T return the credentials here. Signal the client
    // (status=auto_check_pending) to fetch the account via the token-gated status endpoint using the
    // accessToken below — exactly the async-path model. Non-credential outcomes (PENDING_REVIEW) keep
    // their real status. deliveredAccountText is always null in the submit body now.
    const _resolvedWithCreds =
      decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED && !!decision.deliveredAccountText;
    return {
      success: decision.nextStatus === WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
      status: _resolvedWithCreds ? "auto_check_pending" : decision.nextStatus.toLowerCase(),
      claimId: createdClaim.id,
      accessToken: _syncAccessToken,
      orderCode: order.orderCode,
      deliveredAccountText: null,
      message: decision.customerMessage,
      supportTelegram: order.shop.supportTelegram,
      supportZalo: order.shop.supportZalo,
      invoice: this.stripInvoiceSecretsForSubmit(await this.buildPublicInvoice(order.id), !!(dto.targetUsernames && dto.targetUsernames.length > 0)),
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
      // HỆ KHO MỚI (StockBatch/StockEntry): ưu tiên cấp acc thay từ đây để lấy ĐÚNG giá vốn
      // theo từng lô (cùng 1 SP nhiều lô giá vốn khác nhau). Chỉ fallback xuống kho text cũ
      // khi SP chưa có StockEntry nào (hàng nhập kiểu cũ). Chỉ xử lý đủ-hàng (>= qty) ở đây;
      // thiếu hàng để fallback/hoàn tiền theo logic text bên dưới.
      const _fallbackUnitCost =
        decimalToNumber(order.sourcePriceSnapshot) || decimalToNumber(order.sourceProduct?.sourcePrice) || 0;
      const seReplacement = await this.pickReplacementStockEntries(order.sourceProductId, qty, _fallbackUnitCost);
      if (seReplacement) {
        return {
          nextStatus: WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
          deliveredAccountText: seReplacement.entries.join("\n\n"),
          resolutionNote: "Replacement stock delivered automatically from batch inventory.",
          ownerAttentionRequired: false,
          customerMessage:
            language === "en"
              ? "Warranty approved. The replacement account is ready below."
              : language === "th" ? "อนุมัติการรับประกันแล้ว บัญชีทดแทนพร้อมด้านล่าง"
              : "Bảo hành đã được duyệt. Tài khoản thay thế đã sẵn sàng ở bên dưới.",
          stockEntryReplacement: {
            entryIds: seReplacement.entryIds,
            totalCost: seReplacement.totalCost,
            sourceProductId: order.sourceProductId,
            expectedAvailableBefore: seReplacement.availableBefore,
          },
        };
      }

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
            expectedAvailableBefore: deliveryEntries.length,
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
          manualStockUpdate: { remainingEntries: [], expectedAvailableBefore: deliveryEntries.length },
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

    if (!shop?.botConfig?.telegramBotTokenEncrypted) {
      return;
    }

    // Fall back to the owner's own bot chat (ownerTelegramUserId) when no support handle is set —
    // otherwise a shop without supportTelegram never learns a manual/review claim is waiting.
    const chatId = String(shop.supportTelegram || shop.botConfig.ownerTelegramUserId || "").trim();
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
        `📞 Liên hệ khách: ${input.customerLabel}`,
        input.customerMessage ? `Vấn đề: ${input.customerMessage}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch((e) => this.logger.warn(`Telegram notification failed: ${e?.message ?? e}`));
  }

  /**
   * Tell the shop owner (supportTelegram chat) that a warranty just FINISHED — replacement issued,
   * refunded, or escalated to manual review — WITH the account + the customer's contact, so the
   * seller can follow up / re-warranty a lẻ account without digging through the dashboard.
   * Self-contained (fetches the shop itself) so it works regardless of the caller's claim include.
   * Best-effort; never throws into the customer flow. Replaces the old generic
   * "Có yêu cầu bảo hành mới" notify at the refund + escalation points (so no double-notify).
   */
  private async notifySellerWarrantyResult(
    claim: {
      shopId: string;
      orderCodeSnapshot: string;
      productNameSnapshot: string;
      claimNumber: number;
      targetAccountEmail?: string | null;
      metadataJson?: Prisma.JsonValue | null;
      customer?: { telegramUsername?: string | null; firstName?: string | null; telegramChatId?: string | null } | null;
    },
    outcome: "resolved" | "failed" | "refunded" | "review",
    detail?: string | null,
  ): Promise<void> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { id: claim.shopId },
        include: { botConfig: true },
      });
      if (!shop?.botConfig?.telegramBotTokenEncrypted) return;
      const token = decryptSecret(shop.botConfig.telegramBotTokenEncrypted, this.config.encryptionKey);
      // Fall back to the owner's own bot chat when no support handle is configured.
      const chatId = String(shop.supportTelegram || shop.botConfig.ownerTelegramUserId || "").trim();
      if (!token || !chatId || (this.config.mockTelegramEnabled && isMockBotToken(token))) return;
      const header =
        outcome === "resolved" ? "✅ Bảo hành XONG — đã cấp tài khoản thay thế"
        : outcome === "refunded" ? "💸 Bảo hành XONG — đã hoàn tiền vào ví khách"
        : outcome === "review" ? "⚠️ Bảo hành cần DUYỆT TAY (khách đã hết lượt tự kiểm)"
        : "❌ Bảo hành KHÔNG thành công";
      const text = [
        `🛡️ <b>${header}</b>`,
        `📝 Đơn: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`,
        `📦 ${this.escapeHtml(claim.productNameSnapshot)} · Claim #${claim.claimNumber}`,
        ...this.claimIdentityLines(claim as any),
        detail ? this.escapeHtml(detail) : null,
      ].filter(Boolean).join("\n");
      await telegramSendMessage(token, chatId, text, { parse_mode: "HTML" })
        .catch((e) => this.logger.warn(`Seller warranty-result notify failed: ${e?.message ?? e}`));
    } catch (e: any) {
      this.logger.warn(`notifySellerWarrantyResult error: ${e?.message ?? e}`);
    }
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
    if (!token || !claim.customer?.telegramChatId || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      return;
    }
    const _acctScoped = !!(claim as any).targetAccountEmail;
    const _l = String(claim.customer?.preferredLanguage || "").toLowerCase();
    const lang: "vi" | "en" | "th" = _l === "en" ? "en" : _l === "th" ? "th" : "vi";
    const orderLabel = lang === "en" ? "Order" : lang === "th" ? "รหัสคำสั่งซื้อ" : "Mã đơn";
    const productLabel = lang === "en" ? "Product" : lang === "th" ? "สินค้า" : "Sản phẩm";
    const invoice = await this.buildClaimInvoiceMessage(claim.orderId, _acctScoped).catch(() => null);
    const parts: (string | null)[] = [
      claim.deliveredAccountText
        ? (lang === "en" ? "✅ <b>Warranty approved — replacement account below</b>" : lang === "th" ? "✅ <b>อนุมัติการรับประกันแล้ว — บัญชีทดแทนด้านล่าง</b>" : "✅ <b>Bảo hành đã được duyệt — tài khoản thay thế bên dưới</b>")
        : (lang === "en" ? "✅ <b>Warranty processed</b>" : lang === "th" ? "✅ <b>ดำเนินการรับประกันแล้ว</b>" : "✅ <b>Bảo hành đã được xử lý</b>"),
      "",
      _acctScoped ? null : `📝 ${orderLabel}: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`,
      `📦 ${productLabel}: ${this.escapeHtml(claim.productNameSnapshot)}`,
      `🔢 Claim #${claim.claimNumber}`,
      ...this.claimIdentityLines(claim as any),
    ];
    if (claim.deliveredAccountText) {
      const replHdr = lang === "en" ? "🔑 <b>Replacement account:</b>" : lang === "th" ? "🔑 <b>บัญชีทดแทน:</b>" : "🔑 <b>Tài khoản thay thế:</b>";
      parts.push("", replHdr, `<pre>${this.escapeHtml(claim.deliveredAccountText)}</pre>`);
    } else {
      parts.push("", lang === "en" ? "The shop has processed your warranty request." : lang === "th" ? "ทางร้านดำเนินการคำขอรับประกันของคุณแล้ว" : "Shop đã xử lý yêu cầu bảo hành của bạn.");
    }
    if (claim.resolutionNote) {
      parts.push(`💬 ${this.escapeHtml(claim.resolutionNote)}`);
    }
    if (invoice) parts.push("", invoice);
    const text = parts.filter((s) => s !== null).join("\n").trimEnd();
    await this.deliverBotMessage(claim as any, token, text);
  }

  private formatStillPaidAccounts(accounts: any[]): string {
    return accounts
      .map((a) => {
        const emailUser = String(a.email || "").split("@")[0] ?? "";
        const masked = emailUser.length > 6 ? emailUser.slice(0, 6) + "***" : emailUser + "***";
        const tier = String(a.tier || a.plan || "");
        let expireStr = "";
        if (a.expires) {
          const d = new Date(a.expires);
          if (!isNaN(d.getTime())) {
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            expireStr = `${dd}/${mm}/${d.getFullYear()}`;
          }
        } else if (typeof a.daysRemaining === "number") {
          expireStr = `còn ${a.daysRemaining} ngày`;
        }
        return ["•", masked, tier, expireStr, "Còn hạn"].filter(Boolean).join(" | ");
      })
      .join("\n");
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
    accountDetails?: any[],
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

    const _acctScoped = !!(claim as any).targetAccountEmail;
    const _l = String(claim.customer?.preferredLanguage || "").toLowerCase();
    const lang: "vi" | "en" | "th" = _l === "en" ? "en" : _l === "th" ? "th" : "vi";
    const orderLabel = lang === "en" ? "Order" : lang === "th" ? "รหัสคำสั่งซื้อ" : "Mã đơn";
    const productLabel = lang === "en" ? "Product" : lang === "th" ? "สินค้า" : "Sản phẩm";
    const invoice = await this.buildClaimInvoiceMessage(claim.orderId, _acctScoped).catch(() => null);
    const parts: (string | null)[] = [
      lang === "en" ? "❌ <b>Warranty request rejected</b>" : lang === "th" ? "❌ <b>คำขอรับประกันถูกปฏิเสธ</b>" : "❌ <b>Yêu cầu bảo hành bị từ chối</b>",
      "",
      _acctScoped ? null : `📝 ${orderLabel}: <code>${this.escapeHtml(claim.orderCodeSnapshot)}</code>`,
      `📦 ${productLabel}: ${this.escapeHtml(claim.productNameSnapshot)}`,
      `🔢 Claim #${claim.claimNumber}`,
      ...this.claimIdentityLines(claim as any),
    ];
    if (reason) {
      const reasonLabel = lang === "en" ? "Reason" : lang === "th" ? "เหตุผล" : "Lý do";
      parts.push("", `💬 ${reasonLabel}: ${this.escapeHtml(reason)}`);
    }
    if (accountDetails?.length) {
      const detailHdr = lang === "en" ? "📊 <b>Account details:</b>" : lang === "th" ? "📊 <b>รายละเอียดบัญชี:</b>" : "📊 <b>Chi tiết tài khoản:</b>";
      parts.push("", detailHdr, this.escapeHtml(this.formatStillPaidAccounts(accountDetails)));
    }
    if (invoice) parts.push("", invoice);
    const text = parts.filter((s) => s !== null).join("\n").trimEnd();
    await this.deliverBotMessage(claim as any, token, text);
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
      // HỆ KHO MỚI của ULTRA upstream (StockBatch/StockEntry): ưu tiên rút acc thay từ đây để tìm
      // được hàng khi ULTRA nhập kho kiểu lô. Giá ghi vào claim của PRO = GIÁ SỈ PRO trả upstream
      // (sourceOrder.unitPrice), KHÔNG phải giá vốn lô của ULTRA. Fallback kho text cũ nếu chưa có lô.
      const seReplacement = await this.pickReplacementStockEntries(sourceOrder.sourceProductId, qty);
      if (seReplacement) {
        const proUnitCost =
          decimalToNumber(sourceOrder.unitPrice) || decimalToNumber(sourceOrder.sourcePriceSnapshot) || 0;
        return {
          nextStatus: WARRANTY_CLAIM_STATUS.AUTO_RESOLVED,
          deliveredAccountText: seReplacement.entries.join("\n\n"),
          resolutionNote: "Replacement from PRO source batch stock delivered automatically.",
          ownerAttentionRequired: false,
          customerMessage: language === "en"
            ? "Warranty approved. Your replacement account is ready."
            : language === "th" ? "อนุมัติการรับประกันแล้ว บัญชีทดแทนของคุณพร้อมแล้ว"
            : "Bảo hành đã được duyệt. Tài khoản thay thế đã sẵn sàng.",
          stockEntryReplacement: {
            entryIds: seReplacement.entryIds,
            totalCost: proUnitCost * seReplacement.entries.length,
            sourceProductId: sourceOrder.sourceProductId,
            expectedAvailableBefore: seReplacement.availableBefore,
          },
        };
      }

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
            expectedAvailableBefore: deliveryEntries.length,
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
            expectedAvailableBefore: deliveryEntries.length,
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

  /**
   * Current accounts the customer ACTUALLY holds for an order = original delivered accounts MINUS
   * the ones already replaced via a prior warranty, PLUS the replacement accounts that were issued.
   * So a re-warranty on a multi-account order shows the up-to-date set (the new replacement appears,
   * the dead original drops) instead of the stale original list. Also returns which originals were
   * replaced + the issued replacement accounts so the UI can show "đã bảo hành — TK mới: …".
   * Display string per account = its email (username) — matches the bot's `split("|")[0]` display.
   */
  private async buildCurrentAccountView(
    orderId: string,
    originalText: string | null | undefined,
  ): Promise<{ active: string[]; replacedOriginals: string[]; issuedReplacements: string[] }> {
    const replacedSet = await this.autoCheckService.getReplacedEmailSet(orderId);
    const originals = this.autoCheckService.parseAllCredentials(originalText ?? null);
    const stillValid = this.autoCheckService
      .filterOutReplaced(originals, replacedSet)
      .map((c) => c.email)
      .filter(Boolean);

    // Replacement accounts issued by prior resolved claims (oldest→newest).
    const resolved = await this.prisma.warrantyClaim.findMany({
      where: {
        orderId,
        status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
        deliveredAccountText: { not: null },
      },
      orderBy: { resolvedAt: "asc" },
      select: { deliveredAccountText: true },
    });
    const issuedReplacements: string[] = [];
    for (const c of resolved) {
      for (const cred of this.autoCheckService.parseAllCredentials(c.deliveredAccountText)) {
        if (cred.email && !issuedReplacements.includes(cred.email)) issuedReplacements.push(cred.email);
      }
    }

    // Active = still-valid originals + issued replacements, deduped (keep order).
    const seen = new Set<string>();
    const active: string[] = [];
    for (const e of [...stillValid, ...issuedReplacements]) {
      const k = e.toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      active.push(e);
    }
    // Replaced originals (those filtered out) — for the "đã bảo hành acc nào" note.
    const stillValidSet = new Set(stillValid.map((e) => e.toLowerCase().trim()));
    const replacedOriginals = originals
      .map((c) => c.email)
      .filter((e) => e && !stillValidSet.has(e.toLowerCase().trim()));

    // Fallback: if parsing yielded nothing (legacy format), keep the original display lines.
    return {
      active: active.length > 0 ? active : this.parseDeliveredAccounts(originalText),
      replacedOriginals,
      issuedReplacements,
    };
  }

  /**
   * Build the set of usernames valid for warranty submission on a given order. Includes:
   *   - Usernames from the order's original delivery (`order.deliveredAccountText`)
   *   - Usernames from every replacement issued via prior resolved claims
   *
   * Without the replacement set, a customer who already received a warranty replacement and
   * wants to warranty THAT replacement gets "Tài khoản không thuộc đơn hàng này" — because the
   * replacement's username isn't in the original delivered text. publicSearchOrders already
   * supports lookup-by-replacement (BUG-5); this mirror'd it for submission so customer can
   * warranty whatever account they're actually holding.
   */
  private async collectValidOrderUsernames(
    orderId: string,
    originalDeliveredAccountText: string | null | undefined,
  ): Promise<Set<string>> {
    const set = new Set<string>();
    // Use the SAME credential parser as publicSearchOrders (parseAllCredentials) so search and
    // submit agree on which accounts an order contains. The older parseDeliveredAccounts split on
    // DOUBLE newlines, but accounts are delivered ONE-PER-LINE (single newline) → it collapsed a
    // multi-account order to just the first account, so warranty-ing account #2+ was wrongly
    // rejected as "không thuộc đơn hàng này".
    const addFrom = (text: string | null | undefined) => {
      for (const c of this.autoCheckService.parseAllCredentials(text)) {
        const bare = (c.email || "").toLowerCase().trim().split("@")[0];
        if (bare) set.add(bare);
      }
    };
    addFrom(originalDeliveredAccountText);
    const replacementClaims = await this.prisma.warrantyClaim.findMany({
      where: {
        orderId,
        deliveredAccountText: { not: null },
        status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
      },
      select: { deliveredAccountText: true },
    });
    for (const c of replacementClaims) addFrom(c.deliveredAccountText);
    return set;
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

  // Đọc tồn kho theo HỆ MỚI (StockBatch/StockEntry) để cấp acc thay bảo hành.
  // FIFO: lô NULL (kho cũ) trước, rồi theo uploadedAt — KHỚP popManualStockEntries của worker.
  // Bỏ qua lô hết hạn / đã xoá mềm. Trả snapshot (entryIds + text + Σ giá vốn lô) cho decision;
  // apply sẽ re-validate các entryIds còn AVAILABLE dưới lock rồi mới mark SOLD.
  private async pickReplacementStockEntries(
    sourceProductId: string,
    qty: number,
    fallbackUnitCost = 0, // COGS for entries with no batch (batchId/costPerUnit NULL) — avoids 0-cost
  ): Promise<{ entryIds: string[]; entries: string[]; totalCost: number; availableBefore: number } | null> {
    const now = new Date();
    const where: Prisma.StockEntryWhereInput = {
      sourceProductId,
      status: "AVAILABLE",
      OR: [
        { batchId: null },
        { batch: { deletedAt: null, expiresAt: null } },
        { batch: { deletedAt: null, expiresAt: { gt: now } } },
      ],
    };
    const availableBefore = await this.prisma.stockEntry.count({ where });
    if (availableBefore < qty) return null;
    const picked = await this.prisma.stockEntry.findMany({
      where,
      orderBy: [
        { batchId: { sort: "asc", nulls: "first" } },
        { uploadedAt: "asc" },
        { id: "asc" },
      ],
      take: qty,
      include: { batch: { select: { costPerUnit: true } } },
    });
    if (picked.length < qty) return null;
    const totalCost = picked.reduce(
      (sum, e) => sum + (e.batch?.costPerUnit ? Number(e.batch.costPerUnit) : fallbackUnitCost),
      0,
    );
    return {
      entryIds: picked.map((e) => e.id),
      entries: picked.map((e) => e.text),
      totalCost,
      availableBefore,
    };
  }

  // Cắt kho StockEntry trong transaction (mark SOLD đúng entryIds + soft-delete lô rỗng +
  // recompute SourceProduct.available). Trả true nếu thành công; false nếu kho đã đổi (race)
  // → caller tự route sang review / báo lỗi tuỳ entry point.
  private async commitStockEntryReplacement(
    tx: Prisma.TransactionClient,
    repl: { entryIds: string[]; sourceProductId: string },
    orderId: string,
    customerId: string,
  ): Promise<boolean> {
    const { entryIds, sourceProductId } = repl;
    await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${sourceProductId} FOR UPDATE`;
    const stillAvail = await tx.stockEntry.findMany({
      where: { id: { in: entryIds }, status: "AVAILABLE" },
      select: { id: true, batchId: true },
    });
    if (stillAvail.length !== entryIds.length) return false;
    const now = new Date();
    await tx.stockEntry.updateMany({
      where: { id: { in: entryIds } },
      data: { status: "SOLD", soldAt: now, soldToOrderId: orderId, soldToCustomerId: customerId },
    });
    const batchIds = Array.from(new Set(stillAvail.map((e) => e.batchId).filter((b): b is string => Boolean(b))));
    for (const bId of batchIds) {
      const rem = await tx.stockEntry.count({ where: { batchId: bId, status: "AVAILABLE" } });
      if (rem === 0) await tx.stockBatch.update({ where: { id: bId }, data: { deletedAt: new Date() } });
    }
    const remainingAvail = await tx.stockEntry.count({
      where: {
        sourceProductId,
        status: "AVAILABLE",
        OR: [
          { batchId: null },
          { batch: { deletedAt: null, expiresAt: null } },
          { batch: { deletedAt: null, expiresAt: { gt: now } } },
        ],
      },
    });
    await tx.sourceProduct.update({ where: { id: sourceProductId }, data: { available: remainingAvail } });
    return true;
  }

  // Khi seller resolve TAY và dán acc thay: nếu acc đó TRÙNG StockEntry còn AVAILABLE của SP này →
  // cắt kho (mark SOLD) để tránh bán trùng (oversell), và trả {Σ giá vốn lô khớp, số acc khớp}.
  // null nếu không khớp cái nào (seller dán acc ngoài hệ thống → giữ nguyên kho, dùng proxy đơn giá).
  private async consumeMatchingStockEntries(
    tx: Prisma.TransactionClient,
    sourceProductId: string,
    deliveredAccountText: string,
    orderId: string,
    customerId: string,
  ): Promise<{ totalCost: number; matchedCount: number } | null> {
    const blocks = deliveredAccountText
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (blocks.length === 0) return null;
    // How many of each EXACT account text were actually handed out. We must consume at most this
    // many AVAILABLE entries per text — otherwise a duplicate text (the same account re-uploaded
    // into another batch, or appearing in both the delivered slice and the still-for-sale
    // remainder) would get its still-sellable copy marked SOLD too → silent inventory loss.
    const wantByText = new Map<string, number>();
    for (const b of blocks) wantByText.set(b, (wantByText.get(b) || 0) + 1);
    await tx.$queryRaw`SELECT id FROM source_products WHERE id = ${sourceProductId} FOR UPDATE`;
    const candidates = await tx.stockEntry.findMany({
      where: { sourceProductId, status: "AVAILABLE", text: { in: Array.from(wantByText.keys()) } },
      orderBy: [
        { batchId: { sort: "asc", nulls: "first" } },
        { uploadedAt: "asc" },
        { id: "asc" },
      ],
      include: { batch: { select: { costPerUnit: true } } },
    });
    if (candidates.length === 0) return null;
    // FIFO-pick up to wantByText[text] entries per text.
    const takenByText = new Map<string, number>();
    const picked: typeof candidates = [];
    for (const e of candidates) {
      const want = wantByText.get(e.text) || 0;
      const taken = takenByText.get(e.text) || 0;
      if (taken >= want) continue;
      picked.push(e);
      takenByText.set(e.text, taken + 1);
    }
    if (picked.length === 0) return null;
    const ids = picked.map((e) => e.id);
    const now = new Date();
    await tx.stockEntry.updateMany({
      where: { id: { in: ids } },
      data: { status: "SOLD", soldAt: now, soldToOrderId: orderId, soldToCustomerId: customerId },
    });
    const totalCost = picked.reduce(
      (sum, e) => sum + (e.batch?.costPerUnit ? Number(e.batch.costPerUnit) : 0),
      0,
    );
    const batchIds = Array.from(new Set(picked.map((e) => e.batchId).filter((b): b is string => Boolean(b))));
    for (const bId of batchIds) {
      const rem = await tx.stockEntry.count({ where: { batchId: bId, status: "AVAILABLE" } });
      if (rem === 0) await tx.stockBatch.update({ where: { id: bId }, data: { deletedAt: new Date() } });
    }
    const remainingAvail = await tx.stockEntry.count({
      where: {
        sourceProductId,
        status: "AVAILABLE",
        OR: [
          { batchId: null },
          { batch: { deletedAt: null, expiresAt: null } },
          { batch: { deletedAt: null, expiresAt: { gt: now } } },
        ],
      },
    });
    await tx.sourceProduct.update({ where: { id: sourceProductId }, data: { available: remainingAvail } });
    return { totalCost, matchedCount: picked.length };
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
