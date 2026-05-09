import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  decryptSecret,
  isMockBotToken,
  telegramAnswerCallbackQuery,
  telegramDeleteMessage,
  telegramEditMessageText,
  telegramSendMessage,
  telegramSendPhoto,
} from "@reseller/shared/server";
import { DownstreamSourceConnectionStatus, PaymentProvider, PaymentStatus, Prisma, SellerTier } from "@prisma/client";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { CustomerWalletService } from "../customer-wallet/customer-wallet.service";
import { OrdersService } from "../orders/orders.service";
import { ShopsService } from "../shops/shops.service";
import { WarrantyService } from "../warranty/warranty.service";
import { AffiliateService } from "../affiliate/affiliate.service";
import { InternalSourceApiKeyService } from "../source/internal-source-api-key.service";
import { SellerSourceConnectionService } from "../seller/seller-source-connection.service";
import { BinancePayService } from "./binance-pay.service";
import { OnchainPaymentService } from "./onchain-payment.service";
import { PaymentService } from "./payment.service";
import { decimalToNumber, formatCurrency } from "./utils";

type TelegramUpdate = Record<string, any>;

type PendingQuantitySelection = {
  sourceProductId: string;
  displayName: string;
  salePrice: number;
  salePriceUsd: number | null;
  available: number | null;
  maxQuantity: number | null;
  expiresAt: number;
};

type PendingWalletTopupSelection = {
  expiresAt: number;
};

type PendingPaymentSelection = {
  sourceProductId: string;
  quantity: number;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  expiresAt: number;
};

type PendingTxHashSubmission = {
  externalOrderCode: string;
  orderCode: string;
  allowMockHash: boolean;
  expiresAt: number;
};

type PendingBinanceOrderIdSubmission = {
  externalOrderCode: string;
  orderCode: string;
  expiresAt: number;
};

type PendingWarrantyClaimSubmission = {
  expiresAt: number;
};

type PendingWarrantyIssueDescription = {
  orderCode: string;
  expiresAt: number;
};

type PendingWarrantyAccountSelection = {
  orderCode: string;
  accounts: string[];
  expiresAt: number;
};

type PendingConnectionTopupInput = {
  connectionId: string;
  downstreamShopId: string;
  expiresAt: number;
};

