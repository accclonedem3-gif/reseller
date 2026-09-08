import assert from "node:assert/strict";
import test from "node:test";

import { OrderStatus, ProviderKind } from "@prisma/client";

import { OrdersService } from "../src/orders/orders.service";

function orderFixture(
  id: string,
  sourceProduct: {
    providerName: string;
    providerSource: { providerName: string } | null;
  },
) {
  const now = new Date("2026-08-27T00:00:00.000Z");
  return {
    id,
    orderCode: `ORDER-${id}`,
    shopId: "shop-1",
    sellerId: "seller-1",
    customerId: "customer-1",
    sourceProviderKindSnapshot: ProviderKind.EXTERNAL,
    internalSourceOrderId: null,
    internalSourceOrderCode: null,
    productNameSnapshot: "Test account",
    customerEmail: null,
    quantity: 1,
    salePrice: 60_000,
    sourcePriceSnapshot: 50_000,
    totalSaleAmount: 60_000,
    totalSourceAmount: 50_000,
    status: OrderStatus.DELIVERED,
    paymentStatus: "PAID",
    deliveredAccountText: "user | pass",
    failureReason: null,
    createdAt: now,
    paidAt: now,
    deliveredAt: now,
    customer: {
      telegramUsername: "buyer",
      firstName: "Test",
      lastName: "Buyer",
      telegramUserId: "123",
    },
    sourceProduct: {
      externalProductId: "ACC_1",
      sourceName: "Test account",
      ...sourceProduct,
    },
    paymentTransaction: null,
  };
}

test("order history exposes provider names for active and removed sources", async () => {
  let findManyArgs: unknown;
  const prisma = {
    order: {
      findMany: async (args: unknown) => {
        findManyArgs = args;
        return [
          orderFixture("active", {
            providerName: "disconnected_archive",
            providerSource: { providerName: "gigapower" },
          }),
          orderFixture("removed", {
            providerName: "gigapower",
            providerSource: null,
          }),
        ];
      },
    },
  };
  const shopsService = {
    getSellerShop: async () => ({ id: "shop-1" }),
  };
  const service = new OrdersService(
    {} as any,
    prisma as any,
    shopsService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const orders = await service.listOrders({ id: "user-1" } as any);

  assert.deepEqual(
    orders.map((order) => order.sourceProvider),
    ["gigapower", "gigapower"],
  );
  assert.deepEqual(
    (findManyArgs as any).include.sourceProduct.include.providerSource.select,
    { providerName: true },
  );
});
