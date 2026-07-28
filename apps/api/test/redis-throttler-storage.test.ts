import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { RedisThrottlerStorage } from "../src/common/throttling/redis-throttler.storage";

async function main() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const firstProcess = new RedisThrottlerStorage(redisUrl);
  const secondProcess = new RedisThrottlerStorage(redisUrl);
  const key = `integration-${randomUUID()}`;

  try {
    const first = await firstProcess.increment(key, 5_000, 2, 5_000, "test");
    const second = await secondProcess.increment(key, 5_000, 2, 5_000, "test");
    const blocked = await firstProcess.increment(key, 5_000, 2, 5_000, "test");

    assert.equal(first.totalHits, 1);
    assert.equal(
      second.totalHits,
      2,
      "two storage instances must share the Redis counter",
    );
    assert.equal(second.isBlocked, false);
    assert.equal(blocked.totalHits, 3);
    assert.equal(blocked.isBlocked, true);
    assert.ok(blocked.timeToBlockExpire > 0);
    console.log("Redis throttler integration test passed.");
  } finally {
    await Promise.all([
      firstProcess.onApplicationShutdown(),
      secondProcess.onApplicationShutdown(),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
