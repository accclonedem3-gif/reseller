import { PrismaClient } from "@prisma/client";
import { decryptSecret, getUserbotCampaignJobId, JOBS } from "@reseller/shared/server";
import { randomUUID } from "node:crypto";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGramJsProxy(proxyUrl?: string | null) {
  if (!proxyUrl) return undefined;
  try {
    const url = new URL(proxyUrl);
    const isSocks4 = url.protocol.startsWith("socks4");
    const isSocks = url.protocol.startsWith("socks");
    const port = url.port ? parseInt(url.port) : isSocks ? 1080 : 80;
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;

    return {
      ip: url.hostname,
      port,
      socksType: (isSocks4 ? 4 : 5) as 4 | 5,
      username,
      password,
    };
  } catch {
    return undefined;
  }
}

function parseSpintax(text: string): string {
  if (!text) return "";
  return text.replace(/\{([^{}]+)\}/g, (_match, choices) => {
    const options = choices.split("|");
    return options[Math.floor(Math.random() * options.length)] || "";
  });
}

export async function processUserbotCampaignJob(
  job: any,
  prisma: PrismaClient,
  encryptionKey: string,
  redis?: any,
  userbotQueue?: any,
) {
  const campaignId = String(job.data?.campaignId || "").trim();
  if (!campaignId) return;

  console.log(`[userbot-worker] Starting campaign ${campaignId}`);

  const campaign = await prisma.telegramUserCampaign.findUnique({
    where: { id: campaignId },
    include: {
      session: true,
      template: true,
    },
  });

  if (!campaign) {
    console.error(`[userbot-worker] Campaign ${campaignId} not found.`);
    return;
  }

  if (campaign.status !== "RUNNING") {
    console.log(`[userbot-worker] Campaign ${campaignId} is ${campaign.status}. Aborting.`);
    return;
  }

  // Acquire Redis Session Lock to prevent concurrent execution on the same Telegram account
  const lockKey = `userbot-session-lock:${campaign.sessionId}`;
  const lockToken = randomUUID();
  let lockAcquired = false;
  if (redis) {
    const lockResult = await redis.set(lockKey, lockToken, "PX", 300000, "NX");
    if (lockResult !== "OK") {
      console.log(`[userbot-worker] Session ${campaign.sessionId} is currently locked by another active job. Delaying campaign ${campaignId} by 15s.`);
      if (userbotQueue) {
        await userbotQueue.add(JOBS.userbotCampaign, job.data, {
          delay: 15000, removeOnComplete: 100, removeOnFail: 100,
        });
      }
      return;
    }
    lockAcquired = true;
  }

  let client: TelegramClient | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lockLost = false;
  let startedAt: Date | undefined;
  try {
    if (lockAcquired) {
      heartbeat = setInterval(() => {
        void redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], 300000) else return 0 end",
          1, lockKey, lockToken,
        ).then((renewed: number) => { if (!renewed) lockLost = true; })
          .catch(() => { lockLost = true; });
      }, 30000);
    }
    // The persisted pending time identifies a run. Claim it atomically so old
    // delayed jobs and the recovery sweep cannot send the same cycle twice.
    const fresh = await prisma.telegramUserCampaign.findUnique({ where: { id: campaignId } });
    if (!fresh || fresh.status !== "RUNNING") return;
    if (job.data.runAt && fresh.nextRunAt?.toISOString() !== job.data.runAt) return;
    if (fresh.nextRunAt && fresh.nextRunAt.getTime() > Date.now()) return;
    startedAt = new Date();
    const claimed = await prisma.telegramUserCampaign.updateMany({
      where: { id: campaignId, status: "RUNNING", nextRunAt: fresh.nextRunAt, lastRunAt: fresh.lastRunAt },
      data: { nextRunAt: null, lastRunAt: startedAt },
    });
    if (!claimed.count) return;

    const rawSession = decryptSecret(campaign.session.sessionStringEncrypted, encryptionKey);
    const apiId = campaign.session.apiId || Number(process.env.TELEGRAM_API_ID || "2040");
    const apiHash = campaign.session.apiHash || process.env.TELEGRAM_API_HASH || "b18441a1ed609e1201303ec84116b674";

    client = new TelegramClient(new StringSession(rawSession), apiId, apiHash, {
      connectionRetries: 3,
      proxy: parseGramJsProxy(campaign.session.proxyUrl),
    });

    await client.connect();

    const targetGroupIds = (Array.isArray(campaign.targetGroupIds)
      ? campaign.targetGroupIds
      : []) as string[];

    let sentCount = fresh.sentCount;
    let failedCount = fresh.failedCount;

    for (let i = sentCount + failedCount; i < targetGroupIds.length; i++) {
      const groupIdStr = targetGroupIds[i];
      if (!groupIdStr) continue;

      // Re-check if campaign was paused mid-execution
      const freshCampaign = await prisma.telegramUserCampaign.findUnique({
        where: { id: campaignId },
        select: { status: true, lastRunAt: true },
      });

      if (freshCampaign?.status !== "RUNNING" || freshCampaign.lastRunAt?.getTime() !== startedAt.getTime()) {
        console.log(`[userbot-worker] Campaign ${campaignId} paused mid-execution.`);
        break;
      }

      // Fetch group info if existing in DB for title
      const groupChatId = BigInt(groupIdStr);
      const groupRecord = await prisma.telegramUserGroup.findFirst({
        where: {
          sessionId: campaign.sessionId,
          telegramChatId: groupChatId,
        },
      });

      const groupTitle = groupRecord?.title || `Group ${groupIdStr}`;

      if (lockLost) throw new Error("Campaign session lock was lost.");

      try {
        if (campaign.template.type === "FORWARD_SAVED_MESSAGE" && campaign.template.savedMessageId) {
          await client.forwardMessages(groupIdStr as any, {
            messages: [Number(campaign.template.savedMessageId)],
            fromPeer: "me",
          });
        } else {
          const messageText = parseSpintax(campaign.template.content || "");
          await client.sendMessage(groupIdStr as any, {
            message: messageText,
          });
        }

        sentCount++;
        await prisma.telegramUserCampaignLog.create({
          data: {
            campaignId: campaign.id,
            groupTitle,
            groupChatId,
            status: "SUCCESS",
          },
        });

        await prisma.telegramUserCampaign.updateMany({
          where: { id: campaign.id, status: "RUNNING", lastRunAt: startedAt },
          data: { sentCount },
        });

        console.log(`[userbot-worker] [${sentCount}/${targetGroupIds.length}] Sent to ${groupTitle}`);
      } catch (err: any) {
        const errorMessage = err?.message || String(err);

        if (errorMessage.includes("FLOOD_WAIT_") || err?.errorMessage?.includes("FLOOD_WAIT")) {
          const match = errorMessage.match(/FLOOD_WAIT_(\d+)/i);
          const floodSeconds = match ? parseInt(match[1]) : 300;
          const resumeAt = new Date(Date.now() + floodSeconds * 1000 + 5000);

          console.warn(`[userbot-worker] FLOOD_WAIT_${floodSeconds}s encountered for campaign ${campaignId}. Auto-rescheduling for ${resumeAt.toISOString()}`);
          
          await prisma.telegramUserCampaignLog.create({
            data: {
              campaignId: campaign.id,
              groupTitle,
              groupChatId,
              status: "FAILED",
              errorDetail: `FLOOD_WAIT: Telegram yêu cầu tạm dừng ${floodSeconds}s.`,
            },
          });

          await prisma.telegramUserSession.update({
            where: { id: campaign.sessionId },
            data: { status: "FLOOD_WAIT" },
          });

          const deferred = await prisma.telegramUserCampaign.updateMany({
            where: { id: campaign.id, status: "RUNNING", lastRunAt: startedAt },
            data: { nextRunAt: resumeAt },
          });

          if (deferred.count && userbotQueue) {
            await userbotQueue.add(JOBS.userbotCampaign, { campaignId, runAt: resumeAt.toISOString() }, {
              delay: floodSeconds * 1000 + 5000,
              jobId: getUserbotCampaignJobId(campaignId, resumeAt.getTime()),
              removeOnComplete: 100, removeOnFail: 100,
            }).catch((error: unknown) => console.error("[userbot-worker] Resume enqueue failed; schedule recovery will retry:", error));
          }
          return;
        } else {
          failedCount++;
          await prisma.telegramUserCampaignLog.create({
            data: {
              campaignId: campaign.id,
              groupTitle,
              groupChatId,
              status: "FAILED",
              errorDetail: errorMessage,
            },
          });

          await prisma.telegramUserCampaign.updateMany({
            where: { id: campaign.id, status: "RUNNING", lastRunAt: startedAt },
            data: { failedCount },
          });
          console.error(`[userbot-worker] Failed sending to ${groupTitle}:`, errorMessage);
        }
      }

      // Apply campaign delay
      if (i < targetGroupIds.length - 1) {
        await sleep(campaign.delaySeconds * 1000);
      }
    }

    // Check if finished current cycle
    const finalCheck = await prisma.telegramUserCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true, isRecurring: true, repeatIntervalHours: true },
    });

    if (finalCheck?.status === "RUNNING") {
      if (finalCheck.isRecurring && (finalCheck.repeatIntervalHours || 0) > 0) {
        const repeatMs = (finalCheck.repeatIntervalHours || 24) * 3600 * 1000;
        const nextRunAt = new Date(Date.now() + repeatMs);

        const scheduled = await prisma.telegramUserCampaign.updateMany({
          where: { id: campaignId, status: "RUNNING", lastRunAt: startedAt },
          data: {
            status: "RUNNING",
            sentCount: 0,
            failedCount: 0,
            nextRunAt,
          },
        });

        if (scheduled.count && userbotQueue) {
          const nextJobId = `userbot_campaign_${campaignId}_${nextRunAt.getTime()}`;
          await userbotQueue.add(JOBS.userbotCampaign, { campaignId, runAt: nextRunAt.toISOString() }, {
            delay: repeatMs, jobId: nextJobId, removeOnComplete: 100, removeOnFail: 100,
          }).catch((error: unknown) => console.error("[userbot-worker] Repeat enqueue failed; schedule recovery will retry:", error));
        }
        console.log(`[userbot-worker] Campaign ${campaignId} completed cycle. Enqueued next run at ${nextRunAt.toISOString()}`);
      } else {
        await prisma.telegramUserCampaign.updateMany({
          where: { id: campaignId, status: "RUNNING", lastRunAt: startedAt },
          data: { status: "COMPLETED", nextRunAt: null },
        });
        console.log(`[userbot-worker] Campaign ${campaignId} COMPLETED.`);
      }
    }

  } catch (error) {
    console.error(`[userbot-worker] Critical error in campaign ${campaignId}:`, error);
    if (startedAt) {
      await prisma.telegramUserCampaign.updateMany({
        where: { id: campaignId, status: "RUNNING", lastRunAt: startedAt },
        data: { status: "FAILED", nextRunAt: null },
      });
    }
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await client?.disconnect().catch(() => undefined);
    if (lockAcquired && redis) {
      await redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        1, lockKey, lockToken,
      ).catch(() => undefined);
    }
  }
}
