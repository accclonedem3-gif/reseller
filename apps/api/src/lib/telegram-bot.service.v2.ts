import axios from "axios";
import { AsyncLocalStorage } from "node:async_hooks";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  decryptSecret,
  isMockBotToken,
  telegramAnswerCallbackQuery,
  telegramDeleteMessage,
  telegramEditMessageText,
  telegramSendMessage,
  telegramSendPhoto,
  telegramSendPhotoBuffer,
  telegramSendVideo,
  isVideoUrl,
  renderRestockHtml,
  type PayOSBankInfo,
} from "@reseller/shared/server";
import {
  DownstreamSourceConnectionStatus,
  PaymentProvider,
  PaymentStatus,
  PaymentTransactionStatus,
  Prisma,
  SellerTier,
} from "@prisma/client";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { CustomerWalletService } from "../customer-wallet/customer-wallet.service";
import { WalletPromotionService } from "../wallet/wallet-promotion.service";
import { OrdersService } from "../orders/orders.service";
import { ShopsService } from "../shops/shops.service";
import { WarrantyService } from "../warranty/warranty.service";
import { AffiliateService } from "../affiliate/affiliate.service";
import { InternalSourceApiKeyService } from "../source/internal-source-api-key.service";
import { SellerSourceConnectionService } from "../seller/seller-source-connection.service";
import { BinancePayService } from "./binance-pay.service";
import { OkxPersonalApiService } from "./okx-personal-api.service";
import { OnchainPaymentService } from "./onchain-payment.service";
import { SolanaPaymentService } from "./solana-payment.service";
import { PaymentService } from "./payment.service";
import { TelegramClientService } from "./telegram-client.service";
import {
  BotSessionStore,
  PendingQuantitySelection,
  PendingWalletTopupSelection,
  PendingPaymentSelection,
  PendingTxHashSubmission,
  PendingBinanceOrderIdSubmission,
  PendingWarrantyClaimSubmission,
  PendingWarrantyIssueDescription,
  PendingWarrantyAccountSelection,
  PendingConnectionTopupInput,
} from "./bot-session.store";
import { BotRenderHelpers, BotLanguage } from "./bot-render.helpers";
import { CacheService } from "./cache.service";
import {
  hasValidCustomerEmailList,
  parseCustomerEmailList,
} from "./customer-email-list";
import { resolveVisiblePaymentProviders } from "./payment-method-visibility";
import { isBinanceAmountWithinTolerance } from "./binance-payment-match";
import { shouldHoldStockForCheckout } from "./preorder";
import {
  ORDER_HISTORY_PAGE_SIZE,
  buildOwnedOrderWhere,
  isPrivateTelegramChat,
  resolveOrderHistoryPage,
  splitTelegramText,
} from "./telegram-order-history";
import { decimalToNumber, formatCurrency } from "./utils";

const BIN_TO_BANK: Record<string, string> = {
  "970422": "MB Bank",
  "970415": "Vietinbank",
  "970416": "ACB",
  "970432": "Vietcombank",
  "970423": "TPBank",
  "970418": "BIDV",
  "970407": "Techcombank",
  "970405": "Agribank",
  "970431": "Eximbank",
  "970443": "SHB",
  "970440": "Sacombank",
  "970426": "MSB",
  "970449": "LienVietPostBank",
  "970441": "VIB",
  "970438": "BaoViet Bank",
  "970454": "VietBank",
  "970439": "PVcomBank",
  "970425": "ABBank",
  "970448": "Oceanbank",
  "970458": "Bac A Bank",
  "970464": "NamABank",
  "970462": "KienLongBank",
  "970400": "Saigonbank",
  "970403": "SaigonBank",
  "970406": "DongABank",
  "970419": "NCB",
  "970424": "Shinhan Bank",
  "970460": "BanViet",
};

type TelegramUpdate = Record<string, any>;

type CatalogItem = Awaited<
  ReturnType<ShopsService["getCatalogViewForShop"]>
>[number];
type FeaturedCatalogGroupKey =
  | "chatgpt"
  | "grok"
  | "veo3"
  | "kling"
  | "youtube";
