// @ts-nocheck
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const axios_1 = __importDefault(require("axios"));
const client_1 = require("@prisma/client");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const server_1 = require("@reseller/shared/server");
const prisma = new client_1.PrismaClient();
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const INFRA_RETRY_MS = Number(process.env.WORKER_INFRA_RETRY_MS || 5000);
const TELEGRAM_POLL_INTERVAL_MS = Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 5000);
const CATALOG_SYNC_INTERVAL_MS = Number(process.env.CATALOG_SYNC_INTERVAL_MS || 60000);
const CATALOG_SCHEDULER_TICK_MS = Number(process.env.CATALOG_SCHEDULER_TICK_MS || 5000);
const CATALOG_SHOPS_REFRESH_MS = Number(process.env.CATALOG_SHOPS_REFRESH_MS || 60000);
const CATALOG_SYNC_CONCURRENCY = Number(process.env.CATALOG_SYNC_CONCURRENCY || 12);
const CATALOG_SYNC_BATCH_SIZE = Number(process.env.CATALOG_SYNC_BATCH_SIZE || 0);
const CATALOG_SYNC_LOCK_TTL_MS = Number(process.env.CATALOG_SYNC_LOCK_TTL_MS ||
    Math.max(CATALOG_SYNC_INTERVAL_MS * 3, 5 * 60 * 1000));
