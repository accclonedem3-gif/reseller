'use strict';

const { chromium } = require('playwright');
const chalk        = require('chalk');
const figlet       = require('figlet');
const readline     = require('readline');
const fs           = require('fs');
const path         = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────

const LIVE       = 'LIVE';
const WRONG_PASS = 'WRONG_PASS';
const DIE        = 'DIE';
const TIMEOUT    = 'TIMEOUT';
// Tool không vượt được 2FA — KHÔNG có nghĩa acc die. Khách login bằng tay vẫn ok
// (họ có thiết bị OTP). Caller phải route sang seller review, không auto-replace.
const TWO_FA     = 'TWO_FA';

// LƯU Ý: keyword phải đủ ĐẶC TRƯNG. 'try again' từng được dùng cho WRONG_PASS nhưng cũng xuất hiện
// trong nhiều error khác (network, timeout) → false positive. Thay bằng keyword cụ thể hơn.
// Keyword tiếng Việt là defense-in-depth — locale đã ép en-US ở makeContext, nhưng nếu Google
// vẫn serve VI (do proxy IP region) thì vẫn detect được.
const GOOGLE_ERROR_MAP = [
  { keywords: [
      // EN
      'has been disabled', 'account has been suspended', "couldn't find your google account",
      'no account found', "account doesn't exist", 'deleted', 'deactivated',
      // VI
      'đã bị vô hiệu hóa', 'đã bị tạm ngưng', 'không tìm thấy tài khoản',
      'tài khoản không tồn tại', 'đã bị xóa',
    ], status: DIE },
  { keywords: [
      // EN
      'wrong password', 'incorrect password', 'password you entered',
      // VI
      'sai mật khẩu', 'mật khẩu không chính xác', 'mật khẩu bạn nhập',
      'mật khẩu bạn đã nhập', 'mật khẩu bạn vừa nhập',
    ], status: WRONG_PASS },
];

const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--disable-infobars', '--disable-extensions',
  '--disable-background-networking', '--disable-sync', '--no-first-run',
];

const STEALTH_SCRIPT = `(() => {
  Object.defineProperty(navigator, 'webdriver',          { get: () => undefined });
  Object.defineProperty(navigator, 'plugins',            { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, 'mimeTypes',          { get: () => [1,2,3] });
  Object.defineProperty(navigator, 'languages',          { get: () => ['en-US','en'] });
  Object.defineProperty(navigator, 'platform',           { get: () => 'Win32' });
  Object.defineProperty(navigator, 'vendor',             { get: () => 'Google Inc.' });
  Object.defineProperty(navigator, 'hardwareConcurrency',{ get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory',       { get: () => 8 });
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};
  const _p = navigator.permissions;
  if (_p) {
    const _orig = _p.query.bind(_p);
    _p.query = (p) => p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission }) : _orig(p);
  }
})();`;

// image thêm vào (2026-05-29): avatar/plan detection đọc img[src=...] theo thuộc tính,
// KHÔNG cần pixel load → chặn image an toàn, Google/Flow pages nhẹ hơn ~1-3s. Giữ
// stylesheet KHÔNG chặn (detection dựa visibility/layout DOM). Tắt: CHECK_VEO_NO_IMG_BLOCK=1.
const BLOCKED_TYPES = new Set(
  process.env.CHECK_VEO_NO_IMG_BLOCK === '1' ? ['font', 'media'] : ['font', 'media', 'image']
);

const AVATAR_SELECTORS = [
  "img[src*='googleusercontent.com']",
  "button[aria-label*='Google Account']",
  "button[aria-label*='account' i]",
  "a[aria-label*='Google Account']",
  "[data-testid='profile-button']",
  "[data-testid='user-menu']",
];

const CREDIT_PATTERNS = [
  /\d[\d,.]*\s+AI\s+[Cc]redits?/,
  /\d[\d,.]*\s+Tín\s+dụng\s+AI/i,
  /AI\s+[Cc]redits?\s*[:\-]?\s*\d[\d,.]*/i,
  /[Cc]redits?\s*[:\-]?\s*\d[\d,.]*/,
  /\d[\d,.]*\s+[Cc]redits?\s+(?:remaining|left|available)/i,
  /\d[\d,.]*\s+[Cc]redits?/,
  /(?:Ultra|Plan).{0,60}?(\d[\d,.]*)\s+[Cc]redits?/i,
];

// Tier detection — shop chỉ bán Ultra, nên chỉ phân biệt Ultra vs Free.
// Acc rớt sang Pro/Premium (gói thấp hơn) sẽ KHÔNG match Ultra → plan=null → seller review.
const PLAN_PATTERNS = [
  { name: 'Ultra',   re: /Google\s+AI\s+Ultra|AI\s+Ultra\b|\bUltra\s+plan\b|\bUltra\s+subscription\b/i },
  { name: 'Free',    re: /\bFree\s+plan\b|\bFree\s+tier\b|Gói\s+Free\b|\bBasic\s+plan\b/i },
];

// Gói trả phí — chỉ Ultra. stillPaid=true bất kể credit còn lại 0 hay không (hết quota ≠ acc die).
const PAID_PLANS = new Set(['Ultra']);

// ── Shared state ──────────────────────────────────────────────────────────────

const deadProxies = new Set();

// ── Tiny helpers ──────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Kiểm tra URL thực sự là labs.google (tránh false positive khi 'labs.google' nằm trong query param)
function isLabsGoogle(url) {
  try { return new URL(url).hostname === 'labs.google'; }
  catch { return false; }
}

// Workspace admin có thể disable từng service riêng lẻ cho organization. Google redirect
// sang `access.workspace.google.com/.../ServiceNotAllowed?application=<service>`.
//
// CỰC KỲ QUAN TRỌNG: chỉ "Flow blocked" mới đáng hoàn acc. Nếu Gmail/Drive/Calendar bị
// chặn nhưng Flow vẫn ok → acc vẫn dùng được → KHÔNG hoàn. URL pattern 2 case na ná nhau
// (cùng host `access.workspace.google.com`, cùng path `ServiceNotAllowed`), khác duy nhất
// ở query param `application`. Code cũ match bất kỳ ServiceNotAllowed → đánh DIE oan
// cho acc Gmail-blocked.
//
// Returns:
//   - 'flow'  → confirmed Flow service blocked (refund)
//   - 'other' → service khác blocked (Gmail/Drive/etc) — Flow có thể vẫn work
//   - null    → không phải workspace block
const _NON_FLOW_APPS = new Set([
  'mail', 'gmail', 'drive', 'calendar', 'docs', 'sheets', 'slides',
  'meet', 'chat', 'forms', 'sites', 'keep', 'photos', 'youtube',
]);
function classifyWorkspaceBlock(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    // labs.google/.../rejected là Flow-specific (chỉ Flow OAuth flow redirect về /rejected)
    if (u.pathname.includes('/rejected')) return 'flow';
    if (u.hostname === 'access.workspace.google.com' && u.pathname.includes('ServiceNotAllowed')) {
      const app = (u.searchParams.get('application') || '').toLowerCase().trim();
      if (_NON_FLOW_APPS.has(app)) return 'other';
      // Empty/unknown application → ARRIVED đây từ Flow nav → conservative coi là flow block.
      // (Nếu Gmail blocked, tool sẽ không tự navigate vào Gmail nên không tới đây với app=mail
      //  trừ khi Google internal redirect — case 'other' đã cover)
      return 'flow';
    }
    return null;
  } catch {
    if (/\/rejected\b/i.test(url)) return 'flow';
    if (/ServiceNotAllowed/i.test(url)) return 'flow'; // fallback conservative
    return null;
  }
}

