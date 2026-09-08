import assert from "node:assert/strict";
import test from "node:test";

import { ProductsStockService } from "../src/products-stock/products-stock.service";
import { ShopsService } from "../src/shops/shops.service";

test("inventory search treats each non-empty line as an account search term", async () => {
  let findManyArgs: any;
  const service = Object.create(ProductsStockService.prototype) as any;
  service.loadOwnedProduct = async () => ({ id: "product-1" });
  service.prisma = {
    stockEntry: {
      findMany: async (args: unknown) => {
        findManyArgs = args;
        return [];
      },
      count: async () => 0,
    },
  };

  await service.listEntries(
    { id: "seller-user-1" },
    "product-1",
    {
      status: "AVAILABLE",
      search: "first@example.com\n\n second@example.com \nfirst@example.com",
    },
  );

  assert.deepEqual(findManyArgs.where.OR, [
    { text: { contains: "first@example.com", mode: "insensitive" } },
    { text: { contains: "second@example.com", mode: "insensitive" } },
  ]);
  assert.equal(findManyArgs.where.status, "AVAILABLE");
});

test("provider source orders paginate by 100 and expose both order codes", async () => {
  let findManyArgs: any;
  const service = Object.create(ShopsService.prototype) as any;
  service.getSellerShop = async () => ({ id: "shop-1" });
  service.prisma = {
    shopProviderSource: {
      findFirst: async () => ({ id: "source-1" }),
    },
    order: {
      count: async () => 201,
      findMany: async (args: unknown) => {
        findManyArgs = args;
        return [
          {
            id: "order-1",
            orderCode: "ORD-LOCAL-1",
            internalSourceOrderCode: "order_technical_lookup_id",
            providerOrderCode: "71156",
            productNameSnapshot: "Account package",
            quantity: 1,
            salePrice: 20_000,
            sourcePriceSnapshot: 10_000,
            totalSaleAmount: 20_000,
            totalSourceAmount: 10_000,
            status: "DELIVERED",
            paymentStatus: "PAID",
            createdAt: new Date("2026-08-28T00:00:00.000Z"),
            paidAt: new Date("2026-08-28T00:01:00.000Z"),
            deliveredAt: new Date("2026-08-28T00:02:00.000Z"),
            customer: {
              telegramUserId: "123",
              telegramUsername: "buyer",
              firstName: "Test",
              lastName: "Buyer",
            },
          },
        ];
      },
    },
  };

  const result = await service.getProviderSourceOrders(
    { id: "seller-user-1" },
    "source-1",
    { page: 2, search: "71156" },
  );

  assert.equal(findManyArgs.skip, 100);
  assert.equal(findManyArgs.take, 100);
  assert.equal(findManyArgs.where.OR.length, 3);
  assert.equal(result.items[0].orderCode, "ORD-LOCAL-1");
  assert.equal(result.items[0].sourceOrderCode, "71156");
  assert.deepEqual(result.pagination, {
    page: 2,
    pageSize: 100,
    total: 201,
    totalPages: 3,
  });
});
