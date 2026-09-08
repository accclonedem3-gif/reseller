import { Inject, Injectable } from "@nestjs/common";
import {
  isMockBotToken,
  telegramAnswerCallbackQuery,
  telegramEditMessageCaption,
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
    return (
      this.isSimulationToken(token) ||
      (this.config.mockTelegramEnabled && isMockBotToken(token))
    );
  }

  hasInlineEmojiIds(markup: Record<string, unknown> | undefined): boolean {
    if (!markup?.inline_keyboard || !Array.isArray(markup.inline_keyboard))
      return false;
    return (markup.inline_keyboard as unknown[][]).some(
      (row) =>
        Array.isArray(row) &&
        row.some(
          (btn) =>
            btn &&
            typeof btn === "object" &&
            "icon_custom_emoji_id" in (btn as object),
        ),
    );
  }

  stripInlineEmojiIds(
    markup: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!markup?.inline_keyboard || !Array.isArray(markup.inline_keyboard))
      return markup;
    return {
      ...markup,
      inline_keyboard: (markup.inline_keyboard as unknown[][]).map((row) =>
        row.map((btn) => {
          if (btn && typeof btn === "object") {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { icon_custom_emoji_id: _, ...rest } = btn as Record<
              string,
              unknown
            >;
            return rest;
          }
          return btn;
        }),
      ),
    };
  }

  /** Keep the visible fallback emoji while removing Telegram custom-emoji HTML entities. */
  stripTextEmojiIds(text: string): string {
    return text.replace(
      /<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi,
      (_match, fallback: string) => fallback,
    );
  }

  /** Build variants that replace exactly one custom emoji with its visible fallback. */
  stripEachTextEmojiId(text: string): string[] {
    const pattern = /<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi;
    const matches = Array.from(text.matchAll(pattern));
    return matches.map((match) => {
      const start = match.index ?? 0;
      return (
        text.slice(0, start) +
        (match[1] || String()) +
        text.slice(start + match[0].length)
      );
    });
  }

  // Telegram requires icon_custom_emoji_id to be a valid int64 number string. A single bad value
  // (non-digit, empty, or overflow) makes Telegram reject the WHOLE sendMessage/editMessageText
  // ("Field icon_custom_emoji_id must be a valid Number") → the catch then strips ALL bling. So we
  // drop only the INVALID ids here before sending: valid cusids keep their bling, the bad button
  // just falls back to its text icon, and the message goes through. One bad row never kills the page.
  private static isValidCusid(id: unknown): boolean {
    const s = String(id ?? "").trim();
    if (!/^\d{1,19}$/.test(s)) return false;
    try {
      const n = BigInt(s);
      return n > 0n && n <= 9223372036854775807n;
    } catch {
      return false;
    }
  }

  sanitizeInlineEmojiIds(
    markup: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!markup?.inline_keyboard || !Array.isArray(markup.inline_keyboard))
      return markup;
    const dropped: string[] = [];
    const inline_keyboard = (markup.inline_keyboard as unknown[][]).map(
      (row) =>
        Array.isArray(row)
          ? row.map((btn) => {
              if (
                btn &&
                typeof btn === "object" &&
                "icon_custom_emoji_id" in (btn as object)
              ) {
                const b = btn as Record<string, unknown>;
                if (
                  !TelegramClientService.isValidCusid(b.icon_custom_emoji_id)
                ) {
                  dropped.push(String(b.icon_custom_emoji_id ?? ""));
                  const { icon_custom_emoji_id: _drop, ...rest } = b;
                  return rest;
                }
              }
              return btn;
            })
          : row,
    );
    if (dropped.length > 0) {
      console.error(
        "[bling] dropped invalid icon_custom_emoji_id:",
        JSON.stringify(dropped),
      );
    }
    return { ...markup, inline_keyboard };
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
      return this.editText(
        token,
        chatId,
        messageId,
        text,
        replyMarkup,
        actions,
        parseMode,
      );
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
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
      custom_emoji_id?: string;
    }>,
    // Called when the send only succeeded AFTER stripping custom-emoji ids — i.e. this bot can't emit
    // them (used to self-learn that the owner isn't premium so we fall back to text icons).
    onCusidStripped?: () => void | Promise<void>,
  ) {
    if (this.isMockOrSimulation(token)) {
      const mockResult = { message_id: actions.length + 1 };
      actions.push({
        type: "sendMessage",
        chatId,
        text,
        replyMarkup,
        parseMode,
      });
      return mockResult;
    }

    replyMarkup = this.sanitizeInlineEmojiIds(replyMarkup);
    const hasTextEmojiIds = /<tg-emoji\b/i.test(text);
    return telegramSendMessage(token, chatId, text, {
      reply_markup: replyMarkup,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      ...(entities && entities.length > 0 ? { entities } : {}),
    }).catch(async (err: unknown) => {
      const hasInlineEmojiIds = !!(
        replyMarkup && this.hasInlineEmojiIds(replyMarkup)
      );
      if (!hasInlineEmojiIds && !hasTextEmojiIds) throw err;
      // Retry once unchanged to cover transient Telegram errors. If that still fails, isolate one
      // bad body cusid at a time. A manually configured product icon may be invalid while all of the
      // template + button cusids remain valid; never erase the whole visual template for one bad id.
      try {
        return await telegramSendMessage(token, chatId, text, {
          reply_markup: replyMarkup,
          ...(parseMode ? { parse_mode: parseMode } : {}),
          ...(entities && entities.length > 0 ? { entities } : {}),
        });
      } catch {
        if (hasTextEmojiIds) {
          for (const textWithoutOneCusid of this.stripEachTextEmojiId(text)) {
            try {
              return await telegramSendMessage(
                token,
                chatId,
                textWithoutOneCusid,
                {
                  reply_markup: replyMarkup,
                  ...(parseMode ? { parse_mode: parseMode } : {}),
                },
              );
            } catch {
              // Try the next body cusid; one malformed id rejects the whole Telegram message.
            }
          }
        }

        // No single body cusid was the culprit. Isolate button cusids while retaining the complete
        // message body, since inline-button custom emoji support is a separate Telegram capability.
        const plainMarkup = this.stripInlineEmojiIds(replyMarkup);
        if (hasInlineEmojiIds) {
          try {
            const res = await telegramSendMessage(token, chatId, text, {
              reply_markup: plainMarkup,
              ...(parseMode ? { parse_mode: parseMode } : {}),
              ...(entities && entities.length > 0 ? { entities } : {}),
            });
            await onCusidStripped?.();
            return res;
          } catch {
            // The body custom emoji is also unsupported/invalid; fall through to visible text emoji.
          }
        }

        const res = await telegramSendMessage(
          token,
          chatId,
          this.stripTextEmojiIds(text),
          {
            reply_markup: plainMarkup,
            ...(parseMode ? { parse_mode: parseMode } : {}),
          },
        );
        await onCusidStripped?.();
        return res;
      }
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
      actions.push({
        type: "sendPhoto",
        chatId,
        photo: Buffer.isBuffer(photo) ? "[buffer]" : photo,
        caption,
        replyMarkup,
        parseMode,
      });
      return null;
    }

    replyMarkup = this.sanitizeInlineEmojiIds(replyMarkup);
    const sendWithMarkup = (markup: Record<string, unknown> | undefined) => {
      const options = {
        caption,
        reply_markup: markup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      };
      return Buffer.isBuffer(photo)
        ? telegramSendPhotoBuffer(token, chatId, photo, options)
        : telegramSendPhoto(token, chatId, photo, options);
    };

    try {
      const result = (await sendWithMarkup(replyMarkup)) as
        | { message_id: number }
        | undefined;
      return result?.message_id ?? null;
    } catch {
      if (this.hasInlineEmojiIds(replyMarkup)) {
        try {
          const result = (await sendWithMarkup(
            this.stripInlineEmojiIds(replyMarkup),
          )) as { message_id: number } | undefined;
          return result?.message_id ?? null;
        } catch {
          // The photo/caption itself failed; fall back to a text Home message below.
        }
      }

      const result = (await this.sendText(
        token,
        chatId,
        caption,
        actions,
        replyMarkup,
        parseMode,
      )) as { message_id: number } | undefined;
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
    onCusidStripped?: () => void | Promise<void>,
    resendOnFailure = true,
  ) {
    if (this.isMockOrSimulation(token)) {
      actions.push({
        type: "editMessageText",
        chatId,
        messageId,
        text,
        replyMarkup,
        parseMode,
      });
      return;
    }

    replyMarkup = this.sanitizeInlineEmojiIds(replyMarkup) ?? replyMarkup;
    await telegramEditMessageText(token, chatId, messageId, text, {
      reply_markup: replyMarkup,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }).catch(async (err: unknown) => {
      // Content is byte-identical (e.g. re-tapping the same nav button) — the current message already
      // shows this view WITH its bling, so do nothing rather than resend a stripped duplicate.
      if (
        String((err as Error)?.message || "")
          .toLowerCase()
          .includes("not modified")
      )
        return;
      if (!resendOnFailure) {
        const plainMarkup =
          this.stripInlineEmojiIds(replyMarkup) ?? replyMarkup;
        const plainText = this.stripTextEmojiIds(text);
        try {
          await telegramEditMessageText(token, chatId, messageId, plainText, {
            reply_markup: plainMarkup,
            ...(parseMode ? { parse_mode: parseMode } : {}),
          });
          if (plainMarkup !== replyMarkup || plainText !== text) {
            await onCusidStripped?.();
          }
        } catch {
          // The original Home message is already visible. Never send a second copy.
        }
        return;
      }
      // The edit itself failed (message too old / not editable / transient). Resend — but KEEP the
      // custom emoji; only strip if Telegram actually rejects the emoji on the resend. Previously we
      // stripped on EVERY edit failure, which silently killed the catalog bling on unrelated errors.
      const hasEmoji = this.hasInlineEmojiIds(replyMarkup);
      const opts = (markup: Record<string, unknown> | undefined) => ({
        reply_markup: markup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      });
      try {
        await telegramSendMessage(token, chatId, text, opts(replyMarkup));
      } catch (err2) {
        if (!hasEmoji) throw err2;
        await telegramSendMessage(
          token,
          chatId,
          text,
          opts(this.stripInlineEmojiIds(replyMarkup)),
        );
        await onCusidStripped?.();
      }
    });
  }

  async editCaption(
    token: string,
    chatId: string | number,
    messageId: number,
    caption: string,
    replyMarkup: Record<string, unknown>,
    actions: unknown[],
    parseMode?: "HTML" | "Markdown",
    onCusidStripped?: () => void | Promise<void>,
  ) {
    if (this.isMockOrSimulation(token)) {
      actions.push({
        type: "editMessageCaption",
        chatId,
        messageId,
        caption,
        replyMarkup,
        parseMode,
      });
      return;
    }

    replyMarkup = this.sanitizeInlineEmojiIds(replyMarkup) ?? replyMarkup;
    try {
      await telegramEditMessageCaption(token, chatId, messageId, caption, {
        reply_markup: replyMarkup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      });
    } catch (error) {
      if (
        String((error as Error)?.message || "")
          .toLowerCase()
          .includes("not modified")
      ) {
        return;
      }

      const plainMarkup = this.stripInlineEmojiIds(replyMarkup) ?? replyMarkup;
      const plainCaption = this.stripTextEmojiIds(caption);
      try {
        await telegramEditMessageCaption(
          token,
          chatId,
          messageId,
          plainCaption,
          {
            reply_markup: plainMarkup,
            ...(parseMode ? { parse_mode: parseMode } : {}),
          },
        );
        if (plainMarkup !== replyMarkup || plainCaption !== caption) {
          await onCusidStripped?.();
        }
      } catch {
        // Editing a caption must never fall back to a duplicate Home message.
      }
    }
  }

  async answerCallback(
    token: string,
    callbackQueryId: string,
    actions: unknown[],
  ) {
    if (this.isMockOrSimulation(token)) {
      actions.push({ type: "answerCallbackQuery", callbackQueryId });
      return;
    }

    await telegramAnswerCallbackQuery(token, callbackQueryId).catch(
      () => undefined,
    );
  }
}
