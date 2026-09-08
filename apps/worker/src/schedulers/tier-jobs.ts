import axios from "axios";
import {
  decryptSecret,
  isMockBotToken,
  telegramSendMessage,
} from "@reseller/shared/server";
import { prisma } from "../infra";
import { getEncryptionKey } from "../config/env";
import { formatError } from "../format/text";

export async function runTierExpiryReminders(): Promise<void> {
  const now = new Date();
  // Mốc nhắc: 7 ngày, 3 ngày, 1 ngày trước hết hạn
  const stages = [
    { code: "7d", minDays: 6, maxDays: 7 },
    { code: "3d", minDays: 2, maxDays: 3 },
    { code: "1d", minDays: 0, maxDays: 1 },
  ];

  for (const stage of stages) {
    const lowerBound = new Date(now.getTime() + stage.minDays * 24 * 60 * 60 * 1000);
    const upperBound = new Date(now.getTime() + stage.maxDays * 24 * 60 * 60 * 1000);

    const candidates = await prisma.seller.findMany({
      where: {
        tier: { in: ["PRO", "ULTRA"] },
        tierExpiresAt: { gte: lowerBound, lte: upperBound },
        OR: [
          { lastTierReminderStage: null },
          { lastTierReminderStage: { not: stage.code } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        tier: true,
        tierExpiresAt: true,
        lastTierReminderStage: true,
        shops: {
          select: {
            id: true,
            botConfig: {
              select: { telegramBotTokenEncrypted: true, ownerTelegramUserId: true },
            },
          },
          take: 1,
        },
      },
      take: 100,
    });

    for (const seller of candidates) {
      const shop = seller.shops?.[0];
      const botConfig = shop?.botConfig;
      if (!botConfig?.telegramBotTokenEncrypted || !botConfig?.ownerTelegramUserId) continue;

      const token = decryptSecret(
        botConfig.telegramBotTokenEncrypted,
        getEncryptionKey()
      );
      if (!token || isMockBotToken(token)) continue;

      const remainingMs = (seller.tierExpiresAt?.getTime() ?? 0) - now.getTime();
      const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
      const expiryStr = seller.tierExpiresAt
        ? `${String(seller.tierExpiresAt.getDate()).padStart(2, "0")}/${String(seller.tierExpiresAt.getMonth() + 1).padStart(2, "0")}/${seller.tierExpiresAt.getFullYear()} ${String(seller.tierExpiresAt.getHours()).padStart(2, "0")}:${String(seller.tierExpiresAt.getMinutes()).padStart(2, "0")}`
        : "-";

      const heading =
        stage.code === "1d"
          ? "🚨 Gói của bạn HẾT HẠN TRONG HÔM NAY"
          : stage.code === "3d"
          ? "⏰ Gói sắp hết hạn"
          : "📅 Nhắc nhở gia hạn";

      const lines = [
        heading,
        "",
        `Gói hiện tại: ${seller.tier}`,
        `Hết hạn: ${expiryStr} (còn ${remainingDays} ngày)`,
        "",
        "Sau khi hết hạn, shop sẽ tự động hạ về FREE — không thể tạo đơn mới qua bot.",
        "",
        "Anh/chị có thể gia hạn trên web dashboard (mục Gia hạn gói).",
      ];

      try {
        await telegramSendMessage(token, botConfig.ownerTelegramUserId, lines.join("\n"));
        await prisma.seller.update({
          where: { id: seller.id },
          data: { lastTierReminderStage: stage.code, lastTierReminderAt: new Date() },
        });
        console.log(`[tier-reminder] sent ${stage.code} to seller=${seller.id} owner=${botConfig.ownerTelegramUserId}`);
      } catch (error) {
        console.error(`[tier-reminder] failed seller=${seller.id} stage=${stage.code}:`, formatError(error));
      }
    }
  }
}

export async function expireSellerTiers(): Promise<void> {
  const now = new Date();
  const expired = await prisma.seller.findMany({
    where: {
      tier: "PRO",
      tierExpiresAt: { not: null, lt: now },
    },
    select: { id: true },
  });
  if (expired.length === 0) return;
  await prisma.seller.updateMany({
    where: { id: { in: expired.map((s) => s.id) } },
    data: { tier: "FREE" },
  });
  console.log(`[worker] Expired ${expired.length} PRO seller(s) → FREE.`);
}

export async function runTierAutoRenewals(): Promise<void> {
  const baseUrl = (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
  const internalToken = process.env.INTERNAL_API_TOKEN || "";
  if (!internalToken) return;
  try {
    const res = await axios.post(
      `${baseUrl}/api/v1/tiers/internal/run-auto-renewals`,
      {},
      { headers: { "x-internal-token": internalToken, "Content-Type": "application/json" }, timeout: 60000 }
    );
    if (res.data && (res.data.renewed > 0 || res.data.failed > 0)) {
      console.log(`[worker] Tier auto-renew: ${res.data.renewed} renewed, ${res.data.failed} failed`);
    }
  } catch (error) {
    console.error("[worker] Tier auto-renew request failed:", formatError(error));
  }
}
