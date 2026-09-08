import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { PaymentProvider, PaymentTransactionStatus, Prisma } from "@prisma/client";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { CustomerWalletService } from "../customer-wallet/customer-wallet.service";
import { PaymentService } from "./payment.service";

type SubmitTelegramTxHashInput = {
  shopId: string;
  telegramUserId: string;
  externalOrderCode: string;
  txHash: string;
};

type ManualCryptoPayload = {
  provider?: "BINANCE" | "OKX" | "USDT_TRC20" | "USDT_BEP20";
  uid?: string | null;
  address?: string | null;
  network?: "TRC20" | "BEP20" | null;
  usdtAmount?: number;
  usdtVndRate?: number;
  note?: string;
};

type VerifiedTransfer = {
  network: "TRC20" | "BEP20";
  token: "USDT";
  txHash: string;
  fromAddress: string | null;
  toAddress: string;
  amountUsdt: number;
  confirmedAt: Date | null;
  blockNumber: number | null;
  confirmations: number | null;
  tokenAddress: string;
  rawPayload: Record<string, unknown>;
};

type Trc20TransferRecord = {
  transaction_id?: unknown;
  hash?: unknown;
  transaction?: unknown;
  from?: unknown;
  to?: unknown;
  value?: unknown;
  amount?: unknown;
  block_timestamp?: unknown;
  block?: unknown;
  confirmed?: unknown;
  contract_ret?: unknown;
  final_result?: unknown;
  contract_address?: unknown;
  token_info?: {
    address?: unknown;
    decimals?: unknown;
    symbol?: unknown;
  } | null;
  decimals?: unknown;
};

type Trc20EventRecord = {
  event_name?: unknown;
  contract_address?: unknown;
  transaction_id?: unknown;
  transaction?: unknown;
  block_timestamp?: unknown;
  block_number?: unknown;
  result?: {
    from?: unknown;
    to?: unknown;
    value?: unknown;
  } | null;
};

@Injectable()
export class OnchainPaymentService {
  private readonly logger = new Logger(OnchainPaymentService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(CustomerWalletService)
    private readonly customerWalletService: CustomerWalletService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
  ) {}

  async submitTelegramTxHash(input: SubmitTelegramTxHashInput) {
    const normalizedTxHash = this.normalizeTxHash(input.txHash);
    const paymentTransaction = await this.prisma.paymentTransaction.findUnique({
      where: {
        externalOrderCode: input.externalOrderCode,
      },
      include: {
        order: {
          include: {
            customer: true,
            shop: {
              include: {
                paymentConfig: true,
              },
            },
          },
        },
      },
    });

    if (!paymentTransaction?.order) {
      throw new NotFoundException("Payment transaction not found.");
    }

    if (paymentTransaction.order.shopId !== input.shopId) {
      throw new NotFoundException("Payment transaction not found.");
    }

    if (paymentTransaction.order.customer?.telegramUserId !== input.telegramUserId) {
      throw new BadRequestException("This payment does not belong to your Telegram account.");
    }

    if (
      paymentTransaction.provider !== PaymentProvider.USDT_TRC20 &&
      paymentTransaction.provider !== PaymentProvider.USDT_BEP20
    ) {
      throw new BadRequestException("Only USDT TRC20/BEP20 payments accept tx hash confirmation.");
    }

    if (paymentTransaction.status === PaymentTransactionStatus.PAID) {
      if (
        paymentTransaction.cryptoTxHash &&
        paymentTransaction.cryptoTxHash.toLowerCase() !== normalizedTxHash.toLowerCase()
      ) {
        throw new BadRequestException("This order has already been confirmed with a different tx hash.");
      }

      return {
        alreadyPaid: true,
        txHash: paymentTransaction.cryptoTxHash || normalizedTxHash,
        order: await this.ordersService.markPaymentCompleted(input.externalOrderCode),
      };
    }

    const [reusedTx, reusedTopup] = await Promise.all([
      this.prisma.paymentTransaction.findFirst({
        where: {
          cryptoTxHash: normalizedTxHash,
          id: { not: paymentTransaction.id },
        },
        select: { externalOrderCode: true },
      }),
      this.prisma.customerWalletTopup.findFirst({
        where: { cryptoTxHash: normalizedTxHash },
        select: { externalOrderCode: true },
      }),
    ]);

    if (reusedTx || reusedTopup) {
      throw new BadRequestException("This tx hash has already been used.");
    }

    const manualCrypto = this.extractManualCryptoPayload(paymentTransaction.rawPayloadJson);
    const isBep20 = paymentTransaction.provider === PaymentProvider.USDT_BEP20;
    const receiverAddress = String(
      manualCrypto?.address || (isBep20
        ? paymentTransaction.order.shop.paymentConfig?.usdtBep20Address
        : paymentTransaction.order.shop.paymentConfig?.usdtTrc20Address) || "",
    ).trim();

    if (!receiverAddress) {
      throw new BadRequestException(`USDT ${isBep20 ? "BEP20" : "TRC20"} address is not configured.`);
    }

    const expectedAmount = Number(manualCrypto?.usdtAmount || 0);

    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      throw new BadRequestException("Expected USDT amount is missing for this order.");
    }

