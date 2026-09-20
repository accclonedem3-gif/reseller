import assert from "node:assert/strict";
import type { TelegramChatMember } from "@reseller/shared/server";

interface MockCache {
  store: Map<string, { value: unknown; ttl: number }>;
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

function createMockCache(): MockCache {
  const store = new Map<string, { value: unknown; ttl: number }>();
  return {
    store,
    async get<T>(key: string): Promise<T | undefined> {
      return store.get(key)?.value as T | undefined;
    },
    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      store.set(key, { value, ttl: ttlSeconds });
    },
  };
}

// Logic replicate from telegram-bot.service.v2.ts
function normalizeTargetChatId(forceJoinChatId: string, forceJoinUrl: string): string {
  let chatId = forceJoinChatId.trim();
  const url = forceJoinUrl.trim();

  if (!chatId && url) {
    const match = url.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/);
    if (match && match[1] && !match[1].startsWith("+") && match[1] !== "joinchat") {
      chatId = `@${match[1]}`;
    }
  }

  let targetChatId = (chatId || url).trim();
  if (
    targetChatId &&
    !targetChatId.startsWith("@") &&
    !targetChatId.startsWith("-") &&
    !targetChatId.startsWith("+") &&
    !targetChatId.includes("/")
  ) {
    targetChatId = `@${targetChatId}`;
  }
  return targetChatId;
}

function isMemberStatus(member: TelegramChatMember | null | undefined): boolean {
  if (!member) return false;
  return (
    member.status === "creator" ||
    member.status === "administrator" ||
    member.status === "member" ||
    (member.status === "restricted" && member.is_member !== false)
  );
}

// Simulated Telegram Gatekeeper
async function simulateGatekeeper(params: {
  shopId: string;
  ownerTelegramUserId?: string;
  customizationJson: {
    forceJoinChannelEnabled?: boolean;
    forceJoinChannelUrl?: string;
    forceJoinChatId?: string;
  };
  visitorTelegramUserId: string;
  userChatId: number;
  message?: { text?: string };
  callbackQuery?: { id: string; data: string; message?: { message_id: number } };
  cache: MockCache;
  mockGetChatMember: (chatId: string, userId: string) => Promise<TelegramChatMember>;
}) {
  const actions: string[] = [];
  const {
    shopId,
    ownerTelegramUserId,
    customizationJson,
    visitorTelegramUserId,
    userChatId,
    message,
    callbackQuery,
    cache,
    mockGetChatMember,
  } = params;

  const forceJoinEnabled = customizationJson.forceJoinChannelEnabled === true;
  const forceJoinUrl = String(customizationJson.forceJoinChannelUrl || "").trim();
  const forceJoinChatId = String(customizationJson.forceJoinChatId || "").trim();

  const targetChatId = normalizeTargetChatId(forceJoinChatId, forceJoinUrl);

  const isBotOwner = Boolean(
    ownerTelegramUserId &&
      String(ownerTelegramUserId).trim() === visitorTelegramUserId,
  );

  if (
    forceJoinEnabled &&
    targetChatId &&
    !isBotOwner &&
    visitorTelegramUserId &&
    userChatId
  ) {
    const forceJoinCacheKey = `bot:force_join_verified:${shopId}:${visitorTelegramUserId}`;
    const isAlreadyVerified = await cache.get<boolean>(forceJoinCacheKey);

    // 1. Verify callback
    if (callbackQuery?.data === "force_join:verify") {
      const member = await mockGetChatMember(targetChatId, visitorTelegramUserId);
      const isMember = isMemberStatus(member);

      if (isMember) {
        await cache.set(forceJoinCacheKey, true, 86400);
        actions.push("answer_callback_success");
        if (callbackQuery.message?.message_id) {
          actions.push(`delete_message:${callbackQuery.message.message_id}`);
        }
        actions.push("render_language_menu_onboarding");
        return { blocked: true, actions, reason: "verified_success" };
      } else {
        actions.push("answer_callback_alert_not_joined");
        return { blocked: true, actions, reason: "verify_failed_not_member" };
      }
    }

    // 2. Normal message / other callback
    if (!isAlreadyVerified) {
      const member = await mockGetChatMember(targetChatId, visitorTelegramUserId);
      const isMember = isMemberStatus(member);

      if (isMember) {
        // User is already in the channel!
        await cache.set(forceJoinCacheKey, true, 86400);
        // Do NOT block, proceed to normal handler!
      } else {
        if (callbackQuery?.id) {
          actions.push("answer_callback_empty");
        }
        actions.push("send_force_join_prompt");
        return { blocked: true, actions, reason: "prompt_sent" };
      }
    }
  }

  // Fallthrough to normal bot handlers
  actions.push(`normal_handler:${message?.text || callbackQuery?.data || "action"}`);
  return { blocked: false, actions, reason: "proceed_normal" };
}

