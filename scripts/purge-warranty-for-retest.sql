-- Resets warranty data so the same accounts can be used for re-testing.
-- Orders + customers + wallets stay; only claim history + warranty-driven wallet refunds go away.
-- Safe to re-run.

BEGIN;

\echo === BEFORE ===
SELECT 'warranty_claims' AS tbl, COUNT(*) FROM warranty_claims
UNION ALL SELECT 'cwl_warranty', COUNT(*) FROM customer_wallet_ledgers WHERE reference_type LIKE 'warranty%'
UNION ALL SELECT 'order_events_warranty', COUNT(*) FROM order_events WHERE event_type LIKE 'warranty%';

-- Subtract previously-refunded warranty amounts from the wallet so the balance lines up with
-- the post-delete ledger. Clamp at 0 in case of pre-existing inconsistency.
UPDATE customer_wallets cw
SET balance = GREATEST(0, balance - COALESCE(refunds.total, 0))
FROM (
  SELECT customer_id, SUM(amount) AS total
  FROM customer_wallet_ledgers
  WHERE reference_type LIKE 'warranty%'
  GROUP BY customer_id
) refunds
WHERE cw.customer_id = refunds.customer_id;

DELETE FROM customer_wallet_ledgers WHERE reference_type LIKE 'warranty%';
DELETE FROM order_events WHERE event_type LIKE 'warranty%';
DELETE FROM warranty_claims;

\echo === AFTER ===
SELECT 'warranty_claims' AS tbl, COUNT(*) FROM warranty_claims
UNION ALL SELECT 'cwl_warranty', COUNT(*) FROM customer_wallet_ledgers WHERE reference_type LIKE 'warranty%'
UNION ALL SELECT 'order_events_warranty', COUNT(*) FROM order_events WHERE event_type LIKE 'warranty%'
UNION ALL SELECT 'orders_kept', COUNT(*) FROM orders;

COMMIT;
