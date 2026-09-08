import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchProviderProducts,
  isShopMmoProvider,
  purchaseFromProvider,
} from "@reseller/shared/server";

test("Canboso domain is not misclassified as ShopMMO by a 64-char key", () => {
  assert.equal(
    isShopMmoProvider({
      baseUrl: "https://canboso.com",
      buyerKey: "a".repeat(64),
      providerName: "canboso",
    }),
    false,
  );
});

test("ShopMMO domain wins over a stale Canboso provider label", () => {
  assert.equal(
    isShopMmoProvider({
      baseUrl: "https://shopmmo.pro",
      buyerKey: "a".repeat(64),
      providerName: "canboso",
    }),
    true,
  );
});

test("Canboso stock normalization preserves unlimited inventory", async (t) => {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        success: true,
        products: [
          {
            _id: "unlimited",
            product_name: "VEO slot",
            stats: { available: null },
            requires_customer_email: true,
          },
          {
            _id: "zero",
            product_name: "Empty product",
            stats: { available: 0 },
          },
          {
            _id: "positive",
            product_name: "Stocked product",
            stats: { available: 12 },
            requiresCustomerEmail: true,
          },
          {
            _id: "negative",
            product_name: "Legacy oversold product",
            stats: { available: -1 },
          },
          { _id: "missing", product_name: "Untracked product", stats: {} },
        ],
      }),
    );
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
  assert.equal(availableById.negative, 0);

  const requiresEmailById = Object.fromEntries(
    products.map((product) => [
      product.externalId,
      product.requiresCustomerEmail,
    ]),
  );
  assert.equal(requiresEmailById.unlimited, true);
  assert.equal(requiresEmailById.positive, true);
  assert.equal(requiresEmailById.zero, false);

  const cachedProducts = await fetchProviderProducts({
    baseUrl: `http://127.0.0.1:${address.port}`,
    buyerKey: "test-key",
  });
  assert.deepEqual(cachedProducts, products);
  assert.equal(requestCount, 1);
});

test("Canboso v2.1 product fields are normalized for catalog sync", async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        success: true,
        walletCurrency: "VND",
        products: [
          {
            productId: "slot_chatgpt_business",
            name: "ChatGPT Business Slot",
            description: "Business workspace invitation",
            productType: "slot",
            price: { amount: 150000, currency: "VND", text: "150.000 ₫" },
            availability: { available: null, sold: 10 },
            purchaseRequirements: {
              customerEmail: true,
              slotMonths: true,
              quantityFixed: 1,
              allowedMonths: [1, 3, 6, 12],
            },
            promotions: [],
          },
        ],
      }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const [product] = await fetchProviderProducts({
    baseUrl: `http://127.0.0.1:${address.port}`,
    buyerKey: "v2.1-test-key",
  });

  assert.equal(product.externalId, "slot_chatgpt_business");
  assert.equal(product.price, 150000);
  assert.equal(product.available, null);
  assert.equal(product.walletCurrency, "VND");
  assert.equal(product.isSlotProduct, true);
  assert.equal(product.requiresCustomerEmail, true);
  assert.equal(product.requiresSlotMonths, true);
  assert.equal(product.quantityFixed, 1);
  assert.deepEqual(product.slotDurations, [1, 3, 6, 12]);
});

test("Canboso v2.1 purchase returns nested delivery and order code", async (t) => {
  const server = createServer((request, response) => {
    assert.equal(request.headers["idempotency-key"], "ORD-TEST-123456");
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        success: true,
        order: {
          orderCode: "ORDER1A2B3C4D5E",
          status: "completed",
          productId: "product-1",
        },
        delivery: {
          accounts: [
            {
              user: "customer@example.com",
              password: "secret",
              verifyEmail: "recovery@example.com",
            },
          ],
        },
      }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const result = await purchaseFromProvider(
    {
      baseUrl: `http://127.0.0.1:${address.port}`,
      buyerKey: "purchase-test-key",
    },
    {
      productId: "product-1",
      quantity: 1,
      clientOrderCode: "ORD-TEST-123456",
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.pending, false);
  assert.equal(result.providerOrderCode, "ORDER1A2B3C4D5E");
  assert.equal(
    result.deliveredText,
    "customer@example.com | secret | recovery@example.com",
  );
});

test("Canboso purchase has an absolute deadline for never-ending responses", async (t) => {
  const timers = new Set<NodeJS.Timeout>();
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    // Keep the socket active while deliberately never completing the JSON.
    // A socket-idle timeout alone will never fire in this situation.
    const timer = setInterval(() => response.write(" "), 10);
    timers.add(timer);
    request.once("close", () => {
      clearInterval(timer);
      timers.delete(timer);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    for (const timer of timers) clearInterval(timer);
    server.close();
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const startedAt = Date.now();
  const result = await purchaseFromProvider(
    {
      baseUrl: `http://127.0.0.1:${address.port}`,
      buyerKey: "timeout-test-key",
      timeoutMs: 80,
    },
    {
      productId: "product-timeout",
      quantity: 1,
      clientOrderCode: "ORD-TIMEOUT-123456",
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.pending, true);
  assert.match(result.message || "", /timed out/i);
  assert.ok(Date.now() - startedAt < 1_000);
});
