import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { OrdersService } from "../orders/orders.service";
import { TelegramBotService } from "../lib/telegram-bot.service.v2";
import { AppConfigService } from "../config/app-config.service";
import { BinancePayService } from "../lib/binance-pay.service";

@Controller("dev")
export class DevController {
  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    @Inject(TelegramBotService)
    private readonly telegramBotService: TelegramBotService,
    @Inject(BinancePayService)
    private readonly binancePayService: BinancePayService,
  ) {}

  @Get("mock-payments/:externalOrderCode")
  async getMockPaymentPage(
    @Param("externalOrderCode") externalOrderCode: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    this.ensureDevEndpointEnabled(request);

    response.type("html").send(`
      <html lang="vi">
        <head>
          <meta charset="utf-8" />
          <title>Thanh toán mô phỏng</title>
          <style>
            body { font-family: Arial, sans-serif; background: #050816; color: #fff; padding: 32px; }
            .card { max-width: 520px; margin: 0 auto; padding: 24px; border-radius: 24px; background: #0d1326; box-shadow: 0 30px 80px rgba(0,0,0,.4); }
            button { background: #22c55e; color: #00110a; border: 0; padding: 14px 18px; border-radius: 12px; font-weight: 700; cursor: pointer; width: 100%; }
            code { color: #38bdf8; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Trang thanh toán mô phỏng</h1>
            <p>Mã thanh toán: <code>${externalOrderCode}</code></p>
            <p>Trang này dùng để giả lập callback thanh toán local khi hệ thống đang chạy ở chế độ mock.</p>
            <form method="post" action="/api/v1/dev/mock-payments/${externalOrderCode}/confirm">
              <button type="submit">Xác nhận thanh toán thành công</button>
            </form>
          </div>
        </body>
      </html>
    `);
  }

  @Post("mock-payments/:externalOrderCode/confirm")
  async confirmMockPayment(
    @Param("externalOrderCode") externalOrderCode: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    this.ensureDevEndpointEnabled(request);

    const order = await this.ordersService.markPaymentCompleted(externalOrderCode, {
      mock: true,
      externalOrderCode,
    });

    response.type("html").send(`
      <html lang="vi">
        <head>
          <meta charset="utf-8" />
          <title>Xác nhận thanh toán</title>
        </head>
        <body style="font-family: Arial, sans-serif; background: #050816; color: #fff; padding: 32px;">
          <h1>Thanh toán đã được xác nhận</h1>
          <p>Đơn hàng: ${order.orderCode}</p>
          <p>Trạng thái hiện tại: ${order.status}</p>
          <p>Bạn có thể quay lại Telegram hoặc dashboard để xem tiến trình xử lý.</p>
        </body>
      </html>
    `);
  }

  @Post("telegram/:shopId/simulate")
  async simulateTelegram(
    @Param("shopId") shopId: string,
    @Req() request: Request,
    @Body()
    body: {
      text?: string;
      callbackData?: string;
      telegramUserId?: string;
      telegramUsername?: string;
      firstName?: string;
      lastName?: string;
    },
  ) {
    this.ensureDevEndpointEnabled(request);

    const update = body.callbackData
      ? {
          callback_query: {
            id: `mock-callback-${Date.now()}`,
            data: body.callbackData,
            from: {
              id: body.telegramUserId || "9988776655",
              username: body.telegramUsername || "demo_buyer",
              first_name: body.firstName || "Demo",
              last_name: body.lastName || "Buyer",
            },
            message: {
              chat: {
                id: body.telegramUserId || "9988776655",
              },
              message_id: 1,
            },
          },
        }
      : {
          message: {
            text: body.text || "/start",
            chat: {
              id: body.telegramUserId || "9988776655",
            },
            from: {
              id: body.telegramUserId || "9988776655",
              username: body.telegramUsername || "demo_buyer",
              first_name: body.firstName || "Demo",
              last_name: body.lastName || "Buyer",
            },
          },
        };

    return this.telegramBotService.handleIncomingUpdate(shopId, update, {
      simulateOnly: true,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Binance Pay dev / test endpoints
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Test HMAC-SHA512 signing without hitting real Binance API.
   * POST /api/v1/dev/binancepay/test-signing
   * Body: { apiKey: string, secretKey: string, sampleBody?: string }
   */
  @Post("binancepay/test-signing")
  async testBinancePaySigning(
    @Req() request: Request,
    @Body() body: { apiKey?: string; secretKey?: string; sampleBody?: string },
  ) {
    this.ensureDevEndpointEnabled(request);

    const apiKey = body.apiKey || "TEST_API_KEY";
    const secretKey = body.secretKey || "TEST_SECRET_KEY";
    const sampleBody = body.sampleBody || JSON.stringify({
      env: { terminalType: "WEB" },
      merchantTradeNo: "RSP12345678901234",
      orderAmount: "1.00",
      currency: "USDT",
      description: "Test order",
      webhookUrl: "https://example.com/webhooks/binancepay",
    });

    const timestamp = String(Date.now());
    const nonce = "TESTNONCE1234567890ABCDEF123456";
    const signature = this.binancePayService.buildSignature(timestamp, nonce, sampleBody, secretKey);

    return {
      ok: true,
      explanation: "Signing test — no real API call made",
      inputs: {
        timestamp,
        nonce,
        bodyLength: sampleBody.length,
        secretKeyLength: secretKey.length,
      },
      headers: {
        "BinancePay-Timestamp": timestamp,
        "BinancePay-Nonce": nonce,
        "BinancePay-Certificate-SN": apiKey,
        "BinancePay-Signature": signature,
      },
      canonical: `${timestamp}\n${nonce}\n${sampleBody}\n`,
    };
  }

  /**
   * Test merchantTradeNo round-trip (encode/decode externalOrderCode).
   * GET /api/v1/dev/binancepay/test-trade-no/:externalOrderCode
   */
  @Get("binancepay/test-trade-no/:externalOrderCode")
  async testBinancePayTradeNo(
    @Req() request: Request,
    @Param("externalOrderCode") externalOrderCode: string,
  ) {
    this.ensureDevEndpointEnabled(request);

    const merchantTradeNo = this.binancePayService.buildMerchantTradeNo(externalOrderCode);
    const recovered = this.binancePayService.merchantTradeNoToExternalOrderCode(merchantTradeNo);

    return {
      ok: true,
      externalOrderCode,
      merchantTradeNo,
      recovered,
      roundTripMatch: recovered === externalOrderCode,
    };
  }

  /**
   * Simulate a Binance Pay PAY_SUCCESS webhook without RSA verification.
   * Useful for local dev where you have an actual BINANCE_PAY order in DB.
   *
   * POST /api/v1/dev/binancepay/mock-webhook
   * Body: { externalOrderCode: string }
   *
   * This bypasses RSA signature check and directly calls markPaymentCompleted.
   */
  @Post("binancepay/mock-webhook")
  async mockBinancePayWebhook(
    @Req() request: Request,
    @Body() body: { externalOrderCode: string },
  ) {
    this.ensureDevEndpointEnabled(request);

    const { externalOrderCode } = body;

    if (!externalOrderCode) {
      return { ok: false, error: "externalOrderCode is required" };
    }

    try {
      await this.ordersService.markPaymentCompleted(externalOrderCode, {
        mock: true,
        source: "dev_binancepay_mock_webhook",
        externalOrderCode,
        bizStatus: "PAY_SUCCESS",
      });

      return {
        ok: true,
        message: `Payment marked completed for ${externalOrderCode}`,
        returnCode: "SUCCESS",
        returnMessage: null,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private ensureDevEndpointEnabled(request: Request) {
    if (this.config.nodeEnv !== "production") {
      return;
    }

    const host = String(request.headers.host || "").toLowerCase();
    const origin = String(request.headers.origin || "").toLowerCase();
    const referer = String(request.headers.referer || "").toLowerCase();
    const isLoopback = (value: string) =>
      value.includes("localhost") ||
      value.includes("127.0.0.1") ||
      value.includes("[::1]") ||
      value.includes("::1");
    const localRequest = isLoopback(host);
    const localCaller = !origin && !referer
      ? true
      : isLoopback(origin) || isLoopback(referer);

    if (!localRequest || !localCaller) {
      throw new NotFoundException("Not found.");
    }
  }
}
