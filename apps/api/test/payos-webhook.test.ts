import assert from "node:assert/strict";

import { isSuccessfulPayOSWebhook } from "../../../packages/shared/src/server/payos";

const paidWebhook = {
  code: "00",
  desc: "success",
  success: true,
  data: {
    orderCode: 123,
    amount: 199000,
    currency: "VND",
    code: "00",
    desc: "Thành công",
  },
};

assert.equal(isSuccessfulPayOSWebhook(paidWebhook), true);

// This is the shape returned when a payment link is created. It may contain a
// valid provider signature, but it proves only that the invoice is PENDING.
assert.equal(
  isSuccessfulPayOSWebhook({
    code: "00",
    desc: "success",
    data: {
      orderCode: 123,
      amount: 199000,
      currency: "VND",
      status: "PENDING",
      checkoutUrl: "https://pay.payos.vn/web/example",
    },
  }),
  false,
);

assert.equal(
  isSuccessfulPayOSWebhook({ ...paidWebhook, success: false }),
  false,
);
assert.equal(
  isSuccessfulPayOSWebhook({
    ...paidWebhook,
    data: { ...paidWebhook.data, code: "01" },
  }),
  false,
);

console.log("4/4 PayOS webhook tests passed");
