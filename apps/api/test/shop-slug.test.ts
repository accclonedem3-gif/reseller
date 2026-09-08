import assert from "node:assert/strict";
import test from "node:test";

import { pickUniqueSlug } from "../src/lib/utils";

test("keeps the clean shop slug when it is available", () => {
  assert.equal(pickUniqueSlug("shop-moi", []), "shop-moi");
});

test("uses the first available numeric suffix for a duplicate shop slug", () => {
  assert.equal(
    pickUniqueSlug("shop-moi", ["shop-moi", "shop-moi-2", "shop-moi-4"]),
    "shop-moi-3",
  );
});