import axios from "axios";
import type Redis from "ioredis";
import { prisma } from "../infra/prisma";
import { formatError } from "../format/text";
import { getPaymentContext } from "./index";
import {
  BEP20_PAYMENT_SCAN_INTERVAL_MS,
  BEP20_PAYMENT_SCAN_LOCK_KEY,
  BEP20_PAYMENT_SCAN_LOCK_TTL_MS,
} from "../config/env";
import {
  DEFAULT_BSC_RPC_ENDPOINTS,
  BSC_USDT_MAINNET_CONTRACT,
  BSC_USDT_DECIMALS,
  getBscLatestBlockNumber,
  fetchBep20UsdtTransfers,
  normalizeBep20Address,
  type Bep20UsdtTransfer,
} from "@reseller/shared/server";

let bep20PaymentScanRunning = false;

export function getBscRpcEndpoints(): string[] {
  const envUrls = process.env.BSC_RPC_URLS;
  if (envUrls) {
    const list = envUrls
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  return DEFAULT_BSC_RPC_ENDPOINTS;
}

export function getBscUsdtContract(): string {
  return (
    process.env.BSC_USDT_CONTRACT_ADDRESS || BSC_USDT_MAINNET_CONTRACT
  ).toLowerCase();
}

export function getBscUsdtDecimals(): number {
  return Number(process.env.BSC_USDT_DECIMALS || BSC_USDT_DECIMALS);
}

type PendingCryptoMatch = {
  type: "order" | "topup" | "deposit";
  record: any;
  expectedAmount: number;
};

export async function scanBep20UsdtPayments(
  redis?: Redis | null
): Promise<void> {
  if (bep20PaymentScanRunning) return;
  bep20PaymentScanRunning = true;
  let scanLockToken: string | null = null;
  const targetRedis = redis ?? getPaymentContext().redis;

  try {
    if (targetRedis) {
      const candidate = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      const acquired = await targetRedis.set(
        BEP20_PAYMENT_SCAN_LOCK_KEY,
        candidate,
        "PX",
        BEP20_PAYMENT_SCAN_LOCK_TTL_MS,
        "NX"
      );
      if (acquired !== "OK") return;
      scanLockToken = candidate;
    }

    const configs = await prisma.paymentConfig.findMany({
      where: { usdtBep20Address: { not: null } },
      select: { shopId: true, usdtBep20Address: true, usdtBep20Enabled: true },
    });
    if (configs.length === 0) return;

    const shopToWallet = new Map<string, string>();
    for (const cfg of configs) {
      const addr = normalizeBep20Address(cfg.usdtBep20Address);
      if (addr) {
        shopToWallet.set(cfg.shopId, addr);
      }
    }
    if (shopToWallet.size === 0) return;

    const sinceMs = Date.now() - 60 * 60 * 1000;
    const cutoff = new Date(sinceMs);
    const platformDepositShopId =
      process.env.PLATFORM_DEPOSIT_SHOP_ID || "platform-tier";
    const platformWallet = shopToWallet.get(platformDepositShopId) || null;

    // Fetch pending transactions for USDT_BEP20 across orders, topups, and deposits
    const [pendingOrders, pendingTopups, pendingDeposits] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where: {
          provider: "USDT_BEP20",
          status: "PENDING",
          createdAt: { gte: cutoff },
        },
        select: {
          id: true,
          externalOrderCode: true,
          rawPayloadJson: true,
          createdAt: true,
          order: { select: { shopId: true } },
        },
      }),
      prisma.customerWalletTopup.findMany({
        where: {
          provider: "USDT_BEP20",
          status: "PENDING",
          createdAt: { gte: cutoff },
        },
        select: {
          id: true,
          externalOrderCode: true,
          rawPayloadJson: true,
          createdAt: true,
          shopId: true,
        },
      }),
      prisma.depositRequest.findMany({
        where: {
          provider: "USDT_BEP20",
          status: "PENDING",
          createdAt: { gte: cutoff },
        },
        select: {
          id: true,
          externalOrderCode: true,
          rawPayloadJson: true,
          createdAt: true,
        },
      }),
    ]);

    if (
      pendingOrders.length === 0 &&
      pendingTopups.length === 0 &&
      pendingDeposits.length === 0
    ) {
      return;
    }

    const pendingByWallet = new Map<string, Map<number, PendingCryptoMatch>>();

    const getWalletMap = (wallet: string) => {
      let map = pendingByWallet.get(wallet);
      if (!map) {
        map = new Map<number, PendingCryptoMatch>();
        pendingByWallet.set(wallet, map);
      }
      return map;
    };

    let oldestCreatedAt = Date.now();

    for (const order of pendingOrders) {
      const explicitDest = normalizeBep20Address(
        (order.rawPayloadJson as any)?.manualCrypto?.address
      );
      const wallet = explicitDest || shopToWallet.get(order.order.shopId);
      if (!wallet) continue;

      const amt = Number(
        (order.rawPayloadJson as any)?.manualCrypto?.usdtAmount || 0
      );
      if (amt <= 0) continue;
      const key = Number(amt.toFixed(2));
      const map = getWalletMap(wallet);
      if (!map.has(key)) {
        map.set(key, { type: "order", record: order, expectedAmount: amt });
        if (order.createdAt.getTime() < oldestCreatedAt) {
          oldestCreatedAt = order.createdAt.getTime();
        }
      }
    }

    for (const topup of pendingTopups) {
      const explicitDest = normalizeBep20Address(
        (topup.rawPayloadJson as any)?.manualCrypto?.address
      );
      const wallet = explicitDest || shopToWallet.get(topup.shopId);
      if (!wallet) continue;

      const amt = Number(
        (topup.rawPayloadJson as any)?.manualCrypto?.usdtAmount || 0
      );
      if (amt <= 0) continue;
      const key = Number(amt.toFixed(2));
      const map = getWalletMap(wallet);
      if (!map.has(key)) {
        map.set(key, { type: "topup", record: topup, expectedAmount: amt });
        if (topup.createdAt.getTime() < oldestCreatedAt) {
          oldestCreatedAt = topup.createdAt.getTime();
        }
      }
    }

    for (const deposit of pendingDeposits) {
      const explicitDest = normalizeBep20Address(
        (deposit.rawPayloadJson as any)?.manualCrypto?.address
      );
      const wallet = explicitDest || platformWallet;
      if (!wallet) continue;

      const amt = Number(
        (deposit.rawPayloadJson as any)?.manualCrypto?.usdtAmount || 0
      );
      if (amt <= 0) continue;
      const key = Number(amt.toFixed(2));
      const map = getWalletMap(wallet);
      if (!map.has(key)) {
        map.set(key, { type: "deposit", record: deposit, expectedAmount: amt });
        if (deposit.createdAt.getTime() < oldestCreatedAt) {
          oldestCreatedAt = deposit.createdAt.getTime();
        }
      }
    }

    const activeWallets = Array.from(pendingByWallet.keys());
    if (activeWallets.length === 0) return;

    const endpoints = getBscRpcEndpoints();
    let latestBlock: number;
    try {
      latestBlock = await getBscLatestBlockNumber({ endpoints });
    } catch (err) {
      console.error(
        "[worker] Failed to fetch latest BSC block number:",
        formatError(err)
      );
      return;
    }

    // BSC block time is currently ~0.45s (450ms). Add buffer blocks.
    const blocksSinceOldest =
      Math.ceil((Date.now() - oldestCreatedAt) / 450) + 120;
    // Cap at 4800 blocks (under the 5000 block RPC eth_getLogs limit, covers ~36 mins)
    const scanBlockRange = Math.min(4800, Math.max(50, blocksSinceOldest));
    const fromBlock = Math.max(
      0,
      latestBlock - scanBlockRange
    );
    const toBlock = latestBlock;

    let transfers: Bep20UsdtTransfer[] = [];
    try {
      transfers = await fetchBep20UsdtTransfers({
        endpoints,
        fromBlock,
        toBlock,
        ownerAddresses: activeWallets,
        contractAddress: getBscUsdtContract(),
        decimals: getBscUsdtDecimals(),
      });
    } catch (err) {
      console.error(
        "[worker] Failed to fetch BSC USDT transfers:",
        formatError(err)
      );
      return;
    }

    if (transfers.length === 0) return;

    for (const transfer of transfers) {
      const destination = normalizeBep20Address(transfer.toAddress);
      if (!destination) continue;

      const walletMap = pendingByWallet.get(destination);
      if (!walletMap || walletMap.size === 0) continue;

      const amountKey = Number(transfer.amountUsdt.toFixed(2));
      const match = walletMap.get(amountKey);
      if (!match) continue;

      if (Math.abs(transfer.amountUsdt - match.expectedAmount) > 0.000001) {
        continue;
      }

      // Check if this txHash was already claimed or processed
      const [existingReceipt, existingTx, existingTopup] = await Promise.all([
        prisma.onchainPaymentReceipt.findUnique({
          where: {
            provider_txHash: {
              provider: "USDT_BEP20",
              txHash: transfer.txHash,
            },
          },
          select: { processedAt: true, externalOrderCode: true },
        }),
        prisma.paymentTransaction.findFirst({
          where: { cryptoTxHash: transfer.txHash },
          select: { id: true },
        }),
        prisma.customerWalletTopup.findFirst({
          where: { cryptoTxHash: transfer.txHash },
          select: { id: true },
        }),
      ]);

      if (existingReceipt?.processedAt || existingTx || existingTopup) {
        continue;
      }

      // Estimate transaction time: ~450ms per block on BSC
      const approxBlockTime = new Date(
        Date.now() - Math.max(0, latestBlock - transfer.blockNumber) * 450
      );

      // Verify the transaction didn't happen before the invoice was created (with 180s clock skew margin)
      if (
        approxBlockTime.getTime() <
        match.record.createdAt.getTime() - 180_000
      ) {
        continue;
      }

      // Confirm via internal API endpoint (handles order, topup, deposit + onchain receipt + notifications + upstream queue)
      const confirmed = await confirmBep20Payment(
        match,
        transfer,
        approxBlockTime
      ).catch((err) => {
        const msg = String(
          err?.response?.data?.message || err?.message || err
        );
        if (msg.toLowerCase().includes("not enough bep20 confirmations")) {
          // Expected when tx is brand new (< 15 confirmations); will confirm in next poll
          return false;
        }
        console.error(
          `[worker] BEP20 auto-confirm ${match.type} ${match.record.externalOrderCode} failed:`,
          formatError(err)
        );
        return false;
      });

      if (confirmed) {
        walletMap.delete(amountKey);
        console.log(
          `[worker] BEP20 auto-detected ${match.type} ${
            match.record.externalOrderCode
          } -> PAID (${transfer.amountUsdt} USDT, tx ${transfer.txHash.slice(
            0,
            16
          )}...)`
        );
      }
    }
  } catch (error) {
    console.error("[worker] BEP20 auto-scan sweep error:", formatError(error));
  } finally {
    if (targetRedis && scanLockToken) {
      const currentToken = await targetRedis
        .get(BEP20_PAYMENT_SCAN_LOCK_KEY)
        .catch(() => null);
      if (currentToken === scanLockToken) {
        await targetRedis
          .del(BEP20_PAYMENT_SCAN_LOCK_KEY)
          .catch(() => undefined);
      }
    }
    bep20PaymentScanRunning = false;
  }
}

export async function confirmBep20Payment(
  match: PendingCryptoMatch,
  transfer: Bep20UsdtTransfer,
  approxBlockDate: Date
): Promise<boolean> {
  const baseUrl = (
    process.env.APP_PUBLIC_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const response = await axios.post(
    `${baseUrl}/api/v1/webhooks/internal-crypto-confirm/${encodeURIComponent(
      match.record.externalOrderCode
    )}`,
    {
      provider: "USDT_BEP20",
      txHash: transfer.txHash,
      amountUsdt: transfer.amountUsdt,
      destination: transfer.toAddress,
      transactionAt: approxBlockDate.toISOString(),
      source: "bep20_usdt_auto_scan",
      chainPayload: {
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        blockNumber: transfer.blockNumber,
        fromAddress: transfer.fromAddress,
        toAddress: transfer.toAddress,
        amountUsdt: transfer.amountUsdt,
        amountRaw: transfer.amountRaw,
        contractAddress: transfer.contractAddress,
      },
    },
    {
      headers: {
        "x-internal-token": process.env.INTERNAL_API_TOKEN || "",
        "Content-Type": "application/json",
      },
      timeout: 25_000,
    }
  );
  return response.data?.reconciled === true;
}
