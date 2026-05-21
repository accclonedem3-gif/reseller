import "dotenv/config";

import bcrypt from "bcryptjs";
import {
  ConnectionStatus,
  DepositStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  PaymentTransactionStatus,
  Prisma,
  PrismaClient,
  SellerStatus,
  SellerTier,
  ShopStatus,
  TelegramDeliveryMode,
  UserRole,
  UserStatus,
  WalletLedgerType,
  WebhookStatus,
  WithdrawStatus,
} from "@prisma/client";

import { DEFAULT_PROVIDER_BASE_URL } from "../packages/shared/src/constants";
import { encryptSecret } from "../packages/shared/src/server/encryption";

const prisma = new PrismaClient();

function toDecimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function resolveSeedPaymentProvider() {
  return String(process.env.PAYMENT_MODE || "payos").toLowerCase() === "mock"
    ? PaymentProvider.MOCK
    : PaymentProvider.PAYOS;
}

async function createUserWithSeller(input: {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  tier?: SellerTier;
  walletBalance?: number;
  botToken?: string;
  buyerKey?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      passwordHash,
      role: input.role,
      status: UserStatus.ACTIVE,
    },
    create: {
      email: input.email,
      passwordHash,
      role: input.role,
      status: UserStatus.ACTIVE,
    },
  });

  if (input.role === UserRole.SUPER_ADMIN) {
    return { user };
  }

  const seller = await prisma.seller.upsert({
    where: { userId: user.id },
    update: {
      displayName: input.displayName,
      status: SellerStatus.ACTIVE,
      tier: input.tier ?? SellerTier.PRO,
    },
    create: {
      userId: user.id,
      displayName: input.displayName,
      status: SellerStatus.ACTIVE,
      tier: input.tier ?? SellerTier.PRO,
    },
  });

  const shop = await prisma.shop.upsert({
    where: { slug: slugify(input.displayName) },
    update: {
      name: `${input.displayName} Shop`,
      tagline: "Kho acc giao tự động 24/7",
      supportTelegram: null,
      supportZalo: null,
      status: ShopStatus.ACTIVE,
    },
    create: {
      sellerId: seller.id,
      slug: slugify(input.displayName),
      name: `${input.displayName} Shop`,
      tagline: "Kho acc giao tự động 24/7",
      supportTelegram: null,
      supportZalo: null,
      status: ShopStatus.ACTIVE,
    },
  });

  const encryptionKey = process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key";
  const botToken = String(input.botToken || process.env.SEED_SELLER_BOT_TOKEN || "").trim();
  const buyerKey = String(input.buyerKey || process.env.SEED_SELLER_PROVIDER_KEY || "").trim();

  await prisma.botConfig.upsert({
    where: { shopId: shop.id },
    update: {
      telegramBotTokenEncrypted: botToken ? encryptSecret(botToken, encryptionKey) : "",
      webhookUrl: null,
      webhookStatus: WebhookStatus.DISABLED,
      deliveryMode: TelegramDeliveryMode.POLLING,
      telegramBotUsername: null,
      telegramBotId: null,
      lastVerifiedAt: null,
    },
    create: {
      shopId: shop.id,
      telegramBotTokenEncrypted: botToken ? encryptSecret(botToken, encryptionKey) : "",
      webhookUrl: null,
      webhookStatus: WebhookStatus.DISABLED,
      deliveryMode: TelegramDeliveryMode.POLLING,
      telegramBotUsername: null,
      telegramBotId: null,
      lastVerifiedAt: null,
    },
  });

  await prisma.providerConfig.upsert({
    where: { shopId: shop.id },
    update: {
      providerName: "canboso",
      baseUrl: process.env.DEFAULT_PROVIDER_BASE_URL || DEFAULT_PROVIDER_BASE_URL,
      buyerKeyEncrypted: buyerKey ? encryptSecret(buyerKey, encryptionKey) : "",
      connectionStatus: ConnectionStatus.PENDING,
      lastVerifiedAt: null,
    },
    create: {
      shopId: shop.id,
      providerName: "canboso",
      baseUrl: process.env.DEFAULT_PROVIDER_BASE_URL || DEFAULT_PROVIDER_BASE_URL,
      buyerKeyEncrypted: buyerKey ? encryptSecret(buyerKey, encryptionKey) : "",
      connectionStatus: ConnectionStatus.PENDING,
      lastVerifiedAt: null,
    },
  });

  await prisma.paymentConfig.upsert({
    where: { shopId: shop.id },
    update: {
      provider: resolveSeedPaymentProvider(),
    },
    create: {
      shopId: shop.id,
      provider: resolveSeedPaymentProvider(),
    },
  });

  const wallet = await prisma.sellerWallet.upsert({
    where: { sellerId: seller.id },
    update: {
      balance: toDecimal(input.walletBalance ?? 0),
    },
    create: {
      sellerId: seller.id,
      balance: toDecimal(input.walletBalance ?? 0),
      currency: "VND",
    },
  });

  return { user, seller, shop, wallet };
}

