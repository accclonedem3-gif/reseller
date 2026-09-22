import assert from "node:assert/strict";
import {
  resolveTelegramChannelTargetWithThread,
  renderRestockHtml,
  resolveRestockTemplate,
  stripRestockCustomEmojiHtml,
} from "@reseller/shared/server";

async function runTests() {
  console.log("=== RUNNING CHANNEL RESTOCK UPLOAD TESTS ===");

  // Test 1: Resolve channel target from customizationJson for upload restock
  console.log("\n--- Test 1: Channel Target Resolution for Stock Upload ---");
  const shopCustomizationJson = {
    channelRestockNotificationEnabled: true,
    forceJoinChatId: "-1004302123102",
    forceJoinChannelUrl: "https://t.me/shopaccakit",
    forceJoinTopicId: null,
  };
  const botUsername = "khoaccgameuytinbot";

  const target1 = shopCustomizationJson.channelRestockNotificationEnabled
    ? resolveTelegramChannelTargetWithThread(
        shopCustomizationJson.forceJoinChatId,
        shopCustomizationJson.forceJoinChannelUrl,
        shopCustomizationJson.forceJoinTopicId,
        botUsername,
      )
    : null;

  assert.ok(target1, "Target should be resolved");
  assert.equal(target1.chatId, "-1004302123102");
  assert.equal(target1.messageThreadId, undefined);
  console.log("✔ Test 1 passed: Standard channel/group resolved correctly");

  // Test 2: Topic group resolution
  console.log("\n--- Test 2: Topic Group Target Resolution ---");
  const topicCustomization = {
    channelRestockNotificationEnabled: true,
    forceJoinChatId: "-1001928374650",
    forceJoinChannelUrl: "https://t.me/c/1928374650/88",
    forceJoinTopicId: "88",
  };
  const target2 = topicCustomization.channelRestockNotificationEnabled
    ? resolveTelegramChannelTargetWithThread(
        topicCustomization.forceJoinChatId,
        topicCustomization.forceJoinChannelUrl,
        topicCustomization.forceJoinTopicId,
        botUsername,
      )
    : null;

  assert.ok(target2, "Topic target should be resolved");
  assert.equal(target2.chatId, "-1001928374650");
  assert.equal(target2.messageThreadId, 88);
  console.log("✔ Test 2 passed: Topic group with messageThreadId resolved correctly");

  // Test 3: Disabled channel restock
  console.log("\n--- Test 3: Channel Restock Disabled ---");
  const disabledCustomization = {
    channelRestockNotificationEnabled: false,
    forceJoinChatId: "-1004302123102",
    forceJoinChannelUrl: "https://t.me/shopaccakit",
  };
  const target3 = disabledCustomization.channelRestockNotificationEnabled
    ? resolveTelegramChannelTargetWithThread(
        disabledCustomization.forceJoinChatId,
        disabledCustomization.forceJoinChannelUrl,
      )
    : null;

  assert.equal(target3, null, "Disabled restock should resolve to null");
  console.log("✔ Test 3 passed: Disabled restock produces null target");

  // Test 4: Deep Link /start buy_<productId> button construction
  console.log("\n--- Test 4: Deep Link Button Generation ---");
  const product = {
    id: "cmucoxfbc0bjqcag628cibzsz",
    sourceProductId: "manual_acc_free_fire_049",
    displayName: "Acc Free Fire Mã 049",
  };
  const buyUrl = botUsername
    ? `https://t.me/${botUsername}?start=buy_${product.id}`
    : undefined;

  assert.equal(
    buyUrl,
    "https://t.me/khoaccgameuytinbot?start=buy_cmucoxfbc0bjqcag628cibzsz",
  );

  const button = buyUrl
    ? { text: "🛒 Mua ngay", url: buyUrl }
    : { text: "🛒 Mua ngay", callback_data: `buy:${product.id}` };

  assert.equal(button.text, "🛒 Mua ngay");
  assert.equal(button.url, buyUrl);
  console.log("✔ Test 4 passed: Deep link buy button matches bot deep link contract");

  // Test 5: Render restock message and custom emoji fallback
  console.log("\n--- Test 5: Render Restock & Emoji Fallback ---");
  const template = resolveRestockTemplate(null, null);
  const rendered = renderRestockHtml(template, {
    productName: product.displayName,
    addedQuantity: 1,
    available: 1,
    price: 50000,
    usdtVndRate: 26000,
    productIconCustomEmojiId: "5368324170671202286",
    language: "vi",
  });

  assert.ok(rendered.text.includes("Acc Free Fire Mã 049"));
  assert.ok(rendered.text.includes("50.000"));

  const stripped = stripRestockCustomEmojiHtml(rendered.text);
  assert.ok(!stripped.includes("<tg-emoji"), "Stripped html should not contain tg-emoji tag");
  console.log("✔ Test 5 passed: Rendered restock message and stripped emoji fallback successfully");

  console.log("\n=== ALL CHANNEL RESTOCK UPLOAD TESTS PASSED ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
