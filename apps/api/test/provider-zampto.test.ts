import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchProviderBalance,
  fetchProviderOrderStatus,
  fetchProviderProducts,
  isZamptoKey,
  purchaseFromProvider,
} from "@reseller/shared/server";

test("Zampto provider maps catalog, balance, purchase and order status", async (t) => {
  const apiKey = `sk_${"a".repeat(48)}`;
  const requests: Array<{ path: string; key: string; body: string }> = [];
  const server = createServer((request, response) => {
    let requestBody = "";
    request.on("data", (chunk) => (requestBody += String(chunk)));
    request.on("end", () => {
      requests.push({
        path: request.url || "",
        key: String(request.headers["x-api-key"] || ""),
        body: requestBody,
      });
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/products") {
        response.end(
          JSON.stringify({
            data: {
              products: [
                { id: "p1", name: "Product one", price: 12500, stock: 3 },
                {
                  product_id: "p2",
                  product_name: "Product two",
                  price: "20.000",
                  available: 0,
                },
              ],
            },
          }),
        );
        return;
      }
      if (request.url === "/api/balance") {
        response.end(
          JSON.stringify({
            success: true,
            data: { balance: 150000, currency: "VND" },
          }),
        );
        return;
      }
      if (request.url === "/api/buy") {
        const buyBody = JSON.parse(requestBody) as { product_id?: string };
        if (buyBody.product_id === "p-out") {
          response.end(
            JSON.stringify({ success: false, message: "Sản phẩm hết hàng" }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            success: true,
            data: {
              order: {
                id: "internal-1",
                order_code: "DH123456",
                status: "completed",
                items: [{ username: "demo@example.com", password: "secret" }],
              },
            },
          }),
        );
        return;
      }
      if (request.url === "/api/orders/DH123456") {
        response.end(
          JSON.stringify({
            data: {
              order: {
                id: "internal-1",
                order_code: "DH123456",
                status: "completed",
                accounts: ["demo@example.com | secret"],
              },
            },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ success: false, message: "Not found" }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const credentials = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    buyerKey: apiKey,
  };

  assert.equal(isZamptoKey(apiKey), true);
  const products = await fetchProviderProducts(credentials);
  assert.deepEqual(
    products.map((item) => [item.externalId, item.price, item.available]),
    [
      ["p1", 12500, 3],
      ["p2", 20000, 0],
    ],
  );

  const balance = await fetchProviderBalance(credentials);
  assert.equal(balance.balanceVnd, 150000);

  const purchase = await purchaseFromProvider(credentials, {
    productId: "p1",
    quantity: 2,
    clientOrderCode: "ORD-LOCAL-1",
  });
  assert.equal(purchase.success, true);
  assert.equal(purchase.providerOrderCode, "DH123456");
  assert.equal(purchase.deliveredText, "demo@example.com | secret");

  const outOfStock = await purchaseFromProvider(credentials, {
    productId: "p-out",
    quantity: 1,
  });
  assert.equal(outOfStock.success, false);
  assert.equal(outOfStock.outOfStock, true);

  const status = await fetchProviderOrderStatus(credentials, {
    orderCode: "DH123456",
  });
  assert.equal(status.status, "delivered");
  assert.equal(status.deliveredText, "demo@example.com | secret");

  assert.equal(requests.length, 5);
  assert.ok(requests.every((item) => item.key === apiKey));
  assert.deepEqual(JSON.parse(requests[2].body), {
    product_id: "p1",
    quantity: 2,
  });
});
