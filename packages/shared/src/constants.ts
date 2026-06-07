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
} as const;

export const JOBS = {
  syncCatalog: "sync-catalog",
  purchaseUpstream: "purchase-upstream",
  broadcast: "broadcast",
} as const;

export const API_PREFIX = "api/v1";
