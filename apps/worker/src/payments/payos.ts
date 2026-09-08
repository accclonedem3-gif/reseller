import axios from "axios";
import type { Queue } from "bullmq";
import { prisma } from "../infra/prisma";
import { getEncryptionKey } from "../config/env";
import { decimalToNumber, formatError } from "../format/text";
import { enqueuePaidOrder } from "../fulfillment/purchase";
import {
  decryptSecret,
  getPayOSPaymentLinkStatus,
} from "@reseller/shared/server";

export function safeDecryptSecret(payload?: string | null): string {
  try {
    return decryptSecret(payload, getEncryptionKey());
  } catch {
    return "";
  }
}

export function resolvePayOSCredentials(paymentConfig?: {
  payosClientIdEncrypted?: string | null;
  payosApiKeyEncrypted?: string | null;
  payosChecksumKeyEncrypted?: string | null;
} | null): { clientId: string; apiKey: string; checksumKey: string } | null {
  const clientId =
    safeDecryptSecret(paymentConfig?.payosClientIdEncrypted) ||
    process.env.PAYOS_CLIENT_ID ||
    "";
  const apiKey =
    safeDecryptSecret(paymentConfig?.payosApiKeyEncrypted) ||
    process.env.PAYOS_API_KEY ||
    "";
  const checksumKey =
    safeDecryptSecret(paymentConfig?.payosChecksumKeyEncrypted) ||
    process.env.PAYOS_CHECKSUM_KEY ||
    "";
  if (!clientId || !apiKey || !checksumKey) {
    return null;
  }
  return {
    clientId,
    apiKey,
    checksumKey,
  };
}

