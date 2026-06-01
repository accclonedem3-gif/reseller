import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Parses a MAIL_FROM string like "Name <email@domain.com>" or "email@domain.com"
 * into separate name + email fields (Brevo requires the structured form).
 */
function parseFromAddress(raw: string): { name?: string; email: string } {
  const match = raw.match(/^\s*(?:"?([^"<]+?)"?\s+)?<?([^<>\s]+@[^<>\s]+)>?\s*$/);
  if (match && match[2]) {
    return { name: match[1]?.trim() || undefined, email: match[2].trim() };
  }
  return { email: raw.trim() };
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async send(msg: MailMessage): Promise<void> {
    const provider = this.config.mailProvider;
    if (!provider) {
      this.logger.log(`[mail DRY] to=${msg.to} subject="${msg.subject}" (no provider configured)`);
      return;
    }

    if (provider === "brevo") {
      return this.sendViaBrevo(msg);
    }
    return this.sendViaResend(msg);
  }

  private async sendViaBrevo(msg: MailMessage): Promise<void> {
    const key = this.config.brevoApiKey;
    if (!key) {
      this.logger.warn(`[mail brevo] BREVO_API_KEY missing — falling back to dry run`);
      return;
    }
    const sender = parseFromAddress(this.config.mailFrom);
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender,
          to: [{ email: msg.to }],
          subject: msg.subject,
          htmlContent: msg.html,
          textContent: msg.text,
        }),
      });
      if (!response.ok) {
        this.logger.error(
          `[mail brevo] send failed ${response.status}: ${await response.text().catch(() => "")}`,
        );
      }
    } catch (error) {
      this.logger.error(`[mail brevo] send threw: ${(error as Error).message}`);
    }
  }

  private async sendViaResend(msg: MailMessage): Promise<void> {
    const key = this.config.resendApiKey;
    if (!key) {
      this.logger.warn(`[mail resend] RESEND_API_KEY missing — dry run`);
      return;
    }
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.mailFrom,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
      });
      if (!response.ok) {
        this.logger.error(
          `[mail resend] send failed ${response.status}: ${await response.text().catch(() => "")}`,
        );
      }
    } catch (error) {
      this.logger.error(`[mail resend] send threw: ${(error as Error).message}`);
    }
  }
}
