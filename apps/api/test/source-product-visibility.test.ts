import assert from "node:assert/strict";
import test from "node:test";

import {
  isOwnShopProduct,
  isProductVisibleForBot,
} from "../src/lib/source-product-visibility";

test("manual products remain visible in own-products-only mode", () => {
  const manual = { providerName: "manual", metadataJson: { manual: true } };

  assert.equal(isOwnShopProduct(manual), true);
  assert.equal(isProductVisibleForBot(manual, true), true);
});

test("synced source products are hidden only while own-products-only mode is active", () => {
  const synced = { providerName: "internal_pro", metadataJson: {} };

  assert.equal(isOwnShopProduct(synced), false);
  assert.equal(isProductVisibleForBot(synced, false), true);
  assert.equal(isProductVisibleForBot(synced, true), false);
});