// Backward-compat shim — code cũ vẫn gọi isWorkspaceBlocked(url)
function isWorkspaceBlocked(url) {
  return classifyWorkspaceBlock(url) === 'flow';
}

function parseGoogleError(text) {
  const t = text.toLowerCase();
  for (const { keywords, status } of GOOGLE_ERROR_MAP)
    if (keywords.some(k => t.includes(k))) return status;
  // Trước đây default = DIE → false-positive nghiêm trọng: error tiếng Việt không match keyword
  // EN → bị đánh DIE oan → reseller worker auto-refund acc còn sống. Đổi sang TIMEOUT để route
  // sang seller review thay vì auto-hoàn (an toàn hơn nhiều). API intercept ở runCheck đã bắt
  // các code chuẩn của Google (INCORRECT_ANSWER_ENTERED / DELETED_GAIA / ...) nên path này
  // chỉ là fallback cuối — chấp nhận đánh đổi: thà miss DIE còn hơn DIE oan.
  return TIMEOUT;
}

function creditNum(s) {
  if (!s) return 0;
  const m = s.match(/\d[\d,.]*/);
  return m ? (parseInt(m[0].replace(/[,.]/g, ''), 10) || 0) : 0;
}

// ── File I/O ──────────────────────────────────────────────────────────────────

function loadProxies(filepath) {
  const proxies = [];
  for (let line of fs.readFileSync(filepath, 'utf-8').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^https?:\/\/|^socks5:\/\//.test(line)) { proxies.push({ server: line }); continue; }
    const parts = line.split(':');
    if (parts.length === 2) proxies.push({ server: `socks5://${parts[0]}:${parts[1]}` });
    else if (parts.length === 4) proxies.push({ server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] });
  }
  return proxies;
}

function loadAccounts(filepath) {
  if (!fs.existsSync(filepath)) return [];
  const accounts = [];
  const ext  = path.extname(filepath).toLowerCase();
  const text = fs.readFileSync(filepath, 'utf-8');
  if (ext === '.json') {
    const data = JSON.parse(text);
    const entries = Array.isArray(data) ? data.map(i => [i.email, i.password]) : Object.entries(data);
    accounts.push(...entries);
  } else {
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const sep = line.includes('|') ? '|' : ':';
      const idx = line.indexOf(sep);
      if (idx > 0) accounts.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    }
  }
  return accounts;
}

function exportResults(results) {
  const buckets = { 'die.txt': [], 'wrong.txt': [], 'timeout.txt': [], '2fa.txt': [] };
  const creditGroups = {};

  for (const r of results) {
    if (!r) continue;
    if      (r.status === DIE)        buckets['die.txt'].push(r);
    else if (r.status === WRONG_PASS) buckets['wrong.txt'].push(r);
    else if (r.status === TIMEOUT)    buckets['timeout.txt'].push(r);
    else if (r.status === TWO_FA)     buckets['2fa.txt'].push(r);
    else if (r.status === LIVE) {
      const n   = creditNum(r.credit);
      const key = n ? `${n}_credits.txt` : 'live_no_credit.txt';
      (creditGroups[key] = creditGroups[key] || []).push(r);
    }
  }

  Object.assign(buckets, creditGroups);
  const saved = [];

  for (const [filename, rows] of Object.entries(buckets)) {
    if (!rows.length) continue;
    const flag  = filename === 'live_no_credit.txt' ? 'w' : 'a';
    const lines = rows.map(r => `${r.email}|${r.password}\n`).join('');
    fs.writeFileSync(filename, lines, { flag, encoding: 'utf-8' });
    saved.push([filename, rows.length]);
  }

  // Xóa trắng live_no_credit nếu run này không có acc nào vào đó
  if (!creditGroups['live_no_credit.txt'] && fs.existsSync('live_no_credit.txt'))
    fs.writeFileSync('live_no_credit.txt', '', 'utf-8');

  if (saved.length) {
    console.log('');
    console.log('  ' + chalk.bold('📁 Exported:'));
    for (const [fname, count] of saved)
      console.log(`    ${chalk.cyan(fname)}  ${chalk.dim(`(${count} accounts)`)}`);
  }
}

// ── UI ────────────────────────────────────────────────────────────────────────

function printBanner() {
  const art = figlet.textSync('STEWIE', { font: 'Slant' });
  console.log(chalk.bold.cyan(art));
  const bar = chalk.cyan('─'.repeat(58));
  console.log(bar);
  console.log(chalk.bold.white('  VEO 3 Credit Checker') + '  •  ' + chalk.dim('Google Flow Labs'));
  console.log(bar + '\n');
}

function printResult(r, idx, total) {
  const acct = r.email.split('@')[0];
  if (r.status === LIVE) {
    const credit = r.credit ? chalk.bold.cyan(` | ${r.credit}`) : '';
    console.log(chalk.bold.green('✅') + ' ' + chalk.white(acct) + credit);
  } else if (r.status === WRONG_PASS) {
    console.log(chalk.bold.yellow('🔑') + ' ' + chalk.dim(acct));
  } else if (r.status === TIMEOUT) {
    console.log(chalk.bold.magenta('⏱') + ' ' + chalk.dim(acct));
  } else if (r.status === TWO_FA) {
    console.log(chalk.bold.blue('🔒') + ' ' + chalk.dim(acct));
  } else {
    console.log(chalk.bold.red('❌') + ' ' + chalk.dim(acct));
  }
}

function printStats(results, runLabel = '') {
  const live    = results.filter(r => r && r.status === LIVE).length;
  const wrong   = results.filter(r => r && r.status === WRONG_PASS).length;
  const dead    = results.filter(r => r && r.status === DIE).length;
  const timeout = results.filter(r => r && r.status === TIMEOUT).length;
  const twofa   = results.filter(r => r && r.status === TWO_FA).length;
  const bar = '─'.repeat(52);
  console.log(bar);
  if (runLabel) console.log(chalk.dim(`  ${runLabel}`));
  console.log(`  ${chalk.white('Total    :')} ${chalk.bold(results.length)}`);
  console.log(`  ${chalk.green('✅ LIVE   :')} ${chalk.bold.green(live)}`);
  console.log(`  ${chalk.yellow('🔑 WRONG  :')} ${chalk.bold.yellow(wrong)}`);
  console.log(`  ${chalk.red('❌ DIE    :')} ${chalk.bold.red(dead)}`);
  console.log(`  ${chalk.magenta('⏱ TIMEOUT:')} ${chalk.bold.magenta(timeout)}`);
  console.log(`  ${chalk.blue('🔒 2FA    :')} ${chalk.bold.blue(twofa)}`);
  console.log(bar);
}

// ── Playwright core ───────────────────────────────────────────────────────────

// Per-account Google session cache. Keyed by lowercase email.
// Google sessions typically last 24-30 days; we cache for 12h as a conservative window.
//
// Persistence: previously RAM-only (Map). Now mirrored to disk so cache survives server
// restart. File-per-account under `cache/sessions/<sha1(email)>.json`. SHA1 hashes the
// email so the filename is filesystem-safe (no special chars) and doesn't directly leak
// the address in the listing. The file contents still contain the email + storage state
// (cookies, localStorage) — same sensitivity profile as RAM cache.
//
// Why this matters: first-time login for a Google account = ~25-35s of OAuth + popup +
// Flow load. Cache hit = ~10s (just goto + avatar check + intercept credit). Across server
// restart we used to lose all caches; now they persist 12h and the cache hit rate stays
// high even after PM2 / Docker restarts.
const crypto = require('node:crypto');
const SESSION_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const _sessionCache = new Map(); // email → { state: StorageState, savedAt: number }
const SESSION_CACHE_DIR = path.resolve(__dirname, 'cache', 'sessions');
const SESSION_CACHE_PERSIST = (process.env.SESSION_CACHE_PERSIST ?? '1') !== '0';

