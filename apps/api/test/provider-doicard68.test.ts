import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchProviderBalance,
  fetchProviderOrderStatus,
  fetchProviderProducts,
  isDoicardBaseUrl,
  isDoicardProvider,
  parseDoicardCredentials,
  purchaseFromProvider,
  verifyProviderConnection,
} from "@reseller/shared/server";

test("Doicard68 credential parsing and provider detection", () => {
  assert.equal(isDoicardBaseUrl("https://doicard68.com"), true);
  assert.equal(isDoicardBaseUrl("http://api.doicard68.com/some/path"), true);
  assert.equal(isDoicardBaseUrl("https://other.com"), false);

  assert.equal(
    isDoicardProvider({ providerName: "doicard68", baseUrl: "https://doicard68.com" }),
    true,
  );
  assert.equal(
    isDoicardProvider({ providerName: "doicard", baseUrl: "https://example.com" }),
    true,
  );
  assert.equal(
    isDoicardProvider({ providerName: "canboso", baseUrl: "https://canboso.com" }),
    false,
  );

  // Pipe format
  const parsed1 = parseDoicardCredentials("89232986146|27aabc1fcd4f332232ad3a770e596dd6|0076272877");
  assert.equal(parsed1.partnerId, "89232986146");
  assert.equal(parsed1.partnerKey, "27aabc1fcd4f332232ad3a770e596dd6");
  assert.equal(parsed1.walletNumber, "0076272877");

  // JSON format
  const parsed2 = parseDoicardCredentials(
    JSON.stringify({
      partner_id: "123",
      partner_key: "secret",
      wallet_number: "VND999",
    }),
  );
  assert.equal(parsed2.partnerId, "123");
  assert.equal(parsed2.partnerKey, "secret");
  assert.equal(parsed2.walletNumber, "VND999");
});

test("Doicard68 provider maps catalog, balance, purchase and order status", async (t) => {
  const requests: Array<{ url: string; body: string }> = [];

  const server = createServer((request, response) => {
    let requestBody = "";
    request.on("data", (chunk) => (requestBody += String(chunk)));
    request.on("end", () => {
      requests.push({
        url: request.url || "",
        body: requestBody,
      });

      response.setHeader("content-type", "application/json");

      // Products catalog
      if (request.url?.startsWith("/api/cardws/products")) {
        response.end(
          JSON.stringify([
            {
              name: "Thẻ Garena",
              slug: "the-garena",
              service_code: "Garena",
              image: "/garena.png",
              cardvalue: [
                { id: 1, value: 20000, discount: "4" },
                { id: 2, value: 50000, discount: "3" },
              ],
            },
            {
              name: "Thẻ Viettel",
              slug: "the-viettel",
              service_code: "Viettel",
              image: "/viettel.png",
              cardvalue: [{ id: 3, value: 10000 }],
            },
          ]),
        );
        return;
      }

      // Web card pages for scraping stock
      if (request.url?.startsWith("/card/")) {
        response.setHeader("content-type", "text/html");
        response.end(`
          <html><body>
            <script>
              const softcardProducts = [
                {
                  "id": 1,
                  "slug": "the-garena",
                  "items": [
                    { "id": 1, "value": 20000, "stock_quantity": 45 },
                    { "id": 2, "value": 50000, "stock_quantity": 0 }
                  ]
                },
                {
                  "id": 2,
                  "slug": "the-viettel",
                  "items": [
                    { "id": 3, "value": 10000, "stock_quantity": 120 }
                  ]
                }
              ];
            </script>
          </body></html>
        `);
        return;
      }

      // Cardws commands
      if (request.url === "/api/cardws") {
        const parsed = JSON.parse(requestBody || "{}");
        if (parsed.command === "getbalance") {
          response.end(
            JSON.stringify({
              balance: 500000,
              currency_code: "VND",
            }),
          );
          return;
        }

        if (parsed.command === "buycard") {
          if (parsed.service_code === "OutOfStock") {
            response.end(
              JSON.stringify({
                status: 118,
                message: "Sản phẩm đã hết hàng",
              }),
            );
            return;
          }

          response.end(
            JSON.stringify({
              status: 1,
              message: "Mua thẻ thành công",
              data: {
                cards: [
                  {
                    name: "Thẻ Garena 20.000",
                    serial: "10001234567890",
                    code: "99887766554433",
                    expired: "2027-12-31",
                  },
                ],
                order_code: "SC240403001",
                request_id: parsed.request_id,
              },
            }),
          );
          return;
        }

        if (parsed.command === "redownload") {
          response.end(
            JSON.stringify({
              status: 1,
              message: "Tải lại thẻ thành công",
              data: {
                cards: [
                  {
                    name: "Thẻ Garena 20.000",
                    serial: "10001234567890",
                    code: "99887766554433",
                    expired: "2027-12-31",
                  },
                ],
                order_code: "SC240403001",
                request_id: parsed.request_id,
              },
            }),
          );
          return;
        }
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Not found" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(() => {
    server.close();
  });

  const credentials = {
    baseUrl,
    buyerKey: "89232986146|27aabc1fcd4f332232ad3a770e596dd6|0076272877",
    providerName: "doicard68",
  };

  // 1. Test Products
  const products = await fetchProviderProducts(credentials);
  assert.equal(products.length, 3);
  assert.equal(products[0]?.externalId, "Garena_20000");
  assert.equal(products[0]?.price, 19200); // 20.000 with 4% discount = 19.200
  assert.equal(products[0]?.sourceName, "Thẻ Garena 20.000 đ");
  assert.equal(products[0]?.available, 45); // Scraped from web page
  assert.equal(products[1]?.externalId, "Garena_50000");
  assert.equal(products[1]?.price, 48500); // 50.000 with 3% discount = 48.500
  assert.equal(products[1]?.available, 0); // Out of stock
  assert.equal(products[2]?.externalId, "Viettel_10000");
  assert.equal(products[2]?.price, 10000); // no discount = 10.000
  assert.equal(products[2]?.available, 120); // In stock

  // 2. Test Balance
  const balance = await fetchProviderBalance(credentials);
  assert.equal(balance.success, true);
  assert.equal(balance.balance, 500000);
  assert.equal(balance.walletCurrency, "VND");

  // 3. Test Purchase Success
  const purchase = await purchaseFromProvider(credentials, {
    productId: "Garena_20000",
    quantity: 1,
    clientOrderCode: "ORDER_TEST_001",
  });
  assert.equal(purchase.success, true);
  assert.equal(purchase.pending, false);
  assert.equal(purchase.outOfStock, false);
  assert.match(purchase.deliveredText || "", /99887766554433/);
  assert.match(purchase.deliveredText || "", /10001234567890/);

  // 4. Test Purchase Out of Stock
  const outOfStock = await purchaseFromProvider(credentials, {
    productId: "OutOfStock_10000",
    quantity: 1,
    clientOrderCode: "ORDER_TEST_002",
  });
  assert.equal(outOfStock.success, false);
  assert.equal(outOfStock.outOfStock, true);

  // 5. Test Order Status
  const status = await fetchProviderOrderStatus(credentials, {
    orderCode: "ORDER_TEST_001",
  });
  assert.equal(status.success, true);
  assert.equal(status.status, "delivered");
  assert.match(status.deliveredText || "", /99887766554433/);

  // 6. Test Verify Provider Connection
  const verified = await verifyProviderConnection(credentials);
  assert.equal(verified.ok, true);
  assert.equal(verified.providerName, "doicard68");
  assert.equal(verified.sampleSize, 3);
});
