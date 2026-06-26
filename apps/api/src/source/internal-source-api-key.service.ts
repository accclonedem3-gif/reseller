import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DownstreamSourceConnectionStatus,
  InternalSourceApiKeyStatus,
  Prisma,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { decimalToNumber } from "../lib/utils";
import { encryptSecret, decryptSecret } from "@reseller/shared/server";

export interface IssueKeyDto {
  label: string;
  note?: string;
  expiresAt?: string | null;
  telegramChatId?: string;
}

@Injectable()
export class InternalSourceApiKeyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async issueKey(sellerId: string, shopId: string, dto: IssueKeyDto) {
    const rawKey = `isk_${randomBytes(24).toString("hex")}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = await bcrypt.hash(rawKey, 10);
    const keyEncrypted = encryptSecret(rawKey, this.config.encryptionKey);

    const created = await this.prisma.internalSourceApiKey.create({
      data: {
        sellerId,
        shopId,
        label: dto.label.trim(),
        note: dto.note?.trim() || null,
        keyPrefix,
        keyHash,
        keyEncrypted,
        telegramChatId: dto.telegramChatId || null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return {
      id: created.id,
      label: created.label,
      note: created.note,
      key: rawKey,
      keyPrefix: created.keyPrefix,
      status: created.status,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
    };
  }

  decryptKey(keyEncrypted: string): string {
    return decryptSecret(keyEncrypted, this.config.encryptionKey);
  }

  async revokeKey(keyId: string, sellerId: string) {
    const key = await this.prisma.internalSourceApiKey.findFirst({
      where: { id: keyId, sellerId },
      include: { connection: true },
    });

    if (!key) {
      throw new NotFoundException("Source API key not found.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.internalSourceApiKey.update({
        where: { id: key.id },
        data: {
          status: InternalSourceApiKeyStatus.REVOKED,
          revokedAt: new Date(),
        },
      });

      if (key.connection) {
        await tx.downstreamSourceConnection.update({
          where: { id: key.connection.id },
          data: { status: DownstreamSourceConnectionStatus.REVOKED },
        });

        await tx.providerConfig.updateMany({
          where: { internalSourceConnectionId: key.connection.id },
          data: { connectionStatus: "DISABLED" },
        });
      }
    });

    return { success: true, id: key.id };
  }

  async getActiveKeyForTelegramChatId(shopId: string, telegramChatId: string) {
    return this.prisma.internalSourceApiKey.findFirst({
      where: {
        shopId,
        status: InternalSourceApiKeyStatus.ACTIVE,
        telegramChatId,
        keyEncrypted: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeAllBotKeysForChatId(shopId: string, telegramChatId: string) {
    await this.prisma.internalSourceApiKey.updateMany({
      where: {
        shopId,
        telegramChatId,
        status: InternalSourceApiKeyStatus.ACTIVE,
      },
      data: {
        status: InternalSourceApiKeyStatus.REVOKED,
        revokedAt: new Date(),
      },
    });
  }

  async listKeys(sellerId: string) {
    const keys = await this.prisma.internalSourceApiKey.findMany({
      where: { sellerId },
      include: {
        connection: {
          include: {
            downstreamSeller: true,
            downstreamShop: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const walletBalanceMap = new Map<string, number>();
    for (const key of keys) {
      if (key.connection?.downstreamTelegramChatId) {
        const wallet = await this.prisma.customerWallet.findFirst({
          where: {
            customer: {
              shopId: key.connection.upstreamShopId,
              telegramChatId: key.connection.downstreamTelegramChatId,
            },
          },
          select: { balance: true },
        });
        walletBalanceMap.set(key.connection.id, wallet ? decimalToNumber(wallet.balance) : 0);
      }
    }

    return keys.map((key) => ({
      id: key.id,
      label: key.label,
      note: key.note,
      keyPrefix: key.keyPrefix,
      status: key.status,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
      connection: key.connection
        ? {
            id: key.connection.id,
            status: key.connection.status,
            downstreamSellerId: key.connection.downstreamSellerId,
            downstreamSellerName: key.connection.downstreamSeller?.displayName ?? null,
            downstreamShopId: key.connection.downstreamShopId,
            downstreamShopName: key.connection.downstreamShop?.name ?? null,
            balance: walletBalanceMap.get(key.connection.id) ?? 0,
            currency: key.connection.currency,
          }
        : null,
    }));
  }

  async validateKey(rawKey: string) {
    const normalized = String(rawKey || "").trim();

    if (!normalized) {
      throw new ForbiddenException("Source API key is missing.");
    }

    const keyPrefix = normalized.slice(0, 12);

    const candidates = await this.prisma.internalSourceApiKey.findMany({
      where: { keyPrefix },
      include: {
        connection: {
          include: {
            upstreamSeller: true,
            upstreamShop: true,
            downstreamSeller: true,
            downstreamShop: true,
          },
        },
      },
    });

    let matched: (typeof candidates)[number] | null = null;

    for (const candidate of candidates) {
      if (await bcrypt.compare(normalized, candidate.keyHash)) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      throw new ForbiddenException("Source API key is invalid.");
    }

    if (matched.status !== InternalSourceApiKeyStatus.ACTIVE) {
      throw new ForbiddenException("Source API key is no longer active.");
    }

    if (matched.expiresAt && matched.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException("Source API key has expired.");
    }

    await this.prisma.internalSourceApiKey.update({
      where: { id: matched.id },
      data: { lastUsedAt: new Date() },
    });

    return matched as Prisma.InternalSourceApiKeyGetPayload<{
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
  }
}
