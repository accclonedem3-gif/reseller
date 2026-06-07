import { randomUUID } from "crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  OrderStatus,
  CustomerWalletLedgerType,
  PaymentProvider,
  PaymentTransactionStatus,
  ProviderKind,
  Prisma,
  WalletLedgerType,
} from "@prisma/client";
import {
  DEFAULT_USDT_VND_RATE,
  decryptSecret,
  isMockBotToken,
  telegramSendMessage,
} from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";
import { QueueService } from "../lib/queue.service";
import {
  decimalToNumber,
  generateExternalPaymentCode,
  generateOrderCode,
  splitWalletDebit,
  toDecimal,
} from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";
import { WalletService } from "../wallet/wallet.service";
import { WarrantyService } from "../warranty/warranty.service";
import { AffiliateService } from "../affiliate/affiliate.service";

type CreateTelegramOrderInput = {
  shopId: string;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  sourceProductId: string;
  quantity: number;
  paymentProvider?: PaymentProvider;
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(WalletService)
    private readonly walletService: WalletService,
    @Inject(QueueService)
    private readonly queueService: QueueService,
    @Inject(WarrantyService)
    private readonly warrantyService: WarrantyService,
    @Inject(AffiliateService)
    private readonly affiliateService: AffiliateService,
  ) {}

  async listOrders(user: AuthenticatedUser, status?: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const orders = await this.prisma.order.findMany({
      where: {
        shopId: shop.id,
        status: status ? status.toUpperCase() as OrderStatus : undefined,
      },
      include: {
        customer: true,
        sourceProduct: true,
        paymentTransaction: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return orders.map((order) => this.mapOrder(order));
  }

  async getOrder(user: AuthenticatedUser, id: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const order = await this.prisma.order.findFirst({
      where: {
        id,
        shopId: shop.id,
      },
      include: {
        customer: true,
        sourceProduct: true,
        paymentTransaction: true,
        events: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    return {
      ...this.mapOrder(order),
      events: order.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        payload: event.payloadJson,
        createdAt: event.createdAt,
      })),
    };
  }

  async createTelegramOrder(input: CreateTelegramOrderInput) {
    const prepared = await this.prepareTelegramOrderContext(input);
    const orderCode = generateOrderCode();
    const externalOrderCode = generateExternalPaymentCode();
    const payment = await this.paymentService.createPaymentLink({
      shopId: input.shopId,
      externalOrderCode,
      amount: prepared.totalSaleAmount,
      description: orderCode,
      providerOverride: input.paymentProvider,
    });

    const order = await this.prisma.order.create({
      data: {
        shopId: input.shopId,
        sellerId: prepared.shop.sellerId,
        customerId: prepared.customer.id,
        orderCode,
        sourceProductId: prepared.product.id,
        sourceProviderKindSnapshot:
          prepared.shop.providerConfig?.providerKind || ProviderKind.EXTERNAL,
        productNameSnapshot: prepared.productNameSnapshot,
        quantity: prepared.quantity,
        salePrice: toDecimal(prepared.salePrice),
        sourcePriceSnapshot: toDecimal(prepared.sourcePrice),
        totalSaleAmount: toDecimal(prepared.totalSaleAmount),
        totalSourceAmount: toDecimal(prepared.totalSourceAmount),
        status: "AWAITING_PAYMENT",
        paymentStatus: "PENDING",
        paymentTransaction: {
          create: {
            provider: payment.provider,
            externalOrderCode,
            amount: toDecimal(prepared.totalSaleAmount),
            checkoutUrl: payment.checkoutUrl,
            qrCode: payment.qrCode,
            status: PaymentTransactionStatus.PENDING,
            rawPayloadJson: payment.providerPayload as Prisma.InputJsonValue,
          },
        },
        events: {
          create: {
            eventType: "order_created",
            payloadJson: {
              productId: prepared.product.id,
              quantity: prepared.quantity,
              externalOrderCode,
            } as Prisma.InputJsonValue,
          },
        },
      },
      include: {
        paymentTransaction: true,
        customer: true,
      },
    });

    return {
      order: this.mapOrder(order),
      checkoutUrl: order.paymentTransaction?.checkoutUrl || payment.checkoutUrl,
      qrCode: order.paymentTransaction?.qrCode || payment.qrCode,
      manualCrypto: payment.manualCrypto,
      bankInfo: payment.bankInfo,
      isManualNoDelivery: prepared.isManual && !prepared.hasAutoDelivery,
    };
  }

  async createTelegramOrderWithWallet(input: CreateTelegramOrderInput) {
    const prepared = await this.prepareTelegramOrderContext(input);
    const orderCode = generateOrderCode();
    const externalOrderCode = generateExternalPaymentCode();
    const paidAt = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.customerWallet.findUnique({
        where: {
          customerId: prepared.customer.id,
        },
      });

      if (!wallet) {
        throw new BadRequestException("Your wallet balance is not enough. Please top up first.");
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const currentWallet = await tx.customerWallet.findUnique({
        where: {
          id: wallet.id,
        },
      });

      if (!currentWallet) {
        throw new NotFoundException("Customer wallet not found.");
      }

      const balanceBefore = decimalToNumber(currentWallet.balance);
      const commissionBefore = decimalToNumber(currentWallet.commissionBalance);

      if (balanceBefore + commissionBefore < prepared.totalSaleAmount) {
        throw new BadRequestException("Your wallet balance is not enough. Please top up first.");
      }

      const split = splitWalletDebit(commissionBefore, balanceBefore, prepared.totalSaleAmount);
      const balanceAfter = split.balanceAfter;
      const commissionAfter = split.commissionAfter;
      const usdtBefore = decimalToNumber(currentWallet.balanceUsdt);
      const usdtAfter = Math.max(0, usdtBefore - split.fromMain / DEFAULT_USDT_VND_RATE);

      const order = await tx.order.create({
        data: {
          shopId: input.shopId,
          sellerId: prepared.shop.sellerId,
          customerId: prepared.customer.id,
          orderCode,
          sourceProductId: prepared.product.id,
          sourceProviderKindSnapshot:
            prepared.shop.providerConfig?.providerKind || ProviderKind.EXTERNAL,
          productNameSnapshot: prepared.productNameSnapshot,
          quantity: prepared.quantity,
          salePrice: toDecimal(prepared.salePrice),
          sourcePriceSnapshot: toDecimal(prepared.sourcePrice),
          totalSaleAmount: toDecimal(prepared.totalSaleAmount),
          totalSourceAmount: toDecimal(prepared.totalSourceAmount),
          status: "PAID",
          paymentStatus: "PAID",
          paidAt,
          paymentTransaction: {
            create: {
              provider: PaymentProvider.MOCK,
              externalOrderCode,
              amount: toDecimal(prepared.totalSaleAmount),
              checkoutUrl: `wallet://telegram/${externalOrderCode}`,
              qrCode: null,
              status: PaymentTransactionStatus.PAID,
              paidAt,
              rawPayloadJson: {
                source: "customer_wallet",
                channel: "telegram_bot",
              } as Prisma.InputJsonValue,
            },
          },
          events: {
            create: {
              eventType: "order_created",
              payloadJson: {
                productId: prepared.product.id,
                quantity: prepared.quantity,
                externalOrderCode,
                source: "customer_wallet",
              } as Prisma.InputJsonValue,
            },
          },
        },
        include: {
          paymentTransaction: true,
          customer: true,
        },
      });

      await tx.customerWallet.update({
        where: {
          id: currentWallet.id,
        },
        data: {
          balance: toDecimal(balanceAfter),
          commissionBalance: toDecimal(commissionAfter),
          balanceUsdt: toDecimal(usdtAfter),
        },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: prepared.customer.id,
          walletId: currentWallet.id,
          type: CustomerWalletLedgerType.SPEND_ORDER,
          amount: toDecimal(-prepared.totalSaleAmount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          commissionBalanceBefore: toDecimal(commissionBefore),
          commissionBalanceAfter: toDecimal(commissionAfter),
          referenceType: "order",
          referenceId: order.id,
          note: "Paid order from Telegram customer wallet",
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "payment_completed",
          payloadJson: {
            externalOrderCode,
            source: "customer_wallet",
            amount: prepared.totalSaleAmount,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        orderId: order.id,
        walletBalanceAfter: balanceAfter,
      };
    });

    await this.enqueuePaidOrder(created.orderId, prepared.totalSourceAmount);

    return {
      order: await this.getOrderById(created.orderId),
      walletBalanceAfter: created.walletBalanceAfter,
      isManualNoDelivery: prepared.isManual && !prepared.hasAutoDelivery,
    };
  }

  async confirmManualCryptoPayment(user: AuthenticatedUser, orderId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        shopId: shop.id,
      },
      include: {
        paymentTransaction: true,
      },
    });

    if (!order || !order.paymentTransaction) {
      throw new NotFoundException("Order not found.");
    }

    const provider = order.paymentTransaction.provider;

    if (
      provider !== PaymentProvider.BINANCE &&
      provider !== PaymentProvider.OKX &&
      provider !== PaymentProvider.USDT_TRC20
    ) {
      throw new BadRequestException("Only manual crypto payments can be confirmed here.");
    }

    if (order.paymentTransaction.status !== PaymentTransactionStatus.PENDING) {
      throw new BadRequestException("This payment is not pending.");
    }

    return this.markPaymentCompleted(order.paymentTransaction.externalOrderCode, {
      manualCryptoConfirmedBy: user.id,
      provider,
    });
  }

  async markPaymentCompleted(
    externalOrderCode: string,
    rawPayload?: unknown,
    options?: {
      cryptoTxHash?: string | null;
    },
  ) {
    const paymentTransaction = await this.prisma.paymentTransaction.findUnique({
      where: {
        externalOrderCode,
      },
      include: {
        order: true,
      },
    });

    if (!paymentTransaction) {
      throw new NotFoundException("Payment transaction not found.");
    }

    if (paymentTransaction.status === PaymentTransactionStatus.PAID) {
      return this.getOrderById(paymentTransaction.orderId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentTransaction.update({
        where: { id: paymentTransaction.id },
        data: {
          status: PaymentTransactionStatus.PAID,
          paidAt: new Date(),
          cryptoTxHash: options?.cryptoTxHash || undefined,
          rawPayloadJson: rawPayload as Prisma.InputJsonValue,
        },
      });

      await tx.order.update({
        where: { id: paymentTransaction.orderId },
        data: {
          paymentStatus: "PAID",
          status: "PAID",
          paidAt: new Date(),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: paymentTransaction.orderId,
          eventType: "payment_completed",
          payloadJson: (rawPayload || {
            externalOrderCode,
          }) as Prisma.InputJsonValue,
        },
      });
    });

    const order = await this.getOrderById(paymentTransaction.orderId);

    await this.enqueuePaidOrder(order.id, order.totalSourceAmount);

    return this.getOrderById(order.id);
  }

  private async prepareTelegramOrderContext(input: CreateTelegramOrderInput) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: input.shopId },
      include: {
        seller: true,
        providerConfig: true,
      },
    });

    if (!shop) {
      throw new NotFoundException("Shop not found.");
    }

    const product = await this.prisma.sourceProduct.findFirst({
      where: {
        id: input.sourceProductId,
        shopId: input.shopId,
      },
      include: {
        overrides: {
          where: {
            sellerId: shop.sellerId,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException("Product not found.");
    }

    if (product.isSample) {
      throw new BadRequestException("Sản phẩm mẫu (template), không thể mua được.");
    }

    const override = product.overrides[0];
    const quantity = Number(input.quantity);

    if (override?.hidden || override?.enabled === false) {
      throw new BadRequestException("Product is not available.");
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException("Quantity must be a positive integer.");
    }

    if (product.available !== null && product.available <= 0) {
      throw new BadRequestException("Product is out of stock.");
    }

    if (product.available !== null && product.available < quantity) {
      throw new BadRequestException(`Only ${product.available} item(s) left in stock.`);
    }

    const customer = await this.prisma.customer.upsert({
      where: {
        shopId_telegramUserId: {
          shopId: input.shopId,
          telegramUserId: input.telegramUserId,
        },
      },
      update: {
        telegramChatId: input.telegramChatId,
        telegramUsername: input.telegramUsername || null,
        firstName: input.firstName || null,
        lastName: input.lastName || null,
      },
      create: {
        sellerId: shop.sellerId,
        shopId: input.shopId,
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        telegramUsername: input.telegramUsername || null,
        firstName: input.firstName || null,
        lastName: input.lastName || null,
      },
    });

    const baseSalePrice = decimalToNumber(override?.salePrice || product.sourcePrice);
    const [ctvApiKey, downstreamConn] = await Promise.all([
      this.prisma.internalSourceApiKey.findFirst({
        where: { shopId: input.shopId, telegramChatId: input.telegramChatId, status: "ACTIVE" },
        select: { id: true },
      }),
      this.prisma.downstreamSourceConnection.findFirst({
        where: { upstreamShopId: input.shopId, downstreamTelegramChatId: input.telegramChatId, status: "ACTIVE" },
        select: { id: true },
      }),
    ]);
    const ctvBlocked = customer.isCtv === false;
    const isCtvCustomer = !ctvBlocked && ((customer.isCtv ?? false) || ctvApiKey != null || downstreamConn != null);
    const discountPercent = Number(customer.discountPercent ?? 0);

    // Compound CTV pricing: pick the CTV base (internalSourcePrice if the
    // product is published as an internal source SP, else the regular sale
    // price), THEN apply the customer's discount% on top.
    // VD: retail 120k → CTV base 100k → discount 10% → CTV trả 90k.
    // Mirrors getEffectivePrice() / sendQuantityReplyPrompt() in the bot
    // service so the price the user sees in the catalog matches the price
    // they actually pay at order creation.
    let salePrice = baseSalePrice;
    if (isCtvCustomer) {
      const ctvBase = product.internalSourceEnabled && product.internalSourcePrice != null
        ? decimalToNumber(product.internalSourcePrice)
        : baseSalePrice;
      salePrice = discountPercent > 0
        ? Math.round(ctvBase * (1 - discountPercent / 100))
        : ctvBase;
    }
    const sourcePrice = decimalToNumber(product.sourcePrice);

    // Promo logic — check active window first
    const promoType = (product as any).promoType as string | null;
    const promoBuyN = Number((product as any).promoBuyN || 0);
    const promoGetM = Number((product as any).promoGetM || 0);
    const promoBulkMinQty = Number((product as any).promoBulkMinQty || 0);
    const promoBulkDiscountPct = Number((product as any).promoBulkDiscountPct || 0);
    const promoStartAt = (product as any).promoStartAt ? new Date((product as any).promoStartAt) : null;
    const promoEndAt = (product as any).promoEndAt ? new Date((product as any).promoEndAt) : null;
    const now = new Date();
    const promoActive =
      (!promoStartAt || now >= promoStartAt) &&
      (!promoEndAt || now <= promoEndAt);

    let bonusUnits = 0;
    let promoDiscount = 0;
    if (promoActive) {
      if (promoType === "BUY_N_GET_M" && promoBuyN > 0 && promoGetM > 0 && quantity >= promoBuyN) {
        bonusUnits = promoGetM;
      } else if (promoType === "BULK_DISCOUNT" && promoBulkMinQty > 0 && promoBulkDiscountPct > 0 && quantity >= promoBulkMinQty) {
        promoDiscount = Math.floor(salePrice * quantity * promoBulkDiscountPct / 100);
      }
    }

    const effectiveQuantity = quantity + bonusUnits;
    const totalSaleAmount = Math.max(0, salePrice * quantity - promoDiscount);
    const totalSourceAmount = sourcePrice * effectiveQuantity;
    const metadata =
      product.metadataJson && typeof product.metadataJson === "object" && !Array.isArray(product.metadataJson)
        ? (product.metadataJson as Record<string, unknown>)
        : {};
    const isManual =
      String(product.providerName || "").toLowerCase() === "manual" || metadata.manual === true;
    const deliveryEntries = metadata.deliveryEntries;
    const isSharedProduct = metadata.shared === true && typeof metadata.sharedContent === "string" && (metadata.sharedContent as string).trim().length > 0;
    const hasAutoDelivery = isSharedProduct || (Array.isArray(deliveryEntries) && deliveryEntries.length > 0);

    if (!isManual) {
      const [providerBalance, isInStock] = await Promise.all([
        this.shopsService.getProviderBalanceForShopId(input.shopId),
        this.shopsService.checkExternalProductStock(input.shopId, product.externalProductId),
      ]);

      if (!isInStock) {
        throw new BadRequestException(
          "San pham tam het hang ben nha cung cap. Vui long thu lai sau.",
        );
      }

      if (providerBalance.balance < totalSourceAmount) {
        throw new BadRequestException(
          "Shop seller hien khong du so du vi nguon de xu ly don nay. Vui long lien he ho tro.",
        );
      }
    }

    return {
      shop,
      product,
      customer,
      quantity: effectiveQuantity,        // include bonus units for delivery/stock
      paidQuantity: quantity,              // what customer paid for
      bonusUnits,
      promoDiscount,
      salePrice,
      sourcePrice,
      totalSaleAmount,
      totalSourceAmount,
      productNameSnapshot: override?.displayName || product.sourceName,
      isManual,
      hasAutoDelivery,
    };
  }

  private async enqueuePaidOrder(orderId: string, totalSourceAmount: number) {
    try {
      await this.prisma.$transaction(async (tx) => {
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
            } as Prisma.InputJsonValue,
          },
        });
      });

      await this.queueService.addPurchaseJob(orderId);
    } catch (error) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: "FAILED",
          failureReason:
            error instanceof Error ? error.message : "Processing failed.",
        },
      });
    }
  }

  async markOrderDelivered(orderId: string, deliveredAccountText: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "DELIVERED",
          deliveredAccountText,
          deliveredAt: new Date(),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          eventType: "order_delivered",
          payloadJson: {
            deliveredAccountText,
          } as Prisma.InputJsonValue,
        },
      });
    });

    await this.warrantyService.snapshotWarrantyForDeliveredOrder(orderId);
    await this.creditAffiliateCommission(orderId);
    return this.getOrderById(orderId);
  }

  async completePendingManualOrder(user: AuthenticatedUser, orderId: string) {
    const order = await this.getPendingOrderForSeller(user.id, orderId);

    if (order.status !== "PAID_WAITING_STOCK") {
      throw new BadRequestException("Only pending manual orders can be completed here.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          failureReason: null,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "seller_marked_completed",
          payloadJson: {
            note: "Seller manually confirmed that this order is completed.",
          } as Prisma.InputJsonValue,
        },
      });

      if (order.sourceProductId) {
        await tx.sourceProduct.update({
          where: { id: order.sourceProductId },
          data: {
            soldCount: { increment: order.quantity },
            ...(order.sourceProduct?.available !== null && order.sourceProduct?.available !== undefined
              ? { available: { decrement: order.quantity } }
              : {}),
          },
        });
      }
    });

    await this.warrantyService.snapshotWarrantyForDeliveredOrder(order.id);
    await this.creditAffiliateCommission(order.id);

    if (
      order.sourceProviderKindSnapshot === ProviderKind.INTERNAL &&
      order.shop.providerConfig?.internalSourceConnectionId
    ) {
      if (order.sourceProduct?.externalProductId) {
        await this.prisma.sourceProduct.update({
          where: { id: order.sourceProduct.externalProductId },
          data: {
            soldCount: { increment: order.quantity },
            available: { decrement: order.quantity },
          },
        }).catch(() => undefined);
      }
      const totalSourceAmount = decimalToNumber(order.totalSourceAmount);
      if (totalSourceAmount > 0) {
        await this.debitConnectionBalance(
          order.shop.providerConfig.internalSourceConnectionId,
          totalSourceAmount,
          order.id,
        ).catch(() => undefined);
      }
    }

    // Note: do NOT credit seller wallet here — customer paid via gateway/customer-wallet
    // which already deposits to the seller's bank account directly. Crediting here would
    // double-count and let the seller withdraw twice.

    await this.sendSellerResolvedMessage(order, "completed");

    return this.getOrderById(order.id);
  }

  async cancelPendingManualOrder(user: AuthenticatedUser, orderId: string) {
    const order = await this.getPendingOrderForSeller(user.id, orderId);

    if (order.status !== "PAID_WAITING_STOCK") {
      throw new BadRequestException("Only pending manual orders can be canceled here.");
    }

    const reason = "Seller đã hủy xử lý đơn hàng này. Vui lòng liên hệ hỗ trợ để được hướng dẫn bước tiếp theo.";

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "FAILED",
          failureReason: reason,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "seller_marked_canceled",
          payloadJson: {
            reason,
          } as Prisma.InputJsonValue,
        },
      });
    });

    await this.sendSellerResolvedMessage(order, "canceled");

    return this.getOrderById(order.id);
  }

  async markOrderFailed(
    orderId: string,
    reason: string,
    options?: {
      refundWallet?: boolean;
      outOfStock?: boolean;
    },
  ) {
    const order = await this.getOrderById(orderId);

    if (options?.refundWallet) {
      await this.walletService.refundForOrder(
        order.sellerId,
        order.totalSourceAmount,
        order.id,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: options?.outOfStock ? "PAID_WAITING_STOCK" : "FAILED",
          failureReason: reason,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: options?.outOfStock ? "purchase_out_of_stock" : "purchase_failed",
          payloadJson: {
            reason,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return this.getOrderById(order.id);
  }

  async getOrderForWorker(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        shop: {
          include: {
            botConfig: true,
            providerConfig: true,
          },
        },
        customer: true,
        sourceProduct: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    return order;
  }

  async getOrderById(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        sourceProduct: true,
        paymentTransaction: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    return this.mapOrder(order);
  }

  private async getPendingOrderForSeller(userId: string, orderId: string) {
    const shop = await this.shopsService.getSellerShop(userId);
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        shopId: shop.id,
      },
      include: {
        customer: true,
        sourceProduct: { select: { id: true, available: true, externalProductId: true } },
        shop: {
          include: {
            botConfig: true,
            providerConfig: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    return order;
  }

  private normalizeBotLanguage(value: unknown): "vi" | "en" {
    return String(value || "").trim().toLowerCase() === "en" ? "en" : "vi";
  }

  private buildSupportFooter(shop: {
    supportTelegram: string | null;
    supportZalo: string | null;
  }, language: "vi" | "en" = "vi") {
    const lines = [
      shop.supportTelegram
        ? `${language === "en" ? "Telegram" : "Telegram hỗ trợ"}: ${shop.supportTelegram}`
        : null,
      shop.supportZalo
        ? `${language === "en" ? "Zalo" : "Zalo hỗ trợ"}: ${shop.supportZalo}`
        : null,
    ].filter(Boolean);

    if (lines.length === 0) {
      return "";
    }

    return language === "en"
      ? `\n\nSupport contact:\n${lines.join("\n")}`
      : `\n\nLiên hệ hỗ trợ:\n${lines.join("\n")}`;
  }

  private async sendSellerResolvedMessage(
    order: {
      orderCode: string;
      productNameSnapshot: string;
      customer: { telegramChatId: string; preferredLanguage?: string | null } | null;
      shop: {
        name: string;
        supportTelegram: string | null;
        supportZalo: string | null;
        botConfig: {
          telegramBotTokenEncrypted: string;
        } | null;
      };
    },
    action: "completed" | "canceled",
  ) {
    const token = decryptSecret(
      order.shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (
      !token ||
      !order.customer?.telegramChatId ||
      (this.config.mockTelegramEnabled && isMockBotToken(token))
    ) {
      return;
    }

    const language = this.normalizeBotLanguage(order.customer?.preferredLanguage);
    const supportFooter = this.buildSupportFooter(order.shop, language);
    const text =
      action === "completed"
        ? (
            language === "en"
              ? [
                  `✅ Order ${order.orderCode} has been marked completed by the seller.`,
                  `Product: ${order.productNameSnapshot}`,
                  "",
                  "If you still need setup guidance or warranty support, please contact the support channel below.",
                  supportFooter.trim() ? supportFooter.trim() : null,
                ]
              : [
                  `✅ Đơn hàng ${order.orderCode} đã được seller xác nhận hoàn tất.`,
                  `Sản phẩm: ${order.productNameSnapshot}`,
                  "",
                  "Nếu bạn vẫn cần thêm hướng dẫn sử dụng hoặc hỗ trợ bảo hành, vui lòng liên hệ bên dưới.",
                  supportFooter.trim() ? supportFooter.trim() : null,
                ]
          )
            .filter(Boolean)
            .join("\n")
        : (
            language === "en"
              ? [
                  `⚠️ Order ${order.orderCode} has been canceled by the seller.`,
                  `Product: ${order.productNameSnapshot}`,
                  "",
                  "Please contact support for the next step.",
                  supportFooter.trim() ? supportFooter.trim() : null,
                ]
              : [
                  `⚠️ Đơn hàng ${order.orderCode} đã được seller hủy xử lý.`,
                  `Sản phẩm: ${order.productNameSnapshot}`,
                  "",
                  "Vui lòng liên hệ hỗ trợ để được hướng dẫn bước tiếp theo.",
                  supportFooter.trim() ? supportFooter.trim() : null,
                ]
          )
            .filter(Boolean)
            .join("\n");

    await telegramSendMessage(token, order.customer.telegramChatId, text).catch(() => undefined);
  }

  private async debitConnectionBalance(connectionId: string, amount: number, orderId: string) {
    await this.prisma.$transaction(async (tx) => {
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

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`,
      );

      const walletBefore = decimalToNumber(customer.wallet.balance);
      const commissionBefore = decimalToNumber(customer.wallet.commissionBalance);
      const split = splitWalletDebit(commissionBefore, walletBefore, amount);
      const walletAfter = split.balanceAfter;
      const commissionAfter = split.commissionAfter;
      const walletUsdtBefore = decimalToNumber(customer.wallet.balanceUsdt);
      const walletUsdtAfter = Math.max(0, walletUsdtBefore - split.fromMain / DEFAULT_USDT_VND_RATE);

      await tx.customerWallet.update({
        where: { id: customer.wallet.id },
        data: {
          balance: toDecimal(walletAfter),
          commissionBalance: toDecimal(commissionAfter),
          balanceUsdt: toDecimal(walletUsdtAfter),
        },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId: customer.id,
          walletId: customer.wallet.id,
          type: CustomerWalletLedgerType.SPEND_ORDER,
          amount: toDecimal(-amount),
          balanceBefore: toDecimal(walletBefore),
          balanceAfter: toDecimal(walletAfter),
          commissionBalanceBefore: toDecimal(commissionBefore),
          commissionBalanceAfter: toDecimal(commissionAfter),
          referenceType: "order",
          referenceId: orderId,
          note: "Trừ số dư ví khi bot đại lý ra đơn (seller confirm thủ công)",
        },
      });

      await tx.downstreamSourceConnection.update({
        where: { id: connectionId },
        data: { lastOrderedAt: new Date() },
      });

      await tx.internalSourceLedger.create({
        data: {
          id: randomUUID(),
          connectionId,
          type: "DEBIT_ORDER",
          amount: toDecimal(-amount),
          balanceBefore: toDecimal(walletBefore),
          balanceAfter: toDecimal(walletAfter),
          referenceType: "order",
          referenceId: orderId,
          note: "Auto debit from downstream order delivery (manual confirm)",
        },
      });
    });
  }

  private async creditAffiliateCommission(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        shopId: true,
        customerId: true,
        totalSaleAmount: true,
        affiliateCommission: true,
        customer: { select: { referredById: true } },
      },
    });
    if (!order?.customer?.referredById) return;
    if (order.affiliateCommission != null && Number(order.affiliateCommission) > 0) return;

    const config = await this.affiliateService.getConfigByShopId(order.shopId);
    if (!config?.enabled || !config.commissionPct) return;

    const commission = Number(order.totalSaleAmount) * Number(config.commissionPct) / 100;
    if (commission <= 0) return;

    await this.affiliateService.creditCommission(order.id, order.customer.referredById, commission);
  }

  private mapOrder(order: {
    id: string;
    orderCode: string;
    shopId: string;
    sellerId: string;
    customerId: string;
    sourceProviderKindSnapshot?: ProviderKind | null;
    internalSourceOrderId?: string | null;
    internalSourceOrderCode?: string | null;
    warrantyPolicySnapshot?: Prisma.JsonValue | string | null;
    warrantyDeliveryModeSnapshot?: Prisma.JsonValue | string | null;
    warrantyStartedAt?: Date | null;
    warrantyExpiresAt?: Date | null;
    warrantyClaimCount?: number;
    productNameSnapshot: string;
    quantity: number;
    salePrice: Prisma.Decimal;
    sourcePriceSnapshot: Prisma.Decimal;
    totalSaleAmount: Prisma.Decimal;
    totalSourceAmount: Prisma.Decimal;
    status: OrderStatus;
    paymentStatus: string;
    deliveredAccountText: string | null;
    failureReason: string | null;
    createdAt: Date;
    paidAt: Date | null;
    deliveredAt: Date | null;
    customer?: {
      telegramUsername: string | null;
      firstName: string | null;
      lastName: string | null;
      telegramUserId: string;
    } | null;
    sourceProduct?: {
      externalProductId: string;
      sourceName: string;
    } | null;
    paymentTransaction?: {
      externalOrderCode: string;
      checkoutUrl: string;
      qrCode: string | null;
      cryptoTxHash: string | null;
      provider: Prisma.JsonValue | string;
      status: PaymentTransactionStatus;
    } | null;
  }) {
    return {
      id: order.id,
      shopId: order.shopId,
      sellerId: order.sellerId,
      customerId: order.customerId,
      orderCode: order.orderCode,
      sourceProviderKind: String(order.sourceProviderKindSnapshot || "").toLowerCase() || null,
      internalSourceOrderId: order.internalSourceOrderId || null,
      internalSourceOrderCode: order.internalSourceOrderCode || null,
      warrantyPolicy: String(order.warrantyPolicySnapshot || "").toLowerCase() || null,
      warrantyDeliveryMode:
        String(order.warrantyDeliveryModeSnapshot || "").toLowerCase() || null,
      warrantyStartedAt: order.warrantyStartedAt || null,
      warrantyExpiresAt: order.warrantyExpiresAt || null,
      warrantyClaimCount: Number(order.warrantyClaimCount || 0),
      productName: order.productNameSnapshot,
      quantity: order.quantity,
      salePrice: decimalToNumber(order.salePrice),
      sourcePrice: decimalToNumber(order.sourcePriceSnapshot),
      totalSaleAmount: decimalToNumber(order.totalSaleAmount),
      totalSourceAmount: decimalToNumber(order.totalSourceAmount),
      status: order.status.toLowerCase(),
      paymentStatus: order.paymentStatus.toLowerCase(),
      deliveredAccountText: order.deliveredAccountText,
      failureReason: order.failureReason,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      deliveredAt: order.deliveredAt,
      customer: order.customer
        ? {
            telegramUserId: order.customer.telegramUserId,
            telegramUsername: order.customer.telegramUsername,
            name:
              [order.customer.firstName, order.customer.lastName]
                .filter(Boolean)
                .join(" ") || null,
          }
        : null,
      product: order.sourceProduct
        ? {
            sourceProductId: order.sourceProduct.externalProductId,
            sourceName: order.sourceProduct.sourceName,
          }
        : null,
          paymentTransaction: order.paymentTransaction
        ? {
            externalOrderCode: order.paymentTransaction.externalOrderCode,
            checkoutUrl: order.paymentTransaction.checkoutUrl,
            qrCode: order.paymentTransaction.qrCode,
            cryptoTxHash: order.paymentTransaction.cryptoTxHash,
            provider:
              String(order.paymentTransaction.provider).toUpperCase() === "MOCK" &&
              String(order.paymentTransaction.checkoutUrl || "").startsWith("wallet://")
                ? "wallet"
                : String(order.paymentTransaction.provider).toLowerCase(),
            status: order.paymentTransaction.status.toLowerCase(),
          }
        : null,
    };
  }
}
