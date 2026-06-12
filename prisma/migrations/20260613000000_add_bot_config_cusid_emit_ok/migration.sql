-- Self-learned flag: whether this bot can actually emit custom emoji (cusid) on inline buttons.
-- NULL = unknown (attempt bling), TRUE = can emit, FALSE = cannot (owner not premium) -> use text icons.
-- Set to FALSE when a small message (home menu) with a cusid is rejected by Telegram and the client
-- has to strip the custom-emoji ids.
ALTER TABLE "bot_configs" ADD COLUMN "cusid_emit_ok" BOOLEAN;
