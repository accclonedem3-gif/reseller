import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import {
  DownstreamSourceConnectionStatus,
  InternalSourceApiKeyStatus,
  InternalSourceLedgerType,
  InternalSourceOrderStatus,
  Prisma,
  ProviderKind,
  SellerTier,
  WalletLedgerType,
} from "@prisma/client";
import {
  decryptSecret,
  encryptSecret,
  isOrderPriceSafe,
  purchaseFromProvider,
} from "@reseller/shared/server";
import { randomBytes } from "node:crypto";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import {
  hasValidCustomerEmailList,
  parseCustomerEmailList,
} from "../lib/customer-email-list";
import {
  decimalToNumber,
  generateSourceOrderCode,
  hashValue,
  splitWalletDebit,
  toDecimal,
} from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import { StockAlertService } from "../source/stock-alert.service";
import type { AuthenticatedUser } from "../types";

import type {
  AdjustConnectionBalanceDto,
  ConnectInternalSourceDto,
  CreateInternalSourceApiKeyDto,
  DeliverInternalSourceOrderDto,
  FailInternalSourceOrderDto,
  InternalBuyerPurchaseDto,
  TopUpInternalSourceConnectionDto,
} from "./internal-source.dto";

type ResolvedSourceKey = Prisma.InternalSourceApiKeyGetPayload<{
  include: {
    seller: true;
    shop: true;
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

type PublishedSourceProduct = Prisma.SourceProductGetPayload<{
  include: {
    overrides: true;
  };
}>;

@Injectable()
export class InternalSourceService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(StockAlertService)
    private readonly stockAlertService: StockAlertService,
  ) {}

  async listApiKeys(user: AuthenticatedUser) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const keys = await this.prisma.internalSourceApiKey.findMany({
      where: {
        sellerId: shop.sellerId,
      },
      include: {
        connection: {
          include: {
            downstreamSeller: true,
            downstreamShop: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
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
        walletBalanceMap.set(
          key.connection.id,
          wallet ? decimalToNumber(wallet.balance) : 0,
        );
      }
    }

    return keys.map((key) => ({
      id: key.id,
      label: key.label,
      note: key.note,
      keyPrefix: key.keyPrefix,
      status: key.status.toLowerCase(),
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
      connection: key.connection
        ? {
            id: key.connection.id,
            status: key.connection.status.toLowerCase(),
            downstreamSellerId: key.connection.downstreamSellerId,
            downstreamSellerName:
              key.connection.downstreamSeller?.displayName ?? null,
            downstreamShopId: key.connection.downstreamShopId,
            downstreamShopName: key.connection.downstreamShop?.name ?? null,
            balance: walletBalanceMap.get(key.connection.id) ?? 0,
            currency: key.connection.currency,
          }
        : null,
    }));
  }

  async createApiKey(
    user: AuthenticatedUser,
    dto: CreateInternalSourceApiKeyDto,
  ) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const rawKey = `isk_${randomBytes(24).toString("hex")}`;

    const created = await this.prisma.internalSourceApiKey.create({
      data: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        label: dto.label.trim(),
        note: dto.note?.trim() || null,
        keyPrefix: rawKey.slice(0, 12),
        keyHash: await bcrypt.hash(rawKey, 10),
        keyEncrypted: encryptSecret(rawKey, this.config.encryptionKey),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return {
      id: created.id,
      label: created.label,
      key: rawKey,
      keyPrefix: created.keyPrefix,
      expiresAt: created.expiresAt,
      buyerApiBaseUrl: this.getInternalBuyerBaseUrl(),
      status: created.status.toLowerCase(),
      createdAt: created.createdAt,
    };
  }

  async revokeApiKey(user: AuthenticatedUser, id: string) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const key = await this.prisma.internalSourceApiKey.findFirst({
      where: {
        id,
        sellerId: shop.sellerId,
      },
      include: {
        connection: true,
      },
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
          data: {
            status: DownstreamSourceConnectionStatus.DISABLED,
          },
        });

        await tx.providerConfig.updateMany({
          where: {
            internalSourceConnectionId: key.connection.id,
          },
          data: {
            connectionStatus: "DISABLED",
          },
        });
      }
    });

    return {
      success: true,
      id: key.id,
    };
  }

  async getCurrentConnection(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const providerConfig = await this.prisma.providerConfig.findUnique({
      where: { shopId: shop.id },
      select: { internalSourceConnectionId: true },
    });
    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: {
        downstreamShopId: shop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
        ...(providerConfig?.internalSourceConnectionId
          ? { id: providerConfig.internalSourceConnectionId }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        apiKey: true,
        upstreamSeller: true,
        upstreamShop: { include: { botConfig: true } },
        downstreamSeller: true,
        downstreamShop: true,
      },
    });

    if (!connection) {
      return null;
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
        select: { balance: true },
      });
      if (wallet) walletBalance = decimalToNumber(wallet.balance);
    }

    return this.mapConnection(connection, walletBalance);
  }

  async listCurrentShopConnections(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const connections = await this.prisma.downstreamSourceConnection.findMany({
      where: {
        downstreamShopId: shop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      orderBy: { createdAt: "asc" },
      include: {
        apiKey: true,
        upstreamSeller: true,
        upstreamShop: { include: { botConfig: true } },
        downstreamSeller: true,
        downstreamShop: true,
        _count: { select: { catalogProducts: true } },
      },
    });

    return Promise.all(
      connections.map(async (connection) => {
        let walletBalance = 0;
        if (connection.downstreamTelegramChatId) {
          const wallet = await this.prisma.customerWallet.findFirst({
            where: {
              customer: {
                shopId: connection.upstreamShopId,
                telegramChatId: connection.downstreamTelegramChatId,
              },
            },
            select: { balance: true },
          });
          if (wallet) walletBalance = decimalToNumber(wallet.balance);
        }
        return {
          ...this.mapConnection(connection, walletBalance),
          productCount: connection._count.catalogProducts,
        };
      }),
    );
  }

  async listCurrentConnectionOrders(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const orders = await this.prisma.internalSourceOrder.findMany({
      where: { downstreamShopId: shop.id },
      include: {
        connection: true,
        downstreamSeller: true,
        downstreamShop: true,
        sourceProduct: true,
        downstreamOrder: { include: { customer: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return orders.map((order) => this.mapSourceOrder(order));
  }

  async setInheritTemplate(user: AuthenticatedUser, enabled: boolean) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const result = await this.prisma.downstreamSourceConnection.updateMany({
      where: {
        downstreamShopId: shop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      data: { inheritSourceTemplate: enabled },
    });
    if (result.count === 0) {
      throw new NotFoundException("No active source connection.");
    }
    return { ok: true, inheritSourceTemplate: enabled };
  }

  /** Save PRO's per-connection overrides (custom category names/order/hide + product order). */
  async setTemplateOverrides(user: AuthenticatedUser, overrides: unknown) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const clean =
      overrides && typeof overrides === "object" && !Array.isArray(overrides)
        ? overrides
        : {};
    const result = await this.prisma.downstreamSourceConnection.updateMany({
      where: {
        downstreamShopId: shop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      data: { templateOverridesJson: clean as Prisma.InputJsonValue },
    });
    if (result.count === 0) {
      throw new NotFoundException("No active source connection.");
    }
    return { ok: true };
  }

  /**
   * Drop every premium custom-emoji-id field from a bot customizationJson so a NON-premium bot
   * shows the plain text labels/emojis instead of invisible premium icons. Keeps the text
   * counterparts (buttonEmojis, labelEmojis, buttonLabels, welcomeMessage, ...).
   */
  private stripPremiumEmojiIds(json: unknown): Record<string, unknown> {
    if (!json || typeof json !== "object" || Array.isArray(json)) return {};
    const c = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
    delete c.buttonEmojiIds;
    delete c.labelEmojiIds;
    delete c.messageEmojiIds;
    delete c.outOfStockEmojiId;
    const fam = c.productDefaultsByFamily;
    if (fam && typeof fam === "object" && !Array.isArray(fam)) {
      for (const v of Object.values(fam as Record<string, unknown>)) {
        if (v && typeof v === "object")
          (v as Record<string, unknown>).customEmojiId = null;
      }
    }
    return c;
  }

  /**
   * "Đồng bộ giao diện bot": one-press CLONE of the upstream ULTRA source's bot interface into the
   * PRO shop's OWN data. ADDS the ULTRA's catalog categories (skips names the PRO already has),
   * maps the PRO's synced products into them, and MERGES the ULTRA's bot customization over the
   * PRO's — STRIPPING every premium custom-emoji id (the ULTRA is premium; those don't render for
   * the PRO's customers, so categories/buttons fall back to text icons). Turns off live-inherit so
   * the PRO then renders its own materialised data.
   */
  async cloneBotInterfaceFromUpstream(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const conn = await this.prisma.downstreamSourceConnection.findFirst({
      where: {
        downstreamShopId: shop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      select: { id: true, upstreamShopId: true },
    });
    if (!conn) {
      throw new NotFoundException("No active source connection.");
    }

    const [
      upstreamGroups,
      upstreamOverrides,
      proGroups,
      proProducts,
      upstreamBc,
      proBc,
    ] = await Promise.all([
      this.prisma.shopCatalogGroup.findMany({
        where: { shopId: conn.upstreamShopId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.sellerProductOverride.findMany({
        where: { shopId: conn.upstreamShopId },
        select: { sourceProductId: true, groupId: true },
      }),
      this.prisma.shopCatalogGroup.findMany({
        where: { shopId: shop.id },
        select: { id: true, name: true },
      }),
      this.prisma.sourceProduct.findMany({
        where: { shopId: shop.id },
        select: { id: true, externalProductId: true },
      }),
      this.prisma.botConfig.findUnique({
        where: { shopId: conn.upstreamShopId },
        select: { customizationJson: true },
      }),
      this.prisma.botConfig.findUnique({
        where: { shopId: shop.id },
        select: { customizationJson: true },
      }),
    ]);

    // ULTRA product → group layout. Keyed by the ULTRA SourceProduct id, which equals the PRO
    // product's externalProductId (set by syncCatalog).
    const layout = new Map<string, string | null>();
    for (const o of upstreamOverrides) layout.set(o.sourceProductId, o.groupId);

    // MERGE: ULTRA customization (cusids stripped) wins per-key; keep PRO-only keys.
    const strippedUpstreamCust = this.stripPremiumEmojiIds(
      upstreamBc?.customizationJson,
    );
    const existingProCust =
      proBc?.customizationJson &&
      typeof proBc.customizationJson === "object" &&
      !Array.isArray(proBc.customizationJson)
        ? (proBc.customizationJson as Record<string, unknown>)
        : {};
    const mergedCust = { ...existingProCust, ...strippedUpstreamCust };

    let groupsCloned = 0;
    let productsMapped = 0;
    await this.prisma.$transaction(async (tx) => {
      // ADD clone: create ULTRA groups the PRO doesn't already have (match by name), build
      // oldUpstreamGroupId -> proGroupId so products can be mapped to existing OR new groups.
      const idMap = new Map<string, string>();
      const proByName = new Map<string, string>();
      for (const g of proGroups)
        proByName.set(g.name.trim().toLowerCase(), g.id);
      let nextPos = proGroups.length;
      for (const g of upstreamGroups) {
        const key = g.name.trim().toLowerCase();
        const existingId = proByName.get(key);
        if (existingId) {
          idMap.set(g.id, existingId);
          continue;
        }
        const created = await tx.shopCatalogGroup.create({
          data: {
            shopId: shop.id,
            name: g.name,
            description: g.description,
            // Don't copy the ULTRA's stored icon (often a text word/label, not an emoji) — the bot
            // always shows 📁 for categories anyway.
            icon: "📁",
            position: nextPos++,
            iconCustomEmojiId: null,
          },
        });
        idMap.set(g.id, created.id);
        proByName.set(key, created.id);
        groupsCloned++;
      }

      // Map PRO products into the cloned/matched groups (grouped updateMany).
      const byGroup = new Map<string, string[]>();
      for (const p of proProducts) {
        const upstreamGroupId = layout.get(p.externalProductId) ?? null;
        const proGroupId = upstreamGroupId
          ? idMap.get(upstreamGroupId)
          : undefined;
        if (!proGroupId) continue;
        const arr = byGroup.get(proGroupId) ?? [];
        arr.push(p.id);
        byGroup.set(proGroupId, arr);
      }
      for (const [groupId, ids] of byGroup) {
        const res = await tx.sellerProductOverride.updateMany({
          where: {
            shopId: shop.id,
            sellerId: shop.sellerId,
            sourceProductId: { in: ids },
          },
          data: { groupId },
        });
        productsMapped += res.count;
      }

      // MERGE the (stripped) ULTRA customization onto the PRO's own bot config.
      if (upstreamBc?.customizationJson) {
        await tx.botConfig.updateMany({
          where: { shopId: shop.id },
          data: { customizationJson: mergedCust as Prisma.InputJsonValue },
        });
      }

      // Materialised now → stop live-inherit so the PRO renders its OWN data.
      await tx.downstreamSourceConnection.update({
        where: { id: conn.id },
        data: {
          inheritSourceTemplate: false,
          templateOverridesJson: Prisma.DbNull,
        },
      });
    });

    return { ok: true, groupsCloned, productsMapped };
  }

  /** Structure for the override editor: ULTRA categories + the PRO's (effective) products + saved overrides. */
  async getInheritedStructure(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const conn = await this.prisma.downstreamSourceConnection.findFirst({
      where: {
        downstreamShopId: shop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      select: { upstreamShopId: true, templateOverridesJson: true },
    });
    if (!conn) return { groups: [], products: [], overrides: {} };
    const groups = await this.prisma.shopCatalogGroup.findMany({
      where: { shopId: conn.upstreamShopId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    const products = await this.shopsService.getCatalogViewForShop(
      shop.id,
      false,
      true,
    );
    return {
      overrides:
        conn.templateOverridesJson &&
        typeof conn.templateOverridesJson === "object"
          ? conn.templateOverridesJson
          : {},
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        position: g.position,
        icon: g.icon,
      })),
      products: products
        .filter((p) => p.enabled && !p.hidden)
        .map((p) => ({
          id: p.id,
          name: p.displayName,
          groupId: p.groupId,
          position: p.position,
        })),
    };
  }

  async listDownstreamConnections(user: AuthenticatedUser) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const connections = await this.prisma.downstreamSourceConnection.findMany({
      where: {
        upstreamShopId: shop.id,
      },
      include: {
        apiKey: true,
        upstreamSeller: true,
        upstreamShop: { include: { botConfig: true } },
        downstreamSeller: true,
        downstreamShop: {
          include: { botConfig: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const chatIds = connections
      .map((c) => c.apiKey?.telegramChatId)
      .filter((id): id is string => !!id);

    const customers =
      chatIds.length > 0
        ? await this.prisma.customer.findMany({
            where: { shopId: shop.id, telegramChatId: { in: chatIds } },
            select: {
              telegramChatId: true,
              telegramUsername: true,
              firstName: true,
              lastName: true,
            },
          })
        : [];

    const customerByChatId = new Map(
      customers.map((c) => [c.telegramChatId, c]),
    );

    // Batch-fetch wallet balances for all connections
    const downstreamChatIds = connections
      .map((c) => c.downstreamTelegramChatId)
      .filter((id): id is string => !!id);

    const wallets =
      downstreamChatIds.length > 0
        ? await this.prisma.customerWallet.findMany({
            where: {
              customer: {
                shopId: shop.id,
                telegramChatId: { in: downstreamChatIds },
              },
            },
            include: { customer: { select: { telegramChatId: true } } },
          })
        : [];

    const walletByChatId = new Map(
      wallets.map((w) => [
        w.customer.telegramChatId,
        decimalToNumber(w.balance),
      ]),
    );

    return connections.map((connection) => {
      const customer = connection.apiKey?.telegramChatId
        ? customerByChatId.get(connection.apiKey.telegramChatId)
        : undefined;

      const walletBalance = connection.downstreamTelegramChatId
        ? (walletByChatId.get(connection.downstreamTelegramChatId) ?? 0)
        : 0;

      return {
        ...this.mapConnection(connection, walletBalance),
        downstreamSeller: connection.downstreamSeller
          ? {
              id: connection.downstreamSeller.id,
              displayName: connection.downstreamSeller.displayName,
              telegramUsername: customer?.telegramUsername ?? null,
            }
          : customer
            ? {
                id: `customer:${connection.apiKey?.telegramChatId}`,
                displayName:
                  [customer.firstName, customer.lastName]
                    .filter(Boolean)
                    .join(" ") ||
                  customer.telegramUsername ||
                  connection.label ||
                  "Bot customer",
                telegramUsername: customer.telegramUsername ?? null,
              }
            : null,
        downstreamShop: connection.downstreamShop
          ? {
              id: connection.downstreamShop.id,
              name: connection.downstreamShop.name,
              slug: connection.downstreamShop.slug,
              telegramBotUsername:
                connection.downstreamShop.botConfig?.telegramBotUsername ??
                null,
            }
          : null,
        clientName: connection.clientName,
        clientBotUsername: connection.clientBotUsername,
        clientConnectedAt: connection.clientConnectedAt,
      };
    });
  }

  async getConnectionLedger(user: AuthenticatedUser, connectionId: string) {
    const shop = await this.getProSellerShopOrThrow(user.id);

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: { id: connectionId, upstreamShopId: shop.id },
    });

    if (!connection) {
      throw new NotFoundException("Connection not found.");
    }

    const ledger = await this.prisma.internalSourceLedger.findMany({
      where: { connectionId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return ledger.map((entry) => ({
      id: entry.id,
      type: entry.type.toLowerCase(),
      amount: decimalToNumber(entry.amount),
      balanceBefore: decimalToNumber(entry.balanceBefore),
      balanceAfter: decimalToNumber(entry.balanceAfter),
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      note: entry.note,
      createdAt: entry.createdAt,
    }));
  }

  async manualAdjustConnectionBalance(
    user: AuthenticatedUser,
    connectionId: string,
    dto: AdjustConnectionBalanceDto,
  ) {
    const shop = await this.getProSellerShopOrThrow(user.id);

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: { id: connectionId, upstreamShopId: shop.id },
    });

    if (!connection) {
      throw new NotFoundException("Connection not found.");
    }

    if (!connection.downstreamTelegramChatId) {
      throw new BadRequestException(
        "Connection has no linked customer wallet to adjust.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: {
          shopId: connection.upstreamShopId,
          telegramChatId: connection.downstreamTelegramChatId!,
        },
        include: { wallet: true },
      });

      if (!customer) {
        throw new NotFoundException("Linked customer not found.");
      }

      let cWallet = customer.wallet;
      if (!cWallet) {
        cWallet = await tx.customerWallet.create({
          data: {
            customerId: customer.id,
            balance: toDecimal(0),
            balanceUsdt: toDecimal(0),
            currency: "VND",
          },
        });
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${cWallet.id} FOR UPDATE`,
      );

      const balanceBefore = decimalToNumber(cWallet.balance);
      let balanceAfter: number;
      let adjustAmount: number;

      if (dto.action === "topup") {
        adjustAmount = dto.amount;
        balanceAfter = balanceBefore + dto.amount;
      } else if (dto.action === "deduct") {
        adjustAmount = -dto.amount;
        balanceAfter = Math.max(0, balanceBefore - dto.amount);
      } else {
        adjustAmount = dto.amount - balanceBefore;
        balanceAfter = dto.amount;
      }

      await tx.customerWallet.update({
        where: { id: cWallet.id },
        data: { balance: toDecimal(balanceAfter) },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: customer.id,
          walletId: cWallet.id,
          type: adjustAmount >= 0 ? "TOPUP" : "SPEND_ORDER",
          amount: toDecimal(adjustAmount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "manual_adjust",
          referenceId: user.id,
          note: dto.note?.trim() || "Manual balance adjustment by source owner",
        },
      });

      await tx.internalSourceLedger.create({
        data: {
          connectionId: connection.id,
          type: InternalSourceLedgerType.ADJUST,
          amount: toDecimal(adjustAmount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "manual_adjust",
          referenceId: user.id,
          note: dto.note?.trim() || "Manual balance adjustment by source owner",
        },
      });
    });

    return this.getCurrentConnectionById(connection.id);
  }

  async listSourceOrders(user: AuthenticatedUser, status?: string) {
    const shop = await this.getProSellerShopOrThrow(user.id);
    const orders = await this.prisma.internalSourceOrder.findMany({
      where: {
        upstreamShopId: shop.id,
        status: status
          ? (String(status || "")
              .trim()
              .toUpperCase() as InternalSourceOrderStatus)
          : undefined,
      },
      include: {
        connection: true,
        downstreamSeller: true,
        downstreamShop: true,
        sourceProduct: true,
        downstreamOrder: {
          include: { customer: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    const customerChatIds = Array.from(
      new Set(
        orders
          .filter((order) => !order.downstreamOrder)
          .map((order) => order.connection.downstreamTelegramChatId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const directCustomers =
      customerChatIds.length > 0
        ? await this.prisma.customer.findMany({
            where: { shopId: shop.id, telegramChatId: { in: customerChatIds } },
            select: {
              telegramChatId: true,
              telegramUsername: true,
              telegramUserId: true,
              firstName: true,
              lastName: true,
            },
          })
        : [];
    const directCustomerByChatId = new Map(
      directCustomers.map((customer) => [customer.telegramChatId, customer]),
    );

    return orders.map((order) =>
      this.mapSourceOrder(
        order,
        order.connection.downstreamTelegramChatId
          ? directCustomerByChatId.get(
              order.connection.downstreamTelegramChatId,
            )
          : undefined,
      ),
    );
  }

  async connectDownstreamShop(
    user: AuthenticatedUser,
    dto: ConnectInternalSourceDto,
  ) {
    const downstreamShop = await this.shopsService.getSellerShop(user.id);
    const resolvedKey = await this.resolveApiKey(dto.apiKey);

    if (
      resolvedKey.seller.tier !== SellerTier.PRO &&
      resolvedKey.seller.tier !== SellerTier.ULTRA
    ) {
      throw new ForbiddenException(
        "Only PRO sellers can publish internal source keys.",
      );
    }

    if (resolvedKey.status !== InternalSourceApiKeyStatus.ACTIVE) {
      throw new ForbiddenException("Source API key is no longer active.");
    }
    if (
      resolvedKey.expiresAt &&
      resolvedKey.expiresAt.getTime() <= Date.now()
    ) {
      throw new ForbiddenException("Source API key has expired.");
    }

    if (
      resolvedKey.connection &&
      resolvedKey.connection.downstreamShopId == null
    ) {
      throw new BadRequestException(
        "This key is bound to a bot wallet (customer source key) and cannot be used as a dashboard shop connection.",
      );
    }

    if (
      resolvedKey.connection &&
      resolvedKey.connection.downstreamShopId !== downstreamShop.id
    ) {
      throw new BadRequestException(
        "This source key is already assigned to another downstream shop.",
      );
    }

    if (resolvedKey.shop.id === downstreamShop.id) {
      throw new BadRequestException(
        "You cannot connect your shop to its own internal source key.",
      );
    }

    const connection = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.downstreamSourceConnection.findUnique({
        where: {
          upstreamShopId_downstreamShopId: {
            upstreamShopId: resolvedKey.shop.id,
            downstreamShopId: downstreamShop.id,
          },
        },
      });

      const nextConnection = existing
        ? await tx.downstreamSourceConnection.update({
            where: { id: existing.id },
            data: {
              apiKeyId: resolvedKey.id,
              status: DownstreamSourceConnectionStatus.ACTIVE,
            },
          })
        : await tx.downstreamSourceConnection.create({
            data: {
              upstreamSellerId: resolvedKey.sellerId,
              upstreamShopId: resolvedKey.shopId,
              downstreamSellerId: downstreamShop.sellerId,
              downstreamShopId: downstreamShop.id,
              apiKeyId: resolvedKey.id,
              status: DownstreamSourceConnectionStatus.ACTIVE,
              currency: downstreamShop.defaultCurrency,
            },
          });

      await tx.internalSourceApiKey.update({
        where: { id: resolvedKey.id },
        data: {
          keyEncrypted: encryptSecret(
            dto.apiKey.trim(),
            this.config.encryptionKey,
          ),
        },
      });

      await tx.providerConfig.upsert({
        where: { shopId: downstreamShop.id },
        update: {
          providerKind: ProviderKind.INTERNAL,
          providerName: "internal_pro",
          baseUrl: this.getInternalBuyerBaseUrl(),
          buyerKeyEncrypted: encryptSecret(
            dto.apiKey.trim(),
            this.config.encryptionKey,
          ),
          internalSourceConnectionId: nextConnection.id,
          connectionStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
        },
        create: {
          shopId: downstreamShop.id,
          providerKind: ProviderKind.INTERNAL,
          providerName: "internal_pro",
          baseUrl: this.getInternalBuyerBaseUrl(),
          buyerKeyEncrypted: encryptSecret(
            dto.apiKey.trim(),
            this.config.encryptionKey,
          ),
          internalSourceConnectionId: nextConnection.id,
          sourceNotificationSyncEnabled: true,
          connectionStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
        },
      });

      return nextConnection;
    });

    return this.getCurrentConnectionById(connection.id);
  }

  async topUpCurrentConnection(
    user: AuthenticatedUser,
    dto: TopUpInternalSourceConnectionDto,
  ) {
    const downstreamShop = await this.shopsService.getSellerShop(user.id);
    const amount = Number(dto.amount);

    if (!Number.isInteger(amount) || amount < 1000) {
      throw new BadRequestException(
        "Top-up amount must be at least 1,000 VND.",
      );
    }

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: {
        downstreamShopId: downstreamShop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!connection) {
      throw new NotFoundException(
        "No internal source connection found for this shop.",
      );
    }

    return this.topUpConnectionByRecord(downstreamShop, connection, amount);
  }

  async topUpConnection(
    user: AuthenticatedUser,
    connectionId: string,
    dto: TopUpInternalSourceConnectionDto,
  ) {
    const downstreamShop = await this.shopsService.getSellerShop(user.id);
    const amount = Number(dto.amount);
    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: {
        id: connectionId,
        downstreamShopId: downstreamShop.id,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
    });
    if (!connection) {
      throw new NotFoundException("Internal source connection not found.");
    }
    return this.topUpConnectionByRecord(downstreamShop, connection, amount);
  }

  private async topUpConnectionByRecord(
    downstreamShop: Awaited<ReturnType<ShopsService["getSellerShop"]>>,
    connection: {
      id: string;
      upstreamShopId: string;
      downstreamTelegramChatId: string | null;
    },
    amount: number,
  ) {
    if (!Number.isInteger(amount) || amount < 1000) {
      throw new BadRequestException(
        "Top-up amount must be at least 1,000 VND.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.sellerWallet.findUnique({
        where: {
          sellerId: downstreamShop.sellerId,
        },
      });

      if (!wallet) {
        throw new NotFoundException("Seller wallet not found.");
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM downstream_source_connections WHERE id = ${connection.id} FOR UPDATE`,
      );

      const balanceBeforeWallet = decimalToNumber(wallet.balance);

      if (balanceBeforeWallet < amount) {
        throw new BadRequestException(
          "Seller wallet balance is not enough for this source top-up.",
        );
      }

      const refreshedConnection =
        await tx.downstreamSourceConnection.findUnique({
          where: { id: connection.id },
        });

      if (!refreshedConnection) {
        throw new NotFoundException("Internal source connection not found.");
      }

      const walletBalanceAfter = balanceBeforeWallet - amount;

      await tx.sellerWallet.update({
        where: { id: wallet.id },
        data: {
          balance: toDecimal(walletBalanceAfter),
        },
      });

      await tx.walletLedger.create({
        data: {
          sellerId: downstreamShop.sellerId,
          walletId: wallet.id,
          type: WalletLedgerType.ADJUST,
          amount: toDecimal(amount * -1),
          balanceBefore: toDecimal(balanceBeforeWallet),
          balanceAfter: toDecimal(walletBalanceAfter),
          referenceType: "internal_source_connection",
          referenceId: connection.id,
          note: "Top up internal PRO source balance from seller wallet",
        },
      });

      // Credit customer wallet (source of truth)
      let customerWalletBefore = 0;
      let customerWalletAfter = 0;
      if (refreshedConnection.downstreamTelegramChatId) {
        const customer = await tx.customer.findFirst({
          where: {
            shopId: refreshedConnection.upstreamShopId,
            telegramChatId: refreshedConnection.downstreamTelegramChatId,
          },
          include: { wallet: true },
        });
        if (customer) {
          let cWallet = customer.wallet;
          if (!cWallet) {
            cWallet = await tx.customerWallet.create({
              data: {
                customerId: customer.id,
                balance: toDecimal(0),
                balanceUsdt: toDecimal(0),
                currency: "VND",
              },
            });
          }
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${cWallet.id} FOR UPDATE`,
          );
          customerWalletBefore = decimalToNumber(cWallet.balance);
          customerWalletAfter = customerWalletBefore + amount;
          await tx.customerWallet.update({
            where: { id: cWallet.id },
            data: { balance: toDecimal(customerWalletAfter) },
          });
          await tx.customerWalletLedger.create({
            data: {
              customerId: customer.id,
              walletId: cWallet.id,
              type: "TOPUP",
              amount: toDecimal(amount),
              balanceBefore: toDecimal(customerWalletBefore),
              balanceAfter: toDecimal(customerWalletAfter),
              referenceType: "seller_wallet",
              referenceId: wallet.id,
              note: "Nạp ví từ seller wallet (bot nguồn PRO)",
            },
          });
        }
      }

      await tx.downstreamSourceConnection.update({
        where: { id: connection.id },
        data: {
          status: DownstreamSourceConnectionStatus.ACTIVE,
        },
      });

      await tx.internalSourceLedger.create({
        data: {
          connectionId: connection.id,
          type: InternalSourceLedgerType.TOPUP,
          amount: toDecimal(amount),
          balanceBefore: toDecimal(customerWalletBefore),
          balanceAfter: toDecimal(customerWalletAfter),
          referenceType: "seller_wallet",
          referenceId: wallet.id,
          note: "Top up from downstream seller wallet",
        },
      });
    });

    return this.getCurrentConnectionById(connection.id);
  }

  async disconnectConnection(user: AuthenticatedUser, connectionId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: { id: connectionId, downstreamShopId: shop.id },
    });
    if (!connection) {
      throw new NotFoundException("Internal source connection not found.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const products = await tx.sourceProduct.findMany({
        where: {
          shopId: shop.id,
          providerName: { notIn: ["manual", "pro_source", "disconnected_archive"] },
        },
        select: {
          id: true,
          _count: { select: { orders: true, internalSourceOrders: true } },
        },
      });
      const deletableIds = products
        .filter(
          (product) =>
            product._count.orders === 0 &&
            product._count.internalSourceOrders === 0,
        )
        .map((product) => product.id);
      const archivedIds = products
        .filter(
          (product) =>
            product._count.orders > 0 ||
            product._count.internalSourceOrders > 0,
        )
        .map((product) => product.id);

      if (deletableIds.length > 0) {
        await tx.sourceProduct.deleteMany({
          where: { id: { in: deletableIds } },
        });
      }
      if (archivedIds.length > 0) {
        await tx.sourceProduct.updateMany({
          where: { id: { in: archivedIds } },
          data: {
            providerName: "disconnected_archive",
            available: 0,
            internalSourceEnabled: false,
          },
        });
      }

      await tx.downstreamSourceConnection.update({
        where: { id: connection.id },
        data: { status: DownstreamSourceConnectionStatus.DISABLED },
      });

      const replacement = await tx.downstreamSourceConnection.findFirst({
        where: {
          downstreamShopId: shop.id,
          status: DownstreamSourceConnectionStatus.ACTIVE,
          id: { not: connection.id },
        },
        orderBy: { createdAt: "desc" },
        include: { apiKey: { select: { keyEncrypted: true } } },
      });
      const provider = await tx.providerConfig.findUnique({
        where: { shopId: shop.id },
        select: { internalSourceConnectionId: true },
      });
      if (provider?.internalSourceConnectionId === connection.id) {
        await tx.providerConfig.update({
          where: { shopId: shop.id },
          data: replacement
            ? {
                providerKind: ProviderKind.INTERNAL,
                providerName: "internal_pro",
                internalSourceConnectionId: replacement.id,
                ...(replacement.apiKey?.keyEncrypted
                  ? { buyerKeyEncrypted: replacement.apiKey.keyEncrypted }
                  : {}),
                connectionStatus: "VERIFIED",
                lastVerifiedAt: new Date(),
              }
            : {
                internalSourceConnectionId: null,
                connectionStatus: "DISABLED",
                lastVerifiedAt: null,
              },
        });
      }

      return {
        deletedProducts: deletableIds.length,
        archivedProducts: archivedIds.length,
        activeConnections: replacement ? 1 : 0,
      };
    });

    const activeConnections =
      await this.prisma.downstreamSourceConnection.count({
        where: {
          downstreamShopId: shop.id,
          status: DownstreamSourceConnectionStatus.ACTIVE,
        },
      });
    return { ok: true, ...result, activeConnections, ordersPreserved: true };
  }

  async manualDeliverSourceOrder(
    user: AuthenticatedUser,
    id: string,
    dto: DeliverInternalSourceOrderDto,
  ) {
    const order = await this.getManagedSourceOrder(user.id, id);

    if (order.status === InternalSourceOrderStatus.DELIVERED) {
      throw new BadRequestException("Source order is already delivered.");
    }

    if (
      order.status === InternalSourceOrderStatus.FAILED ||
      order.status === InternalSourceOrderStatus.CANCELED
    ) {
      throw new BadRequestException("Source order is already closed.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.internalSourceOrder.update({
        where: { id: order.id },
        data: {
          status: InternalSourceOrderStatus.DELIVERED,
          deliveredAccountText: dto.deliveredAccountText.trim(),
          deliveredAt: new Date(),
          failureReason: null,
        },
      });

      await tx.internalSourceOrderEvent.create({
        data: {
          orderId: order.id,
          eventType: "manual_delivery_by_owner",
          payloadJson: {
            deliveredLength: dto.deliveredAccountText.trim().length,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return this.getSourceOrderById(id);
  }

  async markSourceOrderFailed(
    user: AuthenticatedUser,
    id: string,
    dto: FailInternalSourceOrderDto,
  ) {
    const order = await this.getManagedSourceOrder(user.id, id);

    if (order.status === InternalSourceOrderStatus.DELIVERED) {
      throw new BadRequestException(
        "Delivered source orders cannot be failed.",
      );
    }

    if (
      order.status === InternalSourceOrderStatus.FAILED ||
      order.status === InternalSourceOrderStatus.CANCELED
    ) {
      throw new BadRequestException("Source order is already closed.");
    }

    await this.failInternalSourceOrder(
      {
        id: order.id,
        connectionId: order.connectionId,
        totalAmount: order.totalAmount,
      },
      dto.reason.trim(),
      true,
    );

    return this.getSourceOrderById(id);
  }

  async listProductsByKey(
    rawKey: string,
    requestMeta?: {
      path?: string;
      method?: string;
      ipAddress?: string | null;
    },
  ) {
    const resolvedKey = await this.resolveApiKey(rawKey);
    const connection = this.assertApiKeyUsable(resolvedKey);
    const products = await this.prisma.sourceProduct.findMany({
      where: {
        shopId: connection.upstreamShopId,
        internalSourceEnabled: true,
        archivedAt: null,
        OR: [{ available: null }, { available: { gt: 0 } }],
        overrides: {
          some: {
            sellerId: connection.upstreamSellerId,
            enabled: true,
            groupId: { not: null },
          },
        },
      },
      include: {
        overrides: {
          where: {
            sellerId: connection.upstreamSellerId,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const customerDiscount = connection.downstreamTelegramChatId
      ? await this.prisma.customer
          .findFirst({
            where: {
              shopId: connection.upstreamShopId,
              telegramChatId: connection.downstreamTelegramChatId,
            },
            select: { discountPercent: true },
          })
          .then((c) => Number(c?.discountPercent ?? 0))
      : 0;

    const response = {
      success: true,
      products: products.map((product) =>
        this.mapPublishedProduct(
          product,
          connection.upstreamSellerId,
          customerDiscount,
        ),
      ),
    };

    await this.prisma.downstreamSourceConnection.update({
      where: { id: connection.id },
      data: {
        lastCatalogSyncAt: new Date(),
      },
    });

    await this.recordAccessLog(
      resolvedKey,
      requestMeta,
      200,
      undefined,
      response,
    );

    return response;
  }

  async getBalanceByKey(
    rawKey: string,
    requestMeta?: {
      path?: string;
      method?: string;
      ipAddress?: string | null;
    },
  ) {
    const resolvedKey = await this.resolveApiKey(rawKey);
    const connection = this.assertApiKeyUsable(resolvedKey);
    let walletBalance = 0;
    if (connection.downstreamTelegramChatId) {
      const wallet = await this.prisma.customerWallet.findFirst({
        where: {
          customer: {
            shopId: connection.upstreamShopId,
            telegramChatId: connection.downstreamTelegramChatId,
          },
        },
        select: { balance: true },
      });
      if (wallet) walletBalance = decimalToNumber(wallet.balance);
    }
    const response = {
      success: true,
      balance: walletBalance,
      balanceVnd: walletBalance,
      balanceUsd: null,
      balanceText: `${walletBalance} ${connection.currency}`,
      walletCurrency: connection.currency,
      usdtBalance: 0,
      updatedAt: connection.updatedAt.toISOString(),
      requester: {
        name:
          connection.downstreamSeller?.displayName ??
          connection.downstreamTelegramChatId ??
          "Khách",
        chatId: connection.id,
      },
      botSource: "internal_pro",
    };

    await this.recordAccessLog(
      resolvedKey,
      requestMeta,
      200,
      undefined,
      response,
    );

    return response;
  }

  async createOrderByKey(
    payload: InternalBuyerPurchaseDto,
    requestMeta?: {
      path?: string;
      method?: string;
      ipAddress?: string | null;
    },
  ) {
    const resolvedKey = await this.resolveApiKey(payload.key);
    const connection = this.assertApiKeyUsable(resolvedKey);
    const quantity = Number(payload.quantity);
    const product = await this.prisma.sourceProduct.findFirst({
      where: {
        id: payload.product_id,
        shopId: connection.upstreamShopId,
        internalSourceEnabled: true,
        archivedAt: null,
        overrides: {
          some: {
            sellerId: connection.upstreamSellerId,
            enabled: true,
            groupId: { not: null },
          },
        },
      },
      include: {
        overrides: {
          where: {
            sellerId: connection.upstreamSellerId,
          },
        },
      },
    });

    if (!product) {
      const errorResponse = {
        success: false,
        message: "Source product not found or not published.",
      };
      await this.recordAccessLog(
        resolvedKey,
        requestMeta,
        404,
        payload,
        errorResponse,
      );
      return errorResponse;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      const errorResponse = {
        success: false,
        message: "Quantity must be a positive integer.",
      };
      await this.recordAccessLog(
        resolvedKey,
        requestMeta,
        400,
        payload,
        errorResponse,
      );
      return errorResponse;
    }

    const parsedCustomerEmails = parseCustomerEmailList(payload.customer_email);
    const customerEmail = parsedCustomerEmails.emails.join("\n") || null;
    if (
      this.productRequiresCustomerEmail(product.metadataJson) &&
      (!hasValidCustomerEmailList(parsedCustomerEmails) ||
        parsedCustomerEmails.emails.length !== quantity)
    ) {
      const errorResponse = {
        success: false,
        message: "Enter one valid, unique customer email per purchased item.",
      };
      await this.recordAccessLog(
        resolvedKey,
        requestMeta,
        400,
        payload,
        errorResponse,
      );
      return errorResponse;
    }

    const fallbackOverridePrice = product.overrides?.[0]?.salePrice
      ? decimalToNumber(product.overrides[0].salePrice)
      : null;
    const unitPrice =
      product.internalSourcePrice != null
        ? decimalToNumber(product.internalSourcePrice)
        : (fallbackOverridePrice ?? 0);
    if (unitPrice <= 0) {
      const errorResponse = {
        success: false,
        message: "Source product has no wholesale or sale price configured.",
      };
      await this.recordAccessLog(
        resolvedKey,
        requestMeta,
        400,
        payload,
        errorResponse,
      );
      return errorResponse;
    }
    if (
      !isOrderPriceSafe({
        totalSaleAmount: unitPrice * quantity,
        totalSourceAmount: decimalToNumber(product.sourcePrice) * quantity,
      })
    ) {
      const errorResponse = {
        success: false,
        message:
          "Wholesale price after discount is below the current source cost.",
      };
      await this.recordAccessLog(
        resolvedKey,
        requestMeta,
        400,
        payload,
        errorResponse,
      );
      return errorResponse;
    }
    const totalAmount = unitPrice * quantity;
    let createdOrderId = "";

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (!connection.downstreamTelegramChatId) {
          throw new BadRequestException(
            "Connection has no linked customer wallet.",
          );
        }

        const customer = await tx.customer.findFirst({
          where: {
            shopId: connection.upstreamShopId,
            telegramChatId: connection.downstreamTelegramChatId,
          },
          include: { wallet: true },
        });

        if (!customer?.wallet) {
          throw new BadRequestException("Customer wallet not found.");
        }

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`,
        );
        const freshWallet = await tx.customerWallet.findUnique({
          where: { id: customer.wallet.id },
        });
        if (!freshWallet) {
          throw new BadRequestException("Customer wallet not found.");
        }

        const currentConnection =
          await tx.downstreamSourceConnection.findUnique({
            where: { id: connection.id },
            select: { id: true, status: true },
          });

        if (!currentConnection) {
          throw new NotFoundException("Internal source connection not found.");
        }
        if (
          currentConnection.status !== DownstreamSourceConnectionStatus.ACTIVE
        ) {
          throw new BadRequestException("Downstream connection is not active.");
        }

        const balanceBefore = decimalToNumber(freshWallet.balance);
        const commissionBefore = decimalToNumber(freshWallet.commissionBalance);

        if (balanceBefore + commissionBefore < totalAmount) {
          throw new BadRequestException(
            "Downstream source balance is not enough.",
          );
        }

        const split = splitWalletDebit(
          commissionBefore,
          balanceBefore,
          totalAmount,
        );
        const balanceAfter = split.balanceAfter;
        const commissionAfter = split.commissionAfter;
        const sourceOrderCode = generateSourceOrderCode(
          payload.client_order_code,
        );
        const order = await tx.internalSourceOrder.create({
          data: {
            connectionId: connection.id,
            apiKeyId: resolvedKey.id,
            upstreamSellerId: connection.upstreamSellerId,
            upstreamShopId: connection.upstreamShopId,
            downstreamSellerId: connection.downstreamSellerId,
            downstreamShopId: connection.downstreamShopId,
            sourceProductId: product.id,
            sourceOrderCode,
            downstreamOrderCode: payload.client_order_code || null,
            quantity,
            unitPrice: toDecimal(unitPrice),
            sourcePriceSnapshot: product.sourcePrice,
            totalAmount: toDecimal(totalAmount),
            status: InternalSourceOrderStatus.PENDING,
            metadataJson: {
              customerEmail,
              slotMonths: payload.slot_months || null,
            } as Prisma.InputJsonValue,
          },
        });

        await tx.customerWallet.update({
          where: { id: customer.wallet.id },
          data: {
            balance: toDecimal(balanceAfter),
            commissionBalance: toDecimal(commissionAfter),
          },
        });

        await tx.customerWalletLedger.create({
          data: {
            customerId: customer.id,
            walletId: customer.wallet.id,
            type: "SPEND_ORDER",
            amount: toDecimal(totalAmount * -1),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            commissionBalanceBefore: toDecimal(commissionBefore),
            commissionBalanceAfter: toDecimal(commissionAfter),
            referenceType: "internal_source_order",
            referenceId: order.id,
            note: "Trừ số dư ví khi đặt hàng qua bot nguồn",
          },
        });

        await tx.downstreamSourceConnection.update({
          where: { id: connection.id },
          data: {
            status: DownstreamSourceConnectionStatus.ACTIVE,
            lastOrderedAt: new Date(),
          },
        });

        await tx.internalSourceLedger.create({
          data: {
            connectionId: connection.id,
            type: InternalSourceLedgerType.DEBIT_ORDER,
            amount: toDecimal(totalAmount * -1),
            balanceBefore: toDecimal(balanceBefore + commissionBefore),
            balanceAfter: toDecimal(balanceAfter + commissionAfter),
            referenceType: "internal_source_order",
            referenceId: order.id,
            note: "Debit downstream source balance for internal PRO order",
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: order.id,
            eventType: "order_created",
            payloadJson: {
              productId: product.id,
              quantity,
              totalAmount,
              downstreamOrderCode: payload.client_order_code || null,
            } as Prisma.InputJsonValue,
          },
        });

        return order;
      });

      createdOrderId = created.id;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not create internal source order.";
      const errorResponse = {
        success: false,
        message,
      };
      await this.recordAccessLog(
        resolvedKey,
        requestMeta,
        400,
        payload,
        errorResponse,
      );
      return errorResponse;
    }

    const result = await this.fulfillInternalSourceOrder(createdOrderId);
    await this.recordAccessLog(
      resolvedKey,
      requestMeta,
      result.success ? 200 : result.outOfStock || result.pending ? 409 : 422,
      payload,
      result.rawResponse,
    );

    return result.rawResponse;
  }

  async getOrderStatusByKey(
    rawKey: string,
    identifier: {
      orderId?: string;
      orderCode?: string;
    },
    requestMeta?: {
      path?: string;
      method?: string;
      ipAddress?: string | null;
    },
  ) {
    if (!identifier.orderId && !identifier.orderCode) {
      throw new BadRequestException("order_id or order_code is required.");
    }

    const resolvedKey = await this.resolveApiKey(rawKey);
    const connection = this.assertApiKeyUsable(resolvedKey);
    const order = await this.prisma.internalSourceOrder.findFirst({
      where: {
        connectionId: connection.id,
        id: identifier.orderId || undefined,
        sourceOrderCode: identifier.orderCode || undefined,
      },
    });

    if (!order) {
      const errorResponse = {
        success: false,
        message: "Source order not found.",
      };
      await this.recordAccessLog(
        resolvedKey,
        requestMeta,
        404,
        identifier,
        errorResponse,
      );
      return errorResponse;
    }

    const response = {
      success: true,
      order: {
        id: order.id,
        orderCode: order.sourceOrderCode,
        status: order.status.toLowerCase(),
        quantity: order.quantity,
        totalAmount: decimalToNumber(order.totalAmount),
        deliveredText: order.deliveredAccountText,
        failureReason: order.failureReason,
        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
      },
    };

    await this.recordAccessLog(
      resolvedKey,
      requestMeta,
      200,
      identifier,
      response,
    );

    return response;
  }

  private async popInternalManualStockEntries(
    tx: Prisma.TransactionClient,
    sourceProductId: string,
    quantity: number,
  ) {
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
    candidates.sort((left, right) => {
      if (!left.batchId && right.batchId) return -1;
      if (left.batchId && !right.batchId) return 1;
      const priorityDelta =
        (right.batch?.priority ?? 0) - (left.batch?.priority ?? 0);
      if (priorityDelta !== 0) return priorityDelta;
      const batchDateDelta =
        (left.batch?.createdAt.getTime() ?? 0) -
        (right.batch?.createdAt.getTime() ?? 0);
      if (batchDateDelta !== 0) return batchDateDelta;
      const uploadDateDelta =
        left.uploadedAt.getTime() - right.uploadedAt.getTime();
      if (uploadDateDelta !== 0) return uploadDateDelta;
      return left.id.localeCompare(right.id);
    });
    const entries = candidates.slice(0, quantity);
    if (entries.length < quantity) return null;

    const entryIds = entries.map((entry) => entry.id);
    await tx.stockEntry.updateMany({
      where: { id: { in: entryIds }, status: "AVAILABLE" },
      data: { status: "SOLD", soldAt: now, extractedAt: now },
    });
    const totalCost = entries.reduce(
      (sum, entry) =>
        sum +
        (entry.batch?.costPerUnit
          ? decimalToNumber(entry.batch.costPerUnit)
          : 0),
      0,
    );
    for (const batchId of new Set(
      entries.map((entry) => entry.batchId).filter(Boolean) as string[],
    )) {
      const remaining = await tx.stockEntry.count({
        where: { batchId, status: "AVAILABLE" },
      });
      if (remaining === 0) {
        await tx.stockBatch.update({
          where: { id: batchId },
          data: { deletedAt: now },
        });
      }
    }
    return {
      texts: entries.map((entry) => entry.text),
      entryIds,
      totalCost,
    };
  }

  private mapExistingFulfillmentResult(order: {
    id: string;
    sourceOrderCode: string;
    status: InternalSourceOrderStatus;
    deliveredAccountText: string | null;
    failureReason: string | null;
  }) {
    return {
      success: order.status === InternalSourceOrderStatus.DELIVERED,
      outOfStock: false,
      pending:
        order.status === InternalSourceOrderStatus.PENDING_STOCK ||
        order.status === InternalSourceOrderStatus.PENDING_MANUAL,
      rawResponse: {
        success: order.status === InternalSourceOrderStatus.DELIVERED,
        orderId: order.id,
        orderCode: order.sourceOrderCode,
        deliveredText: order.deliveredAccountText ?? undefined,
        message: order.failureReason ?? undefined,
      },
    };
  }

  async fulfillInternalSourceOrder(orderId: string) {
    const order = await this.prisma.internalSourceOrder.findUnique({
      where: { id: orderId },
      include: {
        connection: true,
        apiKey: true,
        upstreamShop: {
          include: {
            providerConfig: true,
          },
        },
        sourceProduct: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Internal source order not found.");
    }

    // Defensive: fulfillment (and its refund branches) must run at most once per order.
    // If the order is no longer PENDING it has already been processed — return its
    // current shape instead of re-running delivery/refund.
    if (order.status !== InternalSourceOrderStatus.PENDING) {
      return this.mapExistingFulfillmentResult(order);
    }

    const sourceMetadata = this.asRecord(order.sourceProduct.metadataJson);
    const deliveryEntries = this.readManualDeliveryEntries(sourceMetadata);
    const isManualProduct = this.isManualProduct(order.sourceProduct);

    // Customer-bound (canboso-style) orders have NO downstream shop and therefore no
    // worker reconciler watching them. If they can't be fulfilled synchronously we
    // must refund immediately instead of parking money in PENDING_* indefinitely.
    const isCustomerBound = order.downstreamShopId == null;

    if (isManualProduct) {
      const [totalStockEntries, availableStockEntries] = await Promise.all([
        this.prisma.stockEntry.count({
          where: { sourceProductId: order.sourceProductId },
        }),
        this.prisma.stockEntry.count({
          where: {
            sourceProductId: order.sourceProductId,
            status: "AVAILABLE",
            OR: [
              { batchId: null },
              { batch: { deletedAt: null, expiresAt: null } },
              { batch: { deletedAt: null, expiresAt: { gt: new Date() } } },
            ],
          },
        }),
      ]);
      if (availableStockEntries > 0) {
        const shortageSentinel = Symbol("internal_manual_stock_shortage");
        const unsafeMarginSentinel = Symbol("internal_manual_stock_margin");
        let actualStockCost = 0;
        try {
          const delivered = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM internal_source_orders WHERE id = ${order.id} FOR UPDATE`,
            );
            const currentOrder = await tx.internalSourceOrder.findUnique({
              where: { id: order.id },
              select: { status: true },
            });
            if (currentOrder?.status !== InternalSourceOrderStatus.PENDING) {
              throw shortageSentinel;
            }
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM source_products WHERE id = ${order.sourceProductId} FOR UPDATE`,
            );
            const popped = await this.popInternalManualStockEntries(
              tx,
              order.sourceProductId,
              order.quantity,
            );
            if (!popped) throw shortageSentinel;
            actualStockCost = popped.totalCost;
            if (
              !isOrderPriceSafe({
                totalSaleAmount: decimalToNumber(order.totalAmount),
                totalSourceAmount: popped.totalCost,
              })
            ) {
              throw unsafeMarginSentinel;
            }

            const deliveredText = popped.texts.join("\n\n");
            const remainingMetadataEntries = [...deliveryEntries];
            for (const text of popped.texts) {
              const index = remainingMetadataEntries.indexOf(text);
              if (index >= 0) remainingMetadataEntries.splice(index, 1);
            }
            const remainingAvailable = await tx.stockEntry.count({
              where: {
                sourceProductId: order.sourceProductId,
                status: "AVAILABLE",
              },
            });
            await tx.internalSourceOrder.update({
              where: { id: order.id },
              data: {
                status: InternalSourceOrderStatus.DELIVERED,
                deliveredAccountText: deliveredText,
                deliveredAt: new Date(),
                sourcePriceSnapshot: toDecimal(
                  order.quantity > 0
                    ? popped.totalCost / order.quantity
                    : popped.totalCost,
                ),
              },
            });
            await tx.internalSourceOrderEvent.create({
              data: {
                orderId: order.id,
                eventType: "manual_stock_delivered",
                payloadJson: {
                  deliveredCount: popped.texts.length,
                  entryIds: popped.entryIds,
                  actualStockCost: popped.totalCost,
                  chargedAmount: decimalToNumber(order.totalAmount),
                } as Prisma.InputJsonValue,
              },
            });
            await tx.sourceProduct.update({
              where: { id: order.sourceProductId },
              data: {
                soldCount: { increment: order.quantity },
                available: remainingAvailable,
                metadataJson: {
                  ...sourceMetadata,
                  manual: true,
                  deliveryEntries: remainingMetadataEntries,
                  deliveryText: this.normalizeManualDeliveryText(
                    remainingMetadataEntries.join("\n\n"),
                  ),
                } as Prisma.InputJsonValue,
              },
            });
            return deliveredText;
          });
          void this.stockAlertService.checkAndAlert(order.sourceProductId);
          return {
            success: true,
            outOfStock: false,
            pending: false,
            rawResponse: {
              success: true,
              orderId: order.id,
              orderCode: order.sourceOrderCode,
              deliveredText: delivered,
            },
          };
        } catch (error) {
          if (error === unsafeMarginSentinel) {
            const message =
              "Actual stock cost is higher than the charged wholesale amount.";
            await this.failInternalSourceOrder(order, message, true);
            return {
              success: false,
              outOfStock: false,
              pending: false,
              rawResponse: {
                success: false,
                refunded: true,
                orderId: order.id,
                orderCode: order.sourceOrderCode,
                message,
                actualStockCost,
              },
            };
          }
          if (error !== shortageSentinel) throw error;
        }
      }
      if (totalStockEntries === 0 && deliveryEntries.length >= order.quantity) {
        if (
          !isOrderPriceSafe({
            totalSaleAmount: decimalToNumber(order.totalAmount),
            totalSourceAmount:
              decimalToNumber(order.sourceProduct.sourcePrice) * order.quantity,
          })
        ) {
          const message =
            "Current source cost is higher than the charged wholesale amount.";
          await this.failInternalSourceOrder(order, message, true);
          return {
            success: false,
            outOfStock: false,
            pending: false,
            rawResponse: {
              success: false,
              refunded: true,
              orderId: order.id,
              orderCode: order.sourceOrderCode,
              message,
            },
          };
        }
        const deliveredEntries = deliveryEntries.slice(0, order.quantity);
        const remainingEntries = deliveryEntries.slice(order.quantity);
        const deliveredText = deliveredEntries.join("\n\n");

        const legacyDeliveryCommitted = await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM internal_source_orders WHERE id = ${order.id} FOR UPDATE`,
            );
            const currentOrder = await tx.internalSourceOrder.findUnique({
              where: { id: order.id },
              select: { status: true },
            });
            if (currentOrder?.status !== InternalSourceOrderStatus.PENDING) {
              return false;
            }
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM source_products WHERE id = ${order.sourceProductId} FOR UPDATE`,
            );
            await tx.internalSourceOrder.update({
              where: { id: order.id },
              data: {
                status: InternalSourceOrderStatus.DELIVERED,
                deliveredAccountText: deliveredText,
                deliveredAt: new Date(),
              },
            });

            await tx.internalSourceOrderEvent.create({
              data: {
                orderId: order.id,
                eventType: "manual_stock_delivered",
                payloadJson: {
                  deliveredCount: deliveredEntries.length,
                } as Prisma.InputJsonValue,
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
                  deliveryText: this.normalizeManualDeliveryText(
                    remainingEntries.join("\n\n"),
                  ),
                } as Prisma.InputJsonValue,
              },
            });
            return true;
          },
        );

        if (!legacyDeliveryCommitted) {
          const settledOrder =
            await this.prisma.internalSourceOrder.findUniqueOrThrow({
              where: { id: order.id },
            });
          return this.mapExistingFulfillmentResult(settledOrder);
        }

        void this.stockAlertService.checkAndAlert(order.sourceProductId);
        return {
          success: true,
          outOfStock: false,
          pending: false,
          rawResponse: {
            success: true,
            orderId: order.id,
            orderCode: order.sourceOrderCode,
            deliveredText,
          },
        };
      }

      const nextStatus =
        deliveryEntries.length > 0
          ? InternalSourceOrderStatus.PENDING_STOCK
          : InternalSourceOrderStatus.PENDING_MANUAL;
      const message =
        nextStatus === InternalSourceOrderStatus.PENDING_STOCK
          ? "Replacement stock is not enough right now."
          : "This source product is waiting for manual processing.";

      if (isCustomerBound) {
        return this.refundCustomerBoundUnfulfilled(order, message);
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.internalSourceOrder.update({
          where: { id: order.id },
          data: {
            status: nextStatus,
            failureReason: message,
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: order.id,
            eventType: "manual_pending",
            payloadJson: {
              reason: message,
              availableEntries: deliveryEntries.length,
            } as Prisma.InputJsonValue,
          },
        });
      });

      return {
        success: false,
        outOfStock: nextStatus === InternalSourceOrderStatus.PENDING_STOCK,
        pending: true,
        rawResponse: {
          success: false,
          pending: true,
          orderId: order.id,
          orderCode: order.sourceOrderCode,
          message,
        },
      };
    }

    const providerConfig = order.upstreamShop.providerConfig;
    const buyerKey = decryptSecret(
      providerConfig?.buyerKeyEncrypted,
      this.config.encryptionKey,
    );

    if (!providerConfig || !buyerKey) {
      await this.failInternalSourceOrder(
        order,
        "Upstream provider config is missing.",
        true,
      );
      return {
        success: false,
        outOfStock: false,
        pending: false,
        rawResponse: {
          success: false,
          orderId: order.id,
          orderCode: order.sourceOrderCode,
          message: "Upstream provider config is missing.",
        },
      };
    }

    const purchaseResult = await purchaseFromProvider(
      {
        baseUrl: providerConfig.baseUrl,
        buyerKey,
        providerName: providerConfig.providerName,
      },
      {
        productId: order.sourceProduct.externalProductId,
        quantity: order.quantity,
        customerEmail:
          typeof sourceMetadata.customerEmail === "string"
            ? sourceMetadata.customerEmail
            : null,
        clientOrderCode: order.sourceOrderCode,
      },
    );

    if (purchaseResult.success && purchaseResult.deliveredText) {
      const deliveryCommitted = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM internal_source_orders WHERE id = ${order.id} FOR UPDATE`,
        );
        const currentOrder = await tx.internalSourceOrder.findUnique({
          where: { id: order.id },
          select: { status: true },
        });
        if (currentOrder?.status !== InternalSourceOrderStatus.PENDING) {
          return false;
        }
        await tx.internalSourceOrder.update({
          where: { id: order.id },
          data: {
            status: InternalSourceOrderStatus.DELIVERED,
            deliveredAccountText: purchaseResult.deliveredText,
            deliveredAt: new Date(),
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: order.id,
            eventType: "upstream_purchase_success",
            payloadJson: {
              providerOrderId: purchaseResult.providerOrderId,
              providerOrderCode: purchaseResult.providerOrderCode,
            } as Prisma.InputJsonValue,
          },
        });

        await this.incrementSoldAndClampAvailable(
          tx,
          order.sourceProductId,
          order.quantity,
        );
        return true;
      });

      if (!deliveryCommitted) {
        const settledOrder =
          await this.prisma.internalSourceOrder.findUniqueOrThrow({
            where: { id: order.id },
          });
        return this.mapExistingFulfillmentResult(settledOrder);
      }

      void this.stockAlertService.checkAndAlert(order.sourceProductId);
      return {
        success: true,
        outOfStock: false,
        pending: false,
        rawResponse: {
          success: true,
          orderId: order.id,
          orderCode: order.sourceOrderCode,
          deliveredText: purchaseResult.deliveredText,
          upstreamOrderId: purchaseResult.providerOrderId,
          upstreamOrderCode: purchaseResult.providerOrderCode,
        },
      };
    }

    if (purchaseResult.outOfStock || purchaseResult.pending) {
      if (isCustomerBound) {
        return this.refundCustomerBoundUnfulfilled(
          order,
          purchaseResult.message || "Source stock is not enough right now.",
        );
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.internalSourceOrder.update({
          where: { id: order.id },
          data: {
            status: InternalSourceOrderStatus.PENDING_STOCK,
            failureReason:
              purchaseResult.message || "Source stock is not enough right now.",
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: order.id,
            eventType: "upstream_out_of_stock",
            payloadJson: {
              message: purchaseResult.message || null,
            } as Prisma.InputJsonValue,
          },
        });
      });

      return {
        success: false,
        outOfStock: true,
        pending: true,
        rawResponse: {
          success: false,
          pending: true,
          orderId: order.id,
          orderCode: order.sourceOrderCode,
          message:
            purchaseResult.message || "Source stock is not enough right now.",
        },
      };
    }

    await this.failInternalSourceOrder(
      order,
      purchaseResult.message || "Internal source purchase failed.",
      true,
    );

    return {
      success: false,
      outOfStock: false,
      pending: false,
      rawResponse: {
        success: false,
        orderId: order.id,
        orderCode: order.sourceOrderCode,
        message: purchaseResult.message || "Internal source purchase failed.",
      },
    };
  }

  /**
   * Customer-bound (canboso-style) order that could not be fulfilled synchronously:
   * refund the wallet and mark FAILED right away (no downstream reconciler exists for
   * these). Returns a clean out-of-stock response shape for the REST caller.
   */
  private async refundCustomerBoundUnfulfilled(
    order: {
      id: string;
      connectionId: string;
      totalAmount: Prisma.Decimal;
      sourceOrderCode: string;
    },
    message: string,
  ) {
    await this.failInternalSourceOrder(
      {
        id: order.id,
        connectionId: order.connectionId,
        totalAmount: order.totalAmount,
      },
      message,
      true,
    );
    return {
      success: false,
      outOfStock: true,
      pending: false,
      rawResponse: {
        success: false,
        refunded: true,
        orderId: order.id,
        orderCode: order.sourceOrderCode,
        message,
      },
    };
  }

  private async failInternalSourceOrder(
    order: {
      id: string;
      connectionId: string;
      totalAmount: Prisma.Decimal;
    },
    reason: string,
    refundBalance: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Idempotency guard: lock the row and bail if it's already closed, so a refund
      // can never be applied twice (e.g. auto-refund during fulfillment followed by an
      // owner mark-failed on the same order).
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM internal_source_orders WHERE id = ${order.id} FOR UPDATE`,
      );
      const current = await tx.internalSourceOrder.findUnique({
        where: { id: order.id },
        select: { status: true },
      });
      if (
        !current ||
        current.status === InternalSourceOrderStatus.DELIVERED ||
        current.status === InternalSourceOrderStatus.FAILED ||
        current.status === InternalSourceOrderStatus.CANCELED
      ) {
        return;
      }

      await tx.internalSourceOrder.update({
        where: { id: order.id },
        data: {
          status: InternalSourceOrderStatus.FAILED,
          failureReason: reason,
        },
      });

      await tx.internalSourceOrderEvent.create({
        data: {
          orderId: order.id,
          eventType: "order_failed",
          payloadJson: {
            reason,
          } as Prisma.InputJsonValue,
        },
      });

      if (!refundBalance) {
        return;
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM downstream_source_connections WHERE id = ${order.connectionId} FOR UPDATE`,
      );

      const connection = await tx.downstreamSourceConnection.findUnique({
        where: { id: order.connectionId },
      });

      if (!connection) {
        return;
      }

      const refundAmount = decimalToNumber(order.totalAmount);
      let walletBefore = 0;
      let walletAfter = 0;
      let ledgerBalanceBefore = 0;
      let ledgerBalanceAfter = 0;

      if (connection.downstreamTelegramChatId) {
        const customer = await tx.customer.findFirst({
          where: {
            shopId: connection.upstreamShopId,
            telegramChatId: connection.downstreamTelegramChatId,
          },
          include: { wallet: true },
        });
        if (customer) {
          let cWallet = customer.wallet;
          if (!cWallet) {
            cWallet = await tx.customerWallet.create({
              data: {
                customerId: customer.id,
                balance: toDecimal(0),
                balanceUsdt: toDecimal(0),
                currency: "VND",
              },
            });
          }
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${cWallet.id} FOR UPDATE`,
          );
          const freshWallet = await tx.customerWallet.findUniqueOrThrow({
            where: { id: cWallet.id },
          });

          // Reverse the ORIGINAL debit split symmetrically. The order may have been
          // paid partly from spend-only commissionBalance (splitWalletDebit spends
          // commission first). Recover how much came from each bucket from the
          // SPEND_ORDER ledger row; fall back to all-to-main if it's absent (e.g.
          // legacy orders) so behaviour is unchanged for cash-only orders.
          const spendRow = await tx.customerWalletLedger.findFirst({
            where: {
              type: "SPEND_ORDER",
              referenceType: "internal_source_order",
              referenceId: order.id,
            },
            orderBy: { createdAt: "desc" },
          });
          let fromMain = refundAmount;
          let fromCommission = 0;
          if (spendRow) {
            const mainTaken =
              decimalToNumber(spendRow.balanceBefore) -
              decimalToNumber(spendRow.balanceAfter);
            const commissionTaken =
              decimalToNumber(spendRow.commissionBalanceBefore) -
              decimalToNumber(spendRow.commissionBalanceAfter);
            if (
              mainTaken >= 0 &&
              commissionTaken >= 0 &&
              mainTaken + commissionTaken > 0
            ) {
              fromMain = mainTaken;
              fromCommission = commissionTaken;
            }
          }

          const commissionBefore = decimalToNumber(
            freshWallet.commissionBalance,
          );
          const commissionAfter = commissionBefore + fromCommission;
          walletBefore = decimalToNumber(freshWallet.balance);
          walletAfter = walletBefore + fromMain;
          ledgerBalanceBefore = walletBefore + commissionBefore;
          ledgerBalanceAfter = walletAfter + commissionAfter;

          await tx.customerWallet.update({
            where: { id: cWallet.id },
            data: {
              balance: toDecimal(walletAfter),
              ...(fromCommission > 0
                ? { commissionBalance: toDecimal(commissionAfter) }
                : {}),
            },
          });
          await tx.customerWalletLedger.create({
            data: {
              customerId: customer.id,
              walletId: cWallet.id,
              type: "REFUND_ORDER",
              amount: toDecimal(refundAmount),
              balanceBefore: toDecimal(walletBefore),
              balanceAfter: toDecimal(walletAfter),
              commissionBalanceBefore: toDecimal(commissionBefore),
              commissionBalanceAfter: toDecimal(commissionAfter),
              referenceType: "internal_source_order",
              referenceId: order.id,
              note: reason ?? "Hoàn tiền đơn nguồn",
            },
          });
        }
      }

      await tx.internalSourceLedger.create({
        data: {
          connectionId: connection.id,
          type: InternalSourceLedgerType.REFUND_ORDER,
          amount: toDecimal(refundAmount),
          balanceBefore: toDecimal(ledgerBalanceBefore),
          balanceAfter: toDecimal(ledgerBalanceAfter),
          referenceType: "internal_source_order",
          referenceId: order.id,
          note: reason,
        },
      });
    });
  }

  private mapPublishedProduct(
    product: PublishedSourceProduct,
    sellerId: string,
    discountPercent = 0,
  ) {
    const override = product.overrides.find(
      (item) => item.sellerId === sellerId,
    );
    const requiresCustomerEmail =
      product.sourceDeliveryMode === "ADD_MAIL" ||
      this.productRequiresCustomerEmail(product.metadataJson);
    const displayName = override?.displayName || product.sourceName;
    const fallbackSalePrice = override?.salePrice
      ? decimalToNumber(override.salePrice)
      : 0;
    const basePrice =
      product.internalSourcePrice != null
        ? decimalToNumber(product.internalSourcePrice)
        : fallbackSalePrice;
    const wholesalePrice =
      discountPercent > 0
        ? Math.round(basePrice * (1 - discountPercent / 100))
        : basePrice;

    return {
      _id: product.id,
      id: product.id,
      product_name: displayName,
      product_name_raw: product.sourceRawName || displayName,
      description: product.sourceDescription || "",
      walletPricing: wholesalePrice,
      pricing: wholesalePrice,
      sourcePrice: wholesalePrice,
      stats: {
        available: product.available,
      },
      available: product.available,
      isSlotProduct: false,
      requiresCustomerEmail,
      requiresSlotMonths: false,
      slotDurations: [],
      quantityFixed: 1,
      walletCurrency: "VND",
      productFamily: product.productFamily?.toLowerCase() || null,
      productFamilyOther: product.productFamilyOther || null,
      accountType: product.accountType?.toLowerCase() || null,
      accountTypeOther: product.accountTypeOther || null,
      durationType: product.durationType?.toLowerCase() || null,
      durationTypeOther: product.durationTypeOther || null,
      deliveryMode: product.sourceDeliveryMode?.toLowerCase() || null,
      warrantyPolicy: product.warrantyPolicy?.toLowerCase() || null,
      internalSourceEnabled: product.internalSourceEnabled,
      sourceDeliveryMode: product.sourceDeliveryMode?.toLowerCase() || null,
      providerName: "internal_pro",
    };
  }

  private async getManagedSourceOrder(userId: string, orderId: string) {
    const shop = await this.getProSellerShopOrThrow(userId);
    const order = await this.prisma.internalSourceOrder.findFirst({
      where: {
        id: orderId,
        upstreamShopId: shop.id,
      },
      include: {
        connection: true,
        downstreamSeller: true,
        downstreamShop: true,
        sourceProduct: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Source order not found.");
    }

    return order;
  }

  private async getSourceOrderById(id: string) {
    const order = await this.prisma.internalSourceOrder.findUnique({
      where: { id },
      include: {
        connection: true,
        downstreamSeller: true,
        downstreamShop: true,
        sourceProduct: true,
        downstreamOrder: {
          include: { customer: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Source order not found.");
    }

    return this.mapSourceOrder(order);
  }

  private mapSourceOrder(
    order: Prisma.InternalSourceOrderGetPayload<{
      include: {
        connection: true;
        downstreamSeller: true;
        downstreamShop: true;
        sourceProduct: true;
        downstreamOrder: { include: { customer: true } };
      };
    }>,
    directCustomer?: {
      telegramUsername: string | null;
      telegramUserId: string;
      firstName: string | null;
      lastName: string | null;
    },
  ) {
    const endCustomer = order.downstreamOrder?.customer
      ? {
          telegramUsername: order.downstreamOrder.customer.telegramUsername,
          telegramUserId: order.downstreamOrder.customer.telegramUserId,
          firstName: order.downstreamOrder.customer.firstName,
          lastName: order.downstreamOrder.customer.lastName,
        }
      : directCustomer
        ? {
            telegramUsername: directCustomer.telegramUsername,
            telegramUserId: directCustomer.telegramUserId,
            firstName: directCustomer.firstName,
            lastName: directCustomer.lastName,
          }
        : null;
    return {
      id: order.id,
      orderCode: order.sourceOrderCode,
      downstreamOrderCode: order.downstreamOrderCode,
      status: order.status.toLowerCase(),
      quantity: order.quantity,
      unitPrice: decimalToNumber(order.unitPrice),
      totalAmount: decimalToNumber(order.totalAmount),
      deliveredAccountText: order.deliveredAccountText,
      failureReason: order.failureReason,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt,
      product: {
        id: order.sourceProduct.id,
        sourceName: order.sourceProduct.sourceName,
        providerName: order.sourceProduct.providerName,
      },
      downstreamSeller: order.downstreamSeller
        ? {
            id: order.downstreamSeller.id,
            displayName: order.downstreamSeller.displayName,
          }
        : null,
      downstreamShop: order.downstreamShop
        ? {
            id: order.downstreamShop.id,
            name: order.downstreamShop.name,
            slug: order.downstreamShop.slug,
          }
        : null,
      connection: {
        id: order.connection.id,
        currency: order.connection.currency,
      },
      endCustomer,
    };
  }

  private async resolveApiKey(rawKey: string): Promise<ResolvedSourceKey> {
    const normalizedKey = String(rawKey || "").trim();

    if (!normalizedKey) {
      throw new BadRequestException("Source API key is missing.");
    }

    const include = {
      seller: true,
      shop: true,
      connection: {
        include: {
          upstreamSeller: true,
          upstreamShop: true,
          downstreamSeller: true,
          downstreamShop: true,
        },
      },
    } as const;

    const sha256Match = await this.prisma.internalSourceApiKey.findFirst({
      where: { keyHash: hashValue(normalizedKey) },
      include,
    });

    if (sha256Match) {
      return sha256Match;
    }

    const keyPrefix = normalizedKey.slice(0, 12);
    const candidates = await this.prisma.internalSourceApiKey.findMany({
      where: { keyPrefix },
      include,
    });

    for (const candidate of candidates) {
      if (await bcrypt.compare(normalizedKey, candidate.keyHash)) {
        return candidate;
      }
    }

    throw new BadRequestException(
      "Source API key is invalid or does not exist in this environment.",
    );
  }

  private assertApiKeyUsable(resolvedKey: ResolvedSourceKey) {
    if (resolvedKey.status !== InternalSourceApiKeyStatus.ACTIVE) {
      throw new ForbiddenException("Source API key is no longer active.");
    }

    if (
      resolvedKey.expiresAt &&
      resolvedKey.expiresAt.getTime() <= Date.now()
    ) {
      throw new ForbiddenException("Source API key has expired.");
    }

    if (!resolvedKey.connection) {
      throw new ForbiddenException(
        "Source API key is not assigned to a downstream connection yet.",
      );
    }

    if (
      resolvedKey.connection.status !== DownstreamSourceConnectionStatus.ACTIVE
    ) {
      throw new ForbiddenException("Downstream connection is not active.");
    }

    return resolvedKey.connection;
  }

  private async getProSellerShopOrThrow(userId: string) {
    const shop = await this.shopsService.getSellerShop(userId);
    const seller = await this.prisma.seller.findUnique({
      where: {
        id: shop.sellerId,
      },
      select: {
        tier: true,
      },
    });

    if (seller?.tier !== SellerTier.PRO && seller?.tier !== SellerTier.ULTRA) {
      throw new ForbiddenException(
        "This action is only available for PRO sellers.",
      );
    }

    return shop;
  }

  private getInternalBuyerBaseUrl() {
    return `${String(this.config.appPublicUrl || "").replace(/\/$/, "")}/api/v1`;
  }

  private async getCurrentConnectionById(id: string) {
    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id },
      include: {
        apiKey: true,
        upstreamSeller: true,
        upstreamShop: { include: { botConfig: true } },
        downstreamSeller: true,
        downstreamShop: true,
      },
    });

    if (!connection) {
      throw new NotFoundException("Internal source connection not found.");
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
        select: { balance: true },
      });
      if (wallet) walletBalance = decimalToNumber(wallet.balance);
    }

    return this.mapConnection(connection, walletBalance);
  }

  private mapConnection(
    connection: Prisma.DownstreamSourceConnectionGetPayload<{
      include: {
        apiKey: true;
        upstreamSeller: true;
        upstreamShop: { include: { botConfig: true } };
        downstreamSeller?: true;
        downstreamShop?: true;
      };
    }>,
    walletBalance = 0,
  ) {
    return {
      id: connection.id,
      status: connection.status.toLowerCase(),
      label: connection.label,
      balance: walletBalance,
      currency: connection.currency,
      inheritSourceTemplate: connection.inheritSourceTemplate,
      templateOverrides:
        connection.templateOverridesJson &&
        typeof connection.templateOverridesJson === "object"
          ? connection.templateOverridesJson
          : {},
      lastCatalogSyncAt: connection.lastCatalogSyncAt,
      lastOrderedAt: connection.lastOrderedAt,
      buyerApiBaseUrl: this.getInternalBuyerBaseUrl(),
      apiKey: connection.apiKey
        ? {
            id: connection.apiKey.id,
            label: connection.apiKey.label,
            keyPrefix: connection.apiKey.keyPrefix,
            keySuffix: (() => {
              try {
                const raw = decryptSecret(
                  connection.apiKey.keyEncrypted!,
                  this.config.encryptionKey,
                );
                return raw.slice(-4);
              } catch {
                return null;
              }
            })(),
            status: connection.apiKey.status.toLowerCase(),
            expiresAt: connection.apiKey.expiresAt,
            lastUsedAt: connection.apiKey.lastUsedAt,
          }
        : null,
      upstreamSeller: {
        id: connection.upstreamSeller.id,
        displayName: connection.upstreamSeller.displayName,
        tier: connection.upstreamSeller.tier.toLowerCase(),
      },
      upstreamShop: {
        id: connection.upstreamShop.id,
        name: connection.upstreamShop.name,
        slug: connection.upstreamShop.slug,
        telegramBotUsername:
          connection.upstreamShop.botConfig?.telegramBotUsername ?? null,
      },
      downstreamSeller:
        "downstreamSeller" in connection && connection.downstreamSeller
          ? {
              id: connection.downstreamSeller.id,
              displayName: connection.downstreamSeller.displayName,
            }
          : null,
      downstreamShop:
        "downstreamShop" in connection && connection.downstreamShop
          ? {
              id: connection.downstreamShop.id,
              name: connection.downstreamShop.name,
              slug: connection.downstreamShop.slug,
              telegramBotUsername:
                "botConfig" in connection.downstreamShop &&
                connection.downstreamShop.botConfig
                  ? ((connection.downstreamShop.botConfig as any)
                      .telegramBotUsername ?? null)
                  : null,
            }
          : null,
    };
  }

  private async recordAccessLog(
    resolvedKey: ResolvedSourceKey,
    requestMeta:
      | {
          path?: string;
          method?: string;
          ipAddress?: string | null;
        }
      | undefined,
    statusCode: number,
    requestBody?: unknown,
    responseBody?: unknown,
  ) {
    await this.prisma.internalSourceAccessLog.create({
      data: {
        apiKeyId: resolvedKey.id,
        connectionId: resolvedKey.connection?.id || null,
        method: String(requestMeta?.method || "GET"),
        path: String(requestMeta?.path || "/telegram-buyer"),
        statusCode,
        ipAddress: requestMeta?.ipAddress || null,
        requestBodyJson: (requestBody || null) as Prisma.InputJsonValue,
        responseBodyJson: (responseBody || null) as Prisma.InputJsonValue,
      },
    });

    await this.prisma.internalSourceApiKey.update({
      where: { id: resolvedKey.id },
      data: {
        lastUsedAt: new Date(),
      },
    });
  }

  private isManualProduct(product: {
    providerName: string;
    sourceDeliveryMode?: string | null;
    metadataJson?: Prisma.JsonValue | null;
  }) {
    if (
      product.sourceDeliveryMode === "ADD_MAIL" ||
      String(product.providerName || "").toLowerCase() === "manual"
    ) {
      return true;
    }

    const metadata = this.asRecord(product.metadataJson);
    return metadata.manual === true;
  }

  private async incrementSoldAndClampAvailable(
    tx: Prisma.TransactionClient,
    sourceProductId: string,
    quantity: number,
  ) {
    const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    if (safeQuantity === 0) return;
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE source_products
        SET sold_count = sold_count + ${safeQuantity},
            available = CASE
              WHEN available IS NULL THEN NULL
              ELSE GREATEST(0, available - ${safeQuantity})
            END,
            updated_at = NOW()
        WHERE id = ${sourceProductId}
      `,
    );
  }

  private productRequiresCustomerEmail(
    value: Prisma.JsonValue | null | undefined,
  ) {
    const metadata = this.asRecord(value);
    return (
      metadata.requiresCustomerEmail === true ||
      metadata.requires_customer_email === true
    );
  }

  private asRecord(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {} as Record<string, any>;
    }

    return value as Record<string, any>;
  }

  private normalizeManualDeliveryText(value: string | null | undefined) {
    const normalized = String(value || "")
      .replace(/\r\n/g, "\n")
      .trim();
    return normalized || null;
  }

  private unwrapManualDeliveryEnvelope(value: string | null | undefined) {
    const normalized = String(value || "").trim();

    if (normalized.startsWith("{") && normalized.endsWith("}")) {
      return normalized.slice(1, -1).trim();
    }

    return normalized;
  }

  private sanitizeDeliveryEntry(value: string) {
    return value
      .trim()
      .replace(/^[{[]+/, "")
      .replace(/[}\],;]+$/g, "")
      .trim();
  }

  private parseJsonDeliveryEntries(normalized: string) {
    if (!normalized.startsWith("[")) {
      return [] as string[];
    }

    try {
      const parsed = JSON.parse(normalized);

      if (!Array.isArray(parsed)) {
        return [] as string[];
      }

      return parsed
        .map((entry) => this.normalizeJsonDeliveryEntry(entry))
        .filter(Boolean) as string[];
    } catch {
      return [] as string[];
    }
  }

  private normalizeJsonDeliveryEntry(entry: unknown) {
    if (typeof entry === "string") {
      return entry.trim() || null;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    const record = entry as Record<string, unknown>;
    const account = [
      record.account,
      record.email,
      record.username,
      record.user,
      record.login,
    ]
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

  private readManualDeliveryEntries(metadata: Record<string, any>) {
    if (Array.isArray(metadata.deliveryEntries)) {
      return metadata.deliveryEntries
        .map((entry: unknown) => String(entry || "").trim())
        .filter(Boolean);
    }

    if (typeof metadata.deliveryText === "string") {
      const normalized = this.unwrapManualDeliveryEnvelope(
        this.normalizeManualDeliveryText(metadata.deliveryText),
      );

      if (!normalized) {
        return [] as string[];
      }

      const jsonEntries = this.parseJsonDeliveryEntries(normalized);
      if (jsonEntries.length > 0) {
        return jsonEntries;
      }

      return normalized
        .split("\n")
        .map((entry) => this.sanitizeDeliveryEntry(entry))
        .filter(Boolean);
    }

    return [] as string[];
  }
}
