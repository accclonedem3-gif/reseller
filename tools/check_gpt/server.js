'use strict';

// Minimal HTTP server for the ChatGPT checker so it can run on a SEPARATE VPS.
// The reseller worker calls POST /check via CHECK_GPT_URL (sync, one account per request),
// falling back to spawning single-check.js locally if this server is unreachable.
//
// Endpoints:
//   GET  /health            → { ok:true, uptime }
//   POST /check  {email,password,proxy?,extra?}  (X-API-Key required if API_KEY set)
//        → SAME JSON shape that single-check.js prints after "JSON_RESULT:"
//          { ok, tool:'gpt', status, plan, detail, isDead, stillPaid }
//
// Browser-per-request (mirrors single-check.js). Worker controls concurrency
// (ACCOUNT_PARALLEL_LIMIT) — keep VPS RAM in mind (each Chromium ~300-500MB).

const http = require('http');
const { chromium } = require('playwright');
const { checkAccount } = require('./check_gpt');

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
const START = Date.now();

const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--disable-infobars', '--disable-extensions',
  '--disable-background-networking', '--disable-sync', '--no-first-run',
];

function parseProxyArg(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^https?:\/\/|^socks5:\/\//.test(s)) return { server: s };
  const parts = s.split(':');
  if (parts.length === 2) return { server: `socks5://${parts[0]}:${parts[1]}` };
  if (parts.length === 4) return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
  return { server: `http://${s}` };
}

function detectExtra(field) {
  if (!field) return null;
  const f = String(field);
  if (/^[A-Z2-7]{16,64}$/.test(f.toUpperCase())) return { type: 'totp', value: f };
  if (f.startsWith('M.') || f.length > 100) return { type: 'ms_token', value: f };
  return { type: 'unknown', value: f };
}

async function runCheck({ email, password, proxy, extra }) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
    const r = await checkAccount(browser, email, password, parseProxyArg(proxy), detectExtra(extra));
    const status = String(r?.status || 'DIE').toUpperCase();
    const plan = r?.plan || (status === 'PLUS' ? 'PLUS' : status === 'FREE' ? 'FREE' : null);
    const isDead = status === 'DIE' || status === 'WRONG_PASS' || status === 'FREE';
    const stillPaid = status === 'PLUS' || (plan && /plus|pro|team/i.test(plan));
    return { ok: status !== 'TIMEOUT', tool: 'gpt', status, plan, detail: r?.detail || null, isDead, stillPaid };
  } catch (e) {
    return { ok: false, tool: 'gpt', status: 'fatal', error: (e && e.message) || String(e) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    return send(res, 200, { ok: true, tool: 'gpt', uptime: Math.floor((Date.now() - START) / 1000) });
  }
  if (req.method === 'POST' && (req.url === '/check' || req.url === '/check/')) {
    if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
      return send(res, 401, { ok: false, error: 'unauthorized' });
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let p;
      try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false, status: 'invalid_args', error: 'bad json' }); }
      if (!p.email || !p.password) return send(res, 400, { ok: false, status: 'invalid_args', error: 'email and password required' });
      try {
        send(res, 200, await runCheck(p));
      } catch (e) {
        send(res, 500, { ok: false, tool: 'gpt', status: 'fatal', error: (e && e.message) || String(e) });
      }
    });
    return;
  }
  send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[check_gpt] HTTP server on :${PORT}${API_KEY ? ' (API_KEY set)' : ' (⚠ NO API_KEY — public access!)'}`);
});
