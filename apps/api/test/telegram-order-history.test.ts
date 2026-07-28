import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnedOrderWhere,
  isPrivateTelegramChat,
  resolveOrderHistoryPage,
  splitTelegramText,
} from "../src/lib/telegram-order-history";

test("private chat detection rejects groups and keeps simulation compatibility", () => {
  assert.equal(isPrivateTelegramChat({ id: 123, type: "private" }, 123), true);
  assert.equal(isPrivateTelegramChat({ id: 456, type: "private" }, 123), false);
  assert.equal(isPrivateTelegramChat({ id: -100123, type: "supergroup" }, 123), false);
  assert.equal(isPrivateTelegramChat({ id: -123, type: "group" }, 123), false);
  assert.equal(isPrivateTelegramChat({ id: 123 }, 123), true);
  assert.equal(isPrivateTelegramChat({ id: -100123 }, 123), false);
});

test("history pagination clamps invalid and out-of-range pages", () => {
  assert.deepEqual(resolveOrderHistoryPage(-10, 0), {
    page: 0,
    totalPages: 1,
    skip: 0,
    take: 6,
  });
  assert.deepEqual(resolveOrderHistoryPage(99, 13), {
    page: 2,
    totalPages: 3,
    skip: 12,
    take: 6,
  });
  assert.deepEqual(resolveOrderHistoryPage(Number.NaN, 7), {
    page: 0,
    totalPages: 2,
    skip: 0,
    take: 6,
  });
});

test("delivery chunks stay below the Telegram budget and preserve the content", () => {
  const input = `${"a".repeat(2_950)}\n${"🙂".repeat(1_800)}\n${"b".repeat(3_200)}`;
  const chunks = splitTelegramText(input, 3_000);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 3_000));
  assert.equal(chunks.join(""), input);
  assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk)));
});

test("owned-order filter always scopes by order, shop and Telegram user", () => {
  assert.deepEqual(buildOwnedOrderWhere("shop_1", "tg_1", "order_1"), {
    id: "order_1",
    shopId: "shop_1",
    customer: {
      telegramUserId: "tg_1",
    },
  });
});
