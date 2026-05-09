import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";

import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { BroadcastsController } from "./broadcasts/broadcasts.controller";
import { BroadcastsService } from "./broadcasts/broadcasts.service";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { SellerCapabilitiesGuard } from "./common/guards/seller-capabilities.guard";
import { SellerTierGuard } from "./common/guards/seller-tier.guard";
import { SellerCapabilityService } from "./seller/seller-capability.service";
import { InternalSourceApiKeyService } from "./source/internal-source-api-key.service";
import { SellerSourceConnectionController } from "./seller/seller-source-connection.controller";
import { SellerSourceConnectionService } from "./seller/seller-source-connection.service";
import { InternalSourceAuthMiddleware } from "./source/internal-source-auth.middleware";
import { InternalSourceApiController } from "./source/internal-source-api.controller";
import { DownstreamSourceConnectionService } from "./source/downstream-source-connection.service";
import { SourceProductController } from "./source/source-product.controller";
import { SourceProductService } from "./source/source-product.service";
import { StockAlertService } from "./source/stock-alert.service";
import { AppConfigService } from "./config/app-config.service";
import { CustomerWalletService } from "./customer-wallet/customer-wallet.service";
import { PrismaService } from "./db/prisma.service";
import { DevController } from "./dev/dev.controller.v2";
import { InternalController } from "./internal/internal.controller";
import { InternalSourceController } from "./internal-source/internal-source.controller";
import { InternalSourceService } from "./internal-source/internal-source.service";
import { PaymentService } from "./lib/payment.service";
import { BinancePayService } from "./lib/binance-pay.service";
import { OnchainPaymentService } from "./lib/onchain-payment.service";
import { QueueService } from "./lib/queue.service";
import { TelegramBotService } from "./lib/telegram-bot.service.v2";
import { OrdersController } from "./orders/orders.controller";
import { OrdersService } from "./orders/orders.service";
import { ProductsController } from "./products/products.controller";
import { ProductsService } from "./products/products.service";
import { ReportsController } from "./reports/reports.controller";
import { ReportsService } from "./reports/reports.service";
import { ShopsController } from "./shops/shops.controller";
import { ShopsService } from "./shops/shops.service";
import { WalletController } from "./wallet/wallet.controller";
import { WalletService } from "./wallet/wallet.service";
import { WebhooksController } from "./webhooks/webhooks.controller";
import { UpgradeController } from "./upgrade/upgrade.controller";
import { UpgradeService } from "./upgrade/upgrade.service";
import { ProAnalyticsController } from "./pro/pro-analytics.controller";
import { ProAnalyticsService } from "./pro/pro-analytics.service";
import { WarrantyController } from "./warranty/warranty.controller";
import { WarrantyPublicController } from "./warranty/warranty-public.controller";
import { WarrantyService } from "./warranty/warranty.service";
import { AffiliateController } from "./affiliate/affiliate.controller";
import { AffiliateService } from "./affiliate/affiliate.service";
import { AdminController } from "./admin/admin.controller";
import { AdminService } from "./admin/admin.service";

@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
  ],
  controllers: [
    AuthController,
    ShopsController,
    ProductsController,
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
    ProAnalyticsController,
    AffiliateController,
    DevController,
    AdminController,
  ],
  providers: [
    AppConfigService,
    PrismaService,
    QueueService,
    BinancePayService,
    OnchainPaymentService,
    PaymentService,
    TelegramBotService,
    AuthService,
    ShopsService,
    CustomerWalletService,
    ProductsService,
    WalletService,
    WarrantyService,
    OrdersService,
    ReportsService,
    BroadcastsService,
    InternalSourceService,
    UpgradeService,
    Reflector,
    JwtAuthGuard,
    RolesGuard,
    SellerCapabilitiesGuard,
    SellerTierGuard,
    SellerCapabilityService,
    InternalSourceApiKeyService,
    InternalSourceAuthMiddleware,
    SellerSourceConnectionService,
    DownstreamSourceConnectionService,
    SourceProductService,
    StockAlertService,
    ProAnalyticsService,
    AffiliateService,
    AdminService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(InternalSourceAuthMiddleware)
      .forRoutes({ path: "internal-source/v1*path", method: RequestMethod.ALL });
  }
}
