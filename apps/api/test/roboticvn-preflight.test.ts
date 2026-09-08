import assert from "node:assert/strict";
import test from "node:test";

import { ProviderKind } from "@prisma/client";
import { encryptSecret } from "@reseller/shared/server";

import { OrdersService } from "../src/orders/orders.service";

function createService(options: { availableQuantity: number | null; inStock: boolean }) {
  const writes: Array<{ operation: string; args: unknown }> = [];
  const queued: string[] = [];
  const upstreamProvider = {
    providerKind: ProviderKind.EXTERNAL,
    baseUrl: "https://api.roboticvn.com",
    buyerKeyEncrypted: encryptSecret("apk_test", "test-key"),
    internalSourceConnectionId: null,
  };
  const prisma = {
    downstreamSourceConnection: {
      findUnique: async () => ({
        upstreamShopId: "qk-shop",
        upstreamShop: { providerConfig: upstreamProvider },
      }),
      findMany: async () => [
        { downstreamShopId: "reseller-a" },
        { downstreamShopId: "reseller-b" },
      ],
    },
    sourceProduct: {
      findFirst: async () => ({
        id: "qk-product",
        externalProductId: "robotic-variant",
        metadataJson: { productId: "robotic-parent" },
      }),
      update: async (args: unknown) => {
        writes.push({ operation: "update", args });
        return {};
      },
      updateMany: async (args: unknown) => {
        writes.push({ operation: "updateMany", args });
        return { count: 2 };
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  const cache = {
    get: async () => ({
      inStock: options.inStock,
      availableQuantity: options.availableQuantity,
    }),
  };
  const queue = {
    addSyncCatalogJob: async (shopId: string) => {
      queued.push(shopId);
      return {};
    },
  };
  const service = new OrdersService(
    { encryptionKey: "test-key" } as any,
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    queue as any,
    {} as any,
    {} as any,
    {} as any,
    cache as any,
  );
  return { service, writes, queued };
}

const downstreamShop = {
  id: "reseller-a",
  providerConfig: {
    providerKind: ProviderKind.INTERNAL,
    baseUrl: "https://canboso.com",
    buyerKeyEncrypted: "downstream-key",
    internalSourceConnectionId: "connection-1",
  },
};
const downstreamProduct = {
  id: "reseller-product",
  externalProductId: "qk-product",
  metadataJson: { productId: "robotic-parent" },
};

test("cached RoboticVN out-of-stock result blocks checkout and cascades stock zero", async () => {
  const { service, writes, queued } = createService({ inStock: false, availableQuantity: 0 });

  await assert.rejects(
    (service as any).assertRoboticvnStockBeforeCheckout(downstreamShop, downstreamProduct, 1),
    /out of stock/i,
  );

  assert.equal(writes.length, 2);
  assert.deepEqual(queued.sort(), ["reseller-a", "reseller-b"]);
});

test("cached RoboticVN in-stock result permits checkout without stock writes", async () => {
  const { service, writes, queued } = createService({ inStock: true, availableQuantity: 5 });

  const confirmed = await (service as any).assertRoboticvnStockBeforeCheckout(
    downstreamShop,
    downstreamProduct,
    5,
  );

  assert.equal(confirmed, true);
  assert.equal(writes.length, 0);
  assert.equal(queued.length, 0);
});

test("preflight blocks a quantity larger than RoboticVN availability", async () => {
  const { service, writes } = createService({ inStock: true, availableQuantity: 2 });

  await assert.rejects(
    (service as any).assertRoboticvnStockBeforeCheckout(downstreamShop, downstreamProduct, 3),
    /Only 2 item/i,
  );

  assert.equal(writes.length, 2);
});
