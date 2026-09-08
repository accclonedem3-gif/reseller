import assert from "node:assert/strict";
import test from "node:test";

import { convertProviderPriceToVnd } from "../../../packages/shared/src/server/provider";

test("converts USD provider prices to VND before catalog persistence", () => {
  assert.equal(convertProviderPriceToVnd(100, "USD", 27_000), 2_700_000);
});

test("converts USDT provider prices case-insensitively", () => {
  assert.equal(convertProviderPriceToVnd(1.25, "usdt", 27_000), 33_750);
});

test("keeps VND provider prices unchanged", () => {
  assert.equal(convertProviderPriceToVnd(125_000, "VND", 27_000), 125_000);
});

test("rejects unknown currencies instead of treating them as VND", () => {
  assert.throws(
    () => convertProviderPriceToVnd(100, "EUR", 27_000),
    /Unsupported provider product currency: EUR/,
  );
});