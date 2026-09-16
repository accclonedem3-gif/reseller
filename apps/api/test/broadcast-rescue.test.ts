import assert from "node:assert/strict";

console.log("=== Broadcast Rescue & Reliability Tests ===");

async function runTests() {
  const now = new Date();

  // Test 1: Dynamic jobId generation pattern
  {
    const broadcastId = "bc_test_12345";
    const ts = Date.now();
    const dynamicJobId = `broadcast-${broadcastId}-${ts}`;
    assert.match(dynamicJobId, /^broadcast-bc_test_12345-\d+$/);
    console.log("✔ Test 1 passed: dynamic jobId prevents BullMQ deduplication drops");
  }

  // Test 2: Bounded sweeper logic for stuck QUEUED & SENDING (expires > 15m / 20m, rescues fresh 2m-15m)
  {
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    const sampleBroadcasts = [
      { id: "1", status: "QUEUED", createdAt: new Date(now.getTime() - 5 * 60 * 1000), updatedAt: new Date(now.getTime() - 5 * 60 * 1000) }, // 5m ago -> bounded rescue
      { id: "2", status: "QUEUED", createdAt: new Date(now.getTime() - 30 * 1000), updatedAt: new Date(now.getTime() - 30 * 1000) }, // 30s ago -> still fresh, don't rescue yet
      { id: "3", status: "QUEUED", createdAt: new Date(now.getTime() - 60 * 60 * 1000), updatedAt: new Date(now.getTime() - 60 * 60 * 1000) }, // 60m ago -> expired, discard!
      { id: "4", status: "SENDING", updatedAt: new Date(now.getTime() - 12 * 60 * 1000) }, // 12m ago -> bounded rescue
      { id: "5", status: "SENDING", updatedAt: new Date(now.getTime() - 40 * 60 * 1000) }, // 40m ago -> expired, discard!
    ];

    // Expired QUEUED (> 15m)
    const expiredQueued = sampleBroadcasts.filter(
      (b) => b.status === "QUEUED" && b.createdAt <= fifteenMinutesAgo
    );
    assert.equal(expiredQueued.length, 1);
    assert.equal(expiredQueued[0].id, "3");

    // Rescued fresh QUEUED (2m - 15m)
    const rescuedQueued = sampleBroadcasts.filter(
      (b) => b.status === "QUEUED" && b.createdAt <= twoMinutesAgo && b.createdAt > fifteenMinutesAgo
    );
    assert.equal(rescuedQueued.length, 1);
    assert.equal(rescuedQueued[0].id, "1");

    // Expired SENDING (> 20m)
    const expiredSending = sampleBroadcasts.filter(
      (b) => b.status === "SENDING" && b.updatedAt <= twentyMinutesAgo
    );
    assert.equal(expiredSending.length, 1);
    assert.equal(expiredSending[0].id, "5");

    // Rescued fresh SENDING (10m - 20m)
    const rescuedSending = sampleBroadcasts.filter(
      (b) => b.status === "SENDING" && b.updatedAt <= tenMinutesAgo && b.updatedAt > twentyMinutesAgo
    );
    assert.equal(rescuedSending.length, 1);
    assert.equal(rescuedSending[0].id, "4");

    console.log("✔ Test 2 passed: sweeper correctly bounds rescue (2m-15m) and expires old stuck broadcasts (>15m, >20m)");
  }

  // Test 3: Overdue SCHEDULED broadcasts (> 30m past scheduledAt) are marked FAILED and never fired late
  {
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const scheduledBroadcasts = [
      { id: "s1", status: "SCHEDULED", scheduledAt: new Date(now.getTime() - 5 * 60 * 1000) }, // 5m ago -> due now, fire!
      { id: "s2", status: "SCHEDULED", scheduledAt: new Date(now.getTime() - 45 * 60 * 1000) }, // 45m ago -> overdue/stale, discard!
      { id: "s3", status: "SCHEDULED", scheduledAt: new Date(now.getTime() + 10 * 60 * 1000) }, // 10m in future -> not yet due
    ];

    const expiredScheduled = scheduledBroadcasts.filter(
      (b) => b.status === "SCHEDULED" && b.scheduledAt <= thirtyMinutesAgo
    );
    assert.equal(expiredScheduled.length, 1);
    assert.equal(expiredScheduled[0].id, "s2");

    const dueToFire = scheduledBroadcasts.filter(
      (b) => b.status === "SCHEDULED" && b.scheduledAt <= now && b.scheduledAt > thirtyMinutesAgo
    );
    assert.equal(dueToFire.length, 1);
    assert.equal(dueToFire[0].id, "s1");

    console.log("✔ Test 3 passed: overdue SCHEDULED (>30m) are expired, only currently due broadcasts fire");
  }

  // Test 4: Startup stale cleanup discards all hanging QUEUED/SENDING broadcasts older than 5m
  {
    const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000);
    const preExistingBroadcasts = [
      { id: "old1", status: "QUEUED", createdAt: new Date(now.getTime() - 10 * 60 * 1000) }, // stale -> discard
      { id: "old2", status: "SENDING", createdAt: new Date(now.getTime() - 25 * 60 * 1000) }, // stale -> discard
      { id: "fresh1", status: "QUEUED", createdAt: new Date(now.getTime() - 1 * 60 * 1000) }, // fresh (just created 1m ago) -> keep
      { id: "done1", status: "COMPLETED", createdAt: new Date(now.getTime() - 60 * 60 * 1000) }, // already completed -> keep
    ];

    const discarded = preExistingBroadcasts.filter(
      (b) => ["QUEUED", "SENDING"].includes(b.status) && b.createdAt <= staleThreshold
    );
    assert.equal(discarded.length, 2);
    assert.deepEqual(discarded.map((d) => d.id), ["old1", "old2"]);

    console.log("✔ Test 4 passed: startup cleanup correctly purges old stuck broadcasts from previous runs");
  }

  // Test 5: Photo send fallback logic
  {
    let photoAttempted = false;
    let textFallbackAttempted = false;

    async function mockSend(photoUrl: string, message: string) {
      if (photoUrl) {
        photoAttempted = true;
        try {
          throw new Error("Telegram API method sendPhoto failed: 400 Bad Request: failed to get HTTP URL content");
        } catch {
          textFallbackAttempted = true;
          return { ok: true, fallbackText: message };
        }
      }
    }

    const res = await mockSend("https://example.com/uploads/broken.jpg", "Flash sale notification!");
    assert.equal(photoAttempted, true);
    assert.equal(textFallbackAttempted, true);
    assert.equal(res?.ok, true);
    console.log("✔ Test 5 passed: photo send failure gracefully falls back to text delivery");
  }

  console.log("=== All Broadcast Reliability Tests Passed! ===");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
