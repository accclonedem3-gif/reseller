import assert from "node:assert";

// Mock helper matching telegram-bot.service.v2.ts logic
function inlineBtnBytes(btn: Record<string, unknown>): number {
  return JSON.stringify(btn).length + 4;
}

function paginateProductRows(
  rows: Record<string, string>[][],
  fixedBytes = 0,
  fixedRowCount = 0,
  fixedButtonCount = 0,
): Record<string, string>[][][] {
  if (rows.length === 0) return [[]];

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

  let totalRowsBytes = 0;
  let totalRowsButtons = 0;
  for (const r of rows) {
    totalRowsBytes += r.reduce((s, b) => s + inlineBtnBytes(b), 0);
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
    const rb = row.reduce((s, b) => s + inlineBtnBytes(b), 0);
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

function buildCatalogPageNav(
  page: number,
  totalPages: number,
  cbPrefix = "catalog:page",
): Record<string, string>[][] {
  if (totalPages <= 1) return [];
  const row: Record<string, string>[] = [];
  if (page > 0) {
    row.push({
      text: "◀️ Trước",
      callback_data: `${cbPrefix}:${page - 1}`,
    });
  }
  row.push({
    text: `${page + 1}/${totalPages}`,
    callback_data: `${cbPrefix}:${page}`,
  });
  if (page < totalPages - 1) {
    row.push({
      text: "Sau ▶️",
      callback_data: `${cbPrefix}:${page + 1}`,
    });
  }
  return [row];
}

function chunkButtons<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

console.log("--- Starting Catalog Pagination Test Suite ---");

// Test 1: QK Shop simulation (24 categories, 390 ungrouped products)
{
  console.log("Test 1: QK Shop (24 categories, 390 products)...");
  const categories = Array.from({ length: 24 }, (_, i) => ({
    text: `📁 Danh mục ${i + 1} (${i * 5})`,
    callback_data: `catalog:custom:cat_${i}:0`,
  }));
  const groupRows = chunkButtons(categories, 3); // 8 rows, 24 buttons

  const refreshRow = [{ text: "🔄 Làm mới", callback_data: "home:products" }];
  const navRows = [
    [
      { text: "🏠 Trang chủ", callback_data: "home:menu" },
      { text: "💬 Hỗ trợ", callback_data: "home:support" },
    ],
  ];

  const ungroupedProducts = Array.from({ length: 390 }, (_, i) => [
    {
      text: `⚡ Tài khoản Telegram ${i + 1} - Cực xịn giá rẻ - 25.000đ - Còn: 50`,
      callback_data: `buy:prod_uuid_${i}`,
    },
  ]);

  const cgFixedRows = [...groupRows, refreshRow, ...navRows];
  const cgFixedRowCount = cgFixedRows.length + 1;
  const cgFixedButtonCount = cgFixedRows.reduce((s, r) => s + r.length, 0) + 3;
  const cgFixedBytes =
    cgFixedRows.reduce(
      (s, r) => s + r.reduce((x, b) => x + inlineBtnBytes(b), 0),
      0,
    ) + 220;

  const pages = paginateProductRows(
    ungroupedProducts,
    cgFixedBytes,
    cgFixedRowCount,
    cgFixedButtonCount,
  );

  assert(pages.length > 1, "QK shop should be paginated");
  console.log(`  Pages count: ${pages.length}`);

  for (let p = 0; p < pages.length; p++) {
    const markup = {
      inline_keyboard: [
        ...groupRows,
        ...pages[p],
        ...buildCatalogPageNav(p, pages.length),
        refreshRow,
        ...navRows,
      ],
    };
    const jsonStr = JSON.stringify(markup);
    const totalButtons = markup.inline_keyboard.reduce((s, r) => s + r.length, 0);
    const totalRows = markup.inline_keyboard.length;

    assert(
      jsonStr.length < 8000,
      `Page ${p} JSON length (${jsonStr.length}) must be < 8000 bytes (Telegram limit: 10240)`,
    );
    assert(
      totalButtons <= 70,
      `Page ${p} button count (${totalButtons}) must be <= 70 (Telegram limit: 100)`,
    );
    assert(totalRows <= 36, `Page ${p} rows (${totalRows}) must be <= 36`);
  }
  console.log("  ✓ QK Shop passes all Telegram limits on ALL pages!");
}

// Test 2: HeroAI Shop (41 categories, 50 ungrouped products)
{
  console.log("Test 2: HeroAI Shop (41 categories, 50 products)...");
  const categories = Array.from({ length: 41 }, (_, i) => ({
    text: `📁 Phân loại hàng hoá ${i + 1} (${i * 2})`,
    callback_data: `catalog:custom:cat_${i}:0`,
  }));
  const groupRows = chunkButtons(categories, 3); // 14 rows, 41 buttons
  const refreshRow = [{ text: "🔄 Làm mới", callback_data: "home:products" }];
  const navRows = [
    [
      { text: "🏠 Trang chủ", callback_data: "home:menu" },
      { text: "💬 Hỗ trợ", callback_data: "home:support" },
    ],
  ];
  const ungrouped = Array.from({ length: 50 }, (_, i) => [
    {
      text: `🔥 HeroAI Key ${i + 1} VIP Pro - 150.000đ - Còn: 10`,
      callback_data: `buy:prod_${i}`,
    },
  ]);

  const cgFixedRows = [...groupRows, refreshRow, ...navRows];
  const cgFixedRowCount = cgFixedRows.length + 1;
  const cgFixedButtonCount = cgFixedRows.reduce((s, r) => s + r.length, 0) + 3;
  const cgFixedBytes =
    cgFixedRows.reduce(
      (s, r) => s + r.reduce((x, b) => x + inlineBtnBytes(b), 0),
      0,
    ) + 220;

  const pages = paginateProductRows(
    ungrouped,
    cgFixedBytes,
    cgFixedRowCount,
    cgFixedButtonCount,
  );

  console.log(`  HeroAI pages count: ${pages.length}`);
  for (let p = 0; p < pages.length; p++) {
    const markup = {
      inline_keyboard: [
        ...groupRows,
        ...pages[p],
        ...buildCatalogPageNav(p, pages.length),
        refreshRow,
        ...navRows,
      ],
    };
    const jsonStr = JSON.stringify(markup);
    const totalButtons = markup.inline_keyboard.reduce((s, r) => s + r.length, 0);

    assert(
      jsonStr.length < 8000,
      `HeroAI Page ${p} JSON length (${jsonStr.length}) must be < 8000 bytes`,
    );
    assert(
      totalButtons <= 75,
      `HeroAI Page ${p} button count (${totalButtons}) must be <= 75`,
    );
  }
  console.log("  ✓ HeroAI Shop passes all Telegram limits!");
}

// Test 3: Small Flat Shop (15 products, no categories)
{
  console.log("Test 3: Small Flat Shop (15 products)...");
  const refreshRow = [{ text: "🔄 Làm mới", callback_data: "home:products" }];
  const navRows = [
    [
      { text: "🏠 Trang chủ", callback_data: "home:menu" },
      { text: "💬 Hỗ trợ", callback_data: "home:support" },
    ],
  ];
  const products = Array.from({ length: 15 }, (_, i) => [
    {
      text: `Tài khoản số ${i + 1} - 10.000đ - Còn: 99`,
      callback_data: `buy:prod_${i}`,
    },
  ]);
  const flatFixedRows = [refreshRow, ...navRows];
  const flatFixedRowCount = flatFixedRows.length + 1;
  const flatFixedButtonCount =
    flatFixedRows.reduce((s, r) => s + r.length, 0) + 3;
  const flatFixedBytes =
    flatFixedRows.reduce(
      (s, r) => s + r.reduce((x, b) => x + inlineBtnBytes(b), 0),
      0,
    ) + 220;

  const pages = paginateProductRows(
    products,
    flatFixedBytes,
    flatFixedRowCount,
    flatFixedButtonCount,
  );

  assert.strictEqual(pages.length, 1, "Small shop should NOT paginate (1 page)");
  const pageNav = buildCatalogPageNav(0, pages.length);
  assert.strictEqual(pageNav.length, 0, "No page nav buttons for 1 page");
  console.log("  ✓ Small flat shop stays on 1 page with NO pagination nav!");
}

console.log("ALL TESTS PASSED SUCCESSFULLY! ✅");
