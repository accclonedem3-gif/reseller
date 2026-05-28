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
  let response: Awaited<ReturnType<typeof axios.post<{ ok: boolean; result: T; description?: string }>>>;
  try {
    response = await axios.post<{ ok: boolean; result: T; description?: string }>(
      `https://api.telegram.org/bot${token}/${method}`,
      body,
      {
        timeout: 10000,
        ...config,
        headers: {
          "Content-Type": "application/json",
          ...(config?.headers || {}),
        },
      },
    );
  } catch (err: any) {
    const desc = err?.response?.data?.description || err?.message || String(err);
    throw new Error(`Telegram API method ${method} failed: ${desc}`);
  }

  if (!response.data?.ok) {
    throw new Error(`Telegram API method ${method} failed: ${response.data?.description || "unknown"}`);
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
