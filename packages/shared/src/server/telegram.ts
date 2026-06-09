import axios, { type AxiosRequestConfig } from "axios";

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramCommand {
  command: string;
  description: string;
}

async function callTelegramApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  config?: AxiosRequestConfig,
) {
  // Bounded retry for TRANSIENT failures only: HTTP 429 (honour Telegram's retry_after, so a
  // burst of warranty credential-delivery sends isn't silently dropped), 5xx, and network
  // timeouts. Deterministic errors (4xx bad-request / blocked bot / ok:false) are NOT retried.
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const maxAttempts = 3;
  let response: Awaited<ReturnType<typeof axios.post<{ ok: boolean; result: T; description?: string }>>> | null = null;
  let lastDesc = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await axios.post<{ ok: boolean; result: T; description?: string }>(url, body, {
        timeout: 10000,
        ...config,
        headers: {
          "Content-Type": "application/json",
          ...(config?.headers || {}),
        },
      });
      break;
    } catch (err: any) {
      lastDesc = err?.response?.data?.description || err?.message || String(err);
      const status = err?.response?.status;
      const retryAfter = Number(err?.response?.data?.parameters?.retry_after);
      const isRateLimited = status === 429;
      const isServer5xx = typeof status === "number" && status >= 500;
      // Ambiguous: request may have been DELIVERED but the response was lost (timeout / socket reset).
      const isAmbiguousNetwork = err?.code === "ECONNABORTED" || !err?.response;
      // Non-idempotent send methods: retrying an ambiguous-network failure could DUPLICATE the message
      // (e.g. send the warranty replacement credentials / an order twice). Only retry those on a
      // DEFINITE rejection (429/5xx = Telegram did not deliver). Reads/edits are idempotent → safe to
      // retry on network errors too, EXCEPT getUpdates (long-poll no-response is normal, not an error).
      const isSendMethod = /^(sendMessage|sendPhoto|sendDocument|copyMessage|sendMediaGroup)$/.test(method);
      const networkRetryable = isAmbiguousNetwork && !isSendMethod && method !== "getUpdates";
      const isTransient = isRateLimited || isServer5xx || networkRetryable;
      if (attempt >= maxAttempts || !isTransient) {
        throw new Error(`Telegram API method ${method} failed: ${lastDesc}`);
      }
      const waitMs = isRateLimited && Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15000)
        : Math.min(500 * 2 ** (attempt - 1), 4000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  if (!response || !response.data?.ok) {
    throw new Error(`Telegram API method ${method} failed: ${response?.data?.description || lastDesc}`);
  }

  return response.data.result;
}

export async function telegramGetMe(token: string) {
  return callTelegramApi<TelegramBotInfo>(token, "getMe");
}

export async function telegramSetWebhook(
  token: string,
  webhookUrl: string,
  secretToken?: string,
) {
  return callTelegramApi(token, "setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
    ...(secretToken
      ? {
          secret_token: secretToken,
        }
      : {}),
  });
}

export async function telegramDeleteWebhook(token: string) {
  return callTelegramApi(token, "deleteWebhook", {
    drop_pending_updates: false,
  });
}

export async function telegramSetCommands(token: string, commands: TelegramCommand[]) {
  return callTelegramApi(token, "setMyCommands", {
    commands,
  });
}

export async function telegramSendMessage(
  token: string,
  chatId: string | number,
  text: string,
  options?: Record<string, unknown>,
) {
  return callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    ...options,
  });
}

export async function telegramSendPhoto(
  token: string,
  chatId: string | number,
  photo: string,
  options?: Record<string, unknown>,
) {
  return callTelegramApi(token, "sendPhoto", {
    chat_id: chatId,
    photo,
    ...options,
  });
}

export async function telegramSendVideo(
  token: string,
  chatId: string | number,
  video: string,
  options?: Record<string, unknown>,
) {
  return callTelegramApi(token, "sendVideo", {
    chat_id: chatId,
    video,
    supports_streaming: true,
    ...options,
  });
}

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const cleaned = (String(url).split("?")[0] ?? "").toLowerCase();
  return /\.(mp4|mov|webm|m4v)$/i.test(cleaned);
}

export async function telegramSendDocument(
  token: string,
  chatId: string | number,
  documentBuffer: Buffer,
  filename: string,
  options?: Record<string, unknown>,
): Promise<{ message_id: number }> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  const ab = documentBuffer.buffer.slice(
    documentBuffer.byteOffset,
    documentBuffer.byteOffset + documentBuffer.byteLength,
  ) as ArrayBuffer;
  form.append("document", new Blob([ab], { type: "text/plain; charset=utf-8" }), filename);
  for (const [key, value] of Object.entries(options || {})) {
    if (value !== undefined && value !== null) {
      form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  let response: any;
  try {
    response = await axios.post(
      `https://api.telegram.org/bot${token}/sendDocument`,
      form,
      { timeout: 30000, maxContentLength: Infinity, maxBodyLength: Infinity },
    );
  } catch (err: any) {
    const desc = err?.response?.data?.description || err?.message || String(err);
    throw new Error(`Telegram API method sendDocument failed: ${desc}`);
  }
  if (!response.data?.ok) {
    throw new Error(`Telegram API method sendDocument failed: ${response.data?.description || "unknown"}`);
  }
  return response.data.result as { message_id: number };
}

export async function telegramSendPhotoBuffer(
  token: string,
  chatId: string | number,
  photoBuffer: Buffer,
  options?: Record<string, unknown>,
): Promise<{ message_id: number }> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  const ab = photoBuffer.buffer.slice(photoBuffer.byteOffset, photoBuffer.byteOffset + photoBuffer.byteLength) as ArrayBuffer;
  form.append("photo", new Blob([ab], { type: "image/png" }), "qr.png");
  for (const [key, value] of Object.entries(options || {})) {
    if (value !== undefined && value !== null) {
      form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  let response: any;
  try {
    response = await axios.post(
      `https://api.telegram.org/bot${token}/sendPhoto`,
      form,
      { timeout: 15000 },
    );
  } catch (err: any) {
    const desc = err?.response?.data?.description || err?.message || String(err);
    throw new Error(`Telegram API method sendPhoto (buffer) failed: ${desc}`);
  }
  if (!response.data?.ok) {
    throw new Error(`Telegram API method sendPhoto (buffer) failed: ${response.data?.description || "unknown"}`);
  }
  return response.data.result as { message_id: number };
}

export async function telegramEditMessageText(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  options?: Record<string, unknown>,
) {
  return callTelegramApi(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...options,
  });
}

export async function telegramAnswerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  options?: { showAlert?: boolean },
) {
  return callTelegramApi(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    ...(options?.showAlert ? { show_alert: true } : {}),
  });
}

export async function telegramDeleteMessage(
  token: string,
  chatId: string | number,
  messageId: number,
) {
  return callTelegramApi(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

export async function telegramGetUpdates(
  token: string,
  offset?: number,
  timeout = 15,
) {
  return callTelegramApi<Record<string, unknown>[]>(
    token,
    "getUpdates",
    {
      offset,
      timeout,
      allowed_updates: ["message", "callback_query"],
    },
  );
}
