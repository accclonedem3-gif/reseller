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
  connection: ActiveInternalSourceConnection;
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

    if (!apiKey.connection) {
      throw new ForbiddenException("Source API key has no downstream connection assigned.");
    }

    if (apiKey.connection.status !== DownstreamSourceConnectionStatus.ACTIVE) {
      throw new ForbiddenException("Downstream source connection is not active.");
    }

    const isWriteRequest = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    if (isWriteRequest) {
      let walletBalance = 0;
      if (apiKey.connection.downstreamTelegramChatId) {
        const wallet = await this.prisma.customerWallet.findFirst({
          where: {
            customer: {
              shopId: apiKey.connection.upstreamShopId,
              telegramChatId: apiKey.connection.downstreamTelegramChatId,
            },
          },
          select: { balance: true },
        });
        walletBalance = wallet ? Number(wallet.balance) : 0;
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
      connection: apiKey.connection as ActiveInternalSourceConnection,
    };

    this.prisma.internalSourceAccessLog
      .create({
        data: {
          apiKeyId: apiKey.id,
          connectionId: apiKey.connection.id,
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
}
