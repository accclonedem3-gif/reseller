/**
 * Return the compact suffix used to correlate an upstream source order with the
 * downstream reseller order that triggered it. Separators are ignored so a
 * code such as `ORD-20260721121230-057` becomes `30057`.
 */
export function deriveOrderCorrelationSuffix(
  downstreamOrderCode: string | null | undefined,
  length = 5,
) {
  const safeLength = Number.isInteger(length) && length > 0
    ? Math.min(length, 32)
    : 5;
  const compactCode = String(downstreamOrderCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!compactCode) {
    return null;
  }

  return compactCode.slice(-safeLength).padStart(safeLength, "0");
}

/** Extract the 14-digit UTC timestamp embedded in the platform's ORD code. */
export function deriveOrderCorrelationTimestamp(
  downstreamOrderCode: string | null | undefined,
) {
  const match = String(downstreamOrderCode || "").match(/(?:^|\D)(\d{14})(?:\D|$)/);
  return match?.[1] || null;
}