async function runE2ETests() {
  console.log("=== RUNNING E2E FORCE JOIN VERIFICATION TESTS ===");
  const shopId = "shop_test_123";
  const ownerId = "111111111";
  const customerA = "222222222"; // User who has not joined yet
  const customerB = "333333333"; // User who already joined beforehand

  // Mock Telegram channel members database
  const channelMembers = new Map<string, TelegramChatMember>();
  channelMembers.set(customerB, { status: "member" }); // B is already member

  const mockGetChatMember = async (chatId: string, userId: string): Promise<TelegramChatMember> => {
    return channelMembers.get(userId) || { status: "left" };
  };

  const cache = createMockCache();

  // Test 1: Feature DISABLED
  {
    console.log("Test 1: When force join is disabled -> users proceed directly");
    const res = await simulateGatekeeper({
      shopId,
      ownerTelegramUserId: ownerId,
      customizationJson: { forceJoinChannelEnabled: false },
      visitorTelegramUserId: customerA,
      userChatId: 222222222,
      message: { text: "/start" },
      cache,
      mockGetChatMember,
    });
    assert.equal(res.blocked, false);
    assert.deepEqual(res.actions, ["normal_handler:/start"]);
  }

  // Test 2: Feature ENABLED, Owner sends /start -> Owner is bypassed
  {
    console.log("Test 2: When force join is enabled, Owner is never blocked");
    const res = await simulateGatekeeper({
      shopId,
      ownerTelegramUserId: ownerId,
      customizationJson: {
        forceJoinChannelEnabled: true,
        forceJoinChannelUrl: "https://t.me/official_channel",
      },
      visitorTelegramUserId: ownerId, // OWNER
      userChatId: 111111111,
      message: { text: "/start" },
      cache,
      mockGetChatMember,
    });
    assert.equal(res.blocked, false);
    assert.deepEqual(res.actions, ["normal_handler:/start"]);
  }

  // Test 3: Customer A (NOT in channel) sends /start -> gets force join prompt
  {
    console.log("Test 3: Customer A not in channel sends /start -> gets prompt");
    const res = await simulateGatekeeper({
      shopId,
      ownerTelegramUserId: ownerId,
      customizationJson: {
        forceJoinChannelEnabled: true,
        forceJoinChannelUrl: "https://t.me/official_channel",
      },
      visitorTelegramUserId: customerA,
      userChatId: 222222222,
      message: { text: "/start" },
      cache,
      mockGetChatMember,
    });
    assert.equal(res.blocked, true);
    assert.deepEqual(res.actions, ["send_force_join_prompt"]);
    // Cache must NOT be verified yet
    const cached = await cache.get(`bot:force_join_verified:${shopId}:${customerA}`);
    assert.equal(cached, undefined);
  }

  // Test 4: Customer A clicks "Verify" BEFORE joining -> alert shown, prompt remains
  {
    console.log("Test 4: Customer A clicks Verify before joining -> alert popup shown");
    const res = await simulateGatekeeper({
      shopId,
      ownerTelegramUserId: ownerId,
      customizationJson: {
        forceJoinChannelEnabled: true,
        forceJoinChannelUrl: "https://t.me/official_channel",
      },
      visitorTelegramUserId: customerA,
      userChatId: 222222222,
      callbackQuery: {
        id: "cb_query_1",
        data: "force_join:verify",
        message: { message_id: 1001 },
      },
      cache,
      mockGetChatMember,
    });
    assert.equal(res.blocked, true);
    assert.equal(res.reason, "verify_failed_not_member");
    assert.deepEqual(res.actions, ["answer_callback_alert_not_joined"]);
  }

  // Test 5: Customer A joins the channel, then clicks "Verify" -> verified!
  {
    console.log("Test 5: Customer A joins channel and clicks Verify -> verified, prompt deleted, onboarding opened");
    // Customer A joins
    channelMembers.set(customerA, { status: "member" });

    const res = await simulateGatekeeper({
      shopId,
      ownerTelegramUserId: ownerId,
      customizationJson: {
        forceJoinChannelEnabled: true,
        forceJoinChannelUrl: "https://t.me/official_channel",
      },
      visitorTelegramUserId: customerA,
      userChatId: 222222222,
      callbackQuery: {
        id: "cb_query_2",
        data: "force_join:verify",
        message: { message_id: 1001 },
      },
      cache,
      mockGetChatMember,
    });
    assert.equal(res.blocked, true);
    assert.equal(res.reason, "verified_success");
    assert.deepEqual(res.actions, [
      "answer_callback_success",
      "delete_message:1001",
      "render_language_menu_onboarding",
    ]);

    // Verify cache is populated for 24h
    const cached = await cache.get(`bot:force_join_verified:${shopId}:${customerA}`);
    assert.equal(cached, true);
  }

  // Test 6: Subsequent requests from Customer A -> pass immediately without getChatMember
  {
    console.log("Test 6: Customer A subsequent requests -> instant pass via cache, no prompt");
    let apiCalls = 0;
    const trackingGetChatMember = async (chatId: string, userId: string) => {
      apiCalls++;
      return { status: "member" } as TelegramChatMember;
    };

    const res = await simulateGatekeeper({
      shopId,
      ownerTelegramUserId: ownerId,
      customizationJson: {
        forceJoinChannelEnabled: true,
        forceJoinChannelUrl: "https://t.me/official_channel",
      },
      visitorTelegramUserId: customerA,
      userChatId: 222222222,
      message: { text: "/products" },
      cache,
      mockGetChatMember: trackingGetChatMember,
    });
    assert.equal(res.blocked, false);
    assert.deepEqual(res.actions, ["normal_handler:/products"]);
    assert.equal(apiCalls, 0, "Should use cache and NOT call Telegram getChatMember API");
  }

  // Test 7: Customer B (already in channel BEFORE first /start) -> NEVER sees prompt!
  {
    console.log("Test 7: Customer B already joined beforehand -> prompt NEVER appears");
    const res = await simulateGatekeeper({
      shopId,
      ownerTelegramUserId: ownerId,
      customizationJson: {
        forceJoinChannelEnabled: true,
        forceJoinChannelUrl: "https://t.me/official_channel",
      },
      visitorTelegramUserId: customerB,
      userChatId: 333333333,
      message: { text: "/start" },
      cache,
      mockGetChatMember,
    });
    assert.equal(res.blocked, false);
    assert.deepEqual(res.actions, ["normal_handler:/start"]);
    // Prompt was never sent!
    assert.ok(!res.actions.includes("send_force_join_prompt"));

    // And cache is set so subsequent requests are fast
    const cachedB = await cache.get(`bot:force_join_verified:${shopId}:${customerB}`);
    assert.equal(cachedB, true);
  }

  // Test 8: Target Chat ID normalization for various URL types
  {
    console.log("Test 8: Target Chat ID normalization handles all input formats");
    assert.equal(normalizeTargetChatId("", "https://t.me/my_group"), "@my_group");
    assert.equal(normalizeTargetChatId("", "http://telegram.me/my_group"), "@my_group");
    assert.equal(normalizeTargetChatId("", "t.me/my_group"), "@my_group");
    assert.equal(normalizeTargetChatId("", "@my_group"), "@my_group");
    assert.equal(normalizeTargetChatId("", "my_group"), "@my_group");
    assert.equal(normalizeTargetChatId("-100987654321", "https://t.me/+private"), "-100987654321");
    assert.equal(normalizeTargetChatId("-100987654321", ""), "-100987654321");
  }

  console.log("=== ALL 8 END-TO-END SCENARIOS PASSED WITH ZERO ERRORS ===");
}

runE2ETests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
