export class TelegramRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private penaltyUntil: number = 0;

  constructor(messagesPerSecond: number = 25) {
    this.maxTokens = messagesPerSecond;
    this.tokens = messagesPerSecond;
    this.refillRatePerMs = messagesPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    if (now < this.penaltyUntil) {
      return;
    }
    const effectiveStart = Math.max(this.lastRefill, this.penaltyUntil);
    const elapsed = now - effectiveStart;
    if (elapsed > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
      this.lastRefill = now;
    }
  }

  penalize(durationMs: number) {
    const now = Date.now();
    this.penaltyUntil = Math.max(this.penaltyUntil, now + durationMs);
    this.tokens = 0;
    this.lastRefill = this.penaltyUntil;
  }

  async acquire(): Promise<void> {
    this.refill();
    const now = Date.now();
    if (now >= this.penaltyUntil && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.schedule();
    });
  }

  private schedule() {
    if (this.timer || this.queue.length === 0) return;
    const now = Date.now();
    this.refill();
    if (now >= this.penaltyUntil && this.tokens >= 1) {
      this.tokens -= 1;
      const next = this.queue.shift();
      if (next) next();
      if (this.queue.length > 0) {
        this.schedule();
      }
      return;
    }

    let waitMs = 20;
    if (now < this.penaltyUntil) {
      waitMs = Math.max(20, this.penaltyUntil - now);
    } else {
      waitMs = Math.max(20, Math.ceil((1 - this.tokens) / this.refillRatePerMs));
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.schedule();
    }, waitMs);
  }
}

// Alias for backwards compatibility
export const TelegramBroadcastRateLimiter = TelegramRateLimiter;
