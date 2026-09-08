import type { Queue } from "bullmq";
import type Redis from "ioredis";

let _purchaseQueue: Queue | null = null;
let _redis: Redis | null = null;

export function setPaymentContext(ctx: {
  purchaseQueue?: Queue | null;
  redis?: Redis | null;
}): void {
  if (ctx.purchaseQueue !== undefined) _purchaseQueue = ctx.purchaseQueue;
  if (ctx.redis !== undefined) _redis = ctx.redis;
}

export function getPaymentContext(): {
  purchaseQueue: Queue | null;
  redis: Redis | null;
} {
  return { purchaseQueue: _purchaseQueue, redis: _redis };
}

export * from "./payos";
export * from "./okx";
export * from "./trc20";
export * from "./solana";
export * from "./ton";
