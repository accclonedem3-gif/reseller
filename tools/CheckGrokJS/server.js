'use strict';

// HTTP API wrapper cho Grok checker.
// Long-running process với profile Chrome ổn định theo proxy → cf_clearance
// persist trong profile dir → khách đầu pass CF (~15s), khách 2..N ~7-9s.
//
// Endpoints:
//   POST /check                 → submit batch (1-N acc), trả job_id
//   GET  /check/:id             → poll status + results
//   GET  /check/:id/stream      → SSE realtime (event: started/result/done)
//   GET  /stats                 → debug: số proxy live/warm, active job, ...
//   GET  /health                → healthcheck
//   POST /admin/reload-proxies  → reload proxy.txt mà không restart server
//
// Env:
//   PORT=3000                MAX_CONCURRENCY=6     MAX_ACC_PER_JOB=10
//   PROXY_FILE=proxy.txt     API_KEY=<optional>    JOB_TTL_MIN=30
//
// Args: --fast (truyền xuống toolgrok.js → giảm timeout 0.6x)

const express   = require('express');
const rateLimit = require('express-rate-limit');
const pLimit    = require('p-limit');
const crypto    = require('crypto');
const fs        = require('fs');

const {
  runAccount, warmProxy, loadProxies, proxyStr,
  proxyProfileDir, sessionEvents,
  startWindowHider, parseProxy,
} = require('./toolgrok.js');

// Thời điểm warmProxy() thành công gần nhất cho từng proxy key.
// Dùng thay cho getCachedSession() (in-memory) đã bị loại bỏ.
const _lastWarmAt = new Map(); // proxyStr → Date.now()

// Pre-compile DLL ẩn cửa sổ Chrome trước khi launch (chỉ Windows)
startWindowHider();

// ── Config ────────────────────────────────────────────────────────────────
const PORT                   = parseInt(process.env.PORT || '3000');
const MAX_CONCURRENCY        = parseInt(process.env.MAX_CONCURRENCY || '6');
const MAX_ACC_PER_JOB        = parseInt(process.env.MAX_ACC_PER_JOB || '10');
const JOB_TTL_MS             = parseInt(process.env.JOB_TTL_MIN || '30') * 60 * 1000;
const PROXY_DEAD_COOLDOWN_MS = 10 * 60 * 1000;
const PROXY_FILE             = process.env.PROXY_FILE || 'proxy.txt';
const API_KEY                = process.env.API_KEY || null;
const FAST                   = process.argv.includes('--fast');

// Warmer: chạy cron giữ cf_clearance nóng cho MỌI proxy 24/7, kể cả không
// có khách dùng → khách lẻ lúc nào cũng được ~3s, không bao giờ cold-start.
//
// Tham số mặc định (tuned cho "luôn có buffer dày"):
//   INTERVAL = 10 min → cycle ngắn, không có window stale dài
//   MARGIN   = 10 min → refresh khi cookie còn ≤10 phút TTL → cookie tuổi
//              luôn ≤ 15 phút khi khách dùng (TTL = 25 phút - margin 10)
//   PARALLEL = 2      → warm 2 proxy song song, cycle xong nhanh
//
// Tắt warmer: WARMER=0
const WARMER_ENABLED     = (process.env.WARMER ?? '1') !== '0';
const WARMER_INTERVAL_MS = parseInt(process.env.WARMER_INTERVAL_MIN || '10') * 60 * 1000;
const WARMER_MARGIN_MS   = parseInt(process.env.WARMER_MARGIN_MIN   || '10') * 60 * 1000;
const WARMER_PARALLEL    = parseInt(process.env.WARMER_PARALLEL     || '2');
// Sau khi cookie bị invalidate (vd CF reject, session lost), debounce
// re-warm sau N giây để không spam warm liên tục nếu nhiều account cùng fail.
const WARMER_REWARM_DEBOUNCE_MS = 30 * 1000;

