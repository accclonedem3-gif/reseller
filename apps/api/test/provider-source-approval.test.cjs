const assert = require("node:assert/strict");
const test = require("node:test");

const { ProductsService } = require("../dist/products/products.service.js");

function createSubject() {
  const upserts = [];
  const prisma = {
    sourceProduct: {
      findMany: async ({ where }) => {
        assert.equal(where.shopId, "shop-1");
        assert.deepEqual(where.providerSourceId, { not: null });
        return [
          { id: "product-1", sourceName: "Product 1", sourcePrice: 1000 },
          { id: "product-2", sourceName: "Product 2", sourcePrice: 2000 },
        ];
      },
    },
    $transaction: async (callback) =>
      callback({
        sellerProductOverride: {
          upsert: async (args) => upserts.push(args),
        },
      }),
  };
  const shopsService = {
    getSellerShop: async () => ({ id: "shop-1", sellerId: "seller-1" }),
  };
  const service = new ProductsService(prisma, shopsService, {}, {});
  return { service, upserts };
}

test("publishes only provider-source products selected by the seller", async () => {
  const { service, upserts } = createSubject();
  const result = await service.bulkUpdateSourceProductStatus(
    { id: "user-1", sellerTier: "FREE" },
    {
      productIds: ["product-1", "product-2", "manual-product"],
      action: "PUBLISH",
    },
  );

  assert.equal(result.updated, 2);
  assert.equal(result.skipped, 1);
  assert.equal(upserts.length, 2);
  for (const upsert of upserts) {
    assert.deepEqual(upsert.update, { enabled: true, hidden: false });
    assert.equal(upsert.create.enabled, true);
    assert.equal(upsert.create.hidden, false);
  }
});

test("moves approved provider products back to pending review", async () => {
  const { service, upserts } = createSubject();
  await service.bulkUpdateSourceProductStatus(
    { id: "user-1", sellerTier: "FREE" },
    { productIds: ["product-1", "product-2"], action: "PENDING" },
  );

  assert.equal(upserts.length, 2);
  for (const upsert of upserts) {
    assert.deepEqual(upsert.update, { enabled: false, hidden: true });
    assert.equal(upsert.create.enabled, false);
    assert.equal(upsert.create.hidden, true);
  }
});
