import { ForbiddenException, Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import IORedis from "ioredis";

import { AppConfigService } from "../config/app-config.service";

/**
 * Anti-enumeration guard for the PUBLIC warranty lookup/claim endpoints.
 *
 * Closes the brute-force half of hole #2 WITHOUT adding customer friction (no second
 * "claim code" field): instead of gating every lookup, it watches for the *pattern* of
 * someone guessing order codes — repeated lookups that return NOTHING — and locks that IP
 * out, iPhone-passcode style (each repeat doubles the lockout).
 *
 * A legitimate customer enters their real order code / account and gets a HIT on the first
 * try, so they essentially never accumulate misses. A scanner trying random ORD-… codes
 * racks up misses fast and gets frozen.
 *
 * Tuning (env overridable):
 *   WARRANTY_ABUSE_THRESHOLD   misses within the window before the FIRST block      (default 5)
 *   WARRANTY_ABUSE_WINDOW_SEC  sliding miss window in seconds                        (default 600 = 10m)
 *   WARRANTY_ABUSE_BLOCK_SEC   base lockout; doubles each repeat strike              (default 3600 = 1h)
 *   WARRANTY_ABUSE_MAX_BLOCK_SEC  cap on the doubled lockout                         (default 86400 = 24h)
 *   WARRANTY_ABUSE_DISABLED=1  turn the whole guard off (testing)
 *
 * Escalation: after an IP has been blocked once, a SINGLE further miss re-locks it (the
 * "1 lần nữa sai → gấp đôi" behaviour), with the duration doubling 1h→2h→4h…→cap. The
 * strike level remembers for 24h so wait-it-out-then-retry loops keep escalating.
 *
 * Fail-OPEN: every Redis op is wrapped — if Redis is down the guard silently allows the
 * request (never takes down warranty lookups just because abuse-tracking is unavailable).
 */
@Injectable()
export class WarrantyAbuseService implements OnModuleDestroy {
  private readonly logger = new Logger(WarrantyAbuseService.name);
  private readonly redis: IORedis;

  private readonly DISABLED = String(process.env.WARRANTY_ABUSE_DISABLED ?? "") === "1";
  private readonly BASE_THRESHOLD = this.envInt("WARRANTY_ABUSE_THRESHOLD", 5);
  private readonly WINDOW_SEC = this.envInt("WARRANTY_ABUSE_WINDOW_SEC", 600);
  private readonly BASE_BLOCK_SEC = this.envInt("WARRANTY_ABUSE_BLOCK_SEC", 3600);
  private readonly MAX_BLOCK_SEC = this.envInt("WARRANTY_ABUSE_MAX_BLOCK_SEC", 86400);
  private readonly STRIKE_TTL_SEC = 86400; // escalation memory window
  private readonly POST_STRIKE_THRESHOLD = 1; // once burned, a single miss re-locks

  constructor(@Inject(AppConfigService) cfg: AppConfigService) {
    this.redis = new IORedis(cfg.redisUrl, {
      maxRetriesPerRequest: null,
      // Don't let warranty requests hang on a wedged Redis — fail open fast.
      commandTimeout: 1000,
      enableOfflineQueue: false,
    });
    // ioredis emits 'error' on connection loss; swallow so it doesn't crash the process.
    this.redis.on("error", () => undefined);
  }

  private envInt(key: string, fallback: number): number {
    const n = Number(process.env[key]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  private missKey(ip: string) { return `wrt:abuse:miss:${ip}`; }
  private blockKey(ip: string) { return `wrt:abuse:block:${ip}`; }
  private strikeKey(ip: string) { return `wrt:abuse:strikes:${ip}`; }

  private normalizeIp(ip: string | null | undefined): string | null {
    const v = (ip || "").trim();
    if (!v) return null;
    // Don't lock out local/dev traffic (loopback can't be a real abuser behind the proxy).
    if (v === "::1" || v === "127.0.0.1" || v === "::ffff:127.0.0.1") return null;
    return v;
  }

  /** Throws 403 if the IP is currently locked out. Call at the TOP of public search/claim. */
  async assertNotBlocked(rawIp: string | null | undefined): Promise<void> {
    if (this.DISABLED) return;
    const ip = this.normalizeIp(rawIp);
    if (!ip) return;
    let ttl = -2;
    try {
      ttl = await this.redis.ttl(this.blockKey(ip));
    } catch {
      return; // fail open
    }
    if (ttl > 0) {
      const mins = Math.max(1, Math.ceil(ttl / 60));
      throw new ForbiddenException(
        `Bạn đã tra cứu sai quá nhiều lần. Vui lòng thử lại sau ${mins} phút, hoặc liên hệ shop nếu cần hỗ trợ.`,
      );
    }
  }

  /**
   * Record a lookup that returned NOTHING (a guess/typo). Escalates to a lockout when the
   * IP crosses the threshold. Returns whether the IP is now blocked (for logging).
   */
  async recordMiss(rawIp: string | null | undefined): Promise<void> {
    if (this.DISABLED) return;
    const ip = this.normalizeIp(rawIp);
    if (!ip) return;
    try {
      const strikes = Number(await this.redis.get(this.strikeKey(ip))) || 0;
      const threshold = strikes >= 1 ? this.POST_STRIKE_THRESHOLD : this.BASE_THRESHOLD;

      const misses = await this.redis.incr(this.missKey(ip));
      if (misses === 1) {
        await this.redis.expire(this.missKey(ip), this.WINDOW_SEC);
      }

      if (misses >= threshold) {
        const newStrikes = strikes + 1;
        // 1h, 2h, 4h, … capped. (BASE * 2^(strike-1))
        const blockSec = Math.min(
          this.MAX_BLOCK_SEC,
          this.BASE_BLOCK_SEC * Math.pow(2, newStrikes - 1),
        );
        await this.redis.set(this.blockKey(ip), String(newStrikes), "EX", blockSec);
        await this.redis.set(this.strikeKey(ip), String(newStrikes), "EX", this.STRIKE_TTL_SEC);
        await this.redis.del(this.missKey(ip));
        this.logger.warn(
          `[warranty-abuse] LOCKED ip=${ip} strike#${newStrikes} for ${Math.round(blockSec / 60)}m ` +
            `(after ${misses} misses, threshold ${threshold}). Likely order-code enumeration.`,
        );
      }
    } catch {
      // fail open — never block legit traffic because abuse-tracking failed
    }
  }

  /**
   * A successful lookup → ease the miss streak by ONE (floored at 0), not a full reset.
   * A full reset (del) let a scanner who knows a single valid account/order-code interleave one
   * good lookup every few guesses and never trip the threshold (each hit handed back a fresh budget
   * of 5). Decrement-by-one caps that to a 1:1 trade (one extra guess per valid lookup) while still
   * forgiving a genuine customer's occasional typo on a shared/NAT IP. Misses also age out via the
   * window TTL regardless.
   */
  async recordHit(rawIp: string | null | undefined): Promise<void> {
    if (this.DISABLED) return;
    const ip = this.normalizeIp(rawIp);
    if (!ip) return;
    try {
      const cur = Number(await this.redis.get(this.missKey(ip)));
      if (Number.isFinite(cur) && cur > 0) {
        await this.redis.decr(this.missKey(ip));
      }
    } catch {
      // ignore
    }
  }

  /** Admin / support escape hatch to lift a lockout early. */
  async clearBlock(rawIp: string | null | undefined): Promise<void> {
    const ip = this.normalizeIp(rawIp);
    if (!ip) return;
    try {
      await this.redis.del(this.blockKey(ip), this.missKey(ip), this.strikeKey(ip));
    } catch {
      // ignore
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
