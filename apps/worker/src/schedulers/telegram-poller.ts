import axios from "axios";
import {
  decryptSecret,
  isMockBotToken,
  telegramGetUpdates,
  buildInternalRequestHeaders,
} from "@reseller/shared/server";
import { prisma } from "../infra";
import { getEncryptionKey } from "../config/env";

export async function pollTelegramBots(): Promise<void> {
  const bots = await prisma.botConfig.findMany({
    where: {
      deliveryMode: "POLLING",
      webhookStatus: {
        in: ["POLLING", "ACTIVE"],
      },
    },
  });
  for (const bot of bots) {
    const token = decryptSecret(bot.telegramBotTokenEncrypted, getEncryptionKey());
    if (!token || isMockBotToken(token)) {
      continue;
    }
    try {
      const offset = bot.lastProcessedUpdateId ? Number(bot.lastProcessedUpdateId) + 1 : undefined;
      const updates = await telegramGetUpdates(token, offset, 1);
      for (const update of updates) {
        const updateId = Number((update as { update_id?: number }).update_id || 0);
        const path = `/api/v1/internal/telegram/process/${bot.shopId}`;
        const rawBody = JSON.stringify(update);
        const signedHeaders = buildInternalRequestHeaders({
          secret: process.env.INTERNAL_API_TOKEN || "change-me-internal-api-token",
          method: "POST",
          path,
          body: rawBody,
        });
        await axios.post(`${process.env.APP_PUBLIC_URL || "http://localhost:3000"}${path}`, update, {
          headers: {
            ...signedHeaders,
          },
          timeout: 10000,
        });
        await prisma.botConfig.update({
          where: { id: bot.id },
          data: {
            lastProcessedUpdateId: BigInt(updateId),
          },
        });
      }
    } catch (error: any) {
      const status = error?.response?.status ?? error?.response?.data?.error_code;
      if (status === 404) {
        console.warn(`[worker] Bot token invalid for shop ${bot.shopId} — set token to "mock..." to suppress.`);
      } else {
        console.error("[worker] Telegram polling failed:", error?.message ?? error);
      }
    }
  }
}