// Rate limit per IP (chống abuse khi expose internet)
const RL_CHECK_PER_MIN  = parseInt(process.env.RL_CHECK_PER_MIN  || '30');
const RL_STREAM_PER_MIN = parseInt(process.env.RL_STREAM_PER_MIN || '20');
const RL_DISABLE        = process.env.RL_DISABLE === '1';
const TRUST_PROXY       = (process.env.TRUST_PROXY ?? '1') !== '0';


// ── Proxy pool + dead-proxy cooldown ──────────────────────────────────────
let proxies = [];
const proxyDeadUntil = new Map(); // proxyStr → unix ms (skip cho tới khi)

function reloadProxies() {
  if (!fs.existsSync(PROXY_FILE)) { proxies = []; return; }
  proxies = loadProxies(PROXY_FILE);
  console.log(`[proxy] Loaded ${proxies.length} from ${PROXY_FILE}`);
}
reloadProxies();

let _rrIdx = 0;

// Sticky proxy per account: hash(email) → fixed idx trong pool.
// Cùng account luôn cùng proxy → X.AI quen IP → ít trigger 2FA/email-verify.
// Tắt bằng env STICKY_PROXY=0 (rotate round-robin như cũ).
const STICKY_PROXY_ENABLED = (process.env.STICKY_PROXY ?? '1') !== '0';

function stickyIdx(email, len) {
  if (!email || len <= 0) return 0;
  const h = crypto.createHash('sha1').update(String(email).toLowerCase()).digest();
  return h.readUInt32BE(0) % len;
}

// Ưu tiên proxy có CF cache nóng → khách mới hưởng ngay (~3s thay vì ~15s).
// Sticky mode: nếu truyền `email`, dùng hash(email) làm start idx, skip dead,
// walk khi proxy gốc cooldown — kết quả là cùng account cùng proxy 99% case.
// Không sticky (legacy): round-robin toàn pool.
function pickProxy(email = null) {
  if (!proxies.length) return null;
  const now = Date.now();
  const live = proxies.filter(p => {
    const until = proxyDeadUntil.get(proxyStr(p));
    return !until || until < now;
  });
  // Toàn pool cooldown → dùng nguyên pool (tốt hơn null)
  if (!live.length) {
    if (STICKY_PROXY_ENABLED && email) {
      return proxies[stickyIdx(email, proxies.length)];
    }
    _rrIdx++;
    return proxies[(_rrIdx - 1) % proxies.length];
  }
  if (STICKY_PROXY_ENABLED && email) {
    // Sticky: start ở hash(email), nếu proxy đó còn live → dùng luôn.
    // Live filter đã skip cooldown nên không cần check lại.
    const startIdx = stickyIdx(email, proxies.length);
    for (let off = 0; off < proxies.length; off++) {
      const cand = proxies[(startIdx + off) % proxies.length];
      if (live.includes(cand)) return cand;
    }
    // fallback (không nên xảy ra vì live.length > 0)
  }
  // Ưu tiên proxy đã warm gần đây (cf_clearance còn trong profile) → cold start ít hơn.
  const WARM_STALE_MS = 20 * 60 * 1000; // coi là stale sau 20 phút
  const now2 = Date.now();
  const warm = live.filter(p => { const t = _lastWarmAt.get(proxyStr(p)); return t && (now2 - t) < WARM_STALE_MS; });
  const pool = warm.length ? warm : live;
  _rrIdx++;
  return pool[(_rrIdx - 1) % pool.length];
}

function markProxyDead(pStr) {
  if (!pStr || pStr === 'không có') return;
  proxyDeadUntil.set(pStr, Date.now() + PROXY_DEAD_COOLDOWN_MS);
}

// A proxy is "dead" not only on an explicit proxy_die verdict but also on any connection-level
// failure (ERR_CONNECTION_RESET / ECONNREFUSED / ETIMEDOUT / tunnel). Without this the warmer kept
// relaunching a fresh Chromium for a truly-dead proxy EVERY cycle (wasted RAM/CPU) instead of
// cooling it down — a real resource drain on a small machine.
function isConnLevelDead(r) {
  if (r?.error_type === 'proxy_die') return true;
  const e = String(r?.error || '').toLowerCase();
  return /err_connection|econnreset|econnrefused|etimedout|err_timed_out|err_tunnel|err_proxy|net::err_/.test(e);
}

