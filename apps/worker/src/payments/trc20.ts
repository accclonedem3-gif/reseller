import axios from "axios";
import type { Queue } from "bullmq";
import { prisma } from "../infra/prisma";
import { toDecimal, formatError } from "../format/text";
import { JOBS } from "@reseller/shared/server";
import { getPaymentContext } from "./index";

export function getTronGridApiBaseUrl(): string {
  return process.env.TRONGRID_API_BASE_URL || "https://api.trongrid.io";
}

export function getTronGridApiKey(): string {
  return process.env.TRONGRID_API_KEY || "";
}

export function getTronUsdtContractAddress(): string {
  return (
    process.env.TRON_USDT_CONTRACT_ADDRESS || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
  );
}

export function buildTronGridHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = getTronGridApiKey();
  if (key) headers["TRON-PRO-API-KEY"] = key;
  return headers;
}

export async function getRecentTrc20TransfersTo(
  address: string,
  sinceMs: number
): Promise<
  Array<{
    txHash: string;
    amountUsdt: number;
    blockTimestamp: number;
    fromAddress: string;
    toAddress: string;
    confirmed: boolean;
    finalResult: string;
  }>
> {
  const url = new URL(
    `/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`,
    getTronGridApiBaseUrl()
  );
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("only_to", "true");
  url.searchParams.set("limit", "50");
  url.searchParams.set("order_by", "block_timestamp,desc");
  url.searchParams.set("contract_address", getTronUsdtContractAddress());
  url.searchParams.set("min_timestamp", String(sinceMs));
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: buildTronGridHeaders(),
    });
    if (!response.ok) return [];
    const payload: any = await response.json();
    const rows = Array.isArray(payload.data) ? payload.data : [];
    return rows
      .map((row: any) => {
        const txHash = String(
          row.transaction_id || row.hash || row.transaction || ""
        ).trim();
        const decimals = Number(row.token_info?.decimals ?? row.decimals ?? 6);
        const rawAmount = row.value ?? row.amount ?? "0";
        const amountUsdt = Number(rawAmount) / Math.pow(10, decimals);
        const blockTimestamp = Number(row.block_timestamp || 0);
        const fromAddress = String(row.from || "").trim();
        const toAddress = String(row.to || "").trim();
        const confirmed =
          String(row.confirmed || "").toLowerCase() === "true" ||
          row.confirmed === true;
        const finalResult = String(
          row.final_result || row.contract_ret || "SUCCESS"
        ).toUpperCase();
        return {
          txHash,
          amountUsdt,
          blockTimestamp,
          fromAddress,
          toAddress,
          confirmed,
          finalResult,
        };
      })
      .filter(
        (t: any) => t.confirmed && t.finalResult.includes("SUCCESS") && t.txHash
      );
  } catch (_) {
    return [];
  }
}

