import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { verifyPay2sIpnSignature, verifyPayOSWebhook } from "@reseller/shared/server";
import { PaymentProvider } from "@prisma/client";
import { SkipThrottle } from "@nestjs/throttler";

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

// Payment-provider IPNs (PayOS / Pay2s / Web2m / BinancePay) are signature-verified and can arrive
// in bursts from a single provider IP — a per-IP throttle here would drop legitimate callbacks and
// lose payment confirmations. Exempt the whole controller; signature checks are the real gate.
@SkipThrottle()
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

  @Get("paypal/return/:externalOrderCode")
  async handlePaypalReturn(
    @Param("externalOrderCode") externalOrderCode: string,
    @Query("state") state: string | undefined,
    @Query("token") paypalOrderId: string | undefined,
    @Res() response: Response,
  ) {
    const successUrl = new URL("/payments/success", this.config.webPublicUrl);
    const cancelUrl = new URL("/payments/cancel", this.config.webPublicUrl);
    const reconcileToken = this.paymentService.buildPublicReconcileToken(externalOrderCode);
    const botUsername = await this.paymentService.getTelegramBotUsernameForExternalOrderCode(externalOrderCode);
    for (const url of [successUrl, cancelUrl]) {
      url.searchParams.set("orderCode", externalOrderCode);
      url.searchParams.set("rt", reconcileToken);
      url.searchParams.set("provider", "paypal");
      if (botUsername) url.searchParams.set("bot", botUsername);
    }

    if (
      !paypalOrderId
      || !this.paymentService.isValidPaypalReturnState(externalOrderCode, state)
    ) {
      cancelUrl.searchParams.set("reason", "paypal_invalid_return");
      return response.redirect(302, cancelUrl.toString());
    }

    try {
      const paymentStatus = await this.paymentService.reconcilePaypalOrder(
        externalOrderCode,
        paypalOrderId,
      );
      if (String(paymentStatus.providerStatus || "").toUpperCase() === "COMPLETED") {
        await this.processPaymentCompletion(externalOrderCode, {
          source: "paypal_return_capture",
          paypal: paymentStatus.rawPayload,
        });
      }
      return response.redirect(302, successUrl.toString());
    } catch (error) {
      this.logger.error(
        `[paypal] return failed for ${externalOrderCode}: ${error instanceof Error ? error.message : String(error)}`,
      );
      cancelUrl.searchParams.set("reason", "paypal_capture_failed");
      return response.redirect(302, cancelUrl.toString());
    }
  }

  @Post("paypal/:shopId")
  async handlePaypalWebhook(
    @Param("shopId") shopId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: Record<string, unknown>,
  ) {
    const verified = await this.paymentService.verifyPaypalWebhook(shopId, headers, body);
    if (!verified) {
      throw new UnauthorizedException("Invalid PayPal webhook signature.");
    }

    const eventType = String(body?.event_type || "").toUpperCase();
    if (!["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"].includes(eventType)) {
      return { success: true, ignored: true };
    }
    const externalOrderCode = await this.paymentService.resolvePaypalWebhookExternalOrderCode(body);
    if (!externalOrderCode) {
      this.logger.warn(`[paypal] verified ${eventType} webhook has no matching local order`);
      return { success: true, ignored: true };
    }

    const paymentStatus = await this.paymentService.reconcilePaypalOrder(
      externalOrderCode,
      null,
      shopId,
    );
    if (String(paymentStatus.providerStatus || "").toUpperCase() !== "COMPLETED") {
      return {
        success: true,
        reconciled: false,
        providerStatus: paymentStatus.providerStatus,
      };
    }
    return this.processPaymentCompletion(externalOrderCode, {
      source: "paypal_verified_webhook",
      eventId: body?.id,
      eventType,
      paypal: paymentStatus.rawPayload,
    });
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
    // Detect format: IPN (payment-link confirmation) vs Balance webhook (bank-account credit).
    // Pay2s IPN carries `m2signature` (NOT `signature`) + resultCode.
    const isIpn = body.resultCode !== undefined && (body.m2signature !== undefined || body.signature !== undefined);
    const isBalanceWebhook =
      Array.isArray(body.transactions) ||
      (body.transferType !== undefined && body.transferAmount !== undefined && body.content !== undefined);

    this.logger.log(
      `[pay2s] webhook isIpn=${isIpn} isBalance=${isBalanceWebhook} order=${body.orderId ?? body.requestId ?? "?"} resultCode=${body.resultCode ?? "?"} keys=${Object.keys(body || {}).join(",")}`,
    );

    if (isIpn) {
      return this.handlePay2sIpn(body);
    }
    if (isBalanceWebhook) {
      return this.handlePay2sBalanceWebhook(body, authHeader);
    }
    this.logger.warn(`[pay2s] webhook not recognized as IPN or balance — ignored`);
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
      const matched = verifyPay2sIpnSignature(body, creds.accessKey, creds.secretKey);
      if (!matched) {
        this.logger.warn(`[pay2s] IPN signature mismatch for ${externalOrderCode} — not confirming`);
        return { success: true };
      }
      this.logger.log(`[pay2s] IPN signature OK for ${externalOrderCode} (formula=${matched})`);
    }

    const resultCode = Number(body.resultCode);
    if (resultCode !== 0) {
      this.logger.warn(`[pay2s] IPN resultCode=${resultCode} (not success) for ${externalOrderCode}`);
      return { success: true };
    }

    this.logger.log(`[pay2s] IPN verified + success → confirming ${externalOrderCode}`);
    return this.processPaymentCompletion(externalOrderCode, body);
  }

  private async handlePay2sBalanceWebhook(
    body: Record<string, any>,
    authHeader?: string,
  ) {
    // Pay2s posts { transactions: [ { content, transferType:"IN", transferAmount, ... } ] } with
    // "Authorization: Bearer <token>" — <token> is the per-shop value the seller declared when
    // creating the Hook (saved encrypted in PaymentConfig.pay2sWebhookToken). We match each tx to a
    // pending order first (which identifies the shop), then verify the Bearer token against THAT
    // shop's stored token.
    const txs: any[] = Array.isArray(body.transactions)
      ? body.transactions
      : body.transferAmount !== undefined || body.content !== undefined
        ? [body]
        : [];

    let confirmed = 0;
    for (const tx of txs) {
      const transferType = String(tx.transferType || "IN").toUpperCase();
      if (transferType === "OUT") continue; // ignore outgoing
      const content = String(tx.content || "");
      const amount = Number(tx.transferAmount || 0);
      if (!content || amount <= 0) continue;

      const matched = await this.paymentService.findPay2sPendingByContent(content, amount);
      if (!matched) {
        this.logger.log(`[pay2s] balance tx no match content="${content}" amount=${amount}`);
        continue;
      }

      if (this.config.nodeEnv === "production") {
        const token = await this.paymentService.getPay2sWebhookTokenForExternalOrderCode(matched);
        if (!token || authHeader !== `Bearer ${token}`) {
          this.logger.warn(`[pay2s] balance webhook: bad/missing Bearer token for ${matched} — ignoring`);
          continue;
        }
      }

      this.logger.log(`[pay2s] balance tx matched ${matched} (amount=${amount}) → confirming`);
      try {
        await this.processPaymentCompletion(matched, { source: "pay2s_balance_webhook", ...tx });
        confirmed++;
      } catch (error) {
        this.logger.error(`[pay2s] balance confirm failed for ${matched}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { success: true, confirmed };
  }

  @Post(["payments/reconcile/:externalOrderCode", "payos/reconcile/:externalOrderCode"])
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
    @Body() body: {
      provider?: string;
      txHash?: string;
      signature?: string;
      amountUsdt?: number;
      destination?: string;
      transactionAt?: string;
      source?: string;
      chainPayload?: unknown;
    },
  ) {
    if (!tokenHeader || tokenHeader !== this.config.internalApiToken) {
      throw new NotFoundException("Not found.");
    }
    const provider = String(body?.provider || "").trim().toUpperCase() as PaymentProvider;
    const txHash = String(body?.txHash || body?.signature || "").trim();
    const destination = String(body?.destination || "").trim();
    const amountUsdt = Number(body?.amountUsdt || 0);
    const transactionAt = new Date(String(body?.transactionAt || ""));
    // Backward-compatible path for the existing Binance/OKX/TRC20/Solana worker calls.
    // TON additionally uses the durable receipt claim below to prevent cross-table replay.
    if (provider !== PaymentProvider.USDT_TON) {
      return this.processPaymentCompletion(externalOrderCode, {
        source: body?.source || "internal_crypto_auto_scan",
        signature: body?.signature,
        amountUsdt: body?.amountUsdt,
        detectedAt: new Date().toISOString(),
      });
    }
    if (!txHash || !destination || !Number.isFinite(amountUsdt)) {
      throw new BadRequestException("Invalid internal on-chain confirmation payload.");
    }
    if (!Number.isFinite(transactionAt.getTime())) {
      throw new BadRequestException("Invalid on-chain transaction time.");
    }

    const confirmationPayload = {
      source: body?.source || "internal_crypto_auto_scan",
      provider,
      signature: txHash,
      txHash,
      amountUsdt,
      destination,
      transactionAt: transactionAt.toISOString(),
      chainPayload: body?.chainPayload,
      detectedAt: new Date().toISOString(),
    };
    const receipt = await this.paymentService.claimOnchainPaymentReceipt({
      provider,
      txHash,
      externalOrderCode,
      amountUsdt,
      destination,
      transactionAt,
      rawPayload: confirmationPayload,
    });
    const completion = await this.processPaymentCompletion(externalOrderCode, confirmationPayload);
    if (completion.reconciled) {
      await this.paymentService.markOnchainPaymentReceiptProcessed(receipt.id, confirmationPayload);
    }
    return completion;
  }

  async processPaymentCompletion(externalOrderCode: string, rawPayload?: unknown) {
    const rawPayloadObject = rawPayload && typeof rawPayload === "object"
      ? rawPayload as Record<string, unknown>
      : null;
    const cryptoTxHash = String(rawPayloadObject?.txHash || rawPayloadObject?.signature || "").trim() || null;
    try {
      await this.ordersService.markPaymentCompleted(externalOrderCode, rawPayload, { cryptoTxHash });
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
      const topup = await this.customerWalletService.markTopupPaid(externalOrderCode, rawPayload, { cryptoTxHash });
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
