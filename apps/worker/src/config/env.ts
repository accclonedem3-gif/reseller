import { DEFAULT_SOURCE_WATCH_PROVIDER_NAMES } from "../source-watch";

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
export const INFRA_RETRY_MS = Number(process.env.WORKER_INFRA_RETRY_MS || 5000);
export const TELEGRAM_POLL_INTERVAL_MS = Number(
  process.env.TELEGRAM_POLL_INTERVAL_MS || 5000,
);
export const CATALOG_SYNC_INTERVAL_MS = Number(
  process.env.CATALOG_SYNC_INTERVAL_MS || 60000,
);
export const ROBOTICVN_CATALOG_SYNC_INTERVAL_MS = Number(
  process.env.ROBOTICVN_CATALOG_SYNC_INTERVAL_MS || 120000,
);
export const CATALOG_SCHEDULER_TICK_MS = Number(
  process.env.CATALOG_SCHEDULER_TICK_MS || 5000,
);
export const CATALOG_SHOPS_REFRESH_MS = Number(
  process.env.CATALOG_SHOPS_REFRESH_MS || 60000,
);
export const CATALOG_SYNC_CONCURRENCY = Number(
  process.env.CATALOG_SYNC_CONCURRENCY || 12,
);
export const CATALOG_SYNC_BATCH_SIZE = Number(
  process.env.CATALOG_SYNC_BATCH_SIZE || 0,
);
export const CATALOG_SYNC_LOCK_TTL_MS = Number(
  process.env.CATALOG_SYNC_LOCK_TTL_MS ||
    Math.max(CATALOG_SYNC_INTERVAL_MS * 3, 5 * 60 * 1000),
);
export const SOURCE_WATCH_ENABLED =
  String(process.env.SOURCE_WATCH_ENABLED || "true")
    .trim()
    .toLowerCase() !== "false";
export const SOURCE_WATCH_TICK_MS = Math.max(
  1000,
  Number(process.env.SOURCE_WATCH_TICK_MS || 5000) || 5000,
);
export const SOURCE_WATCH_TARGET_INTERVAL_MS = Math.max(
  SOURCE_WATCH_TICK_MS,
  Number(process.env.SOURCE_WATCH_TARGET_INTERVAL_MS || 5000) || 5000,
);
export const SOURCE_WATCH_MAX_REQUESTS_PER_MINUTE = Math.max(
  1,
  Number(process.env.SOURCE_WATCH_MAX_REQUESTS_PER_MINUTE || 60) || 60,
);
export const SOURCE_WATCH_PROVIDER_NAMES = new Set<string>(
  String(
    process.env.SOURCE_WATCH_PROVIDER_NAMES ||
      DEFAULT_SOURCE_WATCH_PROVIDER_NAMES.join(","),
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
export const SOURCE_WATCH_LIGHT_PROVIDER_INTERVAL_MS = Math.max(
  SOURCE_WATCH_TARGET_INTERVAL_MS,
  Number(process.env.SOURCE_WATCH_LIGHT_PROVIDER_INTERVAL_MS || 15000) ||
    15000,
);
export const SOURCE_WATCH_SHOPMMO_INTERVAL_MS = Math.max(
  SOURCE_WATCH_TARGET_INTERVAL_MS,
  Number(process.env.SOURCE_WATCH_SHOPMMO_INTERVAL_MS || 60000) || 60000,
);
export const SOURCE_WATCH_ROBOTICVN_INTERVAL_MS = Math.max(
  SOURCE_WATCH_TARGET_INTERVAL_MS,
  Number(
    process.env.SOURCE_WATCH_ROBOTICVN_INTERVAL_MS ||
      ROBOTICVN_CATALOG_SYNC_INTERVAL_MS,
  ) || ROBOTICVN_CATALOG_SYNC_INTERVAL_MS,
);
export const RESTOCK_NOTIFICATION_CONCURRENCY = Math.max(
  1,
  Number(process.env.RESTOCK_NOTIFICATION_CONCURRENCY || 3) || 3,
);
export const CUSTOMER_TOPUP_SWEEP_INTERVAL_MS = Number(
  process.env.CUSTOMER_TOPUP_SWEEP_INTERVAL_MS || 15000,
);
export const DATA_CLEANUP_INTERVAL_MS = Number(
  process.env.DATA_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000,
);
export const PAYOS_ORDER_SWEEP_INTERVAL_MS = Number(
  process.env.PAYOS_ORDER_SWEEP_INTERVAL_MS || 10000,
);
export const OKX_DEPOSIT_POLL_INTERVAL_MS = Number(
  process.env.OKX_DEPOSIT_POLL_INTERVAL_MS || 30000,
);
export const TON_PAYMENT_SCAN_INTERVAL_MS = Math.max(
  10000,
  Number(process.env.TON_PAYMENT_SCAN_INTERVAL_MS || 30000) || 30000,
);
export const TON_PAYMENT_SCAN_LOCK_KEY = "locks:payments:usdt-ton-scan";
export const TON_PAYMENT_SCAN_LOCK_TTL_MS = Math.max(
  120000,
  TON_PAYMENT_SCAN_INTERVAL_MS * 4,
);
export const INTERNAL_SOURCE_ORDER_SWEEP_INTERVAL_MS = Number(
  process.env.INTERNAL_SOURCE_ORDER_SWEEP_INTERVAL_MS || 15000,
);
export const PREORDER_FULFILLMENT_SWEEP_INTERVAL_MS = Math.max(
  3000,
  Number(process.env.PREORDER_FULFILLMENT_SWEEP_INTERVAL_MS || 5000),
);
export const ONCHAIN_AUTO_CONFIRM_ENABLED =
  String(process.env.ONCHAIN_AUTO_CONFIRM_ENABLED || "false")
    .trim()
    .toLowerCase() !== "false";

export function getEncryptionKey(): string {
  return process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key";
}

export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }
  const errors: string[] = [];
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "APP_ENCRYPTION_KEY",
    "INTERNAL_API_TOKEN",
    "APP_PUBLIC_URL",
  ]) {
    if (!String(process.env[key] || "").trim()) {
      errors.push(`${key} is required.`);
    }
  }
  for (const key of ["APP_ENCRYPTION_KEY", "INTERNAL_API_TOKEN"]) {
    const value = String(process.env[key] || "");
    if (
      value.length < 32 ||
      /change-me|CHANGE_ME|default|secret/i.test(value)
    ) {
      errors.push(
        `${key} must be a strong random value with at least 32 characters.`,
      );
    }
  }
  if (
    /localhost|127\.0\.0\.1|example\.com/i.test(
      String(process.env.APP_PUBLIC_URL || ""),
    )
  ) {
    errors.push("APP_PUBLIC_URL must use the real production API domain.");
  }
  if (String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true") {
    errors.push("MOCK_PROVIDER_ENABLED must be false in production.");
  }
  if (String(process.env.MOCK_TELEGRAM_MODE || "false") === "true") {
    errors.push("MOCK_TELEGRAM_MODE must be false in production.");
  }
  if (errors.length > 0) {
    throw new Error(
      `Worker production configuration is not safe:\n- ${errors.join("\n- ")}`,
    );
  }
}
