import assert from "node:assert/strict";
import { resolveTelegramChannelTarget } from "@reseller/shared/server";

async function runTests() {
  console.log("=== RUNNING CHANNEL NOTIFICATIONS TEST SUITE ===");

  // Test 1: resolveTelegramChannelTarget variations
  console.log("\n--- Test 1: Channel Target Resolution ---");
  assert.equal(
    resolveTelegramChannelTarget("@altivoxai_notification", null),
    "@altivoxai_notification",
    "Should preserve @username",
  );
  assert.equal(
    resolveTelegramChannelTarget("altivoxai_notification", null),
    "@altivoxai_notification",
    "Should prepend @ to plain username",
  );
  assert.equal(
    resolveTelegramChannelTarget("-1001928374650", null),
    "-1001928374650",
    "Should preserve negative numeric chat ID",
  );
  assert.equal(
    resolveTelegramChannelTarget(null, "https://t.me/my_channel_official"),
    "@my_channel_official",
    "Should extract username from https://t.me/ link",
  );
  assert.equal(
    resolveTelegramChannelTarget(null, "telegram.me/another_group"),
    "@another_group",
    "Should extract username from telegram.me/ link",
  );
  assert.equal(
    resolveTelegramChannelTarget("-1009999", "https://t.me/+joinlink"),
    "-1009999",
    "Should prefer explicit chat ID over invite link",
  );
  assert.equal(
    resolveTelegramChannelTarget(null, "https://t.me/+privateInvite"),
    null,
    "Should return null for unresolvable private invite link without chat ID",
  );
  console.log("✔ Test 1 passed: All channel target resolution variants parsed correctly");

  // Test 2: Restock Task Generation with URL Button for Channel
  console.log("\n--- Test 2: Channel Restock Task & URL Button ---");
  const botUsername = "AltivoxResellerBot";
  const productId = "prod_chatgpt_plus";
  const channelTarget = resolveTelegramChannelTarget("@altivoxai_notification", null);
  assert.equal(channelTarget, "@altivoxai_notification");

  const expectedUrl = `https://t.me/${botUsername}?start=buy_${productId}`;
  assert.equal(
    expectedUrl,
    "https://t.me/AltivoxResellerBot?start=buy_prod_chatgpt_plus",
    "URL button format should match /start buy_<productId>",
  );

  const channelTask = {
    chatId: channelTarget!,
    text: "📦 <b>HÀNG VỀ: ChatGPT Plus</b>\nSố lượng: +10",
    hasHtml: true,
    url: expectedUrl,
    cbData: `buy:${productId}`,
    lang: "vi",
  };

  const button = channelTask.url
    ? { text: "🛒 Mua ngay", url: channelTask.url }
    : { text: "🛒 Mua ngay", callback_data: channelTask.cbData };

  assert.equal(button.url, expectedUrl);
  assert.equal(button.text, "🛒 Mua ngay");
  console.log("✔ Test 2 passed: Channel task has URL button pointing to bot start parameter");

  // Test 3: Broadcast Delivery Target Extraction
  console.log("\n--- Test 3: Broadcast Channel Target ---");
  const shopCustomizationJson = {
    channelBroadcastNotificationEnabled: true,
    forceJoinChannelUrl: "https://t.me/my_announcements",
    forceJoinChatId: "",
  };

  const broadcastChannelTarget = shopCustomizationJson.channelBroadcastNotificationEnabled
    ? resolveTelegramChannelTarget(
        shopCustomizationJson.forceJoinChatId,
        shopCustomizationJson.forceJoinChannelUrl,
      )
    : null;

  assert.equal(broadcastChannelTarget, "@my_announcements");

  // When disabled
  const disabledCustomization = {
    channelBroadcastNotificationEnabled: false,
    forceJoinChannelUrl: "https://t.me/my_announcements",
  };
  const disabledTarget = disabledCustomization.channelBroadcastNotificationEnabled
    ? resolveTelegramChannelTarget(null, disabledCustomization.forceJoinChannelUrl)
    : null;
  assert.equal(disabledTarget, null);
  console.log("✔ Test 3 passed: Broadcast honors channelBroadcastNotificationEnabled toggle");

  // Test 4: Deep Link /start buy_ parameter parsing
  console.log("\n--- Test 4: /start buy_ Parameter Parsing ---");
  const startCommands = [
    { text: "/start buy_cmu12345", expected: "cmu12345" },
    { text: "/start buy_prod_999 ", expected: "prod_999" },
    { text: "/start ref_affiliate123", expected: null },
    { text: "/start", expected: null },
  ];

  for (const tc of startCommands) {
    const param = tc.text.slice("/start".length).trim();
    if (param.startsWith("buy_")) {
      const extractedId = param.slice("buy_".length).trim();
      assert.equal(extractedId, tc.expected);
    } else {
      assert.equal(tc.expected, null);
    }
  }
  console.log("✔ Test 4 passed: /start buy_<productId> parsed seamlessly");

  console.log("\n=== ALL CHANNEL NOTIFICATION TESTS PASSED SUCCESSFULLY ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
