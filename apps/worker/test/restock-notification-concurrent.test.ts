import assert from "node:assert/strict";
import { TelegramRateLimiter, stripRestockCustomEmojiHtml } from "@reseller/shared/server";

async function runRestockConcurrencyTest() {
  console.log("=== RUNNING RESTOCK NOTIFICATION CONCURRENCY TEST ===");

  // Test 1: Rate limiter burst and steady rate
  {
    console.log("Test 1: Rate limiter grants burst tokens immediately");
    const limiter = new TelegramRateLimiter(25);
    const start = Date.now();
    for (let i = 0; i < 25; i++) {
      await limiter.acquire();
    }
    const elapsed = Date.now() - start;
    console.log(`Granted 25 burst tokens in ${elapsed}ms`);
    assert.ok(elapsed < 100, `Burst should be nearly instant, took ${elapsed}ms`);
  }

  // Test 2: 8 Workers concurrent queue processing
  {
    console.log("Test 2: 8 Workers processing 50 mock restock notification tasks");
    const limiter = new TelegramRateLimiter(25);

    const mockTasks = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      chatId: `chat_${i}`,
      text: `📢 Restock item #${i}`,
    }));

    let sharedIndex = 0;
    let sentCount = 0;
    const sentOrder: number[] = [];
    const activeWorkers = new Set<number>();
    let maxSimultaneousWorkers = 0;

    const runWorker = async (workerId: number) => {
      while (true) {
        const idx = sharedIndex++;
        if (idx >= mockTasks.length) break;
        const task = mockTasks[idx];

        activeWorkers.add(workerId);
        maxSimultaneousWorkers = Math.max(maxSimultaneousWorkers, activeWorkers.size);

        await limiter.acquire();

        // Simulate network I/O latency (10-30ms)
        await new Promise((r) => setTimeout(r, 15));

        sentOrder.push(task.id);
        sentCount++;
        activeWorkers.delete(workerId);
      }
    };

    const CONCURRENCY = 8;
    const start = Date.now();
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => runWorker(i)),
    );
    const totalDuration = Date.now() - start;

    console.log(`Processed 50 notifications with ${CONCURRENCY} workers in ${totalDuration}ms`);
    console.log(`Peak concurrent workers: ${maxSimultaneousWorkers}`);
    assert.equal(sentCount, 50);
    assert.equal(sentOrder.length, 50);
    assert.ok(maxSimultaneousWorkers > 1, "Should have utilized multiple workers simultaneously");
  }

  // Test 3: Rate limiter penalty on 429
  {
    console.log("Test 3: Rate limiter penalizes on 429 and resumes");
    const limiter = new TelegramRateLimiter(25);
    await limiter.acquire();

    limiter.penalize(300); // 300ms penalty
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    console.log(`Penalty 300ms waited: ${elapsed}ms`);
    assert.ok(elapsed >= 280, `Should have paused at least ~280ms, waited ${elapsed}ms`);
  }

  // Test 4: Custom emoji HTML stripping
  {
    console.log("Test 4: Strip custom emoji HTML tags correctly");
    const raw = `🔥 <tg-emoji emoji-id="12345">⭐️</tg-emoji> <b>Hàng đã về: Netflix 4K</b>`;
    const stripped = stripRestockCustomEmojiHtml(raw);
    assert.equal(stripped.includes("<tg-emoji"), false);
    assert.equal(stripped.includes("</tg-emoji>"), false);
    assert.ok(stripped.includes("⭐️"));
    assert.ok(stripped.includes("<b>Hàng đã về: Netflix 4K</b>"));
  }

  console.log("=== ALL RESTOCK CONCURRENCY TESTS PASSED SUCCESSFULLY ===");
}

runRestockConcurrencyTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
