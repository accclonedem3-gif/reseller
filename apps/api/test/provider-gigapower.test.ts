import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  fetchProviderBalance,
  fetchProviderOrderStatus,
  fetchProviderProducts,
  isGigaPowerBaseUrl,
  parseGigaPowerCredentials,
  purchaseFromProvider,
  supportsProviderBalanceLookup,
  verifyProviderConnection,
} from "@reseller/shared/server";

test("GigaPower maps account catalog and purchase responses", async (t) => {
  const requests: URL[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    requests.push(url);
    response.setHeader("content-type", "application/json; charset=utf-8");

    assert.equal(url.searchParams.get("user"), "demo-user");
    assert.equal(url.searchParams.get("pass"), "demo-pass");

    if (url.pathname === "/api/accounts/available") {
      assert.equal(url.searchParams.get("type"), "normal");
      assert.equal(url.searchParams.get("limit"), "100");
      response.end(
        JSON.stringify({
          success: true,
          total: 2,
          accounts: [
            {
              id: "ACC_1",
              display_name: "LV 32 - 106 tướng",
              type: "normal",
              type_label: "Tài khoản/Mật khẩu",
              price: 50000,
              price_formatted: "50.000đ",
              description: "Server: VN2",
              created_at: "2026-09-01T01:13:20",
            },
            {
              id: "ACC_2",
              display_name: "LV 67 - 89 tướng",
              price: 35000,
            },
          ],
        }),
      );
      return;
    }

    if (url.pathname === "/api/buy_account") {
      const accountId = url.searchParams.get("account_id");
      if (accountId === "ACC_SOLD") {
        response.end(
          JSON.stringify({
            error: "Account is already sold",
            success: false,
          }),
        );
        return;
      }
      if (accountId === "ACC_NO_BALANCE") {
        response.end(
          JSON.stringify({
            balance: 0,
            error: "Insufficient balance. Need: 50000, Have: 0",
            need: 50000,
            success: false,
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          account_id: accountId,
          account_info: "legacy-user | legacy-pass",
          credentials: { username: "testuser", password: "testpassword" },
          display_name: "LV32 - 106 tướng",
          price: 50000,
          success: true,
          type: "normal",
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ success: false, error: "Not found" }));
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
    buyerKey: "demo-user:demo-pass",
    providerName: "gigapower",
  };

  assert.equal(isGigaPowerBaseUrl("http://gigapower.top:5000"), true);
  assert.equal(supportsProviderBalanceLookup(credentials), false);
  assert.equal(
    supportsProviderBalanceLookup({ baseUrl: "http://gigapower.top:5000" }),
    false,
  );
  assert.equal(
    supportsProviderBalanceLookup({ providerName: "roboticvn" }),
    true,
  );
  assert.deepEqual(parseGigaPowerCredentials("demo-user:demo-pass"), {
    user: "demo-user",
    pass: "demo-pass",
  });

  const verification = await verifyProviderConnection(credentials);
  assert.equal(verification.ok, true);
  assert.equal(verification.sampleSize, 2);

  const products = await fetchProviderProducts(credentials);
  assert.deepEqual(
    products.map((item) => [
      item.externalId,
      item.price,
      item.available,
      item.walletCurrency,
    ]),
    [
      ["ACC_1", 50000, 1, "VND"],
      ["ACC_2", 35000, 1, "VND"],
    ],
  );
  assert.equal(products[0].sourceName, "LV 32 - 106 tướng");
  assert.equal(products[0].description, "Server: VN2");

  const purchase = await purchaseFromProvider(credentials, {
    productId: "ACC_1",
    quantity: 1,
    clientOrderCode: "ORDER-LOCAL-1",
  });
  assert.equal(purchase.success, true);
  assert.equal(purchase.deliveredText, "testuser | testpassword");
  assert.equal(purchase.providerOrderId, "ACC_1");

  const sold = await purchaseFromProvider(credentials, {
    productId: "ACC_SOLD",
    quantity: 1,
  });
  assert.equal(sold.success, false);
  assert.equal(sold.outOfStock, true);
  assert.equal(sold.pending, false);

  const insufficient = await purchaseFromProvider(credentials, {
    productId: "ACC_NO_BALANCE",
    quantity: 1,
  });
  assert.equal(insufficient.success, false);
  assert.equal(insufficient.outOfStock, false);
  assert.equal(insufficient.pending, false);
  assert.match(insufficient.message || "", /Insufficient balance/);

  const requestCount = requests.length;
  const invalidQuantity = await purchaseFromProvider(credentials, {
    productId: "ACC_1",
    quantity: 2,
  });
  assert.equal(invalidQuantity.success, false);
  assert.equal(requests.length, requestCount);

  await assert.rejects(
    () => fetchProviderBalance(credentials),
    /does not expose a balance lookup endpoint/,
  );

  const status = await fetchProviderOrderStatus(credentials, {
    orderId: "ACC_1",
  });
  assert.equal(status.success, false);
  assert.equal(status.pending, true);
  assert.match(status.message || "", /manual review/i);
});

test("GigaPower treats a purchase timeout as ambiguous and never retries", async (t) => {
  let requestCount = 0;
  const server = createServer((_request, _response) => {
    requestCount += 1;
    // Deliberately leave the response open until the client aborts it.
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
      buyerKey: "demo-user:demo-pass",
      providerName: "gigapower",
      timeoutMs: 80,
    },
    { productId: "ACC_TIMEOUT", quantity: 1 },
  );

  assert.equal(result.success, false);
  assert.equal(result.pending, true);
  assert.equal(result.providerOrderId, "ACC_TIMEOUT");
  assert.match(result.message || "", /do not retry automatically/i);
  assert.equal(requestCount, 1);
});
