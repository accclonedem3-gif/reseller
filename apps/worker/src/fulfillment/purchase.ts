import type { Job, Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "../infra/prisma";
import { getEncryptionKey } from "../config/env";
import {
  countAvailableManualEntries,
  popManualStockEntries,
} from "../stock";
import { snapshotWarrantyForDeliveredOrder } from "../warranty";
import {
  creditAffiliateCommission,
  recordInternalSourceOrder,
  debitConnectionBalance,
} from "../wallet";
import {
  normalizeLanguage,
  formatLocalizedDateTime,
  formatVndMoney,
  resolveWarrantyText,
  buildManualPendingMessage,
  formatError,
} from "../format/text";
import { getAdminTemplateCustomizationCached } from "./catalog-sync";
import {
  decryptSecret,
  isMockBotToken,
  isMockBuyerKey,
  isRoboticvnProvider,
  checkProviderVariantStock,
  fetchProviderProducts,
  purchaseFromMockProvider,
  purchaseFromProvider,
  fetchProviderOrderStatus,
  telegramDeleteMessage,
  telegramSendMessage,
  resolveInvoiceTemplate,
  sendInvoiceMessages,
  resolveUsageInstructionsTemplate,
  sendUsageInstructionsMessage,
  JOBS,
} from "@reseller/shared/server";

export function splitDeliveredAccountList(deliveredText?: string | null): string[] {
  const raw = String(deliveredText || "").trim();
  if (!raw) return [];
  if (raw.indexOf("\n\n") !== -1) {
    return raw.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  }
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export async function sendDeliveredOrderMessages(input: {
  botToken: string;
  chatId: string;
  orderCode: string;
  productName: string;
  quantity: number;
  amount: any;
  deliveredText: string;
  deliveredAt: Date;
  language: "vi" | "en";
  shopId?: string | null;
  shopName?: string | null;
  customerName?: string | null;
  productIcon?: string | null;
  productIconCustomEmojiId?: string | null;
  sourceDescription?: string | null;
  metadata?: any;
  warrantyPolicy?: any;
  shop?: {
    supportTelegram?: string | null;
    supportZalo?: string | null;
  } | null;
}): Promise<void> {
  let shopCust: any = null;
  let shopName = input.shopName || null;
  let cusidEmitOk = true;
  if (input.shopId) {
    try {
      const shopCfg = await prisma.shop.findUnique({
        where: { id: input.shopId },
        select: {
          name: true,
          botConfig: { select: { customizationJson: true, cusidEmitOk: true } },
        },
      });
      if (shopCfg) {
        shopCust = shopCfg.botConfig?.customizationJson || null;
        if (shopCfg.botConfig?.cusidEmitOk === false) cusidEmitOk = false;
        if (!shopName) shopName = shopCfg.name || null;
      }
    } catch {
      /* ignore */
    }
  }
  const adminCust = await getAdminTemplateCustomizationCached();
  const template = resolveInvoiceTemplate(shopCust, adminCust);
  const accountList = splitDeliveredAccountList(input.deliveredText);
  const warrantyText = resolveWarrantyText({
    productName: input.productName,
    sourceDescription: input.sourceDescription,
    metadata: input.metadata,
    warrantyPolicy: input.warrantyPolicy,
    language: input.language,
  });
  const dateTimeText = `${formatLocalizedDateTime(input.deliveredAt, input.language)} (GMT+7)`;
  const totalPriceText = formatVndMoney(input.amount, input.language);
  const buyMoreLabel =
    input.language === "en" ? "🛍️ Buy more" : "🛍️ Mua tiếp";
  const warrantyLabel =
    input.language === "en" ? "🛡️ Warranty" : "🛡️ Bảo hành";

  await sendInvoiceMessages({
    botToken: input.botToken,
    chatId: input.chatId,
    template,
    data: {
      orderCode: input.orderCode,
      productName: input.productName,
      quantity: input.quantity,
      totalPriceText,
      customerName: input.customerName || null,
      shopName: shopName || null,
      dateTimeText,
      warrantyText,
      accountList,
      language: input.language,
      productIcon: input.productIcon || null,
      productIconCustomEmojiId: input.productIconCustomEmojiId || null,
    },
    buyMoreButton: { text: buyMoreLabel, callback_data: "home:products" },
    warrantyButton: { text: warrantyLabel, callback_data: "warranty:start" },
    canEmitCusid: cusidEmitOk,
  }).catch(() => undefined);

  const usageInstructions = input.metadata?.usageInstructions;
  if (
    usageInstructions &&
    typeof usageInstructions === "string" &&
    usageInstructions.trim()
  ) {
    const usageTpl = resolveUsageInstructionsTemplate(shopCust, adminCust);
    await sendUsageInstructionsMessage({
      botToken: input.botToken,
      chatId: input.chatId,
      template: usageTpl,
      instructionsText: usageInstructions.trim(),
      canEmitCusid: cusidEmitOk,
    }).catch(() => undefined);
  }
}

export async function deleteQrMessage(
  botToken: string,
  order: {
    customer?: { telegramChatId: string } | null;
    paymentTransaction?: { qrTelegramMessageId?: number | string | null } | null;
  }
): Promise<void> {
  const rawId = order.paymentTransaction?.qrTelegramMessageId;
  if (!rawId || !order.customer?.telegramChatId) return;
  const messageId = Number(rawId);
  if (Number.isNaN(messageId)) return;
  await telegramDeleteMessage(botToken, order.customer.telegramChatId, messageId).catch(
    () => undefined
  );
}

export async function enqueuePaidOrder(
  queue: Queue,
  orderId: string,
  totalSourceAmount: number
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "PROCESSING_PURCHASE",
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          eventType: "purchase_enqueued",
          payloadJson: {
            amount: totalSourceAmount,
            note: "Queued for upstream purchase using source wallet balance.",
          },
        },
      });
    });
    await queue.add(
      JOBS.purchaseUpstream,
      { orderId },
      {
        jobId: `purchase-${orderId}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    );
  } catch (error) {
    await prisma.order
      .update({
        where: { id: orderId },
        data: {
          status: "FAILED",
          failureReason:
            error instanceof Error ? error.message : "Processing failed.",
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function processPurchase(job: Job<{ orderId: string }>): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: job.data.orderId },
    include: {
      customer: true,
      shop: {
        include: {
          botConfig: true,
          providerConfig: true,
        },
      },
      sourceProduct: true,
      paymentTransaction: true,
    },
  });
  if (!order) {
    return;
  }
  const sourceMetadata =
    order.sourceProduct?.metadataJson &&
    typeof order.sourceProduct.metadataJson === "object" &&
    !Array.isArray(order.sourceProduct.metadataJson)
      ? (order.sourceProduct.metadataJson as Record<string, any>)
      : {};
  const customerLanguage = normalizeLanguage(order.customer?.preferredLanguage);
  const isManualProduct =
    String(order.sourceProduct?.providerName || "").toLowerCase() === "manual" ||
    sourceMetadata.manual === true;
  // Manual products are fulfilled by internal stock — providerConfig is only required
  // for the external-source branch below. A shop that sells only manual products may
  // legitimately have no providerConfig, so guard it AFTER the manual branch.
  const providerConfig = order.shop.providerConfig;
  if (!isManualProduct && !providerConfig) {
    return;
  }
  if (isManualProduct) {
    const botToken = decryptSecret(
      order.shop.botConfig?.telegramBotTokenEncrypted,
      getEncryptionKey()
    );
    // Shared content delivery: same content for all buyers, stock is a counter
    if (
      sourceMetadata.shared === true &&
      typeof sourceMetadata.sharedContent === "string" &&
      sourceMetadata.sharedContent.trim()
    ) {
      const deliveredText = sourceMetadata.sharedContent.trim();
      const currentAvailable = order.sourceProduct?.available ?? 0;
      const newAvailable = Math.max(0, currentAvailable - order.quantity);
      const deliveredAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "DELIVERED",
            deliveredAccountText: deliveredText,
            deliveredAt,
            failureReason: null,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: "shared_product_delivered",
            payloadJson: { deliveredAt, quantity: order.quantity },
          },
        });
        if (order.sourceProductId) {
          await tx.sourceProduct.update({
            where: { id: order.sourceProductId },
            data: { soldCount: { increment: order.quantity }, available: newAvailable },
          });
        }
      });
      await snapshotWarrantyForDeliveredOrder(order.id);
      await creditAffiliateCommission(order.id).catch(() => undefined);
      if (
        botToken &&
        !(
          String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
          isMockBotToken(botToken)
        )
      ) {
        await deleteQrMessage(botToken, order);
        await sendDeliveredOrderMessages({
          botToken,
          shopId: order.shopId,
          productIcon: order.sourceProduct?.productIcon,
          productIconCustomEmojiId: order.sourceProduct?.iconCustomEmojiId,
          chatId: order.customer.telegramChatId,
          orderCode: order.orderCode,
          productName: order.productNameSnapshot,
          quantity: order.quantity,
          amount: order.totalSaleAmount,
          deliveredText,
          deliveredAt,
          language: normalizeLanguage(order.customer?.preferredLanguage),
          sourceDescription: order.sourceProduct?.sourceDescription,
          metadata: sourceMetadata,
          warrantyPolicy:
            order.warrantyPolicySnapshot || order.sourceProduct?.warrantyPolicy,
          shop: {
            supportTelegram: order.shop.supportTelegram,
            supportZalo: order.shop.supportZalo,
          },
        });
      }
      return;
    }

    if (!order.sourceProductId) {
      return;
    }
    const availableManualEntries = await countAvailableManualEntries(
      prisma,
      order.sourceProductId
    );
    if (availableManualEntries >= order.quantity) {
      const deliveredAt = new Date();
      const __SHORTAGE_SENTINEL = Symbol.for("manual_delivery_shortage");
      let txDeliveredText = "";
      let txTotalCost = 0;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRawUnsafe(
            "SELECT id FROM source_products WHERE id = $1 FOR UPDATE",
            order.sourceProductId
          );
          const popped = await popManualStockEntries(
            tx,
            order.sourceProductId!,
            order.quantity,
            {
              customerId: order.customerId,
              orderId: order.id,
            }
          );
          if (!popped) {
            const shortageReason =
              "Kho tai khoan giao tu dong khong du so luong. Don da chuyen sang cho seller xu ly thu cong.";
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: "PAID_WAITING_STOCK",
                failureReason: shortageReason,
              },
            });
            await tx.orderEvent.create({
              data: {
                orderId: order.id,
                eventType: "manual_product_pending",
                payloadJson: {
                  reason: shortageReason,
                  requestedQuantity: order.quantity,
                  raceDetected: true,
                },
              },
            });
            throw __SHORTAGE_SENTINEL;
          }
          const deliveredText = popped.extracted.join("\n\n");
          txDeliveredText = deliveredText;
          txTotalCost = popped.totalCost;
          const totalSourceAmount =
            popped.totalCost > 0
              ? popped.totalCost
              : Number(order.totalSourceAmount || 0);
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "DELIVERED",
              deliveredAccountText: deliveredText,
              deliveredAt,
              totalSourceAmount: new Prisma.Decimal(totalSourceAmount.toFixed(2)),
            },
          });
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              eventType: "manual_product_delivered",
              payloadJson: {
                deliveredText,
                deliveredCount: popped.extracted.length,
                entryIds: popped.entryIds,
                totalCost: popped.totalCost,
              },
            },
          });
          const remainingAvailable = await tx.stockEntry.count({
            where: {
              sourceProductId: order.sourceProductId!,
              status: "AVAILABLE",
            },
          });
          await tx.sourceProduct.update({
            where: { id: order.sourceProductId! },
            data: {
              soldCount: { increment: order.quantity },
              available: remainingAvailable,
            },
          });
        });
      } catch (e) {
        if (e === __SHORTAGE_SENTINEL) {
          console.warn(
            "[manual-delivery] shortage detected after FOR UPDATE re-read",
            { orderId: order.id }
          );
          return;
        }
        throw e;
      }
      await snapshotWarrantyForDeliveredOrder(order.id);
      await creditAffiliateCommission(order.id).catch(() => undefined);
      if (
        botToken &&
        !(
          String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
          isMockBotToken(botToken)
        )
      ) {
        await deleteQrMessage(botToken, order);
        await sendDeliveredOrderMessages({
          botToken,
          shopId: order.shopId,
          productIcon: order.sourceProduct?.productIcon,
          productIconCustomEmojiId: order.sourceProduct?.iconCustomEmojiId,
          chatId: order.customer.telegramChatId,
          orderCode: order.orderCode,
          productName: order.productNameSnapshot,
          quantity: order.quantity,
          amount: order.totalSaleAmount,
          deliveredText: txDeliveredText,
          deliveredAt,
          language: customerLanguage,
          sourceDescription: order.sourceProduct?.sourceDescription,
          metadata: sourceMetadata,
          warrantyPolicy:
            order.warrantyPolicySnapshot || order.sourceProduct?.warrantyPolicy,
          shop: {
            supportTelegram: order.shop.supportTelegram,
            supportZalo: order.shop.supportZalo,
          },
        });
      }
      return;
    }
    if (availableManualEntries > 0 && availableManualEntries < order.quantity) {
      const shortageReason =
        "Kho tai khoan giao tu dong khong du so luong. Don da chuyen sang cho seller xu ly thu cong.";
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "PAID_WAITING_STOCK",
            failureReason: shortageReason,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: "manual_product_pending",
            payloadJson: {
              reason: shortageReason,
              availableEntries: availableManualEntries,
              requestedQuantity: order.quantity,
            },
          },
        });
        if (
          order.sourceProductId &&
          order.sourceProduct?.available !== null &&
          order.sourceProduct?.available !== undefined
        ) {
          await tx.sourceProduct.update({
            where: { id: order.sourceProductId },
            data: { available: { decrement: order.quantity } },
          });
        }
      });
      if (
        botToken &&
        !(
          String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
          isMockBotToken(botToken)
        )
      ) {
        await telegramSendMessage(
          botToken,
          order.customer.telegramChatId,
          buildManualPendingMessage({
            language: customerLanguage,
            orderCode: order.orderCode,
            productName: order.productNameSnapshot,
            quantity: order.quantity,
            shortage: true,
            shop: {
              supportTelegram: order.shop.supportTelegram,
              supportZalo: order.shop.supportZalo,
            },
          })
        ).catch(() => undefined);
      }
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PAID_WAITING_STOCK",
          failureReason: "San pham manual dang cho seller xu ly thu cong.",
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "manual_product_pending",
          payloadJson: {
            reason: "San pham manual dang cho seller xu ly thu cong.",
          },
        },
      });
      if (
        order.sourceProductId &&
        order.sourceProduct?.available !== null &&
        order.sourceProduct?.available !== undefined
      ) {
        await tx.sourceProduct.update({
          where: { id: order.sourceProductId },
          data: { available: { decrement: order.quantity } },
        });
      }
    });
    if (
      botToken &&
      !(
        String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
        isMockBotToken(botToken)
      )
    ) {
      await telegramSendMessage(
        botToken,
        order.customer.telegramChatId,
        buildManualPendingMessage({
          language: customerLanguage,
          orderCode: order.orderCode,
          productName: order.productNameSnapshot,
          quantity: order.quantity,
          shortage: false,
          shop: {
            supportTelegram: order.shop.supportTelegram,
            supportZalo: order.shop.supportZalo,
          },
        })
      ).catch(() => undefined);
    }
    return;
  }

  if (!providerConfig) {
    return;
  }

  // INTERNAL source: pull delivery entries directly from upstream ULTRA product
  if (
    providerConfig.providerKind === "INTERNAL" &&
    providerConfig.internalSourceConnectionId
  ) {
    if (!order.sourceProduct) {
      return;
    }
    const botToken = decryptSecret(
      order.shop.botConfig?.telegramBotTokenEncrypted,
      getEncryptionKey()
    );
    const upstreamProduct = await prisma.sourceProduct.findUnique({
      where: { id: order.sourceProduct.externalProductId },
    });
    const upstreamMetadata =
      upstreamProduct?.metadataJson &&
      typeof upstreamProduct.metadataJson === "object" &&
      !Array.isArray(upstreamProduct.metadataJson)
        ? (upstreamProduct.metadataJson as Record<string, any>)
        : {};
    const upstreamConnection =
      await prisma.downstreamSourceConnection.findUnique({
        where: { id: providerConfig.internalSourceConnectionId },
        include: { upstreamShop: { include: { providerConfig: true } } },
      });
    const upstreamAvailable = upstreamProduct
      ? await countAvailableManualEntries(prisma, upstreamProduct.id)
      : 0;
    if (upstreamAvailable >= order.quantity && upstreamProduct) {
      const deliveredAt = new Date();
      const __UPSTREAM_SHORTAGE_SENTINEL = Symbol.for(
        "manual_delivery_upstream_shortage"
      );
      let txDeliveredText = "";
      let txTotalCost = 0;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRawUnsafe(
            "SELECT id FROM source_products WHERE id = $1 FOR UPDATE",
            upstreamProduct.id
          );
          const popped = await popManualStockEntries(
            tx,
            upstreamProduct.id,
            order.quantity,
            {
              customerId: order.customerId,
              orderId: order.id,
            }
          );
          if (!popped) {
            const shortageReason =
              "Kho tai khoan giao tu dong khong du so luong. Don da chuyen sang cho seller xu ly thu cong.";
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: "PAID_WAITING_STOCK",
                failureReason: shortageReason,
              },
            });
            await tx.orderEvent.create({
              data: {
                orderId: order.id,
                eventType: "manual_product_pending",
                payloadJson: {
                  reason: shortageReason,
                  requestedQuantity: order.quantity,
                  raceDetected: true,
                  upstreamProductId: upstreamProduct.id,
                },
              },
            });
            throw __UPSTREAM_SHORTAGE_SENTINEL;
          }
          const deliveredText = popped.extracted.join("\n\n");
          txDeliveredText = deliveredText;
          txTotalCost = popped.totalCost;
          const totalSourceAmount =
            popped.totalCost > 0
              ? popped.totalCost
              : Number(order.totalSourceAmount || 0);
          let createdInternalSourceOrderId: string | null = null;
          if (upstreamConnection) {
            const unitPriceISO =
              order.quantity > 0
                ? Number(order.totalSourceAmount || 0) / order.quantity
                : Number(order.totalSourceAmount || 0);
            const sourcePriceSnapshotISO =
              order.quantity > 0
                ? totalSourceAmount / order.quantity
                : totalSourceAmount;
            const isoRow = await recordInternalSourceOrder(tx, {
              connection: upstreamConnection,
              order,
              upstreamProduct,
              unitPrice: unitPriceISO,
              sourcePriceSnapshot: sourcePriceSnapshotISO,
              totalAmount: Number(order.totalSourceAmount || 0),
              deliveredText,
              deliveredAt,
              fulfillment: "ultra_stock",
            });
            createdInternalSourceOrderId = isoRow.id;
          }
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "DELIVERED",
              deliveredAccountText: deliveredText,
              deliveredAt,
              failureReason: null,
              totalSourceAmount: new Prisma.Decimal(totalSourceAmount.toFixed(2)),
              ...(createdInternalSourceOrderId
                ? { internalSourceOrderId: createdInternalSourceOrderId }
                : {}),
            },
          });
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              eventType: "internal_source_delivered",
              payloadJson: {
                deliveredCount: popped.extracted.length,
                deliveredText,
                entryIds: popped.entryIds,
                totalCost: popped.totalCost,
                internalSourceOrderId: createdInternalSourceOrderId,
              },
            },
          });
          if (order.sourceProductId) {
            await tx.sourceProduct.update({
              where: { id: order.sourceProductId },
              data: {
                soldCount: { increment: order.quantity },
                available:
                  order.sourceProduct?.available === null ||
                  order.sourceProduct?.available === undefined
                    ? undefined
                    : { decrement: order.quantity },
              },
            });
          }
          const remainingUpstreamAvailable = await tx.stockEntry.count({
            where: {
              sourceProductId: upstreamProduct.id,
              status: "AVAILABLE",
            },
          });
          await tx.sourceProduct.update({
            where: { id: upstreamProduct.id },
            data: {
              soldCount: { increment: order.quantity },
              available: remainingUpstreamAvailable,
            },
          });
        });
      } catch (e) {
        if (e === __UPSTREAM_SHORTAGE_SENTINEL) {
          console.warn(
            "[internal-source-delivery] upstream shortage detected after FOR UPDATE re-read",
            { orderId: order.id, upstreamProductId: upstreamProduct?.id }
          );
          return;
        }
        throw e;
      }
      await snapshotWarrantyForDeliveredOrder(order.id);
      await creditAffiliateCommission(order.id).catch(() => undefined);
      const totalSourceAmount =
        txTotalCost > 0 ? txTotalCost : Number(order.totalSourceAmount || 0);
      if (totalSourceAmount > 0) {
        await debitConnectionBalance(
          providerConfig.internalSourceConnectionId,
          totalSourceAmount,
          order.id
        ).catch(() => undefined);
      }
      if (
        botToken &&
        !(
          String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
          isMockBotToken(botToken)
        )
      ) {
        await deleteQrMessage(botToken, order);
        await sendDeliveredOrderMessages({
          botToken,
          shopId: order.shopId,
          productIcon: order.sourceProduct?.productIcon,
          productIconCustomEmojiId: order.sourceProduct?.iconCustomEmojiId,
          chatId: order.customer.telegramChatId,
          orderCode: order.orderCode,
          productName: order.productNameSnapshot,
          quantity: order.quantity,
          amount: order.totalSaleAmount,
          deliveredText: txDeliveredText,
          deliveredAt,
          language: customerLanguage,
          sourceDescription: order.sourceProduct?.sourceDescription,
          metadata: sourceMetadata,
          warrantyPolicy:
            order.warrantyPolicySnapshot || order.sourceProduct?.warrantyPolicy,
          shop: {
            supportTelegram: order.shop.supportTelegram,
            supportZalo: order.shop.supportZalo,
          },
        });
      }
      return;
    }

    // No manual delivery entries — check if upstream shop can purchase from Canboso
    const upstreamProviderConfig =
      upstreamConnection?.upstreamShop?.providerConfig;
    if (
      upstreamProviderConfig?.providerKind === "EXTERNAL" &&
      upstreamProduct?.externalProductId
    ) {
      const upstreamBuyerKey = decryptSecret(
        upstreamProviderConfig.buyerKeyEncrypted,
        getEncryptionKey()
      );
      const upstreamResult = await purchaseFromProvider(
        {
          baseUrl: upstreamProviderConfig.baseUrl,
          buyerKey: upstreamBuyerKey,
          timeoutMs: 120000,
        },
        {
          productId: upstreamProduct.externalProductId,
          quantity: order.quantity,
          customerEmail: order.customerEmail || null,
          clientOrderCode: order.orderCode,
        }
      );
      if (upstreamResult.success && upstreamResult.deliveredText) {
        const deliveredAt = new Date();
        await prisma.$transaction(async (tx) => {
          let createdInternalSourceOrderId: string | null = null;
          if (upstreamConnection) {
            const unitPriceISO =
              order.quantity > 0
                ? Number(order.totalSourceAmount || 0) / order.quantity
                : Number(order.totalSourceAmount || 0);
            const sourcePriceSnapshotISO = upstreamProduct?.sourcePrice
              ? Number(upstreamProduct.sourcePrice)
              : 0;
            const isoRow = await recordInternalSourceOrder(tx, {
              connection: upstreamConnection,
              order,
              upstreamProduct,
              unitPrice: unitPriceISO,
              sourcePriceSnapshot: sourcePriceSnapshotISO,
              totalAmount: Number(order.totalSourceAmount || 0),
              deliveredText: upstreamResult.deliveredText,
              deliveredAt,
              fulfillment: "ultra_canboso_fallback",
              canbosoProviderOrderId: upstreamResult.providerOrderId || null,
              canbosoProviderOrderCode: upstreamResult.providerOrderCode || null,
            });
            createdInternalSourceOrderId = isoRow.id;
          }
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "DELIVERED",
              deliveredAccountText: upstreamResult.deliveredText,
              deliveredAt,
              internalSourceOrderId:
                createdInternalSourceOrderId || undefined,
              internalSourceOrderCode:
                upstreamResult.providerOrderCode || undefined,
              failureReason: null,
            },
          });
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              eventType: "internal_via_canboso_delivered",
              payloadJson: {
                deliveredText: upstreamResult.deliveredText,
                providerOrderId: upstreamResult.providerOrderId || null,
                providerOrderCode: upstreamResult.providerOrderCode || null,
                internalSourceOrderId: createdInternalSourceOrderId,
              },
            },
          });
          if (order.sourceProductId) {
            await tx.sourceProduct.update({
              where: { id: order.sourceProductId },
              data: {
                soldCount: { increment: order.quantity },
                available:
                  order.sourceProduct?.available === null ||
                  order.sourceProduct?.available === undefined
                    ? undefined
                    : { decrement: order.quantity },
              },
            });
          }
          if (upstreamProduct) {
            await tx.sourceProduct.update({
              where: { id: upstreamProduct.id },
              data: {
                soldCount: { increment: order.quantity },
              },
            });
          }
        });
        await snapshotWarrantyForDeliveredOrder(order.id);
        await creditAffiliateCommission(order.id).catch(() => undefined);
        const totalSourceAmount = Number(order.totalSourceAmount || 0);
        if (totalSourceAmount > 0) {
          await debitConnectionBalance(
            providerConfig.internalSourceConnectionId,
            totalSourceAmount,
            order.id
          ).catch(() => undefined);
        }
        if (
          botToken &&
          !(
            String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
            isMockBotToken(botToken)
          )
        ) {
          await deleteQrMessage(botToken, order);
          await sendDeliveredOrderMessages({
            botToken,
            shopId: order.shopId,
            productIcon: order.sourceProduct?.productIcon,
            productIconCustomEmojiId: order.sourceProduct?.iconCustomEmojiId,
            chatId: order.customer.telegramChatId,
            orderCode: order.orderCode,
            productName: order.productNameSnapshot,
            quantity: order.quantity,
            amount: order.totalSaleAmount,
            deliveredText: upstreamResult.deliveredText,
            deliveredAt,
            language: customerLanguage,
            sourceDescription: order.sourceProduct?.sourceDescription,
            metadata: sourceMetadata,
            warrantyPolicy:
              order.warrantyPolicySnapshot ||
              order.sourceProduct?.warrantyPolicy,
            shop: {
              supportTelegram: order.shop.supportTelegram,
              supportZalo: order.shop.supportZalo,
            },
          });
        }
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status:
              upstreamResult.outOfStock || upstreamResult.pending
                ? "PAID_WAITING_STOCK"
                : "FAILED",
            failureReason:
              upstreamResult.message || "Upstream Canboso purchase failed.",
            internalSourceOrderId: upstreamResult.providerOrderId || undefined,
            internalSourceOrderCode:
              upstreamResult.providerOrderCode || undefined,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            eventType:
              upstreamResult.outOfStock || upstreamResult.pending
                ? "upstream_out_of_stock"
                : "upstream_failed",
            payloadJson: {
              message:
                upstreamResult.message || "Upstream Canboso purchase failed.",
              providerOrderId: upstreamResult.providerOrderId || null,
              providerOrderCode: upstreamResult.providerOrderCode || null,
            },
          },
        });
      });
      if (
        botToken &&
        !(
          String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
          isMockBotToken(botToken)
        )
      ) {
        await telegramSendMessage(
          botToken,
          order.customer.telegramChatId,
          buildManualPendingMessage({
            language: customerLanguage,
            orderCode: order.orderCode,
            productName: order.productNameSnapshot,
            quantity: order.quantity,
            shortage: upstreamResult.outOfStock ?? false,
            shop: {
              supportTelegram: order.shop.supportTelegram,
              supportZalo: order.shop.supportZalo,
            },
          })
        ).catch(() => undefined);
      }
      return;
    }

    // Upstream has no stock — wait for ULTRA to add entries
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PAID_WAITING_STOCK",
          failureReason:
            "Nguon san pham chua co hang. Dang cho bo sung.",
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "internal_source_out_of_stock",
          payloadJson: {
            message: "Upstream INTERNAL source has no delivery entries.",
          },
        },
      });
    });
    if (
      botToken &&
      !(
        String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
        isMockBotToken(botToken)
      )
    ) {
      await telegramSendMessage(
        botToken,
        order.customer.telegramChatId,
        buildManualPendingMessage({
          language: customerLanguage,
          orderCode: order.orderCode,
          productName: order.productNameSnapshot,
          quantity: order.quantity,
          shortage: false,
          shop: {
            supportTelegram: order.shop.supportTelegram,
            supportZalo: order.shop.supportZalo,
          },
        })
      ).catch(() => undefined);
    }
    return;
  }

  const buyerKey = decryptSecret(
    providerConfig.buyerKeyEncrypted,
    getEncryptionKey()
  );
  const botToken = decryptSecret(
    order.shop.botConfig?.telegramBotTokenEncrypted,
    getEncryptionKey()
  );
  // Pre-purchase stock check for EXTERNAL provider
  // Roboticvn: skip full catalog fetch (N+1 requests → rate limit 120/min).
  // Use DB available (synced every 60s) instead. Canboso: single request, OK to keep.
  if (
    providerConfig.providerKind === "EXTERNAL" &&
    order.sourceProduct?.externalProductId &&
    !(
      String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true" &&
      isMockBuyerKey(buyerKey)
    )
  ) {
    if (isRoboticvnProvider({ baseUrl: providerConfig.baseUrl, buyerKey })) {
      // Roboticvn: single-variant stock check (1 HTTP request) instead of full catalog (N+1).
      try {
        const meta =
          order.sourceProduct.metadataJson &&
          typeof order.sourceProduct.metadataJson === "object" &&
          !Array.isArray(order.sourceProduct.metadataJson)
            ? (order.sourceProduct.metadataJson as Record<string, any>)
            : {};
        const parentProductId = meta.productId ? String(meta.productId) : null;
        const inStock = await checkProviderVariantStock(
          { baseUrl: providerConfig.baseUrl, buyerKey },
          order.sourceProduct.externalProductId,
          parentProductId
        );
        if (inStock === false) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              status: "PAID_WAITING_STOCK",
              failureReason:
                "San pham tam het hang ben nha cung cap. Tu dong thu lai khi co hang.",
            },
          });
          return;
        }
      } catch {
        // fail-open: nếu không check được thì cứ tiếp tục mua
      }
    } else {
      // Canboso / others: single-request catalog fetch is OK.
      try {
        const catalog = await fetchProviderProducts({
          baseUrl: providerConfig.baseUrl,
          buyerKey,
          timeoutMs: 5000,
        });
        const entry = catalog.find(
          (p) => p.externalId === order.sourceProduct?.externalProductId
        );
        if (
          !entry ||
          entry.hidden ||
          (entry.available !== null && entry.available <= 0)
        ) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              status: "PAID_WAITING_STOCK",
              failureReason:
                "San pham tam het hang ben nha cung cap. Tu dong thu lai khi co hang.",
            },
          });
          return;
        }
      } catch {
        // fail-open: nếu không check được thì cứ tiếp tục mua
      }
    }
  }

  const result =
    String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true" &&
    isMockBuyerKey(buyerKey)
      ? purchaseFromMockProvider({
          productId: order.sourceProduct?.externalProductId || "",
          quantity: order.quantity,
        })
      : await purchaseFromProvider(
          {
            baseUrl: providerConfig.baseUrl,
            buyerKey,
            timeoutMs: 120000,
          },
          {
            productId: order.sourceProduct?.externalProductId || "",
            quantity: order.quantity,
            customerEmail: order.customerEmail || null,
            clientOrderCode: order.orderCode,
          }
        );

  if (result.success && result.deliveredText) {
    const deliveredAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "DELIVERED",
          deliveredAccountText: result.deliveredText,
          deliveredAt,
          internalSourceOrderId: result.providerOrderId || undefined,
          internalSourceOrderCode: result.providerOrderCode || undefined,
          failureReason: null,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "upstream_purchase_success",
          payloadJson: {
            deliveredText: result.deliveredText,
            providerOrderId: result.providerOrderId || null,
            providerOrderCode: result.providerOrderCode || null,
          },
        },
      });
      if (order.sourceProductId) {
        await tx.sourceProduct.update({
          where: { id: order.sourceProductId },
          data: {
            soldCount: {
              increment: order.quantity,
            },
            available:
              order.sourceProduct?.available === null ||
              order.sourceProduct?.available === undefined
                ? undefined
                : {
                    decrement: order.quantity,
                  },
          },
        });
      }
    });
    await snapshotWarrantyForDeliveredOrder(order.id);
    await creditAffiliateCommission(order.id).catch(() => undefined);
    if (
      providerConfig.providerKind === "INTERNAL" &&
      providerConfig.internalSourceConnectionId
    ) {
      const totalSourceAmount = Number(order.totalSourceAmount || 0);
      if (totalSourceAmount > 0) {
        await debitConnectionBalance(
          providerConfig.internalSourceConnectionId,
          totalSourceAmount,
          order.id
        ).catch(() => undefined);
      }
    }
    if (
      botToken &&
      !(
        String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
        isMockBotToken(botToken)
      )
    ) {
      await deleteQrMessage(botToken, order);
      await sendDeliveredOrderMessages({
        botToken,
        shopId: order.shopId,
        productIcon: order.sourceProduct?.productIcon,
        productIconCustomEmojiId: order.sourceProduct?.iconCustomEmojiId,
        chatId: order.customer.telegramChatId,
        orderCode: order.orderCode,
        productName: order.productNameSnapshot,
        quantity: order.quantity,
        amount: order.totalSaleAmount,
        deliveredText: result.deliveredText,
        deliveredAt,
        language: customerLanguage,
        sourceDescription: order.sourceProduct?.sourceDescription,
        metadata: sourceMetadata,
        warrantyPolicy:
          order.warrantyPolicySnapshot || order.sourceProduct?.warrantyPolicy,
        shop: {
          supportTelegram: order.shop.supportTelegram,
          supportZalo: order.shop.supportZalo,
        },
      });
    }
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status:
          result.outOfStock || result.pending
            ? "PAID_WAITING_STOCK"
            : "FAILED",
        failureReason: result.message || "Upstream purchase failed.",
        internalSourceOrderId: result.providerOrderId || undefined,
        internalSourceOrderCode: result.providerOrderCode || undefined,
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        eventType:
          result.outOfStock || result.pending
            ? "upstream_out_of_stock"
            : "upstream_failed",
        payloadJson: {
          message: result.message || "Upstream purchase failed.",
          providerOrderId: result.providerOrderId || null,
          providerOrderCode: result.providerOrderCode || null,
        },
      },
    });
  });
}

export async function reconcilePendingInternalSourceOrders(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: {
      sourceProviderKindSnapshot: "INTERNAL",
      status: {
        in: ["PROCESSING_PURCHASE", "PAID_WAITING_STOCK"],
      },
      OR: [
        {
          internalSourceOrderId: {
            not: null,
          },
        },
        {
          internalSourceOrderCode: {
            not: null,
          },
        },
      ],
    },
    include: {
      customer: true,
      shop: {
        include: {
          botConfig: true,
          providerConfig: true,
        },
      },
      sourceProduct: true,
      paymentTransaction: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 20,
  });

  for (const order of orders) {
    const providerConfig = order.shop.providerConfig;
    if (!providerConfig) {
      continue;
    }
    const buyerKey = decryptSecret(
      providerConfig.buyerKeyEncrypted,
      getEncryptionKey()
    );
    if (!buyerKey) {
      continue;
    }
    try {
      const result = await fetchProviderOrderStatus(
        {
          baseUrl: providerConfig.baseUrl,
          buyerKey,
          providerName: providerConfig.providerName,
        },
        {
          orderId: order.internalSourceOrderId,
          orderCode: order.internalSourceOrderCode,
        }
      );
      if (!result.providerOrderId && !result.providerOrderCode && !result.status) {
        continue;
      }
      if (result.status === "delivered" && result.deliveredText) {
        const deliveredAt = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "DELIVERED",
              deliveredAccountText: result.deliveredText,
              deliveredAt,
              internalSourceOrderId:
                result.providerOrderId ||
                order.internalSourceOrderId ||
                undefined,
              internalSourceOrderCode:
                result.providerOrderCode ||
                order.internalSourceOrderCode ||
                undefined,
              failureReason: null,
            },
          });
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              eventType: "internal_source_order_delivered",
              payloadJson: {
                providerOrderId: result.providerOrderId || null,
                providerOrderCode: result.providerOrderCode || null,
              },
            },
          });
          if (order.sourceProductId) {
            await tx.sourceProduct.update({
              where: { id: order.sourceProductId },
              data: {
                soldCount: {
                  increment: order.quantity,
                },
                available:
                  order.sourceProduct?.available === null ||
                  order.sourceProduct?.available === undefined
                    ? undefined
                    : {
                        decrement: order.quantity,
                      },
              },
            });
          }
        });
        await snapshotWarrantyForDeliveredOrder(order.id);
        await creditAffiliateCommission(order.id).catch(() => undefined);
        const botToken = decryptSecret(
          order.shop.botConfig?.telegramBotTokenEncrypted,
          getEncryptionKey()
        );
        const sourceMetadata =
          order.sourceProduct?.metadataJson &&
          typeof order.sourceProduct.metadataJson === "object" &&
          !Array.isArray(order.sourceProduct.metadataJson)
            ? (order.sourceProduct.metadataJson as Record<string, any>)
            : {};
        const customerLanguage = normalizeLanguage(
          order.customer?.preferredLanguage
        );
        if (
          botToken &&
          !(
            String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
            isMockBotToken(botToken)
          )
        ) {
          await deleteQrMessage(botToken, order);
          await sendDeliveredOrderMessages({
            botToken,
            shopId: order.shopId,
            productIcon: order.sourceProduct?.productIcon,
            productIconCustomEmojiId: order.sourceProduct?.iconCustomEmojiId,
            chatId: order.customer.telegramChatId,
            orderCode: order.orderCode,
            productName: order.productNameSnapshot,
            quantity: order.quantity,
            amount: order.totalSaleAmount,
            deliveredText: result.deliveredText,
            deliveredAt,
            language: customerLanguage,
            sourceDescription: order.sourceProduct?.sourceDescription,
            metadata: sourceMetadata,
            warrantyPolicy:
              order.warrantyPolicySnapshot ||
              order.sourceProduct?.warrantyPolicy,
            shop: {
              supportTelegram: order.shop.supportTelegram,
              supportZalo: order.shop.supportZalo,
            },
          });
        }
        continue;
      }
      if (
        ["pending", "processing", "pending_stock", "pending_manual"].includes(
          String(result.status || "")
        )
      ) {
        await prisma.order
          .update({
            where: { id: order.id },
            data: {
              status: "PAID_WAITING_STOCK",
              failureReason:
                result.failureReason ||
                "Internal source order is waiting for seller handling.",
              internalSourceOrderId:
                result.providerOrderId ||
                order.internalSourceOrderId ||
                undefined,
              internalSourceOrderCode:
                result.providerOrderCode ||
                order.internalSourceOrderCode ||
                undefined,
            },
          })
          .catch(() => undefined);
        continue;
      }
      if (["failed", "canceled"].includes(String(result.status || ""))) {
        await prisma.order
          .update({
            where: { id: order.id },
            data: {
              status: "PAID_WAITING_STOCK",
              failureReason:
                result.failureReason ||
                result.message ||
                "Internal source order needs seller review.",
              internalSourceOrderId:
                result.providerOrderId ||
                order.internalSourceOrderId ||
                undefined,
              internalSourceOrderCode:
                result.providerOrderCode ||
                order.internalSourceOrderCode ||
                undefined,
            },
          })
          .catch(() => undefined);
      }
    } catch (error) {
      console.error(
        `[worker] Internal source order reconcile failed for ${order.orderCode}:`,
        formatError(error)
      );
    }
  }
}

// Roboticvn (EXTERNAL) orders whose delivery was delayed (manual-provision products,
// or briefly out-of-stock) land in PAID_WAITING_STOCK with the roboticvn order id stored
// in internalSourceOrderCode (order_xxx). roboticvn has no webhook, so we poll the order
// here and deliver once the source fulfils it. We re-check STATUS only — never re-purchase
// (roboticvn has no idempotency key; a second POST /orders would double-charge the wallet).
export async function reconcilePendingRoboticvnOrders(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: {
      status: "PAID_WAITING_STOCK",
      internalSourceOrderCode: { startsWith: "order_" },
    },
    include: {
      customer: true,
      shop: { include: { botConfig: true, providerConfig: true } },
      sourceProduct: true,
      paymentTransaction: true,
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  for (const order of orders) {
    const providerConfig = order.shop.providerConfig;
    if (!providerConfig) {
      continue;
    }
    const buyerKey = decryptSecret(
      providerConfig.buyerKeyEncrypted,
      getEncryptionKey()
    );
    if (!buyerKey) {
      continue;
    }
    // Guard: only roboticvn (routed by apk_ key prefix or host) — never touch a canboso order.
    if (!isRoboticvnProvider({ baseUrl: providerConfig.baseUrl, buyerKey })) {
      continue;
    }
    try {
      const result = await fetchProviderOrderStatus(
        {
          baseUrl: providerConfig.baseUrl,
          buyerKey,
          providerName: providerConfig.providerName,
        },
        {
          orderId: order.internalSourceOrderCode,
        }
      );
      if (!(result.status === "delivered" && result.deliveredText)) {
        continue; // still pending / not ready — leave for the next sweep
      }
      const deliveredAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "DELIVERED",
            deliveredAccountText: result.deliveredText,
            deliveredAt,
            internalSourceOrderCode:
              result.providerOrderCode ||
              order.internalSourceOrderCode ||
              undefined,
            failureReason: null,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: "upstream_purchase_success",
            payloadJson: {
              deliveredText: result.deliveredText,
              providerOrderCode:
                result.providerOrderCode ||
                order.internalSourceOrderCode ||
                null,
              note: "roboticvn delayed delivery reconciled",
            },
          },
        });
        if (order.sourceProductId) {
          await tx.sourceProduct.update({
            where: { id: order.sourceProductId },
            data: {
              soldCount: { increment: order.quantity },
              available:
                order.sourceProduct?.available === null ||
                order.sourceProduct?.available === undefined
                  ? undefined
                  : { decrement: order.quantity },
            },
          });
        }
      });
      await snapshotWarrantyForDeliveredOrder(order.id);
      await creditAffiliateCommission(order.id).catch(() => undefined);
      const botToken = decryptSecret(
        order.shop.botConfig?.telegramBotTokenEncrypted,
        getEncryptionKey()
      );
      const sourceMetadata =
        order.sourceProduct?.metadataJson &&
        typeof order.sourceProduct.metadataJson === "object" &&
        !Array.isArray(order.sourceProduct.metadataJson)
          ? (order.sourceProduct.metadataJson as Record<string, any>)
          : {};
      const customerLanguage = normalizeLanguage(
        order.customer?.preferredLanguage
      );
      if (
        botToken &&
        !(
          String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
          isMockBotToken(botToken)
        )
      ) {
        await deleteQrMessage(botToken, order);
        await sendDeliveredOrderMessages({
          botToken,
          shopId: order.shopId,
          productIcon: order.sourceProduct?.productIcon,
          productIconCustomEmojiId: order.sourceProduct?.iconCustomEmojiId,
          chatId: order.customer.telegramChatId,
          orderCode: order.orderCode,
          productName: order.productNameSnapshot,
          quantity: order.quantity,
          amount: order.totalSaleAmount,
          deliveredText: result.deliveredText,
          deliveredAt,
          language: customerLanguage,
          sourceDescription: order.sourceProduct?.sourceDescription,
          metadata: sourceMetadata,
          warrantyPolicy:
            order.warrantyPolicySnapshot ||
            order.sourceProduct?.warrantyPolicy,
          shop: {
            supportTelegram: order.shop.supportTelegram,
            supportZalo: order.shop.supportZalo,
          },
        });
      }
    } catch (error) {
      console.error(
        `[worker] Roboticvn order reconcile failed for ${order.orderCode}:`,
        formatError(error)
      );
    }
  }
}
