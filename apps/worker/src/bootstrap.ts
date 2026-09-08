import "dotenv/config";
import { Queue, Worker, Job } from "bullmq";
import { QUEUES, JOBS } from "@reseller/shared/server";
import { setupAccountCheckWorker, killAllChildren } from "./account-check";
import {
  TELEGRAM_POLL_INTERVAL_MS,
  CATALOG_SYNC_INTERVAL_MS,
  CATALOG_SCHEDULER_TICK_MS,
  CATALOG_SYNC_CONCURRENCY,
  CUSTOMER_TOPUP_SWEEP_INTERVAL_MS,
  DATA_CLEANUP_INTERVAL_MS,
  PAYOS_ORDER_SWEEP_INTERVAL_MS,
  OKX_DEPOSIT_POLL_INTERVAL_MS,
  TON_PAYMENT_SCAN_INTERVAL_MS,
  INTERNAL_SOURCE_ORDER_SWEEP_INTERVAL_MS,
  validateProductionConfig,
} from "./config/env";
import { prisma, waitForInfrastructure } from "./infra";
import { formatError } from "./format/text";
import {
  syncCatalogForShop,
  releaseCatalogSyncLock,
  scheduleCatalogSyncJobs,
  setCatalogSyncContext,
} from "./fulfillment/catalog-sync";
import {
  processPurchase,
  reconcilePendingInternalSourceOrders,
  reconcilePendingRoboticvnOrders,
} from "./fulfillment/purchase";
import {
  setPaymentContext,
  reconcilePendingPayOSOrders,
  reconcilePendingTierDeposits,
  pollOkxDeposits,
  expireSellerDepositRequests,
  scanSolanaUsdtPayments,
  scanTrc20UsdtPayments,
  scanTonUsdtPayments,
} from "./payments";
import {
  processBroadcast,
  pollTelegramBots,
  runTierExpiryReminders,
  expireSellerTiers,
  runTierAutoRenewals,
  expireCustomerWalletTopups,
  cleanupStaleData,
  expireAwaitingPaymentOrders,
  sweepScheduledBroadcasts,
} from "./schedulers";

