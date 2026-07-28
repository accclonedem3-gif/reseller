import { Logger, type OnApplicationShutdown } from "@nestjs/common";
import {
  ThrottlerStorageService,
  type ThrottlerStorage,
} from "@nestjs/throttler";
import IORedis from "ioredis";

type RateLimitRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

const REDIS_RETRY_DELAY_MS = 5_000;
const WARNING_INTERVAL_MS = 30_000;

// Fixed-window increment + temporary block in one atomic Redis operation. Keeping the
// decision in Lua prevents two API instances from both accepting a request at the limit.
const INCREMENT_SCRIPT = `
local blockTtl = redis.call("PTTL", KEYS[2])
if blockTtl > 0 then
  local current = tonumber(redis.call("GET", KEYS[1]) or ARGV[3])
  local hitTtl = redis.call("PTTL", KEYS[1])
  if hitTtl < 0 then hitTtl = blockTtl end
  return { current, hitTtl, 1, blockTtl }
end

local hits = redis.call("INCR", KEYS[1])
if hits == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end

local hitTtl = redis.call("PTTL", KEYS[1])
if hits > tonumber(ARGV[3]) then
  redis.call("SET", KEYS[2], "1", "PX", ARGV[2])
  return { hits, hitTtl, 1, tonumber(ARGV[2]) }
end

return { hits, hitTtl, 0, 0 }
`;

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function secondsRemaining(milliseconds: number): number {
  return Math.max(0, Math.ceil(milliseconds / 1000));
}

/**
 * Distributed storage for @nestjs/throttler.
 *
 * Redis is authoritative while healthy. If it is briefly unavailable, requests still pass
 * through Nest's process-local storage so an infrastructure blip does not take the API down or
 * remove rate limiting completely.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: IORedis;
  private readonly fallback = new ThrottlerStorageService();
  private redisUnavailableUntil = 0;
  private lastWarningAt = 0;
  private fallbackActive = false;

  constructor(redisUrl: string) {
    this.redis = new IORedis(redisUrl, {
      commandTimeout: 750,
      connectTimeout: 1_000,
      // Allow the first command to wait for the initial localhost connection. commandTimeout and
      // maxRetriesPerRequest still bound an actual outage, after which the local fallback takes over.
      enableOfflineQueue: true,
      maxRetriesPerRequest: 1,
    });
    this.redis.on("error", (error) => this.warnFallback(error));
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<RateLimitRecord> {
    const ttlMs = positiveInteger(ttl, 60_000);
    const limitValue = positiveInteger(limit, 100);
    const blockMs = positiveInteger(blockDuration, ttlMs);

    if (Date.now() < this.redisUnavailableUntil) {
      return this.fallback.increment(
        key,
        ttlMs,
        limitValue,
        blockMs,
        throttlerName,
      );
    }

    try {
      const namespace = `throttle:${throttlerName}:${key}`;
      const raw = await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${namespace}:hits`,
        `${namespace}:blocked`,
        ttlMs,
        blockMs,
        limitValue,
      );
      const values = raw as Array<number | string>;
      const totalHits = Number(values[0] ?? 0);
      const timeToExpireMs = Number(values[1] ?? ttlMs);
      const isBlocked = Number(values[2] ?? 0) === 1;
      const timeToBlockExpireMs = Number(values[3] ?? 0);

      if (this.fallbackActive) {
        this.logger.log(
          "Redis rate-limit storage recovered; distributed limiting is active.",
        );
        this.fallbackActive = false;
      }

      return {
        totalHits,
        timeToExpire: secondsRemaining(timeToExpireMs),
        isBlocked,
        timeToBlockExpire: secondsRemaining(timeToBlockExpireMs),
      };
    } catch (error) {
      this.redisUnavailableUntil = Date.now() + REDIS_RETRY_DELAY_MS;
      this.fallbackActive = true;
      this.warnFallback(error);
      return this.fallback.increment(
        key,
        ttlMs,
        limitValue,
        blockMs,
        throttlerName,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.fallback.onApplicationShutdown();
    if (this.redis.status === "ready") {
      await this.redis.quit().catch(() => this.redis.disconnect());
      return;
    }
    this.redis.disconnect();
  }

  private warnFallback(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarningAt < WARNING_INTERVAL_MS) return;
    this.lastWarningAt = now;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Redis rate-limit storage unavailable; using local fallback: ${message}`,
    );
  }
}
