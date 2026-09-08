import IORedis from "ioredis";
import { Prisma } from "@prisma/client";
import { REDIS_URL, INFRA_RETRY_MS } from "../config/env";
import { formatError, sleep } from "../format/text";
import { prisma } from "./prisma";

export function createRedisConnection(): IORedis {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  // Avoid noisy default stack traces while the worker is waiting for local infra.
  connection.on("error", () => undefined);
  return connection;
}

export async function waitForInfrastructure(): Promise<IORedis> {
  while (true) {
    const redis = createRedisConnection();
    try {
      await redis.connect();
      await redis.ping();
      await prisma.$connect();
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
      console.log("[worker] Connected to Redis and PostgreSQL.");
      return redis;
    } catch (error) {
      console.error(
        `[worker] Waiting for infrastructure. ${formatError(error)}. Retrying in ${Math.round(INFRA_RETRY_MS / 1000)}s...`,
      );
      await prisma.$disconnect().catch(() => undefined);
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
      await sleep(INFRA_RETRY_MS);
    }
  }
}
