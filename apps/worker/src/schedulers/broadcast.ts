import { Queue, Job } from "bullmq";
import { JOBS, computeNextVnRunAt, decryptSecret, isMockBotToken, telegramSendPhoto, telegramSendMessage } from "@reseller/shared/server";
import { prisma } from "../infra";
import { getEncryptionKey } from "../config/env";

export function computeNextRunAt(
  sendTime: string,
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | string,
  repeatDay?: number | null
): Date {
  // Vietnam wall-clock (UTC+7) — this process runs UTC, so the old local-time math fired 7h late.
  return computeNextVnRunAt(sendTime, frequency, repeatDay);
}

export async function cleanStaleBroadcasts(): Promise<void> {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
  try {
    const result = await prisma.broadcast.updateMany({
      where: {
        status: { in: ["QUEUED", "SENDING"] },
        createdAt: { lte: staleThreshold },
      },
      data: {
        status: "FAILED",
        sentAt: new Date(),
      },
    });
    if (result.count > 0) {
      console.log(`[broadcast] Discarded ${result.count} stale QUEUED/SENDING broadcasts from previous runs.`);
    }
  } catch (error) {
    console.error("[broadcast] Failed to clean stale broadcasts:", error);
  }
}

export async function sweepScheduledBroadcasts(broadcastQueue: Queue): Promise<void> {
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

  // 1. Expire overdue one-time SCHEDULED broadcasts (> 30 mins late -> mark FAILED so we never fire stale broadcasts)
  await prisma.broadcast.updateMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: thirtyMinutesAgo },
    },
    data: {
      status: "FAILED",
      sentAt: now,
    },
  });

  // 2. Fire valid due SCHEDULED broadcasts (scheduled within the last 30 minutes)
  const dueBroadcasts = await prisma.broadcast.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now, gte: thirtyMinutesAgo },
    },
  });
  for (const b of dueBroadcasts) {
    const totalTargets = await prisma.customer.count({ where: { shopId: b.shopId, blacklisted: false } });
    await prisma.broadcast.update({
      where: { id: b.id },
      data: { status: "QUEUED", totalTargets, updatedAt: now },
    });
    await broadcastQueue.add(
      JOBS.broadcast,
      { broadcastId: b.id },
      { jobId: `broadcast-${b.id}-${Date.now()}` }
    );
    console.log(`[scheduler] Fired scheduled broadcast ${b.id}`);
  }

  // 3. Fire recurring schedules
  const dueSchedules = await prisma.broadcastSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    include: { shop: { include: { botConfig: true } } },
  });
  for (const sched of dueSchedules) {
    // If schedule is older than 2 hours, do NOT fire an outdated backlog; just advance nextRunAt
    const isStale = sched.nextRunAt && sched.nextRunAt.getTime() < now.getTime() - 2 * 60 * 60 * 1000;
    if (!isStale) {
      const totalTargets = await prisma.customer.count({ where: { shopId: sched.shopId, blacklisted: false } });
      const broadcast = await prisma.broadcast.create({
        data: {
          shopId: sched.shopId,
          sellerId: sched.sellerId,
          scheduleId: sched.id,
          title: sched.title,
          message: sched.message,
          imageUrl: sched.imageUrl,
          status: "QUEUED",
          totalTargets,
        },
      });
      await broadcastQueue.add(
        JOBS.broadcast,
        { broadcastId: broadcast.id },
        { jobId: `broadcast-${broadcast.id}-${Date.now()}` }
      );
      console.log(`[scheduler] Fired recurring schedule ${sched.id} → broadcast ${broadcast.id}`);
    } else {
      console.warn(`[scheduler] Recurring schedule ${sched.id} nextRunAt was too far in past, advancing without firing.`);
    }
    await prisma.broadcastSchedule.update({
      where: { id: sched.id },
      data: {
        lastRunAt: now,
        nextRunAt: computeNextRunAt(sched.sendTime, sched.frequency, sched.repeatDay),
      },
    });
  }

  // 4. Expire old stuck QUEUED broadcasts (> 15 mins -> mark FAILED instead of rescuing endlessly)
  await prisma.broadcast.updateMany({
    where: {
      status: "QUEUED",
      createdAt: { lte: fifteenMinutesAgo },
    },
    data: {
      status: "FAILED",
      sentAt: now,
    },
  });

  // 5. Expire old stuck SENDING broadcasts (> 20 mins -> mark FAILED)
  await prisma.broadcast.updateMany({
    where: {
      status: "SENDING",
      updatedAt: { lte: twentyMinutesAgo },
    },
    data: {
      status: "FAILED",
      sentAt: now,
    },
  });

  // 6. Rescue only FRESH stuck QUEUED broadcasts (between 2m and 15m old)
  // MUST update updatedAt so the same broadcast is NOT rescued on every single tick
  const stuckQueued = await prisma.broadcast.findMany({
    where: {
      status: "QUEUED",
      createdAt: { lte: twoMinutesAgo, gte: fifteenMinutesAgo },
      updatedAt: { lte: twoMinutesAgo },
    },
  });
  for (const b of stuckQueued) {
    console.log(`[scheduler] Rescuing stuck QUEUED broadcast ${b.id}`);
    await prisma.broadcast.update({
      where: { id: b.id },
      data: { updatedAt: now },
    });
    await broadcastQueue.add(
      JOBS.broadcast,
      { broadcastId: b.id },
      { jobId: `broadcast-${b.id}-${Date.now()}` }
    );
  }

  // 7. Rescue only FRESH stuck SENDING broadcasts (between 10m and 20m old)
  const stuckSending = await prisma.broadcast.findMany({
    where: {
      status: "SENDING",
      updatedAt: { lte: new Date(now.getTime() - 10 * 60 * 1000), gte: twentyMinutesAgo },
    },
  });
  for (const b of stuckSending) {
    console.log(`[scheduler] Rescuing stuck SENDING broadcast ${b.id}`);
    await prisma.broadcast.update({
      where: { id: b.id },
      data: { updatedAt: now },
    });
    await broadcastQueue.add(
      JOBS.broadcast,
      { broadcastId: b.id },
      { jobId: `broadcast-${b.id}-${Date.now()}` }
    );
  }
}

