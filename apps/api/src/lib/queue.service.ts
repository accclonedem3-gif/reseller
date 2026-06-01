import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";

import { JOBS, QUEUES } from "@reseller/shared";

import { AppConfigService } from "../config/app-config.service";
import { CacheService } from "./cache.service";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly syncCatalogQueue: Queue;
  private readonly purchaseQueue: Queue;
  private readonly broadcastQueue: Queue;
  private readonly accountCheckQueue: Queue;

  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(CacheService)
    private readonly cache: CacheService,
  ) {
    this.connection = new IORedis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.syncCatalogQueue = new Queue(QUEUES.syncCatalog, {
      connection: this.connection,
    });
    this.purchaseQueue = new Queue(QUEUES.purchaseUpstream, {
      connection: this.connection,
    });
    this.broadcastQueue = new Queue(QUEUES.broadcast, {
      connection: this.connection,
    });
    this.accountCheckQueue = new Queue(QUEUES.accountCheck, {
      connection: this.connection,
    });
  }

  async addSyncCatalogJob(shopId: string) {
    return this.syncCatalogQueue.add(
      JOBS.syncCatalog,
      { shopId },
      {
        jobId: `sync-${shopId}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  async addPurchaseJob(orderId: string) {
    return this.purchaseQueue.add(
      JOBS.purchaseUpstream,
      { orderId },
      {
        jobId: `purchase-${orderId}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  async addBroadcastJob(broadcastId: string) {
    return this.broadcastQueue.add(
      JOBS.broadcast,
      { broadcastId },
      {
        jobId: `broadcast-${broadcastId}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  async addAccountCheckJob(payload: {
    claimId: string;
    shopId: string;
    tool: "veo" | "grok" | "gpt";
    email: string;
    password: string;
    extra?: string | null;
    proxy?: string | null;
    accounts?: { email: string; password: string; extra?: string | null }[];
  }) {
    // STABLE jobId per claim (no Date.now()): a real provider login is money/ban-sensitive,
    // so a duplicate enqueue for the same claim (double-submit, sweep race, retry) must NOT
    // spawn a second concurrent check. BullMQ dedups by jobId — but only while the job exists
    // in Redis, and a prior COMPLETED/FAILED attempt is retained (removeOnComplete/Fail), which
    // would block a legitimate re-check (recheckClaim). So: if a finished attempt is retained,
    // remove it first; if one is still in flight (waiting/active/delayed), return it as-is
    // instead of enqueuing a duplicate.
    const jobId = `account-check-${payload.claimId}`;
    const existing = await this.accountCheckQueue.getJob(jobId).catch(() => null);
    if (existing) {
      const state = await existing.getState().catch(() => "unknown");
      if (state === "completed" || state === "failed") {
        await existing.remove().catch(() => undefined);
      } else {
        // waiting / active / delayed / unknown(locked) → a check is already in flight for this
        // claim. Suppress the duplicate and hand back the existing job (same jobId the caller
        // will persist as autoCheckJobId). Flag it as pre-existing so the caller's hard-cap
        // defender does NOT remove a job it didn't add (which would cancel another caller's
        // legitimate in-flight check).
        (existing as unknown as { __preExisting?: boolean }).__preExisting = true;
        return existing;
      }
    }
    return this.accountCheckQueue.add(JOBS.accountCheck, payload, {
      jobId,
      // attempts=1: subprocess hitting the real provider must NOT be retried.
      // A second login attempt with the same creds risks the upstream provider flagging the
      // account as suspicious / rate-limited. On failure we route the claim to PENDING_REVIEW
      // via the sweep + applyAutoCheckResult path instead.
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 200,
    });
  }

  async getAccountCheckQueuePosition(jobId: string): Promise<{
    position: number | null;
    total: number;
    state: "active" | "waiting" | null;
    aheadCount: number;
  }> {
    // Cache the queue snapshot for 1s — under load, dozens of pollers ask "what's my position"
    // within the same second. The expensive part is `getJobs(...)` across waiting + active sets.
    const snap = await this.cache.getOrLoad<{
      waitingIds: string[];
      activeIds: string[];
      total: number;
    }>("queue:account-check:snapshot", 1, async () => {
      const [waiting, active, counts] = await Promise.all([
        this.accountCheckQueue.getJobs(["waiting", "delayed"], 0, -1, true),
        this.accountCheckQueue.getJobs(["active"], 0, -1, true),
        this.accountCheckQueue.getJobCounts("waiting", "delayed", "active"),
      ]);
      return {
        waitingIds: waiting.map((j) => String(j.id)),
        activeIds: active.map((j) => String(j.id)),
        total:
          Number(counts.waiting || 0) + Number(counts.delayed || 0) + Number(counts.active || 0),
      };
    });
    const jobIdStr = String(jobId);
    if (snap.activeIds.includes(jobIdStr)) {
      return { position: 0, total: snap.total, state: "active", aheadCount: 0 };
    }
    const waitIdx = snap.waitingIds.indexOf(jobIdStr);
    if (waitIdx === -1) {
      return { position: null, total: snap.total, state: null, aheadCount: 0 };
    }
    return {
      position: waitIdx + 1,
      total: snap.total,
      state: "waiting",
      aheadCount: snap.activeIds.length + waitIdx,
    };
  }

  /** Remove a freshly-enqueued job (called by the hard-cap defender if a burst overshot). */
  async removeAccountCheckJob(jobId: string): Promise<void> {
    if (!jobId) return;
    const job = await this.accountCheckQueue.getJob(jobId);
    if (job) {
      // BullMQ's job.remove() refuses if the job is already locked/active. That's fine — the
      // hard-cap check runs immediately after add(), so the worker hasn't picked it up yet.
      await job.remove().catch(() => undefined);
    }
  }

  async getAccountCheckLoad(): Promise<{ waiting: number; active: number; delayed: number }> {
    const counts = await this.accountCheckQueue.getJobCounts("waiting", "delayed", "active");
    return {
      waiting: Number(counts.waiting || 0),
      delayed: Number(counts.delayed || 0),
      active: Number(counts.active || 0),
    };
  }

  async onModuleDestroy() {
    await Promise.all([
      this.syncCatalogQueue.close(),
      this.purchaseQueue.close(),
      this.broadcastQueue.close(),
      this.accountCheckQueue.close(),
      this.connection.quit(),
    ]);
  }
}
