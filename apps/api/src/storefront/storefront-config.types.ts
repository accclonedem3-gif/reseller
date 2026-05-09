/**
 * Typed representation of Shop.storefrontConfigJson.
 *
 * This field is stored as untyped Json in the database. All consumers should
 * parse through this interface so future additions stay in one place.
 *
 * All fields are optional — missing keys should be treated as "use default".
 */
export interface StorefrontConfig {
  /** Primary brand color (CSS hex, e.g. "#10B981"). */
  themeColor?: string;

  /** URL of the hero/banner image shown on the web storefront home page. */
  bannerImageUrl?: string;

  /** Browser favicon URL. */
  faviconUrl?: string;

  /** <title> tag override for the web storefront. Defaults to shop name. */
  seoTitle?: string;

  /** Meta description for SEO. */
  seoDescription?: string;

  /**
   * Custom domain the web storefront should be served on.
   * DNS configuration is managed outside the platform.
   */
  customDomain?: string;

  /**
   * When true, product prices are shown publicly on the web storefront
   * without requiring login. Defaults to true.
   */
  showProductPrices?: boolean;

  /**
   * When true, customers must authenticate before browsing the catalog.
   * Only relevant for HYBRID and WEB_ONLY modes.
   */
  requireLoginToView?: boolean;

  /**
   * Maximum number of products shown per page on the web catalog.
   * Defaults to 20.
   */
  catalogPageSize?: number;

  /**
   * Whether to display the "Powered by" footer on the web storefront.
   * Defaults to true for FREE/PRO, false for ULTRA.
   */
  showPoweredBy?: boolean;
}

/**
 * Parse a raw Prisma Json value into a typed StorefrontConfig.
 * Returns an empty object if the value is not a plain object.
 */
export function parseStorefrontConfig(raw: unknown): StorefrontConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as StorefrontConfig;
}
