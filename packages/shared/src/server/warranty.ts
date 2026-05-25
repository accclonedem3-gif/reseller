export type WarrantyPolicyCode = "KBH" | "BH24H" | "BH1M" | "BH3M" | "BH6M" | "BH12M" | "BHF";
export type DeliveryModeCode = "AUTO_API" | "AUTO_STOCK" | "MANUAL";

type WarrantySnapshotInput = {
  productName?: string | null;
  sourceDescription?: string | null;
  warrantyPolicy?: string | null;
  sourceDeliveryMode?: string | null;
  providerName?: string | null;
  metadata?: Record<string, unknown> | null;
};

function normalizeText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function firstText(values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeText(value);

    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function normalizeWarrantyPolicy(value: unknown): WarrantyPolicyCode | null {
  const normalized = normalizeText(value).toUpperCase();

  if (normalized === "KBH") return "KBH";
  if (normalized === "BH24H") return "BH24H";
  if (normalized === "BH1M") return "BH1M";
  if (normalized === "BH3M") return "BH3M";
  if (normalized === "BH6M") return "BH6M";
  if (normalized === "BH12M") return "BH12M";
  if (normalized === "BHF") return "BHF";

  return null;
}

function normalizeDeliveryMode(value: unknown): DeliveryModeCode | null {
  const normalized = normalizeText(value).toUpperCase();

  if (normalized === "AUTO_API") return "AUTO_API";
  if (normalized === "AUTO_STOCK") return "AUTO_STOCK";
  if (normalized === "MANUAL") return "MANUAL";

  return null;
}

function hasDeliveryEntries(metadata: Record<string, unknown>) {
  if (Array.isArray(metadata.deliveryEntries)) {
    return metadata.deliveryEntries.some((entry) => normalizeText(entry));
  }

  return normalizeText(metadata.deliveryText).length > 0;
}

export function inferWarrantyPolicy(
  input: WarrantySnapshotInput,
): WarrantyPolicyCode | null {
  const metadata = asRecord(input.metadata);
  const explicitPolicy =
    normalizeWarrantyPolicy(input.warrantyPolicy) ||
    normalizeWarrantyPolicy(metadata.warrantyPolicy) ||
    normalizeWarrantyPolicy(metadata.policyWarranty);

  if (explicitPolicy) {
    return explicitPolicy;
  }

  const searchText = firstText([
    metadata.warranty,
    metadata.warrantyTime,
    metadata.warrantyPeriod,
    metadata.warranty_period,
    metadata.warranty_time,
    metadata.baoHanh,
    metadata.bao_hanh,
    metadata.guarantee,
    input.sourceDescription,
    input.productName,
  ]).toLowerCase();

  if (!searchText) {
    return null;
  }

  if (/khong\s*bao\s*hanh|không\s*bảo\s*hành|no\s*warranty|\bkbh\b/i.test(searchText)) {
    return "KBH";
  }

  if (/\bbhf\b|full\s*warranty|bảo\s*hành\s*full|bao\s*hanh\s*full|bảo\s*hành\s*đầy\s*đủ|bao\s*hanh\s*day\s*du|bảo\s*hành\s*vĩnh\s*viễn|bao\s*hanh\s*vinh\s*vien|forever\s*warranty|lifetime\s*warranty/i.test(searchText)) {
    return "BHF";
  }

  if (/\b24\s*h\b|\b24\s*gio\b|\b24\s*giờ\b|\b1\s*day\b|\b1\s*ngay\b|\b1\s*ngày\b/i.test(searchText)) {
    return "BH24H";
  }

  if (/\b1\s*m\b|\b1\s*month\b|\b1\s*thang\b|\b1\s*tháng\b|\b30\s*day/i.test(searchText)) {
    return "BH1M";
  }

  if (/\b3\s*m\b|\b3\s*month\b|\b3\s*thang\b|\b3\s*tháng\b|\b90\s*day/i.test(searchText)) {
    return "BH3M";
  }

  if (/\b6\s*m\b|\b6\s*month\b|\b6\s*thang\b|\b6\s*tháng\b/i.test(searchText)) {
    return "BH6M";
  }

  if (/\b12\s*m\b|\b12\s*month\b|\b12\s*thang\b|\b12\s*tháng\b|\b1\s*year\b|\b1\s*nam\b|\b1\s*năm\b/i.test(searchText)) {
    return "BH12M";
  }

  return null;
}

export function inferDeliveryMode(
  input: WarrantySnapshotInput,
): DeliveryModeCode | null {
  const metadata = asRecord(input.metadata);
  const explicitMode =
    normalizeDeliveryMode(input.sourceDeliveryMode) ||
    normalizeDeliveryMode(metadata.sourceDeliveryMode) ||
    normalizeDeliveryMode(metadata.deliveryMode);

  if (explicitMode) {
    return explicitMode;
  }

  if (
    normalizeText(input.providerName).toLowerCase() === "manual" ||
    metadata.manual === true
  ) {
    return hasDeliveryEntries(metadata) ? "AUTO_STOCK" : "MANUAL";
  }

  return "AUTO_API";
}

export function calculateWarrantyExpiry(
  policy: WarrantyPolicyCode | null | undefined,
  startedAt: Date | null | undefined,
) {
  if (!policy || !startedAt || policy === "KBH") {
    return null;
  }

  // BHF = bảo hành full / vĩnh viễn — return null means "no expiry";
  // hasWarrantyWindowExpired(null) returns false → never expires.
  if (policy === "BHF") {
    return null;
  }

  const expiresAt = new Date(startedAt.getTime());

  if (policy === "BH24H") {
    expiresAt.setHours(expiresAt.getHours() + 24);
    return expiresAt;
  }

  if (policy === "BH1M") {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
    return expiresAt;
  }

  if (policy === "BH3M") {
    expiresAt.setMonth(expiresAt.getMonth() + 3);
    return expiresAt;
  }

  if (policy === "BH6M") {
    expiresAt.setMonth(expiresAt.getMonth() + 6);
    return expiresAt;
  }

  // BH12M (fallback)
  expiresAt.setMonth(expiresAt.getMonth() + 12);
  return expiresAt;
}

export function hasWarrantyWindowExpired(
  expiresAt: Date | null | undefined,
  referenceDate = new Date(),
) {
  if (!expiresAt) {
    return false;
  }

  return expiresAt.getTime() < referenceDate.getTime();
}
