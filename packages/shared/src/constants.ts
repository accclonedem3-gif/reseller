export const APP_NAME = "Reseller Platform";
export const DEFAULT_PROVIDER_NAME = "canboso";
export const DEFAULT_PROVIDER_BASE_URL = "https://canboso.com";
export const DEFAULT_CURRENCY = "VND";

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
} as const;

export const PRODUCT_FAMILY_TO_TOOL: Record<string, "veo" | "grok" | "gpt"> = {
  VEO3: "veo",
  GROK: "grok",
  CHATGPT: "gpt",
};
