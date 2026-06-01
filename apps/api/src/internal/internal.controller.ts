import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { decryptSecret, verifyInternalRequestSignature } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { TelegramBotService } from "../lib/telegram-bot.service.v2";
import { toDecimal } from "../lib/utils";
import { WarrantyService } from "../warranty/warranty.service";

@Controller("internal")
export class InternalController {
  private readonly internalRequestMaxSkewMs = 5 * 60 * 1000;

  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TelegramBotService)
    private readonly telegramBotService: TelegramBotService,
    @Inject(WarrantyService)
    private readonly warrantyService: WarrantyService,
  ) {}

  @Post("warranty/:claimId/auto-check-applied")
  async warrantyAutoCheckCallback(
    @Param("claimId") claimId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-internal-token") token: string,
    @Headers("x-internal-timestamp") timestamp: string,
    @Headers("x-internal-signature") signature: string,
    @Body() body: Record<string, any>,
  ) {
    this.assertValidInternalRequest(req, body || {}, token, timestamp, signature);
    await this.warrantyService.applyAutoCheckResult(claimId);
    return { success: true };
  }

  @Post("telegram/process/:shopId")
  async processTelegramUpdate(
    @Param("shopId") shopId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-internal-token") token: string,
    @Headers("x-internal-timestamp") timestamp: string,
    @Headers("x-internal-signature") signature: string,
    @Body() body: Record<string, any>,
  ) {
    this.assertValidInternalRequest(req, body, token, timestamp, signature);

    return this.telegramBotService.handleIncomingUpdate(shopId, body);
  }

  @Post("catalog-source-push")
  async processCatalogSourcePush(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-internal-token") token: string,
    @Headers("x-internal-timestamp") timestamp: string,
    @Headers("x-internal-signature") signature: string,
    @Body()
    body: {
      sourceBuyerKey?: string;
      products?: Array<{
        externalProductId?: string;
        displayName?: string;
        sourceName?: string;
        rawName?: string | null;
        description?: string | null;
        sourcePrice?: number;
        available?: number | null;
        addedQuantity?: number;
        metadata?: Record<string, unknown>;
      }>;
    },
  ) {
    this.assertValidInternalRequest(req, body as Record<string, unknown>, token, timestamp, signature);

    const sourceBuyerKey = String(body.sourceBuyerKey || "").trim();
    const products = Array.isArray(body.products) ? body.products : [];

    if (!sourceBuyerKey || products.length === 0) {
      return {
        success: true,
        matchedShops: 0,
        productUpdates: 0,
        messagesSent: 0,
      };
    }

    const shops = await this.prisma.shop.findMany({
      include: {
        providerConfig: true,
        botConfig: true,
      },
    });

    let matchedShops = 0;
    let productUpdates = 0;
    let messagesSent = 0;

    for (const shop of shops) {
      if (!shop.providerConfig || !shop.botConfig) {
        continue;
      }

      const buyerKey = decryptSecret(
        shop.providerConfig.buyerKeyEncrypted,
        this.config.encryptionKey,
      );

      if (buyerKey !== sourceBuyerKey) {
        continue;
      }

      matchedShops += 1;

      const externalIds = products
        .map((item) => String(item.externalProductId || "").trim())
        .filter(Boolean);
      const existingProducts = await this.prisma.sourceProduct.findMany({
        where: {
          shopId: shop.id,
          externalProductId: {
            in: externalIds,
          },
        },
      });
      const existingByExternalId = new Map(
        existingProducts.map((item) => [item.externalProductId, item]),
      );
      const notifications: Array<{
        externalProductId: string;
        displayName: string;
        addedQuantity: number;
        available: number;
      }> = [];

      for (const item of products) {
        const externalProductId = String(item.externalProductId || "").trim();

        if (!externalProductId) {
          continue;
        }

        const available = Number.isFinite(Number(item.available))
          ? Number(item.available)
          : null;
        const sourcePrice = Number.isFinite(Number(item.sourcePrice))
          ? Number(item.sourcePrice)
          : 0;
        const sourceName = String(
          item.sourceName || item.rawName || item.displayName || externalProductId,
        ).trim();
        const displayName = String(item.displayName || sourceName).trim();
        const previous = existingByExternalId.get(externalProductId);
        const inferredAddedQuantity =
          previous && available !== null && previous.available !== null
            ? Math.max(0, available - Number(previous.available))
            : available !== null
              ? Math.max(0, available)
              : 0;
        const addedQuantity = Number.isFinite(Number(item.addedQuantity))
          ? Math.max(0, Number(item.addedQuantity))
          : inferredAddedQuantity;

        const sourceProduct = await this.prisma.sourceProduct.upsert({
          where: {
            shopId_externalProductId: {
              shopId: shop.id,
              externalProductId,
            },
          },
          update: {
            sourceName,
            sourceRawName: String(item.rawName || "").trim() || sourceName,
            sourceDescription: String(item.description || "").trim() || null,
            sourcePrice: toDecimal(sourcePrice),
            available,
            totalCount: available ?? undefined,
            metadataJson: (item.metadata || {}) as Prisma.InputJsonValue,
            syncedAt: new Date(),
          },
          create: {
            shopId: shop.id,
            externalProductId,
            providerName: shop.providerConfig.providerName,
            sourceName,
            sourceRawName: String(item.rawName || "").trim() || sourceName,
            sourceDescription: String(item.description || "").trim() || null,
            sourcePrice: toDecimal(sourcePrice),
            available,
            totalCount: available || 0,
            metadataJson: (item.metadata || {}) as Prisma.InputJsonValue,
            syncedAt: new Date(),
          },
        });

        await this.prisma.sellerProductOverride.upsert({
          where: {
            sellerId_sourceProductId: {
              sellerId: shop.sellerId,
              sourceProductId: sourceProduct.id,
            },
          },
          update: {},
          create: {
            sellerId: shop.sellerId,
            shopId: shop.id,
            sourceProductId: sourceProduct.id,
            displayName,
            salePrice: toDecimal(sourcePrice + 25000),
            enabled: true,
            hidden: false,
          },
        });

        productUpdates += 1;

        if (available !== null && available > 0 && addedQuantity > 0) {
          notifications.push({
            externalProductId,
            displayName,
            addedQuantity,
            available,
          });
        }
      }

      if (shop.providerConfig.sourceNotificationSyncEnabled) {
        messagesSent += await this.telegramBotService.sendCatalogStockUpdateMessages(
          shop.id,
          notifications,
        );
      }
    }

    return {
      success: true,
      matchedShops,
      productUpdates,
      messagesSent,
    };
  }

  private assertValidInternalRequest(
    req: RawBodyRequest<Request>,
    body: Record<string, unknown>,
    token: string,
    timestamp: string,
    signature: string,
  ) {
    if (!this.constantTimeEqual(token, this.config.internalApiToken)) {
      throw new ForbiddenException("Invalid internal token.");
    }

    if (this.config.nodeEnv !== "production" && !timestamp && !signature) {
      return;
    }

    const rawBody = req.rawBody
      ? req.rawBody.toString("utf-8")
      : JSON.stringify(body || {});
    const isValidSignature = verifyInternalRequestSignature({
      secret: this.config.internalApiToken,
      method: req.method || "POST",
      path: req.originalUrl || req.url || "/",
      timestamp,
      signature,
      body: rawBody,
      maxSkewMs: this.internalRequestMaxSkewMs,
    });

    if (!isValidSignature) {
      throw new ForbiddenException("Invalid internal request signature.");
    }
  }

  /**
   * Constant-time secret comparison. A plain `a !== b` short-circuits on the first differing
   * byte, leaking the shared-secret length/prefix via response timing. Hash both sides to a
   * fixed 32-byte digest first so timingSafeEqual never sees mismatched lengths (it throws on
   * those) and no length information escapes.
   */
  private constantTimeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
    if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) {
      return false;
    }
    const ha = createHash("sha256").update(a).digest();
    const hb = createHash("sha256").update(b).digest();
    return timingSafeEqual(ha, hb);
  }
}
