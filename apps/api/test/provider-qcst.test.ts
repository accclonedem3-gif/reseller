import "reflect-metadata";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchProviderBalance,
  fetchProviderOrderStatus,
  fetchProviderProducts,
  isQcstBaseUrl,
  isQcstKey,
  isQcstProvider,
  purchaseFromProvider,
  verifyProviderConnection,
} from "@reseller/shared/server";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateProviderSourceDto } from "../src/shops/shops.dto";

test("QCST URL parsing and provider detection", () => {
  assert.equal(isQcstBaseUrl("https://api.qcst.tech"), true);
  assert.equal(isQcstBaseUrl("http://api.qcst.tech/v1"), true);
  assert.equal(isQcstBaseUrl("https://qcst.tech"), true);
  assert.equal(isQcstBaseUrl("https://sub.qcst.tech"), true);
  assert.equal(isQcstBaseUrl("https://other-domain.com"), false);

  assert.equal(isQcstKey("qcst_live_86d6596dd123_r0R39r0H9sdBr7aAKJAWc5LI0Py9ccxd_GJiZG09ujQ"), true);
  assert.equal(isQcstKey("qcst_test_12345"), true);
  assert.equal(isQcstKey("sk_live_12345"), false);

  assert.equal(
    isQcstProvider({ providerName: "qcst", baseUrl: "https://api.qcst.tech" }),
    true,
  );
  assert.equal(
    isQcstProvider({ providerName: "qcsttech", baseUrl: "https://example.com" }),
    true,
  );
  assert.equal(
    isQcstProvider({ baseUrl: "https://api.qcst.tech" }),
    true,
  );
  assert.equal(
    isQcstProvider({ buyerKey: "qcst_live_abc123" }),
    true,
  );
  assert.equal(
    isQcstProvider({ providerName: "canboso", baseUrl: "https://canboso.com" }),
    false,
  );
});

