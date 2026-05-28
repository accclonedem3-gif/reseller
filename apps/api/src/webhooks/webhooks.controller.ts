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
import { verifyPay2sIpnSignature, verifyPayOSWebhook } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { CustomerWalletService } from "../customer-wallet/customer-wallet.service";
import { PaymentService } from "../lib/payment.service";
import { TelegramBotService } from "../lib/telegram-bot.service.v2";
import { OrdersService } from "../orders/orders.service";
import { SellerSourceConnectionService } from "../seller/seller-source-connection.service";
import { ShopsService } from "../shops/shops.service";
import { UpgradeService } from "../upgrade/upgrade.service";
import { TiersService } from "../tiers/tiers.service";
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
    @Inject(TiersService)
    private readonly tiersService: TiersService,
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

  @Post("web2m")
  async handleWeb2m(
    @Body() body: Record<string, any>,
    @Headers("authorization") authHeader?: string,
  ) {
    this.logger.log(`[web2m] incoming webhook, has-data=${Array.isArray(body?.data)}, count=${Array.isArray(body?.data) ? body.data.length : 0}`);
    if (!body || body.status !== true || !Array.isArray(body.data)) {
      this.logger.warn(`[web2m] Invalid payload: ${JSON.stringify(body).slice(0, 200)}`);
      return { status: false, msg: "Invalid payload" };
    }

    const bearer = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      this.logger.warn(`[web2m] Missing token`);
      return { status: false, msg: "Missing token" };
    }

    const matchingConfig = await this.paymentService.findShopByWeb2mAccessToken(bearer);
    if (!matchingConfig) {
      this.logger.warn(`[web2m] Token not found for bearer=${bearer.slice(0, 8)}...`);
      return { status: false, msg: "Invalid token" };
    }

    const shopId = matchingConfig.shopId;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pending = await this.paymentService.listPendingWeb2mPayments(shopId, since);
    this.logger.log(`[web2m] shop=${shopId} pending=${pending.length}`);

    for (const txn of body.data as any[]) {
      const type = String(txn.type || "").toUpperCase();
      const amount = Number(txn.amount || 0);
      const description = String(txn.description || "");
      this.logger.log(`[web2m] txn type=${type} amount=${amount} desc="${description}"`);
      if (type !== "IN") {
        this.logger.log(`[web2m] skip (not IN)`);
        continue;
      }
      if (amount <= 0) {
        this.logger.log(`[web2m] skip (amount<=0)`);
        continue;
      }
      const normalized = description.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!normalized) {
        this.logger.log(`[web2m] skip (empty desc)`);
        continue;
      }

      let matched = false;
      for (const p of pending as Array<{ externalOrderCode: string; amount: any; orderCode?: string | null }>) {
        const codes: string[] = [];
        if (p.externalOrderCode) codes.push(String(p.externalOrderCode).toUpperCase().replace(/[^A-Z0-9]/g, ""));
        if (p.orderCode) codes.push(String(p.orderCode).toUpperCase().replace(/[^A-Z0-9]/g, ""));
        let codeMatches = false;
        for (const c of codes) {
          if (!c) continue;
          const last6 = c.slice(-6);
          if (normalized.includes(c) || (last6.length === 6 && normalized.includes(last6))) {
            codeMatches = true;
            break;
          }
        }
        const amountMatches = Math.abs(Number(p.amount) - amount) <= 1;
        this.logger.log(`[web2m] try ext=${p.externalOrderCode} order=${p.orderCode || "-"} amount=${Number(p.amount)} codeMatches=${codeMatches} amountMatches=${amountMatches}`);
        if (codeMatches && amountMatches) {
          this.logger.log(`[web2m] MATCH! mark PAID for ${p.externalOrderCode}`);
          await this.processPaymentCompletion(p.externalOrderCode, { web2m: true, txn }).catch((e) => this.logger.error(`[web2m] processPaymentCompletion fail: ${e}`));
          matched = true;
          break;
        }
      }
      if (!matched) {
        this.logger.warn(`[web2m] No matching pending payment for desc="${description}" amount=${amount}`);
      }
    }

    return { status: true, msg: "Ok" };
  }

  @Post("pay2s")
  async handlePay2s(
    @Body() body: Record<string, any>,
    @Headers("authorization") authHeader?: string,
  ) {
    // Detect format: IPN (payment link confirmation) vs Balance webhook (bank account credit)
    const isIpn = body.signature !== undefined && body.resultCode !== undefined;
    const isBalanceWebhook =
      body.transferType !== undefined && body.transferAmount !== undefined && body.content !== undefined;

    if (isIpn) {
      return this.handlePay2sIpn(body);
    }
    if (isBalanceWebhook) {
      return this.handlePay2sBalanceWebhook(body, authHeader);
    }
    return { success: true };
  }

  private async handlePay2sIpn(body: Record<string, any>) {
    const externalOrderCode = String(body.orderId || body.requestId || "");
    if (!externalOrderCode) return { success: true };

    const creds = await this.paymentService.getPay2sCredentialsForExternalOrderCode(externalOrderCode);
    if (this.config.nodeEnv === "production" && (!creds || !creds.accessKey || !creds.secretKey)) {
      return { success: true };
    }

    if (creds?.accessKey && creds.secretKey) {
      const ok = verifyPay2sIpnSignature(body, creds.accessKey, creds.secretKey, "signature");
      if (!ok) return { success: true };
    }

    const resultCode = Number(body.resultCode);
    if (resultCode !== 0) {
      return { success: true };
    }

    return this.processPaymentCompletion(externalOrderCode, body);
  }

  private async handlePay2sBalanceWebhook(
    body: Record<string, any>,
    authHeader?: string,
  ) {
    const transferType = String(body.transferType || "").toUpperCase();
    if (transferType !== "IN") {
      return { success: true }; // ignore outgoing transfers
    }

    const content = String(body.content || "");
    const amount = Number(body.transferAmount || 0);
    if (!content || amount <= 0) return { success: true };

    const matched = await this.paymentService.findPay2sPendingByContent(content, amount);
    if (!matched) return { success: true };

    // Verify Bearer token against shop's secret key
    const creds = await this.paymentService.getPay2sCredentialsForExternalOrderCode(matched);
    if (this.config.nodeEnv === "production") {
      if (!authHeader || !creds.secretKey) return { success: true };
      const expected = `Bearer ${creds.secretKey}`;
      if (authHeader !== expected) return { success: true };
    }

    return this.processPaymentCompletion(matched, { source: "pay2s_balance_webhook", ...body });
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

  @Post("internal-crypto-confirm/:externalOrderCode")
  async internalCryptoConfirm(
    @Param("externalOrderCode") externalOrderCode: string,
    @Headers("x-internal-token") tokenHeader: string,
    @Body() body: { signature?: string; amountUsdt?: number; source?: string },
  ) {
    if (!tokenHeader || tokenHeader !== this.config.internalApiToken) {
      throw new NotFoundException("Not found.");
    }
    return this.processPaymentCompletion(externalOrderCode, {
      source: body?.source || "internal_crypto_auto_scan",
      signature: body?.signature,
      amountUsdt: body?.amountUsdt,
      detectedAt: new Date().toISOString(),
    });
  }

  async processPaymentCompletion(externalOrderCode: string, rawPayload?: unknown) {
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

    // Thử tier subscription mới (deposit có note TIER_SUB:...)
    try {
      const tierSubResult = await this.tiersService.confirmFromExternalOrderCode(
        externalOrderCode,
        rawPayload,
      );
      if (tierSubResult) {
        return {
          success: true,
          reconciled: true,
          kind: "tier_subscription",
          ...tierSubResult,
        };
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    // Thử upgrade tier cũ (deposit request có note UPGRADE_TIER:...) — legacy fallback
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