export async function scanTrc20UsdtPayments(purchaseQueue?: Queue | null): Promise<void> {
  const targetQueue = purchaseQueue ?? getPaymentContext().purchaseQueue;
  const configs = await prisma.paymentConfig.findMany({
    where: { usdtTrc20Address: { not: null } },
    select: { shopId: true, usdtTrc20Address: true },
  });
  if (configs.length === 0) return;
  const sinceMs = Date.now() - 60 * 60 * 1000;
  const platformDepositShopId = process.env.PLATFORM_DEPOSIT_SHOP_ID || null;

  for (const cfg of configs) {
    const wallet = String(cfg.usdtTrc20Address || "").trim();
    if (!wallet) continue;
    const isPlatformShop =
      platformDepositShopId && cfg.shopId === platformDepositShopId;

    // Find pending USDT_TRC20 payments + topups + tier deposit requests for this shop
    const [pendingPayments, pendingTopups, pendingDeposits] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where: {
          provider: "USDT_TRC20",
          status: "PENDING",
          createdAt: { gte: new Date(sinceMs) },
          order: { shopId: cfg.shopId },
        },
        select: {
          id: true,
          externalOrderCode: true,
          rawPayloadJson: true,
          createdAt: true,
        },
      }),
      prisma.customerWalletTopup.findMany({
        where: {
          provider: "USDT_TRC20",
          status: "PENDING",
          shopId: cfg.shopId,
          createdAt: { gte: new Date(sinceMs) },
        },
        select: {
          id: true,
          externalOrderCode: true,
          rawPayloadJson: true,
          createdAt: true,
        },
      }),
      isPlatformShop
        ? prisma.depositRequest.findMany({
            where: {
              provider: "USDT_TRC20",
              status: "PENDING",
              createdAt: { gte: new Date(sinceMs) },
            },
            select: {
              id: true,
              externalOrderCode: true,
              rawPayloadJson: true,
              createdAt: true,
              note: true,
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

    const amountToOrder = new Map<number, { type: string; record: any }>();
    for (const p of pendingPayments) {
      const amt = Number(
        ((p.rawPayloadJson as any)?.manualCrypto?.usdtAmount as any) || 0
      );
      if (amt > 0)
        amountToOrder.set(Number(amt.toFixed(2)), {
          type: "order",
          record: p,
        });
    }
    const amountToTopup = new Map<number, { type: string; record: any }>();
    for (const t of pendingTopups) {
      const amt = Number(
        ((t.rawPayloadJson as any)?.manualCrypto?.usdtAmount as any) || 0
      );
      if (amt > 0 && !amountToOrder.has(Number(amt.toFixed(2)))) {
        amountToTopup.set(Number(amt.toFixed(2)), {
          type: "topup",
          record: t,
        });
      }
    }
    const amountToDeposit = new Map<number, { type: string; record: any }>();
    for (const d of pendingDeposits) {
      const amt = Number(
        ((d.rawPayloadJson as any)?.manualCrypto?.usdtAmount as any) || 0
      );
      if (
        amt > 0 &&
        !amountToOrder.has(Number(amt.toFixed(2))) &&
        !amountToTopup.has(Number(amt.toFixed(2)))
      ) {
        amountToDeposit.set(Number(amt.toFixed(2)), {
          type: "deposit",
          record: d,
        });
      }
    }

    const transfers = await getRecentTrc20TransfersTo(wallet, sinceMs);
    for (const transfer of transfers) {
      if (transfer.toAddress !== wallet) continue;
      // Check tx hash not reused
      const [usedTx, usedTopup] = await Promise.all([
        prisma.paymentTransaction.findFirst({
          where: { cryptoTxHash: transfer.txHash },
          select: { id: true },
        }),
        prisma.customerWalletTopup.findFirst({
          where: { cryptoTxHash: transfer.txHash },
          select: { id: true },
        }),
      ]);
      if (usedTx || usedTopup) continue;

      const matchOrder = amountToOrder.get(Number(transfer.amountUsdt.toFixed(2)));
      if (matchOrder) {
        try {
          await prisma.paymentTransaction.update({
            where: { id: matchOrder.record.id },
            data: {
              status: "PAID",
              paidAt: new Date(),
              cryptoTxHash: transfer.txHash,
              rawPayloadJson: {
                ...((matchOrder.record.rawPayloadJson as any) || {}),
                autoDetect: {
                  source: "trc20_auto_scan",
                  txHash: transfer.txHash,
                  amountUsdt: transfer.amountUsdt,
                  detectedAt: new Date().toISOString(),
                },
              },
            },
          });
          const payment = await prisma.paymentTransaction.findUnique({
            where: { id: matchOrder.record.id },
            include: { order: true },
          });
          if (payment?.order) {
            await prisma.order.update({
              where: { id: payment.orderId },
              data: { paymentStatus: "PAID", status: "PAID", paidAt: new Date() },
            });
            await prisma.orderEvent.create({
              data: {
                orderId: payment.orderId,
                eventType: "payment_completed",
                payloadJson: {
                  source: "trc20_auto_scan",
                  txHash: transfer.txHash,
                  externalOrderCode: matchOrder.record.externalOrderCode,
                },
              },
            });
            await targetQueue
              ?.add(JOBS.purchaseUpstream, { orderId: payment.orderId })
              .catch(() => undefined);
            console.log(
              `[worker] TRC20 auto-detected order ${
                matchOrder.record.externalOrderCode
              } → PAID (${transfer.amountUsdt} USDT, tx ${transfer.txHash.slice(
                0,
                16
              )}...)`
            );
          }
          amountToOrder.delete(Number(transfer.amountUsdt.toFixed(2)));
        } catch (error) {
          console.error(
            `[worker] TRC20 auto-confirm order failed:`,
            formatError(error)
          );
        }
        continue;
      }
      const matchDeposit = amountToDeposit.get(
        Number(transfer.amountUsdt.toFixed(2))
      );
      if (matchDeposit) {
        try {
          const baseUrl = (
            process.env.APP_PUBLIC_URL || "http://localhost:3000"
          ).replace(/\/$/, "");
          const internalToken = process.env.INTERNAL_API_TOKEN || "";
          await axios.post(
            `${baseUrl}/api/v1/webhooks/internal-crypto-confirm/${encodeURIComponent(
              matchDeposit.record.externalOrderCode || ""
            )}`,
            {
              // endpoint reads `signature`; map TRC20 txHash into it so the tx is recorded
              signature: transfer.txHash,
              amountUsdt: transfer.amountUsdt,
              source: "trc20_auto_scan",
            },
            {
              headers: {
                "x-internal-token": internalToken,
                "Content-Type": "application/json",
              },
              timeout: 20000,
            }
          );
          console.log(
            `[worker] TRC20 auto-detected deposit ${
              matchDeposit.record.externalOrderCode
            } → confirmed (${transfer.amountUsdt} USDT, tx ${transfer.txHash.slice(
              0,
              16
            )}...)`
          );
          amountToDeposit.delete(Number(transfer.amountUsdt.toFixed(2)));
        } catch (error) {
          console.error(
            `[worker] TRC20 auto-confirm deposit failed:`,
            formatError(error)
          );
        }
        continue;
      }
      const matchTopup = amountToTopup.get(
        Number(transfer.amountUsdt.toFixed(2))
      );
      if (matchTopup) {
        try {
          await prisma.customerWalletTopup.update({
            where: { id: matchTopup.record.id },
            data: { cryptoTxHash: transfer.txHash },
          });
          const topup = await prisma.customerWalletTopup.findUnique({
            where: { id: matchTopup.record.id },
            include: { wallet: true },
          });
          if (topup) {
            await prisma.$transaction(async (tx) => {
              await tx.customerWalletTopup.update({
                where: { id: topup.id },
                data: { status: "PAID", paidAt: new Date() },
              });
              const wallet = await tx.customerWallet.findUnique({
                where: { id: topup.walletId },
              });
              if (wallet) {
                const balBefore = Number(wallet.balance);
                const balAfter = balBefore + Number(topup.amount);
                await tx.customerWallet.update({
                  where: { id: wallet.id },
                  data: { balance: toDecimal(balAfter) },
                });
                await tx.customerWalletLedger.create({
                  data: {
                    customerId: topup.customerId,
                    walletId: wallet.id,
                    type: "TOPUP",
                    amount: toDecimal(Number(topup.amount)),
                    balanceBefore: toDecimal(balBefore),
                    balanceAfter: toDecimal(balAfter),
                    commissionBalanceBefore: wallet.commissionBalance,
                    commissionBalanceAfter: wallet.commissionBalance,
                    referenceType: "topup",
                    referenceId: topup.id,
                  },
                });
              }
            });
            console.log(
              `[worker] TRC20 auto-detected topup ${matchTopup.record.externalOrderCode} → PAID (${transfer.amountUsdt} USDT)`
            );
          }
          amountToTopup.delete(Number(transfer.amountUsdt.toFixed(2)));
        } catch (error) {
          console.error(
            `[worker] TRC20 auto-confirm topup failed:`,
            formatError(error)
          );
        }
      }
      if (
        amountToOrder.size === 0 &&
        amountToTopup.size === 0 &&
        amountToDeposit.size === 0
      )
        break;
    }
  }
}
