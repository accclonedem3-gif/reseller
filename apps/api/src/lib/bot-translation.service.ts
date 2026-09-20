import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { CacheService } from "./cache.service";
import { BotLanguage } from "./bot-render.helpers";

@Injectable()
export class BotTranslationService {
  private readonly logger = new Logger(BotTranslationService.name);

  // Map bot language to Google Translate target language code
  private readonly TARGET_LANG_MAP: Record<BotLanguage, string> = {
    vi: "vi",
    en: "en",
    th: "th",
    zh: "zh-CN",
  };

  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

  /**
   * Translates arbitrary text into the target bot language.
   * - Uses Google Translate clients5 Chrome extension endpoint (fast, auto-detects source language).
   * - Caches results in Redis with a 14-day TTL using MD5 key hash.
   * - Times out after 3 seconds and fails open (returns original text on any error/timeout).
   */
  async translateText(
    text: string | null | undefined,
    targetLanguage: BotLanguage,
  ): Promise<string> {
    const raw = (text || "").trim();
    if (!raw) return "";

    // If target language is Vietnamese and text already contains Vietnamese diacritics/keywords,
    // skip network/cache entirely for maximum responsiveness.
    if (targetLanguage === "vi" && this.isLikelyVietnamese(raw)) {
      return raw;
    }

    // If string has no alphabetic characters (only numbers, punctuation, emojis), return as is.
    if (!/[a-zA-Z\u00C0-\u1EF9\u0E00-\u0E7F\u4E00-\u9FFF]/.test(raw)) {
      return raw;
    }

    const targetLangCode =
      this.TARGET_LANG_MAP[targetLanguage] || targetLanguage;
    const hash = createHash("md5").update(raw).digest("hex");
    const cacheKey = `bot:trans:${targetLangCode}:${hash}`;

    // 1. Try Redis cache first
    try {
      const cached = await this.cache.get<string>(cacheKey);
      if (cached) return cached;
    } catch {
      // Ignore cache failure and continue to fetch
    }

    // 2. Fetch from Google Translate clients5 endpoint
    try {
      const params = new URLSearchParams({ q: raw });
      const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(targetLangCode)}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        body: params.toString(),
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        this.logger.warn(
          `Google translate returned status ${res.status} for target ${targetLangCode}`,
        );
        return raw;
      }

      const data = await res.json();
      let translatedText: string | null = null;

      if (Array.isArray(data)) {
        if (Array.isArray(data[0]) && typeof data[0][0] === "string") {
          translatedText = data[0][0];
        } else if (typeof data[0] === "string") {
          translatedText = data[0];
        }
      }

      if (translatedText && translatedText.trim()) {
        const result = translatedText.trim();
        // Save to Redis cache (14 days = 1,209,600 seconds)
        await this.cache
          .set(cacheKey, result, 14 * 86400)
          .catch(() => undefined);
        return result;
      }

      return raw;
    } catch (err) {
      this.logger.warn(
        `Failed to translate text for target ${targetLangCode}: ${(err as Error)?.message}`,
      );
      // Fail-open: return original text
      return raw;
    }
  }

  private isLikelyVietnamese(value: string): boolean {
    return (
      /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(
        value,
      ) ||
      /\b(khong|không|san pham|sản phẩm|vui long|vui lòng|so du|số dư|nap|nạp|don hang|đơn hàng)\b/i.test(
        value,
      )
    );
  }
}