export async function bootstrap(): Promise<void> {
  validateProductionConfig();

  const redis = await waitForInfrastructure();

  const syncQueue = new Queue(QUEUES.syncCatalog, {
    connection: redis,
  });
  setCatalogSyncContext({ queue: syncQueue, redis });

  const purchaseQueue = new Queue(QUEUES.purchaseUpstream, {
    connection: redis,
  });
  setPaymentContext({ purchaseQueue, redis });

  const broadcastQueue = new Queue(QUEUES.broadcast, {
    connection: redis,
  });

  const syncWorker = new Worker(
    QUEUES.syncCatalog,
    async (job: Job) => {
      if (job.name === JOBS.syncCatalog) {
        try {
          return await syncCatalogForShop(job.data.shopId);
        } finally {
          await releaseCatalogSyncLock(redis, job.data.shopId, job.data.lockToken).catch(() => undefined);
        }
      }
      return null;
    },
    {
      connection: redis,
      concurrency: Math.max(1, Math.floor(CATALOG_SYNC_CONCURRENCY)),
    }
  );

  const purchaseWorker = new Worker(
    QUEUES.purchaseUpstream,
    async (job: Job) => {
      if (job.name === JOBS.purchaseUpstream) {
        return processPurchase(job as any);
      }
      return null;
    },
    {
      connection: redis,
      concurrency: 2,
    }
  );

  const broadcastWorker = new Worker(
    QUEUES.broadcast,
    async (job: Job) => {
      if (job.name === JOBS.broadcast) {
        return processBroadcast(job as any);
      }
      return null;
    },
    {
      connection: redis,
      concurrency: 1,
    }
  );

  syncWorker.on("failed", (job, error) => {
    console.error("[worker] Sync job failed:", job?.id, error);
  });
  syncWorker.on("error", (error) => {
    console.error("[worker] Sync worker error:", formatError(error));
  });

  purchaseWorker.on("failed", (job, error) => {
    console.error("[worker] Purchase job failed:", job?.id, error);
  });
  purchaseWorker.on("error", (error) => {
    console.error("[worker] Purchase worker error:", formatError(error));
  });

  broadcastWorker.on("failed", (job, error) => {
    console.error("[worker] Broadcast job failed:", job?.id, error);
  });
  broadcastWorker.on("error", (error) => {
    console.error("[worker] Broadcast worker error:", formatError(error));
  });

  setInterval(() => {
    void pollTelegramBots().catch((error) => {
      console.error("[worker] Telegram poll skipped:", formatError(error));
    });
  }, TELEGRAM_POLL_INTERVAL_MS);

  setInterval(() => {
    void reconcilePendingPayOSOrders(purchaseQueue).catch((error) => {
      console.error("[worker] PayOS order sweep failed:", formatError(error));
    });
  }, PAYOS_ORDER_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void reconcilePendingTierDeposits().catch((error) => {
      console.error("[worker] Tier PayOS deposit sweep failed:", formatError(error));
    });
  }, PAYOS_ORDER_SWEEP_INTERVAL_MS);
  void reconcilePendingTierDeposits().catch(() => undefined);

  setInterval(() => {
    void pollOkxDeposits(purchaseQueue).catch((error) => {
      console.error("[worker] OKX deposit poll failed:", formatError(error));
    });
  }, OKX_DEPOSIT_POLL_INTERVAL_MS);

  setInterval(() => {
    void reconcilePendingInternalSourceOrders().catch((error) => {
      console.error("[worker] Internal source order sweep failed:", formatError(error));
    });
  }, INTERNAL_SOURCE_ORDER_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void reconcilePendingRoboticvnOrders().catch((error) => {
      console.error("[worker] Roboticvn order sweep failed:", formatError(error));
    });
  }, INTERNAL_SOURCE_ORDER_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void scheduleCatalogSyncJobs(syncQueue, redis).catch((error) => {
      console.error("[worker] Catalog sync scheduler failed:", formatError(error));
    });
  }, CATALOG_SCHEDULER_TICK_MS);

  setInterval(() => {
    void expireCustomerWalletTopups().catch((error) => {
      console.error("[worker] Customer wallet topup sweep failed:", formatError(error));
    });
  }, CUSTOMER_TOPUP_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void expireSellerDepositRequests().catch((error) => {
      console.error("[worker] Seller deposit sweep failed:", formatError(error));
    });
  }, CUSTOMER_TOPUP_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void cleanupStaleData().catch((error) => {
      console.error("[worker] Data cleanup failed:", formatError(error));
    });
  }, DATA_CLEANUP_INTERVAL_MS);
  void cleanupStaleData().catch(() => undefined);

  setInterval(() => {
    void expireSellerTiers().catch((error) => {
      console.error("[worker] Seller tier expiry failed:", formatError(error));
    });
  }, 15 * 60 * 1000);
  void expireSellerTiers().catch(() => undefined);

  setInterval(() => {
    void runTierAutoRenewals().catch((error) => {
      console.error("[worker] Tier auto-renew failed:", formatError(error));
    });
  }, 6 * 60 * 60 * 1000);
  void runTierAutoRenewals().catch(() => undefined);

  setInterval(() => {
    void runTierExpiryReminders().catch((error) => {
      console.error("[worker] Tier expiry reminders failed:", formatError(error));
    });
  }, 6 * 60 * 60 * 1000);
  void runTierExpiryReminders().catch(() => undefined);

  setInterval(() => {
    void sweepScheduledBroadcasts(broadcastQueue).catch((error) => {
      console.error("[worker] Broadcast schedule sweep failed:", formatError(error));
    });
  }, 60 * 1000);
  void sweepScheduledBroadcasts(broadcastQueue).catch(() => undefined);

  setInterval(() => {
    void expireAwaitingPaymentOrders().catch((error) => {
      console.error("[worker] Awaiting payment expiry sweep failed:", formatError(error));
    });
  }, 30 * 1000);
  void expireAwaitingPaymentOrders().catch(() => undefined);

  setInterval(() => {
    void scanSolanaUsdtPayments().catch((error) => {
      console.error("[worker] Solana auto-detect sweep failed:", formatError(error));
    });
  }, 30 * 1000);
  void scanSolanaUsdtPayments().catch(() => undefined);

  setInterval(() => {
    void scanTrc20UsdtPayments().catch((error) => {
      console.error("[worker] TRC20 auto-detect sweep failed:", formatError(error));
    });
  }, 30 * 1000);
  void scanTrc20UsdtPayments().catch(() => undefined);

  setInterval(() => {
    void scanTonUsdtPayments().catch((error) => {
      console.error("[worker] TON auto-detect sweep failed:", formatError(error));
    });
  }, TON_PAYMENT_SCAN_INTERVAL_MS);
  void scanTonUsdtPayments().catch(() => undefined);

  // Warranty auto-check worker
  let accountCheckHandles: Awaited<ReturnType<typeof setupAccountCheckWorker>> | null = null;
  try {
    accountCheckHandles = await setupAccountCheckWorker(prisma, redis);
  } catch (error) {
    console.error("[worker] Failed to setup account-check worker:", formatError(error));
  }

  console.log(
    `[worker] Started queue workers and Telegram poller. Catalog sync concurrency=${Math.max(
      1,
      Math.floor(CATALOG_SYNC_CONCURRENCY)
    )}, scheduler tick=${CATALOG_SCHEDULER_TICK_MS}ms, target interval=${CATALOG_SYNC_INTERVAL_MS}ms.`
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] Received ${signal} — beginning graceful shutdown.`);

    // 1. Stop the stuck-claim sweep immediately so it can't enqueue new work mid-shutdown.
    if (accountCheckHandles && accountCheckHandles.sweepTimer) {
      clearInterval(accountCheckHandles.sweepTimer);
    }

    // 2. DRAIN in-flight account-check jobs FIRST (bounded ~12s).
    if (accountCheckHandles?.worker) {
      await Promise.race([
        accountCheckHandles.worker
          .close()
          .catch((e: unknown) => console.error("[worker] account-check worker.close failed:", formatError(e))),
        new Promise((resolve) => setTimeout(resolve, 12000)),
      ]);
    }

    // 3. NOW kill any subprocess children that didn't finish within the drain window.
    if (typeof killAllChildren === "function") {
      try {
        killAllChildren();
      } catch {}
    }

    // 4. Close queues + the remaining workers.
    const tasks: Promise<unknown>[] = [];
    if (accountCheckHandles) {
      tasks.push(
        accountCheckHandles.queue
          .close()
          .catch((e: unknown) => console.error("[worker] account-check queue.close failed:", formatError(e)))
      );
    }
    try {
      tasks.push(syncWorker.close().catch(() => undefined));
    } catch {}
    try {
      tasks.push(syncQueue.close().catch(() => undefined));
    } catch {}
    try {
      tasks.push(purchaseQueue.close().catch(() => undefined));
    } catch {}
    try {
      tasks.push(broadcastQueue.close().catch(() => undefined));
    } catch {}

    await Promise.race([Promise.all(tasks), new Promise((resolve) => setTimeout(resolve, 3000))]);
    try {
      await redis.quit();
    } catch {}
    console.log("[worker] Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("unhandledRejection", (reason) => {
    console.error(
      "[worker] UNHANDLED REJECTION:",
      reason instanceof Error ? reason.stack || reason.message : reason
    );
  });
  process.on("uncaughtException", (err) => {
    console.error("[worker] UNCAUGHT EXCEPTION:", err?.stack || err);
    void shutdown("uncaughtException");
  });
}
