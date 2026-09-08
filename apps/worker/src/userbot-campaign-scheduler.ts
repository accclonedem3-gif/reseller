import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { getUserbotCampaignJobId, JOBS } from "@reseller/shared/server";

export function isUserbotCampaignJob(name: string) {
  return [JOBS.userbotCampaign, "run-userbot-campaign", "userbot-campaign-job"].includes(name);
}

export async function enqueueDueUserbotCampaigns(prisma: PrismaClient, queue: Queue) {
  // Only recover explicitly armed runs. Never auto-start old drafts or paused campaigns.
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
