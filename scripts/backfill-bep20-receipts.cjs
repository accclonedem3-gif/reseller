require("dotenv/config");

const fs = require("node:fs");
const { PrismaClient, PaymentProvider, PaymentTransactionStatus } = require("@prisma/client");

const prisma = new PrismaClient();
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.join("=") || true];
  }),
);
const reportPath = String(args.get("--report") || "");
const apply = args.has("--apply");
const expectedCount = Number(args.get("--expected-count") || 0);
const confirmation = String(args.get("--confirm") || "");

function fail(message) {
  throw new Error(message);
}

function normalizeHash(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  return /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}

async function loadTarget(client, result) {
  if (result.kind === "order") {
    return client.paymentTransaction.findUnique({
      where: { externalOrderCode: result.externalOrderCode },
      select: {
        provider: true,
        status: true,
        cryptoTxHash: true,
        paidAt: true,
      },
    });
  }
  if (result.kind === "customer_topup") {
    return client.customerWalletTopup.findUnique({
      where: { externalOrderCode: result.externalOrderCode },
      select: {
        provider: true,
        status: true,
        cryptoTxHash: true,
        paidAt: true,
      },
    });
  }
  fail(`Unsupported historical BEP20 target kind: ${result.kind}`);
}

function validateResult(result) {
  const proposal = result.proposal || {};
  const normalized = normalizeHash(proposal.txHash);
  if (result.status !== "VERIFIED") fail(`Target ${result.externalOrderCode} is not VERIFIED.`);
  if (proposal.provider !== PaymentProvider.USDT_BEP20) {
    fail(`Target ${result.externalOrderCode} has the wrong provider.`);
  }
  if (!normalized || normalized !== proposal.txHashNormalized) {
    fail(`Target ${result.externalOrderCode} has an invalid normalized hash.`);
  }
  if (!Number.isFinite(Number(proposal.amountUsdt)) || Number(proposal.amountUsdt) <= 0) {
    fail(`Target ${result.externalOrderCode} has an invalid amount.`);
  }
  if (!/^0x[a-f0-9]{40}$/.test(String(proposal.destination || "").toLowerCase())) {
    fail(`Target ${result.externalOrderCode} has an invalid destination.`);
  }
  if (!Number.isFinite(new Date(proposal.transactionAt).getTime())) {
    fail(`Target ${result.externalOrderCode} has an invalid transaction timestamp.`);
  }
  return normalized;
}

async function validateAgainstDatabase(client, result) {
  const proposal = result.proposal;
  const normalized = validateResult(result);
  const target = await loadTarget(client, result);
  if (!target) fail(`Target ${result.externalOrderCode} no longer exists.`);
  if (
    target.provider !== PaymentProvider.USDT_BEP20
    || target.status !== PaymentTransactionStatus.PAID
    || !target.paidAt
  ) {
    fail(`Target ${result.externalOrderCode} is no longer a settled BEP20 payment.`);
  }
  if (normalizeHash(target.cryptoTxHash) !== normalized) {
    fail(`Stored hash changed for target ${result.externalOrderCode}.`);
  }
  const [byHash, byCode] = await Promise.all([
    client.onchainPaymentReceipt.findUnique({ where: { txHashNormalized: normalized } }),
    client.onchainPaymentReceipt.findUnique({
      where: { externalOrderCode: result.externalOrderCode },
    }),
  ]);
  const existing = byHash || byCode;
  if (existing) {
    if (
      existing.txHashNormalized !== normalized
      || existing.externalOrderCode !== result.externalOrderCode
    ) {
      fail(`Receipt conflict for target ${result.externalOrderCode}.`);
    }
    return { action: "skip", existing };
  }
  return {
    action: "insert",
    data: {
      provider: PaymentProvider.USDT_BEP20,
      txHash: proposal.txHash,
      txHashNormalized: normalized,
      externalOrderCode: result.externalOrderCode,
      amountUsdt: Number(proposal.amountUsdt),
      destination: String(proposal.destination).toLowerCase(),
      tokenAddress: proposal.tokenAddress || null,
      blockReference: proposal.blockReference || null,
      confirmations: proposal.confirmations == null ? null : Number(proposal.confirmations),
      verificationVersion: Number(proposal.verificationVersion || 2),
      transactionAt: new Date(proposal.transactionAt),
      processedAt: proposal.processedAt ? new Date(proposal.processedAt) : target.paidAt,
      rawPayloadJson: {
        source: "historical_bep20_reconciliation",
        evidenceLevel: result.evidenceLevel,
        amountSource: result.amountSource,
        destinationSource: result.destinationSource,
        reportGeneratedAt: report.generatedAt,
        backfilledAt: new Date().toISOString(),
      },
    },
  };
}

let report;

async function main() {
  if (!reportPath) fail("--report=<path> is required.");
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.readOnly !== true || report.databaseWrites !== 0) {
    fail("The input is not a trusted read-only reconciliation report.");
  }
  if (report.provider !== PaymentProvider.USDT_BEP20) fail("The report is not for BEP20.");
  const ageMs = Date.now() - new Date(report.generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 6 * 60 * 60 * 1000) {
    fail("The reconciliation report is stale; generate a new report.");
  }
  const verified = report.results.filter((result) => result.status === "VERIFIED");
  if (!Number.isInteger(expectedCount) || expectedCount <= 0 || verified.length !== expectedCount) {
    fail(`Expected ${expectedCount} VERIFIED targets but report contains ${verified.length}.`);
  }
  const codes = new Set(verified.map((result) => result.externalOrderCode));
  const hashes = new Set(verified.map((result) => normalizeHash(result.proposal?.txHash)));
  if (codes.size !== verified.length || hashes.size !== verified.length || hashes.has(null)) {
    fail("The report contains duplicate or invalid targets/hashes.");
  }

  const preview = [];
  for (const result of verified) {
    const checked = await validateAgainstDatabase(prisma, result);
    preview.push({
      externalOrderCode: result.externalOrderCode,
      evidenceLevel: result.evidenceLevel,
      action: checked.action,
    });
  }
  const inserts = preview.filter((row) => row.action === "insert").length;
  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    balanceWrites: 0,
    expectedCount,
    inserts,
    skips: verified.length - inserts,
    preview,
  }, null, 2));
  if (!apply) return;
  if (confirmation !== "BACKFILL_VERIFIED_BEP20") {
    fail("--confirm=BACKFILL_VERIFIED_BEP20 is required for apply mode.");
  }

  const applied = await prisma.$transaction(async (tx) => {
    let inserted = 0;
    let skipped = 0;
    for (const result of verified) {
      const checked = await validateAgainstDatabase(tx, result);
      if (checked.action === "skip") {
        skipped += 1;
        continue;
      }
      await tx.onchainPaymentReceipt.create({ data: checked.data });
      inserted += 1;
    }
    return { inserted, skipped };
  }, { isolationLevel: "Serializable", timeout: 60_000 });
  console.log(JSON.stringify({ applied: true, balanceWrites: 0, ...applied }, null, 2));
}

main()
  .catch((error) => {
    console.error("BEP20 receipt backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