test("QCST provider maps balance, products, purchase, and orders", async (t) => {
  const requests: Array<{ url: string; method: string; body: string; headers: Record<string, string | string[] | undefined> }> = [];

  const server = createServer((request, response) => {
    let requestBody = "";
    request.on("data", (chunk) => (requestBody += String(chunk)));
    request.on("end", () => {
      requests.push({
        url: request.url || "",
        method: request.method || "GET",
        body: requestBody,
        headers: request.headers,
      });

      response.setHeader("content-type", "application/json");

      const apiKey = request.headers["x-api-key"];
      if (apiKey !== "TEST_QCST_KEY_123") {
        response.statusCode = 401;
        response.end(JSON.stringify({ success: false, detail: "Invalid API key" }));
        return;
      }

      const urlObj = new URL(request.url || "/", "http://127.0.0.1");

      if (urlObj.pathname === "/v1/balance") {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              available: 1500000,
              currency: "VND",
            },
          }),
        );
        return;
      }

      if (urlObj.pathname === "/v1/products") {
        response.end(
          JSON.stringify({
            success: true,
            data: [
              {
                id: "prod_001",
                name: "Canva Pro 1 Năm",
                name_en: "Canva Pro 1 Year",
                description: "Canva Pro chính chủ bảo hành full.",
                warranty: "1 đổi 1 trong 1 năm",
                customer_input_type: "EMAIL",
                fulfillment_mode: "MANUAL",
                availability: "AVAILABLE",
                stock_type: "EXACT",
                stock_quantity: 15,
                min_quantity: 1,
                max_quantity: 10,
                price: 50000,
                currency: "VND",
                updated_at: "2026-07-26T03:51:48Z",
              },
              {
                id: "prod_002",
                name: "ChatGPT Plus 1 Tháng",
                name_en: "ChatGPT Plus 1 Month",
                description: "ChatGPT Plus cấp sẵn tài khoản.",
                warranty: "BH 30 ngày",
                customer_input_type: "NONE",
                fulfillment_mode: "AUTOMATIC",
                availability: "OUT_OF_STOCK",
                stock_type: "EXACT",
                stock_quantity: 0,
                price: 150000,
                currency: "VND",
                updated_at: "2026-07-26T03:51:48Z",
              },
            ],
          }),
        );
        return;
      }

      if (urlObj.pathname === "/v1/orders" && request.method === "POST") {
        const body = JSON.parse(requestBody || "{}");
        if (body.product_id === "prod_002") {
          response.statusCode = 400;
          response.end(
            JSON.stringify({
              success: false,
              detail: "Sản phẩm đã hết hàng (out of stock).",
            }),
          );
          return;
        }

        response.statusCode = 201;
        response.end(
          JSON.stringify({
            success: true,
            data: {
              id: "qcst_order_999",
              client_order_id: body.client_order_id,
              product_id: body.product_id,
              quantity: body.quantity,
              unit_price: 50000,
              total_amount: 50000,
              currency: "VND",
              status: "COMPLETED",
              delivery: ["user1@gmail.com|pass123|2fa_code"],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
        );
        return;
      }

      if (urlObj.pathname === "/v1/orders/qcst_order_999") {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              id: "qcst_order_999",
              status: "COMPLETED",
              delivery: ["user1@gmail.com|pass123|2fa_code"],
            },
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ success: false, detail: "Not Found" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const credentials = {
    providerName: "qcst",
    baseUrl,
    buyerKey: "TEST_QCST_KEY_123",
  };

  // 1. Check connection
  const connection = await verifyProviderConnection(credentials);
  assert.equal(connection.ok, true);
  assert.equal(connection.providerName, "qcst");
  assert.equal(connection.sampleSize, 2);

  // 2. Fetch Balance
  const balance = await fetchProviderBalance(credentials);
  assert.equal(balance.success, true);
  assert.equal(balance.balance, 1500000);
  assert.equal(balance.walletCurrency, "VND");
  assert.equal(balance.balanceVnd, 1500000);

  // 3. Fetch Products
  const products = await fetchProviderProducts(credentials);
  assert.equal(products.length, 2);
  const p1 = products.find((item) => item.externalId === "prod_001");
  assert(p1);
  assert.equal(p1.sourceName, "Canva Pro 1 Năm");
  assert.equal(p1.price, 50000);
  assert.equal(p1.available, 15);
  assert.equal(p1.requiresCustomerEmail, true);

  const p2 = products.find((item) => item.externalId === "prod_002");
  assert(p2);
  assert.equal(p2.available, 0);

  // 4. Purchase available product
  const purchaseSuccess = await purchaseFromProvider(credentials, {
    productId: "prod_001",
    quantity: 1,
    clientOrderCode: "ORD-TEST-001",
    customerEmail: "customer@gmail.com",
  });
  assert.equal(purchaseSuccess.success, true);
  assert.equal(purchaseSuccess.outOfStock, false);
  assert.equal(purchaseSuccess.deliveredText, "user1@gmail.com|pass123|2fa_code");
  assert.equal(purchaseSuccess.providerOrderId, "qcst_order_999");

  // 5. Purchase out of stock product
  const purchaseOOS = await purchaseFromProvider(credentials, {
    productId: "prod_002",
    quantity: 1,
    clientOrderCode: "ORD-TEST-002",
  });
  assert.equal(purchaseOOS.success, false);
  assert.equal(purchaseOOS.outOfStock, true);

  // 6. Order status
  const orderStatus = await fetchProviderOrderStatus(credentials, {
    orderId: "qcst_order_999",
  });
  assert.equal(orderStatus.success, true);
  assert.equal(orderStatus.status, "completed");
  assert.equal(orderStatus.deliveredText, "user1@gmail.com|pass123|2fa_code");
});

test("CreateProviderSourceDto accepts qcst as providerName", async () => {
  const dto = plainToInstance(CreateProviderSourceDto, {
    label: "QCST Provider",
    providerName: "qcst",
    baseUrl: "https://api.qcst.tech",
    buyerKey: "qcst_live_1234567890",
  });

  const errors = await validate(dto);
  assert.equal(errors.length, 0);
});

test("QCST live API credentials test with real key", async () => {
  const liveCredentials = {
    providerName: "qcst",
    baseUrl: "https://api.qcst.tech",
    buyerKey: "qcst_live_86d6596dd123_r0R39r0H9sdBr7aAKJAWc5LI0Py9ccxd_GJiZG09ujQ",
  };

  const connection = await verifyProviderConnection(liveCredentials);
  assert.equal(connection.ok, true);
  assert.equal(connection.providerName, "qcst");
  assert.ok(connection.sampleSize && connection.sampleSize > 0);

  const balance = await fetchProviderBalance(liveCredentials);
  assert.equal(balance.success, true);
  assert.equal(balance.walletCurrency, "VND");
  assert.equal(typeof balance.balance, "number");

  const products = await fetchProviderProducts(liveCredentials);
  assert.ok(products.length > 0);
  const gemini = products.find((p) => /gemini/i.test(p.sourceName));
  assert.ok(gemini);
});

