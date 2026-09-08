export function getAvailableForNewOrders(
  available: number | null,
  reservedOrderQuantity: number,
) {
  if (available === null) return null;
  return Math.max(0, available - Math.max(0, reservedOrderQuantity));
}

export function needsPreorder(
  availableForNewOrders: number | null,
  requestedQuantity: number,
) {
  return availableForNewOrders !== null && availableForNewOrders < requestedQuantity;
}

export function shouldHoldStockForCheckout(input: {
  available: number | null;
  requestedQuantity: number;
  preorderEnabled: boolean;
}) {
  if (input.available === null) return false;
  if (input.preorderEnabled && needsPreorder(input.available, input.requestedQuantity)) {
    return false;
  }
  return true;
}

export function calculatePreorderCharge(
  merchandiseAmount: number,
  configuredFeePercent: number,
) {
  const feePercent = Math.min(100, Math.max(0, configuredFeePercent));
  const feeAmount = Math.round(Math.max(0, merchandiseAmount) * feePercent / 100);
  return {
    feePercent,
    feeAmount,
    totalAmount: Math.max(0, merchandiseAmount) + feeAmount,
  };
}

export function calculatePreorderCancellationRefund(
  totalAmount: number,
  preorderFeeAmount: number,
  canceledBySeller: boolean,
) {
  const safeTotal = Math.max(0, totalAmount);
  const safeFee = Math.min(safeTotal, Math.max(0, preorderFeeAmount));
  return {
    refundAmount: canceledBySeller ? safeTotal : safeTotal - safeFee,
    feeRefundAmount: canceledBySeller ? safeFee : 0,
    nonRefundedFeeAmount: canceledBySeller ? 0 : safeFee,
  };
}
