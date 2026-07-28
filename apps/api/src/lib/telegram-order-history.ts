export const ORDER_HISTORY_PAGE_SIZE = 6;
export const ORDER_DELIVERY_CHUNK_SIZE = 3_000;

export type TelegramChatIdentity = {
  id?: string | number | null;
  type?: string | null;
};

export function isPrivateTelegramChat(
  chat: TelegramChatIdentity | null | undefined,
  fromUserId: string | number | null | undefined,
): boolean {
  if (!chat?.id || !fromUserId) return false;

  const chatType = String(chat.type || "").trim().toLowerCase();
  if (chatType) {
    return chatType === "private" && String(chat.id) === String(fromUserId);
  }

  // Telegram always supplies chat.type. This fallback keeps local simulation
  // and legacy fixtures working while still rejecting a mismatched/group id.
  return String(chat.id) === String(fromUserId);
}

export function resolveOrderHistoryPage(
  requestedPage: number,
  totalOrders: number,
  pageSize = ORDER_HISTORY_PAGE_SIZE,
) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const safeTotal = Math.max(0, Math.floor(totalOrders));
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const normalizedRequest = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const page = Math.min(Math.max(0, normalizedRequest), totalPages - 1);

  return {
    page,
    totalPages,
    skip: page * safePageSize,
    take: safePageSize,
  };
}

export function splitTelegramText(
  value: string | null | undefined,
  maxLength = ORDER_DELIVERY_CHUNK_SIZE,
): string[] {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const safeLimit = Math.max(100, Math.floor(maxLength));
  const chunks: string[] = [];
  let offset = 0;

  while (offset < normalized.length) {
    let end = Math.min(normalized.length, offset + safeLimit);
    if (end < normalized.length) {
      const newline = normalized.lastIndexOf("\n", end - 1);
      if (newline >= offset + Math.floor(safeLimit * 0.4)) {
        end = newline + 1;
      } else {
        const previousCode = normalized.charCodeAt(end - 1);
        const nextCode = normalized.charCodeAt(end);
        if (
          previousCode >= 0xd800 &&
          previousCode <= 0xdbff &&
          nextCode >= 0xdc00 &&
          nextCode <= 0xdfff
        ) {
          end -= 1;
        }
      }
    }

    chunks.push(normalized.slice(offset, end));
    offset = end;
  }

  return chunks;
}

export function buildOwnedOrderWhere(shopId: string, telegramUserId: string, orderId: string) {
  return {
    id: orderId,
    shopId,
    customer: {
      telegramUserId,
    },
  } as const;
}
