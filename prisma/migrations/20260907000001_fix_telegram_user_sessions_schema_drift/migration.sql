-- Fix schema drift on telegram_user_sessions table.
-- The original migration (20260906000000) created the table with:
--   - "session_string" TEXT  (old name, plaintext)
--   - "telegram_user_id" BIGINT
--   - "groups_count" INTEGER (removed from schema)
--   - "last_synced_at" TIMESTAMP (renamed to last_sync_at)
--
-- The current schema.prisma expects:
--   - "session_string_encrypted" TEXT NOT NULL  (renamed + now encrypted)
--   - "telegram_user_id" TEXT (changed to String for cuid-style IDs)
--   - "last_sync_at" TIMESTAMP (renamed)
--   - "groups_count" removed
--
-- This migration brings the DB in line with the current schema.
-- Existing "session_string" data is migrated into "session_string_encrypted"
-- (values are already stored; encryption happens at application level on write).

-- Step 1: Add the new column (nullable first so existing rows don't fail)
ALTER TABLE "telegram_user_sessions"
  ADD COLUMN IF NOT EXISTS "session_string_encrypted" TEXT;

-- Step 2: Copy data from old column to new column
UPDATE "telegram_user_sessions"
  SET "session_string_encrypted" = "session_string"
  WHERE "session_string_encrypted" IS NULL;

-- Step 3: Set NOT NULL constraint now that all rows have a value
ALTER TABLE "telegram_user_sessions"
  ALTER COLUMN "session_string_encrypted" SET NOT NULL;

-- Step 4: Drop the old column
ALTER TABLE "telegram_user_sessions"
  DROP COLUMN IF EXISTS "session_string";

-- Step 5: Rename last_synced_at -> last_sync_at (if old column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'telegram_user_sessions'
    AND column_name = 'last_synced_at'
  ) THEN
    ALTER TABLE "telegram_user_sessions"
      RENAME COLUMN "last_synced_at" TO "last_sync_at";
  END IF;
END$$;

-- Step 6: Drop groups_count column (removed from schema)
ALTER TABLE "telegram_user_sessions"
  DROP COLUMN IF EXISTS "groups_count";

-- Step 7: Change telegram_user_id from BIGINT to TEXT
-- (schema now uses String type for this field)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'telegram_user_sessions'
    AND column_name = 'telegram_user_id'
    AND data_type = 'bigint'
  ) THEN
    ALTER TABLE "telegram_user_sessions"
      ALTER COLUMN "telegram_user_id" TYPE TEXT USING "telegram_user_id"::TEXT;
  END IF;
END$$;
