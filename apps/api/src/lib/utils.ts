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

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(value);
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

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
