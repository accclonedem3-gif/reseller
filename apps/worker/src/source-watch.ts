import { createHash } from "node:crypto";

export type ExternalSourceCredentials = {
  providerName?: string | null;
  baseUrl: string;
  buyerKey: string;
};

export type StockProduct = {
  externalId?: string | null;
  available?: number | null;
  hidden?: boolean | null;
};

export const DEFAULT_SOURCE_WATCH_PROVIDER_NAMES = [
  "canboso",
  "shopmmo",
  "roboticvn",
  "zampto",
  "huymai",
  "gigapower",
] as const;

export function normalizeSourceProviderName(value: unknown): string {
  return String(value || "external")
    .trim()
    .toLowerCase();
}

export function normalizeSourceBaseUrl(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Stable, non-reversible identity; buyer keys must never appear in Redis keys or logs. */
export function externalSourceGroupKey(
  credentials: ExternalSourceCredentials,
): string {
  return createHash("sha256")
    .update(
      [
        normalizeSourceProviderName(credentials.providerName),
        normalizeSourceBaseUrl(credentials.baseUrl),
        String(credentials.buyerKey || "").trim(),
      ].join("\u0000"),
    )
    .digest("hex");
}

/** Price/name changes do not wake the hot stock path; normal catalog reconciliation handles them. */
export function externalStockFingerprint(products: StockProduct[]): string {
  const rows = products
    .map((product) => {
      const id = String(product.externalId || "").trim();
      const available = Number.isFinite(Number(product.available))
        ? Math.max(0, Math.floor(Number(product.available)))
        : "null";
      return `${id}\u0000${available}\u0000${product.hidden === true ? 1 : 0}`;
    })
    .filter((row) => !row.startsWith("\u0000"))
    .sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

/**
 * Full-catalog cost differs substantially by provider. Canboso exposes one compact catalog
 * request, the light providers expose one stock-bearing list, ShopMMO paginates, and RoboticVN
 * fans out into paced product-detail requests. Keep one shared watcher implementation while
 * retaining a safe minimum interval for the expensive adapters.
 */
export function sourceWatchProviderIntervalMs(input: {
  providerName?: string | null;
  targetIntervalMs: number;
  lightProviderIntervalMs: number;
  shopMmoIntervalMs: number;
  roboticvnIntervalMs: number;
}): number {
  const providerName = normalizeSourceProviderName(input.providerName);
  const target = Math.max(1_000, Number(input.targetIntervalMs) || 1_000);

  if (providerName === "roboticvn") {
    return Math.max(target, Number(input.roboticvnIntervalMs) || target);
  }
  if (providerName === "shopmmo") {
    return Math.max(target, Number(input.shopMmoIntervalMs) || target);
  }
  if (providerName === "canboso") return target;

  return Math.max(target, Number(input.lightProviderIntervalMs) || target);
}

export function sourceWatchSchedule(input: {
  groupCount: number;
  tickMs: number;
  targetIntervalMs: number;
  maxRequestsPerMinute: number;
}): { effectiveIntervalMs: number; batchSize: number } {
  const groupCount = Math.max(0, Math.floor(input.groupCount));
  if (groupCount === 0) {
    return { effectiveIntervalMs: input.targetIntervalMs, batchSize: 0 };
  }
  const maxRequestsPerMinute = Math.max(
    1,
    Math.floor(input.maxRequestsPerMinute),
  );
  const rateLimitedIntervalMs = Math.ceil(
    (groupCount * 60_000) / maxRequestsPerMinute,
  );
  const effectiveIntervalMs = Math.max(
    input.targetIntervalMs,
    rateLimitedIntervalMs,
  );
  const batchSize = Math.max(
    1,
    Math.min(
      groupCount,
      Math.ceil((groupCount * input.tickMs) / effectiveIntervalMs),
    ),
  );
  return { effectiveIntervalMs, batchSize };
}
