import assert from "node:assert/strict";

import {
  DEFAULT_SOURCE_WATCH_PROVIDER_NAMES,
  externalSourceGroupKey,
  externalStockFingerprint,
  sourceWatchProviderIntervalMs,
  sourceWatchSchedule,
} from "../src/source-watch";

assert.deepEqual(DEFAULT_SOURCE_WATCH_PROVIDER_NAMES, [
  "canboso",
  "shopmmo",
  "roboticvn",
  "zampto",
  "huymai",
  "gigapower",
]);

const sameA = externalSourceGroupKey({
  providerName: "CanBoSo",
  baseUrl: "https://canboso.com/",
  buyerKey: "buyer-secret",
});
const sameB = externalSourceGroupKey({
  providerName: "canboso",
  baseUrl: "HTTPS://CANBOSO.COM",
  buyerKey: "buyer-secret",
});
assert.equal(
  sameA,
  sameB,
  "equivalent source credentials must share one watcher",
);
assert.equal(
  sameA ===
    externalSourceGroupKey({
      providerName: "shopmmo",
      baseUrl: "https://canboso.com",
      buyerKey: "buyer-secret",
    }),
  false,
  "credentials from different providers must never be merged",
);
assert.notEqual(
  sameA,
  externalSourceGroupKey({
    providerName: "canboso",
    baseUrl: "https://canboso.com",
    buyerKey: "other-secret",
  }),
  "different buyer keys must not be merged without proof that their catalogs are identical",
);
assert.equal(
  sameA.includes("buyer-secret"),
  false,
  "group id must not leak the key",
);

const stockA = externalStockFingerprint([
  { externalId: "b", available: 2 },
  { externalId: "a", available: 1 },
]);
const stockB = externalStockFingerprint([
  { externalId: "a", available: 1 },
  { externalId: "b", available: 2 },
]);
assert.equal(
  stockA,
  stockB,
  "source response ordering must not create false events",
);
assert.notEqual(
  stockA,
  externalStockFingerprint([
    { externalId: "a", available: 1 },
    { externalId: "b", available: 3 },
  ]),
  "an availability change must wake every matching shop",
);

assert.deepEqual(
  sourceWatchSchedule({
    groupCount: 3,
    tickMs: 5_000,
    targetIntervalMs: 5_000,
    maxRequestsPerMinute: 60,
  }),
  { effectiveIntervalMs: 5_000, batchSize: 3 },
);

const cadenceInput = {
  targetIntervalMs: 5_000,
  lightProviderIntervalMs: 15_000,
  shopMmoIntervalMs: 60_000,
  roboticvnIntervalMs: 120_000,
};
assert.equal(
  sourceWatchProviderIntervalMs({ providerName: "canboso", ...cadenceInput }),
  5_000,
);
assert.equal(
  sourceWatchProviderIntervalMs({ providerName: "huymai", ...cadenceInput }),
  15_000,
);
assert.equal(
  sourceWatchProviderIntervalMs({ providerName: "shopmmo", ...cadenceInput }),
  60_000,
);
assert.equal(
  sourceWatchProviderIntervalMs({ providerName: "roboticvn", ...cadenceInput }),
  120_000,
);
assert.deepEqual(
  sourceWatchSchedule({
    groupCount: 120,
    tickMs: 5_000,
    targetIntervalMs: 5_000,
    maxRequestsPerMinute: 60,
  }),
  { effectiveIntervalMs: 120_000, batchSize: 5 },
  "large key counts must stretch polling instead of violating the source request budget",
);

console.log("source-watch tests passed");