type TelegramPaymentOption = PaymentProvider | "WALLET";
type HandleIncomingUpdateOptions = {
  simulateOnly?: boolean;
};

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
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
      matcher: (product) =>
        /\bgrok\b/i.test(`${product.displayName} ${product.sourceName}`),
    },
    {
      key: "veo3",
      label: "Veo3",
      emoji: "🎬",
      matcher: (product) =>
        /veo\s*3/i.test(`${product.displayName} ${product.sourceName}`),
    },
    {
      key: "kling",
      label: "Kling",
      emoji: "🎥",
      matcher: (product) =>
        /\bkling\b/i.test(`${product.displayName} ${product.sourceName}`),
    },
    {
      key: "youtube",
      label: "YouTube",
      emoji: "▶️",
      matcher: (product) =>
        /\byoutube\b/i.test(`${product.displayName} ${product.sourceName}`),
    },
  ];

  // Per-update render context (resolved shop customization + bling capability). Set once via
  // enterWith() at the top of handleIncomingUpdate so buttonLabel()/navBtn() apply the admin's
  // function-button customization (label/emoji/cusid) everywhere WITHOUT threading custData
  // through every message-builder. Each update is its own async context, so no cross-shop leak;
  // when unset (calls outside an update, e.g. broadcasts) the helpers fall back to defaults.
  private readonly btnCtx = new AsyncLocalStorage<{
    cust: Record<string, unknown>;
    canBling: boolean;
  }>();

  // Reply keyboard button labels (must match exactly in handleIncomingUpdate)
  private readonly replyKeyboardLabels = {
    products: {
      vi: "🛍️ Sản phẩm",
      en: "🛍️ Products",
      th: "🛍️ สินค้า",
      zh: "🛍️ 商品",
    },
    orders: {
      vi: "📦 Đơn hàng",
      en: "📦 Orders",
      th: "📦 คำสั่งซื้อ",
      zh: "📦 订单",
    },
    wallet: {
      vi: "💳 Ví",
      en: "💳 Wallet",
      th: "💳 กระเป๋าเงิน",
      zh: "💳 钱包",
    },
    support: {
      vi: "💬 Hỗ trợ",
      en: "💬 Support",
      th: "💬 ช่วยเหลือ",
      zh: "💬 客服",
    },
    warranty: {
      vi: "🛡️ Bảo hành",
      en: "🛡️ Warranty",
      th: "🛡️ การรับประกัน",
      zh: "🛡️ 售后",
    },
    language: {
      vi: "🌐 Ngôn ngữ",
      en: "🌐 Language",
      th: "🌐 ภาษา",
      zh: "🌐 语言",
    },
    home: {
      vi: "🏠 Trang chủ",
      en: "🏠 Home",
      th: "🏠 หน้าหลัก",
      zh: "🏠 首页",
    },
    affiliate: {
      vi: "🤝 Affiliate",
      en: "🤝 Affiliate",
      th: "🤝 แนะนำเพื่อน",
      zh: "🤝 推广返佣",
    },
  } as const;

  private buildReplyKeyboard(
    language: BotLanguage,
    isPro = false,
    customization?: Record<string, unknown> | null,
  ) {
    const l = this.replyKeyboardLabels;
    const emojis =
      customization?.buttonEmojis &&
      typeof customization.buttonEmojis === "object"
        ? (customization.buttonEmojis as Record<string, string>)
        : {};
    const labels =
      customization?.buttonLabels &&
      typeof customization.buttonLabels === "object"
        ? (customization.buttonLabels as Record<string, Record<string, string>>)
        : {};

    const btn = (key: keyof typeof l): string => {
      // `|| ` (not `?? `): an inherited/cloned ULTRA template sets buttonEmojis="" (it uses cusid
      // instead), and `?? ` would keep that empty string → blank button. Fall back to the default
      // text emoji so a non-premium reply-keyboard button always shows an icon.
      const emoji = emojis[key]?.trim() || l[key][language].split(" ")[0];
      const label =
        labels[key]?.[language] ??
        l[key][language].split(" ").slice(1).join(" ");
      return `${emoji} ${label}`;
    };

    return {
      keyboard: [
        [{ text: btn("products") }, { text: btn("orders") }],
        [{ text: btn("wallet") }, { text: btn("support") }],
        [
          { text: btn("home") },
          ...(isPro ? [{ text: btn("warranty") }] : []),
          { text: btn("language") },
        ],
        [{ text: btn("affiliate") }],
      ],
      resize_keyboard: true,
      persistent: true,
    };
  }

  /**
   * All accepted text variants for a reply-keyboard button: the built-in defaults PLUS the labels
   * actually rendered from the shop's effective customization (its own or an inherited ULTRA
   * template), in every language. Mirrors buildReplyKeyboard's btn() so a relabeled button still
   * matches when tapped (fixes the inherit-template label-drift no-op).
   */
  private replyButtonLabelVariants(
    key:
      | "products"
      | "orders"
      | "wallet"
      | "support"
      | "warranty"
      | "language"
      | "home"
      | "affiliate",
    customization?: Record<string, unknown> | null,
  ): string[] {
    const l = this.replyKeyboardLabels;
    const variants = new Set<string>(Object.values(l[key]));
    const emojis =
      customization?.buttonEmojis &&
      typeof customization.buttonEmojis === "object"
        ? (customization.buttonEmojis as Record<string, string>)
        : {};
    const labels =
      customization?.buttonLabels &&
      typeof customization.buttonLabels === "object"
        ? (customization.buttonLabels as Record<string, Record<string, string>>)
        : {};
    for (const lang of ["vi", "en", "th"] as const) {
      const emoji = emojis[key]?.trim() || l[key][lang].split(" ")[0];
      const label =
        labels[key]?.[lang] ?? l[key][lang].split(" ").slice(1).join(" ");
      variants.add(`${emoji} ${label}`);
    }
    return [...variants];
  }

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(CustomerWalletService)
    private readonly customerWalletService: CustomerWalletService,
    @Inject(WalletPromotionService)
    private readonly walletPromotionService: WalletPromotionService,
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(BinancePayService)
    private readonly binancePayService: BinancePayService,
    @Inject(OkxPersonalApiService)
    private readonly okxPersonalApiService: OkxPersonalApiService,
    @Inject(OnchainPaymentService)
    private readonly onchainPaymentService: OnchainPaymentService,
    @Inject(SolanaPaymentService)
    private readonly solanaPaymentService: SolanaPaymentService,
    @Inject(WarrantyService)
    private readonly warrantyService: WarrantyService,
    @Inject(AffiliateService)
    private readonly affiliateService: AffiliateService,
    @Inject(InternalSourceApiKeyService)
    private readonly apiKeyService: InternalSourceApiKeyService,
    @Inject(SellerSourceConnectionService)
    private readonly connectionTopupService: SellerSourceConnectionService,
    @Inject(TelegramClientService)
    private readonly tg: TelegramClientService,
    @Inject(BotSessionStore)
    private readonly sessions: BotSessionStore,
    @Inject(BotRenderHelpers)
    private readonly render: BotRenderHelpers,
    @Inject(CacheService)
    private readonly cache: CacheService,
  ) {}

  // Anti-abuse flood control thresholds (per shop+Telegram user, Redis fixed windows).
  // Humans never reach these; scripts/floods do. Short window drops bursts; the long window
  // detects sustained scripting and auto-blacklists.
  private static readonly FLOOD_SHORT_WINDOW_SEC = 10;
  private static readonly FLOOD_SHORT_LIMIT = 20;
  private static readonly FLOOD_LONG_WINDOW_SEC = 60;
  private static readonly FLOOD_BAN_LIMIT = 120;

  /**
   * Per-(shop, user) flood gate backed by Redis fixed-window counters.
   * Returns "ok" to proceed, "throttled" to silently drop this burst update, or "banned" when the
   * user has been spamming long enough to auto-blacklist. FAIL-OPEN: a degraded Redis returns
   * count 0 → "ok", so a Redis blip never blocks legitimate users.
   */
  private async enforceFloodControl(
    shopId: string,
    telegramUserId: string,
  ): Promise<"ok" | "throttled" | "banned"> {
    const shortCount = await this.cache.incrWithWindow(
      `flood:s:${shopId}:${telegramUserId}`,
      TelegramBotService.FLOOD_SHORT_WINDOW_SEC,
    );
    if (shortCount === 0) return "ok"; // Redis degraded → fail open
    const longCount = await this.cache.incrWithWindow(
      `flood:l:${shopId}:${telegramUserId}`,
      TelegramBotService.FLOOD_LONG_WINDOW_SEC,
    );
    if (longCount > TelegramBotService.FLOOD_BAN_LIMIT) return "banned";
    if (shortCount > TelegramBotService.FLOOD_SHORT_LIMIT) return "throttled";
    return "ok";
  }

  private _globalDefaultCust: {
    data: Record<string, unknown> | null;
    ts: number;
  } | null = null;

  private async getGlobalDefaultCustomization(): Promise<Record<
    string,
    unknown
  > | null> {
    if (
      this._globalDefaultCust &&
      Date.now() - this._globalDefaultCust.ts < 60_000
    ) {
      return this._globalDefaultCust.data;
    }
    try {
      const cfg = await this.prisma.botConfig.findFirst({
        where: { isGlobalDefault: true },
        select: { customizationJson: true },
      });
      const data =
        (cfg?.customizationJson as Record<string, unknown> | null) ?? null;
      this._globalDefaultCust = { data, ts: Date.now() };
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Like resolveCustomization but, when the shop inherits the ULTRA source template, uses the
   * UPSTREAM shop's customizationJson (welcome / labels / catalog text / emojis) instead of the
   * shop's own. Falls back to the shop's own customization when not inheriting.
   */
  private async resolveEffectiveCustomization(
    shopId: string,
    ownCust: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const inherited =
      await this.shopsService.getInheritedCustomizationJson(shopId);
    // Not inheriting → the shop's own customization.
    if (!inherited) return this.resolveCustomization(ownCust);
    // Inheriting → ULTRA source is the base (over globalDefault), PRO's own fields override on top
    // so PRO can tweak a few things (welcome text, labels, catalog text...) while inheriting the rest.
    const base = await this.resolveCustomization(inherited);
    return this.mergeCustomization(base, ownCust);
  }

  /** Overlay `over`'s fields onto `base` (deep-merge for known object keys). `over` wins per-field. */
  private mergeCustomization(
    base: Record<string, unknown>,
    over: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (!over) return base;
    const DEEP_KEYS = [
      "labelEmojiIds",
      "labelEmojis",
      "buttonEmojiIds",
      "messageEmojiIds",
      "buttonLabels",
      "buttonEmojis",
      "welcomeMessage",
      "footerBill",
      "productNote",
      "catalogText",
      "homeFooter",
      "walletNote",
    ];
    const merged: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (
        DEEP_KEYS.includes(k) &&
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        merged[k] &&
        typeof merged[k] === "object"
      ) {
        merged[k] = {
          ...(merged[k] as Record<string, unknown>),
          ...(v as Record<string, unknown>),
        };
      } else {
        merged[k] = v;
      }
    }
    return merged;
  }

  private async resolveCustomization(
    shopCust: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const globalDefault = await this.getGlobalDefaultCustomization();
    if (!globalDefault) return shopCust ?? {};
    if (!shopCust) return globalDefault;
    return this.mergeCustomization(globalDefault, shopCust);
  }

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
    const updateId = String(update?.update_id ?? "").trim();
    if (updateId) {
      const isFirstDelivery = await this.cache.claimOnce(
        `telegram:update:${shopId}:${updateId}`,
        10 * 60 * 1000,
      );
      if (!isFirstDelivery) {
        return { ok: true, actions };
      }
    }
    const callbackQuery = update.callback_query;
    const message = update.message;

    // Ack the button tap IMMEDIATELY (stops Telegram's loading spinner) before the rest of the
    // per-update DB work, so taps feel instant. catalog:custom answers later with its own alert.
    if (
      callbackQuery?.id &&
      callbackQuery.message?.chat?.id &&
      !String(callbackQuery.data || "").startsWith("catalog:custom:")
    ) {
      await this.answerCallback(outboundToken, callbackQuery.id, actions);
    }

    this.cleanupExpiredPendingSelections();

    const incomingChat = message?.chat || callbackQuery?.message?.chat;
    const incomingUserId = message?.from?.id || callbackQuery?.from?.id;
    if (
      incomingChat?.id &&
      incomingUserId &&
      !isPrivateTelegramChat(incomingChat, incomingUserId)
    ) {
      const botUsername = String(shop.botConfig?.telegramBotUsername || "")
        .trim()
        .replace(/^@/, "");
      await this.sendText(
        outboundToken,
        incomingChat.id,
        [
          "🔒 Vì bảo mật tài khoản và thanh toán, bot chỉ hoạt động trong chat riêng.",
          "Vui lòng mở cuộc trò chuyện riêng với bot để tiếp tục.",
          "",
          "For security, orders, wallet and delivered accounts are only available in a private chat.",
        ].join("\n"),
        actions,
        botUsername
          ? {
              inline_keyboard: [
                [
                  {
                    text: "🔐 Mở chat riêng",
                    url: `https://t.me/${botUsername}`,
                  },
                ],
              ],
            }
          : undefined,
      );
      return { ok: true, actions };
    }

    await this.ensureTelegramCustomerSeen(shop, message, callbackQuery);

    // Anti-abuse flood control — a single Telegram user hammering the bot (script / L7 flood) is
    // throttled per (shop, user) on Redis windows. Sustained spam auto-blacklists them; the
    // blacklist check below then drops every further update cheaply. Runs before the heavy render
    // work so floods cost almost nothing.
    const floodUserId = String(
      message?.from?.id || callbackQuery?.from?.id || "",
    );
    if (floodUserId) {
      const verdict = await this.enforceFloodControl(shopId, floodUserId);
      if (verdict === "banned") {
        await this.prisma.customer.updateMany({
          where: { shopId, telegramUserId: floodUserId },
          data: { blacklisted: true },
        });
      }
      if (verdict !== "ok") {
        return { ok: true, actions };
      }
    }

    // Admin lock — the "Khóa" button (admin/ctv/:id/lock) sets User/Seller.status=DISABLED +
    // Shop.status=SUSPENDED. When locked, the bot stops serving entirely and only tells the
    // customer it is locked. Polling stays on (webhookStatus untouched) so this reply still sends.
    if (shop.seller?.status === "DISABLED" || shop.status === "SUSPENDED") {
      const lockChatId = message?.chat?.id ?? callbackQuery?.message?.chat?.id;
      if (lockChatId) {
        const lockLang = await this.getCustomerLanguage(
          shopId,
          String(message?.from?.id || callbackQuery?.from?.id || ""),
        );
        const lockMsg =
          lockLang === "en"
            ? "🔒 This bot has been locked. Please contact the admin."
            : lockLang === "th"
              ? "🔒 บอทนี้ถูกล็อก กรุณาติดต่อแอดมิน"
              : "🔒 Bot đã bị khóa. Vui lòng liên hệ admin.";
        await this.sendText(outboundToken, lockChatId, lockMsg, actions);
      }
      return { ok: true, actions };
    }

    // "Bling" (custom-emoji) is attempted whenever a button has a cusid configured — only a premium
    // owner can pick custom emoji, so that IS the premium signal — UNLESS this bot self-learned it
    // can't actually emit them (cusidEmitOk === false → force text icons). Read from the already-
    // loaded botConfig (no extra query) and threaded into every render below.
    // Custom button icons require the configured bot owner to be Premium. If
    // Premium cannot be confirmed, retain the Unicode emoji in button text.
    const canBling = await this.resolveCanBling(shopId);

    // Make the resolved customization + bling capability available to buttonLabel()/navBtn() for
    // the rest of this update, so EVERY nav/footer/confirmation button reflects the admin's
    // function-button customization (label/emoji/cusid) — not just the catalog/buy/pay buttons.
    this.btnCtx.enterWith({
      cust: await this.resolveCustomization(
        (shop.botConfig?.customizationJson as Record<string, unknown> | null) ??
          null,
      ),
      canBling,
    });

    // Auto-issue source key for every user of an ULTRA bot (1 key per chatId, forever)
    if (
      shop.seller.tier === SellerTier.PRO ||
      shop.seller.tier === SellerTier.ULTRA
    ) {
      const autoChatId = message?.chat?.id ?? callbackQuery?.message?.chat?.id;
      if (autoChatId) {
        const chatIdStr = String(autoChatId);
        const existing = await this.apiKeyService.getActiveKeyForTelegramChatId(
          shop.id,
          chatIdStr,
        );
        if (!existing) {
          await this.apiKeyService.revokeAllBotKeysForChatId(
            shop.id,
            chatIdStr,
          );
          await this.apiKeyService.issueKey(shop.sellerId, shop.id, {
            label: `Bot - ${chatIdStr}`,
            telegramChatId: chatIdStr,
          });
        }
      }
    }

    const visitorTelegramUserId = String(
      message?.from?.id || callbackQuery?.from?.id || "",
    );
    if (visitorTelegramUserId) {
      const customerRecord = await this.prisma.customer.findUnique({
        where: {
          shopId_telegramUserId: {
            shopId,
            telegramUserId: visitorTelegramUserId,
          },
        },
        select: { blacklisted: true },
      });
      if (customerRecord?.blacklisted) {
        return { ok: true, actions };
      }
    }

    const messageLanguage = await this.getCustomerLanguage(
      shopId,
      String(message?.from?.id || ""),
    );

    if (message?.from?.id && message?.text && !message.text.startsWith("/")) {
      // Handle reply keyboard button taps (both vi & en)
      const msgText = String(message.text || "").trim();
      // Accept BOTH the built-in labels and this shop's effective custom labels (its own or an
      // inherited ULTRA template) so a relabeled reply-keyboard button still routes on tap.
      const replyCust = await this.resolveEffectiveCustomization(
        shopId,
        (shop.botConfig?.customizationJson as Record<string, unknown> | null) ??
          null,
      );
      const allProductLabels = this.replyButtonLabelVariants(
        "products",
        replyCust,
      );
      const allOrderLabels = this.replyButtonLabelVariants("orders", replyCust);
      const allWalletLabels = this.replyButtonLabelVariants(
        "wallet",
        replyCust,
      );
      const allSupportLabels = this.replyButtonLabelVariants(
        "support",
        replyCust,
      );
      const allWarrantyLabels = this.replyButtonLabelVariants(
        "warranty",
        replyCust,
      );
      const allHomeLabels = this.replyButtonLabelVariants("home", replyCust);
      const allLanguageLabels = this.replyButtonLabelVariants(
        "language",
        replyCust,
      );
      const allAffiliateLabels = this.replyButtonLabelVariants(
        "affiliate",
        replyCust,
      );

      if (allProductLabels.includes(msgText as any)) {
        await this.clearPendingQuantitySelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingWalletTopup(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingPaymentSelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingTxHashSubmission(
          shopId,
          String(message.from?.id || ""),
        );
        await this.renderCatalog(
          shopId,
          outboundToken,
          message.chat.id,
          undefined,
          0,
          actions,
          messageLanguage,
          canBling,
        );
        return { ok: true, actions };
      }

      if (allOrderLabels.includes(msgText as any)) {
        await this.clearPendingQuantitySelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingWalletTopup(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingPaymentSelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingTxHashSubmission(
          shopId,
          String(message.from?.id || ""),
        );
        await this.renderOrderHistory(
          shopId,
          outboundToken,
          message.chat.id,
          undefined,
          String(message.from.id),
          actions,
          messageLanguage,
        );
        return { ok: true, actions };
      }

      if (allWalletLabels.includes(msgText as any)) {
        await this.clearPendingQuantitySelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingPaymentSelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingTxHashSubmission(
          shopId,
          String(message.from?.id || ""),
        );
        await this.renderWalletPanel(
          shopId,
          outboundToken,
          message.chat.id,
          undefined,
          String(message.from.id),
          actions,
          messageLanguage,
        );
        return { ok: true, actions };
      }

      if (allSupportLabels.includes(msgText as any)) {
        await this.sendText(
          outboundToken,
          message.chat.id,
          this.buildSupportText(
            shop.name,
            shop.supportTelegram,
            shop.supportZalo,
            messageLanguage,
            shop.supportNote,
          ),
          actions,
          {
            inline_keyboard: [
              [this.navBtn("home", messageLanguage, "home:menu")],
            ],
          },
          "HTML",
        );
        return { ok: true, actions };
      }

      if (allWarrantyLabels.includes(msgText as any)) {
        // Must match the button-visibility rule (ULTRA OR INTERNAL-source PRO, see renderHome /
        // hasWarrantyFeature). Gating on ULTRA-only made the persistent "Bảo hành" reply button a
        // silent no-op for PRO shops with an internal source — eligibility is then enforced per-order.
        const hasWarrantyFeature =
          shop.seller.tier === SellerTier.PRO ||
          shop.seller.tier === SellerTier.ULTRA ||
          shop.providerConfig?.providerKind === "INTERNAL";
        if (!hasWarrantyFeature) {
          return { ok: true, actions };
        }
        await this.clearPendingQuantitySelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingWalletTopup(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingPaymentSelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingTxHashSubmission(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingWarrantyIssueDescription(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingWarrantyAccountSelection(
          shopId,
          String(message.from?.id || ""),
        );
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
        await this.clearPendingQuantitySelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingWalletTopup(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingPaymentSelection(
          shopId,
          String(message.from?.id || ""),
        );
        await this.clearPendingTxHashSubmission(
          shopId,
          String(message.from?.id || ""),
        );
        await this.renderHome(
          shopId,
          outboundToken,
          message.chat.id,
          undefined,
          actions,
          messageLanguage,
          canBling,
        );
        return { ok: true, actions };
      }

      if (allLanguageLabels.includes(msgText as any)) {
        await this.renderLanguageMenu(
          outboundToken,
          message.chat.id,
          undefined,
          messageLanguage,
          actions,
        );
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

      const handledPendingWalletTopup =
        await this.handlePendingWalletTopupMessage(
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

      const handledConnectionTopup =
        await this.handlePendingConnectionTopupAmountMessage(
          shop,
          outboundToken,
          message,
          actions,
        );

      if (handledConnectionTopup) {
        return { ok: true, actions };
      }

      const handledWarrantyAccountSelection =
        await this.handlePendingWarrantyAccountSelectionMessage(
          shopId,
          outboundToken,
          message,
          actions,
        );

      if (handledWarrantyAccountSelection) {
        return { ok: true, actions };
      }

      const handledPendingWarrantyClaim =
        await this.handlePendingWarrantyClaimMessage(
          shopId,
          outboundToken,
          message,
          actions,
        );

      if (handledPendingWarrantyClaim) {
        return { ok: true, actions };
      }

      const handledBinanceOrderId =
        await this.handlePendingBinanceOrderIdMessage(
          shopId,
          outboundToken,
          message,
          actions,
          messageLanguage,
        );

      if (handledBinanceOrderId) {
        return { ok: true, actions };
      }

      const handledOkxTxHash = await this.handlePendingOkxTxHashMessage(
        shopId,
        outboundToken,
        message,
        actions,
        messageLanguage,
      );

      if (handledOkxTxHash) {
        return { ok: true, actions };
      }
    }

    if (message?.text?.startsWith("/start")) {
      await this.clearPendingQuantitySelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingWalletTopup(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingPaymentSelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingTxHashSubmission(
        shopId,
        String(message.from?.id || ""),
      );

      const startParam = message.text.slice("/start".length).trim();
      if (startParam.startsWith("ref_") && message.from?.id) {
        const referrerId = startParam.slice("ref_".length);
        await this.applyAffiliateRef(
          shopId,
          {
            telegramUserId: String(message.from.id),
            telegramChatId: String(message.chat.id),
            telegramUsername: message.from.username || null,
            firstName: message.from.first_name || null,
            lastName: message.from.last_name || null,
          },
          referrerId,
        );
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
      await this.clearPendingQuantitySelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingWalletTopup(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingPaymentSelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingTxHashSubmission(
        shopId,
        String(message.from?.id || ""),
      );
      await this.renderCatalog(
        shopId,
        outboundToken,
        message.chat.id,
        undefined,
        0,
        actions,
        messageLanguage,
        canBling,
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/orders")) {
      await this.clearPendingQuantitySelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingWalletTopup(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingPaymentSelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingTxHashSubmission(
        shopId,
        String(message.from?.id || ""),
      );
      await this.renderOrderHistory(
        shopId,
        outboundToken,
        message.chat.id,
        undefined,
        String(message.from?.id || ""),
        actions,
        messageLanguage,
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/wallet")) {
      await this.clearPendingQuantitySelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingWalletTopup(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingPaymentSelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingTxHashSubmission(
        shopId,
        String(message.from?.id || ""),
      );
      await this.renderWalletPanel(
        shopId,
        outboundToken,
        message.chat.id,
        undefined,
        String(message.from?.id || ""),
        actions,
        messageLanguage,
      );
      return { ok: true, actions };
    }
    if (message?.text?.startsWith("/home")) {
      await this.clearPendingQuantitySelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingWalletTopup(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingPaymentSelection(
        shopId,
        String(message.from?.id || ""),
      );
      await this.clearPendingTxHashSubmission(
        shopId,
        String(message.from?.id || ""),
      );
      await this.renderHome(
        shopId,
        outboundToken,
        message.chat.id,
        undefined,
        actions,
        messageLanguage,
        canBling,
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/language")) {
      await this.renderLanguageMenu(
        outboundToken,
        message.chat.id,
        undefined,
        messageLanguage,
        actions,
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/settings")) {
      const ownerUserId = shop.botConfig?.ownerTelegramUserId;
      const fromUserId = String(message.from?.id || "");
      console.log(
        `[settings] fromUserId=${fromUserId} ownerUserId=${ownerUserId}`,
      );
      if (ownerUserId && fromUserId === ownerUserId) {
        const miniAppUrl = `${this.config.webPublicUrl}/mini-app/settings`;
        await this.sendText(
          outboundToken,
          message.chat.id,
          "⚙️ Nhấn nút bên dưới để mở cài đặt bot:",
          actions,
          {
            inline_keyboard: [
              [
                {
                  text: "⚙️ Cài đặt bot",
                  web_app: { url: miniAppUrl },
                },
              ],
            ],
          },
        );
      }
      return { ok: true, actions };
    }

    // Inspect custom emojis sent by owner or /getid, /emoji command
    const customEmojiEntities = (message?.entities || []).filter(
      (e: any) => e.type === "custom_emoji" && e.custom_emoji_id,
    );
    const isExplicitEmojiCmd =
      message?.text?.startsWith("/getid") ||
      message?.text?.startsWith("/emoji");
    const isOwner =
      Boolean(shop.botConfig?.ownerTelegramUserId) &&
      String(message?.from?.id || "") === shop.botConfig?.ownerTelegramUserId;
    const isShortEmojiMessage =
      (message?.text?.trim()?.length ?? 0) <= 30 && customEmojiEntities.length > 0;

    if (
      customEmojiEntities.length > 0 &&
      (isExplicitEmojiCmd || (isOwner && isShortEmojiMessage))
    ) {
      const uniqueIds = Array.from(
        new Set(customEmojiEntities.map((e: any) => String(e.custom_emoji_id))),
      );
      const lines = [
        "✨ <b>Thông tin Custom Emoji đã nhận:</b>",
        "",
        ...uniqueIds.map((id, index) => {
          return [
            `<b>Icon #${index + 1}:</b> <tg-emoji emoji-id="${id}">⭐️</tg-emoji>`,
            `• ID: <code>${id}</code>`,
            `• Thẻ HTML: <code>&lt;tg-emoji emoji-id="${id}"&gt;⭐️&lt;/tg-emoji&gt;</code>`,
            "",
          ].join("\n");
        }),
        "💡 <i>Chạm vào mã ID hoặc thẻ HTML ở trên để sao chép, sau đó dán vào trang Cấu hình bot!</i>",
      ];
      await this.sendText(
        outboundToken,
        message.chat.id,
        lines.join("\n"),
        actions,
        undefined,
        "HTML",
      );
      return { ok: true, actions };
    } else if (isExplicitEmojiCmd) {
      await this.sendText(
        outboundToken,
        message.chat.id,
        "💡 <b>Hướng dẫn lấy mã Emoji ID:</b>\nHãy gửi một tin nhắn chứa các icon/emoji động bạn muốn lấy mã vào đây. Bot sẽ tự động trích xuất mã ID và thẻ HTML để bạn sao chép!",
        actions,
        undefined,
        "HTML",
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/help")) {
      await this.sendText(
        outboundToken,
        message.chat.id,
        this.buildGuideText(shop.name, messageLanguage),
        actions,
      );
      return { ok: true, actions };
    }

    if (message?.text?.startsWith("/warranty")) {
      if (
        shop.seller.tier !== SellerTier.PRO &&
        shop.seller.tier !== SellerTier.ULTRA
      ) {
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
        this.buildSupportText(
          shop.name,
          shop.supportTelegram,
          shop.supportZalo,
          messageLanguage,
        ),
        actions,
      );
      return { ok: true, actions };
    }

    if (callbackQuery) {
      const data = String(callbackQuery.data || "");
      const chatId = callbackQuery.message?.chat?.id;
      const messageId = callbackQuery.message?.message_id;
      const telegramUserId = String(callbackQuery.from?.id || "");
      const callbackLanguage = await this.getCustomerLanguage(
        shopId,
        telegramUserId,
      );

      if (data === "home:menu") {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.renderHome(
          shopId,
          outboundToken,
          chatId,
          messageId,
          actions,
          callbackLanguage,
          canBling,
          Boolean(callbackQuery.message?.photo),
        );
      } else if (data === "home:products") {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.renderCatalog(
          shopId,
          outboundToken,
          chatId,
          messageId,
          0,
          actions,
          callbackLanguage,
          canBling,
        );
      } else if (data === "home:history") {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.renderOrderHistory(
          shopId,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
          callbackLanguage,
        );
      } else if (/^history:page:\d+$/.test(data)) {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);
        const requestedPage = Number(data.slice("history:page:".length));
        await this.renderOrderHistory(
          shopId,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
          callbackLanguage,
          "all",
          requestedPage,
        );
      } else if (data.startsWith("preorder:cancel:prompt:")) {
        const orderId = data.slice("preorder:cancel:prompt:".length);
        await this.editOrSend(
          outboundToken,
          chatId,
          messageId,
          callbackLanguage === "en"
            ? "⚠️ Send a cancellation request to the seller?\n\nIf approved, the item amount is refunded to your bot wallet. The pre-order fee is non-refundable."
            : callbackLanguage === "th"
              ? "⚠️ ส่งคำขอยกเลิกให้ผู้ขายหรือไม่?\n\nหากอนุมัติ ค่าสินค้าจะคืนเข้ากระเป๋าบอท แต่ค่าจองจะไม่คืน"
              : "⚠️ Gửi yêu cầu hủy cho seller?\n\nNếu được duyệt, tiền hàng sẽ hoàn vào ví bot. Phí đặt trước không được hoàn.",
          {
            inline_keyboard: [
              [
                {
                  text:
                    callbackLanguage === "en"
                      ? "✅ Confirm request"
                      : callbackLanguage === "th"
                        ? "✅ ยืนยันคำขอ"
                        : "✅ Xác nhận yêu cầu",
                  callback_data: `preorder:cancel:confirm:${orderId}`,
                },
              ],
              [
                {
                  text:
                    callbackLanguage === "en"
                      ? "⬅️ Back"
                      : callbackLanguage === "th"
                        ? "⬅️ กลับ"
                        : "⬅️ Quay lại",
                  callback_data: `history:order:${orderId}:0:-1`,
                },
              ],
            ],
          },
          actions,
        );
      } else if (data.startsWith("restock:sub:")) {
        const sourceProductId = data.slice("restock:sub:".length);
        const customerRecord = await this.prisma.customer.findUnique({
          where: { shopId_telegramUserId: { shopId, telegramUserId } },
        });
        if (customerRecord) {
          await this.prisma.restockSubscription.upsert({
            where: {
              customerId_sourceProductId: {
                customerId: customerRecord.id,
                sourceProductId,
              },
            },
            create: {
              shopId,
              customerId: customerRecord.id,
              sourceProductId,
            },
            update: {},
          });
        }
        await this.editOrSend(
          outboundToken,
          chatId,
          messageId,
          callbackLanguage === "en"
            ? "🔔 You will be notified when this product is back in stock."
            : callbackLanguage === "th"
              ? "🔔 คุณจะได้รับการแจ้งเตือนเมื่อสินค้านี้มีในสต็อก"
              : "🔔 Bạn sẽ nhận được thông báo ngay khi sản phẩm này có hàng lại.",
          {
            inline_keyboard: [
              [this.navBtn("back", callbackLanguage, "home:products")],
            ],
          },
          actions,
        );
      } else if (data.startsWith("order:cancel:")) {
        const orderId = data.slice("order:cancel:".length);
        const canceled = await this.ordersService.cancelPendingOrder(
          shopId,
          telegramUserId,
          orderId
        );
        if (canceled) {
          await this.editOrSend(
            outboundToken,
            chatId,
            messageId,
            callbackLanguage === "en"
              ? "✅ Order canceled successfully. Stock has been released."
              : callbackLanguage === "th"
                ? "✅ ยกเลิกคำสั่งซื้อเรียบร้อยแล้ว"
                : "✅ Đã hủy đơn hàng thành công. Kho hàng đã được nhả.",
            {
              inline_keyboard: [
                [this.navBtn("back", callbackLanguage, "home:products")],
              ],
            },
            actions,
          );
        } else {
          await this.editOrSend(
            outboundToken,
            chatId,
            messageId,
            callbackLanguage === "en"
              ? "⚠️ Cannot cancel this order (it might be already paid or expired)."
              : callbackLanguage === "th"
                ? "⚠️ ไม่สามารถยกเลิกคำสั่งซื้อนี้ได้ (อาจชำระเงินแล้วหรือหมดอายุ)"
                : "⚠️ Không thể hủy đơn này (có thể đã thanh toán hoặc đã hết hạn).",
            {
              inline_keyboard: [
                [this.navBtn("back", callbackLanguage, "home:products")],
              ],
            },
            actions,
          );
        }
      } else if (data.startsWith("preorder:cancel:confirm:")) {
        const orderId = data.slice("preorder:cancel:confirm:".length);
        await this.ordersService.requestPreorderCancellationFromTelegram(
          shopId,
          telegramUserId,
          orderId,
        );
        await this.editOrSend(
          outboundToken,
          chatId,
          messageId,
          callbackLanguage === "en"
            ? "✅ Cancellation request sent. The order is temporarily locked from delivery while waiting for seller review."
            : callbackLanguage === "th"
              ? "✅ ส่งคำขอยกเลิกแล้ว ระบบระงับการจัดส่งชั่วคราวระหว่างรอผู้ขายตรวจสอบ"
              : "✅ Đã gửi yêu cầu hủy. Đơn được tạm khóa giao hàng trong lúc chờ seller duyệt.",
          {
            inline_keyboard: [
              [
                {
                  text:
                    callbackLanguage === "en"
                      ? "📋 View orders"
                      : callbackLanguage === "th"
                        ? "📋 ดูคำสั่งซื้อ"
                        : "📋 Xem đơn hàng",
                  callback_data: "home:history",
                },
              ],
            ],
          },
          actions,
        );
      } else if (data.startsWith("history:order:")) {
        const [orderId, deliveryPageRaw, historyPageRaw, presentationRaw] = data
          .slice("history:order:".length)
          .split(":");
        if (orderId) {
          await this.renderOrderHistoryDetail(
            shopId,
            outboundToken,
            chatId,
            messageId,
            telegramUserId,
            orderId,
            Number(deliveryPageRaw || 0),
            Number(historyPageRaw ?? -1),
            actions,
            callbackLanguage,
            presentationRaw === "new",
          );
        }
      } else if (data === "home:wallet") {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.renderWalletPanel(
          shopId,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
          callbackLanguage,
        );
      } else if (data === "wallet:ledger") {
        await this.renderWalletLedger(
          shopId,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
          callbackLanguage,
          0,
        );
      } else if (data.startsWith("wallet:ledger:page:")) {
        const requestedPage = Number(data.slice("wallet:ledger:page:".length));
        await this.renderWalletLedger(
          shopId,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
          callbackLanguage,
          requestedPage,
        );
      } else if (data === "home:warranty" || data === "warranty:start") {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.clearPendingWarrantyIssueDescription(shopId, telegramUserId);
        await this.clearPendingWarrantyAccountSelection(shopId, telegramUserId);
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
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.clearPendingWarrantyClaimSubmission(shopId, telegramUserId);
        const check =
          await this.warrantyService.checkTelegramWarrantyEligibility({
            shopId,
            telegramUserId,
            orderCode,
            language: callbackLanguage === "zh" ? "en" : callbackLanguage,
          });
        if (!check.eligible) {
          await this.editOrSend(
            outboundToken,
            chatId,
            messageId,
            check.message,
            {
              inline_keyboard: [
                [this.navBtn("history", callbackLanguage, "home:history")],
                [this.navBtn("home", callbackLanguage, "home:menu")],
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
            check.issuedReplacements ?? [],
          );
        }
      } else if (data.startsWith("prokey:reissue:")) {
        const downstreamSellerId = data.slice("prokey:reissue:".length);
        await this.handleProKeyReissue(
          shop,
          outboundToken,
          chatId,
          messageId,
          downstreamSellerId,
          actions,
        );
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
        await this.handleProKeyTopupPrompt(
          shop,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
        );
      } else if (data === "wallet:topup") {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.promptWalletTopupCurrency(
          shopId,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
          callbackLanguage,
        );
      } else if (data === "wallet:topup:vnd") {
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.sessions.setPendingSession(
          "pendingWalletTopups",
          this.sessions.getPendingQuantityKey(shopId, telegramUserId),
          {
            currency: "VND",
            expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs,
          },
          this.sessions.pendingQuantityTtlMs,
        );
        await this.promptWalletTopupAmount(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          actions,
          "VND",
          undefined,
          callbackLanguage,
        );
      } else if (data === "wallet:topup:usd") {
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.sessions.setPendingSession(
          "pendingWalletTopups",
          this.sessions.getPendingQuantityKey(shopId, telegramUserId),
          {
            currency: "USDT",
            provider: "USDT_TRC20",
            expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs,
          },
          this.sessions.pendingQuantityTtlMs,
        );
        await this.promptWalletTopupAmount(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          actions,
          "USDT",
          undefined,
          callbackLanguage,
        );
      } else if (
        data === "wallet:topup:sol" ||
        data === "wallet:topup:ton" ||
        data === "wallet:topup:bep20"
      ) {
        const provider = data.endsWith(":ton")
          ? "USDT_TON"
          : data.endsWith(":bep20")
            ? "USDT_BEP20"
            : "USDT_SOL";
        await this.clearPendingWalletTopup(shopId, telegramUserId);
        await this.sessions.setPendingSession(
          "pendingWalletTopups",
          this.sessions.getPendingQuantityKey(shopId, telegramUserId),
          {
            currency: "USDT",
            provider,
            expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs,
          },
          this.sessions.pendingQuantityTtlMs,
        );
        await this.promptWalletTopupAmount(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          actions,
          "USDT",
          undefined,
          callbackLanguage,
          provider,
        );
      } else if (data === "home:language") {
        await this.renderLanguageMenu(
          outboundToken,
          chatId,
          messageId,
          callbackLanguage,
          actions,
        );
      } else if (data.startsWith("lang:set:")) {
        const nextLanguage = data.endsWith(":en")
          ? "en"
          : data.endsWith(":th")
            ? "th"
            : data.endsWith(":zh")
              ? "zh"
              : "vi";
        await this.setCustomerLanguage(shopId, telegramUserId, nextLanguage);
        try {
          await this.sendWalletPromotionAnnouncement(
            shopId,
            outboundToken,
            chatId,
            actions,
            nextLanguage,
          );
        } catch (error) {
          this.logger.warn(
            `Could not send wallet promotion announcement for shop ${shopId}: ${String(error)}`,
          );
        }
        // Send the home as a new message so the promotion is visibly placed before it.
        await this.renderHome(
          shopId,
          outboundToken,
          chatId,
          undefined,
          actions,
          nextLanguage,
          canBling,
        );
      } else if (data === "home:guide") {
        await this.editOrSend(
          outboundToken,
          chatId,
          messageId,
          this.buildGuideText(shop.name, callbackLanguage),
          {
            inline_keyboard: [
              [
                this.navBtn("products", callbackLanguage, "home:products"),
                this.navBtn("home", callbackLanguage, "home:menu"),
              ],
              [
                this.navBtn("history", callbackLanguage, "home:history"),
                this.navBtn("wallet", callbackLanguage, "home:wallet"),
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
          this.buildSupportText(
            shop.name,
            shop.supportTelegram,
            shop.supportZalo,
            callbackLanguage,
            shop.supportNote,
          ),
          {
            inline_keyboard: [
              [
                this.navBtn("home", callbackLanguage, "home:menu"),
                this.navBtn("productsShort", callbackLanguage, "home:products"),
              ],
              [
                this.navBtn("history", callbackLanguage, "home:history"),
                this.navBtn("wallet", callbackLanguage, "home:wallet"),
              ],
            ],
          },
          actions,
          "HTML",
        );
      } else if (data === "home:api") {
        await this.handleProKeyMenu(
          shop,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
        );
      } else if (data === "home:affiliate") {
        await this.renderAffiliatePanel(
          shop,
          outboundToken,
          chatId,
          messageId,
          telegramUserId,
          actions,
          callbackLanguage,
        );
      } else if (data.startsWith("catalog:custom:")) {
        const parts = data.split(":");
        const customGroupId = parts[2] ?? "";
        const page = Number(parts[3] || "0");
        await this.renderCustomCatalogGroup(
          shopId,
          outboundToken,
          chatId,
          messageId,
          customGroupId,
          page,
          actions,
          callbackLanguage,
          callbackQuery.id,
          canBling,
        );
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
          canBling,
        );
      } else if (data.startsWith("catalog:page:")) {
        const page = Number(data.split(":").pop() || "0");
        await this.renderCatalog(
          shopId,
          outboundToken,
          chatId,
          messageId,
          page,
          actions,
          callbackLanguage,
          canBling,
        );
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
      } else if (data.startsWith("txhash:topup:")) {
        await this.promptTopupTxHashSubmission(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          data.slice("txhash:topup:".length),
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
      } else if (data.startsWith("okx:tx:prompt:")) {
        await this.handleOkxTxHashPrompt(
          shopId,
          outboundToken,
          chatId,
          telegramUserId,
          data.slice("okx:tx:prompt:".length),
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
        await this.clearPendingTxHashSubmission(shopId, telegramUserId);

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
                inline_keyboard: [
                  [this.navBtn("back", callbackLanguage, "home:products")],
                ],
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
    formatHint?: string | null,
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

    const custData = await this.resolveCustomization(
      (shop.botConfig?.customizationJson as Record<string, unknown> | null) ??
        null,
    );
    const footerMap =
      custData?.footerBill && typeof custData.footerBill === "object"
        ? (custData.footerBill as Record<string, string>)
        : {};
    const msgEmojiIdsDelivery =
      custData?.messageEmojiIds && typeof custData.messageEmojiIds === "object"
        ? (custData.messageEmojiIds as Record<string, string>)
        : {};
    const footerBillEmojiId = msgEmojiIdsDelivery["footerBill"]?.trim() || "";
    const footerRaw =
      footerMap[language]?.trim() ||
      footerMap["vi"]?.trim() ||
      (language === "en"
        ? "Please change the password right after logging in for safety."
        : language === "th"
          ? "กรุณาเปลี่ยนรหัสผ่านทันทีหลังจากเข้าสู่ระบบเพื่อความปลอดภัย"
          : "Vui lòng đổi mật khẩu ngay sau khi đăng nhập để bảo đảm an toàn.");
    const footerText = footerBillEmojiId
      ? `<tg-emoji emoji-id="${footerBillEmojiId}">🧾</tg-emoji> ${footerRaw}`
      : footerRaw;

    const hasWarrantyFeature =
      shop.seller.tier === SellerTier.PRO ||
      shop.seller.tier === SellerTier.ULTRA ||
      shop.providerConfig?.providerKind === "INTERNAL";
    const warrantyButton =
      hasWarrantyFeature && orderCode
        ? {
            inline_keyboard: [
              [
                {
                  text:
                    language === "en"
                      ? "🛡️ Warranty"
                      : language === "th"
                        ? "🛡️ การรับประกัน"
                        : "🛡️ Bảo hành",
                  callback_data: `warranty_claim:${orderCode}`,
                },
              ],
            ],
          }
        : undefined;

    await this.sendText(
      token,
      chatId,
      [
        language === "en"
          ? "✅ Payment successful"
          : language === "th"
            ? "✅ ชำระเงินสำเร็จ"
            : "✅ Thanh toán thành công",
        language === "en"
          ? `Product: ${this.localizeProductName(productName, language)}`
          : language === "th"
            ? `สินค้า: ${this.localizeProductName(productName, language)}`
            : `Sản phẩm: ${this.localizeProductName(productName, language)}`,
        "",
        language === "en"
          ? "🔐 Your account:"
          : language === "th"
            ? "🔐 บัญชีของคุณ:"
            : "🔐 Tài khoản của bạn:",
        ...(formatHint ? [`Format: ${formatHint}`, ""] : []),
        deliveredAccountText,
        "",
        footerText,
      ].join("\n"),
      [],
      warrantyButton,
      footerBillEmojiId ? "HTML" : undefined,
    );
  }

  private async sendWalletPromotionAnnouncement(
    shopId: string,
    token: string,
    chatId: number,
    actions: unknown[],
    language: BotLanguage,
  ) {
    const promotions =
      await this.walletPromotionService.listActivePromotions(shopId);
    if (promotions.length === 0) return;
    const title =
      language === "en"
        ? "🎁 WALLET TOP-UP PROMOTION"
        : language === "th"
          ? "🎁 โปรโมชั่นเติมเงินเข้ากระเป๋า"
          : "🎁 KHUYẾN MÃI NẠP VÍ";
    const rows = promotions.map((promo) => {
      const threshold = Number(promo.minAmount).toLocaleString(
        language === "en" ? "en-US" : "vi-VN",
      );
      return language === "en"
        ? `• Top up from ${threshold} VND: bonus +${promo.bonusPercent}%`
        : language === "th"
          ? `• เติมตั้งแต่ ${threshold} VND: รับเพิ่ม +${promo.bonusPercent}%`
          : `• Nạp từ ${threshold}đ: tặng thêm +${promo.bonusPercent}%`;
    });
    const footer =
      language === "en"
        ? "The highest eligible tier is applied automatically."
        : language === "th"
          ? "ระบบจะใช้ระดับสูงสุดที่ยอดเติมถึงโดยอัตโนมัติ"
          : "Hệ thống tự động áp dụng mốc cao nhất bạn đạt được.";
    const text = [title, "", ...rows, "", footer].join("\n");
    const imageUrl = [...promotions]
      .reverse()
      .find((promo) => promo.imageUrl)?.imageUrl;
    if (imageUrl) {
      try {
        await this.sendPhoto(token, chatId, imageUrl, text, actions);
        return;
      } catch (error) {
        this.logger.warn(
          `Promotion image failed, falling back to text: ${String(error)}`,
        );
      }
    }
    await this.sendText(token, chatId, text, actions);
  }

  private async renderHome(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    actions: unknown[],
    language: BotLanguage = "vi",
    isPremium = false,
    messageHasPhoto = false,
  ) {
    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    const products = await this.shopsService.getCatalogViewForShop(
      shopId,
      false,
      false,
      true,
    );
    const activeProducts = products.filter(
      (item) => item.enabled && !item.hidden,
    );
    const available = activeProducts.filter(
      (item) =>
        item.available === null || item.available > 0 || item.preorderEnabled,
    );

    const isPro =
      shop.seller.tier === SellerTier.PRO ||
      shop.seller.tier === SellerTier.ULTRA;
    const hasWarranty =
      isPro || shop.providerConfig?.providerKind === "INTERNAL";

    const customization = await this.resolveEffectiveCustomization(
      shopId,
      (shop.botConfig?.customizationJson as Record<string, unknown> | null) ??
        null,
    );
    const custHomeFooter =
      customization?.homeFooter && typeof customization.homeFooter === "object"
        ? (customization.homeFooter as Record<string, string>)
        : {};
    const homeFooterText =
      custHomeFooter[language]?.trim() ??
      custHomeFooter["vi"]?.trim() ??
      undefined;
    const homeIconText =
      typeof customization?.homeIcon === "string"
        ? customization.homeIcon
        : undefined;

    const homeText = this.buildHomeText(
      shop.name,
      shop.tagline ||
        (language === "en"
          ? "Automated digital account stock, updated 24/7."
          : language === "th"
            ? "สต็อกบัญชีดิจิทัลอัตโนมัติ อัปเดตตลอด 24/7"
            : "Kho tài khoản tự động, cập nhật liên tục 24/7."),
      activeProducts.length,
      available.length,
      language,
      homeFooterText,
      homeIconText,
    );
    const custEmojis =
      customization?.buttonEmojis &&
      typeof customization.buttonEmojis === "object"
        ? (customization.buttonEmojis as Record<string, string>)
        : {};
    const custLabels =
      customization?.buttonLabels &&
      typeof customization.buttonLabels === "object"
        ? (customization.buttonLabels as Record<string, Record<string, string>>)
        : {};
    const custEmojiIds =
      customization?.buttonEmojiIds &&
      typeof customization.buttonEmojiIds === "object"
        ? (customization.buttonEmojiIds as Record<string, string>)
        : {};
    const custWelcome =
      customization?.welcomeMessage &&
      typeof customization.welcomeMessage === "object"
        ? (customization.welcomeMessage as Record<string, string>)
        : {};
    const custMsgEmojiIds =
      customization?.messageEmojiIds &&
      typeof customization.messageEmojiIds === "object"
        ? (customization.messageEmojiIds as Record<string, string>)
        : {};
    const welcomeExtra =
      custWelcome[language]?.trim() || custWelcome["vi"]?.trim() || "";
    const welcomeEmojiId = custMsgEmojiIds["welcomeMessage"]?.trim() || "";
    const welcomeFormatted = welcomeExtra
      ? welcomeEmojiId
        ? `<tg-emoji emoji-id="${welcomeEmojiId}">👋</tg-emoji> ${this.render.sanitizeTelegramHtml(welcomeExtra)}`
        : this.render.sanitizeTelegramHtml(welcomeExtra)
      : "";
    const fullHomeText = welcomeFormatted
      ? `${homeText}\n\n${welcomeFormatted}`
      : homeText;
    const bannerUrl = String(shop.logoUrl || "").trim();

    const custParts = (
      custKey: string,
      fallback: Parameters<typeof this.buttonLabel>[0],
    ) => {
      const full = this.buttonLabel(fallback, language);
      const defEmoji = full.split(" ")[0];
      const defLabel = full.split(" ").slice(1).join(" ");
      // `|| ` (not `?? `) so an empty-string emoji override — which an inherited/cloned ULTRA template
      // carries because it uses cusid instead — still falls back to the default text emoji.
      return {
        emoji: custEmojis[custKey]?.trim() || defEmoji,
        label: custLabels[custKey]?.[language] || defLabel,
      };
    };

    // Bot API 9.4: icon_custom_emoji_id on inline keyboard buttons. A premium viewer with a cusid gets
    // the cusid icon only (text emoji stripped so it doesn't render twice); everyone else gets the
    // default text emoji — so a non-premium viewer never sees a blank button.
    const iconBtn = (
      key: string,
      fallback: Parameters<typeof this.buttonLabel>[0],
      cbData: string,
    ) => {
      const useCustom = isPremium && Boolean(custEmojiIds[key]);
      const { emoji, label } = custParts(key, fallback);
      const btn: Record<string, string> = {
        text: useCustom ? label : `${emoji} ${label}`,
        callback_data: cbData,
      };
      if (useCustom && custEmojiIds[key])
        btn.icon_custom_emoji_id = custEmojiIds[key];
      return btn;
    };

    const inlineKeyboard = {
      inline_keyboard: [
        [
          iconBtn("products", "products", "home:products"),
          iconBtn("guide", "guide", "home:guide"),
        ],
        [
          iconBtn("orders", "history", "home:history"),
          iconBtn("wallet", "wallet", "home:wallet"),
        ],
        ...(hasWarranty
          ? [
              [
                iconBtn("warranty", "warranty", "home:warranty"),
                iconBtn("support", "support", "home:support"),
              ],
            ]
          : [[iconBtn("support", "support", "home:support")]]),
        ...(isPro ? [[iconBtn("apiKey", "apiKey", "home:api")]] : []),
        [iconBtn("affiliate", "affiliate", "home:affiliate")],
        [
          iconBtn("language", "language", "home:language"),
          iconBtn("home", "home", "home:menu"),
        ],
      ],
    };

    if (messageId && messageHasPhoto) {
      await this.editCaption(
        token,
        chatId,
        messageId,
        fullHomeText,
        inlineKeyboard,
        actions,
        "HTML",
        () => this.markCusidEmitFailed(shopId),
      );
    } else if (messageId && bannerUrl) {
      await this.sendPhoto(
        token,
        chatId,
        bannerUrl,
        fullHomeText,
        actions,
        inlineKeyboard,
        "HTML",
      );
    } else if (messageId) {
      await this.editText(
        token,
        chatId,
        messageId,
        fullHomeText,
        inlineKeyboard,
        actions,
        "HTML",
        () => this.markCusidEmitFailed(shopId),
      );
    } else if (bannerUrl) {
      await this.sendPhoto(
        token,
        chatId,
        bannerUrl,
        fullHomeText,
        actions,
        inlineKeyboard,
        "HTML",
      );
    } else {
      await this.sendText(
        token,
        chatId,
        fullHomeText,
        actions,
        inlineKeyboard,
        "HTML",
      );
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
    isPremium = false,
  ) {
    try {
      return await this._renderCatalogInner(
        shopId,
        token,
        chatId,
        messageId,
        page,
        actions,
        language,
        isPremium,
      );
    } catch (err) {
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "⚠️ Could not load products. Please try again."
          : "⚠️ Không tải được sản phẩm. Vui lòng thử lại.",
        actions,
        {
          inline_keyboard: [
            [
              {
                text: this.buttonLabel("retry", language),
                callback_data: "home:products",
              },
              {
                text: language === "en" ? "🏠 Home" : "🏠 Trang chủ",
                callback_data: "home:menu",
              },
            ],
          ],
        },
      ).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Resolve CTV (collaborator) pricing context for a chat.
   * A chat is CTV if the Customer.isCtv flag is set, OR it holds an active
   * InternalSourceApiKey, OR it has an active DownstreamSourceConnection —
   * unless explicitly blocked (isCtv === false). `getEffectivePrice` applies
   * the CTV base (internalSourcePrice when available, else salePrice) then the
   * per-customer discount. Centralizes logic previously duplicated across the
   * catalog / quantity-prompt renderers.
   */
  private buildCtvPricing(
    customerRecord: {
      isCtv?: boolean | null;
      discountPercent?: Prisma.Decimal | number | null;
    } | null,
    ctvApiKey: { id: string } | null,
    downstreamConn: { id: string } | null,
  ) {
    const blocked = customerRecord?.isCtv === false;
    const isCtv =
      !blocked &&
      ((customerRecord?.isCtv ?? false) ||
        ctvApiKey != null ||
        downstreamConn != null);
    const discountPercent = Number(customerRecord?.discountPercent ?? 0);
    const getEffectivePrice = (item: {
      salePrice: number;
      internalSourceEnabled?: boolean | null;
      internalSourcePrice?: number | null;
    }): number => {
      if (!isCtv) return item.salePrice;
      const base =
        item.internalSourceEnabled && item.internalSourcePrice != null
          ? item.internalSourcePrice
          : item.salePrice;
      return discountPercent > 0
        ? Math.round(base * (1 - discountPercent / 100))
        : base;
    };
    return { isCtv, discountPercent, getEffectivePrice };
  }

  private async _renderCatalogInner(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    page: number,
    actions: unknown[],
    language: BotLanguage = "vi",
    isPremium = false,
  ) {
    const [allCatalog, shopData, customerRecord, downstreamConn, ctvApiKey] =
      await Promise.all([
        this.shopsService.getCatalogViewForShop(shopId, false, true, true),
        this.shopsService.getSellerShopByShopId(shopId),
        this.prisma.customer.findFirst({
          where: { shopId, telegramChatId: String(chatId) },
          select: { isCtv: true, discountPercent: true },
        }),
        this.prisma.downstreamSourceConnection.findFirst({
          where: {
            upstreamShopId: shopId,
            downstreamTelegramChatId: String(chatId),
            status: "ACTIVE",
          },
          select: { id: true },
        }),
        this.prisma.internalSourceApiKey.findFirst({
          where: { shopId, telegramChatId: String(chatId), status: "ACTIVE" },
          select: { id: true },
        }),
      ]);
    const shopCust = await this.resolveEffectiveCustomization(
      shopId,
      (shopData.botConfig?.customizationJson as Record<
        string,
        unknown
      > | null) ?? null,
    );
    const globalOosEmojiId =
      typeof shopCust?.outOfStockEmojiId === "string"
        ? shopCust.outOfStockEmojiId.trim()
        : "";
    const showOutOfStock = shopCust?.showOutOfStock === true;
    const custData = {
      custEmojis:
        shopCust?.buttonEmojis && typeof shopCust.buttonEmojis === "object"
          ? (shopCust.buttonEmojis as Record<string, string>)
          : {},
      custLabels:
        shopCust?.buttonLabels && typeof shopCust.buttonLabels === "object"
          ? (shopCust.buttonLabels as Record<string, Record<string, string>>)
          : {},
      custEmojiIds:
        shopCust?.buttonEmojiIds && typeof shopCust.buttonEmojiIds === "object"
          ? (shopCust.buttonEmojiIds as Record<string, string>)
          : {},
    };
    const custEmojiIds = custData.custEmojiIds;
    const custMsgEmojiIdsCatalog =
      shopCust?.messageEmojiIds && typeof shopCust.messageEmojiIds === "object"
        ? (shopCust.messageEmojiIds as Record<string, string>)
        : {};
    const mkMsgIcon = (key: string, fallback: string) =>
      custMsgEmojiIdsCatalog[key]
        ? `<tg-emoji emoji-id="${custMsgEmojiIdsCatalog[key]}">${fallback}</tg-emoji>`
        : fallback;

    const { getEffectivePrice } = this.buildCtvPricing(
      customerRecord,
      ctvApiKey,
      downstreamConn,
    );

    const visibleBase = allCatalog.filter(
      (item) =>
        item.enabled &&
        !item.hidden &&
        (language !== "vi" || !item.hiddenVi) &&
        (language !== "en" || !item.hiddenEn),
    );
    const products = visibleBase.filter(
      (item) =>
        item.available === null || item.available > 0 || item.preorderEnabled,
    );
    const outOfStockShown = showOutOfStock
      ? visibleBase.filter(
          (item) =>
            item.available !== null &&
            item.available <= 0 &&
            !item.preorderEnabled,
        )
      : [];
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);

    const productBtn = (item: (typeof allCatalog)[number]) => {
      const isOos = item.available !== null && item.available <= 0;
      const emojiId = isOos ? globalOosEmojiId : item.iconCustomEmojiId;
      // Custom (premium) emoji only renders for Telegram Premium users; for everyone else show
      // the text-emoji fallback instead (and don't send the custom id they can't see).
      const useCustom = isPremium && Boolean(emojiId);
      const effectivePrice = getEffectivePrice(item);
      const btn: Record<string, string> = {
        text: this.buildProductButtonLabel(
          { ...item, salePrice: effectivePrice },
          language,
          usdtVndRate,
          useCustom,
        ),
        callback_data: `buy:${item.id}`,
      };
      if (useCustom && emojiId) btn.icon_custom_emoji_id = emojiId;
      return btn;
    };
    if (products.length === 0) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? ["🛒 Products", "", "There are no active products right now."].join(
              "\n",
            )
          : language === "th"
            ? ["🛒 สินค้า", "", "ขณะนี้ยังไม่มีสินค้าที่เปิดขาย"].join("\n")
            : [
                "🛒 Danh sách sản phẩm",
                "",
                "Hiện chưa có sản phẩm nào đang mở bán.",
              ].join("\n"),
        {
          inline_keyboard: [
            [
              this.navBtn("home", language, "home:menu"),
              this.navBtn("supportShort", language, "home:support"),
            ],
          ],
        },
        actions,
      );
      return;
    }

    const customGroups = await this.shopsService.getCatalogGroupsForShop(
      shopId,
      true,
    );

    if (customGroups.length > 0) {
      // Custom group mode: show group buttons + ungrouped products
      const assignedProductIds = new Set(
        products.filter((p) => p.groupId).map((p) => p.groupId),
      );
      const ungrouped = products.filter((p) => !p.groupId);

      const catalogTextCustom = (shopCust as Record<string, unknown> | null)
        ?.catalogText as Record<string, string> | undefined;
      const catalogTextVal =
        catalogTextCustom?.[language] || catalogTextCustom?.["vi"] || "";

      const lines: string[] = [
        language === "en"
          ? `${mkMsgIcon("catalog", "🛒")} Products`
          : language === "th"
            ? `${mkMsgIcon("catalog", "🛒")} สินค้า`
            : `${mkMsgIcon("catalog", "🛒")} Danh sách sản phẩm`,
      ];

      if (catalogTextVal.trim()) {
        lines.push("");
        lines.push(catalogTextVal.trim());
      }

      // Active promo banner — list all products currently having promo
      const activePromos = products
        .map((p) => ({
          name: this.localizeProductName(p.displayName, language),
          banner: this.getActivePromoBanner(p, language),
          bannerUrl: (p as any).promoBannerUrl as string | null,
        }))
        .filter((x) => x.banner);
      if (activePromos.length > 0) {
        // Send banner images first as separate messages
        const banners = activePromos.filter((x) => x.bannerUrl);
        for (const ap of banners) {
          try {
            if (isVideoUrl(ap.bannerUrl!)) {
              await telegramSendVideo(token, chatId, ap.bannerUrl!, {
                caption: `🎉 <b>${this.escapeHtml(ap.name)}</b>\n${this.escapeHtml(ap.banner!)}`,
                parse_mode: "HTML",
              });
            } else {
              await telegramSendPhoto(token, chatId, ap.bannerUrl!, {
                caption: `🎉 <b>${this.escapeHtml(ap.name)}</b>\n${this.escapeHtml(ap.banner!)}`,
                parse_mode: "HTML",
              });
            }
          } catch {
            // ignore
          }
        }
        lines.push("");
        lines.push(
          language === "en"
            ? "🎉 <b>Active promotions:</b>"
            : language === "th"
              ? "🎉 <b>โปรโมชั่นที่กำลังใช้งาน:</b>"
              : "🎉 <b>Khuyến mãi đang diễn ra:</b>",
        );
        for (const ap of activePromos) {
          lines.push(`\n▫️ <b>${this.escapeHtml(ap.name)}</b>`);
          lines.push(
            this.escapeHtml(ap.banner!)
              .split("\n")
              .map((line) => `   ${line}`)
              .join("\n"),
          );
        }
      }

      const categoryCols = Math.min(
        3,
        Math.max(
          1,
          Number(
            (shopCust as Record<string, unknown> | null)?.categoryGridCols,
          ) || 3,
        ),
      );
      const groupCounts = new Map<string, number>();
      for (const p of products) {
        if (p.groupId)
          groupCounts.set(p.groupId, (groupCounts.get(p.groupId) || 0) + 1);
      }
      const visibleCustomGroups = shopData.providerConfig?.ownProductsOnly
        ? customGroups.filter((group) =>
            visibleBase.some((product) => product.groupId === group.id),
          )
        : customGroups;
      const groupRows = this.chunkButtons(
        visibleCustomGroups.map((g) => {
          // Categories use the 📁 folder as their standby text icon (matches the category header
          // "📁 <name>"), so a non-premium viewer always sees the folder — never blank. A premium
          // viewer with a custom-emoji id on the category gets the cusid bling instead (text stripped
          // to avoid a double icon). Never renders the stored text `icon` (leftover word/label).
          const groupAny = g as typeof g & {
            iconCustomEmojiId?: string | null;
          };
          const useCustom = isPremium && Boolean(groupAny.iconCustomEmojiId);
          const count = groupCounts.get(g.id) || 0;
          const textIcon = "📁";
          const btn: Record<string, string> = {
            text: `${useCustom ? "" : `${textIcon} `}${g.name} (${count})`,
            callback_data: `catalog:custom:${g.id}:0`,
          };
          if (useCustom && groupAny.iconCustomEmojiId)
            btn.icon_custom_emoji_id = groupAny.iconCustomEmojiId;
          return btn;
        }),
        categoryCols,
      );

      // Paginate the ungrouped products so the keyboard never exceeds Telegram's reply_markup size
      // limit (category buttons + nav are shown on every page; ungrouped products fill the rest).
      const ungroupedRows = [
        ...ungrouped.map((item) => [productBtn(item)]),
        ...outOfStockShown
          .filter((item) => !item.groupId)
          .map((item) => [productBtn(item)]),
      ];
      const cgRefreshRow = [
        this.buildRefreshBtn(custData, language, "home:products", isPremium),
      ];
      const cgNavRows = this.buildCatalogNavButtons(
        custData,
        language,
        isPremium,
      );
      const cgFixedRows = [...groupRows, cgRefreshRow, ...cgNavRows];
      const cgFixedRowCount = cgFixedRows.length + 1; // reserve 1 row for page-nav
      const cgFixedButtonCount =
        cgFixedRows.reduce((s, r) => s + r.length, 0) + 3; // reserve 3 buttons for page-nav
      const cgFixedBytes =
        cgFixedRows.reduce(
          (s, r) =>
            s +
            r.reduce(
              (x, b) => x + this.inlineBtnBytes(b as Record<string, unknown>),
              0,
            ),
          0,
        ) + 220; // reserve for the page-nav row
      const cgPages = this.paginateProductRows(
        ungroupedRows,
        cgFixedBytes,
        cgFixedRowCount,
        cgFixedButtonCount,
      );
      const cgIdx = Math.min(Math.max(0, page), cgPages.length - 1);
      await this.editOrSend(
        token,
        chatId,
        messageId,
        lines.join("\n"),
        {
          inline_keyboard: [
            ...groupRows,
            ...(cgPages[cgIdx] ?? []),
            ...this.buildCatalogPageNav(cgIdx, cgPages.length, language),
            cgRefreshRow,
            ...cgNavRows,
          ],
        },
        actions,
        "HTML",
      );
      return;
    }

    // No custom groups — show all products directly
    const allPageItems = [...products, ...outOfStockShown];

    const catalogTextLegacy = (shopCust as Record<string, unknown> | null)
      ?.catalogText as Record<string, string> | undefined;
    const catalogTextLegacyVal =
      catalogTextLegacy?.[language] || catalogTextLegacy?.["vi"] || "";

    const lines: string[] = [
      language === "en"
        ? `${mkMsgIcon("catalog", "🛒")} Products`
        : language === "th"
          ? `${mkMsgIcon("catalog", "🛒")} สินค้า`
          : `${mkMsgIcon("catalog", "🛒")} Danh sách sản phẩm`,
    ];

    if (catalogTextLegacyVal.trim()) {
      lines.push("");
      lines.push(catalogTextLegacyVal.trim());
    }

    // Active promo banner
    const activePromosFlat = products
      .map((p) => ({
        name: this.localizeProductName(p.displayName, language),
        banner: this.getActivePromoBanner(p, language),
        bannerUrl: (p as any).promoBannerUrl as string | null,
      }))
      .filter((x) => x.banner);
    if (activePromosFlat.length > 0) {
      const bannersFlat = activePromosFlat.filter((x) => x.bannerUrl);
      for (const ap of bannersFlat) {
        try {
          await telegramSendPhoto(token, chatId, ap.bannerUrl!, {
            caption: `🎉 <b>${this.escapeHtml(ap.name)}</b>\n${this.escapeHtml(ap.banner!)}`,
            parse_mode: "HTML",
          });
        } catch {
          // ignore
        }
      }
      lines.push("");
      lines.push(
        language === "en"
          ? "🎉 <b>Active promotions:</b>"
          : language === "th"
            ? "🎉 <b>โปรโมชั่นที่กำลังใช้งาน:</b>"
            : "🎉 <b>Khuyến mãi đang diễn ra:</b>",
      );
      for (const ap of activePromosFlat) {
        lines.push(`\n▫️ <b>${this.escapeHtml(ap.name)}</b>`);
        lines.push(
          this.escapeHtml(ap.banner!)
            .split("\n")
            .map((line) => `   ${line}`)
            .join("\n"),
        );
      }
    }

    const flatRefreshRow = [
      this.buildRefreshBtn(custData, language, "home:products", isPremium),
    ];
    const flatNavRows = this.buildCatalogNavButtons(
      custData,
      language,
      isPremium,
    );
    const flatFixedRows = [flatRefreshRow, ...flatNavRows];
    const flatFixedRowCount = flatFixedRows.length + 1; // reserve 1 row for page-nav
    const flatFixedButtonCount =
      flatFixedRows.reduce((s, r) => s + r.length, 0) + 3; // reserve 3 buttons for page-nav
    const flatFixedBytes =
      flatFixedRows.reduce(
        (s, r) =>
          s +
          r.reduce(
            (x, b) => x + this.inlineBtnBytes(b as Record<string, unknown>),
            0,
          ),
        0,
      ) + 220; // reserve for the page-nav row
    const flatPages = this.paginateProductRows(
      allPageItems.map((item) => [productBtn(item)]),
      flatFixedBytes,
      flatFixedRowCount,
      flatFixedButtonCount,
    );
    const flatIdx = Math.min(Math.max(0, page), flatPages.length - 1);
    await this.editOrSend(
      token,
      chatId,
      messageId,
      lines.join("\n"),
      {
        inline_keyboard: [
          ...(flatPages[flatIdx] ?? []),
          ...this.buildCatalogPageNav(flatIdx, flatPages.length, language),
          flatRefreshRow,
          ...flatNavRows,
        ],
      },
      actions,
      "HTML",
    );
  }

  private async renderCustomCatalogGroup(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    groupId: string,
    page: number,
    actions: unknown[],
    language: BotLanguage = "vi",
    callbackQueryId?: string,
    isPremium = false,
  ) {
    const [
      allProducts,
      groups,
      custDataCustom,
      customerRecordGrp,
      downstreamConnGrp,
      ctvApiKeyGrp,
    ] = await Promise.all([
      this.shopsService.getCatalogViewForShop(shopId, false, true, true),
      this.shopsService.getCatalogGroupsForShop(shopId, true),
      this.loadCustData(shopId),
      this.prisma.customer.findFirst({
        where: { shopId, telegramChatId: String(chatId) },
        select: { isCtv: true, discountPercent: true },
      }),
      this.prisma.downstreamSourceConnection.findFirst({
        where: {
          upstreamShopId: shopId,
          downstreamTelegramChatId: String(chatId),
          status: "ACTIVE",
        },
        select: { id: true },
      }),
      this.prisma.internalSourceApiKey.findFirst({
        where: { shopId, telegramChatId: String(chatId), status: "ACTIVE" },
        select: { id: true },
      }),
    ]);

    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      if (callbackQueryId) {
        await telegramAnswerCallbackQuery(token, callbackQueryId).catch(
          () => undefined,
        );
      }
      await this.renderCatalog(
        shopId,
        token,
        chatId,
        messageId,
        0,
        actions,
        language,
        isPremium,
      );
      return;
    }

    const { getEffectivePrice: getEffectivePriceGrp } = this.buildCtvPricing(
      customerRecordGrp,
      ctvApiKeyGrp,
      downstreamConnGrp,
    );

    const products = allProducts.filter(
      (item) =>
        item.groupId === groupId &&
        item.enabled &&
        !item.hidden &&
        (language !== "vi" || !item.hiddenVi) &&
        (language !== "en" || !item.hiddenEn) &&
        (item.available === null || item.available > 0 || item.preorderEnabled),
    );

    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    const productBtn = (item: (typeof allProducts)[number]) => {
      const useCustom = isPremium && Boolean(item.iconCustomEmojiId);
      const btn: Record<string, string> = {
        text: this.buildProductButtonLabel(
          { ...item, salePrice: getEffectivePriceGrp(item) },
          language,
          usdtVndRate,
          useCustom,
        ),
        callback_data: `buy:${item.id}`,
      };
      if (useCustom && item.iconCustomEmojiId)
        btn.icon_custom_emoji_id = item.iconCustomEmojiId;
      return btn;
    };

    if (products.length === 0) {
      const outOfStockMsg =
        language === "en"
          ? "The product you selected is out of stock, please come back later."
          : language === "th"
            ? "สินค้าที่คุณเลือกหมดสต็อก กรุณากลับมาดูใหม่ภายหลังนะ"
            : "Sản phẩm bạn đang chọn hết hàng, bạn quay lại mua sau nhé.";
      if (callbackQueryId) {
        await telegramAnswerCallbackQuery(
          token,
          callbackQueryId,
          outOfStockMsg,
          { showAlert: true },
        ).catch(() => undefined);
      }
      return;
    }

    if (callbackQueryId) {
      await telegramAnswerCallbackQuery(token, callbackQueryId).catch(
        () => undefined,
      );
    }

    const lines = [`📁 ${group.name}`];
    const groupDescription = group.description?.trim();
    if (groupDescription) {
      lines.push("", groupDescription);
    }
    lines.push(
      "",
      language === "en"
        ? "Choose a product to view details."
        : language === "th"
          ? "เลือกสินค้าเพื่อดูรายละเอียด"
          : "Chọn sản phẩm để xem chi tiết.",
    );

    const customGroupRefreshRow = [
      this.buildRefreshBtn(
        custDataCustom,
        language,
        `catalog:custom:${groupId}:${page}`,
        isPremium,
      ),
    ];
    const customGroupViewAllRow = [
      this.buildNavTextBtn(
        custDataCustom,
        "viewAll",
        "viewAll",
        "home:products",
        language,
        isPremium,
      ),
    ];
    const customGroupNavRows = this.buildCatalogNavButtons(
      custDataCustom,
      language,
      isPremium,
    );
    const customGroupFixedRows = [
      customGroupRefreshRow,
      customGroupViewAllRow,
      ...customGroupNavRows,
    ];
    const customGroupFixedRowCount = customGroupFixedRows.length + 1;
    const customGroupFixedButtonCount =
      customGroupFixedRows.reduce((acc, r) => acc + r.length, 0) + 3;
    const customGroupFixedBytes =
      customGroupFixedRows.reduce(
        (s, r) =>
          s +
          r.reduce(
            (x, b) => x + this.inlineBtnBytes(b as Record<string, unknown>),
            0,
          ),
        0,
      ) + 220;
    const customGroupPages = this.paginateProductRows(
      products.map((item) => [productBtn(item)]),
      customGroupFixedBytes,
      customGroupFixedRowCount,
      customGroupFixedButtonCount,
    );
    const customGroupIdx = Math.min(
      Math.max(0, page),
      customGroupPages.length - 1,
    );

    await this.editOrSend(
      token,
      chatId,
      messageId,
      lines.join("\n"),
      {
        inline_keyboard: [
          ...(customGroupPages[customGroupIdx] ?? []),
          ...this.buildCatalogPageNav(
            customGroupIdx,
            customGroupPages.length,
            language,
            `catalog:custom:${groupId}`,
          ),
          ...customGroupFixedRows,
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
    isPremium = false,
  ) {
    const [
      allProducts,
      custDataFeatured,
      customerRecordFt,
      downstreamConnFt,
      ctvApiKeyFt,
    ] = await Promise.all([
      this.shopsService.getCatalogViewForShop(shopId, false, true, true),
      this.loadCustData(shopId),
      this.prisma.customer.findFirst({
        where: { shopId, telegramChatId: String(chatId) },
        select: { isCtv: true, discountPercent: true },
      }),
      this.prisma.downstreamSourceConnection.findFirst({
        where: {
          upstreamShopId: shopId,
          downstreamTelegramChatId: String(chatId),
          status: "ACTIVE",
        },
        select: { id: true },
      }),
      this.prisma.internalSourceApiKey.findFirst({
        where: { shopId, telegramChatId: String(chatId), status: "ACTIVE" },
        select: { id: true },
      }),
    ]);
    const { getEffectivePrice: getEffectivePriceFt } = this.buildCtvPricing(
      customerRecordFt,
      ctvApiKeyFt,
      downstreamConnFt,
    );
    const products = allProducts.filter(
      (item) =>
        item.enabled &&
        !item.hidden &&
        (language !== "vi" || !item.hiddenVi) &&
        (language !== "en" || !item.hiddenEn) &&
        (item.available === null || item.available > 0 || item.preorderEnabled),
    );
    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    const productBtn = (item: (typeof products)[number]) => {
      const useCustom = isPremium && Boolean(item.iconCustomEmojiId);
      const btn: Record<string, string> = {
        text: this.buildProductButtonLabel(
          { ...item, salePrice: getEffectivePriceFt(item) },
          language,
          usdtVndRate,
          useCustom,
        ),
        callback_data: `buy:${item.id}`,
      };
      if (useCustom && item.iconCustomEmojiId)
        btn.icon_custom_emoji_id = item.iconCustomEmojiId;
      return btn;
    };
    const { featuredGroups } = this.splitCatalogProducts(products);
    const group = featuredGroups.find((item) => item.key === groupKey);

    if (!group || group.items.length === 0) {
      await this.renderCatalog(
        shopId,
        token,
        chatId,
        messageId,
        0,
        actions,
        language,
        isPremium,
      );
      return;
    }

    const lines = [
      language === "en"
        ? `${group.emoji} ${group.label}`
        : language === "th"
          ? `${group.emoji} ${group.label}`
          : `${group.emoji} Nhóm ${group.label}`,
      "",
      language === "en"
        ? "Choose a product in this group to continue."
        : language === "th"
          ? "เลือกสินค้าในหมวดหมู่นี้เพื่อดำเนินการต่อ"
          : "Chọn một sản phẩm trong nhóm này để xem chi tiết.",
    ];

    const ftRefreshRow = [
      this.buildRefreshBtn(
        custDataFeatured,
        language,
        `catalog:group:${group.key}:${page}`,
        isPremium,
      ),
    ];
    const ftViewAllRow = [
      this.buildNavTextBtn(
        custDataFeatured,
        "viewAll",
        "viewAll",
        "home:products",
        language,
        isPremium,
      ),
    ];
    const ftNavRows = this.buildCatalogNavButtons(
      custDataFeatured,
      language,
      isPremium,
    );
    const ftFixedRows = [ftRefreshRow, ftViewAllRow, ...ftNavRows];
    const ftFixedRowCount = ftFixedRows.length + 1;
    const ftFixedButtonCount =
      ftFixedRows.reduce((acc, r) => acc + r.length, 0) + 3;
    const ftFixedBytes =
      ftFixedRows.reduce(
        (s, r) =>
          s +
          r.reduce(
            (x, b) => x + this.inlineBtnBytes(b as Record<string, unknown>),
            0,
          ),
        0,
      ) + 220;
    const ftPages = this.paginateProductRows(
      group.items.map((item) => [productBtn(item)]),
      ftFixedBytes,
      ftFixedRowCount,
      ftFixedButtonCount,
    );
    const ftIdx = Math.min(Math.max(0, page), ftPages.length - 1);

    await this.editOrSend(
      token,
      chatId,
      messageId,
      lines.join("\n"),
      {
        inline_keyboard: [
          ...(ftPages[ftIdx] ?? []),
          ...this.buildCatalogPageNav(
            ftIdx,
            ftPages.length,
            language,
            `catalog:group:${group.key}`,
          ),
          ...ftFixedRows,
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
    view: "recent" | "all" = "recent",
    requestedPage = 0,
  ) {
    const [usdtVndRate, shop, custDataHistory, customer] = await Promise.all([
      this.getShopUsdtVndRate(shopId),
      this.shopsService.getSellerShopByShopId(shopId),
      this.loadCustData(shopId),
      this.prisma.customer.findUnique({
        where: { shopId_telegramUserId: { shopId, telegramUserId } },
        select: { id: true },
      }),
    ]);
    const isPro =
      shop.seller.tier === SellerTier.PRO ||
      shop.seller.tier === SellerTier.ULTRA;
    const orderWhere = {
      shopId,
      customerId: customer?.id || "__missing_customer__",
    };
    const totalOrders =
      view === "all" ? await this.prisma.order.count({ where: orderWhere }) : 0;
    const pagination = resolveOrderHistoryPage(
      view === "all" ? requestedPage : 0,
      view === "all" ? totalOrders : 0,
      ORDER_HISTORY_PAGE_SIZE,
    );
    const { page, totalPages } = pagination;
    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderCode: true,
        productNameSnapshot: true,
        quantity: true,
        totalSaleAmount: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        deliveredAccountText: true,
        paymentTransaction: {
          select: {
            provider: true,
            status: true,
            externalOrderCode: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: view === "all" ? pagination.skip : undefined,
      take: pagination.take,
    });

    const paginationButtons: Array<{ text: string; callback_data: string }> =
      [];
    if (view === "all" && page > 0) {
      paginationButtons.push({
        text:
          language === "en"
            ? "⬅️ Previous"
            : language === "th"
              ? "⬅️ ก่อนหน้า"
              : "⬅️ Trang trước",
        callback_data: `history:page:${page - 1}`,
      });
    }
    if (view === "all" && page + 1 < totalPages) {
      paginationButtons.push({
        text:
          language === "en"
            ? "Next ➡️"
            : language === "th"
              ? "ถัดไป ➡️"
              : "Trang sau ➡️",
        callback_data: `history:page:${page + 1}`,
      });
    }

    const historyModeButton =
      view === "recent"
        ? {
            text:
              language === "en"
                ? "📜 View all purchase history"
                : language === "th"
                  ? "📜 ดูประวัติการซื้อทั้งหมด"
                  : "📜 Xem toàn bộ lịch sử mua hàng",
            callback_data: "history:page:0",
          }
        : {
            text:
              language === "en"
                ? "🕘 Recent orders"
                : language === "th"
                  ? "🕘 คำสั่งซื้อล่าสุด"
                  : "🕘 Đơn hàng gần đây",
            callback_data: "home:history",
          };

    await this.editOrSend(
      token,
      chatId,
      messageId,
      this.buildOrderHistoryText(orders, language, usdtVndRate, {
        view,
        page,
        totalPages,
        totalOrders,
        startIndex: view === "all" ? pagination.skip : 0,
      }),
      {
        inline_keyboard: [
          ...orders
            .filter(
              (order) =>
                order.paymentTransaction?.provider ===
                  PaymentProvider.USDT_TRC20 &&
                order.paymentTransaction?.status === "PENDING",
            )
            .slice(0, 3)
            .map((order) => [
              {
                text:
                  language === "en"
                    ? `🧾 Send TX ${this.shortOrderCode(order.orderCode)}`
                    : language === "th"
                      ? `🧾 ส่ง TX ${this.shortOrderCode(order.orderCode)}`
                      : `🧾 Gửi TX ${this.shortOrderCode(order.orderCode)}`,
                callback_data: `txhash:submit:${order.paymentTransaction?.externalOrderCode}`,
              },
            ]),
          ...orders.map((order) => [
            {
              text: this.truncateLabel(
                `📦 ${order.orderCode} - ${this.localizeProductName(order.productNameSnapshot, language)} - ${this.formatBotMoney(decimalToNumber(order.totalSaleAmount), language, usdtVndRate)}`,
                62,
              ),
              callback_data: `history:order:${order.id}:0:${view === "all" ? page : -1}:new`,
            },
          ]),
          ...(paginationButtons.length > 0 ? [paginationButtons] : []),
          [
            this.buildNavTextBtn(
              custDataHistory,
              "wallet",
              "wallet",
              "home:wallet",
              language,
            ),
            this.buildNavTextBtn(
              custDataHistory,
              "products",
              "productsShort",
              "home:products",
              language,
            ),
          ],
          ...(isPro
            ? [
                [
                  this.buildNavTextBtn(
                    custDataHistory,
                    "warranty",
                    "warranty",
                    "home:warranty",
                    language,
                  ),
                  this.buildNavTextBtn(
                    custDataHistory,
                    "home",
                    "home",
                    "home:menu",
                    language,
                  ),
                ],
              ]
            : [
                [
                  this.buildNavTextBtn(
                    custDataHistory,
                    "home",
                    "home",
                    "home:menu",
                    language,
                  ),
                ],
              ]),
          [
            this.buildNavTextBtn(
              custDataHistory,
              "support",
              "supportShort",
              "home:support",
              language,
            ),
            historyModeButton,
          ],
        ],
      },
      actions,
    );
  }

  private async renderOrderHistoryDetail(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    telegramUserId: string,
    orderId: string,
    requestedDeliveryPage: number,
    historyPage: number,
    actions: unknown[],
    language: BotLanguage = "vi",
    sendAsNewMessage = false,
  ) {
    const [usdtVndRate, order, botConfig] = await Promise.all([
      this.getShopUsdtVndRate(shopId),
      this.prisma.order.findFirst({
        where: buildOwnedOrderWhere(shopId, telegramUserId, orderId),
        select: {
          id: true,
          orderCode: true,
          productNameSnapshot: true,
          quantity: true,
          totalSaleAmount: true,
          status: true,
          paymentStatus: true,
          createdAt: true,
          deliveredAccountText: true,
          isPreorder: true,
          preorderFeeAmount: true,
          preorderCancellationStatus: true,
          preorderCancelRequestedAt: true,
        },
      }),
      this.prisma.botConfig.findFirst({
        where: { shopId },
        select: { customizationJson: true },
      }),
    ]);
    const safeHistoryPage =
      Number.isFinite(historyPage) && historyPage >= 0
        ? Math.floor(historyPage)
        : -1;
    const backCallback =
      safeHistoryPage >= 0 ? `history:page:${safeHistoryPage}` : "home:history";

    if (!order) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "⚠️ Order not found or it does not belong to your Telegram account."
          : language === "th"
            ? "⚠️ ไม่พบคำสั่งซื้อหรือคำสั่งซื้อนี้ไม่ใช่ของบัญชี Telegram ของคุณ"
            : "⚠️ Không tìm thấy đơn hoặc đơn này không thuộc tài khoản Telegram của bạn.",
        {
          inline_keyboard: [
            [
              {
                text:
                  language === "en"
                    ? "⬅️ Back to history"
                    : language === "th"
                      ? "⬅️ กลับไปที่ประวัติ"
                      : "⬅️ Về lịch sử",
                callback_data: backCallback,
              },
            ],
          ],
        },
        actions,
      );
      return;
    }

    const customization = await this.resolveEffectiveCustomization(
      shopId,
      (botConfig?.customizationJson as Record<string, unknown> | null) ?? null,
    );
    const messageEmojiIds =
      customization.messageEmojiIds &&
      typeof customization.messageEmojiIds === "object"
        ? (customization.messageEmojiIds as Record<string, unknown>)
        : {};
    const orderDetailIcons: Array<[string, string]> = [
      ["orderDetailTitle", "\u{1F4CB}"],
      ["orderDetailCode", "\u{1F9FE}"],
      ["orderDetailProduct", "\u{1F4E6}"],
      ["orderDetailQuantity", "\u{1F522}"],
      ["orderDetailAmount", "\u{1F4B5}"],
      ["orderDetailStatus", "\u{1F3AF}"],
      ["orderDetailTime", "\u{1F558}"],
      ["orderDetailDelivered", "\u{1F510}"],
    ];
    const applyOrderDetailCustomEmojis = (html: string) => {
      let rendered = html;
      for (const [key, fallback] of orderDetailIcons) {
        const emojiId = String(messageEmojiIds[key] ?? "").trim();
        if (/^\d+$/.test(emojiId)) {
          rendered = rendered
            .split(fallback)
            .join(`<tg-emoji emoji-id="${emojiId}">${fallback}</tg-emoji>`);
        }
      }
      return rendered;
    };

    const deliveryChunks = splitTelegramText(order.deliveredAccountText);
    const deliveryPagination = resolveOrderHistoryPage(
      requestedDeliveryPage,
      deliveryChunks.length,
      1,
    );
    const deliveryText = deliveryChunks[deliveryPagination.page] || null;
    const detailLines = [
      language === "en"
        ? "📋 <b>ORDER DETAILS</b>"
        : language === "th"
          ? "📋 <b>รายละเอียดคำสั่งซื้อ</b>"
          : "📋 <b>CHI TIẾT ĐƠN HÀNG</b>",
      "",
      language === "en"
        ? `🧾 Order: <code>${this.escapeHtml(order.orderCode)}</code>`
        : language === "th"
          ? `🧾 คำสั่งซื้อ: <code>${this.escapeHtml(order.orderCode)}</code>`
          : `🧾 Mã đơn: <code>${this.escapeHtml(order.orderCode)}</code>`,
      language === "en"
        ? `📦 Product: ${this.escapeHtml(this.truncateLabel(this.localizeProductName(order.productNameSnapshot, language), 120))}`
        : language === "th"
          ? `📦 สินค้า: ${this.escapeHtml(this.truncateLabel(this.localizeProductName(order.productNameSnapshot, language), 120))}`
          : `📦 Sản phẩm: ${this.escapeHtml(this.truncateLabel(this.localizeProductName(order.productNameSnapshot, language), 120))}`,
      language === "en"
        ? `🔢 Quantity: ${order.quantity}`
        : language === "th"
          ? `🔢 จำนวน: ${order.quantity}`
          : `🔢 Số lượng: ${order.quantity}`,
      language === "en"
        ? `💵 Amount: ${this.formatBotMoney(decimalToNumber(order.totalSaleAmount), language, usdtVndRate)}`
        : language === "th"
          ? `💵 ยอดเงิน: ${this.formatBotMoney(decimalToNumber(order.totalSaleAmount), language, usdtVndRate)}`
          : `💵 Thành tiền: ${this.formatBotMoney(decimalToNumber(order.totalSaleAmount), language, usdtVndRate)}`,
      language === "en"
        ? `🎯 Status: ${this.escapeHtml(this.formatCustomerOrderStatus(order.status, order.paymentStatus, language))}`
        : language === "th"
          ? `🎯 สถานะ: ${this.escapeHtml(this.formatCustomerOrderStatus(order.status, order.paymentStatus, language))}`
          : `🎯 Trạng thái: ${this.escapeHtml(this.formatCustomerOrderStatus(order.status, order.paymentStatus, language))}`,
      ...(order.preorderCancellationStatus === "REQUESTED"
        ? [
            language === "en"
              ? "⏳ Cancellation request: waiting for seller review"
              : language === "th"
                ? "⏳ คำขอยกเลิก: รอผู้ขายตรวจสอบ"
                : "⏳ Yêu cầu hủy: đang chờ seller duyệt",
          ]
        : []),
      language === "en"
        ? `🕘 Time: ${this.formatDateTime(order.createdAt)}`
        : language === "th"
          ? `🕘 เวลา: ${this.formatDateTime(order.createdAt)}`
          : `🕘 Thời gian: ${this.formatDateTime(order.createdAt)}`,
      "",
      deliveryText
        ? language === "en"
          ? `🔐 <b>Delivered account (${deliveryPagination.page + 1}/${deliveryPagination.totalPages}):</b>`
          : language === "th"
            ? `🔐 <b>บัญชีที่จัดส่ง (${deliveryPagination.page + 1}/${deliveryPagination.totalPages}):</b>`
            : `🔐 <b>Tài khoản đã giao (${deliveryPagination.page + 1}/${deliveryPagination.totalPages}):</b>`
        : language === "en"
          ? "🔐 No account has been delivered for this order yet."
          : language === "th"
            ? "🔐 ยังไม่มีบัญชีที่จัดส่งสำหรับคำสั่งซื้อนี้"
            : "🔐 Đơn này chưa có tài khoản được giao.",
      ...(deliveryText ? [`<pre>${this.escapeHtml(deliveryText)}</pre>`] : []),
    ];
    const detailPaginationButtons: Array<{
      text: string;
      callback_data: string;
    }> = [];
    if (deliveryText && deliveryPagination.page > 0) {
      detailPaginationButtons.push({
        text:
          language === "en"
            ? "⬅️ Previous account page"
            : language === "th"
              ? "⬅️ หน้าบัญชีก่อนหน้า"
              : "⬅️ Tài khoản trước",
        callback_data: `history:order:${order.id}:${deliveryPagination.page - 1}:${safeHistoryPage}`,
      });
    }
    if (
      deliveryText &&
      deliveryPagination.page + 1 < deliveryPagination.totalPages
    ) {
      detailPaginationButtons.push({
        text:
          language === "en"
            ? "Next account page ➡️"
            : language === "th"
              ? "หน้าบัญชีถัดไป ➡️"
              : "Tài khoản sau ➡️",
        callback_data: `history:order:${order.id}:${deliveryPagination.page + 1}:${safeHistoryPage}`,
      });
    }

    const detailMarkup = {
      inline_keyboard: [
        ...(order.isPreorder &&
        order.status === "PAID_WAITING_STOCK" &&
        order.paymentStatus === "PAID" &&
        order.preorderCancellationStatus !== "REQUESTED"
          ? [
              [
                {
                  text:
                    language === "en"
                      ? "❌ Request cancellation"
                      : language === "th"
                        ? "❌ ขอยกเลิก"
                        : "❌ Yêu cầu hủy",
                  callback_data: `preorder:cancel:prompt:${order.id}`,
                },
              ],
            ]
          : []),
        ...(detailPaginationButtons.length > 0
          ? [detailPaginationButtons]
          : []),
        [
          {
            text:
              language === "en"
                ? "⬅️ Back to history"
                : language === "th"
                  ? "⬅️ กลับไปที่ประวัติ"
                  : "⬅️ Về lịch sử",
            callback_data: backCallback,
          },
        ],
        [this.navBtn("home", language, "home:menu")],
      ],
    };
    const detailHtml = applyOrderDetailCustomEmojis(detailLines.join("\n"));
    if (sendAsNewMessage) {
      await this.sendText(
        token,
        chatId,
        detailHtml,
        actions,
        detailMarkup,
        "HTML",
      );
    } else {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        detailHtml,
        detailMarkup,
        actions,
        "HTML",
      );
    }
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
    const [usdtVndRate, summary, custDataWallet] = await Promise.all([
      this.getShopUsdtVndRate(shopId),
      this.customerWalletService.getWalletSummaryForTelegram(
        shopId,
        telegramUserId,
      ),
      this.loadCustData(shopId),
    ]);

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
          [
            {
              text:
                language === "en"
                  ? "🏦 Top up wallet"
                  : language === "th"
                    ? "🏦 เติมเงินกระเป๋า"
                    : "🏦 Nạp vào ví",
              callback_data: "wallet:topup",
            },
          ],
          [
            {
              text:
                language === "en"
                  ? "📋 Balance history"
                  : language === "th"
                    ? "📋 ประวัติยอดเงิน"
                    : "📋 Lịch sử biến động",
              callback_data: "wallet:ledger",
            },
          ],
          ...paymentRows,
          [
            this.buildNavTextBtn(
              custDataWallet,
              "orders",
              "history",
              "home:history",
              language,
            ),
            this.buildNavTextBtn(
              custDataWallet,
              "products",
              "productsShort",
              "home:products",
              language,
            ),
          ],
          [
            this.buildNavTextBtn(
              custDataWallet,
              "home",
              "home",
              "home:menu",
              language,
            ),
            this.buildNavTextBtn(
              custDataWallet,
              "support",
              "supportShort",
              "home:support",
              language,
            ),
          ],
        ],
      },
      actions,
    );
  }

  private walletLedgerLabel(
    type: string,
    language: BotLanguage,
  ): { icon: string; label: string } {
    const map: Record<
      string,
      { icon: string; vi: string; en: string; th: string }
    > = {
      TOPUP: { icon: "🟢", vi: "Nạp ví", en: "Top-up", th: "เติมเงิน" },
      TOPUP_BONUS: {
        icon: "🎁",
        vi: "Thưởng nạp",
        en: "Top-up bonus",
        th: "โบนัสเติมเงิน",
      },
      SPEND_ORDER: {
        icon: "🛒",
        vi: "Mua hàng",
        en: "Purchase",
        th: "ซื้อสินค้า",
      },
      REFUND_ORDER: {
        icon: "↩️",
        vi: "Hoàn tiền",
        en: "Refund",
        th: "คืนเงิน",
      },
      AFFILIATE_COMMISSION: {
        icon: "💸",
        vi: "Hoa hồng",
        en: "Commission",
        th: "ค่าคอมมิชชั่น",
      },
      ADJUST: { icon: "⚙️", vi: "Điều chỉnh", en: "Adjustment", th: "ปรับยอด" },
    };
    const m = map[type];
    if (!m) return { icon: "•", label: type };
    return {
      icon: m.icon,
      label: language === "en" ? m.en : language === "th" ? m.th : m.vi,
    };
  }

  private async renderWalletLedger(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    telegramUserId: string,
    actions: unknown[],
    language: BotLanguage = "vi",
    requestedPage = 0,
  ) {
    const pageSize = 15;
    const page =
      Number.isInteger(requestedPage) && requestedPage >= 0 ? requestedPage : 0;
    const [usdtVndRate, entries] = await Promise.all([
      this.getShopUsdtVndRate(shopId),
      this.customerWalletService.getWalletLedgerForTelegram(
        shopId,
        telegramUserId,
        pageSize + 1,
        page * pageSize,
      ),
    ]);
    const hasNextPage = entries.length > pageSize;
    const visibleEntries = entries.slice(0, pageSize);

    const title =
      language === "en"
        ? "📋 Wallet balance history"
        : language === "th"
          ? "📋 ประวัติยอดกระเป๋าเงิน"
          : "📋 Lịch sử biến động ví";
    const lines: string[] = [title];

    if (visibleEntries.length === 0) {
      lines.push(
        "",
        language === "en"
          ? "No movements yet."
          : language === "th"
            ? "ยังไม่มีการเปลี่ยนแปลง"
            : "Chưa có biến động nào.",
      );
    } else {
      // Pre-format amounts to find the column width (right-aligned in a monospace block).
      const rows = visibleEntries.map((e) => {
        const { icon, label } = this.walletLedgerLabel(e.type, language);
        const sign = e.amount >= 0 ? "+" : "−";
        const amtStr = `${sign}${this.formatBotMoney(Math.abs(e.amount), language, usdtVndRate)}`;
        return { createdAt: e.createdAt, icon, label, amtStr };
      });
      const maxW = rows.reduce((m, r) => Math.max(m, r.amtStr.length), 0);
      const now = new Date();
      const dayKey = (d: Date) =>
        `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const todayKey = dayKey(now);
      const yesterdayKey = dayKey(new Date(now.getTime() - 86400000));

      let lastDay = "";
      for (const r of rows) {
        const d = new Date(r.createdAt);
        const k = dayKey(d);
        if (k !== lastDay) {
          lastDay = k;
          const ddmm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
          const dayLabel =
            k === todayKey
              ? language === "en"
                ? `Today ${ddmm}`
                : language === "th"
                  ? `วันนี้ ${ddmm}`
                  : `Hôm nay ${ddmm}`
              : k === yesterdayKey
                ? language === "en"
                  ? `Yesterday ${ddmm}`
                  : language === "th"
                    ? `เมื่อวาน ${ddmm}`
                    : `Hôm qua ${ddmm}`
                : ddmm;
          lines.push("", `── ${dayLabel} ──`);
        }
        lines.push(
          `<code>${this.escapeHtml(r.amtStr.padStart(maxW, " "))}</code>  ${r.icon} ${r.label}`,
        );
      }
    }

    if (page > 0 || hasNextPage) {
      lines.push(
        "",
        language === "en"
          ? `Page ${page + 1}`
          : language === "th"
            ? `หน้า ${page + 1}`
            : `Trang ${page + 1}`,
      );
    }

    const paginationRow: Array<{ text: string; callback_data: string }> = [];
    if (page > 0) {
      paginationRow.push({
        text:
          language === "en"
            ? "⬅️ Previous"
            : language === "th"
              ? "⬅️ ก่อนหน้า"
              : "⬅️ Trang trước",
        callback_data: `wallet:ledger:page:${page - 1}`,
      });
    }
    if (hasNextPage) {
      paginationRow.push({
        text:
          language === "en"
            ? "Next ➡️"
            : language === "th"
              ? "ถัดไป ➡️"
              : "Trang sau ➡️",
        callback_data: `wallet:ledger:page:${page + 1}`,
      });
    }

    await this.editOrSend(
      token,
      chatId,
      messageId,
      lines.join("\n"),
      {
        inline_keyboard: [
          ...(paginationRow.length > 0 ? [paginationRow] : []),
          [
            {
              text: this.buttonLabel("back", language),
              callback_data: "home:wallet",
            },
          ],
        ],
      },
      actions,
      "HTML",
    );
  }

  private async promptWalletTopupCurrency(
    shopId: string,
    token: string,
    chatId: number,
    messageId: number | undefined,
    telegramUserId: string,
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    const providers = await this.getAvailablePaymentProviders(shopId);
    const cryptoProviders = providers.filter(
      (provider) =>
        provider === PaymentProvider.USDT_TRC20 ||
        provider === PaymentProvider.USDT_BEP20 ||
        provider === PaymentProvider.USDT_SOL ||
        provider === PaymentProvider.USDT_TON,
    );
    const hasUsdt = cryptoProviders.length > 0;
    const hasVnd = providers.some(
      (p) =>
        p === PaymentProvider.PAYOS ||
        p === PaymentProvider.PAY2S ||
        p === PaymentProvider.WEB2M ||
        p === PaymentProvider.MOCK,
    );

    if (!hasVnd && !hasUsdt) {
      await this.clearPendingWalletTopup(shopId, telegramUserId);
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "This shop has no available wallet top-up method."
          : language === "th"
            ? "ร้านค้ายังไม่มีวิธีเติมเงินที่พร้อมใช้งาน"
            : "Shop chưa có phương thức nạp ví khả dụng.",
        {
          inline_keyboard: [[this.navBtn("back", language, "home:wallet")]],
        },
        actions,
      );
      return;
    }

    // If only one option, skip selection and go straight to amount
    if (cryptoProviders.length === 1 && !hasVnd) {
      const provider = cryptoProviders[0] as
        | "USDT_TRC20"
        | "USDT_BEP20"
        | "USDT_SOL"
        | "USDT_TON";
      await this.sessions.setPendingSession(
        "pendingWalletTopups",
        this.sessions.getPendingQuantityKey(shopId, telegramUserId),
        {
          currency: "USDT",
          provider,
          expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs,
        },
        this.sessions.pendingQuantityTtlMs,
      );
      return this.promptWalletTopupAmount(
        shopId,
        token,
        chatId,
        telegramUserId,
        actions,
        "USDT",
        undefined,
        language,
        provider,
      );
    }
    if (!hasUsdt) {
      await this.sessions.setPendingSession(
        "pendingWalletTopups",
        this.sessions.getPendingQuantityKey(shopId, telegramUserId),
        {
          currency: "VND",
          expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs,
        },
        this.sessions.pendingQuantityTtlMs,
      );
      return this.promptWalletTopupAmount(
        shopId,
        token,
        chatId,
        telegramUserId,
        actions,
        "VND",
        undefined,
        language,
      );
    }

    const shopDataTopup = await this.shopsService.getSellerShopByShopId(shopId);
    const shopCustTopup = await this.resolveCustomization(
      (shopDataTopup.botConfig?.customizationJson as Record<
        string,
        unknown
      > | null) ?? null,
    );
    const walletNoteMapTopup = (shopCustTopup as Record<string, unknown> | null)
      ?.walletNote as Record<string, string> | undefined;
    const walletNoteTopup = (
      walletNoteMapTopup?.[language] ||
      walletNoteMapTopup?.["vi"] ||
      ""
    ).trim();

    const promptLine =
      language === "en"
        ? "💳 Choose top-up currency:"
        : language === "th"
          ? "💳 เลือกสกุลเงินที่ต้องการเติม:"
          : "💳 Chọn loại tiền muốn nạp:";
    const text = walletNoteTopup
      ? `${walletNoteTopup}\n\n${promptLine}`
      : promptLine;
    const paymentRows: Array<Array<{ text: string; callback_data: string }>> =
      [];
    if (hasVnd)
      paymentRows.push([
        { text: "🏦 VND (chuyển khoản)", callback_data: "wallet:topup:vnd" },
      ]);
    if (providers.includes(PaymentProvider.USDT_TRC20)) {
      paymentRows.push([
        { text: "💲 USDT (TRC20)", callback_data: "wallet:topup:usd" },
      ]);
    }
    if (providers.includes(PaymentProvider.USDT_BEP20)) {
      paymentRows.push([
        { text: "💛 USDT (BEP20)", callback_data: "wallet:topup:bep20" },
      ]);
    }
    if (providers.includes(PaymentProvider.USDT_SOL)) {
      paymentRows.push([
        { text: "💎 USDT (Solana)", callback_data: "wallet:topup:sol" },
      ]);
    }
    if (providers.includes(PaymentProvider.USDT_TON)) {
      paymentRows.push([
        { text: "💎 USDT (TON)", callback_data: "wallet:topup:ton" },
      ]);
    }

    await this.editOrSend(
      token,
      chatId,
      messageId,
      text,
      {
        inline_keyboard: [
          ...paymentRows,
          [
            {
              text: this.buttonLabel("back", language),
              callback_data: "home:wallet",
            },
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
    currency: "VND" | "USDT" = "VND",
    leadLine?: string,
    language: BotLanguage = "vi",
    provider:
      | "USDT_TRC20"
      | "USDT_BEP20"
      | "USDT_SOL"
      | "USDT_TON" = "USDT_TRC20",
  ) {
    const isUsdt = currency === "USDT";
    const networkName =
      provider === "USDT_TON"
        ? "TON"
        : provider === "USDT_SOL"
          ? "Solana"
          : provider === "USDT_BEP20"
            ? "BEP20 (BSC)"
            : "TRC20";
    const promptText = isUsdt
      ? language === "en"
        ? [
            leadLine || "💲 Enter USDT amount to top up",
            "Example: 10 or 5.5",
            "",
            `The bot will show the ${networkName} wallet address to send to.`,
          ].join("\n")
        : language === "th"
          ? [
              leadLine || "💲 ระบุจำนวน USDT ที่ต้องการเติม",
              "ตัวอย่าง: 10 หรือ 5.5",
              "",
              "บอทจะสร้างที่อยู่กระเป๋า TRC20 ให้โอนไป",
            ].join("\n")
          : [
              leadLine || "💲 Nhập số USDT muốn nạp vào ví",
              "Ví dụ: 10 hoặc 5.5",
              "",
              `Bot sẽ hiển thị địa chỉ ví ${networkName} để bạn chuyển tới.`,
            ].join("\n")
      : language === "en"
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
            ].join("\n");

    await this.sendText(token, chatId, promptText, actions, {
      inline_keyboard: [
        [
          {
            text: this.buttonLabel("back", language),
            callback_data: "wallet:topup",
          },
        ],
      ],
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
    await this.clearPendingTxHashSubmission(shopId, customer.telegramUserId);
    const product = await this.getCatalogItemForTelegram(
      shopId,
      sourceProductId,
      language,
    );

    const pendingOrder = await this.prisma.order.findFirst({
      where: {
        shopId,
        customer: { telegramUserId: customer.telegramUserId },
        status: "AWAITING_PAYMENT",
      },
      select: { id: true, orderCode: true },
    });

    if (pendingOrder) {
      const msg =
        language === "en"
          ? `⚠️ You have an unpaid order (<code>${pendingOrder.orderCode}</code>).\nPlease pay or cancel it before creating a new one.`
          : language === "th"
            ? `⚠️ คุณมีคำสั่งซื้อที่ยังไม่ได้ชำระเงิน (<code>${pendingOrder.orderCode}</code>)\nกรุณาชำระเงินหรือยกเลิกก่อนสร้างคำสั่งซื้อใหม่`
            : `⚠️ Bạn đang có 1 đơn hàng chờ thanh toán (<code>${pendingOrder.orderCode}</code>).\nVui lòng thanh toán hoặc Hủy đơn cũ trước khi tạo đơn mới.`;
      
      await this.sendText(token, customer.telegramChatId, msg, actions, {
        inline_keyboard: [
          [{ text: "❌ Hủy đơn cũ", callback_data: `order:cancel:${pendingOrder.id}` }]
        ],
      });
      return;
    }

    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    // Use physical stock minus held stock
    const holdKey = `stock:hold:${shopId}:${sourceProductId}`;
    const holdCount = Number(await this.cache.get(holdKey)) || 0;
    const availableForNewOrder = product.available !== null ? Math.max(0, product.available - holdCount) : null;
    const isPreorderOnly =
      product.preorderEnabled &&
      availableForNewOrder !== null &&
      availableForNewOrder <= 0;
    const maxQuantity = isPreorderOnly
      ? 100
      : this.getMaxQuantity(availableForNewOrder);

    if (maxQuantity !== null && maxQuantity < 1) {
      const msg =
        language === "en"
          ? "⚠️ This product is out of stock."
          : language === "th"
            ? "⚠️ สินค้านี้หมดชั่วคราว"
            : "⚠️ Sản phẩm hiện đã hết hàng.";

      await this.sendText(token, customer.telegramChatId, msg, actions, {
        inline_keyboard: [
          [
            {
              text: "🔔 Nhận thông báo Restock",
              callback_data: `restock:sub:${sourceProductId}`,
            },
          ],
          [this.navBtn("back", language, "home:products")],
        ],
      });
      return;
    }

    const [customerRecord, ctvApiKey, downstreamConn] = await Promise.all([
      this.prisma.customer.findUnique({
        where: {
          shopId_telegramUserId: {
            shopId,
            telegramUserId: customer.telegramUserId,
          },
        },
        select: { isCtv: true, discountPercent: true },
      }),
      this.prisma.internalSourceApiKey.findFirst({
        where: {
          shopId,
          telegramChatId: String(customer.telegramChatId),
          status: "ACTIVE",
        },
        select: { id: true },
      }),
      this.prisma.downstreamSourceConnection.findFirst({
        where: {
          upstreamShopId: shopId,
          downstreamTelegramChatId: String(customer.telegramChatId),
          status: "ACTIVE",
        },
        select: { id: true },
      }),
    ]);
    const { isCtv, getEffectivePrice } = this.buildCtvPricing(
      customerRecord,
      ctvApiKey,
      downstreamConn,
    );
    const ctvPrice = isCtv ? getEffectivePrice(product) : null;

    await this.sendQuantityReplyPrompt(
      shopId,
      token,
      customer.telegramChatId,
      customer.telegramUserId,
      {
        sourceProductId,
        displayName: product.displayName,
        sourceName: product.sourceName ?? null,
        salePrice: ctvPrice ?? product.salePrice,
        salePriceUsd: ctvPrice != null ? null : (product.salePriceUsd ?? null),
        available: availableForNewOrder,
        maxQuantity,
        imageUrl: product.imageUrl ?? null,
        description: product.description ?? null,
        providerDescription: product.providerDescription ?? null,
        sourceDescriptionLocked: product.sourceDescriptionLocked,
        soldCount: product.soldCount ?? null,
        deliveryFormatHint: product.deliveryFormatHint ?? null,
        iconCustomEmojiId: product.iconCustomEmojiId ?? null,
        promoBanner: this.getActivePromoBanner(product, language),
        promoMessage: product.promoText?.trim() || null,
        promoType: product.promoType ?? null,
        promoBuyN: product.promoBuyN ?? null,
        promoGetM: product.promoGetM ?? null,
        promoPriceTiers:
          ctvPrice == null ? (product.promoPriceTiers ?? []) : [],
        promoBulkMinQty: product.promoBulkMinQty ?? null,
        promoBulkDiscountPct: product.promoBulkDiscountPct ?? null,
        promoStartAt: product.promoStartAt ?? null,
        promoEndAt: product.promoEndAt ?? null,
        requiresCustomerEmail: product.requiresCustomerEmail,
        preorderEnabled: product.preorderEnabled,
        preorderFeePercent: product.preorderFeePercent,
        isPreorderOnly,
      },
      actions,
      undefined,
      language,
      usdtVndRate,
    );
  }

  /**
   * When the seller's plan has lapsed to FREE, customers can still browse the catalog but cannot
   * create orders. Returns true (and notifies the customer) when ordering is blocked, so callers
   * should `return` immediately. Covers every order-creation path (handleBuy + handleBuyWithWallet).
   */
  private async blockIfFreeTier(
    shopId: string,
    token: string,
    chatId: string | number,
    language: BotLanguage,
    actions: unknown[],
  ): Promise<boolean> {
    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    if (shop.seller?.tier !== SellerTier.FREE) return false;
    const msg =
      language === "en"
        ? "⚠️ This shop is temporarily not accepting orders. Please contact the shop/admin."
        : language === "th"
          ? "⚠️ ขณะนี้ร้านยังไม่รับคำสั่งซื้อ กรุณาติดต่อร้าน/แอดมิน"
          : "⚠️ Shop hiện tạm ngưng nhận đơn. Vui lòng liên hệ shop/admin.";
    await this.sendText(token, chatId, msg, actions);
    return true;
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
      customerEmail?: string | null;
    },
    actions: unknown[],
    paymentProvider?: PaymentProvider,
    language: BotLanguage = "vi",
  ) {
    if (
      await this.blockIfFreeTier(
        shopId,
        token,
        customer.telegramChatId,
        language,
        actions,
      )
    )
      return;

    await this.clearPendingQuantitySelection(shopId, customer.telegramUserId);
    await this.clearPendingPaymentSelection(shopId, customer.telegramUserId);
    await this.clearPendingTxHashSubmission(shopId, customer.telegramUserId);

    const product = await this.prisma.sourceProduct.findUnique({
      where: { id: sourceProductId },
      select: { available: true, preorderEnabled: true },
    });
    const maxAvailable = product?.available ?? null;
    let stockHeld = false;
    const holdKey = `stock:hold:${shopId}:${sourceProductId}`;

    if (
      shouldHoldStockForCheckout({
        available: maxAvailable,
        requestedQuantity: quantity,
        preorderEnabled: product?.preorderEnabled === true,
      })
    ) {
      stockHeld = await this.cache.holdStockAtomic(holdKey, maxAvailable ?? 0, quantity);
      if (!stockHeld) {
        const msg =
          language === "en"
            ? "⚠️ Out of stock. Someone else just bought it."
            : language === "th"
              ? "⚠️ สินค้าหมด มีคนอื่นซื้อไปแล้ว"
              : "⚠️ Hết hàng. Vừa có người khác nhanh tay mua trước.";
        await this.sendText(token, customer.telegramChatId, msg, actions);
        return;
      }
    }

    let created;
    try {
      created = await this.ordersService.createTelegramOrder({
      shopId,
      sourceProductId,
      quantity,
      telegramUserId: customer.telegramUserId,
      telegramChatId: customer.telegramChatId,
      telegramUsername: customer.telegramUsername,
      firstName: customer.firstName,
      lastName: customer.lastName,
      customerEmail: customer.customerEmail,
      paymentProvider,
    });
    } catch (error) {
      if (stockHeld) {
        await this.cache.releaseStockAtomic(holdKey, quantity);
      }
      throw error;
    }

    const usdtVndRate = await this.getShopUsdtVndRate(shopId);
    const shop = await this.shopsService.getSellerShopByShopId(shopId);
    const shopCustBuy = await this.resolveCustomization(
      (shop.botConfig?.customizationJson as Record<string, unknown> | null) ??
        null,
    );
    const custEmojiIdsBuy =
      shopCustBuy?.buttonEmojiIds &&
      typeof shopCustBuy.buttonEmojiIds === "object"
        ? (shopCustBuy.buttonEmojiIds as Record<string, string>)
        : {};
    const custDataBuy = {
      custEmojis:
        shopCustBuy?.buttonEmojis &&
        typeof shopCustBuy.buttonEmojis === "object"
          ? (shopCustBuy.buttonEmojis as Record<string, string>)
          : {},
      custLabels:
        shopCustBuy?.buttonLabels &&
        typeof shopCustBuy.buttonLabels === "object"
          ? (shopCustBuy.buttonLabels as Record<string, Record<string, string>>)
          : {},
      custEmojiIds: custEmojiIdsBuy,
    };
    const msgEmojiIdsBuy =
      shopCustBuy?.messageEmojiIds &&
      typeof shopCustBuy.messageEmojiIds === "object"
        ? (shopCustBuy.messageEmojiIds as Record<string, string>)
        : {};
    const isPublicCheckoutUrl = this.isPublicCheckoutUrl(created.checkoutUrl);
    // Prefer the branded VietQR (img.vietqr.io — same look as PayOS); fall back to a
    // provider-supplied ready base64 QR (PAY2S), then to a generic QR image URL.
    let qrBuffer = created.bankInfo
      ? await this.downloadVietQrAsBuffer(
          created.bankInfo,
          created.order.totalSaleAmount,
        )
      : null;
    if (!qrBuffer) qrBuffer = this.decodeDataUriToBuffer(created.qrCode);
    const qrFallbackUrl = qrBuffer
      ? null
      : this.buildQrImageUrl(created.qrCode);
    const hasQr = qrBuffer !== null || qrFallbackUrl !== null;
    const paymentLines = this.buildOrderPaymentLines(
      created,
      language,
      usdtVndRate,
      created.isManualNoDelivery && !created.isAddMail,
      shop.supportTelegram,
      shop.supportZalo,
      msgEmojiIdsBuy,
    );
    // When QR is shown, hide the checkout URL button — customer should scan directly
    const isPremiumBuy = await this.resolveCanBling(shopId);
    const baseInlineKeyboard = this.buildPostPaymentInlineKeyboard(
      created,
      language,
      hasQr ? false : isPublicCheckoutUrl,
      custDataBuy,
      isPremiumBuy,
    );
    const inlineKeyboard =
      created.isManualNoDelivery && !created.isAddMail && shop.supportTelegram
        ? [
            [
              {
                text: this.buttonLabel("contactAdmin", language),
                url: `https://t.me/${shop.supportTelegram.replace(/^@/, "")}`,
              },
            ],
            ...baseInlineKeyboard,
          ]
        : baseInlineKeyboard;

    if (qrBuffer || qrFallbackUrl) {
      const sentMsgId = await this.sendPhoto(
        token,
        customer.telegramChatId,
        qrBuffer ?? qrFallbackUrl!,
        paymentLines.join("\n"),
        actions,
        { inline_keyboard: inlineKeyboard },
        "HTML",
      );
      if (sentMsgId && created.order.paymentTransaction?.externalOrderCode) {
        await this.prisma.paymentTransaction
          .update({
            where: {
              externalOrderCode:
                created.order.paymentTransaction.externalOrderCode,
            },
            data: { qrTelegramMessageId: sentMsgId },
          })
          .catch(() => undefined);
      }
      return;
    }

    const sentResult = (await this.sendText(
      token,
      customer.telegramChatId,
      paymentLines.join("\n"),
      actions,
      {
        inline_keyboard: inlineKeyboard,
      },
      "HTML",
    )) as { message_id?: number } | undefined;
    if (
      sentResult?.message_id &&
      created.order.paymentTransaction?.externalOrderCode
    ) {
      await this.prisma.paymentTransaction
        .update({
          where: {
            externalOrderCode:
              created.order.paymentTransaction.externalOrderCode,
          },
          data: { qrTelegramMessageId: sentResult.message_id },
        })
        .catch(() => undefined);
    }
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
      customerEmail?: string | null;
    },
    actions: unknown[],
    language: BotLanguage = "vi",
  ) {
    if (
      await this.blockIfFreeTier(
        shopId,
        token,
        customer.telegramChatId,
        language,
        actions,
      )
    )
      return;

    await this.clearPendingQuantitySelection(shopId, customer.telegramUserId);
    await this.clearPendingPaymentSelection(shopId, customer.telegramUserId);
    await this.clearPendingTxHashSubmission(shopId, customer.telegramUserId);

    const product = await this.prisma.sourceProduct.findUnique({
      where: { id: sourceProductId },
      select: { available: true, preorderEnabled: true },
    });
    const maxAvailable = product?.available ?? null;
    let stockHeld = false;
    const holdKey = `stock:hold:${shopId}:${sourceProductId}`;

    if (
      shouldHoldStockForCheckout({
        available: maxAvailable,
        requestedQuantity: quantity,
        preorderEnabled: product?.preorderEnabled === true,
      })
    ) {
      stockHeld = await this.cache.holdStockAtomic(holdKey, maxAvailable ?? 0, quantity);
      if (!stockHeld) {
        const msg =
          language === "en"
            ? "⚠️ Out of stock. Someone else just bought it."
            : language === "th"
              ? "⚠️ สินค้าหมด มีคนอื่นซื้อไปแล้ว"
              : "⚠️ Hết hàng. Vừa có người khác nhanh tay mua trước.";
        await this.sendText(token, customer.telegramChatId, msg, actions);
        return;
      }
    }

    let created;
    try {
      created = await this.ordersService.createTelegramOrderWithWallet({
      shopId,
      sourceProductId,
      quantity,
      telegramUserId: customer.telegramUserId,
      telegramChatId: customer.telegramChatId,
      telegramUsername: customer.telegramUsername,
      firstName: customer.firstName,
      customerEmail: customer.customerEmail,
    });
    } catch (error) {
      if (stockHeld) {
        await this.cache.releaseStockAtomic(holdKey, quantity);
      }
      throw error;
    }

    const [usdtVndRate, shop, custDataWalletBuy] = await Promise.all([
      this.getShopUsdtVndRate(shopId),
      this.shopsService.getSellerShopByShopId(shopId),
      this.loadCustData(shopId),
    ]);
    const supportTelegram = shop.supportTelegram || null;
    const supportZalo = shop.supportZalo || null;

    const manualContactLines: string[] = created.isAddMail
      ? [
          "",
          language === "en"
            ? "⏳ Your order is being activated manually. The submitted email has been recorded."
            : language === "th"
              ? "⏳ ระบบได้รับอีเมลแล้ว และผู้ขายกำลังดำเนินการเปิดใช้งานบัญชี"
              : "⏳ Đơn hàng đang được seller xử lý kích hoạt thủ công. Email bạn đã nhập đã được ghi nhận.",
        ]
      : created.isManualNoDelivery
        ? [
            "",
            language === "en"
              ? "✅ Payment received. Please send your email to admin to upgrade your account:"
              : language === "th"
                ? "✅ ได้รับการชำระเงินแล้ว กรุณาส่งอีเมลให้แอดมินเพื่ออัปเกรดบัญชี:"
                : "✅ Đã nhận thanh toán. Gửi email của bạn cho admin để được nâng cấp chính chủ:",
            ...(supportTelegram ? [`Telegram: ${supportTelegram}`] : []),
            ...(supportZalo ? [`Zalo: ${supportZalo}`] : []),
            ...(!supportTelegram && !supportZalo
              ? [
                  language === "en"
                    ? "Please contact the shop admin."
                    : language === "th"
                      ? "กรุณาติดต่อแอดมินร้าน"
                      : "Vui lòng liên hệ admin shop.",
                ]
              : []),
          ]
        : [
            "",
            language === "en"
              ? "The system is processing your order now."
              : language === "th"
                ? "ระบบกำลังดำเนินการคำสั่งซื้อของคุณ"
                : "Hệ thống đang xử lý đơn hàng của bạn.",
          ];

    await this.sendText(
      token,
      customer.telegramChatId,
      [
        language === "en"
          ? "✅ Wallet payment successful"
          : language === "th"
            ? "✅ ชำระเงินด้วยกระเป๋าเงินสำเร็จ"
            : "✅ Thanh toán bằng ví thành công",
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
        ...manualContactLines,
      ].join("\n"),
      actions,
      {
        inline_keyboard: [
          ...(created.isManualNoDelivery &&
          !created.isAddMail &&
          supportTelegram
            ? [
                [
                  {
                    text: this.buttonLabel("contactAdmin", language),
                    url: `https://t.me/${supportTelegram.replace(/^@/, "")}`,
                  },
                ],
              ]
            : []),
          [
            this.buildNavTextBtn(
              custDataWalletBuy,
              "orders",
              "history",
              "home:history",
              language,
            ),
            this.buildNavTextBtn(
              custDataWalletBuy,
              "wallet",
              "wallet",
              "home:wallet",
              language,
            ),
          ],
          [
            this.buildNavTextBtn(
              custDataWalletBuy,
              "products",
              "productsShort",
              "home:products",
              language,
            ),
            this.buildNavTextBtn(
              custDataWalletBuy,
              "home",
              "home",
              "home:menu",
              language,
            ),
          ],
        ],
      },
    );
  }

  private buildPostPaymentInlineKeyboard(
    created: {
      order: {
        id: string;
        orderCode: string;
        paymentTransaction?: {
          externalOrderCode?: string | null;
          provider?: string | null;
        } | null;
      };
      checkoutUrl: string;
      paymentProvider?: PaymentProvider | string;
      providerAmount?: number;
      providerCurrency?: string;
      manualCrypto?: {
        provider:
          | "BINANCE"
          | "OKX"
          | "USDT_TRC20"
          | "USDT_BEP20"
          | "USDT_SOL"
          | "USDT_TON";
        note: string;
        hasPersonalApi?: boolean;
      };
    },
    language: BotLanguage,
    isPublicCheckoutUrl: boolean,
    custData: {
      custEmojis: Record<string, string>;
      custLabels: Record<string, Record<string, string>>;
      custEmojiIds: Record<string, string>;
    } = { custEmojis: {}, custLabels: {}, custEmojiIds: {} },
    isPremium = false,
  ) {
    const custEmojiIds = custData.custEmojiIds;
    const inlineKeyboard: Array<Array<Record<string, string>>> = [];
    const paymentProvider = String(
      created.order.paymentTransaction?.provider || "",
    ).toLowerCase();
    const externalOrderCode = String(
      created.order.paymentTransaction?.externalOrderCode || "",
    ).trim();
    const canInstantVerify =
      Boolean(externalOrderCode) &&
      (paymentProvider === PaymentProvider.PAYOS.toLowerCase() ||
        paymentProvider === PaymentProvider.BINANCE_PAY.toLowerCase() ||
        paymentProvider === PaymentProvider.PAYPAL.toLowerCase());

    // "I've paid"-style buttons: per-viewer so a premium viewer sees the cusid only (text emoji
    // stripped), everyone else sees the text emoji — never a blank button, never a double icon.
    const paidBtn = (text: string, extra: Record<string, string>) => {
      const sp = text.split(" ");
      return this.buildViewerBtn(
        {
          textEmoji: sp[0] ?? "",
          label: sp.slice(1).join(" "),
          cusid: custEmojiIds["paid"],
          isPremium,
        },
        extra,
      );
    };

    if (isPublicCheckoutUrl) {
      inlineKeyboard.push([
        {
          text: this.buttonLabel("openCheckout", language),
          url: created.checkoutUrl,
        },
      ]);
    }

    if (canInstantVerify) {
      inlineKeyboard.push([
        paidBtn(this.buttonLabel("paid", language), {
          callback_data: `payment:verify:${externalOrderCode}`,
        }),
      ]);
    }

    if (created.manualCrypto?.provider === "USDT_TRC20") {
      inlineKeyboard.push([
        {
          text: this.buttonLabel("txHash", language),
          callback_data: `txhash:submit:${created.manualCrypto.note}`,
        },
      ]);
    }

    if (
      created.manualCrypto?.provider === "BINANCE" &&
      created.manualCrypto?.hasPersonalApi
    ) {
      const text =
        language === "en"
          ? "✅ I've paid — Send Order ID"
          : language === "th"
            ? "✅ ชำระแล้ว — ส่ง ID คำสั่ง"
            : "✅ Đã chuyển — Gửi ID lệnh";
      inlineKeyboard.push([
        paidBtn(text, {
          callback_data: `binance:orderid:prompt:${created.manualCrypto.note}`,
        }),
      ]);
    }

    if (
      created.manualCrypto?.provider === "OKX" &&
      created.manualCrypto?.hasPersonalApi
    ) {
      const text =
        language === "en"
          ? "✅ I've paid — Send TX hash"
          : language === "th"
            ? "✅ ชำระแล้ว — ส่ง TX hash"
            : "✅ Đã chuyển — Gửi TX hash";
      inlineKeyboard.push([
        paidBtn(text, {
          callback_data: `okx:tx:prompt:${created.manualCrypto.note}`,
        }),
      ]);
    }

    inlineKeyboard.push([
      {
        text: language === "en" ? "❌ Cancel Order" : "❌ Hủy đơn ngay",
        callback_data: `order:cancel:${created.order.id}`,
      },
    ]);

    inlineKeyboard.push([
      this.buildNavTextBtn(
        custData,
        "orders",
        "history",
        "home:history",
        language,
        isPremium,
      ),
      this.buildNavTextBtn(
        custData,
        "wallet",
        "wallet",
        "home:wallet",
        language,
        isPremium,
      ),
    ]);
    inlineKeyboard.push([
      this.buildNavTextBtn(
        custData,
        "products",
        "productsShort",
        "home:products",
        language,
        isPremium,
      ),
      this.buildNavTextBtn(
        custData,
        "home",
        "home",
        "home:menu",
        language,
        isPremium,
      ),
    ]);

    return inlineKeyboard;
  }

  private getPromotionalTotal(
    selection: PendingQuantitySelection,
    quantity: number,
    unitPrice: number,
    floorDiscount = true,
  ): number {
    const now = new Date();
    const startAt = selection.promoStartAt
      ? new Date(selection.promoStartAt)
      : null;
    const endAt = selection.promoEndAt ? new Date(selection.promoEndAt) : null;
    const active = (!startAt || now >= startAt) && (!endAt || now <= endAt);
    const minQty = Number(selection.promoBulkMinQty || 0);
    const discountPct = Number(selection.promoBulkDiscountPct || 0);
    const buyQty = Number(selection.promoBuyN || 0);
    const payQty = Number(selection.promoGetM || 0);
    const subtotal = unitPrice * quantity;

    if (active && selection.promoType === "TIER_PRICE") {
      const tier = (selection.promoPriceTiers || [])
        .filter((item) => Number(item.minQty) <= quantity)
        .sort((a, b) => Number(b.minQty) - Number(a.minQty))[0];
      if (tier && Number.isFinite(Number(tier.price)))
        return Math.max(0, Number(tier.price) * quantity);
    }

    if (
      active &&
      selection.promoType === "BUY_N_PAY_M" &&
      buyQty > 0 &&
      payQty >= 0 &&
      payQty < buyQty &&
      quantity >= buyQty
    ) {
      const discountedUnits = Math.floor(quantity / buyQty) * (buyQty - payQty);
      return Math.max(0, unitPrice * (quantity - discountedUnits));
    }

    if (
      active &&
      selection.promoType === "PERCENT_DISCOUNT" &&
      discountPct > 0
    ) {
      const discount = (subtotal * Math.min(100, discountPct)) / 100;
      return Math.max(
        0,
        subtotal - (floorDiscount ? Math.floor(discount) : discount),
      );
    }

    if (
      active &&
      selection.promoType === "BULK_DISCOUNT" &&
      minQty > 0 &&
      quantity >= minQty &&
      discountPct > 0
    ) {
      const discount = (subtotal * discountPct) / 100;
      return Math.max(
        0,
        subtotal - (floorDiscount ? Math.floor(discount) : discount),
      );
    }

    return subtotal;
  }

  private getPreorderPreviewAmounts(
    selection: PendingQuantitySelection,
    merchandiseAmount: number,
    merchandiseAmountUsd: number | null = null,
  ) {
    const isPreorder = selection.isPreorderOnly === true;
    const feePercent = isPreorder
      ? Math.min(100, Math.max(0, Number(selection.preorderFeePercent || 0)))
      : 0;
    const feeAmount = isPreorder
      ? Math.round((Math.max(0, merchandiseAmount) * feePercent) / 100)
      : 0;
    const feeAmountUsd =
      merchandiseAmountUsd == null
        ? null
        : Number(
            ((Math.max(0, merchandiseAmountUsd) * feePercent) / 100).toFixed(2),
          );
    return {
      isPreorder,
      feePercent,
      feeAmount,
      feeAmountUsd,
      totalAmount: Math.max(0, merchandiseAmount) + feeAmount,
      totalAmountUsd:
        merchandiseAmountUsd == null
          ? null
          : Number(
              (Math.max(0, merchandiseAmountUsd) + (feeAmountUsd || 0)).toFixed(
                2,
              ),
            ),
    };
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
    const merchandiseAmount = this.getPromotionalTotal(
      selection,
      quantity,
      selection.salePrice,
    );
    const merchandiseAmountUsd =
      selection.salePriceUsd != null && selection.promoType !== "TIER_PRICE"
        ? this.getPromotionalTotal(
            selection,
            quantity,
            selection.salePriceUsd,
            false,
          )
        : null;
    const preorderPreview = this.getPreorderPreviewAmounts(
      selection,
      merchandiseAmount,
      merchandiseAmountUsd,
    );
    const totalAmount = preorderPreview.totalAmount;
    const totalUsd = preorderPreview.totalAmountUsd;
    const [usdtVndRate, shopData] = await Promise.all([
      this.getShopUsdtVndRate(shopId),
      this.shopsService.getSellerShopByShopId(shopId).catch(() => null),
    ]);
    const subtotal = selection.salePrice * quantity;
    const appliedDiscountPct =
      merchandiseAmount < subtotal
        ? Number(selection.promoBulkDiscountPct || 0)
        : 0;
    const totalDisplay =
      appliedDiscountPct > 0
        ? `${this.formatBotMoneyWithUsdOverride(selection.salePrice, selection.salePriceUsd, language, usdtVndRate)} × ${quantity} − ${appliedDiscountPct}% = ${this.formatBotMoneyWithUsdOverride(merchandiseAmount, merchandiseAmountUsd, language, usdtVndRate)}`
        : this.formatBotMoneyWithUsdOverride(
            totalAmount,
            totalUsd,
            language,
            usdtVndRate,
          );
    const rawCustPay = shopData?.botConfig?.customizationJson;
    const custJsonPay =
      rawCustPay && typeof rawCustPay === "object" && !Array.isArray(rawCustPay)
        ? (rawCustPay as Record<string, unknown>)
        : {};
    const custEmojis =
      custJsonPay["buttonEmojis"] &&
      typeof custJsonPay["buttonEmojis"] === "object"
        ? (custJsonPay["buttonEmojis"] as Record<string, string>)
        : {};
    const custLabels =
      custJsonPay["buttonLabels"] &&
      typeof custJsonPay["buttonLabels"] === "object"
        ? (custJsonPay["buttonLabels"] as Record<
            string,
            Record<string, string>
          >)
        : {};
    const custEmojiIds =
      custJsonPay["buttonEmojiIds"] &&
      typeof custJsonPay["buttonEmojiIds"] === "object"
        ? (custJsonPay["buttonEmojiIds"] as Record<string, string>)
        : {};

    const providerToKey = (p: TelegramPaymentOption): string => {
      if (p === "WALLET") return "payWallet";
      if (p === PaymentProvider.BINANCE_PAY || p === PaymentProvider.BINANCE)
        return "payBinance";
      if (p === PaymentProvider.OKX) return "payOkx";
      if (p === PaymentProvider.USDT_TRC20) return "payUsdt";
      if (p === PaymentProvider.USDT_BEP20) return "payBep20";
      if (p === PaymentProvider.USDT_SOL) return "paySol";
      if (p === PaymentProvider.USDT_TON) return "payTon";
      if (p === PaymentProvider.PAYPAL) return "payPaypal";
      return "payQR";
    };

    const isPremiumPay = await this.resolveCanBling(shopId);
    const buildPayBtn = (provider: TelegramPaymentOption) => {
      const key = providerToKey(provider);
      const defaultText = this.paymentOptionButtonLabel(provider, language);
      const custLabel = custLabels[key]?.[language];
      const custEmoji = custEmojis[key];
      // Default emoji + label parsed from the built-in payment label (a custom label without a custom
      // emoji still shows the default icon). Per-viewer: premium + cusid → cusid only, else text emoji.
      const parts = defaultText.split(" ");
      const hasLeadingEmoji =
        parts.length > 1 && !!parts[0] && /\p{Emoji}/u.test(parts[0]);
      const defPayEmoji = hasLeadingEmoji ? (parts[0] ?? "") : "";
      const defPayLabel = hasLeadingEmoji
        ? parts.slice(1).join(" ")
        : defaultText;
      return this.buildViewerBtn(
        {
          textEmoji: custEmoji?.trim() || defPayEmoji,
          label: custLabel || defPayLabel,
          cusid: custEmojiIds[key],
          isPremium: isPremiumPay,
        },
        { callback_data: `pay:${String(provider).toLowerCase()}` },
      );
    };

    await this.sendText(
      token,
      chatId,
      [
        language === "en"
          ? "Choose payment method:"
          : language === "th"
            ? "เลือกวิธีชำระเงิน:"
            : "Chọn phương thức thanh toán:",
        "",
        ...(selection.requiresCustomerEmail
          ? [
              language === "en"
                ? `Email count: ${quantity}`
                : language === "th"
                  ? `จำนวนอีเมล: ${quantity}`
                  : `Số email: ${quantity}`,
              language === "en"
                ? `Unit price: ${this.formatBotMoneyWithUsdOverride(selection.salePrice, selection.salePriceUsd, language, usdtVndRate)}`
                : language === "th"
                  ? `ราคาต่ออีเมล: ${this.formatBotMoneyWithUsdOverride(selection.salePrice, selection.salePriceUsd, language, usdtVndRate)}`
                  : `Đơn giá/email: ${this.formatBotMoneyWithUsdOverride(selection.salePrice, selection.salePriceUsd, language, usdtVndRate)}`,
            ]
          : []),
        ...(preorderPreview.isPreorder
          ? [
              language === "en"
                ? `Items: ${this.formatBotMoneyWithUsdOverride(merchandiseAmount, merchandiseAmountUsd, language, usdtVndRate)}`
                : language === "th"
                  ? `ค่าสินค้า: ${this.formatBotMoneyWithUsdOverride(merchandiseAmount, merchandiseAmountUsd, language, usdtVndRate)}`
                  : `Tiền hàng: ${this.formatBotMoneyWithUsdOverride(merchandiseAmount, merchandiseAmountUsd, language, usdtVndRate)}`,
              language === "en"
                ? `Pre-order fee (${preorderPreview.feePercent}%): ${this.formatBotMoneyWithUsdOverride(preorderPreview.feeAmount, preorderPreview.feeAmountUsd, language, usdtVndRate)}`
                : language === "th"
                  ? `ค่าจอง (${preorderPreview.feePercent}%): ${this.formatBotMoneyWithUsdOverride(preorderPreview.feeAmount, preorderPreview.feeAmountUsd, language, usdtVndRate)}`
                  : `Phí đặt trước (${preorderPreview.feePercent}%): ${this.formatBotMoneyWithUsdOverride(preorderPreview.feeAmount, preorderPreview.feeAmountUsd, language, usdtVndRate)}`,
              language === "en"
                ? `Total: ${this.formatBotMoneyWithUsdOverride(totalAmount, totalUsd, language, usdtVndRate)}`
                : language === "th"
                  ? `ยอดรวม: ${this.formatBotMoneyWithUsdOverride(totalAmount, totalUsd, language, usdtVndRate)}`
                  : `Tổng thanh toán: ${this.formatBotMoneyWithUsdOverride(totalAmount, totalUsd, language, usdtVndRate)}`,
            ]
          : [
              language === "en"
                ? `Total: ${totalDisplay}`
                : language === "th"
                  ? `ยอดรวม: ${totalDisplay}`
                  : `Tổng: ${totalDisplay}`,
            ]),
        ...(selection.promoBanner || selection.promoMessage
          ? [
              `🎉 ${selection.promoMessage || selection.promoBanner}`,
              ...(selection.promoMessage &&
              selection.promoBanner &&
              selection.promoMessage !== selection.promoBanner
                ? [`🔥 ${selection.promoBanner}`]
                : []),
            ]
          : []),
        language === "en"
          ? "This payment selection will expire in 5 minutes."
          : language === "th"
            ? "การเลือกชำระเงินนี้จะหมดอายุใน 5 นาที"
            : "Lựa chọn thanh toán này sẽ hết hạn sau 5 phút.",
      ].join("\n"),
      actions,
      {
        inline_keyboard: [
          ...options.map((provider) => [buildPayBtn(provider)]),
          [
            {
              text: this.buttonLabel("back", language),
              callback_data: "home:products",
            },
          ],
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

    const selection = await this.getPendingPaymentSelection(
      shopId,
      telegramUserId,
    );
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
          inline_keyboard: [
            [
              {
                text:
                  language === "en"
                    ? "🛍️ Products"
                    : language === "th"
                      ? "🛍️ สินค้า"
                      : "🛍️ Sản phẩm",
                callback_data: "home:products",
              },
            ],
          ],
        },
        actions,
      );
      return;
    }

    try {
      const isPaymentMethodAvailable =
        provider === "WALLET" ||
        (await this.getAvailablePaymentProviders(shopId)).includes(provider);

      if (!isPaymentMethodAvailable) {
        await this.clearPendingPaymentSelection(shopId, telegramUserId);
        await this.editOrSend(
          token,
          chatId,
          messageId,
          language === "en"
            ? "This payment method has just been disabled. Please choose the product again."
            : language === "th"
              ? "วิธีชำระเงินนี้ถูกปิดใช้งานแล้ว กรุณาเลือกสินค้าอีกครั้ง"
              : "Phương thức thanh toán này vừa được tắt. Vui lòng chọn lại sản phẩm.",
          {
            inline_keyboard: [
              [
                {
                  text:
                    language === "en"
                      ? "Products"
                      : language === "th"
                        ? "สินค้า"
                        : "Sản phẩm",
                  callback_data: "home:products",
                },
              ],
            ],
          },
          actions,
        );
        return;
      }

      const customer = {
        telegramUserId: selection.telegramUserId,
        telegramChatId: selection.telegramChatId,
        telegramUsername: selection.telegramUsername,
        firstName: selection.firstName,
        lastName: selection.lastName,
        customerEmail: selection.customerEmail,
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
          inline_keyboard: [
            [
              {
                text: this.buttonLabel("back", language),
                callback_data: "home:products",
              },
            ],
          ],
        },
      ).catch(() => undefined);
    }
  }

  private async getAvailablePaymentProviders(shopId: string) {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId },
      select: {
        provider: true,
        payosClientIdEncrypted: true,
        payosApiKeyEncrypted: true,
        payosChecksumKeyEncrypted: true,
        pay2sPartnerCodeEncrypted: true,
        pay2sAccessKeyEncrypted: true,
        pay2sSecretKeyEncrypted: true,
        pay2sBankAccount: true,
        pay2sBankId: true,
        web2mAccountNumber: true,
        web2mBankCode: true,
        binanceUid: true,
        binanceEnabled: true,
        okxUid: true,
        okxEnabled: true,
        usdtTrc20Address: true,
        usdtTrc20Enabled: true,
        usdtBep20Address: true,
        usdtBep20Enabled: true,
        usdtSolanaAddress: true,
        usdtSolanaEnabled: true,
        usdtTonAddress: true,
        usdtTonEnabled: true,
        binancePayEnabled: true,
        paypalEnabled: true,
        paypalClientIdEncrypted: true,
        paypalClientSecretEncrypted: true,
        paypalWebhookId: true,
      },
    });
    return resolveVisiblePaymentProviders(
      paymentConfig,
      this.config.paymentMode === "payos"
        ? PaymentProvider.PAYOS
        : PaymentProvider.MOCK,
    );
  }

  private async getAvailablePaymentOptions(
    shopId: string,
    telegramUserId: string,
    totalAmount: number,
  ): Promise<TelegramPaymentOption[]> {
    const providers = await this.getAvailablePaymentProviders(shopId);
    const options: TelegramPaymentOption[] = [...providers];

    if (telegramUserId) {
      const walletSummary =
        await this.customerWalletService.getWalletSummaryForTelegram(
          shopId,
          telegramUserId,
        );

      const spendableBalance =
        walletSummary.balance + walletSummary.commissionBalance;
      if (spendableBalance >= totalAmount && totalAmount > 0) {
        options.unshift("WALLET");
      }
    }

    return Array.from(new Set(options));
  }

  private normalizePaymentOption(value: string): TelegramPaymentOption | null {
    const normalized = String(value || "").toUpperCase();

    if (normalized === "WALLET") return "WALLET";
    if (normalized === "PAYOS") return PaymentProvider.PAYOS;
    if (normalized === "PAY2S") return PaymentProvider.PAY2S;
    if (normalized === "WEB2M") return PaymentProvider.WEB2M;
    if (normalized === "MOCK") return PaymentProvider.MOCK;
    if (normalized === "BINANCE") return PaymentProvider.BINANCE;
    if (normalized === "BINANCE_PAY") return PaymentProvider.BINANCE_PAY;
    if (normalized === "OKX") return PaymentProvider.OKX;
    if (normalized === "USDT_TRC20") return PaymentProvider.USDT_TRC20;
    if (normalized === "USDT_BEP20") return PaymentProvider.USDT_BEP20;
    if (normalized === "USDT_SOL") return PaymentProvider.USDT_SOL;
    if (normalized === "USDT_TON") return PaymentProvider.USDT_TON;
    if (normalized === "PAYPAL") return PaymentProvider.PAYPAL;

    return null;
  }

  private paymentOptionButtonLabel(
    provider: TelegramPaymentOption,
    language: BotLanguage,
  ) {
    if (provider === "WALLET") {
      return language === "en"
        ? "💰 Pay with Wallet"
        : language === "th"
          ? "💰 ชำระด้วยกระเป๋าเงิน"
          : "💰 Thanh toán bằng ví";
    }
    if (provider === PaymentProvider.BINANCE_PAY) {
      return language === "en"
        ? "🟡 Pay with Binance Pay (Auto)"
        : language === "th"
          ? "🟡 Binance Pay (อัตโนมัติ)"
          : "🟡 Binance Pay (Tự động)";
    }
    if (provider === PaymentProvider.BINANCE) {
      return language === "en"
        ? "🟡 Pay with Binance"
        : language === "th"
          ? "🟡 ชำระด้วย Binance"
          : "🟡 Thanh toán Binance";
    }
    if (provider === PaymentProvider.OKX) {
      return language === "en"
        ? "⚫ Pay with OKX"
        : language === "th"
          ? "⚫ ชำระด้วย OKX"
          : "⚫ Thanh toán OKX";
    }
    if (provider === PaymentProvider.USDT_TRC20) {
      return language === "en"
        ? "Pay with USDT (TRC20)"
        : language === "th"
          ? "ชำระด้วย USDT (TRC20)"
          : "Thanh toán USDT (TRC20)";
    }
    if (provider === PaymentProvider.USDT_BEP20) {
      return language === "en"
        ? "💛 Pay with USDT (BEP20)"
        : language === "th"
          ? "💛 ชำระด้วย USDT (BEP20)"
          : "💛 Thanh toán USDT (BEP20)";
    }
    if (provider === PaymentProvider.USDT_SOL) {
      return language === "en"
        ? "Pay with USDT (Solana)"
        : language === "th"
          ? "ชำระด้วย USDT (Solana)"
          : "Thanh toán USDT (Solana)";
    }
    if (provider === PaymentProvider.USDT_TON) {
      return language === "en"
        ? "Pay with USDT (TON)"
        : language === "th"
          ? "ชำระด้วย USDT (TON)"
          : "Thanh toán USDT (TON)";
    }
    if (provider === PaymentProvider.PAYPAL) {
      return language === "en"
        ? "🅿️ Pay with PayPal"
        : language === "th"
          ? "🅿️ ชำระด้วย PayPal"
          : "🅿️ Thanh toán PayPal";
    }
    if (provider === PaymentProvider.MOCK) {
      return language === "en"
        ? "💳 Pay with QR / Bank"
        : language === "th"
          ? "💳 ชำระด้วย QR / โอนเงิน"
          : "💳 Thanh toán QR / Chuyển khoản";
    }

    return language === "en"
      ? "💳 Pay with QR / Bank"
      : language === "th"
        ? "💳 ชำระด้วย QR / โอนเงิน"
        : "💳 Thanh toán QR / Chuyển khoản";
  }

  private buildOrderPaymentLines(
    created: {
      order: {
        orderCode: string;
        productName: string;
        customerEmail?: string | null;
        quantity: number;
        totalSaleAmount: number;
        isPreorder?: boolean;
        preorderFeePercent?: number;
        preorderFeeAmount?: number;
      };
      checkoutUrl: string;
      paymentProvider?: PaymentProvider | string;
      providerAmount?: number;
      providerCurrency?: string;
      manualCrypto?: {
        provider:
          | "BINANCE"
          | "OKX"
          | "USDT_TRC20"
          | "USDT_BEP20"
          | "USDT_SOL"
          | "USDT_TON";
        uid?: string | null;
        address?: string | null;
        network?: "TRC20" | "BEP20" | "SOLANA" | "TON" | null;
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
      bankInfo?: PayOSBankInfo;
    },
    language: BotLanguage,
    usdtVndRate?: Prisma.Decimal | number | string | null,
    isManualNoDelivery?: boolean,
    supportTelegram?: string | null,
    supportZalo?: string | null,
    msgEmojiIds: Record<string, string> = {},
  ) {
    const orderCreatedIcon = msgEmojiIds["orderCreated"]
      ? `<tg-emoji emoji-id="${msgEmojiIds["orderCreated"]}">✅</tg-emoji>`
      : "✅";
    const bankInfoIcon = msgEmojiIds["bankInfo"]
      ? `<tg-emoji emoji-id="${msgEmojiIds["bankInfo"]}">🏦</tg-emoji>`
      : "🏦";
    const productName = this.escapeHtml(
      this.localizeProductName(created.order.productName, language),
    );
    const preorderFeeAmount = Math.max(
      0,
      Number(created.order.preorderFeeAmount || 0),
    );
    const merchandiseAmount = Math.max(
      0,
      Number(created.order.totalSaleAmount || 0) - preorderFeeAmount,
    );
    const preorderBreakdown = created.order.isPreorder
      ? language === "en"
        ? [
            `🕒 Pre-order`,
            `Items: ${this.formatBotMoney(merchandiseAmount, language, usdtVndRate)}`,
            `Pre-order fee (${Number(created.order.preorderFeePercent || 0)}%): ${this.formatBotMoney(preorderFeeAmount, language, usdtVndRate)}`,
            `After payment, the order joins the FIFO queue and will be delivered automatically when stock arrives.`,
          ]
        : language === "th"
          ? [
              `🕒 คำสั่งจองล่วงหน้า`,
              `ค่าสินค้า: ${this.formatBotMoney(merchandiseAmount, language, usdtVndRate)}`,
              `ค่าจองล่วงหน้า (${Number(created.order.preorderFeePercent || 0)}%): ${this.formatBotMoney(preorderFeeAmount, language, usdtVndRate)}`,
              `หลังชำระเงิน คำสั่งซื้อจะเข้าคิว FIFO และบอทจะส่งสินค้าอัตโนมัติเมื่อมีสินค้า`,
            ]
          : [
              `🕒 Đơn đặt trước`,
              `Tiền hàng: ${this.formatBotMoney(merchandiseAmount, language, usdtVndRate)}`,
              `Phí đặt trước (${Number(created.order.preorderFeePercent || 0)}%): ${this.formatBotMoney(preorderFeeAmount, language, usdtVndRate)}`,
              `Thanh toán xong, đơn vào hàng chờ FIFO và bot sẽ tự giao khi có hàng.`,
            ]
      : [];
    const baseLines =
      language === "en"
        ? [
            `${orderCreatedIcon} Order created`,
            `Order code: ${created.order.orderCode}`,
            `Product: ${productName}`,
            created.order.customerEmail
              ? `Email count: ${created.order.quantity}`
              : `Quantity: ${created.order.quantity}`,
            ...preorderBreakdown,
            `Total: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`,
          ]
        : language === "th"
          ? [
              `${orderCreatedIcon} สร้างคำสั่งซื้อแล้ว`,
              `รหัสคำสั่งซื้อ: ${created.order.orderCode}`,
              `สินค้า: ${productName}`,
              created.order.customerEmail
                ? `จำนวนอีเมล: ${created.order.quantity}`
                : `จำนวน: ${created.order.quantity}`,
              ...preorderBreakdown,
              `ยอดรวม: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`,
            ]
          : [
              `${orderCreatedIcon} Đã tạo đơn hàng`,
              `Mã đơn: ${created.order.orderCode}`,
              `Sản phẩm: ${productName}`,
              created.order.customerEmail
                ? `Số email: ${created.order.quantity}`
                : `Số lượng: ${created.order.quantity}`,
              ...preorderBreakdown,
              `Tổng thanh toán: ${this.formatBotMoney(created.order.totalSaleAmount, language, usdtVndRate)}`,
            ];

    if (
      created.paymentProvider === PaymentProvider.PAYPAL &&
      created.providerCurrency === "USD" &&
      Number(created.providerAmount || 0) > 0
    ) {
      const paypalAmount = Number(created.providerAmount).toFixed(2);
      return [
        ...baseLines,
        "",
        language === "en"
          ? "Payment method: 🅿️ PayPal"
          : language === "th"
            ? "วิธีชำระเงิน: 🅿️ PayPal"
            : "Phương thức: 🅿️ PayPal",
        language === "en"
          ? `PayPal amount: <code>$${paypalAmount} USD</code>`
          : language === "th"
            ? `ยอด PayPal: <code>$${paypalAmount} USD</code>`
            : `Số tiền PayPal: <code>$${paypalAmount} USD</code>`,
        language === "en"
          ? "Open PayPal checkout below. The bot delivers automatically only after the capture is completed."
          : language === "th"
            ? "เปิดหน้า PayPal ด้านล่าง บอทจะจัดส่งอัตโนมัติหลังจาก capture สำเร็จเท่านั้น"
            : "Mở trang PayPal bên dưới. Bot chỉ tự giao hàng sau khi capture hoàn tất.",
      ];
    }

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
      const isTrc20 = created.manualCrypto.provider === "USDT_TRC20";
      const isBep20 = created.manualCrypto.provider === "USDT_BEP20";
      const isSol = created.manualCrypto.provider === "USDT_SOL";
      const isTon = created.manualCrypto.provider === "USDT_TON";
      const isOnchain = isTrc20 || isBep20 || isSol || isTon;
      const providerName =
        created.manualCrypto.provider === "BINANCE"
          ? "Binance"
          : created.manualCrypto.provider === "OKX"
            ? "OKX"
            : isSol
              ? "USDT (Solana)"
              : isTon
                ? "USDT (TON)"
                : isBep20
                  ? "USDT (BEP20)"
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
      const displayReceiverLine = isTrc20
        ? language === "en"
          ? `USDT TRC20 address (tap to copy):\n<code>${created.manualCrypto.address}</code>`
          : language === "th"
            ? `ที่อยู่ USDT TRC20 (แตะเพื่อคัดลอก):\n<code>${created.manualCrypto.address}</code>`
            : `Địa chỉ USDT TRC20 (chạm để copy):\n<code>${created.manualCrypto.address}</code>`
        : isBep20
          ? language === "en"
            ? `USDT BEP20 address (tap to copy):\n<code>${created.manualCrypto.address}</code>`
            : language === "th"
              ? `ที่อยู่ USDT BEP20 (แตะเพื่อคัดลอก):\n<code>${created.manualCrypto.address}</code>`
              : `Địa chỉ USDT BEP20 (chạm để copy):\n<code>${created.manualCrypto.address}</code>`
          : isSol
            ? language === "en"
              ? `USDT Solana address (tap to copy):\n<code>${created.manualCrypto.address}</code>`
              : language === "th"
                ? `ที่อยู่ USDT Solana (แตะเพื่อคัดลอก):\n<code>${created.manualCrypto.address}</code>`
                : `Địa chỉ USDT Solana (chạm để copy):\n<code>${created.manualCrypto.address}</code>`
            : isTon
              ? language === "en"
                ? `USDT TON address (tap to copy):\n<code>${created.manualCrypto.address}</code>`
                : language === "th"
                  ? `ที่อยู่ USDT TON (แตะเพื่อคัดลอก):\n<code>${created.manualCrypto.address}</code>`
                  : `Địa chỉ USDT TON (chạm để copy):\n<code>${created.manualCrypto.address}</code>`
              : receiverLine;
      const networkLine = isTrc20
        ? language === "en"
          ? "Network: TRC20 (Tron)"
          : language === "th"
            ? "เครือข่าย: TRC20 (Tron)"
            : "Mạng: TRC20 (Tron)"
        : isBep20
          ? language === "en"
            ? "Network: BEP20 (BSC)"
            : language === "th"
              ? "เครือข่าย: BEP20 (BSC)"
              : "Mạng: BEP20 (BSC)"
          : isSol
            ? language === "en"
              ? "Network: Solana (SPL Token)"
              : language === "th"
                ? "เครือข่าย: Solana (SPL Token)"
                : "Mạng: Solana (SPL Token)"
            : isTon
              ? language === "en"
                ? "Network: TON (Jetton)"
                : language === "th"
                  ? "เครือข่าย: TON (Jetton)"
                  : "Mạng: TON (Jetton)"
              : null;
      const safetyLine = isTrc20
        ? language === "en"
          ? "Only send USDT on the TRC20 network to this address."
          : language === "th"
            ? "ส่ง USDT ผ่านเครือข่าย TRC20 ไปยังที่อยู่นี้เท่านั้น"
            : "Chỉ gửi USDT đúng mạng TRC20 về địa chỉ này."
        : isBep20
          ? language === "en"
            ? "Only send USDT on the BEP20 (BSC) network to this address."
            : language === "th"
              ? "ส่ง USDT ผ่านเครือข่าย BEP20 (BSC) ไปยังที่อยู่นี้เท่านั้น"
              : "Chỉ gửi USDT đúng mạng BEP20 (BSC) về địa chỉ này."
          : isSol
            ? language === "en"
              ? "Only send USDT on the Solana network (SPL token) to this address."
              : language === "th"
                ? "ส่ง USDT ผ่านเครือข่าย Solana (SPL token) ไปยังที่อยู่นี้เท่านั้น"
                : "Chỉ gửi USDT đúng mạng Solana (SPL token) về địa chỉ này."
            : isTon
              ? language === "en"
                ? "Only send the official USDT Jetton on TON to this address."
                : language === "th"
                  ? "ส่งเฉพาะ USDT Jetton อย่างเป็นทางการบน TON ไปยังที่อยู่นี้"
                  : "Chỉ gửi USDT Jetton chính thức trên mạng TON về địa chỉ này."
              : language === "en"
                ? "Please send the order ID or off-chain transaction reference after payment for verification."
                : language === "th"
                  ? "หลังชำระเงินกรุณาส่ง ID คำสั่งหรือรหัสอ้างอิงธุรกรรมเพื่อยืนยัน"
                  : "Sau khi thanh toán, vui lòng gửi mã đơn hoặc mã giao dịch để xác minh.";
      const expiryLine = isOnchain
        ? language === "en"
          ? "⚠️ This payment order will expire in 30 minutes."
          : language === "th"
            ? "⚠️ คำสั่งชำระเงินนี้จะหมดอายุใน 30 นาที"
            : "⚠️ Lệnh thanh toán này chỉ duy trì được 30 phút."
        : language === "en"
          ? "⚠️ This payment order will expire in 5 minutes."
          : language === "th"
            ? "⚠️ คำสั่งชำระเงินนี้จะหมดอายุใน 5 นาที"
            : "⚠️ Lệnh thanh toán này chỉ duy trì được 5 phút.";
      const followupLine = isOnchain
        ? language === "en"
          ? isTon
            ? "After transfer, the bot auto-detects the TON payment within 30-60s."
            : "After transfer, the bot auto-detects within 30-60s. (Optional: paste the tx hash here for faster verification.)"
          : language === "th"
            ? "หลังโอนเงิน ระบบจะตรวจจับอัตโนมัติภายใน 30-60 วินาที (ทางเลือก: วาง tx hash ที่นี่เพื่อยืนยันเร็วขึ้น)"
            : isTon
              ? "Sau khi chuyển, bot tự dò giao dịch TON trong 30-60 giây."
              : "Sau khi chuyển, bot tự dò trong 30-60s. (Tuỳ chọn: dán tx hash vào đây để xác nhận nhanh hơn.)"
        : null;
      const binanceAutoLine =
        created.manualCrypto.provider === "BINANCE" &&
        created.manualCrypto.hasPersonalApi
          ? language === "en"
            ? "This order uses a unique USDT amount. After transferring, tap 'I've paid' so the bot can check your Binance Pay history automatically."
            : language === "th"
              ? "คำสั่งซื้อนี้ใช้จำนวน USDT เฉพาะ หลังโอนแล้วกด 'ฉันชำระแล้ว' เพื่อให้บอทตรวจสอบประวัติ Binance Pay อัตโนมัติ"
              : "Đơn này được gán số USDT riêng. Sau khi chuyển xong, bấm 'Tôi đã thanh toán' để bot tự kiểm tra lịch sử Binance Pay."
          : isTon
            ? language === "en"
              ? "Scan the QR to copy the address, then choose USDT on the TON network in your wallet and enter the exact amount."
              : language === "th"
                ? "สแกน QR เพื่อคัดลอกที่อยู่ จากนั้นเลือก USDT บนเครือข่าย TON และระบุจำนวนให้ตรง"
                : "Quét QR để lấy địa chỉ ví, sau đó chọn USDT mạng TON và nhập đúng số tiền."
            : null;
      const okxAutoLine =
        created.manualCrypto.provider === "OKX" &&
        created.manualCrypto.hasPersonalApi
          ? language === "en"
            ? "Send the exact USDT amount shown — the bot auto-verifies your OKX deposit within 30-60s. You can also tap 'I've paid' below and paste the tx hash for instant verify."
            : language === "th"
              ? "ส่งจำนวน USDT ตรงตามที่แสดง — บอทจะตรวจสอบ OKX อัตโนมัติภายใน 30-60 วินาที หรือกด 'ฉันชำระแล้ว' แล้ววาง tx hash เพื่อยืนยันทันที"
              : "Chuyển đúng số USDT bên dưới — bot tự dò OKX trong 30-60s. Hoặc bấm 'Đã chuyển' rồi paste tx hash để xác nhận ngay."
          : null;
      const binanceExactAmountLine =
        (created.manualCrypto.provider === "BINANCE" &&
          created.manualCrypto.hasPersonalApi) ||
        (created.manualCrypto.provider === "OKX" &&
          created.manualCrypto.hasPersonalApi) ||
        isSol ||
        isTon
          ? language === "en"
            ? "Send the exact amount shown below so the system can match your payment safely."
            : language === "th"
              ? "กรุณาโอนจำนวนที่แสดงด้านล่างเพื่อให้ระบบจับคู่การชำระเงินได้อย่างถูกต้อง"
              : "Hãy chuyển đúng số tiền bên dưới để hệ thống đối chiếu giao dịch an toàn hơn."
          : null;
      const helperLine = isTrc20
        ? language === "en"
          ? "Scan the QR to copy the address, then enter the amount and choose USDT on TRC20 manually in your wallet."
          : language === "th"
            ? "สแกน QR เพื่อคัดลอกที่อยู่ จากนั้นระบุจำนวนเงินและเลือก USDT บน TRC20 ในกระเป๋าเงินของคุณ"
            : "Quét mã QR để lấy địa chỉ ví, sau đó tự nhập số tiền và chọn gửi USDT mạng TRC20."
        : isSol
          ? language === "en"
            ? "Scan the QR to copy the address, then enter the amount and choose USDT on Solana network in your wallet."
            : language === "th"
              ? "สแกน QR เพื่อคัดลอกที่อยู่ จากนั้นระบุจำนวนเงินและเลือก USDT บนเครือข่าย Solana ในกระเป๋าเงินของคุณ"
              : "Quét mã QR để lấy địa chỉ ví, sau đó tự nhập số tiền và chọn gửi USDT mạng Solana."
          : isTon
            ? language === "en"
              ? "TON transfers need a small amount of TON in the sending wallet for network fees."
              : language === "th"
                ? "การโอนต้องมี TON เล็กน้อยในกระเป๋าผู้ส่งสำหรับค่าธรรมเนียมเครือข่าย"
                : "Ví gửi cần có một ít TON để trả phí mạng."
            : null;
      const feeLine = isTrc20
        ? language === "en"
          ? "TRC20 transfers also need enough TRX on the sending wallet for network fees."
          : language === "th"
            ? "การโอน TRC20 ต้องมี TRX เพียงพอในกระเป๋าผู้ส่งสำหรับค่าธรรมเนียมเครือข่าย"
            : "Lệnh chuyển TRC20 cũng cần đủ TRX trong ví gửi để trả phí mạng."
        : isSol
          ? language === "en"
            ? "Solana transfers need a small amount of SOL on the sending wallet for network fees (~0.001 SOL)."
            : language === "th"
              ? "การโอน Solana ต้องมี SOL เล็กน้อยในกระเป๋าผู้ส่งสำหรับค่าธรรมเนียม (~0.001 SOL)"
              : "Lệnh chuyển Solana cũng cần một ít SOL trong ví gửi để trả phí mạng (~0.001 SOL)."
          : null;
      const toleranceLine =
        isOnchain && !isTon
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
        ...(isOnchain
          ? this.buildUsdtTransferWarningLines(
              created.manualCrypto.provider as
                | "USDT_TRC20"
                | "USDT_BEP20"
                | "USDT_SOL"
                | "USDT_TON",
              created.manualCrypto.usdtAmount,
              language,
            )
          : [safetyLine]),
        ...(binanceAutoLine ? [binanceAutoLine] : []),
        ...(okxAutoLine ? [okxAutoLine] : []),
        ...(binanceExactAmountLine ? [binanceExactAmountLine] : []),
        ...(helperLine ? [helperLine] : []),
        ...(followupLine ? [followupLine] : []),
        "",
        expiryLine,
      ];
    }

    // ── PayOS / default ───────────────────────────────────────────────────────
    const manualNoDeliveryLines: string[] =
      isManualNoDelivery && (supportTelegram || supportZalo)
        ? [
            language === "en"
              ? "✅ Please contact admin if you need support:"
              : language === "th"
                ? "✅ กรุณาติดต่อแอดมินหากต้องการความช่วยเหลือ:"
                : "✅ Vui lòng liên hệ admin nếu cần hỗ trợ:",
            ...(supportTelegram ? [`Telegram: ${supportTelegram}`] : []),
            ...(supportZalo ? [`Zalo: ${supportZalo}`] : []),
          ]
        : [];

    const bankLines = created.bankInfo
      ? this.buildBankInfoLines(
          created.bankInfo,
          created.order.totalSaleAmount,
          language,
          msgEmojiIds,
        )
      : [];

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
        ? "⚠️ Please make sure the transfer description (content) is exactly correct."
        : language === "th"
          ? "⚠️ กรุณากรอกเนื้อหาการโอนเงินให้ถูกต้อง"
          : "⚠️ Hãy đảm bảo bạn điền đúng nội dung chuyển khoản.",
      ...(manualNoDeliveryLines.length > 0
        ? ["", ...manualNoDeliveryLines]
        : []),
      ...bankLines,
    ];
  }

  private buildBankInfoLines(
    bankInfo: PayOSBankInfo,
    amount: number,
    language: BotLanguage,
    msgEmojiIds: Record<string, string> = {},
  ): string[] {
    const bankName = BIN_TO_BANK[bankInfo.bin] || bankInfo.bin;
    // VND gateways receive and encode integer amounts. Display that same value.
    const amountFormatted = Math.round(Number(amount)).toLocaleString("vi-VN");
    const bankIcon = msgEmojiIds["bankInfo"]
      ? `<tg-emoji emoji-id="${msgEmojiIds["bankInfo"]}">🏦</tg-emoji>`
      : "🏦";
    if (language === "en") {
      return [
        "",
        "─────────────────",
        `${bankIcon} Bank transfer details`,
        `Bank: ${bankName}`,
        `Account name: ${bankInfo.accountName}`,
        `Account number: <code>${bankInfo.accountNumber}</code>`,
        `Amount: <code>${amountFormatted}</code>`,
        `Transfer note: <code>${bankInfo.description}</code>`,
        "─────────────────",
      ];
    }
    if (language === "th") {
      return [
        "",
        "─────────────────",
        `${bankIcon} ข้อมูลการโอนเงิน`,
        `ธนาคาร: ${bankName}`,
        `ชื่อบัญชี: ${bankInfo.accountName}`,
        `เลขบัญชี: <code>${bankInfo.accountNumber}</code>`,
        `จำนวนเงิน: <code>${amountFormatted}</code>`,
        `เนื้อหาการโอน: <code>${bankInfo.description}</code>`,
        "─────────────────",
      ];
    }
    return [
      "",
      "─────────────────",
      `${bankIcon} Thông tin chuyển khoản`,
      `Ngân hàng: ${bankName}`,
      `Tên TK: ${bankInfo.accountName}`,
      `STK: <code>${bankInfo.accountNumber}</code>`,
      `Số tiền: <code>${amountFormatted}</code>`,
      `Nội dung: <code>${bankInfo.description}</code>`,
      "─────────────────",
    ];
  }

  private buildUsdtTransferWarningLines(
    provider: "USDT_TRC20" | "USDT_BEP20" | "USDT_SOL" | "USDT_TON",
    expectedAmount: number,
    language: BotLanguage,
  ) {
    const tolerance = Math.max(
      0,
      Number(this.config.usdtPaymentTolerance || 0),
    );
    const minimumReceived = Math.max(
      0,
      Number(expectedAmount || 0) - tolerance,
    );
    const network =
      provider === "USDT_TRC20"
        ? "TRC20 (Tron)"
        : provider === "USDT_BEP20"
          ? "BEP20 (BSC)"
          : provider === "USDT_SOL"
            ? "Solana (SPL)"
            : "TON (Jetton)";
    const feeToken =
      provider === "USDT_TRC20"
        ? "TRX"
        : provider === "USDT_BEP20"
          ? "BNB"
          : provider === "USDT_SOL"
            ? "SOL"
            : "TON";
    const amountText = this.formatUsdt(expectedAmount);
    const toleranceText = this.formatUsdt(tolerance);
    const minimumText = this.formatUsdt(minimumReceived);

    if (language === "en") {
      return [
        "",
        "⚠️ Important transfer notes:",
        `• For automatic detection, send exactly <code>${amountText}</code> USDT.`,
        `• The displayed amount is what the bot must receive and does not include fees. Maximum allowed difference: <code>${toleranceText}</code> USDT; minimum received: <code>${minimumText}</code> USDT.`,
        `• Calculate and cover the fee yourself according to the network/sender. An on-chain wallet normally pays gas in ${feeToken}; an exchange may deduct the fee in USDT.`,
        `• Only send official USDT using the ${network} network to this address. A wrong network may cause permanent loss.`,
      ];
    }

    if (language === "th") {
      return [
        "",
        "⚠️ หมายเหตุสำคัญในการโอน:",
        `• เพื่อให้ระบบตรวจจับอัตโนมัติ กรุณาส่งตรงจำนวน <code>${amountText}</code> USDT`,
        `• จำนวนที่แสดงคือยอดที่บอทต้องได้รับจริงและยังไม่รวมค่าธรรมเนียม อนุญาตให้คลาดเคลื่อนได้สูงสุด <code>${toleranceText}</code> USDT โดยต้องได้รับอย่างน้อย <code>${minimumText}</code> USDT`,
        `• โปรดคำนวณและชดเชยค่าธรรมเนียมเองตามเครือข่าย/ช่องทางที่ส่ง กระเป๋า on-chain มักจ่าย gas ด้วย ${feeToken} ส่วนเว็บเทรดอาจหักค่าธรรมเนียมเป็น USDT`,
        `• ส่งเฉพาะ USDT ทางเครือข่าย ${network} มายังที่อยู่นี้เท่านั้น การเลือกเครือข่ายผิดอาจทำให้เงินสูญหายถาวร`,
      ];
    }

    return [
      "",
      "⚠️ Lưu ý quan trọng khi chuyển:",
      `• Để bot tự nhận, hãy chuyển đúng <code>${amountText}</code> USDT.`,
      `• Số tiền hiển thị là số USDT bot cần thực nhận, chưa bao gồm phí. Cho phép sai số tối đa <code>${toleranceText}</code> USDT; bot phải nhận ít nhất <code>${minimumText}</code> USDT.`,
      `• Khách hàng tự tính và bù phí theo mạng/nơi gửi. Ví on-chain thường trả gas bằng ${feeToken}; sàn có thể trừ phí trực tiếp bằng USDT.`,
      `• Chỉ gửi USDT chính thức đúng mạng ${network} vào địa chỉ này. Chọn sai mạng có thể mất tiền vĩnh viễn.`,
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
    return this.render.buildGuideText(shopName, language);
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
          inline_keyboard: [[this.navBtn("history", language, "home:history")]],
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
          inline_keyboard: [[this.navBtn("history", language, "home:history")]],
        },
        actions,
      );
      return;
    }

    if (
      payment.provider !== PaymentProvider.USDT_TRC20 &&
      payment.provider !== PaymentProvider.USDT_BEP20
    ) {
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
          inline_keyboard: [[this.navBtn("history", language, "home:history")]],
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
          inline_keyboard: [[this.navBtn("history", language, "home:history")]],
        },
        actions,
      );
      return;
    }

    await this.clearPendingQuantitySelection(shopId, telegramUserId);
    await this.clearPendingWalletTopup(shopId, telegramUserId);
    await this.clearPendingPaymentSelection(shopId, telegramUserId);
    await this.sessions.setPendingSession(
      "pendingTxHashSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
      {
        externalOrderCode,
        orderCode: payment.order.orderCode,
        provider: payment.provider,
        allowMockHash: this.isSimulationToken(token),
        expiresAt: Date.now() + this.sessions.pendingTxHashTtlMs,
      },
      this.sessions.pendingTxHashTtlMs,
    );

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
          [this.navBtn("history", language, "home:history")],
          [this.navBtn("home", language, "home:menu")],
        ],
      },
      actions,
    );
  }

  private async promptTopupTxHashSubmission(
    shopId: string,
    token: string,
    chatId: number | undefined,
    telegramUserId: string,
    externalOrderCode: string,
    actions: unknown[],
    language: BotLanguage,
    messageId?: number,
  ) {
    if (!chatId) return;

    const topup = await this.prisma.customerWalletTopup.findUnique({
      where: { externalOrderCode },
      include: { customer: true },
    });

    if (!topup || topup.shopId !== shopId) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "⚠️ Wallet topup not found."
          : language === "th"
            ? "⚠️ ไม่พบรายการเติมเงิน"
            : "⚠️ Không tìm thấy lệnh nạp ví này.",
        { inline_keyboard: [[this.navBtn("home", language, "home:wallet")]] },
        actions,
      );
      return;
    }

    if (topup.customer?.telegramUserId !== telegramUserId) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "⚠️ This topup does not belong to your account."
          : language === "th"
            ? "⚠️ รายการนี้ไม่ใช่ของบัญชีคุณ"
            : "⚠️ Lệnh nạp này không thuộc tài khoản của bạn.",
        { inline_keyboard: [[this.navBtn("home", language, "home:wallet")]] },
        actions,
      );
      return;
    }

    if (topup.status === "PAID") {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        language === "en"
          ? "✅ This topup has already been confirmed."
          : language === "th"
            ? "✅ รายการเติมเงินนี้ได้รับการยืนยันแล้ว"
            : "✅ Lệnh nạp này đã được xác nhận rồi.",
        { inline_keyboard: [[this.navBtn("home", language, "home:wallet")]] },
        actions,
      );
      return;
    }

    await this.clearPendingQuantitySelection(shopId, telegramUserId);
    await this.clearPendingWalletTopup(shopId, telegramUserId);
    await this.clearPendingPaymentSelection(shopId, telegramUserId);
    await this.sessions.setPendingSession(
      "pendingTxHashSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
      {
        externalOrderCode,
        orderCode: externalOrderCode,
        allowMockHash: this.isSimulationToken(token),
        expiresAt: Date.now() + this.sessions.pendingTxHashTtlMs,
        isTopup: true,
      },
      this.sessions.pendingTxHashTtlMs,
    );

    await this.editOrSend(
      token,
      chatId,
      messageId,
      [
        language === "en"
          ? "🧾 Send TX hash for wallet topup"
          : language === "th"
            ? "🧾 ส่ง TX hash สำหรับการเติมเงินกระเป๋า"
            : "🧾 Gửi TX hash để xác nhận nạp ví",
        "",
        language === "en"
          ? `Reply with the ${topup.provider === PaymentProvider.USDT_BEP20 ? "BEP20" : "TRC20"} transaction hash in the next message.`
          : language === "th"
            ? `ตอบกลับด้วย TX hash ของธุรกรรม ${topup.provider === PaymentProvider.USDT_BEP20 ? "BEP20" : "TRC20"} ในข้อความถัดไป`
            : `Hãy trả lời bằng tx hash giao dịch ${topup.provider === PaymentProvider.USDT_BEP20 ? "BEP20" : "TRC20"} ở tin nhắn tiếp theo.`,
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
          [this.navBtn("home", language, "home:wallet")],
          [this.navBtn("home", language, "home:menu")],
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
    await this.sessions.setPendingSession(
      "pendingWarrantyClaimSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
      { expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs },
      this.sessions.pendingQuantityTtlMs,
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
          ? "Reply with your order code (ORD-…) OR the account email you received, in the next message."
          : language === "th"
            ? "ตอบกลับด้วยรหัสคำสั่งซื้อ (ORD-…) หรืออีเมลบัญชีที่คุณได้รับ ในข้อความถัดไป"
            : "Trả lời bằng MÃ ĐƠN (ORD-…) HOẶC email tài khoản bạn đã nhận, ở tin nhắn tiếp theo.",
        language === "en"
          ? "We will validate the warranty window and process the claim automatically when possible."
          : language === "th"
            ? "ระบบจะตรวจสอบระยะเวลารับประกันและดำเนินการอัตโนมัติหากเป็นไปได้"
            : "Hệ thống sẽ kiểm tra thời hạn bảo hành và tự xử lý nếu đủ điều kiện.",
      ].join("\n"),
      {
        inline_keyboard: [
          [this.navBtn("history", language, "home:history")],
          [this.navBtn("home", language, "home:menu")],
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
    const pending = await this.getPendingWarrantyClaimSubmission(
      shopId,
      telegramUserId,
    );

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

    await this.clearPendingWarrantyClaimSubmission(shopId, telegramUserId);

    const check = await this.warrantyService.checkTelegramWarrantyEligibility({
      shopId,
      telegramUserId,
      orderCode,
      language: language === "zh" ? "en" : language,
    });

    if (!check.eligible) {
      await this.sendText(token, message.chat.id, check.message, actions, {
        inline_keyboard: [
          [this.navBtn("history", language, "home:history")],
          [this.navBtn("warranty", language, "warranty:start")],
          [this.navBtn("home", language, "home:menu")],
        ],
      });
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
      check.issuedReplacements ?? [],
    );

    return true;
  }

  /**
   * Map a warranty-submit failure to a customer-facing line so the bot NEVER goes silent on a
   * throw (concurrent double-tap, stock race, per-order cap, etc.). Service errors that are already
   * localized (contain non-ASCII vi/th text) are surfaced as-is; raw English/internal errors fall
   * back to a generic localized retry line so we don't leak internals.
   */
  private warrantySubmitErrorText(
    error: unknown,
    language: BotLanguage,
  ): string {
    const raw = String(
      (error as any)?.response?.message ??
        (error instanceof Error ? error.message : "") ??
        "",
    ).trim();
    const localized = raw && /[^\x00-\x7F]/.test(raw); // has vi/th diacritics → already user-facing
    if (localized) return `⚠️ ${raw}`;
    return language === "en"
      ? "⚠️ Could not create the warranty request right now. Please wait a moment and tap again, or contact the shop."
      : language === "th"
        ? "⚠️ ไม่สามารถสร้างคำขอรับประกันได้ในขณะนี้ กรุณารอสักครู่แล้วลองอีกครั้ง หรือติดต่อร้านค้า"
        : "⚠️ Chưa tạo được yêu cầu bảo hành lúc này. Vui lòng đợi giây lát rồi bấm lại, hoặc liên hệ shop.";
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
    issuedReplacements: string[] = [],
  ) {
    if (accounts.length <= 1) {
      let claim: Awaited<
        ReturnType<WarrantyService["submitTelegramWarrantyClaim"]>
      >;
      try {
        claim = await this.warrantyService.submitTelegramWarrantyClaim({
          shopId,
          telegramUserId,
          telegramChatId: String(chatId),
          orderCode,
          language: language === "zh" ? "en" : language,
        });
      } catch (error) {
        await this.editOrSend(
          token,
          chatId,
          messageId,
          this.warrantySubmitErrorText(error, language),
          { inline_keyboard: [[this.navBtn("home", language, "home:menu")]] },
          actions,
        );
        return;
      }
      await this.sendWarrantyClaimResult(
        token,
        chatId,
        claim,
        actions,
        language,
        shopId,
      );
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
        issuedReplacements,
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
    issuedReplacements: string[] = [],
  ) {
    await this.sessions.setPendingSession(
      "pendingWarrantyAccountSelections",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
      {
        orderCode,
        accounts,
        expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs,
      },
      this.sessions.pendingQuantityTtlMs,
    );

    const usernames = accounts.map((a) => (a.split("|")[0] || a).trim());
    const accountList = usernames.map((u, i) => `${i + 1}. ${u}`).join("\n");
    // Show accounts already replaced in a prior warranty (the new account is in the list above) so
    // the customer knows what was done and only re-warranties the one(s) still failing.
    const replacedUsernames = issuedReplacements
      .map((a) => (a.split("|")[0] || a).trim())
      .filter(Boolean);
    const issuedNote =
      replacedUsernames.length > 0
        ? language === "en"
          ? `✅ Already warrantied — new account(s) issued: ${replacedUsernames.join(", ")}`
          : language === "th"
            ? `✅ รับประกันแล้ว — บัญชีใหม่ที่ออกให้: ${replacedUsernames.join(", ")}`
            : `✅ Đã bảo hành trước đó — TK mới đã cấp: ${replacedUsernames.join(", ")}`
        : "";

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
        ...(issuedNote ? ["", issuedNote] : []),
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
        inline_keyboard: [[this.navBtn("home", language, "home:menu")]],
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
    const pending = await this.getPendingWarrantyAccountSelection(
      shopId,
      telegramUserId,
    );

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
          inline_keyboard: [[this.navBtn("home", language, "home:menu")]],
        },
        actions,
      );
      return true;
    }

    await this.clearPendingWarrantyAccountSelection(shopId, telegramUserId);

    const targetUsernames = input
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    let claim: Awaited<
      ReturnType<WarrantyService["submitTelegramWarrantyClaim"]>
    >;
    try {
      claim = await this.warrantyService.submitTelegramWarrantyClaim({
        shopId,
        telegramUserId,
        telegramChatId: String(message.chat?.id || telegramUserId),
        orderCode: pending.orderCode,
        targetUsernames,
        language: language === "zh" ? "en" : language,
      });
    } catch (error) {
      await this.editOrSend(
        token,
        Number(message.chat?.id || 0),
        undefined,
        this.warrantySubmitErrorText(error, language),
        { inline_keyboard: [[this.navBtn("home", language, "home:menu")]] },
        actions,
      );
      return true;
    }

    await this.sendWarrantyClaimResult(
      token,
      message.chat.id,
      claim,
      actions,
      language,
      shopId,
    );
    return true;
  }

  private async sendWarrantyClaimResult(
    token: string,
    chatId: number,
    claim: Awaited<ReturnType<WarrantyService["submitTelegramWarrantyClaim"]>>,
    actions: unknown[],
    language: BotLanguage = "vi",
    shopId?: string,
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
      if (claim.supportTelegram)
        lines.push(`Telegram: ${claim.supportTelegram}`);
      if (claim.supportZalo) lines.push(`Zalo: ${claim.supportZalo}`);
      // No contact configured → don't leave a dead-end "contact the shop" with nobody to contact.
      if (!claim.supportTelegram && !claim.supportZalo) {
        lines.push(
          language === "en"
            ? "Please reply right here in this chat — the shop will assist you."
            : language === "th"
              ? "กรุณาตอบกลับในแชทนี้ ทางร้านจะช่วยเหลือคุณ"
              : "Bạn cứ nhắn ngay trong khung chat này — shop sẽ hỗ trợ bạn.",
        );
      }
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
        (language === "en"
          ? "An error occurred."
          : language === "th"
            ? "เกิดข้อผิดพลาด"
            : "Đã xảy ra lỗi.");
    }

    const sent = await this.sendText(token, chatId, replyText, actions, {
      inline_keyboard: [
        [this.navBtn("history", language, "home:history")],
        [this.navBtn("warranty", language, "warranty:start")],
        [this.navBtn("home", language, "home:menu")],
      ],
    });

    // Edit-in-place: for the async auto-check path the worker later EDITS this "đang kiểm tra…"
    // message into the verdict/replacement (instead of sending a disconnected 2nd message). Anchor
    // its (chatId, messageId) onto the claim so deliverBotMessage can find + edit it.
    const claimId = (claim as { claimId?: string }).claimId;
    const messageId = Number((sent as { message_id?: number })?.message_id);
    const isMockToken =
      this.isSimulationToken(token) ||
      (this.config.mockTelegramEnabled && isMockBotToken(token));
    if (
      !isMockToken && // mock/sim sendText returns a fake message_id — don't persist a junk anchor
      shopId &&
      claimId &&
      Number.isFinite(messageId) &&
      messageId > 0 &&
      (claim.status === "auto_check_pending" ||
        claim.status === "auto_resolved_pending")
    ) {
      await this.warrantyService
        .updateBotProgressContext(claimId, { shopId, chatId, messageId })
        .catch(() => undefined);
    }
  }

  private async handlePendingTxHashMessage(
    shopId: string,
    token: string,
    message: TelegramUpdate,
    actions: unknown[],
  ) {
    const telegramUserId = String(message.from?.id || "");
    const language = await this.getCustomerLanguage(shopId, telegramUserId);
    let pending = await this.getPendingTxHashSubmission(shopId, telegramUserId);

    if (!pending) {
      // Fallback: detect tx hash format and try to match a recent pending USDT order
      const rawText = String(message.text || "").trim();
      const isTrc20Like = /^(0x)?[a-f0-9]{64}$/i.test(rawText);
      const isSolanaLike =
        /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(rawText) && !isTrc20Like;
      if (!isTrc20Like && !isSolanaLike) {
        return false;
      }
      const customer = await this.prisma.customer.findFirst({
        where: { shopId, telegramUserId },
        select: { id: true },
      });
      if (!customer) {
        return false;
      }
      const targetProvider = isSolanaLike
        ? PaymentProvider.USDT_SOL
        : PaymentProvider.USDT_TRC20;
      const recentPayment = await this.prisma.paymentTransaction.findFirst({
        where: {
          provider: targetProvider,
          status: PaymentTransactionStatus.PENDING,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          order: { customerId: customer.id, shopId },
        },
        orderBy: { createdAt: "desc" },
        select: {
          externalOrderCode: true,
          order: { select: { orderCode: true } },
        },
      });
      const recentTopup = recentPayment
        ? null
        : await this.prisma.customerWalletTopup.findFirst({
            where: {
              provider: targetProvider,
              status: PaymentTransactionStatus.PENDING,
              customerId: customer.id,
              shopId,
              createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            },
            orderBy: { createdAt: "desc" },
            select: { externalOrderCode: true },
          });
      if (!recentPayment && !recentTopup) {
        return false;
      }
      pending = {
        externalOrderCode: (recentPayment?.externalOrderCode ||
          recentTopup?.externalOrderCode) as string,
        orderCode:
          recentPayment?.order?.orderCode ||
          recentTopup?.externalOrderCode ||
          "",
        isTopup: !recentPayment && !!recentTopup,
        allowMockHash: false,
        expiresAt: Date.now() + this.sessions.pendingTxHashTtlMs,
        provider: isSolanaLike ? "USDT_SOL" : "USDT_TRC20",
      };
      await this.sessions.setPendingSession(
        "pendingTxHashSubmissions",
        this.sessions.getPendingQuantityKey(shopId, telegramUserId),
        pending,
        this.sessions.pendingTxHashTtlMs,
      );
    }

    try {
      const rawTxHash = String(message.text || "").trim();

      if (pending.isTopup) {
        const topupResult =
          pending.allowMockHash && /^mock:/i.test(rawTxHash)
            ? await (async () => {
                await this.prisma.customerWalletTopup.update({
                  where: { externalOrderCode: pending.externalOrderCode },
                  data: { cryptoTxHash: rawTxHash },
                });
                await this.customerWalletService.markTopupPaid(
                  pending.externalOrderCode,
                  {
                    source: "simulate_mock_trc20_tx_hash",
                    txHash: rawTxHash,
                  },
                );
                return {
                  alreadyPaid: false,
                  txHash: rawTxHash,
                  verification: { amountUsdt: 0 },
                };
              })()
            : pending.provider === "USDT_SOL"
              ? await this.solanaPaymentService.submitTelegramSolTopupTxHash({
                  shopId,
                  telegramUserId,
                  externalOrderCode: pending.externalOrderCode,
                  signature: rawTxHash,
                })
              : await this.onchainPaymentService.submitTelegramTopupTxHash({
                  shopId,
                  telegramUserId,
                  externalOrderCode: pending.externalOrderCode,
                  txHash: rawTxHash,
                });

        await this.clearPendingTxHashSubmission(shopId, telegramUserId);

        await this.sendText(
          token,
          message.chat.id,
          topupResult.alreadyPaid
            ? language === "en"
              ? "✅ This topup has already been confirmed."
              : language === "th"
                ? "✅ รายการเติมเงินนี้ได้รับการยืนยันแล้ว"
                : "✅ Lệnh nạp ví này đã được xác nhận rồi."
            : [
                language === "en"
                  ? "✅ TX hash verified — wallet topped up!"
                  : language === "th"
                    ? "✅ ยืนยัน TX hash สำเร็จ — เติมเงินกระเป๋าแล้ว!"
                    : "✅ Đã xác minh TX hash — ví đã được nạp tiền!",
                `TX hash: ${topupResult.txHash}`,
                ...((topupResult.verification?.amountUsdt || 0) > 0
                  ? [
                      language === "en"
                        ? `Confirmed: ${this.formatUsdt(topupResult.verification?.amountUsdt || 0)} USDT`
                        : language === "th"
                          ? `ยืนยันแล้ว: ${this.formatUsdt(topupResult.verification?.amountUsdt || 0)} USDT`
                          : `Số tiền xác nhận: ${this.formatUsdt(topupResult.verification?.amountUsdt || 0)} USDT`,
                    ]
                  : []),
              ].join("\n"),
          actions,
          {
            inline_keyboard: [
              [
                {
                  text:
                    language === "en"
                      ? "💳 View wallet"
                      : language === "th"
                        ? "💳 ดูกระเป๋าเงิน"
                        : "💳 Xem ví",
                  callback_data: "home:wallet",
                },
              ],
              [this.navBtn("home", language, "home:menu")],
            ],
          },
        );
        return true;
      }

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
          : pending.provider === "USDT_SOL"
            ? await this.solanaPaymentService.submitTelegramSolTxHash({
                shopId,
                telegramUserId,
                externalOrderCode: pending.externalOrderCode,
                signature: rawTxHash,
              })
            : await this.onchainPaymentService.submitTelegramTxHash({
                shopId,
                telegramUserId,
                externalOrderCode: pending.externalOrderCode,
                txHash: rawTxHash,
              });

      await this.clearPendingTxHashSubmission(shopId, telegramUserId);

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
              this.navBtn("history", language, "home:history"),
              this.navBtn("productsShort", language, "home:products"),
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
            [
              {
                text: this.buttonLabel("txHash", language),
                callback_data: pending.isTopup
                  ? `txhash:topup:${pending.externalOrderCode}`
                  : `txhash:submit:${pending.externalOrderCode}`,
              },
            ],
            [
              {
                text: pending.isTopup
                  ? language === "en"
                    ? "💳 View wallet"
                    : language === "th"
                      ? "💳 ดูกระเป๋าเงิน"
                      : "💳 Xem ví"
                  : this.buttonLabel("history", language),
                callback_data: pending.isTopup ? "home:wallet" : "home:history",
              },
            ],
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
    const selection = await this.getPendingQuantitySelection(
      shopId,
      telegramUserId,
    );

    if (!selection) {
      return false;
    }

    let quantity: number;
    let customerEmail: string | null = null;

    if (selection.requiresCustomerEmail) {
      const parsed = parseCustomerEmailList(message.text);
      const exceedsStock =
        selection.maxQuantity !== null &&
        parsed.nonEmptyLineCount > selection.maxQuantity;

      if (!hasValidCustomerEmailList(parsed) || exceedsStock) {
        let errorText: string;
        if (parsed.nonEmptyLineCount === 0) {
          errorText =
            language === "en"
              ? "❌ Please enter at least one email."
              : language === "th"
                ? "❌ กรุณากรอกอีเมลอย่างน้อยหนึ่งรายการ"
                : "❌ Vui lòng nhập ít nhất một email.";
        } else if (parsed.invalidLineNumbers.length > 0) {
          const lines = parsed.invalidLineNumbers.join(", ");
          errorText =
            language === "en"
              ? `❌ Invalid email on line(s): ${lines}.`
              : language === "th"
                ? `❌ อีเมลไม่ถูกต้องในบรรทัด: ${lines}`
                : `❌ Email chưa hợp lệ ở dòng: ${lines}.`;
        } else if (parsed.duplicateEmails.length > 0) {
          errorText =
            language === "en"
              ? "❌ Duplicate emails are not allowed."
              : language === "th"
                ? "❌ ไม่อนุญาตให้ใช้อีเมลซ้ำ"
                : "❌ Danh sách có email bị trùng. Vui lòng kiểm tra lại.";
        } else {
          errorText =
            language === "en"
              ? `❌ You can enter at most ${selection.maxQuantity} email(s).`
              : language === "th"
                ? `❌ กรอกได้สูงสุด ${selection.maxQuantity} อีเมล`
                : `❌ Chỉ được nhập tối đa ${selection.maxQuantity} email.`;
        }

        await this.sendText(
          token,
          message.chat.id,
          this.buildCustomerEmailPromptText(
            selection.maxQuantity,
            language,
            errorText,
          ),
          actions,
          {
            inline_keyboard: [[this.navBtn("back", language, "home:products")]],
          },
        );
        return true;
      }

      quantity = parsed.emails.length;
      customerEmail = parsed.emails.join("\n");
    } else {
      const parsedQuantity = this.parseQuantityMessage(
        message.text,
        selection.maxQuantity,
      );
      if (!parsedQuantity) {
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
      quantity = parsedQuantity;
    }

    try {
      const customer = {
        telegramUserId,
        telegramChatId: String(message.chat.id || telegramUserId),
        telegramUsername: message.from?.username || null,
        firstName: message.from?.first_name || null,
        lastName: message.from?.last_name || null,
        customerEmail,
      };

      const merchandiseAmount = this.getPromotionalTotal(
        selection,
        quantity,
        selection.salePrice,
      );
      const paymentProviders = await this.getAvailablePaymentOptions(
        shopId,
        telegramUserId,
        this.getPreorderPreviewAmounts(selection, merchandiseAmount)
          .totalAmount,
      );

      if (paymentProviders.length === 0) {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.sendText(
          token,
          message.chat.id,
          language === "en"
            ? "This shop has no available payment method. Please contact the shop owner."
            : language === "th"
              ? "ร้านค้ายังไม่มีวิธีชำระเงินที่พร้อมใช้งาน กรุณาติดต่อเจ้าของร้าน"
              : "Shop chưa có phương thức thanh toán khả dụng. Vui lòng liên hệ chủ shop.",
          actions,
          {
            inline_keyboard: [
              [
                this.navBtn("products", language, "home:products"),
                this.navBtn("home", language, "home:menu"),
              ],
            ],
          },
        );
        return true;
      }

      if (paymentProviders.length > 1) {
        await this.clearPendingQuantitySelection(shopId, telegramUserId);
        await this.sessions.setPendingSession(
          "pendingPaymentSelections",
          this.sessions.getPendingQuantityKey(shopId, telegramUserId),
          {
            sourceProductId: selection.sourceProductId,
            quantity,
            ...customer,
            expiresAt: Date.now() + this.sessions.pendingPaymentTtlMs,
          },
          this.sessions.pendingPaymentTtlMs,
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
          inline_keyboard: [
            [
              {
                text: this.buttonLabel("back", language),
                callback_data: "home:products",
              },
            ],
          ],
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
    const pending = await this.getPendingWalletTopup(shopId, telegramUserId);

    if (!pending) {
      return false;
    }

    const currency = pending.currency;
    const isUsdt = currency === "USDT";

    // Parse amount based on currency
    let vndAmount: number;
    if (isUsdt) {
      const usdtInput = parseFloat(
        String(message.text || "")
          .trim()
          .replace(",", "."),
      );
      if (!isFinite(usdtInput) || usdtInput < 1) {
        await this.promptWalletTopupAmount(
          shopId,
          token,
          Number(message.chat.id),
          telegramUserId,
          actions,
          "USDT",
          language === "en"
            ? "❌ Invalid USDT amount. Minimum is 1 USDT."
            : language === "th"
              ? "❌ จำนวน USDT ไม่ถูกต้อง ขั้นต่ำ 1 USDT"
              : "❌ Số USDT không hợp lệ. Tối thiểu 1 USDT.",
          language,
          pending.provider,
        );
        return true;
      }
      const rate = await this.getShopUsdtVndRate(shopId);
      const rateNum = Number(rate || 27000);
      vndAmount = Math.round(usdtInput * rateNum);
    } else {
      const parsed = this.parseWalletTopupAmount(message.text);
      if (!parsed) {
        await this.promptWalletTopupAmount(
          shopId,
          token,
          Number(message.chat.id),
          telegramUserId,
          actions,
          "VND",
          language === "en"
            ? "❌ Invalid amount. Please enter an integer from 1,000 VND."
            : language === "th"
              ? "❌ จำนวนเงินไม่ถูกต้อง กรุณาระบุจำนวนเต็มตั้งแต่ 1,000 VND ขึ้นไป"
              : "❌ Số tiền không hợp lệ. Vui lòng nhập số nguyên từ 1.000đ trở lên.",
          language,
        );
        return true;
      }
      vndAmount = parsed;
    }

    const providerOverride = isUsdt
      ? (pending.provider as PaymentProvider | undefined) ||
        PaymentProvider.USDT_TRC20
      : undefined;

    try {
      const created = await this.customerWalletService.createTopupForTelegram({
        shopId,
        amount: vndAmount,
        customer: {
          telegramUserId,
          telegramChatId: String(message.chat.id || telegramUserId),
          telegramUsername: message.from?.username || null,
          firstName: message.from?.first_name || null,
          lastName: message.from?.last_name || null,
        },
        providerOverride,
      });

      await this.clearPendingWalletTopup(shopId, telegramUserId);

      let qrBuffer = created.bankInfo
        ? await this.downloadVietQrAsBuffer(
            created.bankInfo,
            created.topup.amount,
          )
        : null;
      if (!qrBuffer)
        qrBuffer = this.decodeDataUriToBuffer(created.topup.qrCode);
      const qrFallbackUrl = qrBuffer
        ? null
        : this.buildQrImageUrl(created.topup.qrCode);
      const usdtVndRate = await this.getShopUsdtVndRate(shopId);
      const text = this.buildWalletTopupInstructionText(
        created.topup.amount,
        created.topup.externalOrderCode,
        created.topup.expiresAt,
        language,
        usdtVndRate,
        created.bankInfo,
        created.manualCrypto,
      );

      const replyMarkup = {
        inline_keyboard: [
          ...(this.isPublicCheckoutUrl(created.topup.checkoutUrl)
            ? [
                [
                  {
                    text: this.buttonLabel("openCheckout", language),
                    url: created.topup.checkoutUrl,
                  },
                ],
              ]
            : []),
          ...(isUsdt && pending.provider !== "USDT_TON"
            ? [
                [
                  {
                    text: this.buttonLabel("txHash", language),
                    callback_data: `txhash:topup:${created.topup.externalOrderCode}`,
                  },
                ],
              ]
            : []),
          [
            {
              text:
                language === "en"
                  ? "💳 View wallet"
                  : language === "th"
                    ? "💳 ดูกระเป๋าเงิน"
                    : "💳 Xem ví",
              callback_data: "home:wallet",
            },
            this.navBtn("home", language, "home:menu"),
          ],
        ],
      };

      let sentMessageId: number | null = null;
      if (qrBuffer || qrFallbackUrl) {
        sentMessageId = await this.sendPhoto(
          token,
          message.chat.id,
          qrBuffer ?? qrFallbackUrl!,
          text,
          actions,
          replyMarkup,
          "HTML",
        );
      } else {
        const result = await this.sendText(
          token,
          message.chat.id,
          text,
          actions,
          replyMarkup,
          "HTML",
        );
        sentMessageId =
          result && typeof result === "object" && "message_id" in result
            ? (result as { message_id: number }).message_id
            : null;
      }

      if (sentMessageId) {
        await this.sessions.setPendingSession(
          "pendingQrMessages",
          created.topup.externalOrderCode,
          {
            token,
            chatId: message.chat.id,
            messageId: sentMessageId,
          },
          30 * 60 * 1000,
        );
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
        currency,
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
        pending.provider,
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

    const qrMsg = await this.sessions.getPendingSession<{
      token: string;
      chatId: string | number;
      messageId: number;
    }>("pendingQrMessages", externalOrderCode);
    if (qrMsg) {
      await telegramDeleteMessage(
        qrMsg.token,
        qrMsg.chatId,
        qrMsg.messageId,
      ).catch(() => undefined);
      await this.sessions.delPendingSession(
        "pendingQrMessages",
        externalOrderCode,
      );
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
              text:
                language === "en"
                  ? "💳 View wallet"
                  : language === "th"
                    ? "💳 ดูกระเป๋าเงิน"
                    : "💳 Xem ví",
              callback_data: "home:wallet",
            },
            {
              text:
                language === "en"
                  ? "🛍️ Products"
                  : language === "th"
                    ? "🛍️ สินค้า"
                    : "🛍️ Xem sản phẩm",
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
          [
            {
              text:
                language === "en"
                  ? "🏦 Top up again"
                  : language === "th"
                    ? "🏦 เติมเงินอีกครั้ง"
                    : "🏦 Nạp lại",
              callback_data: "wallet:topup",
            },
          ],
          [
            {
              text:
                language === "en"
                  ? "💳 View wallet"
                  : language === "th"
                    ? "💳 ดูกระเป๋าเงิน"
                    : "💳 Xem ví",
              callback_data: "home:wallet",
            },
          ],
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
    const upstreamShop =
      await this.shopsService.getSellerShopByShopId(upstreamShopId);
    const upstreamToken = decryptSecret(
      upstreamShop.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (
      upstreamToken &&
      upstreamShop.supportTelegram &&
      !(this.config.mockTelegramEnabled && isMockBotToken(upstreamToken))
    ) {
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

    if (
      downstreamCustomer?.telegramChatId &&
      upstreamToken &&
      !(this.config.mockTelegramEnabled && isMockBotToken(upstreamToken))
    ) {
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
      /** Optional price snapshot from the caller. If omitted the current catalog salePrice is used. */
      price?: number | null;
    }>,
  ) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return 0;
    }

    // One fetch for the shop — used to grab the bot token AND (via botConfig.customizationJson)
    // the shop-level customization for buttons. Previously we called getSellerShopByShopId twice.
    const shopData = await this.shopsService.getSellerShopByShopId(shopId);
    const token = decryptSecret(
      shopData.botConfig?.telegramBotTokenEncrypted,
      this.config.encryptionKey,
    );

    if (!token) {
      return 0;
    }

    if (this.config.mockTelegramEnabled && isMockBotToken(token)) {
      return 0;
    }

    // Prepare shared data once (catalog map, template, customization) before iterating chunks.
    const catalog = await this.shopsService.getCatalogViewForShop(
      shopId,
      false,
      false,
      true,
    );
    const shopCustNotif = await this.resolveCustomization(
      (shopData.botConfig?.customizationJson as Record<
        string,
        unknown
      > | null) ?? null,
    );
    const custDataNotif = {
      custEmojis:
        shopCustNotif?.buttonEmojis &&
        typeof shopCustNotif.buttonEmojis === "object"
          ? (shopCustNotif.buttonEmojis as Record<string, string>)
          : {},
      custLabels:
        shopCustNotif?.buttonLabels &&
        typeof shopCustNotif.buttonLabels === "object"
          ? (shopCustNotif.buttonLabels as Record<
              string,
              Record<string, string>
            >)
          : {},
      custEmojiIds:
        shopCustNotif?.buttonEmojiIds &&
        typeof shopCustNotif.buttonEmojiIds === "object"
          ? (shopCustNotif.buttonEmojiIds as Record<string, string>)
          : {},
    };
    // Restock message body comes from the admin-configurable template (shop override > admin > default).
    const restockTemplate =
      await this.shopsService.resolveRestockTemplateForShop(shopId);
    const restockUsdtVndRate = this.resolveUsdtVndRate(
      shopData.paymentConfig?.usdtVndRateOverride,
    );
    // Bling (cusid) is gated on the shop OWNER's premium — same for every recipient of this broadcast.
    const canBlingNotif = await this.resolveCanBling(shopId);
    const productByExternalId = new Map(
      catalog.map((item) => [item.sourceProductId, item]),
    );

    // De-dup: claim each (product, available) restock once per window — keyed by sourceProductId
    // (shared with the worker + sync notify paths) so a restock already broadcast by another path
    // isn't re-sent here. Collapses the "Thông báo nhập kho" burst.
    const claimedUpdates: typeof updates = [];
    for (const update of updates) {
      const product = productByExternalId.get(update.externalProductId);
      if (!product) continue;
      if (
        await this.shopsService.claimRestockNotification(
          shopId,
          product.sourceProductId,
          update.available,
        )
      ) {
        claimedUpdates.push(update);
      }
    }
    if (claimedUpdates.length === 0) {
      return 0;
    }

    // Stream customers in cursor-paginated chunks — a 100k-customer shop restock previously
    // loaded the whole list into memory + fanned out N×M sends before yielding. Chunking:
    //   1. Keeps heap flat regardless of shop size.
    //   2. Lets Telegram rate-limiter breathe between batches.
    const CHUNK = 500;
    let cursorId: string | undefined = undefined;
    let sentCount = 0;

    while (true) {
      const customers: Array<{
        id: string;
        telegramChatId: string;
        preferredLanguage: string | null;
      }> = await this.prisma.customer.findMany({
        where: { shopId },
        orderBy: { id: "asc" },
        take: CHUNK,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select: {
          id: true,
          telegramChatId: true,
          preferredLanguage: true,
        },
      });

      if (customers.length === 0) break;

      for (const customer of customers) {
        for (const update of claimedUpdates) {
          const product = productByExternalId.get(update.externalProductId);

          const customerLang = this.normalizeLanguage(
            customer.preferredLanguage,
          );

          if (!product || product.hidden || !product.enabled) {
            continue;
          }

          if (customerLang === "vi" && product.hiddenVi) continue;
          if (customerLang === "en" && product.hiddenEn) continue;

          const productName = this.localizeProductName(
            product.displayName || update.displayName,
            customerLang,
          );
          // Prefer the caller-provided snapshot (matches the price at the moment the restock
          // event happened). Fall back to the current catalog salePrice only if the caller
          // did not supply one — this covers manual-upload paths that don't have the
          // per-product override handy at the time they call this method.
          let priceForRender: number | null = null;
          if (
            update.price != null &&
            Number.isFinite(update.price) &&
            update.price > 0
          ) {
            priceForRender = Number(update.price);
          } else {
            const catalogPrice = Number((product as any)?.salePrice);
            priceForRender =
              Number.isFinite(catalogPrice) && catalogPrice > 0
                ? catalogPrice
                : null;
          }
          const rendered = renderRestockHtml(restockTemplate, {
            productName,
            addedQuantity: update.addedQuantity,
            available: update.available,
            price: priceForRender,
            usdtVndRate: restockUsdtVndRate,
            productIcon: product.productIcon ?? null,
            productIconCustomEmojiId: product.iconCustomEmojiId ?? null,
            language: customerLang === "zh" ? "en" : customerLang,
          });

          await this.sendText(
            token,
            customer.telegramChatId,
            rendered.text,
            [],
            {
              inline_keyboard: [
                [
                  this.buildNavTextBtn(
                    custDataNotif,
                    "buyNow",
                    "buyNow",
                    `buy:${product.id}`,
                    customerLang,
                    canBlingNotif,
                  ),
                ],
              ],
            },
            rendered.hasHtml ? "HTML" : undefined,
          ).catch(() => undefined);

          sentCount += 1;
        }
      }

      if (customers.length < CHUNK) break;
      const last = customers[customers.length - 1];
      if (!last) break;
      cursorId = last.id;
    }

    return sentCount;
  }

  private async sendQuantityReplyPrompt(
    shopId: string,
    token: string,
    chatId: string | number,
    telegramUserId: string,
    selection:
      | Omit<PendingQuantitySelection, "expiresAt">
      | PendingQuantitySelection,
    actions: unknown[],
    leadLine?: string,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    const shopData = await this.shopsService
      .getSellerShopByShopId(shopId)
      .catch(() => null);
    const cust = await this.resolveCustomization(
      (shopData?.botConfig?.customizationJson as Record<
        string,
        unknown
      > | null) ?? null,
    );
    const productNoteMap =
      cust?.productNote && typeof cust.productNote === "object"
        ? (cust.productNote as Record<string, string>)
        : {};
    const msgEmojiIds =
      cust?.messageEmojiIds && typeof cust.messageEmojiIds === "object"
        ? (cust.messageEmojiIds as Record<string, string>)
        : {};
    const labelEmojiIds =
      cust?.labelEmojiIds && typeof cust.labelEmojiIds === "object"
        ? (cust.labelEmojiIds as Record<string, string>)
        : {};
    const labelEmojis =
      cust?.labelEmojis && typeof cust.labelEmojis === "object"
        ? (cust.labelEmojis as Record<string, string>)
        : {};
    const custEmojiIdsQty =
      cust?.buttonEmojiIds && typeof cust.buttonEmojiIds === "object"
        ? (cust.buttonEmojiIds as Record<string, string>)
        : {};
    const productNoteRaw =
      productNoteMap[language]?.trim() || productNoteMap["vi"]?.trim() || "";
    const productNoteEmojiIdRaw = msgEmojiIds["productNote"]?.trim() || "";
    const productNoteEmojiId = /^\d+$/.test(productNoteEmojiIdRaw)
      ? productNoteEmojiIdRaw
      : "";
    const safeProductNote = this.render.sanitizeTelegramHtml(productNoteRaw);
    const productNote = safeProductNote
      ? productNoteEmojiId
        ? `<tg-emoji emoji-id="${productNoteEmojiId}">💬</tg-emoji> ${safeProductNote}`
        : safeProductNote
      : "";

    const dbEmojiIdRaw = selection.iconCustomEmojiId?.trim() || "";
    const dbEmojiId = /^\d+$/.test(dbEmojiIdRaw) ? dbEmojiIdRaw : "";
    const customEmoji = !dbEmojiId
      ? this.resolveCustomEmojiId(selection.displayName, selection.sourceName)
      : null;
    const staticEmojiChar =
      customEmoji?.char ||
      this.resolveProductEmoji(selection.displayName, selection.sourceName);
    const localizedName = this.localizeProductName(
      selection.displayName,
      language,
    );
    const priceStr = this.formatBotMoneyWithUsdOverride(
      selection.salePrice,
      (selection as any).salePriceUsd,
      language,
      usdtVndRate,
    );
    const stockLabel = selection.isPreorderOnly
      ? language === "en"
        ? `Pre-order (+${selection.preorderFeePercent ?? 0}% fee)`
        : language === "th"
          ? `สั่งจองล่วงหน้า (+${selection.preorderFeePercent ?? 0}%)`
          : `Đặt trước (+${selection.preorderFeePercent ?? 0}% phí)`
      : selection.available === null
        ? "∞"
        : String(Math.max(0, selection.available));
    // Per-viewer: premium + a cusid → cusid icon only; everyone else → the text emoji (never blank).
    const buyOtherCustomEmoji = custEmojiIdsQty["buyOther"];
    const isPremiumQty = await this.resolveCanBling(shopId);
    const buyOtherFull = this.buttonLabel("buyOther", language);
    const replyMarkup = {
      inline_keyboard: [
        [
          this.buildViewerBtn(
            {
              textEmoji: buyOtherFull.split(" ")[0] ?? "",
              label: buyOtherFull.split(" ").slice(1).join(" "),
              cusid: buyOtherCustomEmoji,
              isPremium: isPremiumQty,
            },
            { callback_data: "home:products" },
          ),
        ],
      ],
    };
    const quantityLine = this.buildQuantityPromptText(
      selection.maxQuantity,
      language,
      msgEmojiIds["quantityInput"] || "",
    );
    const preorderPrompt = selection.isPreorderOnly
      ? language === "en"
        ? `🕒 This item is out of stock. Enter the quantity to pre-order. A ${selection.preorderFeePercent ?? 0}% fee applies; paid orders are delivered automatically in FIFO order when stock arrives.`
        : language === "th"
          ? `🕒 สินค้าหมด กรุณาระบุจำนวนที่ต้องการจอง มีค่าจอง ${selection.preorderFeePercent ?? 0}% และบอทจะจัดส่งอัตโนมัติตามลำดับ FIFO เมื่อมีสินค้า`
          : `🕒 Sản phẩm đang hết hàng. Nhập số lượng muốn đặt trước. Phí đặt trước ${selection.preorderFeePercent ?? 0}%; đơn đã thanh toán sẽ được bot tự giao theo thứ tự FIFO khi có hàng.`
      : "";
    const nextStepPromptBase = selection.requiresCustomerEmail
      ? this.buildCustomerEmailPromptText(selection.maxQuantity, language)
      : quantityLine;
    const nextStepPrompt = preorderPrompt
      ? `${preorderPrompt}\n\n${nextStepPromptBase}`
      : nextStepPromptBase;
    const hasLabelEmojis = Object.values(labelEmojiIds).some((v) =>
      /^\d+$/.test(v?.trim() || ""),
    );
    const sellerDescription = selection.description?.trim() || "";
    const sourceDescription = selection.providerDescription?.trim() || "";
    // Once a reseller explicitly edits (or clears) the description, their choice is
    // authoritative. Otherwise show the provider copy, falling back to sourceDescription
    // for providers that do not expose a separate providerDescription metadata field.
    const regularDescription =
      selection.sourceDescriptionLocked || !sourceDescription
        ? sellerDescription
        : "";
    const providerDescription = selection.sourceDescriptionLocked
      ? ""
      : sourceDescription;
    // Force HTML mode when a description exists so Telegram formatting renders safely.
    const useHtml = !!(
      dbEmojiId ||
      productNoteEmojiId ||
      hasLabelEmojis ||
      regularDescription ||
      providerDescription
    );

    const mkLabel = (key: string, fallback: string) => {
      const customChar = labelEmojis[key]?.trim();
      const visibleRaw = customChar || fallback;
      const visible = useHtml ? this.escapeHtml(visibleRaw) : visibleRaw;
      const eidRaw = labelEmojiIds[key]?.trim() || "";
      const eid = /^\d+$/.test(eidRaw) ? eidRaw : "";
      return eid
        ? `<tg-emoji emoji-id="${eid}">${visible}</tg-emoji>`
        : visible;
    };

    if (selection.imageUrl && !leadLine) {
      // Rich photo card
      let nameLine: string;
      if (dbEmojiId) {
        nameLine = `<tg-emoji emoji-id="${dbEmojiId}">${staticEmojiChar}</tg-emoji> ${this.escapeHtml(localizedName)}`;
      } else {
        nameLine = `${staticEmojiChar} ${this.escapeHtml(localizedName)}`;
      }

      const priceLabel =
        language === "en" ? "Price" : language === "th" ? "ราคา" : "Giá";
      const stockLabelText =
        language === "en"
          ? "In stock"
          : language === "th"
            ? "ในคลัง"
            : "Tồn kho";
      const soldLabel =
        language === "en" ? "Sold" : language === "th" ? "ขายแล้ว" : "Đã bán";
      const descLabel =
        language === "en"
          ? "Description"
          : language === "th"
            ? "รายละเอียด"
            : "Mô tả";
      const unitLabel =
        language === "en"
          ? "accounts"
          : language === "th"
            ? "บัญชี"
            : "tài khoản";
      const formatLabel =
        language === "en"
          ? "Format"
          : language === "th"
            ? "รูปแบบ"
            : "Định dạng";

      const escFn = useHtml
        ? (s: string) => this.escapeHtml(s)
        : (s: string) => s;
      const lines: string[] = [
        nameLine,
        `${mkLabel("price", "💳")} ${priceLabel}: ${escFn(priceStr)}`,
        `${mkLabel("stock", "📦")} ${stockLabelText}: ${stockLabel} ${unitLabel}`,
      ];

      lines.push(
        `${mkLabel("sold", "📊")} ${soldLabel}: ${selection.soldCount ?? 0} ${unitLabel}`,
      );

      if ((selection as any).deliveryFormatHint?.trim()) {
        lines.push(
          ``,
          `${mkLabel("format", "🔑")} ${formatLabel}: ${escFn((selection as any).deliveryFormatHint.trim())}`,
        );
      }
      if (regularDescription) {
        // Photo caption budget is tight (Telegram hard limit 1024) → keep description short.
        lines.push(
          ``,
          this.buildProductDescBlock(
            regularDescription,
            `${mkLabel("description", "💬")} ${descLabel}:`,
            escFn,
            language,
            { maxLines: 20, maxChars: 700 },
          ),
        );
      }

      if (providerDescription) {
        lines.push(
          ``,
          this.buildProviderDescriptionItalic(
            providerDescription,
            `${mkLabel("description", "💬")} ${descLabel}:`,
            escFn,
            { maxLines: 15, maxChars: 600 },
          ),
        );
      }

      if (selection.promoBanner) {
        lines.push(``, `🎉 <b>${escFn(selection.promoBanner)}</b>`);
      }

      if (productNote) lines.push(``, productNote);

      const caption = this.clampTelegramHtml(lines.join("\n"), 1024);

      const captionEntities =
        !useHtml && customEmoji
          ? [
              {
                type: "custom_emoji",
                offset: 0,
                length: 2,
                custom_emoji_id: customEmoji.id,
              },
            ]
          : undefined;

      if (
        this.isSimulationToken(token) ||
        (this.config.mockTelegramEnabled && isMockBotToken(token))
      ) {
        actions.push({
          type: "sendPhoto",
          chatId,
          photo: selection.imageUrl,
          caption,
          replyMarkup,
        });
      } else {
        const sendOptions = {
          caption,
          reply_markup: replyMarkup,
          ...(useHtml
            ? { parse_mode: "HTML" }
            : captionEntities
              ? { caption_entities: captionEntities }
              : {}),
        };
        if (isVideoUrl(selection.imageUrl)) {
          await telegramSendVideo(
            token,
            chatId,
            selection.imageUrl,
            sendOptions,
          );
        } else {
          await telegramSendPhoto(
            token,
            chatId,
            selection.imageUrl,
            sendOptions,
          );
        }
      }
    } else {
      // Full-detail text message (no photo)
      const priceLabel =
        language === "en" ? "Price" : language === "th" ? "ราคา" : "Giá";
      const stockLabelText =
        language === "en"
          ? "In stock"
          : language === "th"
            ? "ในคลัง"
            : "Tồn kho";
      const soldLabel =
        language === "en" ? "Sold" : language === "th" ? "ขายแล้ว" : "Đã bán";
      const descLabel =
        language === "en"
          ? "Description"
          : language === "th"
            ? "รายละเอียด"
            : "Mô tả";
      const unitLabel =
        language === "en"
          ? "accounts"
          : language === "th"
            ? "บัญชี"
            : "tài khoản";
      const formatLabel =
        language === "en"
          ? "Format"
          : language === "th"
            ? "รูปแบบ"
            : "Định dạng";

      const escFn = useHtml
        ? (s: string) => this.escapeHtml(s)
        : (s: string) => s;

      let nameLine: string;
      if (dbEmojiId) {
        nameLine = `<tg-emoji emoji-id="${dbEmojiId}">${staticEmojiChar}</tg-emoji> <b>${this.escapeHtml(localizedName)}</b>`;
      } else if (customEmoji) {
        nameLine = `<tg-emoji emoji-id="${customEmoji.id}">${customEmoji.char}</tg-emoji> <b>${this.escapeHtml(localizedName)}</b>`;
      } else {
        nameLine = `${staticEmojiChar} <b>${this.escapeHtml(localizedName)}</b>`;
      }

      const textLines: string[] = [nameLine];

      if (leadLine) {
        textLines.push(``, this.escapeHtml(leadLine));
      }

      textLines.push(
        `${mkLabel("price", "💳")} ${priceLabel}: ${escFn(priceStr)}`,
        `${mkLabel("stock", "📦")} ${stockLabelText}: ${stockLabel} ${unitLabel}`,
      );

      textLines.push(
        `${mkLabel("sold", "📊")} ${soldLabel}: ${selection.soldCount ?? 0} ${unitLabel}`,
      );

      if ((selection as any).deliveryFormatHint?.trim()) {
        textLines.push(
          ``,
          `${mkLabel("format", "🔑")} ${formatLabel}: ${escFn((selection as any).deliveryFormatHint.trim())}`,
        );
      }
      if (regularDescription) {
        textLines.push(
          ``,
          this.buildProductDescBlock(
            regularDescription,
            `${mkLabel("description", "💬")} ${descLabel}:`,
            escFn,
            language,
            { maxLines: 60, maxChars: 3500 },
          ),
        );
      }

      if (providerDescription) {
        textLines.push(
          ``,
          this.buildProviderDescriptionItalic(
            providerDescription,
            `${mkLabel("description", "💬")} ${descLabel}:`,
            escFn,
            { maxLines: 50, maxChars: 3000 },
          ),
        );
      }

      if (selection.promoBanner) {
        textLines.push(``, `🎉 <b>${escFn(selection.promoBanner)}</b>`);
      }

      if (productNote) textLines.push(``, productNote);

      const fullText = this.clampTelegramHtml(textLines.join("\n"), 4096);

      await this.sendText(
        token,
        chatId,
        fullText,
        actions,
        replyMarkup,
        "HTML",
      );
    }

    // Keep the next-step instruction outside the product caption/text. Telegram truncates
    // photo captions at 1024 characters, so a long source description could otherwise hide
    // the quantity prompt completely and leave the buyer with only the "choose another"
    // button visible.
    await this.sendText(
      token,
      chatId,
      nextStepPrompt,
      actions,
      undefined,
      "HTML",
    );

    await this.sessions.setPendingSession(
      "pendingQuantitySelections",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
      {
        sourceProductId: selection.sourceProductId,
        displayName: selection.displayName,
        sourceName: (selection as any).sourceName ?? null,
        salePrice: selection.salePrice,
        salePriceUsd: (selection as any).salePriceUsd ?? null,
        available: selection.available,
        maxQuantity: selection.maxQuantity,
        imageUrl: selection.imageUrl ?? null,
        description: selection.description ?? null,
        providerDescription: selection.providerDescription ?? null,
        sourceDescriptionLocked: selection.sourceDescriptionLocked === true,
        soldCount: selection.soldCount ?? null,
        deliveryFormatHint: (selection as any).deliveryFormatHint ?? null,
        iconCustomEmojiId: selection.iconCustomEmojiId ?? null,
        promoMessage: selection.promoMessage ?? null,
        promoType: selection.promoType ?? null,
        promoBulkMinQty: selection.promoBulkMinQty ?? null,
        promoBulkDiscountPct: selection.promoBulkDiscountPct ?? null,
        promoStartAt: selection.promoStartAt ?? null,
        promoEndAt: selection.promoEndAt ?? null,
        requiresCustomerEmail: selection.requiresCustomerEmail === true,
        preorderEnabled: selection.preorderEnabled === true,
        preorderFeePercent: selection.preorderFeePercent ?? 0,
        isPreorderOnly: selection.isPreorderOnly === true,
        expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs,
      },
      this.sessions.pendingQuantityTtlMs,
    );
  }

  /**
   * Build the <blockquote>-wrapped product description with hard caps. A long description
   * (the only unbounded field a seller controls) could otherwise push the photo caption past
   * Telegram's 1024-char limit (or text past 4096) → sendPhoto/sendMessage fails → the product
   * silently doesn't render when tapped. Truncates by WHOLE lines so the escaped HTML stays valid.
   */
  private buildProviderDescriptionItalic(
    description: string,
    header: string,
    escFn: (value: string) => string,
    opts: { maxLines: number; maxChars: number },
  ): string {
    const lines: string[] = [];
    let used = 0;
    for (const rawLine of description.trim().split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (lines.length >= opts.maxLines || used >= opts.maxChars) break;
      const clipped = line.length > 280 ? `${line.slice(0, 280)}…` : line;
      lines.push(escFn(clipped));
      used += clipped.length;
    }
    return `${header}\n<i>${lines.join("\n")}</i>`;
  }

  private buildProductDescBlock(
    description: string,
    header: string,
    escFn: (s: string) => string,
    language: BotLanguage,
    opts: { maxLines: number; maxChars: number },
  ): string {
    const descLines: string[] = [header];
    let used = 0;
    let truncated = false;
    for (const rawLine of description.trim().split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (descLines.length - 1 >= opts.maxLines || used >= opts.maxChars) {
        truncated = true;
        break;
      }
      let bulleted = /^[•·*\-]\s*/.test(trimmed) ? trimmed : `• ${trimmed}`;
      if (bulleted.length > 280) bulleted = `${bulleted.slice(0, 280)}…`;
      descLines.push(escFn(bulleted));
      used += bulleted.length;
    }
    if (truncated) {
      const more =
        language === "en"
          ? "… (truncated)"
          : language === "th"
            ? "… (ย่อ)"
            : "… (đã rút gọn)";
      descLines.push(escFn(more));
    }
    return `<blockquote>${descLines.join("\n")}</blockquote>`;
  }

  /**
   * Hard backstop: clamp an HTML message/caption so its raw length stays under Telegram's limit
   * (photo caption 1024, text 4096). It never splits an HTML tag/entity and re-closes every
   * formatting tag that remains open. Raw length ≥ visible length, so this is conservative.
   */
  private clampTelegramHtml(text: string, limit: number): string {
    if (text.length <= limit) return text;

    const tokens =
      text.match(/<[^>]*>|&(?:#\d+|#x[\da-f]+|[a-z]+);|[^<&]+|[<&]/gi) || [];
    const openTags: string[] = [];
    let out = "";

    for (const token of tokens) {
      const closing = token.match(/^<\/([a-z][\w-]*)\s*>$/i);
      const opening = token.match(/^<([a-z][\w-]*)(?:\s[^>]*)?>$/i);
      const nextOpenTags = [...openTags];

      if (closing) {
        const tag = closing[1]!;
        const index = nextOpenTags.lastIndexOf(tag.toLowerCase());
        if (index >= 0) nextOpenTags.splice(index, 1);
      } else if (opening && !token.endsWith("/>")) {
        nextOpenTags.push(opening[1]!.toLowerCase());
      }

      const closingSuffix = nextOpenTags
        .slice()
        .reverse()
        .map((tag) => `</${tag}>`)
        .join("");
      const room = limit - out.length - closingSuffix.length - 1;
      if (room <= 0) break;

      if (token.startsWith("<") || token.startsWith("&")) {
        if (token.length > room) break;
        out += token;
        openTags.splice(0, openTags.length, ...nextOpenTags);
        continue;
      }

      if (token.length > room) {
        out += token.slice(0, room);
        break;
      }

      out += token;
      openTags.splice(0, openTags.length, ...nextOpenTags);
    }

    out = out.trimEnd();
    const suffix = openTags
      .slice()
      .reverse()
      .map((tag) => `</${tag}>`)
      .join("");
    return `${out}…${suffix}`;
  }

  private async getCatalogItemForTelegram(
    shopId: string,
    sourceProductId: string,
    language: BotLanguage = "vi",
  ) {
    await this.shopsService.refreshInternalProductAvailability(
      shopId,
      sourceProductId,
    );
    const product = await this.shopsService.getCatalogItemForShop(
      shopId,
      sourceProductId,
      true,
    );

    if (!product || product.hidden || !product.enabled) {
      throw new Error(
        language === "en"
          ? "This product is not available right now."
          : language === "th"
            ? "สินค้านี้ไม่พร้อมใช้งานในขณะนี้"
            : "Sản phẩm hiện không khả dụng.",
      );
    }

    if (
      product.available !== null &&
      product.available <= 0 &&
      !product.preorderEnabled
    ) {
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

  /**
   * Return a short banner like "🎁 Mua 2 tặng 1" or "🔥 Mua 3+ giảm 10%" if product
   * has an active (in time window) promo, otherwise null.
   */
  private getActivePromoBanner(
    item: any,
    language: BotLanguage = "vi",
  ): string | null {
    if (!item) return null;
    const now = new Date();
    const start = item.promoStartAt ? new Date(item.promoStartAt) : null;
    const end = item.promoEndAt ? new Date(item.promoEndAt) : null;
    const active = (!start || now >= start) && (!end || now <= end);
    if (!active) return null;
    const N = Number(item.promoBuyN || 0);
    const M = Number(item.promoGetM || 0);
    const minQ = Number(item.promoBulkMinQty || 0);
    const pct = Number(item.promoBulkDiscountPct || 0);
    if (
      item.promoType === "TIER_PRICE" &&
      Array.isArray(item.promoPriceTiers) &&
      item.promoPriceTiers.length > 0
    ) {
      const tiers = item.promoPriceTiers
        .map((tier: any) => ({
          minQty: Number(tier.minQty),
          price: Number(tier.price),
        }))
        .filter((tier: any) => tier.minQty > 0 && Number.isFinite(tier.price))
        .sort((a: any, b: any) => a.minQty - b.minQty);
      const labels = tiers.map((tier: any, index: number) => {
        const next = tiers[index + 1];
        const range = next
          ? `${tier.minQty}–${next.minQty - 1}`
          : language === "vi"
            ? `Từ ${tier.minQty}`
            : `${tier.minQty}+`;
        return `${index === tiers.length - 1 ? "└" : "├"} ${range}: ${new Intl.NumberFormat("vi-VN").format(tier.price)}đ/sp`;
      });
      const title =
        language === "en"
          ? "🏷 Quantity pricing"
          : language === "th"
            ? "🏷 ราคาตามจำนวน"
            : "🏷 Giá theo số lượng";
      return `${title}\n${labels.join("\n")}`;
    }
    if (item.promoType === "BUY_N_GET_M" && N > 0 && M > 0) {
      const tiers =
        Array.isArray(item.promoTiers) && item.promoTiers.length > 0
          ? item.promoTiers
          : [{ buy: N, get: M }];
      const labels = tiers.map((tier: any) => {
        const buy = Number(tier.buy || 0);
        const get = Number(tier.get || 0);
        return language === "en"
          ? `Buy ${buy}, get ${get}`
          : language === "th"
            ? `ซื้อ ${buy} แถม ${get}`
            : `Mua ${buy} tặng ${get}`;
      });
      return `🎁 ${labels.join(" • ")}`;
    }
    if (item.promoType === "BUY_N_PAY_M" && N > 0 && M >= 0 && M < N) {
      return language === "en"
        ? `💸 Get ${N}, pay for ${M}`
        : language === "th"
          ? `💸 รับ ${N} จ่าย ${M}`
          : `💸 Mua ${N} tính tiền ${M}`;
    }
    if (item.promoType === "PERCENT_DISCOUNT" && pct > 0) {
      return language === "en"
        ? `⚡ ${pct}% off every order`
        : language === "th"
          ? `⚡ ลด ${pct}% ทุกออเดอร์`
          : `⚡ Giảm ${pct}% toàn đơn`;
    }
    if (item.promoType === "BULK_DISCOUNT" && minQ > 0 && pct > 0) {
      return language === "en"
        ? `🔥 Buy ${minQ}+ get ${pct}% off`
        : language === "th"
          ? `🔥 ซื้อ ${minQ}+ ลด ${pct}%`
          : `🔥 Mua từ ${minQ}+ giảm ${pct}%`;
    }
    return null;
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

  private buildQuantityPromptText(
    maxQuantity: number | null,
    language: BotLanguage = "vi",
    emojiId = "",
  ) {
    const icon = emojiId
      ? `<tg-emoji emoji-id="${emojiId}">✏️</tg-emoji>`
      : "✏️";
    if (language === "en") {
      return maxQuantity === null
        ? `${icon} Enter quantity to buy:`
        : `${icon} Enter quantity to buy (max ${maxQuantity}):`;
    }
    if (language === "th") {
      return maxQuantity === null
        ? `${icon} ระบุจำนวนที่ต้องการซื้อ:`
        : `${icon} ระบุจำนวนที่ต้องการซื้อ (สูงสุด ${maxQuantity}):`;
    }
    return maxQuantity === null
      ? `${icon} Nhập số lượng cần mua:`
      : `${icon} Nhập số lượng cần mua (tối đa ${maxQuantity}):`;
  }

  private buildCustomerEmailPromptText(
    maxQuantity: number | null,
    language: BotLanguage = "vi",
    errorText?: string,
  ) {
    const maxLine =
      maxQuantity === null
        ? null
        : language === "en"
          ? `Maximum: ${maxQuantity} email(s).`
          : language === "th"
            ? `สูงสุด: ${maxQuantity} อีเมล`
            : `Tối đa: ${maxQuantity} email.`;
    const body =
      language === "en"
        ? [
            "📧 Please enter the emails that will receive a slot (one email per line).",
            "💡 Quantity and total price are calculated automatically from the number of emails.",
            ...(maxLine ? [maxLine] : []),
            "",
            "Example:",
            "user1@gmail.com",
            "user2@gmail.com",
          ]
        : language === "th"
          ? [
              "📧 กรุณากรอกอีเมลที่จะรับสล็อต (หนึ่งอีเมลต่อหนึ่งบรรทัด)",
              "💡 ระบบจะคำนวณจำนวนและราคารวมอัตโนมัติตามจำนวนอีเมล",
              ...(maxLine ? [maxLine] : []),
              "",
              "ตัวอย่าง:",
              "user1@gmail.com",
              "user2@gmail.com",
            ]
          : [
              "📧 Vui lòng nhập email để nhận slot (mỗi dòng 1 email).",
              "💡 Số lượng và tổng tiền sẽ được tính tự động theo số email bạn nhập.",
              ...(maxLine ? [maxLine] : []),
              "",
              "Ví dụ:",
              "user1@gmail.com",
              "user2@gmail.com",
            ];

    return [...(errorText ? [errorText, ""] : []), ...body].join("\n");
  }

  private buildInvalidQuantityText(
    maxQuantity: number | null,
    language: BotLanguage = "vi",
  ) {
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

  /**
   * Decode a base64 image data-URI to a Buffer for sendPhoto. PAY2S returns the ready VietQR as
   * "data:image/png;base64,..." in its response — we use that directly instead of regenerating via
   * img.vietqr.io (which needs a NUMERIC bank BIN; PAY2S gives a bank CODE like "MBB" → vietqr 404).
   */
  private decodeDataUriToBuffer(value: string | null): Buffer | null {
    const match = /^data:image\/\w+;base64,(.+)$/.exec(
      String(value || "").trim(),
    );
    const b64 = match?.[1];
    if (!b64) return null;
    try {
      return Buffer.from(b64, "base64");
    } catch {
      return null;
    }
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

  private buildVietQrImageUrl(bankInfo: PayOSBankInfo, amount: number): string {
    const params = new URLSearchParams({
      amount: String(Math.round(Number(amount))),
      addInfo: bankInfo.description,
      accountName: bankInfo.accountName,
    });
    return `https://img.vietqr.io/image/${bankInfo.bin}-${bankInfo.accountNumber}-compact.png?${params.toString()}`;
  }

  private async downloadVietQrAsBuffer(
    bankInfo: PayOSBankInfo,
    amount: number,
  ): Promise<Buffer | null> {
    try {
      const url = this.buildVietQrImageUrl(bankInfo, amount);
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 8000,
      });
      return Buffer.from(response.data);
    } catch {
      return null;
    }
  }

  private async getPendingWalletTopup(shopId: string, telegramUserId: string) {
    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    const pending =
      await this.sessions.getPendingSession<PendingWalletTopupSelection>(
        "pendingWalletTopups",
        key,
      );

    if (!pending) {
      return null;
    }

    if (pending.expiresAt <= Date.now()) {
      await this.sessions.delPendingSession("pendingWalletTopups", key);
      return null;
    }

    return pending;
  }

  private async getPendingQuantitySelection(
    shopId: string,
    telegramUserId: string,
  ) {
    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    const selection =
      await this.sessions.getPendingSession<PendingQuantitySelection>(
        "pendingQuantitySelections",
        key,
      );

    if (!selection) {
      return null;
    }

    if (selection.expiresAt <= Date.now()) {
      await this.sessions.delPendingSession("pendingQuantitySelections", key);
      return null;
    }

    return selection;
  }

  private async getPendingPaymentSelection(
    shopId: string,
    telegramUserId: string,
  ) {
    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    const selection =
      await this.sessions.getPendingSession<PendingPaymentSelection>(
        "pendingPaymentSelections",
        key,
      );

    if (!selection) {
      return null;
    }

    if (selection.expiresAt <= Date.now()) {
      await this.sessions.delPendingSession("pendingPaymentSelections", key);
      return null;
    }

    return selection;
  }

  private async getPendingTxHashSubmission(
    shopId: string,
    telegramUserId: string,
  ) {
    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    const pending =
      await this.sessions.getPendingSession<PendingTxHashSubmission>(
        "pendingTxHashSubmissions",
        key,
      );

    if (!pending) {
      return null;
    }

    if (pending.expiresAt <= Date.now()) {
      await this.sessions.delPendingSession("pendingTxHashSubmissions", key);
      return null;
    }

    return pending;
  }

  private async getPendingWarrantyClaimSubmission(
    shopId: string,
    telegramUserId: string,
  ) {
    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    const pending =
      await this.sessions.getPendingSession<PendingWarrantyClaimSubmission>(
        "pendingWarrantyClaimSubmissions",
        key,
      );

    if (!pending) {
      return null;
    }

    if (pending.expiresAt <= Date.now()) {
      await this.sessions.delPendingSession(
        "pendingWarrantyClaimSubmissions",
        key,
      );
      return null;
    }

    return pending;
  }

  private async clearPendingQuantitySelection(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) {
      return;
    }

    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    await Promise.all([
      this.sessions.delPendingSession("pendingQuantitySelections", key),
      this.sessions.delPendingSession("pendingCustomerEmailSelections", key),
    ]);
  }

  private async clearPendingWalletTopup(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) {
      return;
    }
    await this.sessions.delPendingSession(
      "pendingWalletTopups",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
    );
  }

  private async clearPendingPaymentSelection(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) {
      return;
    }

    await this.sessions.delPendingSession(
      "pendingPaymentSelections",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
    );
  }

  private async clearPendingTxHashSubmission(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) {
      return;
    }

    await this.sessions.delPendingSession(
      "pendingTxHashSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
    );
  }

  private async clearPendingWarrantyClaimSubmission(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) {
      return;
    }

    await this.sessions.delPendingSession(
      "pendingWarrantyClaimSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
    );
  }

  private async clearPendingWarrantyIssueDescription(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) {
      return;
    }

    await this.sessions.delPendingSession(
      "pendingWarrantyIssueDescriptions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
    );
  }

  private async getPendingWarrantyAccountSelection(
    shopId: string,
    telegramUserId: string,
  ) {
    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    const pending =
      await this.sessions.getPendingSession<PendingWarrantyAccountSelection>(
        "pendingWarrantyAccountSelections",
        key,
      );

    if (!pending) {
      return null;
    }

    if (pending.expiresAt <= Date.now()) {
      await this.sessions.delPendingSession(
        "pendingWarrantyAccountSelections",
        key,
      );
      return null;
    }

    return pending;
  }

  private async clearPendingWarrantyAccountSelection(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) {
      return;
    }

    await this.sessions.delPendingSession(
      "pendingWarrantyAccountSelections",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
    );
  }

  private async handleProKeyReissue(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    token: string,
    chatId: number,
    messageId: number | undefined,
    downstreamSellerId: string,
    actions: unknown[],
  ) {
    if (
      shop.seller.tier !== SellerTier.PRO &&
      shop.seller.tier !== SellerTier.ULTRA
    )
      return;

    const existingConn = await this.prisma.downstreamSourceConnection.findFirst(
      {
        where: { upstreamShopId: shop.id, downstreamSellerId },
        include: { apiKey: true },
      },
    );

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
        data: {
          apiKeyId: result.id,
          status: DownstreamSourceConnectionStatus.ACTIVE,
        },
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
    const plusCustomer =
      await this.findPlusSellerByTelegramUserId(telegramUserId);

    if (!plusCustomer) {
      await this.editOrSend(
        token,
        chatId,
        messageId,
        "⛔ Không tìm thấy tài khoản PRO.",
        { inline_keyboard: [] },
        actions,
      );
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
      await this.editOrSend(
        token,
        chatId,
        messageId,
        "⛔ Không có kết nối đang hoạt động.",
        { inline_keyboard: [] },
        actions,
      );
      return;
    }

    let currentBalance = 0;
    if (connection.downstreamTelegramChatId) {
      const wallet = await this.prisma.customerWallet.findFirst({
        where: {
          customer: {
            shopId: connection.upstreamShopId,
            telegramChatId: connection.downstreamTelegramChatId,
          },
        },
        select: { balance: true },
      });
      if (wallet) currentBalance = decimalToNumber(wallet.balance);
    }

    await this.sessions.setPendingSession(
      "pendingConnectionTopupInputs",
      this.sessions.getPendingConnectionTopupKey(shop.id, telegramUserId),
      {
        connectionId: connection.id,
        downstreamShopId: plusCustomer.shopId,
        expiresAt: Date.now() + this.sessions.pendingQuantityTtlMs,
      },
      this.sessions.pendingQuantityTtlMs,
    );

    await this.editOrSend(
      token,
      chatId,
      messageId,
      [
        "💰 Nạp ví kết nối nguồn",
        `Số dư hiện tại: ${formatCurrency(currentBalance)}`,
        "",
        "Nhập số tiền muốn nạp (VND, tối thiểu 10,000đ):",
      ].join("\n"),
      {
        inline_keyboard: [[{ text: "❌ Hủy", callback_data: "prokey:cancel" }]],
      },
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
    const key = this.sessions.getPendingConnectionTopupKey(
      shop.id,
      telegramUserId,
    );
    const pending =
      await this.sessions.getPendingSession<PendingConnectionTopupInput>(
        "pendingConnectionTopupInputs",
        key,
      );

    if (!pending || pending.expiresAt <= Date.now()) {
      if (pending)
        await this.sessions.delPendingSession(
          "pendingConnectionTopupInputs",
          key,
        );
      return false;
    }

    const raw = String(message.text || "")
      .trim()
      .replace(/[,.]/g, "");
    const amount = parseInt(raw, 10);

    if (!Number.isInteger(amount) || amount < 10000) {
      await this.sendText(
        token,
        message.chat.id,
        "⚠️ Số tiền không hợp lệ. Tối thiểu 10,000đ. Nhập lại:",
        actions,
        {
          inline_keyboard: [
            [{ text: "❌ Hủy", callback_data: "prokey:cancel" }],
          ],
        },
      );
      return true;
    }

    await this.sessions.delPendingSession("pendingConnectionTopupInputs", key);

    try {
      const result =
        await this.connectionTopupService.createPayosTopupForConnection(
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
        {
          inline_keyboard: [
            [{ text: "❌ Hủy giao dịch", callback_data: "prokey:cancel" }],
          ],
        },
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
      // Only PRO reseller connections here — customer-bound (canboso-style) keys
      // have no downstream seller and are managed via the customer's own bot wallet.
      where: { upstreamShopId: shop.id, downstreamSellerId: { not: null } },
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

    const connChatIds = connections
      .map((c) => c.downstreamTelegramChatId)
      .filter((id): id is string => !!id);
    const connWallets =
      connChatIds.length > 0
        ? await this.prisma.customerWallet.findMany({
            where: {
              customer: {
                shopId: shop.id,
                telegramChatId: { in: connChatIds },
              },
            },
            include: { customer: { select: { telegramChatId: true } } },
          })
        : [];
    const connWalletByChatId = new Map(
      connWallets.map((w) => [
        w.customer.telegramChatId,
        decimalToNumber(w.balance),
      ]),
    );

    for (const conn of connections) {
      const name =
        conn.downstreamSeller?.displayName ||
        conn.downstreamSellerId?.slice(0, 8) ||
        conn.downstreamTelegramChatId ||
        "?";
      const status =
        conn.status === DownstreamSourceConnectionStatus.ACTIVE ? "✅" : "⏸️";
      const balance = formatCurrency(
        conn.downstreamTelegramChatId
          ? (connWalletByChatId.get(conn.downstreamTelegramChatId) ?? 0)
          : 0,
      );
      const keyHint = conn.apiKey?.keyPrefix
        ? `${conn.apiKey.keyPrefix}…`
        : "chưa có key";
      lines.push(`${status} ${name} — ${balance} — ${keyHint}`);
      buttons.push([
        {
          text: `Cấp key: ${name.slice(0, 15)}`,
          callback_data: `prokey:reissue:${conn.downstreamSellerId}`,
        },
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
    return Array.from(
      { length: 8 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
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

  private async applyAffiliateRef(
    shopId: string,
    from: {
      telegramUserId: string;
      telegramChatId: string;
      telegramUsername: string | null;
      firstName: string | null;
      lastName: string | null;
    },
    refParam: string,
  ) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { sellerId: true },
    });
    if (!shop) return;

    const customer = await this.prisma.customer.upsert({
      where: {
        shopId_telegramUserId: { shopId, telegramUserId: from.telegramUserId },
      },
      create: {
        shopId,
        sellerId: shop.sellerId,
        telegramUserId: from.telegramUserId,
        telegramChatId: from.telegramChatId,
        telegramUsername: from.telegramUsername,
        firstName: from.firstName,
        lastName: from.lastName,
      },
      update: {
        telegramChatId: from.telegramChatId,
        telegramUsername: from.telegramUsername,
        firstName: from.firstName,
        lastName: from.lastName,
      },
      select: {
        id: true,
        referredById: true,
        telegramUserId: true,
        telegramChatId: true,
      },
    });
    if (customer.referredById) return;

    const referrer = await this.prisma.customer.findFirst({
      where: { shopId, OR: [{ referralCode: refParam }, { id: refParam }] },
      select: { id: true, telegramUserId: true, telegramChatId: true },
    });
    if (!referrer) return;
    if (referrer.id === customer.id) return;
    if (
      referrer.telegramUserId &&
      referrer.telegramUserId === customer.telegramUserId
    ) {
      this.logger.warn(
        `Self-referral blocked (same telegramUserId=${customer.telegramUserId}, shop=${shopId})`,
      );
      return;
    }
    if (
      referrer.telegramChatId &&
      referrer.telegramChatId === customer.telegramChatId
    ) {
      this.logger.warn(
        `Self-referral blocked (same telegramChatId=${customer.telegramChatId}, shop=${shopId})`,
      );
      return;
    }

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
      await this.editOrSend(
        token,
        chatId,
        messageId,
        text,
        {
          inline_keyboard: [[this.navBtn("home", language, "home:menu")]],
        },
        actions,
        "HTML",
      );
      return;
    }

    // Get or lazily create the referral token for this customer
    const refCode =
      customer.referralCode ||
      (await this.getOrCreateReferralCode(customer.id));

    const stats = await this.affiliateService.getStatsByCustomer(customer.id);
    const botUsername = shop.botConfig?.telegramBotUsername || "";
    const refLink = botUsername
      ? `https://t.me/${botUsername}?start=ref_${refCode}`
      : null;
    const commissionPct = Number(config.commissionPct);

    // Default intro: always describes the program + auto-mentions % when set
    const defaultIntro =
      language === "en"
        ? commissionPct > 0
          ? `Share your referral link and earn <b>${commissionPct}%</b> commission for every successful order placed by people you refer. No limit on referrals.`
          : `Join our affiliate program and earn commission for every customer you refer.`
        : commissionPct > 0
          ? `Chia sẻ link giới thiệu và nhận <b>${commissionPct}%</b> hoa hồng cho mỗi đơn thành công từ người bạn giới thiệu. Không giới hạn số lượt.`
          : `Tham gia chương trình affiliate và nhận hoa hồng cho mỗi khách hàng bạn giới thiệu.`;

    const programInfo = config.programText
      ? `${defaultIntro}\n\n${config.programText}`
      : defaultIntro;

    const lines =
      language === "en"
        ? [
            `🤝 <b>Affiliate Program</b>`,
            ``,
            programInfo,
            ``,
            `💰 Commission earned: <b>${stats.lifetimeCommission.toLocaleString("vi-VN")} ₫</b>`,
            `👥 Referred customers: <b>${stats.downlineCount}</b>`,
            refLink
              ? `\n🔗 <b>Your referral link:</b>\n<code>${refLink}</code>`
              : ``,
          ]
        : language === "th"
          ? [
              `🤝 <b>โปรแกรมแนะนำเพื่อน</b>`,
              ``,
              programInfo,
              ``,
              `💰 ค่าคอมมิชชันสะสม: <b>${stats.lifetimeCommission.toLocaleString("vi-VN")} ₫</b>`,
              `👥 ลูกค้าที่แนะนำ: <b>${stats.downlineCount}</b>`,
              refLink
                ? `\n🔗 <b>ลิงก์แนะนำของคุณ:</b>\n<code>${refLink}</code>`
                : ``,
            ]
          : [
              `🤝 <b>Chương trình Affiliate</b>`,
              ``,
              programInfo,
              ``,
              `💰 Hoa hồng tích lũy: <b>${stats.lifetimeCommission.toLocaleString("vi-VN")} ₫</b>`,
              `👥 Người đã giới thiệu: <b>${stats.downlineCount}</b>`,
              refLink
                ? `\n🔗 <b>Link giới thiệu của bạn:</b>\n<code>${refLink}</code>`
                : ``,
            ];

    await this.editOrSend(
      token,
      chatId,
      messageId,
      lines.filter(Boolean).join("\n"),
      {
        inline_keyboard: [[this.navBtn("home", language, "home:menu")]],
      },
      actions,
      "HTML",
    );
  }

  private async handleProKeyMenu(
    shop: Awaited<ReturnType<ShopsService["getSellerShopByShopId"]>>,
    token: string,
    chatId: number,
    messageId: number | undefined,
    _telegramUserId: string,
    actions: unknown[],
  ) {
    if (
      shop.seller.tier !== SellerTier.PRO &&
      shop.seller.tier !== SellerTier.ULTRA
    ) {
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
    const existing = await this.apiKeyService.getActiveKeyForTelegramChatId(
      shop.id,
      chatIdStr,
    );

    const displayKey = existing?.keyEncrypted
      ? this.apiKeyService.decryptKey(existing.keyEncrypted)
      : null;

    let result: { key: string };
    if (displayKey) {
      result = { key: displayKey };
    } else {
      await this.apiKeyService.revokeAllBotKeysForChatId(shop.id, chatIdStr);
      result = await this.apiKeyService.issueKey(shop.sellerId, shop.id, {
        label: `Bot - ${chatIdStr}`,
        telegramChatId: chatIdStr,
      });
    }

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
    // No-op: Redis handles TTL automatically
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
    options: {
      view: "recent" | "all";
      page: number;
      totalPages: number;
      totalOrders: number;
      startIndex: number;
    } = {
      view: "recent",
      page: 0,
      totalPages: 1,
      totalOrders: 0,
      startIndex: 0,
    },
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

    const title =
      options.view === "all"
        ? language === "en"
          ? "📜 All purchase history"
          : language === "th"
            ? "📜 ประวัติการซื้อทั้งหมด"
            : "📜 Toàn bộ lịch sử mua hàng"
        : language === "en"
          ? "📜 Purchase history"
          : language === "th"
            ? "📜 ประวัติการซื้อ"
            : "📜 Lịch sử mua hàng";
    const pageSummary =
      options.view === "all"
        ? language === "en"
          ? `Page ${options.page + 1}/${options.totalPages} • ${options.totalOrders} orders`
          : language === "th"
            ? `หน้า ${options.page + 1}/${options.totalPages} • ${options.totalOrders} คำสั่งซื้อ`
            : `Trang ${options.page + 1}/${options.totalPages} • ${options.totalOrders} đơn hàng`
        : null;

    const instruction =
      language === "en"
        ? "Select an order to view details:"
        : language === "th"
          ? "เลือกคำสั่งซื้อเพื่อดูรายละเอียด:"
          : "Chọn đơn để xem chi tiết:";
    const lines: string[] = [
      title,
      ...(pageSummary ? [pageSummary] : []),
      "",
      instruction,
    ];

    return lines.join("\n").trim();
  }

  private buildWalletText(
    summary: {
      balance: number;
      commissionBalance?: number;
      currency: string;
      telegramUsername?: string | null;
      telegramChatId?: string | null;
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
    },
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
    shopCust?: Record<string, unknown> | null,
  ) {
    const commissionBalance = summary.commissionBalance ?? 0;
    const walletNoteMap = (shopCust as Record<string, unknown> | null)
      ?.walletNote as Record<string, string> | undefined;
    const walletNote = (
      walletNoteMap?.[language] ||
      walletNoteMap?.["vi"] ||
      ""
    ).trim();
    if (language === "en") {
      const lines: string[] = [
        "💳 Your wallet",
        "",
        ...(walletNote ? [walletNote, ""] : []),
        ...(summary.telegramUsername
          ? [`Username: @${summary.telegramUsername}`]
          : []),
        ...(summary.telegramChatId ? [`ID: ${summary.telegramChatId}`] : []),
        `💰 Wallet balance: ${this.formatBotMoney(summary.balance, language, usdtVndRate)}`,
        `🎁 Commission balance: ${this.formatBotMoney(commissionBalance, language, usdtVndRate)}`,
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

      lines.push("📋 See all movements in “Balance history” below.");

      return lines.join("\n");
    }

    if (language === "th") {
      const lines: string[] = [
        "💳 กระเป๋าเงินของคุณ",
        "",
        ...(walletNote ? [walletNote, ""] : []),
        `💰 ยอดเติม: ${this.formatBotMoney(summary.balance, language, usdtVndRate)}`,
        `🎁 ยอดค่าคอม: ${this.formatBotMoney(commissionBalance, language, usdtVndRate)}`,
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

      lines.push("📋 ดูการเปลี่ยนแปลงทั้งหมดที่ปุ่ม “ประวัติยอดเงิน” ด้านล่าง");

      return lines.join("\n");
    }

    const lines: string[] = [
      "💳 Ví của bạn",
      "",
      ...(walletNote ? [walletNote, ""] : []),
      ...(summary.telegramUsername
        ? [`Username: @${summary.telegramUsername}`]
        : []),
      ...(summary.telegramChatId ? [`ID: ${summary.telegramChatId}`] : []),
      `💰 Số dư nạp ví: ${this.formatBotMoney(summary.balance, language, usdtVndRate)}`,
      `🎁 Số dư hoa hồng: ${this.formatBotMoney(commissionBalance, language, usdtVndRate)}`,
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

    lines.push("📋 Xem toàn bộ biến động ở nút “Lịch sử biến động” bên dưới.");

    return lines.join("\n");
  }

  private formatTopupStatus(status: string, language: BotLanguage = "vi") {
    const en = language === "en";
    const th = language === "th";
    if (status === "paid")
      return en ? "Credited" : th ? "เครดิตแล้ว" : "Đã cộng tiền";
    if (status === "canceled")
      return en ? "Canceled" : th ? "ยกเลิกแล้ว" : "Đã hủy";
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

    if (status === "DELIVERED")
      return en ? "Delivered" : th ? "จัดส่งแล้ว" : "Đã giao";
    if (status === "FAILED") return en ? "Failed" : th ? "ล้มเหลว" : "Thất bại";
    if (status === "PAID_WAITING_STOCK")
      return en
        ? "Paid, waiting for stock"
        : th
          ? "ชำระแล้ว รอสินค้า"
          : "Đã thanh toán, chờ hàng";
    if (status === "PROCESSING_PURCHASE")
      return en ? "Processing" : th ? "กำลังดำเนินการ" : "Đang xử lý";
    if (status === "REFUNDED" || paymentStatus === "REFUNDED")
      return en ? "Refunded" : th ? "คืนเงินแล้ว" : "Đã hoàn tiền";
    if (status === "PAID" || paymentStatus === "PAID")
      return en ? "Paid" : th ? "ชำระแล้ว" : "Đã thanh toán";
    if (
      status === "AWAITING_PAYMENT" ||
      paymentStatus === "PENDING" ||
      paymentStatus === "UNPAID"
    ) {
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
    bankInfo?: PayOSBankInfo,
    manualCrypto?: {
      provider?:
        | "BINANCE"
        | "OKX"
        | "USDT_TRC20"
        | "USDT_BEP20"
        | "USDT_SOL"
        | "USDT_TON";
      network?: "TRC20" | "BEP20" | "SOLANA" | "TON" | null;
      address?: string | null;
      usdtAmount: number;
      note: string;
    } | null,
  ) {
    if (
      manualCrypto?.address &&
      (manualCrypto.provider === "USDT_SOL" ||
        manualCrypto.provider === "USDT_TON" ||
        manualCrypto.provider === "USDT_BEP20")
    ) {
      const usdtFormatted = this.formatUsdt(manualCrypto.usdtAmount);
      const network =
        manualCrypto.provider === "USDT_TON"
          ? "TON"
          : manualCrypto.provider === "USDT_BEP20"
            ? "BEP20 (BSC)"
            : "Solana";
      const transferWarnings = this.buildUsdtTransferWarningLines(
        manualCrypto.provider,
        manualCrypto.usdtAmount,
        language,
      );
      if (language === "en") {
        return [
          `💲 USDT top-up ${usdtFormatted} USDT (≈ ${formatCurrency(amount)})`,
          `Top-up code: ${externalOrderCode}`,
          `Payment deadline: ${this.formatDateTime(expiresAt)}`,
          "",
          `📤 Transfer details (${network})`,
          `Address: <code>${manualCrypto.address}</code>`,
          `Amount: <code>${usdtFormatted}</code> USDT`,
          `Reference: <code>${manualCrypto.note}</code>`,
          "",
          `Send the exact amount using only USDT on ${network}. The bot will confirm automatically within 30-60 seconds.`,
          ...transferWarnings,
        ].join("\n");
      }
      if (language === "th") {
        return [
          `💲 เติม USDT ${usdtFormatted} USDT (≈ ${formatCurrency(amount)})`,
          `รหัสเติมเงิน: ${externalOrderCode}`,
          `กำหนดชำระ: ${this.formatDateTime(expiresAt)}`,
          "",
          `📤 ข้อมูลการโอน (${network})`,
          `ที่อยู่: <code>${manualCrypto.address}</code>`,
          `จำนวน: <code>${usdtFormatted}</code> USDT`,
          "",
          `ส่งจำนวนที่ตรงกันด้วย USDT บน ${network} เท่านั้น ระบบจะยืนยันอัตโนมัติภายใน 30-60 วินาที`,
          ...transferWarnings,
        ].join("\n");
      }
      return [
        `💲 Nạp USDT ${usdtFormatted} USDT (≈ ${formatCurrency(amount)})`,
        `Mã nạp: ${externalOrderCode}`,
        `Hạn thanh toán: ${this.formatDateTime(expiresAt)}`,
        "",
        `📤 Thông tin chuyển (${network})`,
        `Địa chỉ ví: <code>${manualCrypto.address}</code>`,
        `Số USDT: <code>${usdtFormatted}</code>`,
        `Mã tham chiếu: <code>${manualCrypto.note}</code>`,
        "",
        `Chuyển đúng số tiền và chỉ dùng USDT mạng ${network}. Bot sẽ tự xác nhận trong 30-60 giây.`,
        ...transferWarnings,
      ].join("\n");
    }

    // USDT TRC20 topup
    if (manualCrypto?.address) {
      const usdtFormatted = this.formatUsdt(manualCrypto.usdtAmount);
      const transferWarnings = this.buildUsdtTransferWarningLines(
        "USDT_TRC20",
        manualCrypto.usdtAmount,
        language,
      );
      if (language === "en") {
        return [
          `💲 USDT top-up ${usdtFormatted} USDT (≈ ${formatCurrency(amount)})`,
          `Top-up code: ${externalOrderCode}`,
          `Payment deadline: ${this.formatDateTime(expiresAt)}`,
          "",
          "─────────────────",
          "📤 Transfer details (TRC20)",
          `Address: <code>${manualCrypto.address}</code>`,
          `Amount: <code>${usdtFormatted}</code> USDT`,
          `Memo / Note: <code>${manualCrypto.note}</code>`,
          "─────────────────",
          "After transferring, tap 'Send TX hash' below and paste the txid.",
          ...transferWarnings,
        ].join("\n");
      }
      if (language === "th") {
        return [
          `💲 เติม USDT ${usdtFormatted} USDT (≈ ${formatCurrency(amount)})`,
          `รหัสเติมเงิน: ${externalOrderCode}`,
          `กำหนดชำระ: ${this.formatDateTime(expiresAt)}`,
          "",
          "─────────────────",
          "📤 ข้อมูลการโอน (TRC20)",
          `ที่อยู่: <code>${manualCrypto.address}</code>`,
          `จำนวน: <code>${usdtFormatted}</code> USDT`,
          `หมายเหตุ: <code>${manualCrypto.note}</code>`,
          "─────────────────",
          "หลังโอนแล้ว กด 'ส่ง TX hash' ด้านล่างแล้ววาง txid",
          ...transferWarnings,
        ].join("\n");
      }
      return [
        `💲 Nạp USDT ${usdtFormatted} USDT (≈ ${formatCurrency(amount)})`,
        `Mã nạp: ${externalOrderCode}`,
        `Hạn thanh toán: ${this.formatDateTime(expiresAt)}`,
        "",
        "─────────────────",
        "📤 Thông tin chuyển (TRC20)",
        `Địa chỉ ví: <code>${manualCrypto.address}</code>`,
        `Số USDT: <code>${usdtFormatted}</code>`,
        `Nội dung: <code>${manualCrypto.note}</code>`,
        "─────────────────",
        "Sau khi chuyển xong, bấm 'Gửi TX hash' bên dưới rồi dán txid.",
        ...transferWarnings,
      ].join("\n");
    }

    // VND bank transfer (PayOS)
    const bankLines = bankInfo
      ? this.buildBankInfoLines(bankInfo, amount, language)
      : [];

    if (language === "en") {
      return [
        `🏦 Top up ${this.formatBotMoney(amount, language, usdtVndRate)} to wallet`,
        `Gateway amount: ${formatCurrency(amount)}`,
        `Top-up code: ${externalOrderCode}`,
        `Payment deadline: ${this.formatDateTime(expiresAt)}`,
        "",
        "Scan the QR code or open the payment link below.",
        "After PayOS confirms the payment, the bot will credit your wallet automatically.",
        ...bankLines,
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
        ...bankLines,
      ].join("\n");
    }

    return [
      `🏦 Nạp ${this.formatBotMoney(amount, language, usdtVndRate)} vào ví`,
      `Mã nạp: ${externalOrderCode}`,
      `Hạn thanh toán: ${this.formatDateTime(expiresAt)}`,
      "",
      "Quét mã QR hoặc mở link thanh toán bên dưới.",
      "Sau khi PayOS xác nhận thành công, bot sẽ tự động cộng số dư vào ví của bạn.",
      ...bankLines,
    ].join("\n");
  }

  private buildDeliveredSnippet(value: string, maxLines = 4, maxLength = 280) {
    const normalized = String(value || "")
      .replace(/\r/g, "")
      .trim();
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
    return this.render.indentBlock(value);
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
    const inlineKeyboard: Array<
      Array<{ text: string; callback_data?: string; url?: string }>
    > = [];

    if (this.isPublicCheckoutUrl(checkoutUrl || "")) {
      inlineKeyboard.push([
        {
          text: this.buttonLabel("openCheckout", language),
          url: checkoutUrl,
        },
      ]);
    }

    inlineKeyboard.push([
      this.navBtn("history", language, "home:history"),
      this.navBtn("home", language, "home:menu"),
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
        transaction.provider !== PaymentProvider.BINANCE_PAY &&
        transaction.provider !== PaymentProvider.PAYPAL)
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
          ? language === "en"
            ? "This payment has already been confirmed and the account has been delivered."
            : language === "th"
              ? "การชำระเงินนี้ได้รับการยืนยันแล้วและบัญชีถูกจัดส่งแล้ว"
              : "Thanh toán này đã được xác nhận và tài khoản đã được giao."
          : language === "en"
            ? "This payment has already been confirmed. The system is processing your order."
            : language === "th"
              ? "การชำระเงินนี้ได้รับการยืนยันแล้ว ระบบกำลังดำเนินการคำสั่งซื้อของคุณ"
              : "Thanh toán này đã được xác nhận. Hệ thống đang xử lý đơn hàng của bạn.";

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
      const paymentStatus =
        await this.paymentService.getExternalPaymentStatus(externalOrderCode);
      const providerStatus = String(
        paymentStatus.providerStatus || "UNKNOWN",
      ).toUpperCase();
      const isPaid =
        ["PAID", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(
          providerStatus,
        ) ||
        (Number(paymentStatus.amountPaid || 0) > 0 &&
          Number(paymentStatus.amount || 0) > 0 &&
          Number(paymentStatus.amountPaid || 0) >=
            Number(paymentStatus.amount || 0));

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

      if (messageId) {
        await telegramDeleteMessage(token, chatId, messageId).catch(
          () => undefined,
        );
      }

      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "✅ Payment confirmed. The system is now processing your order automatically."
          : language === "th"
            ? "✅ ยืนยันการชำระเงินแล้ว ระบบกำลังดำเนินการคำสั่งซื้อของคุณอัตโนมัติ"
            : "✅ Đã xác nhận thanh toán. Hệ thống đang tự động xử lý đơn hàng của bạn.",
        actions,
        this.buildCheckoutVerifyReplyMarkup(
          transaction.checkoutUrl || "",
          externalOrderCode,
          language,
          { includeVerify: false },
        ),
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

  private async getPendingBinanceOrderIdSubmission(
    shopId: string,
    telegramUserId: string,
  ) {
    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    const pending =
      await this.sessions.getPendingSession<PendingBinanceOrderIdSubmission>(
        "pendingBinanceOrderIdSubmissions",
        key,
      );
    if (!pending) return null;
    if (pending.expiresAt <= Date.now()) {
      await this.sessions.delPendingSession(
        "pendingBinanceOrderIdSubmissions",
        key,
      );
      return null;
    }
    return pending;
  }

  private async clearPendingBinanceOrderIdSubmission(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) return;
    await this.sessions.delPendingSession(
      "pendingBinanceOrderIdSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
    );
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
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "This payment is no longer pending or is invalid."
          : language === "th"
            ? "คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงินแล้ว"
            : "Đơn hàng không còn ở trạng thái chờ thanh toán.",
        actions,
      );
      return;
    }

    await this.sessions.setPendingSession(
      "pendingBinanceOrderIdSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
      {
        externalOrderCode,
        orderCode: transaction.order.orderCode,
        expiresAt: Date.now() + this.sessions.pendingBinanceOrderIdTtlMs,
      },
      this.sessions.pendingBinanceOrderIdTtlMs,
    );

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
    const pending = await this.getPendingBinanceOrderIdSubmission(
      shopId,
      telegramUserId,
    );
    if (!pending) return false;

    const msgText = String(message.text || "").trim();
    if (!/^\d{15,22}$/.test(msgText)) return false;

    await this.clearPendingBinanceOrderIdSubmission(shopId, telegramUserId);
    await this.handleBinanceVerifyByOrderId(
      shopId,
      token,
      message.chat.id,
      telegramUserId,
      pending.externalOrderCode,
      msgText,
      actions,
      language,
    );
    return true;
  }

  // ────────────────────────────────────────────────────────────────────
  // OKX Personal API — paste tx-hash flow
  // ────────────────────────────────────────────────────────────────────

  private async getPendingOkxTxHashSubmission(
    shopId: string,
    telegramUserId: string,
  ) {
    const key = this.sessions.getPendingQuantityKey(shopId, telegramUserId);
    const pending = await this.sessions.getPendingSession<{
      externalOrderCode: string;
      orderCode: string;
      expiresAt: number;
    }>("pendingOkxTxHashSubmissions", key);
    if (!pending) return null;
    if (pending.expiresAt <= Date.now()) {
      await this.sessions.delPendingSession("pendingOkxTxHashSubmissions", key);
      return null;
    }
    return pending;
  }

  private async clearPendingOkxTxHashSubmission(
    shopId: string,
    telegramUserId: string,
  ) {
    if (!telegramUserId) return;
    await this.sessions.delPendingSession(
      "pendingOkxTxHashSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
    );
  }

  private async handleOkxTxHashPrompt(
    shopId: string,
    token: string,
    chatId: number,
    telegramUserId: string,
    externalOrderCode: string,
    actions: unknown[],
    language: BotLanguage,
    _messageId?: number,
  ) {
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { externalOrderCode },
      include: { order: true },
    });
    if (
      !transaction ||
      transaction.status !== "PENDING" ||
      transaction.provider !== "OKX" ||
      transaction.order.shopId !== shopId
    ) {
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "This payment is no longer pending or is invalid."
          : language === "th"
            ? "คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงินแล้ว"
            : "Đơn hàng không còn ở trạng thái chờ thanh toán.",
        actions,
      );
      return;
    }
    await this.sessions.setPendingSession(
      "pendingOkxTxHashSubmissions",
      this.sessions.getPendingQuantityKey(shopId, telegramUserId),
      {
        externalOrderCode,
        orderCode: transaction.order.orderCode,
        expiresAt: Date.now() + this.sessions.pendingOkxTxHashTtlMs,
      },
      this.sessions.pendingOkxTxHashTtlMs,
    );
    await this.sendText(
      token,
      chatId,
      language === "en"
        ? `📋 Please paste the <b>TX hash</b> of your OKX USDT transfer for order <b>${transaction.order.orderCode}</b>.\n\nFind it in OKX → Funding → Withdrawals → tap the transaction → "Txid" (64 chars for TRC20, 0x-prefixed 66 chars for BEP20, 88 chars base58 for Solana).`
        : language === "th"
          ? `📋 กรุณาวาง <b>TX hash</b> ของการโอน USDT จาก OKX สำหรับคำสั่งซื้อ <b>${transaction.order.orderCode}</b>\n\nหาได้ที่ OKX → Funding → ประวัติการถอน → แตะรายการ → "Txid"`
          : `📋 Vui lòng dán <b>TX hash</b> của lệnh chuyển USDT từ OKX cho đơn <b>${transaction.order.orderCode}</b>.\n\nLấy ở OKX → Funding → Lịch sử rút → bấm vào lệnh → "Txid" (TRC20 dài 64 ký tự, BEP20 bắt đầu 0x dài 66, Solana base58 dài ~88).`,
      actions,
      { parse_mode: "HTML" as const },
    );
  }

  private async handlePendingOkxTxHashMessage(
    shopId: string,
    token: string,
    message: any,
    actions: unknown[],
    language: BotLanguage,
  ): Promise<boolean> {
    const telegramUserId = String(message.from?.id || "");
    const pending = await this.getPendingOkxTxHashSubmission(
      shopId,
      telegramUserId,
    );
    if (!pending) return false;
    const msgText = String(message.text || "").trim();
    // Accept TRC20 (64 hex), BEP20/ETH (0x + 64 hex = 66), Solana (base58 ~ 80-90)
    const looksLikeHash =
      /^[A-Fa-f0-9]{64}$/.test(msgText) ||
      /^0x[A-Fa-f0-9]{64}$/.test(msgText) ||
      /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(msgText);
    if (!looksLikeHash) return false;
    await this.clearPendingOkxTxHashSubmission(shopId, telegramUserId);
    await this.handleOkxVerifyByTxHash(
      shopId,
      token,
      message.chat.id,
      telegramUserId,
      pending.externalOrderCode,
      msgText,
      actions,
      language,
    );
    return true;
  }

  private async handleOkxVerifyByTxHash(
    shopId: string,
    token: string,
    chatId: number,
    telegramUserId: string,
    externalOrderCode: string,
    txHash: string,
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
      transaction.provider !== "OKX" ||
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
        okxPersonalApiKeyEncrypted: true,
        okxPersonalSecretKeyEncrypted: true,
        okxPersonalPassphraseEncrypted: true,
        okxPersonalApiEnabled: true,
      },
    });
    if (
      !config?.okxPersonalApiEnabled ||
      !config.okxPersonalApiKeyEncrypted ||
      !config.okxPersonalSecretKeyEncrypted ||
      !config.okxPersonalPassphraseEncrypted
    ) {
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "OKX auto-verify is not configured for this shop."
          : language === "th"
            ? "ร้านค้ายังไม่ได้ตั้งค่า OKX auto-verify"
            : "Shop chưa bật OKX auto-verify.",
        actions,
      );
      return;
    }
    try {
      const apiKey =
        decryptSecret(
          config.okxPersonalApiKeyEncrypted,
          this.config.encryptionKey,
        )?.trim() ?? "";
      const secret =
        decryptSecret(
          config.okxPersonalSecretKeyEncrypted,
          this.config.encryptionKey,
        )?.trim() ?? "";
      const passphrase =
        decryptSecret(
          config.okxPersonalPassphraseEncrypted,
          this.config.encryptionKey,
        )?.trim() ?? "";
      const manualCrypto =
        (transaction.rawPayloadJson as any)?.manualCrypto || {};
      const requiredUsdt = Number(manualCrypto.usdtAmount || 0);

      const sinceMs = Math.max(0, transaction.createdAt.getTime() - 60 * 1000);
      const deposit = await this.okxPersonalApiService.findDepositByTxHash(
        apiKey,
        secret,
        passphrase,
        txHash,
        sinceMs,
      );
      if (!deposit) {
        await this.sendText(
          token,
          chatId,
          language === "en"
            ? "TX hash not found in recent OKX deposit history. Make sure the deposit is fully credited (state = on-chain confirmed) and try again."
            : language === "th"
              ? "ไม่พบ TX hash นี้ในประวัติเงินฝาก OKX ล่าสุด กรุณาตรวจสอบให้แน่ใจว่าเงินฝากได้รับการยืนยันบนเครือข่ายแล้วลองอีกครั้ง"
              : "Không tìm thấy TX hash này trong lịch sử deposit OKX gần đây. Kiểm tra xem giao dịch đã credited (on-chain confirmed) chưa rồi thử lại.",
          actions,
        );
        return;
      }
      const matchAmount = Number(deposit.amt || 0);
      const transactionAt = new Date(Number(deposit.ts));
      if (!Number.isFinite(transactionAt.getTime())) {
        throw new Error("OKX deposit timestamp is missing or invalid.");
      }
      if (requiredUsdt > 0 && Math.abs(matchAmount - requiredUsdt) > 0.01) {
        await this.sendText(
          token,
          chatId,
          language === "en"
            ? `Payment amount mismatch. Expected ${requiredUsdt} USDT, got ${matchAmount} USDT.`
            : language === "th"
              ? `จำนวนเงินไม่ตรงกัน คาดหวัง ${requiredUsdt} USDT ได้รับ ${matchAmount} USDT`
              : `Số tiền không khớp. Cần ${requiredUsdt} USDT, deposit có ${matchAmount} USDT.`,
          actions,
        );
        return;
      }
      const receipt = await this.paymentService.claimOnchainPaymentReceipt({
        provider: PaymentProvider.OKX,
        txHash: deposit.txId,
        externalOrderCode,
        amountUsdt: matchAmount,
        destination: String(manualCrypto.uid || "").trim(),
        transactionAt,
        rawPayload: deposit,
      });
      await this.ordersService.markPaymentCompleted(
        externalOrderCode,
        {
          provider: "OKX",
          autoVerified: true,
          verificationMode: "okx_tx_hash",
          txHash: deposit.txId,
          chain: deposit.chain,
          amount: deposit.amt,
          depositId: deposit.depId,
        },
        { cryptoTxHash: deposit.txId },
      );
      await this.paymentService.markOnchainPaymentReceiptProcessed(
        receipt.id,
        deposit,
      );
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "✅ OKX payment verified successfully!"
          : language === "th"
            ? "✅ ยืนยันการชำระเงิน OKX สำเร็จ!"
            : "✅ Xác minh thanh toán OKX thành công!",
        actions,
      );
    } catch (e) {
      this.logger.error(
        `Error verifying OKX tx hash for shop ${shopId}:`,
        e instanceof Error ? e.stack : String(e),
      );
      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "Unable to check OKX deposit right now. Please try again shortly."
          : language === "th"
            ? "ไม่สามารถตรวจสอบเงินฝาก OKX ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"
            : "Tạm thời chưa kiểm tra được OKX. Vui lòng thử lại sau.",
        actions,
      );
    }
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
      await this.sendText(
        token,
        chatId,
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
          ? "Binance verification not configured."
          : language === "th"
            ? "ร้านค้ายังไม่ได้ตั้งค่า Binance API"
            : "Shop chưa cấu hình Binance API.",
        actions,
      );
      return;
    }

    try {
      const apiKey =
        decryptSecret(
          config.binancePersonalApiKeyEncrypted,
          this.config.encryptionKey,
        )?.trim() ?? "";
      const secretKey =
        decryptSecret(
          config.binancePersonalSecretKeyEncrypted,
          this.config.encryptionKey,
        )?.trim() ?? "";
      const configuredBinanceUid = String(config.binanceUid || "").trim();
      const manualCrypto =
        (transaction.rawPayloadJson as any)?.manualCrypto || {};
      const requiredUsdt = Number(manualCrypto.usdtAmount || 0);

      const startTime = Math.max(
        0,
        transaction.createdAt.getTime() - 10 * 60 * 1000,
      );
      const history = await this.binancePayService.queryPersonalPayTransactions(
        apiKey,
        secretKey,
        startTime,
      );

      const match = history.find(
        (item) => String(item.orderId || "") === binanceOrderId,
      );

      if (!match) {
        await this.sendText(
          token,
          chatId,
          language === "en"
            ? "Order ID not found in recent Binance Pay history. Please check and try again."
            : language === "th"
              ? "ไม่พบ Order ID นี้ในประวัติ Binance Pay ล่าสุด กรุณาตรวจสอบและลองใหม่"
              : "Không tìm thấy ID lệnh này trong lịch sử Binance. Kiểm tra lại và thử lại.",
          actions,
        );
        return;
      }

      const receiverBinanceId = String(
        match.receiverInfo?.binanceId || match.payeeId || "",
      ).trim();
      const matchAmount = Number(match.amount ?? match.orderAmount ?? 0);
      const transactionAt = new Date(Number(match.transactionTime));
      const matchCurrency = String(match.currency || "")
        .trim()
        .toUpperCase();

      if (
        matchCurrency !== "USDT" ||
        !Number.isFinite(transactionAt.getTime()) ||
        transactionAt.getTime() < transaction.createdAt.getTime() ||
        transactionAt.getTime() > Date.now() + 5 * 60 * 1000
      ) {
        await this.sendText(
          token,
          chatId,
          language === "en"
            ? "This Binance transaction has the wrong currency or timestamp."
            : "Giao dịch Binance không đúng loại tiền hoặc thời gian của yêu cầu thanh toán.",
          actions,
        );
        return;
      }

      if (receiverBinanceId !== configuredBinanceUid) {
        await this.sendText(
          token,
          chatId,
          language === "en"
            ? "This payment was sent to a different Binance account. Please check and try again."
            : language === "th"
              ? "การชำระเงินนี้ถูกส่งไปยังบัญชี Binance อื่น กรุณาตรวจสอบและลองใหม่"
              : "Giao dịch này không gửi đến đúng tài khoản Binance của shop.",
          actions,
        );
        return;
      }

      if (
        requiredUsdt > 0 &&
        !isBinanceAmountWithinTolerance(matchAmount, requiredUsdt)
      ) {
        await this.sendText(
          token,
          chatId,
          language === "en"
            ? `Payment amount mismatch. Expected ${requiredUsdt} USDT, got ${matchAmount} USDT.`
            : language === "th"
              ? `จำนวนเงินไม่ตรงกัน คาดหวัง ${requiredUsdt} USDT ได้รับ ${matchAmount} USDT`
              : `Số tiền không khớp. Cần ${requiredUsdt} USDT, nhận được ${matchAmount} USDT.`,
          actions,
        );
        return;
      }

      const receipt = await this.paymentService.claimOnchainPaymentReceipt({
        provider: PaymentProvider.BINANCE,
        txHash: String(match.transactionId || match.orderId || "").trim(),
        externalOrderCode,
        amountUsdt: matchAmount,
        destination: receiverBinanceId,
        transactionAt,
        rawPayload: match,
      });

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
      await this.paymentService.markOnchainPaymentReceiptProcessed(
        receipt.id,
        match,
      );

      await this.sendText(
        token,
        chatId,
        language === "en"
          ? "✅ Payment verified successfully!"
          : language === "th"
            ? "✅ ยืนยันการชำระเงินสำเร็จ!"
            : "✅ Xác minh thanh toán thành công!",
        actions,
      );
    } catch (e) {
      this.logger.error(
        `Error verifying Binance order ID for shop ${shopId}:`,
        e instanceof Error ? e.stack : String(e),
      );
      await this.sendText(
        token,
        chatId,
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
      const apiKey =
        decryptSecret(
          config.binancePersonalApiKeyEncrypted,
          this.config.encryptionKey,
        )?.trim() ?? "";
      const secretKey =
        decryptSecret(
          config.binancePersonalSecretKeyEncrypted,
          this.config.encryptionKey,
        )?.trim() ?? "";
      const configuredBinanceUid = String(config.binanceUid || "").trim();
      const manualCrypto =
        (transaction.rawPayloadJson as any)?.manualCrypto || {};
      const requiredUsdt = Number(manualCrypto.usdtAmount || 0);

      if (!apiKey || !secretKey || !configuredBinanceUid) {
        throw new Error("Binance personal API decryption failed.");
      }

      if (!Number.isFinite(requiredUsdt) || requiredUsdt <= 0) {
        throw new Error("Missing required Binance UID amount.");
      }

      const startTime = Math.max(
        0,
        transaction.createdAt.getTime() - 10 * 60 * 1000,
      );
      const history = await this.binancePayService.queryPersonalPayTransactions(
        apiKey,
        secretKey,
        startTime,
      );

      const match = history
        .filter((item) => {
          const receiverBinanceId = String(
            item.receiverInfo?.binanceId || item.payeeId || "",
          ).trim();
          const currency = String(item.currency || "")
            .trim()
            .toUpperCase();
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
        const matchAmount = Number(match.amount ?? match.orderAmount ?? 0);
        const receipt = await this.paymentService.claimOnchainPaymentReceipt({
          provider: PaymentProvider.BINANCE,
          txHash: String(match.transactionId || match.orderId || "").trim(),
          externalOrderCode,
          amountUsdt: matchAmount,
          destination: String(
            match.receiverInfo?.binanceId || match.payeeId || "",
          ).trim(),
          transactionAt: new Date(Number(match.transactionTime)),
          rawPayload: match,
        });
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
        await this.paymentService.markOnchainPaymentReceiptProcessed(
          receipt.id,
          match,
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
    const chat = message?.chat || callbackQuery?.message?.chat;

    if (!from?.id || !isPrivateTelegramChat(chat, from.id)) {
      return;
    }
    const chatId = chat.id;

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
        // Refresh the cached Premium flag on every interaction (self-heals when premium lapses).
        isPremium: (from as any)?.is_premium === true,
        isPremiumCheckedAt: new Date(),
      },
      create: {
        sellerId: shop.sellerId,
        shopId: shop.id,
        telegramUserId: String(from.id),
        telegramChatId: String(chatId),
        telegramUsername: from.username || null,
        firstName: from.first_name || null,
        lastName: from.last_name || null,
        isPremium: (from as any)?.is_premium === true,
        isPremiumCheckedAt: new Date(),
      },
    });
  }

  private formatDateTime(value: Date) {
    return this.render.formatDateTime(value);
  }

  private createSimulationToken(token: string) {
    return this.tg.createSimulationToken(token);
  }

  private isSimulationToken(token: string) {
    return this.tg.isSimulationToken(token);
  }

  private normalizeLanguage(value: unknown): BotLanguage {
    return this.render.normalizeLanguage(value);
  }

  private async getCustomerLanguage(
    shopId: string,
    telegramUserId: string,
  ): Promise<BotLanguage> {
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

  /**
   * Whether this bot may render the "bling" custom-emoji interface. We do NOT detect the owner's
   * premium directly (Telegram can't be queried for it, and a typed-in id is gameable). Instead:
   * configured cusids already imply a premium owner (only premium accounts can pick custom emoji),
   * so the per-button gate already keys off cusid presence. This flag is the SAFETY OVERRIDE: if the
   * bot has self-learned it CANNOT actually emit custom emoji (cusidEmitOk === false — set when
   * Telegram rejects a small cusid message, see markCusidEmitFailed), fall back to text icons.
   * NULL/true → attempt bling; false → text icons.
   */
  private async resolveCanBling(shopId: string): Promise<boolean> {
    const contextual = this.btnCtx.getStore();
    if (contextual) return contextual.canBling;

    const bc = await this.prisma.botConfig.findUnique({
      where: { shopId },
      select: { cusidEmitOk: true, ownerTelegramUserId: true },
    });
    if (bc?.cusidEmitOk === false || !bc?.ownerTelegramUserId) return false;

    const owner = await this.prisma.customer.findUnique({
      where: {
        shopId_telegramUserId: {
          shopId,
          telegramUserId: bc.ownerTelegramUserId,
        },
      },
      select: { isPremium: true },
    });
    return owner?.isPremium === true;
  }

  /**
   * Self-learn that this bot can't actually emit custom emoji (owner not premium): set when a small
   * home-menu cusid message was rejected by Telegram and had to be stripped. From then on
   * resolveCanBling returns false → text icons. Only writes when not already false.
   */
  private async markCusidEmitFailed(shopId: string): Promise<void> {
    await this.prisma.botConfig
      .updateMany({
        where: { shopId, cusidEmitOk: { not: false } },
        data: { cusidEmitOk: false },
      })
      .catch(() => undefined);
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
          ? [
              "🌐 Choose your language",
              "",
              "Please select a language before entering the shop.",
            ].join("\n")
          : language === "th"
            ? ["🌐 เลือกภาษา", "", "กรุณาเลือกภาษาก่อนเข้าร้านค้า"].join("\n")
            : language === "zh"
              ? ["🌐 选择语言", "", "进入商店前请选择语言。"].join("\n")
              : [
                  "🌐 Chọn ngôn ngữ",
                  "",
                  "Vui lòng chọn ngôn ngữ trước khi vào shop.",
                ].join("\n")
        : language === "en"
          ? "🌐 Choose bot language"
          : language === "th"
            ? "🌐 เลือกภาษาของบอท"
            : language === "zh"
              ? "🌐 选择机器人语言"
              : "🌐 Chọn ngôn ngữ cho bot";

    const inlineKeyboard: Array<
      Array<{ text: string; callback_data: string }>
    > = [
      [
        { text: "🇻🇳 Tiếng Việt", callback_data: "lang:set:vi" },
        { text: "🇬🇧 English", callback_data: "lang:set:en" },
        { text: "🇹🇭 ภาษาไทย", callback_data: "lang:set:th" },
        { text: "🇨🇳 简体中文", callback_data: "lang:set:zh" },
      ],
    ];

    if (variant !== "onboarding") {
      inlineKeyboard.push([this.navBtn("home", language, "home:menu")]);
    }

    // For onboarding we also attach the reply keyboard so it appears after language selection
    const replyMarkup: Record<string, unknown> =
      variant === "onboarding"
        ? { inline_keyboard: inlineKeyboard }
        : { inline_keyboard: inlineKeyboard };

    await this.editOrSend(token, chatId, messageId, text, replyMarkup, actions);
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
      | "affiliate"
      | "apiKey"
      | "viewAll"
      | "buyOther"
      | "payWallet"
      | "payQR"
      | "payBinance"
      | "payUsdt"
      | "paid"
      | "buyNow"
      | "back"
      | "contactAdmin"
      | "openCheckout"
      | "retry"
      | "txHash",
    language: BotLanguage,
  ): string {
    const def = this.render.buttonLabel(key, language);
    const store = this.btnCtx.getStore();
    if (!store) return def;
    const cust = store.cust;
    const labels =
      cust?.buttonLabels && typeof cust.buttonLabels === "object"
        ? (cust.buttonLabels as Record<string, Record<string, string>>)
        : {};
    const emojis =
      cust?.buttonEmojis && typeof cust.buttonEmojis === "object"
        ? (cust.buttonEmojis as Record<string, string>)
        : {};
    const sp = def.split(" ");
    const defEmoji = sp[0] ?? "";
    const defLabel = sp.slice(1).join(" ");
    const emoji = emojis[key]?.trim() || defEmoji;
    const label = labels[key]?.[language] || defLabel;
    return `${emoji} ${label}`.trim();
  }

  /** Full inline nav button (text + premium cusid) honouring the shop's function-button
   *  customization from btnCtx. Drop-in for `{ text: this.buttonLabel(key,lang), callback_data }`
   *  so the same button also gets the custom-emoji icon when the bot can emit it. */
  private navBtn(
    key: Parameters<typeof this.buttonLabel>[0],
    language: BotLanguage,
    cbData: string,
  ): { text: string; callback_data: string; icon_custom_emoji_id?: string } {
    const def = this.render.buttonLabel(key, language);
    const sp = def.split(" ");
    const defEmoji = sp[0] ?? "";
    const defLabel = sp.slice(1).join(" ");
    const store = this.btnCtx.getStore();
    const cust = store?.cust ?? {};
    const labels =
      cust?.buttonLabels && typeof cust.buttonLabels === "object"
        ? (cust.buttonLabels as Record<string, Record<string, string>>)
        : {};
    const emojis =
      cust?.buttonEmojis && typeof cust.buttonEmojis === "object"
        ? (cust.buttonEmojis as Record<string, string>)
        : {};
    const emojiIds =
      cust?.buttonEmojiIds && typeof cust.buttonEmojiIds === "object"
        ? (cust.buttonEmojiIds as Record<string, string>)
        : {};
    const label = labels[key]?.[language] || defLabel;
    const cusid = emojiIds[key]?.trim();
    const useCusid = Boolean(store?.canBling) && Boolean(cusid);
    const emoji = emojis[key]?.trim() || defEmoji;
    const btn: {
      text: string;
      callback_data: string;
      icon_custom_emoji_id?: string;
    } = {
      text: useCusid ? label : `${emoji} ${label}`.trim(),
      callback_data: cbData,
    };
    if (useCusid && cusid) btn.icon_custom_emoji_id = cusid;
    return btn;
  }

  private buildSupportText(
    shopName: string,
    supportTelegram: string | null,
    supportZalo: string | null,
    language: BotLanguage = "vi",
    supportNote?: string | null,
  ) {
    return this.render.buildSupportText(
      shopName,
      supportTelegram,
      supportZalo,
      language,
      supportNote,
    );
  }

  private buildHomeText(
    shopName: string,
    tagline: string,
    productCount: number,
    availableCount: number,
    language: BotLanguage = "vi",
    footerOverride?: string,
    iconOverride?: string,
  ) {
    return this.render.buildHomeText(
      shopName,
      tagline,
      productCount,
      availableCount,
      language,
      footerOverride,
      iconOverride,
    );
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
      otherProducts: sortedProducts.filter(
        (product) => !matchedIds.has(product.id),
      ),
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
      language === "en"
        ? "products"
        : language === "th"
          ? "รายการ"
          : "sản phẩm";
    return `${group.emoji} ${group.label} — ${group.items.length} ${unit}`;
  }

  private buildProductButtonLabel(
    product: CatalogItem,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
    hasCustomIcon = false,
  ) {
    const effectiveUsdPrice =
      language === "en" &&
      product.salePriceUsd != null &&
      product.salePriceUsd > 0
        ? product.salePriceUsd
        : null;
    const priceLabel =
      effectiveUsdPrice != null
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(effectiveUsdPrice)
        : this.formatCatalogButtonMoney(
            product.salePrice,
            language,
            usdtVndRate,
          );
    const isPreorderOnly =
      product.preorderEnabled &&
      product.available !== null &&
      product.available <= 0;
    const stockLabel = isPreorderOnly
      ? language === "en"
        ? `Pre-order +${product.preorderFeePercent}%`
        : language === "th"
          ? `สั่งจอง +${product.preorderFeePercent}%`
          : `Đặt trước +${product.preorderFeePercent}%`
      : product.available === null
        ? "∞"
        : String(Math.max(0, product.available));
    const suffix = ` | ${priceLabel} | ${isPreorderOnly ? "🕒" : "📦"} ${stockLabel}`;
    // When the button already carries an icon_custom_emoji_id (Bot API 9.4+),
    // Telegram renders that premium emoji as the button icon, so prepending a text
    // emoji too would show two icons. Only prepend a text-emoji fallback when the
    // button has no custom icon.
    const emoji = hasCustomIcon
      ? ""
      : product.productIcon?.trim() ||
        this.resolveProductEmoji(product.displayName, product.sourceName);
    const normalizedName = [
      emoji,
      this.compactProductName(
        this.localizeProductName(product.displayName, language),
      ),
    ]
      .filter(Boolean)
      .join(" ");
    const safeNameLength = Math.max(16, 58 - suffix.length);

    return this.sanitizeButtonText(
      `${this.truncateLabel(normalizedName, safeNameLength)}${suffix}`,
    );
  }

  private sanitizeButtonText(value: string): string {
    return String(value || "")
      .replace(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
        "",
      ) // lone surrogates
      .replace(/ /g, "") // null bytes
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // control chars except \t \n \r
      .trim();
  }

  private resolveProductEmoji(displayName: string, sourceName?: string | null) {
    return this.render.resolveProductEmoji(displayName, sourceName);
  }

  private resolveCustomEmojiId(
    displayName: string,
    sourceName?: string | null,
  ): { char: string; id: string } | null {
    return this.render.resolveCustomEmojiId(displayName, sourceName);
  }

  private compactProductName(value: string) {
    return this.render.compactProductName(value);
  }

  private localizeProductName(value: string, language: BotLanguage = "vi") {
    return this.render.localizeProductName(value, language);
  }

  private translateProductNameToVietnamese(value: string) {
    return this.render.translateProductNameToVietnamese(value);
  }

  private translateProductNameToEnglish(value: string) {
    return this.render.translateProductNameToEnglish(value);
  }

  private applyProductNameReplacements(
    value: string,
    replacements: Array<
      [RegExp, string | ((match: string, ...groups: string[]) => string)]
    >,
  ) {
    return this.render.applyProductNameReplacements(value, replacements);
  }

  private normalizeTranslationSource(value: string) {
    return this.render.normalizeTranslationSource(value);
  }

  private formatEnglishCount(
    rawAmount: string,
    unit: "day" | "month" | "year",
  ) {
    return this.render.formatEnglishCount(rawAmount, unit);
  }

  private async getShopUsdtVndRate(shopId: string) {
    const paymentConfig = await this.prisma.paymentConfig.findUnique({
      where: { shopId },
      select: { usdtVndRateOverride: true },
    });

    return this.resolveUsdtVndRate(paymentConfig?.usdtVndRateOverride);
  }

  private resolveUsdtVndRate(value?: Prisma.Decimal | number | string | null) {
    const overrideRate = Number(value ?? NaN);

    if (Number.isFinite(overrideRate) && overrideRate > 0) {
      return overrideRate;
    }

    const fallbackRate = Number(this.config.usdtVndRate || 26000);
    return Number.isFinite(fallbackRate) && fallbackRate > 0
      ? fallbackRate
      : 26000;
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
    if (
      (language === "en" || language === "th") &&
      salePriceUsd != null &&
      salePriceUsd > 0
    ) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(salePriceUsd);
    }
    return this.formatBotMoney(vndAmount, language, usdtVndRate);
  }

  private formatCatalogButtonMoney(
    value: number,
    language: BotLanguage = "vi",
    usdtVndRate?: Prisma.Decimal | number | string | null,
  ) {
    return language === "en" || language === "th"
      ? this.formatBotMoney(value, language, usdtVndRate)
      : this.render.formatCatalogButtonMoney(value);
  }

  private localizeBotErrorMessage(
    error: unknown,
    language: BotLanguage,
    fallbackMessage?: string,
  ) {
    return this.render.localizeBotErrorMessage(
      error,
      language,
      fallbackMessage,
    );
  }

  private isLikelyVietnameseText(value: string) {
    return this.render.isLikelyVietnameseText(value);
  }

  private async loadCustData(
    shopId: string,
  ): Promise<{
    custEmojis: Record<string, string>;
    custLabels: Record<string, Record<string, string>>;
    custEmojiIds: Record<string, string>;
  }> {
    const shopData = await this.shopsService.getSellerShopByShopId(shopId);
    const customization = await this.resolveEffectiveCustomization(
      shopId,
      (shopData.botConfig?.customizationJson as Record<
        string,
        unknown
      > | null) ?? null,
    );
    return {
      custEmojis:
        customization?.buttonEmojis &&
        typeof customization.buttonEmojis === "object"
          ? (customization.buttonEmojis as Record<string, string>)
          : {},
      custLabels:
        customization?.buttonLabels &&
        typeof customization.buttonLabels === "object"
          ? (customization.buttonLabels as Record<
              string,
              Record<string, string>
            >)
          : {},
      custEmojiIds:
        customization?.buttonEmojiIds &&
        typeof customization.buttonEmojiIds === "object"
          ? (customization.buttonEmojiIds as Record<string, string>)
          : {},
    };
  }

  private buildCatalogNavButtons(
    custData: {
      custEmojis: Record<string, string>;
      custLabels: Record<string, Record<string, string>>;
      custEmojiIds: Record<string, string>;
    },
    language: BotLanguage,
    isPremium = false,
  ) {
    const navBtn = (
      key: string,
      fallback: Parameters<typeof this.buttonLabel>[0],
      cbData: string,
    ) => {
      const full = this.buttonLabel(fallback, language);
      const defEmoji = full.split(" ")[0];
      const defLabel = full.split(" ").slice(1).join(" ");
      const useCustom = isPremium && Boolean(custData.custEmojiIds[key]);
      const emoji = custData.custEmojis[key]?.trim() || defEmoji;
      const label = custData.custLabels[key]?.[language] || defLabel;
      const btn: Record<string, string> = {
        text: useCustom ? label : `${emoji} ${label}`,
        callback_data: cbData,
      };
      if (useCustom && custData.custEmojiIds[key])
        btn.icon_custom_emoji_id = custData.custEmojiIds[key];
      return btn;
    };
    return [
      [
        navBtn("home", "home", "home:menu"),
        navBtn("support", "supportShort", "home:support"),
      ],
    ];
  }

  /** Rough serialized byte size of one inline-keyboard button (for markup-size budgeting). */
  private inlineBtnBytes(btn: Record<string, unknown>): number {
    return JSON.stringify(btn).length + 4; // + array/comma overhead
  }

  /**
   * Split product-button rows into pages so each page's full inline keyboard stays safely
   * within Telegram's reply_markup limits (10 KB max payload, 100 max buttons).
   * Packs GREEDILY by byte size and button count against a safe budget, taking into account
   * fixed rows (categories, refresh, nav, pagination buttons) that are rendered on every page.
   */
  private paginateProductRows(
    rows: Record<string, string>[][],
    fixedBytes = 0,
    fixedRowCount = 0,
    fixedButtonCount = 0,
  ): Record<string, string>[][][] {
    if (rows.length === 0) return [[]];

    // Telegram Bot API limits: 10,240 bytes max for reply_markup, 100 max total buttons.
    // We maintain a conservative budget of 6,500 bytes and 70 total buttons to leave ample headroom.
    const MARKUP_BYTE_BUDGET = 6500;
    const MAX_TOTAL_BUTTONS = 70;
    const MAX_TOTAL_ROWS = 35;
    const MAX_PRODUCTS_PER_PAGE = 25;

    const availableByteBudget = Math.max(800, MARKUP_BYTE_BUDGET - fixedBytes);
    const availableButtonBudget = Math.max(
      3,
      MAX_TOTAL_BUTTONS - fixedButtonCount,
    );
    const availableRowBudget = Math.max(
      3,
      Math.min(MAX_PRODUCTS_PER_PAGE, MAX_TOTAL_ROWS - fixedRowCount),
    );

    // If all rows fit comfortably within the available budget, return a single page.
    let totalRowsBytes = 0;
    let totalRowsButtons = 0;
    for (const r of rows) {
      totalRowsBytes += r.reduce(
        (s, b) => s + this.inlineBtnBytes(b as Record<string, unknown>),
        0,
      );
      totalRowsButtons += r.length;
    }

    if (
      rows.length <= availableRowBudget &&
      totalRowsBytes <= availableByteBudget &&
      totalRowsButtons <= availableButtonBudget
    ) {
      return [rows];
    }

    const pages: Record<string, string>[][][] = [];
    let cur: Record<string, string>[][] = [];
    let curBytes = 0;
    let curButtons = 0;

    for (const row of rows) {
      const rb = row.reduce(
        (s, b) => s + this.inlineBtnBytes(b as Record<string, unknown>),
        0,
      );
      const rButtons = row.length;

      const wouldExceedBytes = curBytes + rb > availableByteBudget;
      const wouldExceedButtons = curButtons + rButtons > availableButtonBudget;
      const wouldExceedRows = cur.length >= availableRowBudget;

      if (
        cur.length > 0 &&
        (wouldExceedBytes || wouldExceedButtons || wouldExceedRows)
      ) {
        pages.push(cur);
        cur = [];
        curBytes = 0;
        curButtons = 0;
      }
      cur.push(row);
      curBytes += rb;
      curButtons += rButtons;
    }

    if (cur.length > 0) {
      pages.push(cur);
    }

    return pages.length > 0 ? pages : [[]];
  }

  /** Prev / page-indicator / Next row for a paginated catalog (callback catalog:page:N or custom prefix). Empty if 1 page. */
  private buildCatalogPageNav(
    page: number,
    totalPages: number,
    language: BotLanguage,
    cbPrefix = "catalog:page",
  ): Record<string, string>[][] {
    if (totalPages <= 1) return [];
    const row: Record<string, string>[] = [];
    if (page > 0) {
      row.push({
        text:
          language === "en"
            ? "◀️ Prev"
            : language === "th"
              ? "◀️ ก่อนหน้า"
              : "◀️ Trước",
        callback_data: `${cbPrefix}:${page - 1}`,
      });
    }
    row.push({
      text: `${page + 1}/${totalPages}`,
      callback_data: `${cbPrefix}:${page}`,
    });
    if (page < totalPages - 1) {
      row.push({
        text:
          language === "en"
            ? "Next ▶️"
            : language === "th"
              ? "ถัดไป ▶️"
              : "Sau ▶️",
        callback_data: `${cbPrefix}:${page + 1}`,
      });
    }
    return [row];
  }

  private buildRefreshBtn(
    custData: {
      custEmojis: Record<string, string>;
      custLabels: Record<string, Record<string, string>>;
      custEmojiIds: Record<string, string>;
    },
    language: BotLanguage,
    cbData: string,
    isPremium = false,
  ) {
    const defEmoji = "🔄";
    const defLabel =
      language === "en" ? "Refresh" : language === "th" ? "รีเฟรช" : "Làm mới";
    const useCustom = isPremium && Boolean(custData.custEmojiIds["refresh"]);
    const emoji = custData.custEmojis["refresh"]?.trim() || defEmoji;
    const label = custData.custLabels["refresh"]?.[language] || defLabel;
    const btn: Record<string, string> = {
      text: useCustom ? label : `${emoji} ${label}`,
      callback_data: cbData,
    };
    if (useCustom && custData.custEmojiIds["refresh"])
      btn.icon_custom_emoji_id = custData.custEmojiIds["refresh"];
    return btn;
  }

  private buildNavTextBtn(
    custData: {
      custEmojis: Record<string, string>;
      custLabels: Record<string, Record<string, string>>;
      custEmojiIds: Record<string, string>;
    },
    key: string,
    fallback: Parameters<typeof this.buttonLabel>[0],
    cbData: string,
    language: BotLanguage,
    isPremium = false,
  ) {
    const full = this.buttonLabel(fallback, language);
    const defEmoji = full.split(" ")[0];
    const defLabel = full.split(" ").slice(1).join(" ");
    const useCustom = isPremium && Boolean(custData.custEmojiIds[key]);
    const emoji = custData.custEmojis[key]?.trim() || defEmoji;
    const label = custData.custLabels[key]?.[language] || defLabel;
    const btn: Record<string, string> = {
      text: useCustom ? label : `${emoji} ${label}`,
      callback_data: cbData,
    };
    if (useCustom && custData.custEmojiIds[key])
      btn.icon_custom_emoji_id = custData.custEmojiIds[key];
    return btn;
  }

  /**
   * Per-viewer inline button (same rule the catalog/home builders inline): a premium viewer WITH a
   * cusid → cusid icon only (text emoji stripped, no double); everyone else → "textEmoji label" so a
   * non-premium viewer never gets a blank button. For the payment/quantity/notification gap sites.
   */
  private buildViewerBtn(
    args: {
      textEmoji: string;
      label: string;
      cusid?: string | null;
      isPremium: boolean;
    },
    extra: Record<string, string>,
  ): Record<string, string> {
    const useCustom = args.isPremium && Boolean(args.cusid);
    const btn: Record<string, string> = {
      text: useCustom ? args.label : `${args.textEmoji} ${args.label}`.trim(),
      ...extra,
    };
    if (useCustom && args.cusid) btn.icon_custom_emoji_id = args.cusid;
    return btn;
  }

  private chunkButtons<T>(items: T[], size: number) {
    return this.render.chunkButtons(items, size);
  }

  private truncateLabel(value: string, maxLength: number) {
    return this.render.truncateLabel(value, maxLength);
  }

  private formatStock(available: number | null, language: BotLanguage = "vi") {
    return this.render.formatStock(available, language);
  }

  private escapeHtml(value: string) {
    return this.render.escapeHtml(value);
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
    return this.tg.editOrSend(
      token,
      chatId,
      messageId,
      text,
      replyMarkup,
      actions,
      parseMode,
    );
  }

  private async sendText(
    token: string,
    chatId: string | number,
    text: string,
    actions: unknown[],
    replyMarkup?: Record<string, unknown>,
    parseMode?: "HTML" | "Markdown",
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
      custom_emoji_id?: string;
    }>,
  ) {
    return this.tg.sendText(
      token,
      chatId,
      text,
      actions,
      replyMarkup,
      parseMode,
      entities,
    );
  }

  private hasInlineEmojiIds(
    markup: Record<string, unknown> | undefined,
  ): boolean {
    return this.tg.hasInlineEmojiIds(markup);
  }

  private stripInlineEmojiIds(
    markup: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    return this.tg.stripInlineEmojiIds(markup);
  }

  private async sendPhoto(
    token: string,
    chatId: string | number,
    photo: string | Buffer,
    caption: string,
    actions: unknown[],
    replyMarkup?: Record<string, unknown>,
    parseMode?: "HTML" | "Markdown",
  ): Promise<number | null> {
    return this.tg.sendPhoto(
      token,
      chatId,
      photo,
      caption,
      actions,
      replyMarkup,
      parseMode,
    );
  }

  private async editText(
    token: string,
    chatId: string | number,
    messageId: number,
    text: string,
    replyMarkup: Record<string, unknown>,
    actions: unknown[],
    parseMode?: "HTML" | "Markdown",
    onCusidStripped?: () => void | Promise<void>,
    resendOnFailure = true,
  ) {
    return this.tg.editText(
      token,
      chatId,
      messageId,
      text,
      replyMarkup,
      actions,
      parseMode,
      onCusidStripped,
      resendOnFailure,
    );
  }

  private async editCaption(
    token: string,
    chatId: string | number,
    messageId: number,
    caption: string,
    replyMarkup: Record<string, unknown>,
    actions: unknown[],
    parseMode?: "HTML" | "Markdown",
    onCusidStripped?: () => void | Promise<void>,
  ) {
    return this.tg.editCaption(
      token,
      chatId,
      messageId,
      caption,
      replyMarkup,
      actions,
      parseMode,
      onCusidStripped,
    );
  }

  private async answerCallback(
    token: string,
    callbackQueryId: string,
    actions: unknown[],
  ) {
    return this.tg.answerCallback(token, callbackQueryId, actions);
  }
}
