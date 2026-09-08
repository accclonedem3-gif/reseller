import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_USDT_VND_RATE,
  deriveOrderCorrelationTimestamp,
  deriveOrderCorrelationSuffix,
  resolveSellerSafeAffiliateCommission,
  decryptSecret,
  isMockBotToken,
  telegramSendMessage,
} from "@reseller/shared/server";
import { prisma } from "./infra/prisma";
import { getEncryptionKey } from "./config/env";
import { formatError } from "./format/text";

export class ConnectionBalanceError extends Error {}

export function generateInternalSourceOrderCode(
  downstreamOrderCode: string | null | undefined,
): string {
  const nowTimestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const downstreamTimestamp =
    deriveOrderCorrelationTimestamp(downstreamOrderCode);
  const correlationSuffix = deriveOrderCorrelationSuffix(
    downstreamOrderCode,
    5,
  );
  const ts = downstreamTimestamp
    ? downstreamTimestamp.slice(2)
    : nowTimestamp.slice(2, correlationSuffix ? 17 : 14);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ISO-${ts}-${correlationSuffix || rand}`;
}

export async function recordInternalSourceOrder(
  tx: any,
  params: {
    connection: any;
    order: any;
    upstreamProduct: any;
    unitPrice?: any;
    sourcePriceSnapshot?: any;
    totalAmount?: any;
    deliveredText?: string | null;
    deliveredAt: Date;
    fulfillment: string;
    canbosoProviderOrderId?: string | null;
    canbosoProviderOrderCode?: string | null;
  },
) {
  const {
    connection,
    order,
    upstreamProduct,
    unitPrice,
    sourcePriceSnapshot,
    totalAmount,
    deliveredText,
    deliveredAt,
    fulfillment,
    canbosoProviderOrderId,
    canbosoProviderOrderCode,
  } = params;
  const sourceOrderCode = generateInternalSourceOrderCode(order.orderCode);
  const created = await tx.internalSourceOrder.create({
    data: {
      connectionId: connection.id,
      apiKeyId: connection.apiKeyId,
      upstreamSellerId: connection.upstreamSellerId,
      upstreamShopId: connection.upstreamShopId,
      downstreamSellerId: connection.downstreamSellerId,
      downstreamShopId: connection.downstreamShopId,
      sourceProductId: upstreamProduct.id,
      sourceOrderCode,
      downstreamOrderCode: order.orderCode,
      quantity: order.quantity,
      unitPrice: new Prisma.Decimal(Number(unitPrice || 0).toFixed(2)),
      sourcePriceSnapshot: new Prisma.Decimal(
        Number(sourcePriceSnapshot || 0).toFixed(2),
      ),
      totalAmount: new Prisma.Decimal(Number(totalAmount || 0).toFixed(2)),
      status: "DELIVERED",
      deliveredAccountText: deliveredText || null,
      deliveredAt,
      metadataJson: {
        fulfilledVia: fulfillment,
        ...(canbosoProviderOrderId ? { canbosoProviderOrderId } : {}),
        ...(canbosoProviderOrderCode ? { canbosoProviderOrderCode } : {}),
        downstreamOrderId: order.id,
        customerEmail: order.customerEmail || null,
      },
    },
  });
  await tx.internalSourceOrderEvent.create({
    data: {
      orderId: created.id,
      eventType: "order_delivered_via_downstream_purchase",
      payloadJson: {
        downstreamOrderCode: order.orderCode,
        fulfillment,
        quantity: order.quantity,
        ...(canbosoProviderOrderId ? { canbosoProviderOrderId } : {}),
      },
    },
  });
  return created;
}

export async function getConnectionUsdtVndRate(
  connectionId: string,
): Promise<number> {
  const connection = await prisma.downstreamSourceConnection.findUnique({
    where: { id: connectionId },
    select: { upstreamShopId: true },
  });
  if (!connection) {
    throw new ConnectionBalanceError("Internal source connection not found.");
  }
  const paymentConfig = await prisma.paymentConfig.findUnique({
    where: { shopId: connection.upstreamShopId },
    select: { usdtVndRateOverride: true },
  });
  const overrideRate = Number(paymentConfig?.usdtVndRateOverride ?? NaN);
  const fallbackRate = Number(
    process.env.USDT_VND_RATE || DEFAULT_USDT_VND_RATE,
  );
  return Number.isFinite(overrideRate) && overrideRate > 0
    ? overrideRate
    : fallbackRate;
}

export async function debitConnectionBalanceTx(
  tx: any,
  connectionId: string,
  amount: number | string,
  orderId: string,
  usdtVndRate?: number,
) {
  const debitAmount = Number(amount);
  if (!Number.isFinite(debitAmount) || debitAmount <= 0) {
    throw new ConnectionBalanceError("Invalid internal source debit amount.");
  }
  const connection = await tx.downstreamSourceConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection?.downstreamTelegramChatId) {
    throw new ConnectionBalanceError(
      "Internal source connection has no linked customer wallet.",
    );
  }
  const customer = await tx.customer.findFirst({
    where: {
      shopId: connection.upstreamShopId,
      telegramChatId: connection.downstreamTelegramChatId,
    },
    select: { id: true, wallet: { select: { id: true } } },
  });
  if (!customer?.wallet) {
    throw new ConnectionBalanceError(
      "Internal source customer wallet not found.",
    );
  }

  await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`;
  const [debitCount, refundCount] = await Promise.all([
    tx.customerWalletLedger.count({
      where: {
        walletId: customer.wallet.id,
        type: "SPEND_ORDER",
        referenceType: "order",
        referenceId: orderId,
      },
    }),
    tx.customerWalletLedger.count({
      where: {
        walletId: customer.wallet.id,
        type: "REFUND_ORDER",
        referenceType: "order",
        referenceId: orderId,
      },
    }),
  ]);
  if (debitCount > refundCount) return { alreadyDebited: true };

  const freshWallet = await tx.customerWallet.findUnique({
    where: { id: customer.wallet.id },
  });
  if (!freshWallet) {
    throw new ConnectionBalanceError(
      "Internal source customer wallet not found.",
    );
  }
  const walletBefore = Number(freshWallet.balance);
  const commissionBefore = Number(freshWallet.commissionBalance);
  const availableBalance = walletBefore + commissionBefore;
  if (availableBalance < debitAmount) {
    throw new ConnectionBalanceError(
      `Insufficient source balance. Required: ${debitAmount}, available: ${availableBalance}.`,
    );
  }

  const fromCommission = Math.min(commissionBefore, debitAmount);
  const fromMain = debitAmount - fromCommission;
  const walletAfter = walletBefore - fromMain;
  const commissionAfter = commissionBefore - fromCommission;
  const safeUsdtVndRate =
    Number.isFinite(Number(usdtVndRate)) && Number(usdtVndRate) > 0
      ? Number(usdtVndRate)
      : Number(process.env.USDT_VND_RATE || DEFAULT_USDT_VND_RATE);
  const walletUsdtAfter = Math.max(
    0,
    Number(freshWallet.balanceUsdt) - fromMain / safeUsdtVndRate,
  );
  await tx.customerWallet.update({
    where: { id: freshWallet.id },
    data: {
      balance: walletAfter,
      commissionBalance: commissionAfter,
      balanceUsdt: walletUsdtAfter,
    },
  });
  await tx.customerWalletLedger.create({
    data: {
      customerId: customer.id,
      walletId: freshWallet.id,
      type: "SPEND_ORDER",
      amount: -debitAmount,
      balanceBefore: walletBefore,
      balanceAfter: walletAfter,
      commissionBalanceBefore: commissionBefore,
      commissionBalanceAfter: commissionAfter,
      referenceType: "order",
      referenceId: orderId,
      note: "Trừ số dư ví khi bot đại lý ra đơn",
    },
  });
  await tx.downstreamSourceConnection.update({
    where: { id: connectionId },
    data: { lastOrderedAt: new Date() },
  });
  await tx.internalSourceLedger.create({
    data: {
      id: randomUUID(),
      connectionId,
      type: "DEBIT_ORDER",
      amount: -debitAmount,
      balanceBefore: availableBalance,
      balanceAfter: walletAfter + commissionAfter,
      referenceType: "order",
      referenceId: orderId,
      note: "Auto debit from downstream order delivery",
    },
  });
  return { alreadyDebited: false };
}

