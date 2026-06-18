import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { BroadcastsController } from "./broadcasts/broadcasts.controller";
import { BroadcastsService } from "./broadcasts/broadcasts.service";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { SellerCapabilitiesGuard } from "./common/guards/seller-capabilities.guard";
import { SellerTierGuard } from "./common/guards/seller-tier.guard";
import { InternalSourceApiKeyService } from "./source/internal-source-api-key.service";
import { SellerSourceConnectionController } from "./seller/seller-source-connection.controller";
import { SellerSourceConnectionService } from "./seller/seller-source-connection.service";
import { InternalSourceAuthMiddleware } from "./source/internal-source-auth.middleware";
import { InternalSourceApiController } from "./source/internal-source-api.controller";
import { SourceProductController } from "./source/source-product.controller";
import { SourceProductService } from "./source/source-product.service";
import { StockAlertService } from "./source/stock-alert.service";
import { AppConfigService } from "./config/app-config.service";
import { CustomerWalletService } from "./customer-wallet/customer-wallet.service";
import { WalletNotifyService } from "./customer-wallet/wallet-notify.service";
import { PrismaService } from "./db/prisma.service";
import { DevController } from "./dev/dev.controller.v2";
import { InternalController } from "./internal/internal.controller";
import { InternalSourceController } from "./internal-source/internal-source.controller";
import { InternalSourceService } from "./internal-source/internal-source.service";
import { PaymentService } from "./lib/payment.service";
import { BinancePayService } from "./lib/binance-pay.service";
import { OkxPersonalApiService } from "./lib/okx-personal-api.service";
import { OnchainPaymentService } from "./lib/onchain-payment.service";
import { SolanaPaymentService } from "./lib/solana-payment.service";
import { QueueService } from "./lib/queue.service";
import { TelegramBotService } from "./lib/telegram-bot.service.v2";
import { TelegramClientService } from "./lib/telegram-client.service";
import { BotSessionStore } from "./lib/bot-session.store";
import { BotRenderHelpers } from "./lib/bot-render.helpers";
import { OrdersController } from "./orders/orders.controller";
import { OrdersService } from "./orders/orders.service";
import { ProductsController } from "./products/products.controller";
import { ProductsService } from "./products/products.service";
import { ProductsStockController } from "./products-stock/products-stock.controller";
import { ProductsStockService } from "./products-stock/products-stock.service";
import { SourceStockController } from "./source-stock/source-stock.controller";
import { SourceStockService } from "./source-stock/source-stock.service";
import { ReportsController } from "./reports/reports.controller";
import { ReportsService } from "./reports/reports.service";
import { ShopsController } from "./shops/shops.controller";
import { ShopsService } from "./shops/shops.service";
import { WalletController } from "./wallet/wallet.controller";
import { WalletService } from "./wallet/wallet.service";
import { WalletPromotionService } from "./wallet/wallet-promotion.service";
import { WebhooksController } from "./webhooks/webhooks.controller";
import { UpgradeController } from "./upgrade/upgrade.controller";
import { UpgradeService } from "./upgrade/upgrade.service";
import { ProAnalyticsController } from "./pro/pro-analytics.controller";
import { ProAnalyticsService } from "./pro/pro-analytics.service";
import { WarrantyController } from "./warranty/warranty.controller";
import { WarrantyPublicController } from "./warranty/warranty-public.controller";
import { WarrantyService } from "./warranty/warranty.service";
import { WarrantyAutoCheckService } from "./warranty/warranty-auto-check.service";
import { WarrantyAbuseService } from "./warranty/warranty-abuse.service";
import { CacheService } from "./lib/cache.service";
import { IdempotencyService } from "./lib/idempotency.service";
import { AffiliateController } from "./affiliate/affiliate.controller";
import { AffiliateService } from "./affiliate/affiliate.service";
import { AdminController } from "./admin/admin.controller";
import { AdminService } from "./admin/admin.service";
import { CustomersController } from "./customers/customers.controller";
import { CustomersService } from "./customers/customers.service";
import { CatalogGroupsController } from "./catalog-groups/catalog-groups.controller";
import { CatalogGroupsService } from "./catalog-groups/catalog-groups.service";
import { IconCatalogController } from "./icon-catalog/icon-catalog.controller";
import { IconCatalogService } from "./icon-catalog/icon-catalog.service";
import { MiniAppController } from "./mini-app/mini-app.controller";
import { MiniAppService } from "./mini-app/mini-app.service";
import { GramJsService } from "./lib/gramjs.service";
import { TiersController } from "./tiers/tiers.controller";
import { TiersService } from "./tiers/tiers.service";
import { TierAffiliateService } from "./tiers/tier-affiliate.service";
import { AdminTemplateController } from "./admin-template/admin-template.controller";
import { AdminTemplateService } from "./admin-template/admin-template.service";
import { DiscountCodesController } from "./discount-codes/discount-codes.controller";
import { DiscountCodesService } from "./discount-codes/discount-codes.service";
import { ProductFamilyController, AdminProductFamilyController } from "./product-family/product-family.controller";
import { ProductFamilyService } from "./product-family/product-family.service";
import { AdminNotifyService } from "./lib/admin-notify.service";
import { MailService } from "./lib/mail.service";

