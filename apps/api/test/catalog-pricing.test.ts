import assert from "node:assert/strict";

import {
  resolveInternalCatalogSourcePrice,
  resolveSyncedSalePrice,
  resolveSyncedWholesalePrice,
  roundMarkupSalePrice,
} from "@reseller/shared/server";

// Unit tests for roundMarkupSalePrice: >= 500 rounds UP, < 500 rounds DOWN
assert.equal(roundMarkupSalePrice(13_500), 14_000, "13,500 must round up to 14,000");
assert.equal(roundMarkupSalePrice(13_499), 13_000, "13,499 must round down to 13,000");
assert.equal(roundMarkupSalePrice(13_530), 14_000, "13,530 must round up to 14,000");
assert.equal(roundMarkupSalePrice(13_200), 13_000, "13,200 must round down to 13,000");
assert.equal(roundMarkupSalePrice(20_500), 21_000, "20,500 must round up to 21,000");
assert.equal(roundMarkupSalePrice(20_499), 20_000, "20,499 must round down to 20,000");
assert.equal(roundMarkupSalePrice(499), 1_000, "499 should not drop to 0, minimum 1,000");
assert.equal(roundMarkupSalePrice(0), 0, "0 should stay 0");

assert.equal(
  resolveInternalCatalogSourcePrice({
    internalSourcePrice: null,
    fallbackSalePrice: 130_000,
    connectionDiscountPercent: 0,
  }),
  130_000,
  "F2 must inherit F1 retail price when no wholesale price is configured",
);

assert.equal(
  resolveInternalCatalogSourcePrice({
    internalSourcePrice: 90_000,
    fallbackSalePrice: 130_000,
    connectionDiscountPercent: 10,
  }),
  81_000,
  "the connection discount must be applied once to the wholesale source price",
);

assert.equal(
  resolveInternalCatalogSourcePrice({
    internalSourcePrice: null,
    fallbackSalePrice: null,
    connectionDiscountPercent: 0,
  }),
  0,
  "a missing F1 wholesale and retail price must never fall back to F0",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 100_000,
    previousSourcePrice: 100_000,
    existingSalePrice: 130_000,
    salePriceLocked: true,
    markupPercent: null,
  }),
  null,
  "a stock-only sync must not rewrite a manually configured F2 margin",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 170_000,
    previousSourcePrice: 120_000,
    existingSalePrice: 140_000,
    salePriceLocked: true,
    markupPercent: 30,
  }),
  190_000,
  "a manually configured product must preserve its 20k absolute margin",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 100_000,
    previousSourcePrice: 120_000,
    existingSalePrice: 140_000,
    salePriceLocked: true,
    markupPercent: 30,
  }),
  120_000,
  "a manually configured margin must also be preserved when source price falls",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 100_000,
    previousSourcePrice: 100_000,
    existingSalePrice: 130_000,
    salePriceLocked: false,
    markupPercent: null,
  }),
  130_000,
  "unchanged source price must keep the existing unlocked F2 price",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 110_000,
    previousSourcePrice: 100_000,
    existingSalePrice: 130_000,
    salePriceLocked: false,
    markupPercent: null,
  }),
  140_000,
  "a genuine source-price change should preserve the absolute margin",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 100_000,
    previousSourcePrice: null,
    existingSalePrice: null,
    salePriceLocked: false,
    markupPercent: 20,
  }),
  120_000,
  "configured percentage markup should remain authoritative",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 9_700,
    previousSourcePrice: null,
    existingSalePrice: null,
    salePriceLocked: false,
    markupPercent: 0,
  }),
  10_000,
  "0% markup should round 9,700 up to 10,000 (>= 500 rounds up)",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 12_300,
    previousSourcePrice: null,
    existingSalePrice: null,
    salePriceLocked: false,
    markupPercent: 10,
  }),
  14_000,
  "12,300 with 10% markup (13,530) must round up to 14,000",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 12_000,
    previousSourcePrice: null,
    existingSalePrice: null,
    salePriceLocked: false,
    markupPercent: 2,
  }),
  12_000,
  "12,000 with 2% markup (12,240) must round down to 12,000",
);

assert.equal(
  resolveSyncedSalePrice({
    sourcePrice: 110_000,
    previousSourcePrice: 100_000,
    existingSalePrice: 123_456,
    salePriceLocked: true,
    markupPercent: 20,
  }),
  133_456,
  "seller manually set odd price (123,456) must remain untouched and not rounded",
);

assert.equal(
  resolveSyncedWholesalePrice({
    sourcePrice: 110_000,
    previousSourcePrice: 100_000,
    existingWholesalePrice: 120_000,
  }),
  130_000,
  "CTV price must rise by the same delta as the upstream source price",
);

assert.equal(
  resolveSyncedWholesalePrice({
    sourcePrice: 80_000,
    previousSourcePrice: 100_000,
    existingWholesalePrice: 120_000,
  }),
  100_000,
  "CTV price must fall by the same delta as the upstream source price",
);

assert.equal(
  resolveSyncedWholesalePrice({
    sourcePrice: 100_000,
    previousSourcePrice: 100_000,
    existingWholesalePrice: 120_000,
  }),
  null,
  "stock-only syncs must not rewrite the configured CTV price",
);

assert.equal(
  resolveSyncedWholesalePrice({
    sourcePrice: 110_000,
    previousSourcePrice: 100_000,
    existingWholesalePrice: null,
  }),
  null,
  "an inherited retail price must stay unpersisted",
);

assert.equal(
  resolveSyncedWholesalePrice({
    sourcePrice: 115_000,
    previousSourcePrice: 100_000,
    existingWholesalePrice: 105_000,
  }),
  120_000,
  "CTV price must preserve its configured margin after a source increase",
);

console.log("catalog pricing tests passed");
