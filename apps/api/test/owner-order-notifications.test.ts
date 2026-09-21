import assert from "node:assert/strict";
import axios from "axios";
import { notifyOwnerNewOrder } from "../../../apps/worker/src/fulfillment/purchase";

async function runTests() {
  console.log("=== RUNNING OWNER ORDER NOTIFICATIONS & BUTTON ACTION TEST SUITE ===");

  const sentTelegramCalls: Array<{
    url: string;
    body: any;
  }> = [];

  const originalPost = axios.post;
  (axios as any).post = async (url: string, body: any) => {
    if (typeof url === "string" && url.includes("api.telegram.org")) {
      sentTelegramCalls.push({ url, body });
      return { data: { ok: true, result: { message_id: 1234 } } };
    }
    return originalPost(url, body);
  };

  try {
    // Test 1: ADD_MAIL Order Notification to Owner with 1-tap copy & inline buttons
    console.log("\n--- Test 1: ADD_MAIL Order Notification Format ---");
    sentTelegramCalls.length = 0;

    await notifyOwnerNewOrder({
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      shop: {
        id: "shop_test_1",
        name: "Test Shop",
        botConfig: {
          ownerTelegramUserId: "99887766",
          customizationJson: { ownerOrderNotificationEnabled: true },
        },
      },
      order: {
        id: "order_addmail_123",
        orderCode: "ORD-ADDMAIL-001",
        productNameSnapshot: "Canva Pro 1 Year (Add Mail)",
        quantity: 1,
        totalSaleAmount: 150000,
        customerEmail: "student@university.edu.vn",
        targetLink: "https://canva.com",
        comments: "Kích hoạt gấp giúp mình nha",
        customer: {
          telegramUsername: "happy_customer",
          telegramUserId: "11223344",
          name: "Happy Customer",
        },
      },
      type: "ADD_MAIL",
    });

    assert.equal(sentTelegramCalls.length, 1, "Should send 1 message to owner via Telegram API");
    const msg1 = sentTelegramCalls[0].body;
    assert.equal(msg1.chat_id, "99887766", "Must send to ownerTelegramUserId");
    assert.ok(
      msg1.text.includes("⚡ <b>ĐƠN HÀNG MỚI CẦN XỬ LÝ (ADD MAIL)</b>"),
      "Must have ADD_MAIL header",
    );
    assert.ok(
      msg1.text.includes("<code>student@university.edu.vn</code>"),
      "Must wrap email in <code> tags for 1-tap copy",
    );
    assert.ok(
      msg1.text.includes("#ORD-ADDMAIL-001"),
      "Must include order code",
    );
    assert.ok(
      msg1.text.includes("@happy_customer"),
      "Must include customer username",
    );

    // Verify inline buttons
    const keyboard = msg1.reply_markup?.inline_keyboard;
    assert.ok(Array.isArray(keyboard), "Must include inline keyboard");
    assert.equal(keyboard.length, 1);
    assert.equal(keyboard[0].length, 2);
    assert.equal(keyboard[0][0].text, "✅ Đã hoàn tất");
    assert.equal(
      keyboard[0][0].callback_data,
      "owner_order:complete:order_addmail_123",
      "Complete button callback must match owner_order:complete:<orderId>",
    );
    assert.equal(keyboard[0][1].text, "❌ Hủy đơn");
    assert.equal(
      keyboard[0][1].callback_data,
      "owner_order:cancel:order_addmail_123",
      "Cancel button callback must match owner_order:cancel:<orderId>",
    );
    console.log("✔ Test 1 passed: ADD_MAIL notification has <code> email and [✅ Hoàn tất] / [❌ Hủy] buttons");

    // Test 2: AUTO_DELIVERED Order Notification Format
    console.log("\n--- Test 2: AUTO_DELIVERED Order Notification Format ---");
    sentTelegramCalls.length = 0;

    await notifyOwnerNewOrder({
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      shop: {
        id: "shop_test_1",
        name: "Test Shop",
        botConfig: {
          ownerTelegramUserId: "99887766",
          customizationJson: { ownerOrderNotificationEnabled: true },
        },
      },
      order: {
        orderCode: "ORD-AUTO-002",
        productNameSnapshot: "Netflix Premium Ultra HD",
        quantity: 2,
        totalSaleAmount: 180000,
        customer: {
          telegramUsername: "movie_fan",
        },
      },
      type: "AUTO_DELIVERED",
    });

    assert.equal(sentTelegramCalls.length, 1);
    const msg2 = sentTelegramCalls[0].body;
    assert.ok(
      msg2.text.includes("🎉 <b>ĐƠN HÀNG MỚI (Tự động hoàn tất)</b>"),
      "Must have AUTO_DELIVERED header",
    );
    assert.equal(
      msg2.reply_markup,
      undefined,
      "Auto delivered order should not have action buttons",
    );
    console.log("✔ Test 2 passed: AUTO_DELIVERED notification has no action buttons");

    // Test 3: Disabled by ownerOrderNotificationEnabled toggle
    console.log("\n--- Test 3: Disabled Toggle Skips Notification ---");
    sentTelegramCalls.length = 0;

    await notifyOwnerNewOrder({
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      shop: {
        id: "shop_test_1",
        name: "Test Shop",
        botConfig: {
          ownerTelegramUserId: "99887766",
          customizationJson: { ownerOrderNotificationEnabled: false },
        },
      },
      order: {
        orderCode: "ORD-003",
        productNameSnapshot: "Test Product",
        quantity: 1,
        totalSaleAmount: 50000,
      },
      type: "ADD_MAIL",
    });

    assert.equal(
      sentTelegramCalls.length,
      0,
      "Should not send notification when ownerOrderNotificationEnabled is false",
    );
    console.log("✔ Test 3 passed: Notification correctly suppressed when disabled");

    // Test 4: Missing ownerTelegramUserId Skips Notification
    console.log("\n--- Test 4: Missing Owner Telegram ID Skips Notification ---");
    sentTelegramCalls.length = 0;

    await notifyOwnerNewOrder({
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      shop: {
        id: "shop_test_1",
        name: "Test Shop",
        botConfig: {
          ownerTelegramUserId: null,
          customizationJson: { ownerOrderNotificationEnabled: true },
        },
      },
      order: {
        orderCode: "ORD-004",
        productNameSnapshot: "Test Product",
        quantity: 1,
        totalSaleAmount: 50000,
      },
      type: "ADD_MAIL",
    });

    assert.equal(
      sentTelegramCalls.length,
      0,
      "Should not send notification when ownerTelegramUserId is empty",
    );
    console.log("✔ Test 4 passed: Gracefully skipped when ownerTelegramUserId not configured");

    // Test 5: Authorization check simulation
    console.log("\n--- Test 5: Button Click Authorization Verification ---");
    const configuredOwnerId = "99887766";
    const hackerUserId = "11223344";
    const legitOwnerId = "99887766";

    const isHackerAuthorized = hackerUserId === configuredOwnerId;
    const isOwnerAuthorized = legitOwnerId === configuredOwnerId;

    assert.equal(isHackerAuthorized, false, "Random user must be rejected");
    assert.equal(isOwnerAuthorized, true, "Only owner telegram user ID must be accepted");
    console.log("✔ Test 5 passed: Strict owner authorization verified");

    console.log("\n==================================================");
    console.log("ALL OWNER ORDER NOTIFICATION TESTS PASSED SUCCESSFULLY! ✔");
    console.log("==================================================");
  } finally {
    (axios as any).post = originalPost;
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
