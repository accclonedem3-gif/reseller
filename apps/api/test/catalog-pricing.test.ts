import assert from "node:assert/strict";

import {
  resolveInternalCatalogSourcePrice,
  resolveSyncedSalePrice,
  resolveSyncedWholesalePrice,
} from "@reseller/shared/server";

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
