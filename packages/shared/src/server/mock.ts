import type {
  ProviderProduct,
  ProviderPurchaseInput,
  ProviderPurchaseResult,
} from "./provider";

export function isMockBuyerKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().startsWith("mock");
}

export function isMockBotToken(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().startsWith("mock");
}

export function getMockProviderProducts(): ProviderProduct[] {
  return [
    {
      externalId: "698600232b866a39b4cb2272",
      sourceName: "VEO3 Ultra 25k credit",
      sourceRawName: "VEO3 Ultra 25k credit",
      description: "Demo catalog item for local sync.",
      rawDescription: "Demo catalog item for local sync.",
      price: 35000,
      available: 12,
      hidden: false,
      isSlotProduct: false,
      requiresCustomerEmail: false,
      requiresSlotMonths: false,
      slotDurations: [],
      quantityFixed: 1,
      walletCurrency: "VND",
      metadata: { mock: true, category: "ai" },
    },
    {
      externalId: "698618eeaff16b992e059270",
      sourceName: "Spotify Premium 12 tháng",
      sourceRawName: "Spotify Premium 12 tháng",
      description: "Mock provider response for audio account.",
      rawDescription: "Mock provider response for audio account.",
      price: 90000,
      available: 8,
      hidden: false,
      isSlotProduct: false,
      requiresCustomerEmail: false,
      requiresSlotMonths: false,
      slotDurations: [],
      quantityFixed: 1,
      walletCurrency: "VND",
      metadata: { mock: true, category: "music" },
    },
    {
      externalId: "698618eeaff16b992e059271",
      sourceName: "Netflix Premium 1 tháng",
      sourceRawName: "Netflix Premium 1 tháng",
      description: "Mock provider response for video account.",
      rawDescription: "Mock provider response for video account.",
      price: 60000,
      available: 4,
      hidden: false,
      isSlotProduct: false,
      requiresCustomerEmail: false,
      requiresSlotMonths: false,
      slotDurations: [],
      quantityFixed: 1,
      walletCurrency: "VND",
      metadata: { mock: true, category: "video" },
    },
  ];
}

export function purchaseFromMockProvider(
  input: ProviderPurchaseInput,
): ProviderPurchaseResult {
  if (input.productId === "698618eeaff16b992e059270") {
    return {
      success: false,
      deliveredText: null,
      outOfStock: true,
      rawPayload: { mock: true },
      message: "Mock upstream is out of stock for this product.",
    };
  }

  return {
    success: true,
    deliveredText: `demo-${input.productId}@example.com:Password123!`,
    outOfStock: false,
    rawPayload: { mock: true },
  };
}

export function getMockTelegramBotInfo() {
  return {
    id: 123456789,
    is_bot: true,
    first_name: "Mock Reseller Bot",
    username: "mock_reseller_bot",
  };
}
