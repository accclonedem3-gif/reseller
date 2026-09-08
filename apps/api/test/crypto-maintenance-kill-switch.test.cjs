const assert = require("node:assert/strict");
const test = require("node:test");

const { PaymentProvider } = require("@prisma/client");
const { PaymentService } = require("../dist/lib/payment.service.js");

const providerFeatures = new Map([
  [PaymentProvider.USDT_TRC20, "payment_trc20"],
  [PaymentProvider.USDT_BEP20, "payment_bep20"],
  [PaymentProvider.USDT_SOL, "payment_solana"],
  [PaymentProvider.USDT_TON, "payment_ton"],
]);

test("maintenance flags stop every on-chain receipt before payment data is read", async () => {
  for (const [provider, expectedFeature] of providerFeatures) {
    let databaseRead = false;
    let assertedFeature = "";
    const maintenanceError = new Error(`${expectedFeature} is under maintenance`);
    const prisma = new Proxy({}, {
      get() {
        databaseRead = true;
        throw new Error("Database must not be touched while crypto is under maintenance.");
      },
    });
    const featureFlags = {
      async assertEnabled(feature) {
        assertedFeature = feature;
        throw maintenanceError;
      },
    };
    const service = new PaymentService(prisma, {}, {}, {}, featureFlags);

    await assert.rejects(
      service.claimOnchainPaymentReceipt({
        provider,
        txHash: "test-hash",
        externalOrderCode: "test-order",
        amountUsdt: 1,
        destination: "test-wallet",
        transactionAt: new Date(),
      }),
      maintenanceError,
    );
    assert.equal(assertedFeature, expectedFeature);
    assert.equal(databaseRead, false);
  }
});
