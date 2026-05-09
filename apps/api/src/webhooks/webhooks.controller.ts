import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { verifyPayOSWebhook } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { CustomerWalletService } from "../customer-wallet/customer-wallet.service";
import { PaymentService } from "../lib/payment.service";
import { TelegramBotService } from "../lib/telegram-bot.service.v2";
import { OrdersService } from "../orders/orders.service";
import { SellerSourceConnectionService } from "../seller/seller-source-connection.service";
import { ShopsService } from "../shops/shops.service";
import { UpgradeService } from "../upgrade/upgrade.service";
import { WalletService } from "../wallet/wallet.service";

@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    @Inject(CustomerWalletService)
    private readonly customerWalletService: CustomerWalletService,
    @Inject(WalletService)
    private readonly walletService: WalletService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(TelegramBotService)
    private readonly telegramBotService: TelegramBotService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(UpgradeService)
    private readonly upgradeService: UpgradeService,
    @Inject(SellerSourceConnectionService)
    private readonly connectionService: SellerSourceConnectionService,
  ) { }

  @Post("payos")
  async handlePayOS(@Body() body: Record<string, any>) {
    const payload = body.data || {};
    const signature = String(body.signature || "");
    const externalOrderCode = String(payload.orderCode || "");
    const checksumKey = externalOrderCode
      ? await this.paymentService.getPayOSChecksumKeyForExternalOrderCode(externalOrderCode)
      : process.env.PAYOS_CHECKSUM_KEY || "";

    if (this.config.nodeEnv === "production" && !checksumKey) {
      return { success: true };
    }

    if (checksumKey) {
      if (!signature) {
        return { success: true };
      }

      const isValid = verifyPayOSWebhook(payload, signature, checksumKey);

      if (!isValid) {
        return { success: true };
      }
    }

    if (!externalOrderCode) {
      return { success: true };
    }

    return this.processPaymentCompletion(externalOrderCode, body);
  }

  @Post("payos/reconcile/:externalOrderCode")
  async reconcilePayOS(
    @Param("externalOrderCode") externalOrderCode: string,
    @Body() body: { token?: string } | null,
    @Headers("x-reconcile-token") tokenHeader?: string,
  ) {
    const reconcileToken = String(body?.token || tokenHeader || "").trim();

    if (!this.paymentService.isValidPublicReconcileToken(externalOrderCode, reconcileToken)) {
      throw new NotFoundException("Not found.");
    }

    const paymentStatus = await this.paymentService.getExternalPaymentStatus(externalOrderCode);
    const providerStatus = String(paymentStatus.providerStatus || "UNKNOWN").toUpperCase();
    const isPaid =
      ["PAID", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(providerStatus) ||
      (Number(paymentStatus.amountPaid || 0) > 0 &&
        Number(paymentStatus.amount || 0) > 0 &&
        Number(paymentStatus.amountPaid || 0) >= Number(paymentStatus.amount || 0));

    if (!isPaid) {
      return {
        success: true,
        reconciled: false,
        ...paymentStatus,
      };
    }

    const completion = await this.processPaymentCompletion(externalOrderCode, {
      reconciledBy: "signed_public_reconcile",
      payos: paymentStatus.rawPayload,
    });

    return {
      ...completion,
      providerStatus,
    };
  }

  private async processPaymentCompletion(externalOrderCode: string, rawPayload?: unknown) {
    try {
      await this.ordersService.markPaymentCompleted(externalOrderCode, rawPayload);
      const paymentStatus = await this.paymentService.getExternalPaymentStatus(externalOrderCode);
      return {
        success: true,
        reconciled: true,
        kind: "order",
        provider: paymentStatus.provider,
        providerStatus: paymentStatus.providerStatus,
        localPaymentStatus: paymentStatus.localPaymentStatus,
        localOrderStatus: paymentStatus.localOrderStatus,
        failureReason: paymentStatus.failureReason,
      };
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    try {
      const topup = await this.customerWalletService.markTopupPaid(externalOrderCode, rawPayload);
      await this.telegramBotService.sendWalletTopupPaidMessage(
        topup.topup.shopId,
        topup.topup.amount,
        topup.balanceAfter,
        topup.customer.telegramChatId,
        topup.topup.externalOrderCode,
      );
      return {
        success: true,
        reconciled: true,
        kind: "customer_topup",
      };
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    // Thử upgrade tier trước (deposit request có note UPGRADE_TIER:...)
    try {
      const upgradeResult = await this.upgradeService.confirmUpgradeByExternalOrderCode(
        externalOrderCode,
        rawPayload,
      );
      if (upgradeResult) {
        return {
          success: true,
          reconciled: true,
          kind: "tier_upgrade",
          tier: upgradeResult.tier,
        };
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    try {
      await this.walletService.confirmDepositRequestByExternalOrderCode(externalOrderCode, rawPayload);
      return {
        success: true,
        reconciled: true,
        kind: "seller_deposit",
      };
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    try {
      const topup = await this.connectionService.markTopupPaid(externalOrderCode, rawPayload);
      await this.telegramBotService.sendConnectionTopupPaidMessage(
        topup.upstreamShopId,
        topup.downstreamShopId,
        topup.amount,
        topup.balanceAfter,
      );
      return {
        success: true,
        reconciled: true,
        kind: "connection_topup",
      };
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    return {
      success: true,
      reconciled: false,
    };
  }

  @Post("binancepay")
  async handleBinancePay(
    @Req() req: RawBodyRequest<Request>,
    @Headers("binancepay-timestamp") timestamp: string,
    @Headers("binancepay-nonce") nonce: string,
    @Headers("binancepay-certificate-sn") certSerial: string,
    @Headers("binancepay-signature") signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    const rawBody = req.rawBody
      ? req.rawBody.toString("utf-8")
      : JSON.stringify(body);

    let externalOrderCode: string;
    let bizStatus: string;
    let rawData: unknown;

    try {
      const verified = await this.paymentService.verifyBinancePayWebhook(
        { timestamp, nonce, certSerial, signature },
        rawBody,
      );
      externalOrderCode = verified.externalOrderCode;
      bizStatus = verified.bizStatus;
      rawData = verified.rawData;
    } catch (error) {
      if (this.isIgnorableBinancePayWebhookError(error)) {
        return this.buildBinancePayWebhookResponse("SUCCESS");
      }

      return this.buildBinancePayWebhookResponse(
        "FAIL",
        error instanceof Error ? error.message : "Internal processing error.",
      );
    }

    if (bizStatus !== "PAY_SUCCESS") {
      return this.buildBinancePayWebhookResponse("SUCCESS");
    }

    try {
      const completion = await this.processPaymentCompletion(externalOrderCode, rawData);

      if (!completion.reconciled) {
        return this.buildBinancePayWebhookResponse(
          "FAIL",
          "Verified notification but no local payment target was reconciled.",
        );
      }

      return this.buildBinancePayWebhookResponse("SUCCESS");
    } catch (error) {
      return this.buildBinancePayWebhookResponse(
        "FAIL",
        error instanceof Error ? error.message : "Internal processing error.",
      );
    }
  }

  private buildBinancePayWebhookResponse(
    returnCode: "SUCCESS" | "FAIL",
    returnMessage: string | null = null,
  ) {
    return {
      returnCode,
      returnMessage,
    };
  }

  private isIgnorableBinancePayWebhookError(error: unknown) {
    const message =
      error instanceof BadRequestException
        ? String(error.message || "")
        : error instanceof Error
          ? String(error.message || "")
          : "";

    return message === "Binance Pay webhook signature verification failed.";
  }

  @Post("telegram/:shopId")
  async handleTelegram(
    @Param("shopId") shopId: string,
    @Headers("x-telegram-bot-api-secret-token") secretToken: string,
    @Body() body: Record<string, any>,
  ) {
    if (!this.shopsService.isValidTelegramWebhookSecret(shopId, secretToken)) {
      throw new NotFoundException("Not found.");
    }

    try {
      await this.telegramBotService.handleIncomingUpdate(shopId, body);
    } catch (error) {
      this.logger.error(`handleIncomingUpdate failed for shop ${shopId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { success: true };
  }

  @Post("source-stock/:webhookKey")
  async handleSourceStock(
    @Param("webhookKey") webhookKey: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.shopsService.handleSourceCatalogWebhook(webhookKey, body);
  }
}