async function seedCatalog(shopId: string, sellerId: string) {
  const products = [
    {
      externalProductId: "698600232b866a39b4cb2272",
      sourceName: "VEO3 Ultra 25k credit",
      sourceRawName: "VEO3 Ultra 25k credit",
      sourceDescription: "Giao tài khoản VEO3 credit. Hỗ trợ BH 24h.",
      sourcePrice: 35000,
      available: 12,
      soldCount: 17,
      totalCount: 29,
    },
    {
      externalProductId: "698618eeaff16b992e059270",
      sourceName: "Spotify Premium 12 tháng",
      sourceRawName: "Spotify Premium 12 tháng",
      sourceDescription: "Tài khoản premium bảo hành đầy đủ.",
      sourcePrice: 90000,
      available: 8,
      soldCount: 11,
      totalCount: 19,
    },
    {
      externalProductId: "698618eeaff16b992e059271",
      sourceName: "Netflix Premium 1 tháng",
      sourceRawName: "Netflix Premium 1 tháng",
      sourceDescription: "Tài khoản Netflix Premium riêng tư.",
      sourcePrice: 60000,
      available: 4,
      soldCount: 24,
      totalCount: 28,
    },
  ];

  for (const product of products) {
    const sourceProduct = await prisma.sourceProduct.upsert({
      where: {
        shopId_externalProductId: {
          shopId,
          externalProductId: product.externalProductId,
        },
      },
      update: {
        sourceName: product.sourceName,
        sourceRawName: product.sourceRawName,
        sourceDescription: product.sourceDescription,
        sourcePrice: toDecimal(product.sourcePrice),
        available: product.available,
        soldCount: product.soldCount,
        totalCount: product.totalCount,
        syncedAt: new Date(),
      },
      create: {
        shopId,
        externalProductId: product.externalProductId,
        providerName: "canboso",
        sourceName: product.sourceName,
        sourceRawName: product.sourceRawName,
        sourceDescription: product.sourceDescription,
        sourcePrice: toDecimal(product.sourcePrice),
        available: product.available,
        soldCount: product.soldCount,
        totalCount: product.totalCount,
        metadataJson: {
          demo: true,
        },
        syncedAt: new Date(),
      },
    });

    await prisma.sellerProductOverride.upsert({
      where: {
        sellerId_sourceProductId: {
          sellerId,
          sourceProductId: sourceProduct.id,
        },
      },
      update: {
        displayName:
          product.externalProductId === "698600232b866a39b4cb2272"
            ? "VEO3 Ultra 25k credit - BH 24h"
            : product.sourceName,
        salePrice:
          product.externalProductId === "698600232b866a39b4cb2272"
            ? toDecimal(50000)
            : toDecimal(product.sourcePrice + 25000),
        hidden: false,
        enabled: true,
        promoText:
          product.externalProductId === "698600232b866a39b4cb2272"
            ? "Best seller"
            : null,
      },
      create: {
        sellerId,
        shopId,
        sourceProductId: sourceProduct.id,
        displayName:
          product.externalProductId === "698600232b866a39b4cb2272"
            ? "VEO3 Ultra 25k credit - BH 24h"
            : product.sourceName,
        salePrice:
          product.externalProductId === "698600232b866a39b4cb2272"
            ? toDecimal(50000)
            : toDecimal(product.sourcePrice + 25000),
        hidden: false,
        enabled: true,
        promoText:
          product.externalProductId === "698600232b866a39b4cb2272"
            ? "Best seller"
            : null,
      },
    });
  }
}

