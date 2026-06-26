import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from "@nestjs/common";
import {
  DownstreamSourceConnectionStatus,
  Prisma,
} from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

import { PrismaService } from "../db/prisma.service";

import { InternalSourceApiKeyService } from "./internal-source-api-key.service";

export type ResolvedInternalSourceKey = Prisma.InternalSourceApiKeyGetPayload<{
  include: {
    connection: {
      include: {
        upstreamSeller: true;
        upstreamShop: true;
        downstreamSeller: true;
        downstreamShop: true;
      };
    };
  };
}>;

export type ActiveInternalSourceConnection = NonNullable<ResolvedInternalSourceKey["connection"]>;

export interface InternalSourceContext {
  apiKey: ResolvedInternalSourceKey;
  connection: ActiveInternalSourceConnection | null;
}

declare module "express" {
  interface Request {
    internalSourceContext?: InternalSourceContext;
  }
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class InternalSourceAuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(InternalSourceApiKeyService)
    private readonly apiKeyService: InternalSourceApiKeyService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const rawKey = String(req.headers["x-source-api-key"] || "").trim();

    if (!rawKey) {
      throw new UnauthorizedException("X-Source-Api-Key header is required.");
    }

    const apiKey = await this.apiKeyService.validateKey(rawKey);

    // Canboso-style parity: a key issued to a bot customer (carries a telegramChatId)
    // auto-binds to a connection on first use, pointing at the customer's own wallet
    // in the upstream shop — no downstream shop/dashboard needed. Keys with no
    // telegramChatId (e.g. legacy dashboard keys) keep the explicit connect() flow.
    let connection = apiKey.connection ?? null;
    if (!connection) {
      connection = await this.ensureCustomerBoundConnection(apiKey);
    }

    // A connection that exists must be ACTIVE for any request (read or write).
    if (connection && connection.status !== DownstreamSourceConnectionStatus.ACTIVE) {
      throw new ForbiddenException("Downstream source connection is not active.");
    }

    // Read-only requests (GET catalog/balance) are fully serviceable from the key
    // alone (apiKey.shopId is the upstream shop). Only writes (placing orders) need
    // a funded downstream connection, because they debit a customer wallet.
    const isWriteRequest = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    if (isWriteRequest) {
      if (!connection) {
        throw new ForbiddenException("Source API key has no downstream connection assigned.");
      }

      let walletBalance = 0;
      if (connection.downstreamTelegramChatId) {
        const wallet = await this.prisma.customerWallet.findFirst({
          where: {
            customer: {
              shopId: connection.upstreamShopId,
              telegramChatId: connection.downstreamTelegramChatId,
            },
          },
          // Spendable = cash balance + commission. The order debit (splitWalletDebit)
          // spends commission FIRST, so the gate must count it too or it wrongly
          // blocks commission-funded (CTV) buyers who can actually pay.
          select: { balance: true, commissionBalance: true },
        });
        walletBalance = wallet ? Number(wallet.balance) + Number(wallet.commissionBalance) : 0;
      }
      if (walletBalance <= 0) {
        throw new ForbiddenException(
          "Số dư kết nối bằng 0. Vui lòng nạp tiền vào bot nguồn PRO trước khi đặt hàng.",
        );
      }
    }

    const now = Date.now();
    const bucket = rateLimitStore.get(apiKey.id);

    if (!bucket || now >= bucket.resetAt) {
      rateLimitStore.set(apiKey.id, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    } else {
      bucket.count += 1;
      if (bucket.count > RATE_LIMIT_MAX) {
        throw new HttpException("Rate limit exceeded. Max 60 requests per minute.", 429);
      }
    }

    req.internalSourceContext = {
      apiKey,
      connection,
    };

    this.prisma.internalSourceAccessLog
      .create({
        data: {
          apiKeyId: apiKey.id,
          connectionId: connection?.id ?? null,
          method: req.method,
          path: req.originalUrl || req.url,
          statusCode: 200,
          ipAddress: req.ip || null,
          requestBodyJson: null as unknown as Prisma.InputJsonValue,
          responseBodyJson: null as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});

    next();
  }

  /**
   * Lazily create a customer-bound (canboso-style) connection for a key that has a
   * telegramChatId but no connection yet. Downstream seller/shop are null — the buyer
   * is a bot customer whose prepaid wallet lives in the upstream shop, keyed by
   * downstreamTelegramChatId. Idempotent via the unique apiKeyId; race-safe.
   */
  private async ensureCustomerBoundConnection(
    apiKey: ResolvedInternalSourceKey,
  ): Promise<ActiveInternalSourceConnection | null> {
    if (!apiKey.telegramChatId) {
      return null;
    }

    const include = {
      upstreamSeller: true,
      upstreamShop: true,
      downstreamSeller: true,
      downstreamShop: true,
    } as const;

    const existing = await this.prisma.downstreamSourceConnection.findUnique({
      where: { apiKeyId: apiKey.id },
      include,
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.downstreamSourceConnection.create({
        data: {
          upstreamSellerId: apiKey.sellerId,
          upstreamShopId: apiKey.shopId,
          downstreamSellerId: null,
          downstreamShopId: null,
          apiKeyId: apiKey.id,
          downstreamTelegramChatId: apiKey.telegramChatId,
          status: DownstreamSourceConnectionStatus.ACTIVE,
          currency: "VND",
          label: "Customer-bound (bot wallet)",
        },
        include,
      });
    } catch {
      // Concurrent first-use request already created it — re-read and use that row.
      return this.prisma.downstreamSourceConnection.findUnique({
        where: { apiKeyId: apiKey.id },
        include,
      });
    }
  }
}