    const verifiedTransfer = this.isMockTxHash(normalizedTxHash)
      ? this.buildMockVerifiedTransfer(normalizedTxHash, receiverAddress, expectedAmount)
      : isBep20
        ? await this.verifyUsdtBep20Transfer({
          txHash: normalizedTxHash,
          receiverAddress,
          expectedAmount,
          createdAt: paymentTransaction.createdAt,
        })
        : await this.verifyUsdtTrc20Transfer({
          txHash: normalizedTxHash,
          receiverAddress,
          expectedAmount,
          createdAt: paymentTransaction.createdAt,
        });

    const receipt = this.isMockTxHash(normalizedTxHash)
      ? null
      : await this.paymentService.claimOnchainPaymentReceipt({
          provider: paymentTransaction.provider,
          txHash: verifiedTransfer.txHash,
          externalOrderCode: input.externalOrderCode,
          amountUsdt: verifiedTransfer.amountUsdt,
          destination: verifiedTransfer.toAddress,
          transactionAt: verifiedTransfer.confirmedAt!,
          tokenAddress: verifiedTransfer.tokenAddress,
          blockReference: verifiedTransfer.blockNumber,
          confirmations: verifiedTransfer.confirmations,
          rawPayload: verifiedTransfer.rawPayload,
        });

    const order = await this.ordersService.markPaymentCompleted(
      input.externalOrderCode,
      {
        source: verifiedTransfer.rawPayload.source || (isBep20 ? "bep20_tx_hash" : "trc20_tx_hash"),
        externalOrderCode: input.externalOrderCode,
        txHash: verifiedTransfer.txHash,
        network: verifiedTransfer.network,
        token: verifiedTransfer.token,
        amountUsdt: verifiedTransfer.amountUsdt,
        expectedAmountUsdt: expectedAmount,
        toleranceUsdt: this.config.usdtPaymentTolerance,
        fromAddress: verifiedTransfer.fromAddress,
        toAddress: verifiedTransfer.toAddress,
        confirmedAt: verifiedTransfer.confirmedAt?.toISOString() || null,
        blockNumber: verifiedTransfer.blockNumber,
        verification: verifiedTransfer.rawPayload,
      },
      {
        cryptoTxHash: verifiedTransfer.txHash,
      },
    );
    if (receipt) {
      await this.paymentService.markOnchainPaymentReceiptProcessed(receipt.id, verifiedTransfer.rawPayload);
    }

