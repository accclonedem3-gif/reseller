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
import { decimalToNumber } from "../money";
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
  isDinostoreProvider,
  isDoicardProvider,
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
  DEFAULT_USDT_VND_RATE,
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

export async function refundOutOfStockOrderToCustomerWallet(input: {
  orderId: string;
  botToken?: string | null;
  reason?: string | null;
  isOutOfStock?: boolean;
}): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      shop: { include: { botConfig: true } },
      customer: true,
      sourceProduct: true,
    },
  });
  if (!order) {
    return false;
  }

  // Pre-orders explicitly agreed to wait for stock; do not auto-refund
  if (order.isPreorder) {
    return false;
  }

  // Idempotency: if already refunded or delivered, skip
  if (order.status === "REFUNDED" || order.status === "DELIVERED") {
    return false;
  }

  const isOutOfStock = input.isOutOfStock !== false;
  const orderTotal = Math.max(0, Number(order.totalSaleAmount || 0));
  const failureReason =
    input.reason ||
    (isOutOfStock
      ? "Sản phẩm đã hết hàng do có khách hàng khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn."
      : "Đơn hàng thất bại từ nhà cung cấp. Số tiền đã được hoàn vào ví bot của bạn.");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        "SELECT id FROM orders WHERE id = $1 FOR UPDATE",
        order.id
      );

      const lockedOrder = await tx.order.findUnique({
        where: { id: order.id },
      });
      if (
        !lockedOrder ||
        lockedOrder.status === "REFUNDED" ||
        lockedOrder.status === "DELIVERED"
      ) {
        return;
      }

      // Check if already refunded to wallet
      const existingRefund = await tx.customerWalletLedger.findFirst({
        where: {
          customerId: order.customerId,
          type: "REFUND_ORDER",
          referenceId: order.id,
        },
      });
      if (existingRefund) {
        return;
      }

      // Customer wallet lookup or creation
      let wallet = await tx.customerWallet.findUnique({
        where: { customerId: order.customerId },
      });
      if (!wallet) {
        wallet = await tx.customerWallet.create({
          data: { customerId: order.customerId },
        });
      }

      await tx.$queryRawUnsafe(
        "SELECT id FROM customer_wallets WHERE id = $1 FOR UPDATE",
        wallet.id
      );

      const freshWallet = await tx.customerWallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });

      // Check original wallet spend (if order was paid from wallet balance)
      const originalSpend = await tx.customerWalletLedger.findFirst({
        where: {
          customerId: order.customerId,
          type: "SPEND_ORDER",
          referenceType: "order",
          referenceId: order.id,
        },
        orderBy: { createdAt: "asc" },
      });

      const originalCommissionSpend = originalSpend
        ? Math.max(
            0,
            Number(originalSpend.commissionBalanceBefore) -
              Number(originalSpend.commissionBalanceAfter)
          )
        : 0;

      const commissionRefund = Math.min(orderTotal, originalCommissionSpend);
      const mainRefund = Math.max(0, orderTotal - commissionRefund);

      const balanceBefore = Number(freshWallet.balance);
      const commissionBalanceBefore = Number(freshWallet.commissionBalance);
      const balanceUsdtBefore = Number(freshWallet.balanceUsdt);

      const balanceAfter = balanceBefore + mainRefund;
      const commissionBalanceAfter =
        commissionBalanceBefore + commissionRefund;

      const safeUsdtVndRate = Number(
        process.env.USDT_VND_RATE || DEFAULT_USDT_VND_RATE
      );
      const balanceUsdtAfter =
        balanceUsdtBefore + mainRefund / Math.max(1, safeUsdtVndRate);

      await tx.customerWallet.update({
        where: { id: freshWallet.id },
        data: {
          balance: new Prisma.Decimal(balanceAfter.toFixed(2)),
          commissionBalance: new Prisma.Decimal(
            commissionBalanceAfter.toFixed(2)
          ),
          balanceUsdt: new Prisma.Decimal(balanceUsdtAfter.toFixed(2)),
        },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: order.customerId,
          walletId: freshWallet.id,
          type: "REFUND_ORDER",
          amount: new Prisma.Decimal(orderTotal.toFixed(2)),
          balanceBefore: new Prisma.Decimal(balanceBefore.toFixed(2)),
          balanceAfter: new Prisma.Decimal(balanceAfter.toFixed(2)),
          commissionBalanceBefore: new Prisma.Decimal(
            commissionBalanceBefore.toFixed(2)
          ),
          commissionBalanceAfter: new Prisma.Decimal(
            commissionBalanceAfter.toFixed(2)
          ),
          referenceType: isOutOfStock ? "race_out_of_stock" : "upstream_failed",
          referenceId: order.id,
          note: isOutOfStock
            ? `Hoàn tiền đơn hàng ${order.orderCode} do hết hàng (khách khác thanh toán trước)`
            : `Hoàn tiền đơn hàng ${order.orderCode} do lỗi nguồn hàng (${failureReason})`,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "REFUNDED",
          paymentStatus: "REFUNDED",
          failureReason,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: isOutOfStock ? "race_out_of_stock_refund" : "upstream_failed_refund",
          payloadJson: {
            refundAmount: orderTotal,
            reason: failureReason,
            balanceAfter,
            commissionBalanceAfter,
          },
        },
      });
    });
  } catch (txErr) {
    console.error(
      `[refundOutOfStockOrder] transaction error for order ${order.orderCode}:`,
      formatError(txErr)
    );
    return false;
  }

  // Send customer Telegram notification
  const resolvedBotToken =
    input.botToken ||
    decryptSecret(
      order.shop.botConfig?.telegramBotTokenEncrypted,
      getEncryptionKey()
    );

  if (
    resolvedBotToken &&
    !(
      String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
      isMockBotToken(resolvedBotToken)
    ) &&
    order.customer?.telegramChatId
  ) {
    await deleteQrMessage(resolvedBotToken, order);

    const lang = normalizeLanguage(order.customer?.preferredLanguage);
    const formattedAmount = formatVndMoney(orderTotal);
    const prodName = order.productNameSnapshot || "sản phẩm";

    let msg = "";
    let walletBtnText = "";
    let shopBtnText = "";

    if (lang === "en") {
      msg = isOutOfStock
        ? [
            "⚠️ <b>OUT OF STOCK & REFUNDED TO WALLET</b>",
            "",
            `We are sorry, <b>${prodName}</b> (Qty: <b>${order.quantity}</b>) for order <code>${order.orderCode}</code> is <b>out of stock</b> because another customer completed payment first.`,
            "",
            `💰 <b>Amount:</b> <code>${formattedAmount}</code> has been <b>100% refunded to your bot wallet</b>!`,
            "You can use your wallet balance to place a new order or purchase other products anytime.",
          ].join("\n")
        : [
            "⚠️ <b>ORDER FAILED & REFUNDED TO WALLET</b>",
            "",
            `We are sorry, your order <code>${order.orderCode}</code> for <b>${prodName}</b> (Qty: <b>${order.quantity}</b>) could not be fulfilled (${failureReason}).`,
            "",
            `💰 <b>Amount:</b> <code>${formattedAmount}</code> has been <b>100% refunded to your bot wallet</b>!`,
            "You can use your wallet balance to place a new order or purchase other products anytime.",
          ].join("\n");
      walletBtnText = "💳 View bot wallet";
      shopBtnText = "🛍️ Continue shopping";
    } else {
      msg = isOutOfStock
        ? [
            "⚠️ <b>THÔNG BÁO HẾT HÀNG & HOÀN TIỀN VÀO VÍ</b>",
            "",
            `Rất tiếc, sản phẩm <b>${prodName}</b> (Số lượng: <b>${order.quantity}</b>) trong đơn hàng <code>${order.orderCode}</code> đã <b>hết hàng</b> do có khách hàng khác nhanh tay thanh toán trước.`,
            "",
            `💰 <b>Số tiền:</b> <code>${formattedAmount}</code> đã được <b>hoàn 100% vào số dư ví bot</b> của bạn!`,
            "Bạn có thể dùng số dư ví để mua sản phẩm khác bất cứ lúc nào.",
          ].join("\n")
        : [
            "⚠️ <b>THÔNG BÁO HỦY ĐƠN & HOÀN TIỀN VÀO VÍ</b>",
            "",
            `Rất tiếc, đơn hàng <code>${order.orderCode}</code> mua <b>${prodName}</b> (Số lượng: <b>${order.quantity}</b>) không thể hoàn tất do lỗi nhà cung cấp (${failureReason}).`,
            "",
            `💰 <b>Số tiền:</b> <code>${formattedAmount}</code> đã được <b>hoàn 100% vào số dư ví bot</b> của bạn!`,
            "Bạn có thể dùng số dư ví để mua sản phẩm khác bất cứ lúc nào.",
          ].join("\n");
      walletBtnText = "💳 Xem ví bot";
      shopBtnText = "🛍️ Tiếp tục mua sắm";
    }

    const supportLines: string[] = [];
    if (order.shop?.supportTelegram) {
      supportLines.push(
        `💬 Support Telegram: @${order.shop.supportTelegram.replace(/^@/, "")}`
      );
    }
    if (order.shop?.supportZalo) {
      supportLines.push(`📞 Hotline/Zalo: ${order.shop.supportZalo}`);
    }
    if (supportLines.length > 0) {
      msg += `\n\n${supportLines.join("\n")}`;
    }

    await telegramSendMessage(
      resolvedBotToken,
      order.customer.telegramChatId,
      msg,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: walletBtnText, callback_data: "home:wallet" }],
            [{ text: shopBtnText, callback_data: "home:products" }],
          ],
        },
      }
    ).catch((err) => {
      console.warn(
        `[refundOutOfStockOrder] failed to send Telegram notification for ${order.orderCode}:`,
        err
      );
    });
  }

  return true;
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

