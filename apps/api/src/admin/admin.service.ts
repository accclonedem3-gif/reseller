import { Inject, Injectable, Logger } from "@nestjs/common";
import { OrderStatus, Prisma, SellerTier, UserRole, UserStatus } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import axios from "axios";

import { PrismaService } from "../db/prisma.service";
import { CacheService } from "../lib/cache.service";
import { decimalToNumber } from "../lib/utils";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(CacheService)
    private readonly cache: CacheService,
  ) {}

  /**
   * Push the admin's `warranty.check.proxies` value to the CheckGrokJS server so its CF cookie
   * warmer + per-job picker uses the same proxy list as the worker. Without this sync, the
   * grok server keeps its boot-time proxy.txt snapshot — when admin adds a new proxy, the
   * worker picks it up on the next job (no cache) but the warmer never warms it → cold-start
   * tax (~15-25s CF challenge) on first hit instead of ~3s warm.
   *
   * Two steps:
   *  1. Write the proxy list to `CHECK_GROK_PROXY_FILE` (defaults to ../../CheckGrokJS/proxy.txt
   *     relative to API cwd — covers the local-dev monorepo-sibling layout).
   *  2. Hit `POST /admin/reload-proxies` on the grok server so it re-reads the file in-process,
   *     no restart needed.
   *
   * Errors are logged but don't fail the admin config save — the DB is the source of truth,
   * worker reads from there. Grok server sync is an optimisation, not correctness-critical.
   */
  private async syncProxiesToVeoServer(proxyValue: string): Promise<void> {
    const veoUrl = (process.env.CHECK_VEO_URL || "").replace(/\/+$/, "");

    const candidates = process.env.CHECK_VEO_PROXY_FILE
      ? [process.env.CHECK_VEO_PROXY_FILE]
      : [
          path.resolve(process.cwd(), "..", "..", "..", "check_veo", "proxies.txt"),
          path.resolve(process.cwd(), "..", "..", "check_veo", "proxies.txt"),
          path.resolve(process.cwd(), "..", "check_veo", "proxies.txt"),
          path.resolve(process.cwd(), "check_veo", "proxies.txt"),
        ];

    const proxyFile: string =
      candidates.find((p): p is string => !!p && fs.existsSync(path.dirname(p))) ||
      candidates[0] || "";
    if (!proxyFile) {
      this.logger.warn("No proxies.txt path candidate resolved — skipping veo sync.");
      return;
    }

    try {
      fs.writeFileSync(proxyFile, proxyValue, "utf8");
      this.logger.log(`Wrote ${proxyValue.split(/\r?\n/).filter(Boolean).length} proxy lines to ${proxyFile}`);
    } catch (err: any) {
      this.logger.warn(`Failed to write proxies.txt at ${proxyFile}: ${err?.message ?? err}`);
      return;
    }

    if (!veoUrl) {
      this.logger.log("CHECK_VEO_URL not set — skipping veo server reload (proxies.txt written though, will pick up on next server restart).");
      return;
    }

    try {
      const headers: Record<string, string> = {};
      if (process.env.CHECK_VEO_API_KEY) headers["X-API-Key"] = process.env.CHECK_VEO_API_KEY;
      const res = await axios.post(`${veoUrl}/admin/reload-proxies`, {}, { headers, timeout: 5_000 });
      this.logger.log(`Veo server reloaded: ${res.data?.proxies ?? "?"} proxies active`);
      await axios.post(`${veoUrl}/admin/warm-now`, {}, { headers, timeout: 5_000 }).catch(() => undefined);
    } catch (err: any) {
      this.logger.warn(`Veo server /admin/reload-proxies failed: ${err?.message ?? err}`);
    }
  }

  private async syncProxiesToGrokServer(proxyValue: string): Promise<void> {
    const grokUrl = (process.env.CHECK_GROK_URL || "").replace(/\/+$/, "");

    // proxy.txt path resolution: API cwd depends on how it's launched (nest start runs from
    // `apps/api/`, npm run dev runs from reseller root, prod PM2 may be `apps/api/dist`).
    // Walk a list of candidates from inside-out — first existing parent gets the write.
    // Explicit env override always wins.
    const candidates = process.env.CHECK_GROK_PROXY_FILE
      ? [process.env.CHECK_GROK_PROXY_FILE]
      : [
          path.resolve(process.cwd(), "..", "..", "..", "CheckGrokJS", "proxy.txt"), // from apps/api/dist
          path.resolve(process.cwd(), "..", "..", "CheckGrokJS", "proxy.txt"),       // from apps/api/
          path.resolve(process.cwd(), "..", "CheckGrokJS", "proxy.txt"),             // from reseller/
          path.resolve(process.cwd(), "CheckGrokJS", "proxy.txt"),                   // from D:/DuAn/
        ];

    // Pick the first candidate whose PARENT DIR exists. If none exist, use the first
    // candidate and let writeFileSync error out (caller logs it).
    const proxyFile: string =
      candidates.find((p): p is string => !!p && fs.existsSync(path.dirname(p))) ||
      candidates[0] || "";
    if (!proxyFile) {
      this.logger.warn("No proxy.txt path candidate resolved — skipping grok sync.");
      return;
    }

    try {
      fs.writeFileSync(proxyFile, proxyValue, "utf8");
      this.logger.log(`Wrote ${proxyValue.split(/\r?\n/).filter(Boolean).length} proxy lines to ${proxyFile}`);
    } catch (err: any) {
      this.logger.warn(`Failed to write proxy.txt at ${proxyFile}: ${err?.message ?? err}`);
      return; // Skip reload if file write failed — server has nothing fresh to read.
    }

    if (!grokUrl) {
      this.logger.log("CHECK_GROK_URL not set — skipping grok server reload (proxy.txt written though, will pick up on next server restart).");
      return;
    }

    try {
      const headers: Record<string, string> = {};
      if (process.env.CHECK_GROK_API_KEY) headers["X-API-Key"] = process.env.CHECK_GROK_API_KEY;
      const res = await axios.post(`${grokUrl}/admin/reload-proxies`, {}, { headers, timeout: 5_000 });
      this.logger.log(`Grok server reloaded: ${res.data?.proxies ?? "?"} proxies active`);
      // Kick off a warm cycle immediately so the new proxies pick up CF cookies before the next check.
      await axios.post(`${grokUrl}/admin/warm-now`, {}, { headers, timeout: 5_000 }).catch(() => undefined);
    } catch (err: any) {
      this.logger.warn(`Grok server /admin/reload-proxies failed: ${err?.message ?? err}`);
    }
  }

  async getOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [
      totalSellers,
      activeSellers,
      tierCounts,
      totalOrdersThisMonth,
      totalOrdersLastMonth,
      revenueThisMonth,
      revenueLastMonth,
      totalOrders,
    ] = await Promise.all([
      this.prisma.seller.count(),
      this.prisma.seller.count({ where: { status: "ACTIVE" } }),
      this.prisma.seller.groupBy({
        by: ["tier"],
        _count: { tier: true },
      }),
      this.prisma.order.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      this.prisma.order.count({
        where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
      }),
      this.prisma.order.aggregate({
        where: {
          status: { in: ["DELIVERED", "PAID", "PROCESSING_PURCHASE"] },
          createdAt: { gte: startOfMonth },
        },
        _sum: { totalSaleAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: { in: ["DELIVERED", "PAID", "PROCESSING_PURCHASE"] },
          createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
        },
        _sum: { totalSaleAmount: true },
      }),
      this.prisma.order.count(),
    ]);

    const tierMap: Record<string, number> = {};
    for (const t of tierCounts) {
      tierMap[t.tier.toLowerCase()] = t._count.tier;
    }

    return {
      totalSellers,
      activeSellers,
      tierCounts: tierMap,
      totalOrders,
      totalOrdersThisMonth,
      totalOrdersLastMonth,
      revenueThisMonth: decimalToNumber(revenueThisMonth._sum?.totalSaleAmount ?? 0),
      revenueLastMonth: decimalToNumber(revenueLastMonth._sum?.totalSaleAmount ?? 0),
    };
  }

  async getRevenueChart(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ["DELIVERED", "PAID", "PROCESSING_PURCHASE"] },
        createdAt: { gte: since },
      },
      select: { createdAt: true, totalSaleAmount: true },
    });

    const map = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      map.set(d.toISOString().slice(0, 10), 0);
    }

    for (const order of orders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + decimalToNumber(order.totalSaleAmount));
    }

    return Array.from(map.entries()).map(([date, revenue]) => ({ date, revenue }));
  }

  async getRecentSellers(limit = 10) {
    const users = await this.prisma.user.findMany({
      where: { role: UserRole.SELLER },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        seller: {
          select: {
            displayName: true,
            tier: true,
            status: true,
            shops: {
              take: 1,
              select: { name: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      username: u.email,
      displayName: u.seller?.displayName || null,
      tier: u.seller?.tier.toLowerCase() || null,
      status: u.status.toLowerCase(),
      shopName: u.seller?.shops[0]?.name || null,
      createdAt: u.createdAt,
    }));
  }

  async listSellers(filters: { tier?: SellerTier; status?: string; search?: string }) {
    const users = await this.prisma.user.findMany({
      where: {
        role: UserRole.SELLER,
        ...(filters.status
          ? { status: filters.status.toUpperCase() as UserStatus }
          : {}),
        ...(filters.search
          ? {
              OR: [
                { email: { contains: filters.search, mode: "insensitive" } },
                {
                  seller: {
                    displayName: { contains: filters.search, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
        ...(filters.tier
          ? { seller: { tier: filters.tier } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        seller: {
          include: {
            shops: {
              take: 1,
              orderBy: { createdAt: "asc" },
              select: { id: true, name: true, slug: true, status: true },
            },
            wallet: { select: { balance: true } },
            _count: {
              select: { orders: true, customers: true },
            },
          },
        },
      },
      take: 500,
    });

    return users.map((u) => ({
      id: u.id,
      username: u.email,
      recoveryEmail: u.recoveryEmail,
      status: u.status.toLowerCase(),
      createdAt: u.createdAt,
      displayName: u.seller?.displayName || null,
      sellerTier: u.seller?.tier.toLowerCase() || null,
      sellerTierStartedAt: u.seller?.tierStartedAt || null,
      sellerTierExpiresAt: u.seller?.tierExpiresAt || null,
      sellerStatus: u.seller?.status.toLowerCase() || null,
      shopId: u.seller?.shops[0]?.id || null,
      shopName: u.seller?.shops[0]?.name || null,
      shopSlug: u.seller?.shops[0]?.slug || null,
      shopStatus: u.seller?.shops[0]?.status.toLowerCase() || null,
      walletBalance: u.seller?.wallet ? decimalToNumber(u.seller.wallet.balance) : 0,
      orderCount: u.seller?._count.orders ?? 0,
      customerCount: u.seller?._count.customers ?? 0,
    }));
  }

  async updateSellerTier(userId: string, tier: SellerTier) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { seller: true },
    });

    if (!user || user.role !== UserRole.SELLER || !user.seller) {
      throw new Error("Seller not found");
    }

    await this.prisma.seller.update({
      where: { id: user.seller.id },
      data: { tier },
    });

    return { id: userId, tier: tier.toLowerCase() };
  }

  async updateSellerTierDates(
    userId: string,
    dates: { tierStartedAt?: string | null; tierExpiresAt?: string | null },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { seller: true },
    });

    if (!user || user.role !== UserRole.SELLER || !user.seller) {
      throw new Error("Seller not found");
    }

    const tierStartedAt =
      "tierStartedAt" in dates
        ? dates.tierStartedAt
          ? new Date(dates.tierStartedAt)
          : null
        : undefined;

    let tierExpiresAt: Date | null | undefined =
      "tierExpiresAt" in dates
        ? dates.tierExpiresAt
          ? new Date(dates.tierExpiresAt)
          : null
        : undefined;

    // Nếu chỉ set tierStartedAt mà không kèm tierExpiresAt → tự tính +30 ngày
    if (tierStartedAt && tierExpiresAt === undefined) {
      tierExpiresAt = new Date(tierStartedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const updated = await this.prisma.seller.update({
      where: { id: user.seller.id },
      data: { tierStartedAt, tierExpiresAt },
      select: { tierStartedAt: true, tierExpiresAt: true },
    });

    return { id: userId, tierStartedAt: updated.tierStartedAt, tierExpiresAt: updated.tierExpiresAt };
  }

  async listOrders(params: { page: number; status?: string; search?: string }) {
    const PAGE_SIZE = 20;
    const skip = (params.page - 1) * PAGE_SIZE;

    const where: Prisma.OrderWhereInput = {};
    if (params.status) {
      where.status = params.status.toUpperCase() as OrderStatus;
    }
    if (params.search) {
      where.OR = [
        { orderCode: { contains: params.search, mode: "insensitive" } },
        { productNameSnapshot: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
        include: {
          seller: { select: { displayName: true } },
          shop: { select: { name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        status: o.status.toLowerCase(),
        productName: o.productNameSnapshot,
        totalAmount: decimalToNumber(o.totalSaleAmount),
        quantity: o.quantity,
        sellerName: o.seller?.displayName || null,
        shopName: o.shop?.name || null,
        createdAt: o.createdAt,
      })),
      total,
      page: params.page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
  }

  async getOrderDetail(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        seller: { select: { displayName: true } },
        shop: { select: { name: true } },
        customer: {
          select: {
            telegramUserId: true,
            firstName: true,
            lastName: true,
          },
        },
        warrantyClaims: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            claimNumber: true,
            status: true,
            customerMessage: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) return null;

    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status.toLowerCase(),
      productName: order.productNameSnapshot,
      totalAmount: decimalToNumber(order.totalSaleAmount),
      quantity: order.quantity,
      unitPrice: decimalToNumber(order.salePrice),
      deliveredAccountText: order.deliveredAccountText,
      sellerName: order.seller?.displayName || null,
      shopName: order.shop?.name || null,
      customerTelegramId: order.customer?.telegramUserId || null,
      customerName:
        [order.customer?.firstName, order.customer?.lastName]
          .filter(Boolean)
          .join(" ") || null,
      warrantyPolicy: order.warrantyPolicySnapshot,
      warrantyClaims: order.warrantyClaims,
      sourceProviderKind: order.sourceProviderKindSnapshot,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  async getSystemConfigs() {
    const configs = await this.prisma.systemConfig.findMany();
    return Object.fromEntries(configs.map((c) => [c.key, c.value]));
  }

  async upsertSystemConfig(key: string, value: string) {
    await this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    this.cache.memoDel("wac:config");
    // Side-effect: keep grok server's proxy.txt + in-memory list in sync with admin updates.
    // Fire-and-forget so the HTTP response doesn't wait on the grok server.
    if (key === "warranty.check.proxies") {
      void this.syncProxiesToGrokServer(value);
      void this.syncProxiesToVeoServer(value);
    }
    return { key, value };
  }

  async bulkUpsertSystemConfig(configs: Record<string, string>) {
    await this.prisma.$transaction(
      Object.entries(configs).map(([key, value]) =>
        this.prisma.systemConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    this.cache.memoDel("wac:config");
    if ("warranty.check.proxies" in configs) {
      void this.syncProxiesToGrokServer(configs["warranty.check.proxies"]);
      void this.syncProxiesToVeoServer(configs["warranty.check.proxies"]);
    }
    return this.getSystemConfigs();
  }

  /**
   * Test proxy list TRƯỚC khi lưu — forward sang grok server /admin/test-proxy (TCP + HTTP GET
   * x.ai qua proxy, kèm latency). Admin dán proxy vào ô → bấm Test → biết con nào sống/khỏe để
   * lọc. Chunk 50/request (giới hạn của grok server). Không sửa config — chỉ probe.
   */
  async testProxies(proxiesText: string, mode: "tcp" | "full" = "full") {
    const lines = String(proxiesText || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
    if (lines.length === 0) {
      return { ok: false, error: "Chưa có proxy nào", summary: { total: 0, alive: 0, dead: 0 }, results: [] };
    }
    // Default to the local grok server (same fallback the worker uses in account-check.ts) so the
    // admin proxy test works out-of-the-box even when CHECK_GROK_URL isn't explicitly set in env.
    // Previously this had no default → it returned 0/N + "chưa set" (never probing the proxies)
    // whenever the API was started without that env var, which read as "all proxies dead".
    const grokUrl = (process.env.CHECK_GROK_URL || "http://127.0.0.1:4001").replace(/\/+$/, "");
    const headers: Record<string, string> = {};
    if (process.env.CHECK_GROK_API_KEY) headers["X-API-Key"] = process.env.CHECK_GROK_API_KEY;

    const CHUNK = 50;
    const results: any[] = [];
    try {
      for (let i = 0; i < lines.length; i += CHUNK) {
        const batch = lines.slice(i, i + CHUNK);
        const res = await axios.post(
          `${grokUrl}/admin/test-proxy?mode=${mode === "tcp" ? "tcp" : "full"}`,
          { proxies: batch },
          { headers, timeout: 90_000 },
        );
        if (Array.isArray(res.data?.results)) results.push(...res.data.results);
      }
    } catch (err: any) {
      return {
        ok: false,
        error: `Test lỗi (grok server): ${err?.message ?? err}`,
        summary: { total: lines.length, alive: results.filter((r) => r.ok).length, dead: 0 },
        results,
      };
    }
    const alive = results.filter((r) => r.ok).length;
    return { ok: true, mode, summary: { total: results.length, alive, dead: results.length - alive }, results };
  }
}
