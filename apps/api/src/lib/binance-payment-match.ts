export function isBinanceAmountWithinTolerance(
  receivedUsdt: number,
  expectedUsdt: number,
  toleranceCents = 1,
) {
  if (
    !Number.isFinite(receivedUsdt) ||
    !Number.isFinite(expectedUsdt) ||
    receivedUsdt <= 0 ||
    expectedUsdt <= 0
  ) {
    return false;
  }

  const receivedCents = Math.round(receivedUsdt * 100);
  const expectedCents = Math.round(expectedUsdt * 100);
  return Math.abs(receivedCents - expectedCents) <= toleranceCents;
}
