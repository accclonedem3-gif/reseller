-- Defense-in-depth for warranty refunds: make double-refund STORAGE-IMPOSSIBLE, not merely
-- prevented by application-level row locks. Partial UNIQUE indexes scoped to the warranty refund
-- reference types so unrelated ledger rows (topups, purchases, deposits, ...) are unaffected.
--
-- Partial (WHERE ...) unique indexes cannot be expressed in schema.prisma, hence this raw SQL
-- migration. Prod applies it via `prisma migrate deploy`.

-- End-customer wallet refunds: at most ONE per (type, claim). The two out-of-stock refund paths
-- (autoRefundForOutOfStock → 'warranty_refund', applyPartialStockRefund → 'warranty_partial_refund')
-- each key on the claim id. Cascade is intentionally EXCLUDED here: a single root claim can
-- legitimately credit several DISTINCT upstream sellers (one row each), so it is deduped on the
-- internal_source_ledgers index below instead.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cwl_warranty_refund_per_claim"
  ON "customer_wallet_ledgers" ("reference_type", "reference_id")
  WHERE "reference_type" IN ('warranty_refund', 'warranty_partial_refund');

-- Upstream cascade refunds: at most ONE per (root claim, connection hop). Matches the
-- cascadeRefundUpstream idempotency key exactly (referenceType + rootClaimId + connectionId).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_isl_warranty_cascade_per_hop"
  ON "internal_source_ledgers" ("reference_type", "reference_id", "connection_id")
  WHERE "reference_type" = 'warranty_cascade_refund';
