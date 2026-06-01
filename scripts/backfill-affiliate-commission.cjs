require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const COMMIT = process.argv.includes("--commit");
const VERBOSE = process.argv.includes("--verbose");

function fmt(n) {
  return Number(n).toLocaleString("vi-VN") + "đ";
}

async function main() {
  console.log(`Mode: ${COMMIT ? "COMMIT (will write)" : "DRY RUN (no writes — add --commit to apply)"}`);
  console.log("");

  const orders = await prisma.order.findMany({
    where: {
      affiliateCustomerId: { not: null },
      affiliateCommission: { gt: 0 },
    },
    select: {
      id: true,
      orderCode: true,
      affiliateCustomerId: true,
      affiliateCommission: true,
    },
  });

  console.log(`Found ${orders.length} orders with affiliate commission set.`);

  const byReferrer = new Map();
  for (const order of orders) {
    const list = byReferrer.get(order.affiliateCustomerId) || [];
    list.push({
      orderId: order.id,
      orderCode: order.orderCode,
      amount: Number(order.affiliateCommission),
    });
    byReferrer.set(order.affiliateCustomerId, list);
  }

  console.log(`Distinct referrer customers: ${byReferrer.size}`);
  console.log("");

  let customersBackfilled = 0;
  let customersAlreadyOk = 0;
  let ordersBackfilled = 0;
  let amountBackfilled = 0;

  for (const [customerId, ordersForCustomer] of byReferrer) {
    const orderIds = ordersForCustomer.map((o) => o.orderId);
    const existingLedgers = await prisma.customerWalletLedger.findMany({
      where: {
        customerId,
        type: "AFFILIATE_COMMISSION",
        referenceType: "order",
        referenceId: { in: orderIds },
      },
      select: { referenceId: true },
    });
    const existingIds = new Set(existingLedgers.map((l) => l.referenceId).filter(Boolean));
    const missing = ordersForCustomer.filter((o) => !existingIds.has(o.orderId));

    if (missing.length === 0) {
      customersAlreadyOk++;
      if (VERBOSE) {
        console.log(`  [OK]   customer=${customerId} — already credited (${ordersForCustomer.length} orders)`);
      }
      continue;
    }

    const missingAmount = missing.reduce((sum, o) => sum + o.amount, 0);
    customersBackfilled++;
    ordersBackfilled += missing.length;
    amountBackfilled += missingAmount;

    console.log(`  [FIX]  customer=${customerId} — ${missing.length} orders missing ledger, total ${fmt(missingAmount)}`);
    if (VERBOSE) {
      for (const m of missing) {
        console.log(`         · ${m.orderCode} +${fmt(m.amount)}`);
      }
    }

    if (!COMMIT) continue;

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.customerWallet.upsert({
        where: { customerId },
        update: {},
        create: { customerId },
      });

      await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`;
      const fresh = await tx.customerWallet.findUnique({ where: { id: wallet.id } });
      if (!fresh) throw new Error(`Wallet vanished after upsert for customer ${customerId}`);

      const balance = Number(fresh.balance);
      let runningCommission = Number(fresh.commissionBalance);

      for (const m of missing) {
        const commissionBefore = runningCommission;
        const commissionAfter = commissionBefore + m.amount;

        await tx.customerWalletLedger.create({
          data: {
            customerId,
            walletId: wallet.id,
            type: "AFFILIATE_COMMISSION",
            amount: m.amount,
            balanceBefore: balance,
            balanceAfter: balance,
            commissionBalanceBefore: commissionBefore,
            commissionBalanceAfter: commissionAfter,
            referenceType: "order",
            referenceId: m.orderId,
            note: "Backfill: missing commission credit due to pre-34ba03b worker bug",
          },
        });

        runningCommission = commissionAfter;
      }

      await tx.customerWallet.update({
        where: { id: wallet.id },
        data: { commissionBalance: runningCommission },
      });
    });
  }

  console.log("");
  console.log("--- Summary ---");
  console.log(`Customers already OK:    ${customersAlreadyOk}`);
  console.log(`Customers ${COMMIT ? "backfilled" : "needing backfill"}: ${customersBackfilled}`);
  console.log(`Orders ${COMMIT ? "credited" : "to credit"}:         ${ordersBackfilled}`);
  console.log(`Total amount ${COMMIT ? "credited" : "to credit"}:    ${fmt(amountBackfilled)}`);
  if (!COMMIT) {
    console.log("");
    console.log("→ Re-run with --commit to apply (and --verbose for per-order detail).");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("Backfill failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
