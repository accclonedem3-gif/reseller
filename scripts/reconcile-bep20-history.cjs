require("dotenv/config");

const { PrismaClient, PaymentProvider, PaymentTransactionStatus } = require("@prisma/client");
const {
  BSC_MIN_CONFIRMATIONS,
  BSC_USDT_DECIMALS,
  BSC_USDT_MAINNET_CONTRACT,
  DEFAULT_BSC_RPC_ENDPOINTS,
  fetchBep20TxReceipt,
  normalizeBep20Address,
} = require("../packages/shared/dist/server.js");

if (process.argv.some((arg) => arg === "--apply" || arg === "--write")) {
  throw new Error("This command is read-only. Database writes are intentionally unsupported.");
}

const prisma = new PrismaClient();

function normalizeHash(value) {
  const raw = String(value || "").trim().toLowerCase();
  const prefixed = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[a-f0-9]{64}$/.test(prefixed) ? prefixed : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function extractNestedHash(rawPayload) {
  const payload = asObject(rawPayload);
  const verification = asObject(payload.verification);
  const transfer = asObject(payload.transfer);
  return normalizeHash(
    payload.txHash
      || payload.signature
      || verification.txHash
      || verification.signature
      || transfer.txHash,
  );
}

function extractExpectation(record) {
  const payload = asObject(record.rawPayloadJson);
  const manualCrypto = asObject(payload.manualCrypto);
  const verification = asObject(payload.verification);
  const transfer = asObject(payload.transfer);
  const amountCandidates = [
    { value: manualCrypto.usdtAmount, source: "manualCrypto.usdtAmount", evidence: "INVOICE_PAYLOAD" },
    { value: payload.expectedAmountUsdt, source: "expectedAmountUsdt", evidence: "INVOICE_PAYLOAD" },
    { value: payload.amountUsdt, source: "amountUsdt", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
    { value: verification.amountUsdt, source: "verification.amountUsdt", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
    { value: transfer.amountUsdt, source: "transfer.amountUsdt", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
  ];
  const destinationCandidates = [
    { value: manualCrypto.address, source: "manualCrypto.address", evidence: "INVOICE_PAYLOAD" },
    { value: payload.expectedDestination, source: "expectedDestination", evidence: "INVOICE_PAYLOAD" },
    { value: payload.toAddress, source: "toAddress", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
    { value: payload.destination, source: "destination", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
    { value: verification.toAddress, source: "verification.toAddress", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
    { value: verification.destination, source: "verification.destination", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
    { value: transfer.toAddress, source: "transfer.toAddress", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
    { value: transfer.destination, source: "transfer.destination", evidence: "LEGACY_SETTLEMENT_PAYLOAD" },
  ];
  const amountMatch = amountCandidates.find((candidate) => {
    const amount = Number(candidate.value);
    return Number.isFinite(amount) && amount > 0;
  });
  const destinationMatch = destinationCandidates
    .map((candidate) => ({ ...candidate, normalized: normalizeBep20Address(candidate.value) }))
    .find((candidate) => candidate.normalized);
  const evidenceLevel = amountMatch?.evidence === "INVOICE_PAYLOAD"
    && destinationMatch?.evidence === "INVOICE_PAYLOAD"
    ? "INVOICE_PAYLOAD"
    : "LEGACY_SETTLEMENT_PAYLOAD";
  return {
    amountUsdt: amountMatch ? Number(amountMatch.value) : 0,
    amountSource: amountMatch?.source || null,
    destination: destinationMatch?.normalized || null,
    destinationSource: destinationMatch?.source || null,
    evidenceLevel,
  };
}

function serialize(value) {
  return JSON.stringify(
    value,
    (_key, entry) => typeof entry === "bigint" ? Number(entry) : entry,
    2,
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function loadReceiptlessTargets() {
  const existingReceipts = await prisma.onchainPaymentReceipt.findMany({
    select: { externalOrderCode: true },
  });
  const claimedCodes = new Set(existingReceipts.map((row) => row.externalOrderCode));

  const [payments, topups, deposits, connectionTopups] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where: {
        provider: PaymentProvider.USDT_BEP20,
        status: PaymentTransactionStatus.PAID,
      },
      select: {
        id: true,
        externalOrderCode: true,
        cryptoTxHash: true,
        rawPayloadJson: true,
        createdAt: true,
        paidAt: true,
        order: {
          select: {
            shop: {
              select: {
                paymentConfig: { select: { usdtBep20Address: true } },
              },
            },
          },
        },
      },
    }),
    prisma.customerWalletTopup.findMany({
      where: {
        provider: PaymentProvider.USDT_BEP20,
        status: PaymentTransactionStatus.PAID,
      },
      select: {
        id: true,
        externalOrderCode: true,
        cryptoTxHash: true,
        rawPayloadJson: true,
        createdAt: true,
        expiresAt: true,
        paidAt: true,
        shop: {
          select: {
            paymentConfig: { select: { usdtBep20Address: true } },
          },
        },
      },
    }),
    prisma.depositRequest.findMany({
      where: { provider: PaymentProvider.USDT_BEP20, status: "CONFIRMED" },
      select: {
        id: true,
        externalOrderCode: true,
        rawPayloadJson: true,
        createdAt: true,
        expiresAt: true,
        paidAt: true,
        seller: {
          select: {
            shops: {
              orderBy: { createdAt: "asc" },
              take: 1,
              select: {
                paymentConfig: { select: { usdtBep20Address: true } },
              },
            },
          },
        },
      },
    }),
    prisma.connectionTopupRequest.findMany({
      where: { provider: PaymentProvider.USDT_BEP20, status: "PAID" },
      select: {
        id: true,
        externalOrderCode: true,
        rawPayloadJson: true,
        createdAt: true,
        expiresAt: true,
        updatedAt: true,
        upstreamShop: {
          select: {
            paymentConfig: { select: { usdtBep20Address: true } },
          },
        },
      },
    }),
  ]);

  return [
    ...payments.map((row) => ({
      ...row,
      kind: "order",
      expiresAt: new Date(row.createdAt.getTime() + 30 * 60 * 1000),
      settledAt: row.paidAt,
      txHash: normalizeHash(row.cryptoTxHash) || extractNestedHash(row.rawPayloadJson),
      currentBep20Address: row.order?.shop?.paymentConfig?.usdtBep20Address || null,
    })),
    ...topups.map((row) => ({
      ...row,
      kind: "customer_topup",
      settledAt: row.paidAt,
      txHash: normalizeHash(row.cryptoTxHash) || extractNestedHash(row.rawPayloadJson),
      currentBep20Address: row.shop?.paymentConfig?.usdtBep20Address || null,
    })),
    ...deposits.map((row) => ({
      ...row,
      kind: "seller_deposit",
      settledAt: row.paidAt,
      txHash: extractNestedHash(row.rawPayloadJson),
      currentBep20Address: row.seller?.shops?.[0]?.paymentConfig?.usdtBep20Address || null,
    })),
    ...connectionTopups.map((row) => ({
      ...row,
      kind: "connection_topup",
      settledAt: row.updatedAt,
      txHash: extractNestedHash(row.rawPayloadJson),
      currentBep20Address: row.upstreamShop?.paymentConfig?.usdtBep20Address || null,
    })),
  ].filter((row) => row.externalOrderCode && !claimedCodes.has(row.externalOrderCode));
}

async function main() {
  const rpcEndpoints = String(process.env.BSC_RPC_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const config = {
    endpoints: rpcEndpoints.length > 0 ? rpcEndpoints : DEFAULT_BSC_RPC_ENDPOINTS,
    contractAddress: String(
      process.env.BSC_USDT_CONTRACT_ADDRESS || BSC_USDT_MAINNET_CONTRACT,
    ).trim(),
    decimals: Number(process.env.BSC_USDT_DECIMALS || BSC_USDT_DECIMALS),
    minConfirmations: Math.max(
      1,
      Number(process.env.BSC_MIN_CONFIRMATIONS || BSC_MIN_CONFIRMATIONS),
    ),
    tolerance: Math.max(0, Number(process.env.USDT_PAYMENT_TOLERANCE || 0.02)),
  };
  const targets = await loadReceiptlessTargets();
  const hashCounts = new Map();
  for (const target of targets) {
    if (target.txHash) hashCounts.set(target.txHash, (hashCounts.get(target.txHash) || 0) + 1);
  }

  const receiptCache = new Map();
  const results = await mapWithConcurrency(targets, 3, async (target) => {
    const expectation = extractExpectation(target);
    const base = {
      kind: target.kind,
      externalOrderCode: target.externalOrderCode,
      txHash: target.txHash,
      expectedAmountUsdt: expectation.amountUsdt,
      amountSource: expectation.amountSource,
      expectedDestination: expectation.destination,
      destinationSource: expectation.destinationSource,
      evidenceLevel: expectation.evidenceLevel,
      currentConfiguredDestination: normalizeBep20Address(target.currentBep20Address),
      createdAt: target.createdAt,
      expiresAt: target.expiresAt,
      settledAt: target.settledAt,
    };
    if (!target.txHash) return { ...base, status: "MISSING_HASH" };
    if ((hashCounts.get(target.txHash) || 0) > 1) {
      return { ...base, status: "DUPLICATE_TARGET_HASH" };
    }
    if (!Number.isFinite(expectation.amountUsdt) || expectation.amountUsdt <= 0) {
      return { ...base, status: "INVALID_EXPECTED_AMOUNT" };
    }

    try {
      let receiptPromise = receiptCache.get(target.txHash);
      if (!receiptPromise) {
        receiptPromise = fetchBep20TxReceipt({
          endpoints: config.endpoints,
          txHash: target.txHash,
          contractAddress: config.contractAddress,
          decimals: config.decimals,
          timeoutMs: 20_000,
        });
        receiptCache.set(target.txHash, receiptPromise);
      }
      const receipt = await receiptPromise;
      if (!receipt) return { ...base, status: "TX_NOT_FOUND" };
      if (receipt.status !== 1) return { ...base, status: "TX_REVERTED" };
      if (receipt.confirmations < config.minConfirmations) {
        return { ...base, status: "INSUFFICIENT_CONFIRMATIONS", confirmations: receipt.confirmations };
      }
      const amountMatches = receipt.transfers.filter((candidate) =>
        Math.abs(candidate.amountUsdt - expectation.amountUsdt) <= config.tolerance + 1e-9,
      );
      if (amountMatches.length === 0) {
        return {
          ...base,
          status: "TRANSFER_MISMATCH",
          observedTransfers: receipt.transfers.map((candidate) => ({
            destination: candidate.toAddress,
            amountUsdt: candidate.amountUsdt,
          })),
        };
      }
      if (receipt.blockTimestamp.getTime() < target.createdAt.getTime() - 60 * 1000) {
        return { ...base, status: "TX_PREDATES_INVOICE", transactionAt: receipt.blockTimestamp };
      }
      if (target.expiresAt && receipt.blockTimestamp.getTime() > target.expiresAt.getTime() + 60_000) {
        return { ...base, status: "TX_AFTER_EXPIRY", transactionAt: receipt.blockTimestamp };
      }
      if (!expectation.destination) {
        return {
          ...base,
          status: "MISSING_HISTORICAL_DESTINATION",
          transactionAt: receipt.blockTimestamp,
          confirmations: receipt.confirmations,
          amountMatchedTransfers: amountMatches.map((candidate) => ({
            destination: candidate.toAddress,
            amountUsdt: candidate.amountUsdt,
            matchesCurrentConfig: Boolean(
              base.currentConfiguredDestination
              && candidate.toAddress === base.currentConfiguredDestination
            ),
          })),
        };
      }
      const transfer = amountMatches.find((candidate) =>
        candidate.toAddress === expectation.destination,
      );
      if (!transfer) {
        return {
          ...base,
          status: "TRANSFER_MISMATCH",
          observedTransfers: receipt.transfers.map((candidate) => ({
            destination: candidate.toAddress,
            amountUsdt: candidate.amountUsdt,
          })),
        };
      }
      return {
        ...base,
        status: "VERIFIED",
        proposal: {
          provider: PaymentProvider.USDT_BEP20,
          txHash: receipt.txHash,
          txHashNormalized: receipt.txHash.replace(/^0x/i, "").toLowerCase(),
          externalOrderCode: target.externalOrderCode,
          amountUsdt: transfer.amountUsdt,
          destination: transfer.toAddress,
          tokenAddress: transfer.contractAddress,
          blockReference: String(receipt.blockNumber),
          confirmations: receipt.confirmations,
          verificationVersion: 2,
          transactionAt: receipt.blockTimestamp,
          processedAt: target.settledAt || receipt.blockTimestamp,
        },
      };
    } catch (error) {
      return {
        ...base,
        status: "RPC_ERROR",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const statusCounts = {};
  for (const result of results) {
    statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;
  }
  const verifiedCount = statusCounts.VERIFIED || 0;
  const invoiceEvidenceVerifiedCount = results.filter((result) =>
    result.status === "VERIFIED" && result.evidenceLevel === "INVOICE_PAYLOAD"
  ).length;
  const legacySettlementEvidenceVerifiedCount = results.filter((result) =>
    result.status === "VERIFIED" && result.evidenceLevel === "LEGACY_SETTLEMENT_PAYLOAD"
  ).length;
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    databaseWrites: 0,
    provider: PaymentProvider.USDT_BEP20,
    config: {
      contractAddress: config.contractAddress,
      decimals: config.decimals,
      minConfirmations: config.minConfirmations,
      tolerance: config.tolerance,
      rpcEndpointCount: config.endpoints.length,
    },
    summary: {
      totalReceiptlessTargets: targets.length,
      verifiedCount,
      invoiceEvidenceVerifiedCount,
      legacySettlementEvidenceVerifiedCount,
      autoBackfillEligibleCount: invoiceEvidenceVerifiedCount,
      requiresExplicitApprovalCount: legacySettlementEvidenceVerifiedCount,
      needsReviewCount: targets.length - verifiedCount,
      statusCounts,
    },
    results,
  };
  console.log(serialize(report));
  if (targets.length - verifiedCount > 0) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error("BEP20 history reconciliation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
