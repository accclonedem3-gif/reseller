import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

import { refundOutOfStockOrderToCustomerWallet } from "../src/fulfillment/purchase";
import { prisma } from "../src/infra/prisma";

process.env.MOCK_TELEGRAM_MODE = "true";

test("refundOutOfStockOrderToCustomerWallet - standard cash/QR order refund", async () => {
  const originalFindUnique = prisma.order.findUnique;
  const originalTransaction = prisma.$transaction;

  let walletBalance = 0;
  let walletCommission = 0;
  let orderStatus = "PAID";
  let paymentStatus = "PAID";
  const ledgerEntries: any[] = [];

  const mockOrder: any = {
    id: "order-test-1",
    orderCode: "ORD-RACE-1",
    customerId: "cust-1",
    isPreorder: false,
    status: "PAID",
    paymentStatus: "PAID",
    totalSaleAmount: new Prisma.Decimal(100000),
    quantity: 5,
    productNameSnapshot: "Netflix Premium",
    customer: {
      id: "cust-1",
      telegramChatId: "123456789",
      preferredLanguage: "vi",
    },
    shop: {
      id: "shop-1",
      botConfig: {
        telegramBotTokenEncrypted: "enc_token",
      },
    },
    sourceProduct: {
      id: "prod-1",
    },
  };

  const mockTx: any = {
    $queryRawUnsafe: async () => [],
    order: {
      findUnique: async () => ({ ...mockOrder, status: orderStatus, paymentStatus }),
      update: async (args: any) => {
        orderStatus = args.data.status;
        paymentStatus = args.data.paymentStatus;
        return { ...mockOrder, ...args.data };
      },
    },
    customerWallet: {
      findUnique: async () => ({
        id: "wallet-1",
        customerId: "cust-1",
        balance: new Prisma.Decimal(walletBalance),
        commissionBalance: new Prisma.Decimal(walletCommission),
        balanceUsdt: new Prisma.Decimal(walletBalance / 25000),
      }),
      findUniqueOrThrow: async () => ({
        id: "wallet-1",
        customerId: "cust-1",
        balance: new Prisma.Decimal(walletBalance),
        commissionBalance: new Prisma.Decimal(walletCommission),
        balanceUsdt: new Prisma.Decimal(walletBalance / 25000),
      }),
      create: async () => ({ id: "wallet-1" }),
      update: async (args: any) => {
        walletBalance = Number(args.data.balance);
        walletCommission = Number(args.data.commissionBalance);
        return { id: "wallet-1" };
      },
    },
    customerWalletLedger: {
      findFirst: async (args: any) => {
        if (args.where?.type === "REFUND_ORDER") {
          return ledgerEntries.find((l) => l.type === "REFUND_ORDER" && l.referenceId === args.where.referenceId) || null;
        }
        if (args.where?.type === "SPEND_ORDER") {
          return null;
        }
        return null;
      },
      create: async (args: any) => {
        ledgerEntries.push(args.data);
        return { id: "ledger-1", ...args.data };
      },
    },
    orderEvent: {
      create: async () => ({ id: "event-1" }),
    },
  };

  // @ts-ignore
  prisma.order.findUnique = async () => ({ ...mockOrder, status: orderStatus, paymentStatus });
  // @ts-ignore
  prisma.$transaction = async (cb: any) => cb(mockTx);

  try {
    const refunded = await refundOutOfStockOrderToCustomerWallet({
      orderId: "order-test-1",
      botToken: "mock:token",
      reason: "Kho hết hàng do khách khác thanh toán trước.",
    });

    assert.equal(refunded, true, "First refund call must succeed");
    assert.equal(walletBalance, 100000, "Wallet balance must be credited 100,000 VND");
    assert.equal(walletCommission, 0, "Commission balance must remain 0");
    assert.equal(orderStatus, "REFUNDED", "Order status must be REFUNDED");
    assert.equal(paymentStatus, "REFUNDED", "Payment status must be REFUNDED");
    assert.equal(ledgerEntries.length, 1, "Exactly 1 ledger entry must be created");
    assert.equal(ledgerEntries[0].type, "REFUND_ORDER", "Ledger entry must be REFUND_ORDER");
    assert.equal(ledgerEntries[0].referenceType, "race_out_of_stock", "Reference type must be race_out_of_stock");

    const secondRefund = await refundOutOfStockOrderToCustomerWallet({
      orderId: "order-test-1",
      botToken: "mock:token",
    });

    assert.equal(secondRefund, false, "Second refund call must return false (already refunded)");
    assert.equal(walletBalance, 100000, "Wallet balance must NOT be double credited");
    assert.equal(ledgerEntries.length, 1, "No extra ledger entry must be created");
  } finally {
    prisma.order.findUnique = originalFindUnique;
    prisma.$transaction = originalTransaction;
  }
});

