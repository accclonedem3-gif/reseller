require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const customerId = process.argv[2];
if (!customerId) {
  console.error("Usage: node scripts/check-affiliate-balance.cjs <customerId>");
  process.exit(1);
}

function fmt(n) {
  return Number(n).toLocaleString("vi-VN") + "đ";
}

async function main() {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      telegramUsername: true,
      telegramUserId: true,
      telegramChatId: true,
      shopId: true,
      referralCode: true,
      wallet: { select: { balance: true, commissionBalance: true, balanceUsdt: true } },
    },
  });

  if (!customer) {
    console.log(`Customer ${customerId} NOT FOUND`);
    return;
  }

  const lifetimeEarned = await prisma.order.aggregate({
    where: { affiliateCustomerId: customerId, affiliateCommission: { gt: 0 } },
    _sum: { affiliateCommission: true },
    _count: { _all: true },
  });

  const ledgerCommission = await prisma.customerWalletLedger.aggregate({
    where: { customerId, type: "AFFILIATE_COMMISSION" },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const spendLedger = await prisma.customerWalletLedger.aggregate({
    where: { customerId, type: "SPEND_ORDER" },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const topupLedger = await prisma.customerWalletLedger.aggregate({
    where: { customerId, type: { in: ["TOPUP", "TOPUP_BONUS"] } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const allLedgerGroups = await prisma.customerWalletLedger.groupBy({
    by: ["type"],
    where: { customerId },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const referredCount = await prisma.customer.count({
    where: { referredById: customerId },
  });

  console.log("=== Customer ===");
  console.log(`ID:              ${customer.id}`);
  console.log(`Telegram:        @${customer.telegramUsername || "?"} (chatId=${customer.telegramChatId || "?"})`);
  console.log(`Shop:            ${customer.shopId}`);
  console.log(`Referral code:   ${customer.referralCode || "—"}`);
  console.log("");
  console.log("=== Wallet (live state) ===");
  console.log(`Balance:         ${fmt(customer.wallet?.balance || 0)}`);
  console.log(`Commission bal:  ${fmt(customer.wallet?.commissionBalance || 0)}     ← this is what bot shows in 'Ví'`);
  console.log(`USDT balance:    ${customer.wallet?.balanceUsdt || 0}`);
  console.log("");
  console.log("=== Affiliate (lifetime, from Order table) ===");
  console.log(`Lifetime earned: ${fmt(lifetimeEarned._sum.affiliateCommission || 0)}   ← this is what bot shows in 'Aff panel'`);
  console.log(`Orders earned:   ${lifetimeEarned._count._all}`);
  console.log(`Referred count:  ${referredCount}`);
  console.log("");
  console.log("=== Ledger (event log — ALL types) ===");
  let ledgerNetSum = 0;
  for (const g of allLedgerGroups) {
    const sum = Number(g._sum.amount || 0);
    ledgerNetSum += sum;
    console.log(`  ${g.type.padEnd(25)} ${fmt(sum).padStart(18)}  (${g._count._all} entries)`);
  }
  console.log(`  ${"NET (sum of all)".padEnd(25)} ${fmt(ledgerNetSum).padStart(18)}`);
  console.log("");

  const lifetimeNum = Number(lifetimeEarned._sum.affiliateCommission || 0);
  const ledgerCommissionNum = Number(ledgerCommission._sum.amount || 0);
  const commissionBalNum = Number(customer.wallet?.commissionBalance || 0);
  const drift = lifetimeNum - ledgerCommissionNum;

  console.log("=== Diagnosis ===");
  if (drift > 0) {
    console.log(`⚠️  Commission ledger DRIFT: ${fmt(drift)} earned but never written → backfill needed.`);
  } else if (drift < 0) {
    console.log(`⚠️  Ledger sum (${fmt(ledgerCommissionNum)}) > Order lifetime sum (${fmt(lifetimeNum)}). Over-credit?`);
  } else {
    console.log(`✅ Commission ledger matches lifetime earned (${fmt(lifetimeNum)}).`);
  }

  // Reconcile commission balance: credited - spent should = current
  const expectedFromLedger = ledgerCommissionNum + Number(spendLedger._sum.amount || 0); // spend is negative
  const unaccountedFromCommission = commissionBalNum - expectedFromLedger;
  console.log("");
  console.log("  Commission balance reconciliation:");
  console.log(`    Credited (AFFILIATE_COMMISSION):  +${fmt(ledgerCommissionNum)}`);
  console.log(`    Spent (SPEND_ORDER, all types):    ${fmt(spendLedger._sum.amount || 0)}`);
  console.log(`    Expected = credited + spent:       ${fmt(expectedFromLedger)}`);
  console.log(`    Actual wallet commission_balance:  ${fmt(commissionBalNum)}`);
  if (Math.abs(unaccountedFromCommission) > 1) {
    console.log(`    🚨 UNACCOUNTED: ${fmt(unaccountedFromCommission)} difference`);
    console.log("       Possible causes: another ledger type debits commission,");
    console.log("       OR a code path updates wallet.commissionBalance without ledger entry.");
    console.log("       → See 'ALL types' table above to spot extra debit categories.");
  } else {
    console.log(`    ✅ Reconciles cleanly.`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("Check failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
