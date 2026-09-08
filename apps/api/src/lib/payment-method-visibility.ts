import { PaymentProvider } from "@prisma/client";

export type PaymentMethodVisibilityConfig = {
  provider?: PaymentProvider | null;
  payosClientIdEncrypted?: string | null;
  payosApiKeyEncrypted?: string | null;
  payosChecksumKeyEncrypted?: string | null;
  pay2sPartnerCodeEncrypted?: string | null;
  pay2sAccessKeyEncrypted?: string | null;
  pay2sSecretKeyEncrypted?: string | null;
  pay2sBankAccount?: string | null;
  pay2sBankId?: string | null;
  web2mAccountNumber?: string | null;
  web2mBankCode?: string | null;
  binanceUid?: string | null;
  binanceEnabled?: boolean | null;
  okxUid?: string | null;
  okxEnabled?: boolean | null;
  usdtTrc20Address?: string | null;
  usdtTrc20Enabled?: boolean | null;
  usdtBep20Address?: string | null;
  usdtBep20Enabled?: boolean | null;
  usdtSolanaAddress?: string | null;
  usdtSolanaEnabled?: boolean | null;
  usdtTonAddress?: string | null;
  usdtTonEnabled?: boolean | null;
  binancePayEnabled?: boolean | null;
  paypalEnabled?: boolean | null;
  paypalClientIdEncrypted?: string | null;
  paypalClientSecretEncrypted?: string | null;
  paypalWebhookId?: string | null;
};

function hasValue(value: string | null | undefined) {
  return Boolean(String(value || "").trim());
}

function isPrimaryProviderReady(
  paymentConfig: PaymentMethodVisibilityConfig | null | undefined,
  provider: PaymentProvider,
) {
  if (provider === PaymentProvider.MOCK) return true;
  if (!paymentConfig) return false;

  if (provider === PaymentProvider.PAYOS) {
    return hasValue(paymentConfig.payosClientIdEncrypted)
      && hasValue(paymentConfig.payosApiKeyEncrypted)
      && hasValue(paymentConfig.payosChecksumKeyEncrypted);
  }

  if (provider === PaymentProvider.PAY2S) {
    return hasValue(paymentConfig.pay2sPartnerCodeEncrypted)
      && hasValue(paymentConfig.pay2sAccessKeyEncrypted)
      && hasValue(paymentConfig.pay2sSecretKeyEncrypted)
      && hasValue(paymentConfig.pay2sBankAccount)
      && hasValue(paymentConfig.pay2sBankId);
  }

  if (provider === PaymentProvider.WEB2M) {
    return hasValue(paymentConfig.web2mAccountNumber)
      && hasValue(paymentConfig.web2mBankCode);
  }

  return false;
}

export function resolveVisiblePaymentProviders(
  paymentConfig: PaymentMethodVisibilityConfig | null | undefined,
  fallbackPrimaryProvider: PaymentProvider,
) {
  const providers: PaymentProvider[] = [];
  const configuredPrimaryProvider = paymentConfig?.provider || fallbackPrimaryProvider;
  const primaryProvider = configuredPrimaryProvider === PaymentProvider.PAYPAL
    ? fallbackPrimaryProvider
    : configuredPrimaryProvider;

  if (isPrimaryProviderReady(paymentConfig, primaryProvider)) {
    providers.push(primaryProvider);
  }

  if (
    paymentConfig?.paypalEnabled
    && hasValue(paymentConfig.paypalClientIdEncrypted)
    && hasValue(paymentConfig.paypalClientSecretEncrypted)
    && hasValue(paymentConfig.paypalWebhookId)
  ) {
    providers.push(PaymentProvider.PAYPAL);
  }

  if (paymentConfig?.binanceEnabled && paymentConfig.binancePayEnabled) {
    providers.push(PaymentProvider.BINANCE_PAY);
  } else if (paymentConfig?.binanceEnabled && hasValue(paymentConfig.binanceUid)) {
    providers.push(PaymentProvider.BINANCE);
  }

  if (paymentConfig?.okxEnabled && hasValue(paymentConfig.okxUid)) {
    providers.push(PaymentProvider.OKX);
  }

  if (paymentConfig?.usdtTrc20Enabled && hasValue(paymentConfig.usdtTrc20Address)) {
    providers.push(PaymentProvider.USDT_TRC20);
  }

  if (paymentConfig?.usdtBep20Enabled && hasValue(paymentConfig.usdtBep20Address)) {
    providers.push(PaymentProvider.USDT_BEP20);
  }

  if (paymentConfig?.usdtSolanaEnabled && hasValue(paymentConfig.usdtSolanaAddress)) {
    providers.push(PaymentProvider.USDT_SOL);
  }

  if (paymentConfig?.usdtTonEnabled && hasValue(paymentConfig.usdtTonAddress)) {
    providers.push(PaymentProvider.USDT_TON);
  }

  return Array.from(new Set(providers));
}
