import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyAlchemyWebhookSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  signingKey: string,
) {
  if (!signingKey || !rawBody || !signature) return false;
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const actual = String(signature).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(actual) || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}
