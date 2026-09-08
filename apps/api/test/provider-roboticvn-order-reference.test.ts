import assert from "node:assert/strict";
import test from "node:test";

import { resolveRoboticvnOrderReference } from "@reseller/shared/server";

test("RoboticVN keeps the technical id for lookup and display_id for the source code", () => {
  assert.deepEqual(
    resolveRoboticvnOrderReference({
      id: "order_01M148BBVRMNMKEAGPS12KV2H1",
      display_id: 71156,
    }),
    {
      providerOrderId: "order_01M148BBVRMNMKEAGPS12KV2H1",
      providerOrderCode: "71156",
    },
  );
});

test("RoboticVN purchase response order_id is supported", () => {
  assert.deepEqual(
    resolveRoboticvnOrderReference({
      order_id: "order_technical_id",
      display_id: "71157",
    }),
    {
      providerOrderId: "order_technical_id",
      providerOrderCode: "71157",
    },
  );
});

test("RoboticVN falls back to technical id when display_id is unavailable", () => {
  assert.deepEqual(resolveRoboticvnOrderReference({}, "order_fallback"), {
    providerOrderId: "order_fallback",
    providerOrderCode: "order_fallback",
  });
});
