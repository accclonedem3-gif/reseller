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

export async function sweepScheduledBroadcasts(broadcastQueue: Queue): Promise<void> {
  const now = new Date();
  // Fire one-time SCHEDULED broadcasts
  const dueBroadcasts = await prisma.broadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
  });
  for (const b of dueBroadcasts) {
    const totalTargets = await prisma.customer.count({ where: { shopId: b.shopId } });
    await prisma.broadcast.update({
      where: { id: b.id },
      data: { status: "QUEUED", totalTargets },
    });
    await broadcastQueue.add(
      JOBS.broadcast,
      { broadcastId: b.id },
      { jobId: `broadcast-${b.id}-${Date.now()}` }
    );
    console.log(`[scheduler] Fired scheduled broadcast ${b.id}`);
  }
  // Fire recurring schedules
  const dueSchedules = await prisma.broadcastSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    include: { shop: { include: { botConfig: true } } },
  });
  for (const sched of dueSchedules) {
    const totalTargets = await prisma.customer.count({ where: { shopId: sched.shopId } });
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
    await prisma.broadcastSchedule.update({
      where: { id: sched.id },
      data: {
        lastRunAt: now,
        nextRunAt: computeNextRunAt(sched.sendTime, sched.frequency, sched.repeatDay),
      },
    });
    console.log(`[scheduler] Fired recurring schedule ${sched.id} → broadcast ${broadcast.id}`);
  }

  // Rescue stuck QUEUED broadcasts (created >= 2 mins ago and still QUEUED)
  const stuckQueued = await prisma.broadcast.findMany({
    where: {
      status: "QUEUED",
      createdAt: { lte: new Date(Date.now() - 2 * 60 * 1000) },
    },
  });
  for (const b of stuckQueued) {
    console.log(`[scheduler] Rescuing stuck QUEUED broadcast ${b.id}`);
    await broadcastQueue.add(
      JOBS.broadcast,
      { broadcastId: b.id },
      { jobId: `broadcast-${b.id}-${Date.now()}` }
    );
  }

  // Rescue stuck SENDING broadcasts (updated >= 10 mins ago, indicating interrupted worker)
  const stuckSending = await prisma.broadcast.findMany({
    where: {
      status: "SENDING",
      updatedAt: { lte: new Date(Date.now() - 10 * 60 * 1000) },
    },
  });
  for (const b of stuckSending) {
    console.log(`[scheduler] Rescuing stuck SENDING broadcast ${b.id}`);
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
  const customers = await prisma.customer.findMany({
    where: {
      shopId: broadcast.shopId,
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
    },
  });

  const botToken = decryptSecret(broadcast.shop.botConfig?.telegramBotTokenEncrypted, getEncryptionKey());
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
  for (const customer of customers) {
    if (alreadySentIds.has(customer.id)) continue;
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
            if (broadcast.message.length <= MAX_CAPTION) {
              await telegramSendPhoto(botToken, customer.telegramChatId, broadcast.imageUrl, {
                caption: broadcast.message,
              });
            } else {
              await telegramSendPhoto(botToken, customer.telegramChatId, broadcast.imageUrl, {});
              await telegramSendMessage(botToken, customer.telegramChatId, broadcast.message);
            }
          } catch (photoError: any) {
            console.warn(`[broadcast] Photo delivery failed for customer ${customer.id}, falling back to text: ${photoError?.message || photoError}`);
            // Fallback to text message so recipients still receive the broadcast if image fails
            await telegramSendMessage(botToken, customer.telegramChatId, broadcast.message);
          }
        } else {
          await telegramSendMessage(botToken, customer.telegramChatId, broadcast.message);
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
