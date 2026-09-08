const assert = require("node:assert/strict");
const test = require("node:test");

const { PaymentProvider, PaymentTransactionStatus } = require("@prisma/client");
const { PaymentService } = require("../dist/lib/payment.service.js");
const { SolanaPaymentService } = require("../dist/lib/solana-payment.service.js");

function createPaymentService(prisma) {
  return new PaymentService(
    prisma,
    { usdtPaymentTolerance: 0.02 },
    {},
    {},
    { assertEnabled: async () => undefined },
  );
}

test("EVM transaction hashes are globally normalized", () => {
  const service = createPaymentService({});
  const hash = "A".repeat(64);
  assert.equal(service.normalizeOnchainTxHash(`0x${hash}`), "a".repeat(64));
  assert.equal(service.normalizeOnchainTxHash(hash), "a".repeat(64));
  assert.equal(service.normalizeOnchainTxHash("SolanaCaseSensitiveHash"), "SolanaCaseSensitiveHash");
});

test("crypto settlement requires a verified receipt for the same invoice and hash", async () => {
  const receipt = {
    provider: PaymentProvider.USDT_BEP20,
    externalOrderCode: "invoice-1",
    txHashNormalized: "a".repeat(64),
  };
  const service = createPaymentService({
    onchainPaymentReceipt: {
      findUnique: async () => receipt,
    },
  });

  await service.assertCryptoReceiptClaimed(
    "invoice-1",
    PaymentProvider.USDT_BEP20,
    `0x${"A".repeat(64)}`,
  );
  await assert.rejects(
    service.assertCryptoReceiptClaimed(
      "invoice-1",
      PaymentProvider.USDT_BEP20,
      `0x${"B".repeat(64)}`,
    ),
    /does not match the verified receipt/i,
  );
  await assert.rejects(
    service.assertCryptoReceiptClaimed("invoice-1", PaymentProvider.USDT_TRC20),
    /cannot be settled before/i,
  );
});

test("one normalized blockchain hash cannot be claimed by a second invoice", async () => {
  const now = new Date();
  let storedReceipt = null;
  const prisma = {
    paymentTransaction: {
      findUnique: async ({ where }) => ({
        provider: PaymentProvider.USDT_BEP20,
        status: PaymentTransactionStatus.PENDING,
        createdAt: now,
        rawPayloadJson: {
          manualCrypto: {
            usdtAmount: 20,
            address: "0x1111111111111111111111111111111111111111",
          },
        },
        providerAmount: null,
        providerCurrency: null,
        providerReference: null,
        order: {
          shopId: "shop-1",
          status: "AWAITING_PAYMENT",
          failureReason: null,
        },
        externalOrderCode: where.externalOrderCode,
      }),
    },
    customerWalletTopup: { findUnique: async () => null },
    depositRequest: { findUnique: async () => null },
    connectionTopupRequest: { findUnique: async () => null },
    onchainPaymentReceipt: {
      findUnique: async ({ where }) => {
        if (where.txHashNormalized) {
          return storedReceipt?.txHashNormalized === where.txHashNormalized ? storedReceipt : null;
        }
        if (where.externalOrderCode) {
          return storedReceipt?.externalOrderCode === where.externalOrderCode ? storedReceipt : null;
        }
        return null;
      },
      create: async ({ data }) => {
        storedReceipt = { id: "receipt-1", ...data };
        return storedReceipt;
      },
    },
  };
  const service = createPaymentService(prisma);
  const hash = `0x${"C".repeat(64)}`;
  const base = {
    provider: PaymentProvider.USDT_BEP20,
    txHash: hash,
    amountUsdt: 20,
    destination: "0x1111111111111111111111111111111111111111",
    transactionAt: now,
  };

  await assert.rejects(
    service.claimOnchainPaymentReceipt({
      ...base,
      externalOrderCode: "invoice-1",
      transactionAt: new Date(now.getTime() - 61_000),
    }),
    /predates this payment request/i,
  );
  await service.claimOnchainPaymentReceipt({ ...base, externalOrderCode: "invoice-1" });
  await assert.rejects(
    service.claimOnchainPaymentReceipt({ ...base, externalOrderCode: "invoice-2" }),
    /already been claimed/i,
  );
});

test("Solana destination balance is resolved by the exact token account index", () => {
  const mint = "USDT-mint";
  const service = new SolanaPaymentService({}, {}, { solanaUsdtMintAddress: mint }, {}, {});
  const tx = {
    transaction: {
      message: {
        accountKeys: [{ pubkey: "other-token-account" }, { pubkey: "target-token-account" }],
      },
    },
  };
  const meta = {
    postTokenBalances: [
      { accountIndex: 0, mint, owner: "attacker-owner" },
      { accountIndex: 1, mint, owner: "expected-owner" },
    ],
  };

  const result = service.findTokenBalanceForAccount("target-token-account", tx, meta);
  assert.equal(result.owner, "expected-owner");
});
