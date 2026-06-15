import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import IORedis from "ioredis";

import { AppConfigService } from "../config/app-config.service";

type Loader<T> = () => Promise<T>;

// Circuit-breaker tuning. When Redis fails CIRCUIT_FAIL_THRESHOLD times in a row, we open the
// circuit for CIRCUIT_COOLDOWN_MS — every read/write becomes a no-op (or falls back to memo) so
// we don't pile up a thundering herd of timeouts on a dead Redis. After cooldown, ONE probe is
// allowed; success → close circuit; failure → re-open. This is the standard half-open pattern.
const CIRCUIT_FAIL_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: IORedis;
  private readonly mem = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {
    // commandTimeout: cap blocking on a dead Redis so the API doesn't hang request threads. The
    // circuit breaker turns failures into fast no-ops after the threshold is crossed.
    this.redis = new IORedis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
      commandTimeout: 1500,
      enableOfflineQueue: false,
    });
    this.redis.on("error", (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  private circuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private recordSuccess(): void {
    if (this.consecutiveFailures > 0 || this.circuitOpenUntil > 0) {
      this.logger.log("Redis circuit closed (recovery).");
    }
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CIRCUIT_FAIL_THRESHOLD && !this.circuitOpen()) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      this.logger.warn(
        `Redis circuit OPEN — ${this.consecutiveFailures} consecutive failures; bypassing cache for ${CIRCUIT_COOLDOWN_MS / 1000}s.`,
      );
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.circuitOpen()) return null;
    try {
      const raw = await this.redis.get(key);
      this.recordSuccess();
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.recordFailure();
      this.logger.warn(`get(${key}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.circuitOpen()) return;
    try {
      await this.redis.set(key, JSON.stringify(value), "EX", Math.max(1, ttlSeconds));
      this.recordSuccess();
    } catch (err) {
      this.recordFailure();
      this.logger.warn(`set(${key}) failed: ${(err as Error).message}`);
    }
  }

  /**
   * Raw key-existence check (no JSON parse) — used by /metrics to count live proxies against the
   * worker's `account-check:proxy-dead:*` markers (whose values are plain strings, not JSON).
   * Circuit-open or error → treat as "not present" (false) so a Redis blip doesn't report proxies
   * as dead (which would falsely show "0 live proxies"). Live-count is best-effort, not authoritative.
   */
  async exists(key: string): Promise<boolean> {
    if (this.circuitOpen()) return false;
    try {
      const n = await this.redis.exists(key);
      this.recordSuccess();
      return n > 0;
    } catch (err) {
      this.recordFailure();
      this.logger.warn(`exists(${key}) failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** Is the Redis circuit currently open (degraded mode)? Surfaced in /metrics + /health. */
  isCircuitOpen(): boolean {
    return this.circuitOpen();
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (this.circuitOpen()) return;
    try {
      await this.redis.del(...keys);
      this.recordSuccess();
    } catch (err) {
      this.recordFailure();
      this.logger.warn(`del failed: ${(err as Error).message}`);
    }
  }

  // Sentinel returned by acquireLock when Redis is unavailable — caller proceeds UNLOCKED
  // (fail-open). releaseLock treats it as a no-op.
  private static readonly DEGRADED_LOCK_TOKEN = "__degraded__";

  /**
   * Distributed mutex via `SET key token PX ttl NX` — same key/protocol the worker uses, so the
   * API and worker mutually exclude on the same resource. Returns a unique token on success.
   *
   * `maxWaitMs > 0` → retry (every 200ms) until acquired or the deadline passes, then returns
   * `null` (held by someone else). `maxWaitMs = 0` → single attempt (skip-if-locked).
   *
   * FAIL-OPEN: if the Redis circuit is open or a command errors, returns a sentinel token so the
   * caller proceeds without the lock (a rare duplicate beats blocking every caller while Redis is
   * down). Always release in a finally with the returned token.
   */
  async acquireLock(key: string, ttlMs: number, maxWaitMs = 0): Promise<string | null> {
    if (this.circuitOpen()) return CacheService.DEGRADED_LOCK_TOKEN;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const deadline = Date.now() + Math.max(0, maxWaitMs);
    for (;;) {
      try {
        const res = await this.redis.set(key, token, "PX", Math.max(1000, Math.floor(ttlMs)), "NX");
        this.recordSuccess();
        if (res === "OK") return token;
      } catch (err) {
        this.recordFailure();
        this.logger.warn(`acquireLock(${key}) failed: ${(err as Error).message}`);
        return CacheService.DEGRADED_LOCK_TOKEN; // fail-open
      }
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Token-safe release: only deletes the key if we still own it (avoids dropping a lock that
   * already expired and was re-acquired by another holder). No-op for the fail-open sentinel. */
  async releaseLock(key: string, token: string | null): Promise<void> {
    if (!token || token === CacheService.DEGRADED_LOCK_TOKEN) return;
    if (this.circuitOpen()) return;
    try {
      const current = await this.redis.get(key);
      if (current === token) await this.redis.del(key);
      this.recordSuccess();
    } catch (err) {
      this.recordFailure();
      this.logger.warn(`releaseLock(${key}) failed: ${(err as Error).message}`);
    }
  }

  /**
   * Cache-aside with single-flight dedupe. If multiple callers hit the same key
   * within the TTL window and the value is missing, only one runs the loader.
   * Loader errors are NOT cached. When the Redis circuit is open the single-flight
   * still applies (in-process), so a hot key under outage collapses to 1 DB hit per pod.
   */
  async getOrLoad<T>(key: string, ttlSeconds: number, loader: Loader<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null && hit !== undefined) return hit;

    const inflight = this.pending.get(key);
    if (inflight) return inflight as Promise<T>;

    const p = (async () => {
      try {
        const value = await loader();
        if (value !== undefined && value !== null) {
          await this.set(key, value, ttlSeconds);
        }
        return value;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, p as Promise<unknown>);
    return p;
  }

  /** Process-local memo with TTL. Use for tiny hot config-style reads (no cross-instance coherence). */
  memoGet<T>(key: string): T | null {
    const entry = this.mem.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return entry.value as T;
  }

  memoSet(key: string, value: unknown, ttlSeconds: number): void {
    this.mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  memoDel(prefix: string): void {
    for (const k of this.mem.keys()) {
      if (k === prefix || k.startsWith(prefix + ":")) this.mem.delete(k);
    }
  }
}
