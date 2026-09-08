import assert from "node:assert/strict";

import {
  DEFAULT_RESTOCK_TEMPLATE,
  renderRestockHtml,
} from "@reseller/shared/server";

const rendered = renderRestockHtml(DEFAULT_RESTOCK_TEMPLATE, {
  productName: "Gói thử nghiệm",
  addedQuantity: 5,
  available: 12,
  price: 100_000,
  usdtVndRate: 27_000,
  language: "vi",
});

assert.match(rendered.text, /100\.000₫ \(~3\.70 USDT\)/);

const withoutValidRate = renderRestockHtml(DEFAULT_RESTOCK_TEMPLATE, {
  productName: "Gói thử nghiệm",
  addedQuantity: 5,
  available: 12,
  price: 100_000,
  usdtVndRate: 0,
  language: "vi",
});

assert.doesNotMatch(withoutValidRate.text, /USDT/);

console.log("restock template tests passed");