export async function refundConnectionBalanceTx(
  tx: any,
  connectionId: string,
  orderId: string,
  usdtVndRate?: number,
) {
  const connection = await tx.downstreamSourceConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection?.downstreamTelegramChatId) return { refunded: false };
  const customer = await tx.customer.findFirst({
    where: {
      shopId: connection.upstreamShopId,
      telegramChatId: connection.downstreamTelegramChatId,
    },
    select: { id: true, wallet: { select: { id: true } } },
  });
  if (!customer?.wallet) return { refunded: false };
  await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`;
  const debits = await tx.customerWalletLedger.findMany({
    where: {
      walletId: customer.wallet.id,
      type: "SPEND_ORDER",
      referenceType: "order",
      referenceId: orderId,
    },
    orderBy: { createdAt: "asc" },
  });
  const refunds = await tx.customerWalletLedger.count({
    where: {
      walletId: customer.wallet.id,
      type: "REFUND_ORDER",
      referenceType: "order",
      referenceId: orderId,
    },
  });
  const debit = debits[refunds];
  if (!debit) return { refunded: false };
  const freshWallet = await tx.customerWallet.findUnique({
    where: { id: customer.wallet.id },
  });
  if (!freshWallet) return { refunded: false };
  const walletBefore = Number(freshWallet.balance);
  const commissionBefore = Number(freshWallet.commissionBalance);
  const refundedMain = Number(debit.balanceBefore) - Number(debit.balanceAfter);
  const refundedCommission =
    Number(debit.commissionBalanceBefore || 0) -
    Number(debit.commissionBalanceAfter || 0);
  const refundAmount = refundedMain + refundedCommission;
  const walletAfter = walletBefore + refundedMain;
  const commissionAfter = commissionBefore + refundedCommission;
  const safeUsdtVndRate =
    Number.isFinite(Number(usdtVndRate)) && Number(usdtVndRate) > 0
      ? Number(usdtVndRate)
      : Number(process.env.USDT_VND_RATE || DEFAULT_USDT_VND_RATE);
  const walletUsdtAfter = Math.max(
    0,
    Number(freshWallet.balanceUsdt) + refundedMain / safeUsdtVndRate,
  );
  await tx.customerWallet.update({
    where: { id: freshWallet.id },
    data: {
      balance: walletAfter,
      commissionBalance: commissionAfter,
      balanceUsdt: walletUsdtAfter,
    },
  });
  await tx.customerWalletLedger.create({
    data: {
      customerId: customer.id,
      walletId: freshWallet.id,
      type: "REFUND_ORDER",
      amount: refundAmount,
      balanceBefore: walletBefore,
      balanceAfter: walletAfter,
      commissionBalanceBefore: commissionBefore,
      commissionBalanceAfter: commissionAfter,
      referenceType: "order",
      referenceId: orderId,
      note: "Hoàn số dư ví nguồn cho đơn không giao thành công",
    },
  });
  await tx.downstreamSourceConnection.update({
    where: { id: connectionId },
    data: { lastOrderedAt: new Date() },
  });
  await tx.internalSourceLedger.create({
    data: {
      id: randomUUID(),
      connectionId,
      type: "REFUND_ORDER",
      amount: refundAmount,
      balanceBefore: walletBefore + commissionBefore,
      balanceAfter: walletAfter + commissionAfter,
      referenceType: "order",
      referenceId: orderId,
      note: "Refund source balance for downstream order",
    },
  });
  return { refunded: true };
}

export async function debitConnectionBalance(
  connectionId: string,
  amount: number | string,
  orderId: string,
) {
  const usdtVndRate = await getConnectionUsdtVndRate(connectionId);
  return prisma.$transaction((tx) =>
    debitConnectionBalanceTx(tx, connectionId, amount, orderId, usdtVndRate),
  );
}

export async function creditAffiliateCommission(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      shopId: true,
      customerId: true,
      totalSaleAmount: true,
      totalSourceAmount: true,
      affiliateCommission: true,
      customer: { select: { referredById: true } },
    },
  });
  const referredById = order?.customer?.referredById;
  if (!referredById) return;
  if (
    order.affiliateCommission != null &&
    Number(order.affiliateCommission) > 0
  )
    return;
  const config = await prisma.affiliateConfig.findUnique({
    where: { shopId: order.shopId },
  });
  if (!config?.enabled || !config.commissionPct) return;
  const commission = Math.round(
    resolveSellerSafeAffiliateCommission({
      totalSaleAmount: Number(order.totalSaleAmount),
      totalSourceAmount: Number(order.totalSourceAmount),
      commissionPercent: Number(config.commissionPct),
    }),
  );
  if (commission <= 0) return;
  let creditedCommissionAfter: number | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        affiliateCommission: commission,
        affiliateCustomerId: referredById,
      },
    });
    const wallet = await tx.customerWallet.upsert({
      where: { customerId: referredById },
      update: {},
      create: { customerId: referredById },
    });
    await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`;
    const fresh = await tx.customerWallet.findUnique({
      where: { id: wallet.id },
    });
    if (!fresh) return;
    const balance = Number(fresh.balance);
    const commissionBefore = Number(fresh.commissionBalance);
    const commissionAfter = commissionBefore + commission;
    await tx.customerWallet.update({
      where: { id: wallet.id },
      data: { commissionBalance: commissionAfter },
    });
    creditedCommissionAfter = commissionAfter;
    await tx.customerWalletLedger.create({
      data: {
        customerId: referredById,
        walletId: wallet.id,
        type: "AFFILIATE_COMMISSION",
        amount: commission,
        balanceBefore: balance,
        balanceAfter: balance,
        commissionBalanceBefore: commissionBefore,
        commissionBalanceAfter: commissionAfter,
        referenceType: "order",
        referenceId: orderId,
      },
    });
  });
  // Notify the referrer that their bot-wallet commission balance went up.
  if (creditedCommissionAfter != null && referredById) {
    try {
      const [ref, botCfg] = await Promise.all([
        prisma.customer.findUnique({
          where: { id: referredById },
          select: { telegramChatId: true },
        }),
        prisma.botConfig.findUnique({
          where: { shopId: order.shopId },
          select: { telegramBotTokenEncrypted: true },
        }),
      ]);
      const enc = botCfg?.telegramBotTokenEncrypted;
      const chatId = ref?.telegramChatId;
      if (enc && chatId) {
        const token = decryptSecret(enc, getEncryptionKey());
        if (token && !isMockBotToken(token)) {
          const amt = new Intl.NumberFormat("vi-VN").format(commission) + "đ";
          const bal =
            new Intl.NumberFormat("vi-VN").format(creditedCommissionAfter) +
            "đ";
          await telegramSendMessage(
            token,
            chatId,
            `🎁 Bạn vừa nhận hoa hồng: <b>+${amt}</b>\nSố dư hoa hồng: ${bal}`,
            { parse_mode: "HTML" },
          ).catch(() => undefined);
        }
      }
    } catch (error) {
      console.error("[worker] commission notify failed:", formatError(error));
    }
  }
}
