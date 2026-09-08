import axios from "axios";
import type { Queue } from "bullmq";
import { prisma } from "../infra/prisma";
import { toDecimal, formatError } from "../format/text";
import { JOBS } from "@reseller/shared/server";
import { getPaymentContext } from "./index";

export function getSolanaRpcUrl(): string {
  const key = process.env.HELIUS_API_KEY;
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function getSolanaUsdtMint(): string {
  return (
    process.env.SOLANA_USDT_MINT ||
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
  );
}

export async function solanaRpc(method: string, params: any[]): Promise<any> {
  const response = await fetch(getSolanaRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) return null;
  const json: any = await response.json();
  if (json.error) return null;
  return json.result;
}

export async function getUsdtTokenAccountsOfWallet(
  walletAddress: string
): Promise<string[]> {
  const result = await solanaRpc("getTokenAccountsByOwner", [
    walletAddress,
    { mint: getSolanaUsdtMint() },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  if (!result?.value) return [];
  return result.value.map((a: any) => a.pubkey);
}

export async function getSignaturesForAccount(
  accountAddress: string,
  limit = 30
): Promise<Array<{ signature: string; blockTime?: number }>> {
  const result = await solanaRpc("getSignaturesForAddress", [
    accountAddress,
    { limit, commitment: "confirmed" },
  ]);
  if (!Array.isArray(result)) return [];
  return result
    .filter((s: any) => !s.err)
    .map((s: any) => ({ signature: s.signature, blockTime: s.blockTime }));
}

export async function getSolanaTransaction(signature: string): Promise<any> {
  return solanaRpc("getTransaction", [
    signature,
    {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  ]);
}

export async function extractUsdtTransfers(
  tx: any,
  expectedReceiverWallet: string
): Promise<Array<{ amountUsdt: number; toOwner: string; signature: string }>> {
  const meta = tx?.meta;
  if (!meta || meta.err) return [];
  const usdtMint = getSolanaUsdtMint();
  const instructions = tx.transaction?.message?.instructions ?? [];
  const innerInstructions = (meta.innerInstructions ?? []).flatMap(
    (i: any) => i.instructions ?? []
  );
  const allInstructions = [...instructions, ...innerInstructions];
  const transfers: Array<{
    amountUsdt: number;
    toOwner: string;
    signature: string;
  }> = [];
  for (const inst of allInstructions) {
    if (inst.program !== "spl-token" || !inst.parsed) continue;
    const type = inst.parsed.type;
    if (type !== "transfer" && type !== "transferChecked") continue;
    const info = inst.parsed.info;
    const mint = info.mint;
    if (type === "transferChecked" && mint !== usdtMint) continue;
    // For plain transfer, check via postTokenBalances
    if (type === "transfer") {
      const postBalances = meta.postTokenBalances ?? [];
      const destBalance = postBalances.find(
        (b: any) => b.mint === usdtMint && b.owner === expectedReceiverWallet
      );
      if (!destBalance) continue;
    }
    const decimals = info.tokenAmount?.decimals ?? 6;
    const rawAmount = info.amount ?? info.tokenAmount?.amount ?? "0";
    const amountUsdt = Number(rawAmount) / Math.pow(10, decimals);
    // Resolve destination owner
    let toOwner = "";
    const postBalances = meta.postTokenBalances ?? [];
    const destBalance = postBalances.find(
      (b: any) => b.mint === usdtMint && b.owner === expectedReceiverWallet
    );
    if (destBalance) toOwner = destBalance.owner;
    if (toOwner !== expectedReceiverWallet) continue;
    transfers.push({
      amountUsdt,
      toOwner,
      signature: tx.transaction?.signatures?.[0] || "",
    });
  }
  return transfers;
}

export async function scanSolanaUsdtPayments(
  purchaseQueue?: Queue | null
): Promise<void> {
  const targetQueue = purchaseQueue ?? getPaymentContext().purchaseQueue;
  // Find all shops with usdt_solana_address configured
  const configs = await prisma.paymentConfig.findMany({
    where: { usdtSolanaAddress: { not: null } },
    select: { shopId: true, usdtSolanaAddress: true },
  });
  if (configs.length === 0) return;
  const sinceMs = Date.now() - 60 * 60 * 1000; // last 1 hour
  const platformDepositShopId = process.env.PLATFORM_DEPOSIT_SHOP_ID || null;

  for (const cfg of configs) {
    const wallet = String(cfg.usdtSolanaAddress || "").trim();
    if (!wallet) continue;
    const isPlatformShop =
      platformDepositShopId && cfg.shopId === platformDepositShopId;

    // Find pending USDT_SOL payments + topups + deposit requests for this shop
    const [pendingPayments, pendingTopups, pendingDeposits] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where: {
          provider: "USDT_SOL",
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
          provider: "USDT_SOL",
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
              provider: "USDT_SOL",
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

    // Build amount → record map
    const amountToOrder = new Map<number, { type: string; record: any }>();
    for (const p of pendingPayments) {
      const amt = Number(
        ((p.rawPayloadJson as any)?.manualCrypto?.usdtAmount as any) || 0
      );
      if (amt > 0) amountToOrder.set(amt, { type: "order", record: p });
    }
    const amountToTopup = new Map<number, { type: string; record: any }>();
    for (const t of pendingTopups) {
      const amt = Number(
        ((t.rawPayloadJson as any)?.manualCrypto?.usdtAmount as any) || 0
      );
      if (amt > 0 && !amountToOrder.has(amt))
        amountToTopup.set(amt, { type: "topup", record: t });
    }
    const amountToDeposit = new Map<number, { type: string; record: any }>();
    for (const d of pendingDeposits) {
      const amt = Number(
        ((d.rawPayloadJson as any)?.manualCrypto?.usdtAmount as any) || 0
      );
      if (amt > 0 && !amountToOrder.has(amt) && !amountToTopup.has(amt)) {
        amountToDeposit.set(amt, { type: "deposit", record: d });
      }
    }

    // Fetch recent USDT transfers to this wallet
    const tokenAccounts = await getUsdtTokenAccountsOfWallet(wallet);
    if (tokenAccounts.length === 0) continue;

    const seenSignatures = new Set<string>();
    for (const ata of tokenAccounts) {
      const sigs = await getSignaturesForAccount(ata, 30);
      for (const sig of sigs) {
        if (seenSignatures.has(sig.signature)) continue;
        seenSignatures.add(sig.signature);
        if (sig.blockTime && sig.blockTime * 1000 < sinceMs) continue;
        // Check tx hash not already used
        const [usedTx, usedTopup] = await Promise.all([
          prisma.paymentTransaction.findFirst({
            where: { cryptoTxHash: sig.signature },
            select: { id: true },
          }),
          prisma.customerWalletTopup.findFirst({
            where: { cryptoTxHash: sig.signature },
            select: { id: true },
          }),
        ]);
        if (usedTx || usedTopup) continue;

        const tx = await getSolanaTransaction(sig.signature);
        if (!tx) continue;
        const transfers = await extractUsdtTransfers(tx, wallet);
        if (transfers.length === 0) continue;

        for (const transfer of transfers) {
          const matchOrder = amountToOrder.get(
            Number(transfer.amountUsdt.toFixed(2))
          );
          if (matchOrder) {
            try {
              await prisma.paymentTransaction.update({
                where: { id: matchOrder.record.id },
                data: {
                  status: "PAID",
                  paidAt: new Date(),
                  cryptoTxHash: sig.signature,
                  rawPayloadJson: {
                    ...((matchOrder.record.rawPayloadJson as any) || {}),
                    autoDetect: {
                      source: "solana_auto_scan",
                      signature: sig.signature,
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
                  data: {
                    paymentStatus: "PAID",
                    status: "PAID",
                    paidAt: new Date(),
                  },
                });
                await prisma.orderEvent.create({
                  data: {
                    orderId: payment.orderId,
                    eventType: "payment_completed",
                    payloadJson: {
                      source: "solana_auto_scan",
                      signature: sig.signature,
                      externalOrderCode: matchOrder.record.externalOrderCode,
                    },
                  },
                });
                // Enqueue purchase job
                await targetQueue
                  ?.add(JOBS.purchaseUpstream, { orderId: payment.orderId })
                  .catch(() => undefined);
                console.log(
                  `[worker] Solana auto-detected order ${
                    matchOrder.record.externalOrderCode
                  } → PAID (${transfer.amountUsdt} USDT, sig ${sig.signature.slice(
                    0,
                    16
                  )}...)`
                );
              }
              amountToOrder.delete(Number(transfer.amountUsdt.toFixed(2)));
            } catch (error) {
              console.error(
                `[worker] Solana auto-confirm order failed:`,
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
                  signature: sig.signature,
                  amountUsdt: transfer.amountUsdt,
                  source: "solana_auto_scan",
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
                `[worker] Solana auto-detected deposit ${
                  matchDeposit.record.externalOrderCode
                } → confirmed (${transfer.amountUsdt} USDT)`
              );
              amountToDeposit.delete(Number(transfer.amountUsdt.toFixed(2)));
            } catch (error) {
              console.error(
                `[worker] Solana auto-confirm deposit failed:`,
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
                data: { cryptoTxHash: sig.signature },
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
                  `[worker] Solana auto-detected topup ${matchTopup.record.externalOrderCode} → PAID (${transfer.amountUsdt} USDT)`
                );
              }
              amountToTopup.delete(Number(transfer.amountUsdt.toFixed(2)));
            } catch (error) {
              console.error(
                `[worker] Solana auto-confirm topup failed:`,
                formatError(error)
              );
            }
          }
        }

        if (
          amountToOrder.size === 0 &&
          amountToTopup.size === 0 &&
          amountToDeposit.size === 0
        )
          break;
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
