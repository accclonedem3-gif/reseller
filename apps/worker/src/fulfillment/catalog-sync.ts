import type IORedis from "ioredis";
import type { Queue } from "bullmq";
import {
  JOBS,
  decryptSecret,
  isMockBotToken,
  telegramSendMessage,
  resolveRestockTemplate,
  renderRestockHtml,
  restockNotiDedupKey,
  RESTOCK_NOTI_DEDUP_TTL_MS,
  isRoboticvnProvider,
  isMockBuyerKey,
  getMockProviderProducts,
  fetchProviderProducts,
} from "@reseller/shared/server";
import { prisma } from "../infra/prisma";
import {
  getEncryptionKey,
  ROBOTICVN_CATALOG_SYNC_INTERVAL_MS,
  CATALOG_SYNC_INTERVAL_MS,
  CATALOG_SCHEDULER_TICK_MS,
  CATALOG_SHOPS_REFRESH_MS,
  CATALOG_SYNC_BATCH_SIZE,
  CATALOG_SYNC_LOCK_TTL_MS,
} from "../config/env";
import { formatError } from "../format/text";
import { toDecimal, extractInternalBusinessFields } from "../money";

export interface StockNotificationItem {
  sourceProductId: string;
  displayName: string;
  addedQuantity: number;
  available: number;
  price: number | null;
}

let activeCatalogShopIds: string[] = [];
let activeCatalogShopCursor = 0;
let lastCatalogShopRefreshAt = 0;

let _globalSyncQueue: Queue | null = null;
let _globalRedis: IORedis | null = null;

export function setCatalogSyncContext(ctx: {
  queue?: Queue | null;
  redis?: IORedis | null;
}) {
  if (ctx.queue !== undefined) _globalSyncQueue = ctx.queue;
  if (ctx.redis !== undefined) _globalRedis = ctx.redis;
}

export function getCatalogSyncLockKey(shopId: string): string {
  return `worker:catalog-sync:scheduled:${shopId}`;
}

export function getCatalogSyncBatchSize(shopCount: number): number {
  if (!Number.isFinite(shopCount) || shopCount <= 0) {
    return 0;
  }
  if (Number.isFinite(CATALOG_SYNC_BATCH_SIZE) && CATALOG_SYNC_BATCH_SIZE > 0) {
    return Math.max(1, Math.floor(CATALOG_SYNC_BATCH_SIZE));
  }
  if (CATALOG_SYNC_INTERVAL_MS <= 0 || CATALOG_SCHEDULER_TICK_MS <= 0) {
    return shopCount;
  }
  return Math.max(
    1,
    Math.ceil((shopCount * CATALOG_SCHEDULER_TICK_MS) / CATALOG_SYNC_INTERVAL_MS),
  );
}

