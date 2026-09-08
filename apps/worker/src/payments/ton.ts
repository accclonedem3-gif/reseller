import axios from "axios";
import type Redis from "ioredis";
import { prisma } from "../infra/prisma";
import {
  TON_PAYMENT_SCAN_LOCK_KEY,
  TON_PAYMENT_SCAN_LOCK_TTL_MS,
} from "../config/env";
import { formatError } from "../format/text";
import {
  normalizeTonAddress,
  fetchTonUsdtTransfers,
  TON_USDT_MAINNET_MASTER,
} from "@reseller/shared/server";
import { getPaymentContext } from "./index";

let tonPaymentScanRunning = false;

export async function scanTonUsdtPayments(redis?: Redis | null): Promise<void> {
  if (tonPaymentScanRunning) return;
  tonPaymentScanRunning = true;
  let scanLockToken: string | null = null;
  const targetRedis = redis ?? getPaymentContext().redis;
  try {
    if (targetRedis) {
      const candidate = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      const acquired = await targetRedis.set(
        TON_PAYMENT_SCAN_LOCK_KEY,
        candidate,
        "PX",
        TON_PAYMENT_SCAN_LOCK_TTL_MS,
        "NX"
      );
      if (acquired !== "OK") return;
      scanLockToken = candidate;
    }
    const configs = await prisma.paymentConfig.findMany({
      where: { usdtTonAddress: { not: null } },
      select: { shopId: true, usdtTonAddress: true },
    });
    if (configs.length === 0) return;

    const sinceMs = Date.now() - 60 * 60 * 1000;
    const cutoff = new Date(sinceMs);
    const platformDepositShopId =
      process.env.PLATFORM_DEPOSIT_SHOP_ID || "platform-tier";
    const contexts: any[] = [];

    for (const cfg of configs) {
      const wallet = normalizeTonAddress(cfg.usdtTonAddress);
      if (!wallet) {
        console.error(`[worker] Ignoring invalid TON address for shop ${cfg.shopId}.`);
        continue;
      }
      const isPlatformShop = cfg.shopId === platformDepositShopId;
      const [pendingPayments, pendingTopups, pendingDeposits] = await Promise.all([
        prisma.paymentTransaction.findMany({
          where: {
            provider: "USDT_TON",
            status: "PENDING",
            createdAt: { gte: cutoff },
            order: { shopId: cfg.shopId },
          },
          select: {
            externalOrderCode: true,
            rawPayloadJson: true,
            createdAt: true,
          },
        }),
        prisma.customerWalletTopup.findMany({
          where: {
            provider: "USDT_TON",
            status: "PENDING",
            shopId: cfg.shopId,
            createdAt: { gte: cutoff },
          },
          select: {
            externalOrderCode: true,
            rawPayloadJson: true,
            createdAt: true,
          },
        }),
        isPlatformShop
          ? prisma.depositRequest.findMany({
              where: {
                provider: "USDT_TON",
                status: "PENDING",
                createdAt: { gte: cutoff },
              },
              select: {
                externalOrderCode: true,
                rawPayloadJson: true,
                createdAt: true,
              },
            })
          : Promise.resolve([]),
      ]);
      if (
        pendingPayments.length === 0 &&
        pendingTopups.length === 0 &&
        pendingDeposits.length === 0
      )
        continue;
      contexts.push({
        cfg,
        wallet,
        pendingPayments,
        pendingTopups,
        pendingDeposits,
      });
    }

    if (contexts.length === 0) return;
    await matchTonTransfersToPendingPayments(contexts, cutoff);
  } finally {
    if (targetRedis && scanLockToken) {
      const currentToken = await targetRedis
        .get(TON_PAYMENT_SCAN_LOCK_KEY)
        .catch(() => null);
      if (currentToken === scanLockToken) {
        await targetRedis.del(TON_PAYMENT_SCAN_LOCK_KEY).catch(() => undefined);
      }
    }
    tonPaymentScanRunning = false;
  }
}