// ── Job store + SSE subscribers ───────────────────────────────────────────
const jobs        = new Map(); // jobId → { status, results, total, done, createdAt, error? }
const subscribers = new Map(); // jobId → Set<res>

// GC jobs hết hạn để không leak RAM
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
}, 5 * 60 * 1000).unref();

function publish(jobId, event, data) {
  const subs = subscribers.get(jobId);
  if (!subs) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) try { res.write(payload); } catch {}
}

function closeSubs(jobId) {
  const subs = subscribers.get(jobId);
  if (!subs) return;
  for (const res of subs) try { res.end(); } catch {}
  subscribers.delete(jobId);
}

function sanitizeResult(r) {
  if (!r) return null;
  return {
    plan:           r.plan ?? null,
    status:         r.status ?? null,
    expires:        r.expires ?? null,
    days_remaining: r.daysRemaining ?? null,
    cancel_at_end:  r.cancelAtEnd ?? null,
    proxy:          r.proxy ?? null,
    error:          r.error ?? null,
    error_type:     r.error_type ?? null,
  };
}

// ── Concurrency ───────────────────────────────────────────────────────────
// p-limit toàn process → mọi job chia sẻ cùng pool worker
// (4GB RAM ≈ 6 luồng Chrome an toàn, 8GB ≈ 10 luồng).
const limit = pLimit(MAX_CONCURRENCY);

async function processJob(jobId, accounts) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  publish(jobId, 'started', { total: accounts.length });

  await Promise.all(accounts.map((acc, i) => limit(async () => {
    // Per-account proxy override: caller (vd reseller worker) đã rotate sẵn proxy.
    // Nếu không có → fallback pickProxy() (dùng proxy.txt của server).
    let proxy = null;
    if (acc.proxy) {
      try { proxy = typeof acc.proxy === 'string' ? parseProxy(acc.proxy) : acc.proxy; }
      catch { proxy = null; }
    }
    if (!proxy) proxy = pickProxy(acc.user);
    const warm  = proxy ? !!_lastWarmAt.get(proxyStr(proxy)) : false;
    const t0    = Date.now();
    let entry;
    try {
      const result = await runAccount(acc.user, acc.pwd, true, proxy, 0);
      if (isConnLevelDead(result)) markProxyDead(result.proxy || proxyStr(proxy));
      entry = {
        idx: i, user: acc.user, label: acc.label || '',
        proxy_warm: warm, elapsed_ms: Date.now() - t0,
        result: sanitizeResult(result),
      };
    } catch (e) {
      entry = {
        idx: i, user: acc.user, label: acc.label || '',
        proxy_warm: warm, elapsed_ms: Date.now() - t0,
        result: { error: e.message || String(e), error_type: 'die' },
      };
    }
    job.results.push(entry);
    job.done++;
    publish(jobId, 'result', entry);
  })));

  job.status = 'done';
  publish(jobId, 'done', { done: job.done, total: job.total });
  closeSubs(jobId);
}

// ── CF warmer loop ─────────────────────────────────────────────────────────
// Parallel (warmLimit) để cycle xong nhanh — proxy nào cũng có cookie nóng
// trong cùng cycle. Mỗi warm dùng 1 Chrome → max Chrome cùng lúc =
// MAX_CONCURRENCY (customer) + WARMER_PARALLEL.
const warmLimit  = pLimit(WARMER_PARALLEL);
const _warmStats = { runs: 0, ok: 0, fail: 0, lastCycle: null, cyclesCompleted: 0 };
// Track proxy nào đang warm để tránh re-warm trùng (immediate trigger có thể
// fire khi cycle warmer đang chạy cùng proxy)
const _warmInProgress = new Set();
// Debounce immediate re-warm: nếu nhiều account fail cùng 1 proxy trong N giây,
// chỉ trigger 1 lần warm (không spam).
const _lastRewarmAt = new Map();

