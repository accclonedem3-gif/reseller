import { Prisma } from "@prisma/client";

export function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export function normalizeSourceEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[] | T[],
): T | undefined {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized || !(allowedValues as readonly string[]).includes(normalized)) {
    return undefined;
  }
  return normalized as T;
}

export function extractInternalBusinessFields(metadata: any) {
  return {
    productFamily: normalizeSourceEnum(metadata?.productFamily, [
      "CHATGPT",
      "VEO3",
      "CLAUDE",
      "GEMINI",
      "CANVA",
      "CAPCUT",
      "OTHER",
    ] as const),
    productFamilyOther:
      String(metadata?.productFamily || "")
        .trim()
        .toUpperCase() === "OTHER"
        ? String(metadata?.productFamilyOther || "").trim() || null
        : null,
    accountType: normalizeSourceEnum(metadata?.accountType, [
      "PERSONAL",
      "SHARED",
      "ADD_FAMILY",
      "CREDIT_API",
      "OTHER",
    ] as const),
    accountTypeOther:
      String(metadata?.accountType || "")
        .trim()
        .toUpperCase() === "OTHER"
        ? String(metadata?.accountTypeOther || "").trim() || null
        : null,
    durationType: normalizeSourceEnum(metadata?.durationType, [
      "DAY_1",
      "DAY_7",
      "MONTH_1",
      "MONTH_3",
      "MONTH_6",
      "MONTH_12",
      "LIFETIME",
      "OTHER",
    ] as const),
    durationTypeOther:
      String(metadata?.durationType || "")
        .trim()
        .toUpperCase() === "OTHER"
        ? String(metadata?.durationTypeOther || "").trim() || null
        : null,
    sourceDeliveryMode: normalizeSourceEnum(
      metadata?.sourceDeliveryMode || metadata?.deliveryMode,
      ["AUTO_API", "AUTO_STOCK", "MANUAL", "ADD_MAIL"] as const,
    ),
    warrantyPolicy: normalizeSourceEnum(metadata?.warrantyPolicy, [
      "KBH",
      "BH24H",
      "BH1M",
      "BH6M",
      "BH12M",
    ] as const),
  };
}
