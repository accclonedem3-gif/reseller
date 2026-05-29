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
  console.log("=== Ledger (event log) ===");
  console.log(`Commission credited (ledger sum): ${fmt(ledgerCommission._sum.amount || 0)}  (${ledgerCommission._count._all} entries)`);
  console.log(`Spent on orders:                  ${fmt(spendLedger._sum.amount || 0)}  (${spendLedger._count._all} entries)`);
  console.log(`Top-up:                           ${fmt(topupLedger._sum.amount || 0)}  (${topupLedger._count._all} entries)`);
  console.log("");

  const lifetimeNum = Number(lifetimeEarned._sum.affiliateCommission || 0);
  const ledgerNum = Number(ledgerCommission._sum.amount || 0);
  const balanceNum = Number(customer.wallet?.commissionBalance || 0);
  const drift = lifetimeNum - ledgerNum;

  console.log("=== Diagnosis ===");
  if (drift > 0) {
    console.log(`⚠️  Ledger DRIFT: ${fmt(drift)} earned but never written to ledger → backfill needed.`);
  } else if (drift === 0) {
    console.log(`✅ Lifetime earned matches ledger sum (${fmt(lifetimeNum)}).`);
    if (balanceNum < ledgerNum) {
      const spent = Math.abs(Number(spendLedger._sum.amount || 0));
      console.log(`ℹ️  Current commission balance (${fmt(balanceNum)}) < ledger sum (${fmt(ledgerNum)}).`);
      console.log(`   This is normal if customer spent commission (${fmt(spent)} on orders).`);
      console.log(`   → No bug. The aff panel shows lifetime, wallet shows current.`);
    } else if (balanceNum === ledgerNum) {
      console.log(`✅ Wallet balance equals total credited — never spent.`);
    } else {
      console.log(`⚠️  Wallet balance (${fmt(balanceNum)}) > ledger credited (${fmt(ledgerNum)}). Something credited outside ledger?`);
    }
  } else {
    console.log(`⚠️  Ledger sum (${fmt(ledgerNum)}) > Order lifetime sum (${fmt(lifetimeNum)}). Over-credit?`);
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
