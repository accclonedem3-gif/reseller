import { createHmac, timingSafeEqual } from "node:crypto";

function normalizePath(value: string) {
  return String(value || "/").split("?")[0] || "/";
}

function normalizeBody(value: string) {
  return String(value || "");
}

export function buildInternalRequestSignature(input: {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  body: string;
}) {
  const payload = [
    String(input.method || "POST").toUpperCase(),
    normalizePath(input.path),
    String(input.timestamp || ""),
    normalizeBody(input.body),
    "",
  ].join("\n");

  return createHmac("sha256", input.secret).update(payload).digest("hex");
}

export function buildInternalRequestHeaders(input: {
  secret: string;
  method: string;
  path: string;
  body: string;
  timestamp?: string;
}) {
  const timestamp = String(input.timestamp || new Date().toISOString());
  const signature = buildInternalRequestSignature({
    secret: input.secret,
    method: input.method,
    path: input.path,
    timestamp,
    body: input.body,
  });

  return {
    "x-internal-token": input.secret,
    "x-internal-timestamp": timestamp,
    "x-internal-signature": signature,
  };
}

export function verifyInternalRequestSignature(input: {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  signature: string;
  body: string;
  maxSkewMs?: number;
}) {
  const timestamp = String(input.timestamp || "").trim();
  const signature = String(input.signature || "").trim().toLowerCase();

  if (!timestamp || !signature) {
    return false;
  }

  const parsedTimestamp = Date.parse(timestamp);

  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  const maxSkewMs = Number(input.maxSkewMs || 0);

  if (maxSkewMs > 0 && Math.abs(Date.now() - parsedTimestamp) > maxSkewMs) {
    return false;
  }

  const expected = buildInternalRequestSignature({
    secret: input.secret,
    method: input.method,
    path: input.path,
    timestamp,
    body: input.body,
  });

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
