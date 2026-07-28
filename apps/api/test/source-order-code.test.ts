import assert from "node:assert/strict";
import test from "node:test";

import { deriveOrderCorrelationSuffix } from "@reseller/shared/server";

import {
  generateOrderCode,
  generateSourceOrderCode,
} from "../src/lib/utils";

test("source orders reuse the five-character downstream order suffix", () => {
  const downstreamOrderCode = "ORD-20260721121230-057";

  assert.equal(deriveOrderCorrelationSuffix(downstreamOrderCode), "30057");
  assert.equal(generateSourceOrderCode(downstreamOrderCode), "SRC-20260721121230-30057");
});

test("direct shop orders keep their existing three-digit suffix", () => {
  assert.match(generateOrderCode(), /^ORD-\d{14}-\d{3}$/);
  assert.match(generateSourceOrderCode(), /^SRC-\d{14}-\d{3}$/);
});
