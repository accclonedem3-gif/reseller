import { PrismaClient } from "@prisma/client";
import { decryptSecret, getUserbotCampaignJobId, JOBS } from "@reseller/shared/server";
import { randomUUID } from "node:crypto";
import { Api, TelegramClient } from "telegram";
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

async function sendTemplateMessage(
  client: TelegramClient,
  peer: any,
  template: any,
  topicId?: number | null,
) {
  if (template.type === "FORWARD_SAVED_MESSAGE" && template.savedMessageId) {
    if (topicId) {
      const inputPeer = await client.getInputEntity(peer);
      await client.invoke(
        new Api.messages.ForwardMessages({
          fromPeer: "me",
          id: [Number(template.savedMessageId)],
          toPeer: inputPeer,
          topMsgId: Number(topicId),
        }),
      );
    } else {
      await client.forwardMessages(peer, {
        messages: [Number(template.savedMessageId)],
        fromPeer: "me",
      });
    }
  } else {
    const rawText =
      (template.content && template.content.trim()) ||
      (template.savedMessageText && template.savedMessageText.trim()) ||
      (template.name && template.name.trim()) ||
      "";
    const messageText = parseSpintax(rawText);
    const sendParams: any = { message: messageText };
    if (topicId) {
      sendParams.replyTo = Number(topicId);
    }
    await client.sendMessage(peer, sendParams);
  }
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
    if (job.data.runAt) {
      if (!fresh.nextRunAt) return;
      const jobTime = new Date(job.data.runAt).getTime();
      const freshTime = fresh.nextRunAt.getTime();
      if (Number.isNaN(jobTime) || Math.abs(freshTime - jobTime) > 1000) return;
    }
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
    await client.getDialogs({ limit: 100 }).catch(() => undefined);

    const targetGroupIds = (Array.isArray(campaign.targetGroupIds)
      ? campaign.targetGroupIds
      : []) as string[];

    const targetMode = (campaign as any).targetMode || "GROUP_ONLY";
    const targetTopics = (campaign as any).targetTopics && typeof (campaign as any).targetTopics === "object"
      ? ((campaign as any).targetTopics as Record<string, number>)
      : {};
    const maxMembersPerRun = Math.min(Math.max((campaign as any).maxMembersPerRun ?? 30, 1), 100);

    let sentCount = fresh.sentCount;
    let failedCount = fresh.failedCount;

    const startIdx = targetMode === "GROUP_ONLY" ? Math.min(sentCount + failedCount, targetGroupIds.length) : 0;

    for (let i = startIdx; i < targetGroupIds.length; i++) {
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

      if (lockLost) throw new Error("Campaign session lock was lost.");

      // Fetch group info if existing in DB for title
      const groupChatId = BigInt(groupIdStr);
      const groupRecord = await prisma.telegramUserGroup.findFirst({
        where: {
          sessionId: campaign.sessionId,
          telegramChatId: groupChatId,
        },
      });

      const groupTitle = groupRecord?.title || `Group ${groupIdStr}`;
      const topicId = targetTopics[groupIdStr] ? Number(targetTopics[groupIdStr]) : null;

      // --- 1. Send to Group (if GROUP_ONLY or BOTH) ---
      if (targetMode === "GROUP_ONLY" || targetMode === "BOTH") {
        try {
          await sendTemplateMessage(client, groupIdStr, campaign.template, topicId);

          sentCount++;
          await prisma.telegramUserCampaignLog.create({
            data: {
              campaignId: campaign.id,
              groupTitle,
              groupChatId,
              targetType: "GROUP",
              targetName: topicId ? `${groupTitle} (Topic #${topicId})` : groupTitle,
              topicId,
              status: "SUCCESS",
            },
          });

          await prisma.telegramUserCampaign.updateMany({
            where: { id: campaign.id, status: "RUNNING", lastRunAt: startedAt },
            data: { sentCount },
          });

          console.log(`[userbot-worker] [${sentCount}] Sent to ${groupTitle}${topicId ? ` (topic #${topicId})` : ""}`);
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
                targetType: "GROUP",
                targetName: groupTitle,
                topicId,
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
                targetType: "GROUP",
                targetName: groupTitle,
                topicId,
                status: "FAILED",
                errorDetail: errorMessage,
              },
            });

            await prisma.telegramUserCampaign.updateMany({
              where: { id: campaign.id, status: "RUNNING", lastRunAt: startedAt },
              data: { failedCount },
            });
            console.error(`[userbot-worker] Failed sending to group ${groupTitle}:`, errorMessage);
          }
        }

        if (campaign.delaySeconds > 0) {
          await sleep(campaign.delaySeconds * 1000);
        }
      }

      // --- 2. Send DM to Members (if MEMBERS_DM or BOTH) ---
      if (targetMode === "MEMBERS_DM" || targetMode === "BOTH") {
        const pauseCheck = await prisma.telegramUserCampaign.findUnique({
          where: { id: campaignId },
          select: { status: true, lastRunAt: true },
        });
        if (pauseCheck?.status !== "RUNNING" || pauseCheck.lastRunAt?.getTime() !== startedAt.getTime()) {
          console.log(`[userbot-worker] Campaign ${campaignId} paused before DMing members.`);
          break;
        }

        let participantsResult: any;
        try {
          const inputEntity = await client.getInputEntity(groupIdStr as any);
          participantsResult = await client.invoke(
            new Api.channels.GetParticipants({
              channel: inputEntity,
              filter: new Api.ChannelParticipantsRecent(),
              offset: 0,
              limit: Math.max(50, maxMembersPerRun * 3),
              hash: BigInt(0) as any,
            }),
          );
        } catch (fetchErr: any) {
          const fetchMsg = fetchErr?.message || String(fetchErr);
          const isHidden = fetchMsg.includes("CHAT_ADMIN_REQUIRED") || fetchMsg.includes("CHANNEL_PRIVATE");
          console.warn(`[userbot-worker] Cannot fetch participants for ${groupTitle}:`, fetchMsg);
          await prisma.telegramUserCampaignLog.create({
            data: {
              campaignId: campaign.id,
              groupTitle,
              groupChatId,
              targetType: "MEMBER",
              targetName: "Thành viên nhóm",
              status: "SKIPPED",
              errorDetail: isHidden
                ? "Nhóm đã bật tính năng ẩn danh sách thành viên (chỉ Admin mới xem được)."
                : `Không thể tải danh sách thành viên: ${fetchMsg}`,
            },
          });
          participantsResult = null;
        }

        if (participantsResult && Array.isArray(participantsResult.participants)) {
          const adminUserIds = new Set<string>();
          for (const p of participantsResult.participants) {
            const pClass = p?.className;
            if (
              pClass === "ChannelParticipantCreator" ||
              pClass === "ChannelParticipantAdmin" ||
              p?.adminRights
            ) {
              if (p.userId) adminUserIds.add(p.userId.toString());
            }
          }

          const candidateUsers = (participantsResult.users || []).filter((u: any) => {
            const uId = u?.id?.toString();
            if (!uId) return false;
            if (adminUserIds.has(uId)) return false;
            if (u.bot || u.deleted || u.isSelf) return false;
            if (campaign.session.telegramUserId && uId === campaign.session.telegramUserId) return false;
            return true;
          });

          const targetMembers = candidateUsers.slice(0, maxMembersPerRun);
          console.log(`[userbot-worker] Group ${groupTitle}: found ${candidateUsers.length} ordinary members, sending DM up to ${targetMembers.length}`);

          for (let mIdx = 0; mIdx < targetMembers.length; mIdx++) {
            const member = targetMembers[mIdx];
            const memberFresh = await prisma.telegramUserCampaign.findUnique({
              where: { id: campaignId },
              select: { status: true, lastRunAt: true },
            });
            if (memberFresh?.status !== "RUNNING" || memberFresh.lastRunAt?.getTime() !== startedAt.getTime()) {
              console.log(`[userbot-worker] Campaign ${campaignId} paused during member DM.`);
              break;
            }
            if (lockLost) throw new Error("Campaign session lock was lost.");

            const memberName = [member.firstName, member.lastName].filter(Boolean).join(" ") ||
              (member.username ? `@${member.username}` : `User ${member.id}`);

            try {
              await sendTemplateMessage(client, member.id, campaign.template);
              sentCount++;

              await prisma.telegramUserCampaignLog.create({
                data: {
                  campaignId: campaign.id,
                  groupTitle,
                  groupChatId,
                  targetType: "MEMBER",
                  targetName: memberName,
                  status: "SUCCESS",
                },
              });

              await prisma.telegramUserCampaign.updateMany({
                where: { id: campaign.id, status: "RUNNING", lastRunAt: startedAt },
                data: { sentCount },
              });

              console.log(`[userbot-worker] [${sentCount}] DM sent to ${memberName} (group ${groupTitle})`);
            } catch (dmErr: any) {
              const dmErrMsg = dmErr?.message || String(dmErr);
              if (dmErrMsg.includes("PEER_FLOOD") || dmErr?.errorMessage?.includes("PEER_FLOOD")) {
                console.warn(`[userbot-worker] PEER_FLOOD encountered on member ${memberName}. Pausing campaign.`);
                failedCount++;
                await prisma.telegramUserCampaignLog.create({
                  data: {
                    campaignId: campaign.id,
                    groupTitle,
                    groupChatId,
                    targetType: "MEMBER",
                    targetName: memberName,
                    status: "FAILED",
                    errorDetail: "PEER_FLOOD: Telegram giới hạn tài khoản gửi tin nhắn cho người lạ. Hệ thống tự động tạm dừng để bảo vệ tài khoản.",
                  },
                });

                await prisma.telegramUserCampaign.updateMany({
                  where: { id: campaign.id, status: "RUNNING", lastRunAt: startedAt },
                  data: { status: "PAUSED", failedCount },
                });
                return;
              } else if (dmErrMsg.includes("FLOOD_WAIT_") || dmErr?.errorMessage?.includes("FLOOD_WAIT")) {
                const match = dmErrMsg.match(/FLOOD_WAIT_(\d+)/i);
                const floodSeconds = match ? parseInt(match[1]) : 300;
                const resumeAt = new Date(Date.now() + floodSeconds * 1000 + 5000);
                console.warn(`[userbot-worker] FLOOD_WAIT_${floodSeconds}s encountered on member ${memberName}. Auto-rescheduling.`);

                await prisma.telegramUserCampaignLog.create({
                  data: {
                    campaignId: campaign.id,
                    groupTitle,
                    groupChatId,
                    targetType: "MEMBER",
                    targetName: memberName,
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
                  }).catch((error: unknown) => console.error("[userbot-worker] Resume enqueue failed:", error));
                }
                return;
              } else {
                failedCount++;
                await prisma.telegramUserCampaignLog.create({
                  data: {
                    campaignId: campaign.id,
                    groupTitle,
                    groupChatId,
                    targetType: "MEMBER",
                    targetName: memberName,
                    status: "FAILED",
                    errorDetail: dmErrMsg,
                  },
                });

                await prisma.telegramUserCampaign.updateMany({
                  where: { id: campaign.id, status: "RUNNING", lastRunAt: startedAt },
                  data: { failedCount },
                });
                console.error(`[userbot-worker] Failed sending DM to ${memberName}:`, dmErrMsg);
              }
            }

            // Delay between member DMs
            if (mIdx < targetMembers.length - 1 && campaign.delaySeconds > 0) {
              await sleep(campaign.delaySeconds * 1000);
            }
          }
        }
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
          const nextJobId = getUserbotCampaignJobId(campaignId, nextRunAt.getTime());
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
