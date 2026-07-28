import assert from "node:assert/strict";

import {
  extractPaypalApprovalUrl,
  extractPaypalWebhookExternalOrderCode,
  extractPaypalWebhookOrderId,
  formatPaypalUsdAmount,
  summarizePaypalOrder,
} from "../src/lib/paypal-payment";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "formats valid USD amounts and rejects zero",
    run: () => {
      assert.equal(formatPaypalUsdAmount(12.3), "12.30");
      assert.throws(() => formatPaypalUsdAmount(0), /greater than zero/);
    },
  },
  {
    name: "extracts only a secure PayPal approval link",
    run: () => {
      assert.equal(
        extractPaypalApprovalUrl({
          links: [
            { rel: "self", href: "https://api-m.paypal.com/order/1" },
            { rel: "payer-action", href: "https://www.paypal.com/checkoutnow?token=1" },
          ],
        }),
        "https://www.paypal.com/checkoutnow?token=1",
      );
      assert.equal(extractPaypalApprovalUrl({ links: [{ rel: "payer-action", href: "javascript:alert(1)" }] }), "");
    },
  },
  {
    name: "extracts local and PayPal order references from approval webhook",
    run: () => {
      const event = {
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: {
          id: "PAYPAL-ORDER-1",
          purchase_units: [{ custom_id: "LOCAL-ORDER-1" }],
        },
      };
      assert.equal(extractPaypalWebhookExternalOrderCode(event), "LOCAL-ORDER-1");
      assert.equal(extractPaypalWebhookOrderId(event), "PAYPAL-ORDER-1");
    },
  },
  {
    name: "extracts references from completed capture webhook",
    run: () => {
      const event = {
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          custom_id: "LOCAL-ORDER-2",
          supplementary_data: { related_ids: { order_id: "PAYPAL-ORDER-2" } },
        },
      };
      assert.equal(extractPaypalWebhookExternalOrderCode(event), "LOCAL-ORDER-2");
      assert.equal(extractPaypalWebhookOrderId(event), "PAYPAL-ORDER-2");
    },
  },
  {
    name: "summarizes only completed USD captures",
    run: () => {
      const summary = summarizePaypalOrder({
        id: "PAYPAL-ORDER-3",
        status: "COMPLETED",
        purchase_units: [{
          reference_id: "LOCAL-ORDER-3",
          custom_id: "LOCAL-ORDER-3",
          amount: { currency_code: "USD", value: "5.25" },
          payments: {
            captures: [
              { id: "CAPTURE-1", status: "COMPLETED", amount: { currency_code: "USD", value: "5.25" } },
              { id: "CAPTURE-IGNORED", status: "PENDING", amount: { currency_code: "USD", value: "99.00" } },
            ],
          },
        }],
      });
      assert.deepEqual(summary, {
        orderId: "PAYPAL-ORDER-3",
        status: "COMPLETED",
        externalOrderCode: "LOCAL-ORDER-3",
        currency: "USD",
        amount: 5.25,
        amountPaid: 5.25,
        captureId: "CAPTURE-1",
        completed: true,
      });
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

console.log(`${tests.length}/${tests.length} PayPal payment tests passed`);
