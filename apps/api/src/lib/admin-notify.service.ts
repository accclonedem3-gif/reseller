import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";

/**
 * Sends notifications to the platform admin (you) via a Telegram bot.
 *
 * Configured via env:
 *   ADMIN_TG_BOT_TOKEN — token of the Telegram bot used for admin alerts
 *   ADMIN_TG_CHAT_ID   — chat id (your @userinfobot id, or a private channel id)
 *
 * If either is missing, calls silently log to stdout and return — same
 * dry-run behavior other notification helpers use.
 *
 * All sends are fire-and-forget: errors are logged but never thrown, so
 * an admin-notification hiccup never blocks a business flow.
 */
@Injectable()
export class AdminNotifyService {
  private readonly logger = new Logger(AdminNotifyService.name);

  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async send(
    text: string,
    options?: {
      parseMode?: "HTML" | "Markdown";
      disableNotification?: boolean;
      level?: "info" | "warning" | "error";
      service?: string;
    },
  ) {
    const webhookUrl = this.config.adminAlertWebhookUrl;
    if (webhookUrl) {
      return this.sendViaWebhook(webhookUrl, text, options);
    }
    return this.sendViaTelegramDirect(text, options);
  }

  /** Send to an external alert bot (POST /alert with {level, service, message}). */
  private async sendViaWebhook(
    url: string,
    text: string,
    options?: { level?: "info" | "warning" | "error"; service?: string },
  ) {
    try {
      // The alert bot uses Markdown — strip HTML-only tags from the body.
      const plainText = text
        .replace(/<\/?b>/g, "*")
        .replace(/<\/?i>/g, "_")
        .replace(/<\/?code>/g, "`")
        .replace(/<[^>]+>/g, "");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: options?.level ?? "info",
          service: options?.service ?? "Reseller Platform",
          message: plainText,
        }),
      });
      if (!response.ok) {
        this.logger.warn(`[admin-notify] webhook returned ${response.status}: ${await response.text().catch(() => "")}`);
      }
    } catch (error) {
      this.logger.warn(`[admin-notify] webhook threw: ${(error as Error).message}`);
    }
  }

  /** Fallback: send directly via Telegram Bot API (uses ADMIN_TG_BOT_TOKEN / CHAT_ID). */
  private async sendViaTelegramDirect(
    text: string,
    options?: { parseMode?: "HTML" | "Markdown"; disableNotification?: boolean },
  ) {
    const token = this.config.adminTelegramBotToken;
    const chatId = this.config.adminTelegramChatId;
    if (!token || !chatId) {
      this.logger.log(`[admin-notify DRY] ${text.slice(0, 120)}...`);
      return;
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options?.parseMode ?? "HTML",
          disable_web_page_preview: true,
          disable_notification: options?.disableNotification ?? false,
        }),
      });
      if (!response.ok) {
        this.logger.warn(`[admin-notify] Telegram returned ${response.status}: ${await response.text().catch(() => "")}`);
      }
    } catch (error) {
      this.logger.warn(`[admin-notify] send threw: ${(error as Error).message}`);
    }
  }

  /** Helper: escape HTML so user content can't break parse_mode. */
  escape(value: string | null | undefined): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
