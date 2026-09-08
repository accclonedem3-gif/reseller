import assert from "node:assert/strict";

import {
  isOrderPriceSafe,
  resolveAffiliateCommissionRefund,
  resolveInternalStockSettlement,
  resolveSellerSafeAffiliateCommission,
} from "@reseller/shared/server";

assert.equal(
  isOrderPriceSafe({ totalSaleAmount: 133_000, totalSourceAmount: 170_000 }),
  false,
  "an order that would lose money must be blocked",
);

assert.equal(
  isOrderPriceSafe({ totalSaleAmount: 183_000, totalSourceAmount: 170_000 }),
  true,
  "a profitable order must be allowed",
);

assert.equal(
  isOrderPriceSafe({ totalSaleAmount: 170_000, totalSourceAmount: 170_000 }),
  true,
  "a break-even order is safe",
);

assert.equal(
  isOrderPriceSafe({ totalSaleAmount: Number.NaN, totalSourceAmount: 170_000 }),
  false,
  "invalid totals must fail closed",
);

assert.equal(
  isOrderPriceSafe({ totalSaleAmount: -1, totalSourceAmount: -2 }),
  false,
  "negative totals must fail closed",
);

assert.equal(
  resolveSellerSafeAffiliateCommission({
    totalSaleAmount: 100_000,
    totalSourceAmount: 80_000,
    commissionPercent: 10,
  }),
  10_000,
  "normal affiliate commission should be preserved when margin covers it",
);

assert.equal(
  resolveSellerSafeAffiliateCommission({
    totalSaleAmount: 100_000,
    totalSourceAmount: 95_000,
    commissionPercent: 10,
  }),
  5_000,
  "affiliate commission must be capped at the seller's remaining margin",
);

assert.equal(
  resolveSellerSafeAffiliateCommission({
    totalSaleAmount: 90_000,
    totalSourceAmount: 100_000,
    commissionPercent: 10,
  }),
  0,
  "an unsafe order must never create affiliate commission",
);

const profitableInternalSettlement = resolveInternalStockSettlement({
  downstreamSaleAmount: 35_000,
  advertisedWholesaleAmount: 27_000,
  actualStockCost: 12_000,
});
assert.deepEqual(
  profitableInternalSettlement,
  {
    safe: true,
    chargeAmount: 27_000,
    sourceCostSnapshot: 12_000,
  },
  "F2 must be charged F1's advertised wholesale price, never F1's private F0 cost",
);

assert.equal(
  resolveInternalStockSettlement({
    downstreamSaleAmount: 35_000,
    advertisedWholesaleAmount: 27_000,
    actualStockCost: 30_000,
  }).safe,
  false,
  "F1 stock must not be delivered when its actual batch cost exceeds wholesale revenue",
);

assert.equal(
  resolveInternalStockSettlement({
    downstreamSaleAmount: 25_000,
    advertisedWholesaleAmount: 27_000,
    actualStockCost: 12_000,
  }).safe,
  false,
  "F2 must not deliver an order sold below its wholesale cost",
);

assert.equal(
  resolveAffiliateCommissionRefund({
    originalCommission: 10_000,
    remainingCommission: 10_000,
    orderTotal: 100_000,
    refundAmount: 25_000,
  }),
  2_500,
  "a partial refund must claw back the same proportion of affiliate commission",
);

assert.equal(
  resolveAffiliateCommissionRefund({
    originalCommission: 10_000,
    remainingCommission: 2_000,
    orderTotal: 100_000,
    refundAmount: 100_000,
  }),
  2_000,
  "commission clawback must never exceed the remaining credited commission",
);

console.log("order pricing safety tests passed");
