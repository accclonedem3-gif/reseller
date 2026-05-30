require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/check-affiliate-balance.cjs <customerId | @username | telegramId>");
  process.exit(1);
}

function fmt(n) {
  return Number(n).toLocaleString("vi-VN") + "đ";
}

async function resolveCustomer(input) {
  const sel = {
    id: true,
    telegramUsername: true,
    telegramUserId: true,
    telegramChatId: true,
    shopId: true,
    referralCode: true,
    wallet: { select: { balance: true, commissionBalance: true, balanceUsdt: true } },
  };

  if (input.startsWith("@")) {
    const matches = await prisma.customer.findMany({
      where: { telegramUsername: input.slice(1) },
      select: sel,
    });
    return matches;
  }

  if (/^\d+$/.test(input)) {
    const matches = await prisma.customer.findMany({
      where: { OR: [{ telegramUserId: input }, { telegramChatId: input }] },
      select: sel,
    });
    return matches;
  }

  const one = await prisma.customer.findUnique({ where: { id: input }, select: sel });
  return one ? [one] : [];
}

async function main() {
  const matches = await resolveCustomer(arg);
  if (matches.length === 0) {
    console.log(`No customer matched: ${arg}`);
    return;
  }
  if (matches.length > 1) {
    console.log(`${matches.length} customers matched "${arg}" — showing first. To pick another, pass its cuid:`);
    for (const m of matches) {
      console.log(`  · ${m.id}  shop=${m.shopId}  @${m.telegramUsername || "?"}  chatId=${m.telegramChatId || "?"}`);
    }
    console.log("");
  }
  const customer = matches[0];
  const customerId = customer.id;

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

  const allEntries = await prisma.customerWalletLedger.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      amount: true,
      currency: true,
      balanceBefore: true,
      balanceAfter: true,
      commissionBalanceBefore: true,
      commissionBalanceAfter: true,
      referenceType: true,
      referenceId: true,
      note: true,
      createdAt: true,
    },
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

  // Reconcile commission balance via commissionBalanceBefore/After (more accurate than amount sign)
  let commissionDeltaFromLedger = 0;
  let commissionEntries = 0;
  for (const e of allEntries) {
    const before = Number(e.commissionBalanceBefore ?? 0);
    const after = Number(e.commissionBalanceAfter ?? 0);
    const delta = after - before;
    if (delta !== 0) {
      commissionDeltaFromLedger += delta;
      commissionEntries++;
    }
  }
  console.log("");
  console.log("  Commission balance reconciliation (via commissionBalanceBefore/After fields):");
  console.log(`    Net delta from ledger: ${fmt(commissionDeltaFromLedger)}  (${commissionEntries} entries actually touched commission)`);
  console.log(`    Actual wallet field:   ${fmt(commissionBalNum)}`);
  const unaccountedFromCommission = commissionBalNum - commissionDeltaFromLedger;
  if (Math.abs(unaccountedFromCommission) > 1) {
    console.log(`    🚨 UNACCOUNTED: ${fmt(unaccountedFromCommission)} — wallet has more/less commission than ledger explains`);
    console.log("       → A code path is updating wallet.commissionBalance WITHOUT writing ledger entry.");
  } else {
    console.log(`    ✅ Reconciles cleanly — every change to commissionBalance is in ledger.`);
  }

  // Recent entries that actually moved commission
  const movers = allEntries
    .filter((e) => {
      const before = Number(e.commissionBalanceBefore ?? 0);
      const after = Number(e.commissionBalanceAfter ?? 0);
      return before !== after;
    })
    .slice(-15);
  if (movers.length > 0) {
    console.log("");
    console.log("=== Last 15 ledger entries that changed commission ===");
    for (const e of movers) {
      const before = Number(e.commissionBalanceBefore ?? 0);
      const after = Number(e.commissionBalanceAfter ?? 0);
      const delta = after - before;
      const sign = delta >= 0 ? "+" : "";
      console.log(
        `  ${e.createdAt.toISOString().slice(0, 19)} ${e.type.padEnd(20)} ${sign}${fmt(delta).padStart(13)}  ` +
        `(${fmt(before)} → ${fmt(after)}) ref=${e.referenceType || "—"}/${(e.referenceId || "—").slice(0, 18)}`,
      );
    }
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
