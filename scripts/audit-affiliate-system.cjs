require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const VERBOSE = process.argv.includes("--verbose");

function fmt(n) {
  return Number(n).toLocaleString("vi-VN") + "đ";
}

async function main() {
  console.log("Auditing entire affiliate commission system...\n");

  // 1. Find all customers with ANY commission activity (either as referrer in Order or in Ledger)
  const referrerIds = await prisma.order.findMany({
    where: { affiliateCustomerId: { not: null } },
    select: { affiliateCustomerId: true },
    distinct: ["affiliateCustomerId"],
  });
  const ledgerCustomerIds = await prisma.customerWalletLedger.findMany({
    where: { type: "AFFILIATE_COMMISSION" },
    select: { customerId: true },
    distinct: ["customerId"],
  });

  const customerIds = new Set([
    ...referrerIds.map((r) => r.affiliateCustomerId).filter(Boolean),
    ...ledgerCustomerIds.map((r) => r.customerId).filter(Boolean),
  ]);

  console.log(`Checking ${customerIds.size} customers with commission activity...\n`);

  const issues = [];
  let totalLifetime = 0;
  let totalLedgerSum = 0;
  let totalWalletField = 0;

  for (const customerId of customerIds) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        telegramUsername: true,
        telegramChatId: true,
        shopId: true,
        wallet: { select: { commissionBalance: true } },
      },
    });
    if (!customer) {
      issues.push({ customerId, kind: "missing-customer" });
      continue;
    }

    const [lifetimeAgg, ledgerAgg, allEntries] = await Promise.all([
      prisma.order.aggregate({
        where: { affiliateCustomerId: customerId, affiliateCommission: { gt: 0 } },
        _sum: { affiliateCommission: true },
        _count: { _all: true },
      }),
      prisma.customerWalletLedger.aggregate({
        where: { customerId, type: "AFFILIATE_COMMISSION" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.customerWalletLedger.findMany({
        where: { customerId },
        select: { commissionBalanceBefore: true, commissionBalanceAfter: true },
      }),
    ]);

    const lifetime = Number(lifetimeAgg._sum.affiliateCommission || 0);
    const ledgerSum = Number(ledgerAgg._sum.amount || 0);
    const walletField = Number(customer.wallet?.commissionBalance || 0);

    let ledgerDelta = 0;
    for (const e of allEntries) {
      ledgerDelta += Number(e.commissionBalanceAfter ?? 0) - Number(e.commissionBalanceBefore ?? 0);
    }

    totalLifetime += lifetime;
    totalLedgerSum += ledgerSum;
    totalWalletField += walletField;

    const driftLifetimeVsLedger = lifetime - ledgerSum;
    const driftWalletVsDelta = walletField - ledgerDelta;

    const label = `${customer.telegramUsername ? "@" + customer.telegramUsername : "?"} (id=${customerId.slice(0, 12)}...)`;

    if (Math.abs(driftLifetimeVsLedger) > 1) {
      issues.push({
        customerId,
        kind: "lifetime-vs-ledger",
        label,
        lifetime,
        ledgerSum,
        drift: driftLifetimeVsLedger,
      });
    }
    if (Math.abs(driftWalletVsDelta) > 1) {
      issues.push({
        customerId,
        kind: "wallet-vs-delta",
        label,
        walletField,
        ledgerDelta,
        drift: driftWalletVsDelta,
      });
    }

    if (VERBOSE) {
      const ok = Math.abs(driftLifetimeVsLedger) <= 1 && Math.abs(driftWalletVsDelta) <= 1;
      console.log(
        `  ${ok ? "✅" : "🚨"} ${label.padEnd(50)} lifetime=${fmt(lifetime).padStart(14)}  ledger=${fmt(ledgerSum).padStart(14)}  walletField=${fmt(walletField).padStart(14)}`,
      );
    }
  }

  console.log("\n--- System Totals ---");
  console.log(`Total lifetime earned (Order):     ${fmt(totalLifetime)}`);
  console.log(`Total ledger amount (AFFILIATE):   ${fmt(totalLedgerSum)}`);
  console.log(`Total wallet.commissionBalance:    ${fmt(totalWalletField)}`);
  console.log("");

  console.log("--- Issues ---");
  if (issues.length === 0) {
    console.log("✅ No discrepancies found across all customers.");
  } else {
    for (const issue of issues) {
      if (issue.kind === "lifetime-vs-ledger") {
        console.log(`🚨 ${issue.label}`);
        console.log(`   lifetime=${fmt(issue.lifetime)}  ledger=${fmt(issue.ledgerSum)}  drift=${fmt(issue.drift)}`);
        console.log(`   → run: node scripts/backfill-affiliate-commission.cjs --commit`);
      } else if (issue.kind === "wallet-vs-delta") {
        console.log(`🚨 ${issue.label}`);
        console.log(`   wallet=${fmt(issue.walletField)}  ledger delta=${fmt(issue.ledgerDelta)}  drift=${fmt(issue.drift)}`);
        console.log(`   → wallet field changed outside ledger (or vice versa) — needs manual investigation`);
      } else if (issue.kind === "missing-customer") {
        console.log(`🚨 customerId=${issue.customerId} — referenced but Customer row missing`);
      }
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("Audit failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