export async function processBroadcast(job: Job<{ broadcastId: string }>): Promise<void> {
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: job.data.broadcastId },
    include: {
      shop: {
        include: {
          botConfig: true,
        },
      },
    },
  });
  if (!broadcast) {
    return;
  }

  // 1. Skip if already COMPLETED or FAILED
  if (broadcast.status === "COMPLETED" || broadcast.status === "FAILED") {
    console.log(`[broadcast] Broadcast ${broadcast.id} is already ${broadcast.status}, skipping.`);
    return;
  }

  // 2. Discard if stale (> 20 mins old) — user instructed not to re-run old broadcasts
  if (Date.now() - broadcast.createdAt.getTime() > 20 * 60 * 1000) {
    console.warn(`[broadcast] Broadcast ${broadcast.id} is stale (>20m), marking FAILED and discarding.`);
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        status: "FAILED",
        sentAt: new Date(),
      },
    });
    return;
  }

  const customers = await prisma.customer.findMany({
    where: {
      shopId: broadcast.shopId,
      blacklisted: false,
    },
  });
  const alreadySentIds = new Set(
    (
      await prisma.broadcastLog.findMany({
        where: { broadcastId: broadcast.id, status: "SENT" },
        select: { customerId: true },
      })
    ).map((l) => l.customerId)
  );
  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: {
      status: "SENDING",
      updatedAt: new Date(),
    },
  });

  const botToken = decryptSecret(broadcast.shop?.botConfig?.telegramBotTokenEncrypted, getEncryptionKey());
  if (
    !botToken &&
    !(String(process.env.MOCK_TELEGRAM_MODE || "false") === "true")
  ) {
    console.error(`[broadcast] Shop ${broadcast.shopId} has no valid bot token, failing broadcast ${broadcast.id}`);
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        status: "FAILED",
        failedCount: customers.length,
        sentCount: 0,
        sentAt: new Date(),
      },
    });
    return;
  }

  let sentCount = broadcast.sentCount ?? 0;
  let failedCount = 0;
  const messageText = broadcast.message.length > 4096
    ? broadcast.message.slice(0, 4093) + "..."
    : broadcast.message;

  for (const customer of customers) {
    if (alreadySentIds.has(customer.id)) continue;
    if (!customer.telegramChatId || customer.telegramChatId === "0") continue;

    try {
      if (
        botToken &&
        !(
          String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
          isMockBotToken(botToken)
        )
      ) {
        // Sleep 35ms between messages to comply with Telegram's 30 msgs/sec broadcast rate limit
        await new Promise((r) => setTimeout(r, 35));

        if (broadcast.imageUrl) {
          const MAX_CAPTION = 1024;
          try {
            if (messageText.length <= MAX_CAPTION) {
              await telegramSendPhoto(botToken, customer.telegramChatId, broadcast.imageUrl, {
                caption: messageText,
              });
            } else {
              await telegramSendPhoto(botToken, customer.telegramChatId, broadcast.imageUrl, {});
              await telegramSendMessage(botToken, customer.telegramChatId, messageText);
            }
          } catch (photoError: any) {
            console.warn(`[broadcast] Photo delivery failed for customer ${customer.id}, falling back to text: ${photoError?.message || photoError}`);
            // Fallback to text message so recipients still receive the broadcast if image fails
            await telegramSendMessage(botToken, customer.telegramChatId, messageText);
          }
        } else {
          await telegramSendMessage(botToken, customer.telegramChatId, messageText);
        }
      }
      sentCount += 1;
      await prisma.broadcastLog.upsert({
        where: {
          broadcastId_customerId: {
            broadcastId: broadcast.id,
            customerId: customer.id,
          },
        },
        update: {
          status: "SENT",
          sentAt: new Date(),
        },
        create: {
          broadcastId: broadcast.id,
          customerId: customer.id,
          status: "SENT",
          sentAt: new Date(),
        },
      });
    } catch (error) {
      failedCount += 1;
      await prisma.broadcastLog.upsert({
        where: {
          broadcastId_customerId: {
            broadcastId: broadcast.id,
            customerId: customer.id,
          },
        },
        update: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "Broadcast send failed.",
        },
        create: {
          broadcastId: broadcast.id,
          customerId: customer.id,
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "Broadcast send failed.",
        },
      });
    }
  }
  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: {
      status: failedCount > 0 && sentCount === (broadcast.sentCount ?? 0) ? "FAILED" : "COMPLETED",
      sentCount,
      failedCount,
      sentAt: new Date(),
    },
  });
}
