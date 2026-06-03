#!/usr/bin/env node
/**
 * Bulk-refresh Telegram webhook for every active shop.
 *
 * Use cases:
 *  - First-time production deploy: flip every shop from POLLING → WEBHOOK.
 *  - After domain change: re-register webhooks to the new URL.
 *  - Recovery: a webhook can drift if Telegram had a temporary failure during setWebhook.
 *
 * Behavior:
 *  - Requires APP_PUBLIC_URL pointing at a public, HTTPS-reachable host (Telegram refuses HTTP
 *    and localhost). If APP_PUBLIC_URL contains "localhost" or "127.0.0.1" the script refuses
 *    to run — there is no scenario where webhook-mode against localhost is correct.
 *  - For each BotConfig with a token, calls Telegram setWebhook → updates the DB row to
 *    deliveryMode=WEBHOOK + webhookStatus=ACTIVE.
 *  - On API failure for one shop, logs and continues (one bad token shouldn't block the rest).
 *  - Idempotent: safe to re-run.
 *
 * Usage:
 *   APP_PUBLIC_URL=https://shop.example.com node scripts/refresh-telegram-webhooks.cjs
 *
 * Flags:
 *   --dry-run     Show what would change without calling Telegram or writing DB.
 *   --shop=<id>   Only process this single shop (useful for one-off debug).
 */

require("dotenv/config");

const { PrismaClient } = require("@prisma/client");
const { decryptSecret, telegramSetWebhook, telegramGetMe } = require("@reseller/shared/server");
const crypto = require("node:crypto");

const prisma = new PrismaClient();
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || "").replace(/\/+$/, "");
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const DRY_RUN = process.argv.includes("--dry-run");
const SHOP_FILTER = (process.argv.find((a) => a.startsWith("--shop="))?.split("=")[1] || "").trim();

function buildTelegramWebhookSecret(shopId) {
  // Mirrors `ShopsService.buildTelegramWebhookSecret`. Telegram includes this token in the
  // x-telegram-bot-api-secret-token header; the API endpoint validates it before processing.
  return crypto
    .createHmac("sha256", TELEGRAM_WEBHOOK_SECRET || ENCRYPTION_KEY || "fallback")
    .update(shopId)
    .digest("hex")
    .slice(0, 32);
}

async function main() {
  if (!APP_PUBLIC_URL) {
    console.error("✗ APP_PUBLIC_URL is required (e.g. https://shop.example.com).");
    process.exit(1);
  }
  if (APP_PUBLIC_URL.includes("localhost") || APP_PUBLIC_URL.includes("127.0.0.1")) {
    console.error(`✗ APP_PUBLIC_URL=${APP_PUBLIC_URL} is local. Webhook mode requires a public HTTPS URL.`);
    process.exit(1);
  }
  if (!ENCRYPTION_KEY) {
    console.error("✗ ENCRYPTION_KEY is required to decrypt bot tokens.");
    process.exit(1);
  }

  const where = SHOP_FILTER ? { shopId: SHOP_FILTER } : {};
  const configs = await prisma.botConfig.findMany({
    where: { ...where, telegramBotTokenEncrypted: { not: null } },
    select: { shopId: true, telegramBotTokenEncrypted: true, deliveryMode: true, webhookStatus: true, webhookUrl: true },
  });

  if (configs.length === 0) {
    console.log("ℹ No bot configs found with a token.");
    return;
  }

  console.log(`→ Found ${configs.length} bot config(s). DRY_RUN=${DRY_RUN}.`);
  let ok = 0;
  let fail = 0;

  for (const cfg of configs) {
    const token = decryptSecret(cfg.telegramBotTokenEncrypted, ENCRYPTION_KEY);
    if (!token) {
      console.warn(`  [shop ${cfg.shopId}] ✗ Could not decrypt token (key mismatch?). Skipping.`);
      fail++;
      continue;
    }
    const webhookUrl = `${APP_PUBLIC_URL}/api/v1/webhooks/telegram/${cfg.shopId}`;

    if (DRY_RUN) {
      console.log(`  [shop ${cfg.shopId}] would set webhookUrl=${webhookUrl} (current mode=${cfg.deliveryMode})`);
      ok++;
      continue;
    }

    try {
      // getMe first — a fast sanity check that the token is still valid before mutating webhook.
      // Telegram returns 401 on a revoked token; we want to surface that distinctly.
      const info = await telegramGetMe(token);
      await telegramSetWebhook(token, webhookUrl, buildTelegramWebhookSecret(cfg.shopId));
      await prisma.botConfig.update({
        where: { shopId: cfg.shopId },
        data: {
          telegramBotId: String(info.id),
          telegramBotUsername: info.username || null,
          webhookUrl,
          webhookStatus: "ACTIVE",
          deliveryMode: "WEBHOOK",
          lastVerifiedAt: new Date(),
        },
      });
      console.log(`  [shop ${cfg.shopId}] ✓ webhook → ${webhookUrl} (bot @${info.username})`);
      ok++;
    } catch (err) {
      console.error(`  [shop ${cfg.shopId}] ✗ ${err?.message || err}`);
      fail++;
    }
  }

  console.log(`\n→ Done. ok=${ok}, fail=${fail}.`);
}

main()
  .catch((err) => {
    console.error("Unexpected:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
