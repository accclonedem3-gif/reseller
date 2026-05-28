import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PaymentProvider, PaymentTransactionStatus } from "@prisma/client";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { CustomerWalletService } from "../customer-wallet/customer-wallet.service";

type SubmitTelegramSolTxInput = {
  shopId: string;
  telegramUserId: string;
  externalOrderCode: string;
  signature: string;
};

type VerifiedSolanaTransfer = {
  signature: string;
  fromOwner: string | null;
  toOwner: string;
  amountUsdt: number;
  confirmedAt: Date | null;
  slot: number | null;
  rawPayload: Record<string, unknown>;
};

type SolanaParsedTokenTransfer = {
  source?: string;
  destination?: string;
  authority?: string;
  mint?: string;
  tokenAmount?: { amount?: string; decimals?: number; uiAmount?: number };
  // tokenTransferChecked variant
  amount?: string;
};

@Injectable()
export class SolanaPaymentService {
  private readonly logger = new Logger(SolanaPaymentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(CustomerWalletService) private readonly customerWalletService: CustomerWalletService,
  ) {}

  normalizeSignature(raw: string) {
    return String(raw || "").trim();
  }

  isValidSignatureFormat(signature: string) {
    // Solana signatures are base58 strings ~87-88 chars
    return /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature);
  }

  async submitTelegramSolTxHash(input: SubmitTelegramSolTxInput) {
    const signature = this.normalizeSignature(input.signature);

    const paymentTransaction = await this.prisma.paymentTransaction.findUnique({
      where: { externalOrderCode: input.externalOrderCode },
      include: {
        order: {
          include: {
            customer: true,
            shop: { include: { paymentConfig: true } },
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
    if (paymentTransaction.provider !== PaymentProvider.USDT_SOL) {
      throw new BadRequestException("Only USDT Solana payments accept this confirmation.");
    }

    if (paymentTransaction.status === PaymentTransactionStatus.PAID) {
      if (
        paymentTransaction.cryptoTxHash &&
        paymentTransaction.cryptoTxHash.toLowerCase() !== signature.toLowerCase()
      ) {
        throw new BadRequestException("This order has already been confirmed with a different signature.");
      }
      return {
        alreadyPaid: true,
        txHash: paymentTransaction.cryptoTxHash || signature,
        order: await this.ordersService.markPaymentCompleted(input.externalOrderCode),
      };
    }

    const [reusedTx, reusedTopup] = await Promise.all([
      this.prisma.paymentTransaction.findFirst({
        where: { cryptoTxHash: signature, id: { not: paymentTransaction.id } },
        select: { externalOrderCode: true },
      }),
      this.prisma.customerWalletTopup.findFirst({
        where: { cryptoTxHash: signature },
        select: { externalOrderCode: true },
      }),
    ]);
    if (reusedTx || reusedTopup) {
      throw new BadRequestException("This signature has already been used.");
    }

    const manualCrypto = this.extractManualCryptoPayload(paymentTransaction.rawPayloadJson);
    const receiverAddress = String(
      manualCrypto?.address || paymentTransaction.order.shop.paymentConfig?.usdtSolanaAddress || "",
    ).trim();

    if (!receiverAddress) {
      throw new BadRequestException("USDT Solana address is not configured.");
    }

    const expectedAmount = Number(manualCrypto?.usdtAmount || 0);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      throw new BadRequestException("Expected USDT amount is missing for this order.");
    }

    const verified = await this.verifyUsdtSolTransfer({
      signature,
      receiverAddress,
      expectedAmount,
      createdAt: paymentTransaction.createdAt,
    });

    const order = await this.ordersService.markPaymentCompleted(
      input.externalOrderCode,
      {
        source: "solana_signature",
        externalOrderCode: input.externalOrderCode,
        signature: verified.signature,
        amountUsdt: verified.amountUsdt,
        expectedAmountUsdt: expectedAmount,
        toleranceUsdt: this.config.usdtPaymentTolerance,
        fromOwner: verified.fromOwner,
        toOwner: verified.toOwner,
        confirmedAt: verified.confirmedAt?.toISOString() || null,
        slot: verified.slot,
        verification: verified.rawPayload,
      },
      { cryptoTxHash: verified.signature },
    );

    return { alreadyPaid: false, txHash: verified.signature, verification: verified, order };
  }

  async submitTelegramSolTopupTxHash(input: SubmitTelegramSolTxInput) {
    const signature = this.normalizeSignature(input.signature);
    const topup = await this.prisma.customerWalletTopup.findUnique({
      where: { externalOrderCode: input.externalOrderCode },
      include: { customer: true, shop: { include: { paymentConfig: true } } },
    });

    if (!topup || topup.shopId !== input.shopId) {
      throw new NotFoundException("Wallet topup not found.");
    }
    if (topup.customer?.telegramUserId !== input.telegramUserId) {
      throw new BadRequestException("This topup does not belong to your Telegram account.");
    }
    if (topup.provider !== PaymentProvider.USDT_SOL) {
      throw new BadRequestException("Only USDT Solana topups accept this confirmation.");
    }
    if (topup.status === PaymentTransactionStatus.PAID) {
      return { alreadyPaid: true, txHash: signature };
    }
    if (topup.status === PaymentTransactionStatus.CANCELED) {
      throw new BadRequestException("Lệnh nạp đã hết hạn. Vui lòng tạo lệnh nạp mới và thử lại.");
    }

    const [reusedTopup, reusedTx] = await Promise.all([
      this.prisma.customerWalletTopup.findFirst({
        where: { cryptoTxHash: signature, id: { not: topup.id } },
        select: { externalOrderCode: true },
      }),
      this.prisma.paymentTransaction.findFirst({
        where: { cryptoTxHash: signature },
        select: { externalOrderCode: true },
      }),
    ]);
    if (reusedTopup || reusedTx) {
      throw new BadRequestException("This signature has already been used.");
    }

    const manualCrypto = this.extractManualCryptoPayload(topup.rawPayloadJson);
    const receiverAddress = String(
      manualCrypto?.address || topup.shop?.paymentConfig?.usdtSolanaAddress || "",
    ).trim();

    if (!receiverAddress) {
      throw new BadRequestException("USDT Solana address is not configured.");
    }

    const expectedAmount = Number(manualCrypto?.usdtAmount || 0);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      throw new BadRequestException("Expected USDT amount is missing for this topup.");
    }

    const verified = await this.verifyUsdtSolTransfer({
      signature,
      receiverAddress,
      expectedAmount,
      createdAt: topup.createdAt,
    });

    await this.prisma.customerWalletTopup.update({
      where: { externalOrderCode: input.externalOrderCode },
      data: { cryptoTxHash: verified.signature },
    });

    await this.customerWalletService.markTopupPaid(input.externalOrderCode, {
      source: "solana_signature",
      txHash: verified.signature,
      amountUsdt: verified.amountUsdt,
    });

    return { alreadyPaid: false, txHash: verified.signature, verification: verified };
  }

  async verifyUsdtSolTransfer(input: {
    signature: string;
    receiverAddress: string;
    expectedAmount: number;
    createdAt: Date;
  }): Promise<VerifiedSolanaTransfer> {
    const response = await fetch(this.config.solanaRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          input.signature,
          { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ],
      }),
    });

    if (!response.ok) {
      this.logger.warn(`Solana RPC getTransaction failed status=${response.status} sig=${input.signature}`);
      throw new BadRequestException("Could not verify Solana transaction. Try again in a minute.");
    }

    const json = (await response.json()) as { result?: any; error?: { message?: string } };
    if (json.error) {
      this.logger.warn(`Solana RPC error: ${json.error.message}`);
      throw new BadRequestException("Could not verify Solana transaction.");
    }
    if (!json.result) {
      throw new BadRequestException("Transaction not found or not confirmed yet.");
    }

    const tx = json.result;
    const meta = tx.meta;
    if (!meta || meta.err) {
      throw new BadRequestException("This Solana transaction failed on-chain.");
    }

    const blockTime: number | null = tx.blockTime ?? null;
    const slot: number | null = tx.slot ?? null;
    const confirmedAt = blockTime ? new Date(blockTime * 1000) : null;

    // Time window check
    const minAllowedTime = input.createdAt.getTime() - 5 * 60 * 1000;
    if (!confirmedAt || confirmedAt.getTime() < minAllowedTime) {
      throw new BadRequestException("This signature is from before the order was created.");
    }

    // Find SPL token transfer instruction matching our USDT mint + destination
    const instructions: any[] = tx.transaction?.message?.instructions ?? [];
    const innerInstructions: any[] = (meta.innerInstructions ?? []).flatMap((i: any) => i.instructions ?? []);
    const allInstructions = [...instructions, ...innerInstructions];

    const usdtMint = this.config.solanaUsdtMintAddress;
    let bestMatch: { parsed: SolanaParsedTokenTransfer; amountUsdt: number; toOwner: string } | null = null;

    for (const inst of allInstructions) {
      if (inst.program !== "spl-token" || !inst.parsed) continue;
      const type = inst.parsed.type;
      if (type !== "transfer" && type !== "transferChecked") continue;
      const info: SolanaParsedTokenTransfer = inst.parsed.info;

      // For transferChecked: mint is included directly
      const mint = info.mint || (await this.resolveMintForAccount(info.destination));
      if (!mint || mint !== usdtMint) continue;

      // Resolve owner of destination token account
      const toOwner = await this.resolveOwnerForAccount(info.destination || "", meta);
      if (toOwner !== input.receiverAddress) continue;

      const decimals = info.tokenAmount?.decimals ?? 6;
      const rawAmount = info.amount ?? info.tokenAmount?.amount ?? "0";
      const amountUsdt = Number(rawAmount) / Math.pow(10, decimals);

      if (!bestMatch || amountUsdt > bestMatch.amountUsdt) {
        bestMatch = {
          parsed: info,
          amountUsdt,
          toOwner,
        };
      }
    }

    if (!bestMatch) {
      throw new BadRequestException("This signature does not transfer USDT to the configured Solana address.");
    }

    if (bestMatch.amountUsdt + this.config.usdtPaymentTolerance < input.expectedAmount) {
      throw new BadRequestException("The transferred USDT amount is lower than required for this order.");
    }

    const fromOwner = bestMatch.parsed.authority || bestMatch.parsed.source || null;

    return {
      signature: input.signature,
      fromOwner,
      toOwner: bestMatch.toOwner,
      amountUsdt: bestMatch.amountUsdt,
      confirmedAt,
      slot,
      rawPayload: {
        source: "solana_rpc_get_transaction",
        slot,
        blockTime,
      },
    };
  }

  /**
   * Auto-detect: scan recent USDT transfers to a wallet address.
   * Returns transfers in the time window.
   */
  async scanRecentUsdtTransfers(walletAddress: string, sinceMs: number): Promise<VerifiedSolanaTransfer[]> {
    // Step 1: get USDT token account (ATA) of this wallet via getTokenAccountsByOwner
    const tokenAccounts = await this.getUsdtTokenAccounts(walletAddress);
    if (tokenAccounts.length === 0) {
      return [];
    }

    const transfers: VerifiedSolanaTransfer[] = [];
    for (const ata of tokenAccounts) {
      const signatures = await this.getSignaturesForAccount(ata);
      for (const sig of signatures) {
        if (sig.blockTime && sig.blockTime * 1000 < sinceMs) continue;
        try {
          const verified = await this.verifyUsdtSolTransfer({
            signature: sig.signature,
            receiverAddress: walletAddress,
            expectedAmount: 0, // skip expected amount check in scan
            createdAt: new Date(sinceMs),
          });
          transfers.push(verified);
        } catch {
          // ignore non-matching tx
        }
      }
    }
    return transfers;
  }

  private async getUsdtTokenAccounts(walletAddress: string): Promise<string[]> {
    const response = await fetch(this.config.solanaRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          walletAddress,
          { mint: this.config.solanaUsdtMintAddress },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ],
      }),
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { result?: { value?: Array<{ pubkey: string }> } };
    return (json.result?.value || []).map((a) => a.pubkey);
  }

  private async getSignaturesForAccount(
    accountAddress: string,
    limit = 50,
  ): Promise<Array<{ signature: string; blockTime: number | null }>> {
    const response = await fetch(this.config.solanaRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [accountAddress, { limit, commitment: "confirmed" }],
      }),
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { result?: Array<{ signature: string; blockTime: number | null; err: unknown }> };
    return (json.result || []).filter((s) => !s.err).map((s) => ({ signature: s.signature, blockTime: s.blockTime }));
  }

  private async resolveMintForAccount(_account?: string): Promise<string | null> {
    // For plain "transfer" (not transferChecked), mint isn't included. Would need extra RPC.
    // For now we rely on transferChecked which provides mint directly.
    return null;
  }

  private async resolveOwnerForAccount(tokenAccount: string, meta: any): Promise<string> {
    // Try to resolve from post-balance entries (these include account owner info)
    const postBalances: any[] = meta?.postTokenBalances ?? [];
    for (const b of postBalances) {
      if (b.accountIndex !== undefined && b.owner && tokenAccount) {
        // Cannot trivially map without account keys; try matching mint
        if (b.mint === this.config.solanaUsdtMintAddress) {
          return String(b.owner);
        }
      }
    }
    // Fallback: query token account info
    try {
      const response = await fetch(this.config.solanaRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAccountInfo",
          params: [tokenAccount, { encoding: "jsonParsed", commitment: "confirmed" }],
        }),
      });
      const json = (await response.json()) as { result?: { value?: { data?: { parsed?: { info?: { owner?: string } } } } } };
      return String(json.result?.value?.data?.parsed?.info?.owner || "");
    } catch {
      return "";
    }
  }

  private extractManualCryptoPayload(
    raw: unknown,
  ): { address?: string; usdtAmount?: number } | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const manualCrypto = obj.manualCrypto;
    if (!manualCrypto || typeof manualCrypto !== "object" || Array.isArray(manualCrypto)) return null;
    return manualCrypto as { address?: string; usdtAmount?: number };
  }
}
