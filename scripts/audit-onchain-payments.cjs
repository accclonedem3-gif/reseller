require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const cryptoProviders = [
  "USDT_TRC20",
  "USDT_BEP20",
  "USDT_SOL",
  "USDT_TON",
];

function serialize(value) {
  return JSON.stringify(
    value,
    (_key, entry) => typeof entry === "bigint" ? Number(entry) : entry,
    2,
  );
}

async function query(sql) {
  return prisma.$queryRawUnsafe(sql);
}

async function main() {
  const providerList = cryptoProviders.map((value) => `'${value}'`).join(", ");
  const normalizedHashExpression = `CASE
    WHEN regexp_replace(trim(tx_hash), '^0x', '', 'i') ~ '^[0-9a-fA-F]{64}$'
      THEN lower(regexp_replace(trim(tx_hash), '^0x', '', 'i'))
    ELSE trim(tx_hash)
  END`;

  const checks = {
    duplicateNormalizedHashes: await query(`
      SELECT ${normalizedHashExpression} AS tx_hash_normalized, count(*)::int AS occurrences,
             array_agg(external_order_code ORDER BY created_at) AS external_order_codes
      FROM onchain_payment_receipts
      GROUP BY 1
      HAVING count(*) > 1
      ORDER BY occurrences DESC
    `),
    receiptlessPaidTargets: await query(`
      WITH paid_targets AS (
        SELECT 'order'::text AS kind, pt.external_order_code, pt.provider::text AS provider,
               pt.paid_at AS settled_at
        FROM payment_transactions pt
        WHERE pt.provider::text IN (${providerList}) AND pt.status::text = 'PAID'
        UNION ALL
        SELECT 'customer_topup', cwt.external_order_code, cwt.provider::text, cwt.paid_at
        FROM customer_wallet_topups cwt
        WHERE cwt.provider::text IN (${providerList}) AND cwt.status::text = 'PAID'
        UNION ALL
        SELECT 'seller_deposit', dr.external_order_code, dr.provider::text, dr.paid_at
        FROM deposit_requests dr
        WHERE dr.external_order_code IS NOT NULL
          AND dr.provider::text IN (${providerList}) AND dr.status::text = 'CONFIRMED'
        UNION ALL
        SELECT 'connection_topup', ctr.external_order_code, ctr.provider::text, ctr.updated_at
        FROM connection_topup_requests ctr
        WHERE ctr.provider::text IN (${providerList}) AND ctr.status::text = 'PAID'
      )
      SELECT target.*
      FROM paid_targets target
      LEFT JOIN onchain_payment_receipts receipt
        ON receipt.external_order_code = target.external_order_code
      WHERE receipt.id IS NULL
      ORDER BY target.settled_at DESC NULLS LAST
    `),
    unprocessedReceipts: await query(`
      SELECT id, provider::text AS provider, external_order_code, tx_hash, created_at
      FROM onchain_payment_receipts
      WHERE processed_at IS NULL
      ORDER BY created_at
    `),
    duplicateCustomerLedgerEffects: await query(`
      SELECT ledger.reference_type, ledger.reference_id, ledger.type::text AS type,
             ledger.currency, count(*)::int AS occurrences,
             sum(ledger.amount)::text AS total_amount
      FROM customer_wallet_ledgers ledger
      LEFT JOIN customer_wallet_topups topup
        ON ledger.reference_type = 'customer_wallet_topup'
       AND topup.id = ledger.reference_id
      LEFT JOIN connection_topup_requests connection_topup
        ON ledger.reference_type = 'connection_topup_request'
       AND connection_topup.id = ledger.reference_id
      WHERE ledger.reference_id IS NOT NULL
        AND (
          topup.provider::text IN (${providerList})
          OR connection_topup.provider::text IN (${providerList})
        )
      GROUP BY ledger.reference_type, ledger.reference_id, ledger.type, ledger.currency
      HAVING count(*) > 1
      ORDER BY occurrences DESC
    `),
    duplicateSellerLedgerEffects: await query(`
      SELECT ledger.reference_type, ledger.reference_id, ledger.type::text AS type,
             count(*)::int AS occurrences, sum(ledger.amount)::text AS total_amount
      FROM wallet_ledgers ledger
      JOIN deposit_requests deposit
        ON ledger.reference_type = 'deposit_request'
       AND deposit.id = ledger.reference_id
      WHERE ledger.reference_id IS NOT NULL
        AND deposit.provider::text IN (${providerList})
      GROUP BY ledger.reference_type, ledger.reference_id, ledger.type
      HAVING count(*) > 1
      ORDER BY occurrences DESC
    `),
    duplicateTierPaymentReferences: await query(`
      SELECT payment_transaction_id, count(*)::int AS occurrences
      FROM tier_subscriptions
      WHERE payment_transaction_id IS NOT NULL
      GROUP BY payment_transaction_id
      HAVING count(*) > 1
      ORDER BY occurrences DESC
    `),
    stuckPaidOrders: await query(`
      SELECT o.id, o.order_code, pt.external_order_code, o.paid_at
      FROM orders o
      JOIN payment_transactions pt ON pt.order_id = o.id
      WHERE pt.status::text = 'PAID' AND o.status::text = 'PAID'
        AND o.paid_at < now() - interval '2 minutes'
      ORDER BY o.paid_at
    `),
    pendingCryptoCounts: await query(`
      SELECT provider, kind, count(*)::int AS count
      FROM (
        SELECT pt.provider::text AS provider, 'order'::text AS kind
        FROM payment_transactions pt
        WHERE pt.provider::text IN (${providerList}) AND pt.status::text = 'PENDING'
        UNION ALL
        SELECT cwt.provider::text, 'customer_topup'
        FROM customer_wallet_topups cwt
        WHERE cwt.provider::text IN (${providerList}) AND cwt.status::text = 'PENDING'
        UNION ALL
        SELECT dr.provider::text, 'seller_deposit'
        FROM deposit_requests dr
        WHERE dr.provider::text IN (${providerList}) AND dr.status::text = 'PENDING'
        UNION ALL
        SELECT ctr.provider::text, 'connection_topup'
        FROM connection_topup_requests ctr
        WHERE ctr.provider::text IN (${providerList}) AND ctr.status::text = 'PENDING'
      ) pending
      GROUP BY provider, kind
      ORDER BY provider, kind
    `),
  };

  const criticalKeys = [
    "duplicateNormalizedHashes",
    "receiptlessPaidTargets",
    "duplicateCustomerLedgerEffects",
    "duplicateSellerLedgerEffects",
    "duplicateTierPaymentReferences",
  ];
  const criticalCount = criticalKeys.reduce((sum, key) => sum + checks[key].length, 0);

  console.log(serialize({
    generatedAt: new Date().toISOString(),
    safeToEnableCrypto: criticalCount === 0,
    criticalCount,
    checks,
  }));

  if (criticalCount > 0) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error("On-chain audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
