import { Inject, Injectable } from "@nestjs/common";
import { StorefrontMode } from "@prisma/client";

import { PrismaService } from "../db/prisma.service";
import { ShopsService } from "../shops/shops.service";

import { parseStorefrontConfig } from "./storefront-config.types";
import type { StorefrontConfig } from "./storefront-config.types";

/**
 * StorefrontService — Phase 8 stub.
 *
 * Centralises all storefront-mode-aware logic so that:
 *  - Bot handlers never need to check storefrontMode themselves
 *  - Future web storefront controllers have a single entry point
 *  - Source-core logic (ProviderConfig, InternalSource*) remains decoupled
 *    from how products are displayed to end-customers
 *
 * TODO (web storefront phase): replace all TODO stubs below with real logic.
 */
@Injectable()
export class StorefrontService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
  ) {}

  /**
   * Returns the resolved storefront mode for a shop.
   *
   * Use this instead of reading shop.storefrontMode directly so routing
   * decisions are centralised here.
   */
  async getStorefrontMode(shopId: string): Promise<StorefrontMode> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { storefrontMode: true },
    });
    return shop?.storefrontMode ?? StorefrontMode.TELEGRAM_ONLY;
  }

  /**
   * Returns the parsed StorefrontConfig for a shop.
   */
  async getStorefrontConfig(shopId: string): Promise<StorefrontConfig> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { storefrontConfigJson: true },
    });
    return parseStorefrontConfig(shop?.storefrontConfigJson);
  }

  /**
   * Returns true when the shop exposes a web-facing catalog
   * (HYBRID or WEB_ONLY mode).
   */
  async isWebStorefrontEnabled(shopId: string): Promise<boolean> {
    const mode = await this.getStorefrontMode(shopId);
    return mode === StorefrontMode.HYBRID || mode === StorefrontMode.WEB_ONLY;
  }

  /**
   * Returns true when the shop exposes a Telegram bot storefront
   * (TELEGRAM_ONLY or HYBRID mode).
   */
  async isTelegramStorefrontEnabled(shopId: string): Promise<boolean> {
    const mode = await this.getStorefrontMode(shopId);
    return mode === StorefrontMode.TELEGRAM_ONLY || mode === StorefrontMode.HYBRID;
  }

  // ---------------------------------------------------------------------------
  // TODO (web storefront phase): implement the methods below
  // ---------------------------------------------------------------------------

  /**
   * TODO: Return the public-facing product catalog for the web storefront.
   *
   * Should:
   *  - Respect storefrontConfig.catalogPageSize
   *  - Respect storefrontConfig.requireLoginToView (throw 401 if unauthenticated)
   *  - Filter to available products only
   *  - Not expose internalSourcePrice or any supplier-side cost fields
   */
  async getWebCatalog(
    _shopSlug: string,
    _page: number,
  ): Promise<never> {
    throw new Error("TODO: web storefront catalog not yet implemented (Phase 8+)");
  }

  /**
   * TODO: Return a single product detail for the web storefront.
   *
   * Should respect storefrontConfig.showProductPrices to decide whether
   * to include pricing in the response for unauthenticated visitors.
   */
  async getWebProduct(
    _shopSlug: string,
    _productId: string,
  ): Promise<never> {
    throw new Error("TODO: web storefront product detail not yet implemented (Phase 8+)");
  }

  /**
   * TODO: Render the storefront home metadata (SEO, theme, banner).
   *
   * Used by a future server-rendered web page or a dedicated API route.
   * Keys come from StorefrontConfig — see storefront-config.types.ts.
   */
  async getWebHomeMeta(_shopSlug: string): Promise<never> {
    throw new Error("TODO: web storefront home meta not yet implemented (Phase 8+)");
  }
}
