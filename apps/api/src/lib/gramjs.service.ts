import { Injectable, Inject, OnModuleDestroy } from "@nestjs/common";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import { AppConfigService } from "../config/app-config.service";

// Custom emoji document_id -> fallback char mapping
// Sellers can add more via mini app
export interface CustomEmojiButton {
  text: string;        // button label (without emoji)
  callbackData: string;
  emojiDocumentId?: bigint; // custom emoji ID
  emojiFallback?: string;   // fallback unicode char
}

@Injectable()
export class GramJsService implements OnModuleDestroy {
  private clients = new Map<string, TelegramClient>();

  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async onModuleDestroy() {
    for (const client of this.clients.values()) {
      await client.disconnect().catch(() => {});
    }
  }

  private async getClient(botToken: string): Promise<TelegramClient> {
    if (this.clients.has(botToken)) {
      const c = this.clients.get(botToken)!;
      if (c.connected) return c;
    }

    const client = new TelegramClient(
      new StringSession(""),
      this.config.telegramApiId,
      this.config.telegramApiHash,
      { connectionRetries: 3, useWSS: false },
    );

    await client.start({ botAuthToken: botToken });
    this.clients.set(botToken, client);
    return client;
  }

  // Send or edit a message with inline keyboard supporting custom emoji in button text
  async sendMessageWithCustomEmoji(opts: {
    botToken: string;
    chatId: number;
    text: string;
    parseMode?: "html";
    rows: CustomEmojiButton[][];
  }) {
    const client = await this.getClient(opts.botToken);
    const peer = await client.getInputEntity(opts.chatId);

    const rows = opts.rows.map(
      (row) =>
        new Api.KeyboardButtonRow({
          buttons: row.map((btn) => {
            const buttonText = btn.emojiDocumentId
              ? (btn.emojiFallback ?? "●") + " " + btn.text
              : btn.text;

            return new Api.KeyboardButtonCallback({
              text: buttonText,
              data: Buffer.from(btn.callbackData),
            });
          }),
        }),
    );

    const [message, entities] = opts.parseMode === "html" && client.parseMode
      ? client.parseMode.parse(opts.text)
      : [opts.text, []] as [string, Api.TypeMessageEntity[]];

    // Attach custom emoji entities to button text if emojiDocumentId provided
    // Note: this is applied to message text entities, not button text
    const customEmojiEntities = (entities ?? []) as Api.TypeMessageEntity[];

    const result = await client.invoke(
      new Api.messages.SendMessage({
        peer,
        message: String(message),
        entities: customEmojiEntities.length ? customEmojiEntities : undefined,
        replyMarkup: new Api.ReplyInlineMarkup({ rows }),
        noWebpage: true,
      }),
    );

    return result;
  }

  async editMessageWithCustomEmoji(opts: {
    botToken: string;
    chatId: number;
    messageId: number;
    text: string;
    parseMode?: "html";
    rows: CustomEmojiButton[][];
  }) {
    const client = await this.getClient(opts.botToken);
    const peer = await client.getInputEntity(opts.chatId);

    const rows = opts.rows.map(
      (row) =>
        new Api.KeyboardButtonRow({
          buttons: row.map((btn) => {
            const buttonText = btn.emojiDocumentId
              ? (btn.emojiFallback ?? "●") + " " + btn.text
              : btn.text;
            return new Api.KeyboardButtonCallback({
              text: buttonText,
              data: Buffer.from(btn.callbackData),
            });
          }),
        }),
    );

    const [message, entities] = opts.parseMode === "html" && client.parseMode
      ? client.parseMode.parse(opts.text)
      : [opts.text, []] as [string, Api.TypeMessageEntity[]];

    const customEmojiEntities = (entities ?? []) as Api.TypeMessageEntity[];

    const result = await client.invoke(
      new Api.messages.EditMessage({
        peer,
        id: opts.messageId,
        message: String(message),
        entities: customEmojiEntities.length ? customEmojiEntities : undefined,
        replyMarkup: new Api.ReplyInlineMarkup({ rows }),
        noWebpage: true,
      }),
    );

    return result;
  }

  // Check if service is usable
  isConfigured(): boolean {
    return this.config.telegramApiId > 0 && this.config.telegramApiHash.length > 0;
  }
}
