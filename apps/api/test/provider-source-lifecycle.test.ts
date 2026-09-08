import assert from "node:assert/strict";
import test from "node:test";

import { ShopsService } from "../src/shops/shops.service";

function createService(enabled: boolean) {
  const calls: Array<{ operation: string; args: any }> = [];
  const source = {
    id: "source-1",
    shopId: "shop-1",
    enabled,
    providerName: "gigapower",
  };
  const tx = {
    sourceProduct: {
      findMany: async () => [
        {
          id: "unused-product",
          _count: { orders: 0, internalSourceOrders: 0 },
        },
        {
          id: "historical-product",
          _count: { orders: 1, internalSourceOrders: 0 },
        },
      ],
      deleteMany: async (args: any) => {
        calls.push({ operation: "deleteProducts", args });
        return { count: 1 };
      },
      updateMany: async (args: any) => {
        calls.push({ operation: "archiveProducts", args });
        return { count: 1 };
      },
    },
    shopProviderSource: {
      delete: async (args: any) => {
        calls.push({ operation: "deleteSource", args });
        return source;
      },
    },
  };
  const service = Object.create(ShopsService.prototype) as any;
  service.getSellerShop = async () => ({ id: "shop-1" });
  service.prisma = {
    shopProviderSource: { findFirst: async () => source },
    $transaction: async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
  };
  return { service, calls };
}

test("permanent provider removal preserves products used by order history", async () => {
  const { service, calls } = createService(false);

  const result = await service.removeProviderSource(
    { id: "user-1" },
    "source-1",
  );

  assert.equal(result.ordersPreserved, true);
  assert.equal(result.deletedProducts, 1);
  assert.equal(result.preservedHistoricalProducts, 1);
  assert.deepEqual(calls[0], {
    operation: "deleteProducts",
    args: { where: { id: { in: ["unused-product"] } } },
  });
  assert.equal(calls[1].operation, "archiveProducts");
  assert.deepEqual(calls[1].args.where, {
    id: { in: ["historical-product"] },
  });
  assert.equal(calls[1].args.data.available, 0);
  assert.equal(calls[1].args.data.providerName, "gigapower");
  assert.ok(calls[1].args.data.archivedAt instanceof Date);
  assert.deepEqual(calls[2], {
    operation: "deleteSource",
    args: { where: { id: "source-1" } },
  });
});

test("active provider source must be disconnected before permanent removal", async () => {
  const { service, calls } = createService(true);

  await assert.rejects(
    service.removeProviderSource({ id: "user-1" }, "source-1"),
    /Disconnect the provider source/,
  );
  assert.equal(calls.length, 0);
});

test("reconnect syncs a disabled provider and enables it only on success", async () => {
  const service = Object.create(ShopsService.prototype) as any;
  let syncArgs: unknown[] = [];
  service.getSellerShop = async () => ({ id: "shop-1" });
  service.syncProviderSourceByRecord = async (...args: unknown[]) => {
    syncArgs = args;
    return 12;
  };

  const result = await service.reconnectProviderSource(
    { id: "user-1" },
    "source-1",
  );

  assert.deepEqual(syncArgs, [
    "shop-1",
    "source-1",
    { allowDisabled: true, enableOnSuccess: true },
  ]);
  assert.deepEqual(result, { id: "source-1", synced: 12, enabled: true });
});
