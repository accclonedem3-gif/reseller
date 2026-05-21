-- Backfill DownstreamSourceConnection.balance for all resellers
-- who already topped up via customer wallet before the auto-credit code was deployed.
--
-- Safe to re-run: skips topups that already have a ledger entry.
-- Run in psql or any Postgres client with sufficient privileges.

DO $$
DECLARE
  v_topup RECORD;
  v_conn  RECORD;
  v_bal_before NUMERIC;
  v_bal_after  NUMERIC;
  v_count INT := 0;
BEGIN
  FOR v_topup IN
    SELECT
      t.id          AS topup_id,
      t.shop_id     AS upstream_shop_id,
      t.amount      AS amount,
      c.telegram_chat_id
    FROM customer_wallet_topups t
    JOIN customers c ON c.id = t.customer_id
    WHERE t.status = 'PAID'
      AND c.telegram_chat_id IS NOT NULL
      -- idempotent: skip if already credited
      AND NOT EXISTS (
        SELECT 1
        FROM internal_source_ledgers l
        WHERE l.reference_type = 'customer_wallet_topup'
          AND l.reference_id   = t.id
      )
    ORDER BY t.created_at
  LOOP
    -- Find the active connection for this reseller
    SELECT *
    INTO v_conn
    FROM downstream_source_connections
    WHERE upstream_shop_id            = v_topup.upstream_shop_id
      AND downstream_telegram_chat_id = v_topup.telegram_chat_id
      AND status                      = 'ACTIVE'
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;  -- customer is not a linked reseller, skip
    END IF;

    -- Lock the row to prevent concurrent balance drift
    PERFORM id
    FROM downstream_source_connections
    WHERE id = v_conn.id
    FOR UPDATE;

    -- Re-read after lock to get the freshest balance
    SELECT * INTO v_conn
    FROM downstream_source_connections
    WHERE id = v_conn.id;

    v_bal_before := v_conn.balance;
    v_bal_after  := v_bal_before + v_topup.amount;

    UPDATE downstream_source_connections
    SET balance = v_bal_after
    WHERE id = v_conn.id;

    INSERT INTO internal_source_ledgers (
      id,
      connection_id,
      type,
      amount,
      balance_before,
      balance_after,
      reference_type,
      reference_id,
      note,
      created_at
    ) VALUES (
      gen_random_uuid()::text,
      v_conn.id,
      'TOPUP'::"InternalSourceLedgerType",
      v_topup.amount,
      v_bal_before,
      v_bal_after,
      'customer_wallet_topup',
      v_topup.topup_id,
      'Backfill: credit from customer wallet top-up (pre-deploy)',
      NOW()
    );

    v_count := v_count + 1;

    RAISE NOTICE 'connection=% topup=% amount=% balance % -> %',
      v_conn.id, v_topup.topup_id, v_topup.amount, v_bal_before, v_bal_after;
  END LOOP;

  RAISE NOTICE '=== Backfill done: % topup(s) credited ===', v_count;
END $$;
