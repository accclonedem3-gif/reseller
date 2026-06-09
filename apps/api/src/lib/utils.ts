import { createHash, randomBytes, randomInt } from "node:crypto";

import { Prisma } from "@prisma/client";

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function durationToMs(value: string) {
  const match = /^(\d+)([smhd])$/i.exec(value.trim());

  if (!match) {
    return 15 * 60 * 1000;
  }

  const amount = Number(match[1]);
  const unit = (match[2] || "m").toLowerCase();

  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

export function toDecimal(value: number | string) {
  return new Prisma.Decimal(Number(value).toFixed(2));
}

export function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
}

/**
 * Split a debit amount across commission balance (used first) and main balance.
 * Commission balance is spend-only (cannot withdraw), so prefer using it.
 */
export function splitWalletDebit(
  commissionBefore: number,
  balanceBefore: number,
  amount: number,
) {
  const fromCommission = Math.min(commissionBefore, amount);
  const fromMain = amount - fromCommission;
  return {
    fromCommission,
    fromMain,
    commissionAfter: commissionBefore - fromCommission,
    balanceAfter: balanceBefore - fromMain,
  };
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(value);
}

// Extract the set of account emails from a delivered/stock text block. Used as the stable KEY for
// the per-account "added-to-stock date" map (products.service writes it, warranty bypass reads it),
// so BOTH sides MUST key identically — keep this the single source of truth for that extraction.
export function extractAccountEmails(text: string | null | undefined): string[] {
  const matches = String(text || "")
    .toLowerCase()
    .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g);
  return matches ? [...new Set(matches)] : [];
}

// Per-order warranty claim code: a short, human-typable secret the buyer must present to open a
// public warranty claim. Unambiguous alphabet (no 0/O/1/I/L) so customers can read it off Telegram.
// ~8 chars from a 31-symbol alphabet ≈ 39.6 bits (8 * log2(31)) — adequate for a per-order
// ownership token (not a password), backed by per-IP rate limiting on the public warranty endpoints.
export function generateWarrantyClaimCode(length = 8) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(0, alphabet.length)];
  return out;
}

export function generateOrderCode() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `ORD-${timestamp}-${randomInt(100, 999)}`;
}

export function generateSourceOrderCode() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `SRC-${timestamp}-${randomInt(100, 999)}`;
}

export function generateExternalPaymentCode() {
  const min = 100000000000000n;
  const range = 900000000000000n;
  const randomValue = BigInt(`0x${randomBytes(8).toString("hex")}`) % range;
  return String(min + randomValue);
}

/**
 * Count how many of an order's ACCOUNTS have actually been resolved (refunded/replaced) by
 * warranty — NOT how many claims exist. A single claim can cover several accounts, and a
 * whole-order claim only replaces the accounts that were actually dead (not all `quantity`).
 *
 * Authoritative source per claim is `metadataJson.replacedAccountEmails` — set on every
 * replacement AND refund, holding ONLY the accounts confirmed dead/refunded. Falls back to
 * `targetUsernames` for legacy claims, then to the resolved-claim count if no per-account data
 * exists at all (so a resolved claim never shows as "0"). Distinct local-parts, capped at quantity.
 */
export function countResolvedWarrantyAccounts(
  claims: { metadataJson?: unknown }[],
  quantity: number,
): number {
  const covered = new Set<string>();
  for (const claim of claims) {
    const meta =
      claim.metadataJson && typeof claim.metadataJson === "object"
        ? (claim.metadataJson as Record<string, unknown>)
        : {};
    const replaced = Array.isArray(meta.replacedAccountEmails)
      ? (meta.replacedAccountEmails as unknown[])
      : [];
    const source =
      replaced.length > 0
        ? replaced
        : Array.isArray(meta.targetUsernames)
          ? (meta.targetUsernames as unknown[])
          : [];
    for (const e of source) {
      const key = String(e ?? "").toLowerCase().trim().split("@")[0];
      if (key) covered.add(key);
    }
  }
  // No per-account metadata (very old claims) → fall back to resolved-claim count so it still
  // reads as done, never "0".
  if (covered.size === 0) return Math.min(quantity, claims.length);
  return Math.min(quantity, covered.size);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