type CatalogItem = Awaited<ReturnType<ShopsService["getCatalogViewForShop"]>>[number];
type FeaturedCatalogGroupKey = "chatgpt" | "grok" | "veo3" | "kling" | "youtube";
type BotLanguage = "vi" | "en" | "th";
type TelegramPaymentOption = PaymentProvider | "WALLET";
type HandleIncomingUpdateOptions = {
  simulateOnly?: boolean;
};

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly pendingQuantitySelections = new Map<string, PendingQuantitySelection>();
  private readonly pendingWalletTopups = new Map<string, PendingWalletTopupSelection>();
  private readonly pendingPaymentSelections = new Map<string, PendingPaymentSelection>();
  private readonly pendingTxHashSubmissions = new Map<string, PendingTxHashSubmission>();
  private readonly pendingBinanceOrderIdSubmissions = new Map<string, PendingBinanceOrderIdSubmission>();
  private readonly pendingWarrantyClaimSubmissions = new Map<string, PendingWarrantyClaimSubmission>();
  private readonly pendingWarrantyIssueDescriptions = new Map<string, PendingWarrantyIssueDescription>();
  private readonly pendingWarrantyAccountSelections = new Map<string, PendingWarrantyAccountSelection>();
  private readonly pendingConnectionTopupInputs = new Map<string, PendingConnectionTopupInput>();
  private readonly pendingQrMessages = new Map<string, { token: string; chatId: string | number; messageId: number }>();
  private readonly pendingQuantityTtlMs = 10 * 60 * 1000;
  private readonly pendingPaymentTtlMs = 5 * 60 * 1000;
  private readonly pendingTxHashTtlMs = 12 * 60 * 60 * 1000;
  private readonly pendingBinanceOrderIdTtlMs = 12 * 60 * 60 * 1000;
  private readonly featuredCatalogGroups: Array<{
    key: FeaturedCatalogGroupKey;
    label: string;
    emoji: string;
    matcher: (product: CatalogItem) => boolean;
  }> = [
    {
      key: "chatgpt",
      label: "Chat GPT",
      emoji: "✨",
      matcher: (product) =>
        /\b(chat\s*gpt|gpt(?:\s*plus|\s*pro|\s*team|\s*edu|\s*enterprise)?)(?!\s*creator)\b/i.test(
          `${product.displayName} ${product.sourceName}`,
        ),
    },
    {
      key: "grok",
      label: "Grok",
      emoji: "⚡",
      matcher: (product) => /\bgrok\b/i.test(`${product.displayName} ${product.sourceName}`),
    },
    {
      key: "veo3",
      label: "Veo3",
      emoji: "🎬",
      matcher: (product) => /veo\s*3/i.test(`${product.displayName} ${product.sourceName}`),
    },
    {
      key: "kling",
      label: "Kling",
      emoji: "🎥",
      matcher: (product) => /\bkling\b/i.test(`${product.displayName} ${product.sourceName}`),
    },
    {
      key: "youtube",
      label: "YouTube",
      emoji: "▶️",
      matcher: (product) => /\byoutube\b/i.test(`${product.displayName} ${product.sourceName}`),
    },
  ];

  // Reply keyboard button labels (must match exactly in handleIncomingUpdate)
  private readonly replyKeyboardLabels = {
    products:  { vi: "🛍️ Sản phẩm", en: "🛍️ Products", th: "🛍️ สินค้า" },
    orders:    { vi: "📦 Đơn hàng", en: "📦 Orders", th: "📦 คำสั่งซื้อ" },
    wallet:    { vi: "💳 Ví", en: "💳 Wallet", th: "💳 กระเป๋าเงิน" },
    support:   { vi: "💬 Hỗ trợ", en: "💬 Support", th: "💬 ช่วยเหลือ" },
    warranty:  { vi: "🛡️ Bảo hành", en: "🛡️ Warranty", th: "🛡️ การรับประกัน" },
    language:  { vi: "🌐 Ngôn ngữ", en: "🌐 Language", th: "🌐 ภาษา" },
    home:      { vi: "🏠 Trang chủ", en: "🏠 Home", th: "🏠 หน้าหลัก" },
    affiliate: { vi: "🤝 Affiliate", en: "🤝 Affiliate", th: "🤝 แนะนำเพื่อน" },
  } as const;

  private buildReplyKeyboard(language: BotLanguage, isPro = false) {
    const l = this.replyKeyboardLabels;
    return {
      keyboard: [
        [
          { text: l.products[language] },
          { text: l.orders[language] },
        ],
        [
          { text: l.wallet[language] },
          { text: l.support[language] },
        ],
        [
          { text: l.home[language] },
          ...(isPro ? [{ text: l.warranty[language] }] : []),
          { text: l.language[language] },
        ],
        [
          { text: l.affiliate[language] },
        ],
      ],
      resize_keyboard: true,
      persistent: true,
    };
  }

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(CustomerWalletService)
    private readonly customerWalletService: CustomerWalletService,
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(BinancePayService)
    private readonly binancePayService: BinancePayService,
    @Inject(OnchainPaymentService)
    private readonly onchainPaymentService: OnchainPaymentService,
    @Inject(WarrantyService)
    private readonly warrantyService: WarrantyService,
    @Inject(AffiliateService)
    private readonly affiliateService: AffiliateService,
    @Inject(InternalSourceApiKeyService)
    private readonly apiKeyService: InternalSourceApiKeyService,
    @Inject(SellerSourceConnectionService)
    private readonly connectionTopupService: SellerSourceConnectionService,
  ) {}

  async handleIncomingUpdate(
    shopId: string,
    update: TelegramUpdate,
    options?: HandleIncomingUpdateOptions,
  ) {
    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    const token = decryptSecret(
      shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (!token) {
      throw new NotFoundException("Bot token is missing.");
    }

    const outboundToken = options?.simulateOnly
      ? this.createSimulationToken(token)
      : token;

    const actions: unknown[] = [];
    const callbackQuery = update.callback_query;
    const message = update.message;

    this.cleanupExpiredPendingSelections();

    await this.ensureTelegramCustomerSeen(shop, message, callbackQuery);

    const messageLanguage = await this.getCustomerLanguage(
      shopId,
      String(message?.from?.id || ""),
    );

    if (message?.from?.id && message?.text && !message.text.startsWith("/")) {
      // Handle reply keyboard button taps (both vi & en)
      const msgText = String(message.text || "").trim();
      const allProductLabels = Object.values(this.replyKeyboardLabels.products);
      const allOrderLabels = Object.values(this.replyKeyboardLabels.orders);
      const allWalletLabels = Object.values(this.replyKeyboardLabels.wallet);
      const allSupportLabels = Object.values(this.replyKeyboardLabels.support);
      const allWarrantyLabels = Object.values(this.replyKeyboardLabels.warranty);
      const allHomeLabels = Object.values(this.replyKeyboardLabels.home);
      const allLanguageLabels = Object.values(this.replyKeyboardLabels.language);
      const allAffiliateLabels = Object.values(this.replyKeyboardLabels.affiliate);

      if (allProductLabels.includes(msgText as any)) {
        this.clearPendingQuantitySelection(shopId, String(message.from?.id || ""));
        this.clearPendingWalletTopup(shopId, String(message.from?.id || ""));
        this.clearPendingPaymentSelection(shopId, String(message.from?.id || ""));
        this.clearPendingTxHashSubmission(shopId, String(message.from?.id || ""));
        await this.renderCatalog(shopId, outboundToken, message.chat.id, undefined, 0, actions, messageLanguage);
        return { ok: true, actions };
      }

      if (allOrderLabels.includes(msgText as any)) {
        this.clearPendingQuantitySelection(shopId, String(message.from?.id || ""));
        this.clearPendingWalletTopup(shopId, String(message.from?.id || ""));
        this.clearPendingPaymentSelection(shopId, String(message.from?.id || ""));
        this.clearPendingTxHashSubmission(shopId, String(message.from?.id || ""));
        await this.renderOrderHistory(shopId, outboundToken, message.chat.id, undefined, String(message.from.id), actions, messageLanguage);
        return { ok: true, actions };
      }

      if (allWalletLabels.includes(msgText as any)) {
        this.clearPendingQuantitySelection(shopId, String(message.from?.id || ""));
        this.clearPendingPaymentSelection(shopId, String(message.from?.id || ""));
        this.clearPendingTxHashSubmission(shopId, String(message.from?.id || ""));
        await this.renderWalletPanel(shopId, outboundToken, message.chat.id, undefined, String(message.from.id), actions, messageLanguage);
        return { ok: true, actions };
      }

      if (allSupportLabels.includes(msgText as any)) {
        await this.sendText(
          outboundToken,
          message.chat.id,
          this.buildSupportText(shop.name, shop.supportTelegram, shop.supportZalo, messageLanguage),
          actions,
          {
            inline_keyboard: [
              [{ text: this.buttonLabel("home", messageLanguage), callback_data: "home:menu" }],
            ],
          },
        );
        return { ok: true, actions };
      }

      if (allWarrantyLabels.includes(msgText as any)) {
        if (shop.seller.tier !== SellerTier.ULTRA) {
          return { ok: true, actions };
        }
        this.clearPendingQuantitySelection(shopId, String(message.from?.id || ""));
        this.clearPendingWalletTopup(shopId, String(message.from?.id || ""));
        this.clearPendingPaymentSelection(shopId, String(message.from?.id || ""));
        this.clearPendingTxHashSubmission(shopId, String(message.from?.id || ""));
        this.clearPendingWarrantyIssueDescription(shopId, String(message.from?.id || ""));
        this.clearPendingWarrantyAccountSelection(shopId, String(message.from?.id || ""));
        await this.promptWarrantyClaimOrderCode(
          outboundToken,
          message.chat.id,
          undefined,
          shopId,
          String(message.from.id),
          actions,
          messageLanguage,
        );
        return { ok: true, actions };
      }

      if (allHomeLabels.includes(msgText as any)) {
        this.clearPendingQuantitySelection(shopId, String(message.from?.id || ""));
        this.clearPendingWalletTopup(shopId, String(message.from?.id || ""));
        this.clearPendingPaymentSelection(shopId, String(message.from?.id || ""));
        this.clearPendingTxHashSubmission(shopId, String(message.from?.id || ""));
        await this.renderHome(shopId, outboundToken, message.chat.id, undefined, actions, messageLanguage);
        return { ok: true, actions };
      }

      if (allLanguageLabels.includes(msgText as any)) {
        await this.renderLanguageMenu(outboundToken, message.chat.id, undefined, messageLanguage, actions);
        return { ok: true, actions };
      }

      if (allAffiliateLabels.includes(msgText as any)) {
        await this.renderAffiliatePanel(
          shop,
          outboundToken,
          message.chat.id,
          undefined,
          String(message.from.id),
          actions,
          messageLanguage,
        );
        return { ok: true, actions };
      }

      const handledPendingTxHash = await this.handlePendingTxHashMessage(
        shopId,
        outboundToken,
        message,
        actions,
      );

      if (handledPendingTxHash) {
        return { ok: true, actions };
      }

      const handledPendingWalletTopup = await this.handlePendingWalletTopupMessage(
        shopId,
        outboundToken,
        message,
        actions,
      );

      if (handledPendingWalletTopup) {
        return { ok: true, actions };
      }

      const handledPendingSelection = await this.handlePendingQuantityMessage(
        shopId,
        outboundToken,
        message,
        actions,
      );

      if (handledPendingSelection) {
        return { ok: true, actions };
      }

      const handledConnectionTopup = await this.handlePendingConnectionTopupAmountMessage(
        shop,
        outboundToken,
        message,
        actions,
      );

      if (handledConnectionTopup) {
        return { ok: true, actions };
      }

      const handledWarrantyAccountSelection = await this.handlePendingWarrantyAccountSelectionMessage(
        shopId,
        outboundToken,
        message,
        actions,
      );

      if (handledWarrantyAccountSelection) {
        return { ok: true, actions };
      }

      const handledPendingWarrantyClaim = await this.handlePendingWarrantyClaimMessage(
        shopId,
        outboundToken,
        message,
        actions,
      );

      if (handledPendingWarrantyClaim) {
        return { ok: true, actions };
      }

      const handledBinanceOrderId = await this.handlePendingBinanceOrderIdMessage(
        shopId,
        outboundToken,
        message,
        actions,
        messageLanguage,
      );

      if (handledBinanceOrderId) {
        return { ok: true, actions };
      }
    }

    if (message?.text?.startsWith("/start")) {
      this.clearPendingQuantitySelection(shopId, String(message.from?.id || ""));
      this.clearPendingWalletTopup(shopId, String(message.from?.id || ""));
      this.clearPendingPaymentSelection(shopId, String(message.from?.id || ""));
      this.clearPendingTxHashSubmission(shopId, String(message.from?.id || ""));

      const startParam = message.text.slice("/start".length).trim();
      if (startParam.startsWith("ref_") && message.from?.id) {
        const referrerId = startParam.slice("ref_".length);
        await this.applyAffiliateRef(shopId, String(message.from.id), referrerId);
      }

      await this.renderLanguageMenu(
        outboundToken,
        message.chat.id,
        undefined,
        messageLanguage,
        actions,
        "onboarding",
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/products")) {
      this.clearPendingQuantitySelection(shopId, String(message.from?.id || ""));
      this.clearPendingWalletTopup(shopId, String(message.from?.id || ""));
      this.clearPendingPaymentSelection(shopId, String(message.from?.id || ""));
      this.clearPendingTxHashSubmission(shopId, String(message.from?.id || ""));
      await this.renderCatalog(shopId, outboundToken, message.chat.id, undefined, 0, actions, messageLanguage);
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/language")) {
      await this.renderLanguageMenu(outboundToken, message.chat.id, undefined, messageLanguage, actions);
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/help")) {
      await this.sendText(outboundToken, message.chat.id, this.buildGuideText(shop.name, messageLanguage), actions);
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/warranty")) {
      if (shop.seller.tier !== SellerTier.ULTRA) {
        return { ok: true, actions };
      }
      await this.promptWarrantyClaimOrderCode(
        outboundToken,
        message.chat.id,
        undefined,
        shopId,
        String(message.from?.id || ""),
        actions,
        messageLanguage,
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/api")) {
      await this.handleProKeyMenu(
        shop,
        outboundToken,
        message.chat.id,
        undefined,
        String(message.from?.id || ""),
        actions,
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/affiliate")) {
      await this.renderAffiliatePanel(
        shop,
        outboundToken,
        message.chat.id,
        undefined,
        String(message.from?.id || ""),
        actions,
        messageLanguage,
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/support")) {
      await this.sendText(
        outboundToken,
        message.chat.id,
        this.buildSupportText(shop.name, shop.supportTelegram, shop.supportZalo, messageLanguage),
        actions,
      );
      return { ok: true, actions };
    }

    if (callbackQuery) {
      const data = String(callbackQuery.data || "");
      const chatId = callbackQuery.message?.chat?.id;
      const messageId = callbackQuery.message?.message_id;
      const telegramUserId = String(callbackQuery.from?.id || "");
      const callbackLanguage = await this.getCustomerLanguage(shopId, telegramUserId);

      if (chatId && callbackQuery.id) {
        await this.answerCallback(outboundToken, callbackQuery.id, actions);
      }

      if (data === "home:menu") {
        this.clearPendingQuantitySelection(shopId, telegramUserId);
        this.clearPendingWalletTopup(shopId, telegramUserId);
        this.clearPendingPaymentSelection(shopId, telegramUserId);
        this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.renderHome(shopId, outboundToken, chatId, messageId, actions, callbackLanguage);
      } else if (data === "home:products") {
        this.clearPendingQuantitySelection(shopId, telegramUserId);
        this.clearPendingWalletTopup(shopId, telegramUserId);
        this.clearPendingPaymentSelection(shopId, telegramUserId);
        this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.renderCatalog(shopId, outboundToken, chatId, messageId, 0, actions, callbackLanguage);
      } else if (data === "home:history") {
        this.clearPendingQuantitySelection(shopId, telegramUserId);
        this.clearPendingWalletTopup(shopId, telegramUserId);
        this.clearPendingPaymentSelection(shopId, telegramUserId);
        this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.renderOrderHistory(shopId, outboundToken, chatId, messageId, telegramUserId, actions, callbackLanguage);
      } else if (data === "home:wallet") {
        this.clearPendingQuantitySelection(shopId, telegramUserId);
        this.clearPendingWalletTopup(shopId, telegramUserId);
        this.clearPendingPaymentSelection(shopId, telegramUserId);
        this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.renderWalletPanel(shopId, outboundToken, chatId, messageId, telegramUserId, actions, callbackLanguage);
      } else if (data === "home:warranty" || data === "warranty:start") {
        this.clearPendingQuantitySelection(shopId, telegramUserId);
        this.clearPendingWalletTopup(shopId, telegramUserId);
        this.clearPendingPaymentSelection(shopId, telegramUserId);
        this.clearPendingTxHashSubmission(shopId, telegramUserId);
        this.clearPendingWarrantyIssueDescription(shopId, telegramUserId);
        this.clearPendingWarrantyAccountSelection(shopId, telegramUserId);
        await this.promptWarrantyClaimOrderCode(
          outboundToken,
          chatId,
          messageId,
          shopId,
          telegramUserId,
          actions,
          callbackLanguage,
        );
      } else if (data.startsWith("warranty_claim:")) {
        const orderCode = data.slice("warranty_claim:".length);
        this.clearPendingQuantitySelection(shopId, telegramUserId);
        this.clearPendingWalletTopup(shopId, telegramUserId);
        this.clearPendingPaymentSelection(shopId, telegramUserId);
        this.clearPendingTxHashSubmission(shopId, telegramUserId);
        this.clearPendingWarrantyClaimSubmission(shopId, telegramUserId);
        const check = await this.warrantyService.checkTelegramWarrantyEligibility({
          shopId,
          telegramUserId,
          orderCode,
          language: callbackLanguage,
        });
        if (!check.eligible) {
          await this.editOrSend(
            outboundToken,
            chatId,
            messageId,
            check.message,
            {
              inline_keyboard: [
                [{ text: this.buttonLabel("history", callbackLanguage), callback_data: "home:history" }],
                [{ text: this.buttonLabel("home", callbackLanguage), callback_data: "home:menu" }],
              ],
            },
            actions,
          );
        } else {
          await this.routeWarrantyByAccountCount(
            outboundToken,
            chatId,
            messageId,
            shopId,
            telegramUserId,
            check.orderCode,
            check.accounts,
            actions,
            callbackLanguage,
          );
        }
      } else if (data.startsWith("prokey:reissue:")) {
        const downstreamSellerId = data.slice("prokey:reissue:".length);
        await this.handleProKeyReissue(shop, outboundToken, chatId, messageId, downstreamSellerId, actions);
      } else if (data === "prokey:cancel") {
        await this.editOrSend(
          outboundToken,
          chatId,
          messageId,
          "❌ Đã hủy.",
          { inline_keyboard: [] },
          actions,
        );
      } else if (data === "prokey:topup") {
        await this.handleProKeyTopupPrompt(shop, outboundToken, chatId, messageId, telegramUserId, actions);
      } else if (data === "wallet:topup") {
        this.clearPendingQuantitySelection(shopId, telegramUserId);
        this.clearPendingPaymentSelection(shopId, telegramUserId);
        this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.promptWalletTopupAmount(shopId, outboundToken, chatId, telegramUserId, actions, undefined, callbackLanguage);
      } else if (data === "home:language") {
        await this.renderLanguageMenu(outboundToken, chatId, messageId, callbackLanguage, actions);
      } else if (data.startsWith("lang:set:")) {
        const nextLanguage = data.endsWith(":en") ? "en" : data.endsWith(":th") ? "th" : "vi";
        await this.setCustomerLanguage(shopId, telegramUserId, nextLanguage);
        await this.renderHome(shopId, outboundToken, chatId, messageId, actions, nextLanguage);
      } else if (data === "home:guide") {
        await this.editOrSend(
          outboundToken,
          chatId,
          messageId,
          this.buildGuideText(shop.name, callbackLanguage),
          {
            inline_keyboard: [
              [
                { text: this.buttonLabel("products", callbackLanguage), callback_data: "home:products" },
                { text: this.buttonLabel("home", callbackLanguage), callback_data: "home:menu" },
              ],
              [
                { text: this.buttonLabel("history", callbackLanguage), callback_data: "home:history" },
                { text: this.buttonLabel("wallet", callbackLanguage), callback_data: "home:wallet" },
              ],
            ],
          },
          actions,
        );
      } else if (data === "home:support") {
        await this.editOrSend(
          outboundToken,
          chatId,
          messageId,
          this.buildSupportText(shop.name, shop.supportTelegram, shop.supportZalo, callbackLanguage),
          {
            inline_keyboard: [
              [
                { text: this.buttonLabel("home", callbackLanguage), callback_data: "home:menu" },
                { text: this.buttonLabel("productsShort", callbackLanguage), callback_data: "home:products" },
              ],
              [
                { text: this.buttonLabel("history", callbackLanguage), callback_data: "home:history" },
                { text: this.buttonLabel("wallet", callbackLanguage), callback_data: "home:wallet" },
              ],
            ],
          },
          actions,
        );
      } else if (data === "home:api") {
        await this.handleProKeyMenu(shop, outboundToken, chatId, messageId, telegramUserId, actions);
      } else if (data === "home:affiliate") {
        await this.renderAffiliatePanel(shop, outboundToken, chatId, messageId, telegramUserId, actions, callbackLanguage);
      } else if (data.startsWith("catalog:group:")) {
        const [, , rawGroupKey, rawPage] = data.split(":");
        const page = Number(rawPage || "0");
        await this.renderCatalogGroup(
          shopId,
          outboundToken,
          chatId,
          messageId,
          rawGroupKey as FeaturedCatalogGroupKey,
          page,
          actions,
          callbackLanguage,
        );
      } else if (data.startsWith("catalog:page:")) {
        const page = Number(data.split(":").pop() || "0");
        await this.renderCatalog(shopId, outboundToken, chatId, messageId, page, actions, callbackLanguage);
      } else if (data.startsWith("pay:")) {
        await this.handlePaymentMethodSelection(
          shopId,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          data.slice(4),
          actions,
          callbackLanguage,
        );
      } else if (data.startsWith("txhash:submit:")) {
        await this.promptTxHashSubmission(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          data.slice("txhash:submit:".length),
          actions,
          callbackLanguage,
          messageId,
        );
      } else if (data.startsWith("binance:verify:")) {
        await this.handleBinancePersonalVerify(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          data.slice("binance:verify:".length),
          actions,
          callbackLanguage,
          messageId,
        );
      } else if (data.startsWith("binance:orderid:prompt:")) {
        await this.handleBinanceOrderIdPrompt(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          data.slice("binance:orderid:prompt:".length),
          actions,
          callbackLanguage,
          messageId,
        );
      } else if (data.startsWith("payment:verify:")) {
        await this.handleCheckoutPaymentVerify(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          data.slice("payment:verify:".length),
          actions,
          callbackLanguage,
          messageId,
        );
      } else if (data.startsWith("buy:")) {
        const sourceProductId = data.slice(4);
        this.clearPendingTxHashSubmission(shopId, telegramUserId);

        try {
          await this.promptQuantitySelection(
            shopId,
            outboundToken,
            sourceProductId || "",
            {
              telegramUserId,
              telegramChatId: String(chatId || callbackQuery.from?.id || ""),
              telegramUsername: callbackQuery.from?.username || null,
              firstName: callbackQuery.from?.first_name || null,
              lastName: callbackQuery.from?.last_name || null,
            },
            actions,
            callbackLanguage,
          );
        } catch (error) {
          this.logger.error(
            `Failed to prepare Telegram order for shop ${shopId}, product ${sourceProductId}`,
            error instanceof Error ? error.stack : undefined,
          );

          if (chatId) {
            await this.sendText(
              outboundToken,
              chatId,
              [
                callbackLanguage === "en"
                  ? "⚠️ Cannot create the order right now."
                  : callbackLanguage === "th"
                    ? "⚠️ ไม่สามารถสร้างคำสั่งซื้อได้ในขณะนี้"
                    : "⚠️ Không thể tạo đơn hàng lúc này.",
                this.localizeBotErrorMessage(error, callbackLanguage),
              ].join("\n"),
              actions,
              {
                inline_keyboard: [[{
                  text:
                    callbackLanguage === "en"
                      ? "⬅️ Back to products"
                      : callbackLanguage === "th"
                        ? "⬅️ กลับไปยังสินค้า"
                        : "⬅️ Quay lại sản phẩm",
                  callback_data: "home:products",
                }]],
              },
            ).catch(() => undefined);
          }
        }
      }
    }

    return { ok: true, actions };
  }

  async sendDeliveredMessage(
    shopId: string,
    chatId: string,
    productName: string,
    deliveredAccountText: string,
    orderCode?: string,
  ) {
    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    const language = await this.getCustomerLanguageByChatId(shopId, chatId);
    const token = decryptSecret(
      shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (!token) {
      return;
    }

    const hasWarrantyFeature = shop.seller.tier === SellerTier.ULTRA
      || shop.providerConfig?.providerKind === "INTERNAL";
    const warrantyButton = hasWarrantyFeature && orderCode
      ? {
          inline_keyboard: [
            [{ text: language === "en" ? "🛡️ Warranty" : language === "th" ? "🛡️ การรับประกัน" : "🛡️ Bảo hành", callback_data: `warranty_claim:${orderCode}` }],
          ],
        }
      : undefined;

    await this.sendText(
      token,
      chatId,
      [
        language === "en" ? "✅ Payment successful" : language === "th" ? "✅ ชำระเงินสำเร็จ" : "✅ Thanh toán thành công",
        language === "en"
          ? `Product: ${this.localizeProductName(productName, language)}`
          : language === "th"
            ? `สินค้า: ${this.localizeProductName(productName, language)}`
            : `Sản phẩm: ${this.localizeProductName(productName, language)}`,
        "",
        language === "en" ? "🔐 Your account:" : language === "th" ? "🔐 บัญชีของคุณ:" : "🔐 Tài khoản của bạn:",
        deliveredAccountText,
        "",
        language === "en"
          ? "Please change the password right after logging in for safety."
          : language === "th"
            ? "กรุณาเปลี่ยนรหัสผ่านทันทีหลังจากเข้าสู่ระบบเพื่อความปลอดภัย"
            : "Vui lòng đổi mật khẩu ngay sau khi đăng nhập để bảo đảm an toàn.",
      ].join("\n"),
      [],
      warrantyButton,
    );
  }

  private async renderHome(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    const products = await this.shopsService.getCatalogViewForShop(shopId);
    const available = products.filter((item) => item.available === null || item.available > 0);

    const isPro = shop.seller.tier === SellerTier.ULTRA;
    const hasWarranty = isPro || shop.providerConfig?.providerKind === "INTERNAL";

    const homeText = this.buildHomeText(
      shop.name,
      shop.tagline ||
        (language === "en"
          ? "Automated digital account stock, updated 24/7."
          : language === "th"
            ? "สต็อกบัญชีดิจิทัลอัตโนมัติ อัปเดตตลอด 24/7"
            : "Kho tài khoản tự động, cập nhật liên tục 24/7."),
      products.length,
      available.length,
      language,
    );

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: this.buttonLabel("products", language), callback_data: "home:products" },
          { text: this.buttonLabel("guide", language), callback_data: "home:guide" },
        ],
        [
          { text: this.buttonLabel("history", language), callback_data: "home:history" },
          { text: this.buttonLabel("wallet", language), callback_data: "home:wallet" },
        ],
        ...(hasWarranty
          ? [[
              { text: this.buttonLabel("warranty", language), callback_data: "home:warranty" },
              { text: this.buttonLabel("support", language), callback_data: "home:support" },
            ]]
          : [[{ text: this.buttonLabel("support", language), callback_data: "home:support" }]]),
        ...(isPro ? [[{ text: "🔑 API Key", callback_data: "home:api" }]] : []),
        [{ text: "🤝 Affiliate", callback_data: "home:affiliate" }],
        [
          { text: this.buttonLabel("language", language), callback_data: "home:language" },
          { text: this.buttonLabel("home", language), callback_data: "home:menu" },
        ],
      ],
    };

    if (messageId) {
      // Refreshing home via callback — just update text + inline keyboard on the existing message
      await this.editText(token, chatId, messageId, homeText, inlineKeyboard, actions, "HTML");
    } else {
      // Fresh home (e.g. /start, text command) — send with reply keyboard first to keep it persistent,
      // then edit the same message to attach the inline keyboard.
      // Telegram rejects both keyboard types in a single reply_markup, so we must split into two calls.
      const sent = await this.sendText(token, chatId, homeText, actions, this.buildReplyKeyboard(language, hasWarranty), "HTML");
      const sentMessageId = sent && typeof sent === "object" && "message_id" in sent
        ? (sent as { message_id: number }).message_id
        : undefined;
      if (sentMessageId) {
        await this.editText(token, chatId, sentMessageId, homeText, inlineKeyboard, actions, "HTML");
      }
    }
  }

  private async renderCatalog(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    page: number,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    const products = (await this.shopsService.getCatalogViewForShop(shopId)).filter(
      (item) =>
        item.enabled &&
        !item.hidden &&
        (language !== "vi" || !item.hiddenVi) &&
        (language !== "en" || !item.hiddenEn) &&
        (item.available === null || item.available > 0),
    );
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    if (products.length === 0) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? ["🛒 Products", "", "There are no active products right now."].join("\n")
          : language === "th"
            ? ["🛒 สินค้า", "", "ขณะนี้ยังไม่มีสินค้าที่เปิดขาย"].join("\n")
            : ["🛒 Danh sách sản phẩm", "", "Hiện chưa có sản phẩm nào đang mở bán."].join("\n"),
        {
          inline_keyboard: [
            [
              { text: this.buttonLabel("home", language), callback_data: "home:menu" },
              { text: this.buttonLabel("supportShort", language), callback_data: "home:support" },
            ],
          ],
        },
        actions,
      );
      return;
    }

    const { featuredGroups, otherProducts } = this.splitCatalogProducts(products);
    const pageCount = 1;
    const normalizedPage = 0;
    const pageItems = otherProducts;

    const lines: string[] = [language === "en" ? "🛒 Products" : language === "th" ? "🛒 สินค้า" : "🛒 Danh sách sản phẩm", ""];

    if (featuredGroups.length > 0) {
      lines.push(language === "en" ? "📂 Featured groups" : language === "th" ? "📂 หมวดหมู่แนะนำ" : "📂 Nhóm nổi bật");
      lines.push(
        ...featuredGroups.map(
          (group) =>
            `• ${group.emoji} ${group.label}: ${group.items.length} ${
              language === "en" ? "products" : language === "th" ? "รายการ" : "sản phẩm"
            }`,
        ),
      );
      lines.push("");
    }

    if (otherProducts.length > 0) {
      lines.push(language === "en" ? "📦 Other products" : language === "th" ? "📦 สินค้าอื่นๆ" : "📦 Sản phẩm khác");
      lines.push(
        language === "en"
          ? `Page ${normalizedPage + 1}/${pageCount} • ${otherProducts.length} products`
          : language === "th"
            ? `หน้า ${normalizedPage + 1}/${pageCount} • ${otherProducts.length} รายการ`
            : `Trang ${normalizedPage + 1}/${pageCount} • ${otherProducts.length} sản phẩm`,
      );
    } else if (featuredGroups.length > 0) {
      lines.push(language === "en" ? "📦 Other products" : language === "th" ? "📦 สินค้าอื่นๆ" : "📦 Sản phẩm khác");
      lines.push(
        language === "en"
          ? "There are no products outside featured groups yet."
          : language === "th"
            ? "ยังไม่มีสินค้านอกเหนือจากหมวดหมู่แนะนำ"
            : "Hiện chưa có sản phẩm nào ngoài các nhóm nổi bật.",
      );
      lines.push("");
    }

    lines.push("");
    lines.push(
      language === "en"
        ? "Choose a group or product below to continue."
        : language === "th"
          ? "เลือกหมวดหมู่หรือสินค้าด้านล่างเพื่อดำเนินการต่อ"
          : "Chọn một nhóm hoặc một sản phẩm bên dưới để xem chi tiết.",
    );

    const navigationRow: Array<Record<string, unknown>> = [];
    if (normalizedPage > 0) {
      navigationRow.push({
        text: language === "en" ? "⬅️ Previous" : language === "th" ? "⬅️ ก่อนหน้า" : "⬅️ Trang trước",
        callback_data: `catalog:page:${normalizedPage - 1}`,
      });
    }
    if (normalizedPage < pageCount - 1) {
      navigationRow.push({
        text: language === "en" ? "Next ➡️" : language === "th" ? "ถัดไป ➡️" : "Trang sau ➡️",
        callback_data: `catalog:page:${normalizedPage + 1}`,
      });
    }

    const groupRows = this.chunkButtons(
      featuredGroups.map((group) => ({
        text: this.buildFeaturedGroupButtonLabel(group, language),
        callback_data: `catalog:group:${group.key}:0`,
      })),
      2,
    );

    await this.editOrSend(
      token,
      chatId,
      messageId,
      lines.join("\n"),
      {
        inline_keyboard: [
          ...groupRows,
            ...pageItems.map((item) => [
              {
                text: this.buildProductButtonLabel(item, language, usdtVndRate),
                callback_data: `buy:${item.id}`,
              },
            ]),
          [
            {
              text: language === "en" ? "🔄 Refresh products" : language === "th" ? "🔄 รีเฟรชสินค้า" : "🔄 Làm mới sản phẩm",
              callback_data: "home:products",
            },
          ],
          ...(navigationRow.length > 0 ? [navigationRow] : []),
          [
            { text: this.buttonLabel("history", language), callback_data: "home:history" },
            { text: this.buttonLabel("wallet", language), callback_data: "home:wallet" },
          ],
          [
            { text: this.buttonLabel("home", language), callback_data: "home:menu" },
            { text: this.buttonLabel("supportShort", language), callback_data: "home:support" },
          ],
        ],
      },
      actions,
    );
  }

  private async renderCatalogGroup(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    groupKey: FeaturedCatalogGroupKey,
    page: number,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    const products = (await this.shopsService.getCatalogViewForShop(shopId)).filter(
      (item) =>
        item.enabled &&
        !item.hidden &&
        (language !== "vi" || !item.hiddenVi) &&
        (language !== "en" || !item.hiddenEn) &&
        (item.available === null || item.available > 0),
    );
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    const { featuredGroups } = this.splitCatalogProducts(products);
    const group = featuredGroups.find((item) => item.key === groupKey);

    if (!group || group.items.length === 0) {
      await this.renderCatalog(shopId, token, chatId, messageId, 0, actions, language);
      return;
    }

    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(group.items.length / pageSize));
    const normalizedPage = Math.min(Math.max(page, 0), pageCount - 1);
    const startIndex = normalizedPage * pageSize;
    const pageItems = group.items.slice(startIndex, startIndex + pageSize);

    const lines = [
      language === "en" ? `${group.emoji} ${group.label}` : language === "th" ? `${group.emoji} ${group.label}` : `${group.emoji} Nhóm ${group.label}`,
      language === "en"
        ? `Page ${normalizedPage + 1}/${pageCount} • ${group.items.length} products`
        : language === "th"
          ? `หน้า ${normalizedPage + 1}/${pageCount} • ${group.items.length} รายการ`
          : `Trang ${normalizedPage + 1}/${pageCount} • ${group.items.length} sản phẩm`,
      "",
      language === "en"
        ? "Choose a product in this group to continue."
        : language === "th"
          ? "เลือกสินค้าในหมวดหมู่นี้เพื่อดำเนินการต่อ"
          : "Chọn một sản phẩm trong nhóm này để xem chi tiết.",
    ];

    const navigationRow: Array<Record<string, unknown>> = [];
    if (normalizedPage > 0) {
      navigationRow.push({
        text: language === "en" ? "⬅️ Previous" : language === "th" ? "⬅️ ก่อนหน้า" : "⬅️ Trang trước",
        callback_data: `catalog:group:${group.key}:${normalizedPage - 1}`,
      });
    }
    if (normalizedPage < pageCount - 1) {
      navigationRow.push({
        text: language === "en" ? "Next ➡️" : language === "th" ? "ถัดไป ➡️" : "Trang sau ➡️",
        callback_data: `catalog:group:${group.key}:${normalizedPage + 1}`,
      });
    }

    await this.editOrSend(
      token,
      chatId,
      messageId,
      lines.join("\n"),
      {
        inline_keyboard: [
            ...pageItems.map((item) => [
              {
                text: this.buildProductButtonLabel(item, language, usdtVndRate),
                callback_data: `buy:${item.id}`,
              },
            ]),
          [
            {
              text: language === "en" ? "🔄 Refresh products" : language === "th" ? "🔄 รีเฟรชสินค้า" : "🔄 Làm mới sản phẩm",
              callback_data: `catalog:group:${group.key}:${normalizedPage}`,
            },
          ],
          ...(navigationRow.length > 0 ? [navigationRow] : []),
          [{ text: language === "en" ? "⬅️ All products" : language === "th" ? "⬅️ สินค้าทั้งหมด" : "⬅️ Xem tất cả", callback_data: "home:products" }],
          [
            { text: this.buttonLabel("history", language), callback_data: "home:history" },
            { text: this.buttonLabel("wallet", language), callback_data: "home:wallet" },
          ],
          [
            { text: this.buttonLabel("home", language), callback_data: "home:menu" },
            { text: this.buttonLabel("supportShort", language), callback_data: "home:support" },
          ],
        ],
      },
      actions,
    );
  }

  private async renderOrderHistory(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    telegramUserId: string,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    const [usdtVndRate, shop] = await Promise.all([
      this.getShopUsdtVndRate(shopId),
      this.shopsService.getSellerShopByShopId(shopId),
    ]);
    const isPro = shop.seller.tier === SellerTier.ULTRA;
    const orders = await this.prisma.order.findMany({
      where: {
        shopId,
        customer: {
          telegramUserId,
        },
      },
      include: {
        paymentTransaction: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 6,
    });

    await this.editOrSend(
      token,
      chatId,
      messageId,
      this.buildOrderHistoryText(orders, language, usdtVndRate),
      {
        inline_keyboard: [
          ...orders
            .filter(
              (order) =>
                order.paymentTransaction?.provider === PaymentProvider.USDT_TRC20 &&
                order.paymentTransaction?.status === "PENDING",
            )
            .slice(0, 3)
            .map((order) => [{
              text:
                language === "en"
                  ? `🧾 Send TX ${this.shortOrderCode(order.orderCode)}`
                  : language === "th"
                    ? `🧾 ส่ง TX ${this.shortOrderCode(order.orderCode)}`
                    : `🧾 Gửi TX ${this.shortOrderCode(order.orderCode)}`,
              callback_data: `txhash:submit:${order.paymentTransaction?.externalOrderCode}`,
            }]),
          [
            { text: this.buttonLabel("wallet", language), callback_data: "home:wallet" },
            { text: this.buttonLabel("productsShort", language), callback_data: "home:products" },
          ],
          ...(isPro
            ? [[
                { text: this.buttonLabel("warranty", language), callback_data: "home:warranty" },
                { text: this.buttonLabel("home", language), callback_data: "home:menu" },
              ]]
            : [[{ text: this.buttonLabel("home", language), callback_data: "home:menu" }]]),
          [
            { text: this.buttonLabel("supportShort", language), callback_data: "home:support" },
            { text: this.buttonLabel("history", language), callback_data: "home:history" },
          ],
        ],
      },
      actions,
    );
  }

  private async renderWalletPanel(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    telegramUserId: string,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    const summary = await this.customerWalletService.getWalletSummaryForTelegram(shopId, telegramUserId);

    const paymentRows = summary.pendingTopups
      .filter((topup) => this.isPublicCheckoutUrl(topup.checkoutUrl || ""))
      .slice(0, 2)
      .map((topup) => [
        {
          text:
            language === "en"
              ? `💳 Pay ${this.shortOrderCode(topup.externalOrderCode)}`
              : language === "th"
                ? `💳 ชำระ ${this.shortOrderCode(topup.externalOrderCode)}`
                : `💳 Thanh toán ${this.shortOrderCode(topup.externalOrderCode)}`,
          url: topup.checkoutUrl,
        },
      ]);

    await this.editOrSend(
      token,
      chatId,
      messageId,
      this.buildWalletText(summary, language, usdtVndRate),
      {
        inline_keyboard: [
          [{ text: language === "en" ? "🏦 Top up wallet" : language === "th" ? "🏦 เติมเงินกระเป๋า" : "🏦 Nạp vào ví", callback_data: "wallet:topup" }],
          ...paymentRows,
          [
            { text: this.buttonLabel("history", language), callback_data: "home:history" },
            { text: this.buttonLabel("productsShort", language), callback_data: "home:products" },
          ],
          [
            { text: this.buttonLabel("home", language), callback_data: "home:menu" },
            { text: this.buttonLabel("supportShort", language), callback_data: "home:support" },
          ],
        ],
      },
      actions,
    );
  }

  private async promptWalletTopupAmount(
    shopId: string,
    token: string,
    chatId: number,
    telegramUserId: string,
    actions: unknown[],
    leadLine?: string,
    language: BotLanguage = "vi",
  ) {
    await this.sendText(
      token,
      chatId,
      language === "en"
        ? [
            leadLine || "🏦 Enter the wallet top-up amount (VND)",
            "Example: 100000",
            "",
            "The bot will create a payment QR/link valid for 5 minutes.",
          ].join("\n")
        : language === "th"
          ? [
              leadLine || "🏦 ระบุจำนวนเงินที่ต้องการเติม (VND)",
              "ตัวอย่าง: 100000",
              "",
              "บอทจะสร้าง QR และลิงก์ชำระเงินที่ใช้ได้ภายใน 5 นาที",
            ].join("\n")
          : [
              leadLine || "🏦 Nhập số tiền muốn nạp vào ví (VND)",
              "Ví dụ: 100000",
              "",
              "Bot sẽ tạo mã QR và link thanh toán trong 5 phút.",
            ].join("\n"),
      actions,
      {
        inline_keyboard: [
          [{ text: language === "en" ? "⬅️ Back to wallet" : language === "th" ? "⬅️ กลับกระเป๋าเงิน" : "⬅️ Quay lại ví", callback_data: "home:wallet" }],
        ],
      },
    );

    this.pendingWalletTopups.set(this.getPendingQuantityKey(shopId, telegramUserId), {
      expiresAt: Date.now() + this.pendingQuantityTtlMs,
    });
  }

  private async promptQuantitySelection(
    shopId: string,
    token: string,
    sourceProductId: string,
    customer: {
      telegramUserId: string;
      telegramChatId: string;
      telegramUsername?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    },
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    this.clearPendingTxHashSubmission(shopId, customer.telegramUserId);
    const product = await this.getCatalogItemForTelegram(shopId, sourceProductId, language);
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    const maxQuantity = this.getMaxQuantity(product.available);

    if (maxQuantity !== null && maxQuantity < 1) {
      throw new Error(
        language === "en"
          ? "This product does not have enough stock to create an order."
          : language === "th"
            ? "สินค้านี้มีสต็อกไม่เพียงพอสำหรับการสั่งซื้อ"
            : "Sản phẩm hiện không đủ tồn kho để tạo đơn.",
      );
    }

    await this.sendQuantityReplyPrompt(
      shopId,
      token,
      customer.telegramChatId,
      customer.telegramUserId,
      {
        sourceProductId,
        displayName: product.displayName,
        salePrice: product.salePrice,
        salePriceUsd: product.salePriceUsd ?? null,
        available: product.available,
        maxQuantity,
      },
      actions,
      undefined,
      language,
      usdtVndRate,
    );
  }

  private async handleBuy(
    shopId: string,
    token: string,
    sourceProductId: string,
    quantity: number,
    customer: {
      telegramUserId: string;
      telegramChatId: string;
      telegramUsername?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    },
    actions: unknown[],
    paymentProvider?: PaymentProvider,
    language: BotLanguage = "vi",
  ) {
    this.clearPendingQuantitySelection(shopId, customer.telegramUserId);
    this.clearPendingPaymentSelection(shopId, customer.telegramUserId);
    this.clearPendingTxHashSubmission(shopId, customer.telegramUserId);

    const created = await this.ordersService.createTelegramOrder({
      shopId,
      sourceProductId,
      quantity,
      telegramUserId: customer.telegramUserId,
      telegramChatId: customer.telegramChatId,
      telegramUsername: customer.telegramUsername,
      firstName: customer.firstName,
      lastName: customer.lastName,
      paymentProvider,
    });

    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    const isPublicCheckoutUrl = this.isPublicCheckoutUrl(created.checkoutUrl);
    const qrImageUrl = this.buildQrImageUrl(created.qrCode);
    const paymentLines = this.buildOrderPaymentLines(created, language, usdtVndRate);
    // When QR is shown, hide the checkout URL button — customer should scan directly
    const inlineKeyboard = this.buildPostPaymentInlineKeyboard(created, language, qrImageUrl ? false : isPublicCheckoutUrl);

    if (qrImageUrl) {
      const sentMsgId = await this.sendPhoto(
        token,
        customer.telegramChatId,
        qrImageUrl,
        paymentLines.join("\n"),
        actions,
        { inline_keyboard: inlineKeyboard },
        "HTML"
      );
      if (sentMsgId && created.order.paymentTransaction?.externalOrderCode) {
        await this.prisma.paymentTransaction.update({
          where: { externalOrderCode: created.order.paymentTransaction.externalOrderCode },
          data: { qrTelegramMessageId: sentMsgId },
        }).catch(() => undefined);
      }
      return;
    }

    await this.sendText(token, customer.telegramChatId, paymentLines.join("\n"), actions, {
      inline_keyboard: inlineKeyboard,
    }, "HTML");
  }

  private async handleBuyWithWallet(
    shopId: string,
    token: string,
    sourceProductId: string,
    quantity: number,
    customer: {
      telegramUserId: string;
      telegramChatId: string;
      telegramUsername?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    },
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    this.clearPendingQuantitySelection(shopId, customer.telegramUserId);
    this.clearPendingPaymentSelection(shopId, customer.telegramUserId);
    this.clearPendingTxHashSubmission(shopId, customer.telegramUserId);

    const created = await this.ordersService.createTelegramOrderWithWallet({
      shopId,
      sourceProductId,
      quantity,
      telegramUserId: customer.telegramUserId,
      telegramChatId: customer.telegramChatId,
      telegramUsername: customer.telegramUsername,
      firstName: customer.firstName,
      lastName: customer.lastName,
    });

    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    await this.sendText(
      token,
      customer.telegramChatId,
      [
        language === "en" ? "✅ Wallet payment successful" : language === "th" ? "✅ ชำระเงินด้วยกระเป๋าเงินสำเร็จ" : "✅ Thanh toán bằng ví thành công",
        language === "en"
          ? `Order code: ${created.order.orderCode}`
          : language === "th"
            ? `รหัสคำสั่งซื้อ: ${created.order.orderCode}`
            : `Mã đơn: ${created.order.orderCode}`,
        language === "en"
          ? `Product: ${this.localizeProductName(created.order.productName, language)}`
          : language === "th"
            ? `สินค้า: ${this.localizeProductName(created.order.productName, language)}`
            : `Sản phẩm: ${this.localizeProductName(created.order.productName, language)}`,
        language === "en"
          ? `Quantity: ${created.order.quantity}`
          : language === "th"
            ? `จำนวน: ${created.order.quantity}`
            : `Số lượng: ${created.order.quantity}`,
        language === "en"
          ? `Paid from wallet: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`
          : language === "th"
            ? `หักจากกระเป๋าเงิน: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`
            : `Đã trừ từ ví: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`,
        language === "en"
          ? `Remaining wallet balance: ${this.formatBotMoney(created.walletBalanceAfter, language, usdtVndRate)}`
          : language === "th"
            ? `ยอดคงเหลือในกระเป๋าเงิน: ${this.formatBotMoney(created.walletBalanceAfter, language, usdtVndRate)}`
            : `Số dư ví còn lại: ${this.formatBotMoney(created.walletBalanceAfter, language, usdtVndRate)}`,
        "",
        language === "en"
          ? "The system is processing your order now."
          : language === "th"
            ? "ระบบกำลังดำเนินการคำสั่งซื้อของคุณ"
            : "Hệ thống đang xử lý đơn hàng của bạn.",
      ].join("\n"),
      actions,
      {
        inline_keyboard: [
          [
            { text: this.buttonLabel("history", language), callback_data: "home:history" },
            { text: this.buttonLabel("wallet", language), callback_data: "home:wallet" },
          ],
          [
            { text: this.buttonLabel("products", language), callback_data: "home:products" },
            { text: this.buttonLabel("home", language), callback_data: "home:menu" },
          ],
        ],
      },
    );
  }

  private buildPostPaymentInlineKeyboard(
    created: {
      order: {
        orderCode: string;
        paymentTransaction?: {
          externalOrderCode?: string | null;
          provider?: string | null;
        } | null;
      };
      checkoutUrl: string;
      manualCrypto?: {
        provider: "BINANCE" | "OKX" | "USDT_TRC20";
        note: string;
        hasPersonalApi?: boolean;
      };
    },
    language: BotLanguage,
    isPublicCheckoutUrl: boolean,
  ) {
    const inlineKeyboard: Array<Array<Record<string, string>>> = [];
    const paymentProvider = String(created.order.paymentTransaction?.provider || "").toLowerCase();
    const externalOrderCode = String(created.order.paymentTransaction?.externalOrderCode || "").trim();
    const canInstantVerify =
      Boolean(externalOrderCode) &&
      (paymentProvider === PaymentProvider.PAYOS.toLowerCase() ||
        paymentProvider === PaymentProvider.BINANCE_PAY.toLowerCase());

    if (isPublicCheckoutUrl) {
      inlineKeyboard.push([{
        text: language === "en" ? "💳 Open payment page" : language === "th" ? "💳 เปิดหน้าชำระเงิน" : "💳 Mở trang thanh toán",
        url: created.checkoutUrl,
      }]);
    }

    if (canInstantVerify) {
      inlineKeyboard.push([{
        text: language === "en" ? "✅ I've paid" : language === "th" ? "✅ ฉันชำระแล้ว" : "✅ Tôi đã thanh toán",
        callback_data: `payment:verify:${externalOrderCode}`,
      }]);
    }

    if (created.manualCrypto?.provider === "USDT_TRC20") {
      inlineKeyboard.push([{
        text: language === "en" ? "🧾 Send TX hash" : language === "th" ? "🧾 ส่ง TX hash" : "🧾 Gửi TX hash",
        callback_data: `txhash:submit:${created.manualCrypto.note}`,
      }]);
    }

    if (created.manualCrypto?.provider === "BINANCE" && created.manualCrypto?.hasPersonalApi) {
      inlineKeyboard.push([{
        text: language === "en" ? "✅ I've paid — Send Order ID" : language === "th" ? "✅ ชำระแล้ว — ส่ง ID คำสั่ง" : "✅ Đã chuyển — Gửi ID lệnh",
        callback_data: `binance:orderid:prompt:${created.manualCrypto.note}`,
      }]);
    }

    inlineKeyboard.push([
      { text: this.buttonLabel("history", language), callback_data: "home:history" },
      { text: this.buttonLabel("wallet", language), callback_data: "home:wallet" },
    ]);
    inlineKeyboard.push([
      { text: this.buttonLabel("products", language), callback_data: "home:products" },
      { text: this.buttonLabel("home", language), callback_data: "home:menu" },
    ]);

    return inlineKeyboard;
  }

  private async renderPaymentMethodPrompt(
    shopId: string,
    token: string,
    chatId: number | string,
    selection: PendingQuantitySelection,
    quantity: number,
    options: TelegramPaymentOption[],
    actions: unknown[],
    language: BotLanguage,
  ) {
    const totalAmount = selection.salePrice * quantity;
    const totalUsd = selection.salePriceUsd != null ? selection.salePriceUsd * quantity : null;
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);

    await this.sendText(
      token,
      chatId,
      [
        language === "en" ? "Choose payment method:" : language === "th" ? "เลือกวิธีชำระเงิน:" : "Chọn phương thức thanh toán:",
        "",
        language === "en"
          ? `Total: ${this.formatBotMoneyWithUsdOverride(totalAmount, totalUsd, language, usdtVndRate)}`
          : language === "th"
            ? `ยอดรวม: ${this.formatBotMoneyWithUsdOverride(totalAmount, totalUsd, language, usdtVndRate)}`
            : `Tổng: ${this.formatBotMoneyWithUsdOverride(totalAmount, totalUsd, language, usdtVndRate)}`,
        language === "en"
          ? "This payment selection will expire in 5 minutes."
          : language === "th"
            ? "การเลือกชำระเงินนี้จะหมดอายุใน 5 นาที"
            : "Lựa chọn thanh toán này sẽ hết hạn sau 5 phút.",
      ].join("\n"),
      actions,
      {
        inline_keyboard: [
          ...options.map((provider) => [
            {
              text: this.paymentOptionButtonLabel(provider, language),
              callback_data: `pay:${String(provider).toLowerCase()}`,
            },
          ]),
          [{ text: language === "en" ? "⬅️ Back to products" : language === "th" ? "⬅️ กลับไปยังสินค้า" : "⬅️ Quay lại sản phẩm", callback_data: "home:products" }],
        ],
      },
    );
  }

  private async handlePaymentMethodSelection(
    shopId: string,
    token: string,
    chatId: number | undefined,
    messageId: number | undefined,
    telegramUserId: string,
    rawProvider: string,
    actions: unknown[],
    language: BotLanguage,
  ) {
    if (!chatId) {
      return;
    }

    const selection = this.getPendingPaymentSelection(shopId, telegramUserId);
    const provider = this.normalizePaymentOption(rawProvider);

    if (!selection || !provider) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "⌛ This payment selection expired. Please choose the product again."
          : language === "th"
            ? "⌛ การเลือกชำระเงินหมดอายุแล้ว กรุณาเลือกสินค้าใหม่"
            : "⌛ Lựa chọn thanh toán đã hết hạn. Vui lòng chọn lại sản phẩm.",
        {
          inline_keyboard: [[{ text: language === "en" ? "🛍️ Products" : language === "th" ? "🛍️ สินค้า" : "🛍️ Sản phẩm", callback_data: "home:products" }]],
        },
        actions,
      );
      return;
    }

    try {
      const customer = {
        telegramUserId: selection.telegramUserId,
        telegramChatId: selection.telegramChatId,
        telegramUsername: selection.telegramUsername,
        firstName: selection.firstName,
        lastName: selection.lastName,
      };

      if (provider === "WALLET") {
        await this.handleBuyWithWallet(
          shopId,
          token,
          selection.sourceProductId,
          selection.quantity,
          customer,
          actions,
          language,
        );
      } else {
        await this.handleBuy(
          shopId,
          token,
          selection.sourceProductId,
          selection.quantity,
          customer,
          actions,
          provider,
          language,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to create Telegram order for shop ${shopId}, product ${selection.sourceProductId}, provider ${provider}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(
        token,
        chatId,
        [
          language === "en"
            ? "⚠️ Cannot create the order right now."
            : language === "th"
              ? "⚠️ ไม่สามารถสร้างคำสั่งซื้อได้ในขณะนี้"
              : "⚠️ Không thể tạo đơn hàng lúc này.",
          this.localizeBotErrorMessage(error, language),
        ].join("\n"),
        actions,
        {
          inline_keyboard: [[{ text: language === "en" ? "⬅️ Back to products" : language === "th" ? "⬅️ กลับไปยังสินค้า" : "⬅️ Quay lại sản phẩm", callback_data: "home:products" }]],
        },
      ).catch(() => undefined);
    }
  }

  private async getAvailablePaymentProviders(shopId: string) {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId },
      select: {
        provider: true,
        binanceUid: true,
        okxUid: true,
        usdtTrc20Address: true,
        binancePayEnabled: true,
      },
    });
    const providers: PaymentProvider[] = [];
    const primaryProvider =
      paymentConfig?.provider ||
      (this.config.paymentMode === "payos" ? PaymentProvider.PAYOS : PaymentProvider.MOCK);

    providers.push(primaryProvider);

    // Binance Pay auto (merchant API) — takes priority over manual UID
    if (paymentConfig?.binancePayEnabled) {
      if (!providers.includes(PaymentProvider.BINANCE_PAY)) {
        providers.push(PaymentProvider.BINANCE_PAY);
      }
    } else if (String(paymentConfig?.binanceUid || "").trim()) {
      providers.push(PaymentProvider.BINANCE);
    }

    if (String(paymentConfig?.usdtTrc20Address || "").trim()) {
      providers.push(PaymentProvider.USDT_TRC20);
    }

    return Array.from(new Set(providers));
  }

  private async getAvailablePaymentOptions(
    shopId: string,
    telegramUserId: string,
    totalAmount: number,
  ): Promise<TelegramPaymentOption[]> {
    const providers = await this.getAvailablePaymentProviders(shopId);
    const options: TelegramPaymentOption[] = [...providers];

    if (telegramUserId) {
      const walletSummary = await this.customerWalletService.getWalletSummaryForTelegram(
        shopId,
        telegramUserId,
      );

      if (walletSummary.balance >= totalAmount && totalAmount > 0) {
        options.unshift("WALLET");
      }
    }

    return Array.from(new Set(options));
  }

  private normalizePaymentOption(value: string): TelegramPaymentOption | null {
    const normalized = String(value || "").toUpperCase();

    if (normalized === "WALLET") return "WALLET";
    if (normalized === "PAYOS") return PaymentProvider.PAYOS;
    if (normalized === "MOCK") return PaymentProvider.MOCK;
    if (normalized === "BINANCE") return PaymentProvider.BINANCE;
    if (normalized === "BINANCE_PAY") return PaymentProvider.BINANCE_PAY;
    if (normalized === "OKX") return PaymentProvider.OKX;
    if (normalized === "USDT_TRC20") return PaymentProvider.USDT_TRC20;

    return null;
  }

  private paymentOptionButtonLabel(provider: TelegramPaymentOption, language: BotLanguage) {
    if (provider === "WALLET") {
      return language === "en" ? "💰 Pay with Wallet" : language === "th" ? "💰 ชำระด้วยกระเป๋าเงิน" : "💰 Thanh toán bằng ví";
    }
    if (provider === PaymentProvider.BINANCE_PAY) {
      return language === "en" ? "🟡 Pay with Binance Pay (Auto)" : language === "th" ? "🟡 Binance Pay (อัตโนมัติ)" : "🟡 Binance Pay (Tự động)";
    }
    if (provider === PaymentProvider.BINANCE) {
      return language === "en" ? "🟡 Pay with Binance" : language === "th" ? "🟡 ชำระด้วย Binance" : "🟡 Thanh toán Binance";
    }
    if (provider === PaymentProvider.OKX) {
      return language === "en" ? "⚫ Pay with OKX" : language === "th" ? "⚫ ชำระด้วย OKX" : "⚫ Thanh toán OKX";
    }
    if (provider === PaymentProvider.USDT_TRC20) {
      return language === "en" ? "Pay with USDT (TRC20)" : language === "th" ? "ชำระด้วย USDT (TRC20)" : "Thanh toán USDT (TRC20)";
    }
    if (provider === PaymentProvider.MOCK) {
      return language === "en" ? "💳 Pay with QR / Bank" : language === "th" ? "💳 ชำระด้วย QR / โอนเงิน" : "💳 Thanh toán QR / Chuyển khoản";
    }

    return language === "en" ? "💳 Pay with QR / Bank" : language === "th" ? "💳 ชำระด้วย QR / โอนเงิน" : "💳 Thanh toán QR / Chuyển khoản";
  }

  private buildOrderPaymentLines(
    created: {
      order: {
        orderCode: string;
        productName: string;
        quantity: number;
        totalSaleAmount: number;
      };
      checkoutUrl: string;
      manualCrypto?: {
        provider: "BINANCE" | "OKX" | "USDT_TRC20";
        uid?: string | null;
        address?: string | null;
        network?: "TRC20" | null;
        usdtAmount: number;
        usdtVndRate: number;
        note: string;
        hasPersonalApi?: boolean;
      };
      binancePay?: {
        prepayId: string;
        qrcodeLink: string;
        deeplink: string;
        universalUrl: string;
      };
    },
    language: BotLanguage,
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    const productName = this.escapeHtml(this.localizeProductName(created.order.productName, language));
    const baseLines =
      language === "en"
        ? [
            "✅ Order created",
            `Order code: ${created.order.orderCode}`,
            `Product: ${productName}`,
            `Quantity: ${created.order.quantity}`,
            `Total: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`,
          ]
        : language === "th"
          ? [
              "✅ สร้างคำสั่งซื้อแล้ว",
              `รหัสคำสั่งซื้อ: ${created.order.orderCode}`,
              `สินค้า: ${productName}`,
              `จำนวน: ${created.order.quantity}`,
              `ยอดรวม: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`,
            ]
          : [
              "✅ Đã tạo đơn hàng",
              `Mã đơn: ${created.order.orderCode}`,
              `Sản phẩm: ${productName}`,
              `Số lượng: ${created.order.quantity}`,
              `Tổng thanh toán: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`,
            ];

    // ── Binance Pay auto (merchant API) ──────────────────────────────────────
    if (created.binancePay) {
      return [
        ...baseLines,
        "",
        language === "en"
          ? "Payment method: 🟡 Binance Pay (Auto)"
          : language === "th"
            ? "วิธีชำระเงิน: 🟡 Binance Pay (อัตโนมัติ)"
            : "Phương thức: 🟡 Binance Pay (Tự động)",
        language === "en"
          ? "Tap the button below to open the Binance Pay checkout page."
          : language === "th"
            ? "กดปุ่มด้านล่างเพื่อเปิดหน้าชำระเงิน Binance Pay"
            : "Nhấn nút bên dưới để mở trang thanh toán Binance Pay.",
        language === "en"
          ? "The system will process automatically after your payment succeeds."
          : language === "th"
            ? "ระบบจะดำเนินการอัตโนมัติหลังจากชำระเงินสำเร็จ"
            : "Hệ thống sẽ tự xử lý khi bạn thanh toán thành công.",
        language === "en"
          ? "If you have already paid, tap 'I've paid' below for an immediate check."
          : language === "th"
            ? "หากชำระแล้ว กด 'ฉันชำระแล้ว' ด้านล่างเพื่อให้ระบบตรวจสอบทันที"
            : "Nếu bạn đã thanh toán, bấm 'Tôi đã thanh toán' bên dưới để hệ thống kiểm tra ngay.",
      ];
    }

    // ── Binance/OKX manual ────────────────────────────────────────────────────
    if (created.manualCrypto) {
      const providerName =
        created.manualCrypto.provider === "BINANCE"
          ? "Binance"
          : created.manualCrypto.provider === "OKX"
            ? "OKX"
            : "USDT (TRC20)";
      const receiverLine =
        created.manualCrypto.provider === "BINANCE"
          ? language === "en"
            ? `Binance ID (tap to copy):\n<code>${created.manualCrypto.uid}</code>`
            : language === "th"
              ? `Binance ID (แตะเพื่อคัดลอก):\n<code>${created.manualCrypto.uid}</code>`
              : `Binance UID (chạm để copy):\n<code>${created.manualCrypto.uid}</code>`
          : language === "en"
            ? `OKX UID (tap to copy):\n<code>${created.manualCrypto.uid}</code>`
            : language === "th"
              ? `OKX UID (แตะเพื่อคัดลอก):\n<code>${created.manualCrypto.uid}</code>`
              : `OKX UID (chạm để copy):\n<code>${created.manualCrypto.uid}</code>`;
      const displayReceiverLine =
        created.manualCrypto.provider === "USDT_TRC20"
          ? language === "en"
            ? `USDT TRC20 address (tap to copy):\n<code>${created.manualCrypto.address}</code>`
            : language === "th"
              ? `ที่อยู่ USDT TRC20 (แตะเพื่อคัดลอก):\n<code>${created.manualCrypto.address}</code>`
              : `Địa chỉ USDT TRC20 (chạm để copy):\n<code>${created.manualCrypto.address}</code>`
          : receiverLine;
      const networkLine =
        created.manualCrypto.provider === "USDT_TRC20"
          ? language === "en"
            ? "Network: TRC20 (Tron)"
            : language === "th"
              ? "เครือข่าย: TRC20 (Tron)"
              : "Mạng: TRC20 (Tron)"
          : null;
      const safetyLine =
        created.manualCrypto.provider === "USDT_TRC20"
          ? language === "en"
            ? "Only send USDT on the TRC20 network to this address."
            : language === "th"
              ? "ส่ง USDT ผ่านเครือข่าย TRC20 ไปยังที่อยู่นี้เท่านั้น"
              : "Chỉ gửi USDT đúng mạng TRC20 về địa chỉ này."
          : language === "en"
            ? "Please send the order ID or off-chain transaction reference after payment for verification."
            : language === "th"
              ? "หลังชำระเงินกรุณาส่ง ID คำสั่งหรือรหัสอ้างอิงธุรกรรมเพื่อยืนยัน"
              : "Sau khi thanh toán, vui lòng gửi mã đơn hoặc mã giao dịch để xác minh.";
      const expiryLine =
        language === "en"
          ? "⚠️ This payment order will expire in 5 minutes."
          : language === "th"
            ? "⚠️ คำสั่งชำระเงินนี้จะหมดอายุใน 5 นาที"
            : "⚠️ Lệnh thanh toán này chỉ duy trì được 5 phút.";
      const followupLine =
        created.manualCrypto.provider === "USDT_TRC20"
          ? language === "en"
            ? "After transfer, tap 'Send TX hash' below and paste the txid for automatic verification."
            : language === "th"
              ? "หลังโอนเงินแล้ว กด 'ส่ง TX hash' ด้านล่างแล้ววาง txid เพื่อให้ระบบยืนยันอัตโนมัติ"
              : "Sau khi chuyển xong, bấm 'Gửi TX hash' bên dưới rồi dán txid để hệ thống tự xác minh."
          : null;
      const binanceAutoLine =
        created.manualCrypto.provider === "BINANCE" && created.manualCrypto.hasPersonalApi
          ? language === "en"
            ? "This order uses a unique USDT amount. After transferring, tap 'I've paid' so the bot can check your Binance Pay history automatically."
            : language === "th"
              ? "คำสั่งซื้อนี้ใช้จำนวน USDT เฉพาะ หลังโอนแล้วกด 'ฉันชำระแล้ว' เพื่อให้บอทตรวจสอบประวัติ Binance Pay อัตโนมัติ"
              : "Đơn này được gán số USDT riêng. Sau khi chuyển xong, bấm 'Tôi đã thanh toán' để bot tự kiểm tra lịch sử Binance Pay."
          : null;
      const binanceExactAmountLine =
        created.manualCrypto.provider === "BINANCE" && created.manualCrypto.hasPersonalApi
          ? language === "en"
            ? "Send the exact amount shown below so the system can match your payment safely."
            : language === "th"
              ? "กรุณาโอนจำนวนที่แสดงด้านล่างเพื่อให้ระบบจับคู่การชำระเงินได้อย่างถูกต้อง"
              : "Hãy chuyển đúng số tiền bên dưới để hệ thống đối chiếu giao dịch an toàn hơn."
          : null;
      const helperLine =
        created.manualCrypto.provider === "USDT_TRC20"
          ? language === "en"
            ? "Scan the QR to copy the address, then enter the amount and choose USDT on TRC20 manually in your wallet."
            : language === "th"
              ? "สแกน QR เพื่อคัดลอกที่อยู่ จากนั้นระบุจำนวนเงินและเลือก USDT บน TRC20 ในกระเป๋าเงินของคุณ"
              : "Quét mã QR để lấy địa chỉ ví, sau đó tự nhập số tiền và chọn gửi USDT mạng TRC20."
          : null;
      const feeLine =
        created.manualCrypto.provider === "USDT_TRC20"
          ? language === "en"
            ? "TRC20 transfers also need enough TRX on the sending wallet for network fees."
            : language === "th"
              ? "การโอน TRC20 ต้องมี TRX เพียงพอในกระเป๋าผู้ส่งสำหรับค่าธรรมเนียมเครือข่าย"
              : "Lệnh chuyển TRC20 cũng cần đủ TRX trong ví gửi để trả phí mạng."
          : null;
      const toleranceLine =
        created.manualCrypto.provider === "USDT_TRC20"
          ? language === "en"
            ? `Allowed transfer difference: ${this.formatUsdt(this.config.usdtPaymentTolerance)} USDT`
            : language === "th"
              ? `ความคลาดเคลื่อนที่อนุญาต: ${this.formatUsdt(this.config.usdtPaymentTolerance)} USDT`
              : `Sai số chuyển cho phép: ${this.formatUsdt(this.config.usdtPaymentTolerance)} USDT`
          : null;

      return [
        ...baseLines,
        "",
        language === "en"
          ? `Payment method: ${providerName}`
          : language === "th"
            ? `วิธีชำระเงิน: ${providerName}`
            : `Phương thức: ${providerName}`,
        displayReceiverLine,
        ...(networkLine ? [networkLine] : []),
        language === "en"
          ? `Amount to transfer: <code>${this.formatUsdt(created.manualCrypto.usdtAmount)}</code> USDT`
          : language === "th"
            ? `จำนวนที่ต้องโอน: <code>${this.formatUsdt(created.manualCrypto.usdtAmount)}</code> USDT`
            : `Số tiền cần chuyển: <code>${this.formatUsdt(created.manualCrypto.usdtAmount)}</code> USDT`,
        language === "en"
          ? `Order reference: <code>${created.manualCrypto.note}</code>`
          : language === "th"
            ? `รหัสอ้างอิงคำสั่งซื้อ: <code>${created.manualCrypto.note}</code>`
            : `Mã tham chiếu đơn: <code>${created.manualCrypto.note}</code>`,
        "",
        safetyLine,
        ...(binanceAutoLine ? [binanceAutoLine] : []),
        ...(binanceExactAmountLine ? [binanceExactAmountLine] : []),
        ...(helperLine ? [helperLine] : []),
        ...(feeLine ? [feeLine] : []),
        ...(toleranceLine ? [toleranceLine] : []),
        ...(followupLine ? [followupLine] : []),
        "",
        expiryLine,
      ];
    }

    // ── PayOS / default ───────────────────────────────────────────────────────
    return [
      ...baseLines,
      "",
      language === "en"
        ? "Scan the QR code or open the payment page to complete the transfer."
        : language === "th"
          ? "สแกน QR หรือเปิดหน้าชำระเงินเพื่อทำการโอนเงิน"
          : "Quét mã QR hoặc mở trang thanh toán để hoàn tất chuyển khoản.",
      language === "en"
        ? "The system will process automatically after your transfer succeeds."
        : language === "th"
          ? "ระบบจะดำเนินการอัตโนมัติหลังจากโอนเงินสำเร็จ"
          : "Hệ thống sẽ tự xử lý khi bạn chuyển khoản thành công.",
      language === "en"
        ? "If you have already paid, tap 'I've paid' below for an immediate check."
        : language === "th"
          ? "หากชำระแล้ว กด 'ฉันชำระแล้ว' ด้านล่างเพื่อให้ระบบตรวจสอบทันที"
          : "Nếu bạn đã thanh toán, bấm 'Tôi đã thanh toán' bên dưới để hệ thống kiểm tra ngay.",
    ];
  }

  private formatUsdt(value: number) {
    return Number(value || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private isPublicCheckoutUrl(url: string) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      if (!["http:", "https:"].includes(parsed.protocol)) {
        return false;
      }


      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".local")
      ) {
        return false;
      }

      if (
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private buildGuideText(shopName: string, language: BotLanguage = "vi") {
    if (language === "en") {
      return [
        `📘 Buying guide | ${shopName}`,
        "",
        "1. Open the product list.",
        "2. Choose the package you want.",
        "3. Reply with the quantity.",
        "4. Choose a payment method.",
        "5. For USDT TRC20, transfer to the shown address then send the tx hash.",
        "6. Auto-verified payments deliver right after confirmation.",
      ].join("\n");
    }

    if (language === "th") {
      return [
        `📘 คู่มือการซื้อ | ${shopName}`,
        "",
        "1. เปิดรายการสินค้า",
        "2. เลือกแพ็กเกจที่ต้องการ",
        "3. ตอบกลับด้วยจำนวนที่ต้องการ",
        "4. เลือกวิธีชำระเงิน",
        "5. สำหรับ USDT TRC20 ให้โอนไปยังที่อยู่ที่แสดงแล้วส่ง tx hash",
        "6. การชำระเงินที่ยืนยันอัตโนมัติจะจัดส่งทันทีหลังยืนยัน",
      ].join("\n");
    }

    return [
      `📘 Hướng dẫn mua hàng | ${shopName}`,
      "",
      "1. Bấm vào danh sách sản phẩm.",
      "2. Chọn gói bạn muốn mua.",
      "3. Nhắn số lượng cần mua vào khung chat.",
      "4. Chọn phương thức thanh toán.",
      "5. Với USDT TRC20, chuyển vào địa chỉ bot hiển thị rồi gửi tx hash.",
      "6. Đơn được xác minh tự động sẽ giao ngay sau khi khớp thanh toán.",
    ].join("\n");
  }

  private async promptTxHashSubmission(
    shopId: string,
    token: string,
    chatId: number | undefined,
    telegramUserId: string,
    externalOrderCode: string,
    actions: unknown[],
    language: BotLanguage,
    messageId?: number,
  ) {
    if (!chatId) {
      return;
    }

    const payment = await this.prisma.paymentTransaction.findUnique({
      where: {
        externalOrderCode,
      },
      include: {
        order: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (!payment?.order || payment.order.shopId !== shopId) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "⚠️ Payment order not found."
          : language === "th"
            ? "⚠️ ไม่พบคำสั่งชำระเงินนี้"
            : "⚠️ Không tìm thấy lệnh thanh toán này.",
        {
          inline_keyboard: [[{ text: this.buttonLabel("history", language), callback_data: "home:history" }]],
        },
        actions,
      );
      return;
    }

    if (payment.order.customer?.telegramUserId !== telegramUserId) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "⚠️ This payment order does not belong to your Telegram account."
          : language === "th"
            ? "⚠️ คำสั่งชำระเงินนี้ไม่ใช่ของบัญชี Telegram ของคุณ"
            : "⚠️ Lệnh thanh toán này không thuộc tài khoản Telegram của bạn.",
        {
          inline_keyboard: [[{ text: this.buttonLabel("history", language), callback_data: "home:history" }]],
        },
        actions,
      );
      return;
    }

    if (payment.provider !== PaymentProvider.USDT_TRC20) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "⚠️ Only USDT TRC20 orders accept tx hash confirmation here."
          : language === "th"
            ? "⚠️ มีเพียงคำสั่งซื้อ USDT TRC20 เท่านั้นที่รับการยืนยันด้วย tx hash ที่นี่"
            : "⚠️ Chỉ đơn USDT TRC20 mới nhận xác nhận bằng tx hash ở đây.",
        {
          inline_keyboard: [[{ text: this.buttonLabel("history", language), callback_data: "home:history" }]],
        },
        actions,
      );
      return;
    }

    if (payment.status === "PAID") {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? `✅ Order ${payment.order.orderCode} has already been paid.`
          : language === "th"
            ? `✅ คำสั่งซื้อ ${payment.order.orderCode} ชำระเงินแล้ว`
            : `✅ Đơn ${payment.order.orderCode} đã được xác nhận thanh toán rồi.`,
        {
          inline_keyboard: [[{ text: this.buttonLabel("history", language), callback_data: "home:history" }]],
        },
        actions,
      );
      return;
    }

    this.clearPendingQuantitySelection(shopId, telegramUserId);
    this.clearPendingWalletTopup(shopId, telegramUserId);
    this.clearPendingPaymentSelection(shopId, telegramUserId);
    this.pendingTxHashSubmissions.set(this.getPendingQuantityKey(shopId, telegramUserId), {
      externalOrderCode,
      orderCode: payment.order.orderCode,
      allowMockHash: this.isSimulationToken(token),
      expiresAt: Date.now() + this.pendingTxHashTtlMs,
    });

    await this.editOrSend(
      token,
      chatId,
      messageId,
      [
        language === "en"
          ? `🧾 Send TX hash for order ${payment.order.orderCode}`
          : language === "th"
            ? `🧾 ส่ง TX hash สำหรับคำสั่งซื้อ ${payment.order.orderCode}`
            : `🧾 Gửi TX hash cho đơn ${payment.order.orderCode}`,
        "",
        language === "en"
          ? "Reply with the TRC20 transaction hash in the next message."
          : language === "th"
            ? "ตอบกลับด้วย TX hash ของธุรกรรม TRC20 ในข้อความถัดไป"
            : "Hãy trả lời bằng tx hash giao dịch TRC20 ở tin nhắn tiếp theo.",
        language === "en"
          ? "We will verify the receiver address, amount, and confirmation automatically."
          : language === "th"
            ? "ระบบจะตรวจสอบที่อยู่ผู้รับ จำนวนเงิน และสถานะการยืนยันอัตโนมัติ"
            : "Hệ thống sẽ tự kiểm tra địa chỉ nhận, số tiền và trạng thái xác nhận.",
        ...(this.isSimulationToken(token)
          ? [
              "",
              language === "en"
                ? "Local test tip: you can send a mock hash like `mock:test-001`."
                : language === "th"
                  ? "เคล็ดลับทดสอบ: คุณสามารถส่ง hash จำลองเช่น `mock:test-001`"
                  : "Mẹo test local: bạn có thể gửi hash giả như `mock:test-001`.",
            ]
          : []),
      ].join("\n"),
      {
        inline_keyboard: [
          [{ text: this.buttonLabel("history", language), callback_data: "home:history" }],
          [{ text: this.buttonLabel("home", language), callback_data: "home:menu" }],
        ],
      },
      actions,
    );
  }

  private async promptWarrantyClaimOrderCode(
    token: string,
    chatId: number,
    messageId: number | undefined,
    shopId: string,
    telegramUserId: string,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    this.pendingWarrantyClaimSubmissions.set(
      this.getPendingQuantityKey(shopId, telegramUserId),
      {
        expiresAt: Date.now() + this.pendingQuantityTtlMs,
      },
    );

    await this.editOrSend(
      token,
      chatId,
      messageId,
      [
        language === "en"
          ? "🛡️ Warranty request"
          : language === "th"
            ? "🛡️ คำขอรับประกัน"
            : "🛡️ Yêu cầu bảo hành",
        "",
        language === "en"
          ? "Please reply with your order code in the next message."
          : language === "th"
            ? "กรุณาตอบกลับด้วยรหัสคำสั่งซื้อในข้อความถัดไป"
            : "Vui lòng trả lời bằng mã đơn hàng ở tin nhắn tiếp theo.",
        language === "en"
          ? "We will validate the warranty window and process the claim automatically when possible."
          : language === "th"
            ? "ระบบจะตรวจสอบระยะเวลารับประกันและดำเนินการอัตโนมัติหากเป็นไปได้"
            : "Hệ thống sẽ kiểm tra thời hạn bảo hành và tự xử lý nếu đủ điều kiện.",
      ].join("\n"),
      {
        inline_keyboard: [
          [{ text: this.buttonLabel("history", language), callback_data: "home:history" }],
          [{ text: this.buttonLabel("home", language), callback_data: "home:menu" }],
        ],
      },
      actions,
    );
  }

  private async handlePendingWarrantyClaimMessage(
    shopId: string,
    token: string,
    message: TelegramUpdate,
    actions: unknown[],
  ) {
    const telegramUserId = String(message.from?.id || "");
    const language = await this.getCustomerLanguage(shopId, telegramUserId);
    const pending = this.getPendingWarrantyClaimSubmission(shopId, telegramUserId);

    if (!pending) {
      return false;
    }

    const orderCode = String(message.text || "").trim();

    if (!orderCode) {
      await this.promptWarrantyClaimOrderCode(
        token,
        Number(message.chat?.id || 0),
        undefined,
        shopId,
        telegramUserId,
        actions,
        language,
      );
      return true;
    }

    this.clearPendingWarrantyClaimSubmission(shopId, telegramUserId);

    const check = await this.warrantyService.checkTelegramWarrantyEligibility({
      shopId,
      telegramUserId,
      orderCode,
      language,
    });

    if (!check.eligible) {
      await this.sendText(
        token,
        message.chat.id,
        check.message,
        actions,
        {
          inline_keyboard: [
            [{ text: this.buttonLabel("history", language), callback_data: "home:history" }],
            [{ text: this.buttonLabel("warranty", language), callback_data: "warranty:start" }],
            [{ text: this.buttonLabel("home", language), callback_data: "home:menu" }],
          ],
        },
      );
      return true;
    }

    await this.routeWarrantyByAccountCount(
      token,
      Number(message.chat?.id || 0),
      undefined,
      shopId,
      telegramUserId,
      check.orderCode,
      check.accounts,
      actions,
      language,
    );

    return true;
  }

  private async routeWarrantyByAccountCount(
    token: string,
    chatId: number,
    messageId: number | undefined,
    shopId: string,
    telegramUserId: string,
    orderCode: string,
    accounts: string[],
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    if (accounts.length <= 1) {
      const claim = await this.warrantyService.submitTelegramWarrantyClaim({
        shopId,
        telegramUserId,
        telegramChatId: String(chatId),
        orderCode,
        language,
      });
      await this.sendWarrantyClaimResult(token, chatId, claim, actions, language);
    } else {
      await this.promptWarrantyAccountSelection(
        token,
        chatId,
        messageId,
        shopId,
        telegramUserId,
        orderCode,
        accounts,
        actions,
        language,
      );
    }
  }

  private async promptWarrantyAccountSelection(
    token: string,
    chatId: number,
    messageId: number | undefined,
    shopId: string,
    telegramUserId: string,
    orderCode: string,
    accounts: string[],
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    this.pendingWarrantyAccountSelections.set(
      this.getPendingQuantityKey(shopId, telegramUserId),
      { orderCode, accounts, expiresAt: Date.now() + this.pendingQuantityTtlMs },
    );

    const usernames = accounts.map((a) => (a.split("|")[0] || a).trim());
    const accountList = usernames.map((u, i) => `${i + 1}. ${u}`).join("\n");

    await this.editOrSend(
      token,
      chatId,
      messageId,
      [
        language === "en"
          ? "🛡️ Warranty request"
          : language === "th"
            ? "🛡️ คำขอรับประกัน"
            : "🛡️ Yêu cầu bảo hành",
        language === "en"
          ? `Order: ${orderCode}`
          : language === "th"
            ? `รหัสคำสั่งซื้อ: ${orderCode}`
            : `Đơn hàng: ${orderCode}`,
        "",
        language === "en"
          ? `This order has ${accounts.length} accounts:`
          : language === "th"
            ? `คำสั่งซื้อนี้มี ${accounts.length} บัญชี:`
            : `Đơn này có ${accounts.length} tài khoản:`,
        accountList,
        "",
        language === "en"
          ? "Enter the username(s) you want to replace, separated by semicolons (;)."
          : language === "th"
            ? "กรอก username ที่ต้องการเปลี่ยน คั่นด้วยเครื่องหมายอัฒภาค (;)"
            : "Nhập username của tài khoản cần bảo hành, cách nhau bởi dấu chấm phẩy (;).",
        language === "en"
          ? `Example: ${usernames[0]}${usernames[1] ? `;${usernames[1]}` : ""}`
          : language === "th"
            ? `ตัวอย่าง: ${usernames[0]}${usernames[1] ? `;${usernames[1]}` : ""}`
            : `Ví dụ: ${usernames[0]}${usernames[1] ? `;${usernames[1]}` : ""}`,
      ].join("\n"),
      {
        inline_keyboard: [
          [{ text: this.buttonLabel("home", language), callback_data: "home:menu" }],
        ],
      },
      actions,
    );
  }

  private async handlePendingWarrantyAccountSelectionMessage(
    shopId: string,
    token: string,
    message: TelegramUpdate,
    actions: unknown[],
  ) {
    const telegramUserId = String(message.from?.id || "");
    const language = await this.getCustomerLanguage(shopId, telegramUserId);
    const pending = this.getPendingWarrantyAccountSelection(shopId, telegramUserId);

    if (!pending) {
      return false;
    }

    const input = String(message.text || "").trim();

    if (!input) {
      await this.editOrSend(
        token,
        Number(message.chat?.id || 0),
        undefined,
        language === "en"
          ? "Please enter the username(s) separated by semicolons (;)."
          : language === "th"
            ? "กรุณากรอก username คั่นด้วยเครื่องหมายอัฒภาค (;)"
            : "Vui lòng nhập username cần bảo hành, cách nhau bởi dấu (;).",
        {
          inline_keyboard: [
            [{ text: this.buttonLabel("home", language), callback_data: "home:menu" }],
          ],
        },
        actions,
      );
      return true;
    }

    this.clearPendingWarrantyAccountSelection(shopId, telegramUserId);

    const targetUsernames = input.split(";").map((s) => s.trim()).filter(Boolean);

    const claim = await this.warrantyService.submitTelegramWarrantyClaim({
      shopId,
      telegramUserId,
      telegramChatId: String(message.chat?.id || telegramUserId),
      orderCode: pending.orderCode,
      targetUsernames,
      language,
    });

    await this.sendWarrantyClaimResult(token, message.chat.id, claim, actions, language);
    return true;
  }

  private async sendWarrantyClaimResult(
    token: string,
    chatId: number,
    claim: Awaited<ReturnType<WarrantyService["submitTelegramWarrantyClaim"]>>,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    let replyText: string;

    if (claim.status === "auto_resolved" && claim.deliveredAccountText) {
      replyText = [
        language === "en"
          ? "✅ Warranty approved. Here is your replacement account:"
          : language === "th"
            ? "✅ อนุมัติการรับประกันแล้ว นี่คือบัญชีทดแทนของคุณ:"
            : "✅ Bảo hành đã được duyệt. Đây là tài khoản thay thế của bạn:",
        "",
        claim.deliveredAccountText,
      ].join("\n");
    } else if (claim.status === "pending_manual") {
      const lines: string[] = [
        language === "en"
          ? "📋 Warranty request created. Please contact the shop for assistance:"
          : language === "th"
            ? "📋 บันทึกคำขอรับประกันแล้ว กรุณาติดต่อร้านเพื่อขอความช่วยเหลือ:"
            : "📋 Yêu cầu bảo hành đã được ghi nhận. Vui lòng liên hệ shop để được hỗ trợ:",
      ];
      if (claim.supportTelegram) lines.push(`Telegram: ${claim.supportTelegram}`);
      if (claim.supportZalo) lines.push(`Zalo: ${claim.supportZalo}`);
      replyText = lines.join("\n");
    } else if (
      claim.status === "pending_stock" ||
      claim.status === "pending_review" ||
      claim.status === "pending"
    ) {
      replyText =
        language === "en"
          ? `📋 Warranty request #${claim.claimNumber} has been recorded. The shop will handle it shortly.`
          : language === "th"
            ? `📋 บันทึกคำขอรับประกัน #${claim.claimNumber} แล้ว ร้านจะดำเนินการในเร็วๆ นี้`
            : `📋 Yêu cầu bảo hành #${claim.claimNumber} đã được ghi nhận. Shop sẽ xử lý trong thời gian sớm nhất.`;
    } else {
      replyText =
        claim.message ??
        (language === "en" ? "An error occurred." : language === "th" ? "เกิดข้อผิดพลาด" : "Đã xảy ra lỗi.");
    }

    await this.sendText(
      token,
      chatId,
      replyText,
      actions,
      {
        inline_keyboard: [
          [{ text: this.buttonLabel("history", language), callback_data: "home:history" }],
          [{ text: this.buttonLabel("warranty", language), callback_data: "warranty:start" }],
          [{ text: this.buttonLabel("home", language), callback_data: "home:menu" }],
        ],
      },
    );
  }

  private async handlePendingTxHashMessage(
    shopId: string,
    token: string,
    message: TelegramUpdate,
    actions: unknown[],
  ) {
    const telegramUserId = String(message.from?.id || "");
    const language = await this.getCustomerLanguage(shopId, telegramUserId);
    const pending = this.getPendingTxHashSubmission(shopId, telegramUserId);

    if (!pending) {
      return false;
    }

    try {
      const rawTxHash = String(message.text || "").trim();
      const result =
        pending.allowMockHash && /^mock:/i.test(rawTxHash)
          ? {
              alreadyPaid: false,
              txHash: rawTxHash,
              verification: {
                amountUsdt: 0,
              },
              order: await this.ordersService.markPaymentCompleted(
                pending.externalOrderCode,
                {
                  source: "simulate_mock_trc20_tx_hash",
                  txHash: rawTxHash,
                  externalOrderCode: pending.externalOrderCode,
                },
                {
                  cryptoTxHash: rawTxHash,
                },
              ),
            }
          : await this.onchainPaymentService.submitTelegramTxHash({
              shopId,
              telegramUserId,
              externalOrderCode: pending.externalOrderCode,
              txHash: rawTxHash,
            });

      this.clearPendingTxHashSubmission(shopId, telegramUserId);

      await this.sendText(
        token,
        message.chat.id,
        result.alreadyPaid
          ? [
              language === "en"
                ? `✅ Order ${result.order.orderCode} is already marked as paid.`
                : language === "th"
                  ? `✅ คำสั่งซื้อ ${result.order.orderCode} ถูกทำเครื่องหมายว่าชำระแล้ว`
                  : `✅ Đơn ${result.order.orderCode} đã được đánh dấu thanh toán rồi.`,
              `TX hash: ${result.txHash}`,
              "",
              language === "en"
                ? "You can open order history to track the delivery status."
                : language === "th"
                  ? "คุณสามารถเปิดประวัติคำสั่งซื้อเพื่อติดตามสถานะการจัดส่ง"
                  : "Bạn có thể mở lịch sử đơn để theo dõi trạng thái giao hàng.",
            ].join("\n")
          : [
              language === "en"
                ? "✅ TX hash verified successfully"
                : language === "th"
                  ? "✅ ยืนยัน TX hash สำเร็จ"
                  : "✅ Đã xác minh TX hash thành công",
              language === "en"
                ? `Order code: ${result.order.orderCode}`
                : language === "th"
                  ? `รหัสคำสั่งซื้อ: ${result.order.orderCode}`
                  : `Mã đơn: ${result.order.orderCode}`,
              `TX hash: ${result.txHash}`,
              ...((result.verification?.amountUsdt || 0) > 0
                ? [
                    language === "en"
                      ? `Confirmed amount: ${this.formatUsdt(result.verification?.amountUsdt || 0)} USDT`
                      : language === "th"
                        ? `จำนวนที่ยืนยัน: ${this.formatUsdt(result.verification?.amountUsdt || 0)} USDT`
                        : `Số tiền xác nhận: ${this.formatUsdt(result.verification?.amountUsdt || 0)} USDT`,
                  ]
                : []),
              "",
              language === "en"
                ? "The order is now being processed automatically."
                : language === "th"
                  ? "คำสั่งซื้อกำลังถูกดำเนินการอัตโนมัติ"
                  : "Đơn hàng đang được đưa vào luồng xử lý tự động.",
            ].join("\n"),
        actions,
        {
          inline_keyboard: [
            [
              { text: this.buttonLabel("history", language), callback_data: "home:history" },
              { text: this.buttonLabel("productsShort", language), callback_data: "home:products" },
            ],
          ],
        },
      );
    } catch (error) {
      await this.sendText(
        token,
        message.chat.id,
        [
          language === "en"
            ? `⚠️ Could not verify TX hash for order ${pending.orderCode}.`
            : language === "th"
              ? `⚠️ ไม่สามารถยืนยัน TX hash สำหรับคำสั่งซื้อ ${pending.orderCode} ได้`
              : `⚠️ Chưa thể xác minh TX hash cho đơn ${pending.orderCode}.`,
          this.localizeBotErrorMessage(error, language),
        ].join("\n"),
        actions,
        {
          inline_keyboard: [
            [{
              text: language === "en" ? "🧾 Try TX hash again" : language === "th" ? "🧾 ลองส่ง TX hash อีกครั้ง" : "🧾 Gửi lại TX hash",
              callback_data: `txhash:submit:${pending.externalOrderCode}`,
            }],
            [{ text: this.buttonLabel("history", language), callback_data: "home:history" }],
          ],
        },
      ).catch(() => undefined);
    }

    return true;
  }

  private async handlePendingQuantityMessage(
    shopId: string,
    token: string,
    message: TelegramUpdate,
    actions: unknown[],
  ) {
    const telegramUserId = String(message.from?.id || "");
    const language = await this.getCustomerLanguage(shopId, telegramUserId);
    const selection = this.getPendingQuantitySelection(shopId, telegramUserId);

    if (!selection) {
      return false;
    }

    const quantity = this.parseQuantityMessage(message.text, selection.maxQuantity);

    if (!quantity) {
      const usdtVndRate = await this.getShopUsdtVndRate(shopId);
      await this.sendQuantityReplyPrompt(
        shopId,
        token,
        String(message.chat.id || telegramUserId),
        telegramUserId,
        selection,
        actions,
        this.buildInvalidQuantityText(selection.maxQuantity, language),
        language,
        usdtVndRate,
      );
      return true;
    }

    try {
      const paymentProviders = await this.getAvailablePaymentOptions(
        shopId,
        telegramUserId,
        selection.salePrice * quantity,
      );
      const customer = {
        telegramUserId,
        telegramChatId: String(message.chat.id || telegramUserId),
        telegramUsername: message.from?.username || null,
        firstName: message.from?.first_name || null,
        lastName: message.from?.last_name || null,
      };

      if (paymentProviders.length > 1) {
        this.clearPendingQuantitySelection(shopId, telegramUserId);
        this.pendingPaymentSelections.set(
          this.getPendingQuantityKey(shopId, telegramUserId),
          {
            sourceProductId: selection.sourceProductId,
            quantity,
            ...customer,
            expiresAt: Date.now() + this.pendingPaymentTtlMs,
          },
        );
        await this.renderPaymentMethodPrompt(
          shopId,
          token,
          message.chat.id,
          selection,
          quantity,
          paymentProviders,
          actions,
          language,
        );
        return true;
      }

      if (paymentProviders[0] === "WALLET") {
        await this.handleBuyWithWallet(
          shopId,
          token,
          selection.sourceProductId,
          quantity,
          customer,
          actions,
          language,
        );
      } else {
        await this.handleBuy(
          shopId,
          token,
          selection.sourceProductId,
          quantity,
          customer,
          actions,
          paymentProviders[0],
          language,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to create Telegram order for shop ${shopId}, product ${selection.sourceProductId}, quantity ${quantity}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(
        token,
        message.chat.id,
        [
          language === "en"
            ? "⚠️ Cannot create the order right now."
            : language === "th"
              ? "⚠️ ไม่สามารถสร้างคำสั่งซื้อได้ในขณะนี้"
              : "⚠️ Không thể tạo đơn hàng lúc này.",
          this.localizeBotErrorMessage(error, language),
        ].join("\n"),
        actions,
        {
          inline_keyboard: [[{ text: language === "en" ? "⬅️ Back to products" : language === "th" ? "⬅️ กลับไปยังสินค้า" : "⬅️ Quay lại sản phẩm", callback_data: "home:products" }]],
        },
      ).catch(() => undefined);
    }

    return true;
  }

  private async handlePendingWalletTopupMessage(
    shopId: string,
    token: string,
    message: TelegramUpdate,
    actions: unknown[],
  ) {
    const telegramUserId = String(message.from?.id || "");
    const language = await this.getCustomerLanguage(shopId, telegramUserId);
    const pending = this.getPendingWalletTopup(shopId, telegramUserId);

    if (!pending) {
      return false;
    }

    const amount = this.parseWalletTopupAmount(message.text);

    if (!amount) {
      await this.promptWalletTopupAmount(
        shopId,
        token,
        Number(message.chat.id),
        telegramUserId,
        actions,
        language === "en"
          ? "❌ Invalid amount. Please enter an integer from 1,000 VND."
          : language === "th"
            ? "❌ จำนวนเงินไม่ถูกต้อง กรุณาระบุจำนวนเต็มตั้งแต่ 1,000 VND ขึ้นไป"
            : "❌ Số tiền không hợp lệ. Vui lòng nhập số nguyên từ 1.000đ trở lên.",
        language,
      );
      return true;
    }

    try {
      const created = await this.customerWalletService.createTopupForTelegram({
        shopId,
        amount,
        customer: {
          telegramUserId,
          telegramChatId: String(message.chat.id || telegramUserId),
          telegramUsername: message.from?.username || null,
          firstName: message.from?.first_name || null,
          lastName: message.from?.last_name || null,
        },
      });

      this.clearPendingWalletTopup(shopId, telegramUserId);

      const qrImageUrl = this.buildQrImageUrl(created.topup.qrCode);
      const usdtVndRate = await this.getShopUsdtVndRate(shopId);
      const text = this.buildWalletTopupInstructionText(
        created.topup.amount,
        created.topup.externalOrderCode,
        created.topup.expiresAt,
        language,
        usdtVndRate,
      );

      const replyMarkup = {
        inline_keyboard: [
          ...(this.isPublicCheckoutUrl(created.topup.checkoutUrl)
            ? [[{
              text: language === "en" ? "💳 Open payment page" : language === "th" ? "💳 เปิดหน้าชำระเงิน" : "💳 Mở trang thanh toán",
              url: created.topup.checkoutUrl,
            }]]
            : []),
          [
            { text: language === "en" ? "💳 View wallet" : language === "th" ? "💳 ดูกระเป๋าเงิน" : "💳 Xem ví", callback_data: "home:wallet" },
            { text: this.buttonLabel("home", language), callback_data: "home:menu" },
          ],
        ],
      };

      let sentMessageId: number | null = null;
      if (qrImageUrl) {
        sentMessageId = await this.sendPhoto(token, message.chat.id, qrImageUrl, text, actions, replyMarkup);
      } else {
        const result = await this.sendText(token, message.chat.id, text, actions, replyMarkup);
        sentMessageId = result && typeof result === "object" && "message_id" in result
          ? (result as { message_id: number }).message_id
          : null;
      }

      if (sentMessageId) {
        this.pendingQrMessages.set(created.topup.externalOrderCode, {
          token,
          chatId: message.chat.id,
          messageId: sentMessageId,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to create wallet topup for shop ${shopId}, telegram user ${telegramUserId}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.promptWalletTopupAmount(
        shopId,
        token,
        Number(message.chat.id),
        telegramUserId,
        actions,
        this.localizeBotErrorMessage(
          error,
          language,
          language === "en"
            ? "Cannot create a wallet top-up right now."
            : language === "th"
              ? "ไม่สามารถสร้างรายการเติมเงินได้ในขณะนี้"
              : "Không thể tạo lệnh nạp ví lúc này.",
        ),
        language,
      );
    }

    return true;
  }

  async sendWalletTopupPaidMessage(
    shopId: string,
    amount: number,
    balanceAfter: number,
    chatId: string | number,
    externalOrderCode: string,
  ) {
    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    const language = await this.getCustomerLanguageByChatId(shopId, chatId);
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);

    const token = decryptSecret(
      shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (!token) {
      return;
    }

    const qrMsg = this.pendingQrMessages.get(externalOrderCode);
    if (qrMsg) {
      await telegramDeleteMessage(qrMsg.token, qrMsg.chatId, qrMsg.messageId).catch(() => undefined);
      this.pendingQrMessages.delete(externalOrderCode);
    }

    await this.sendText(
      token,
      chatId,
      language === "en"
        ? [
            "✅ Wallet top-up successful",
            `Amount credited: ${this.formatBotMoney(amount, language, usdtVndRate)}`,
            `Gateway amount: ${formatCurrency(amount)}`,
            `Top-up code: ${externalOrderCode}`,
            `Current wallet balance: ${this.formatBotMoney(balanceAfter, language, usdtVndRate)}`,
            "",
            "You can continue shopping or view your wallet in the bot.",
          ].join("\n")
        : language === "th"
          ? [
              "✅ เติมเงินกระเป๋าเงินสำเร็จ",
              `จำนวนเงินที่เครดิต: ${this.formatBotMoney(amount, language, usdtVndRate)}`,
              `จำนวนเงิน: ${formatCurrency(amount)}`,
              `รหัสการเติมเงิน: ${externalOrderCode}`,
              `ยอดคงเหลือปัจจุบัน: ${this.formatBotMoney(balanceAfter, language, usdtVndRate)}`,
              "",
              "คุณสามารถซื้อสินค้าต่อหรือดูกระเป๋าเงินในบอทได้",
            ].join("\n")
          : [
              "✅ Nạp ví thành công",
              `Số tiền đã nạp: ${this.formatBotMoney(amount, language, usdtVndRate)}`,
              `Mã nạp: ${externalOrderCode}`,
              `Số dư hiện tại: ${this.formatBotMoney(balanceAfter, language, usdtVndRate)}`,
              "",
              "Bạn có thể tiếp tục theo dõi ví hoặc mua hàng ngay trong bot.",
            ].join("\n"),
      [],
      {
        inline_keyboard: [
          [
            {
              text: language === "en" ? "💳 View wallet" : language === "th" ? "💳 ดูกระเป๋าเงิน" : "💳 Xem ví",
              callback_data: "home:wallet",
            },
            {
              text: language === "en" ? "🛍️ Products" : language === "th" ? "🛍️ สินค้า" : "🛍️ Xem sản phẩm",
              callback_data: "home:products",
            },
          ],
        ],
      },
    );
  }

  async sendWalletTopupExpiredMessage(
    shopId: string,
    chatId: string | number,
    externalOrderCode: string,
    amount: number,
  ) {
    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    const language = await this.getCustomerLanguageByChatId(shopId, chatId);
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    const token = decryptSecret(
      shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (!token) {
      return;
    }

    await this.sendText(
      token,
      chatId,
      language === "en"
        ? [
            "⌛ Wallet top-up expired",
            `Top-up code: ${externalOrderCode}`,
            `Amount: ${this.formatBotMoney(amount, language, usdtVndRate)}`,
            `Gateway amount: ${formatCurrency(amount)}`,
            "",
            "This top-up was not paid within 5 minutes and has been canceled.",
          ].join("\n")
        : language === "th"
          ? [
              "⌛ การเติมเงินกระเป๋าเงินหมดอายุ",
              `รหัสการเติมเงิน: ${externalOrderCode}`,
              `จำนวนเงิน: ${this.formatBotMoney(amount, language, usdtVndRate)}`,
              "",
              "การเติมเงินนี้ไม่ได้ชำระภายใน 5 นาทีและถูกยกเลิกแล้ว",
            ].join("\n")
          : [
              "⌛ Lệnh nạp ví đã hết hạn",
              `Mã nạp: ${externalOrderCode}`,
              `Số tiền: ${this.formatBotMoney(amount, language, usdtVndRate)}`,
              "",
              "Lệnh nạp đã quá 5 phút chưa thanh toán và đã bị hủy.",
            ].join("\n"),
      [],
      {
        inline_keyboard: [
          [{ text: language === "en" ? "🏦 Top up again" : language === "th" ? "🏦 เติมเงินอีกครั้ง" : "🏦 Nạp lại", callback_data: "wallet:topup" }],
          [{ text: language === "en" ? "💳 View wallet" : language === "th" ? "💳 ดูกระเป๋าเงิน" : "💳 Xem ví", callback_data: "home:wallet" }],
        ],
      },
    ).catch(() => undefined);
  }

  async sendConnectionTopupPaidMessage(
    upstreamShopId: string,
    downstreamShopId: string,
    amount: number,
    balanceAfter: number,
  ) {
    const upstreamShop = await this.shopsService.getSellerShopByShopId(upstreamShopId);
    const upstreamToken = decryptSecret(
      upstreamShop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (upstreamToken && upstreamShop.supportTelegram && !(this.config.mockTelegramEnabled && isMockBotToken(upstreamToken))) {
      await telegramSendMessage(
        upstreamToken,
        upstreamShop.supportTelegram,
        `💰 Khách PRO vừa nạp ${formatCurrency(amount)} vào ví kết nối.`,
      ).catch(() => undefined);
    }

    const downstreamCustomer = await this.prisma.customer.findFirst({
      where: { shopId: downstreamShopId },
      select: { telegramChatId: true },
      orderBy: { createdAt: "desc" },
    });

    if (downstreamCustomer?.telegramChatId && upstreamToken && !(this.config.mockTelegramEnabled && isMockBotToken(upstreamToken))) {
      await telegramSendMessage(
        upstreamToken,
        downstreamCustomer.telegramChatId,
        [
          "✅ Nạp ví kết nối thành công!",
          `Số tiền: ${formatCurrency(amount)}`,
          `Số dư hiện tại: ${formatCurrency(balanceAfter)}`,
        ].join("\n"),
      ).catch(() => undefined);
    }
  }

  async sendCatalogStockUpdateMessages(
    shopId: string,
    updates: Array<{
      externalProductId: string;
      displayName: string;
      addedQuantity: number;
      available: number;
    }>,
  ) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return 0;
    }

    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    const token = decryptSecret(
      shop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (!token) {
      return 0;
    }

    if (this.config.mockTelegramEnabled && isMockBotToken(token)) {
      return 0;
    }

    const customers = await this.prisma.customer.findMany({
      where: { shopId },
      select: {
        telegramChatId: true,
        preferredLanguage: true,
      },
    });

    if (customers.length === 0) {
      return 0;
    }

    const catalog = await this.shopsService.getCatalogViewForShop(shopId);
    const productByExternalId = new Map(
      catalog.map((item) => [item.sourceProductId, item]),
    );
    let sentCount = 0;

    for (const customer of customers) {
      for (const update of updates) {
        const product = productByExternalId.get(update.externalProductId);

        const customerLang = this.normalizeLanguage(customer.preferredLanguage);

        if (!product || product.hidden || !product.enabled) {
          continue;
        }

        if (customerLang === "vi" && product.hiddenVi) continue;
        if (customerLang === "en" && product.hiddenEn) continue;

        await this.sendText(
          token,
          customer.telegramChatId,
          [
            customerLang === "en" ? "📢 Restock notification!" : customerLang === "th" ? "📢 แจ้งเตือนสินค้าเข้าใหม่!" : "📢 Thông báo nhập kho!",
            "",
            `📦 ${this.localizeProductName(
              product.displayName || update.displayName,
              customerLang,
            )}`,
            customerLang === "en"
              ? `➕ Added: ${update.addedQuantity}`
              : customerLang === "th"
                ? `➕ เพิ่ม: ${update.addedQuantity}`
                : `➕ Thêm: ${update.addedQuantity}`,
            customerLang === "en"
              ? `📦 Current stock: ${update.available}`
              : customerLang === "th"
                ? `📦 สต็อกปัจจุบัน: ${update.available}`
                : `📦 Tồn kho hiện tại: ${update.available}`,
          ].join("\n"),
          [],
          {
            inline_keyboard: [
              [
                {
                  text: customerLang === "en" ? "🛒 Buy now" : customerLang === "th" ? "🛒 ซื้อเลย" : "🛒 Mua ngay",
                  callback_data: `buy:${product.id}`,
                },
              ],
            ],
          },
        ).catch(() => undefined);

        sentCount += 1;
      }
    }

    return sentCount;
  }

  private async sendQuantityReplyPrompt(
    shopId: string,
    token: string,
    chatId: string | number,
    telegramUserId: string,
    selection: Omit<PendingQuantitySelection, "expiresAt"> | PendingQuantitySelection,
    actions: unknown[],
    leadLine?: string,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    await this.sendText(
      token,
      chatId,
      [
        leadLine
          ? leadLine
          : language === "en"
            ? `✅ You selected ${this.localizeProductName(selection.displayName, language)} (${this.formatBotMoneyWithUsdOverride(selection.salePrice, (selection as any).salePriceUsd, language, usdtVndRate)}).`
            : language === "th"
              ? `✅ คุณเลือก ${this.localizeProductName(selection.displayName, language)} (${this.formatBotMoneyWithUsdOverride(selection.salePrice, (selection as any).salePriceUsd, language, usdtVndRate)})`
              : `✅ Bạn đã chọn ${this.localizeProductName(selection.displayName, language)} (${this.formatBotMoneyWithUsdOverride(selection.salePrice, (selection as any).salePriceUsd, language, usdtVndRate)}).`,
        this.buildQuantityPromptText(selection.maxQuantity, language),
      ].join("\n"),
      actions,
      {
        inline_keyboard: [
          [{ text: language === "en" ? "⬅️ Choose another product" : language === "th" ? "⬅️ เลือกสินค้าอื่น" : "⬅️ Chọn sản phẩm khác", callback_data: "home:products" }],
        ],
      },
    );

    this.pendingQuantitySelections.set(
      this.getPendingQuantityKey(shopId, telegramUserId),
      {
        sourceProductId: selection.sourceProductId,
        displayName: selection.displayName,
        salePrice: selection.salePrice,
        salePriceUsd: (selection as any).salePriceUsd ?? null,
        available: selection.available,
        maxQuantity: selection.maxQuantity,
        expiresAt: Date.now() + this.pendingQuantityTtlMs,
      },
    );
  }

  private async getCatalogItemForTelegram(
    shopId: string,
    sourceProductId: string,
    language: BotLanguage = "vi",
  ) {
    const products = await this.shopsService.getCatalogViewForShop(shopId);
    const product = products.find((item) => item.id === sourceProductId);

    if (!product || product.hidden || !product.enabled) {
      throw new Error(
        language === "en"
          ? "This product is not available right now."
          : language === "th"
            ? "สินค้านี้ไม่พร้อมใช้งานในขณะนี้"
            : "Sản phẩm hiện không khả dụng.",
      );
    }

    if (product.available !== null && product.available <= 0) {
      throw new Error(
        language === "en"
          ? "This product is out of stock."
          : language === "th"
            ? "สินค้าหมดแล้ว"
            : "Sản phẩm đã hết hàng.",
      );
    }

    return product;
  }

  private getMaxQuantity(available: number | null) {
    if (available === null) {
      return null;
    }

    return Math.max(0, available);
  }

  private parseQuantityMessage(text: string, maxQuantity: number | null) {
    const value = Number(String(text || "").trim());

    if (!Number.isInteger(value) || value < 1) {
      return null;
    }

    if (maxQuantity !== null && value > maxQuantity) {
      return null;
    }

    return value;
  }

  private buildQuantityPromptText(maxQuantity: number | null, language: BotLanguage = "vi") {
    if (language === "en") {
      if (maxQuantity === null) {
        return "✏️ Enter quantity to buy:";
      }

      return `✏️ Enter quantity to buy (max ${maxQuantity}):`;
    }

    if (language === "th") {
      if (maxQuantity === null) {
        return "✏️ ระบุจำนวนที่ต้องการซื้อ:";
      }

      return `✏️ ระบุจำนวนที่ต้องการซื้อ (สูงสุด ${maxQuantity}):`;
    }

    if (maxQuantity === null) {
      return "✏️ Nhập số lượng cần mua:";
    }

    return `✏️ Nhập số lượng cần mua (tối đa ${maxQuantity}):`;
  }

  private buildInvalidQuantityText(maxQuantity: number | null, language: BotLanguage = "vi") {
    if (language === "en") {
      if (maxQuantity === null) {
        return "❌ Invalid quantity. Please enter a positive integer.";
      }

      return `❌ Invalid quantity. Please enter a number from 1 to ${maxQuantity}.`;
    }

    if (language === "th") {
      if (maxQuantity === null) {
        return "❌ จำนวนไม่ถูกต้อง กรุณาระบุจำนวนเต็มบวก";
      }

      return `❌ จำนวนไม่ถูกต้อง กรุณาระบุตัวเลขตั้งแต่ 1 ถึง ${maxQuantity}`;
    }

    if (maxQuantity === null) {
      return "❌ Số lượng không hợp lệ. Vui lòng nhập số nguyên dương.";
    }

    return `❌ Số lượng không hợp lệ. Vui lòng nhập số từ 1 đến ${maxQuantity}.`;
  }

  private buildQrImageUrl(qrCode: string | null) {
    const rawValue = String(qrCode || "").trim();

    if (!rawValue) {
      return null;
    }

    if (rawValue.startsWith("qrdata:")) {
      return `https://quickchart.io/qr?size=320&text=${encodeURIComponent(rawValue.slice("qrdata:".length))}`;
    }

    try {
      const parsed = new URL(rawValue);

      if (["http:", "https:"].includes(parsed.protocol)) {
        return rawValue;
      }
    } catch {
      return `https://quickchart.io/qr?size=320&text=${encodeURIComponent(rawValue)}`;
    }

    return null;
  }

  private getPendingQuantityKey(shopId: string, telegramUserId: string) {
    return `${shopId}:${telegramUserId}`;
  }

  private getPendingWalletTopup(shopId: string, telegramUserId: string) {
    const key = this.getPendingQuantityKey(shopId, telegramUserId);
    const pending = this.pendingWalletTopups.get(key);

    if (!pending) {
      return null;
    }

    if (pending.expiresAt <= Date.now()) {
      this.pendingWalletTopups.delete(key);
      return null;
    }

    return pending;
  }

  private getPendingQuantitySelection(shopId: string, telegramUserId: string) {
    const key = this.getPendingQuantityKey(shopId, telegramUserId);
    const selection = this.pendingQuantitySelections.get(key);

    if (!selection) {
      return null;
    }

    if (selection.expiresAt <= Date.now()) {
      this.pendingQuantitySelections.delete(key);
      return null;
    }

    return selection;
  }

  private getPendingPaymentSelection(shopId: string, telegramUserId: string) {
    const key = this.getPendingQuantityKey(shopId, telegramUserId);
    const selection = this.pendingPaymentSelections.get(key);

    if (!selection) {
      return null;
    }

    if (selection.expiresAt <= Date.now()) {
      this.pendingPaymentSelections.delete(key);
      return null;
    }

    return selection;
  }

  private getPendingTxHashSubmission(shopId: string, telegramUserId: string) {
    const key = this.getPendingQuantityKey(shopId, telegramUserId);
    const pending = this.pendingTxHashSubmissions.get(key);

    if (!pending) {
      return null;
    }

    if (pending.expiresAt <= Date.now()) {
      this.pendingTxHashSubmissions.delete(key);
      return null;
    }

    return pending;
  }

  private getPendingWarrantyClaimSubmission(shopId: string, telegramUserId: string) {
    const key = this.getPendingQuantityKey(shopId, telegramUserId);
    const pending = this.pendingWarrantyClaimSubmissions.get(key);

    if (!pending) {
      return null;
    }

    if (pending.expiresAt <= Date.now()) {
      this.pendingWarrantyClaimSubmissions.delete(key);
      return null;
    }

    return pending;
  }

  private clearPendingQuantitySelection(shopId: string, telegramUserId: string) {
    if (!telegramUserId) {
      return;
    }

    this.pendingQuantitySelections.delete(this.getPendingQuantityKey(shopId, telegramUserId));
  }

  private clearPendingWalletTopup(shopId: string, telegramUserId: string) {
    if (!telegramUserId) {
      return;
    }

    this.pendingWalletTopups.delete(this.getPendingQuantityKey(shopId, telegramUserId));
  }

  private clearPendingPaymentSelection(shopId: string, telegramUserId: string) {
    if (!telegramUserId) {
      return;
    }

    this.pendingPaymentSelections.delete(this.getPendingQuantityKey(shopId, telegramUserId));
  }

  private clearPendingTxHashSubmission(shopId: string, telegramUserId: string) {
    if (!telegramUserId) {
      return;
    }

    this.pendingTxHashSubmissions.delete(this.getPendingQuantityKey(shopId, telegramUserId));
  }

  private clearPendingWarrantyClaimSubmission(shopId: string, telegramUserId: string) {
    if (!telegramUserId) {
      return;
    }

    this.pendingWarrantyClaimSubmissions.delete(this.getPendingQuantityKey(shopId, telegramUserId));
  }

  private clearPendingWarrantyIssueDescription(shopId: string, telegramUserId: string) {
    if (!telegramUserId) {
      return;
    }

    this.pendingWarrantyIssueDescriptions.delete(this.getPendingQuantityKey(shopId, telegramUserId));
  }

  private getPendingWarrantyAccountSelection(shopId: string, telegramUserId: string) {
    const key = this.getPendingQuantityKey(shopId, telegramUserId);
    const pending = this.pendingWarrantyAccountSelections.get(key);

    if (!pending) {
      return null;
    }

    if (pending.expiresAt <= Date.now()) {
      this.pendingWarrantyAccountSelections.delete(key);
      return null;
    }

    return pending;
  }

  private clearPendingWarrantyAccountSelection(shopId: string, telegramUserId: string) {
    if (!telegramUserId) {
      return;
    }

    this.pendingWarrantyAccountSelections.delete(this.getPendingQuantityKey(shopId, telegramUserId));
  }

  private getPendingConnectionTopupKey(shopId: string, telegramUserId: string) {
    return this.getPendingQuantityKey(shopId, telegramUserId);
  }

  private async handleProKeyReissue(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    token: string,
    chatId: number,
    messageId: number | undefined,
    downstreamSellerId: string,
    actions: unknown[],
  ) {
    if (shop.seller.tier !== SellerTier.ULTRA) return;

    const existingConn = await this.prisma.downstreamSourceConnection.findFirst({
      where: { upstreamShopId: shop.id, downstreamSellerId },
      include: { apiKey: true },
    });

    if (existingConn?.apiKey) {
      await this.prisma.internalSourceApiKey.update({
        where: { id: existingConn.apiKey.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const result = await this.apiKeyService.issueKey(shop.sellerId, shop.id, {
      label: `Bot - ${downstreamSellerId.slice(0, 8)} - ${today}`,
    });

    if (existingConn) {
      await this.prisma.downstreamSourceConnection.update({
        where: { id: existingConn.id },
        data: { apiKeyId: result.id, status: DownstreamSourceConnectionStatus.ACTIVE },
      });
    }

    await this.editOrSend(
      token,
      chatId,
      messageId,
      [
        "✅ Đã cấp key mới!",
        "",
        `🔑 Key: \`${result.key}\``,
        "",
        "⚠️ Copy ngay, sẽ không hiển thị lại.",
      ].join("\n"),
      { inline_keyboard: [] },
      actions,
    );
  }

  private async handleProKeyTopupPrompt(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    token: string,
    chatId: number,
    messageId: number | undefined,
    telegramUserId: string,
    actions: unknown[],
  ) {
    const plusCustomer = await this.findPlusSellerByTelegramUserId(telegramUserId);

    if (!plusCustomer) {
      await this.editOrSend(token, chatId, messageId, "⛔ Không tìm thấy tài khoản PRO.", { inline_keyboard: [] }, actions);
      return;
    }

    const connection = await this.prisma.downstreamSourceConnection.findFirst({
      where: {
        upstreamShopId: shop.id,
        downstreamShopId: plusCustomer.shopId,
        status: DownstreamSourceConnectionStatus.ACTIVE,
      },
    });

    if (!connection) {
      await this.editOrSend(token, chatId, messageId, "⛔ Không có kết nối đang hoạt động.", { inline_keyboard: [] }, actions);
      return;
    }

    this.pendingConnectionTopupInputs.set(
      this.getPendingConnectionTopupKey(shop.id, telegramUserId),
      { connectionId: connection.id, downstreamShopId: plusCustomer.shopId, expiresAt: Date.now() + this.pendingQuantityTtlMs },
    );

    await this.editOrSend(
      token,
      chatId,
      messageId,
      [
        "💰 Nạp ví kết nối nguồn",
        `Số dư hiện tại: ${formatCurrency(decimalToNumber(connection.balance))}`,
        "",
        "Nhập số tiền muốn nạp (VND, tối thiểu 10,000đ):",
      ].join("\n"),
      { inline_keyboard: [[{ text: "❌ Hủy", callback_data: "prokey:cancel" }]] },
      actions,
    );
  }

  private async handlePendingConnectionTopupAmountMessage(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    token: string,
    message: TelegramUpdate,
    actions: unknown[],
  ) {
    const telegramUserId = String(message.from?.id || "");
    const key = this.getPendingConnectionTopupKey(shop.id, telegramUserId);
    const pending = this.pendingConnectionTopupInputs.get(key);

    if (!pending || pending.expiresAt <= Date.now()) {
      if (pending) this.pendingConnectionTopupInputs.delete(key);
      return false;
    }

    const raw = String(message.text || "").trim().replace(/[,.]/g, "");
    const amount = parseInt(raw, 10);

    if (!Number.isInteger(amount) || amount < 10000) {
      await this.sendText(
        token,
        message.chat.id,
        "⚠️ Số tiền không hợp lệ. Tối thiểu 10,000đ. Nhập lại:",
        actions,
        { inline_keyboard: [[{ text: "❌ Hủy", callback_data: "prokey:cancel" }]] },
      );
      return true;
    }

    this.pendingConnectionTopupInputs.delete(key);

    try {
      const result = await this.connectionTopupService.createPayosTopupForConnection(
        pending.connectionId,
        pending.downstreamShopId,
        amount,
      );

      await this.sendText(
        token,
        message.chat.id,
        [
          `💰 Tạo lệnh nạp ${formatCurrency(amount)} thành công!`,
          "",
          "Quét mã QR hoặc bấm link để thanh toán:",
          result.checkoutUrl,
          "",
          `Hết hạn sau 15 phút.`,
        ].join("\n"),
        actions,
        { inline_keyboard: [[{ text: "❌ Hủy giao dịch", callback_data: "prokey:cancel" }]] },
      );
    } catch (error) {
      await this.sendText(
        token,
        message.chat.id,
        `⚠️ ${error instanceof Error ? error.message : "Không thể tạo lệnh nạp tiền."}`,
        actions,
      );
    }

    return true;
  }

  private async findPlusSellerByTelegramUserId(telegramUserId: string) {
    return this.prisma.customer.findFirst({
      where: {
        telegramUserId,
        shop: {
          seller: { tier: SellerTier.PRO },
        },
      },
      include: {
        shop: {
          include: { seller: true },
        },
      },
    });
  }

  private async handleProAdminPanel(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    token: string,
    chatId: number,
    messageId: number | undefined,
    actions: unknown[],
  ) {
    const connections = await this.prisma.downstreamSourceConnection.findMany({
      where: { upstreamShopId: shop.id },
      include: {
        apiKey: true,
        downstreamSeller: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (connections.length === 0) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        [
          "🔑 Quản lý API Key (PRO Admin)",
          "",
          "Chưa có kết nối PRO nào.",
          "",
          "PRO seller cần nhắn /api trong bot này để nhận key.",
        ].join("\n"),
        { inline_keyboard: [] },
        actions,
      );
      return;
    }

    const lines = [
      "🔑 Quản lý API Key (PRO Admin)",
      `Có ${connections.length} kết nối:`,
      "",
    ];

    const buttons: { text: string; callback_data: string }[][] = [];

    for (const conn of connections) {
      const name = conn.downstreamSeller?.displayName || conn.downstreamSellerId.slice(0, 8);
      const status = conn.status === DownstreamSourceConnectionStatus.ACTIVE ? "✅" : "⏸️";
      const balance = formatCurrency(decimalToNumber(conn.balance));
      const keyHint = conn.apiKey?.keyPrefix ? `${conn.apiKey.keyPrefix}…` : "chưa có key";
      lines.push(`${status} ${name} — ${balance} — ${keyHint}`);
      buttons.push([
        { text: `Cấp key: ${name.slice(0, 15)}`, callback_data: `prokey:reissue:${conn.downstreamSellerId}` },
      ]);
    }

    await this.editOrSend(
      token,
      chatId,
      messageId,
      lines.join("\n"),
      {
        inline_keyboard: [
          ...buttons,
          [{ text: "❌ Đóng", callback_data: "prokey:cancel" }],
        ],
      },
      actions,
    );
  }

  private generateReferralCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  private async getOrCreateReferralCode(customerId: string): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = this.generateReferralCode();
      const existing = await this.prisma.customer.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!existing) {
        await this.prisma.customer.update({
          where: { id: customerId },
          data: { referralCode: code },
        });
        return code;
      }
    }
    return customerId;
  }

  private async applyAffiliateRef(shopId: string, telegramUserId: string, refParam: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { shopId_telegramUserId: { shopId, telegramUserId } },
      select: { id: true, referredById: true },
    });
    if (!customer || customer.referredById) return;

    // Look up referrer by referralCode (new) or id (backward compat)
    const referrer = await this.prisma.customer.findFirst({
      where: {
        shopId,
        OR: [{ referralCode: refParam }, { id: refParam }],
      },
      select: { id: true },
    });
    if (!referrer || referrer.id === customer.id) return;

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { referredById: referrer.id },
    });
  }

  private async renderAffiliatePanel(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    token: string,
    chatId: number,
    messageId: number | undefined,
    telegramUserId: string,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    const config = await this.affiliateService.getConfigByShopId(shop.id);
    const customer = await this.prisma.customer.findUnique({
      where: { shopId_telegramUserId: { shopId: shop.id, telegramUserId } },
      select: { id: true, referralCode: true },
    });

    if (!config?.enabled || !customer) {
      const text =
        language === "en"
          ? `🤝 <b>Affiliate Program</b>\n\nThe affiliate program is not currently active for this shop.`
          : language === "th"
            ? `🤝 <b>โปรแกรมแนะนำเพื่อน</b>\n\nโปรแกรมแนะนำเพื่อนยังไม่ได้เปิดใช้งานในร้านนี้`
            : `🤝 <b>Chương trình Affiliate</b>\n\nChương trình affiliate chưa được kích hoạt tại shop này.`;
      await this.editOrSend(token, chatId, messageId, text, {
        inline_keyboard: [[{ text: this.buttonLabel("home", language), callback_data: "home:menu" }]],
      }, actions, "HTML");
      return;
    }

    // Get or lazily create the referral token for this customer
    const refCode = customer.referralCode || await this.getOrCreateReferralCode(customer.id);

    const stats = await this.affiliateService.getStatsByCustomer(customer.id);
    const botUsername = shop.botConfig?.telegramBotUsername || "";
    const refLink = botUsername ? `https://t.me/${botUsername}?start=ref_${refCode}` : null;
    const commissionPct = Number(config.commissionPct);

    // Default intro: always describes the program + auto-mentions % when set
    const defaultIntro = language === "en"
      ? commissionPct > 0
        ? `Share your referral link and earn <b>${commissionPct}%</b> commission for every successful order placed by people you refer. No limit on referrals.`
        : `Join our affiliate program and earn commission for every customer you refer.`
      : commissionPct > 0
        ? `Chia sẻ link giới thiệu và nhận <b>${commissionPct}%</b> hoa hồng cho mỗi đơn thành công từ người bạn giới thiệu. Không giới hạn số lượt.`
        : `Tham gia chương trình affiliate và nhận hoa hồng cho mỗi khách hàng bạn giới thiệu.`;

    const programInfo = config.programText
      ? `${defaultIntro}\n\n${config.programText}`
      : defaultIntro;

    const lines = language === "en" ? [
      `🤝 <b>Affiliate Program</b>`,
      ``,
      programInfo,
      ``,
      `💰 Commission earned: <b>${stats.commissionBalance.toLocaleString("vi-VN")} ₫</b>`,
      `👥 Referred customers: <b>${stats.downlineCount}</b>`,
      refLink ? `\n🔗 <b>Your referral link:</b>\n<code>${refLink}</code>` : ``,
    ] : language === "th" ? [
      `🤝 <b>โปรแกรมแนะนำเพื่อน</b>`,
      ``,
      programInfo,
      ``,
      `💰 ค่าคอมมิชชันสะสม: <b>${stats.commissionBalance.toLocaleString("vi-VN")} ₫</b>`,
      `👥 ลูกค้าที่แนะนำ: <b>${stats.downlineCount}</b>`,
      refLink ? `\n🔗 <b>ลิงก์แนะนำของคุณ:</b>\n<code>${refLink}</code>` : ``,
    ] : [
      `🤝 <b>Chương trình Affiliate</b>`,
      ``,
      programInfo,
      ``,
      `💰 Hoa hồng tích lũy: <b>${stats.commissionBalance.toLocaleString("vi-VN")} ₫</b>`,
      `👥 Người đã giới thiệu: <b>${stats.downlineCount}</b>`,
      refLink ? `\n🔗 <b>Link giới thiệu của bạn:</b>\n<code>${refLink}</code>` : ``,
    ];

    await this.editOrSend(token, chatId, messageId, lines.filter(Boolean).join("\n"), {
      inline_keyboard: [[{ text: this.buttonLabel("home", language), callback_data: "home:menu" }]],
    }, actions, "HTML");
  }

  private async handleProKeyMenu(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    token: string,
    chatId: number,
    messageId: number | undefined,
    _telegramUserId: string,
    actions: unknown[],
  ) {
    if (shop.seller.tier !== SellerTier.ULTRA) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        "⛔ Lệnh này chỉ dành cho shop PRO.",
        { inline_keyboard: [] },
        actions,
      );
      return;
    }

    const chatIdStr = String(chatId);
    const swaggerUrl = `${this.config.appPublicUrl}/api/swagger`;
    const existing = await this.apiKeyService.getActiveKeyForLabel(shop.id, chatIdStr);

    const displayKey = existing?.keyEncrypted
      ? this.apiKeyService.decryptKey(existing.keyEncrypted)
      : null;

    const result = displayKey
      ? { key: displayKey }
      : await this.apiKeyService.issueKey(shop.sellerId, shop.id, { label: `Bot - ${chatIdStr}`, telegramChatId: chatIdStr });

    await this.editOrSend(
      token,
      chatId,
      messageId,
      [
        "🔑 *API Key nguồn nội bộ*",
        "",
        "Your API key is:",
        "```",
        result.key,
        "```",
        "_(tap to copy)_",
        "",
        `📖 API Docs: ${swaggerUrl}`,
        "",
        "API list:",
        "- GET /internal-source/v1/catalog",
        "- GET /internal-source/v1/balance",
        "- POST /internal-source/v1/orders",
      ].join("\n"),
      {
        inline_keyboard: [
          [{ text: "🏠 Về trang chủ", callback_data: "home:menu" }],
        ],
      },
      actions,
      "Markdown",
    );
  }

  private cleanupExpiredPendingSelections() {
    const now = Date.now();

    for (const [key, selection] of this.pendingQuantitySelections.entries()) {
      if (selection.expiresAt <= now) {
        this.pendingQuantitySelections.delete(key);
      }
    }

    for (const [key, pending] of this.pendingWalletTopups.entries()) {
      if (pending.expiresAt <= now) {
        this.pendingWalletTopups.delete(key);
      }
    }

    for (const [key, selection] of this.pendingPaymentSelections.entries()) {
      if (selection.expiresAt <= now) {
        this.pendingPaymentSelections.delete(key);
      }
    }

    for (const [key, pending] of this.pendingTxHashSubmissions.entries()) {
      if (pending.expiresAt <= now) {
        this.pendingTxHashSubmissions.delete(key);
      }
    }

    for (const [key, pending] of this.pendingBinanceOrderIdSubmissions.entries()) {
      if (pending.expiresAt <= now) {
        this.pendingBinanceOrderIdSubmissions.delete(key);
      }
    }

    for (const [key, pending] of this.pendingWarrantyClaimSubmissions.entries()) {
      if (pending.expiresAt <= now) {
        this.pendingWarrantyClaimSubmissions.delete(key);
      }
    }

    for (const [key, pending] of this.pendingWarrantyIssueDescriptions.entries()) {
      if (pending.expiresAt <= now) {
        this.pendingWarrantyIssueDescriptions.delete(key);
      }
    }

    for (const [key, pending] of this.pendingConnectionTopupInputs.entries()) {
      if (pending.expiresAt <= now) {
        this.pendingConnectionTopupInputs.delete(key);
      }
    }
  }

  private buildOrderHistoryText(
    orders: Array<{
      orderCode: string;
      productNameSnapshot: string;
      quantity: number;
      totalSaleAmount: Prisma.Decimal | number | string | null | undefined;
      status: string;
      paymentStatus: string;
      createdAt: Date;
      deliveredAccountText: string | null;
    }>,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    if (orders.length === 0) {
      if (language === "en") {
        return [
          "📜 Order history",
          "",
          "You do not have any orders yet.",
          "Go back to products to start shopping.",
        ].join("\n");
      }

      if (language === "th") {
        return [
          "📜 ประวัติคำสั่งซื้อ",
          "",
          "ยังไม่มีคำสั่งซื้อ",
          "กลับไปดูสินค้าเพื่อเริ่มช้อปปิ้ง",
        ].join("\n");
      }

      return [
        "📜 Lịch sử mua hàng",
        "",
        "Bạn chưa có đơn hàng nào.",
        "Hãy quay lại danh sách sản phẩm để bắt đầu mua hàng.",
      ].join("\n");
    }

    const lines: string[] = [
      language === "en" ? "📜 Recent orders" : language === "th" ? "📜 คำสั่งซื้อล่าสุด" : "📜 Lịch sử mua hàng gần đây",
      "",
      ...orders.flatMap((order, index) => [
        `${index + 1}. ${this.localizeProductName(order.productNameSnapshot, language)}`,
        language === "en" ? `   Order: ${order.orderCode}` : language === "th" ? `   คำสั่งซื้อ: ${order.orderCode}` : `   Mã đơn: ${order.orderCode}`,
        language === "en"
          ? `   Qty: ${order.quantity} • ${this.formatBotMoney(decimalToNumber(order.totalSaleAmount), language, usdtVndRate)}`
          : language === "th"
            ? `   จำนวน: ${order.quantity} • ${this.formatBotMoney(decimalToNumber(order.totalSaleAmount), language, usdtVndRate)}`
            : `   SL: ${order.quantity} • ${this.formatBotMoney(decimalToNumber(order.totalSaleAmount), language, usdtVndRate)}`,
        language === "en"
          ? `   Status: ${this.formatCustomerOrderStatus(order.status, order.paymentStatus, language)}`
          : language === "th"
            ? `   สถานะ: ${this.formatCustomerOrderStatus(order.status, order.paymentStatus, language)}`
            : `   Trạng thái: ${this.formatCustomerOrderStatus(order.status, order.paymentStatus, language)}`,
        language === "en"
          ? `   Time: ${this.formatDateTime(order.createdAt)}`
          : language === "th"
            ? `   เวลา: ${this.formatDateTime(order.createdAt)}`
            : `   Thời gian: ${this.formatDateTime(order.createdAt)}`,
        "",
      ]),
    ];

    const deliveredOrders = orders.filter((order) => Boolean(order.deliveredAccountText)).slice(0, 3);

    if (deliveredOrders.length > 0) {
      lines.push(language === "en" ? "🔐 Recently delivered accounts:" : language === "th" ? "🔐 บัญชีที่จัดส่งล่าสุด:" : "🔐 Tài khoản đã giao gần đây:", "");

      deliveredOrders.forEach((order, index) => {
        lines.push(
          `${index + 1}. ${order.orderCode} • ${this.truncateLabel(
            this.localizeProductName(order.productNameSnapshot, language),
            32,
          )}`,
        );
        lines.push(this.indentBlock(this.buildDeliveredSnippet(order.deliveredAccountText || "")));
        lines.push("");
      });
    }

    return lines.join("\n").trim();
  }

  private buildWalletText(summary: {
    balance: number;
    currency: string;
    pendingTopups: Array<{
      amount: number;
      externalOrderCode: string;
      createdAt: Date;
      expiresAt: Date;
      checkoutUrl: string;
    }>;
    recentTopups: Array<{
      amount: number;
      externalOrderCode: string;
      status: string;
      createdAt: Date;
      paidAt: Date | null;
    }>;
  }, language: BotLanguage = "vi", usdtVndRate?: Prisma.Decimal | number | string | null) {
    if (language === "en") {
      const lines: string[] = [
        "💳 Your wallet",
        "",
        `Current balance: ${this.formatBotMoney(summary.balance, language, usdtVndRate)}`,
        "Display currency: USDT ($)",
        "",
      ];

      if (summary.pendingTopups.length > 0) {
        lines.push("Pending wallet top-ups:", "");
        lines.push(
          ...summary.pendingTopups.flatMap((topup, index) => [
            `${index + 1}. ${this.formatBotMoney(topup.amount, language, usdtVndRate)}`,
            `   Top-up code: ${topup.externalOrderCode}`,
            `   Expires: ${this.formatDateTime(topup.expiresAt)}`,
            "",
          ]),
        );
      } else {
        lines.push("You have no pending wallet top-ups.", "");
      }

      if (summary.recentTopups.length > 0) {
        lines.push("Recent top-ups:", "");
        lines.push(
          ...summary.recentTopups.slice(0, 5).flatMap((topup, index) => [
            `${index + 1}. ${this.formatBotMoney(topup.amount, language, usdtVndRate)} • ${this.formatTopupStatus(topup.status, language)}`,
            `   Top-up code: ${topup.externalOrderCode}`,
            `   Time: ${this.formatDateTime(topup.paidAt || topup.createdAt)}`,
            "",
          ]),
        );
      } else {
        lines.push("No top-up history yet.", "");
      }

      return lines.join("\n");
    }

    if (language === "th") {
      const lines: string[] = [
        "💳 กระเป๋าเงินของคุณ",
        "",
        `ยอดคงเหลือ: ${this.formatBotMoney(summary.balance, language, usdtVndRate)}`,
        `สกุลเงิน: ${summary.currency}`,
        "",
      ];

      if (summary.pendingTopups.length > 0) {
        lines.push("รายการเติมเงินที่รอชำระ:", "");
        lines.push(
          ...summary.pendingTopups.flatMap((topup, index) => [
            `${index + 1}. ${this.formatBotMoney(topup.amount, language, usdtVndRate)}`,
            `   รหัสเติมเงิน: ${topup.externalOrderCode}`,
            `   หมดอายุ: ${this.formatDateTime(topup.expiresAt)}`,
            "",
          ]),
        );
      } else {
        lines.push("ไม่มีรายการเติมเงินที่รอชำระ", "");
      }

      if (summary.recentTopups.length > 0) {
        lines.push("ประวัติการเติมเงินล่าสุด:", "");
        lines.push(
          ...summary.recentTopups.slice(0, 5).flatMap((topup, index) => [
            `${index + 1}. ${this.formatBotMoney(topup.amount, language, usdtVndRate)} • ${this.formatTopupStatus(topup.status, language)}`,
            `   รหัสเติมเงิน: ${topup.externalOrderCode}`,
            `   เวลา: ${this.formatDateTime(topup.paidAt || topup.createdAt)}`,
            "",
          ]),
        );
      } else {
        lines.push("ยังไม่มีประวัติการเติมเงิน", "");
      }

      return lines.join("\n");
    }

    const lines: string[] = [
      "💳 Ví của bạn",
      "",
      `Số dư hiện tại: ${this.formatBotMoney(summary.balance, language, usdtVndRate)}`,
      `Tiền tệ: ${summary.currency}`,
      "",
    ];

    if (summary.pendingTopups.length > 0) {
      lines.push("Đơn nạp ví đang chờ thanh toán:", "");
      lines.push(
        ...summary.pendingTopups.flatMap((topup, index) => [
          `${index + 1}. ${this.formatBotMoney(topup.amount, language, usdtVndRate)}`,
          `   Mã nạp: ${topup.externalOrderCode}`,
          `   Hết hạn: ${this.formatDateTime(topup.expiresAt)}`,
          "",
        ]),
      );
    } else {
      lines.push("Hiện bạn không có lệnh nạp ví nào đang chờ thanh toán.", "");
    }

    if (summary.recentTopups.length > 0) {
      lines.push("Lịch sử nạp ví gần đây:", "");
      lines.push(
        ...summary.recentTopups.slice(0, 5).flatMap((topup, index) => [
          `${index + 1}. ${this.formatBotMoney(topup.amount, language, usdtVndRate)} • ${this.formatTopupStatus(topup.status, language)}`,
          `   Mã nạp: ${topup.externalOrderCode}`,
          `   Thời gian: ${this.formatDateTime(topup.paidAt || topup.createdAt)}`,
          "",
        ]),
      );
    } else {
      lines.push("Chưa có lịch sử nạp ví.", "");
    }

    return lines.join("\n");
  }

  private formatTopupStatus(status: string, language: BotLanguage = "vi") {
    const en = language === "en";
    const th = language === "th";
    if (status === "paid") return en ? "Credited" : th ? "เครดิตแล้ว" : "Đã cộng tiền";
    if (status === "canceled") return en ? "Canceled" : th ? "ยกเลิกแล้ว" : "Đã hủy";
    if (status === "failed") return en ? "Failed" : th ? "ล้มเหลว" : "Thất bại";
    return en ? "Awaiting payment" : th ? "รอชำระเงิน" : "Chờ thanh toán";
  }

  private formatCustomerOrderStatus(
    status: string,
    paymentStatus: string,
    language: BotLanguage = "vi",
  ) {
    const en = language === "en";
    const th = language === "th";

    if (status === "DELIVERED") return en ? "Delivered" : th ? "จัดส่งแล้ว" : "Đã giao";
    if (status === "FAILED") return en ? "Failed" : th ? "ล้มเหลว" : "Thất bại";
    if (status === "PAID_WAITING_STOCK") return en ? "Paid, waiting for stock" : th ? "ชำระแล้ว รอสินค้า" : "Đã thanh toán, chờ hàng";
    if (status === "PROCESSING_PURCHASE") return en ? "Processing" : th ? "กำลังดำเนินการ" : "Đang xử lý";
    if (status === "REFUNDED" || paymentStatus === "REFUNDED") return en ? "Refunded" : th ? "คืนเงินแล้ว" : "Đã hoàn tiền";
    if (status === "PAID" || paymentStatus === "PAID") return en ? "Paid" : th ? "ชำระแล้ว" : "Đã thanh toán";
    if (status === "AWAITING_PAYMENT" || paymentStatus === "PENDING" || paymentStatus === "UNPAID") {
      return en ? "Awaiting payment" : th ? "รอชำระเงิน" : "Chờ thanh toán";
    }

    return en ? "Processing" : th ? "กำลังดำเนินการ" : "Đang xử lý";
  }

  private parseWalletTopupAmount(text: string) {
    const normalized = String(text || "").replace(/[^\d]/g, "");
    const value = Number(normalized);

    if (!Number.isInteger(value) || value < 1000) {
      return null;
    }

    return value;
  }

  private buildWalletTopupInstructionText(
    amount: number,
    externalOrderCode: string,
    expiresAt: Date,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    if (language === "en") {
      return [
        `🏦 Top up ${this.formatBotMoney(amount, language, usdtVndRate)} to wallet`,
        `Gateway amount: ${formatCurrency(amount)}`,
        `Top-up code: ${externalOrderCode}`,
        `Payment deadline: ${this.formatDateTime(expiresAt)}`,
        "",
        "Scan the QR code or open the payment link below.",
        "After PayOS confirms the payment, the bot will credit your wallet automatically.",
      ].join("\n");
    }

    if (language === "th") {
      return [
        `🏦 เติมเงิน ${this.formatBotMoney(amount, language, usdtVndRate)} เข้ากระเป๋าเงิน`,
        `จำนวนเงิน: ${formatCurrency(amount)}`,
        `รหัสเติมเงิน: ${externalOrderCode}`,
        `กำหนดชำระ: ${this.formatDateTime(expiresAt)}`,
        "",
        "สแกน QR หรือเปิดลิงก์ชำระเงินด้านล่าง",
        "หลังจาก PayOS ยืนยันการชำระเงิน บอทจะเติมยอดคงเหลือให้อัตโนมัติ",
      ].join("\n");
    }

    return [
      `🏦 Nạp ${this.formatBotMoney(amount, language, usdtVndRate)} vào ví`,
      `Mã nạp: ${externalOrderCode}`,
      `Hạn thanh toán: ${this.formatDateTime(expiresAt)}`,
      "",
      "Quét mã QR hoặc mở link thanh toán bên dưới.",
      "Sau khi PayOS xác nhận thành công, bot sẽ tự động cộng số dư vào ví của bạn.",
    ].join("\n");
  }

  private buildDeliveredSnippet(value: string, maxLines = 4, maxLength = 280) {
    const normalized = String(value || "").replace(/\r/g, "").trim();
    const snippet = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, maxLines)
      .join("\n");

    if (snippet.length <= maxLength) {
      return snippet;
    }

    return `${snippet.slice(0, maxLength - 1).trimEnd()}…`;
  }

  private indentBlock(value: string) {
    return value
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n");
  }

  private shortOrderCode(orderCode: string) {
    return `#${String(orderCode || "").slice(-6)}`;
  }

  private buildCheckoutVerifyReplyMarkup(
    checkoutUrl: string,
    externalOrderCode: string,
    language: BotLanguage,
    options?: {
      includeVerify?: boolean;
    },
  ) {
    const inlineKeyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [];

    if (this.isPublicCheckoutUrl(checkoutUrl || "")) {
      inlineKeyboard.push([{
        text: language === "en" ? "💳 Open payment page" : language === "th" ? "💳 เปิดหน้าชำระเงิน" : "💳 Mở trang thanh toán",
        url: checkoutUrl,
      }]);
    }

    inlineKeyboard.push([
      { text: this.buttonLabel("history", language), callback_data: "home:history" },
      { text: this.buttonLabel("home", language), callback_data: "home:menu" },
    ]);

    return { inline_keyboard: inlineKeyboard };
  }

  private async handleCheckoutPaymentVerify(
    shopId: string,
    token: string,
    chatId: number,
    telegramUserId: string,
    externalOrderCode: string,
    actions: unknown[],
    language: BotLanguage,
    messageId?: number,
  ) {
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { externalOrderCode },
      include: {
        order: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (
      !transaction ||
      !transaction.order ||
      transaction.order.shopId !== shopId ||
      transaction.order.customer?.telegramUserId !== telegramUserId ||
      (transaction.provider !== PaymentProvider.PAYOS &&
        transaction.provider !== PaymentProvider.BINANCE_PAY)
    ) {
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "This payment order is invalid or no longer available."
          : language === "th"
            ? "คำสั่งชำระเงินนี้ไม่ถูกต้องหรือไม่พร้อมใช้งานแล้ว"
            : "Lệnh thanh toán này không hợp lệ hoặc không còn khả dụng.",
        actions,
      );
      return;
    }

    if (transaction.status !== "PENDING") {
      const alreadyProcessedText =
        transaction.order.status === "DELIVERED"
          ? (language === "en"
              ? "This payment has already been confirmed and the account has been delivered."
              : language === "th"
                ? "การชำระเงินนี้ได้รับการยืนยันแล้วและบัญชีถูกจัดส่งแล้ว"
                : "Thanh toán này đã được xác nhận và tài khoản đã được giao.")
          : (language === "en"
              ? "This payment has already been confirmed. The system is processing your order."
              : language === "th"
                ? "การชำระเงินนี้ได้รับการยืนยันแล้ว ระบบกำลังดำเนินการคำสั่งซื้อของคุณ"
                : "Thanh toán này đã được xác nhận. Hệ thống đang xử lý đơn hàng của bạn.");

      await this.editOrSend(
        token,
        chatId,
        messageId,
        alreadyProcessedText,
        this.buildCheckoutVerifyReplyMarkup(
          transaction.checkoutUrl || "",
          externalOrderCode,
          language,
          { includeVerify: false },
        ),
        actions,
      );
      return;
    }

    try {
      const paymentStatus = await this.paymentService.getExternalPaymentStatus(externalOrderCode);
      const providerStatus = String(paymentStatus.providerStatus || "UNKNOWN").toUpperCase();
      const isPaid =
        ["PAID", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(providerStatus) ||
        (Number(paymentStatus.amountPaid || 0) > 0 &&
          Number(paymentStatus.amount || 0) > 0 &&
          Number(paymentStatus.amountPaid || 0) >= Number(paymentStatus.amount || 0));

      if (!isPaid) {
        await this.editOrSend(
          token,
          chatId,
          messageId,
          language === "en"
            ? "The system has not matched your payment yet. If you have just transferred, please wait a few seconds and tap 'I've paid' again."
            : language === "th"
              ? "ระบบยังไม่พบการชำระเงินของคุณ หากโอนเงินแล้ว กรุณารอสักครู่แล้วกด 'ฉันชำระแล้ว' อีกครั้ง"
              : "Hệ thống chưa đối soát được giao dịch của bạn. Nếu bạn vừa chuyển khoản xong, hãy đợi vài giây rồi bấm 'Tôi đã thanh toán' lại.",
          this.buildCheckoutVerifyReplyMarkup(
            transaction.checkoutUrl || "",
            externalOrderCode,
            language,
          ),
          actions,
        );
        return;
      }

      await this.ordersService.markPaymentCompleted(externalOrderCode, {
        verifiedBy: "telegram_payment_button",
        provider: transaction.provider,
        providerStatus,
        rawPayload: paymentStatus.rawPayload,
      });

      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "✅ Payment confirmed. The system is now processing your order automatically."
          : language === "th"
            ? "✅ ยืนยันการชำระเงินแล้ว ระบบกำลังดำเนินการคำสั่งซื้อของคุณอัตโนมัติ"
            : "✅ Đã xác nhận thanh toán. Hệ thống đang tự động xử lý đơn hàng của bạn.",
        this.buildCheckoutVerifyReplyMarkup(
          transaction.checkoutUrl || "",
          externalOrderCode,
          language,
          { includeVerify: false },
        ),
        actions,
      );
    } catch (error) {
      this.logger.error(
        `Failed instant payment verification for shop ${shopId}, order ${externalOrderCode}`,
        error instanceof Error ? error.stack : String(error),
      );

      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "Unable to check this payment right now. Please try again in a moment."
          : language === "th"
            ? "ไม่สามารถตรวจสอบการชำระเงินนี้ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"
            : "Hiện tại chưa thể kiểm tra giao dịch này. Bạn vui lòng thử lại sau ít giây.",
        this.buildCheckoutVerifyReplyMarkup(
          transaction.checkoutUrl || "",
          externalOrderCode,
          language,
        ),
        actions,
      );
    }
  }

  private getPendingBinanceOrderIdSubmission(shopId: string, telegramUserId: string) {
    const key = this.getPendingQuantityKey(shopId, telegramUserId);
    const pending = this.pendingBinanceOrderIdSubmissions.get(key);
    if (!pending) return null;
    if (pending.expiresAt <= Date.now()) {
      this.pendingBinanceOrderIdSubmissions.delete(key);
      return null;
    }
    return pending;
  }

  private clearPendingBinanceOrderIdSubmission(shopId: string, telegramUserId: string) {
    if (!telegramUserId) return;
    this.pendingBinanceOrderIdSubmissions.delete(this.getPendingQuantityKey(shopId, telegramUserId));
  }

  private async handleBinanceOrderIdPrompt(
    shopId: string,
    token: string,
    chatId: number,
    telegramUserId: string,
    externalOrderCode: string,
    actions: unknown[],
    language: BotLanguage,
    messageId?: number,
  ) {
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { externalOrderCode },
      include: { order: true },
    });

    if (
      !transaction ||
      transaction.status !== "PENDING" ||
      transaction.provider !== "BINANCE" ||
      transaction.order.shopId !== shopId
    ) {
      await this.sendText(token, chatId,
        language === "en"
          ? "This payment is no longer pending or is invalid."
          : language === "th"
            ? "คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงินแล้ว"
            : "Đơn hàng không còn ở trạng thái chờ thanh toán.",
        actions,
      );
      return;
    }

    this.pendingBinanceOrderIdSubmissions.set(this.getPendingQuantityKey(shopId, telegramUserId), {
      externalOrderCode,
      orderCode: transaction.order.orderCode,
      expiresAt: Date.now() + this.pendingBinanceOrderIdTtlMs,
    });

    await this.sendText(
      token,
      chatId,
      language === "en"
        ? `📋 Please send the <b>Order ID</b> (ID lệnh) from your Binance payment confirmation screen for order <b>${transaction.order.orderCode}</b>.\n\nIt is a long numeric string (e.g. <code>429073211632295936</code>).`
        : language === "th"
          ? `📋 กรุณาส่ง <b>Order ID</b> จากหน้าจอยืนยันการชำระเงิน Binance สำหรับคำสั่งซื้อ <b>${transaction.order.orderCode}</b>\n\nเป็นตัวเลขยาว (เช่น <code>429073211632295936</code>)`
          : `📋 Vui lòng gửi <b>ID lệnh</b> từ màn hình xác nhận thanh toán Binance cho đơn <b>${transaction.order.orderCode}</b>.\n\nLà dãy số dài (VD: <code>429073211632295936</code>).`,
      actions,
      { parse_mode: "HTML" as const },
    );
  }

  private async handlePendingBinanceOrderIdMessage(
    shopId: string,
    token: string,
    message: any,
    actions: unknown[],
    language: BotLanguage,
  ): Promise<boolean> {
    const telegramUserId = String(message.from?.id || "");
    const pending = this.getPendingBinanceOrderIdSubmission(shopId, telegramUserId);
    if (!pending) return false;

    const msgText = String(message.text || "").trim();
    if (!/^\d{15,22}$/.test(msgText)) return false;

    this.clearPendingBinanceOrderIdSubmission(shopId, telegramUserId);
    await this.handleBinanceVerifyByOrderId(shopId, token, message.chat.id, telegramUserId, pending.externalOrderCode, msgText, actions, language);
    return true;
  }

  private async handleBinanceVerifyByOrderId(
    shopId: string,
    token: string,
    chatId: number,
    telegramUserId: string,
    externalOrderCode: string,
    binanceOrderId: string,
    actions: unknown[],
    language: BotLanguage,
  ) {
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { externalOrderCode },
      include: { order: { include: { customer: true } } },
    });

    if (
      !transaction ||
      transaction.status !== "PENDING" ||
      transaction.provider !== "BINANCE" ||
      transaction.order.shopId !== shopId ||
      transaction.order.customer?.telegramUserId !== telegramUserId
    ) {
      await this.sendText(token, chatId,
        language === "en"
          ? "This payment is no longer pending or is invalid."
          : language === "th"
            ? "คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงินแล้ว"
            : "Đơn hàng không còn ở trạng thái chờ thanh toán.",
        actions,
      );
      return;
    }

    const config = await this.prisma.paymentConfig.findUnique({
      where: { shopId },
      select: { binanceUid: true, binancePersonalApiKeyEncrypted: true, binancePersonalSecretKeyEncrypted: true },
    });

    if (!config?.binanceUid || !config?.binancePersonalApiKeyEncrypted || !config?.binancePersonalSecretKeyEncrypted) {
      await this.sendText(token, chatId,
        language === "en" ? "Binance verification not configured." : language === "th" ? "ร้านค้ายังไม่ได้ตั้งค่า Binance API" : "Shop chưa cấu hình Binance API.",
        actions,
      );
      return;
    }

    try {
      const apiKey = decryptSecret(config.binancePersonalApiKeyEncrypted, this.config.encryptionKey)?.trim() ?? "";
      const secretKey = decryptSecret(config.binancePersonalSecretKeyEncrypted, this.config.encryptionKey)?.trim() ?? "";
      const configuredBinanceUid = String(config.binanceUid || "").trim();
      const manualCrypto = (transaction.rawPayloadJson as any)?.manualCrypto || {};
      const requiredUsdt = Number(manualCrypto.usdtAmount || 0);

      const startTime = Math.max(0, transaction.createdAt.getTime() - 10 * 60 * 1000);
      const history = await this.binancePayService.queryPersonalPayTransactions(apiKey, secretKey, startTime);

      const match = history.find((item) => String(item.orderId || "") === binanceOrderId);

      if (!match) {
        await this.sendText(token, chatId,
          language === "en"
            ? "Order ID not found in recent Binance Pay history. Please check and try again."
            : language === "th"
              ? "ไม่พบ Order ID นี้ในประวัติ Binance Pay ล่าสุด กรุณาตรวจสอบและลองใหม่"
              : "Không tìm thấy ID lệnh này trong lịch sử Binance. Kiểm tra lại và thử lại.",
          actions,
        );
        return;
      }

      const receiverBinanceId = String(match.receiverInfo?.binanceId || match.payeeId || "").trim();
      const matchAmount = Number(match.amount ?? match.orderAmount ?? 0);

      if (receiverBinanceId !== configuredBinanceUid) {
        await this.sendText(token, chatId,
          language === "en"
            ? "This payment was sent to a different Binance account. Please check and try again."
            : language === "th"
              ? "การชำระเงินนี้ถูกส่งไปยังบัญชี Binance อื่น กรุณาตรวจสอบและลองใหม่"
              : "Giao dịch này không gửi đến đúng tài khoản Binance của shop.",
          actions,
        );
        return;
      }

      if (requiredUsdt > 0 && Math.abs(matchAmount - requiredUsdt) > 0.01) {
        await this.sendText(token, chatId,
          language === "en"
            ? `Payment amount mismatch. Expected ${requiredUsdt} USDT, got ${matchAmount} USDT.`
            : language === "th"
              ? `จำนวนเงินไม่ตรงกัน คาดหวัง ${requiredUsdt} USDT ได้รับ ${matchAmount} USDT`
              : `Số tiền không khớp. Cần ${requiredUsdt} USDT, nhận được ${matchAmount} USDT.`,
          actions,
        );
        return;
      }

      await this.ordersService.markPaymentCompleted(
        externalOrderCode,
        {
          provider: "BINANCE",
          autoVerified: true,
          verificationMode: "binance_order_id",
          payeeId: match.payeeId,
          orderAmount: match.amount ?? match.orderAmount,
          currency: match.currency,
          transactionId: match.transactionId,
          transactionTime: match.transactionTime,
        },
        { cryptoTxHash: match.transactionId },
      );

      await this.sendText(token, chatId,
        language === "en" ? "✅ Payment verified successfully!" : language === "th" ? "✅ ยืนยันการชำระเงินสำเร็จ!" : "✅ Xác minh thanh toán thành công!",
        actions,
      );
    } catch (e) {
      this.logger.error(`Error verifying Binance order ID for shop ${shopId}:`, e instanceof Error ? e.stack : String(e));
      await this.sendText(token, chatId,
        language === "en"
          ? "Unable to check Binance payment right now. Please try again shortly."
          : language === "th"
            ? "ไม่สามารถตรวจสอบการชำระเงิน Binance ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"
            : "Tạm thời chưa kiểm tra được. Vui lòng thử lại sau.",
        actions,
      );
    }
  }

  private async handleBinancePersonalVerify(
    shopId: string,
    token: string,
    chatId: number,
    telegramUserId: string,
    externalOrderCode: string,
    actions: unknown[],
    language: BotLanguage,
    messageId?: number,
  ) {
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { externalOrderCode },
      include: {
        order: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (
      !transaction ||
      transaction.status !== "PENDING" ||
      transaction.provider !== "BINANCE" ||
      transaction.order.shopId !== shopId ||
      transaction.order.customer?.telegramUserId !== telegramUserId
    ) {
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "This payment is no longer pending or is invalid."
          : language === "th"
            ? "คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงินหรือไม่ถูกต้อง"
            : "Đơn hàng không còn ở trạng thái chờ thanh toán hoặc không hợp lệ.",
        actions,
      );
      return;
    }

    const config = await this.prisma.paymentConfig.findUnique({
      where: { shopId },
      select: {
        binanceUid: true,
        binancePersonalApiKeyEncrypted: true,
        binancePersonalSecretKeyEncrypted: true,
      },
    });

    if (
      !config?.binanceUid ||
      !config?.binancePersonalApiKeyEncrypted ||
      !config?.binancePersonalSecretKeyEncrypted
    ) {
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "Automatic Binance UID verification is not configured for this shop yet."
          : language === "th"
            ? "ร้านค้านี้ยังไม่ได้ตั้งค่าการยืนยัน Binance UID อัตโนมัติ"
            : "Shop nay chua cau hinh du Binance UID auto verification.",
        actions,
      );
      return;
    }

    try {
      const apiKey = decryptSecret(config.binancePersonalApiKeyEncrypted, this.config.encryptionKey)?.trim() ?? "";
      const secretKey = decryptSecret(config.binancePersonalSecretKeyEncrypted, this.config.encryptionKey)?.trim() ?? "";
      const configuredBinanceUid = String(config.binanceUid || "").trim();
      const manualCrypto = (transaction.rawPayloadJson as any)?.manualCrypto || {};
      const requiredUsdt = Number(manualCrypto.usdtAmount || 0);

      if (!apiKey || !secretKey || !configuredBinanceUid) {
        throw new Error("Binance personal API decryption failed.");
      }

      if (!Number.isFinite(requiredUsdt) || requiredUsdt <= 0) {
        throw new Error("Missing required Binance UID amount.");
      }

      const startTime = Math.max(0, transaction.createdAt.getTime() - 10 * 60 * 1000);
      const history = await this.binancePayService.queryPersonalPayTransactions(apiKey, secretKey, startTime);

      const match = history
        .filter((item) => {
          const receiverBinanceId = String(item.receiverInfo?.binanceId || item.payeeId || "").trim();
          const currency = String(item.currency || "").trim().toUpperCase();
          const amount = Number(item.amount ?? item.orderAmount ?? 0);

          return (
            receiverBinanceId === configuredBinanceUid &&
            currency === "USDT" &&
            amount > 0 &&
            item.transactionTime >= transaction.createdAt.getTime() &&
            Math.abs(amount - requiredUsdt) < 0.000001
          );
        })
        .sort((left, right) => left.transactionTime - right.transactionTime)[0];

      if (match) {
        await this.ordersService.markPaymentCompleted(
          externalOrderCode,
          {
            provider: "BINANCE",
            autoVerified: true,
            verificationMode: "binance_personal_api",
            payeeId: match.payeeId,
            orderAmount: match.orderAmount,
            currency: match.currency,
            transactionId: match.transactionId,
            transactionTime: match.transactionTime,
          },
          { cryptoTxHash: match.transactionId },
        );

        const successMessage =
          language === "en"
            ? "Payment verified automatically."
            : "Da xac minh thanh toan tu dong.";

        if (messageId) {
          await this.editOrSend(
            token,
            chatId,
            messageId,
            successMessage,
            {},
            actions,
          );
        } else {
          await this.sendText(token, chatId, successMessage, actions);
        }

        return;
/*

        if (messageId) {
          // Send verification success inline
          await this.editOrSend(
            token,
            chatId,
            messageId,
            language === "en" ? "✅ Payment verified automatically!" : language === "th" ? "✅ ยืนยันการชำระเงินสำเร็จ!" : "✅ Đã xác minh thanh toán thành công!",
            {},
            actions,
          );
        } else {
          await this.sendText(token, chatId, language === "en" ? "✅ Payment verified automatically!" : language === "th" ? "✅ ยืนยันการชำระเงินสำเร็จ!" : "✅ Đã xác minh thanh toán thành công!", actions);
        }
        

*/
      } else {
        await this.sendText(
          token,
          chatId,
          language === "en"
            ? "We have not matched the exact Binance payment yet. Please wait 1-2 minutes and try again."
            : language === "th"
              ? "ระบบยังไม่พบธุรกรรม Binance ที่ตรงกัน กรุณารอ 1-2 นาทีแล้วลองใหม่"
              : "He thong chua doi chieu duoc giao dich Binance dung so tien nay. Hay doi 1-2 phut roi thu lai.",
          actions,
        );
        return;
/*

        await this.sendText(
          token,
          chatId,
          language === "en"
            ? "⚠️ We haven't received the exact amount yet. Please wait a moment and try again."
            : "⚠️ Hệ thống chưa ghi nhận giao dịch với số tiền này. Bạn vui lòng đợi thêm 1-2 phút rồi bấm thử lại nhé.",
          actions,
        );
*/
      }
    } catch (e) {
      this.logger.error(
        `Error verifying Binance personal payment for shop ${shopId}, order ${externalOrderCode}:`,
        e instanceof Error ? e.stack : String(e),
      );
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "Unable to check Binance payment right now. Please try again shortly or contact support."
          : language === "th"
            ? "ไม่สามารถตรวจสอบการชำระเงิน Binance ได้ในขณะนี้ กรุณาลองใหม่อีกครั้งหรือติดต่อฝ่ายช่วยเหลือ"
            : "Tam thoi chua kiem tra duoc giao dich Binance. Hay thu lai sau it phut hoac lien he ho tro.",
        actions,
      );
      return;
