import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchProviderBalance,
  fetchProviderOrderStatus,
  fetchProviderProducts,
  isDinostoreBaseUrl,
  isDinostoreKey,
  isDinostoreProvider,
  purchaseFromProvider,
  verifyProviderConnection,
} from "@reseller/shared/server";

test("Dinostore provider maps catalog, balance, purchase and order status", async (t) => {
  const apiKey = "test_dino_api_key_123456789";
  const requests: Array<{
    method: string;
    path: string;
    key: string;
    idempotencyKey: string;
    body: string;
  }> = [];

  const server = createServer((request, response) => {
    let requestBody = "";
    request.on("data", (chunk) => (requestBody += String(chunk)));
    request.on("end", () => {
      requests.push({
        method: request.method || "",
        path: request.url || "",
        key: String(request.headers["x-api-key"] || ""),
        idempotencyKey: String(request.headers["x-idempotency-key"] || ""),
        body: requestBody,
      });

      response.setHeader("content-type", "application/json");

      if (request.url === "/api/v2/me") {
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              version: "2.0",
              partner_name: "TestPartner",
              is_admin: false,
              balance: 500000,
              maintenance_mode: false,
            },
          }),
        );
        return;
      }

      if (request.url === "/api/v2/catalog") {
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              products: [
                {
                  product_id: "p_101",
                  name: "Netflix Premium",
                  price: 65000,
                  currency: "VND",
                  description: "Account 1 month",
                  duration: "30 days",
                  warranty: "30 days",
                  delivery_mode: "instant_items",
                  stock_status: "in_stock",
                  stock_count: 5,
                  requires_gmail: false,
                },
                {
                  product_id: "p_102",
                  name: "YouTube Premium",
                  price: 25000,
                  currency: "VND",
                  description: "Upgrade Gmail",
                  delivery_mode: "manual_fulfillment",
                  stock_status: "in_stock",
                  stock_count: null,
                  requires_gmail: true,
                },
              ],
            },
          }),
        );
        return;
      }

      if (request.url === "/api/social/catalog") {
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              products: [
                {
                  product_id: "ctt_999",
                  name: "TikTok Followers",
                  price: 150,
                  currency: "VND",
                  delivery_mode: "social_service",
                  stock_status: "in_stock",
                  minimum_order_quantity: 100,
                  is_cheotuongtac_service: true,
                },
              ],
            },
          }),
        );
        return;
      }

      if (request.url === "/api/v2/orders" && request.method === "POST") {
        const body = JSON.parse(requestBody);
        if (body.product_id === "p_out_of_stock") {
          response.statusCode = 409;
          response.end(
            JSON.stringify({
              ok: false,
              detail: "Insufficient stock. available=0, required=1",
            }),
          );
          return;
        }

        if (body.product_id === "p_102") {
          // Manual pending order
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                order_code: "DINO-ORD-MANUAL-001",
                partner_ref: body.partner_ref,
                status: "⏳ Cho xu ly manual (API)",
                price: 25000,
                delivery_mode: "manual_pending",
                delivered_count: 0,
                items: [],
              },
            }),
          );
          return;
        }

        // Instant order with items
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              order_code: "DINO-ORD-INSTANT-001",
              partner_ref: body.partner_ref,
              status: "✅ Hoan thanh (API Product)",
              price: 65000,
              delivery_mode: "stock_items",
              delivered_count: 1,
              items: ["user@netflix.com|password123"],
            },
          }),
        );
        return;
      }

      if (request.url === "/api/v2/orders/DINO-ORD-MANUAL-001") {
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              order_code: "DINO-ORD-MANUAL-001",
              status: "✅ Hoan thanh (API Product)",
              delivered_count: 1,
              items: ["gmail_success@gmail.com|done"],
            },
          }),
        );
        return;
      }

      if (request.url === "/api/v2/orders/by-ref/REF_002") {
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              order_code: "DINO-ORD-BY-REF-002",
              partner_ref: "REF_002",
              status: "✅ Hoan thanh",
              items: ["account|secret"],
            },
          }),
        );
        return;
      }

      if (request.url === "/api/social/orders" && request.method === "POST") {
        const body = JSON.parse(requestBody);
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              order_code: "DINO-SOC-001",
              partner_ref: body.partner_ref,
              product_id: body.product_id,
              target_link: body.target_link,
              quantity: body.quantity,
              comments: body.comments,
              status: "⏳ Đang chạy (Social Service)",
              delivery_mode: "social_service",
              delivered_count: 0,
            },
          }),
        );
        return;
      }

      if (request.url === "/api/social/orders/DINO-SOC-001") {
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              order_code: "DINO-SOC-001",
              status: "✅ Hoàn thành (Social)",
              supplier_status: "completed",
            },
          }),
        );
        return;
      }

      if (request.url === "/api/social/orders/DINO-SOC-FAILED") {
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              order_code: "DINO-SOC-FAILED",
              status: "❌ Đã hủy bởi nhà cung cấp",
              supplier_status: "canceled",
            },
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, message: "Not found" }));
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

  // 1. Key, URL and Provider detection
  assert.equal(isDinostoreKey(apiKey), true);
  assert.equal(isDinostoreBaseUrl("https://api.dinos-tore.com"), true);
  assert.equal(isDinostoreBaseUrl("https://dinos-tore.com/"), true);
  assert.equal(isDinostoreProvider(credentials), true);
  assert.equal(
    isDinostoreProvider({ baseUrl: "https://some-other.com", providerName: "dinostore" }),
    true,
  );

  // 2. Balance lookup
  const balance = await fetchProviderBalance(credentials);
  assert.equal(balance.success, true);
  assert.equal(balance.balance, 500000);
  assert.equal(balance.balanceVnd, 500000);
  assert.equal(balance.walletCurrency, "VND");
  assert.equal(balance.requesterName, "TestPartner");

  // 3. Connection verification
  const verify = await verifyProviderConnection(credentials);
  assert.equal(verify.ok, true);
  assert.equal(verify.providerName, "dinostore");
  assert.equal(verify.sampleSize, 2);

  // 4. Products catalog mapping
  const products = await fetchProviderProducts(credentials);
  assert.equal(products.length, 2);
  const netflix = products.find((p) => p.externalId === "p_101");
  assert.ok(netflix);
  assert.equal(netflix.sourceName, "Netflix Premium");
  assert.equal(netflix.price, 65000);
  assert.equal(netflix.available, 5);
  assert.equal(netflix.hidden, false);
  assert.equal(netflix.isSlotProduct, false);

  const youtube = products.find((p) => p.externalId === "p_102");
  assert.ok(youtube);
  assert.equal(youtube.isSlotProduct, true);
  assert.equal(youtube.requiresCustomerEmail, true);
  assert.equal(youtube.available, null);

  // 5. Purchase - Instant delivery
  const instantPurchase = await purchaseFromProvider(credentials, {
    productId: "p_101",
    quantity: 1,
    clientOrderCode: "ORD_INSTANT_001",
  });
  assert.equal(instantPurchase.success, true);
  assert.equal(instantPurchase.pending, false);
  assert.equal(instantPurchase.deliveredText, "user@netflix.com|password123");
  assert.equal(instantPurchase.providerOrderCode, "DINO-ORD-INSTANT-001");

  // 6. Purchase - Pending delivery (manual fulfillment)
  const pendingPurchase = await purchaseFromProvider(credentials, {
    productId: "p_102",
    quantity: 1,
    customerEmail: "client@gmail.com",
    clientOrderCode: "ORD_MANUAL_001",
  });
  assert.equal(pendingPurchase.success, true);
  assert.equal(pendingPurchase.pending, true);
  assert.equal(pendingPurchase.deliveredText, null);
  assert.equal(pendingPurchase.providerOrderCode, "DINO-ORD-MANUAL-001");

  // 7. Purchase - Out of stock handling
  const outOfStockPurchase = await purchaseFromProvider(credentials, {
    productId: "p_out_of_stock",
    quantity: 1,
    clientOrderCode: "ORD_OOS_001",
  });
  assert.equal(outOfStockPurchase.success, false);
  assert.equal(outOfStockPurchase.outOfStock, true);

  // 8. Order status polling - by order code
  const statusPoll = await fetchProviderOrderStatus(credentials, {
    orderCode: "DINO-ORD-MANUAL-001",
  });
  assert.equal(statusPoll.success, true);
  assert.equal(statusPoll.status, "delivered");
  assert.equal(statusPoll.deliveredText, "gmail_success@gmail.com|done");

  // 9. Order status polling - fallback by partner ref
  const statusByRef = await fetchProviderOrderStatus(credentials, {
    orderCode: "REF_002",
  });
  assert.equal(statusByRef.success, true);
  assert.equal(statusByRef.status, "delivered");
  assert.equal(statusByRef.deliveredText, "account|secret");

  // 10. Verify headers were sent properly
  const v2OrderReq = requests.find((r) => r.path === "/api/v2/orders");
  assert.ok(v2OrderReq);
  assert.equal(v2OrderReq.key, apiKey);
  assert.ok(v2OrderReq.idempotencyKey.length > 0);

  // 11. Dinostore Social provider tests
  const socialCredentials = {
    ...credentials,
    providerName: "dinostore_social",
  };
  assert.equal(isDinostoreProvider(socialCredentials), true);

  // 11a. Fetch social products catalog
  const socialProducts = await fetchProviderProducts(socialCredentials);
  assert.equal(socialProducts.length, 1);
  const tiktokFollowers = socialProducts[0];
  assert.equal(tiktokFollowers.externalId, "ctt_999");
  assert.equal(tiktokFollowers.sourceName, "TikTok Followers");
  assert.equal(tiktokFollowers.price, 150);
  assert.equal((tiktokFollowers.metadata as any).is_social, true);
  assert.equal(tiktokFollowers.quantityFixed, 100);

  // 11b. Purchase social service
  const socialPurchase = await purchaseFromProvider(socialCredentials, {
    productId: "ctt_999",
    quantity: 500,
    targetLink: "https://tiktok.com/@mytestaccount",
    comments: "Great video!",
    clientOrderCode: "ORD_SOC_001",
  });
  assert.equal(socialPurchase.success, true);
  assert.equal(socialPurchase.pending, true);
  assert.equal(socialPurchase.providerOrderCode, "DINO-SOC-001");

  // Verify social order request payload
  const socialOrderReq = requests.find((r) => r.path === "/api/social/orders");
  assert.ok(socialOrderReq);
  assert.equal(socialOrderReq.key, apiKey);
  const socialBody = JSON.parse(socialOrderReq.body);
  assert.equal(socialBody.product_id, "ctt_999");
  assert.equal(socialBody.quantity, 500);
  assert.equal(socialBody.target_link, "https://tiktok.com/@mytestaccount");
  assert.equal(socialBody.comments, "Great video!");

  // 11c. Order status polling for social service - completed
  const socialStatus = await fetchProviderOrderStatus(socialCredentials, {
    orderCode: "DINO-SOC-001",
  });
  assert.equal(socialStatus.success, true);
  assert.equal(socialStatus.status, "delivered");
  assert.ok(socialStatus.deliveredText?.includes("hoàn tất") || socialStatus.deliveredText?.includes("Dịch vụ"));

  // 11d. Order status polling for social service - failed/cancelled
  const socialFailedStatus = await fetchProviderOrderStatus(socialCredentials, {
    orderCode: "DINO-SOC-FAILED",
  });
  assert.equal(socialFailedStatus.success, false);
  assert.equal(socialFailedStatus.status, "failed");
});