async function seedOrders(shopId: string, sellerId: string, walletId: string) {
  const customer = await prisma.customer.upsert({
    where: {
      shopId_telegramUserId: {
        shopId,
        telegramUserId: "9988776655",
      },
    },
    update: {
      telegramUsername: "demo_buyer",
      firstName: "Demo",
      lastName: "Buyer",
    },
    create: {
      sellerId,
      shopId,
      telegramUserId: "9988776655",
      telegramChatId: "9988776655",
      telegramUsername: "demo_buyer",
      firstName: "Demo",
      lastName: "Buyer",
    },
  });

  const sourceProduct = await prisma.sourceProduct.findFirstOrThrow({
    where: {
      shopId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const deliveredOrder = await prisma.order.upsert({
    where: {
      orderCode: "ORD-DEMO-0001",
    },
    update: {},
    create: {
      shopId,
      sellerId,
      customerId: customer.id,
      orderCode: "ORD-DEMO-0001",
      sourceProductId: sourceProduct.id,
      productNameSnapshot: "VEO3 Ultra 25k credit - BH 24h",
      quantity: 1,
      salePrice: toDecimal(50000),
      sourcePriceSnapshot: toDecimal(35000),
      totalSaleAmount: toDecimal(50000),
      totalSourceAmount: toDecimal(35000),
      status: OrderStatus.DELIVERED,
      paymentStatus: PaymentStatus.PAID,
      deliveredAccountText: "demo-account@example.com:Password123!",
      paidAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      deliveredAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    },
  });

  await prisma.paymentTransaction.upsert({
    where: {
      orderId: deliveredOrder.id,
    },
    update: {
      status: PaymentTransactionStatus.PAID,
      amount: toDecimal(50000),
      checkoutUrl: "http://localhost:3000/api/v1/dev/mock-payments/ORD-DEMO-0001",
      qrCode: "mock://ORD-DEMO-0001",
      paidAt: deliveredOrder.paidAt,
    },
    create: {
      orderId: deliveredOrder.id,
      provider: PaymentProvider.MOCK,
      externalOrderCode: "1000001",
      amount: toDecimal(50000),
      checkoutUrl: "http://localhost:3000/api/v1/dev/mock-payments/ORD-DEMO-0001",
      qrCode: "mock://ORD-DEMO-0001",
      status: PaymentTransactionStatus.PAID,
      paidAt: deliveredOrder.paidAt,
    },
  });

  const paidWaitingOrder = await prisma.order.upsert({
    where: {
      orderCode: "ORD-DEMO-0002",
    },
    update: {},
    create: {
      shopId,
      sellerId,
      customerId: customer.id,
      orderCode: "ORD-DEMO-0002",
      sourceProductId: sourceProduct.id,
      productNameSnapshot: "Spotify Premium 12 tháng",
      quantity: 1,
      salePrice: toDecimal(115000),
      sourcePriceSnapshot: toDecimal(90000),
      totalSaleAmount: toDecimal(115000),
      totalSourceAmount: toDecimal(90000),
      status: OrderStatus.PAID_WAITING_STOCK,
      paymentStatus: PaymentStatus.PAID,
      paidAt: new Date(Date.now() - 1000 * 60 * 60 * 5),
      failureReason: "Provider demo is temporarily out of stock.",
    },
  });

  await prisma.paymentTransaction.upsert({
    where: {
      orderId: paidWaitingOrder.id,
    },
    update: {},
    create: {
      orderId: paidWaitingOrder.id,
      provider: PaymentProvider.MOCK,
      externalOrderCode: "1000002",
      amount: toDecimal(115000),
      checkoutUrl: "http://localhost:3000/api/v1/dev/mock-payments/ORD-DEMO-0002",
      qrCode: "mock://ORD-DEMO-0002",
      status: PaymentTransactionStatus.PAID,
      paidAt: paidWaitingOrder.paidAt,
    },
  });

  await prisma.walletLedger.upsert({
    where: {
      id: "seed-topup-ledger",
    },
    update: {},
    create: {
      id: "seed-topup-ledger",
      sellerId,
      walletId,
      type: WalletLedgerType.TOPUP,
      amount: toDecimal(3000000),
      balanceBefore: toDecimal(0),
      balanceAfter: toDecimal(3000000),
      referenceType: "seed",
      referenceId: "initial-balance",
      note: "Demo wallet topup",
    },
  });

  await prisma.depositRequest.upsert({
    where: {
      id: "seed-deposit-request",
    },
    update: {},
    create: {
      id: "seed-deposit-request",
      sellerId,
      amount: toDecimal(500000),
      status: DepositStatus.CONFIRMED,
      note: "Nạp demo đã duyệt",
    },
  });

  await prisma.withdrawRequest.upsert({
    where: {
      id: "seed-withdraw-request",
    },
    update: {},
    create: {
      id: "seed-withdraw-request",
      sellerId,
      amount: toDecimal(150000),
      bankName: "Vietcombank",
      bankAccountNumber: "0123456789",
      bankAccountName: "Demo Seller",
      status: WithdrawStatus.PENDING,
      note: "Rút demo đang chờ duyệt",
    },
  });
}

async function main() {
  const shouldSeedDemoData = String(process.env.SEED_DEMO_DATA || "false") === "true";

  const { user: adminUser } = await createUserWithSeller({
    email: process.env.SEED_SUPER_ADMIN_EMAIL || "thaidem57",
    password: process.env.SEED_SUPER_ADMIN_PASSWORD || "Thaikuku@1",
    displayName: "Platform Admin",
    role: UserRole.SUPER_ADMIN,
  });

  const { seller, shop, wallet } = await createUserWithSeller({
    email: process.env.SEED_SELLER_EMAIL || "j97shop",
    password: process.env.SEED_SELLER_PASSWORD || "Seller123!",
    displayName: process.env.SEED_SELLER_DISPLAY_NAME || "J97 SHOP",
    role: UserRole.SELLER,
    tier: SellerTier.PRO,
    walletBalance: Number(process.env.SEED_SELLER_WALLET_BALANCE || 0),
    botToken: process.env.SEED_SELLER_BOT_TOKEN || undefined,
    buyerKey: process.env.SEED_SELLER_PROVIDER_KEY || undefined,
  });

  if (!seller || !shop || !wallet) {
    throw new Error("Seller seed data was not created.");
  }

  const { seller: proSeller } = await createUserWithSeller({
    email: process.env.SEED_PRO_SELLER_EMAIL || "proseller",
    password: process.env.SEED_PRO_SELLER_PASSWORD || "ProSeller123!",
    displayName: process.env.SEED_PRO_SELLER_DISPLAY_NAME || "ULTRA SOURCE",
    role: UserRole.SELLER,
    tier: SellerTier.ULTRA,
    botToken: process.env.SEED_PRO_SELLER_BOT_TOKEN || undefined,
  });

  if (!proSeller) {
    throw new Error("PRO seller seed data was not created.");
  }

  if (shouldSeedDemoData) {
    await seedCatalog(shop.id, seller.id);
    await seedOrders(shop.id, seller.id, wallet.id);
  }

  console.log("Seed completed.");
  console.log(`Demo data: ${shouldSeedDemoData ? "enabled" : "disabled"}`);
  console.log(`Super admin: ${adminUser.email}`);
  console.log(`PRO seller:   ${process.env.SEED_SELLER_EMAIL || "j97shop"}`);
  console.log(`ULTRA seller: ${process.env.SEED_PRO_SELLER_EMAIL || "proseller"}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
