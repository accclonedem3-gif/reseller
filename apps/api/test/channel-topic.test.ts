import assert from "node:assert/strict";
import {
  resolveTelegramChannelTarget,
  resolveTelegramChannelTargetWithThread,
} from "@reseller/shared/server";

// 1. Test public group link with topic ID: https://t.me/hoctiengem/5
{
  const res = resolveTelegramChannelTargetWithThread(null, "https://t.me/hoctiengem/5");
  assert.deepEqual(
    res,
    { chatId: "@hoctiengem", messageThreadId: 5 },
    "Must extract @hoctiengem and thread 5 from public topic link",
  );
}

// 2. Test user error case: user mistakenly enters bot's username in chatId box
{
  const res = resolveTelegramChannelTargetWithThread(
    "@Sonor_ai",
    "https://t.me/hoctiengem/5",
    null,
    "Sonor_ai",
  );
  assert.deepEqual(
    res,
    { chatId: "@hoctiengem", messageThreadId: 5 },
    "Must ignore bot's own username in chatId and resolve group from URL with thread 5",
  );
}

// 2b. Test user error case: user enters an extraneous personal username into chatId when public group URL exists
{
  const res = resolveTelegramChannelTargetWithThread(
    "@huymmo1711",
    "https://t.me/hoctiengem/5",
    null,
    "taogiongai_bot",
  );
  assert.deepEqual(
    res,
    { chatId: "@hoctiengem", messageThreadId: 5 },
    "Must preserve @hoctiengem from URL and not be overridden by extraneous @huymmo1711",
  );
}

// 3. Test private group topic link: https://t.me/c/1829384756/42
{
  const res = resolveTelegramChannelTargetWithThread(
    null,
    "https://t.me/c/1829384756/42",
  );
  assert.deepEqual(
    res,
    { chatId: "-1001829384756", messageThreadId: 42 },
    "Must convert /c/1829384756/42 to -1001829384756 with thread 42",
  );
}

// 4. Test explicit topicId parameter overriding or setting thread
{
  const res = resolveTelegramChannelTargetWithThread(
    "-1001928374650",
    "https://t.me/+joinlink",
    "99",
  );
  assert.deepEqual(
    res,
    { chatId: "-1001928374650", messageThreadId: 99 },
    "Must apply explicit topicId 99",
  );
}

// 5. Test plain channel link without topic
{
  const res = resolveTelegramChannelTargetWithThread(
    null,
    "https://t.me/my_channel_official",
  );
  assert.deepEqual(
    res,
    { chatId: "@my_channel_official" },
    "Must resolve @my_channel_official with no messageThreadId",
  );
  assert.equal(res?.messageThreadId, undefined);
}

// 6. Test backward compatible resolveTelegramChannelTarget
{
  assert.equal(
    resolveTelegramChannelTarget("@Sonor_ai", "https://t.me/hoctiengem/5", null, "Sonor_ai"),
    "@hoctiengem",
  );
  assert.equal(
    resolveTelegramChannelTarget(null, "https://t.me/hoctiengem/5"),
    "@hoctiengem",
  );
  assert.equal(
    resolveTelegramChannelTarget(null, "https://t.me/c/1829384756/42"),
    "-1001829384756",
  );
}

// 7. Test direct chatId with topic slash or underscore: -1001234567890/5
{
  const res = resolveTelegramChannelTargetWithThread("-1001234567890/5");
  assert.deepEqual(res, { chatId: "-1001234567890", messageThreadId: 5 });
}

// 8. Test group without topic: direct numeric Chat ID
{
  const res = resolveTelegramChannelTargetWithThread("-1001234567890");
  assert.deepEqual(res, { chatId: "-1001234567890" });
  assert.equal(res?.messageThreadId, undefined);
}

// 9. Test private group with invite link + Chat ID (no topic)
{
  const res = resolveTelegramChannelTargetWithThread("-1001234567890", "https://t.me/+lo_T-U-7s41iOWQ1");
  assert.deepEqual(res, { chatId: "-1001234567890" });
  assert.equal(res?.messageThreadId, undefined);
}

// 10. Test private group with ONLY invite link (no Chat ID provided) -> should return null
{
  const res = resolveTelegramChannelTargetWithThread(null, "https://t.me/+lo_T-U-7s41iOWQ1");
  assert.equal(res, null, "Private invite link cannot be resolved without Chat ID");
}

console.log("All channel topic tests passed successfully!");
