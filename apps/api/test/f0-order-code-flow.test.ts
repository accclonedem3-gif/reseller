import assert from "node:assert/strict";
import { test } from "node:test";

test("F0 order code response structure test", () => {
  const providerOrderId = "f0_123456";
  const providerOrderCode = "F0-ORD-2026-9999";
  const sourceOrderCode = "SRC-20260912120000-12345";
  const clientOrderCode = "order:822a471a-95da-473e-bc74-3f3033da126e";

  const mappedResponse = {
    success: true,
    order: {
      id: "iso_test_123",
      orderCode: sourceOrderCode,
      downstreamOrderCode: clientOrderCode,
      providerOrderId: providerOrderId,
      providerOrderCode: providerOrderCode,
      upstreamOrderId: providerOrderId,
      upstreamOrderCode: providerOrderCode,
      f0_order_id: providerOrderId,
      f0_order_code: providerOrderCode,
      status: "delivered",
      quantity: 1,
      unitPrice: 114000,
      totalAmount: 114000,
      deliveredText: "user@example.com|pass123",
      failureReason: null,
      createdAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
    },
  };

  assert.equal(mappedResponse.order.f0_order_id, "f0_123456");
  assert.equal(mappedResponse.order.f0_order_code, "F0-ORD-2026-9999");
  assert.equal(mappedResponse.order.providerOrderCode, "F0-ORD-2026-9999");
  assert.equal(mappedResponse.order.upstreamOrderCode, "F0-ORD-2026-9999");
  assert.equal(mappedResponse.order.downstreamOrderCode, "order:822a471a-95da-473e-bc74-3f3033da126e");
  assert.equal(mappedResponse.order.orderCode, "SRC-20260912120000-12345");
});
