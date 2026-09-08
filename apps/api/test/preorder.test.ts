import assert from "node:assert/strict";

import {
  calculatePreorderCharge,
  calculatePreorderCancellationRefund,
  getAvailableForNewOrders,
  needsPreorder,
  shouldHoldStockForCheckout,
} from "../src/lib/preorder";

assert.equal(getAvailableForNewOrders(null, 99), null);
assert.equal(getAvailableForNewOrders(10, 4), 6);
assert.equal(getAvailableForNewOrders(3, 8), 0);

assert.equal(needsPreorder(0, 1), true);
assert.equal(needsPreorder(2, 2), false);
assert.equal(needsPreorder(null, 100), false);

assert.equal(
  shouldHoldStockForCheckout({
    available: 0,
    requestedQuantity: 1,
    preorderEnabled: true,
  }),
  false,
);
assert.equal(
  shouldHoldStockForCheckout({
    available: 2,
    requestedQuantity: 3,
    preorderEnabled: true,
  }),
  false,
);
assert.equal(
  shouldHoldStockForCheckout({
    available: 2,
    requestedQuantity: 1,
    preorderEnabled: true,
  }),
  true,
);
assert.equal(
  shouldHoldStockForCheckout({
    available: 0,
    requestedQuantity: 1,
    preorderEnabled: false,
  }),
  true,
);

assert.deepEqual(calculatePreorderCharge(100_000, 5), {
  feePercent: 5,
  feeAmount: 5_000,
  totalAmount: 105_000,
});
assert.deepEqual(calculatePreorderCharge(25_790, 2.5), {
  feePercent: 2.5,
  feeAmount: 645,
  totalAmount: 26_435,
});
assert.equal(calculatePreorderCharge(100_000, 999).feePercent, 100);
assert.equal(calculatePreorderCharge(100_000, -10).feePercent, 0);

assert.deepEqual(calculatePreorderCancellationRefund(105_000, 5_000, false), {
  refundAmount: 100_000,
  feeRefundAmount: 0,
  nonRefundedFeeAmount: 5_000,
});
assert.deepEqual(calculatePreorderCancellationRefund(105_000, 5_000, true), {
  refundAmount: 105_000,
  feeRefundAmount: 5_000,
  nonRefundedFeeAmount: 0,
});

console.log("preorder tests passed");