function emailHash(email) {
  return crypto.createHash('sha1').update(String(email).toLowerCase()).digest('hex');
}

function sessionCacheFile(email) {
  return path.join(SESSION_CACHE_DIR, emailHash(email) + '.json');
}

// Load all persisted cache entries on module init. Skip expired entries — they'd just
// be re-deleted on first access anyway, and removing them now keeps the disk tidy.
function _loadPersistedCache() {
  if (!SESSION_CACHE_PERSIST) return;
  try {
    if (!fs.existsSync(SESSION_CACHE_DIR)) {
      fs.mkdirSync(SESSION_CACHE_DIR, { recursive: true });
      return;
    }
    const files = fs.readdirSync(SESSION_CACHE_DIR).filter((f) => f.endsWith('.json'));
    let loaded = 0, expired = 0;
    for (const f of files) {
      const full = path.join(SESSION_CACHE_DIR, f);
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!data?.email || !data?.state || !data?.savedAt) {
          fs.unlinkSync(full);
          continue;
        }
        if (Date.now() - data.savedAt > SESSION_CACHE_TTL_MS) {
          fs.unlinkSync(full);
          expired++;
          continue;
        }
        _sessionCache.set(data.email.toLowerCase(), { state: data.state, savedAt: data.savedAt });
        loaded++;
      } catch {
        try { fs.unlinkSync(full); } catch {}
      }
    }
    if (loaded || expired) {
      console.log(`[veo:session-cache] loaded ${loaded} entries, purged ${expired} expired from ${SESSION_CACHE_DIR}`);
    }
  } catch (e) {
    console.warn(`[veo:session-cache] persist load failed: ${e?.message || e}`);
  }
}
_loadPersistedCache();

function sessionCacheGet(email) {
  const entry = _sessionCache.get(email.toLowerCase());
  if (!entry) return null;
  if (Date.now() - entry.savedAt > SESSION_CACHE_TTL_MS) {
    sessionCacheDel(email);
    return null;
  }
  return entry.state;
}

function sessionCacheSet(email, state) {
  const lower = email.toLowerCase();
  const savedAt = Date.now();
  _sessionCache.set(lower, { state, savedAt });
  if (SESSION_CACHE_PERSIST) {
    try {
      if (!fs.existsSync(SESSION_CACHE_DIR)) fs.mkdirSync(SESSION_CACHE_DIR, { recursive: true });
      // Atomic write: write to .tmp first then rename, so a crash mid-write doesn't leave
      // a half-written JSON that breaks the next load.
      const tmp = sessionCacheFile(email) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ email: lower, state, savedAt }), 'utf8');
      fs.renameSync(tmp, sessionCacheFile(email));
    } catch (e) {
      console.warn(`[veo:session-cache] persist save failed for ${lower}: ${e?.message || e}`);
    }
  }
}

function sessionCacheDel(email) {
  const lower = email.toLowerCase();
  _sessionCache.delete(lower);
  if (SESSION_CACHE_PERSIST) {
    try { fs.unlinkSync(sessionCacheFile(email)); } catch {}
  }
}

async function makeContext(browser, proxy = null, storageState = null) {
  // Ép locale en-US: Google login serve UI tiếng Anh → error message khớp keyword tiếng Anh
  // trong GOOGLE_ERROR_MAP. Tránh case Vietnamese UI fall-through xuống default DIE.
  const opts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  };
  if (proxy && !deadProxies.has(proxy.server)) opts.proxy = proxy;
  if (storageState) opts.storageState = storageState;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(STEALTH_SCRIPT);
  return ctx;
}

async function getPageError(page, timeout = 1000) {
  for (const sel of ["div[jsname='B34EJ']", "span[jsname='LXRPh']", "div[aria-live='assertive']",
                      '[data-error-code]', 'div.Ekjuhf', 'div.dEOOab']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout })) {
        const txt = (await el.innerText()).trim();
        if (txt) return txt;
      }
    } catch {}
  }
  return null;
}

// Đợi outcome sau khi submit email/password. Poll 3 nguồn song song để return SỚM NHẤT có thể:
//   1. page.__authStatus  → API intercept đã bắt code Google (INCORRECT_ANSWER_ENTERED, ...)
//      → ưu tiên cao nhất, language-agnostic, return trong ~200-500ms sau response
//   2. URL changed away  → login thành công, chuyển bước tiếp theo → return { advance: true }
//   3. DOM error visible CHÍNH XÁC → fallback khi intercept miss (Google đổi response format)
// Quan trọng: DOM error chỉ return khi parseGoogleError ra status DEFINITIVE (WRONG_PASS/DIE).
// Nếu DOM error visible nhưng parseGoogleError = TIMEOUT (keyword không match) → KEEP POLLING,
// đừng return TIMEOUT sớm — acc đổi pass thường có hint "password was changed N days ago"
// không match keyword nào, nhưng API intercept sẽ catch INCORRECT_ANSWER_ENTERED trong 1-2s.
async function waitForAuthOutcome(page, stayOnStepFn, maxMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    // 1. API intercept
    if (page.__authStatus) {
      return { error: { status: page.__authStatus, detail: page.__authDetail || 'API intercept' } };
    }
    // 2. URL đã chuyển bước
    if (!stayOnStepFn(page.url())) return { advance: true };
    // 3. DOM error (quick check — 200ms timeout)
    const err = await getPageError(page, 200);
    if (err) {
      // Re-check intercept (có thể đã set trong lúc check DOM)
      if (page.__authStatus) {
        return { error: { status: page.__authStatus, detail: page.__authDetail } };
      }
      const parsedStatus = parseGoogleError(err);
      // Chỉ return nếu definitive. TIMEOUT default = "không nhận diện được" → tiếp tục poll
      // chờ intercept thay vì bail out sớm với TIMEOUT (sẽ làm acc sai pass bị xếp nhầm).
      if (parsedStatus === WRONG_PASS || parsedStatus === DIE) {
        return { error: { status: parsedStatus, detail: err } };
      }
    }
    await sleep(150);
  }
  // Timeout: final check intercept (response có thể vừa đến)
  if (page.__authStatus) {
    return { error: { status: page.__authStatus, detail: page.__authDetail } };
  }
  // Fallback an toàn: thấy error-frame sau submit pass + VẪN kẹt ở bước này (acc tốt đã
  // advance khỏi đây) → kết luận WRONG_PASS thay vì timeout mù → nhanh + đúng bucket.
  if (page.__authErrorFrame && stayOnStepFn(page.url())) {
    return { error: { status: WRONG_PASS, detail: 'rpc_error_frame (no wrb.fr, kẹt ở bước auth)' } };
  }
  return { timeout: true };
}

// ⚠️ DEPRECATED / DEAD CODE (#22): the live path is enterFlowApp(). doGoogleLogin + loginFlow are
// no longer called by checkAccount/runCheck. Kept only for reference. Their verdicts have been
// made money-SAFE (no bare DIE → no auto-refund) so an accidental reactivation can't wrongly
// refund a live account. Do NOT re-wire these into the flow without re-validating every verdict.
async function doGoogleLogin(page, email, password) {
  try { await page.waitForSelector("input[type='email']", { timeout: 8000 }); }
  catch { return [LIVE, null]; }

  await page.click("input[type='email']");
  await sleep(300);
  await page.type("input[type='email']", email, { delay: 45 });
  await sleep(400);
  await page.getByRole('button', { name: 'Next' }).click();

  try { await page.waitForSelector("input[type='password']", { timeout: 12000 }); }
  catch {
    const err = await getPageError(page);
    // #22: "cannot reach password step" is NOT proof the account is dead (network/CF/redirect) →
    // TIMEOUT (seller review), never DIE (which would auto-refund).
    return err ? [parseGoogleError(err), err] : [TIMEOUT, 'Cannot reach password step'];
  }

  await sleep(500);
  await page.click("input[type='password']");
  await sleep(300);
  await page.type("input[type='password']", password, { delay: 40 });
  await sleep(400);
  await page.getByRole('button', { name: 'Next' }).click();
  page.__pwSubmitted = true;
  return [LIVE, null];
}

