import { Prisma } from "@prisma/client";
import type IORedis from "ioredis";

export async function popManualStockEntries(
  tx: any,
  sourceProductId: string,
  quantity: number,
  opts?: { orderId?: string | null; customerId?: string | null },
): Promise<{ extracted: string[]; totalCost: number; entryIds: string[] } | null> {
  const now = new Date();
  const candidates = await tx.stockEntry.findMany({
    where: {
      sourceProductId,
      status: "AVAILABLE",
      OR: [
        { batchId: null },
        { batch: { deletedAt: null, expiresAt: null } },
        { batch: { deletedAt: null, expiresAt: { gt: now } } },
      ],
    },
    include: {
      batch: {
        select: {
          id: true,
          costPerUnit: true,
          priority: true,
          createdAt: true,
        },
      },
    },
  });
  candidates.sort((a: any, b: any) => {
    // 1. legacy (no batch) first
    if (!a.batchId && b.batchId) return -1;
    if (a.batchId && !b.batchId) return 1;
    // 2. higher priority first (default 0)
    const pa = a.batch?.priority ?? 0;
    const pb = b.batch?.priority ?? 0;
    if (pa !== pb) return pb - pa;
    // 3. earlier batch.createdAt first
    const ca = a.batch?.createdAt?.getTime?.() ?? 0;
    const cb = b.batch?.createdAt?.getTime?.() ?? 0;
    if (ca !== cb) return ca - cb;
    // 4. earlier uploadedAt first
    const ua = a.uploadedAt.getTime();
    const ub = b.uploadedAt.getTime();
    if (ua !== ub) return ua - ub;
    // 5. stable by id
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const entries = candidates.slice(0, quantity);
  if (entries.length < quantity) {
    return null;
  }
  const entryIds = entries.map((e: any) => e.id);
  await tx.stockEntry.updateMany({
    where: { id: { in: entryIds } },
    data: {
      status: "SOLD",
      soldAt: now,
      soldToOrderId: opts?.orderId ?? null,
      soldToCustomerId: opts?.customerId ?? null,
    },
  });
  const extracted = entries.map((e: any) => e.text);
  const totalCost = entries.reduce(
    (sum: number, e: any) => sum + (e.batch?.costPerUnit ? Number(e.batch.costPerUnit) : 0),
    0,
  );
  const affectedBatchIds = Array.from(
    new Set(entries.map((e: any) => e.batchId).filter(Boolean)),
  );
  for (const bId of affectedBatchIds) {
    const remaining = await tx.stockEntry.count({
      where: { batchId: bId, status: "AVAILABLE" },
    });
    if (remaining === 0) {
      await tx.stockBatch.update({
        where: { id: bId },
        data: { deletedAt: new Date() },
      });
    }
  }
  return { extracted, totalCost, entryIds };
}

export async function countAvailableManualEntries(
  client: any,
  sourceProductId: string,
): Promise<number> {
  const now = new Date();
  return client.stockEntry.count({
    where: {
      sourceProductId,
      status: "AVAILABLE",
      OR: [
        { batchId: null },
        { batch: { deletedAt: null, expiresAt: null } },
        { batch: { deletedAt: null, expiresAt: { gt: now } } },
      ],
    },
  });
}

export async function incrementSoldAndClampAvailable(
  tx: any,
  sourceProductId: string,
  quantity: number,
): Promise<void> {
  const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!sourceProductId || safeQuantity === 0) return;
  await tx.$executeRaw(Prisma.sql`
        UPDATE source_products
        SET sold_count = sold_count + ${safeQuantity},
            available = CASE
                WHEN available IS NULL THEN NULL
                ELSE GREATEST(0, available - ${safeQuantity})
            END,
            updated_at = NOW()
        WHERE id = ${sourceProductId}
    `);
}

export function isManualSourceProduct(product: any): boolean {
  const metadata =
    product?.metadataJson &&
    typeof product.metadataJson === "object" &&
    !Array.isArray(product.metadataJson)
      ? product.metadataJson
      : {};
  return (
    product?.sourceDeliveryMode === "ADD_MAIL" ||
    String(product?.providerName || "").toLowerCase() === "manual" ||
    metadata.manual === true
  );
}

export async function getPreorderAvailableQuantity(
  product: any,
  prismaClient: any,
): Promise<number> {
  if (!product) return 0;
  const metadata =
    product.metadataJson &&
    typeof product.metadataJson === "object" &&
    !Array.isArray(product.metadataJson)
      ? product.metadataJson
      : {};
  if (
    isManualSourceProduct(product) &&
    metadata.shared !== true &&
    product.sourceDeliveryMode !== "ADD_MAIL"
  ) {
    return countAvailableManualEntries(prismaClient, product.id);
  }
  if (product.available === null || product.available === undefined)
    return Number.POSITIVE_INFINITY;
  return Math.max(0, Number(product.available) || 0);
}

export async function releaseOrderStockHold(
  redis: IORedis | null,
  shopId: string,
  sourceProductId: string,
  quantity: number,
): Promise<void> {
  if (!redis || !shopId || !sourceProductId || !quantity || quantity <= 0) return;
  const holdKey = `stock:hold:${shopId}:${sourceProductId}`;
  const script = `
    local hold = tonumber(redis.call("GET", KEYS[1]) or "0")
    local qty = tonumber(ARGV[1])
    local new_hold = hold - qty
    if new_hold < 0 then new_hold = 0 end
    if new_hold > 0 then
      redis.call("SET", KEYS[1], new_hold, "EX", 300)
    else
      redis.call("DEL", KEYS[1])
    end
  `;
  await redis.eval(script, 1, holdKey, quantity).catch((e: any) => {
    console.error("[worker] releaseOrderStockHold failed:", e);
  });
}
