import assert from "node:assert/strict";
import { PaymentProvider } from "@prisma/client";
import { resolveVisiblePaymentProviders } from "../src/lib/payment-method-visibility";

function testCryptoProvidersFilter() {
  const providersCase1: PaymentProvider[] = [
    PaymentProvider.PAYOS,
    PaymentProvider.BINANCE,
  ];

  const cryptoProviders1 = providersCase1.filter(
    (provider) =>
      provider === PaymentProvider.USDT_TRC20 ||
      provider === PaymentProvider.USDT_BEP20 ||
      provider === PaymentProvider.USDT_SOL ||
      provider === PaymentProvider.USDT_TON ||
      provider === PaymentProvider.BINANCE ||
      provider === PaymentProvider.BINANCE_PAY ||
      provider === PaymentProvider.OKX,
  );
  const hasUsdt1 = cryptoProviders1.length > 0;
  const hasVnd1 = providersCase1.some(
    (p) =>
      p === PaymentProvider.PAYOS ||
      p === PaymentProvider.PAY2S ||
      p === PaymentProvider.WEB2M ||
      p === PaymentProvider.MOCK,
  );

  assert.equal(hasUsdt1, true);
  assert.equal(hasVnd1, true);
  assert.equal(cryptoProviders1.includes(PaymentProvider.BINANCE), true);

  const providersCase2: PaymentProvider[] = [PaymentProvider.BINANCE_PAY];
  const cryptoProviders2 = providersCase2.filter(
    (provider) =>
      provider === PaymentProvider.USDT_TRC20 ||
      provider === PaymentProvider.USDT_BEP20 ||
      provider === PaymentProvider.USDT_SOL ||
      provider === PaymentProvider.USDT_TON ||
      provider === PaymentProvider.BINANCE ||
      provider === PaymentProvider.BINANCE_PAY ||
      provider === PaymentProvider.OKX,
  );
  const hasUsdt2 = cryptoProviders2.length > 0;
  const hasVnd2 = providersCase2.some(
    (p) =>
      p === PaymentProvider.PAYOS ||
      p === PaymentProvider.PAY2S ||
      p === PaymentProvider.WEB2M ||
      p === PaymentProvider.MOCK,
  );

  assert.equal(hasUsdt2, true);
  assert.equal(hasVnd2, false);
  assert.equal(cryptoProviders2.length, 1);
  assert.equal(cryptoProviders2[0], PaymentProvider.BINANCE_PAY);
}

function testVisibilityHelper() {
  const visibleBinance = resolveVisiblePaymentProviders(
    {
      binanceUid: "12345678",
      binanceEnabled: true,
      binancePayEnabled: false,
    },
    PaymentProvider.MOCK,
  );
  assert.ok(visibleBinance.includes(PaymentProvider.BINANCE));

  const visibleBinancePay = resolveVisiblePaymentProviders(
    {
      binanceEnabled: true,
      binancePayEnabled: true,
    },
    PaymentProvider.MOCK,
  );
  assert.ok(visibleBinancePay.includes(PaymentProvider.BINANCE_PAY));
}

testCryptoProvidersFilter();
testVisibilityHelper();
console.log("All wallet topup Binance tests passed!");
