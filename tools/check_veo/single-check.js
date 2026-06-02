'use strict';

// Single-account VEO check wrapper for reseller worker.
// Args: --email <e> --password <p> [--proxy <scheme://[user:pass@]host:port>]
// Output: a single line "JSON_RESULT:{...}" on stdout.

const { chromium } = require('playwright');
const { checkAccount } = require('./check_veo');

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function parseProxyArg(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\/|^socks5:\/\//.test(s)) return { server: s };
  const parts = s.split(':');
  if (parts.length === 2) return { server: `socks5://${parts[0]}:${parts[1]}` };
  if (parts.length === 4) return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
  return { server: `http://${s}` };
}

(async () => {
  // Env vars take precedence (set by reseller worker for security).
  const email = process.env.CHECK_EMAIL || arg('email');
  const password = process.env.CHECK_PASSWORD || arg('password');
  const proxy = parseProxyArg(process.env.CHECK_PROXY || arg('proxy'));

  if (!email || !password) {
    process.stdout.write('JSON_RESULT:' + JSON.stringify({
      ok: false,
      status: 'invalid_args',
      error: 'email and password required',
    }) + '\n');
    process.exit(2);
  }

  const BROWSER_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-infobars', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--no-first-run',
  ];

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
    const r = await checkAccount(browser, email, password, proxy);
    const status = String(r?.status || 'TIMEOUT').toUpperCase();
    const credit = typeof r?.credit === 'number' ? r.credit : (parseInt(r?.credit) || null);
    // Plan name từ check_veo (Ultra/Pro/Premium/Free/null). KHÔNG override bằng credit number
    // — warranty side cần phân biệt gói trả phí hết quota (stillPaid) vs gói Free (isDead).
    const planName = r?.plan ? String(r.plan).trim() : null;
    const planLower = planName ? planName.toLowerCase() : '';
    // Shop chỉ bán Ultra → chỉ Ultra mới count là "còn hạn" để auto-reject claim.
    // Pro/Premium = gói khác (rớt từ Ultra hoặc detect nhầm) → KHÔNG auto-reject,
    // KHÔNG auto-replace, route sang seller review để xác minh.
    const isUltraPlan = planLower === 'ultra';
    const isFreePlan = planLower === 'free';

    // Phân loại 3 case rõ ràng (mirror với reseller worker để route đúng):
    //   - 'flow_blocked'    → Workspace admin tắt Flow service riêng cho org (Gmail/Drive vẫn ok
    //                          nhưng Flow chết) → HOÀN acc. check_veo.js đã verify bằng cách
    //                          navigate trực tiếp vào Flow Labs sau khi gặp ServiceNotAllowed,
    //                          nên đây là Flow-block CHẮC CHẮN, không nhầm với Gmail-block.
    //   - 'plan_lost'       → acc còn login được nhưng plan rớt về Free (mất Ultra) → HOÀN acc.
    //   - 'account_disabled'→ Google account bị disable/suspend toàn bộ → HOÀN acc.
    //   - 'wrong_password'  → sai pass (có thể khách đổi) → seller review, KHÔNG hoàn.
    //   - '2fa'             → cần OTP device → seller review, KHÔNG hoàn.
    //   - 'timeout'         → UNKNOWN state → seller review, KHÔNG hoàn.
    //   - null + LIVE+Ultra → còn hạn → auto-reject claim.
    let errorType = null;
    if (status === 'DIE') {
      errorType = r?.reason || 'account_disabled';
    } else if (status === 'WRONG_PASS') {
      errorType = 'wrong_password';
    } else if (status === 'TWO_FA') {
      errorType = '2fa';
    } else if (status === 'TIMEOUT') {
      errorType = 'timeout';
    } else if (isFreePlan) {
      // status=LIVE nhưng plan=Free → acc còn login được, đã mất Ultra → hoàn acc.
      errorType = 'plan_lost';
    }

    // isDead chỉ true khi CHẮC CHẮN acc chết (về mặt SẢN PHẨM Ultra):
    //   - flow_blocked   (Flow service bị Workspace admin disable)
    //   - plan_lost      (rớt từ Ultra về Free)
    //   - account_disabled (toàn bộ Google account die)
    // KHÔNG bao gồm:
    //   - wrong_password / 2fa / timeout → state UNKNOWN, không bằng chứng acc chết
    //   - Pro/Premium plan → có thể detect nhầm popup upsell, seller review
    //   - Gmail-blocked nhưng Flow vẫn work → check_veo.js đã verify, trả LIVE+plan=Ultra
    const isDead = ['flow_blocked', 'plan_lost', 'account_disabled'].includes(errorType);
    // stillPaid=true → warranty service auto-reject claim. CHỈ set khi acc đang ở Ultra.
    const stillPaid = status === 'LIVE' && isUltraPlan;
    process.stdout.write('JSON_RESULT:' + JSON.stringify({
      ok: !errorType,
      tool: 'veo',
      status,
      credit,
      plan: planName || (credit !== null ? `${credit} credit` : null),
      tier: planName,
      stillPaid,
      detail: r?.detail || null,
      reason: r?.reason || null,
      errorType,
      isDead,
    }) + '\n');
    process.exit(0);
  } catch (e) {
    process.stdout.write('JSON_RESULT:' + JSON.stringify({
      ok: false,
      tool: 'veo',
      status: 'fatal',
      error: e?.message || String(e),
    }) + '\n');
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
