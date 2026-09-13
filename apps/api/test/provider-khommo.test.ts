import "reflect-metadata";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchProviderBalance,
  fetchProviderOrderStatus,
  fetchProviderProducts,
  isKhommoBaseUrl,
  isKhommoProvider,
  purchaseFromProvider,
  verifyProviderConnection,
} from "@reseller/shared/server";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateProviderSourceDto } from "../src/shops/shops.dto";

test("KhoMMO URL parsing and provider detection", () => {
  assert.equal(isKhommoBaseUrl("https://khommo.vn"), true);
  assert.equal(isKhommoBaseUrl("http://khommo.vn/api"), true);
  assert.equal(isKhommoBaseUrl("https://sub.khommo.vn"), true);
  assert.equal(isKhommoBaseUrl("https://other-domain.com"), false);

  assert.equal(
    isKhommoProvider({ providerName: "khommo", baseUrl: "https://khommo.vn" }),
    true,
  );
  assert.equal(
    isKhommoProvider({ providerName: "khommovn", baseUrl: "https://example.com" }),
    true,
  );
  assert.equal(
    isKhommoProvider({ baseUrl: "https://khommo.vn" }),
    true,
  );
  assert.equal(
    isKhommoProvider({ providerName: "canboso", baseUrl: "https://canboso.com" }),
    false,
  );
});

