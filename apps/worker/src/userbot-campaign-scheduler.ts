import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { getUserbotCampaignJobId, JOBS } from "@reseller/shared/server";

export function isUserbotCampaignJob(name: string) {
  return [JOBS.userbotCampaign, "run-userbot-campaign", "userbot-campaign-job"].includes(name);
}

export async function enqueueDueUserbotCampaigns(
  prisma: PrismaClient,
  queue: Queue,
  redis?: any,
) {
  // 1. Recover interrupted running campaigns where nextRunAt is null
  // (e.g. worker restarted mid-run) and session lock is not held.
  try {
    const stuckCampaigns = await prisma.telegramUserCampaign.findMany({
      where: {
        status: "RUNNING",
        nextRunAt: null,
        OR: [
          { lastRunAt: null },
          { lastRunAt: { lte: new Date(Date.now() - 60 * 1000) } },
        ],
      },
      select: { id: true, sessionId: true },
      take: 50,
    });

    for (const stuck of stuckCampaigns) {
      if (redis && typeof redis.get === "function") {
        const lockHeld = await redis.get(`userbot-session-lock:${stuck.sessionId}`).catch(() => null);
        if (lockHeld) continue;
      }
      const now = new Date();
      if (typeof prisma.telegramUserCampaign.updateMany === "function") {
        await prisma.telegramUserCampaign.updateMany({
          where: { id: stuck.id, status: "RUNNING", nextRunAt: null },
          data: { nextRunAt: now },
        });
      }
    }
  } catch (err) {
    console.error("[userbot-scheduler] Error recovering stuck campaigns:", err);
  }

  // 2. Only recover explicitly armed runs. Never auto-start old drafts or paused campaigns.
  const campaigns = await prisma.telegramUserCampaign.findMany({
    where: { status: "RUNNING", nextRunAt: { lte: new Date() } },
    select: { id: true, nextRunAt: true },
    orderBy: { nextRunAt: "asc" },
    take: 100,
  });
  for (const campaign of campaigns) {
    if (!campaign.nextRunAt) continue;
    const jobId = getUserbotCampaignJobId(campaign.id, campaign.nextRunAt.getTime());
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed") await existing.retry(state);
      continue;
    }
    await queue.add(JOBS.userbotCampaign, {
      campaignId: campaign.id,
      runAt: campaign.nextRunAt.toISOString(),
    }, { jobId, removeOnComplete: 100, removeOnFail: 100 });
  }
}
