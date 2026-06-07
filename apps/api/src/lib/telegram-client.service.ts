import { Inject, Injectable } from "@nestjs/common";
import {
  isMockBotToken,
  telegramAnswerCallbackQuery,
  telegramEditMessageText,
  telegramSendMessage,
  telegramSendPhoto,
  telegramSendPhotoBuffer,
} from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";

/**
 * Thin Telegram transport layer (extracted from TelegramBotService).
 *
 * Owns: send/edit message, send photo (buffer or URL), answer callback, plus
 * the simulation-token + custom-emoji-fallback plumbing. Short-circuits to the
 * `actions[]` accumulator when running against a mock/simulation bot token so
 * no real Telegram call is made.
 *
 * Pure transport — no business logic, no DB, no Redis. Behaviour is identical
 * to the original inline methods; TelegramBotService now delegates to this.
 */
@Injectable()
export class TelegramClientService {
  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  createSimulationToken(token: string) {
    return `simulate:${token}`;
  }

  isSimulationToken(token: string) {
    return String(token || "").startsWith("simulate:");
  }

  private isMockOrSimulation(token: string) {
    return this.isSimulationToken(token) || (this.config.mockTelegramEnabled && isMockBotToken(token));
  }

  hasInlineEmojiIds(markup: Record<string, unknown> | undefined): boolean {
    if (!markup?.inline_keyboard || !Array.isArray(markup.inline_keyboard)) return false;
    return (markup.inline_keyboard as unknown[][]).some((row) =>
      Array.isArray(row) && row.some((btn) => btn && typeof btn === "object" && "icon_custom_emoji_id" in (btn as object)),
    );
  }

  stripInlineEmojiIds(markup: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!markup?.inline_keyboard || !Array.isArray(markup.inline_keyboard)) return markup;
    return {
      ...markup,
      inline_keyboard: (markup.inline_keyboard as unknown[][]).map((row) =>
        row.map((btn) => {
          if (btn && typeof btn === "object") {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { icon_custom_emoji_id: _, ...rest } = btn as Record<string, unknown>;
            return rest;
          }
          return btn;
        }),
      ),
    };
  }

  async editOrSend(
    token: string,
    chatId: number,
    messageId: number | undefined,
    text: string,
    replyMarkup: Record<string, unknown>,
    actions: unknown[],
    parseMode?: "HTML" | "Markdown",
  ) {
    if (messageId) {
      return this.editText(token, chatId, messageId, text, replyMarkup, actions, parseMode);
    }

    return this.sendText(token, chatId, text, actions, replyMarkup, parseMode);
  }

  async sendText(
    token: string,
    chatId: string | number,
    text: string,
    actions: unknown[],
    replyMarkup?: Record<string, unknown>,
    parseMode?: "HTML" | "Markdown",
    entities?: Array<{ type: string; offset: number; length: number; custom_emoji_id?: string }>,
  ) {
    if (this.isMockOrSimulation(token)) {
      const mockResult = { message_id: actions.length + 1 };
      actions.push({ type: "sendMessage", chatId, text, replyMarkup, parseMode });
      return mockResult;
    }

    return telegramSendMessage(token, chatId, text, {
      reply_markup: replyMarkup,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(entities && entities.length > 0 ? { entities } : {}),
    }).catch(async (err: unknown) => {
      if (replyMarkup && this.hasInlineEmojiIds(replyMarkup)) {
        return telegramSendMessage(token, chatId, text, {
          reply_markup: this.stripInlineEmojiIds(replyMarkup),
          ...(parseMode ? { parse_mode: parseMode } : {}),
        });
      }
      throw err;
    });
  }

  async sendPhoto(
    token: string,
    chatId: string | number,
    photo: string | Buffer,
    caption: string,
    actions: unknown[],
    replyMarkup?: Record<string, unknown>,
    parseMode?: "HTML" | "Markdown",
  ): Promise<number | null> {
    if (this.isMockOrSimulation(token)) {
      actions.push({ type: "sendPhoto", chatId, photo: Buffer.isBuffer(photo) ? "[buffer]" : photo, caption, replyMarkup, parseMode });
      return null;
    }

    try {
      const options = {
        caption,
        reply_markup: replyMarkup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      };
      const result = Buffer.isBuffer(photo)
        ? await telegramSendPhotoBuffer(token, chatId, photo, options)
        : await telegramSendPhoto(token, chatId, photo, options) as { message_id: number } | undefined;
      return result?.message_id ?? null;
    } catch {
      const result = await telegramSendMessage(token, chatId, caption, {
        reply_markup: replyMarkup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }) as { message_id: number } | undefined;
      return result?.message_id ?? null;
    }
  }

  async editText(
    token: string,
    chatId: string | number,
    messageId: number,
    text: string,
    replyMarkup: Record<string, unknown>,
    actions: unknown[],
    parseMode?: "HTML" | "Markdown",
  ) {
    if (this.isMockOrSimulation(token)) {
      actions.push({ type: "editMessageText", chatId, messageId, text, replyMarkup, parseMode });
      return;
    }

    await telegramEditMessageText(token, chatId, messageId, text, {
      reply_markup: replyMarkup,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }).catch(async () => {
      await telegramSendMessage(token, chatId, text, {
        reply_markup: this.hasInlineEmojiIds(replyMarkup) ? this.stripInlineEmojiIds(replyMarkup) : replyMarkup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      });
    });
  }

  async answerCallback(token: string, callbackQueryId: string, actions: unknown[]) {
    if (this.isMockOrSimulation(token)) {
      actions.push({ type: "answerCallbackQuery", callbackQueryId });
      return;
    }

    await telegramAnswerCallbackQuery(token, callbackQueryId).catch(() => undefined);
  }
}
