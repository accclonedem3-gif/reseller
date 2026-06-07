import { Inject, Injectable } from "@nestjs/common";
import IORedis from "ioredis";

import { AppConfigService } from "../config/app-config.service";

export type PendingQuantitySelection = {
  sourceProductId: string;
  displayName: string;
  sourceName?: string | null;
  salePrice: number;
  salePriceUsd: number | null;
  available: number | null;
  maxQuantity: number | null;
  expiresAt: number;
  imageUrl?: string | null;
  description?: string | null;
  soldCount?: number | null;
  deliveryFormatHint?: string | null;
  iconCustomEmojiId?: string | null;
  promoBanner?: string | null;
};

export type PendingWalletTopupSelection = {
  currency: "VND" | "USDT";
  expiresAt: number;
};

export type PendingPaymentSelection = {
  sourceProductId: string;
  quantity: number;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  expiresAt: number;
};

export type PendingTxHashSubmission = {
  externalOrderCode: string;
  orderCode: string;
  allowMockHash: boolean;
  expiresAt: number;
  isTopup?: boolean;
  provider?: "USDT_TRC20" | "USDT_SOL";
};

export type PendingBinanceOrderIdSubmission = {
  externalOrderCode: string;
  orderCode: string;
  expiresAt: number;
};

export type PendingWarrantyClaimSubmission = {
  expiresAt: number;
};

export type PendingWarrantyIssueDescription = {
  orderCode: string;
  expiresAt: number;
};

export type PendingWarrantyAccountSelection = {
  orderCode: string;
  accounts: string[];
  expiresAt: number;
};

export type PendingConnectionTopupInput = {
  connectionId: string;
  downstreamShopId: string;
  expiresAt: number;
};

/**
 * Redis-backed store for the bot's short-lived pending interaction state
 * (quantity selection, payment method, tx-hash submission, warranty claim, …).
 *
 * Owns the Redis connection, the `bot:session:<type>:<key>` namespace, JSON
 * serialization, the per-flow TTLs, and the key builders. Extracted verbatim
 * from TelegramBotService — behaviour is unchanged; the bot now delegates the
 * generic get/set/del + key/TTL plumbing here while keeping its typed accessors.
 */
@Injectable()
export class BotSessionStore {
  private readonly redis: IORedis;

  readonly pendingQuantityTtlMs = 10 * 60 * 1000;
  readonly pendingPaymentTtlMs = 5 * 60 * 1000;
  readonly pendingTxHashTtlMs = 12 * 60 * 60 * 1000;
  readonly pendingBinanceOrderIdTtlMs = 12 * 60 * 60 * 1000;
  readonly pendingOkxTxHashTtlMs = 12 * 60 * 60 * 1000;

  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {
    this.redis = new IORedis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }

  getPendingQuantityKey(shopId: string, telegramUserId: string) {
    return `${shopId}:${telegramUserId}`;
  }

  getPendingConnectionTopupKey(shopId: string, telegramUserId: string) {
    return this.getPendingQuantityKey(shopId, telegramUserId);
  }

  async setPendingSession<T>(type: string, key: string, data: T, ttlMs: number) {
    const fullKey = `bot:session:${type}:${key}`;
    await this.redis.set(fullKey, JSON.stringify(data), "PX", ttlMs);
  }

  async getPendingSession<T>(type: string, key: string): Promise<T | undefined> {
    const fullKey = `bot:session:${type}:${key}`;
    const val = await this.redis.get(fullKey);
    if (!val) return undefined;
    try {
      return JSON.parse(val) as T;
    } catch {
      return undefined;
    }
  }

  async delPendingSession(type: string, key: string) {
    const fullKey = `bot:session:${type}:${key}`;
    await this.redis.del(fullKey);
  }
}
