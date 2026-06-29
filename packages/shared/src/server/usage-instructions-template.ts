import { telegramSendMessage } from "./telegram";

export interface UsageInstructionsTemplateConfig {
  /** Header text shown above the instructions body. */
  headerText: string;
  /** Fallback emoji shown when no custom emoji ID is set. Used once if headerEmojiIds is empty. */
  headerIcon: string;
  /**
   * Array of Telegram custom emoji IDs rendered side-by-side on the header line.
   * Supports multiple at once. Each entry is a tg-emoji entity with the fallback = headerIcon.
   */
  headerEmojiIds: string[];
  /** Optional footer text. */
  footer: string;
}

export const DEFAULT_USAGE_INSTRUCTIONS_TEMPLATE: UsageInstructionsTemplateConfig = {
  headerText: "HƯỚNG DẪN SỬ DỤNG",
  headerIcon: "📖",
  headerEmojiIds: [],
  footer: "",
};

function escHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderEmojiRow(icon: string, ids: string[]): string {
  const fb = icon || "📖";
  if (!ids || ids.length === 0) return fb;
  return ids.map((id) => {
    const cleaned = (id || "").trim();
    if (!cleaned) return fb;
    return `<tg-emoji emoji-id="${escHtml(cleaned)}">${escHtml(fb)}</tg-emoji>`;
  }).join("");
}

export function resolveUsageInstructionsTemplate(
  shopCust: Record<string, any> | null | undefined,
  adminCust: Record<string, any> | null | undefined,
): UsageInstructionsTemplateConfig {
  const merged: UsageInstructionsTemplateConfig = {
    ...DEFAULT_USAGE_INSTRUCTIONS_TEMPLATE,
    headerEmojiIds: [],
  };

  const apply = (src: Partial<UsageInstructionsTemplateConfig> | null | undefined) => {
    if (!src || typeof src !== "object") return;
    if (typeof src.headerText === "string") merged.headerText = src.headerText;
    if (typeof src.headerIcon === "string" && src.headerIcon.trim()) merged.headerIcon = src.headerIcon;
    if (Array.isArray(src.headerEmojiIds)) {
      merged.headerEmojiIds = src.headerEmojiIds.filter((id) => typeof id === "string" && id.trim());
    }
    if (typeof src.footer === "string") merged.footer = src.footer;
  };

  const adminTpl = (adminCust?.usageInstructionsTemplate ?? null) as Partial<UsageInstructionsTemplateConfig> | null;
  const shopTpl = (shopCust?.usageInstructionsTemplate ?? null) as Partial<UsageInstructionsTemplateConfig> | null;
  apply(adminTpl);
  apply(shopTpl);
  return merged;
}

export function renderUsageInstructionsHtml(
  template: UsageInstructionsTemplateConfig,
  instructionsText: string,
): string {
  const emojiRow = renderEmojiRow(template.headerIcon, template.headerEmojiIds);
  const headerText = (template.headerText || DEFAULT_USAGE_INSTRUCTIONS_TEMPLATE.headerText).trim();
  const lines: string[] = [];
  lines.push(`${emojiRow} <b>${escHtml(headerText)}</b>`);
  lines.push("");
  lines.push(escHtml(instructionsText.trim()));
  const footer = (template.footer || "").trim();
  if (footer) {
    lines.push("");
    lines.push(escHtml(footer));
  }
  return lines.join("\n");
}

/** Strip `<tg-emoji emoji-id="X">FB</tg-emoji>` down to its fallback `FB`. */
function stripCustomEmojiHtml(html: string): string {
  return html.replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi, "$1");
}

export interface SendUsageInstructionsOptions {
  botToken: string;
  chatId: string | number;
  template: UsageInstructionsTemplateConfig;
  instructionsText: string;
  canEmitCusid?: boolean;
}

export async function sendUsageInstructionsMessage(
  opts: SendUsageInstructionsOptions,
): Promise<void> {
  const { botToken, chatId, template, instructionsText, canEmitCusid = true } = opts;
  const text = renderUsageInstructionsHtml(template, instructionsText);
  const hasCusid = /<tg-emoji\b/i.test(text);

  if (hasCusid && !canEmitCusid) {
    await telegramSendMessage(botToken, chatId, stripCustomEmojiHtml(text), { parse_mode: "HTML" }).catch(() => undefined);
    return;
  }

  try {
    await telegramSendMessage(botToken, chatId, text, { parse_mode: "HTML" });
  } catch {
    if (!hasCusid) return;
    await telegramSendMessage(botToken, chatId, stripCustomEmojiHtml(text), { parse_mode: "HTML" }).catch(() => undefined);
  }
}