async function loginFlow(page, email, password) {
  const signInSels = [
    "a:has-text('Sign in')", "button:has-text('Sign in')",
    "a:has-text('Sign In')", "button:has-text('Sign In')",
    "a:has-text('Log in')",  "a[href*='signin']", "a[href*='accounts.google']",
  ];

  let clicked = false;
  for (const sel of signInSels) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) { await el.click(); clicked = true; break; }
    } catch {}
  }
  // Nếu không tìm thấy Sign in → navigate thẳng, kèm continue URL để sau login redirect về Flow
  if (!clicked) {
    const cont = encodeURIComponent('https://labs.google/fx/en/tools/flow');
    await page.goto(
      `https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&continue=${cont}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
  }

  try { await page.waitForURL('**/accounts.google**', { timeout: 10000 }); }
  catch { return [LIVE, null]; }

  const [status, msg] = await doGoogleLogin(page, email, password);
  if (status !== LIVE) return [status, msg];

  // Poll post-login — xử lý mọi trang trung gian của Google
  const deadline = 40000;
  const start    = Date.now();
  while (Date.now() - start < deadline) {
    await sleep(600);
    const url = page.url();

    // Account bị Google khóa → DIE ngay (khỏi loop tới deadline). Xem chú thích ở enterFlowApp.
    if (/speedbump\/disabled|\/disabled\/explanation/i.test(url)) {
      return [DIE, `account_disabled (speedbump): ${url.slice(0, 120)}`];
    }

    if (isLabsGoogle(url)) return [LIVE, null];

    if (url.includes('challenge/pwd')) {
      // Google yêu cầu nhập lại password (không phải 2FA)
      await sleep(1000);
      try {
        const pwd = page.locator("input[type='password']").first();
        if (await pwd.isVisible({ timeout: 3000 })) {
          await pwd.fill('');
          await pwd.type(password, { delay: 40 });
          await sleep(400);
          await page.getByRole('button', { name: 'Next' }).click();
          // Chờ URL rời khỏi challenge/pwd (tối đa 15s) thay vì hardcode sleep
          try { await page.waitForURL(u => !u.toString().includes('challenge/pwd'), { timeout: 15000 }); } catch {}
        }
      } catch {}
      continue;
    }

    if (['twosv', 'signinchallenge'].some(k => url.includes(k))) {
      await sleep(1500);
      const hasOtp = await page.locator(
        'input[type="tel"], input[type="number"], input[aria-label*="code" i]'
      ).first().isVisible({ timeout: 800 }).catch(() => false);
      if (hasOtp) return [TWO_FA, '2FA required']; // #22: 2FA ≠ dead → TWO_FA (review), not DIE
      for (const name of ['Yes', "Yes, it's me", 'Confirm', 'Continue', 'OK', 'Next', 'Skip']) {
        try {
          const btn = page.getByRole('button', { name, exact: false }).first();
          await btn.click({ force: true, timeout: 1200 });
          await sleep(2000);
          break;
        } catch {}
      }
      continue;
    }

    // Bị redirect vào trang tạo tài khoản — navigate về login (với continue param)
    if (url.includes('signup') || url.includes('CreateAccount') || url.includes('lifecycle/steps')) {
      const cont = encodeURIComponent('https://labs.google/fx/en/tools/flow');
      await page.goto(`https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&continue=${cont}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      continue;
    }

    // Account picker
    if (url.includes('accountchooser') || url.includes('/b/0/')) {
      try {
        const el = page.locator(`[data-email='${email}'], div[data-identifier='${email}']`).first();
        if (await el.isVisible({ timeout: 2000 })) { await el.click(); continue; }
      } catch {}
    }

    // Trang đăng nhập bình thường (email/password input) — KHÔNG phải trang trung gian
    // Xuất hiện khi OAuth flow yêu cầu xác thực lại → tự đăng nhập lại
    if (url.includes('accounts.google.com') && url.includes('identifier')) {
      const emailInput = page.locator("input[type='email']").first();
      const hasEmail = await emailInput.isVisible({ timeout: 1500 }).catch(() => false);
      if (hasEmail) {
        await doGoogleLogin(page, email, password);
      }
      continue;
    }

    // Welcome / Terms / ManageAccount / myaccount / workspacetermsofservice
    // Bao gồm cả myaccount.google.com — KHÔNG return LIVE ngay, phải xử lý Welcome/Terms trước
    const isIntermediate =
      (url.includes('accounts.google.com') || url.includes('myaccount.google.com')) &&
      !['challenge/pwd', 'twosv', 'signinchallenge', 'identifier'].some(k => url.includes(k));

    if (isIntermediate) {
      await sleep(1500);

      // 1. Playwright force click — bypass visibility + enabled (thử cả button lẫn link)
      const ACCEPT = ['I understand','I Agree','I Accept','Accept','Agree','Continue','Next','Confirm','OK','Got it'];
      let dismissed = false;
      outer: for (const name of ACCEPT) {
        for (const role of ['button', 'link']) {
          try {
            const btn = page.getByRole(role, { name, exact: false }).first();
            await btn.click({ force: true, timeout: 1500 });
            dismissed = true;
            break outer;
          } catch {}
        }
      }

      // 2. Click nút cuối cùng trên trang (thường là Accept/OK)
      if (!dismissed) {
        try {
          await page.locator('button').last().click({ force: true, timeout: 2000 });
          dismissed = true;
        } catch {}
      }

      // 3. JS fallback với scroll — cuộn xuống cuối rồi tìm nút Accept/Continue
      if (!dismissed) {
        try {
          await page.evaluate(() => {
            document.documentElement.scrollTop = 999999;
            document.body.scrollTop = 999999;
            const kw = ['i understand','i agree','i accept','accept','agree','continue','next','confirm','ok','got it'];
            const btn = [...document.querySelectorAll('button,[role="button"],a,input[type="submit"]')]
              .find(e => kw.some(k => e.textContent.trim().toLowerCase().startsWith(k)));
            if (btn) { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); btn.click(); }
          });
        } catch {}
      }

      await sleep(1500);

      // Nếu vẫn còn trên myaccount.google.com (không dismiss được gì) → navigate thẳng sang flow
      if (page.url().includes('myaccount.google.com')) {
        try {
          await page.goto('https://labs.google/fx/en/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch {}
      }

      continue;  // Luôn continue — chỉ return LIVE khi poll loop thấy labs.google/flow
    }

    const err = await getPageError(page);
    if (err) return [parseGoogleError(err), err];
  }

  return [TIMEOUT, `Post-login timeout (url: ${page.url()})`];
}

async function scrollPopupToBottom(page) {
  try {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*'))
        if (el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 30) el.scrollTop = el.scrollHeight;
    });
  } catch {}
  await sleep(500);
}

