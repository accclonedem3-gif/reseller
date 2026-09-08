import assert from "node:assert/strict";
import { BotRenderHelpers } from "../src/lib/bot-render.helpers";

console.log("--- Testing sanitizeTelegramHtml and BotRenderHelpers ---");

const render = new BotRenderHelpers();

// Test 1: Preserves <tg-emoji> tags intact
{
  const input = `<tg-emoji emoji-id="5368324170671202286">⭐️</tg-emoji> Uy tín tạo nên thương hiệu`;
  const output = render.sanitizeTelegramHtml(input);
  assert.equal(output, input, "Should preserve <tg-emoji> tag and content");
  console.log("✓ Test 1 passed: Preserves <tg-emoji>");
}

// Test 2: Preserves valid formatting tags (<b>, <i>, <a>, <code>)
{
  const input = `<b>ĐẬM</b> <i>NGHIÊNG</i> <code>CODE</code> <a href="https://t.me/shop">LINK</a>`;
  const output = render.sanitizeTelegramHtml(input);
  assert.equal(output, input, "Should preserve standard Telegram HTML tags");
  console.log("✓ Test 2 passed: Preserves standard HTML tags");
}

// Test 3: Escapes raw <, >, & safely without breaking Telegram tags
{
  const input = `<tg-emoji emoji-id="12345">💎</tg-emoji> Giá rẻ & chất lượng < 100k > 50k`;
  const output = render.sanitizeTelegramHtml(input);
  assert.equal(
    output,
    `<tg-emoji emoji-id="12345">💎</tg-emoji> Giá rẻ &amp; chất lượng &lt; 100k &gt; 50k`,
    "Should escape raw characters while preserving tags",
  );
  console.log("✓ Test 3 passed: Escapes unsafe characters safely");
}

// Test 4: Does not double-encode existing XML entities
{
  const input = `Momo &amp; Ngân hàng`;
  const output = render.sanitizeTelegramHtml(input);
  assert.equal(output, `Momo &amp; Ngân hàng`, "Should not double escape &amp;");
  console.log("✓ Test 4 passed: No double escaping");
}

// Test 5: buildHomeText with rich custom emoji tagline
{
  const tagline = `<tg-emoji emoji-id="5368324170671202286">👑</tg-emoji> <b>PREMIUM STORE</b>\nHotline: <tg-emoji emoji-id="123">0</tg-emoji><tg-emoji emoji-id="456">9</tg-emoji>`;
  const homeText = render.buildHomeText("QK Shop", tagline, 10, 5, "vi");
  assert(
    homeText.includes(
      `<tg-emoji emoji-id="5368324170671202286">👑</tg-emoji> <b>PREMIUM STORE</b>`,
    ),
    "buildHomeText should include unescaped custom emoji in tagline",
  );
  assert(
    homeText.includes(`🔥 <b>QK Shop</b>`),
    "buildHomeText should have bold title",
  );
  console.log("✓ Test 5 passed: buildHomeText preserves custom emoji");
}

// Test 6: buildSupportText with rich supportNote
{
  const supportNote = `<tg-emoji emoji-id="999">🚨</tg-emoji> <b>Hỗ trợ 24/7</b> qua Telegram &amp; Zalo`;
  const supportText = render.buildSupportText(
    "QK Shop",
    "@support",
    "0905970970",
    "vi",
    supportNote,
  );
  assert(
    supportText.includes(
      `<tg-emoji emoji-id="999">🚨</tg-emoji> <b>Hỗ trợ 24/7</b>`,
    ),
    "buildSupportText should include rich supportNote",
  );
  console.log("✓ Test 6 passed: buildSupportText preserves rich supportNote");
}

console.log("ALL SANITIZE TESTS PASSED SUCCESSFULLY! ✅");
