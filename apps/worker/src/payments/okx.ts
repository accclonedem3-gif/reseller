import crypto from "crypto";
import type { Queue } from "bullmq";
import { prisma } from "../infra/prisma";
import { decimalToNumber, formatError } from "../format/text";
import { enqueuePaidOrder } from "../fulfillment/purchase";
import { safeDecryptSecret } from "./payos";

export async function pollOkxDeposits(purchaseQueue: Queue): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const pendingOrders = await prisma.order.findMany({
    where: {
      status: "AWAITING_PAYMENT",
      paymentStatus: "UNPAID",
      paymentTransaction: {
        is: {
          provider: "OKX",
          status: "PENDING",
          createdAt: { gte: cutoff },
        },
      },
    },
    include: {
      paymentTransaction: true,
      shop: { include: { paymentConfig: true } },
    },
    take: 50,
  });
  if (pendingOrders.length === 0) return;
  const shopMap = new Map<string, { config: any; pending: typeof pendingOrders }>();
  for (const order of pendingOrders) {
    const config = order.shop.paymentConfig;
    if (!config?.okxPersonalApiEnabled) continue;
    if (
      !config.okxPersonalApiKeyEncrypted ||
      !config.okxPersonalSecretKeyEncrypted ||
      !config.okxPersonalPassphraseEncrypted
    )
      continue;
    if (!shopMap.has(order.shopId)) {
      shopMap.set(order.shopId, { config, pending: [] });
    }
    shopMap.get(order.shopId)!.pending.push(order);
  }
  for (const [shopId, { config, pending }] of shopMap.entries()) {
    try {
      const apiKey = safeDecryptSecret(config.okxPersonalApiKeyEncrypted);
      const secret = safeDecryptSecret(config.okxPersonalSecretKeyEncrypted);
      const passphrase = safeDecryptSecret(config.okxPersonalPassphraseEncrypted);
      if (!apiKey || !secret || !passphrase) continue;
      const timestamp = new Date().toISOString();
      const path = "/api/v5/asset/deposit-history?ccy=USDT&limit=100";
      const prehash = timestamp + "GET" + path;
      const signature = crypto
        .createHmac("sha256", secret)
        .update(prehash)
        .digest("base64");
      const res = await fetch("https://www.okx.com" + path, {
        method: "GET",
        headers: {
          "OK-ACCESS-KEY": apiKey,
          "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-TIMESTAMP": timestamp,
          "OK-ACCESS-PASSPHRASE": passphrase,
          "Content-Type": "application/json",
        },
      });
      const json: any = await res.json();
      if (!res.ok || json.code !== "0") {
        console.error(
          `[okx-poll] shop=${shopId} api error: code=${json.code} msg=${
            json.msg || res.status
          }`
        );
        continue;
      }
      const deposits = (json.data || []).filter((d: any) => d.state === "2");
      if (deposits.length === 0) continue;
      // Idempotency: a deposit can only pay ONE order. Two orders sharing the same USDT
      // amount used to both match the same on-chain deposit → double-credit. Filter out
      // deposits already consumed by a prior paid tx (persisted in rawPayloadJson.okxDepositId)
      // AND track claims made within this iteration.
      const depIds = deposits.map((d: any) => String(d.depId)).filter(Boolean);
      const consumedDepIds = new Set<string>();
      if (depIds.length > 0) {
        const consumed = await prisma.paymentTransaction
          .findMany({
            where: {
              provider: "OKX",
              status: "PAID",
            },
            select: { rawPayloadJson: true },
            take: 200,
            orderBy: { paidAt: "desc" },
          })
          .catch(() => []);
        for (const c of consumed) {
          const d = ((c.rawPayloadJson as any) || {}).okxDepositId;
          if (d && depIds.includes(String(d))) consumedDepIds.add(String(d));
        }
      }
      const claimedInBatch = new Set<string>();
      for (const order of pending) {
        const tx = order.paymentTransaction;
        const usdtAmount = Number(
          ((tx?.rawPayloadJson as any) || {}).manualCrypto?.usdtAmount || 0
        );
        if (!usdtAmount) continue;
        const matched = deposits.find((d: any) => {
          const id = String(d.depId);
          if (!id || consumedDepIds.has(id) || claimedInBatch.has(id)) return false;
          return Math.abs(Number(d.amt) - usdtAmount) < 0.001;
        });
        if (!matched) continue;
        claimedInBatch.add(String(matched.depId));
        const paidOrder = await prisma.$transaction(async (tx2) => {
          const current = await tx2.order.findUnique({
            where: { id: order.id },
            include: { paymentTransaction: true },
          });
          if (
            !current?.paymentTransaction ||
            current.status !== "AWAITING_PAYMENT" ||
            current.paymentStatus !== "UNPAID" ||
            current.paymentTransaction.status !== "PENDING"
          ) {
            return null;
          }
          const paidAt = new Date();
          await tx2.paymentTransaction.update({
            where: { id: current.paymentTransaction.id },
            data: {
              status: "PAID",
              paidAt,
              cryptoTxHash: matched.txId,
              rawPayloadJson: {
                ...((current.paymentTransaction.rawPayloadJson as any) || {}),
                sweptBy: "worker_okx_personal_poll",
                okxDepositId: matched.depId,
                okxChain: matched.chain,
                matchAmount: matched.amt,
              },
            },
          });
          await tx2.order.update({
            where: { id: current.id },
            data: { paymentStatus: "PAID", status: "PAID", paidAt },
          });
          await tx2.orderEvent.create({
            data: {
              orderId: current.id,
              eventType: "payment_completed",
              payloadJson: {
                sweptBy: "worker_okx_personal_poll",
                txHash: matched.txId,
                chain: matched.chain,
                amount: matched.amt,
              },
            },
          });
          return { id: current.id, totalSourceAmount: current.totalSourceAmount };
        });
        if (!paidOrder) continue;
        await enqueuePaidOrder(
          purchaseQueue,
          paidOrder.id,
          decimalToNumber(paidOrder.totalSourceAmount)
        );
        console.log(
          `[worker] OKX matched deposit ${matched.txId} (${matched.amt} USDT) for order ${order.orderCode}.`
        );
      }
    } catch (e) {
      console.error(
        `[worker] OKX poll failed for shop ${shopId}:`,
        formatError(e)
      );
    }
  }
}