function isManualSourceProduct(product: any): boolean {
  const metadata =
    product?.metadataJson &&
    typeof product.metadataJson === "object" &&
    !Array.isArray(product.metadataJson)
      ? product.metadataJson
      : {};
  return (
    String(product?.providerName || "").toLowerCase() === "manual" ||
    metadata.manual === true
  );
}

export async function getPreorderAvailableQuantity(product: any): Promise<number> {
  if (!product) return 0;
  const metadata =
    product.metadataJson &&
    typeof product.metadataJson === "object" &&
    !Array.isArray(product.metadataJson)
      ? product.metadataJson
      : {};
  if (
    isManualSourceProduct(product) &&
    metadata.shared !== true &&
    product.sourceDeliveryMode !== "ADD_MAIL"
  ) {
    return countAvailableManualEntries(prisma, product.id);
  }
  if (product.available === null || product.available === undefined)
    return Number.POSITIVE_INFINITY;
  return Math.max(0, Number(product.available) || 0);
}

export async function getPaidPreorderQueue(sourceProductId: string) {
  return prisma.order.findMany({
    where: {
      sourceProductId,
      isPreorder: true,
      paymentStatus: "PAID",
      status: { in: ["PAID", "PROCESSING_PURCHASE", "PAID_WAITING_STOCK"] },
    },
    select: {
      id: true,
      quantity: true,
      paidAt: true,
      createdAt: true,
      status: true,
      preorderCancellationStatus: true,
    },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

export async function movePreorderToWaiting(
  order: any,
  availableQuantity: number
): Promise<void> {
  if (!order.sourceProductId) return;
  const queue = await getPaidPreorderQueue(order.sourceProductId);
  const queueIndex = queue.findIndex((item) => item.id === order.id);
  const queuePosition = queueIndex >= 0 ? queueIndex + 1 : 1;
  const reason =
    queueIndex > 0
      ? "Don dat truoc dang cho den luot FIFO."
      : "Don dat truoc da thanh toan, dang cho hang ve.";
  const moved = await prisma.order.updateMany({
    where: { id: order.id, status: "PROCESSING_PURCHASE" },
    data: { status: "PAID_WAITING_STOCK", failureReason: reason },
  });
  if (moved.count === 0) return;
  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      eventType: "preorder_waiting_stock",
      payloadJson: {
        queuePosition,
        availableQuantity: Number.isFinite(availableQuantity)
          ? availableQuantity
          : null,
        requestedQuantity: order.quantity,
      },
    },
  });
  const alreadyNotified = await prisma.orderEvent.findFirst({
    where: {
      orderId: order.id,
      eventType: "preorder_waiting_confirmation_sent",
    },
    select: { id: true },
  });
  if (alreadyNotified) return;
  const encryptedToken = order.shop?.botConfig?.telegramBotTokenEncrypted;
  const chatId = order.customer?.telegramChatId;
  if (!encryptedToken || !chatId) return;
  const botToken = decryptSecret(encryptedToken, getEncryptionKey());
  if (
    !botToken ||
    (String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
      isMockBotToken(botToken))
  )
    return;
  const language: string = normalizeLanguage(order.customer?.preferredLanguage);
  const formatter = new Intl.NumberFormat(
    language === "en" ? "en-US" : language === "th" ? "th-TH" : "vi-VN"
  );
  const total = `${formatter.format(decimalToNumber(order.totalSaleAmount))}đ`;
  const fee = `${formatter.format(decimalToNumber(order.preorderFeeAmount))}đ`;
  const feePercent = decimalToNumber(order.preorderFeePercent);
  const message =
    language === "en"
      ? `🕒 Pre-order payment confirmed\nOrder: ${order.orderCode}\nProduct: ${order.productNameSnapshot}\nQuantity: ${order.quantity}\nPre-order fee (${feePercent}%): ${fee}\nTotal paid: ${total}\nFIFO position: #${queuePosition}\n\nThe bot will deliver and notify you automatically when stock arrives.`
      : language === "th"
        ? `🕒 ยืนยันการชำระเงินคำสั่งจองแล้ว\nคำสั่งซื้อ: ${order.orderCode}\nสินค้า: ${order.productNameSnapshot}\nจำนวน: ${order.quantity}\nค่าจอง (${feePercent}%): ${fee}\nยอดชำระ: ${total}\nลำดับ FIFO: #${queuePosition}\n\nบอทจะส่งสินค้าและแจ้งเตือนอัตโนมัติเมื่อมีสินค้า`
        : `🕒 Đã xác nhận thanh toán đơn đặt trước\nMã đơn: ${order.orderCode}\nSản phẩm: ${order.productNameSnapshot}\nSố lượng: ${order.quantity}\nPhí đặt trước (${feePercent}%): ${fee}\nTổng đã thanh toán: ${total}\nVị trí FIFO: #${queuePosition}\n\nKhi hàng về, bot sẽ tự động giao và thông báo cho bạn.`;
  const sent = await telegramSendMessage(botToken, chatId, message)
    .then(() => true)
    .catch(() => false);
  if (sent) {
    await prisma.orderEvent
      .create({
        data: {
          orderId: order.id,
          eventType: "preorder_waiting_confirmation_sent",
          payloadJson: { queuePosition },
        },
      })
      .catch(() => undefined);
  }
}

