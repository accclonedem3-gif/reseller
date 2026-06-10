export const APP_NAME = "Reseller Platform";
export const DEFAULT_PROVIDER_NAME = "canboso";
export const DEFAULT_PROVIDER_BASE_URL = "https://canboso.com";
export const DEFAULT_CURRENCY = "VND";

/**
 * Single source of truth for the fallback USDT→VND conversion rate.
 * Per-shop overrides live on `PaymentConfig.usdtVndRateOverride`; this is the
 * default used when no override is configured (mirrors `USDT_VND_RATE` env default).
 */
export const DEFAULT_USDT_VND_RATE = 27000;

export const QUEUES = {
  syncCatalog: "sync-catalog",
  purchaseUpstream: "purchase-upstream",
  broadcast: "broadcast",
  accountCheck: "account-check",
} as const;

export const JOBS = {
  syncCatalog: "sync-catalog",
  purchaseUpstream: "purchase-upstream",
  broadcast: "broadcast",
  accountCheck: "account-check",
} as const;

export const API_PREFIX = "api/v1";

export const SYSTEM_CONFIG_KEYS = {
  warrantyCheckConcurrency: "warranty.check.concurrency",
  // Số account check song song TRONG 1 job (1 đơn nhiều acc). Worker đọc hot mỗi job — đổi
  // không cần restart. 4GB nên để 2; cao hơn = nhiều Chrome cùng lúc = tốn RAM/dễ sập.
  warrantyCheckPerJobParallel: "warranty.check.perJobParallel",
  warrantyCheckJobTimeoutMs: "warranty.check.jobTimeoutMs",
  warrantyCooldownDays: "warranty.cooldownDays",
  // Newline-separated proxy list passed to single-check.js subprocesses via CHECK_PROXY env.
  // Format mỗi dòng: scheme://[user:pass@]host:port  OR  host:port[:user:pass]
  // Worker rotate round-robin theo index account, không proxy thì warranty check chạy raw IP.
  warrantyCheckProxies: "warranty.check.proxies",
  // Cổng duyệt hoàn tiền: khi tool báo acc CHẾT + hết hàng thay, nếu số tiền hoàn DỰ KIẾN > ngưỡng
  // này (VNĐ) thì KHÔNG auto-hoàn ví mà chuyển PENDING_REVIEW cho seller duyệt tay — chống
  // false-dead (tool báo chết nhầm) hoàn nhầm số lớn không thu hồi được. 0 = tắt (auto-hoàn mọi mức).
  warrantyRefundReviewAboveVnd: "warranty.refund.reviewAboveVnd",
} as const;

export const WARRANTY_AUTO_CHECK_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  UNSUPPORTED: "unsupported",
  SKIPPED: "skipped",
  OVERLOADED: "overloaded",
  // Set when a seller resolves/rejects the claim manually before the auto-check landed —
  // signals the pipeline to ignore any late callback for this claim and the sweep to skip it.
  CANCELLED: "cancelled",
} as const;

export const ACCOUNT_CHECK_TOOLS = {
  VEO: "veo",
  GROK: "grok",
  GPT: "gpt",
  CURSOR: "cursor",
} as const;

// Maps a product family → its auto-check tool. CHATGPT is intentionally NOT listed: the GPT
// checker isn't built yet, so ChatGPT warranties resolve to UNSUPPORTED → seller handles manually
// (resolveToolForFamily returns null for unmapped families). Add CHATGPT: "gpt" back once the
// check_gpt tool is implemented + hardened.
// CURSOR → "cursor": external HTTP checker (separate repo/VPS). Auto-routes once the
// CHECK_CURSOR_URL env points the worker at the running cursor checker server.
export const PRODUCT_FAMILY_TO_TOOL: Record<string, "veo" | "grok" | "gpt" | "cursor"> = {
  VEO3: "veo",
  GROK: "grok",
  CURSOR: "cursor",
};