@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
  ],
  controllers: [
    AuthController,
    ShopsController,
    ProductsController,
    ProductsStockController,
    SourceStockController,
    OrdersController,
    WalletController,
    ReportsController,
    BroadcastsController,
    WebhooksController,
    WarrantyController,
    WarrantyPublicController,
    InternalController,
    InternalSourceController,
    InternalSourceApiController,
    SellerSourceConnectionController,
    SourceProductController,
    UpgradeController,
    TiersController,
    ProAnalyticsController,
    AffiliateController,
    DevController,
    AdminController,
    CustomersController,
    CatalogGroupsController,
    IconCatalogController,
    MiniAppController,
    AdminTemplateController,
    DiscountCodesController,
    ProductFamilyController,
    AdminProductFamilyController,
  ],
  providers: [
    // Global L7 rate limit (default 100 req/min/IP from ThrottlerModule.forRoot). Per-route
    // @Throttle still overrides (e.g. login 5/min); @SkipThrottle exempts internal + webhook
    // routes so the worker/payment-IPN traffic never throttles itself.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AppConfigService,
    PrismaService,
    QueueService,
    BinancePayService,
    OkxPersonalApiService,
    OnchainPaymentService,
    SolanaPaymentService,
    PaymentService,
    TelegramClientService,
    BotSessionStore,
    BotRenderHelpers,
    TelegramBotService,
    AuthService,
    ShopsService,
    CustomerWalletService,
    WalletNotifyService,
    ProductsService,
    ProductsStockService,
    SourceStockService,
    WalletService,
    WalletPromotionService,
    WarrantyService,
    WarrantyAutoCheckService,
    WarrantyAbuseService,
    CacheService,
    IdempotencyService,
    OrdersService,
    ReportsService,
    BroadcastsService,
    InternalSourceService,
    UpgradeService,
    TiersService,
    TierAffiliateService,
    Reflector,
    JwtAuthGuard,
    RolesGuard,
    SellerCapabilitiesGuard,
    SellerTierGuard,
    InternalSourceApiKeyService,
    InternalSourceAuthMiddleware,
    SellerSourceConnectionService,
    SourceProductService,
    StockAlertService,
    ProAnalyticsService,
    AffiliateService,
    AdminService,
    CustomersService,
    CatalogGroupsService,
    IconCatalogService,
    MiniAppService,
    GramJsService,
    AdminTemplateService,
    DiscountCodesService,
    MailService,
    AdminNotifyService,
    ProductFamilyService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(InternalSourceAuthMiddleware)
      .forRoutes({ path: "internal-source/v1*path", method: RequestMethod.ALL });
  }
}