export async function enqueueWaitingPreorder(
  queue: Queue,
  order: any
): Promise<boolean> {
  const claimed = await prisma.order.updateMany({
    where: {
      id: order.id,
      isPreorder: true,
      paymentStatus: "PAID",
      status: "PAID_WAITING_STOCK",
      preorderCancellationStatus: { not: "REQUESTED" },
    },
    data: { status: "PROCESSING_PURCHASE", failureReason: null },
  });
  if (claimed.count === 0) return false;
  try {
    await queue.add(
      JOBS.purchaseUpstream,
      { orderId: order.id },
      {
        jobId: `preorder-${order.id}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    );
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: "preorder_fulfillment_enqueued",
        payloadJson: {
          note: "Stock is available; queued for FIFO fulfillment.",
        },
      },
    });
    return true;
  } catch (error) {
    await prisma.order
      .updateMany({
        where: { id: order.id, status: "PROCESSING_PURCHASE" },
        data: {
          status: "PAID_WAITING_STOCK",
          failureReason:
            error instanceof Error
              ? error.message
              : "Pre-order enqueue failed.",
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

let preorderSweepRunning = false;
export async function enqueueFulfillablePreorders(queue: Queue): Promise<void> {
  if (preorderSweepRunning) return;
  preorderSweepRunning = true;
  try {
    const waiting = await prisma.order.findMany({
      where: {
        isPreorder: true,
        paymentStatus: "PAID",
        status: "PAID_WAITING_STOCK",
        preorderCancellationStatus: { not: "REQUESTED" },
      },
      select: { sourceProductId: true },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: 200,
    });
    const productIds = Array.from(
      new Set(waiting.map((order) => order.sourceProductId).filter(Boolean))
    ) as string[];
    for (const sourceProductId of productIds) {
      const [product, fifo] = await Promise.all([
        prisma.sourceProduct.findUnique({ where: { id: sourceProductId } }),
        getPaidPreorderQueue(sourceProductId),
      ]);
      if (!product || fifo.length === 0) continue;
      let remainingAvailable = await getPreorderAvailableQuantity(product);
      for (const waitingOrder of fifo) {
        if (
          waitingOrder.status !== "PAID_WAITING_STOCK" ||
          waitingOrder.preorderCancellationStatus === "REQUESTED"
        )
          continue;
        if (remainingAvailable < waitingOrder.quantity) break;
        const enqueued = await enqueueWaitingPreorder(queue, waitingOrder);
        if (enqueued) {
          remainingAvailable -= waitingOrder.quantity;
        }
      }
    }
  } finally {
    preorderSweepRunning = false;
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
      sourceProduct: {
        include: {
          providerSource: true,
        },
      },
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
  const internalSourceConnId =
    order.sourceProduct?.internalSourceConnectionId ||
    (order.sourceProduct?.sourceScope?.startsWith("internal:")
      ? order.sourceProduct.sourceScope.replace("internal:", "")
      : null) ||
    order.shop.providerConfig?.internalSourceConnectionId ||
    null;
  const isInternalSource = Boolean(
    internalSourceConnId ||
    order.sourceProviderKindSnapshot === "INTERNAL" ||
    order.sourceProduct?.providerName === "internal_pro" ||
    order.shop.providerConfig?.providerKind === "INTERNAL"
  );

  // Resolve provider configuration for external products:
  // Prefer the direct ShopProviderSource assigned to the product (multi-provider support),
  // falling back to the shop's legacy single-source providerConfig.
  let directProviderSource = order.sourceProduct?.providerSource;
  if (!directProviderSource && order.sourceProduct?.providerSourceId) {
    directProviderSource = await prisma.shopProviderSource.findUnique({
      where: { id: order.sourceProduct.providerSourceId },
    });
  }

  const providerConfig = directProviderSource
    ? {
        id: directProviderSource.id,
        shopId: directProviderSource.shopId,
        providerKind: "EXTERNAL" as const,
        providerName: directProviderSource.providerName,
        baseUrl: directProviderSource.baseUrl,
        buyerKeyEncrypted: directProviderSource.buyerKeyEncrypted,
        internalSourceConnectionId: null,
        sourceWebhookKey: null,
        sourceNotificationSyncEnabled:
          directProviderSource.sourceNotificationSyncEnabled,
        ownProductsOnly: false,
        priceMarkupPercent: directProviderSource.priceMarkupPercent,
        connectionStatus: directProviderSource.connectionStatus,
        lastVerifiedAt: directProviderSource.lastVerifiedAt,
        createdAt: directProviderSource.createdAt,
        updatedAt: directProviderSource.updatedAt,
      }
    : order.shop.providerConfig;

  if (!isManualProduct && !isInternalSource && !providerConfig) {
    return;
  }

  if (order.isPreorder === true) {
    if (
      order.status !== "PROCESSING_PURCHASE" ||
      order.paymentStatus !== "PAID"
    )
      return;
    if (order.preorderCancellationStatus === "REQUESTED") {
      await prisma.order.updateMany({
        where: {
          id: order.id,
          status: "PROCESSING_PURCHASE",
          preorderCancellationStatus: "REQUESTED",
        },
        data: {
          status: "PAID_WAITING_STOCK",
          failureReason:
            "Khach da yeu cau huy. Don tam khoa giao hang de cho seller duyet.",
        },
      });
      return;
    }
    const [preorderQueue, availableQuantity] = await Promise.all([
      getPaidPreorderQueue(order.sourceProductId!),
      getPreorderAvailableQuantity(order.sourceProduct),
    ]);
    const isFirstInQueue = preorderQueue[0]?.id === order.id;
    if (!isFirstInQueue || availableQuantity < order.quantity) {
      await movePreorderToWaiting(order, availableQuantity);
      return;
    }
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
      if (
        order.sourceProduct?.available !== null &&
        order.sourceProduct?.available !== undefined &&
        currentAvailable < order.quantity
      ) {
        if (!order.isPreorder) {
          await refundOutOfStockOrderToCustomerWallet({
            orderId: order.id,
            botToken,
            reason:
              "Sản phẩm đã hết hàng do có khách hàng khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn.",
          });
          return;
        }
      }
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
            if (!order.isPreorder) {
              throw Symbol.for("race_out_of_stock_refund");
            }
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
        if (e === Symbol.for("race_out_of_stock_refund")) {
          await refundOutOfStockOrderToCustomerWallet({
            orderId: order.id,
            botToken,
            reason:
              "Kho tài khoản tự động đã hết hàng do có khách khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn.",
          });
          return;
        }
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
      if (!order.isPreorder) {
        await refundOutOfStockOrderToCustomerWallet({
          orderId: order.id,
          botToken,
          reason:
            "Kho tài khoản tự động không đủ số lượng do có khách khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn.",
        });
        return;
      }
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
            data: {
              available: Math.max(
                0,
                (order.sourceProduct.available ?? 0) - order.quantity
              ),
            },
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

    const isAddMail =
      order.sourceProduct?.sourceDeliveryMode === "ADD_MAIL" ||
      sourceMetadata.requiresCustomerEmail === true;

    if (!isAddMail && !order.isPreorder) {
      await refundOutOfStockOrderToCustomerWallet({
        orderId: order.id,
        botToken,
        reason:
          "Kho tài khoản tự động đã hết hàng do có khách khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn.",
      });
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
          data: {
            available: Math.max(
              0,
              (order.sourceProduct.available ?? 0) - order.quantity
            ),
          },
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

  if (!isInternalSource && !providerConfig) {
    return;
  }

  // INTERNAL source: pull delivery entries directly from upstream ULTRA product
  if (isInternalSource && internalSourceConnId) {
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
        where: { id: internalSourceConnId },
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
            if (!order.isPreorder) {
              throw Symbol.for("upstream_race_out_of_stock_refund");
            }
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
        if (e === Symbol.for("upstream_race_out_of_stock_refund")) {
          await refundOutOfStockOrderToCustomerWallet({
            orderId: order.id,
            botToken,
            reason:
              "Nguồn sản phẩm nội bộ đã hết hàng do có khách khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn.",
          });
          return;
        }
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
          internalSourceConnId,
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

    // No manual delivery entries — check if upstream shop can purchase from external provider
    const upstreamDirectSource = upstreamProduct?.providerSourceId
      ? await prisma.shopProviderSource.findUnique({
          where: { id: upstreamProduct.providerSourceId },
        })
      : null;

    const resolvedUpstreamConfig = upstreamDirectSource
      ? {
          baseUrl: upstreamDirectSource.baseUrl,
          buyerKeyEncrypted: upstreamDirectSource.buyerKeyEncrypted,
          providerName: upstreamDirectSource.providerName,
          providerKind: "EXTERNAL" as const,
        }
      : upstreamConnection?.upstreamShop?.providerConfig;

    const isUpstreamProductExternal =
      upstreamProduct?.providerName !== "manual" &&
      !upstreamMetadata.manual &&
      Boolean(upstreamProduct?.externalProductId) &&
      !upstreamProduct?.externalProductId?.startsWith("manual_");

    let upstreamBuyerKey: string | null = null;
    if (
      isUpstreamProductExternal &&
      resolvedUpstreamConfig?.providerKind === "EXTERNAL" &&
      resolvedUpstreamConfig?.buyerKeyEncrypted
    ) {
      upstreamBuyerKey = decryptSecret(
        resolvedUpstreamConfig.buyerKeyEncrypted,
        getEncryptionKey()
      );
    }

    if (
      isUpstreamProductExternal &&
      resolvedUpstreamConfig?.providerKind === "EXTERNAL" &&
      upstreamBuyerKey &&
      upstreamProduct?.externalProductId
    ) {
      const upstreamResult = await purchaseFromProvider(
        {
          baseUrl: resolvedUpstreamConfig.baseUrl,
          buyerKey: upstreamBuyerKey,
          providerName: resolvedUpstreamConfig.providerName,
          timeoutMs: 120000,
        },
        {
          productId: upstreamProduct.externalProductId,
          quantity: order.quantity,
          customerEmail: order.customerEmail || null,
          targetLink: (order as any).targetLink || null,
          comments: (order as any).comments || null,
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
              providerOrderId: upstreamResult.providerOrderId || undefined,
              providerOrderCode: upstreamResult.providerOrderCode || undefined,
              ...(createdInternalSourceOrderId
                ? { internalSourceOrderId: createdInternalSourceOrderId }
                : {}),
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
                    : Math.max(
                        0,
                        (order.sourceProduct.available ?? 0) - order.quantity
                      ),
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
            internalSourceConnId,
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

      if (!upstreamResult.success && !upstreamResult.pending && !order.isPreorder) {
        await refundOutOfStockOrderToCustomerWallet({
          orderId: order.id,
          botToken,
          isOutOfStock: Boolean(upstreamResult.outOfStock),
          reason:
            upstreamResult.message ||
            (upstreamResult.outOfStock
              ? "Nguồn hàng tạm hết do có khách khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn."
              : "Đơn hàng thất bại từ nhà cung cấp. Số tiền đã được hoàn vào ví bot của bạn."),
        });
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
            providerOrderId: upstreamResult.providerOrderId || undefined,
            providerOrderCode:
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
        await deleteQrMessage(botToken, order);
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

    // Upstream has no immediate stock:
    // Check if upstream product is manual or requires seller processing (ADD_MAIL, manual slot, etc.)
    const isManualUpstream =
      upstreamProduct?.providerName === "manual" ||
      upstreamMetadata.manual === true ||
      upstreamProduct?.sourceDeliveryMode === "ADD_MAIL" ||
      upstreamMetadata.requiresCustomerEmail === true;

    if (isManualUpstream && upstreamConnection && upstreamProduct) {
      const unitPriceISO =
        order.quantity > 0
          ? Number(order.totalSourceAmount || 0) / order.quantity
          : Number(order.totalSourceAmount || 0);
      const sourcePriceSnapshotISO = upstreamProduct.sourcePrice
        ? Number(upstreamProduct.sourcePrice)
        : 0;

      await prisma.$transaction(async (tx) => {
        const isoRow = await recordInternalSourceOrder(tx, {
          connection: upstreamConnection,
          order,
          upstreamProduct,
          unitPrice: unitPriceISO,
          sourcePriceSnapshot: sourcePriceSnapshotISO,
          totalAmount: Number(order.totalSourceAmount || 0),
          deliveredText: null,
          deliveredAt: null,
          fulfillment: "ultra_manual_pending",
          status: "PENDING_MANUAL",
          failureReason: "Sản phẩm đang chờ shop nguồn xử lý thủ công.",
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "PAID_WAITING_STOCK",
            failureReason: "Sản phẩm đang chờ shop nguồn xử lý thủ công.",
            internalSourceOrderId: isoRow.id,
            internalSourceOrderCode: isoRow.sourceOrderCode,
          },
        });

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: "internal_source_pending_manual",
            payloadJson: {
              message: "Đơn hàng manual đã tạo trên shop nguồn, đang chờ shop nguồn xử lý.",
              internalSourceOrderId: isoRow.id,
              internalSourceOrderCode: isoRow.sourceOrderCode,
              customerEmail: order.customerEmail || null,
            },
          },
        });

        if (order.sourceProductId) {
          await tx.sourceProduct.update({
            where: { id: order.sourceProductId },
            data: {
              available:
                order.sourceProduct?.available === null ||
                order.sourceProduct?.available === undefined
                  ? undefined
                  : Math.max(
                      0,
                      (order.sourceProduct.available ?? 0) - order.quantity
                    ),
            },
          });
        }
        if (upstreamProduct) {
          await tx.sourceProduct.update({
            where: { id: upstreamProduct.id },
            data: {
              soldCount: { increment: order.quantity },
              available:
                upstreamProduct.available === null ||
                upstreamProduct.available === undefined
                  ? undefined
                  : Math.max(
                      0,
                      (upstreamProduct.available ?? 0) - order.quantity
                    ),
            },
          });
        }
      });

      const totalSourceAmount = Number(order.totalSourceAmount || 0);
      if (totalSourceAmount > 0) {
        await debitConnectionBalance(
          internalSourceConnId,
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

    // Upstream has no stock — wait for ULTRA to add entries
    if (!order.isPreorder) {
      await refundOutOfStockOrderToCustomerWallet({
        orderId: order.id,
        botToken,
        reason:
          "Nguồn sản phẩm nội bộ đã hết hàng do có khách khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn.",
      });
      return;
    }

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
      await deleteQrMessage(botToken, order);
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

  if (!providerConfig) {
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
          if (!order.isPreorder) {
            await refundOutOfStockOrderToCustomerWallet({
              orderId: order.id,
              botToken,
              reason:
                "Sản phẩm tạm hết hàng bên nhà cung cấp do có khách khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn.",
            });
            return;
          }
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
          providerName: providerConfig.providerName,
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
          if (!order.isPreorder) {
            await refundOutOfStockOrderToCustomerWallet({
              orderId: order.id,
              botToken,
              reason:
                "Sản phẩm tạm hết hàng bên nhà cung cấp do có khách khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn.",
            });
            return;
          }
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
            providerName: providerConfig.providerName,
            timeoutMs: 120000,
          },
          {
            productId: order.sourceProduct?.externalProductId || "",
            quantity: order.quantity,
            customerEmail: order.customerEmail || null,
            targetLink: (order as any).targetLink || null,
            comments: (order as any).comments || null,
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
          providerOrderId: result.providerOrderId || undefined,
          providerOrderCode: result.providerOrderCode || undefined,
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
                : Math.max(
                    0,
                    (order.sourceProduct.available ?? 0) - order.quantity
                  ),
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

  if (!result.success && !result.pending && !order.isPreorder) {
    await refundOutOfStockOrderToCustomerWallet({
      orderId: order.id,
      botToken,
      isOutOfStock: Boolean(result.outOfStock),
      reason:
        result.message ||
        (result.outOfStock
          ? "Sản phẩm tạm hết hàng bên nhà cung cấp do có khách hàng khác thanh toán trước. Số tiền đã được hoàn vào ví bot của bạn."
          : "Đơn hàng thất bại từ nhà cung cấp. Số tiền đã được hoàn vào ví bot của bạn."),
    });
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
        providerOrderId: result.providerOrderId || undefined,
        providerOrderCode: result.providerOrderCode || undefined,
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
    // 1. Direct DB lookup if internalSourceOrderId is present
    if (order.internalSourceOrderId) {
      const iso = await prisma.internalSourceOrder.findUnique({
        where: { id: order.internalSourceOrderId },
      });
      if (iso) {
        if (iso.status === "DELIVERED" && iso.deliveredAccountText) {
          const deliveredAt = iso.deliveredAt || new Date();
          const deliveredText = iso.deliveredAccountText;
          await prisma.$transaction(async (tx) => {
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: "DELIVERED",
                deliveredAccountText: deliveredText,
                deliveredAt,
                internalSourceOrderId: iso.id,
                internalSourceOrderCode: iso.sourceOrderCode,
                failureReason: null,
              },
            });
            await tx.orderEvent.create({
              data: {
                orderId: order.id,
                eventType: "internal_source_order_delivered",
                payloadJson: {
                  internalSourceOrderId: iso.id,
                  internalSourceOrderCode: iso.sourceOrderCode,
                  deliveredText,
                  deliveredAt,
                },
              },
            });
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
              deliveredText,
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
        } else if (iso.status === "FAILED" || iso.status === "CANCELED") {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              status: "FAILED",
              failureReason: iso.failureReason || "Đơn hàng nguồn đã bị hủy.",
            },
          });
          continue;
        }
        // Still pending (PENDING_MANUAL, PENDING_STOCK, etc.) - wait for upstream delivery
        continue;
      }
    }

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
          orderId: order.internalSourceOrderId || order.providerOrderId || undefined,
          orderCode:
            order.internalSourceOrderCode ||
            order.providerOrderCode ||
            order.orderCode ||
            undefined,
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
              providerOrderId:
                result.providerOrderId ||
                order.providerOrderId ||
                undefined,
              providerOrderCode:
                result.providerOrderCode ||
                order.providerOrderCode ||
                undefined,
              internalSourceOrderId:
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
                    : Math.max(
                        0,
                        (order.sourceProduct.available ?? 0) - order.quantity
                      ),
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
              providerOrderId:
                result.providerOrderId ||
                order.providerOrderId ||
                undefined,
              providerOrderCode:
                result.providerOrderCode ||
                order.providerOrderCode ||
                undefined,
              internalSourceOrderId:
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
              providerOrderId:
                result.providerOrderId ||
                order.providerOrderId ||
                undefined,
              providerOrderCode:
                result.providerOrderCode ||
                order.providerOrderCode ||
                undefined,
              internalSourceOrderId:
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
      OR: [
        { providerOrderCode: { not: null } },
        { providerOrderId: { not: null } },
        { internalSourceOrderCode: { not: null } },
      ],
    },
    include: {
      customer: true,
      shop: { include: { botConfig: true, providerConfig: true } },
      sourceProduct: {
        include: {
          providerSource: true,
        },
      },
      paymentTransaction: true,
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  for (const order of orders) {
    const directProviderSource =
      order.sourceProduct?.providerSource ||
      (order.sourceProduct?.providerSourceId
        ? await prisma.shopProviderSource.findUnique({
            where: { id: order.sourceProduct.providerSourceId },
          })
        : null);

    const providerConfig = directProviderSource
      ? {
          baseUrl: directProviderSource.baseUrl,
          buyerKeyEncrypted: directProviderSource.buyerKeyEncrypted,
          providerName: directProviderSource.providerName,
        }
      : order.shop.providerConfig;

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
    // Guard: only roboticvn and dinostore — never touch a canboso order.
    if (
      !isRoboticvnProvider({ baseUrl: providerConfig.baseUrl, buyerKey }) &&
      !isDinostoreProvider({
        baseUrl: providerConfig.baseUrl,
        buyerKey,
        providerName: providerConfig.providerName,
      }) &&
      !isDoicardProvider({
        baseUrl: providerConfig.baseUrl,
        buyerKey,
        providerName: providerConfig.providerName,
      })
    ) {
      continue;
    }
    try {
      const orderRef =
        order.providerOrderCode ||
        order.providerOrderId ||
        order.internalSourceOrderCode ||
        order.orderCode;
      const result = await fetchProviderOrderStatus(
        {
          baseUrl: providerConfig.baseUrl,
          buyerKey,
          providerName: providerConfig.providerName,
        },
        {
          orderId: orderRef,
          orderCode: orderRef,
        }
      );
      if (result.status === "failed") {
        const botToken = decryptSecret(
          order.shop.botConfig?.telegramBotTokenEncrypted,
          getEncryptionKey()
        );
        await refundOutOfStockOrderToCustomerWallet({
          orderId: order.id,
          botToken,
          isOutOfStock: false,
          reason:
            result.message ||
            "Nhà cung cấp đã hủy hoặc không thể hoàn thành đơn hàng. Số tiền đã được hoàn lại vào ví của bạn.",
        });
        continue;
      }
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
            providerOrderId:
              result.providerOrderId ||
              order.providerOrderId ||
              undefined,
            providerOrderCode:
              result.providerOrderCode ||
              order.providerOrderCode ||
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
              providerOrderId:
                result.providerOrderId ||
                order.providerOrderId ||
                null,
              providerOrderCode:
                result.providerOrderCode ||
                order.providerOrderCode ||
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
                  : Math.max(
                      0,
                      (order.sourceProduct.available ?? 0) - order.quantity
                    ),
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
