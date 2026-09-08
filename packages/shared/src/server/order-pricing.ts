export type OrderPriceSafetyInput = {
  totalSaleAmount: number;
  totalSourceAmount: number;
};

/**
 * A small shared guard used at checkout and again before the upstream purchase.
 * Comparing order totals (instead of unit prices) also covers CTV discounts,
 * quantity promotions, bonus units, and preorder fees.
 */
export function isOrderPriceSafe(input: OrderPriceSafetyInput): boolean {
  const totalSaleAmount = Number(input.totalSaleAmount);
  const totalSourceAmount = Number(input.totalSourceAmount);

  if (
    !Number.isFinite(totalSaleAmount) ||
    !Number.isFinite(totalSourceAmount) ||
    totalSaleAmount < 0 ||
    totalSourceAmount < 0
  ) {
    return false;
  }

  return totalSaleAmount >= totalSourceAmount;
}

export type SellerSafeAffiliateCommissionInput = {
  totalSaleAmount: number;
  totalSourceAmount: number;
  commissionPercent: number;
};

/**
 * Calculate affiliate commission without letting it consume the seller's
 * source cost. Invalid monetary inputs fail closed and return zero.
 */
export function resolveSellerSafeAffiliateCommission(
  input: SellerSafeAffiliateCommissionInput,
): number {
  const totalSaleAmount = Number(input.totalSaleAmount);
  const totalSourceAmount = Number(input.totalSourceAmount);
  const commissionPercent = Number(input.commissionPercent);

  if (
    !Number.isFinite(totalSaleAmount) ||
    !Number.isFinite(totalSourceAmount) ||
    !Number.isFinite(commissionPercent) ||
    totalSaleAmount < 0 ||
    totalSourceAmount < 0 ||
    commissionPercent <= 0
  ) {
    return 0;
  }

  const availableMargin = Math.max(0, totalSaleAmount - totalSourceAmount);
  const configuredCommission =
    (totalSaleAmount * Math.min(100, commissionPercent)) / 100;

  return Math.min(configuredCommission, availableMargin);
}

export type InternalStockSettlementInput = {
  downstreamSaleAmount: number;
  advertisedWholesaleAmount: number;
  actualStockCost: number;
};

/**
 * Keep the F1→F2 charge separate from F1's private stock cost. The private
 * cost is only an analytics snapshot; the downstream order pays the
 * advertised wholesale amount agreed at checkout.
 */
export function resolveInternalStockSettlement(
  input: InternalStockSettlementInput,
) {
  const downstreamSaleAmount = Number(input.downstreamSaleAmount);
  const advertisedWholesaleAmount = Number(input.advertisedWholesaleAmount);
  const actualStockCost = Number(input.actualStockCost);
  const valid =
    Number.isFinite(downstreamSaleAmount) &&
    Number.isFinite(advertisedWholesaleAmount) &&
    Number.isFinite(actualStockCost) &&
    downstreamSaleAmount >= 0 &&
    advertisedWholesaleAmount > 0 &&
    actualStockCost >= 0;

  return {
    safe:
      valid &&
      downstreamSaleAmount >= advertisedWholesaleAmount &&
      advertisedWholesaleAmount >= actualStockCost,
    chargeAmount: valid ? advertisedWholesaleAmount : 0,
    sourceCostSnapshot: valid ? actualStockCost : 0,
  };
}

export function resolveAffiliateCommissionRefund(input: {
  originalCommission: number;
  remainingCommission: number;
  orderTotal: number;
  refundAmount: number;
}) {
  const originalCommission = Number(input.originalCommission);
  const remainingCommission = Number(input.remainingCommission);
  const orderTotal = Number(input.orderTotal);
  const refundAmount = Number(input.refundAmount);
  if (
    !Number.isFinite(originalCommission) ||
    !Number.isFinite(remainingCommission) ||
    !Number.isFinite(orderTotal) ||
    !Number.isFinite(refundAmount) ||
    originalCommission <= 0 ||
    remainingCommission <= 0 ||
    orderTotal <= 0 ||
    refundAmount <= 0
  ) {
    return 0;
  }
  return Math.min(
    remainingCommission,
    originalCommission * Math.min(1, refundAmount / orderTotal),
  );
}