async function warmOneProxy(proxy, reason = 'cycle') {
  const key = proxyStr(proxy);
  if (_warmInProgress.has(key)) return { ok: false, skipped: true, reason: 'already warming' };
  _warmInProgress.add(key);
  _warmStats.runs++;
  const t0 = Date.now();
  try {
    const r = await warmProxy(proxy, true);
    const elapsed = Date.now() - t0;
    if (r.ok) {
      _warmStats.ok++;
      _lastWarmAt.set(key, Date.now()); // ghi timestamp để pickProxy biết proxy này warm
      console.log(`[warm:${reason}] ✅ ${key} (${r.cookies} cookie, ${Math.round(elapsed / 1000)}s)`);
    } else {
      _warmStats.fail++;
      console.log(`[warm:${reason}] ❌ ${key}: ${r.error}`);
      // Cool down on proxy_die OR any connection-level failure → warmer stops relaunching Chromium
      // for a dead proxy every cycle (e.g. the ERR_CONNECTION_RESET proxies).
      if (isConnLevelDead(r)) markProxyDead(key);
    }
    return r;
  } finally {
    _warmInProgress.delete(key);
  }
}

async function warmCycle() {
  if (!proxies.length) return;
  const toWarm = [];
  const now = Date.now();
  for (const proxy of proxies) {
    // Skip proxy đang cooldown (vừa báo die)
    const until = proxyDeadUntil.get(proxyStr(proxy));
    if (until && until > now) continue;
    // Skip nếu proxy vừa được warm gần đây (TTL profile = ~25 phút, margin WARMER_MARGIN_MS)
    const lastWarm = _lastWarmAt.get(proxyStr(proxy));
    if (lastWarm && (now - lastWarm) < (25 * 60 * 1000 - WARMER_MARGIN_MS)) continue;
    toWarm.push(proxy);
  }
  if (!toWarm.length) {
    _warmStats.lastCycle = { at: new Date().toISOString(), warmed: 0, skipped: proxies.length };
    return;
  }
  const cycleStart = Date.now();
  console.log(`[warm:cycle] start — ${toWarm.length}/${proxies.length} proxy cần refresh`);
  const results = await Promise.all(toWarm.map(p => warmLimit(() => warmOneProxy(p, 'cycle'))));
  const okCount = results.filter(r => r.ok).length;
  _warmStats.cyclesCompleted++;
  _warmStats.lastCycle = {
    at: new Date().toISOString(),
    warmed: toWarm.length,
    ok: okCount,
    fail: toWarm.length - okCount,
    elapsed_s: Math.round((Date.now() - cycleStart) / 1000),
  };
  console.log(`[warm:cycle] done — ${okCount}/${toWarm.length} OK in ${_warmStats.lastCycle.elapsed_s}s`);
}

// Trigger warm ngay khi cookie bị invalidate (vd customer hit cookie hỏng).
// Debounce: nếu cùng proxy fail liên tục, chỉ warm 1 lần per debounce window.
function scheduleImmediateWarm(proxyKey) {
  if (!proxyKey || proxyKey === 'không có') return;
  const proxy = proxies.find(p => proxyStr(p) === proxyKey);
  if (!proxy) return;
  const last = _lastRewarmAt.get(proxyKey) || 0;
  if (Date.now() - last < WARMER_REWARM_DEBOUNCE_MS) return;
  _lastRewarmAt.set(proxyKey, Date.now());
  // Fire-and-forget — đi qua warmLimit, sẽ queue nếu warmer cycle đang busy
  warmLimit(() => warmOneProxy(proxy, 'rewarm')).catch(e => console.error('[warm:rewarm]', e.message));
}

// sessionEvents không còn emit 'invalidated' (model cũ đã bỏ).
// Re-warm vẫn xảy ra qua warmCycle định kỳ.

// ── HTTP ──────────────────────────────────────────────────────────────────
const app = express();
// Đứng sau Caddy/Nginx → trust X-Forwarded-For để rate-limit theo IP thật
if (TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

// Rate limit: protect /check (submit) và /check/:id/stream (long-lived SSE)
const checkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      RL_CHECK_PER_MIN,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'rate limit exceeded — too many checks/min' },
  skip: () => RL_DISABLE,
});
const streamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      RL_STREAM_PER_MIN,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'rate limit exceeded — too many SSE connections/min' },
  skip: () => RL_DISABLE,
});