async function dismissPopups(page) {
  // Chỉ dùng tên nút an toàn — loại bỏ 'Create', 'Get started', 'Try it' vì có thể trigger navigation
  const names = ['Next','Continue','Accept','Got it','OK'];
  const startUrl = page.url();
  for (let round = 0; round < 4; round++) {
    let dismissed = false;
    for (const name of names) {
      try {
        const btn = page.getByRole('button', { name }).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await scrollPopupToBottom(page);
          for (let i = 0; i < 6; i++) { if (await btn.isEnabled()) break; await sleep(300); }
          await btn.click();
          await sleep(700);
          // Nếu bị navigate ra khỏi domain ban đầu thì dừng
          if (!isLabsGoogle(page.url())) return;
          dismissed = true;
          break;
        }
      } catch {}
    }
    if (!dismissed) break;
  }
}

async function clickAvatar(page, timeout = 800) {
  for (const sel of AVATAR_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout })) { await el.click(); return true; }
    } catch {}
  }

  // JS fallback — tìm element góc trên phải (avatar text-initial của Flow Labs)
  const result = await page.evaluate(() => {
    // Ưu tiên Google profile photo (luôn serve từ googleusercontent.com)
    const profileImg = [...document.querySelectorAll('img')].find(i => i.src && i.src.includes('googleusercontent.com'));
    if (profileImg) {
      const r = profileImg.getBoundingClientRect();
      if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2, found: true };
    }
    // Fallback: element nhỏ góc trên phải (initial avatar)
    const cands = [...document.querySelectorAll('button,[role="button"],a')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.right > window.innerWidth - 150 && r.top < 80 && r.width >= 24 && r.width <= 80 && r.height >= 24 && r.height <= 80;
    });
    const target = cands.find(el => { const t = (el.textContent||'').trim(); return t.length >= 1 && t.length <= 2; });
    if (target) { const r = target.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, found: true }; }
    return { found: false };
  }).catch(() => ({ found: false }));
  if (result && result.found) { await page.mouse.click(result.x, result.y); return true; }

  // Last resort: tọa độ cố định góc trên phải
  const vp = page.viewportSize();
  if (vp) { await page.mouse.click(vp.width - 45, 38); return true; }
  return false;
}

async function extractCredit(page) {
  let body;
  try { body = await page.locator('body').innerText(); } catch { return null; }

  // Quét từng dòng — bỏ qua dòng promo ("Receive N credits", "Get N credits", v.v.)
  for (const line of body.split('\n')) {
    const l = line.trim();
    if (!l || /^(?:receive|get|earn)\b/i.test(l)) continue;
    for (const pat of CREDIT_PATTERNS) {
      const m = l.match(pat);
      if (m) return (m[1] ? `${m[1]} credits` : m[0]).trim();
    }
  }

  return null;
}

// Quét body cho keyword gói (Ultra/Pro/Premium/Free). Bỏ qua line promo ("Upgrade to Ultra",
// "Try Pro free", ...) vì những line này KHÔNG phản ánh gói hiện tại của acc.
async function extractPlan(page) {
  let body;
  try { body = await page.locator('body').innerText(); } catch { return null; }
  const PROMO_RE = /\b(upgrade|try|get|start|switch|join|subscribe|buy|purchase)\b/i;
  for (const line of body.split('\n')) {
    const l = line.trim();
    if (!l || PROMO_RE.test(l)) continue;
    for (const { name, re } of PLAN_PATTERNS) {
      if (re.test(l)) return name;
    }
  }
  return null;
}

async function handleLabsOnboarding(page) {
  // Xử lý tối đa 4 popup onboarding của labs.google (Tiếp theo / Next / Continue)
  // Popup 2 đặc biệt: nút bị disabled cho đến khi scroll xuống hết TOS
  for (let round = 0; round < 4; round++) {
    await sleep(1000);
    if (!isLabsGoogle(page.url())) break;

    // Scroll tất cả vùng có thể scroll trong popup
    try {
      await page.evaluate(() => {
        document.documentElement.scrollTop = 999999;
        document.body.scrollTop = 999999;
        for (const el of document.querySelectorAll('*')) {
          if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 30)
            el.scrollTop = el.scrollHeight;
        }
      });
    } catch {}
    await sleep(600);

    let clicked = false;
    for (const name of ['Tiếp theo', 'Next', 'Continue', 'OK', 'Got it', 'Accept', 'Agree']) {
      try {
        const btn = page.getByRole('button', { name, exact: false }).first();
        if (!await btn.isVisible({ timeout: 800 })) continue;
        // Chờ nút enabled (tối đa 5s — nút chờ scroll xong mới sáng)
        for (let i = 0; i < 10; i++) {
          if (await btn.isEnabled()) break;
          await sleep(500);
        }
        await btn.click();
        clicked = true;
        break;
      } catch {}
    }
    if (!clicked) break;
  }
}

// 2FA / extra verification challenge URLs. Khi acc bật 2-step verification, OAuth redirect
// vào 1 trong các path này + render input nhập mã. Tool không có cách qua → trả DIE.
function isTwoFactorUrl(url) {
  return /twosv|signinchallenge|challenge\/(?:az|ipp|totp|skotp|sms|dp|kpe|ka)\b/i.test(url || '');
}

/**
 * Return shape:
 *   { ok: true }                       — đã vô được Flow
 *   { ok: false, status, detail }      — phát hiện chính xác (DIE/WRONG_PASS)
 *   { ok: false }                      — chưa xác định (caller treat as TIMEOUT)
 */