export async function reconcilePendingPayOSOrders(purchaseQueue: Queue): Promise<void> {
  const pendingOrders = await prisma.order.findMany({
    where: {
      status: "AWAITING_PAYMENT",
      paymentStatus: "UNPAID",
      paymentTransaction: {
        is: {
          provider: "PAYOS",
          status: "PENDING",
        },
      },
    },
    include: {
      paymentTransaction: true,
      shop: {
        include: {
          paymentConfig: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 20,
  });

  for (const order of pendingOrders) {
    const externalOrderCode = order.paymentTransaction?.externalOrderCode;
    if (!externalOrderCode) {
      continue;
    }
    const credentials = resolvePayOSCredentials(order.shop.paymentConfig);
    if (!credentials) {
      continue;
    }
    try {
      const remoteStatus = await getPayOSPaymentLinkStatus(
        credentials,
        externalOrderCode
      );
      const providerStatus = String(remoteStatus.status || "UNKNOWN").toUpperCase();
      const isPaid =
        ["PAID", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(providerStatus) ||
        (Number(remoteStatus.amountPaid || 0) > 0 &&
          Number(remoteStatus.amount || 0) > 0 &&
          Number(remoteStatus.amountPaid || 0) >= Number(remoteStatus.amount || 0));
      if (!isPaid) {
        continue;
      }
      const paidOrder = await prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({
          where: { id: order.id },
          include: {
            paymentTransaction: true,
          },
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
        await tx.paymentTransaction.update({
          where: { id: current.paymentTransaction.id },
          data: {
            status: "PAID",
            paidAt,
            rawPayloadJson: {
              sweptBy: "worker_payos_status_poll",
              providerStatus,
              payos: remoteStatus.providerResponse as any,
            },
          },
        });
        await tx.order.update({
          where: { id: current.id },
          data: {
            paymentStatus: "PAID",
            status: "PAID",
            paidAt,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: current.id,
            eventType: "payment_completed",
            payloadJson: {
              sweptBy: "worker_payos_status_poll",
              externalOrderCode,
              providerStatus,
              payos: remoteStatus.providerResponse as any,
            },
          },
        });
        return {
          id: current.id,
          totalSourceAmount: current.totalSourceAmount,
        };
      });
      if (!paidOrder) {
        continue;
      }
      await enqueuePaidOrder(
        purchaseQueue,
        paidOrder.id,
        decimalToNumber(paidOrder.totalSourceAmount)
      );
      console.log(
        `[worker] Reconciled PayOS payment ${externalOrderCode} without waiting for the success-page click.`
      );
    } catch (error) {
      console.error(
        `[worker] PayOS pending order reconcile failed for ${externalOrderCode}:`,
        formatError(error)
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Tier subscription PayOS fallback — tier payments are stored as
// DepositRequest (note "TIER_SUB:..."), NOT as Order, so the order
// sweep above does not cover them. Without this, a tier renewal only
// confirms if the live PayOS webhook lands — a missed/late webhook
// leaves the seller paid-but-not-upgraded. Poll PayOS for pending
// tier deposits and confirm via the internal endpoint as a fallback.
// ─────────────────────────────────────────────────────────────────
export async function reconcilePendingTierDeposits(): Promise<void> {
  const platformShopId = process.env.PLATFORM_DEPOSIT_SHOP_ID || "platform-tier";
  const pending = await prisma.depositRequest.findMany({
    where: {
      provider: "PAYOS",
      status: "PENDING",
      externalOrderCode: { not: null },
      note: { startsWith: "TIER_SUB:" },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  if (pending.length === 0) {
    return;
  }
  const platformShop = await prisma.shop.findUnique({
    where: { id: platformShopId },
    include: { paymentConfig: true },
  });
  const credentials = resolvePayOSCredentials(platformShop?.paymentConfig);
  if (!credentials) {
    return;
  }
  const baseUrl = (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  const internalToken = process.env.INTERNAL_API_TOKEN || "";
  for (const deposit of pending) {
    const externalOrderCode = deposit.externalOrderCode;
    if (!externalOrderCode) {
      continue;
    }
    try {
      const remoteStatus = await getPayOSPaymentLinkStatus(
        credentials,
        externalOrderCode
      );
      const providerStatus = String(remoteStatus.status || "UNKNOWN").toUpperCase();
      const isPaid =
        ["PAID", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(providerStatus) ||
        (Number(remoteStatus.amountPaid || 0) > 0 &&
          Number(remoteStatus.amount || 0) > 0 &&
          Number(remoteStatus.amountPaid || 0) >= Number(remoteStatus.amount || 0));
      if (!isPaid) {
        continue;
      }
      await axios.post(
        `${baseUrl}/api/v1/webhooks/internal-crypto-confirm/${encodeURIComponent(
          externalOrderCode
        )}`,
        {
          source: "worker_tier_payos_poll",
          providerStatus,
          payos: remoteStatus.providerResponse,
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
        `[worker] Tier PayOS deposit ${externalOrderCode} → confirmed via poll (${providerStatus}).`
      );
    } catch (error) {
      console.error(
        `[worker] Tier PayOS deposit reconcile failed for ${externalOrderCode}:`,
        formatError(error)
      );
    }
  }
}

export async function expireSellerDepositRequests(): Promise<void> {
  const expiredRequests = await prisma.depositRequest.findMany({
    where: {
      status: "PENDING",
      externalOrderCode: {
        not: null,
      },
      expiresAt: {
        lte: new Date(),
      },
    },
    orderBy: {
      expiresAt: "asc",
    },
    take: 30,
  });
  if (expiredRequests.length === 0) {
    return;
  }

  // MONEY-SAFETY: a slow inter-bank transfer can land right at / just past the tier link's
  // 30-min expiry. Before REJECTing a TIER_SUB PayOS deposit, ask PayOS one last time — if it's
  // actually paid, confirm it (auto-upgrade) instead of rejecting. Otherwise the seller paid but
  // gets no tier and no auto-refund.
  const baseUrl = (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  const internalToken = process.env.INTERNAL_API_TOKEN || "";
  let tierPayosCredentials: any = null;
  const hasTierPayos = expiredRequests.some(
    (r) => r.provider === "PAYOS" && String(r.note || "").startsWith("TIER_SUB:")
  );
  if (hasTierPayos) {
    const platformShopId = process.env.PLATFORM_DEPOSIT_SHOP_ID || "platform-tier";
    const platformShop = await prisma.shop.findUnique({
      where: { id: platformShopId },
      include: { paymentConfig: true },
    });
    tierPayosCredentials = resolvePayOSCredentials(platformShop?.paymentConfig);
  }

  for (const request of expiredRequests) {
    const isTierPayos =
      request.provider === "PAYOS" &&
      String(request.note || "").startsWith("TIER_SUB:");
    if (isTierPayos && tierPayosCredentials && request.externalOrderCode) {
      try {
        const remoteStatus = await getPayOSPaymentLinkStatus(
          tierPayosCredentials,
          request.externalOrderCode
        );
        const providerStatus = String(remoteStatus.status || "UNKNOWN").toUpperCase();
        const isPaid =
          ["PAID", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(providerStatus) ||
          (Number(remoteStatus.amountPaid || 0) > 0 &&
            Number(remoteStatus.amount || 0) > 0 &&
            Number(remoteStatus.amountPaid || 0) >= Number(remoteStatus.amount || 0));
        if (isPaid) {
          await axios.post(
            `${baseUrl}/api/v1/webhooks/internal-crypto-confirm/${encodeURIComponent(
              request.externalOrderCode
            )}`,
            {
              source: "worker_tier_expire_recheck",
              providerStatus,
              payos: remoteStatus.providerResponse,
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
            `[worker] Tier PayOS deposit ${request.externalOrderCode} paid late → confirmed at expiry (not rejected).`
          );
          continue; // skip the REJECT below
        }
      } catch (error) {
        console.error(
          `[worker] Tier expire recheck failed for ${request.externalOrderCode}:`,
          formatError(error)
        );
        // fall through to reject
      }
    }
    await prisma.depositRequest.updateMany({
      where: {
        id: request.id,
        status: "PENDING",
      },
      data: {
        status: "REJECTED",
        note: request.note || "Expired payment link",
      },
    });
  }
}
