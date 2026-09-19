const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../debug_deposit_balance_sync/.env"),
  "D:\\BOT telegram\\reseller-platform\\.env",
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    if (process.env.DATABASE_URL) break;
  }
}

const { PrismaClient, Prisma } = require("@prisma/client");

const prisma = new PrismaClient();

const COMMIT = process.argv.includes("--commit");
const VERBOSE = process.argv.includes("--verbose");
const DEFAULT_RATE = Number(process.env.USDT_VND_RATE || 27000);

async function main() {
  console.log("=== Customer Wallet USD Reconcile Script ===");
  console.log(`Mode: ${COMMIT ? "COMMIT (will update DB)" : "DRY RUN (no writes — run with --commit to apply)"}`);
  console.log(`Default fallback rate: 1 USDT = ${DEFAULT_RATE.toLocaleString("vi-VN")} VND\n`);

  const paymentConfigs = await prisma.paymentConfig.findMany({
    select: { shopId: true, usdtVndRateOverride: true },
  });
  const shopRateMap = new Map();
  for (const pc of paymentConfigs) {
    const override = Number(pc.usdtVndRateOverride);
    if (Number.isFinite(override) && override > 0) {
      shopRateMap.set(pc.shopId, override);
    }
  }

  const wallets = await prisma.customerWallet.findMany({
    include: {
      customer: {
        select: {
          id: true,
          shopId: true,
          telegramUsername: true,
          telegramChatId: true,
        },
      },
    },
  });

  console.log(`Found ${wallets.length} customer wallets to inspect.\n`);

  let inspected = 0;
  let inSync = 0;
  let desynced = 0;
  let updated = 0;

  for (const w of wallets) {
    inspected++;
    const shopId = w.customer?.shopId;
    const rate = (shopId ? shopRateMap.get(shopId) : null) || DEFAULT_RATE;

    const balanceVnd = Number(w.balance);
    const currentUsdt = Number(w.balanceUsdt);
    const expectedUsdt = Number((balanceVnd / Math.max(1, rate)).toFixed(4));

    const diff = Math.abs(currentUsdt - expectedUsdt);
    if (diff <= 0.0001) {
      inSync++;
      if (VERBOSE) {
        console.log(`[IN SYNC] Wallet ${w.id} (User: ${w.customer?.telegramUsername || w.customer?.telegramChatId}): ${balanceVnd.toLocaleString("vi-VN")} VND <=> ${currentUsdt.toFixed(4)} USDT (rate: ${rate})`);
      }
      continue;
    }

    desynced++;
    console.log(
      `[DESYNC] Wallet ${w.id} | Customer: ${w.customer?.telegramUsername || w.customer?.telegramChatId || w.customerId} | Shop: ${shopId || "N/A"}\n` +
      `         VND Balance: ${balanceVnd.toLocaleString("vi-VN")} VND | Rate: ${rate}\n` +
      `         Current USDT: ${currentUsdt.toFixed(4)} USDT  -->  Expected USDT: ${expectedUsdt.toFixed(4)} USDT (diff: ${diff.toFixed(4)})`
    );

    if (COMMIT) {
      await prisma.customerWallet.update({
        where: { id: w.id },
        data: {
          balanceUsdt: new Prisma.Decimal(expectedUsdt.toFixed(4)),
        },
      });
      updated++;
    }
  }

  console.log("\n================ Summary ================");
  console.log(`Total Wallets Inspected: ${inspected}`);
  console.log(`Already In Sync:         ${inSync}`);
  console.log(`Desynced Detected:       ${desynced}`);
  if (COMMIT) {
    console.log(`Successfully Updated:    ${updated}`);
  } else {
    console.log(`To apply these fixes, run: node scripts/reconcile-customer-wallet-usd.cjs --commit`);
  }
  console.log("=========================================\n");
}

main()
  .catch((err) => {
    console.error("Reconciliation error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