const CUSTOMER_TOPUP_SWEEP_INTERVAL_MS = Number(process.env.CUSTOMER_TOPUP_SWEEP_INTERVAL_MS || 15000);
const DATA_CLEANUP_INTERVAL_MS = Number(process.env.DATA_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000);
let globalSyncQueue = null;
let globalRedis = null;
const PAYOS_ORDER_SWEEP_INTERVAL_MS = Number(process.env.PAYOS_ORDER_SWEEP_INTERVAL_MS || 10000);
const INTERNAL_SOURCE_ORDER_SWEEP_INTERVAL_MS = Number(process.env.INTERNAL_SOURCE_ORDER_SWEEP_INTERVAL_MS || 15000);
function validateProductionConfig() {
    if (process.env.NODE_ENV !== "production") {
        return;
    }
    const errors = [];
    for (const key of ["DATABASE_URL", "REDIS_URL", "APP_ENCRYPTION_KEY", "INTERNAL_API_TOKEN", "APP_PUBLIC_URL"]) {
        if (!String(process.env[key] || "").trim()) {
            errors.push(`${key} is required.`);
        }
    }
    for (const key of ["APP_ENCRYPTION_KEY", "INTERNAL_API_TOKEN"]) {
        const value = String(process.env[key] || "");
        if (value.length < 32 || /change-me|CHANGE_ME|default|secret/i.test(value)) {
            errors.push(`${key} must be a strong random value with at least 32 characters.`);
        }
    }
    if (/localhost|127\.0\.0\.1|example\.com/i.test(String(process.env.APP_PUBLIC_URL || ""))) {
        errors.push("APP_PUBLIC_URL must use the real production API domain.");
    }
    if (String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true") {
        errors.push("MOCK_PROVIDER_ENABLED must be false in production.");
    }
    if (String(process.env.MOCK_TELEGRAM_MODE || "false") === "true") {
        errors.push("MOCK_TELEGRAM_MODE must be false in production.");
    }
    if (errors.length > 0) {
        throw new Error(`Worker production configuration is not safe:\n- ${errors.join("\n- ")}`);
    }
}
validateProductionConfig();
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function formatError(error) {
    if (!error) {
        return "Unknown error";
    }
    if (error instanceof client_1.Prisma.PrismaClientInitializationError) {
        return error.message;
    }
    if (error instanceof AggregateError) {
        return error.errors
            .map((item) => formatError(item))
            .filter(Boolean)
            .join(" | ");
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function normalizeManualDeliveryText(value) {
    const normalized = String(value || "")
        .replace(/\r\n/g, "\n")
        .trim();
    return normalized || null;
}
function parseManualDeliveryEntries(value) {
    const normalized = unwrapManualDeliveryEnvelope(normalizeManualDeliveryText(value));
    if (!normalized) {
        return [];
    }
    const jsonEntries = parseJsonDeliveryEntries(normalized);
    if (jsonEntries.length > 0) {
        return jsonEntries;
    }
    return normalized
        .split("\n")
        .map((entry) => sanitizeDeliveryEntry(entry))
        .filter(Boolean);
}
function readManualDeliveryEntries(metadata) {
    if (Array.isArray(metadata.deliveryEntries)) {
        return metadata.deliveryEntries
            .map((entry) => String(entry || "").trim())
            .filter(Boolean);
    }
    if (typeof metadata.deliveryText === "string") {
        return parseManualDeliveryEntries(metadata.deliveryText);
    }
    return [];
}
function parseJsonDeliveryEntries(normalized) {
    if (!normalized.startsWith("[")) {
        return [];
    }
    try {
        const parsed = JSON.parse(normalized);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map((entry) => normalizeJsonDeliveryEntry(entry))
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
function normalizeJsonDeliveryEntry(entry) {
    if (typeof entry === "string") {
        return entry.trim() || null;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
    }
    const record = entry;
    const account = [record.account, record.email, record.username, record.user, record.login]
        .map((value) => String(value || "").trim())
        .find(Boolean);
    const password = [record.password, record.pass, record.pwd]
        .map((value) => String(value || "").trim())
        .find(Boolean);
    if (account && password) {
        return `${account} | ${password}`;
    }
    return null;
}
function unwrapManualDeliveryEnvelope(value) {
    const normalized = String(value || "").trim();
    if (normalized.startsWith("{") && normalized.endsWith("}")) {
        return normalized.slice(1, -1).trim();
    }
    return normalized;
}
function sanitizeDeliveryEntry(value) {
    return value
        .trim()
        .replace(/^[{[]+/, "")
        .replace(/[}\],;]+$/, "")
        .trim();
}
function escapeTelegramHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
function normalizeLanguage(value) {
    return String(value || "").trim().toLowerCase() === "en" ? "en" : "vi";
}
function formatLocalizedDateTime(value, language = "vi") {
    return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(value);
}
function formatVndMoney(value, language = "vi") {
    return new Intl.NumberFormat(language === "en" ? "en-US" : "vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0,
    }).format(decimalToNumber(value));
}
function extractTextValue(value) {
    const normalized = String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    return normalized || null;
}
function extractMetadataText(metadata, keys) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return null;
    }
    for (const key of keys) {
        const value = metadata[key];
        if (typeof value === "string" || typeof value === "number") {
            const normalized = extractTextValue(value);
            if (normalized) {
                return normalized;
            }
        }
    }
    return null;
}
function normalizeWarrantyPhrase(value) {
    const normalized = extractTextValue(value);
    if (!normalized) {
        return null;
    }
    if (/no\s*warranty|không\s*bảo\s*hành|khong\s*bao\s*hanh/i.test(normalized)) {
        return "__NO_WARRANTY__";
    }
    if (/full\s*warranty|bảo\s*hành\s*(full|đầy\s*đủ)|bao\s*hanh\s*(full|day\s*du)/i.test(normalized)) {
        return "__FULL_WARRANTY__";
    }
    const match = normalized.match(/(?:hỗ\s*trợ\s*)?(?:bảo\s*hành|bao\s*hanh|warranty|bh)\s*[:\-]?\s*([^.!,\n]+)/i);
    if (match?.[1]) {
        return extractTextValue(match[1]);
    }
    if (/(bảo\s*hành|bao\s*hanh|warranty|\bbh\b)/i.test(normalized)) {
        return normalized
            .replace(/(?:hỗ\s*trợ\s*)?(?:bảo\s*hành|bao\s*hanh|warranty|bh)\s*[:\-]?\s*/gi, "")
            .replace(/[.!,;:]+$/g, "")
            .trim() || normalized;
    }
    return null;
}
function translateWarrantyPhrase(value, language = "vi") {
    if (!value) {
        return language === "en" ? "According to product policy" : "Theo chính sách sản phẩm";
    }
    if (value === "__NO_WARRANTY__") {
        return language === "en" ? "No warranty" : "Không bảo hành";
    }
    if (value === "__FULL_WARRANTY__") {
        return language === "en" ? "Full warranty" : "Bảo hành đầy đủ";
    }
    let normalized = String(value);
    if (language === "en") {
        normalized = normalized
            .replace(/\b(\d+)\s*giờ\b/gi, (_match, amount) => `${amount} hours`)
            .replace(/\b(\d+)\s*gio\b/gi, (_match, amount) => `${amount} hours`)
            .replace(/\b(\d+)\s*ngày\b/gi, (_match, amount) => `${amount} days`)
            .replace(/\b(\d+)\s*ngay\b/gi, (_match, amount) => `${amount} days`)
            .replace(/\b(\d+)\s*tháng\b/gi, (_match, amount) => `${amount} months`)
            .replace(/\b(\d+)\s*thang\b/gi, (_match, amount) => `${amount} months`)
            .replace(/\b(\d+)\s*năm\b/gi, (_match, amount) => `${amount} years`)
            .replace(/\b(\d+)\s*nam\b/gi, (_match, amount) => `${amount} years`)
            .replace(/\bbảo\s*hành\b/gi, "warranty")
            .replace(/\bbao\s*hanh\b/gi, "warranty")
            .replace(/\bđầy\s*đủ\b/gi, "full")
            .replace(/\bday\s*du\b/gi, "full")
            .replace(/\bkhông\b/gi, "no")
            .replace(/\bkhong\b/gi, "no")
            .replace(/\blỗi\b/gi, "fault")
            .replace(/\bdoi\s*1\s*doi\s*1\b/gi, "1-to-1 replacement")
            .replace(/\bđổi\s*1\s*đổi\s*1\b/gi, "1-to-1 replacement");
    }
    else {
        normalized = normalized
            .replace(/\b(\d+)\s*hours?\b/gi, (_match, amount) => `${amount} giờ`)
            .replace(/\b(\d+)\s*days?\b/gi, (_match, amount) => `${amount} ngày`)
            .replace(/\b(\d+)\s*months?\b/gi, (_match, amount) => `${amount} tháng`)
            .replace(/\b(\d+)\s*years?\b/gi, (_match, amount) => `${amount} năm`)
            .replace(/\bno\s*warranty\b/gi, "không bảo hành")
            .replace(/\bfull\s*warranty\b/gi, "bảo hành đầy đủ")
            .replace(/\bwarranty\b/gi, "bảo hành");
    }
    return extractTextValue(normalized) || (language === "en" ? "According to product policy" : "Theo chính sách sản phẩm");
}
function resolveWarrantyText(input) {
    const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? input.metadata
        : {};
    const candidates = [
        extractMetadataText(metadata, [
            "warranty",
            "warrantyTime",
            "warrantyPeriod",
            "warranty_period",
            "warranty_time",
            "baoHanh",
            "bao_hanh",
            "baoHanhText",
            "bao_hanh_text",
            "guarantee",
            "guaranteeText",
            "guarantee_text",
            "bh",
        ]),
        input.sourceDescription,
        input.productName,
    ];
    for (const candidate of candidates) {
        const warrantyPhrase = normalizeWarrantyPhrase(candidate);
        if (warrantyPhrase) {
            return translateWarrantyPhrase(warrantyPhrase, input.language);
        }
    }
    return input.language === "en" ? "According to product policy" : "Theo chính sách sản phẩm";
}
function normalizeSupportTelegram(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return null;
    }
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
        return normalized;
    }
    if (normalized.startsWith("@")) {
        return normalized;
    }
    return `@${normalized}`;
}
function normalizeSupportZalo(value) {
    const normalized = String(value || "").trim();
    return normalized || null;
}
function buildSupportContactLines(shop, language = "vi") {
    const supportTelegram = normalizeSupportTelegram(shop.supportTelegram);
    const supportZalo = normalizeSupportZalo(shop.supportZalo);
    if (!supportTelegram && !supportZalo) {
        return [
            language === "en"
                ? "Support: reply in this chat if you need help."
                : "Hỗ trợ: hãy phản hồi trong chat này nếu bạn cần trợ giúp.",
        ];
    }
    const lines = [language === "en" ? "Support contact:" : "Liên hệ hỗ trợ:"];
    if (supportTelegram) {
        lines.push(`${language === "en" ? "Telegram" : "Telegram"}: ${supportTelegram}`);
    }
    if (supportZalo) {
        lines.push(`${language === "en" ? "Zalo" : "Zalo"}: ${supportZalo}`);
    }
    return lines;
}
function buildDeliveredAccountMessage(input) {
    const lines = input.language === "en"
        ? [
            "✅ Payment confirmed",
            `Order code: ${input.orderCode}`,
            `Product: ${input.productName}`,
            `Quantity: ${input.quantity}`,
            "",
            "🔐 Account information:",
            `<pre>${escapeTelegramHtml(input.deliveredText)}</pre>`,
            "",
            "Please change the password right after logging in for safety.",
            "A detailed bill will be sent in the next message.",
        ]
        : [
            "✅ Thanh toán đã được xác nhận",
            `Mã đơn: ${input.orderCode}`,
            `Sản phẩm: ${input.productName}`,
            `Số lượng: ${input.quantity}`,
            "",
            "🔐 Thông tin tài khoản:",
            `<pre>${escapeTelegramHtml(input.deliveredText)}</pre>`,
            "",
            "Vui lòng đổi mật khẩu ngay sau khi đăng nhập để bảo đảm an toàn.",
            "Hóa đơn chi tiết sẽ được gửi ở tin nhắn tiếp theo.",
        ];
    return lines.join("\n");
}
function buildDeliveredBillMessage(input) {
    const supportLines = buildSupportContactLines(input.shop, input.language);
    const warrantyText = resolveWarrantyText({
        productName: input.productName,
        sourceDescription: input.sourceDescription,
        metadata: input.metadata,
        language: input.language,
    });
    const lines = input.language === "en"
        ? [
            "🧾 Order bill",
            `Order code: ${input.orderCode}`,
            `Product: ${input.productName}`,
            `Quantity: ${input.quantity}`,
            `Paid amount: ${formatVndMoney(input.amount, input.language)}`,
            `Delivered at: ${formatLocalizedDateTime(input.deliveredAt, input.language)} (GMT+7)`,
            `Warranty: ${warrantyText}`,
            "",
            ...supportLines,
        ]
        : [
            "🧾 Hóa đơn đơn hàng",
            `Mã đơn: ${input.orderCode}`,
            `Sản phẩm: ${input.productName}`,
            `Số lượng: ${input.quantity}`,
            `Thanh toán: ${formatVndMoney(input.amount, input.language)}`,
            `Thời gian giao: ${formatLocalizedDateTime(input.deliveredAt, input.language)} (GMT+7)`,
            `Thời gian bảo hành: ${warrantyText}`,
            "",
            ...supportLines,
        ];
    return lines.join("\n");
}
function buildManualPendingMessage(input) {
    const supportLines = buildSupportContactLines(input.shop, input.language);
    const bodyLines = input.shortage
        ? (input.language === "en"
            ? [
                "The payment has been recorded successfully.",
                "The auto stock is temporarily lower than your requested quantity.",
                "The seller will check and deliver the remaining account(s) manually within a few minutes.",
            ]
            : [
                "Thanh toán đã được ghi nhận thành công.",
                "Kho giao tự động hiện tạm thời chưa đủ đúng số lượng bạn đặt.",
                "Seller sẽ kiểm tra và giao bù thủ công trong ít phút tới.",
            ])
        : (input.language === "en"
            ? [
                "The payment has been recorded successfully.",
                "Your order is waiting for manual handling from the seller.",
                "The seller will process and deliver the account within a few minutes.",
            ]
            : [
                "Thanh toán đã được ghi nhận thành công.",
                "Đơn hàng đang chờ seller xử lý thủ công.",
                "Seller sẽ xử lý và giao tài khoản trong ít phút tới.",
            ]);
    return [
        input.language === "en" ? "✅ Payment confirmed" : "✅ Thanh toán thành công",
        input.language === "en" ? `Order code: ${input.orderCode}` : `Mã đơn: ${input.orderCode}`,
        input.language === "en" ? `Product: ${input.productName}` : `Sản phẩm: ${input.productName}`,
        input.language === "en" ? `Quantity: ${input.quantity}` : `Số lượng: ${input.quantity}`,
        "",
        ...bodyLines,
        "",
        ...supportLines,
    ].join("\n");
}
function safeDecryptSecret(payload) {
    try {
        return (0, server_1.decryptSecret)(payload, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
    }
    catch {
        return "";
    }
}
function resolvePayOSCredentials(paymentConfig) {
    const clientId = safeDecryptSecret(paymentConfig?.payosClientIdEncrypted) || process.env.PAYOS_CLIENT_ID || "";
    const apiKey = safeDecryptSecret(paymentConfig?.payosApiKeyEncrypted) || process.env.PAYOS_API_KEY || "";
    const checksumKey = safeDecryptSecret(paymentConfig?.payosChecksumKeyEncrypted) || process.env.PAYOS_CHECKSUM_KEY || "";
    if (!clientId || !apiKey || !checksumKey) {
        return null;
    }
    return {
        clientId,
        apiKey,
        checksumKey,
    };
}
async function enqueuePaidOrder(queue, orderId, totalSourceAmount) {
    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: "PROCESSING_PURCHASE",
                },
            });
            await tx.orderEvent.create({
                data: {
                    orderId,
                    eventType: "purchase_enqueued",
                    payloadJson: {
                        amount: totalSourceAmount,
                        note: "Queued for upstream purchase using source wallet balance.",
                    },
                },
            });
        });
        await queue.add(server_1.JOBS.purchaseUpstream, { orderId }, {
            jobId: `purchase-${orderId}`,
            removeOnComplete: 100,
            removeOnFail: 100,
        });
    }
    catch (error) {
        await prisma.order.update({
            where: { id: orderId },
            data: {
                status: "FAILED",
                failureReason: error instanceof Error ? error.message : "Processing failed.",
            },
        }).catch(() => undefined);
        throw error;
    }
}
async function sendDeliveredOrderMessages(input) {
    await (0, server_1.telegramSendMessage)(input.botToken, input.chatId, buildDeliveredAccountMessage(input), {
        parse_mode: "HTML",
    }).catch(() => undefined);
    await (0, server_1.telegramSendMessage)(input.botToken, input.chatId, buildDeliveredBillMessage(input), {
        reply_markup: {
            inline_keyboard: [
                [{
                        text: input.language === "en" ? "🛡️ Warranty" : "🛡️ Bảo hành",
                        callback_data: "warranty:start",
                    }],
            ],
        },
    }).catch(() => undefined);
}
function createRedisConnection() {
    const connection = new ioredis_1.default(REDIS_URL, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
    });
    // Avoid noisy default stack traces while the worker is waiting for local infra.
    connection.on("error", () => undefined);
    return connection;
}
let activeCatalogShopIds = [];
let activeCatalogShopCursor = 0;
let lastCatalogShopRefreshAt = 0;
function getCatalogSyncLockKey(shopId) {
    return `worker:catalog-sync:scheduled:${shopId}`;
}
function getCatalogSyncBatchSize(shopCount) {
    if (!Number.isFinite(shopCount) || shopCount <= 0) {
        return 0;
    }
    if (Number.isFinite(CATALOG_SYNC_BATCH_SIZE) && CATALOG_SYNC_BATCH_SIZE > 0) {
        return Math.max(1, Math.floor(CATALOG_SYNC_BATCH_SIZE));
    }
    if (CATALOG_SYNC_INTERVAL_MS <= 0 || CATALOG_SCHEDULER_TICK_MS <= 0) {
        return shopCount;
    }
    return Math.max(1, Math.ceil((shopCount * CATALOG_SCHEDULER_TICK_MS) / CATALOG_SYNC_INTERVAL_MS));
}
async function refreshActiveCatalogShopIds(force = false) {
    const now = Date.now();
    if (!force &&
        activeCatalogShopIds.length > 0 &&
        now - lastCatalogShopRefreshAt < CATALOG_SHOPS_REFRESH_MS) {
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
async function releaseCatalogSyncLock(redis, shopId, expectedToken) {
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
async function enqueueCatalogSyncJob(queue, redis, shopId) {
    const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const acquired = await redis.set(getCatalogSyncLockKey(shopId), lockToken, "PX", CATALOG_SYNC_LOCK_TTL_MS, "NX");
    if (acquired !== "OK") {
        return false;
    }
    try {
        await queue.add(server_1.JOBS.syncCatalog, {
            shopId,
            lockToken,
        }, {
            jobId: `sync-${shopId}-${Date.now()}`,
            removeOnComplete: 100,
            removeOnFail: 100,
        });
        return true;
    }
    catch (error) {
        await releaseCatalogSyncLock(redis, shopId, lockToken).catch(() => undefined);
        throw error;
    }
}
async function waitForInfrastructure() {
    while (true) {
        const redis = createRedisConnection();
        try {
            await redis.connect();
            await redis.ping();
            await prisma.$connect();
            await prisma.$queryRaw(client_1.Prisma.sql `SELECT 1`);
            console.log("[worker] Connected to Redis and PostgreSQL.");
            return redis;
        }
        catch (error) {
            console.error(`[worker] Waiting for infrastructure. ${formatError(error)}. Retrying in ${Math.round(INFRA_RETRY_MS / 1000)}s...`);
            await prisma.$disconnect().catch(() => undefined);
            try {
                await redis.quit();
            }
            catch {
                redis.disconnect();
            }
            await sleep(INFRA_RETRY_MS);
        }
    }
}
function decimalToNumber(value) {
    if (value === null || value === undefined) {
        return 0;
    }
    return Number(value);
}
function toDecimal(value) {
    return new client_1.Prisma.Decimal(value.toFixed(2));
}
function normalizeSourceEnum(value, allowedValues) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized || !allowedValues.includes(normalized)) {
        return undefined;
    }
    return normalized;
}
function extractInternalBusinessFields(metadata) {
    return {
        productFamily: normalizeSourceEnum(metadata?.productFamily, ["CHATGPT", "VEO3", "CLAUDE", "GEMINI", "CANVA", "CAPCUT", "OTHER"]),
        productFamilyOther: String(metadata?.productFamily || "").trim().toUpperCase() === "OTHER"
            ? String(metadata?.productFamilyOther || "").trim() || null
            : null,
        accountType: normalizeSourceEnum(metadata?.accountType, ["PERSONAL", "SHARED", "ADD_FAMILY", "CREDIT_API", "OTHER"]),
        accountTypeOther: String(metadata?.accountType || "").trim().toUpperCase() === "OTHER"
            ? String(metadata?.accountTypeOther || "").trim() || null
            : null,
        durationType: normalizeSourceEnum(metadata?.durationType, ["DAY_1", "DAY_7", "MONTH_1", "MONTH_3", "MONTH_6", "MONTH_12", "LIFETIME", "OTHER"]),
        durationTypeOther: String(metadata?.durationType || "").trim().toUpperCase() === "OTHER"
            ? String(metadata?.durationTypeOther || "").trim() || null
            : null,
        sourceDeliveryMode: normalizeSourceEnum(metadata?.sourceDeliveryMode || metadata?.deliveryMode, ["AUTO_API", "AUTO_STOCK", "MANUAL"]),
        warrantyPolicy: normalizeSourceEnum(metadata?.warrantyPolicy, ["KBH", "BH24H", "BH1M", "BH6M", "BH12M"]),
    };
}
async function snapshotWarrantyForDeliveredOrder(orderId, tx = prisma) {
    const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
            sourceProduct: true,
        },
    });
    if (!order?.deliveredAt || order.status !== "DELIVERED") {
        return null;
    }
    if (order.warrantyStartedAt && order.warrantyDeliveryModeSnapshot) {
        return {
            warrantyPolicySnapshot: order.warrantyPolicySnapshot,
            warrantyDeliveryModeSnapshot: order.warrantyDeliveryModeSnapshot,
            warrantyStartedAt: order.warrantyStartedAt,
            warrantyExpiresAt: order.warrantyExpiresAt,
        };
    }
    const sourceMetadata = order.sourceProduct?.metadataJson &&
        typeof order.sourceProduct.metadataJson === "object" &&
        !Array.isArray(order.sourceProduct.metadataJson)
        ? order.sourceProduct.metadataJson
        : {};
    const warrantyPolicySnapshot = (0, server_1.inferWarrantyPolicy)({
        productName: order.productNameSnapshot,
        sourceDescription: order.sourceProduct?.sourceDescription,
        warrantyPolicy: order.sourceProduct?.warrantyPolicy,
        sourceDeliveryMode: order.sourceProduct?.sourceDeliveryMode,
        providerName: order.sourceProduct?.providerName,
        metadata: sourceMetadata,
    });
    const warrantyDeliveryModeSnapshot = (0, server_1.inferDeliveryMode)({
        productName: order.productNameSnapshot,
        sourceDescription: order.sourceProduct?.sourceDescription,
        warrantyPolicy: order.sourceProduct?.warrantyPolicy,
        sourceDeliveryMode: order.sourceProduct?.sourceDeliveryMode,
        providerName: order.sourceProduct?.providerName,
        metadata: sourceMetadata,
    });
    const warrantyExpiresAt = (0, server_1.calculateWarrantyExpiry)(warrantyPolicySnapshot, order.deliveredAt);
    await tx.order.update({
        where: { id: order.id },
        data: {
            warrantyPolicySnapshot: warrantyPolicySnapshot || null,
            warrantyDeliveryModeSnapshot: warrantyDeliveryModeSnapshot || null,
            warrantyStartedAt: order.deliveredAt,
            warrantyExpiresAt,
        },
    });
    return {
        warrantyPolicySnapshot,
        warrantyDeliveryModeSnapshot,
        warrantyStartedAt: order.deliveredAt,
        warrantyExpiresAt,
    };
}
async function syncCatalogForShop(shopId) {
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
    let products;
    if (shop.providerConfig.providerKind === "INTERNAL") {
        const connectionId = shop.providerConfig.internalSourceConnectionId;
        if (!connectionId) throw new Error("INTERNAL shop missing internalSourceConnectionId.");
        const connection = await prisma.downstreamSourceConnection.findUnique({ where: { id: connectionId } });
        if (!connection || connection.status !== "ACTIVE") throw new Error("Internal source connection is not active.");
        const upstreamProducts = await prisma.sourceProduct.findMany({
            where: { shopId: connection.upstreamShopId, internalSourceEnabled: true },
            orderBy: { createdAt: "asc" },
        });
        products = upstreamProducts.map((p) => ({
            externalId: p.id,
            sourceName: p.sourceName,
            sourceRawName: p.sourceRawName || p.sourceName,
            description: p.sourceDescription,
            rawDescription: p.sourceDescription,
            price: p.internalSourcePrice != null ? Number(p.internalSourcePrice) : Number(p.sourcePrice),
            available: p.available,
            hidden: false,
            isSlotProduct: false,
            requiresCustomerEmail: false,
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
                internalSourcePrice: p.internalSourcePrice != null ? Number(p.internalSourcePrice) : null,
            },
        }));
        await prisma.downstreamSourceConnection.update({
            where: { id: connection.id },
            data: { lastCatalogSyncAt: new Date() },
        }).catch(() => undefined);
    } else {
        const buyerKey = (0, server_1.decryptSecret)(shop.providerConfig.buyerKeyEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
        if (!buyerKey) throw new Error("Provider buyer key is missing.");
        products = String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true" && (0, server_1.isMockBuyerKey)(buyerKey)
            ? (0, server_1.getMockProviderProducts)()
            : await (0, server_1.fetchProviderProducts)({ baseUrl: shop.providerConfig.baseUrl, buyerKey }).catch((err) => {
                console.error(`[worker] fetchProviderProducts failed for shop ${shopId}:`, err?.response?.status || err?.message);
                return null;
            });
    }
    if (!products) {
        return { synced: 0, notified: 0 };
    }
    const existingProducts = await prisma.sourceProduct.findMany({
        where: { shopId: shop.id },
        select: {
            id: true,
            externalProductId: true,
            available: true,
        },
    });
    const existingByExternalId = new Map(existingProducts.map((item) => [item.externalProductId, item]));
    const stockNotifications = [];
    const syncedAt = new Date();
    for (const product of products) {
        const previous = existingByExternalId.get(product.externalId);
        const businessFields = shop.providerConfig.providerKind === "INTERNAL"
            ? extractInternalBusinessFields(product.metadata)
            : {};
        const sourceProduct = await prisma.sourceProduct.upsert({
            where: {
                shopId_externalProductId: {
                    shopId: shop.id,
                    externalProductId: product.externalId,
                },
            },
            update: {
                sourceName: product.sourceName,
                sourceRawName: product.sourceRawName,
                sourceDescription: product.description || product.rawDescription,
                sourcePrice: toDecimal(product.price),
                available: product.available,
                ...businessFields,
                syncedAt,
                metadataJson: product.metadata,
            },
            create: {
                shopId: shop.id,
                externalProductId: product.externalId,
                providerName: shop.providerConfig.providerName,
                sourceName: product.sourceName,
                sourceRawName: product.sourceRawName,
                sourceDescription: product.description || product.rawDescription,
                sourcePrice: toDecimal(product.price),
                available: product.available,
                totalCount: product.available || 0,
                internalSourceEnabled: shop.seller?.tier === "ULTRA",
                ...businessFields,
                metadataJson: product.metadata,
                syncedAt,
            },
        });
        await prisma.sellerProductOverride.upsert({
            where: {
                sellerId_sourceProductId: {
                    sellerId: shop.sellerId,
                    sourceProductId: sourceProduct.id,
                },
            },
            update: shop.providerConfig.providerKind === "INTERNAL"
                ? { salePrice: toDecimal(product.price + 30000) }
                : {},
            create: {
                sellerId: shop.sellerId,
                shopId: shop.id,
                sourceProductId: sourceProduct.id,
                displayName: product.sourceName,
                salePrice: toDecimal(product.price + (shop.providerConfig.providerKind === "INTERNAL" ? 30000 : 25000)),
                enabled: true,
                hidden: false,
            },
        });
        const nextAvailable = product.available;
        const previousAvailable = previous?.available;
        let addedQuantity = 0;
        if (previous &&
            Number.isFinite(previousAvailable) &&
            Number.isFinite(nextAvailable)) {
            addedQuantity = Math.max(0, Number(nextAvailable) - Number(previousAvailable));
        }
        if (addedQuantity > 0 && Number(nextAvailable) > 0) {
            stockNotifications.push({
                sourceProductId: sourceProduct.id,
                displayName: product.sourceName,
                addedQuantity,
                available: Number(nextAvailable),
            });
        }
    }
    if (shop.providerConfig.providerKind === "INTERNAL") {
        const staleProducts = await prisma.sourceProduct.findMany({
            where: { shopId: shop.id, providerName: { not: "internal_pro" } },
            select: { id: true, soldCount: true },
        });
        if (staleProducts.length > 0) {
            const deletableIds = staleProducts.filter((p) => !p.soldCount || p.soldCount === 0).map((p) => p.id);
            const disableIds = staleProducts.filter((p) => p.soldCount && p.soldCount > 0).map((p) => p.id);
            if (deletableIds.length > 0) {
                await prisma.sellerProductOverride.deleteMany({ where: { sourceProductId: { in: deletableIds } } });
                await prisma.sourceProduct.deleteMany({ where: { id: { in: deletableIds } } });
            }
            if (disableIds.length > 0) {
                await prisma.sourceProduct.updateMany({ where: { id: { in: disableIds } }, data: { available: 0 } });
                await prisma.sellerProductOverride.updateMany({ where: { shopId: shop.id, sourceProductId: { in: disableIds } }, data: { enabled: false } });
            }
        }
    }
    await prisma.shop.update({
        where: { id: shop.id },
        data: {
            lastCatalogSyncAt: syncedAt,
        },
    });
    if (shop.providerConfig.internalSourceConnectionId) {
        await prisma.downstreamSourceConnection.update({
            where: { id: shop.providerConfig.internalSourceConnectionId },
            data: {
                lastCatalogSyncAt: syncedAt,
            },
        }).catch(() => undefined);
    }
    if (shop.providerConfig.sourceNotificationSyncEnabled) {
        await notifyCatalogStockUpdates(shop.id, shop.botConfig?.telegramBotTokenEncrypted || null, stockNotifications);
    }
    if (shop.providerConfig.providerKind !== "INTERNAL" && shop.seller?.tier === "ULTRA") {
        const downstreamConnections = await prisma.downstreamSourceConnection.findMany({
            where: { upstreamShopId: shop.id, status: "ACTIVE" },
            select: { downstreamShopId: true },
        });
        for (const conn of downstreamConnections) {
            await enqueueCatalogSyncJob(globalSyncQueue, globalRedis, conn.downstreamShopId).catch(() => undefined);
        }
    }
    return products.length;
}
async function notifyCatalogStockUpdates(shopId, encryptedBotToken, notifications) {
    if (notifications.length === 0 || !encryptedBotToken) {
        return 0;
    }
    const token = (0, server_1.decryptSecret)(encryptedBotToken, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
    if (!token ||
        (String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" && (0, server_1.isMockBotToken)(token))) {
        return 0;
    }
    const customers = await prisma.customer.findMany({
        where: { shopId },
        select: {
            telegramChatId: true,
        },
    });
    let sentCount = 0;
    for (const customer of customers) {
        for (const item of notifications) {
            await (0, server_1.telegramSendMessage)(token, customer.telegramChatId, [
                `📦 ${item.displayName}`,
                `➕ Thêm: ${item.addedQuantity}`,
                `📦 Tồn kho hiện tại: ${item.available}`,
            ].join("\n"), {
                reply_markup: {
                    inline_keyboard: [[{ text: "🛒 Mua ngay", callback_data: `buy:${item.sourceProductId}` }]],
                },
            }).catch(() => undefined);
            sentCount += 1;
        }
    }
    return sentCount;
}
async function scheduleCatalogSyncJobs(queue, redis) {
    const shops = await refreshActiveCatalogShopIds();
    if (shops.length === 0) {
        return {
            activeShops: 0,
            scheduled: 0,
        };
    }
    const batchSize = Math.min(shops.length, getCatalogSyncBatchSize(shops.length));
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
        }
        catch (error) {
            console.error(`[worker] Catalog scheduler failed for shop ${shopId}:`, formatError(error));
        }
    }
    return {
        activeShops: shops.length,
        scheduled,
    };
}
async function debitConnectionBalance(connectionId, amount, orderId) {
    await prisma.$transaction(async (tx) => {
        const connection = await tx.downstreamSourceConnection.findUnique({ where: { id: connectionId } });
        if (!connection || !connection.downstreamTelegramChatId) return;
        const customer = await tx.customer.findFirst({
            where: {
                shopId: connection.upstreamShopId,
                telegramChatId: connection.downstreamTelegramChatId,
            },
            include: { wallet: true },
        });
        if (!customer?.wallet) return;
        // Lock wallet row — CustomerWallet is source of truth
        await tx.$queryRaw`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`;
        const walletBefore = Number(customer.wallet.balance);
        const walletAfter = Math.max(0, walletBefore - amount);
        await tx.customerWallet.update({
            where: { id: customer.wallet.id },
            data: { balance: walletAfter },
        });
        await tx.customerWalletLedger.create({
            data: {
                customerId: customer.id,
                walletId: customer.wallet.id,
                type: "SPEND_ORDER",
                amount: -amount,
                balanceBefore: walletBefore,
                balanceAfter: walletAfter,
                referenceType: "order",
                referenceId: orderId,
                note: "Trừ số dư ví khi bot đại lý ra đơn",
            },
        });
        // Sync connection balance = wallet balance (no independent calculation)
        const connBalBefore = Number(connection.balance);
        await tx.downstreamSourceConnection.update({
            where: { id: connectionId },
            data: { balance: walletAfter, lastOrderedAt: new Date() },
        });
        await tx.internalSourceLedger.create({
            data: {
                id: require("crypto").randomUUID(),
                connectionId,
                type: "DEBIT_ORDER",
                amount: -amount,
                balanceBefore: connBalBefore,
                balanceAfter: walletAfter,
                referenceType: "order",
                referenceId: orderId,
                note: "Auto debit from downstream order delivery",
            },
        });
    });
}
async function deleteQrMessage(botToken, order) {
    const messageId = order.paymentTransaction?.qrTelegramMessageId;
    if (!messageId || !order.customer?.telegramChatId)
        return;
    await (0, server_1.telegramDeleteMessage)(botToken, order.customer.telegramChatId, messageId).catch(() => undefined);
}
async function processPurchase(job) {
    const order = await prisma.order.findUnique({
        where: { id: job.data.orderId },
        include: {
            customer: true,
            shop: {
                include: {
                    botConfig: true,
                    providerConfig: true,
                },
            },
            sourceProduct: true,
            paymentTransaction: true,
        },
    });
    if (!order?.shop.providerConfig) {
        const metadata = order?.sourceProduct?.metadataJson &&
            typeof order.sourceProduct.metadataJson === "object" &&
            !Array.isArray(order.sourceProduct.metadataJson)
            ? order.sourceProduct.metadataJson
            : {};
        const isManual = String(order?.sourceProduct?.providerName || "").toLowerCase() === "manual" ||
            metadata.manual === true;
        if (!order || !isManual) {
            return;
        }
    }
    const providerConfig = order.shop.providerConfig;
    if (!providerConfig) {
        return;
    }
    const sourceMetadata = order.sourceProduct?.metadataJson &&
        typeof order.sourceProduct.metadataJson === "object" &&
        !Array.isArray(order.sourceProduct.metadataJson)
        ? order.sourceProduct.metadataJson
        : {};
    const customerLanguage = normalizeLanguage(order.customer?.preferredLanguage);
    const isManualProduct = String(order.sourceProduct.providerName || "").toLowerCase() === "manual" ||
        sourceMetadata.manual === true;
    if (isManualProduct) {
        const botToken = (0, server_1.decryptSecret)(order.shop.botConfig?.telegramBotTokenEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
        const deliveryEntries = readManualDeliveryEntries(sourceMetadata);
        if (deliveryEntries.length >= order.quantity) {
            const deliveredEntries = deliveryEntries.slice(0, order.quantity);
            const remainingEntries = deliveryEntries.slice(order.quantity);
            const deliveredText = deliveredEntries.join("\n\n");
            const remainingDeliveryText = normalizeManualDeliveryText(remainingEntries.join("\n\n")) || null;
            const deliveredAt = new Date();
            await prisma.$transaction(async (tx) => {
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        status: "DELIVERED",
                        deliveredAccountText: deliveredText,
                        deliveredAt,
                    },
                });
                await tx.orderEvent.create({
                    data: {
                        orderId: order.id,
                        eventType: "manual_product_delivered",
                        payloadJson: {
                            deliveredText,
                            deliveredCount: deliveredEntries.length,
                        },
                    },
                });
                await tx.sourceProduct.update({
                    where: { id: order.sourceProductId },
                    data: {
                        soldCount: {
                            increment: order.quantity,
                        },
                        available: remainingEntries.length,
                        metadataJson: {
                            ...sourceMetadata,
                            manual: true,
                            deliveryEntries: remainingEntries,
                            deliveryText: remainingDeliveryText,
                        },
                    },
                });
            });
            await snapshotWarrantyForDeliveredOrder(order.id);
            if (botToken &&
                !(String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
                    (0, server_1.isMockBotToken)(botToken))) {
                await deleteQrMessage(botToken, order);
                await sendDeliveredOrderMessages({
                    botToken,
                    chatId: order.customer.telegramChatId,
                    orderCode: order.orderCode,
                    productName: order.productNameSnapshot,
                    quantity: order.quantity,
                    amount: order.totalSaleAmount,
                    deliveredText,
                    deliveredAt,
                    language: customerLanguage,
                    sourceDescription: order.sourceProduct?.sourceDescription,
                    metadata: sourceMetadata,
                    shop: {
                        supportTelegram: order.shop.supportTelegram,
                        supportZalo: order.shop.supportZalo,
                    },
                });
            }
            return;
        }
        if (deliveryEntries.length > 0 && deliveryEntries.length < order.quantity) {
            const shortageReason = "Kho tai khoan giao tu dong khong du so luong. Don da chuyen sang cho seller xu ly thu cong.";
            await prisma.$transaction(async (tx) => {
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        status: "PAID_WAITING_STOCK",
                        failureReason: shortageReason,
                    },
                });
                await tx.orderEvent.create({
                    data: {
                        orderId: order.id,
                        eventType: "manual_product_pending",
                        payloadJson: {
                            reason: shortageReason,
                            availableEntries: deliveryEntries.length,
                            requestedQuantity: order.quantity,
                        },
                    },
                });
            });
            if (botToken &&
                !(String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
                    (0, server_1.isMockBotToken)(botToken))) {
                await (0, server_1.telegramSendMessage)(botToken, order.customer.telegramChatId, buildManualPendingMessage({
                    language: customerLanguage,
                    orderCode: order.orderCode,
                    productName: order.productNameSnapshot,
                    quantity: order.quantity,
                    shortage: true,
                    shop: {
                        supportTelegram: order.shop.supportTelegram,
                        supportZalo: order.shop.supportZalo,
                    },
                })).catch(() => undefined);
            }
            return;
        }
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: order.id },
                data: {
                    status: "PAID_WAITING_STOCK",
                    failureReason: "San pham manual dang cho seller xu ly thu cong.",
                },
            });
            await tx.orderEvent.create({
                data: {
                    orderId: order.id,
                    eventType: "manual_product_pending",
                    payloadJson: {
                        reason: "San pham manual dang cho seller xu ly thu cong.",
                    },
                },
            });
        });
        if (botToken &&
            !(String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
                (0, server_1.isMockBotToken)(botToken))) {
            await (0, server_1.telegramSendMessage)(botToken, order.customer.telegramChatId, buildManualPendingMessage({
                language: customerLanguage,
                orderCode: order.orderCode,
                productName: order.productNameSnapshot,
                quantity: order.quantity,
                shortage: false,
                shop: {
                    supportTelegram: order.shop.supportTelegram,
                    supportZalo: order.shop.supportZalo,
                },
            })).catch(() => undefined);
        }
        return;
    }
    const buyerKey = (0, server_1.decryptSecret)(providerConfig.buyerKeyEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
    const botToken = (0, server_1.decryptSecret)(order.shop.botConfig?.telegramBotTokenEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
    const result = String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true" && (0, server_1.isMockBuyerKey)(buyerKey)
        ? (0, server_1.purchaseFromMockProvider)({
            productId: order.sourceProduct.externalProductId,
            quantity: order.quantity,
        })
        : await (0, server_1.purchaseFromProvider)({
            baseUrl: providerConfig.baseUrl,
            buyerKey,
        }, {
            productId: order.sourceProduct.externalProductId,
            quantity: order.quantity,
            clientOrderCode: order.orderCode,
        });
    if (result.success && result.deliveredText) {
        const deliveredAt = new Date();
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: order.id },
                data: {
                    status: "DELIVERED",
                    deliveredAccountText: result.deliveredText,
                    deliveredAt,
                    internalSourceOrderId: result.providerOrderId || undefined,
                    internalSourceOrderCode: result.providerOrderCode || undefined,
                    failureReason: null,
                },
            });
            await tx.orderEvent.create({
                data: {
                    orderId: order.id,
                    eventType: "upstream_purchase_success",
                    payloadJson: {
                        deliveredText: result.deliveredText,
                        providerOrderId: result.providerOrderId || null,
                        providerOrderCode: result.providerOrderCode || null,
                    },
                },
            });
            await tx.sourceProduct.update({
                where: { id: order.sourceProductId },
                data: {
                    soldCount: {
                        increment: order.quantity,
                    },
                    available: order.sourceProduct.available === null
                        ? undefined
                        : {
                            decrement: order.quantity,
                        },
                },
            });
        });
        await snapshotWarrantyForDeliveredOrder(order.id);
        if (providerConfig.providerKind === "INTERNAL" && providerConfig.internalSourceConnectionId) {
            const totalSourceAmount = Number(order.totalSourceAmount || 0);
            if (totalSourceAmount > 0) {
                await debitConnectionBalance(providerConfig.internalSourceConnectionId, totalSourceAmount, order.id).catch(() => undefined);
            }
        }
        if (botToken &&
            !(String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
                (0, server_1.isMockBotToken)(botToken))) {
            await deleteQrMessage(botToken, order);
            await sendDeliveredOrderMessages({
                botToken,
                chatId: order.customer.telegramChatId,
                orderCode: order.orderCode,
                productName: order.productNameSnapshot,
                quantity: order.quantity,
                amount: order.totalSaleAmount,
                deliveredText: result.deliveredText,
                deliveredAt,
                language: customerLanguage,
                sourceDescription: order.sourceProduct?.sourceDescription,
                metadata: sourceMetadata,
                shop: {
                    supportTelegram: order.shop.supportTelegram,
                    supportZalo: order.shop.supportZalo,
                },
            });
        }
        return;
    }
    await prisma.$transaction(async (tx) => {
        await tx.order.update({
            where: { id: order.id },
            data: {
                status: result.outOfStock || result.pending ? "PAID_WAITING_STOCK" : "FAILED",
                failureReason: result.message || "Upstream purchase failed.",
                internalSourceOrderId: result.providerOrderId || undefined,
                internalSourceOrderCode: result.providerOrderCode || undefined,
            },
        });
        await tx.orderEvent.create({
            data: {
                orderId: order.id,
                eventType: result.outOfStock || result.pending ? "upstream_out_of_stock" : "upstream_failed",
                payloadJson: {
                    message: result.message || "Upstream purchase failed.",
                    providerOrderId: result.providerOrderId || null,
                    providerOrderCode: result.providerOrderCode || null,
                },
            },
        });
    });
}
async function reconcilePendingInternalSourceOrders() {
    const orders = await prisma.order.findMany({
        where: {
            sourceProviderKindSnapshot: "INTERNAL",
            status: {
                in: ["PROCESSING_PURCHASE", "PAID_WAITING_STOCK"],
            },
            OR: [
                {
                    internalSourceOrderId: {
                        not: null,
                    },
                },
                {
                    internalSourceOrderCode: {
                        not: null,
                    },
                },
            ],
        },
        include: {
            customer: true,
            shop: {
                include: {
                    botConfig: true,
                    providerConfig: true,
                },
            },
            sourceProduct: true,
        },
        orderBy: {
            createdAt: "asc",
        },
        take: 20,
    });
    for (const order of orders) {
        const providerConfig = order.shop.providerConfig;
        if (!providerConfig) {
            continue;
        }
        const buyerKey = (0, server_1.decryptSecret)(providerConfig.buyerKeyEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
        if (!buyerKey) {
            continue;
        }
        try {
            const result = await (0, server_1.fetchProviderOrderStatus)({
                baseUrl: providerConfig.baseUrl,
                buyerKey,
                providerName: providerConfig.providerName,
            }, {
                orderId: order.internalSourceOrderId,
                orderCode: order.internalSourceOrderCode,
            });
            if (!result.providerOrderId && !result.providerOrderCode && !result.status) {
                continue;
            }
            if (result.status === "delivered" && result.deliveredText) {
                const deliveredAt = new Date();
                await prisma.$transaction(async (tx) => {
                    await tx.order.update({
                        where: { id: order.id },
                        data: {
                            status: "DELIVERED",
                            deliveredAccountText: result.deliveredText,
                            deliveredAt,
                            internalSourceOrderId: result.providerOrderId || order.internalSourceOrderId || undefined,
                            internalSourceOrderCode: result.providerOrderCode || order.internalSourceOrderCode || undefined,
                            failureReason: null,
                        },
                    });
                    await tx.orderEvent.create({
                        data: {
                            orderId: order.id,
                            eventType: "internal_source_order_delivered",
                            payloadJson: {
                                providerOrderId: result.providerOrderId || null,
                                providerOrderCode: result.providerOrderCode || null,
                            },
                        },
                    });
                    await tx.sourceProduct.update({
                        where: { id: order.sourceProductId },
                        data: {
                            soldCount: {
                                increment: order.quantity,
                            },
                            available: order.sourceProduct.available === null
                                ? undefined
                                : {
                                    decrement: order.quantity,
                                },
                        },
                    });
                });
                await snapshotWarrantyForDeliveredOrder(order.id);
                const botToken = (0, server_1.decryptSecret)(order.shop.botConfig?.telegramBotTokenEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
                const sourceMetadata = order.sourceProduct?.metadataJson &&
                    typeof order.sourceProduct.metadataJson === "object" &&
                    !Array.isArray(order.sourceProduct.metadataJson)
                    ? order.sourceProduct.metadataJson
                    : {};
                const customerLanguage = normalizeLanguage(order.customer?.preferredLanguage);
                if (botToken &&
                    !(String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
                        (0, server_1.isMockBotToken)(botToken))) {
                    await deleteQrMessage(botToken, order);
                    await sendDeliveredOrderMessages({
                        botToken,
                        chatId: order.customer.telegramChatId,
                        orderCode: order.orderCode,
                        productName: order.productNameSnapshot,
                        quantity: order.quantity,
                        amount: order.totalSaleAmount,
                        deliveredText: result.deliveredText,
                        deliveredAt,
                        language: customerLanguage,
                        sourceDescription: order.sourceProduct?.sourceDescription,
                        metadata: sourceMetadata,
                        shop: {
                            supportTelegram: order.shop.supportTelegram,
                            supportZalo: order.shop.supportZalo,
                        },
                    });
                }
                continue;
            }
            if (["pending", "processing", "pending_stock", "pending_manual"].includes(String(result.status || ""))) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: "PAID_WAITING_STOCK",
                        failureReason: result.failureReason || "Internal source order is waiting for seller handling.",
                        internalSourceOrderId: result.providerOrderId || order.internalSourceOrderId || undefined,
                        internalSourceOrderCode: result.providerOrderCode || order.internalSourceOrderCode || undefined,
                    },
                }).catch(() => undefined);
                continue;
            }
            if (["failed", "canceled"].includes(String(result.status || ""))) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: "PAID_WAITING_STOCK",
                        failureReason: result.failureReason || result.message || "Internal source order needs seller review.",
                        internalSourceOrderId: result.providerOrderId || order.internalSourceOrderId || undefined,
                        internalSourceOrderCode: result.providerOrderCode || order.internalSourceOrderCode || undefined,
                    },
                }).catch(() => undefined);
            }
        }
        catch (error) {
            console.error(`[worker] Internal source order reconcile failed for ${order.orderCode}:`, formatError(error));
        }
    }
}
async function processBroadcast(job) {
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
    await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
            status: "SENDING",
        },
    });
    const botToken = (0, server_1.decryptSecret)(broadcast.shop.botConfig?.telegramBotTokenEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
    let sentCount = 0;
    let failedCount = 0;
    for (const customer of customers) {
        try {
            if (botToken &&
                !(String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" &&
                    (0, server_1.isMockBotToken)(botToken))) {
                await (0, server_1.telegramSendMessage)(botToken, customer.telegramChatId, broadcast.message);
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
        }
        catch (error) {
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
            status: failedCount > 0 && sentCount === 0 ? "FAILED" : "COMPLETED",
            sentCount,
            failedCount,
            sentAt: new Date(),
        },
    });
}
async function pollTelegramBots() {
    const bots = await prisma.botConfig.findMany({
        where: {
            deliveryMode: "POLLING",
            webhookStatus: {
                in: ["POLLING", "ACTIVE"],
            },
        },
    });
    for (const bot of bots) {
        const token = (0, server_1.decryptSecret)(bot.telegramBotTokenEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
        if (!token || (0, server_1.isMockBotToken)(token)) {
            continue;
        }
        try {
            const offset = bot.lastProcessedUpdateId ? Number(bot.lastProcessedUpdateId) + 1 : undefined;
            const updates = await (0, server_1.telegramGetUpdates)(token, offset, 1);
            for (const update of updates) {
                const updateId = Number(update.update_id || 0);
                const path = `/api/v1/internal/telegram/process/${bot.shopId}`;
                const rawBody = JSON.stringify(update);
                const signedHeaders = (0, server_1.buildInternalRequestHeaders)({
                    secret: process.env.INTERNAL_API_TOKEN || "change-me-internal-api-token",
                    method: "POST",
                    path,
                    body: rawBody,
                });
                await axios_1.default.post(`${process.env.APP_PUBLIC_URL || "http://localhost:3000"}${path}`, update, {
                    headers: {
                        ...signedHeaders,
                    },
                    timeout: 10000,
                });
                await prisma.botConfig.update({
                    where: { id: bot.id },
                    data: {
                        lastProcessedUpdateId: BigInt(updateId),
                    },
                });
            }
        }
        catch (error) {
            const status = error?.response?.status ?? error?.response?.data?.error_code;
            if (status === 404) {
                console.warn(`[worker] Bot token invalid for shop ${bot.shopId} — set token to "mock..." to suppress.`);
            } else {
                console.error("[worker] Telegram polling failed:", error?.message ?? error);
            }
        }
    }
}
async function reconcilePendingPayOSOrders(purchaseQueue) {
    const pendingOrders = await prisma.order.findMany({
        where: {
            status: "AWAITING_PAYMENT",
            paymentStatus: "UNPAID",
            paymentTransaction: {
                is: {
                    provider: "PAYOS",
                    status: "PENDING",
                },
            },
        },
        include: {
            paymentTransaction: true,
            shop: {
                include: {
                    paymentConfig: true,
                },
            },
        },
        orderBy: {
            createdAt: "asc",
        },
        take: 20,
    });
    for (const order of pendingOrders) {
        const externalOrderCode = order.paymentTransaction?.externalOrderCode;
        if (!externalOrderCode) {
            continue;
        }
        const credentials = resolvePayOSCredentials(order.shop.paymentConfig);
        if (!credentials) {
            continue;
        }
        try {
            const remoteStatus = await (0, server_1.getPayOSPaymentLinkStatus)(credentials, externalOrderCode);
            const providerStatus = String(remoteStatus.status || "UNKNOWN").toUpperCase();
            const isPaid = ["PAID", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(providerStatus) ||
                (Number(remoteStatus.amountPaid || 0) > 0 &&
                    Number(remoteStatus.amount || 0) > 0 &&
                    Number(remoteStatus.amountPaid || 0) >= Number(remoteStatus.amount || 0));
            if (!isPaid) {
                continue;
            }
            const paidOrder = await prisma.$transaction(async (tx) => {
                const current = await tx.order.findUnique({
                    where: { id: order.id },
                    include: {
                        paymentTransaction: true,
                    },
                });
                if (!current?.paymentTransaction ||
                    current.status !== "AWAITING_PAYMENT" ||
                    current.paymentStatus !== "UNPAID" ||
                    current.paymentTransaction.status !== "PENDING") {
                    return null;
                }
                const paidAt = new Date();
                await tx.paymentTransaction.update({
                    where: { id: current.paymentTransaction.id },
                    data: {
                        status: "PAID",
                        paidAt,
                        rawPayloadJson: {
                            sweptBy: "worker_payos_status_poll",
                            providerStatus,
                            payos: remoteStatus.providerResponse,
                        },
                    },
                });
                await tx.order.update({
                    where: { id: current.id },
                    data: {
                        paymentStatus: "PAID",
                        status: "PAID",
                        paidAt,
                    },
                });
                await tx.orderEvent.create({
                    data: {
                        orderId: current.id,
                        eventType: "payment_completed",
                        payloadJson: {
                            sweptBy: "worker_payos_status_poll",
                            externalOrderCode,
                            providerStatus,
                            payos: remoteStatus.providerResponse,
                        },
                    },
                });
                return {
                    id: current.id,
                    totalSourceAmount: current.totalSourceAmount,
                };
            });
            if (!paidOrder) {
                continue;
            }
            await enqueuePaidOrder(purchaseQueue, paidOrder.id, decimalToNumber(paidOrder.totalSourceAmount));
            console.log(`[worker] Reconciled PayOS payment ${externalOrderCode} without waiting for the success-page click.`);
        }
        catch (error) {
            console.error(`[worker] PayOS pending order reconcile failed for ${externalOrderCode}:`, formatError(error));
        }
    }
}
async function expireCustomerWalletTopups() {
    const expiredTopups = await prisma.customerWalletTopup.findMany({
        where: {
            status: "PENDING",
            expiresAt: {
                lte: new Date(),
            },
        },
        include: {
            customer: true,
            shop: {
                include: {
                    botConfig: true,
                },
            },
        },
        orderBy: {
            expiresAt: "asc",
        },
        take: 30,
    });
    for (const topup of expiredTopups) {
        const updated = await prisma.customerWalletTopup.updateMany({
            where: {
                id: topup.id,
                status: "PENDING",
            },
            data: {
                status: "CANCELED",
                canceledAt: new Date(),
            },
        });
        if (updated.count === 0) {
            continue;
        }
        const botToken = (0, server_1.decryptSecret)(topup.shop.botConfig?.telegramBotTokenEncrypted, process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key");
        if (!botToken ||
            (String(process.env.MOCK_TELEGRAM_MODE || "false") === "true" && (0, server_1.isMockBotToken)(botToken))) {
            continue;
        }
        await (0, server_1.telegramSendMessage)(botToken, topup.customer.telegramChatId, [
            "⌛ Lenh nap vi da het han",
            `Ma nap: ${topup.externalOrderCode}`,
            `So tien: ${decimalToNumber(topup.amount).toLocaleString("vi-VN")}d`,
            "",
            "Lenh nap da qua 5 phut chua thanh toan va da bi huy.",
        ].join("\n"), {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🏦 Nap lai", callback_data: "wallet:topup" }],
                    [{ text: "💳 Xem vi", callback_data: "home:wallet" }],
                ],
            },
        }).catch(() => undefined);
    }
}
async function cleanupStaleData() {
    const now = new Date();
    const days90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const days2 = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const [orderEventsDeleted, referralEventsDeleted, topupsDeleted, accountsCleared] = await Promise.all([
        prisma.orderEvent.deleteMany({
            where: { createdAt: { lt: days90 } },
        }),
        prisma.referralEvent.deleteMany({
            where: { createdAt: { lt: days90 } },
        }),
        prisma.customerWalletTopup.deleteMany({
            where: {
                status: { in: ["CANCELED", "EXPIRED"] },
                createdAt: { lt: days30 },
            },
        }),
        prisma.order.updateMany({
            where: {
                status: "DELIVERED",
                deliveredAccountText: { not: null },
                warrantyExpiresAt: { lt: days2 },
            },
            data: { deliveredAccountText: null },
        }),
    ]);
    console.log(`[worker] Data cleanup: orderEvents=${orderEventsDeleted.count}, referralEvents=${referralEventsDeleted.count}, topups=${topupsDeleted.count}, accountsCleared=${accountsCleared.count}`);
}
async function expireSellerTiers() {
    const now = new Date();
    const expired = await prisma.seller.findMany({
        where: {
            tier: "PRO",
            tierExpiresAt: { not: null, lt: now },
        },
        select: { id: true },
    });
    if (expired.length === 0) return;
    await prisma.seller.updateMany({
        where: { id: { in: expired.map((s) => s.id) } },
        data: { tier: "FREE" },
    });
    console.log(`[worker] Expired ${expired.length} PRO seller(s) → FREE.`);
}
async function expireSellerDepositRequests() {
    const expiredRequests = await prisma.depositRequest.findMany({
        where: {
            status: "PENDING",
            externalOrderCode: {
                not: null,
            },
            expiresAt: {
                lte: new Date(),
            },
        },
        orderBy: {
            expiresAt: "asc",
        },
        take: 30,
    });
    for (const request of expiredRequests) {
        await prisma.depositRequest.updateMany({
            where: {
                id: request.id,
                status: "PENDING",
            },
            data: {
                status: "REJECTED",
                note: request.note || "Expired payment link",
            },
        });
    }
}
async function bootstrap() {
    const redis = await waitForInfrastructure();
    globalRedis = redis;
    const syncQueue = new bullmq_1.Queue(server_1.QUEUES.syncCatalog, {
        connection: redis,
    });
    globalSyncQueue = syncQueue;
    const purchaseQueue = new bullmq_1.Queue(server_1.QUEUES.purchaseUpstream, {
        connection: redis,
    });
    const syncWorker = new bullmq_1.Worker(server_1.QUEUES.syncCatalog, async (job) => {
        if (job.name === server_1.JOBS.syncCatalog) {
            try {
                return await syncCatalogForShop(job.data.shopId);
            }
            finally {
                await releaseCatalogSyncLock(redis, job.data.shopId, job.data.lockToken).catch(() => undefined);
            }
        }
        return null;
    }, {
        connection: redis,
        concurrency: Math.max(1, Math.floor(CATALOG_SYNC_CONCURRENCY)),
    });
    const purchaseWorker = new bullmq_1.Worker(server_1.QUEUES.purchaseUpstream, async (job) => {
        if (job.name === server_1.JOBS.purchaseUpstream) {
            return processPurchase(job);
        }
        return null;
    }, {
        connection: redis,
        concurrency: 2,
    });
    const broadcastWorker = new bullmq_1.Worker(server_1.QUEUES.broadcast, async (job) => {
        if (job.name === server_1.JOBS.broadcast) {
            return processBroadcast(job);
        }
        return null;
    }, {
        connection: redis,
        concurrency: 1,
    });
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
        void reconcilePendingInternalSourceOrders().catch((error) => {
            console.error("[worker] Internal source order sweep failed:", formatError(error));
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
    console.log(`[worker] Started queue workers and Telegram poller. Catalog sync concurrency=${Math.max(1, Math.floor(CATALOG_SYNC_CONCURRENCY))}, scheduler tick=${CATALOG_SCHEDULER_TICK_MS}ms, target interval=${CATALOG_SYNC_INTERVAL_MS}ms.`);
}
bootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map