async function enterFlowApp(page, email, password) {
  // Đợi trang React hydrate xong trước khi tìm nút (domcontentloaded không đủ)
  try { await page.waitForLoadState('load', { timeout: 10000 }); } catch {}
  await sleep(300);

  // Click "Create with Flow" — OR selector + 12s timeout (trang còn đang render)
  let clicked = false;
  try {
    const el = page.locator(
      "button:has-text('Create with Flow'), a:has-text('Create with Flow'), " +
      "button:has-text('Tạo với Flow'), a:has-text('Tạo với Flow')"
    ).first();
    if (await el.isVisible({ timeout: 8000 })) { await el.click(); clicked = true; }
  } catch {}

  // Fallback: getByRole (cover trường hợp text locale khác)
  if (!clicked) {
    for (const name of ['Create with Flow', 'Tạo với Flow', 'Create', 'Get started', 'Bắt đầu']) {
      try {
        for (const role of ['button', 'link']) {
          const btn = page.getByRole(role, { name, exact: false }).first();
          if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); clicked = true; break; }
        }
      } catch {}
      if (clicked) break;
    }
  }

  if (!clicked) {
    return { ok: false };
  }


  // Poll loop xử lý OAuth redirect + Terms + về labs.google (có thể có OAuth round 2 sau onboarding)
  // Poll 450ms — đủ buffer cho Google redirect (~500-800ms/hop), nhanh hơn 700ms cũ.
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline) {
    await sleep(450);

    // API intercept đã bắt được status auth từ Google batchexecute response → return ngay,
    // không cần đợi DOM render error. Language-agnostic, nhanh hơn getPageError() 1-2s.
    if (page.__authStatus) {
      return { ok: false, status: page.__authStatus, detail: page.__authDetail || 'API intercept' };
    }

    const url = page.url();

    // Account bị Google KHÓA → redirect tới /signin/speedbump/disabled/explanation. Bắt NGAY
    // → DIE (account_disabled) thay vì loop tới deadline 70s. (Trước: không nhận ra URL này →
    // chạy mò ~84s rồi TIMEOUT sai → đẩy seller review thay vì auto-hoàn.)
    if (/speedbump\/disabled|\/disabled\/explanation/i.test(url)) {
      return { ok: false, status: DIE, reason: 'account_disabled', detail: `Google đã khóa tài khoản (speedbump): ${url.slice(0, 120)}` };
    }

    // Đã về labs.google → xử lý onboarding popups
    if (isLabsGoogle(url)) {
      await handleLabsOnboarding(page);
      // Workspace TOS popup 2 có thể kick OAuth round 2 → nếu vẫn trên labs.google thì xong
      if (isLabsGoogle(page.url())) return { ok: true };
      // Không return — để poll loop tiếp tục xử lý OAuth round 2
      continue;
    }

    // Workspace admin block — URL có thể là access.workspace.google.com (KHÔNG chứa accounts.google.com)
    // nên check trước guard "must be accounts.google.com" bên dưới.
    const blockKind = classifyWorkspaceBlock(url);
    if (blockKind === 'flow') {
      return { ok: false, status: DIE, reason: 'flow_blocked', detail: `Flow blocked: ${url.slice(0, 100)}` };
    }
    if (blockKind === 'other') {
      // Gmail/Drive/etc blocked — Flow có thể vẫn work. Navigate thẳng vào Flow Labs để verify.
      // Nếu Flow load OK → poll loop sẽ thấy labs.google → LIVE.
      // Nếu Flow ALSO redirect về ServiceNotAllowed/flow → vòng sau classifyWorkspaceBlock='flow' → DIE.
      try {
        await page.goto('https://labs.google/fx/en/tools/flow', { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch {}
      continue;
    }

    // 2FA / challenge step — acc bật xác thực 2 yếu tố, tool không vượt qua được.
    if (isTwoFactorUrl(url)) {
      await sleep(1200);
      const hasOtp = await page.locator(
        'input[type="tel"], input[type="number"], input[aria-label*="code" i], input[aria-label*="mã" i], input[name*="totpPin" i]',
      ).first().isVisible({ timeout: 1500 }).catch(() => false);
      if (hasOtp) return { ok: false, status: TWO_FA, detail: '2FA required' };
      // Recovery prompt / "Confirm it's you" — thử dismiss bằng Yes/Continue/Skip
      for (const name of ['Yes', "Yes, it's me", 'Confirm', 'Continue', 'OK', 'Next', 'Skip']) {
        try {
          await page.getByRole('button', { name, exact: false }).first().click({ force: true, timeout: 1000 });
          await sleep(1500);
          break;
        } catch {}
      }
      continue;
    }

    if (!url.includes('accounts.google.com')) continue;

    // --- Đang trên accounts.google.com ---

    // OAuth/GeneralOAuthFlow: cần điền email
    const emailInput = page.locator("input[type='email']").first();
    if (await emailInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await emailInput.fill('');
      await emailInput.type(email, { delay: 45 });
      await sleep(300);
      try { await page.getByRole('button', { name: 'Next' }).click(); } catch {}

      // Sau khi submit email: poll outcome. Acc die / email không tồn tại hiện error ngay tại đây
      // (không bao giờ render password). Stay-on-step = URL còn chứa 'identifier' hoặc 'lookup'.
      const outcome = await waitForAuthOutcome(
        page,
        u => u.includes('identifier') || u.includes('lookup'),
        10000,
      );
      if (outcome.error) return { ok: false, status: outcome.error.status, detail: outcome.error.detail };
      // URL đã chuyển bước (advance) hoặc timeout → đợi password field render
      try { await page.waitForSelector("input[type='password']", { timeout: 8000 }); } catch {}
      continue;
    }

    // Cần điền password
    const pwdInput = page.locator("input[type='password']").first();
    if (await pwdInput.isVisible({ timeout: 1500 }).catch(() => false)) {
      await pwdInput.fill('');
      await pwdInput.type(password, { delay: 40 });
      await sleep(400);
      try { await page.getByRole('button', { name: 'Next' }).click(); } catch {}
      page.__pwSubmitted = true;

      // Poll outcome song song (intercept / URL change / DOM error) thay vì block waitForURL 12s.
      // Sai pass: intercept thường catch trong 1-2s. URL change: login OK.
      const outcome = await waitForAuthOutcome(
        page,
        u => u.includes('challenge/pwd') || u.includes('signin/v2/challenge'),
        12000,
      );
      if (outcome.error) return { ok: false, status: outcome.error.status, detail: outcome.error.detail };
      // advance hoặc timeout → continue poll loop bên ngoài xử lý tiếp
      continue;
    }

    // workspacetermsofservice hoặc trang Terms/Welcome khác → click I understand / Accept
    await sleep(2000);
    let dismissed = false;
    for (const name of ['I understand', 'I Agree', 'I Accept', 'Accept', 'Agree', 'Continue', 'OK']) {
      for (const role of ['button', 'link']) {
        try {
          const btn = page.getByRole(role, { name, exact: false }).first();
          await btn.click({ force: true, timeout: 1500 });
          dismissed = true;
          break;
        } catch {}
      }
      if (dismissed) break;
    }
    if (!dismissed) {
      // JS fallback: scroll xuống cuối rồi click nút Terms
      try {
        await page.evaluate(() => {
          document.documentElement.scrollTop = 999999;
          document.body.scrollTop = 999999;
          const kw = ['i understand','i agree','i accept','accept','agree','continue','ok'];
          const btn = [...document.querySelectorAll('button,[role="button"],a,input[type="submit"]')]
            .find(e => kw.some(k => e.textContent.trim().toLowerCase().startsWith(k)));
          if (btn) { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); btn.click(); }
        });
      } catch {}
    }
  }

  return { ok: isLabsGoogle(page.url()) };
}

// Mở popup avatar 1 lần, đọc CẢ credit + plan trong cùng frame mở. Plan name chỉ xuất hiện
// trong popup (không phải dashboard body), nên phải mở popup dù credit đã có từ API intercept.
// Return { credit, plan } — mỗi cái có thể null độc lập.
async function getAccountInfo(page, emailPrefix = '') {
  if (!isLabsGoogle(page.url())) return { credit: null, plan: null };

  try { await page.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
  await sleep(500);

  await dismissPopups(page);
  if (!isLabsGoogle(page.url())) return { credit: null, plan: null };

  let credit = null;
  let plan = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let clicked = await clickAvatar(page, attempt === 0 ? 1500 : 2500);
    if (!clicked) {
      await dismissPopups(page);
      await sleep(400);
      clicked = await clickAvatar(page, 2500);
      if (!clicked) continue;
    }

    // Popup avatar render fast (~1s). Lần đầu chờ 1200ms, các lần sau thêm buffer.
    await sleep(attempt === 0 ? 1200 : 2500);

    // Trong khi popup đang mở: thử cả 2. Plan có thể detect được ngay cả khi credit chưa render
    // (popup load incrementally).
    if (!plan) plan = await extractPlan(page);
    if (!credit) credit = await extractCredit(page);
    if (credit && plan) {
      try { await page.keyboard.press('Escape'); } catch {}
      return { credit, plan };
    }

    try { await page.keyboard.press('Escape'); } catch {}
    await sleep(800);
  }
  return { credit, plan };
}

// ── Check logic ───────────────────────────────────────────────────────────────

async function runCheck(browser, email, password, proxy = null) {
  const cachedSession = sessionCacheGet(email);
  const ctx  = await makeContext(
    browser,
    proxy && !deadProxies.has(proxy.server) ? proxy : null,
    cachedSession,
  );
  const page = await ctx.newPage();

  // Intercept API responses — bắt credit data + auth status trực tiếp từ network thay vì đọc DOM
  let interceptedCredit = null;
  // Auth status từ Google batchexecute response. Language-agnostic (không lo locale tiếng Việt).
  //   WRONG_PASS → INCORRECT_ANSWER_ENTERED
  //   DIE        → DELETED_GAIA / DISABLED_GAIA / SUSPENDED_GAIA / ACCOUNT_DISABLED / ACCOUNT_NOT_FOUND
  //   TWO_FA     → SECOND_FACTOR_REQUIRED / RESPONSE_TYPE_REAUTH_PROMPT / TOTP_VERIFICATION
  // Attach lên page để enterFlowApp poll loop đọc được (early return sớm hơn DOM polling).
  page.__authStatus = null;
  page.__authDetail = null;
  page.__pwSubmitted = false;   // bật sau khi click Next ở bước password (arm error-frame fallback)
  page.__authErrorFrame = false; // thấy error-frame batchexecute sau submit pass (không có wrb.fr)
  const DEBUG_INTERCEPT = !!process.env.CHECK_DEBUG_INTERCEPT;
  page.on('response', async (res) => {
    try {
      const url = res.url();

      // Google auth endpoint — phát hiện wrong pass / acc die sớm bằng code chuẩn của Google.
      // URL pattern broaden: bắt cả `/_/AccountsSignInUi/data/batchexecute`, `/_/signin/...`,
      // `/v3/signin/_/...` để không miss case Google đổi path internal.
      // Broaden: thêm /v3/signin, /signin/v2, challenge để không miss khi Google đổi path.
      const isAuthEndpoint = url.includes('accounts.google.com') && (
        url.includes('batchexecute') ||
        url.includes('/signin') ||
        url.includes('/_/lookup/') ||
        url.includes('challenge') ||
        url.includes('AccountsSignInUi')
      );
      if (isAuthEndpoint) {
        const text = await res.text().catch(() => '');
        if (!text) return;
        if (DEBUG_INTERCEPT) {
          // Log 200 ký tự đầu để debug khi cần (set env CHECK_DEBUG_INTERCEPT=1)
          console.log(`[intercept] ${url.slice(0, 80)} → ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
        }
        if (/INCORRECT_ANSWER_ENTERED/i.test(text)) {
          page.__authStatus = WRONG_PASS;
          page.__authDetail = 'INCORRECT_ANSWER_ENTERED';
        } else if (/DELETED_GAIA|DISABLED_GAIA|SUSPENDED_GAIA|ACCOUNT_DISABLED|ACCOUNT_NOT_FOUND/i.test(text)) {
          page.__authStatus = DIE;
          const m = text.match(/DELETED_GAIA|DISABLED_GAIA|SUSPENDED_GAIA|ACCOUNT_DISABLED|ACCOUNT_NOT_FOUND/i);
          page.__authDetail = m ? m[0] : 'account_disabled';
        } else if (/SECOND_FACTOR|TOTP_VERIFICATION|SMS_OTP|REAUTH_PROMPT/i.test(text)) {
          page.__authStatus = TWO_FA;
          page.__authDetail = '2FA required (intercepted)';
        } else if (page.__pwSubmitted && !page.__authStatus &&
                   (url.includes('/signin') || url.includes('AccountsSignInUi') || url.includes('/_/lookup/')) &&
                   /\)\]\}'/.test(text) && /\[\s*"e"\s*,/.test(text) && !text.includes('wrb.fr')) {
          // Error-frame batchexecute SAU khi submit pass + KHÔNG có data frame (wrb.fr) →
          // dấu hiệu auth fail (Google trả dạng nén [["e",N,...]] thay vì chuỗi rõ ràng,
          // vd `[["e",4,null,null,92]]`). #14: CHỈ tính khi URL thuộc luồng sign-in
          // (signin / AccountsSignInUi / lookup) — KHÔNG phải mọi batchexecute trên
          // accounts.google.com (account chooser, telemetry… cũng dùng batchexecute và có thể
          // trả error frame của RPC phụ → tránh false wrong_pass). KHÔNG set __authStatus ngay
          // (sợ giết acc tốt nếu là sub-RPC lỗi vặt) → chỉ đánh dấu; waitForAuthOutcome dùng làm
          // fallback CHỈ khi vẫn kẹt ở bước pass lúc timeout (acc tốt đã advance khỏi đây → không dính).
          page.__authErrorFrame = true;
        }
        return;
      }

      if (!url.includes('labs.google') && !url.includes('generativelanguage') && !url.includes('googleapis')) return;
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const data = await res.json().catch(() => null);
      if (!data) return;
      const str = JSON.stringify(data);
      for (const pat of CREDIT_PATTERNS) {
        const m = str.match(pat);
        if (m) { interceptedCredit = (m[1] ? `${m[1]} credits` : m[0]).replace(/"/g, '').trim(); return; }
      }
      // Tìm field credit/balance trong JSON
      const keys = ['credits', 'credit', 'balance', 'remaining', 'quota'];
      for (const k of keys) {
        const km = str.match(new RegExp(`"${k}"\\s*:\\s*(\\d+)`));
        if (km && +km[1] > 0) { interceptedCredit = `${km[1]} credits`; return; }
      }
    } catch {}
  });

  await page.route('**/*', route =>
    BLOCKED_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue()
  );
  const navTimeout = proxy ? 35000 : 30000;

  try {
    try {
      await page.goto('https://labs.google/fx/en/tools/flow', { waitUntil: 'domcontentloaded', timeout: navTimeout });
    } catch (e) {
      const s = e.message.toLowerCase();
      if (s.includes('interrupted') || s.includes('setsid')) {
        await sleep(2000);
        if (!isLabsGoogle(page.url()))
          await page.goto('https://labs.google/fx/en/tools/flow', { waitUntil: 'domcontentloaded', timeout: navTimeout });
      } else if (s.includes('timeout')) {
        return { email, password, status: TIMEOUT, credit: null, detail: 'Navigation timeout' };
      } else throw e;
    }

    // Kiểm tra đã login vào Flow Labs chưa (avatar hiện = đã có session)
    let alreadyInApp = false;
    if (isLabsGoogle(page.url())) {
      try {
        const av = page.locator("img[referrerpolicy='no-referrer'], button[aria-label*='Google Account']").first();
        alreadyInApp = await av.isVisible({ timeout: 3000 });
      } catch {}
    }
    // Nếu đã load cached session nhưng vẫn không vào được Flow → session expired, xóa cache
    if (!alreadyInApp && cachedSession) sessionCacheDel(email);

    const ep = email.split('@')[0];
    let status = LIVE, errMsg = null, reason = null;

    if (!alreadyInApp) {
      // Chưa login → enterFlowApp xử lý toàn bộ: click "Create with Flow" → OAuth → Terms → Popup
      // Return: { ok: true } | { ok: false, status, reason?, detail } | { ok: false }
      const entered = await enterFlowApp(page, email, password);
      const finalUrl = page.url();
      if (entered && entered.ok) {
        // Vào được Flow → giữ status=LIVE, sẽ extract credit/plan ở bước kế.
      } else if (entered && entered.status) {
        // enterFlowApp xác định chính xác (DIE / WRONG_PASS / TWO_FA, có thể kèm reason)
        status = entered.status;
        errMsg = entered.detail || null;
        reason = entered.reason || null;
      } else if (classifyWorkspaceBlock(finalUrl) === 'flow') {
        // Safety net: enterFlowApp có thể đã return false trước khi check workspace block
        status = DIE;
        reason = 'flow_blocked';
        errMsg = `Flow blocked by Workspace admin — url: ${finalUrl.slice(0, 100)}`;
      } else if (page.__authStatus) {
        // Fallback từ API intercept — race condition: poll loop trong enterFlowApp đã kết thúc
        // trước khi response batchexecute parse xong. Lấy status từ intercept thay vì TIMEOUT.
        status = page.__authStatus;
        errMsg = page.__authDetail || null;
      } else {
        status = TIMEOUT;
        errMsg = `OAuth/auth failed (url: ${finalUrl.slice(0, 80)})`;
      }
    }

    let credit = null;
    let plan = null;
    if (status === LIVE) {
      await sleep(800);
      // Luôn mở popup avatar để đọc plan name (API intercept không trả tên gói).
      // Trong cùng popup cũng scrape credit làm fallback nếu intercept không bắt được.
      const info = await getAccountInfo(page, ep);
      credit = interceptedCredit || info.credit;
      plan = info.plan;
      if (!credit) try { await page.screenshot({ path: `debug_${ep}.png` }); } catch {}

      // Save Google session so the next check for this account skips login entirely.
      try {
        const state = await ctx.storageState();
        if (state && state.cookies && state.cookies.length > 0) sessionCacheSet(email, state);
      } catch {}
    } else {
      // Wrong password or disabled account → cached session (if any) is invalid, clear it.
      if (status === WRONG_PASS || status === DIE) sessionCacheDel(email);
    }

    return { email, password, status, credit: credit || null, plan: plan || null, detail: errMsg || null, reason: reason || null };
  } finally {
    await ctx.close();
  }
}

async function checkAccount(browser, email, password, proxy = null) {
  // Fail-closed (P1): when WARRANTY_REQUIRE_PROXY is ON (default), never fall back to the raw IP —
  // that's the account-ban vector. Return TIMEOUT (ambiguous → worker retries on a live proxy or
  // routes to seller review). Set WARRANTY_REQUIRE_PROXY=0 to restore the old raw-IP fallback.
  const requireProxy = !/^(0|false|off|no)$/i.test(String(process.env.WARRANTY_REQUIRE_PROXY ?? '').trim());
  if (proxy && deadProxies.has(proxy.server)) {
    if (requireProxy) return { email, password, status: TIMEOUT, credit: null, detail: 'proxy_dead_no_raw_fallback (cached dead)' };
    proxy = null;
  }
  if (requireProxy && !proxy) {
    return { email, password, status: TIMEOUT, credit: null, detail: 'no_proxy_no_raw_fallback (WARRANTY_REQUIRE_PROXY on)' };
  }
  try {
    return await runCheck(browser, email, password, proxy);
  } catch (e) {
    const proxyErrors = ['ERR_CONNECTION_CLOSED','ERR_TUNNEL_CONNECTION_FAILED','ERR_PROXY',
                         'ERR_EMPTY_RESPONSE','Connection refused','net::','Timeout','timeout'];
    if (proxy && proxyErrors.some(k => e.message.includes(k))) {
      deadProxies.add(proxy.server);
      console.log(chalk.yellow(`  Proxy dead [${proxy.server}] — skipping`));
      if (requireProxy) {
        // Don't retry on raw IP — surface as TIMEOUT so the worker handles proxy rotation/review.
        return { email, password, status: TIMEOUT, credit: null, detail: 'proxy_dead_no_raw_fallback: ' + e.message };
      }
      try { return await runCheck(browser, email, password, null); }
      catch (e2) {
        // Không xác minh được do exception — KHÔNG mark DIE (acc có thể vẫn sống).
        return { email, password, status: TIMEOUT, credit: null, detail: e2.message };
      }
    }
    // Exception không phải proxy (timeout playwright, browser crash, network blip…).
    // Trạng thái acc UNKNOWN, không có bằng chứng acc die → TIMEOUT thay vì DIE.
    return { email, password, status: TIMEOUT, credit: null, detail: e.message };
  }
}

// ── Worker pool ───────────────────────────────────────────────────────────────

async function runAsync(accounts, proxies, workers) {
  const total   = accounts.length;
  const results = new Array(total).fill(null);
  // Queue index — safe vì JS single-threaded, cursor++ là atomic giữa các await
  const queue   = accounts.map((acc, i) => i);  // [0,1,2,...,n-1]
  let   qHead   = 0;

  const browsers = await Promise.all(
    Array.from({ length: workers }, () => chromium.launch({ headless: true, args: BROWSER_ARGS }))
  );

  async function worker(browser) {
    while (true) {
      const i = qHead++;   // atomic trong JS event loop
      if (i >= total) break;
      const [email, password] = accounts[i];
      const proxy = proxies.length ? proxies[Math.floor(Math.random() * proxies.length)] : null;
      try {
        let r = await checkAccount(browser, email, password, proxy);
        if (r.status === TIMEOUT && proxies.length)
          r = await checkAccount(browser, email, password, proxies[(i + 1) % proxies.length]);
        results[i] = r;
        printResult(r, i + 1, total);
      } catch (e) {
        // Same rationale as checkAccount catch: unknown state != confirmed dead.
        results[i] = { email, password, status: TIMEOUT, credit: null, detail: e.message };
        printResult(results[i], i + 1, total);
      }
    }
  }

  await Promise.all(browsers.map(b => worker(b)));
  for (const b of browsers) await b.close();
  return results;
}

// ── Entry point ───────────────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  printBanner();

  let filepath = process.argv[2];
  if (!filepath) {
    for (const def of ['accounts.txt', 'accounts.json']) {
      if (fs.existsSync(def)) { filepath = def; break; }
    }
  }
  if (!filepath || !fs.existsSync(filepath)) {
    console.log(chalk.red('Usage: node check_veo.js <accounts.txt>'));
    process.exit(1);
  }

  let proxies = [];
  for (const pf of ['proxies.txt', 'proxy.txt']) {
    if (fs.existsSync(pf)) {
      proxies = loadProxies(pf);
      console.log(chalk.dim(`Proxy  : ${chalk.cyan(proxies.length)} from ${pf}`));
      break;
    }
  }

  const accounts0 = loadAccounts(filepath);
  if (!accounts0.length) { console.log(chalk.red('No accounts found.')); process.exit(1); }
  console.log(chalk.dim(`Account: ${chalk.cyan(accounts0.length)} from ${filepath}\n`));

  const wInput  = await prompt(chalk.bold.cyan('  Threads (Enter = 3): '));
  const workers = (wInput && /^\d+$/.test(wInput) && +wInput > 0) ? +wInput : 3;
  console.log(chalk.dim(`Workers: ${chalk.cyan(workers)}\n`));

  let currentFile = filepath;
  let run         = 0;
  const MAX_RETRIES = 10;

  while (true) {
    run++;
    const accounts = loadAccounts(currentFile);
    if (!accounts.length) break;

    const actualWorkers = Math.min(workers, accounts.length);
    if (run > 1)
      console.log(chalk.bold.cyan(`\n🔄 Retry #${run - 1} — ${accounts.length} live_no_credit accounts\n`));
    else
      console.log(chalk.dim(`Workers: ${chalk.cyan(actualWorkers)}\n`));

    deadProxies.clear();
    const results = await runAsync(accounts, proxies, actualWorkers);

    printStats(results, `Run #${run} — ${currentFile}`);
    exportResults(results);

    const retryAccounts = loadAccounts('live_no_credit.txt');
    if (!retryAccounts.length) {
      console.log(chalk.bold.green('\n  ✅ live_no_credit.txt trống — hoàn tất!\n'));
      break;
    }
    if (run >= MAX_RETRIES) {
      console.log(chalk.yellow(`\n  ⚠ Đã retry ${MAX_RETRIES} lần, còn ${retryAccounts.length} acc chưa có credit.\n`));
      break;
    }
    currentFile = 'live_no_credit.txt';
  }
}

module.exports = { checkAccount };

if (require.main === module) {
  main().catch(err => { console.error(chalk.red('Fatal error:'), err); process.exit(1); });
}
