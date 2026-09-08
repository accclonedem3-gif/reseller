import assert from "node:assert/strict";
import test from "node:test";

import { isBinanceAmountWithinTolerance } from "../src/lib/binance-payment-match";

test("accepts a Binance payment that differs from the invoice by exactly one cent", () => {
  assert.equal(isBinanceAmountWithinTolerance(25.79, 25.8), true);
});

test("rejects a Binance payment that differs from the invoice by more than one cent", () => {
  assert.equal(isBinanceAmountWithinTolerance(25.78, 25.8), false);
});

test("accepts an exact Binance payment and rejects invalid amounts", () => {
  assert.equal(isBinanceAmountWithinTolerance(25.8, 25.8), true);
  assert.equal(isBinanceAmountWithinTolerance(Number.NaN, 25.8), false);
  assert.equal(isBinanceAmountWithinTolerance(25.8, 0), false);
});