    return {
      alreadyPaid: false,
      txHash: verifiedTransfer.txHash,
      verification: verifiedTransfer,
      order,
    };
  }

  async submitTelegramTopupTxHash(input: SubmitTelegramTxHashInput) {
    const normalizedTxHash = this.normalizeTxHash(input.txHash);
    const topup = await this.prisma.customerWalletTopup.findUnique({
      where: { externalOrderCode: input.externalOrderCode },
      include: {
        customer: true,
        shop: { include: { paymentConfig: true } },
      },
    });

    if (!topup || topup.shopId !== input.shopId) {
      throw new NotFoundException("Wallet topup not found.");
    }
    if (topup.customer?.telegramUserId !== input.telegramUserId) {
      throw new BadRequestException("This topup does not belong to your Telegram account.");
    }
    if (topup.provider !== PaymentProvider.USDT_TRC20 && topup.provider !== PaymentProvider.USDT_BEP20) {
      throw new BadRequestException("Only USDT TRC20/BEP20 topups accept tx hash confirmation.");
    }
    if (topup.status === PaymentTransactionStatus.PAID) {
      return { alreadyPaid: true, txHash: normalizedTxHash };
    }
    if (topup.status === PaymentTransactionStatus.CANCELED) {
      throw new BadRequestException("Lệnh nạp đã hết hạn. Vui lòng tạo lệnh nạp mới và thử lại.");
    }

    const [reusedTopup, reusedTx] = await Promise.all([
      this.prisma.customerWalletTopup.findFirst({
        where: { cryptoTxHash: normalizedTxHash, id: { not: topup.id } },
        select: { externalOrderCode: true },
      }),
      this.prisma.paymentTransaction.findFirst({
        where: { cryptoTxHash: normalizedTxHash },
        select: { externalOrderCode: true },
      }),
    ]);
    if (reusedTopup || reusedTx) {
      throw new BadRequestException("This tx hash has already been used.");
    }

    const manualCrypto = this.extractManualCryptoPayload(topup.rawPayloadJson);
    const isBep20 = topup.provider === PaymentProvider.USDT_BEP20;
    const receiverAddress = String(
      manualCrypto?.address || (isBep20
        ? topup.shop?.paymentConfig?.usdtBep20Address
        : topup.shop?.paymentConfig?.usdtTrc20Address) || "",
    ).trim();

    if (!receiverAddress) {
      throw new BadRequestException(`USDT ${isBep20 ? "BEP20" : "TRC20"} address is not configured.`);
    }

    const expectedAmount = Number(manualCrypto?.usdtAmount || 0);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      throw new BadRequestException("Expected USDT amount is missing for this topup.");
    }

    const verifiedTransfer = this.isMockTxHash(normalizedTxHash)
      ? this.buildMockVerifiedTransfer(normalizedTxHash, receiverAddress, expectedAmount)
      : isBep20
        ? await this.verifyUsdtBep20Transfer({
          txHash: normalizedTxHash,
          receiverAddress,
          expectedAmount,
          createdAt: topup.createdAt,
        })
        : await this.verifyUsdtTrc20Transfer({
          txHash: normalizedTxHash,
          receiverAddress,
          expectedAmount,
          createdAt: topup.createdAt,
        });

    const receipt = this.isMockTxHash(normalizedTxHash)
      ? null
      : await this.paymentService.claimOnchainPaymentReceipt({
          provider: topup.provider,
          txHash: verifiedTransfer.txHash,
          externalOrderCode: input.externalOrderCode,
          amountUsdt: verifiedTransfer.amountUsdt,
          destination: verifiedTransfer.toAddress,
          transactionAt: verifiedTransfer.confirmedAt!,
          tokenAddress: verifiedTransfer.tokenAddress,
          blockReference: verifiedTransfer.blockNumber,
          confirmations: verifiedTransfer.confirmations,
          rawPayload: verifiedTransfer.rawPayload,
        });

    await this.prisma.customerWalletTopup.update({
      where: { externalOrderCode: input.externalOrderCode },
      data: { cryptoTxHash: verifiedTransfer.txHash },
    });

    await this.customerWalletService.markTopupPaid(input.externalOrderCode, {
      source: isBep20 ? "bep20_tx_hash" : "trc20_tx_hash",
      txHash: verifiedTransfer.txHash,
      amountUsdt: verifiedTransfer.amountUsdt,
    });
    if (receipt) {
      await this.paymentService.markOnchainPaymentReceiptProcessed(receipt.id, verifiedTransfer.rawPayload);
    }

    return {
      alreadyPaid: false,
      txHash: verifiedTransfer.txHash,
      verification: verifiedTransfer,
    };
  }

  async verifyUsdtBep20Transfer(input: {
    txHash: string;
    receiverAddress: string;
    expectedAmount: number;
    createdAt: Date;
  }) {
    const { fetchBep20TxReceipt, normalizeBep20Address } = await import("@reseller/shared/server");
    const txHash = input.txHash.startsWith("0x") ? input.txHash : `0x${input.txHash}`;
    const receiver = normalizeBep20Address(input.receiverAddress);
    if (!receiver) throw new BadRequestException("Invalid configured BEP20 address.");
    const receipt = await fetchBep20TxReceipt({
      endpoints: this.config.bscRpcUrls,
      txHash,
      contractAddress: this.config.bscUsdtContractAddress,
      decimals: this.config.bscUsdtDecimals,
    });
    if (!receipt || receipt.status !== 1) throw new BadRequestException("BEP20 transaction is not confirmed or failed.");
    if (receipt.confirmations < this.config.bscMinConfirmations) throw new BadRequestException("Not enough BEP20 confirmations.");
    const minAllowedTime = input.createdAt.getTime() - 60 * 1000;
    if (receipt.blockTimestamp.getTime() < minAllowedTime) {
      throw new BadRequestException("This BEP20 transaction is from before the payment request was created.");
    }
    const transfer = receipt.transfers.find((row) => row.toAddress === receiver);
    if (!transfer) throw new BadRequestException("TX hash does not transfer USDT to the configured BEP20 address.");
    if (Math.abs(transfer.amountUsdt - input.expectedAmount) > this.config.usdtPaymentTolerance + 1e-9) {
      throw new BadRequestException("Transferred USDT amount does not match the invoice.");
    }
    return {
      network: "BEP20" as const, token: "USDT" as const, txHash,
      fromAddress: transfer.fromAddress, toAddress: transfer.toAddress,
      amountUsdt: transfer.amountUsdt, confirmedAt: receipt.blockTimestamp,
      blockNumber: transfer.blockNumber,
      confirmations: receipt.confirmations,
      tokenAddress: this.config.bscUsdtContractAddress,
      rawPayload: { source: "bsc_tx_receipt", confirmations: receipt.confirmations, tokenAddress: this.config.bscUsdtContractAddress },
    };
  }
  async verifyUsdtTrc20Transfer(input: {
    txHash: string;
    receiverAddress: string;
    expectedAmount: number;
    createdAt: Date;
  }): Promise<VerifiedTransfer> {
    // The exact-tx endpoint is much cheaper than listing up to 200 receiver
    // transfers, so prefer it to avoid exhausting TronGrid's public quota.
    const transferFromEvents = await this.findTransferFromTxEvents({
      txHash: input.txHash,
      receiverAddress: input.receiverAddress,
      expectedAmount: input.expectedAmount,
      createdAt: input.createdAt,
    });

    if (transferFromEvents) {
      return transferFromEvents;
    }

    const transferFromHistory = await this.findTransferFromReceiverHistory(input);

    if (transferFromHistory) {
      return transferFromHistory;
    }

    throw new BadRequestException("We could not find a confirmed USDT TRC20 transfer for this tx hash yet.");
  }

  private async findTransferFromReceiverHistory(input: {
    txHash: string;
    receiverAddress: string;
    expectedAmount: number;
    createdAt: Date;
  }) {
    const url = new URL(
      `/v1/accounts/${encodeURIComponent(input.receiverAddress)}/transactions/trc20`,
      this.config.tronGridApiBaseUrl,
    );
    url.searchParams.set("only_confirmed", "true");
    url.searchParams.set("only_to", "true");
    url.searchParams.set("limit", "200");
    url.searchParams.set("order_by", "block_timestamp,desc");
    url.searchParams.set("contract_address", this.config.tronUsdtContractAddress);
    url.searchParams.set(
      "min_timestamp",
      String(Math.max(0, input.createdAt.getTime() - 60 * 1000)),
    );

    const response = await this.fetchTronGridWithRetry(url);

    if (!response.ok) {
      this.logger.warn(
        `TronGrid receiver history lookup failed with status ${response.status} for ${input.txHash}`,
      );
      return null;
    }

    const payload = await response.json() as { data?: Trc20TransferRecord[] };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const match = rows.find((row) => this.extractTxHash(row) === input.txHash.toLowerCase());

    if (!match) {
      return null;
    }

    return this.mapVerifiedTransferFromHistory(match, input);
  }

  private async findTransferFromTxEvents(input: {
    txHash: string;
    receiverAddress: string;
    expectedAmount: number;
    createdAt: Date;
  }) {
    const url = new URL(
      `/v1/transactions/${encodeURIComponent(input.txHash)}/events`,
      this.config.tronGridApiBaseUrl,
    );
    url.searchParams.set("only_confirmed", "true");

    const response = await this.fetchTronGridWithRetry(url);

    if (!response.ok) {
      this.logger.warn(
        `TronGrid tx event lookup failed with status ${response.status} for ${input.txHash}`,
      );
      return null;
    }

    const payload = await response.json() as { data?: Trc20EventRecord[] };
    const rows = Array.isArray(payload.data) ? payload.data : [];

    const transferEvent = rows.find((row) => {
      const eventName = String(row.event_name || "").toLowerCase();
      const contractAddress = String(row.contract_address || "").trim();

      return (
        eventName === "transfer" &&
        contractAddress === this.config.tronUsdtContractAddress
      );
    });

    if (!transferEvent?.result) {
      return null;
    }

    const toAddress = this.normalizeTronAddress(transferEvent.result.to);
    const expectedReceiver = this.normalizeTronAddress(input.receiverAddress);
    const amountUsdt = this.parseUsdtAmount(transferEvent.result.value, 6, input.expectedAmount);
    const blockTimestamp = this.parseTimestamp(transferEvent.block_timestamp);

    if (!toAddress || !expectedReceiver || toAddress !== expectedReceiver) {
      throw new BadRequestException("The tx hash does not transfer USDT to the configured TRC20 address.");
    }

    if (Math.abs(amountUsdt - input.expectedAmount) > this.config.usdtPaymentTolerance + 1e-9) {
      throw new BadRequestException("The transferred USDT amount does not match this order.");
    }

    // Allow only minimal clock skew; older transactions must never satisfy a new invoice.
    const minAllowedTime = input.createdAt.getTime() - 60 * 1000;
    if (blockTimestamp && blockTimestamp.getTime() < minAllowedTime) {
      throw new BadRequestException("This tx hash is from before the order was created.");
    }
    // If we couldn't parse block_timestamp, reject for safety
    if (!blockTimestamp) {
      throw new BadRequestException("Could not verify timing of this TRC20 transfer.");
    }

    return {
      network: "TRC20" as const,
      token: "USDT" as const,
      txHash: input.txHash,
      fromAddress: this.normalizeTronAddress(transferEvent.result.from) || null,
      toAddress,
      amountUsdt,
      confirmedAt: blockTimestamp,
      blockNumber: this.parseNullableNumber(transferEvent.block_number),
      confirmations: null,
      tokenAddress: this.config.tronUsdtContractAddress,
      rawPayload: {
        source: "trongrid_tx_events",
        event: transferEvent,
      },
    };
  }

  private mapVerifiedTransferFromHistory(
    row: Trc20TransferRecord,
    input: {
      txHash: string;
      receiverAddress: string;
      expectedAmount: number;
      createdAt: Date;
    },
  ): VerifiedTransfer {
    const confirmed = this.isTruthyStatus(row.confirmed);
    const finalResult = String(row.final_result || row.contract_ret || "SUCCESS").toUpperCase();
    const toAddress = this.normalizeTronAddress(row.to);
    const expectedReceiver = this.normalizeTronAddress(input.receiverAddress);
    const contractAddress = String(row.token_info?.address || row.contract_address || "").trim();
    const decimals = this.parseNullableNumber(row.token_info?.decimals ?? row.decimals) ?? 6;
    const amountUsdt = this.parseUsdtAmount(row.value ?? row.amount, decimals, input.expectedAmount);

    if (!confirmed) {
      throw new BadRequestException("This TRC20 transaction is not confirmed yet.");
    }

    if (finalResult && !finalResult.includes("SUCCESS")) {
      throw new BadRequestException("This TRC20 transaction was not successful.");
    }

    if (contractAddress !== this.config.tronUsdtContractAddress) {
      throw new BadRequestException("The tx hash is not a USDT TRC20 transfer.");
    }

    if (!toAddress || !expectedReceiver || toAddress !== expectedReceiver) {
      throw new BadRequestException("The tx hash does not transfer USDT to the configured TRC20 address.");
    }

    if (Math.abs(amountUsdt - input.expectedAmount) > this.config.usdtPaymentTolerance + 1e-9) {
      throw new BadRequestException("The transferred USDT amount does not match this order.");
    }

    const confirmedAt = this.parseTimestamp(row.block_timestamp);
    if (!confirmedAt) {
      throw new BadRequestException("Could not verify timing of this TRC20 transfer.");
    }
    if (confirmedAt.getTime() < input.createdAt.getTime() - 60 * 1000) {
      throw new BadRequestException("This tx hash is from before the order was created.");
    }

    return {
      network: "TRC20",
      token: "USDT",
      txHash: input.txHash,
      fromAddress: this.normalizeTronAddress(row.from) || null,
      toAddress,
      amountUsdt,
      confirmedAt,
      blockNumber: this.parseNullableNumber(row.block),
      confirmations: null,
      tokenAddress: this.config.tronUsdtContractAddress,
      rawPayload: {
        source: "trongrid_receiver_history",
        transfer: row,
      },
    };
  }

  private buildMockVerifiedTransfer(
    txHash: string,
    receiverAddress: string,
    expectedAmount: number,
  ): VerifiedTransfer {
    return {
      network: "TRC20",
      token: "USDT",
      txHash,
      fromAddress: "TMockSender111111111111111111111111111",
      toAddress: receiverAddress,
      amountUsdt: expectedAmount,
      confirmedAt: new Date(),
      blockNumber: 99999999,
      confirmations: 999,
      tokenAddress: this.config.tronUsdtContractAddress,
      rawPayload: {
        source: "mock_trc20_tx_hash",
      },
    };
  }

  private buildTronGridHeaders() {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.config.tronGridApiKey) {
      headers["TRON-PRO-API-KEY"] = this.config.tronGridApiKey;
    }

    return headers;
  }

  private async fetchTronGridWithRetry(url: URL) {
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, {
        method: "GET",
        headers: this.buildTronGridHeaders(),
      });
      lastResponse = response;

      if (response.ok || (response.status !== 429 && response.status < 500)) {
        return response;
      }

      if (attempt < 2) {
        const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
        const waitMs = retryAfterSeconds > 0
          ? Math.min(5_000, retryAfterSeconds * 1_000)
          : 500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    return lastResponse!;
  }

  private normalizeTronAddress(value: unknown) {
    const raw = String(value || "").trim();
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw)) {
      return raw;
    }

    let hex = raw.replace(/^0x/i, "").toLowerCase();
    if (/^[a-f0-9]{40}$/.test(hex)) {
      hex = `41${hex}`;
    }
    if (!/^41[a-f0-9]{40}$/.test(hex)) {
      return "";
    }

    const payload = Buffer.from(hex, "hex");
    const firstHash = createHash("sha256").update(payload).digest();
    const checksum = createHash("sha256").update(firstHash).digest().subarray(0, 4);
    const bytes = Buffer.concat([payload, checksum]);
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let number = BigInt(`0x${bytes.toString("hex")}`);
    let encoded = "";
    while (number > 0n) {
      const remainder = Number(number % 58n);
      encoded = alphabet[remainder] + encoded;
      number /= 58n;
    }
    for (const byte of bytes) {
      if (byte !== 0) break;
      encoded = `1${encoded}`;
    }
    return encoded;
  }

  private extractManualCryptoPayload(rawPayload: Prisma.JsonValue | null): ManualCryptoPayload | null {
    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      return null;
    }

    const candidate = (rawPayload as Record<string, unknown>).manualCrypto;

    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }

    return candidate as ManualCryptoPayload;
  }

  private normalizeTxHash(value: string) {
    const trimmed = String(value || "").trim();

    if (!trimmed) {
      throw new BadRequestException("Please send a tx hash.");
    }

    if (this.isMockTxHash(trimmed)) {
      return trimmed;
    }

    const normalized = trimmed.replace(/^0x/i, "").toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(normalized)) {
      throw new BadRequestException("Invalid tx hash format.");
    }

    return normalized;
  }

  private isMockTxHash(value: string) {
    if (this.config.nodeEnv === "production") {
      return false;
    }

    return /^mock:/i.test(String(value || "").trim());
  }

  private extractTxHash(row: Trc20TransferRecord) {
    const rawHash = row.transaction_id ?? row.hash ?? row.transaction;
    return String(rawHash || "").trim().toLowerCase();
  }

  private parseUsdtAmount(rawValue: unknown, decimals: number, expectedAmount?: number) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return rawValue;
    }

    const value = String(rawValue ?? "").trim();

    if (!value) {
      throw new BadRequestException("Could not read the transferred USDT amount from this tx hash.");
    }

    if (value.includes(".")) {
      const parsed = Number(value);

      if (!Number.isFinite(parsed)) {
        throw new BadRequestException("Could not parse the transferred USDT amount.");
      }

      return parsed;
    }

    if (!/^\d+$/.test(value)) {
      throw new BadRequestException("Could not parse the transferred USDT amount.");
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      throw new BadRequestException("Could not parse the transferred USDT amount.");
    }

    const scaledValue = parsed / 10 ** decimals;

    if (Number.isFinite(expectedAmount) && (expectedAmount || 0) > 0) {
      const distanceToRaw = Math.abs(parsed - Number(expectedAmount));
      const distanceToScaled = Math.abs(scaledValue - Number(expectedAmount));
      return distanceToScaled <= distanceToRaw ? scaledValue : parsed;
    }

    return value.length >= decimals ? scaledValue : parsed;
  }

  private parseTimestamp(value: unknown) {
    const parsed = this.parseNullableNumber(value);

    if (!parsed || parsed <= 0) {
      return null;
    }

    return new Date(parsed);
  }

  private parseNullableNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isTruthyStatus(value: unknown) {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value === 1;
    }

    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "success";
  }
}