export async function refreshActiveCatalogShopIds(
  force = false,
): Promise<string[]> {
  const now = Date.now();
  if (
    !force &&
    activeCatalogShopIds.length > 0 &&
    now - lastCatalogShopRefreshAt < CATALOG_SHOPS_REFRESH_MS
  ) {
    return activeCatalogShopIds;
  }
  const shops = await prisma.shop.findMany({
    where: {
      status: "ACTIVE",
      providerConfig: {
        is: {
          connectionStatus: "VERIFIED",
        },
      },
    },
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
  activeCatalogShopIds = shops.map((shop) => shop.id);
  lastCatalogShopRefreshAt = now;
  if (activeCatalogShopCursor >= activeCatalogShopIds.length) {
    activeCatalogShopCursor = 0;
  }
  return activeCatalogShopIds;
}

export async function releaseCatalogSyncLock(
  redis: IORedis,
  shopId: string,
  expectedToken?: string,
): Promise<void> {
  const lockKey = getCatalogSyncLockKey(shopId);
  if (!expectedToken) {
    await redis.del(lockKey);
    return;
  }
  const currentToken = await redis.get(lockKey);
  if (currentToken === expectedToken) {
    await redis.del(lockKey);
  }
}

export async function enqueueCatalogSyncJob(
  queue: Queue,
  redis: IORedis,
  shopId: string,
): Promise<boolean> {
  const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const acquired = await redis.set(
    getCatalogSyncLockKey(shopId),
    lockToken,
    "PX",
    CATALOG_SYNC_LOCK_TTL_MS,
    "NX",
  );
  if (acquired !== "OK") {
    return false;
  }
  try {
    await queue.add(
      JOBS.syncCatalog,
      {
        shopId,
        lockToken,
      },
      {
        jobId: `sync-${shopId}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    return true;
  } catch (error) {
    await releaseCatalogSyncLock(redis, shopId, lockToken).catch(() => undefined);
    throw error;
  }
}

let __adminTemplateCustCache: any = null;
let __adminTemplateCustCacheAt = 0;

export async function getAdminTemplateCustomizationCached(): Promise<any> {
  const now = Date.now();
  if (
    __adminTemplateCustCache !== null &&
    now - __adminTemplateCustCacheAt < 60000
  ) {
    return __adminTemplateCustCache;
  }
  try {
    const adminCfg = await prisma.botConfig.findFirst({
      where: { isGlobalDefault: true },
      select: { customizationJson: true },
    });
    __adminTemplateCustCache = adminCfg?.customizationJson || null;
    __adminTemplateCustCacheAt = now;
    return __adminTemplateCustCache;
  } catch {
    return null;
  }
}

export async function notifyCatalogStockUpdates(
  shopId: string,
  encryptedBotToken: string | null,
  notifications: StockNotificationItem[],
  redisClient?: IORedis | null,
): Promise<number> {
  if (notifications.length === 0 || !encryptedBotToken) {
    return 0;
  }
  // The sync can run for several seconds. Re-read the switches here so a seller
  // enabling own-products-only during an in-flight sync cannot receive a stale
  // source-product restock notification after the toggle has been saved.
  const notificationConfig = await prisma.providerConfig.findUnique({
    where: { shopId },
    select: { sourceNotificationSyncEnabled: true, ownProductsOnly: true },
  });
  if (
    !notificationConfig?.sourceNotificationSyncEnabled ||
    notificationConfig.ownProductsOnly
  ) {
    return 0;
  }
  const token = decryptSecret(encryptedBotToken, getEncryptionKey());
  if (
    !token ||
    (String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
      isMockBotToken(token))
  ) {
    return 0;
  }
  const [customers, sourceProducts, shop] = await Promise.all([
    prisma.customer.findMany({
      where: { shopId },
      select: { telegramChatId: true, preferredLanguage: true },
    }),
    prisma.sourceProduct.findMany({
      where: { shopId },
      select: { id: true, iconCustomEmojiId: true },
    }),
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { botConfig: { select: { customizationJson: true } } },
    }),
  ]);
  const productById = new Map(sourceProducts.map((p) => [p.id, p]));
  const rawCust = shop?.botConfig?.customizationJson;
  const custJson =
    rawCust && typeof rawCust === "object" && !Array.isArray(rawCust)
      ? (rawCust as Record<string, any>)
      : {};
  const custEmojis =
    custJson.buttonEmojis && typeof custJson.buttonEmojis === "object"
      ? (custJson.buttonEmojis as Record<string, string>)
      : {};
  const custLabels =
    custJson.buttonLabels && typeof custJson.buttonLabels === "object"
      ? (custJson.buttonLabels as Record<string, Record<string, string>>)
      : {};
  const custEmojiIds =
    custJson.buttonEmojiIds && typeof custJson.buttonEmojiIds === "object"
      ? (custJson.buttonEmojiIds as Record<string, string>)
      : {};
  const buildBtn = (
    key: string,
    fallbackEmoji: string,
    fallbackTextVi: string,
    fallbackTextEn: string,
    fallbackTextTh: string,
    cbData: string,
    lang: string,
  ) => {
    const custLabel = custLabels[key]?.[lang];
    const custEmoji = custEmojis[key];
    const custEmojiId = custEmojiIds[key];
    const fallbackText =
      lang === "en"
        ? fallbackTextEn
        : lang === "th"
          ? fallbackTextTh
          : fallbackTextVi;
    const text = custLabel
      ? (custEmoji ? `${custEmoji} ` : "") + custLabel
      : `${custEmoji ?? fallbackEmoji} ${fallbackText}`;
    const btn: Record<string, any> = { text, callback_data: cbData };
    if (custEmojiId) btn.icon_custom_emoji_id = custEmojiId;
    return btn;
  };
  // De-dup: claim each (product, available) restock once per window (SAME Redis key + TTL as the
  // API, via @reseller/shared) so the worker's periodic re-sync — or any other path — doesn't
  // re-broadcast a restock that was already sent. This is the real fix for the "nhập kho" spam:
  // the per-sync delta check re-fired whenever `available` looked like it rose from 0 again.
  const redis = redisClient || _globalRedis;
  const freshNotifications: StockNotificationItem[] = [];
  for (const item of notifications) {
    let claimed = true;
    try {
      if (redis) {
        const res = await redis.set(
          restockNotiDedupKey(shopId, item.sourceProductId, item.available),
          "1",
          "PX",
          RESTOCK_NOTI_DEDUP_TTL_MS,
          "NX",
        );
        claimed = res === "OK";
      }
    } catch {
      claimed = true; // fail-open: notify rather than silently drop
    }
    if (claimed) freshNotifications.push(item);
  }
  if (freshNotifications.length === 0) {
    return 0;
  }
  // Restock body from the admin-configurable template (shop override > admin template > default).
  const restockTemplate = resolveRestockTemplate(
    custJson,
    await getAdminTemplateCustomizationCached(),
  );
  let sentCount = 0;
  for (const customer of customers) {
    const lang =
      customer.preferredLanguage === "en"
        ? "en"
        : customer.preferredLanguage === "th"
          ? "th"
          : "vi";
    for (const item of freshNotifications) {
      const product = productById.get(item.sourceProductId);
      if (!product) continue;
      const cbData = `buy:${item.sourceProductId}`;
      const rendered = renderRestockHtml(restockTemplate, {
        productName: item.displayName || "",
        addedQuantity: item.addedQuantity,
        available: item.available,
        price: item.price ?? null,
        productIconCustomEmojiId: product.iconCustomEmojiId ?? null,
        language: lang,
      });
      await telegramSendMessage(
        token,
        customer.telegramChatId,
        rendered.text,
        {
          parse_mode: rendered.hasHtml ? "HTML" : undefined,
          reply_markup: {
            inline_keyboard: [
              [
                buildBtn(
                  "buyNow",
                  "🛒",
                  "Mua ngay",
                  "Buy now",
                  "ซื้อเลย",
                  cbData,
                  lang,
                ),
              ],
            ],
          },
        },
      ).catch(() => undefined);
      sentCount += 1;
    }
  }
  return sentCount;
}

export async function syncCatalogForShop(
  shopId: string,
  options?: { queue?: Queue | null; redis?: IORedis | null },
): Promise<number | { synced: number; notified: number }> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      botConfig: true,
      providerConfig: true,
      seller: true,
    },
  });
  if (!shop?.providerConfig) {
    throw new Error("Shop provider config not found.");
  }
  let products: any[] | null;
  if (shop.providerConfig.providerKind === "INTERNAL") {
    const connectionId = shop.providerConfig.internalSourceConnectionId;
    if (!connectionId)
      throw new Error("INTERNAL shop missing internalSourceConnectionId.");
    const connection = await prisma.downstreamSourceConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection || connection.status !== "ACTIVE")
      throw new Error("Internal source connection is not active.");
    const upstreamProducts = await prisma.sourceProduct.findMany({
      where: {
        shopId: connection.upstreamShopId,
        internalSourceEnabled: true,
      },
      include: {
        overrides: {
          where: { sellerId: connection.upstreamSellerId },
          select: { salePrice: true },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    });
    products = upstreamProducts.map((p) => {
      const fallbackSalePrice = p.overrides?.[0]?.salePrice
        ? Number(p.overrides[0].salePrice)
        : 0;
      const wholesalePrice =
        p.internalSourcePrice != null
          ? Number(p.internalSourcePrice)
          : fallbackSalePrice;
      const upstreamMetadata =
        p.metadataJson &&
        typeof p.metadataJson === "object" &&
        !Array.isArray(p.metadataJson)
          ? p.metadataJson
          : {};
      const requiresCustomerEmail =
        (upstreamMetadata as any).requiresCustomerEmail === true ||
        (upstreamMetadata as any).requires_customer_email === true;
      return {
        externalId: p.id,
        sourceName: p.sourceName,
        sourceRawName: p.sourceRawName || p.sourceName,
        description: p.sourceDescription,
        rawDescription: p.sourceDescription,
        price: wholesalePrice,
        available: p.available,
        hidden: false,
        isSlotProduct: false,
        requiresCustomerEmail,
        requiresSlotMonths: false,
        slotDurations: [],
        quantityFixed: 1,
        walletCurrency: "VND",
        metadata: {
          productFamily: p.productFamily ?? null,
          productFamilyOther: p.productFamilyOther ?? null,
          accountType: p.accountType ?? null,
          accountTypeOther: p.accountTypeOther ?? null,
          durationType: p.durationType ?? null,
          durationTypeOther: p.durationTypeOther ?? null,
          sourceDeliveryMode: p.sourceDeliveryMode ?? null,
          deliveryMode: p.sourceDeliveryMode ?? null,
          warrantyPolicy: p.warrantyPolicy ?? null,
          internalSourceEnabled: p.internalSourceEnabled,
          internalSourcePrice:
            p.internalSourcePrice != null
              ? Number(p.internalSourcePrice)
              : null,
          requiresCustomerEmail,
        },
      };
    });
    await prisma.downstreamSourceConnection
      .update({
        where: { id: connection.id },
        data: { lastCatalogSyncAt: new Date() },
      })
      .catch(() => undefined);
  } else {
    const buyerKey = decryptSecret(
      shop.providerConfig.buyerKeyEncrypted,
      getEncryptionKey(),
    );
    if (!buyerKey) throw new Error("Provider buyer key is missing.");
    // Roboticvn: enforce longer sync interval to stay within 120 req/min rate limit.
    if (
      isRoboticvnProvider({
        baseUrl: shop.providerConfig.baseUrl,
        buyerKey,
      })
    ) {
      const lastSync = shop.lastCatalogSyncAt
        ? shop.lastCatalogSyncAt.getTime()
        : 0;
      if (Date.now() - lastSync < ROBOTICVN_CATALOG_SYNC_INTERVAL_MS) {
        return { synced: 0, notified: 0 };
      }
    }
    products =
      String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true" &&
      isMockBuyerKey(buyerKey)
        ? (getMockProviderProducts() as any[])
        : await fetchProviderProducts({
            baseUrl: shop.providerConfig.baseUrl,
            buyerKey,
          }).catch((err: any) => {
            console.error(
              `[worker] fetchProviderProducts failed for shop ${shopId}:`,
              err?.response?.status || err?.message,
            );
            return null;
          });
  }
  if (!products) {
    return { synced: 0, notified: 0 };
  }
  const connectionId = shop.providerConfig.internalSourceConnectionId;
  const sourceScope =
    shop.providerConfig.providerKind === "INTERNAL" && connectionId
      ? `internal:${connectionId}`
      : "legacy";
  const existingProducts = await prisma.sourceProduct.findMany({
    where: { shopId: shop.id, sourceScope },
    select: {
      id: true,
      externalProductId: true,
      providerName: true,
      available: true,
      sourcePrice: true,
      sourceDescriptionLocked: true,
      metadataJson: true,
      overrides: {
        where: { sellerId: shop.sellerId },
        select: {
          salePrice: true,
          displayNameLocked: true,
          salePriceLocked: true,
        },
        take: 1,
      },
    },
  });
  const existingByExternalId = new Map(
    existingProducts.map((item) => [item.externalProductId, item]),
  );
  const stockNotifications: StockNotificationItem[] = [];
  const syncedAt = new Date();
  for (const product of products) {
    const previous = existingByExternalId.get(product.externalId);
    const businessFields =
      shop.providerConfig.providerKind === "INTERNAL"
        ? extractInternalBusinessFields(product.metadata)
        : {};
    const sourceProduct = await prisma.sourceProduct.upsert({
      where: {
        shopId_sourceScope_externalProductId: {
          shopId: shop.id,
          sourceScope,
          externalProductId: product.externalId,
        },
      },
      update: {
        sourceScope,
        sourceName: product.sourceName,
        sourceRawName: product.sourceRawName,
        ...(previous?.sourceDescriptionLocked
          ? {}
          : {
              sourceDescription:
                product.description || product.rawDescription,
            }),
        sourcePrice: toDecimal(product.price),
        available: product.hidden ? 0 : product.available,
        ...businessFields,
        syncedAt,
        metadataJson: {
          ...(product.metadata &&
          typeof product.metadata === "object" &&
          !Array.isArray(product.metadata)
            ? product.metadata
            : {}),
          requiresCustomerEmail: product.requiresCustomerEmail,
          ...(previous?.metadataJson &&
          typeof previous.metadataJson === "object" &&
          !Array.isArray(previous.metadataJson)
            ? {
                usageInstructions:
                  (previous.metadataJson as any).usageInstructions ?? null,
              }
            : {}),
        },
      },
      create: {
        shopId: shop.id,
        sourceScope,
        externalProductId: product.externalId,
        providerName: shop.providerConfig.providerName,
        sourceName: product.sourceName,
        sourceRawName: product.sourceRawName,
        sourceDescription: product.description || product.rawDescription,
        sourcePrice: toDecimal(product.price),
        available: product.hidden ? 0 : product.available,
        totalCount: product.available || 0,
        internalSourceEnabled: shop.seller?.tier === "ULTRA",
        ...businessFields,
        metadataJson: {
          ...(product.metadata &&
          typeof product.metadata === "object" &&
          !Array.isArray(product.metadata)
            ? product.metadata
            : {}),
          requiresCustomerEmail: product.requiresCustomerEmail,
        },
        syncedAt,
      },
    });
    const markupPercent =
      shop.providerConfig.priceMarkupPercent != null
        ? Number(shop.providerConfig.priceMarkupPercent)
        : null;
    const oldSourcePrice =
      previous?.sourcePrice != null ? Number(previous.sourcePrice) : null;
    const existingSalePrice =
      previous?.overrides?.[0]?.salePrice != null
        ? Number(previous.overrides[0].salePrice)
        : null;
    const salePriceLocked = previous?.overrides?.[0]?.salePriceLocked ?? false;
    let updatedSalePrice: any;
    if (!salePriceLocked && markupPercent !== null && markupPercent > 0) {
      updatedSalePrice = toDecimal(product.price * (1 + markupPercent / 100));
    } else if (oldSourcePrice !== null && existingSalePrice !== null) {
      const delta = product.price - oldSourcePrice;
      updatedSalePrice = toDecimal(
        salePriceLocked
          ? Math.max(product.price, existingSalePrice + delta)
          : Math.max(product.price + 10000, existingSalePrice + delta),
      );
    } else if (!salePriceLocked) {
      updatedSalePrice = toDecimal(
        product.price +
          (shop.providerConfig.providerKind === "INTERNAL" ? 30000 : 10000),
      );
    }
    await prisma.sellerProductOverride.upsert({
      where: {
        sellerId_sourceProductId: {
          sellerId: shop.sellerId,
          sourceProductId: sourceProduct.id,
        },
      },
      update: {
        ...(previous?.overrides?.[0]?.displayNameLocked
          ? {}
          : {
              displayName: product.sourceRawName || product.sourceName,
            }),
        ...(updatedSalePrice ? { salePrice: updatedSalePrice } : {}),
      },
      create: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        sourceProductId: sourceProduct.id,
        displayName: product.sourceRawName || product.sourceName,
        salePrice: toDecimal(
          markupPercent != null && markupPercent > 0
            ? product.price * (1 + markupPercent / 100)
            : product.price +
                (shop.providerConfig.providerKind === "INTERNAL"
                  ? 30000
                  : 10000),
        ),
        enabled: true,
        hidden: false,
      },
    });
    // Use the SAME hidden-adjusted value we persist below as the restock baseline.
    const nextAvailable = product.hidden ? 0 : product.available;
    const previousAvailable = previous?.available;
    let addedQuantity = 0;
    if (
      previous &&
      Number.isFinite(previousAvailable) &&
      Number.isFinite(nextAvailable)
    ) {
      addedQuantity = Math.max(
        0,
        Number(nextAvailable) - Number(previousAvailable),
      );
    }
    if (addedQuantity > 0 && Number(nextAvailable) > 0) {
      const priceForNoti =
        updatedSalePrice != null
          ? Number(updatedSalePrice)
          : (existingSalePrice ?? null);
      stockNotifications.push({
        sourceProductId: sourceProduct.id,
        displayName: product.sourceRawName || product.sourceName,
        addedQuantity,
        available: Number(nextAvailable),
        price:
          priceForNoti != null &&
          Number.isFinite(priceForNoti) &&
          priceForNoti > 0
            ? priceForNoti
            : null,
      });
    }
  }
  // Mark products that disappeared from upstream as out-of-stock
  if (products.length > 0) {
    const currentProvName = shop.providerConfig.providerName;
    const fetchedIdSet = new Set(products.map((p) => p.externalId));
    const candidates = await prisma.sourceProduct.findMany({
      where: { shopId: shop.id, providerName: currentProvName },
      select: { id: true, externalProductId: true, available: true },
    });
    const staleIds = candidates
      .filter((sp) => !fetchedIdSet.has(sp.externalProductId))
      .filter((sp) => (sp.available ?? 0) > 0)
      .map((sp) => sp.id);
    if (staleIds.length > 0) {
      await prisma.sourceProduct.updateMany({
        where: { id: { in: staleIds } },
        data: { available: 0, syncedAt },
      });
    }
  }
  // Stale = products NOT in the current internal upstream feed. EXCLUDE "manual".
  if (shop.providerConfig.providerKind === "INTERNAL" && products.length > 0) {
    const fetchedIds = new Set(products.map((p) => p.externalId));
    const staleProducts = await prisma.sourceProduct.findMany({
      where: {
        shopId: shop.id,
        providerName: { notIn: ["internal_pro", "manual"] },
      },
      select: { id: true, externalProductId: true },
    });
    const allStaleIds = staleProducts
      .filter((p) => !fetchedIds.has(p.externalProductId))
      .map((p) => p.id);
    if (allStaleIds.length > 0) {
      await prisma.sourceProduct.updateMany({
        where: { id: { in: allStaleIds } },
        data: { available: 0 },
      });
      await prisma.sellerProductOverride.updateMany({
        where: { shopId: shop.id, sourceProductId: { in: allStaleIds } },
        data: { enabled: false, hidden: true },
      });
    }
  }
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      lastCatalogSyncAt: syncedAt,
    },
  });
  if (shop.providerConfig.internalSourceConnectionId) {
    await prisma.downstreamSourceConnection
      .update({
        where: { id: shop.providerConfig.internalSourceConnectionId },
        data: {
          lastCatalogSyncAt: syncedAt,
        },
      })
      .catch(() => undefined);
  }
  if (
    shop.providerConfig.sourceNotificationSyncEnabled &&
    !shop.providerConfig.ownProductsOnly
  ) {
    const redis = options?.redis || _globalRedis;
    await notifyCatalogStockUpdates(
      shop.id,
      shop.botConfig?.telegramBotTokenEncrypted || null,
      stockNotifications,
      redis,
    );
  }
  if (
    shop.providerConfig.providerKind !== "INTERNAL" &&
    shop.seller?.tier === "ULTRA"
  ) {
    const downstreamConnections =
      await prisma.downstreamSourceConnection.findMany({
        where: {
          upstreamShopId: shop.id,
          status: "ACTIVE",
          downstreamShopId: { not: null },
        },
        select: { downstreamShopId: true },
      });
    const queue = options?.queue || _globalSyncQueue;
    const redis = options?.redis || _globalRedis;
    if (queue && redis) {
      for (const conn of downstreamConnections) {
        if (!conn.downstreamShopId) continue;
        await enqueueCatalogSyncJob(
          queue,
          redis,
          conn.downstreamShopId,
        ).catch(() => undefined);
      }
    }
  }
  return products.length;
}

export async function scheduleCatalogSyncJobs(
  queue: Queue,
  redis: IORedis,
): Promise<{ activeShops: number; scheduled: number }> {
  const shops = await refreshActiveCatalogShopIds();
  if (shops.length === 0) {
    return {
      activeShops: 0,
      scheduled: 0,
    };
  }
  const batchSize = Math.min(
    shops.length,
    getCatalogSyncBatchSize(shops.length),
  );
  let scheduled = 0;
  for (let index = 0; index < batchSize; index += 1) {
    const shopId = shops[activeCatalogShopCursor];
    activeCatalogShopCursor = (activeCatalogShopCursor + 1) % shops.length;
    if (!shopId) {
      continue;
    }
    try {
      const enqueued = await enqueueCatalogSyncJob(queue, redis, shopId);
      if (enqueued) {
        scheduled += 1;
      }
    } catch (error) {
      console.error(
        `[worker] Catalog scheduler failed for shop ${shopId}:`,
        formatError(error),
      );
    }
  }
  return {
    activeShops: shops.length,
    scheduled,
  };
}
