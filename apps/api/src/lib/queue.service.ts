import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";

import { JOBS, QUEUES } from "@reseller/shared";

import { AppConfigService } from "../config/app-config.service";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly syncCatalogQueue: Queue;
  private readonly purchaseQueue: Queue;
  private readonly broadcastQueue: Queue;

  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
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

  async onModuleDestroy() {
    await Promise.all([
      this.syncCatalogQueue.close(),
      this.purchaseQueue.close(),
      this.broadcastQueue.close(),
      this.connection.quit(),
    ]);
  }
}
