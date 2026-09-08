export type SyncedSalePriceInput = {
  sourcePrice: number;
  previousSourcePrice: number | null;
  existingSalePrice: number | null;
  salePriceLocked: boolean;
  markupPercent: number | null;
  defaultMarkupAmount?: number;
};

export type SyncedWholesalePriceInput = {
  sourcePrice: number;
  previousSourcePrice: number | null;
  existingWholesalePrice: number | null;
};

export function resolveInternalCatalogSourcePrice(input: {
  internalSourcePrice: number | null;
  fallbackSalePrice: number | null;
  connectionDiscountPercent?: number | null;
}) {
  // Never expose the upstream provider cost to a downstream shop. When F1
  // has not configured a dedicated F2/wholesale price, F2 inherits F1's
  // retail price. A missing retail price resolves to 0 so purchase paths can
  // reject the product instead of silently charging F0.
  const basePrice = input.internalSourcePrice ?? input.fallbackSalePrice ?? 0;
  const discountPercent = Math.min(
    100,
    Math.max(0, Number(input.connectionDiscountPercent) || 0),
  );
  return discountPercent > 0
    ? Math.round(basePrice * (1 - discountPercent / 100))
    : basePrice;
}

/**
 * Resolve the downstream sale price for a catalog sync.
 *
 * A manually configured price locks its absolute margin over the source cost.
 * Stock-only syncs leave it untouched; genuine source-price changes move the
 * sale price by the same delta. Unconfigured prices follow the percentage
 * markup when present, otherwise they keep the default absolute margin.
 */
export function resolveSyncedSalePrice(input: SyncedSalePriceInput): number | null {
  const defaultMarkupAmount = input.defaultMarkupAmount ?? 10_000;

  if (input.salePriceLocked) {
    if (
      input.previousSourcePrice === null ||
      input.existingSalePrice === null
    ) {
      return null;
    }

    const sourceDelta = input.sourcePrice - input.previousSourcePrice;
    if (sourceDelta === 0) return null;

    return Math.max(
      input.sourcePrice,
      input.existingSalePrice + sourceDelta,
    );
  }

  if (input.markupPercent !== null && input.markupPercent > 0) {
    return input.sourcePrice * (1 + input.markupPercent / 100);
  }

  if (input.previousSourcePrice !== null && input.existingSalePrice !== null) {
    const sourceDelta = input.sourcePrice - input.previousSourcePrice;
    return Math.max(
      input.sourcePrice + defaultMarkupAmount,
      input.existingSalePrice + sourceDelta,
    );
  }

  return input.sourcePrice + defaultMarkupAmount;
}

/**
 * Keep a seller-configured CTV/wholesale margin stable when the upstream
 * source price changes. A null wholesale price means the downstream shop
 * already inherits the seller's retail price, so there is nothing to persist.
 */
export function resolveSyncedWholesalePrice(
  input: SyncedWholesalePriceInput,
): number | null {
  if (
    input.previousSourcePrice === null ||
    input.existingWholesalePrice === null ||
    !Number.isFinite(input.sourcePrice) ||
    !Number.isFinite(input.previousSourcePrice) ||
    !Number.isFinite(input.existingWholesalePrice)
  ) {
    return null;
  }

  const sourceDelta = input.sourcePrice - input.previousSourcePrice;
  if (sourceDelta === 0) return null;

  return Math.max(
    input.sourcePrice,
    input.existingWholesalePrice + sourceDelta,
  );
}
