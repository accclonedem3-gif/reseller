import { ConflictException, Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import IORedis from "ioredis";

import { AppConfigService } from "../config/app-config.service";

/**
 * Idempotent execution wrapper.
 *
 * Wraps a request handler so that repeated calls with the same key return the
 * SAME response — protects against accidental double-submits (client double-click,
 * mobile network retry, browser back/forward).
 *
 * Storage: Redis. TTL 10 min for the result, 30 sec for the in-flight lock.
 *
 * Concurrency: uses Redis `SET NX EX` to atomically claim the key. A second
 * concurrent caller polls for the first to finish and returns the cached
 * response — never duplicates the work or the DB writes.
 *
 * On failure: the lock is released so a retry with the same key can succeed.
 * (Don't cache errors — caller should be able to retry after fixing the issue.)
 */
@Injectable()
export class IdempotencyService implements OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly redis: IORedis;
  private readonly RESULT_TTL_SEC = 600;
  private readonly LOCK_TTL_SEC = 30;
  private readonly POLL_INTERVAL_MS = 400;
  private readonly POLL_MAX_ATTEMPTS = 75; // 30s total — matches LOCK_TTL_SEC
  private readonly PENDING_MARKER = "__pending__";

  constructor(@Inject(AppConfigService) cfg: AppConfigService) {
    this.redis = new IORedis(cfg.redisUrl, { maxRetriesPerRequest: null });
  }

  async runOnce<T>(key: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    // No key → no idempotency, just run. Callers that want protection MUST send a key.
    if (!key) return fn();

    const cacheKey = `idempotency:${key}`;
    const acquired = await this.redis.set(cacheKey, this.PENDING_MARKER, "EX", this.LOCK_TTL_SEC, "NX");

    if (!acquired) {
      // Another caller already started with this key — wait for them, return their result.
      for (let i = 0; i < this.POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, this.POLL_INTERVAL_MS));
        const val = await this.redis.get(cacheKey);
        if (val && val !== this.PENDING_MARKER) {
          try {
            return JSON.parse(val) as T;
          } catch {
            // Cached value corrupted — fall through to ConflictException so caller can retry with a NEW key.
            break;
          }
        }
      }
      throw new ConflictException(
        "Yêu cầu trùng lặp đang được xử lý. Vui lòng đợi vài giây rồi thử lại.",
      );
    }

    try {
      const result = await fn();
      await this.redis.set(cacheKey, JSON.stringify(result), "EX", this.RESULT_TTL_SEC).catch((err) => {
        this.logger.warn(`Failed to cache idempotency result for ${key}: ${err?.message || err}`);
      });
      return result;
    } catch (err) {
      // Release the lock so the same key can be retried with corrected input.
      await this.redis.del(cacheKey).catch(() => undefined);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
