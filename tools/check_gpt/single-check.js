'use strict';

// Single-account ChatGPT check wrapper for reseller worker.
// Args: --email <e> --password <p> [--extra <totp|ms_token>] [--proxy <...>]
// Output: a single line "JSON_RESULT:{...}" on stdout.

const { chromium } = require('playwright');
const { checkAccount } = require('./check_gpt');

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

function detectExtra(field) {
  if (!field) return null;
  if (/^[A-Z2-7]{16,64}$/.test(field.toUpperCase())) return { type: 'totp', value: field };
  if (field.startsWith('M.') || field.length > 100) return { type: 'ms_token', value: field };
  return { type: 'unknown', value: field };
}

(async () => {
  // Env vars take precedence (set by reseller worker for security).
  const email = process.env.CHECK_EMAIL || arg('email');
  const password = process.env.CHECK_PASSWORD || arg('password');
  const proxy = parseProxyArg(process.env.CHECK_PROXY || arg('proxy'));
  const extra = detectExtra(process.env.CHECK_EXTRA || arg('extra'));

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
    const r = await checkAccount(browser, email, password, proxy, extra);
    const status = String(r?.status || 'DIE').toUpperCase();
    const plan = r?.plan || (status === 'PLUS' ? 'PLUS' : status === 'FREE' ? 'FREE' : null);
    const isDead = status === 'DIE' || status === 'WRONG_PASS' || status === 'FREE';
    const stillPaid = status === 'PLUS' || (plan && /plus|pro|team/i.test(plan));
    process.stdout.write('JSON_RESULT:' + JSON.stringify({
      ok: status !== 'TIMEOUT',
      tool: 'gpt',
      status,
      plan,
      detail: r?.detail || null,
      isDead,
      stillPaid,
    }) + '\n');
    process.exit(0);
  } catch (e) {
    process.stdout.write('JSON_RESULT:' + JSON.stringify({
      ok: false,
      tool: 'gpt',
      status: 'fatal',
      error: e?.message || String(e),
    }) + '\n');
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
