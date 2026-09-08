import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { verifyAlchemyWebhookSignature } from "../src/lib/alchemy-bep20.utils";

test("accepts an Alchemy HMAC-SHA256 signature over the exact raw body", () => {
  const body = Buffer.from(JSON.stringify({
    webhookId: "wh_test",
    type: "ADDRESS_ACTIVITY",
    event: { network: "BNB_MAINNET", activity: [] },
  }));
  const signingKey = "whsec_test_signing_key";
  const signature = createHmac("sha256", signingKey).update(body).digest("hex");
  assert.equal(verifyAlchemyWebhookSignature(body, signature, signingKey), true);
});

test("rejects changed payloads, malformed signatures and missing inputs", () => {
  const signingKey = "whsec_test_signing_key";
  const body = Buffer.from('{"id":"original"}');
  const signature = createHmac("sha256", signingKey).update(body).digest("hex");
  assert.equal(verifyAlchemyWebhookSignature(Buffer.from('{"id":"changed"}'), signature, signingKey), false);
  assert.equal(verifyAlchemyWebhookSignature(body, "not-hex", signingKey), false);
  assert.equal(verifyAlchemyWebhookSignature(undefined, signature, signingKey), false);
});
