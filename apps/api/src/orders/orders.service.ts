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
  PreorderCancellationStatus,
  ProviderKind,
  Prisma,
  WalletLedgerType,
} from "@prisma/client";
import {
  checkProviderVariantAvailability,
  decryptSecret,
  isOrderPriceSafe,
  isMockBotToken,
  isRoboticvnProvider,
  resolveProviderBalanceVnd,
  resolveSellerSafeAffiliateCommission,
  supportsProviderBalanceLookup,
  telegramSendMessage,
} from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";
import { FeatureFlagService } from "../lib/feature-flag.service";
import { CacheService } from "../lib/cache.service";
import { QueueService } from "../lib/queue.service";
import {
  hasValidCustomerEmailList,
  parseCustomerEmailList,
} from "../lib/customer-email-list";
import { isProductVisibleForBot } from "../lib/source-product-visibility";
import {
  calculatePreorderCharge,
  calculatePreorderCancellationRefund,
  needsPreorder,
} from "../lib/preorder";
import {
  decimalToNumber,
  generateExternalPaymentCode,
  generateOrderCode,
  generateWarrantyClaimCode,
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
  customerEmail?: string | null;
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
    @Inject(FeatureFlagService)
    private readonly featureFlags: FeatureFlagService,
    @Inject(CacheService)
    private readonly cache: CacheService,
  ) {}

  async listOrders(user: AuthenticatedUser, status?: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const orders = await this.prisma.order.findMany({
      where: {
        shopId: shop.id,
        status: status ? (status.toUpperCase() as OrderStatus) : undefined,
      },
      include: {
        customer: true,
        sourceProduct: {
          include: {
            providerSource: { select: { providerName: true } },
          },
        },
        paymentTransaction: true,
      },
      orderBy: {
        createdAt: "desc",
      },
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
    await this.featureFlags.assertEnabled("orders");
    const prepared = await this.prepareTelegramOrderContext(input);
    const orderCode = generateOrderCode();
    const warrantyClaimCode = generateWarrantyClaimCode();
    const externalOrderCode = generateExternalPaymentCode();
    const payment = await this.paymentService.createPaymentLink({
      shopId: input.shopId,
      externalOrderCode,
      amount: prepared.totalSaleAmount,
      amountUsd: prepared.totalSaleAmountUsd,
      description: orderCode,
      providerOverride: input.paymentProvider,
    });

    const order = await this.prisma.$transaction(async (tx) => {
      await this.assertPhysicalStockAvailable(
        tx,
        prepared.product.id,
        prepared.quantity,
        prepared.isPreorder,
      );
      await this.assertCurrentOrderPriceSafe(
        tx,
        prepared.product.id,
        prepared.quantity,
        prepared.totalSaleAmount,
      );

      return tx.order.create({
        data: {
          shopId: input.shopId,
          sellerId: prepared.shop.sellerId,
          customerId: prepared.customer.id,
          orderCode,
          warrantyClaimCode,
          sourceProductId: prepared.product.id,
          sourceProviderKindSnapshot: prepared.product.providerSourceId
            ? ProviderKind.EXTERNAL
            : prepared.product.internalSourceConnectionId
              ? ProviderKind.INTERNAL
              : prepared.shop.providerConfig?.providerKind ||
                ProviderKind.EXTERNAL,
          productNameSnapshot: prepared.productNameSnapshot,
          customerEmail: prepared.customerEmail,
          quantity: prepared.quantity,
          salePrice: toDecimal(prepared.salePrice),
          sourcePriceSnapshot: toDecimal(prepared.sourcePrice),
          totalSaleAmount: toDecimal(prepared.totalSaleAmount),
          totalSourceAmount: toDecimal(prepared.totalSourceAmount),
          isPreorder: prepared.isPreorder,
          preorderFeePercent: toDecimal(prepared.preorderFeePercent),
          preorderFeeAmount: toDecimal(prepared.preorderFeeAmount),
          status: "AWAITING_PAYMENT",
          paymentStatus: "PENDING",
          paymentTransaction: {
            create: {
              provider: payment.provider,
              externalOrderCode,
              amount: toDecimal(prepared.totalSaleAmount),
              providerAmount:
                payment.providerAmount == null
                  ? undefined
                  : toDecimal(payment.providerAmount),
              providerCurrency: payment.providerCurrency,
              providerReference: payment.providerReference,
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
                isPreorder: prepared.isPreorder,
                preorderFeePercent: prepared.preorderFeePercent,
                preorderFeeAmount: prepared.preorderFeeAmount,
              } as Prisma.InputJsonValue,
            },
          },
        },
        include: {
          paymentTransaction: true,
          customer: true,
        },
      });
    });

    await this.queueService.addOrderTimeoutJob(order.id, 5 * 60 * 1000);

    return {
      order: this.mapOrder(order),
      checkoutUrl: order.paymentTransaction?.checkoutUrl || payment.checkoutUrl,
      qrCode: order.paymentTransaction?.qrCode || payment.qrCode,
      paymentProvider: payment.provider,
      providerAmount: payment.providerAmount,
      providerCurrency: payment.providerCurrency,
      manualCrypto: payment.manualCrypto,
      bankInfo: payment.bankInfo,
      isManualNoDelivery: prepared.isManual && !prepared.hasAutoDelivery,
      isAddMail: prepared.isAddMail,
      isPreorder: prepared.isPreorder,
      preorderFeePercent: prepared.preorderFeePercent,
      preorderFeeAmount: prepared.preorderFeeAmount,
    };
  }

  async createTelegramOrderWithWallet(input: CreateTelegramOrderInput) {
    await this.featureFlags.assertEnabled("orders");
    const prepared = await this.prepareTelegramOrderContext(input);
    const orderCode = generateOrderCode();
    const warrantyClaimCode = generateWarrantyClaimCode();
    const externalOrderCode = generateExternalPaymentCode();
    const paidAt = new Date();
    const usdtVndRate = await this.getShopUsdtVndRate(input.shopId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertPhysicalStockAvailable(
        tx,
        prepared.product.id,
        prepared.quantity,
        prepared.isPreorder,
      );
      await this.assertCurrentOrderPriceSafe(
        tx,
        prepared.product.id,
        prepared.quantity,
        prepared.totalSaleAmount,
      );

      const wallet = await tx.customerWallet.findUnique({
        where: {
          customerId: prepared.customer.id,
        },
      });

      if (!wallet) {
        throw new BadRequestException(
          "Your wallet balance is not enough. Please top up first.",
        );
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
        throw new BadRequestException(
          "Your wallet balance is not enough. Please top up first.",
        );
      }

      const split = splitWalletDebit(
        commissionBefore,
        balanceBefore,
        prepared.totalSaleAmount,
      );
      const balanceAfter = split.balanceAfter;
      const commissionAfter = split.commissionAfter;
      const usdtBefore = decimalToNumber(currentWallet.balanceUsdt);
      const usdtAfter = Math.max(0, usdtBefore - split.fromMain / usdtVndRate);

      const order = await tx.order.create({
        data: {
          shopId: input.shopId,
          sellerId: prepared.shop.sellerId,
          customerId: prepared.customer.id,
          orderCode,
          warrantyClaimCode,
          sourceProductId: prepared.product.id,
          sourceProviderKindSnapshot: prepared.product.providerSourceId
            ? ProviderKind.EXTERNAL
            : prepared.product.internalSourceConnectionId
              ? ProviderKind.INTERNAL
              : prepared.shop.providerConfig?.providerKind ||
                ProviderKind.EXTERNAL,
          productNameSnapshot: prepared.productNameSnapshot,
          customerEmail: prepared.customerEmail,
          quantity: prepared.quantity,
          salePrice: toDecimal(prepared.salePrice),
          sourcePriceSnapshot: toDecimal(prepared.sourcePrice),
          totalSaleAmount: toDecimal(prepared.totalSaleAmount),
          totalSourceAmount: toDecimal(prepared.totalSourceAmount),
          isPreorder: prepared.isPreorder,
          preorderFeePercent: toDecimal(prepared.preorderFeePercent),
          preorderFeeAmount: toDecimal(prepared.preorderFeeAmount),
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
                isPreorder: prepared.isPreorder,
                preorderFeePercent: prepared.preorderFeePercent,
                preorderFeeAmount: prepared.preorderFeeAmount,
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
      isAddMail: prepared.isAddMail,
      isPreorder: prepared.isPreorder,
      preorderFeePercent: prepared.preorderFeePercent,
      preorderFeeAmount: prepared.preorderFeeAmount,
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
      provider !== PaymentProvider.USDT_TRC20 &&
      provider !== PaymentProvider.USDT_BEP20 &&
      provider !== PaymentProvider.USDT_SOL &&
      provider !== PaymentProvider.USDT_TON
    ) {
      throw new BadRequestException(
        "Only manual crypto payments can be confirmed here.",
      );
    }

    if (order.paymentTransaction.status !== PaymentTransactionStatus.PENDING) {
      throw new BadRequestException("This payment is not pending.");
    }

    throw new BadRequestException(
      "Manual crypto confirmation is disabled. The payment must be verified by its provider.",
    );
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
      const paidOrder = await this.getOrderById(paymentTransaction.orderId);
      if (paidOrder.status === "PAID") {
        await this.enqueuePaidOrder(paidOrder.id, paidOrder.totalSourceAmount);
      }
      return this.getOrderById(paymentTransaction.orderId);
    }

    await this.paymentService.assertCryptoReceiptClaimed(
      externalOrderCode,
      paymentTransaction.provider,
      options?.cryptoTxHash,
    );

    const expiredPaymentFailure =
      paymentTransaction.order.status === "FAILED" &&
      String(paymentTransaction.order.failureReason || "").startsWith(
        "Don hang het han thanh toan",
      );
    if (
      paymentTransaction.order.status !== "AWAITING_PAYMENT" &&
      !expiredPaymentFailure
    ) {
      throw new BadRequestException(
        "Order is no longer eligible for automatic payment recovery.",
      );
    }

    const transitioned = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentTransaction.updateMany({
        where: {
          id: paymentTransaction.id,
          status: PaymentTransactionStatus.PENDING,
        },
        data: {
          status: PaymentTransactionStatus.PAID,
          paidAt: new Date(),
          cryptoTxHash: options?.cryptoTxHash || undefined,
          rawPayloadJson: rawPayload as Prisma.InputJsonValue,
        },
      });

      if (claimed.count === 0) return false;

      await tx.order.update({
        where: { id: paymentTransaction.orderId },
        data: {
          paymentStatus: "PAID",
          status: "PAID",
          paidAt: new Date(),
          failureReason: null,
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
      return true;
    });

    if (!transitioned) {
      return this.getOrderById(paymentTransaction.orderId);
    }

    const order = await this.getOrderById(paymentTransaction.orderId);

    await this.enqueuePaidOrder(order.id, order.totalSourceAmount);

    return this.getOrderById(order.id);
  }

  /**
   * Re-read physical stock in the checkout transaction. Unpaid/pending orders
   * deliberately do not reserve stock: customers may create an order while the
   * item is physically available, and fulfillment re-checks stock after payment.
   */
  private async assertPhysicalStockAvailable(
    tx: Prisma.TransactionClient,
    sourceProductId: string,
    requestedQuantity: number,
    isPreorder: boolean,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM source_products WHERE id = ${sourceProductId} FOR UPDATE`,
    );

    if (isPreorder) return;

    const product = await tx.sourceProduct.findUnique({
      where: { id: sourceProductId },
      select: { available: true },
    });
    if (!product) throw new NotFoundException("Product not found.");
    if (product.available === null) return;

    if (product.available < requestedQuantity) {
      if (product.available > 0) {
        throw new BadRequestException(
          `Only ${product.available} item(s) left in stock.`,
        );
      }
      throw new BadRequestException("Product is out of stock.");
    }
  }

  private async incrementSoldAndClampAvailable(
    db: Prisma.TransactionClient | PrismaService,
    sourceProductId: string,
    quantity: number,
  ) {
    const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    if (safeQuantity === 0) return;
    await db.$executeRaw(
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

  private async prepareTelegramOrderContext(input: CreateTelegramOrderInput) {
    await this.shopsService.refreshInternalProductAvailability(
      input.shopId,
      input.sourceProductId,
    );
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
      throw new BadRequestException(
        "Sản phẩm mẫu (template), không thể mua được.",
      );
    }

    if (
      !isProductVisibleForBot(
        product,
        shop.providerConfig?.ownProductsOnly === true,
      )
    ) {
      throw new BadRequestException("Product is not available.");
    }

    const override = product.overrides[0];
    const quantity = Number(input.quantity);

    if (override?.hidden || override?.enabled === false) {
      throw new BadRequestException("Product is not available.");
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException("Quantity must be a positive integer.");
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

    const baseSalePrice = decimalToNumber(
      override?.salePrice || product.sourcePrice,
    );
    const [ctvApiKey, downstreamConn] = await Promise.all([
      this.prisma.internalSourceApiKey.findFirst({
        where: {
          shopId: input.shopId,
          telegramChatId: input.telegramChatId,
          status: "ACTIVE",
        },
        select: { id: true },
      }),
      this.prisma.downstreamSourceConnection.findFirst({
        where: {
          upstreamShopId: input.shopId,
          downstreamTelegramChatId: input.telegramChatId,
          status: "ACTIVE",
        },
        select: { id: true },
      }),
    ]);
    const ctvBlocked = customer.isCtv === false;
    const isCtvCustomer =
      !ctvBlocked &&
      ((customer.isCtv ?? false) ||
        ctvApiKey != null ||
        downstreamConn != null);
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
      const ctvBase =
        product.internalSourceEnabled && product.internalSourcePrice != null
          ? decimalToNumber(product.internalSourcePrice)
          : baseSalePrice;
      salePrice =
        discountPercent > 0
          ? Math.round(ctvBase * (1 - discountPercent / 100))
          : ctvBase;
    }
    const sourcePrice = decimalToNumber(product.sourcePrice);
    let salePriceUsd =
      !isCtvCustomer && override?.salePriceUsd != null
        ? decimalToNumber(override.salePriceUsd)
        : null;

    const metadata =
      product.metadataJson &&
      typeof product.metadataJson === "object" &&
      !Array.isArray(product.metadataJson)
        ? (product.metadataJson as Record<string, unknown>)
        : {};
    const requiresCustomerEmail =
      product.sourceDeliveryMode === "ADD_MAIL" ||
      metadata.requiresCustomerEmail === true ||
      metadata.requires_customer_email === true;

    // Promo logic — check active window first
    const promoType = (product as any).promoType as string | null;
    const promoBuyN = Number((product as any).promoBuyN || 0);
    const promoGetM = Number((product as any).promoGetM || 0);
    const productMetadata =
      (product as any).metadataJson &&
      typeof (product as any).metadataJson === "object" &&
      !Array.isArray((product as any).metadataJson)
        ? ((product as any).metadataJson as Record<string, unknown>)
        : {};
    const promoTiers = Array.isArray(productMetadata.promoTiers)
      ? productMetadata.promoTiers
          .map((tier: any) => ({
            buy: Math.floor(Number(tier?.buy)),
            get: Math.floor(Number(tier?.get)),
          }))
          .filter((tier) => tier.buy > 0 && tier.get > 0)
      : [];
    const promoPriceTiers = Array.isArray(productMetadata.promoPriceTiers)
      ? productMetadata.promoPriceTiers
          .map((tier: any) => ({
            minQty: Math.floor(Number(tier?.minQty)),
            price: Number(tier?.price),
          }))
          .filter(
            (tier) =>
              tier.minQty > 0 && Number.isFinite(tier.price) && tier.price >= 0,
          )
          .sort((a, b) => a.minQty - b.minQty)
      : [];
    const promoBulkMinQty = Number((product as any).promoBulkMinQty || 0);
    const promoBulkDiscountPct = Number(
      (product as any).promoBulkDiscountPct || 0,
    );
    const promoStartAt = (product as any).promoStartAt
      ? new Date((product as any).promoStartAt)
      : null;
    const promoEndAt = (product as any).promoEndAt
      ? new Date((product as any).promoEndAt)
      : null;
    const now = new Date();
    const promoActive =
      (!promoStartAt || now >= promoStartAt) &&
      (!promoEndAt || now <= promoEndAt);

    let bonusUnits = 0;
    let promoDiscount = 0;
    let promoDiscountUnits = 0;
    let appliedDiscountPct = 0;
    if (promoActive) {
      if (promoType === "TIER_PRICE" && !isCtvCustomer) {
        const eligiblePriceTiers = promoPriceTiers.filter(
          (tier) => tier.minQty <= quantity,
        );
        const priceTier = eligiblePriceTiers[eligiblePriceTiers.length - 1];
        if (priceTier) {
          salePrice = priceTier.price;
          salePriceUsd = null;
        }
      } else if (
        !requiresCustomerEmail &&
        promoType === "BUY_N_GET_M" &&
        promoBuyN > 0 &&
        promoGetM > 0 &&
        quantity >= promoBuyN
      ) {
        const tiers =
          promoTiers.length > 0
            ? promoTiers
            : [{ buy: promoBuyN, get: promoGetM }];
        bonusUnits = tiers.reduce(
          (best, tier) =>
            Math.max(best, Math.floor(quantity / tier.buy) * tier.get),
          0,
        );
      } else if (
        promoType === "BUY_N_PAY_M" &&
        promoBuyN > 0 &&
        promoGetM >= 0 &&
        promoGetM < promoBuyN &&
        quantity >= promoBuyN
      ) {
        promoDiscountUnits =
          Math.floor(quantity / promoBuyN) * (promoBuyN - promoGetM);
        promoDiscount = salePrice * promoDiscountUnits;
      } else if (
        promoType === "BULK_DISCOUNT" &&
        promoBulkMinQty > 0 &&
        promoBulkDiscountPct > 0 &&
        quantity >= promoBulkMinQty
      ) {
        appliedDiscountPct = Math.min(100, promoBulkDiscountPct);
        promoDiscount = Math.floor(
          (salePrice * quantity * appliedDiscountPct) / 100,
        );
      } else if (promoType === "PERCENT_DISCOUNT" && promoBulkDiscountPct > 0) {
        appliedDiscountPct = Math.min(100, promoBulkDiscountPct);
        promoDiscount = Math.floor(
          (salePrice * quantity * appliedDiscountPct) / 100,
        );
      }
    }

    const effectiveQuantity = quantity + bonusUnits;
    const merchandiseSaleAmount = Math.max(
      0,
      salePrice * quantity - promoDiscount,
    );
    const merchandiseSaleAmountUsd =
      salePriceUsd == null
        ? null
        : Math.max(
            0,
            salePriceUsd *
              (quantity - promoDiscountUnits) *
              (1 - appliedDiscountPct / 100),
          );
    const totalSourceAmount = sourcePrice * effectiveQuantity;
    const parsedCustomerEmails = parseCustomerEmailList(input.customerEmail);
    const customerEmail = requiresCustomerEmail
      ? parsedCustomerEmails.emails.join("\n") || null
      : String(input.customerEmail || "")
          .trim()
          .toLowerCase() || null;

    if (
      requiresCustomerEmail &&
      (!hasValidCustomerEmailList(parsedCustomerEmails) ||
        parsedCustomerEmails.emails.length !== quantity)
    ) {
      throw new BadRequestException(
        "Enter one valid, unique customer email per purchased item.",
      );
    }
    const isAddMail = product.sourceDeliveryMode === "ADD_MAIL";
    const isManual =
      isAddMail ||
      String(product.providerName || "").toLowerCase() === "manual" ||
      metadata.manual === true;
    const deliveryEntries = metadata.deliveryEntries;
    const isSharedProduct =
      metadata.shared === true &&
      typeof metadata.sharedContent === "string" &&
      (metadata.sharedContent as string).trim().length > 0;
    const hasAutoDelivery =
      isSharedProduct ||
      (Array.isArray(deliveryEntries) && deliveryEntries.length > 0);

    const availableForNewOrder = product.available;
    const isPreorder = needsPreorder(availableForNewOrder, effectiveQuantity);

    if (isPreorder && !product.preorderEnabled) {
      if (availableForNewOrder && availableForNewOrder > 0) {
        throw new BadRequestException(
          `Only ${availableForNewOrder} item(s) left in stock.`,
        );
      }
      throw new BadRequestException("Product is out of stock.");
    }
    if (isPreorder && isAddMail) {
      throw new BadRequestException("ADD_MAIL products cannot be preordered.");
    }

    const preorderCharge = calculatePreorderCharge(
      merchandiseSaleAmount,
      isPreorder ? decimalToNumber(product.preorderFeePercent) : 0,
    );
    const preorderFeePercent = preorderCharge.feePercent;
    const preorderFeeAmount = preorderCharge.feeAmount;
    const totalSaleAmount = preorderCharge.totalAmount;
    const totalSaleAmountUsd =
      merchandiseSaleAmountUsd == null
        ? null
        : Number(
            (merchandiseSaleAmountUsd * (1 + preorderFeePercent / 100)).toFixed(
              2,
            ),
          );

    if (!isOrderPriceSafe({ totalSaleAmount, totalSourceAmount })) {
      throw new BadRequestException(
        "Gia ban dang thap hon gia nguon. Shop dang cap nhat gia, vui long thu lai sau.",
      );
    }

    if (!isManual) {
      const roboticvnStockConfirmed = isPreorder
        ? true
        : await this.assertRoboticvnStockBeforeCheckout(
            shop,
            product,
            effectiveQuantity,
          );
      const shouldCheckProviderBalance = supportsProviderBalanceLookup({
        providerName: product.providerName,
        // Legacy single-source products use the shop-level provider config.
        // Multi-source products persist their detected provider name directly.
        baseUrl: product.providerSourceId
          ? undefined
          : shop.providerConfig?.baseUrl,
      });
      const [providerBalance, isInStock] = await Promise.all([
        shouldCheckProviderBalance
          ? this.shopsService.getProviderBalanceForShopId(
              input.shopId,
              product.internalSourceConnectionId,
              product.providerSourceId,
            )
          : Promise.resolve(null),
        isPreorder || roboticvnStockConfirmed
          ? Promise.resolve(true)
          : this.shopsService.checkExternalProductStock(
              input.shopId,
              product.externalProductId,
              product.providerSourceId,
            ),
      ]);

      if (!isInStock) {
        throw new BadRequestException(
          "San pham tam het hang ben nha cung cap. Vui long thu lai sau.",
        );
      }

      const sourcePricing =
        metadata.sourcePricing &&
        typeof metadata.sourcePricing === "object" &&
        !Array.isArray(metadata.sourcePricing)
          ? (metadata.sourcePricing as Record<string, unknown>)
          : {};
      const sourceCurrency = String(sourcePricing.currency || "VND")
        .trim()
        .toUpperCase();
      const storedUsdVndRate = Number(sourcePricing.usdVndRate);
      const sourceUsdVndRate =
        Number.isFinite(storedUsdVndRate) && storedUsdVndRate > 0
          ? storedUsdVndRate
          : this.config.usdtVndRate;
      const providerBalanceVnd = providerBalance
        ? resolveProviderBalanceVnd(
            providerBalance,
            sourceCurrency,
            sourceUsdVndRate,
          )
        : null;

      if (
        shouldCheckProviderBalance &&
        (providerBalanceVnd === null ||
          providerBalanceVnd < totalSourceAmount)
      ) {
        throw new BadRequestException(
          "Shop seller hien khong du so du vi nguon de xu ly don nay. Vui long lien he ho tro.",
        );
      }
    }

    return {
      shop,
      product,
      customer,
      quantity: effectiveQuantity, // include bonus units for delivery/stock
      paidQuantity: quantity, // what customer paid for
      bonusUnits,
      promoDiscount,
      salePrice,
      sourcePrice,
      totalSaleAmount,
      totalSaleAmountUsd,
      totalSourceAmount,
      productNameSnapshot: override?.displayName || product.sourceName,
      customerEmail,
      isManual,
      isAddMail,
      hasAutoDelivery,
      isPreorder,
      preorderFeePercent,
      preorderFeeAmount,
    };
  }

  private async assertCurrentOrderPriceSafe(
    tx: Prisma.TransactionClient,
    sourceProductId: string,
    quantity: number,
    totalSaleAmount: number,
  ) {
    const currentProduct = await tx.sourceProduct.findUnique({
      where: { id: sourceProductId },
      select: { sourcePrice: true },
    });
    if (!currentProduct) {
      throw new NotFoundException("Product not found.");
    }

    const currentTotalSourceAmount =
      decimalToNumber(currentProduct.sourcePrice) * quantity;
    if (
      !isOrderPriceSafe({
        totalSaleAmount,
        totalSourceAmount: currentTotalSourceAmount,
      })
    ) {
      throw new BadRequestException(
        "Gia nguon vua thay doi va dang cao hon gia ban. Shop dang cap nhat gia, vui long thu lai sau.",
      );
    }
  }

  private async assertRoboticvnStockBeforeCheckout(
    shop: {
      id: string;
      providerConfig: {
        providerKind: ProviderKind;
        baseUrl: string;
        buyerKeyEncrypted: string;
        internalSourceConnectionId: string | null;
      } | null;
    },
    product: {
      id: string;
      externalProductId: string;
      internalSourceConnectionId: string | null;
      providerSourceId: string | null;
      metadataJson: Prisma.JsonValue | null;
    },
    requiredQuantity: number,
  ) {
    let upstreamShopId = shop.id;
    let upstreamProduct = product;
    const directProviderSource = product.providerSourceId
      ? await this.prisma.shopProviderSource.findUnique({
          where: { id: product.providerSourceId },
        })
      : null;
    let providerConfig = product.providerSourceId
      ? directProviderSource
        ? {
            providerKind: ProviderKind.EXTERNAL,
            baseUrl: directProviderSource.baseUrl,
            buyerKeyEncrypted: directProviderSource.buyerKeyEncrypted,
            internalSourceConnectionId: null,
          }
        : null
      : shop.providerConfig;
    let providerScopeId = directProviderSource?.id || `legacy:${shop.id}`;
    let currentConnectionId = product.internalSourceConnectionId;
    const visitedShopIds = new Set<string>();

    for (
      let depth = 0;
      providerConfig?.providerKind === ProviderKind.INTERNAL && depth < 5;
      depth++
    ) {
      if (
        !(currentConnectionId || providerConfig.internalSourceConnectionId) ||
        visitedShopIds.has(upstreamShopId)
      )
        return false;
      visitedShopIds.add(upstreamShopId);
      const connection =
        await this.prisma.downstreamSourceConnection.findUnique({
          where: {
            id:
              currentConnectionId || providerConfig.internalSourceConnectionId!,
          },
          select: {
            upstreamShopId: true,
            upstreamShop: { select: { providerConfig: true } },
          },
        });
      if (!connection?.upstreamShop.providerConfig) return false;

      const source = await this.prisma.sourceProduct.findFirst({
        where: {
          id: upstreamProduct.externalProductId,
          shopId: connection.upstreamShopId,
        },
        select: {
          id: true,
          externalProductId: true,
          internalSourceConnectionId: true,
          providerSourceId: true,
          metadataJson: true,
        },
      });
      if (!source) return false;
      upstreamShopId = connection.upstreamShopId;
      upstreamProduct = source;
      const upstreamProviderSource = source.providerSourceId
        ? await this.prisma.shopProviderSource.findUnique({
            where: { id: source.providerSourceId },
          })
        : null;
      providerConfig = source.providerSourceId
        ? upstreamProviderSource
          ? {
              providerKind: ProviderKind.EXTERNAL,
              baseUrl: upstreamProviderSource.baseUrl,
              buyerKeyEncrypted: upstreamProviderSource.buyerKeyEncrypted,
              internalSourceConnectionId: null,
            }
          : null
        : connection.upstreamShop.providerConfig;
      providerScopeId =
        upstreamProviderSource?.id || `legacy:${connection.upstreamShopId}`;
      currentConnectionId = source.internalSourceConnectionId;
    }

    if (
      !providerConfig ||
      providerConfig.providerKind !== ProviderKind.EXTERNAL
    ) {
      return false;
    }

    const buyerKey = decryptSecret(
      providerConfig.buyerKeyEncrypted,
      this.config.encryptionKey,
    )?.trim();
    if (
      !buyerKey ||
      !isRoboticvnProvider({ baseUrl: providerConfig.baseUrl, buyerKey })
    ) {
      return false;
    }

    const metadata =
      upstreamProduct.metadataJson &&
      typeof upstreamProduct.metadataJson === "object" &&
      !Array.isArray(upstreamProduct.metadataJson)
        ? (upstreamProduct.metadataJson as Record<string, unknown>)
        : {};
    const parentProductId = String(metadata.productId || "").trim();
    if (!parentProductId) return false;

    const cacheKey = `roboticvn:preflight:v2:${providerScopeId}:${upstreamProduct.externalProductId}`;
    let availability = await this.cache.get<{
      inStock: boolean;
      availableQuantity: number | null;
    }>(cacheKey);
    if (availability === null) {
      const lockKey = `${cacheKey}:lock`;
      const lockToken = await this.cache.acquireLock(lockKey, 5_000, 1_500);
      if (lockToken) {
        try {
          availability = await this.cache.get(cacheKey);
          if (
            availability === null &&
            !(await this.cache.exists("roboticvn:catalog-active"))
          ) {
            const requestCount = await this.cache.incrWithWindow(
              "roboticvn:preflight:requests",
              60,
            );
            const configuredLimit = Number(
              process.env.ROBOTICVN_PREFLIGHT_MAX_REQUESTS_PER_MINUTE || 15,
            );
            const requestLimit = Number.isFinite(configuredLimit)
              ? Math.min(30, Math.max(1, Math.floor(configuredLimit)))
              : 15;
            // Full catalog detail scans can consume close to 100 requests/minute.
            // Keep preflight deliberately small and let its 15-second cache + lock
            // collapse hot variants. Redis/catalog pressure fails open to the DB snapshot.
            if (requestCount > 0 && requestCount <= requestLimit) {
              availability = await checkProviderVariantAvailability(
                { baseUrl: providerConfig.baseUrl, buyerKey },
                upstreamProduct.externalProductId,
                parentProductId,
              );
              if (availability !== null)
                await this.cache.set(cacheKey, availability, 15);
            }
          }
        } finally {
          await this.cache.releaseLock(lockKey, lockToken);
        }
      } else {
        availability = await this.cache.get(cacheKey);
      }
    }

    if (availability === null) return false;
    const actualQuantity = availability.availableQuantity;
    const hasEnough =
      availability.inStock &&
      (actualQuantity === null || actualQuantity >= requiredQuantity);
    if (hasEnough) return true;

    const syncedAt = new Date();
    const nextAvailable =
      availability.inStock && actualQuantity !== null ? actualQuantity : 0;
    await this.prisma.$transaction([
      this.prisma.sourceProduct.update({
        where: { id: upstreamProduct.id },
        data: { available: nextAvailable, syncedAt },
      }),
      this.prisma.sourceProduct.updateMany({
        where: { externalProductId: upstreamProduct.id },
        data: { available: nextAvailable, syncedAt },
      }),
    ]);

    const downstreamConnections =
      await this.prisma.downstreamSourceConnection.findMany({
        where: {
          upstreamShopId,
          status: "ACTIVE",
          downstreamShopId: { not: null },
        },
        select: { downstreamShopId: true },
      });
    await Promise.allSettled(
      downstreamConnections
        .filter((connection) => connection.downstreamShopId)
        .map((connection) =>
          this.queueService.addSyncCatalogJob(connection.downstreamShopId!),
        ),
    );

    if (nextAvailable > 0) {
      throw new BadRequestException(
        `Only ${nextAvailable} item(s) left in stock.`,
      );
    }
    throw new BadRequestException("Product is out of stock.");
  }

  private async enqueuePaidOrder(orderId: string, totalSourceAmount: number) {
    try {
      const claimed = await this.prisma.order.updateMany({
        where: { id: orderId, status: "PAID" },
        data: {
          status: "PROCESSING_PURCHASE",
          failureReason: null,
        },
      });
      if (claimed.count === 0) return;

      await this.queueService.addPurchaseJob(orderId);
      await this.prisma.orderEvent.create({
        data: {
          orderId,
          eventType: "purchase_enqueued",
          payloadJson: {
            amount: totalSourceAmount,
            note: "Queued for upstream purchase using source wallet balance.",
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      await this.prisma.order.updateMany({
        where: {
          id: orderId,
          status: "PROCESSING_PURCHASE",
        },
        data: {
          status: "PAID",
          failureReason:
            error instanceof Error ? error.message : "Purchase enqueue failed.",
        },
      });
      throw error;
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
      throw new BadRequestException(
        "Only pending manual orders can be completed here.",
      );
    }
    if (order.isPreorder) {
      throw new BadRequestException(
        "Paid pre-orders are fulfilled automatically in FIFO order when stock arrives.",
      );
    }

    const internalConnectionId =
      order.sourceProviderKindSnapshot === ProviderKind.INTERNAL
        ? order.sourceProduct?.internalSourceConnectionId ||
          order.shop.providerConfig?.internalSourceConnectionId ||
          null
        : null;
    const internalSourceAmount = decimalToNumber(order.totalSourceAmount);
    if (internalConnectionId && order.sourceProduct?.externalProductId) {
      const upstreamProduct = await this.prisma.sourceProduct.findUnique({
        where: { id: order.sourceProduct.externalProductId },
        select: { sourcePrice: true },
      });
      const currentUpstreamCost =
        decimalToNumber(upstreamProduct?.sourcePrice) * order.quantity;
      if (
        !isOrderPriceSafe({
          totalSaleAmount: internalSourceAmount,
          totalSourceAmount: currentUpstreamCost,
        })
      ) {
        throw new BadRequestException(
          "Current upstream cost is higher than this order's wholesale amount.",
        );
      }
    }
    const internalSourceUsdtVndRate = internalConnectionId
      ? await this.getConnectionUsdtVndRate(internalConnectionId)
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`,
      );
      const currentOrder = await tx.order.findUnique({
        where: { id: order.id },
        select: { status: true },
      });
      if (currentOrder?.status !== OrderStatus.PAID_WAITING_STOCK) {
        throw new BadRequestException(
          "Only pending manual orders can be completed here.",
        );
      }
      if (internalConnectionId && internalSourceAmount > 0) {
        await this.debitConnectionBalanceTx(
          tx,
          internalConnectionId,
          internalSourceAmount,
          order.id,
          internalSourceUsdtVndRate as number,
        );
      }
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
        if (order.sourceProduct?.sourceDeliveryMode === "ADD_MAIL") {
          await tx.sourceProduct.update({
            where: { id: order.sourceProductId },
            data: { soldCount: { increment: order.quantity } },
          });
        } else {
          await this.incrementSoldAndClampAvailable(
            tx,
            order.sourceProductId,
            order.quantity,
          );
        }
      }
      if (internalConnectionId && order.sourceProduct?.externalProductId) {
        await this.incrementSoldAndClampAvailable(
          tx,
          order.sourceProduct.externalProductId,
          order.quantity,
        );
      }
    });

    await this.warrantyService.snapshotWarrantyForDeliveredOrder(order.id);
    await this.creditAffiliateCommission(order.id);

    // Note: do NOT credit seller wallet here — customer paid via gateway/customer-wallet
    // which already deposits to the seller's bank account directly. Crediting here would
    // double-count and let the seller withdraw twice.

    await this.sendSellerResolvedMessage(order, "completed");

    return this.getOrderById(order.id);
  }

  async cancelPendingOrder(shopId: string, telegramUserId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        shopId,
        customer: { telegramUserId },
        status: "AWAITING_PAYMENT",
      },
    });

    if (!order) return false;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        paymentStatus: "FAILED",
        failureReason: "Khách hàng hủy đơn (nhả kho)",
      },
    });

    if (order.sourceProductId) {
      const holdKey = `stock:hold:${shopId}:${order.sourceProductId}`;
      await this.cache.releaseStockAtomic(holdKey, order.quantity);
    }

    await this.queueService.removeOrderTimeoutJob(order.id);
    return true;
  }

  async requestPreorderCancellationFromTelegram(
    shopId: string,
    telegramUserId: string,
    orderId: string,
  ) {
    const requestedAt = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`,
      );
      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          shopId,
          customer: { telegramUserId },
        },
      });
      if (!order) throw new NotFoundException("Order not found.");
      if (!order.isPreorder)
        throw new BadRequestException(
          "Only pre-orders can request cancellation.",
        );
      if (
        order.paymentStatus !== "PAID" ||
        order.status !== "PAID_WAITING_STOCK"
      ) {
        throw new BadRequestException(
          "This pre-order is no longer waiting for stock and cannot be canceled.",
        );
      }
      if (
        order.preorderCancellationStatus ===
        PreorderCancellationStatus.REQUESTED
      )
        return false;
      if (
        order.preorderCancellationStatus ===
          PreorderCancellationStatus.APPROVED ||
        order.preorderCancellationStatus ===
          PreorderCancellationStatus.SELLER_CANCELED
      ) {
        throw new BadRequestException(
          "This pre-order has already been canceled.",
        );
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          preorderCancellationStatus: PreorderCancellationStatus.REQUESTED,
          preorderCancelRequestedBy: "CUSTOMER",
          preorderCancelReason:
            "Customer requested cancellation from Telegram bot.",
          preorderCancelRequestedAt: requestedAt,
          preorderCancelReviewedAt: null,
          preorderCancelReviewedBy: null,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "preorder_cancellation_requested",
          payloadJson: {
            requestedBy: "CUSTOMER",
            requestedAt,
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    });

    const order = await this.getPreorderCancellationOrder(orderId);
    if (created) await this.notifySellerAboutPreorderCancellationRequest(order);
    return this.mapOrder(order);
  }

  async approvePreorderCancellation(user: AuthenticatedUser, orderId: string) {
    return this.resolvePreorderCancellation(
      user,
      orderId,
      "APPROVE_CUSTOMER_REQUEST",
    );
  }

  async rejectPreorderCancellation(user: AuthenticatedUser, orderId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const reviewedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`,
      );
      const order = await tx.order.findFirst({
        where: { id: orderId, shopId: shop.id },
      });
      if (!order) throw new NotFoundException("Order not found.");
      if (
        order.preorderCancellationStatus !==
        PreorderCancellationStatus.REQUESTED
      ) {
        throw new BadRequestException(
          "This order has no pending cancellation request.",
        );
      }
      if (
        order.status !== "PAID_WAITING_STOCK" ||
        order.paymentStatus !== "PAID"
      ) {
        throw new BadRequestException(
          "This cancellation request can no longer be rejected.",
        );
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          preorderCancellationStatus: PreorderCancellationStatus.REJECTED,
          preorderCancelReviewedAt: reviewedAt,
          preorderCancelReviewedBy: user.id,
          failureReason:
            "Yêu cầu hủy đã bị seller từ chối. Đơn tiếp tục chờ hàng.",
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "preorder_cancellation_rejected",
          payloadJson: {
            reviewedBy: user.id,
            reviewedAt,
          } as Prisma.InputJsonValue,
        },
      });
    });
    const order = await this.getPreorderCancellationOrder(orderId);
    await this.notifyCustomerAboutPreorderCancellation(
      order,
      "REJECTED",
      0,
      0,
      null,
    );
    return this.mapOrder(order);
  }

  async sellerCancelPreorder(user: AuthenticatedUser, orderId: string) {
    return this.resolvePreorderCancellation(user, orderId, "SELLER_CANCEL");
  }

  private async resolvePreorderCancellation(
    user: AuthenticatedUser,
    orderId: string,
    action: "APPROVE_CUSTOMER_REQUEST" | "SELLER_CANCEL",
  ) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const usdtVndRate = await this.getShopUsdtVndRate(shop.id);
    const reviewedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`,
      );
      const order = await tx.order.findFirst({
        where: { id: orderId, shopId: shop.id },
      });
      if (!order) throw new NotFoundException("Order not found.");
      if (
        !order.isPreorder ||
        order.status !== "PAID_WAITING_STOCK" ||
        order.paymentStatus !== "PAID"
      ) {
        throw new BadRequestException(
          "Only a paid pre-order waiting for stock can be canceled.",
        );
      }
      if (
        action === "APPROVE_CUSTOMER_REQUEST" &&
        order.preorderCancellationStatus !==
          PreorderCancellationStatus.REQUESTED
      ) {
        throw new BadRequestException(
          "This order has no pending customer cancellation request.",
        );
      }
      if (
        order.preorderCancellationStatus ===
          PreorderCancellationStatus.APPROVED ||
        order.preorderCancellationStatus ===
          PreorderCancellationStatus.SELLER_CANCELED
      ) {
        throw new BadRequestException(
          "This pre-order has already been canceled and refunded.",
        );
      }

      const orderTotal = decimalToNumber(order.totalSaleAmount);
      const preorderFee = decimalToNumber(order.preorderFeeAmount);
      const cancellationRefund = calculatePreorderCancellationRefund(
        orderTotal,
        preorderFee,
        action === "SELLER_CANCEL",
      );
      const refundAmount = cancellationRefund.refundAmount;
      const feeRefundAmount = cancellationRefund.feeRefundAmount;
      const wallet = await this.creditPreorderRefund(
        tx,
        order,
        refundAmount,
        action === "SELLER_CANCEL"
          ? "preorder_seller_cancel_refund"
          : "preorder_customer_cancel_refund",
        usdtVndRate,
      );

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "REFUNDED",
          paymentStatus: "REFUNDED",
          failureReason:
            action === "SELLER_CANCEL"
              ? "Shop đã hủy đơn đặt trước và hoàn toàn bộ tiền vào ví khách."
              : "Yêu cầu hủy đã được duyệt. Tiền hàng đã hoàn vào ví; phí đặt trước không hoàn.",
          preorderCancellationStatus:
            action === "SELLER_CANCEL"
              ? PreorderCancellationStatus.SELLER_CANCELED
              : PreorderCancellationStatus.APPROVED,
          preorderCancelRequestedBy:
            action === "SELLER_CANCEL"
              ? "SELLER"
              : order.preorderCancelRequestedBy,
          preorderCancelReason:
            action === "SELLER_CANCEL"
              ? "Seller canceled the pre-order."
              : order.preorderCancelReason,
          preorderCancelRequestedAt:
            action === "SELLER_CANCEL"
              ? reviewedAt
              : order.preorderCancelRequestedAt,
          preorderCancelReviewedAt: reviewedAt,
          preorderCancelReviewedBy: user.id,
          preorderCancelRefundAmount: toDecimal(refundAmount),
          preorderCancelFeeRefundAmount: toDecimal(feeRefundAmount),
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType:
            action === "SELLER_CANCEL"
              ? "preorder_canceled_by_seller"
              : "preorder_cancellation_approved",
          payloadJson: {
            reviewedBy: user.id,
            reviewedAt,
            refundAmount,
            feeRefundAmount,
            walletBalanceAfter: wallet.balanceAfter,
            commissionBalanceAfter: wallet.commissionBalanceAfter,
          } as Prisma.InputJsonValue,
        },
      });
      return { refundAmount, feeRefundAmount, wallet };
    });

    const order = await this.getPreorderCancellationOrder(orderId);
    await this.notifyCustomerAboutPreorderCancellation(
      order,
      action === "SELLER_CANCEL" ? "SELLER_CANCELED" : "APPROVED",
      result.refundAmount,
      result.feeRefundAmount,
      result.wallet,
    );
    return this.mapOrder(order);
  }

  private async creditPreorderRefund(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      orderCode: string;
      customerId: string;
      totalSaleAmount: Prisma.Decimal;
    },
    refundAmount: number,
    referenceType: string,
    usdtVndRate: number,
  ) {
    const existing = await tx.customerWalletLedger.findFirst({
      where: {
        customerId: order.customerId,
        type: CustomerWalletLedgerType.REFUND_ORDER,
        referenceType,
        referenceId: order.id,
      },
      select: { id: true },
    });
    if (existing)
      throw new BadRequestException(
        "This pre-order has already been refunded.",
      );

    let wallet = await tx.customerWallet.findUnique({
      where: { customerId: order.customerId },
    });
    if (!wallet)
      wallet = await tx.customerWallet.create({
        data: { customerId: order.customerId },
      });
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`,
    );
    const freshWallet = await tx.customerWallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });
    const originalSpend = await tx.customerWalletLedger.findFirst({
      where: {
        customerId: order.customerId,
        type: CustomerWalletLedgerType.SPEND_ORDER,
        referenceType: "order",
        referenceId: order.id,
      },
      orderBy: { createdAt: "asc" },
    });
    const orderTotal = Math.max(0, decimalToNumber(order.totalSaleAmount));
    const refundRatio =
      orderTotal > 0 ? Math.min(1, refundAmount / orderTotal) : 0;
    const originalCommissionSpend = originalSpend
      ? Math.max(
          0,
          decimalToNumber(originalSpend.commissionBalanceBefore) -
            decimalToNumber(originalSpend.commissionBalanceAfter),
        )
      : 0;
    const commissionRefund = Math.min(
      refundAmount,
      Number((originalCommissionSpend * refundRatio).toFixed(2)),
    );
    const mainRefund = Math.max(0, refundAmount - commissionRefund);
    const balanceBefore = decimalToNumber(freshWallet.balance);
    const commissionBalanceBefore = decimalToNumber(
      freshWallet.commissionBalance,
    );
    const balanceUsdtBefore = decimalToNumber(freshWallet.balanceUsdt);
    const balanceAfter = balanceBefore + mainRefund;
    const commissionBalanceAfter = commissionBalanceBefore + commissionRefund;
    const balanceUsdtAfter =
      balanceUsdtBefore + mainRefund / Math.max(1, usdtVndRate);

    await tx.customerWallet.update({
      where: { id: freshWallet.id },
      data: {
        balance: toDecimal(balanceAfter),
        commissionBalance: toDecimal(commissionBalanceAfter),
        balanceUsdt: toDecimal(balanceUsdtAfter),
      },
    });
    await tx.customerWalletLedger.create({
      data: {
        customerId: order.customerId,
        walletId: freshWallet.id,
        type: CustomerWalletLedgerType.REFUND_ORDER,
        amount: toDecimal(refundAmount),
        balanceBefore: toDecimal(balanceBefore),
        balanceAfter: toDecimal(balanceAfter),
        commissionBalanceBefore: toDecimal(commissionBalanceBefore),
        commissionBalanceAfter: toDecimal(commissionBalanceAfter),
        referenceType,
        referenceId: order.id,
        note: `Hoàn đơn đặt trước ${order.orderCode}`,
      },
    });
    return { balanceAfter, commissionBalanceAfter };
  }

  async cancelPendingManualOrder(user: AuthenticatedUser, orderId: string) {
    const order = await this.getPendingOrderForSeller(user.id, orderId);

    if (order.status !== "PAID_WAITING_STOCK") {
      throw new BadRequestException(
        "Only pending manual orders can be canceled here.",
      );
    }
    if (order.isPreorder) {
      throw new BadRequestException(
        "Use the pre-order cancellation workflow for this order.",
      );
    }

    const reason =
      "Seller đã hủy xử lý đơn hàng này. Vui lòng liên hệ hỗ trợ để được hướng dẫn bước tiếp theo.";

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

      if (
        order.sourceProductId &&
        order.sourceProduct?.sourceDeliveryMode === "ADD_MAIL" &&
        order.sourceProduct.available !== null &&
        order.sourceProduct.available !== undefined
      ) {
        await tx.sourceProduct.update({
          where: { id: order.sourceProductId },
          data: { available: { increment: order.quantity } },
        });
      }
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
          eventType: options?.outOfStock
            ? "purchase_out_of_stock"
            : "purchase_failed",
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
        sourceProduct: {
          select: {
            id: true,
            available: true,
            externalProductId: true,
            internalSourceConnectionId: true,
            sourceDeliveryMode: true,
          },
        },
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

  private async getPreorderCancellationOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        sourceProduct: true,
        paymentTransaction: true,
        shop: { include: { botConfig: true } },
      },
    });
    if (!order) throw new NotFoundException("Order not found.");
    return order;
  }

  private async notifySellerAboutPreorderCancellationRequest(
    order: Awaited<ReturnType<OrdersService["getPreorderCancellationOrder"]>>,
  ) {
    const encryptedToken = order.shop.botConfig?.telegramBotTokenEncrypted;
    const rawSellerChatId =
      order.shop.botConfig?.ownerTelegramUserId ||
      (/^\d+$/.test(String(order.shop.supportTelegram || "").trim())
        ? String(order.shop.supportTelegram).trim()
        : "");
    if (!encryptedToken || !rawSellerChatId) return;
    const token = decryptSecret(encryptedToken, this.config.encryptionKey);
    if (!token || (this.config.mockTelegramEnabled && isMockBotToken(token)))
      return;
    const customerName = order.customer.telegramUsername
      ? `@${order.customer.telegramUsername}`
      : [order.customer.firstName, order.customer.lastName]
          .filter(Boolean)
          .join(" ") || order.customer.telegramUserId;
    const merchandiseAmount = Math.max(
      0,
      decimalToNumber(order.totalSaleAmount) -
        decimalToNumber(order.preorderFeeAmount),
    );
    const text = [
      "🔔 KHÁCH YÊU CẦU HỦY ĐƠN ĐẶT TRƯỚC",
      `Mã đơn: ${order.orderCode}`,
      `Khách: ${customerName}`,
      `Sản phẩm: ${order.productNameSnapshot}`,
      `Số lượng: ${order.quantity}`,
      `Tiền hàng dự kiến hoàn: ${merchandiseAmount.toLocaleString("vi-VN")}đ`,
      `Phí đặt trước không hoàn: ${decimalToNumber(order.preorderFeeAmount).toLocaleString("vi-VN")}đ`,
      "",
      "Vào Đơn chờ xử lý để duyệt hoặc từ chối yêu cầu.",
    ].join("\n");
    await telegramSendMessage(token, rawSellerChatId, text).catch(
      () => undefined,
    );
  }

  private async notifyCustomerAboutPreorderCancellation(
    order: Awaited<ReturnType<OrdersService["getPreorderCancellationOrder"]>>,
    result: "APPROVED" | "REJECTED" | "SELLER_CANCELED",
    refundAmount: number,
    feeRefundAmount: number,
    wallet: { balanceAfter: number; commissionBalanceAfter: number } | null,
  ) {
    const encryptedToken = order.shop.botConfig?.telegramBotTokenEncrypted;
    if (!encryptedToken || !order.customer.telegramChatId) return;
    const token = decryptSecret(encryptedToken, this.config.encryptionKey);
    if (!token || (this.config.mockTelegramEnabled && isMockBotToken(token)))
      return;
    const language = this.normalizeBotLanguage(
      order.customer.preferredLanguage,
    );
    const fmt = (amount: number) =>
      `${amount.toLocaleString(language === "en" ? "en-US" : "vi-VN")}đ`;
    let text: string;
    if (result === "REJECTED") {
      text =
        language === "en"
          ? `⚠️ Your cancellation request for pre-order ${order.orderCode} was declined.\nThe order remains in the waiting queue at its original position.`
          : `⚠️ Yêu cầu hủy đơn đặt trước ${order.orderCode} đã bị từ chối.\nĐơn tiếp tục chờ hàng và vẫn giữ nguyên vị trí.`;
    } else {
      const sellerCanceled = result === "SELLER_CANCELED";
      const nonRefundedFee = Math.max(
        0,
        decimalToNumber(order.preorderFeeAmount) - feeRefundAmount,
      );
      text =
        language === "en"
          ? [
              sellerCanceled
                ? "✅ The shop canceled your pre-order successfully."
                : "✅ Your pre-order cancellation was approved.",
              `Order: ${order.orderCode}`,
              `Refunded to wallet: ${fmt(refundAmount)}`,
              nonRefundedFee > 0
                ? `Non-refundable pre-order fee: ${fmt(nonRefundedFee)}`
                : null,
              wallet ? `Cash balance: ${fmt(wallet.balanceAfter)}` : null,
              wallet && wallet.commissionBalanceAfter > 0
                ? `Commission balance: ${fmt(wallet.commissionBalanceAfter)}`
                : null,
            ]
              .filter(Boolean)
              .join("\n")
          : [
              sellerCanceled
                ? "✅ Shop đã hủy đơn đặt trước thành công."
                : "✅ Hủy đơn đặt trước thành công.",
              `Mã đơn: ${order.orderCode}`,
              `Tiền hoàn vào ví: ${fmt(refundAmount)}`,
              nonRefundedFee > 0
                ? `Phí đặt trước không hoàn: ${fmt(nonRefundedFee)}`
                : null,
              wallet ? `Số dư ví tiền: ${fmt(wallet.balanceAfter)}` : null,
              wallet && wallet.commissionBalanceAfter > 0
                ? `Số dư hoa hồng: ${fmt(wallet.commissionBalanceAfter)}`
                : null,
            ]
              .filter(Boolean)
              .join("\n");
    }
    await telegramSendMessage(token, order.customer.telegramChatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: language === "en" ? "📋 View orders" : "📋 Xem đơn hàng",
              callback_data: "home:history",
            },
            {
              text: language === "en" ? "💳 View wallet" : "💳 Xem ví",
              callback_data: "home:wallet",
            },
          ],
        ],
      },
    }).catch(() => undefined);
  }

  private normalizeBotLanguage(value: unknown): "vi" | "en" {
    return String(value || "")
      .trim()
      .toLowerCase() === "en"
      ? "en"
      : "vi";
  }

  private buildSupportFooter(
    shop: {
      supportTelegram: string | null;
      supportZalo: string | null;
    },
    language: "vi" | "en" = "vi",
  ) {
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
      warrantyClaimCode?: string | null;
      customer: {
        telegramChatId: string;
        preferredLanguage?: string | null;
      } | null;
      sourceProduct?: { sourceDeliveryMode?: string | null } | null;
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

    const language = this.normalizeBotLanguage(
      order.customer?.preferredLanguage,
    );
    const supportFooter = this.buildSupportFooter(order.shop, language);
    const isAddMail = order.sourceProduct?.sourceDeliveryMode === "ADD_MAIL";
    const addMailCompletedText =
      isAddMail && action === "completed"
        ? (language === "en"
            ? [
                "✅ Account activation completed successfully.",
                "Please open Gmail and accept the Family invitation.",
                "Thank you for choosing " + order.shop.name + "! ❤️",
              ]
            : [
                "Đã kích hoạt tài khoản thành công ✅.",
                "Khách vui lòng vào Gmail và chấp nhận lời mời tham gia Family.",
                "Shop " + order.shop.name + " xin cảm ơn khách rất nhiều ạ! ❤️",
              ]
          ).join("\n")
        : null;
    const text = addMailCompletedText
      ? addMailCompletedText
      : action === "completed"
        ? (language === "en"
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
        : (language === "en"
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

    await telegramSendMessage(
      token,
      order.customer.telegramChatId,
      text,
      isAddMail && action === "completed"
        ? {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      language === "en"
                        ? "🛍️ Continue shopping"
                        : "🛍️ Tiếp tục mua hàng",
                    callback_data: "home:products",
                  },
                  {
                    text:
                      language === "en" ? "🛟 Report an issue" : "🛟 Có vấn đề",
                    callback_data: "home:support",
                  },
                ],
              ],
            },
          }
        : undefined,
    ).catch(() => undefined);
  }

  private async getConnectionUsdtVndRate(connectionId: string) {
    const connection = await this.prisma.downstreamSourceConnection.findUnique({
      where: { id: connectionId },
      select: { upstreamShopId: true },
    });
    if (!connection) {
      throw new BadRequestException("Internal source connection not found.");
    }
    return this.getShopUsdtVndRate(connection.upstreamShopId);
  }

  private async debitConnectionBalanceTx(
    tx: Prisma.TransactionClient,
    connectionId: string,
    amount: number,
    orderId: string,
    usdtVndRate: number,
  ) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException("Invalid internal source debit amount.");
    }
    const connection = await tx.downstreamSourceConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection?.downstreamTelegramChatId) {
      throw new BadRequestException(
        "Internal source connection has no linked customer wallet.",
      );
    }
    const customer = await tx.customer.findFirst({
      where: {
        shopId: connection.upstreamShopId,
        telegramChatId: connection.downstreamTelegramChatId,
      },
      select: { id: true, wallet: { select: { id: true } } },
    });
    if (!customer?.wallet) {
      throw new BadRequestException(
        "Internal source customer wallet not found.",
      );
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`,
    );
    const existingDebit = await tx.customerWalletLedger.findFirst({
      where: {
        walletId: customer.wallet.id,
        type: CustomerWalletLedgerType.SPEND_ORDER,
        referenceType: "order",
        referenceId: orderId,
      },
      select: { id: true },
    });
    if (existingDebit) return;
    const wallet = await tx.customerWallet.findUnique({
      where: { id: customer.wallet.id },
    });
    if (!wallet) {
      throw new BadRequestException(
        "Internal source customer wallet not found.",
      );
    }
    const walletBefore = decimalToNumber(wallet.balance);
    const commissionBefore = decimalToNumber(wallet.commissionBalance);
    const availableBalance = walletBefore + commissionBefore;
    if (availableBalance < amount) {
      throw new BadRequestException(
        `Insufficient source balance. Required: ${amount}, available: ${availableBalance}.`,
      );
    }
    const split = splitWalletDebit(commissionBefore, walletBefore, amount);
    const walletAfter = split.balanceAfter;
    const commissionAfter = split.commissionAfter;
    const walletUsdtAfter = Math.max(
      0,
      decimalToNumber(wallet.balanceUsdt) - split.fromMain / usdtVndRate,
    );
    await tx.customerWallet.update({
      where: { id: wallet.id },
      data: {
        balance: toDecimal(walletAfter),
        commissionBalance: toDecimal(commissionAfter),
        balanceUsdt: toDecimal(walletUsdtAfter),
      },
    });
    await tx.customerWalletLedger.create({
      data: {
        customerId: customer.id,
        walletId: wallet.id,
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
        balanceBefore: toDecimal(availableBalance),
        balanceAfter: toDecimal(walletAfter + commissionAfter),
        referenceType: "order",
        referenceId: orderId,
        note: "Auto debit from downstream order delivery (manual confirm)",
      },
    });
  }

  private async getShopUsdtVndRate(shopId: string) {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId },
      select: { usdtVndRateOverride: true },
    });
    const override = Number(paymentConfig?.usdtVndRateOverride ?? NaN);
    return Number.isFinite(override) && override > 0
      ? override
      : this.config.usdtVndRate;
  }

  private async creditAffiliateCommission(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        shopId: true,
        customerId: true,
        totalSaleAmount: true,
        totalSourceAmount: true,
        affiliateCommission: true,
        customer: { select: { referredById: true } },
      },
    });
    if (!order?.customer?.referredById) return;
    if (
      order.affiliateCommission != null &&
      Number(order.affiliateCommission) > 0
    )
      return;

    const config = await this.affiliateService.getConfigByShopId(order.shopId);
    if (!config?.enabled || !config.commissionPct) return;

    const commission = resolveSellerSafeAffiliateCommission({
      totalSaleAmount: Number(order.totalSaleAmount),
      totalSourceAmount: Number(order.totalSourceAmount),
      commissionPercent: Number(config.commissionPct),
    });
    if (commission <= 0) return;

    await this.affiliateService.creditCommission(
      order.id,
      order.customer.referredById,
      commission,
    );
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
    providerOrderId?: string | null;
    providerOrderCode?: string | null;
    warrantyPolicySnapshot?: Prisma.JsonValue | string | null;
    warrantyDeliveryModeSnapshot?: Prisma.JsonValue | string | null;
    warrantyStartedAt?: Date | null;
    warrantyExpiresAt?: Date | null;
    warrantyClaimCount?: number;
    productNameSnapshot: string;
    customerEmail?: string | null;
    quantity: number;
    salePrice: Prisma.Decimal;
    sourcePriceSnapshot: Prisma.Decimal;
    totalSaleAmount: Prisma.Decimal;
    totalSourceAmount: Prisma.Decimal;
    isPreorder?: boolean;
    preorderFeePercent?: Prisma.Decimal;
    preorderFeeAmount?: Prisma.Decimal;
    preorderCancellationStatus?: PreorderCancellationStatus;
    preorderCancelRequestedBy?: string | null;
    preorderCancelReason?: string | null;
    preorderCancelRequestedAt?: Date | null;
    preorderCancelReviewedAt?: Date | null;
    preorderCancelRefundAmount?: Prisma.Decimal;
    preorderCancelFeeRefundAmount?: Prisma.Decimal;
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
      providerName?: string;
      providerSource?: { providerName: string } | null;
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
      sourceProviderKind:
        String(order.sourceProviderKindSnapshot || "").toLowerCase() || null,
      sourceProvider:
        String(
          order.sourceProduct?.providerSource?.providerName ||
            order.sourceProduct?.providerName ||
            (order.sourceProviderKindSnapshot === ProviderKind.INTERNAL
              ? "internal_pro"
              : ""),
        )
          .trim()
          .toLowerCase() || null,
      internalSourceOrderId: order.internalSourceOrderId || null,
      internalSourceOrderCode:
        order.providerOrderCode || order.internalSourceOrderCode || null,
      providerOrderId: order.providerOrderId || null,
      providerOrderCode: order.providerOrderCode || null,
      warrantyPolicy:
        String(order.warrantyPolicySnapshot || "").toLowerCase() || null,
      warrantyDeliveryMode:
        String(order.warrantyDeliveryModeSnapshot || "").toLowerCase() || null,
      warrantyStartedAt: order.warrantyStartedAt || null,
      warrantyExpiresAt: order.warrantyExpiresAt || null,
      warrantyClaimCount: Number(order.warrantyClaimCount || 0),
      productName: order.productNameSnapshot,
      customerEmail: order.customerEmail || null,
      quantity: order.quantity,
      salePrice: decimalToNumber(order.salePrice),
      sourcePrice: decimalToNumber(order.sourcePriceSnapshot),
      totalSaleAmount: decimalToNumber(order.totalSaleAmount),
      totalSourceAmount: decimalToNumber(order.totalSourceAmount),
      isPreorder: order.isPreorder === true,
      preorderFeePercent: order.preorderFeePercent
        ? decimalToNumber(order.preorderFeePercent)
        : 0,
      preorderFeeAmount: order.preorderFeeAmount
        ? decimalToNumber(order.preorderFeeAmount)
        : 0,
      preorderCancellationStatus: String(
        order.preorderCancellationStatus || "NONE",
      ).toLowerCase(),
      preorderCancelRequestedBy: order.preorderCancelRequestedBy || null,
      preorderCancelReason: order.preorderCancelReason || null,
      preorderCancelRequestedAt: order.preorderCancelRequestedAt || null,
      preorderCancelReviewedAt: order.preorderCancelReviewedAt || null,
      preorderCancelRefundAmount: order.preorderCancelRefundAmount
        ? decimalToNumber(order.preorderCancelRefundAmount)
        : 0,
      preorderCancelFeeRefundAmount: order.preorderCancelFeeRefundAmount
        ? decimalToNumber(order.preorderCancelFeeRefundAmount)
        : 0,
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
              String(order.paymentTransaction.provider).toUpperCase() ===
                "MOCK" &&
              String(order.paymentTransaction.checkoutUrl || "").startsWith(
                "wallet://",
              )
                ? "wallet"
                : String(order.paymentTransaction.provider).toLowerCase(),
            status: order.paymentTransaction.status.toLowerCase(),
          }
        : null,
    };
  }
}
