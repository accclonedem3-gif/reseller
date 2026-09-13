import "reflect-metadata";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchProviderBalance,
  fetchProviderOrderStatus,
  fetchProviderProducts,
  isHaiVanKhoSiBaseUrl,
  isHaiVanKhoSiProvider,
  purchaseFromProvider,
  verifyProviderConnection,
} from "@reseller/shared/server";

test("HaiVanKhoSi URL parsing and provider detection", () => {
  assert.equal(isHaiVanKhoSiBaseUrl("https://webshop.haivankhosi.site"), true);
  assert.equal(isHaiVanKhoSiBaseUrl("http://haivankhosi.site/api"), true);
  assert.equal(isHaiVanKhoSiBaseUrl("https://sub.haivankhosi.site"), true);
  assert.equal(isHaiVanKhoSiBaseUrl("https://other-domain.com"), false);

  assert.equal(
    isHaiVanKhoSiProvider({ providerName: "haivankhosi", baseUrl: "https://webshop.haivankhosi.site" }),
    true,
  );
  assert.equal(
    isHaiVanKhoSiProvider({ providerName: "haivan", baseUrl: "https://example.com" }),
    true,
  );
  assert.equal(
    isHaiVanKhoSiProvider({ baseUrl: "https://webshop.haivankhosi.site" }),
    true,
  );
  assert.equal(
    isHaiVanKhoSiProvider({ providerName: "canboso", baseUrl: "https://canboso.com" }),
    false,
  );
});

test("HaiVanKhoSi provider maps balance, products, purchase, and orders", async (t) => {
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

      // Verify Header
      const apiKey = request.headers["x-api-key"];
      if (apiKey !== "TEST_SECRET_API_KEY_123") {
        response.statusCode = 401;
        response.end(JSON.stringify({ success: false, error: "Invalid API key" }));
        return;
      }

      // Balance
      if (request.url === "/api/balance") {
        response.end(
          JSON.stringify({
            success: true,
            user_id: 7346373274,
            username: "pnreal",
            balance_vnd: 1602947,
            balance_usdt: 0,
          }),
        );
        return;
      }

      // Products (grouped menus structure)
      if (request.url?.startsWith("/api/products")) {
        response.end(
          JSON.stringify({
            success: true,
            menus: [
              {
                id: "menu_pro",
                name: "PRO",
                emoji_id: "5359437015752401733",
                menu_path: ["PRO"],
                products: [
                  {
                    id: "9wj6kkmh",
                    name: "PRO 6-7D - 5K KBH",
                    emoji_id: "123456",
                    price_vnd: 4000,
                    price_usdt: 0.15,
                    original_price_vnd: 5000,
                    discount_vnd: 1000,
                    discount_type: "percent",
                    discount_value: 20,
                    promo_code: "CTV12345678",
                    stock: 19,
                    description: "Mo ta san pham PRO...",
                  },
                  {
                    id: "out_of_stock_item",
                    name: "PRO Out Of Stock",
                    price_vnd: 10000,
                    stock: 0,
                    description: "Tam het hang",
                  },
                ],
              },
            ],
          }),
        );
        return;
      }

      // Buy
      if (request.url === "/api/buy" && request.method === "POST") {
        const parsed = JSON.parse(requestBody || "{}");
        if (parsed.product_id === "out_of_stock_item") {
          response.end(
            JSON.stringify({
              success: false,
              error: "Sản phẩm đã hết hàng trong kho",
            }),
          );
          return;
        }

        if (parsed.product_id === "9wj6kkmh") {
          response.end(
            JSON.stringify({
              success: true,
              order: {
                order_group: "API734637327420260325124000",
                product: "PRO 6-7D - 5K KBH",
                quantity: parsed.quantity || 1,
                bonus: 0,
                total_items: 1,
                original_total_price: 5000,
                discount: 1000,
                discount_type: "percent",
                discount_value: 20,
                promo_code: "CTV12345678",
                total_price: 4000,
                currency: "VND",
              },
              items: ["user_test_pro|pass_secret_888"],
              new_balance: 1598947,
            }),
          );
          return;
        }
      }

      // Orders
      if (request.url?.startsWith("/api/orders")) {
        response.end(
          JSON.stringify({
            success: true,
            orders: [
              {
                id: "API734637327420260325124000",
                product: "PRO 6-7D - 5K KBH",
                items: ["user_test_pro|pass_secret_888"],
                price: 4000,
                quantity: 1,
                created_at: "2026-03-25 10:20:00",
              },
            ],
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "Not found" }));
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
    buyerKey: "TEST_SECRET_API_KEY_123",
    providerName: "haivankhosi",
  };

  // 1. Balance
  const balance = await fetchProviderBalance(credentials);
  assert.equal(balance.success, true);
  assert.equal(balance.balance, 1602947);
  assert.equal(balance.balanceVnd, 1602947);
  assert.equal(balance.walletCurrency, "VND");
  assert.equal(balance.requesterName, "pnreal");

  // 2. Products
  const products = await fetchProviderProducts(credentials);
  assert.equal(products.length, 2);
  assert.equal(products[0]?.externalId, "9wj6kkmh");
  assert.equal(products[0]?.sourceName, "PRO 6-7D - 5K KBH");
  assert.equal(products[0]?.price, 4000);
  assert.equal(products[0]?.available, 19);
  assert.equal(products[0]?.metadata?.emoji_id, "123456");

  assert.equal(products[1]?.externalId, "out_of_stock_item");
  assert.equal(products[1]?.available, 0);

  // 3. Purchase Success
  const purchase = await purchaseFromProvider(credentials, {
    productId: "9wj6kkmh",
    quantity: 1,
    clientOrderCode: "LOCAL_ORDER_001",
  });
  assert.equal(purchase.success, true);
  assert.equal(purchase.pending, false);
  assert.equal(purchase.outOfStock, false);
  assert.equal(purchase.providerOrderId, "API734637327420260325124000");
  assert.match(purchase.deliveredText || "", /user_test_pro\|pass_secret_888/);

  // 4. Purchase Out of Stock
  const oosPurchase = await purchaseFromProvider(credentials, {
    productId: "out_of_stock_item",
    quantity: 1,
    clientOrderCode: "LOCAL_ORDER_002",
  });
  assert.equal(oosPurchase.success, false);
  assert.equal(oosPurchase.outOfStock, true);

  // 5. Order Status
  const orderStatus = await fetchProviderOrderStatus(credentials, {
    orderCode: "API734637327420260325124000",
  });
  assert.equal(orderStatus.success, true);
  assert.equal(orderStatus.status, "delivered");
  assert.match(orderStatus.deliveredText || "", /user_test_pro\|pass_secret_888/);

  // 6. Verify Connection
  const verify = await verifyProviderConnection(credentials);
  assert.equal(verify.ok, true);
  assert.equal(verify.providerName, "haivankhosi");
  assert.equal(verify.sampleSize, 2);
});

test("CreateProviderSourceDto accepts haivankhosi as providerName", async () => {
  const { validate } = await import("class-validator");
  const { plainToInstance } = await import("class-transformer");
  const { CreateProviderSourceDto } = await import("../src/shops/shops.dto");

  const validDto = plainToInstance(CreateProviderSourceDto, {
    label: "HaiVanKhoSi",
    providerName: "haivankhosi",
    baseUrl: "https://webshop.haivankhosi.site",
    buyerKey: "9360848f9a03ec91538be65a2195c44a7fa3b9518f1ebbe25be1927a29f0eca7",
  });

  const errors = await validate(validDto);
  assert.equal(errors.length, 0, `Validation failed: ${JSON.stringify(errors)}`);
});

