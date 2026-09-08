import assert from "node:assert/strict";
import test from "node:test";

import { PaymentProvider } from "@prisma/client";

import { resolveVisiblePaymentProviders } from "../src/lib/payment-method-visibility";

test("bot hides receiving methods that are configured but turned off on the web", () => {
  const providers = resolveVisiblePaymentProviders({
    provider: PaymentProvider.PAYOS,
    payosClientIdEncrypted: "encrypted-client-id",
    payosApiKeyEncrypted: "encrypted-api-key",
    payosChecksumKeyEncrypted: "encrypted-checksum-key",
    binanceUid: "123456789",
    binanceEnabled: false,
    okxUid: "987654321",
    okxEnabled: false,
    usdtTrc20Address: "TRON_ADDRESS",
    usdtTrc20Enabled: false,
    usdtBep20Address: "0x1111111111111111111111111111111111111111",
    usdtBep20Enabled: false,
    usdtSolanaAddress: "SOLANA_ADDRESS",
    usdtSolanaEnabled: false,
    usdtTonAddress: "TON_ADDRESS",
    usdtTonEnabled: false,
    paypalEnabled: false,
    paypalClientIdEncrypted: "encrypted-client-id",
    paypalClientSecretEncrypted: "encrypted-client-secret",
    paypalWebhookId: "WH-123",
  }, PaymentProvider.MOCK);

  assert.deepEqual(providers, [PaymentProvider.PAYOS]);
});

test("bot shows only enabled and fully configured receiving methods", () => {
  const providers = resolveVisiblePaymentProviders({
    provider: PaymentProvider.WEB2M,
    web2mAccountNumber: "0123456789",
    web2mBankCode: "mb",
    binanceUid: "123456789",
    binanceEnabled: true,
    okxUid: "",
    okxEnabled: true,
    usdtTrc20Address: "TRON_ADDRESS",
    usdtTrc20Enabled: true,
    usdtBep20Address: "0x1111111111111111111111111111111111111111",
    usdtBep20Enabled: true,
    usdtSolanaAddress: "SOLANA_ADDRESS",
    usdtSolanaEnabled: false,
    usdtTonAddress: "TON_ADDRESS",
    usdtTonEnabled: true,
    paypalEnabled: true,
    paypalClientIdEncrypted: "encrypted-client-id",
    paypalClientSecretEncrypted: "encrypted-client-secret",
    paypalWebhookId: "WH-123",
  }, PaymentProvider.MOCK);

  assert.deepEqual(providers, [
    PaymentProvider.WEB2M,
    PaymentProvider.PAYPAL,
    PaymentProvider.BINANCE,
    PaymentProvider.USDT_TRC20,
    PaymentProvider.USDT_BEP20,
    PaymentProvider.USDT_TON,
  ]);
});

test("Binance merchant mode replaces manual Binance UID when the method is enabled", () => {
  const providers = resolveVisiblePaymentProviders({
    provider: PaymentProvider.PAYOS,
    payosClientIdEncrypted: "encrypted-client-id",
    payosApiKeyEncrypted: "encrypted-api-key",
    payosChecksumKeyEncrypted: "encrypted-checksum-key",
    binanceUid: "123456789",
    binanceEnabled: true,
    binancePayEnabled: true,
  }, PaymentProvider.MOCK);

  assert.deepEqual(providers, [PaymentProvider.PAYOS, PaymentProvider.BINANCE_PAY]);
});

test("legacy PayPal primary value falls back to the configured VND gateway", () => {
  const providers = resolveVisiblePaymentProviders({
    provider: PaymentProvider.PAYPAL,
    paypalEnabled: false,
    payosClientIdEncrypted: "encrypted-client-id",
    payosApiKeyEncrypted: "encrypted-api-key",
    payosChecksumKeyEncrypted: "encrypted-checksum-key",
  }, PaymentProvider.PAYOS);

  assert.deepEqual(providers, [PaymentProvider.PAYOS]);
});

test("selected bank QR gateway stays hidden until its required web configuration is complete", () => {
  assert.deepEqual(resolveVisiblePaymentProviders({
    provider: PaymentProvider.PAYOS,
    payosClientIdEncrypted: "encrypted-client-id",
    payosApiKeyEncrypted: "",
    payosChecksumKeyEncrypted: "encrypted-checksum-key",
  }, PaymentProvider.PAYOS), []);

  assert.deepEqual(resolveVisiblePaymentProviders({
    provider: PaymentProvider.PAY2S,
    pay2sPartnerCodeEncrypted: "encrypted-partner-code",
    pay2sAccessKeyEncrypted: "encrypted-access-key",
    pay2sSecretKeyEncrypted: "encrypted-secret-key",
    pay2sBankAccount: "",
    pay2sBankId: "MBB",
  }, PaymentProvider.PAYOS), []);

  assert.deepEqual(resolveVisiblePaymentProviders({
    provider: PaymentProvider.WEB2M,
    web2mAccountNumber: "0123456789",
    web2mBankCode: "",
  }, PaymentProvider.PAYOS), []);
});
