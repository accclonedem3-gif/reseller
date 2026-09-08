const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const { TelegramClient } = require("telegram");
const { encryptSecret } = require("@reseller/shared/server");
const { processUserbotCampaignJob } = require("../dist/userbot-campaign.worker.js");
const { enqueueDueUserbotCampaigns, isUserbotCampaignJob } = require("../dist/userbot-campaign-scheduler.js");

const key = "test-only-encryption-key";
function fixture(overrides = {}) {
  const campaign = {
    id: "campaign", sessionId: "session", status: "RUNNING", nextRunAt: new Date(Date.now() - 1000),
    lastRunAt: null, sentCount: 0, failedCount: 0, delaySeconds: 0, isRecurring: false,
    targetGroupIds: ["1"], repeatIntervalHours: 1,
    session: { sessionStringEncrypted: encryptSecret("", key), apiId: 123, apiHash: "test" },
    template: { type: "SPINTAX_TEXT", content: "Test" }, ...overrides,
  };
  const jobs = [];
  const logs = [];
  const matches = (where) => Object.entries(where).every(([k, v]) => {
    if (v instanceof Date) return campaign[k]?.getTime() === v.getTime();
    return campaign[k] === v;
  });
  const prisma = {
    telegramUserCampaign: {
      findUnique: async () => ({ ...campaign }),
      updateMany: async ({ where, data }) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(campaign, data);
        return { count: 1 };
      },
    },
    telegramUserGroup: { findFirst: async () => ({ title: "Test group" }) },
    telegramUserSession: { update: async () => ({}) },
    telegramUserCampaignLog: { create: async ({ data }) => logs.push(data) },
  };
  const redis = { set: async () => "OK", eval: async () => 1 };
  const queue = { add: async (...args) => jobs.push(args) };
  const job = { id: "job", data: { campaignId: campaign.id, runAt: campaign.nextRunAt?.toISOString() } };
  return { campaign, prisma, redis, queue, jobs, logs, job };
}

test("scheduled and recurring jobs execute; repeated delivery of an old job does not send twice", async () => {
  const connect = mock.method(TelegramClient.prototype, "connect", async () => true);
  mock.method(TelegramClient.prototype, "disconnect", async () => {});
  const send = mock.method(TelegramClient.prototype, "sendMessage", async () => ({}));
  try {
    const f = fixture({ isRecurring: true });
    await processUserbotCampaignJob(f.job, f.prisma, key, f.redis, f.queue);
    assert.equal(send.mock.calls.length, 1);
    assert.equal(f.jobs[0][0], "userbot-campaign");
    assert.ok(isUserbotCampaignJob(f.jobs[0][0]));
    assert.equal(f.jobs[0][2].delay, 3600000);
    assert.equal(f.campaign.nextRunAt.toISOString(), f.jobs[0][1].runAt);
    await processUserbotCampaignJob(f.job, f.prisma, key, f.redis, f.queue);
    assert.equal(connect.mock.calls.length, 1);
    // Move the next persisted run to now, without waiting one hour or contacting Telegram.
    f.campaign.nextRunAt = new Date(Date.now() - 1000);
    await processUserbotCampaignJob({ data: { campaignId: "campaign", runAt: f.campaign.nextRunAt.toISOString() } }, f.prisma, key, f.redis, f.queue);
    assert.equal(send.mock.calls.length, 2);
    assert.equal(f.jobs.length, 2);
  } finally { mock.restoreAll(); }
});

test("paused, draft, failed, future and stale jobs do not connect to Telegram", async () => {
  const connect = mock.method(TelegramClient.prototype, "connect", async () => { throw new Error("must not connect"); });
  try {
    for (const status of ["PAUSED", "DRAFT", "FAILED", "COMPLETED"]) {
      const f = fixture({ status });
      await processUserbotCampaignJob(f.job, f.prisma, key, f.redis, f.queue);
    }
    const future = fixture({ nextRunAt: new Date(Date.now() + 60000) });
    await processUserbotCampaignJob(future.job, future.prisma, key, future.redis, future.queue);
    const stale = fixture();
    stale.job.data.runAt = "old-run";
    await processUserbotCampaignJob(stale.job, stale.prisma, key, stale.redis, stale.queue);
    assert.equal(connect.mock.calls.length, 0);
  } finally { mock.restoreAll(); }
});

test("session contention defers with the canonical name and preserves run identity", async () => {
  const f = fixture();
  f.redis.set = async () => null;
  await processUserbotCampaignJob(f.job, f.prisma, key, f.redis, f.queue);
  assert.equal(f.jobs[0][0], "userbot-campaign");
  assert.deepEqual(f.jobs[0][1], f.job.data);
  assert.equal(f.jobs[0][2].delay, 15000);
  assert.ok(f.campaign.nextRunAt);
});

test("flood wait schedules a resume without completing the cycle or replaying successful groups", async () => {
  mock.method(TelegramClient.prototype, "connect", async () => true);
  mock.method(TelegramClient.prototype, "disconnect", async () => {});
  const send = mock.method(TelegramClient.prototype, "sendMessage", async () => { throw new Error("FLOOD_WAIT_60"); });
  try {
    const f = fixture({ targetGroupIds: ["1", "2"], sentCount: 1 });
    await processUserbotCampaignJob(f.job, f.prisma, key, f.redis, f.queue);
    assert.equal(send.mock.calls[0].arguments[0], "2");
    assert.equal(f.campaign.status, "RUNNING");
    assert.equal(f.campaign.sentCount, 1);
    assert.equal(f.campaign.failedCount, 0);
    assert.equal(f.jobs.length, 1);
    assert.equal(f.jobs[0][0], "userbot-campaign");
    assert.equal(f.jobs[0][2].delay, 65000);
    send.mock.mockImplementation(async () => ({}));
    f.campaign.nextRunAt = new Date(Date.now() - 1000);
    await processUserbotCampaignJob({ data: { campaignId: "campaign", runAt: f.campaign.nextRunAt.toISOString() } }, f.prisma, key, f.redis, f.queue);
    assert.equal(send.mock.calls[1].arguments[0], "2");
    assert.equal(f.campaign.status, "COMPLETED");
    assert.equal(f.campaign.sentCount, 2);
    assert.equal(f.campaign.nextRunAt, null);
  } finally { mock.restoreAll(); }
});

test("recovery handles missing, waiting, completed and failed jobs without starting drafts", async () => {
  for (const state of [null, "delayed", "active", "completed", "failed"]) {
    const runAt = new Date(Date.now() - 1000);
    let query;
    const added = [], retried = [];
    const prisma = { telegramUserCampaign: { findMany: async (args) => {
      query = args;
      return [{ id: "campaign", nextRunAt: runAt }];
    } } };
    const queue = {
      getJob: async () => state ? { getState: async () => state, retry: async (s) => retried.push(s) } : undefined,
      add: async (...args) => added.push(args),
    };
    await enqueueDueUserbotCampaigns(prisma, queue);
    assert.equal(query.where.status, "RUNNING");
    assert.ok(query.where.nextRunAt.lte instanceof Date);
    assert.equal(added.length, state === null ? 1 : 0);
    assert.equal(retried.length, ["failed", "completed"].includes(state) ? 1 : 0);
    if (!state) assert.equal(added[0][1].runAt, runAt.toISOString());
  }
  assert.ok(isUserbotCampaignJob("userbot-campaign-job"));
  assert.ok(isUserbotCampaignJob("run-userbot-campaign"));
  assert.equal(isUserbotCampaignJob("unrelated"), false);
});
