import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  SellerStatus,
  SellerTier,
  ShopStatus,
  SourceProductFamily,
  UserRole,
  UserStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptSecret } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { slugify, toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";

import type {
  RemoveProductDefaultDto,
  ResetShopCustomizationDto,
  SetProductDefaultDto,
  UpdateTemplateCustomizationDto,
  UploadMediaUrlDto,
} from "./admin-template.dto";

const ADMIN_TEMPLATE_USERNAME = "admin-template-system";
const ADMIN_TEMPLATE_DISPLAY_NAME = "Admin Template";

@Injectable()
export class AdminTemplateService {
  private readonly logger = new Logger(AdminTemplateService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  private async assertSuperAdmin(user: AuthenticatedUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });
    if (u?.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Only SUPER_ADMIN can manage admin template.");
    }
  }

  /**
   * Find the admin template shop. Throws if not bootstrapped.
   */
  async findTemplateShop() {
    const shop = await this.prisma.shop.findFirst({
      where: { isTemplate: true },
      include: { botConfig: true },
    });
    if (!shop) {
      throw new NotFoundException("Admin template shop not bootstrapped. Call bootstrap first.");
    }
    return shop;
  }

  async findTemplateShopOrNull() {
    return this.prisma.shop.findFirst({
      where: { isTemplate: true },
      include: { botConfig: true },
    });
  }

  /**
   * Create the admin template shop if missing. Idempotent.
   */
  async bootstrap(user: AuthenticatedUser) {
    await this.assertSuperAdmin(user);

    const existing = await this.findTemplateShopOrNull();
    if (existing) {
      return { existed: true, shopId: existing.id };
    }

    const passwordHash = await bcrypt.hash(`adm-tpl-${Date.now()}-${Math.random()}`, 10);

    const shop = await this.prisma.$transaction(async (tx) => {
      // Reuse if a user with the system username already exists
      let systemUser = await tx.user.findUnique({
        where: { email: ADMIN_TEMPLATE_USERNAME },
        include: { seller: true },
      });

      if (!systemUser) {
        systemUser = await tx.user.create({
          data: {
            email: ADMIN_TEMPLATE_USERNAME,
            passwordHash,
            role: UserRole.SUPER_ADMIN,
            status: UserStatus.ACTIVE,
          },
          include: { seller: true },
        });
      }

      let seller = systemUser.seller;
      if (!seller) {
        seller = await tx.seller.create({
          data: {
            userId: systemUser.id,
            displayName: ADMIN_TEMPLATE_DISPLAY_NAME,
            tier: SellerTier.ULTRA,
            status: SellerStatus.ACTIVE,
          },
        });

        await tx.sellerWallet.create({
          data: {
            sellerId: seller.id,
            balance: toDecimal(0),
            currency: this.config.defaultCurrency,
          },
        });
      }

      const newShop = await tx.shop.create({
        data: {
          sellerId: seller.id,
          slug: `${slugify(ADMIN_TEMPLATE_DISPLAY_NAME)}-${Math.random().toString(36).slice(2, 6)}`,
          name: ADMIN_TEMPLATE_DISPLAY_NAME,
          status: ShopStatus.ACTIVE,
          isTemplate: true,
          defaultCurrency: this.config.defaultCurrency,
        },
      });

      // BotConfig — global default + empty customization
      await tx.botConfig.upsert({
        where: { shopId: newShop.id },
        create: {
          shopId: newShop.id,
          telegramBotTokenEncrypted: "",
          isGlobalDefault: true,
          webhookStatus: "DISABLED",
          deliveryMode: "POLLING",
          customizationJson: {} as Prisma.InputJsonValue,
        },
        update: {
          isGlobalDefault: true,
        },
      });

      // Demote any other global default
      await tx.botConfig.updateMany({
        where: {
          isGlobalDefault: true,
          shopId: { not: newShop.id },
        },
        data: { isGlobalDefault: false },
      });

      return newShop;
    });

    this.logger.log(`Admin template shop bootstrapped: ${shop.id}`);
    return { existed: false, shopId: shop.id };
  }

  /**
   * Read template customization JSON.
   */
  async getTemplate(user: AuthenticatedUser) {
    await this.assertSuperAdmin(user);
    const shop = await this.findTemplateShop();
    return {
      shopId: shop.id,
      shopName: shop.name,
      botConfig: shop.botConfig
        ? {
            id: shop.botConfig.id,
            telegramBotUsername: shop.botConfig.telegramBotUsername,
            isGlobalDefault: shop.botConfig.isGlobalDefault,
            customization: (shop.botConfig.customizationJson as Record<string, any>) ?? {},
          }
        : null,
    };
  }

  /**
   * Update template customizationJson.
   */
  async updateTemplate(user: AuthenticatedUser, dto: UpdateTemplateCustomizationDto) {
    await this.assertSuperAdmin(user);
    const shop = await this.findTemplateShop();
    if (!shop.botConfig) {
      throw new BadRequestException("BotConfig missing for template shop.");
    }
    await this.prisma.botConfig.update({
      where: { id: shop.botConfig.id },
      data: {
        customizationJson: dto.customization as Prisma.InputJsonValue,
      },
    });
    return { success: true };
  }

  /**
   * Add or update a productDefaultsByFamily entry (keyed by SourceProductFamily enum).
   */
  async setProductDefault(user: AuthenticatedUser, dto: SetProductDefaultDto) {
    await this.assertSuperAdmin(user);
    const shop = await this.findTemplateShop();
    if (!shop.botConfig) {
      throw new BadRequestException("BotConfig missing for template shop.");
    }
    const cust = (shop.botConfig.customizationJson as Record<string, any>) ?? {};
    const map: Record<string, any> = { ...(cust.productDefaultsByFamily ?? {}) };
    map[dto.family] = {
      icon: dto.icon ?? null,
      customEmojiId: dto.customEmojiId ?? null,
      description: dto.description ?? null,
      media: dto.media ?? null,
    };
    cust.productDefaultsByFamily = map;
    await this.prisma.botConfig.update({
      where: { id: shop.botConfig.id },
      data: { customizationJson: cust as Prisma.InputJsonValue },
    });
    return { success: true, defaults: map };
  }

  async removeProductDefault(user: AuthenticatedUser, dto: RemoveProductDefaultDto) {
    await this.assertSuperAdmin(user);
    const shop = await this.findTemplateShop();
    if (!shop.botConfig) return { success: true };
    const cust = (shop.botConfig.customizationJson as Record<string, any>) ?? {};
    if (!cust.productDefaultsByFamily) return { success: true };
    delete cust.productDefaultsByFamily[dto.family];
    await this.prisma.botConfig.update({
      where: { id: shop.botConfig.id },
      data: { customizationJson: cust as Prisma.InputJsonValue },
    });
    return { success: true };
  }

  /**
   * Set media via URL keyed by family.
   */
  async setMediaUrl(user: AuthenticatedUser, dto: UploadMediaUrlDto) {
    await this.assertSuperAdmin(user);
    const shop = await this.findTemplateShop();
    if (!shop.botConfig) {
      throw new BadRequestException("BotConfig missing for template shop.");
    }
    const cust = (shop.botConfig.customizationJson as Record<string, any>) ?? {};
    const map: Record<string, any> = { ...(cust.productDefaultsByFamily ?? {}) };
    const existing = map[dto.family] ?? {};
    existing.media = {
      type: dto.type,
      url: dto.url,
      caption: dto.caption ?? null,
    };
    map[dto.family] = existing;
    cust.productDefaultsByFamily = map;
    await this.prisma.botConfig.update({
      where: { id: shop.botConfig.id },
      data: { customizationJson: cust as Prisma.InputJsonValue },
    });
    await this.prisma.botMediaCache.deleteMany({
      where: { mediaKey: { startsWith: `family:${dto.family}:` } },
    });
    return { success: true };
  }

  /**
   * Set Telegram bot token for admin template.
   * Encrypts before saving.
   */
  async setBotToken(user: AuthenticatedUser, token: string) {
    await this.assertSuperAdmin(user);
    const shop = await this.findTemplateShop();
    if (!shop.botConfig) {
      throw new BadRequestException("BotConfig missing for template shop.");
    }
    const cleaned = token.trim();
    if (!cleaned) {
      // Empty → clear token
      await this.prisma.botConfig.update({
        where: { id: shop.botConfig.id },
        data: {
          telegramBotTokenEncrypted: "",
          telegramBotId: null,
          telegramBotUsername: null,
        },
      });
      return { success: true, cleared: true };
    }
    // Quick validation: token format is "<numeric>:<35+ chars>"
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(cleaned)) {
      throw new BadRequestException("Token Telegram không đúng định dạng.");
    }
    const enc = encryptSecret(cleaned, this.config.encryptionKey);
    // Try fetch bot info from Telegram to validate + capture username/id
    let botId: string | null = null;
    let botUsername: string | null = null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${cleaned}/getMe`);
      const json = (await res.json()) as any;
      if (json?.ok && json.result) {
        botId = String(json.result.id);
        botUsername = String(json.result.username);
      }
    } catch {}
    await this.prisma.botConfig.update({
      where: { id: shop.botConfig.id },
      data: {
        telegramBotTokenEncrypted: enc,
        telegramBotId: botId,
        telegramBotUsername: botUsername,
      },
    });
    return { success: true, botId, botUsername };
  }

  /**
   * Upload a media file (image/video/animation) for admin template.
   * Saves to local uploads dir → returns public URL.
   */
  async uploadMediaFile(user: AuthenticatedUser, file: Express.Multer.File): Promise<{ url: string; type: string }> {
    await this.assertSuperAdmin(user);
    if (!file) throw new BadRequestException("No file uploaded.");

    let type: "photo" | "video" | "animation" = "photo";
    if (file.mimetype.startsWith("video/")) type = "video";
    else if (file.mimetype === "image/gif") type = "animation";
    else if (file.mimetype.startsWith("image/")) type = "photo";
    else throw new BadRequestException("Only image / video / gif files allowed.");

    const ext = extname(file.originalname).toLowerCase() || (type === "video" ? ".mp4" : ".jpg");
    const filename = `${randomUUID()}${ext}`;
    const dir = join(process.cwd(), "uploads", "admin-template");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), file.buffer);

    const url = `${this.config.appPublicUrl}/uploads/admin-template/${filename}`;
    return { url, type };
  }

  /**
   * Inherit lookup: given a product family + sourceName, return defaults from admin template.
   * Match by family first, fallback to sourceName for legacy.
   */
  async getInheritedDefaults(args: { family?: SourceProductFamily | null; sourceName?: string | null }) {
    const shop = await this.findTemplateShopOrNull();
    if (!shop?.botConfig) return null;
    const cust = (shop.botConfig.customizationJson as Record<string, any>) ?? {};
    if (args.family) {
      const byFamily = (cust.productDefaultsByFamily ?? {}) as Record<string, any>;
      if (byFamily[args.family]) return byFamily[args.family];
    }
    if (args.sourceName) {
      const byName = (cust.productDefaultsByName ?? {}) as Record<string, any>;
      if (byName[args.sourceName]) return byName[args.sourceName];
    }
    return null;
  }

  /**
   * Auto-detect SourceProductFamily từ tên sản phẩm — dùng cho products không có family.
   */
  private detectFamilyFromName(name: string | null | undefined): SourceProductFamily | null {
    if (!name) return null;
    const n = String(name).toLowerCase();
    if (/\b(chatgpt|gpt[\s-]*plus|gpt[\s-]*pro|gpt[\s-]*team|openai)\b/.test(n)) return SourceProductFamily.CHATGPT;
    if (/\b(claude|anthropic)\b/.test(n)) return SourceProductFamily.CLAUDE;
    if (/\b(gemini|google[\s-]*ai|bard)\b/.test(n)) return SourceProductFamily.GEMINI;
    if (/\b(grok|xai|x[\s-]*ai)\b/.test(n)) return SourceProductFamily.GROK;
    if (/\b(perplexity|pplx)\b/.test(n)) return SourceProductFamily.PERPLEXITY;
    if (/\b(veo[\s-]*3|veo3)\b/.test(n)) return SourceProductFamily.VEO3;
    if (/\b(kling)\b/.test(n)) return SourceProductFamily.KLING;
    if (/\b(higgsfield|higgs[\s-]*field|higg)\b/.test(n)) return SourceProductFamily.HIGGSFIELD;
    if (/\b(canva)\b/.test(n)) return SourceProductFamily.CANVA;
    if (/\b(capcut|cap[\s-]*cut)\b/.test(n)) return SourceProductFamily.CAPCUT;
    if (/\b(adobe|photoshop|illustrator|premiere|lightroom|creative[\s-]*cloud|after[\s-]*effects)\b/.test(n)) return SourceProductFamily.ADOBE;
    if (/\b(suno)\b/.test(n)) return SourceProductFamily.SUNO;
    if (/\b(eleven[\s-]*labs|elevenlabs|11labs|eleven)\b/.test(n)) return SourceProductFamily.ELEVENLABS;
    if (/\b(heygen|hey[\s-]*gen)\b/.test(n)) return SourceProductFamily.HEYGEN;
    if (/\b(gmail|google[\s-]*workspace|gworkspace)\b/.test(n)) return SourceProductFamily.GMAIL;
    if (/\b(youtube|yt[\s-]*premium|yt[\s-]*family)\b/.test(n)) return SourceProductFamily.YOUTUBE;
    if (/\b(tiktok|tik[\s-]*tok)\b/.test(n)) return SourceProductFamily.TIKTOK;
    if (/\b(zoom)\b/.test(n)) return SourceProductFamily.ZOOM;
    if (/\b(duolingo|duo[\s-]*lingo)\b/.test(n)) return SourceProductFamily.DUOLINGO;
    if (/\b(hidemyass|hma)\b/.test(n)) return SourceProductFamily.HMA;
    if (/\b(vpn|nordvpn|expressvpn|surfshark|protonvpn|cyberghost)\b/.test(n)) return SourceProductFamily.VPN;
    return null;
  }

  /**
   * Backfill icons/media on existing SourceProducts. Auto-detect family if NULL.
   * Only fills NULL fields — does not override existing values.
   */
  async backfillIcons(user: AuthenticatedUser): Promise<{ scanned: number; familyDetected: number; updated: number }> {
    await this.assertSuperAdmin(user);
    const tpl = await this.findTemplateShopOrNull();
    if (!tpl?.botConfig) {
      throw new BadRequestException("Admin template chưa có customization.");
    }
    const cust = (tpl.botConfig.customizationJson as Record<string, any>) ?? {};
    const map = (cust.productDefaultsByFamily as Record<string, any>) ?? {};
    if (Object.keys(map).length === 0) {
      return { scanned: 0, familyDetected: 0, updated: 0 };
    }

    // Lấy MỌI products (không filter family) — sẽ detect ở runtime
    const products = await this.prisma.sourceProduct.findMany({
      select: {
        id: true,
        sourceName: true,
        productFamily: true,
        productIcon: true,
        iconCustomEmojiId: true,
        imageUrl: true,
      },
    });

    let familyDetected = 0;
    let updated = 0;
    for (const p of products) {
      // Step 1: detect family if NULL
      let family = p.productFamily;
      let needSetFamily = false;
      if (!family) {
        family = this.detectFamilyFromName(p.sourceName);
        if (family) {
          needSetFamily = true;
          familyDetected++;
        }
      }
      if (!family) continue;

      const defaults = map[family];
      if (!defaults) {
        // Family detected nhưng admin không có config → vẫn save family
        if (needSetFamily) {
          await this.prisma.sourceProduct.update({ where: { id: p.id }, data: { productFamily: family } });
        }
        continue;
      }

      const data: Record<string, any> = {};
      if (needSetFamily) data.productFamily = family;
      if (!p.productIcon && defaults.icon) data.productIcon = defaults.icon;
      if (!p.iconCustomEmojiId && defaults.customEmojiId) data.iconCustomEmojiId = defaults.customEmojiId;
      if (!p.imageUrl && defaults.media?.type === "photo" && defaults.media?.url) data.imageUrl = defaults.media.url;
      if (Object.keys(data).length === 0) continue;
      await this.prisma.sourceProduct.update({ where: { id: p.id }, data });
      updated++;
    }

    return { scanned: products.length, familyDetected, updated };
  }

  /**
   * Reset seller's customizationJson back to empty (full inherit from admin).
   */
  async resetShopCustomization(user: AuthenticatedUser, dto: ResetShopCustomizationDto) {
    // For seller's own shop — only require auth (not super_admin)
    const seller = await this.prisma.seller.findUnique({
      where: { userId: user.id },
      include: {
        // assume first shop
      },
    });
    if (!seller) throw new NotFoundException("Seller not found");
    const shop = await this.prisma.shop.findFirst({
      where: { sellerId: seller.id, isTemplate: false },
      include: { botConfig: true },
    });
    if (!shop) throw new NotFoundException("Shop not found");
    if (shop.botConfig) {
      await this.prisma.botConfig.update({
        where: { id: shop.botConfig.id },
        data: { customizationJson: {} as Prisma.InputJsonValue },
      });
    }
    if (dto.alsoResetProductOverrides) {
      await this.prisma.sourceProduct.updateMany({
        where: { shopId: shop.id },
        data: { productIcon: null, iconCustomEmojiId: null, imageUrl: null },
      });
    }
    // Invalidate media cache so seller bot re-fetches from admin
    await this.prisma.botMediaCache.deleteMany({ where: { shopId: shop.id } });
    return { success: true };
  }

  /**
   * Reset icon/media for a specific product → fallback to admin defaults.
   */
  async resetProductIcon(user: AuthenticatedUser, productId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException("Seller not found");
    const product = await this.prisma.sourceProduct.findUnique({
      where: { id: productId },
      include: { shop: { select: { sellerId: true, id: true } } },
    });
    if (!product || product.shop.sellerId !== seller.id) {
      throw new NotFoundException("Product not found");
    }
    await this.prisma.sourceProduct.update({
      where: { id: productId },
      data: { productIcon: null, iconCustomEmojiId: null, imageUrl: null },
    });
    // Invalidate cached media for this product across all bots
    await this.prisma.botMediaCache.deleteMany({
      where: { mediaKey: { startsWith: `product:${product.sourceName}:` } },
    });
    return { success: true };
  }
}