export async function matchTonTransfersToPendingPayments(
  contexts: any[],
  since: Date
): Promise<void> {
  const ownerAddresses = Array.from(
    new Set(contexts.map((context) => context.wallet))
  );
  const transfers: any[] = [];
  for (let offset = 0; offset < ownerAddresses.length; offset += 1000) {
    const batch = ownerAddresses.slice(offset, offset + 1000);
    const rows = await fetchTonUsdtTransfers({
      ownerAddresses: batch,
      since,
      apiBaseUrl:
        process.env.TONCENTER_API_BASE_URL || "https://toncenter.com/api/v3",
      apiKey: process.env.TONCENTER_API_KEY || "",
      jettonMasterAddress:
        process.env.TON_USDT_MASTER_ADDRESS || TON_USDT_MAINNET_MASTER,
      decimals: Number(process.env.TON_USDT_DECIMALS || 6),
      limit: 1000,
    });
    transfers.push(...rows);
  }

  const transfersByDestination = new Map<string, any[]>();
  for (const transfer of transfers) {
    const rows = transfersByDestination.get(transfer.destinationAddress) || [];
    rows.push(transfer);
    transfersByDestination.set(transfer.destinationAddress, rows);
  }

  for (const context of contexts) {
    const pendingByAmount = buildTonPendingAmountMap(context);
    const walletTransfers = transfersByDestination.get(context.wallet) || [];
    for (const transfer of walletTransfers) {
      const amountKey = Number(transfer.amountUsdt.toFixed(2));
      const match = pendingByAmount.get(amountKey);
      if (!match) continue;
      const expectedAmount = Number(
        match.record.rawPayloadJson?.manualCrypto?.usdtAmount || 0
      );
      if (
        !Number.isFinite(expectedAmount) ||
        Math.abs(transfer.amountUsdt - expectedAmount) > 0.000001
      )
        continue;

      // Never match an old transfer to an invoice created later. A 60-second allowance covers
      // small clock differences between the application host and the indexed block timestamp.
      if (
        transfer.transactionAt.getTime() <
        match.record.createdAt.getTime() - 60_000
      )
        continue;

      const existingReceipt = await prisma.onchainPaymentReceipt.findUnique({
        where: {
          provider_txHash: {
            provider: "USDT_TON",
            txHash: transfer.txHash,
          },
        },
      });
      if (existingReceipt?.processedAt) continue;
      if (
        existingReceipt &&
        existingReceipt.externalOrderCode !== match.record.externalOrderCode
      )
        continue;

      const confirmed = await confirmTonPayment(match, transfer).catch(
        (error) => {
          console.error(
            `[worker] TON auto-confirm ${match.type} failed:`,
            formatError(error)
          );
          return false;
        }
      );
      if (!confirmed) continue;

      pendingByAmount.delete(amountKey);
      console.log(
        `[worker] TON auto-detected ${match.type} ${
          match.record.externalOrderCode
        } -> PAID (${transfer.amountUsdt} USDT, tx ${transfer.txHash.slice(
          0,
          16
        )}...)`
      );
      if (pendingByAmount.size === 0) break;
    }
  }
}

export function buildTonPendingAmountMap(
  context: any
): Map<number, { type: string; record: any }> {
  const result = new Map<number, { type: string; record: any }>();
  const addRecords = (type: string, records: any[]) => {
    for (const record of records) {
      const amount = Number(
        record.rawPayloadJson?.manualCrypto?.usdtAmount || 0
      );
      const key = Number(amount.toFixed(2));
      if (amount > 0 && !result.has(key)) result.set(key, { type, record });
    }
  };
  addRecords("order", context.pendingPayments);
  addRecords("deposit", context.pendingDeposits);
  addRecords("topup", context.pendingTopups);
  return result;
}

export async function confirmTonPayment(
  match: { type: string; record: any },
  transfer: any
): Promise<boolean> {
  const baseUrl = (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  const response = await axios.post(
    `${baseUrl}/api/v1/webhooks/internal-crypto-confirm/${encodeURIComponent(
      match.record.externalOrderCode
    )}`,
    {
      provider: "USDT_TON",
      txHash: transfer.txHash,
      amountUsdt: transfer.amountUsdt,
      destination: transfer.destinationAddress,
      transactionAt: transfer.transactionAt.toISOString(),
      source: "ton_usdt_auto_scan",
      chainPayload: {
        traceId: transfer.traceId,
        transactionLt: transfer.transactionLt,
        amountUnits: transfer.amountUnits,
        jettonMasterAddress: transfer.jettonMasterAddress,
        sourceAddress: transfer.sourceAddress,
      },
    },
    {
      headers: {
        "x-internal-token": process.env.INTERNAL_API_TOKEN || "",
        "Content-Type": "application/json",
      },
      timeout: 20_000,
    }
  );
  return response.data?.reconciled === true;
}
