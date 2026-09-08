const assert = require("node:assert/strict");
const test = require("node:test");
const { UserbotCampaignService } = require("../dist/userbot-campaign/userbot-campaign.service.js");
const { QueueService } = require("../dist/lib/queue.service.js");
const { parseUserbotCampaignScheduleTime, planUserbotCampaignStart } = require("../dist/userbot-campaign/userbot-campaign-schedule.js");

function fixture() {
  let campaign;
  const jobs = [];
  const prisma = {
    telegramUserSession: { findFirst: async () => ({ id: "session" }) },
    telegramUserTemplate: { findFirst: async () => ({ id: "template" }) },
    telegramUserGroup: { findMany: async () => [{ telegramChatId: 1n }] },
    telegramUserCampaign: {
      count: async () => 0,
      create: async ({ data }) => (campaign = { id: "campaign", lastRunAt: null, ...data }),
      findFirst: async () => campaign,
      findUnique: async () => campaign,
      updateMany: async ({ where, data }) => {
        if (where.status?.in && !where.status.in.includes(campaign.status)) return { count: 0 };
        Object.assign(campaign, data);
        return { count: 1 };
      },
      update: async ({ data }) => Object.assign(campaign, data),
    },
  };
  const queue = { addUserbotCampaignJob: async (...args) => jobs.push(args) };
  const service = new UserbotCampaignService(prisma, {}, queue);
  service.getLicenseStatus = async () => ({ isActive: true, maxCampaigns: 5, minDelaySeconds: 30 });
  return { service, queue, jobs, get campaign() { return campaign; } };
}
const user = { sellerId: "seller" };
const dto = { sessionId: "session", templateId: "template", targetGroupIds: ["1"], name: "Scheduled test", delaySeconds: 60 };

test("offset timestamps retain intended instant and unzoned input is rejected", () => {
  assert.equal(parseUserbotCampaignScheduleTime("2026-09-09T20:30:00+07:00").toISOString(), "2026-09-09T13:30:00.000Z");
  assert.throws(() => parseUserbotCampaignScheduleTime("2026-09-09T20:30"), /timezone/);
  assert.throws(() => parseUserbotCampaignScheduleTime("invalidZ"), /invalid/);
  const now = new Date("2026-09-09T13:00:00Z");
  assert.equal(planUserbotCampaignStart(new Date("2026-09-09T13:30:00Z"), now).delayMs, 1800000);
  assert.equal(planUserbotCampaignStart(null, now).nextRunAt, now);
});

test("creating a scheduled campaign arms the first run, including recurring campaigns", async () => {
  for (const isRecurring of [false, true]) {
    const f = fixture();
    const scheduleTime = new Date(Date.now() + 3600000).toISOString();
    const campaign = await f.service.createCampaign(user, { ...dto, scheduleTime, isRecurring, repeatIntervalHours: 24 });
    assert.equal(campaign.status, "RUNNING");
    assert.equal(campaign.nextRunAt.toISOString(), scheduleTime);
    assert.equal(campaign.lastRunAt, null);
    assert.equal(f.jobs.length, 1);
    assert.ok(f.jobs[0][1] > 3500000 && f.jobs[0][1] <= 3600000);
    assert.equal(f.jobs[0][3], scheduleTime);
  }
});

test("immediate creation stays draft; start arms a recoverable job and rejects double start", async () => {
  const f = fixture();
  await f.service.createCampaign(user, dto);
  assert.equal(f.campaign.status, "DRAFT");
  assert.equal(f.jobs.length, 0);
  await f.service.startCampaign(user, "campaign");
  assert.equal(f.campaign.status, "RUNNING");
  assert.ok(f.campaign.nextRunAt instanceof Date);
  assert.equal(f.jobs.length, 1);
  await assert.rejects(f.service.startCampaign(user, "campaign"));
  assert.equal(f.jobs.length, 1);
  await f.service.pauseCampaign(user, "campaign");
  assert.equal(f.campaign.nextRunAt, null);
});

test("enqueue outage preserves an armed schedule for recovery without reporting create failure", async () => {
  const f = fixture();
  f.queue.addUserbotCampaignJob = async () => { throw new Error("Redis unavailable"); };
  const result = await f.service.createCampaign(user, { ...dto, scheduleTime: new Date(Date.now() + 60000).toISOString() });
  assert.equal(result.status, "RUNNING");
  assert.ok(result.nextRunAt);
});

test("past and invalid schedules never create campaigns", async () => {
  for (const scheduleTime of [new Date(Date.now() - 60000).toISOString(), "invalid", "2026-09-09T20:30"]) {
    const f = fixture();
    await assert.rejects(f.service.createCampaign(user, { ...dto, scheduleTime }));
    assert.equal(f.campaign, undefined);
  }
});

test("API queue retains the run identity and uses the canonical job name", async () => {
  let call;
  await QueueService.prototype.addUserbotCampaignJob.call({ userbotCampaignQueue: { add: async (...args) => { call = args; } } }, "campaign", 60000, "run-id", "run-at");
  assert.equal(call[0], "userbot-campaign");
  assert.deepEqual(call[1], { campaignId: "campaign", runAt: "run-at" });
  assert.equal(call[2].delay, 60000);
});
