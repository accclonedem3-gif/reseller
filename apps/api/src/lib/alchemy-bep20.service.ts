import { Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PaymentProvider, PaymentTransactionStatus } from "@prisma/client";
import axios from "axios";
import {
  fetchBep20TxReceipt,
  isValidBep20Address,
  normalizeBep20Address,
} from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { verifyAlchemyWebhookSignature } from "./alchemy-bep20.utils";

export type AlchemyAddressActivity = {
  hash?: string;
  toAddress?: string;
  value?: number;
  category?: string;
  rawContract?: { address?: string; decimals?: number; rawValue?: string };
  log?: { removed?: boolean; transactionHash?: string; address?: string };
};

@Injectable()
export class AlchemyBep20Service implements OnApplicationBootstrap {
  private readonly logger = new Logger(AlchemyBep20Service.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  isConfigured() {
    return this.config.alchemyBep20WebhookEnabled;
  }

  async onApplicationBootstrap() {
    if (!this.config.alchemyNotifyAuthToken || !this.config.alchemyBep20WebhookId) return;
    try {
      const result = await this.syncAddressChange(null);
      this.logger.log(`Alchemy BEP20 startup sync completed: tracked=${result.added}`);
    } catch (error) {
      // Do not block API startup: the BSC scanner remains available and the next shop config
      // save retries the idempotent address sync.
      this.logger.error(
        `Alchemy BEP20 startup sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    return verifyAlchemyWebhookSignature(
      rawBody,
      signature,
      this.config.alchemyBep20SigningKey,
    );
  }

  async syncAddressChange(previousAddress?: string | null) {
    const authToken = this.config.alchemyNotifyAuthToken;
    const webhookId = this.config.alchemyBep20WebhookId;
    if (!authToken || !webhookId) return { configured: false, added: 0, removed: 0 };

    const configs = await this.prisma.paymentConfig.findMany({
      where: { usdtBep20Enabled: true, usdtBep20Address: { not: null } },
      select: { usdtBep20Address: true },
    });
    const activeAddresses = new Set(
      configs
        .map((row) => normalizeBep20Address(row.usdtBep20Address))
        .filter((value): value is string => Boolean(value)),
    );
    const previous = normalizeBep20Address(previousAddress);
    const addressesToRemove = previous && !activeAddresses.has(previous) ? [previous] : [];

    // PATCH is idempotent. Re-adding the complete active set also heals any address that was
    // removed manually from Alchemy without requiring seller interaction.
    const addressesToAdd = [...activeAddresses];
    for (let offset = 0; offset < Math.max(addressesToAdd.length, addressesToRemove.length, 1); offset += 500) {
      const add = addressesToAdd.slice(offset, offset + 500);
      const remove = addressesToRemove.slice(offset, offset + 500);
      if (add.length === 0 && remove.length === 0) continue;
      await axios.patch(
        "https://dashboard.alchemy.com/api/update-webhook-addresses",
        {
          webhook_id: webhookId,
          addresses_to_add: add,
          addresses_to_remove: remove,
        },
        {
          headers: { "Content-Type": "application/json", "X-Alchemy-Token": authToken },
          timeout: 15_000,
        },
      );
    }
    return { configured: true, added: addressesToAdd.length, removed: addressesToRemove.length };
  }

  async resolveConfirmedTransfer(activity: AlchemyAddressActivity) {
    if (activity.log?.removed) return { status: "ignored" as const, reason: "removed_log" };
    const txHash = String(activity.hash || activity.log?.transactionHash || "").trim().toLowerCase();
    const destination = normalizeBep20Address(activity.toAddress);
    const contract = normalizeBep20Address(activity.rawContract?.address || activity.log?.address);
    if (!/^0x[a-f0-9]{64}$/.test(txHash) || !destination || !contract) {
      return { status: "ignored" as const, reason: "invalid_activity" };
    }
    if (contract !== this.config.bscUsdtContractAddress.toLowerCase()) {
      return { status: "ignored" as const, reason: "wrong_contract" };
    }

    const receipt = await fetchBep20TxReceipt({
      endpoints: this.config.bscRpcUrls,
      txHash,
      contractAddress: this.config.bscUsdtContractAddress,
      decimals: this.config.bscUsdtDecimals,
    });
    if (!receipt || receipt.status !== 1) return { status: "ignored" as const, reason: "unconfirmed_tx" };
    if (receipt.confirmations < this.config.bscMinConfirmations) {
      return { status: "pending" as const, reason: "not_enough_confirmations", confirmations: receipt.confirmations };
    }
    const transfer = receipt.transfers.find((row) => row.toAddress === destination);
    if (!transfer) return { status: "ignored" as const, reason: "transfer_not_found" };

    const [usedOrder, usedTopup] = await Promise.all([
      this.prisma.paymentTransaction.findFirst({ where: { cryptoTxHash: txHash }, select: { externalOrderCode: true } }),
      this.prisma.customerWalletTopup.findFirst({ where: { cryptoTxHash: txHash }, select: { externalOrderCode: true } }),
    ]);
    if (usedOrder || usedTopup) {
      return { status: "duplicate" as const, txHash, externalOrderCode: usedOrder?.externalOrderCode || usedTopup?.externalOrderCode };
    }

    const configs = await this.prisma.paymentConfig.findMany({
      where: { usdtBep20Enabled: true, usdtBep20Address: { not: null } },
      select: { shopId: true, usdtBep20Address: true },
    });
    const shopIds = configs
      .filter((row) => normalizeBep20Address(row.usdtBep20Address) === destination)
      .map((row) => row.shopId);
    if (shopIds.length === 0) return { status: "ignored" as const, reason: "unknown_destination" };

    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const includePlatformDeposits = Boolean(
      process.env.PLATFORM_DEPOSIT_SHOP_ID
      && shopIds.includes(process.env.PLATFORM_DEPOSIT_SHOP_ID),
    );
    const [orders, topups, deposits] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: {
          provider: PaymentProvider.USDT_BEP20,
          status: PaymentTransactionStatus.PENDING,
          createdAt: { gte: cutoff },
          order: { shopId: { in: shopIds } },
        },
        select: { externalOrderCode: true, rawPayloadJson: true, createdAt: true },
      }),
      this.prisma.customerWalletTopup.findMany({
        where: {
          provider: PaymentProvider.USDT_BEP20,
          status: PaymentTransactionStatus.PENDING,
          createdAt: { gte: cutoff },
          shopId: { in: shopIds },
        },
        select: { externalOrderCode: true, rawPayloadJson: true, createdAt: true },
      }),
      includePlatformDeposits
        ? this.prisma.depositRequest.findMany({
          where: {
            provider: PaymentProvider.USDT_BEP20,
            status: "PENDING",
            createdAt: { gte: cutoff },
          },
          select: { externalOrderCode: true, rawPayloadJson: true, createdAt: true },
        })
        : Promise.resolve([]),
    ]);
    const candidates = [...orders, ...topups, ...deposits].filter((row) => {
      const expected = Number((row.rawPayloadJson as any)?.manualCrypto?.usdtAmount || 0);
      return expected > 0
        && receipt.blockTimestamp.getTime() >= row.createdAt.getTime() - 60_000
        && transfer.amountUsdt + this.config.usdtPaymentTolerance >= expected
        && transfer.amountUsdt <= expected + this.config.usdtPaymentTolerance;
    });
    if (candidates.length !== 1) {
      this.logger.warn(`BEP20 webhook match candidates=${candidates.length} tx=${txHash} amount=${transfer.amountUsdt} destination=${destination}`);
      return { status: "ambiguous" as const, reason: candidates.length === 0 ? "invoice_not_found" : "multiple_invoices" };
    }
    return {
      status: "matched" as const,
      externalOrderCode: candidates[0]!.externalOrderCode!,
      txHash,
      amountUsdt: transfer.amountUsdt,
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
      blockNumber: transfer.blockNumber,
      blockTimestamp: receipt.blockTimestamp,
      confirmations: receipt.confirmations,
    };
  }
}
