import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { fetchProviderProducts } from "@reseller/shared/server";

test("Canboso stock normalization preserves unlimited inventory", async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      success: true,
      products: [
        {
          _id: "unlimited",
          product_name: "VEO slot",
          stats: { available: null },
          requires_customer_email: true,
        },
        { _id: "zero", product_name: "Empty product", stats: { available: 0 } },
        {
          _id: "positive",
          product_name: "Stocked product",
          stats: { available: 12 },
          requiresCustomerEmail: true,
        },
        { _id: "missing", product_name: "Untracked product", stats: {} },
      ],
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const products = await fetchProviderProducts({
    baseUrl: `http://127.0.0.1:${address.port}`,
    buyerKey: "test-key",
  });
  const availableById = Object.fromEntries(
    products.map((product) => [product.externalId, product.available]),
  );

  assert.equal(availableById.unlimited, null);
  assert.equal(availableById.missing, null);
  assert.equal(availableById.zero, 0);
  assert.equal(availableById.positive, 12);

  const requiresEmailById = Object.fromEntries(
    products.map((product) => [product.externalId, product.requiresCustomerEmail]),
  );
  assert.equal(requiresEmailById.unlimited, true);
  assert.equal(requiresEmailById.positive, true);
  assert.equal(requiresEmailById.zero, false);
});