test("KhoMMO provider maps balance, products, purchase, and orders", async (t) => {
  const requests: Array<{ url: string; body: string; headers: Record<string, string | string[] | undefined> }> = [];

  const server = createServer((request, response) => {
    let requestBody = "";
    request.on("data", (chunk) => (requestBody += String(chunk)));
    request.on("end", () => {
      requests.push({
        url: request.url || "",
        body: requestBody,
        headers: request.headers,
      });

      response.setHeader("content-type", "application/json");

      const urlObj = new URL(request.url || "/", "http://127.0.0.1");
      const apiKey = urlObj.searchParams.get("api_key");

      if (urlObj.pathname === "/api/profile.php") {
        if (apiKey !== "TEST_KHOMMO_KEY_123") {
          response.statusCode = 401;
          response.end(JSON.stringify({ status: "error", msg: "API Key không hợp lệ" }));
          return;
        }
        response.end(
          JSON.stringify({
            status: "success",
            msg: "Lấy dữ liệu thành công!",
            data: {
              username: "test_reseller",
              money: "250000.00",
            },
          }),
        );
        return;
      }

      if (urlObj.pathname === "/api/products.php") {
        if (apiKey !== "TEST_KHOMMO_KEY_123") {
          response.statusCode = 401;
          response.end(JSON.stringify({ status: "error", msg: "API Key không hợp lệ" }));
          return;
        }
        response.end(
          JSON.stringify({
            status: "success",
            msg: "Lấy dữ liệu thành công!",
            categories: [
              {
                id: "101",
                name: "Hotmail/Outlook",
                icon: "https://khommo.vn/icon.png",
                products: [
                  {
                    id: "31126",
                    name: "Hotmail Trusted - OAuth2",
                    price: "278.6",
                    amount: 99880,
                    description: "Định dạng Mail|Pass|Refresh_token",
                    flag: null,
                    min: "1",
                    max: "1000",
                  },
                ],
              },
            ],
          }),
        );
        return;
      }

      if (urlObj.pathname === "/api/buy_product.php") {
        const bodyParams = new URLSearchParams(requestBody);
        const postApiKey = bodyParams.get("api_key");
        const action = bodyParams.get("action");
        const id = bodyParams.get("id");
        const amount = Number(bodyParams.get("amount") || "0");

        if (postApiKey !== "TEST_KHOMMO_KEY_123" || action !== "buyProduct") {
          response.statusCode = 400;
          response.end(JSON.stringify({ status: "error", msg: "Dữ liệu không hợp lệ" }));
          return;
        }

        if (id === "OUT_OF_STOCK") {
          response.end(JSON.stringify({ status: "error", msg: "Số lượng còn lại trong kho không đủ" }));
          return;
        }

        if (id === "NO_FUNDS") {
          response.end(JSON.stringify({ status: "error", msg: "Số dư không đủ, vui lòng nạp thêm" }));
          return;
        }

        response.end(
          JSON.stringify({
            status: "success",
            msg: "Tạo đơn hàng thành công!",
            trans_id: "KM_TRANS_9988",
            data: [
              "user1@mail.com|pass1|token1",
              "user2@mail.com|pass2|token2",
            ].slice(0, amount),
          }),
        );
        return;
      }

      if (urlObj.pathname === "/api/order.php") {
        const order = urlObj.searchParams.get("order");
        if (order === "NOT_FOUND") {
          response.end(JSON.stringify({ status: "error", msg: "Đơn hàng không tồn tại" }));
          return;
        }
        response.end(
          JSON.stringify({
            status: "success",
            msg: "Thành công",
            data: {
              order_id: order,
              status: "completed",
              accounts: ["user1@mail.com|pass1|token1"],
            },
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ status: "error", msg: "Not found" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(() => {
    server.close();
  });

  const credentials = {
    providerName: "khommo",
    baseUrl,
    buyerKey: "TEST_KHOMMO_KEY_123",
  };

  // 1. Balance
  const balance = await fetchProviderBalance(credentials);
  assert.equal(balance.success, true);
  assert.equal(balance.balance, 250000);
  assert.equal(balance.balanceVnd, 250000);
  assert.equal(balance.walletCurrency, "VND");
  assert.equal(balance.requesterName, "test_reseller");

  // 2. Products
  const products = await fetchProviderProducts(credentials);
  assert.equal(products.length, 1);
  assert.equal(products[0].externalId, "31126");
  assert.equal(products[0].sourceName, "Hotmail Trusted - OAuth2");
  assert.equal(products[0].price, 278.6);
  assert.equal(products[0].available, 99880);
  assert.equal(products[0].walletCurrency, "VND");
  assert.equal(products[0].metadata?.category_name, "Hotmail/Outlook");

  // 3. Purchase Success
  const purchaseSuccess = await purchaseFromProvider(credentials, {
    productId: "31126",
    quantity: 2,
    clientOrderCode: "LOCAL_ORDER_1001",
  });
  assert.equal(purchaseSuccess.success, true);
  assert.equal(purchaseSuccess.outOfStock, false);
  assert.equal(purchaseSuccess.providerOrderId, "KM_TRANS_9988");
  assert.equal(
    purchaseSuccess.deliveredText,
    "user1@mail.com|pass1|token1\nuser2@mail.com|pass2|token2",
  );

  // 4. Purchase Out of Stock
  const purchaseOOS = await purchaseFromProvider(credentials, {
    productId: "OUT_OF_STOCK",
    quantity: 1,
  });
  assert.equal(purchaseOOS.success, false);
  assert.equal(purchaseOOS.outOfStock, true);

  // 5. Purchase Insufficient Funds
  const purchaseNoFunds = await purchaseFromProvider(credentials, {
    productId: "NO_FUNDS",
    quantity: 1,
  });
  assert.equal(purchaseNoFunds.success, false);
  assert.equal(purchaseNoFunds.outOfStock, false);
  assert.match(purchaseNoFunds.message || "", /Số dư không đủ/);

  // 6. Order Status Success
  const orderStatus = await fetchProviderOrderStatus(credentials, {
    orderCode: "KM_TRANS_9988",
  });
  assert.equal(orderStatus.success, true);
  assert.equal(orderStatus.status, "completed");
  assert.equal(orderStatus.deliveredText, "user1@mail.com|pass1|token1");

  // 7. Order Status Not Found
  const orderNotFound = await fetchProviderOrderStatus(credentials, {
    orderCode: "NOT_FOUND",
  });
  assert.equal(orderNotFound.success, false);
  assert.match(orderNotFound.message || "", /không tồn tại/);

  // 8. Verify Provider Connection
  const verify = await verifyProviderConnection(credentials);
  assert.equal(verify.ok, true);
  assert.equal(verify.providerName, "khommo");
  assert.equal(verify.sampleSize, 1);
});

test("CreateProviderSourceDto accepts khommo as providerName", async () => {
  const dto = plainToInstance(CreateProviderSourceDto, {
    label: "KhoMMO",
    providerName: "khommo",
    baseUrl: "https://khommo.vn",
    buyerKey: "VALID_BUYER_KEY_123",
    priceMarkupPercent: 10,
    syncIntervalMinutes: 60,
    isEnabled: true,
  });

  const errors = await validate(dto);
  assert.equal(errors.length, 0, `Expected no validation errors: ${JSON.stringify(errors)}`);
});
