import {
  decryptSecret,
  isMockBotToken,
  telegramSendMessage,
  telegramDeleteMessage,
} from "@reseller/shared/server";
import { prisma } from "../infra";
import { getEncryptionKey } from "../config/env";
import { decimalToNumber, normalizeLanguage } from "../format/text";

export async function expireCustomerWalletTopups(): Promise<void> {
  const expiredTopups = await prisma.customerWalletTopup.findMany({
    where: {
      status: "PENDING",
      expiresAt: {
        lte: new Date(),
      },
    },
    include: {
      customer: true,
      shop: {
        include: {
          botConfig: true,
        },
      },
    },
    orderBy: {
      expiresAt: "asc",
    },
    take: 30,
  });

  for (const topup of expiredTopups) {
    const updated = await prisma.customerWalletTopup.updateMany({
      where: {
        id: topup.id,
        status: "PENDING",
      },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
      },
    });
    if (updated.count === 0) {
      continue;
    }
    const botToken = decryptSecret(topup.shop.botConfig?.telegramBotTokenEncrypted, getEncryptionKey());
    if (
      !botToken ||
      (String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" && isMockBotToken(botToken))
    ) {
      continue;
    }
    await telegramSendMessage(
      botToken,
      topup.customer.telegramChatId,
      [
        "⌛ Lenh nap vi da het han",
        `Ma nap: ${topup.externalOrderCode}`,
        `So tien: ${decimalToNumber(topup.amount).toLocaleString("vi-VN")}d`,
        "",
        "Lenh nap da qua 5 phut chua thanh toan va da bi huy.",
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🏦 Nap lai", callback_data: "wallet:topup" }],
            [{ text: "💳 Xem vi", callback_data: "home:wallet" }],
          ],
        },
      }
    ).catch(() => undefined);
  }
}

export async function cleanupStaleData(): Promise<void> {
  const now = new Date();
  const days90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days2 = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const [orderEventsDeleted, referralEventsDeleted, topupsDeleted, accountsCleared] = await Promise.all([
    prisma.orderEvent.deleteMany({
      where: { createdAt: { lt: days90 } },
    }),
    prisma.referralEvent.deleteMany({
      where: { createdAt: { lt: days90 } },
    }),
    prisma.customerWalletTopup.deleteMany({
      where: {
        status: { in: ["CANCELED", "FAILED"] },
        createdAt: { lt: days30 },
      },
    }),
    prisma.order.updateMany({
      where: {
        status: "DELIVERED",
        deliveredAccountText: { not: null },
        warrantyExpiresAt: { lt: days2 },
      },
      data: { deliveredAccountText: null },
    }),
  ]);

  console.log(
    `[worker] Data cleanup: orderEvents=${orderEventsDeleted.count}, referralEvents=${referralEventsDeleted.count}, topups=${topupsDeleted.count}, accountsCleared=${accountsCleared.count}`
  );
}

export async function expireAwaitingPaymentOrders(): Promise<void> {
  const now = Date.now();
  const vndCutoff = new Date(now - 5 * 60 * 1000);
  const cryptoCutoff = new Date(now - 30 * 60 * 1000);
  const orders = await prisma.order.findMany({
    where: { status: "AWAITING_PAYMENT", createdAt: { lte: vndCutoff } },
    include: {
      customer: true,
      shop: { include: { botConfig: true } },
      paymentTransaction: true,
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  for (const order of orders) {
    const isCryptoProvider =
      order.paymentTransaction?.provider === "USDT_TRC20" ||
      order.paymentTransaction?.provider === "USDT_SOL" ||
      order.paymentTransaction?.provider === "USDT_TON" ||
      order.paymentTransaction?.provider === "BINANCE" ||
      order.paymentTransaction?.provider === "OKX";
    const cutoff = isCryptoProvider ? cryptoCutoff : vndCutoff;
    if (order.createdAt > cutoff) continue;
    const timeoutLabel = isCryptoProvider ? "30 phut" : "5 phut";
    const updated = await prisma.order.updateMany({
      where: { id: order.id, status: "AWAITING_PAYMENT" },
      data: { status: "FAILED", failureReason: `Don hang het han thanh toan (${timeoutLabel}).` },
    });
    if (updated.count === 0) continue;

    const botToken = decryptSecret(order.shop.botConfig?.telegramBotTokenEncrypted, getEncryptionKey());
    if (!botToken || !order.customer?.telegramChatId) continue;
    const qrMessageId = order.paymentTransaction?.qrTelegramMessageId;
    if (qrMessageId) {
      const parsedId = Number(qrMessageId);
      if (!Number.isNaN(parsedId)) {
        await telegramDeleteMessage(botToken, order.customer.telegramChatId, parsedId).catch(() => undefined);
      }
    }
    const lang = normalizeLanguage(order.customer?.preferredLanguage);
    const msg =
      lang === "en"
        ? [
            "❌ Order cancelled",
            `Order code: ${order.orderCode}`,
            `Product: ${order.productNameSnapshot}`,
            "",
            "The order has been automatically cancelled because payment was not completed within 5 minutes.",
            "Please place a new order if you still wish to purchase.",
          ].join("\n")
        : [
            "❌ Đơn hàng đã bị hủy",
            `Mã đơn: ${order.orderCode}`,
            `Sản phẩm: ${order.productNameSnapshot}`,
            "",
            "Đơn hàng tự động hủy do không thanh toán trong vòng 5 phút.",
            "Vui lòng đặt lại nếu bạn vẫn muốn mua.",
          ].join("\n");
    await telegramSendMessage(botToken, order.customer.telegramChatId, msg).catch(() => undefined);
  }
}