/*
      this.logger.error("Error verifying Binance Personal:", e);
      await this.sendText(token, chatId, "❌ Error checking API. Please contact support.", actions);
*/
    }
  }


  private async ensureTelegramCustomerSeen(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    message: TelegramUpdate | undefined,
    callbackQuery: TelegramUpdate | undefined,
  ) {
    const from = message?.from || callbackQuery?.from;
    const chatId =
      message?.chat?.id || callbackQuery?.message?.chat?.id || callbackQuery?.from?.id || null;

    if (!from?.id || !chatId) {
      return;
    }

    await this.prisma.customer.upsert({
      where: {
        shopId_telegramUserId: {
          shopId: shop.id,
          telegramUserId: String(from.id),
        },
      },
      update: {
        telegramChatId: String(chatId),
        telegramUsername: from.username || null,
        firstName: from.first_name || null,
        lastName: from.last_name || null,
      },
      create: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        telegramUserId: String(from.id),
        telegramChatId: String(chatId),
        telegramUsername: from.username || null,
        firstName: from.first_name || null,
        lastName: from.last_name || null,
      },
    });
  }

  private formatDateTime(value: Date) {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(new Date(value));
  }

  private createSimulationToken(token: string) {
    return `simulate:${token}`;
  }

  private isSimulationToken(token: string) {
    return String(token || "").startsWith("simulate:");
  }

  private normalizeLanguage(value: unknown): BotLanguage {
    const v = String(value || "").toLowerCase();
    if (v === "en") return "en";
    if (v === "th") return "th";
    return "vi";
  }

  private async getCustomerLanguage(shopId: string, telegramUserId: string): Promise<BotLanguage> {
    if (!telegramUserId) {
      return "vi";
    }

    const customer = await this.prisma.customer.findUnique({
      where: {
        shopId_telegramUserId: {
          shopId,
          telegramUserId,
        },
      },
      select: {
        preferredLanguage: true,
      },
    });

    return this.normalizeLanguage(customer?.preferredLanguage);
  }

  private async getCustomerLanguageByChatId(
    shopId: string,
    telegramChatId: string | number,
  ): Promise<BotLanguage> {
    const chatId = String(telegramChatId || "").trim();
    if (!chatId) {
      return "vi";
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
        shopId,
        telegramChatId: chatId,
      },
      select: {
        preferredLanguage: true,
      },
    });

    return this.normalizeLanguage(customer?.preferredLanguage);
  }

  private async setCustomerLanguage(
    shopId: string,
    telegramUserId: string,
    language: BotLanguage,
  ) {
    if (!telegramUserId) {
      return;
    }

    await this.prisma.customer.updateMany({
      where: {
        shopId,
        telegramUserId,
      },
      data: {
        preferredLanguage: language,
      },
    });
  }

  private async renderLanguageMenu(
    token: string,
    chatId: number,
    messageId: number | undefined,
    language: BotLanguage,
    actions: unknown[],
    variant: "settings" | "onboarding" = "settings",
  ) {
    const text =
      variant === "onboarding"
        ? language === "en"
          ? ["🌐 Choose your language", "", "Please select a language before entering the shop."].join("\n")
          : language === "th"
            ? ["🌐 เลือกภาษา", "", "กรุณาเลือกภาษาก่อนเข้าร้านค้า"].join("\n")
            : ["🌐 Chọn ngôn ngữ", "", "Vui lòng chọn ngôn ngữ trước khi vào shop."].join("\n")
        : language === "en"
          ? "🌐 Choose bot language"
          : language === "th"
            ? "🌐 เลือกภาษาของบอท"
            : "🌐 Chọn ngôn ngữ cho bot";

    const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [
      [
        { text: "🇻🇳 Tiếng Việt", callback_data: "lang:set:vi" },
        { text: "🇬🇧 English", callback_data: "lang:set:en" },
        { text: "🇹🇭 ภาษาไทย", callback_data: "lang:set:th" },
      ],
    ];

    if (variant !== "onboarding") {
      inlineKeyboard.push([{ text: this.buttonLabel("home", language), callback_data: "home:menu" }]);
    }

    // For onboarding we also attach the reply keyboard so it appears after language selection
    const replyMarkup: Record<string, unknown> = variant === "onboarding"
      ? { inline_keyboard: inlineKeyboard }
      : { inline_keyboard: inlineKeyboard };

    await this.editOrSend(
      token,
      chatId,
      messageId,
      text,
      replyMarkup,
      actions,
    );
  }

  private buttonLabel(
    key:
      | "products"
      | "productsShort"
      | "guide"
      | "history"
      | "wallet"
      | "support"
      | "supportShort"
      | "warranty"
      | "language"
      | "home"
      | "affiliate",
    language: BotLanguage,
  ) {
    const labels: Record<string, { vi: string; en: string; th: string }> = {
      products:     { vi: "🛍️ Xem sản phẩm",       en: "🛍️ Products",        th: "🛍️ ดูสินค้า" },
      productsShort:{ vi: "🛍️ Sản phẩm",            en: "🛍️ Products",        th: "🛍️ สินค้า" },
      guide:        { vi: "📘 Cách mua",             en: "📘 How to buy",       th: "📘 วิธีซื้อ" },
      history:      { vi: "📜 Lịch sử mua",          en: "📜 Orders",           th: "📜 ประวัติคำสั่งซื้อ" },
      wallet:       { vi: "💳 Ví",                   en: "💳 Wallet",           th: "💳 กระเป๋าเงิน" },
      support:      { vi: "💬 Liên hệ hỗ trợ",       en: "💬 Support",          th: "💬 ติดต่อฝ่ายช่วยเหลือ" },
      supportShort: { vi: "💬 Hỗ trợ",               en: "💬 Support",          th: "💬 ช่วยเหลือ" },
      warranty:     { vi: "🛡️ Bảo hành",             en: "🛡️ Warranty",         th: "🛡️ การรับประกัน" },
      language:     { vi: "🌐 Ngôn ngữ",             en: "🌐 Language",         th: "🌐 ภาษา" },
      home:         { vi: "🏠 Trang chủ",            en: "🏠 Home",             th: "🏠 หน้าหลัก" },
      affiliate:    { vi: "🤝 Affiliate",             en: "🤝 Affiliate",        th: "🤝 แนะนำเพื่อน" },
    };

    return labels[key]?.[language] ?? labels[key]?.["en"] ?? key;
  }

  private buildSupportText(
    shopName: string,
    supportTelegram: string | null,
    supportZalo: string | null,
    language: BotLanguage = "vi",
  ) {
    if (language === "en") {
      return [
        `💬 Support | ${shopName}`,
        "",
        supportTelegram ? `Telegram: ${supportTelegram}` : null,
        supportZalo ? `Zalo: ${supportZalo}` : null,
        "",
        "When you need help, please include your order code so support can check faster.",
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (language === "th") {
      return [
        `💬 ช่วยเหลือ | ${shopName}`,
        "",
        supportTelegram ? `Telegram: ${supportTelegram}` : null,
        supportZalo ? `Zalo: ${supportZalo}` : null,
        "",
        "เมื่อต้องการความช่วยเหลือ กรุณาแนบรหัสคำสั่งซื้อเพื่อให้ทีมงานตรวจสอบได้รวดเร็วขึ้น",
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      `💬 Hỗ trợ | ${shopName}`,
      "",
      supportTelegram ? `Telegram: ${supportTelegram}` : null,
      supportZalo ? `Zalo: ${supportZalo}` : null,
      "",
      "Khi cần hỗ trợ, vui lòng gửi kèm mã đơn hàng để được xử lý nhanh hơn.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private buildHomeText(
    shopName: string,
    tagline: string,
    productCount: number,
    availableCount: number,
    language: BotLanguage = "vi",
  ) {
    const safeName = this.escapeHtml(shopName);
    const safeTagline = this.escapeHtml(tagline);

    if (language === "en") {
      return [
        `🔥 <b>${safeName}</b>`,
        `<i>${safeTagline}</i>`,
        "",
        `▫️ Active products: <b>${productCount}</b>`,
        `▫️ In‑stock: <b>${availableCount}</b>`,
        "",
        "<i>Choose a product below to start ↘️</i>",
      ].join("\n");
    }

    if (language === "th") {
      return [
        `🔥 <b>${safeName}</b>`,
        `<i>${safeTagline}</i>`,
        "",
        `▫️ สินค้าที่เปิดขาย: <b>${productCount}</b>`,
        `▫️ มีสินค้า: <b>${availableCount}</b>`,
        "",
        "<i>เลือกสินค้าด้านล่างเพื่อเริ่มต้น ↘️</i>",
      ].join("\n");
    }

    return [
      `🔥 <b>${safeName}</b>`,
      `<i>${safeTagline}</i>`,
      "",
      `▫️ Sản phẩm đang bán: <b>${productCount}</b>`,
      `▫️ Còn hàng: <b>${availableCount}</b>`,
      "",
      "<i>Chọn sản phẩm bên dưới để bắt đầu nhé ↘️</i>",
    ].join("\n");
  }

  private splitCatalogProducts(products: CatalogItem[]) {
    const sortedProducts = [...products].sort((left, right) =>
      `${left.displayName} ${left.sourceName}`.localeCompare(
        `${right.displayName} ${right.sourceName}`,
        "vi",
        { sensitivity: "base" },
      ),
    );
    const matchedIds = new Set<string>();
    const featuredGroups = this.featuredCatalogGroups
      .map((group) => ({
        ...group,
        items: sortedProducts.filter((product) => {
          if (matchedIds.has(product.id)) {
            return false;
          }

          if (!group.matcher(product)) {
            return false;
          }

          matchedIds.add(product.id);
          return true;
        }),
      }))
      .filter((group) => group.items.length > 0);

    return {
      featuredGroups,
      otherProducts: sortedProducts.filter((product) => !matchedIds.has(product.id)),
    };
  }

  private buildFeaturedGroupButtonLabel(
    group: {
      emoji: string;
      label: string;
      items: CatalogItem[];
    },
    language: BotLanguage = "vi",
  ) {
    const unit =
      language === "en" ? "products" : language === "th" ? "รายการ" : "sản phẩm";
    return `${group.emoji} ${group.label} — ${group.items.length} ${unit}`;
  }

  private buildProductButtonLabel(
    product: CatalogItem,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    const effectiveUsdPrice =
      language === "en" && product.salePriceUsd != null && product.salePriceUsd > 0
        ? product.salePriceUsd
        : null;
    const priceLabel = effectiveUsdPrice != null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(effectiveUsdPrice)
      : this.formatCompactBotMoney(product.salePrice, language, usdtVndRate);
    const stockLabel = product.available === null ? "∞" : String(Math.max(0, product.available));
    const suffix = ` | ${priceLabel} | 📦 ${stockLabel}`;
    const emoji = product.productIcon?.trim() || this.resolveProductEmoji(product.displayName, product.sourceName);
    const normalizedName = `${emoji} ${this.compactProductName(
      this.localizeProductName(product.displayName, language),
    )}`.trim();
    const safeNameLength = Math.max(16, 58 - suffix.length);

    return this.sanitizeButtonText(`${this.truncateLabel(normalizedName, safeNameLength)}${suffix}`);
  }

  private sanitizeButtonText(value: string): string {
    // Strip lone surrogates — invalid Unicode that Telegram rejects with "must be encoded in UTF-8"
    return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  }

  private resolveProductEmoji(displayName: string, sourceName?: string | null) {
    const normalized = `${displayName || ""} ${sourceName || ""}`.toLowerCase();

    // AI & productivity
    if (/chatgpt|gpt/.test(normalized)) return "✨";
    if (/grok/.test(normalized)) return "⚡";
    if (/gemini/.test(normalized)) return "🔮";
    if (/claude/.test(normalized)) return "🧬";
    if (/copilot/.test(normalized)) return "🪄";
    if (/midjourney/.test(normalized)) return "🖼️";
    if (/elevenlabs/.test(normalized)) return "🎙️";
    if (/suno/.test(normalized)) return "🎶";
    if (/notion/.test(normalized)) return "📝";
    if (/perplexity/.test(normalized)) return "🔍";
    if (/cursor/.test(normalized)) return "💻";

    // Video & media
    if (/veo/.test(normalized)) return "🎬";
    if (/kling/.test(normalized)) return "🎥";
    if (/youtube/.test(normalized)) return "▶️";
    if (/netflix/.test(normalized)) return "🍿";
    if (/capcut/.test(normalized)) return "✂️";

    // Creative tools
    if (/canva/.test(normalized)) return "🎨";
    if (/adobe/.test(normalized)) return "🅰️";
    if (/figma/.test(normalized)) return "🎯";
    if (/meitu/.test(normalized)) return "💄";
    if (/fotor/.test(normalized)) return "📸";
    if (/freepik/.test(normalized)) return "🖌️";

    // Communication & cloud
    if (/gmail|google(?!\s*play)/.test(normalized)) return "📧";
    if (/spotify/.test(normalized)) return "🎵";
    if (/discord/.test(normalized)) return "💬";
    if (/zoom/.test(normalized)) return "📹";
    if (/vpn|express/.test(normalized)) return "🔒";
    if (/fam\b/.test(normalized)) return "👨‍👩‍👧";

    return "🛍️";
  }

  private compactProductName(value: string) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private localizeProductName(value: string, language: BotLanguage = "vi") {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();

    if (!normalized) {
      return normalized;
    }

    return language === "en" || language === "th"
      ? this.translateProductNameToEnglish(normalized)
      : this.translateProductNameToVietnamese(normalized);
  }

  private translateProductNameToVietnamese(value: string) {
    const withLongDurations = this.applyProductNameReplacements(value, [
      [/\b(\d+)\s*years?\b/gi, (_match, amount: string) => `${amount} năm`],
      [/\b(\d+)\s*months?\b/gi, (_match, amount: string) => `${amount} tháng`],
      [/\b(\d+)\s*days?\b/gi, (_match, amount: string) => `${amount} ngày`],
      [/\b(\d+)\s*yrs?\b/gi, (_match, amount: string) => `${amount} năm`],
      [/\b(\d+)\s*mos?\b/gi, (_match, amount: string) => `${amount} tháng`],
    ]);

    const withShortDurations = this.applyProductNameReplacements(withLongDurations, [
      [/\b(\d+)\s*y\b/gi, (_match, amount: string) => `${amount} năm`],
      [/\b(\d+)\s*m\b/gi, (_match, amount: string) => `${amount} tháng`],
      [/\b(\d+)\s*d\b/gi, (_match, amount: string) => `${amount} ngày`],
    ]);

    return this.applyProductNameReplacements(withShortDurations, [
      [/\bpersonal account\b/gi, "TK chính chủ"],
      [/\bowner account\b/gi, "TK chính chủ"],
      [/\bmain account\b/gi, "TK chính chủ"],
      [/\bpersonal\b/gi, "chính chủ"],
      [/\baccount\b/gi, "TK"],
      [/\bpackage\b/gi, "gói"],
      [/\blifetime\b/gi, "vĩnh viễn"],
      [/\bpermanent\b/gi, "vĩnh viễn"],
      [/\bfull warranty\b/gi, "bảo hành full"],
      [/\bno warranty\b/gi, "không bảo hành"],
      [/\bstock mail\b/gi, "mail có sẵn"],
      [/\brandom\b/gi, "ngẫu nhiên"],
      [/\badd family\b/gi, "add family"],
      [/\badd fam\b/gi, "add fam"],
      [/\bwarranty\b/gi, "bảo hành"],
    ]);
  }

  private translateProductNameToEnglish(value: string) {
    const normalized = this.normalizeTranslationSource(value);

    const withDurations = this.applyProductNameReplacements(normalized, [
      [/\b(\d+)\s*năm\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "year")],
      [/\b(\d+)\s*nam\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "year")],
      [/\b(\d+)\s*tháng\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "month")],
      [/\b(\d+)\s*thang\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "month")],
      [/\b(\d+)\s*ngày\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "day")],
      [/\b(\d+)\s*ngay\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "day")],
      [/\b(\d+)\s*t\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "month")],
      [/\b(\d+)\s*th\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "month")],
      [/\b(\d+)\s*n\b/gi, (_match, amount: string) => this.formatEnglishCount(amount, "year")],
    ]);

    const translated = this.applyProductNameReplacements(withDurations, [
      [/\btài\s*khoản\s*chính\s*chủ\b/gi, "personal account"],
      [/\btai\s*khoan\s*chinh\s*chu\b/gi, "personal account"],
      [/\btk\s*chính\s*chủ\b/gi, "personal account"],
      [/\btk\s*chinh\s*chu\b/gi, "personal account"],
      [/\bchính\s*chủ\b/gi, "personal"],
      [/\bchinh\s*chu\b/gi, "personal"],
      [/\btk\b/gi, "account"],
      [/\btài\s*khoản\b/gi, "account"],
      [/\btai\s*khoan\b/gi, "account"],
      [/\bgói\b/gi, "package"],
      [/\bgoi\b/gi, "package"],
      [/\bvĩnh\s*viễn\b/gi, "lifetime"],
      [/\bvinh\s*vien\b/gi, "lifetime"],
      [/\btrọn\s*đời\b/gi, "lifetime"],
      [/\btron\s*doi\b/gi, "lifetime"],
      [/\bkhông\s*bảo\s*hành\b/gi, "no warranty"],
      [/\bkhong\s*bao\s*hanh\b/gi, "no warranty"],
      [/\bbảo\s*hành\s*đầy\s*đủ\b/gi, "full warranty"],
      [/\bbao\s*hanh\s*day\s*du\b/gi, "full warranty"],
      [/\bbảo\s*hành\s*full\b/gi, "full warranty"],
      [/\bbao\s*hanh\s*full\b/gi, "full warranty"],
      [/\bfull\s*bảo\s*hành\b/gi, "full warranty"],
      [/\bfull\s*bao\s*hanh\b/gi, "full warranty"],
      [/\bmail\s*có\s*sẵn\b/gi, "stock mail"],
      [/\bmail\s*co\s*san\b/gi, "stock mail"],
      [/\bngẫu\s*nhiên\b/gi, "random"],
      [/\bngau\s*nhien\b/gi, "random"],
      [/\bthêm\s*family\b/gi, "add family"],
      [/\bthem\s*family\b/gi, "add family"],
      [/\bthêm\s*fam\b/gi, "add fam"],
      [/\bthem\s*fam\b/gi, "add fam"],
      [/\bbảo\s*hành\b/gi, "warranty"],
      [/\bbao\s*hanh\b/gi, "warranty"],
    ]);

    return this.applyProductNameReplacements(translated, [
      [/\baccount\s+personal\b/gi, "personal account"],
      [/\bpackage\s+team(\d+)\b/gi, "team $1 package"],
      [/\bteam(\d+)\b/gi, "team $1"],
    ]);
  }

  private applyProductNameReplacements(
    value: string,
    replacements: Array<[RegExp, string | ((match: string, ...groups: string[]) => string)]>,
  ) {
    let result = String(value || "");

    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement as never);
    }

    return result.replace(/\s+/g, " ").trim();
  }

  private normalizeTranslationSource(value: string) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, (character) => (character === "đ" ? "d" : "D"))
      .replace(/\s+/g, " ")
      .trim();
  }

  private formatEnglishCount(rawAmount: string, unit: "day" | "month" | "year") {
    const amount = Number(rawAmount || 0);
    return `${rawAmount} ${amount === 1 ? unit : `${unit}s`}`;
  }

  private async getShopUsdtVndRate(shopId: string) {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId },
      select: { usdtVndRateOverride: true },
    });

    return this.resolveUsdtVndRate(paymentConfig?.usdtVndRateOverride);
  }

  private resolveUsdtVndRate(
    value?: Prisma.Decimal | number | string | null,
  ) {
    const overrideRate = Number(value ?? NaN);

    if (Number.isFinite(overrideRate) && overrideRate > 0) {
      return overrideRate;
    }

    const fallbackRate = Number(this.config.usdtVndRate || 26000);
    return Number.isFinite(fallbackRate) && fallbackRate > 0 ? fallbackRate : 26000;
  }

  private toUsdtAmount(
    value: number,
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    const amount = Number(value || 0);
    const safeRate = this.resolveUsdtVndRate(usdtVndRate);
    return amount / safeRate;
  }

  private formatBotMoney(
    value: number,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    const amount = Number(value || 0);

    if (language !== "en" && language !== "th") {
      return formatCurrency(amount);
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(this.toUsdtAmount(amount, usdtVndRate));
  }

  private formatBotMoneyWithUsdOverride(
    vndAmount: number,
    salePriceUsd: number | null | undefined,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    if ((language === "en" || language === "th") && salePriceUsd != null && salePriceUsd > 0) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(salePriceUsd);
    }
    return this.formatBotMoney(vndAmount, language, usdtVndRate);
  }

  private formatCompactBotMoney(
    value: number,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    return language === "en" || language === "th"
      ? this.formatBotMoney(value, language, usdtVndRate)
      : this.formatCompactMoney(value);
  }

  private localizeBotErrorMessage(
    error: unknown,
    language: BotLanguage,
    fallbackMessage?: string,
  ) {
    const fallback =
      fallbackMessage ||
      (language === "en"
        ? "Something went wrong. Please try again."
        : language === "th"
          ? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"
          : "Đã có lỗi xảy ra, vui lòng thử lại.");

    if (!(error instanceof Error)) {
      return fallback;
    }

    const rawMessage = String(error.message || "").trim();
    if (!rawMessage) {
      return fallback;
    }

    const normalized = this.normalizeTranslationSource(rawMessage).toLowerCase();
    const onlyLeftMatch = normalized.match(/only\s+(\d+)\s+item(?:\(s\))?\s+left\s+in\s+stock/);

    if (onlyLeftMatch) {
      return language === "en"
        ? `Only ${onlyLeftMatch[1]} item(s) left in stock.`
        : `Chỉ còn ${onlyLeftMatch[1]} sản phẩm trong kho.`;
    }

    if (/san pham.*khong kha dung|product is not available/.test(normalized)) {
      return language === "en"
        ? "This product is not available right now."
        : "Sản phẩm hiện không khả dụng.";
    }

    if (/product not found/.test(normalized)) {
      return language === "en" ? "Product not found." : language === "th" ? "ไม่พบสินค้า" : "Không tìm thấy sản phẩm.";
    }

    if (/san pham.*het hang|product is out of stock/.test(normalized)) {
      return language === "en" ? "This product is out of stock." : language === "th" ? "สินค้าหมดสต็อก" : "Sản phẩm đã hết hàng.";
    }

    if (/khong du ton kho|does not have enough stock/.test(normalized)) {
      return language === "en"
        ? "This product does not have enough stock to create an order."
        : "Sản phẩm hiện không đủ tồn kho để tạo đơn.";
    }

    if (/quantity must be a positive integer|so luong.*so nguyen duong/.test(normalized)) {
      return language === "en"
        ? "Quantity must be a positive integer."
        : "Số lượng phải là số nguyên dương.";
    }

    if (/wallet balance is not enough|so du vi.*khong du/.test(normalized)) {
      return language === "en"
        ? "Your wallet balance is not enough. Please top up first."
        : "Số dư ví của bạn không đủ. Vui lòng nạp thêm trước.";
    }

    if (/customer wallet not found/.test(normalized)) {
      return language === "en"
        ? "Customer wallet not found."
        : "Không tìm thấy ví khách hàng.";
    }

    if (/shop not found/.test(normalized)) {
      return language === "en" ? "Shop not found." : language === "th" ? "ไม่พบร้านค้า" : "Không tìm thấy shop.";
    }

    if (/so tien nap.*1000d|top-up amount must be an integer from 1,000 vnd/.test(normalized)) {
      return language === "en"
        ? "Top-up amount must be an integer from 1,000 VND."
        : "Số tiền nạp phải là số nguyên từ 1.000đ trở lên.";
    }

    if (/shop seller hien khong du so du vi nguon|source wallet.*not have enough balance/.test(normalized)) {
      return language === "en"
        ? "The seller's source wallet does not have enough balance to process this order right now. Please contact support."
        : "Shop seller hiện không đủ số dư ví nguồn để xử lý đơn này. Vui lòng liên hệ hỗ trợ.";
    }

    if (/please send a tx hash|invalid tx hash format/.test(normalized)) {
      return language === "en"
        ? "Invalid tx hash format. Please paste the full transaction hash."
        : "TX hash chưa đúng định dạng. Vui lòng dán đầy đủ mã giao dịch.";
    }

    if (/could not find a confirmed usdt trc20 transfer|payment transaction not found/.test(normalized)) {
      return language === "en"
        ? "We could not find a confirmed USDT TRC20 transfer for this tx hash yet."
        : "Chưa tìm thấy giao dịch USDT TRC20 đã xác nhận cho tx hash này.";
    }

    if (/tx hash has already been used/.test(normalized)) {
      return language === "en"
        ? "This tx hash was already used for another order."
        : "TX hash này đã được dùng cho một đơn khác.";
    }

    if (/does not transfer usdt to the configured trc20 address/.test(normalized)) {
      return language === "en"
        ? "This tx hash does not send USDT to the configured TRC20 address."
        : "TX hash này không chuyển USDT tới đúng địa chỉ TRC20 đã cấu hình.";
    }

    if (/transferred usdt amount is lower than required/.test(normalized)) {
      return language === "en"
        ? "The transferred USDT amount is lower than required for this order."
        : "Số USDT đã chuyển thấp hơn mức cần thiết cho đơn này.";
    }

    if (/transaction is not confirmed yet/.test(normalized)) {
      return language === "en"
        ? "This transaction is not confirmed yet. Please wait a bit and try again."
        : "Giao dịch này chưa đủ xác nhận. Chờ thêm một chút rồi gửi lại nhé.";
    }

    if (/this order has already been confirmed with a different tx hash/.test(normalized)) {
      return language === "en"
        ? "This order was already confirmed with a different tx hash."
        : "Đơn này đã được xác nhận bằng một tx hash khác.";
    }

    if (language === "en" && this.isLikelyVietnameseText(rawMessage)) {
      return fallback;
    }

    return rawMessage;
  }

  private isLikelyVietnameseText(value: string) {
    return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(
      value,
    ) || /\b(khong|không|san pham|sản phẩm|vui long|vui lòng|so du|số dư|nap|nạp|don hang|đơn hàng)\b/i.test(value);
  }

  private formatCompactMoney(value: number) {
    const amount = Number(value || 0);

    if (amount >= 1_000_000) {
      const millions = amount / 1_000_000;
      const normalized =
        millions >= 10 || Number.isInteger(millions)
          ? `${Math.round(millions)}`
          : millions.toFixed(1).replace(/\.0$/, "");
      return `${normalized}tr`;
    }

    if (amount >= 1_000) {
      return `${Math.round(amount / 1_000)}k`;
    }

    return `${amount}`;
  }

  private chunkButtons<T>(items: T[], size: number) {
    if (size <= 0) {
      return [items];
    }

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private truncateLabel(value: string, maxLength: number) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 1).trimEnd()}…`;
  }

  private formatStock(available: number | null, language: BotLanguage = "vi") {
    if (available === null) {
      return language === "en" ? "Unlimited" : language === "th" ? "ไม่จำกัด" : "Không giới hạn";
    }

    return String(available);
  }

  private escapeHtml(value: string) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private async editOrSend(
    token: string,
    chatId: number,
    messageId: number | undefined,
    text: string,
    replyMarkup: Record<string, unknown>,
    actions: unknown[],
    parseMode?: "HTML" | "Markdown",
  ) {
    if (messageId) {
      return this.editText(token, chatId, messageId, text, replyMarkup, actions, parseMode);
    }

    return this.sendText(token, chatId, text, actions, replyMarkup, parseMode);
  }

  private async sendText(
    token: string,
    chatId: string | number,
    text: string,
    actions: unknown[],
    replyMarkup?: Record<string, unknown>,
    parseMode?: "HTML" | "Markdown",
  ) {
    if (this.isSimulationToken(token) || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      const mockResult = { message_id: actions.length + 1 };
      actions.push({ type: "sendMessage", chatId, text, replyMarkup, parseMode });
      return mockResult;
    }

    return telegramSendMessage(token, chatId, text, {
      reply_markup: replyMarkup,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }

  private async sendPhoto(
    token: string,
    chatId: string | number,
    photo: string,
    caption: string,
    actions: unknown[],
    replyMarkup?: Record<string, unknown>,
    parseMode?: "HTML" | "Markdown",
  ): Promise<number | null> {
    if (this.isSimulationToken(token) || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      actions.push({ type: "sendPhoto", chatId, photo, caption, replyMarkup, parseMode });
      return null;
    }

    try {
      const result = await telegramSendPhoto(token, chatId, photo, {
        caption,
        reply_markup: replyMarkup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }) as { message_id: number } | undefined;
      return result?.message_id ?? null;
    } catch {
      const result = await telegramSendMessage(token, chatId, caption, {
        reply_markup: replyMarkup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }) as { message_id: number } | undefined;
      return result?.message_id ?? null;
    }
  }

  private async editText(
    token: string,
    chatId: string | number,
    messageId: number,
    text: string,
    replyMarkup: Record<string, unknown>,
    actions: unknown[],
    parseMode?: "HTML" | "Markdown",
  ) {
    if (this.isSimulationToken(token) || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      actions.push({ type: "editMessageText", chatId, messageId, text, replyMarkup, parseMode });
      return;
    }

    await telegramEditMessageText(token, chatId, messageId, text, {
      reply_markup: replyMarkup,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }).catch(async () => {
      await telegramSendMessage(token, chatId, text, {
        reply_markup: replyMarkup,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      });
    });
  }

  private async answerCallback(token: string, callbackQueryId: string, actions: unknown[]) {
    if (this.isSimulationToken(token) || (this.config.mockTelegramEnabled && isMockBotToken(token))) {
      actions.push({ type: "answerCallbackQuery", callbackQueryId });
      return;
    }

    await telegramAnswerCallbackQuery(token, callbackQueryId).catch(() => undefined);
  }
}
