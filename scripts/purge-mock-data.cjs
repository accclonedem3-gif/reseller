require("dotenv/config");

const { Prisma, PrismaClient } = require("@prisma/client");
const { decryptSecret } = require("@reseller/shared/server");

const prisma = new PrismaClient();

const MOCK_PAYMENT_PATH = "/api/v1/dev/mock-payments/";
const KNOWN_MOCK_EXTERNAL_PRODUCT_IDS = new Set([
  "698600232b866a39b4cb2272",
  "698618eeaff16b992e059270",
  "698618eeaff16b992e059271",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasMockFlag(value) {
  return isRecord(value) && (value.mock === true || value.demo === true);
}

function isMockPrefix(value) {
  return String(value || "").trim().toLowerCase().startsWith("mock");
}

function isDemoOrderCode(value) {
  return String(value || "").toUpperCase().startsWith("ORD-DEMO-");
}

function isMockFailureReason(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.includes("mock upstream") || normalized.includes("provider demo");
}

function usesMockCheckout(url) {
  return String(url || "").includes(MOCK_PAYMENT_PATH);
}

function toNumber(value) {
  return Number(typeof value?.toString === "function" ? value.toString() : value || 0);
}

function toDecimal(value) {
  return new Prisma.Decimal(value.toFixed(2));
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeDecrypt(value, secret) {
  try {
    return decryptSecret(value, secret);
  } catch {
    return String(value || "");
  }
}

async function deleteManyByIds(model, ids) {
  if (!ids.length) {
    return 0;
  }

  const result = await model.deleteMany({
    where: {
      id: {
        in: ids,
      },
    },
  });

  return result.count;
}

async function recalculateWallets() {
  const wallets = await prisma.sellerWallet.findMany({
    select: {
      id: true,
      sellerId: true,
    },
  });

  const ledgers = await prisma.walletLedger.findMany({
    select: {
      id: true,
      sellerId: true,
      walletId: true,
      amount: true,
      balanceBefore: true,
      balanceAfter: true,
      createdAt: true,
    },
    orderBy: [{ sellerId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  const ledgersBySeller = new Map();

  for (const ledger of ledgers) {
    const sellerLedgers = ledgersBySeller.get(ledger.sellerId) || [];
    sellerLedgers.push(ledger);
    ledgersBySeller.set(ledger.sellerId, sellerLedgers);
  }

  let updatedLedgerCount = 0;
  const walletSummaries = [];

  for (const wallet of wallets) {
    const sellerLedgers = ledgersBySeller.get(wallet.sellerId) || [];
    let balance = 0;

    for (const ledger of sellerLedgers) {
      const balanceBefore = roundMoney(balance);
      const balanceAfter = roundMoney(balanceBefore + toNumber(ledger.amount));

      if (
        roundMoney(toNumber(ledger.balanceBefore)) !== balanceBefore ||
        roundMoney(toNumber(ledger.balanceAfter)) !== balanceAfter
      ) {
        await prisma.walletLedger.update({
          where: { id: ledger.id },
          data: {
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
          },
        });
        updatedLedgerCount += 1;
      }

      balance = balanceAfter;
    }

    await prisma.sellerWallet.update({
      where: { id: wallet.id },
      data: {
        balance: toDecimal(roundMoney(balance)),
      },
    });

    walletSummaries.push({
      sellerId: wallet.sellerId,
      balance: roundMoney(balance),
      ledgerCount: sellerLedgers.length,
    });
  }

  return {
    updatedLedgerCount,
    walletSummaries,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const encryptionKey = process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key";

  const [sourceProducts, paymentTransactions, orders, walletLedgers, deposits, withdraws, botConfigs, providerConfigs, paymentConfigs] =
    await Promise.all([
      prisma.sourceProduct.findMany({
        select: {
          id: true,
          externalProductId: true,
          metadataJson: true,
        },
      }),
      prisma.paymentTransaction.findMany({
        select: {
          id: true,
          orderId: true,
          provider: true,
          checkoutUrl: true,
          rawPayloadJson: true,
        },
      }),
      prisma.order.findMany({
        select: {
          id: true,
          customerId: true,
          orderCode: true,
          sourceProductId: true,
          failureReason: true,
        },
      }),
      prisma.walletLedger.findMany({
        select: {
          id: true,
          referenceType: true,
          referenceId: true,
          note: true,
        },
      }),
      prisma.depositRequest.findMany({
        select: {
          id: true,
          note: true,
        },
      }),
      prisma.withdrawRequest.findMany({
        select: {
          id: true,
          note: true,
          bankAccountName: true,
        },
      }),
      prisma.botConfig.findMany({
        select: {
          id: true,
          telegramBotTokenEncrypted: true,
          telegramBotUsername: true,
          telegramBotId: true,
        },
      }),
      prisma.providerConfig.findMany({
        select: {
          id: true,
          buyerKeyEncrypted: true,
        },
      }),
      prisma.paymentConfig.findMany({
        select: {
          id: true,
          provider: true,
        },
      }),
    ]);

  const mockProductIds = sourceProducts
    .filter(
      (product) =>
        hasMockFlag(product.metadataJson) ||
        KNOWN_MOCK_EXTERNAL_PRODUCT_IDS.has(product.externalProductId),
    )
    .map((product) => product.id);
  const mockProductIdSet = new Set(mockProductIds);

  const mockTransactionIds = paymentTransactions
    .filter(
      (transaction) =>
        transaction.provider === "MOCK" ||
        usesMockCheckout(transaction.checkoutUrl) ||
        hasMockFlag(transaction.rawPayloadJson),
    )
    .map((transaction) => transaction.id);
  const mockTransactionOrderIds = new Set(
    paymentTransactions
      .filter((transaction) => mockTransactionIds.includes(transaction.id))
      .map((transaction) => transaction.orderId),
  );

  const mockOrders = orders.filter(
    (order) =>
      mockProductIdSet.has(order.sourceProductId) ||
      mockTransactionOrderIds.has(order.id) ||
      isDemoOrderCode(order.orderCode) ||
      isMockFailureReason(order.failureReason),
  );
  const mockOrderIds = mockOrders.map((order) => order.id);
  const mockOrderIdSet = new Set(mockOrderIds);
  const candidateCustomerIds = unique(mockOrders.map((order) => order.customerId));

  const mockLedgerIds = walletLedgers
    .filter(
      (ledger) =>
        (ledger.referenceType === "order" && mockOrderIdSet.has(ledger.referenceId)) ||
        ledger.referenceType === "seed" ||
        String(ledger.id || "").startsWith("seed-") ||
        String(ledger.note || "").toLowerCase().includes("demo wallet topup"),
    )
    .map((ledger) => ledger.id);

  const mockDepositIds = deposits
    .filter(
      (deposit) =>
        String(deposit.id || "").startsWith("seed-") ||
        String(deposit.note || "").toLowerCase().includes("demo"),
    )
    .map((deposit) => deposit.id);

  const mockWithdrawIds = withdraws
    .filter(
      (withdraw) =>
        String(withdraw.id || "").startsWith("seed-") ||
        String(withdraw.note || "").toLowerCase().includes("demo") ||
        String(withdraw.bankAccountName || "").toLowerCase().includes("demo"),
    )
    .map((withdraw) => withdraw.id);

  const mockBotConfigIds = botConfigs
    .filter((config) => {
      const token = safeDecrypt(config.telegramBotTokenEncrypted, encryptionKey);
      return (
        isMockPrefix(token) ||
        ((!token || token === config.telegramBotTokenEncrypted) &&
          (config.telegramBotUsername === "mock_reseller_bot" ||
            config.telegramBotId === "123456789"))
      );
    })
    .map((config) => config.id);

  const mockProviderConfigIds = providerConfigs
    .filter((config) => isMockPrefix(safeDecrypt(config.buyerKeyEncrypted, encryptionKey)))
    .map((config) => config.id);

  const mockPaymentConfigIds = paymentConfigs
    .filter((config) => config.provider === "MOCK")
    .map((config) => config.id);

  const summary = {
    dryRun,
    mockProducts: mockProductIds.length,
    mockOrders: mockOrderIds.length,
    mockTransactions: mockTransactionIds.length,
    mockLedgers: mockLedgerIds.length,
    mockDeposits: mockDepositIds.length,
    mockWithdraws: mockWithdrawIds.length,
    mockBotConfigs: mockBotConfigIds.length,
    mockProviderConfigs: mockProviderConfigIds.length,
    mockPaymentConfigs: mockPaymentConfigIds.length,
    affectedCustomers: candidateCustomerIds.length,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    return;
  }

  const deletedOrderEvents =
    mockOrderIds.length > 0
      ? (
          await prisma.orderEvent.deleteMany({
            where: {
              orderId: {
                in: mockOrderIds,
              },
            },
          })
        ).count
      : 0;

  const deletedTransactions =
    mockOrderIds.length > 0
      ? (
          await prisma.paymentTransaction.deleteMany({
            where: {
              orderId: {
                in: mockOrderIds,
              },
            },
          })
        ).count
      : 0;

  const deletedLedgers = await deleteManyByIds(prisma.walletLedger, unique(mockLedgerIds));
  const deletedOrders = await deleteManyByIds(prisma.order, mockOrderIds);
  const deletedDeposits = await deleteManyByIds(prisma.depositRequest, mockDepositIds);
  const deletedWithdraws = await deleteManyByIds(prisma.withdrawRequest, mockWithdrawIds);

  const deletedOverrides =
    mockProductIds.length > 0
      ? (
          await prisma.sellerProductOverride.deleteMany({
            where: {
              sourceProductId: {
                in: mockProductIds,
              },
            },
          })
        ).count
      : 0;

  const deletedProducts = await deleteManyByIds(prisma.sourceProduct, mockProductIds);

  let deletedCustomers = 0;

  if (candidateCustomerIds.length > 0) {
    const remainingOrders = await prisma.order.findMany({
      where: {
        customerId: {
          in: candidateCustomerIds,
        },
      },
      select: {
        customerId: true,
      },
    });

    const activeCustomerIds = new Set(remainingOrders.map((order) => order.customerId));
    const orphanCustomerIds = candidateCustomerIds.filter((customerId) => !activeCustomerIds.has(customerId));

    deletedCustomers = await deleteManyByIds(prisma.customer, orphanCustomerIds);
  }

  const clearedBotConfigs =
    mockBotConfigIds.length > 0
      ? (
          await prisma.botConfig.updateMany({
            where: {
              id: {
                in: mockBotConfigIds,
              },
            },
            data: {
              telegramBotTokenEncrypted: "",
              telegramBotUsername: null,
              telegramBotId: null,
              webhookUrl: null,
              webhookStatus: "DISABLED",
              deliveryMode: "POLLING",
              lastVerifiedAt: null,
            },
          })
        ).count
      : 0;

  const clearedProviderConfigs =
    mockProviderConfigIds.length > 0
      ? (
          await prisma.providerConfig.updateMany({
            where: {
              id: {
                in: mockProviderConfigIds,
              },
            },
            data: {
              buyerKeyEncrypted: "",
              connectionStatus: "PENDING",
              lastVerifiedAt: null,
            },
          })
        ).count
      : 0;

  const switchedPaymentConfigs =
    mockPaymentConfigIds.length > 0
      ? (
          await prisma.paymentConfig.updateMany({
            where: {
              id: {
                in: mockPaymentConfigIds,
              },
            },
            data: {
              provider: "PAYOS",
            },
          })
        ).count
      : 0;

  const walletResult = await recalculateWallets();

  console.log(
    JSON.stringify(
      {
        deletedOrderEvents,
        deletedTransactions,
        deletedOrders,
        deletedLedgers,
        deletedDeposits,
        deletedWithdraws,
        deletedOverrides,
        deletedProducts,
        deletedCustomers,
        clearedBotConfigs,
        clearedProviderConfigs,
        switchedPaymentConfigs,
        updatedWalletLedgers: walletResult.updatedLedgerCount,
        wallets: walletResult.walletSummaries,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
