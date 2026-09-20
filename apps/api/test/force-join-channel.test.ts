import assert from "node:assert/strict";
import type { TelegramChatMember } from "@reseller/shared/server";

function isUserChatMember(member: TelegramChatMember | null | undefined): boolean {
  if (!member) return false;
  return (
    member.status === "creator" ||
    member.status === "administrator" ||
    member.status === "member" ||
    (member.status === "restricted" && member.is_member !== false)
  );
}

function extractTargetChatId(channelUrl: string, explicitChatId?: string): string {
  if (explicitChatId && explicitChatId.trim() !== "") {
    return explicitChatId.trim();
  }
  const cleanUrl = channelUrl.trim();
  if (cleanUrl.includes("t.me/")) {
    const handle = cleanUrl.split("t.me/")[1]?.split("/")[0]?.replace(/^\+/, "");
    return handle ? `@${handle}` : cleanUrl;
  }
  return cleanUrl.startsWith("@") ? cleanUrl : `@${cleanUrl}`;
}

function buildForceJoinMarkup(channelUrl: string, language = "vi") {
  const isEn = language === "en";
  const isTh = language === "th";
  const isZh = language === "zh";

  const joinBtnText = isEn
    ? "📢 Join Channel"
    : isTh
      ? "📢 เข้าร่วมช่อง"
      : isZh
        ? "📢 加入频道"
        : "📢 Tham gia kênh";

  const verifyBtnText = isEn
    ? "✅ Verify"
    : isTh
      ? "✅ ยืนยัน"
      : isZh
        ? "✅ 验证"
        : "✅ Xác minh";

  return {
    inline_keyboard: [
      [
        {
          text: joinBtnText,
          url: channelUrl,
        },
      ],
      [
        {
          text: verifyBtnText,
          callback_data: "force_join:verify",
        },
      ],
    ],
  };
}

function runTests() {
  console.log("Running force-join-channel tests...");

  // Test 1: Membership status checking
  assert.equal(isUserChatMember({ status: "creator" }), true);
  assert.equal(isUserChatMember({ status: "administrator" }), true);
  assert.equal(isUserChatMember({ status: "member" }), true);
  assert.equal(isUserChatMember({ status: "restricted", is_member: true }), true);
  assert.equal(isUserChatMember({ status: "restricted", is_member: false }), false);
  assert.equal(isUserChatMember({ status: "left" }), false);
  assert.equal(isUserChatMember({ status: "kicked" }), false);
  assert.equal(isUserChatMember(null), false);
  assert.equal(isUserChatMember(undefined), false);

  // Test 2: Chat ID extraction
  assert.equal(
    extractTargetChatId("https://t.me/reseller_community"),
    "@reseller_community",
  );
  assert.equal(
    extractTargetChatId("https://t.me/reseller_community/123"),
    "@reseller_community",
  );
  assert.equal(
    extractTargetChatId("@my_channel"),
    "@my_channel",
  );
  assert.equal(
    extractTargetChatId("https://t.me/+joinPrivate", "-1001987654321"),
    "-1001987654321",
  );

  // Test 3: Markup structure
  const markupVi = buildForceJoinMarkup("https://t.me/reseller_community", "vi");
  assert.equal(markupVi.inline_keyboard.length, 2);
  assert.equal(markupVi.inline_keyboard[0][0].text, "📢 Tham gia kênh");
  assert.equal(markupVi.inline_keyboard[0][0].url, "https://t.me/reseller_community");
  assert.equal(markupVi.inline_keyboard[1][0].text, "✅ Xác minh");
  assert.equal(markupVi.inline_keyboard[1][0].callback_data, "force_join:verify");

  const markupEn = buildForceJoinMarkup("https://t.me/reseller_community", "en");
  assert.equal(markupEn.inline_keyboard[0][0].text, "📢 Join Channel");
  assert.equal(markupEn.inline_keyboard[1][0].text, "✅ Verify");

  console.log("All force-join-channel tests passed successfully!");
}

runTests();
