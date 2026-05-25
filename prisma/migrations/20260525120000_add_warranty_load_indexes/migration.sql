-- Composite index for stuck-claim sweep (worker scans every 60s).
-- Without this, scans grow O(n) once warranty_claims exceeds a few thousand rows.
CREATE INDEX IF NOT EXISTS "warranty_claims_auto_check_status_started_idx"
  ON "warranty_claims" ("auto_check_status", "auto_check_started_at");

-- Composite index for findCooldownBlocker — per-order resolved-claim lookup is hot
-- on every public/Telegram warranty submit.
CREATE INDEX IF NOT EXISTS "warranty_claims_order_status_resolved_idx"
  ON "warranty_claims" ("order_id", "status", "resolved_at");
