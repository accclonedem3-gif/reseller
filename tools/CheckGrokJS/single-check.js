'use strict';

// Single-account check wrapper: invoked by reseller worker as subprocess.
// Args: --email <e> --password <p> [--proxy <scheme://[user:pass@]host:port>]
// Output: a single line "JSON_RESULT:{...}" on stdout.

const { runAccount, parseProxy, startWindowHider } = require('./toolgrok');

// Start window hider immediately — Add-Type compiles while args are parsed,
// so it's ready before puppeteer.launch() is called inside runAccount.
startWindowHider();

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

(async () => {
  // Env vars take precedence (set by reseller worker for security — credentials not in `ps`).
  const email = process.env.CHECK_EMAIL || arg('email');
  const password = process.env.CHECK_PASSWORD || arg('password');
  const proxyArg = process.env.CHECK_PROXY || arg('proxy');

  if (!email || !password) {
    process.stdout.write('JSON_RESULT:' + JSON.stringify({
      ok: false,
      status: 'invalid_args',
      error: 'email and password required',
    }) + '\n');
    process.exit(2);
  }

  const proxy = proxyArg ? parseProxy(proxyArg) : null;

  // Lỗi definitive — không retry vô ích.
  const NO_RETRY = new Set(['proxy_die', '2fa', 'blocked', 'wrong_password', 'login_stuck']);
  const MAX_RETRIES = 2;

  try {
    let r = await runAccount(email, password, true, proxy, 0);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (!r?.error || NO_RETRY.has(r?.error_type)) break;
      r = await runAccount(email, password, true, proxy, 0);
    }
    const errorType = r?.error_type || null;
    // plan = null for ANY error — prevents generic failures (CF timeout, API 401, crash)
    // from falsely resolving to 'Free' and triggering a wrong warranty replacement.
    const plan = r?.error ? null : String(r?.plan || 'Free');
    const status = String(r?.status || 'Unknown');
    const tier = (() => {
      if (!plan) return 'UNKNOWN';
      const p = plan.toLowerCase();
      if (p.includes('heavy')) return 'HEAVY';
      if (p.includes('supergrok') || p.includes('super')) return 'SUPERGROK';
      return 'FREE';
    })();
    const daysRem = typeof r?.daysRemaining === 'number' ? r.daysRemaining : null;
    // SuperGrok/Heavy mà Inactive/Canceled/Expired/PastDue HOẶC hết hạn (daysRem<=0) = mất gói
    // trả phí → coi như CHẾT (→ hoàn hàng), vì shop bán SuperGrok đang ACTIVE. Unknown KHÔNG tính.
    // CHỈ dead khi status KHÔNG active (tránh hoàn nhầm acc còn Active dù date qua). Khớp
    // warranty.service (status!=active) → tool chỉ là tập con, không bắt rộng hơn service.
    const expiredPaid =
      (tier === 'SUPERGROK' || tier === 'HEAVY') &&
      !r?.error &&
      !/^active$/i.test(status) &&
      (/inactive|cancel|expired|past.?due|unpaid|incomplete|suspend/i.test(status) ||
        (typeof daysRem === 'number' && daysRem <= 0));
    // blocked = die chắc; expired/inactive paid = die về mặt SẢN PHẨM.
    // wrong_password / login_stuck = không xác minh được, KHÔNG hoàn — chuyển seller review.
    const isDead = errorType === 'blocked' || expiredPaid;

    // stillPaid: plan paid (SuperGrok/Heavy) + status Active + còn hạn (hoặc không biết hạn)
    // → warranty service sẽ tự auto-reject, không cần duyệt thủ công
    const stillPaid =
      !isDead &&
      !r?.error &&
      (tier === 'SUPERGROK' || tier === 'HEAVY') &&
      /^active$/i.test(status) &&
      (daysRem === null || daysRem > 0);

    // UI: SuperGrok/Heavy hết hạn/Inactive → hiển thị "Free" cho khách khỏi hiểu nhầm còn gói.
    // Giữ tier/plan gốc + expires/status để seller audit.
    const outTier = expiredPaid ? 'FREE' : tier;
    const outPlan = expiredPaid ? 'Free' : plan;
    process.stdout.write('JSON_RESULT:' + JSON.stringify({
      ok: !r?.error,
      tool: 'grok',
      tier: outTier,
      plan: outPlan,
      ...(expiredPaid ? { originalTier: tier, originalPlan: plan } : {}),
      status,
      expires: r?.expires || null,
      daysRemaining: daysRem,
      cancelAtEnd: r?.cancelAtEnd ?? null,
      errorType,
      error: r?.error || null,
      isDead,
      stillPaid,
    }) + '\n');
    process.exit(0);
  } catch (e) {
    process.stdout.write('JSON_RESULT:' + JSON.stringify({
      ok: false,
      tool: 'grok',
      status: 'fatal',
      error: e?.message || String(e),
    }) + '\n');
    process.exit(1);
  }
})();