// CORS basic (allow browser frontend) — restrict origin trong prod nếu cần
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin',  '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function auth(req, res, next) {
  if (!API_KEY) return next();
  const k = req.headers['x-api-key'] || req.query.api_key;
  if (k !== API_KEY) return res.status(401).json({ error: 'invalid api key' });
  next();
}

app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get('/stats', auth, (req, res) => {
  const now = Date.now();
  const live = proxies.filter(p => {
    const until = proxyDeadUntil.get(proxyStr(p));
    return !until || until < now;
  });
  const WARM_STALE_MS2 = 20 * 60 * 1000;
  const warm = live.filter(p => { const t = _lastWarmAt.get(proxyStr(p)); return t && (Date.now() - t) < WARM_STALE_MS2; });
  res.json({
    proxies_total: proxies.length,
    proxies_live:  live.length,
    proxies_warm:  warm.length,
    proxies_dead:  [...proxyDeadUntil.entries()]
      .filter(([, t]) => t > now)
      .map(([k, v]) => ({ proxy: k, until: new Date(v).toISOString() })),
    active_jobs:   jobs.size,
    concurrency:   MAX_CONCURRENCY,
    fast_mode:     FAST,
    warmer:        { enabled: WARMER_ENABLED, interval_min: WARMER_INTERVAL_MS / 60000, ..._warmStats },
    memory_mb:     Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

// Quick proxy health probe — KHÔNG launch Chrome (warm cycle nặng quá nếu chỉ
// muốn biết proxy có còn sống). Hai mức:
//   mode=tcp  (default): chỉ TCP connect, ~3s
//   mode=full: TCP + HTTP GET https://accounts.x.ai/sign-in qua undici ProxyAgent
//              → confirm proxy ra được internet và X.AI không 403 IP, ~6s
//
// Body: {proxies: ["host:port:user:pass", ...]} hoặc {proxy: "host:port"}
// Response: {results: [{proxy, ok, tcp, http?, status?, error}]}
app.post('/admin/test-proxy', auth, async (req, res) => {
  const mode = (req.query.mode || 'tcp').toString();
  const list = Array.isArray(req.body?.proxies)
    ? req.body.proxies
    : req.body?.proxy ? [req.body.proxy] : null;
  if (!list || list.length === 0)
    return res.status(400).json({ error: 'send {proxies:[...]} or {proxy:"..."}' });
  if (list.length > 50)
    return res.status(400).json({ error: 'max 50 proxies per request' });

  const net = require('net');
  const { ProxyAgent, request: undiciRequest } = require('undici');

  async function probeTcp(p) {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      let done = false;
      const finish = (ok, err) => {
        if (done) return;
        done = true;
        try { sock.destroy(); } catch {}
        resolve({ ok, err });
      };
      sock.setTimeout(3000);
      sock.once('connect', () => finish(true, null));
      sock.once('timeout', () => finish(false, 'tcp_timeout'));
      sock.once('error', (e) => finish(false, e.code || e.message));
      try { sock.connect(p.port, p.host); }
      catch (e) { finish(false, e.message); }
    });
  }

  async function probeHttp(p) {
    const proxyUrl = p.user
      ? `${p.scheme}://${encodeURIComponent(p.user)}:${encodeURIComponent(p.password || '')}@${p.host}:${p.port}`
      : `${p.scheme}://${p.host}:${p.port}`;
    let agent;
    try { agent = new ProxyAgent(proxyUrl); } catch (e) { return { ok: false, err: 'agent_' + e.message }; }
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 6000);
    try {
      const { statusCode } = await undiciRequest('https://accounts.x.ai/sign-in?redirect=grok-com', {
        dispatcher: agent,
        method: 'GET',
        signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      return { ok: statusCode < 500, status: statusCode };
    } catch (e) {
      const msg = String(e?.message || e).toLowerCase();
      const reason = /abort/.test(msg) ? 'http_timeout'
        : /tunnel/.test(msg) ? 'tunnel_fail'
        : /auth/.test(msg) ? 'proxy_auth_fail'
        : msg.slice(0, 80);
      return { ok: false, err: reason };
    } finally { clearTimeout(tm); try { agent?.close?.(); } catch {} }
  }

  const out = await Promise.all(list.map(async (raw) => {
    const p = parseProxy(raw);
    if (!p) return { proxy: raw, ok: false, error: 'parse_fail' };
    const key = proxyStr(p);
    const t0 = Date.now();
    const tcp = await probeTcp(p);
    const tcpMs = Date.now() - t0;
    if (!tcp.ok) return { proxy: key, ok: false, tcp: false, tcpMs, error: tcp.err };
    if (mode === 'full') {
      const h0 = Date.now();
      const http = await probeHttp(p);
      const httpMs = Date.now() - h0;
      return { proxy: key, ok: http.ok, tcp: true, tcpMs, http: http.ok, httpMs, status: http.status, error: http.err || null };
    }
    return { proxy: key, ok: true, tcp: true, tcpMs };
  }));

  const summary = {
    total: out.length,
    alive: out.filter((r) => r.ok).length,
    dead: out.filter((r) => !r.ok).length,
  };
  res.json({ mode, summary, results: out });
});

app.post('/admin/reload-proxies', auth, (req, res) => {
  reloadProxies();
  res.json({ proxies: proxies.length });
});

// Trigger warmer ngay (vd: sau khi reload proxies mới, warm chúng liền)
app.post('/admin/warm-now', auth, (req, res) => {
  warmCycle().catch(e => console.error('[warm] manual error:', e.message));
  res.json({ ok: true, message: 'warm cycle started in background' });
});

// Xem tuổi cookie từng proxy + warmer health → biết warmer có chạy đều không
app.get('/admin/warm-status', auth, (req, res) => {
  const now = Date.now();
  const proxyStatus = proxies.map(p => {
    const key      = proxyStr(p);
    const lastWarm = _lastWarmAt.get(key);
    const dead     = proxyDeadUntil.get(key);
    const age_s    = lastWarm ? Math.round((now - lastWarm) / 1000) : null;
    return {
      proxy:           key,
      profile_dir:     proxyProfileDir(p),
      last_warm_ago_s: age_s,
      ttl_remaining_s: lastWarm ? Math.max(0, Math.round((25 * 60 * 1000 - (now - lastWarm)) / 1000)) : 0,
      warming_now:     _warmInProgress.has(key),
      dead_until:      dead && dead > now ? new Date(dead).toISOString() : null,
    };
  });
  res.json({
    warmer: {
      enabled:           WARMER_ENABLED,
      interval_min:      WARMER_INTERVAL_MS / 60000,
      margin_min:        WARMER_MARGIN_MS   / 60000,
      parallel:          WARMER_PARALLEL,
      cycles_completed:  _warmStats.cyclesCompleted,
      total_runs:        _warmStats.runs,
      total_ok:          _warmStats.ok,
      total_fail:        _warmStats.fail,
      last_cycle:        _warmStats.lastCycle,
      in_progress:       [..._warmInProgress],
    },
    proxies: proxyStatus,
    summary: {
      total:    proxies.length,
      warmed:   proxyStatus.filter(p => p.last_warm_ago_s !== null).length,
      warming:  proxyStatus.filter(p => p.warming_now).length,
      dead:     proxyStatus.filter(p => p.dead_until).length,
    },
  });
});

app.post('/check', checkLimiter, auth, (req, res) => {
  const accounts = req.body?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0)
    return res.status(400).json({ error: 'accounts must be non-empty array' });
  if (accounts.length > MAX_ACC_PER_JOB)
    return res.status(400).json({ error: `max ${MAX_ACC_PER_JOB} accounts/request` });

  for (const a of accounts) {
    if (!a || typeof a !== 'object' || !a.user || !a.pwd)
      return res.status(400).json({ error: 'each account needs {user, pwd}' });
    if (!String(a.user).includes('@'))
      return res.status(400).json({ error: `invalid email: ${a.user}` });
    if (a.proxy !== undefined && a.proxy !== null && typeof a.proxy !== 'string')
      return res.status(400).json({ error: 'proxy must be a string (scheme://[user:pass@]host:port)' });
  }

  const jobId = crypto.randomBytes(8).toString('hex');
  jobs.set(jobId, {
    status:    'queued',
    results:   [],
    total:     accounts.length,
    done:      0,
    createdAt: Date.now(),
  });

  // Fire-and-forget — client poll/SSE để lấy kết quả
  processJob(jobId, accounts).catch(e => {
    const j = jobs.get(jobId);
    if (j) { j.status = 'error'; j.error = e.message; }
    publish(jobId, 'error', { error: e.message });
    closeSubs(jobId);
  });

  res.json({
    job_id: jobId, total: accounts.length, status: 'queued',
    poll_url:   `/check/${jobId}`,
    stream_url: `/check/${jobId}/stream`,
  });
});

app.get('/check/:job_id', auth, (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json({
    job_id:   req.params.job_id,
    status:   job.status,
    total:    job.total,
    done:     job.done,
    progress: job.total ? Math.round((job.done / job.total) * 100) : 0,
    results:  job.results,
    error:    job.error || null,
  });
});

app.get('/check/:job_id/stream', streamLimiter, auth, (req, res) => {
  const jobId = req.params.job_id;
  const job   = jobs.get(jobId);
  if (!job) return res.status(404).end();

  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Replay state hiện tại để khách connect muộn vẫn thấy progress
  res.write(`event: state\ndata: ${JSON.stringify({ status: job.status, done: job.done, total: job.total })}\n\n`);
  for (const r of job.results) res.write(`event: result\ndata: ${JSON.stringify(r)}\n\n`);

  if (job.status === 'done' || job.status === 'error') {
    res.write(`event: done\ndata: ${JSON.stringify({ done: job.done, total: job.total })}\n\n`);
    return res.end();
  }

  if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
  subscribers.get(jobId).add(res);

  // Keepalive 25s — proxy/CDN thường disconnect idle SSE sau 30s
  const ka = setInterval(() => { try { res.write(':\n\n'); } catch { clearInterval(ka); } }, 25000);

  req.on('close', () => {
    clearInterval(ka);
    const subs = subscribers.get(jobId);
    if (subs) {
      subs.delete(res);
      if (!subs.size) subscribers.delete(jobId);
    }
  });
});

if (WARMER_ENABLED) {
  // Warm lần đầu sau 5s khi server lên (đợi proxies load + reseller workers settle)
  setTimeout(() => warmCycle().catch(e => console.error('[warm] error:', e.message)), 5000).unref();
  setInterval(() => warmCycle().catch(e => console.error('[warm] error:', e.message)), WARMER_INTERVAL_MS).unref();
}

const BIND_HOST = process.env.BIND_HOST || "127.0.0.1"; // default loopback — set BIND_HOST=0.0.0.0 only for a separate-box deploy
app.listen(PORT, BIND_HOST, () => {
  console.log(`\n🚀 Grok API on ${BIND_HOST}:${PORT}  |  concurrency=${MAX_CONCURRENCY}  |  proxies=${proxies.length}${FAST ? '  |  ⚡ FAST' : ''}`);
  console.log(`   POST /check  |  GET /check/:id  |  GET /check/:id/stream  |  GET /stats  |  GET /admin/warm-status`);
  if (WARMER_ENABLED) {
    console.log(`   🔥 Warmer: every ${WARMER_INTERVAL_MS / 60000} min, margin ${WARMER_MARGIN_MS / 60000} min, parallel=${WARMER_PARALLEL}`);
    console.log(`      → cookie luôn ≤ ${(25 - WARMER_MARGIN_MS / 60000)} phút tuổi, có dự phòng cho khách lẻ bất cứ lúc nào`);
  }
  if (!RL_DISABLE) console.log(`   🛡  Rate limit: ${RL_CHECK_PER_MIN}/min /check, ${RL_STREAM_PER_MIN}/min /stream`);
  if (!API_KEY)    console.log(`⚠️  No API_KEY — public access. Set env API_KEY=xxx để bảo vệ.`);
});
