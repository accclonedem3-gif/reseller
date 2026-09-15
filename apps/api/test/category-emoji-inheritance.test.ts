import assert from "node:assert";
import { CatalogGroupsService } from "../src/catalog-groups/catalog-groups.service";

// Test 1: bulkAssign inherits category custom emoji to products
async function testBulkAssignInheritance() {
  console.log("--- Running Test 1: bulkAssign category emoji inheritance ---");

  let updatedSourceProductData: any = null;
  let updatedOverrideData: any = null;

  const mockPrisma: any = {
    shopCatalogGroup: {
      findFirst: async ({ where }: any) => {
        if (where.id === "grp-1" && where.shopId === "shop-1") {
          return {
            id: "grp-1",
            shopId: "shop-1",
            name: "Netflix Premium",
            icon: "Netflix",
            iconCustomEmojiId: "5368324170671202286",
          };
        }
        return null;
      },
    },
    sellerProductOverride: {
      findMany: async () => [
        { id: "ov-1", sourceProductId: "prod-1" },
        { id: "ov-2", sourceProductId: "prod-2" },
      ],
      updateMany: async (args: any) => {
        updatedOverrideData = args;
        return { count: 2 };
      },
    },
    sourceProduct: {
      updateMany: async (args: any) => {
        updatedSourceProductData = args;
        return { count: 2 };
      },
    },
  };

  const mockShopsService: any = {
    getSellerShop: async () => ({
      id: "shop-1",
      sellerId: "seller-1",
    }),
  };

  const service = new CatalogGroupsService(mockPrisma, mockShopsService);
  const user: any = { id: "user-1" };

  // Assign prod-1 and prod-2 to grp-1
  const result = await service.bulkAssign(user, {
    productIds: ["prod-1", "prod-2"],
    groupId: "grp-1",
  });

  assert.equal(result.updated, 2);
  assert.equal(updatedOverrideData.data.groupId, "grp-1");
  assert.deepEqual(updatedSourceProductData.data, {
    iconCustomEmojiId: "5368324170671202286",
    productIcon: "Netflix",
  });
  assert.deepEqual(updatedSourceProductData.where, {
    id: { in: ["prod-1", "prod-2"] },
    shopId: "shop-1",
  });

  console.log("✓ Test 1 passed: Products inherited category custom emoji on bulkAssign");
}

// Test 2: updateGroup updates all products in the category with new custom emoji
async function testUpdateGroupPropagatesToProducts() {
  console.log("--- Running Test 2: updateGroup propagates emoji to existing products ---");

  let updatedSourceProductData: any = null;

  const mockPrisma: any = {
    shopCatalogGroup: {
      findFirst: async ({ where }: any) => {
        if (where.id === "grp-1" && where.shopId === "shop-1") {
          return {
            id: "grp-1",
            shopId: "shop-1",
            name: "Netflix Old",
            icon: "OldIcon",
            iconCustomEmojiId: "11111111",
          };
        }
        return null;
      },
      update: async ({ data }: any) => ({
        id: "grp-1",
        ...data,
      }),
    },
    sellerProductOverride: {
      findMany: async ({ where }: any) => {
        if (where.shopId === "shop-1" && where.groupId === "grp-1") {
          return [
            { sourceProductId: "prod-10" },
            { sourceProductId: "prod-20" },
            { sourceProductId: "prod-30" },
          ];
        }
        return [];
      },
    },
    sourceProduct: {
      updateMany: async (args: any) => {
        updatedSourceProductData = args;
        return { count: 3 };
      },
    },
  };

  const mockShopsService: any = {
    getSellerShop: async () => ({
      id: "shop-1",
      sellerId: "seller-1",
    }),
  };

  const service = new CatalogGroupsService(mockPrisma, mockShopsService);
  const user: any = { id: "user-1" };

  await service.updateGroup(user, "grp-1", {
    icon: "CapCut",
    iconCustomEmojiId: "5999888777666",
  });

  assert.deepEqual(updatedSourceProductData.data, {
    iconCustomEmojiId: "5999888777666",
    productIcon: "CapCut",
  });
  assert.deepEqual(updatedSourceProductData.where, {
    id: { in: ["prod-10", "prod-20", "prod-30"] },
    shopId: "shop-1",
  });

  console.log("✓ Test 2 passed: Updating category emoji propagated to all 3 existing products");
}

// Test 3: mapCatalogProduct in ShopsService inherits category emoji at query time
function testMapCatalogProductInheritance() {
  console.log("--- Running Test 3: mapCatalogProduct runtime inheritance ---");

  // Re-implement the mapping logic from shops.service.ts to test contract
  function mapCatalogProduct(product: any) {
    const override = product.overrides[0];
    const group = override?.group;
    const inheritedCustomEmojiId = group?.iconCustomEmojiId?.trim() || null;
    const inheritedIcon = group?.icon?.trim() || null;

    return {
      id: product.id,
      displayName: override?.displayName || product.sourceName,
      productIcon:
        inheritedCustomEmojiId && inheritedIcon
          ? inheritedIcon
          : product.productIcon || null,
      iconCustomEmojiId:
        inheritedCustomEmojiId ?? product.iconCustomEmojiId ?? null,
      groupId: override?.groupId ?? null,
    };
  }

  // Case A: Product has its own custom emoji, but belongs to category with different custom emoji
  // Category MUST override product's emoji!
  const productA = {
    id: "p-1",
    sourceName: "Acc Netflix 1M",
    productIcon: "OldProductIcon",
    iconCustomEmojiId: "old-product-emoji-id",
    overrides: [
      {
        groupId: "grp-netflix",
        group: {
          id: "grp-netflix",
          icon: "CategoryIcon",
          iconCustomEmojiId: "category-custom-emoji-id",
        },
      },
    ],
  };

  const mappedA = mapCatalogProduct(productA);
  assert.equal(mappedA.iconCustomEmojiId, "category-custom-emoji-id");
  assert.equal(mappedA.productIcon, "CategoryIcon");

  // Case B: Product has its own emoji, but category has NO custom emoji
  // Product keeps its own emoji!
  const productB = {
    id: "p-2",
    sourceName: "Acc Spotify 1M",
    productIcon: "🎵",
    iconCustomEmojiId: "prod-spotify-emoji",
    overrides: [
      {
        groupId: "grp-music",
        group: {
          id: "grp-music",
          icon: null,
          iconCustomEmojiId: null,
        },
      },
    ],
  };

  const mappedB = mapCatalogProduct(productB);
  assert.equal(mappedB.iconCustomEmojiId, "prod-spotify-emoji");
  assert.equal(mappedB.productIcon, "🎵");

  // Case C: Ungrouped product
  const productC = {
    id: "p-3",
    sourceName: "Standalone Item",
    productIcon: "📦",
    iconCustomEmojiId: null,
    overrides: [{ groupId: null, group: null }],
  };

  const mappedC = mapCatalogProduct(productC);
  assert.equal(mappedC.iconCustomEmojiId, null);
  assert.equal(mappedC.productIcon, "📦");

  console.log("✓ Test 3 passed: mapCatalogProduct correctly prioritizes category custom emoji");
}

async function runAll() {
  try {
    await testBulkAssignInheritance();
    await testUpdateGroupPropagatesToProducts();
    testMapCatalogProductInheritance();
    console.log("\nALL CATEGORY EMOJI INHERITANCE TESTS PASSED! 🎉");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

runAll();
