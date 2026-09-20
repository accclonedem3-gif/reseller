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

export class TelegramBroadcastRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private penaltyUntil: number = 0;

  constructor(messagesPerSecond: number = 25) {
    this.maxTokens = messagesPerSecond;
    this.tokens = messagesPerSecond;
    this.refillRatePerMs = messagesPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    if (now < this.penaltyUntil) {
      return;
    }
    const effectiveStart = Math.max(this.lastRefill, this.penaltyUntil);
    const elapsed = now - effectiveStart;
    if (elapsed > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
      this.lastRefill = now;
    }
  }

  penalize(durationMs: number) {
    const now = Date.now();
    this.penaltyUntil = Math.max(this.penaltyUntil, now + durationMs);
    this.tokens = 0;
    this.lastRefill = this.penaltyUntil;
  }

  async acquire(): Promise<void> {
    this.refill();
    const now = Date.now();
    if (now >= this.penaltyUntil && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.schedule();
    });
  }

  private schedule() {
    if (this.timer || this.queue.length === 0) return;
    const now = Date.now();
    this.refill();
    if (now >= this.penaltyUntil && this.tokens >= 1) {
      this.tokens -= 1;
      const next = this.queue.shift();
      if (next) next();
      if (this.queue.length > 0) {
        this.schedule();
      }
      return;
    }

    let waitMs = 20;
    if (now < this.penaltyUntil) {
      waitMs = Math.max(20, this.penaltyUntil - now);
    } else {
      waitMs = Math.max(20, Math.ceil((1 - this.tokens) / this.refillRatePerMs));
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.schedule();
    }, waitMs);
  }
}

interface BroadcastLogBufferItem {
  customerId: string;
  status: "SENT" | "FAILED";
  errorMessage?: string;
  sentAt: Date;
}

async function flushBroadcastLogs(
  broadcastId: string,
  logs: BroadcastLogBufferItem[]
): Promise<void> {
  if (logs.length === 0) return;
  try {
    await prisma.$transaction(
      logs.map((item) =>
        prisma.broadcastLog.upsert({
          where: {
            broadcastId_customerId: {
              broadcastId,
              customerId: item.customerId,
            },
          },
          update: {
            status: item.status,
            errorMessage: item.errorMessage || null,
            sentAt: item.sentAt,
          },
          create: {
            broadcastId,
            customerId: item.customerId,
            status: item.status,
            errorMessage: item.errorMessage || null,
            sentAt: item.sentAt,
          },
        })
      )
    );
  } catch (err) {
    console.error(`[broadcast] Failed to flush ${logs.length} logs for broadcast ${broadcastId}:`, err);
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

  const messageText = broadcast.message.length > 4096
    ? broadcast.message.slice(0, 4093) + "..."
    : broadcast.message;

  const targetCustomers = customers.filter(
    (c) => !alreadySentIds.has(c.id) && c.telegramChatId && c.telegramChatId !== "0"
  );

  if (targetCustomers.length === 0) {
    console.log(`[broadcast] Broadcast ${broadcast.id} has no pending customers to send.`);
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        status: "COMPLETED",
        sentAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return;
  }

  const broadcastId = broadcast.id;
  const broadcastImageUrl = broadcast.imageUrl;
  const rateLimiter = new TelegramBroadcastRateLimiter(25);
  const CONCURRENCY = Math.min(8, targetCustomers.length);

  let sentDelta = 0;
  let failedDelta = 0;
  let sharedIndex = 0;
  const logBuffer: BroadcastLogBufferItem[] = [];
  let isFlushing = false;
  let lastHeartbeatTime = Date.now();

  const maybeFlush = async (force: boolean = false) => {
    if (isFlushing) return;
    const shouldFlush =
      force ||
      logBuffer.length >= 50 ||
      (Date.now() - lastHeartbeatTime >= 4000 && logBuffer.length > 0);

    if (!shouldFlush) return;

    isFlushing = true;
    const batch = logBuffer.splice(0, logBuffer.length);
    const currSent = sentDelta;
    const currFailed = failedDelta;
    sentDelta = 0;
    failedDelta = 0;

    try {
      await flushBroadcastLogs(broadcastId, batch);
      lastHeartbeatTime = Date.now();
      await prisma.broadcast.update({
        where: { id: broadcastId },
        data: {
          sentCount: { increment: currSent },
          failedCount: { increment: currFailed },
          updatedAt: new Date(),
        },
      });
    } catch (e) {
      console.error(`[broadcast] Heartbeat update error:`, e);
      // Re-add deltas on error so counts don't get lost
      sentDelta += currSent;
      failedDelta += currFailed;
    } finally {
      isFlushing = false;
    }
  };

  async function runWorker() {
    while (true) {
      const idx = sharedIndex++;
      if (idx >= targetCustomers.length) break;
      const customer = targetCustomers[idx];
      if (!customer || !customer.telegramChatId) continue;

      await rateLimiter.acquire();

      try {
        if (
          botToken &&
          !(
            String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
            isMockBotToken(botToken)
          )
        ) {
          if (broadcastImageUrl) {
            const MAX_CAPTION = 1024;
            try {
              if (messageText.length <= MAX_CAPTION) {
                await telegramSendPhoto(botToken, customer.telegramChatId, broadcastImageUrl, {
                  caption: messageText,
                });
              } else {
                await telegramSendPhoto(botToken, customer.telegramChatId, broadcastImageUrl, {});
                await telegramSendMessage(botToken, customer.telegramChatId, messageText);
              }
            } catch (photoError: any) {
              const msg = photoError?.message || String(photoError);
              if (msg.includes("retry_after") || msg.includes("429")) {
                rateLimiter.penalize(3000);
              }
              console.warn(`[broadcast] Photo delivery failed for customer ${customer.id}, falling back to text: ${msg}`);
              await telegramSendMessage(botToken, customer.telegramChatId, messageText);
            }
          } else {
            await telegramSendMessage(botToken, customer.telegramChatId, messageText);
          }
        }

        sentDelta += 1;
        logBuffer.push({
          customerId: customer.id,
          status: "SENT",
          sentAt: new Date(),
        });
      } catch (error: any) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes("retry_after") || errMsg.includes("429")) {
          rateLimiter.penalize(3000);
        }
        failedDelta += 1;
        logBuffer.push({
          customerId: customer.id,
          status: "FAILED",
          errorMessage: errMsg,
          sentAt: new Date(),
        });
      }

      await maybeFlush(false);
    }
  }

  // Execute all workers concurrently
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => runWorker())
  );

  // Final drain and flush
  while (logBuffer.length > 0 || isFlushing) {
    await maybeFlush(true);
    if (logBuffer.length > 0) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  if (sentDelta > 0 || failedDelta > 0) {
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        sentCount: { increment: sentDelta },
        failedCount: { increment: failedDelta },
        updatedAt: new Date(),
      },
    });
    sentDelta = 0;
    failedDelta = 0;
  }

  const finalRecord = await prisma.broadcast.findUnique({
    where: { id: broadcast.id },
    select: { sentCount: true, failedCount: true },
  });

  const totalSent = finalRecord?.sentCount ?? 0;
  const totalFailed = finalRecord?.failedCount ?? 0;

  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: {
      status: totalFailed > 0 && totalSent === 0 ? "FAILED" : "COMPLETED",
      sentAt: new Date(),
      updatedAt: new Date(),
    },
  });

  console.log(`[broadcast] Finished broadcast ${broadcast.id}: sent=${totalSent}, failed=${totalFailed}`);
}
