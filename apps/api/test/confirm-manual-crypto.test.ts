import assert from "node:assert/strict";
import { OrdersService } from "../dist/orders/orders.service";

// Mock Prisma
let markPaymentCompletedArgs: any = null;
const mockPrisma: any = {
  order: {
    findFirst: async () => ({
      id: "test-order-id",
      shopId: "test-shop-id",
      paymentTransaction: {
        externalOrderCode: "ext-12345",
        cryptoTxHash: null,
        provider: "BINANCE",
        status: "PENDING",
      },
    }),
    findUnique: async () => ({
      id: "test-order-id",
      shopId: "test-shop-id",
      paymentTransaction: {
        externalOrderCode: "ext-12345",
        cryptoTxHash: null,
        provider: "BINANCE",
        status: "PENDING",
      },
    }),
  },
};
const mockShopsService: any = {
  getSellerShop: async () => ({ id: "test-shop-id" }),
};

const service = new OrdersService(
  null as any, // config
  mockPrisma,
  mockShopsService,
  null as any, // paymentService
  null as any, // walletService
  null as any, // queueService
  null as any, // warrantyService
  null as any, // affiliateService
  null as any, // featureFlags
  null as any, // cache
);

// Spy on markPaymentCompleted
service.markPaymentCompleted = async (externalOrderCode: string, payload: any, options: any) => {
  markPaymentCompletedArgs = { externalOrderCode, payload, options };
  return { id: "test-order-id", status: "PAID" } as any;
};

async function runTests() {
  const result = await service.confirmManualCryptoPayment(
    { id: "user-1", role: "SELLER" } as any,
    "test-order-id",
  );

  assert.equal(result.status, "PAID");
  assert.equal(markPaymentCompletedArgs.externalOrderCode, "ext-12345");
  assert.equal(markPaymentCompletedArgs.options.allowManual, true);
  assert.ok(markPaymentCompletedArgs.options.cryptoTxHash.startsWith("manual_seller_"));

  console.log("Manual crypto confirm test passed!");
}

runTests();
