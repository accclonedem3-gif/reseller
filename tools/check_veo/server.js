'use strict';

/**
 * VEO Check Server — long-running HTTP wrapper around check_veo.js
 *
 * Mirrors the architecture of ../CheckGrokJS/server.js:
 *   - Persistent browser pool (keeps Chromium processes alive across checks → saves the
 *     ~3-5s cold launch tax. Login itself is still per-account, can't share that.)
 *   - Per-proxy isolation: each pool slot pinned to one proxy so the browser's network
 *     state (DNS cache, TLS resumption, residual cookies tolerated by Google) is reused
 *     for the same upstream IP — not as dramatic as CF cookie sharing but still ~1-2s/check.
 *   - HTTP API + job lifecycle so the reseller worker can submit a batch and stream results,
 *     instead of spawning a fresh single-check.js subprocess per account.
 *
 * Defaults tuned for 4GB VPS:
 *   POOL_MAX=2          (2 persistent Chromiums = ~600-800MB idle)
 *   MAX_CONCURRENCY=2   (limited by pool size; no point queueing beyond what we can run)
 *
 * Endpoints (match CheckGrokJS/server.js for worker code reuse):
 *   POST /check                       → submit batch, returns job_id
 *   GET  /check/:id                   → poll status / results
 *   GET  /check/:id/stream            → SSE stream of per-account completions
 *   GET  /stats                       → pool + warmer health
 *   POST /admin/reload-proxies        → reload proxies.txt without restart
 *   GET  /admin/warm-status           → per-proxy pool detail
 *
 * Run:
 *   PORT=4002 node server.js
 *   (or via PM2 — see reseller/ecosystem.config.cjs)
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { chromium } = require('playwright');
const { checkAccount } = require('./check_veo');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ── Config ───────────────────────────────────────────────────────────────
const PORT             = Number(process.env.PORT || 4002);
const API_KEY          = process.env.API_KEY || '';
const PROXY_FILE       = process.env.PROXY_FILE || path.resolve(__dirname, 'proxies.txt');
const POOL_MAX         = Math.max(1, Number(process.env.POOL_MAX || 2));
// MAX_CONCURRENCY must NOT exceed POOL_MAX: each in-flight check holds one browser slot, and
// acquireSlot's "all in use" branch assumes the callsite never admits more checks than there are
// slots (otherwise it busy-spins on 200ms retries waiting for a slot that can't free up). Clamp.
const _maxConcReq      = Math.max(1, Number(process.env.MAX_CONCURRENCY || POOL_MAX));
const MAX_CONCURRENCY  = Math.min(_maxConcReq, POOL_MAX);
if (_maxConcReq > POOL_MAX) {
  console.warn(`[config] MAX_CONCURRENCY=${_maxConcReq} > POOL_MAX=${POOL_MAX} — clamped to ${POOL_MAX} (one slot per check).`);
}
const JOB_TTL_MS       = Math.max(60_000, Number(process.env.JOB_TTL_MIN || 30) * 60_000);
const BROWSER_IDLE_TTL_MS = Math.max(60_000, Number(process.env.BROWSER_IDLE_MIN || 30) * 60_000);
const PROXY_DEAD_TTL_MS   = Math.max(60_000, Number(process.env.PROXY_DEAD_MIN || 10) * 60_000);
const RL_CHECK_PER_MIN = Number(process.env.RL_CHECK_PER_MIN || 30);

const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--disable-infobars', '--disable-extensions',
  '--disable-background-networking', '--disable-sync', '--no-first-run',
  '--mute-audio',
];

// ── Proxy state ──────────────────────────────────────────────────────────
let proxies = [];
const _proxyDeadUntil = new Map();  // proxyKey → unix ms

function proxyStr(p) {
  if (!p) return '';
  if (p.username) return `${p.server.replace('://', `://${p.username}:***@`)}`;
  return p.server;
}
function proxyKey(p) {
  if (!p) return '';
  return p.username ? `${p.server}|${p.username}` : p.server;
}
function parseProxyLine(line) {
  const s = String(line || '').trim();
  if (!s || s.startsWith('#')) return null;
  if (/^https?:\/\/|^socks5:\/\//.test(s)) return { server: s };
  const parts = s.split(':');
  if (parts.length === 2) return { server: `socks5://${parts[0]}:${parts[1]}` };
  if (parts.length === 4) return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
  return { server: `http://${s}` };
}
function loadProxies() {
  try {
    const txt = fs.readFileSync(PROXY_FILE, 'utf8');
    const list = txt.split(/\r?\n/).map(parseProxyLine).filter(Boolean);
    console.log(`[proxy] Loaded ${list.length} from ${PROXY_FILE}`);
    return list;
  } catch (e) {
    console.warn(`[proxy] Failed to read ${PROXY_FILE}: ${e.message} — running with 0 proxies`);
    return [];
  }
}

function isProxyDead(proxy) {
  const until = _proxyDeadUntil.get(proxyKey(proxy));
  return !!until && until > Date.now();
}
function markProxyDead(proxy, reason) {
  const k = proxyKey(proxy);
  if (!k) return;
  _proxyDeadUntil.set(k, Date.now() + PROXY_DEAD_TTL_MS);
  console.warn(`[proxy] Marked dead: ${proxyStr(proxy)} (${reason}) for ${PROXY_DEAD_TTL_MS / 60000} min`);
}
function pickProxy(stickyHash) {
  if (proxies.length === 0) return null;
  // Walk starting at hash-derived index, skip dead ones. Fall back to first alive.
  const start = stickyHash != null
    ? Math.abs(Number(stickyHash)) % proxies.length
    : Math.floor(Math.random() * proxies.length);
  for (let i = 0; i < proxies.length; i++) {
    const p = proxies[(start + i) % proxies.length];
    if (!isProxyDead(p)) return p;
  }
  return null; // all dead
}

// ── Browser pool ─────────────────────────────────────────────────────────
// Each entry: { browser, proxy, inUse, lastUsed, profileDir }
const _pool = [];

function profileDirFor(proxy) {
  const tag = proxy ? crypto.createHash('sha1').update(proxyKey(proxy)).digest('hex').slice(0, 12) : 'noproxy';
  return path.join(require('os').tmpdir(), 'cveo-profiles', `proxy_${tag}`);
}

async function launchBrowserFor(proxy) {
  const profileDir = profileDirFor(proxy);
  try { fs.mkdirSync(profileDir, { recursive: true }); } catch {}
  // launchPersistentContext keeps cookies/cache across restarts (saves another second per
  // check on the SECOND visit per proxy). Returns a BrowserContext directly, not a Browser —
  // adjust callsites accordingly.
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: BROWSER_ARGS,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    proxy: proxy || undefined,
  });
  return { ctx, profileDir };
}

async function acquireSlot(proxy, _attempt = 0) {
  // Find an idle slot matching this proxy.
  for (const slot of _pool) {
    if (!slot.inUse && proxyKey(slot.proxy) === proxyKey(proxy)) {
      slot.inUse = true;
      slot.lastUsed = Date.now();
      return slot;
    }
  }
  // If we're under pool max, launch a new one.
  if (_pool.length < POOL_MAX) {
    const { ctx, profileDir } = await launchBrowserFor(proxy);
    const slot = { ctx, proxy, inUse: true, lastUsed: Date.now(), profileDir };
    _pool.push(slot);
    console.log(`[pool] Launched slot ${_pool.length}/${POOL_MAX} for ${proxyStr(proxy) || 'raw IP'}`);
    return slot;
  }
  // Pool full: evict the oldest idle slot and rebuild for this proxy.
  let oldest = null;
  for (const s of _pool) {
    if (!s.inUse && (!oldest || s.lastUsed < oldest.lastUsed)) oldest = s;
  }
  if (!oldest) {
    // All in use → wait briefly and retry. With MAX_CONCURRENCY clamped to POOL_MAX this is
    // rare (a slot is releasing). Bound the retries so a leaked inUse slot turns into a clear
    // error instead of an infinite busy-spin: ~150 × 200ms ≈ 30s, comfortably past one check.
    if (_attempt >= 150) {
      throw new Error('acquireSlot: no slot free after ~30s — possible leaked browser slot');
    }
    await new Promise(r => setTimeout(r, 200));
    return acquireSlot(proxy, _attempt + 1);
  }
  console.log(`[pool] Evicting idle slot to make room for ${proxyStr(proxy) || 'raw IP'}`);
  await oldest.ctx.close().catch(() => undefined);
  const { ctx, profileDir } = await launchBrowserFor(proxy);
  oldest.ctx = ctx; oldest.proxy = proxy; oldest.inUse = true;
  oldest.lastUsed = Date.now(); oldest.profileDir = profileDir;
  return oldest;
}

function releaseSlot(slot) {
  slot.inUse = false;
  slot.lastUsed = Date.now();
}

// Idle reaper: close browsers that have sat idle past BROWSER_IDLE_TTL_MS to free RAM.
setInterval(() => {
  const now = Date.now();
  for (let i = _pool.length - 1; i >= 0; i--) {
    const s = _pool[i];
    if (!s.inUse && now - s.lastUsed > BROWSER_IDLE_TTL_MS) {
      console.log(`[pool] Reaping idle slot for ${proxyStr(s.proxy) || 'raw IP'} (idle ${Math.round((now - s.lastUsed) / 60000)}min)`);
      s.ctx.close().catch(() => undefined);
      _pool.splice(i, 1);
    }
  }
}, 60_000).unref();

// ── Check execution ──────────────────────────────────────────────────────
// Normalise checkAccount() output to the stable contract the reseller worker reads via
// deriveVeoResultShape(). Mirrors CheckGrokJS/server.js sanitizeResult() so that if
// checkAccount ever adds/renames fields the mismatch is obvious here, not silently wrong.
function sanitizeResult(r) {
  if (!r) return null;
  return {
    status: r.status ?? null,
    credit: r.credit ?? null,
    plan:   r.plan   ?? null,
    detail: r.detail ?? null,
    reason: r.reason ?? null,
  };
}

// Run one account check against the persistent context. check_veo.checkAccount expects a
// `browser` but it only uses `browser.newContext()` — so we pass the BrowserContext as the
// browser arg (Playwright BrowserContext has a `newContext`-equivalent: we create a temporary
// context inside the persistent one via `context.browser()?.newContext()` if available, OR
// we just reuse the persistent context's pages directly).
//
// Approach: use the persistent context's underlying browser to spawn a fresh sub-context for
// each check (isolates cookies/sessions per-account). If `ctx.browser()` returns null (some
// playwright versions), fall back to passing ctx itself — checkAccount will create a context
// from it, which on a launchPersistentContext is treated as a sibling.
async function runOneCheck(account, proxy, slot) {
  const browserLike = slot.ctx.browser() || slot.ctx;
  // checkAccount accepts (browser, email, password, proxy) → uses browser.newContext().
  // When given a persistent context, the underlying Browser handles newContext() fine.
  return await checkAccount(browserLike, account.email, account.password, proxy || null);
}

// ── Concurrency ──────────────────────────────────────────────────────────
// Tiny semaphore — we don't want to pull p-limit (ESM-only in v4) into a CJS file.
function semaphore(max) {
  let running = 0;
  const queue = [];
  const run = async (fn) => {
    if (running >= max) await new Promise(r => queue.push(r));
    running++;
    try { return await fn(); } finally {
      running--;
      const next = queue.shift();
      if (next) next();
    }
  };
  return run;
}
const limit = semaphore(MAX_CONCURRENCY);

// ── Job lifecycle ────────────────────────────────────────────────────────
// Map<jobId, { total, done, results, status, createdAt, listeners }>
// `listeners` is an array of SSE response objects subscribed to per-account events.
const _jobs = new Map();
function newJobId() { return crypto.randomBytes(8).toString('hex'); }
function purgeStaleJobs() {
  const now = Date.now();
  for (const [id, job] of _jobs) {
    if (now - job.createdAt > JOB_TTL_MS) _jobs.delete(id);
  }
}
setInterval(purgeStaleJobs, 5 * 60_000).unref();

function stickyHashOf(email) {
  return crypto.createHash('md5').update(String(email || '')).digest().readUInt32BE(0);
}

async function processAccount(job, idx, account) {
  const stickyHash = stickyHashOf(account.user || account.email);
  // Allow per-request proxy override (worker passes one based on its admin pool).
  let proxy = null;
  if (account.proxy) {
    proxy = parseProxyLine(account.proxy);
  } else {
    proxy = pickProxy(stickyHash);
  }

  const t0 = Date.now();
  let slot;
  let result = null;
  try {
    slot = await acquireSlot(proxy);
    result = await runOneCheck(
      { email: account.user || account.email, password: account.pwd || account.password },
      proxy,
      slot,
    );
  } catch (e) {
    // Distinguish proxy errors → mark proxy dead, retry once with raw IP. Other errors:
    // return TIMEOUT (mirror check_veo.js behavior).
    const msg = (e && e.message) || String(e);
    const proxyErrs = ['ERR_CONNECTION', 'ERR_TUNNEL', 'ERR_PROXY', 'ERR_EMPTY_RESPONSE', 'Connection refused', 'net::'];
    // Fail-closed (P1): when WARRANTY_REQUIRE_PROXY is ON (default), do NOT retry on this server's
    // raw IP after a proxy dies — that's the ban vector. Return a TIMEOUT so the worker marks the
    // proxy dead and retries on a LIVE proxy (or aborts to review). Set =0 to allow raw fallback.
    const requireProxy = !/^(0|false|off|no)$/i.test(String(process.env.WARRANTY_REQUIRE_PROXY ?? '').trim());
    if (proxy && proxyErrs.some(k => msg.includes(k))) {
      markProxyDead(proxy, msg.split('\n')[0].slice(0, 80));
      if (slot) releaseSlot(slot);
      slot = null;
      if (requireProxy) {
        result = { email: account.user, password: account.pwd, status: 'TIMEOUT', credit: null, detail: 'proxy_dead_no_raw_fallback: ' + msg.split('\n')[0].slice(0, 80) };
      } else {
        try {
          slot = await acquireSlot(null);
          result = await runOneCheck(
            { email: account.user || account.email, password: account.pwd || account.password },
            null,
            slot,
          );
        } catch (e2) {
          result = { email: account.user, password: account.pwd, status: 'TIMEOUT', credit: null, detail: e2.message };
        }
      }
    } else {
      result = { email: account.user, password: account.pwd, status: 'TIMEOUT', credit: null, detail: msg };
    }
  } finally {
    if (slot) releaseSlot(slot);
  }

  const elapsed_ms = Date.now() - t0;
  const entry = {
    idx,
    user: account.user || account.email,
    label: account.label || '',
    proxy: proxyStr(proxy) || null,
    elapsed_ms,
    result: sanitizeResult(result),
  };
  job.results[idx] = entry;
  job.done++;
  // Fan out to SSE listeners.
  for (const res of job.listeners) {
    try { res.write(`event: result\ndata: ${JSON.stringify(entry)}\n\n`); } catch {}
  }
  if (job.done >= job.total) {
    job.status = 'done';
    for (const res of job.listeners) {
      try { res.write(`event: done\ndata: {}\n\n`); res.end(); } catch {}
    }
    job.listeners = [];
  }
}

// ── HTTP API ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '1mb' }));

function auth(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

const checkLimiter = rateLimit({
  windowMs: 60_000,
  limit: RL_CHECK_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', limit_per_min: RL_CHECK_PER_MIN },
});

// POST /check — submit a batch of accounts.
// Body: { accounts: [{ user, pwd, [label], [proxy] }, ...] }
// Returns: { job_id, total, status, poll_url, stream_url }
app.post('/check', auth, checkLimiter, (req, res) => {
  const accounts = Array.isArray(req.body?.accounts) ? req.body.accounts : null;
  if (!accounts || accounts.length === 0) {
    return res.status(400).json({ error: 'accounts array required' });
  }
  if (accounts.length > 20) {
    return res.status(400).json({ error: 'max 20 accounts per batch' });
  }
  for (const a of accounts) {
    if (!a.user && !a.email) return res.status(400).json({ error: 'each account needs user/email' });
    if (!a.pwd && !a.password) return res.status(400).json({ error: 'each account needs pwd/password' });
  }

  const jobId = newJobId();
  const job = {
    total: accounts.length,
    done: 0,
    results: new Array(accounts.length).fill(null),
    status: 'running',
    createdAt: Date.now(),
    listeners: [],
  };
  _jobs.set(jobId, job);

  // Fire off each account through the semaphore, fire-and-forget. Results land in job.results
  // via processAccount's mutation.
  for (let i = 0; i < accounts.length; i++) {
    const idx = i;
    limit(() => processAccount(job, idx, accounts[idx])).catch((e) => {
      console.error(`[job ${jobId}] account ${idx} crashed:`, e);
    });
  }

  res.json({
    job_id: jobId,
    total: accounts.length,
    status: 'queued',
    poll_url: `/check/${jobId}`,
    stream_url: `/check/${jobId}/stream`,
  });
});

// GET /check/:id — poll job state.
app.get('/check/:id', auth, (req, res) => {
  const job = _jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  res.json({
    job_id: req.params.id,
    status: job.status,
    total: job.total,
    done: job.done,
    progress: Math.round((job.done / job.total) * 100),
    results: job.results.filter(Boolean),
    error: null,
  });
});

// GET /check/:id/stream — SSE: receive `result` event per account, `done` when complete.
app.get('/check/:id/stream', auth, (req, res) => {
  const job = _jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  // Replay completed results so the worker doesn't miss any that landed before subscription.
  for (const r of job.results.filter(Boolean)) {
    res.write(`event: result\ndata: ${JSON.stringify(r)}\n\n`);
  }
  if (job.status === 'done') {
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
    return;
  }
  job.listeners.push(res);
  req.on('close', () => {
    job.listeners = job.listeners.filter(r => r !== res);
  });
});

// GET /stats — pool + proxy health.
app.get('/stats', (req, res) => {
  const now = Date.now();
  const poolStats = _pool.map(s => ({
    proxy: proxyStr(s.proxy) || 'raw',
    in_use: s.inUse,
    idle_for_s: Math.round((now - s.lastUsed) / 1000),
  }));
  const dead = [];
  for (const [k, until] of _proxyDeadUntil) {
    if (until > now) dead.push({ proxy: k.split('|')[0], dead_until: new Date(until).toISOString() });
  }
  res.json({
    proxies_total: proxies.length,
    proxies_live: proxies.length - dead.length,
    proxies_dead: dead,
    pool_size: _pool.length,
    pool_max: POOL_MAX,
    pool_in_use: _pool.filter(s => s.inUse).length,
    pool_detail: poolStats,
    concurrency: MAX_CONCURRENCY,
    active_jobs: Array.from(_jobs.values()).filter(j => j.status === 'running').length,
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

app.get('/admin/warm-status', auth, (req, res) => {
  // Veo doesn't have a CF warmer (Google doesn't use CF heavily). We just surface the pool
  // health for parity with CheckGrokJS's endpoint.
  const now = Date.now();
  res.json({
    warmer: { enabled: false, note: 'veo has no CF warmer; pool keeps Chromium hot' },
    pool: _pool.map(s => ({
      proxy: proxyStr(s.proxy) || 'raw',
      in_use: s.inUse,
      idle_for_s: Math.round((now - s.lastUsed) / 1000),
      profile_dir: s.profileDir,
    })),
    proxies: proxies.map(p => ({
      proxy: proxyStr(p),
      dead_until: (() => { const u = _proxyDeadUntil.get(proxyKey(p)); return u && u > now ? new Date(u).toISOString() : null; })(),
    })),
  });
});

app.post('/admin/reload-proxies', auth, (req, res) => {
  proxies = loadProxies();
  res.json({ proxies: proxies.length });
});

// Boot.
proxies = loadProxies();

const BIND_HOST = process.env.BIND_HOST || "127.0.0.1"; // default loopback — set BIND_HOST=0.0.0.0 only for a separate-box deploy
const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`\n🚀 Veo Check API on ${BIND_HOST}:${PORT}  |  pool=${POOL_MAX}  |  concurrency=${MAX_CONCURRENCY}  |  proxies=${proxies.length}`);
  console.log(`   POST /check  |  GET /check/:id  |  GET /check/:id/stream  |  GET /stats`);
  if (!API_KEY) console.log(`⚠️  No API_KEY — public access. Set env API_KEY=xxx để bảo vệ.`);
});

// Graceful shutdown so PM2 stop / SIGTERM closes browsers cleanly (otherwise Chromium children eat
// RAM). NOTE: this uses Playwright (not puppeteer) — the client Browser has NO .process(), so we
// can't taskkill by PID ourselves. Instead we (a) force-close each whole Browser (more thorough than
// ctx.close), racing a 5s timeout so a wedged context can't hang shutdown, then (b) process.exit(),
// which fires Playwright's OWN processLauncher.gracefullyCloseAll() exit handler — that SIGKILLs any
// browser child Playwright launched (incl. renderers) that didn't close in time. That is the real
// zombie backstop on this stack; an explicit PID kill is impossible via the Playwright client API.
let _shuttingDown = false;
async function shutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[shutdown] ${signal} received — closing browsers`);
  try { server.close(); } catch {}
  await Promise.race([
    Promise.all(_pool.map(s => (s.ctx.browser()?.close() ?? s.ctx.close()).catch(() => undefined))),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  process.exit(0); // → Playwright's exit handler kills any surviving browser process tree
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
