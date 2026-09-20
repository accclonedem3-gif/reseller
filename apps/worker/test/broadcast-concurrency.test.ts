import { TelegramBroadcastRateLimiter } from "../src/schedulers/broadcast";

async function testRateLimiterBasic() {
  console.log("--- Testing TelegramBroadcastRateLimiter Basic ---");
  const limiter = new TelegramBroadcastRateLimiter(25);

  const start = Date.now();
  let acquiredCount = 0;

  // First 25 should acquire immediately (burst allowance)
  for (let i = 0; i < 25; i++) {
    await limiter.acquire();
    acquiredCount++;
  }
  const burstDuration = Date.now() - start;
  console.log(`Burst 25 tokens took: ${burstDuration}ms`);
  if (burstDuration > 200) {
    throw new Error(`Burst should be near instantaneous, took ${burstDuration}ms`);
  }

  // Next 10 tokens should be rate-limited at 25/sec (~40ms per token = ~400ms for 10 tokens)
  const afterBurstStart = Date.now();
  for (let i = 0; i < 10; i++) {
    await limiter.acquire();
    acquiredCount++;
  }
  const rateLimitedDuration = Date.now() - afterBurstStart;
  console.log(`10 rate-limited tokens took: ${rateLimitedDuration}ms`);
  if (rateLimitedDuration < 250) {
    throw new Error(`Rate limit was not enforced! Took only ${rateLimitedDuration}ms for 10 tokens`);
  }

  console.log("✓ Basic token bucket rate limiting verified.");
}

async function testRateLimiterConcurrentWorkers() {
  console.log("--- Testing 8 Concurrent Workers Throughput ---");
  const limiter = new TelegramBroadcastRateLimiter(50); // test with 50/sec for faster test run
  const TOTAL_ITEMS = 100;
  const CONCURRENCY = 8;

  let sharedIndex = 0;
  let processed = 0;
  const start = Date.now();

  async function worker() {
    while (true) {
      const idx = sharedIndex++;
      if (idx >= TOTAL_ITEMS) break;

      await limiter.acquire();
      // Simulate network request latency (20ms - 50ms)
      await new Promise((r) => setTimeout(r, 30));
      processed++;
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker())
  );

  const totalTime = Date.now() - start;
  console.log(`Processed ${processed}/${TOTAL_ITEMS} items using ${CONCURRENCY} workers in ${totalTime}ms`);

  if (processed !== TOTAL_ITEMS) {
    throw new Error(`Expected ${TOTAL_ITEMS} items processed, got ${processed}`);
  }

  // With sequential processing: 100 * 30ms = 3000ms minimum.
  // With 8 concurrent workers at 50/sec: ~2000ms (rate-limited ceiling)
  console.log(`✓ Concurrent workers verified in ${totalTime}ms.`);
}

async function testPenaltyCooldown() {
  console.log("--- Testing Penalty Cooldown (429 handling) ---");
  const limiter = new TelegramBroadcastRateLimiter(25);

  limiter.penalize(400); // 400ms penalty
  const start = Date.now();
  await limiter.acquire();
  const elapsed = Date.now() - start;

  console.log(`Penalty 400ms resulted in actual wait: ${elapsed}ms`);
  if (elapsed < 350) {
    throw new Error(`Penalty was ignored! Only waited ${elapsed}ms`);
  }
  console.log("✓ Penalty cooldown verified.");
}

async function run() {
  try {
    await testRateLimiterBasic();
    await testRateLimiterConcurrentWorkers();
    await testPenaltyCooldown();
    console.log("\n=================================");
    console.log("ALL BROADCAST CONCURRENCY TESTS PASSED!");
    console.log("=================================\n");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

void run();
