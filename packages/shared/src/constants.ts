export const APP_NAME = "Reseller Platform";
export const DEFAULT_PROVIDER_NAME = "canboso";
export const DEFAULT_PROVIDER_BASE_URL = "https://canboso.com";
export const DEFAULT_CURRENCY = "VND";

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
