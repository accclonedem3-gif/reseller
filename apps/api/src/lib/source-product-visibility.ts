type ProductVisibilityInput = {
  providerName?: string | null;
  metadataJson?: unknown;
};

export function isOwnShopProduct(product: ProductVisibilityInput) {
  const metadata =
    product.metadataJson &&
    typeof product.metadataJson === "object" &&
    !Array.isArray(product.metadataJson)
      ? (product.metadataJson as Record<string, unknown>)
      : {};

  return (
    String(product.providerName || "").trim().toLowerCase() === "manual" ||
    metadata.manual === true
  );
}

export function isProductVisibleForBot(
  product: ProductVisibilityInput,
  ownProductsOnly: boolean,
) {
  return !ownProductsOnly || isOwnShopProduct(product);
}
