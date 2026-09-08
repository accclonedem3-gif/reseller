import assert from "node:assert/strict";
import test from "node:test";

import { resolveProviderBalanceVnd } from "@reseller/shared/server";

test("uses the USD wallet for products whose source price was converted from USD", () => {
  const balanceVnd = resolveProviderBalanceVnd(
    {
      walletCurrency: "USD",
      balance: 10.48,
      balanceVnd: 100_000,
      balanceUsd: 10.48,
      usdtBalance: 0,
    },
    "USD",
    27_000,
  );

  assert.equal(balanceVnd, 282_960);
  assert.ok(balanceVnd >= 10_530);
});

test("uses the VND wallet for products priced by the provider in VND", () => {
  const balanceVnd = resolveProviderBalanceVnd(
    {
      walletCurrency: "USD",
      balance: 10.48,
      balanceVnd: 100_000,
      balanceUsd: 10.48,
      usdtBalance: 0,
    },
    "VND",
    27_000,
  );

  assert.equal(balanceVnd, 100_000);
});

test("falls back to the primary balance only when its currency matches", () => {
  assert.equal(
    resolveProviderBalanceVnd(
      {
        walletCurrency: "USD",
        balance: 2.5,
        balanceVnd: null,
        balanceUsd: null,
        usdtBalance: 0,
      },
      "USD",
      27_000,
    ),
    67_500,
  );

  assert.equal(
    resolveProviderBalanceVnd(
      {
        walletCurrency: "USD",
        balance: 2.5,
        balanceVnd: null,
        balanceUsd: null,
        usdtBalance: 0,
      },
      "VND",
      27_000,
    ),
    null,
  );
});
