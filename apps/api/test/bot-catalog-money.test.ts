import assert from "node:assert/strict";
import test from "node:test";

import { BotRenderHelpers } from "../src/lib/bot-render.helpers";

const render = new BotRenderHelpers();

test("catalog button prices always show the full VND amount", () => {
  assert.equal(render.formatCatalogButtonMoney(2_000), "2.000đ");
  assert.equal(render.formatCatalogButtonMoney(1_500), "1.500đ");
  assert.equal(render.formatCatalogButtonMoney(2_000_000), "2.000.000đ");
});

test("catalog button prices never use k or tr abbreviations", () => {
  const values = [1_000, 2_000, 15_500, 1_000_000];

  for (const value of values) {
    const formatted = render.formatCatalogButtonMoney(value);
    assert.doesNotMatch(formatted, /(?:k|tr)$/i);
  }
});