test("refundOutOfStockOrderToCustomerWallet - protects preorders", async () => {
  const originalFindUnique = prisma.order.findUnique;

  const mockPreorder: any = {
    id: "preorder-1",
    isPreorder: true,
    status: "PAID_WAITING_STOCK",
    totalSaleAmount: new Prisma.Decimal(50000),
  };

  // @ts-ignore
  prisma.order.findUnique = async () => mockPreorder;

  try {
    const refunded = await refundOutOfStockOrderToCustomerWallet({
      orderId: "preorder-1",
    });

    assert.equal(refunded, false, "Pre-orders must NOT be auto-refunded");
  } finally {
    prisma.order.findUnique = originalFindUnique;
  }
});

test("refundOutOfStockOrderToCustomerWallet - correctly restores commission and main balance if paid from wallet", async () => {
  const originalFindUnique = prisma.order.findUnique;
  const originalTransaction = prisma.$transaction;

  let walletBalance = 50000;
  let walletCommission = 0;
  let orderStatus = "PAID";
  let paymentStatus = "PAID";
  const ledgerEntries: any[] = [];

  const mockOrder: any = {
    id: "order-wallet-pay",
    orderCode: "ORD-WALLET-1",
    customerId: "cust-2",
    isPreorder: false,
    status: "PAID",
    paymentStatus: "PAID",
    totalSaleAmount: new Prisma.Decimal(60000),
    customer: { id: "cust-2" },
    shop: { botConfig: null },
  };

  const mockTx: any = {
    $queryRawUnsafe: async () => [],
    order: {
      findUnique: async () => ({ ...mockOrder, status: orderStatus, paymentStatus }),
      update: async (args: any) => {
        orderStatus = args.data.status;
        paymentStatus = args.data.paymentStatus;
        return { ...mockOrder, ...args.data };
      },
    },
    customerWallet: {
      findUnique: async () => ({
        id: "wallet-2",
        customerId: "cust-2",
        balance: new Prisma.Decimal(walletBalance),
        commissionBalance: new Prisma.Decimal(walletCommission),
        balanceUsdt: new Prisma.Decimal(walletBalance / 25000),
      }),
      findUniqueOrThrow: async () => ({
        id: "wallet-2",
        customerId: "cust-2",
        balance: new Prisma.Decimal(walletBalance),
        commissionBalance: new Prisma.Decimal(walletCommission),
        balanceUsdt: new Prisma.Decimal(walletBalance / 25000),
      }),
      update: async (args: any) => {
        walletBalance = Number(args.data.balance);
        walletCommission = Number(args.data.commissionBalance);
        return { id: "wallet-2" };
      },
    },
    customerWalletLedger: {
      findFirst: async (args: any) => {
        if (args.where?.type === "REFUND_ORDER") return null;
        if (args.where?.type === "SPEND_ORDER") {
          return {
            commissionBalanceBefore: new Prisma.Decimal(20000),
            commissionBalanceAfter: new Prisma.Decimal(0),
            balanceBefore: new Prisma.Decimal(90000),
            balanceAfter: new Prisma.Decimal(50000),
          };
        }
        return null;
      },
      create: async (args: any) => {
        ledgerEntries.push(args.data);
        return { id: "ledger-2", ...args.data };
      },
    },
    orderEvent: {
      create: async () => ({ id: "event-2" }),
    },
  };

  // @ts-ignore
  prisma.order.findUnique = async () => ({ ...mockOrder, status: orderStatus, paymentStatus });
  // @ts-ignore
  prisma.$transaction = async (cb: any) => cb(mockTx);

  try {
    const refunded = await refundOutOfStockOrderToCustomerWallet({
      orderId: "order-wallet-pay",
    });

    assert.equal(refunded, true);
    assert.equal(walletCommission, 20000, "20,000 VND should be restored to commission balance");
    assert.equal(walletBalance, 90000, "40,000 VND should be restored to main balance");
    assert.equal(ledgerEntries.length, 1);
    assert.equal(Number(ledgerEntries[0].amount), 60000);
    assert.equal(Number(ledgerEntries[0].commissionBalanceAfter), 20000);
  } finally {
    prisma.order.findUnique = originalFindUnique;
    prisma.$transaction = originalTransaction;
  }
});
