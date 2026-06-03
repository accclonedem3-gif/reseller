'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const pLimit = require('p-limit');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execSync, exec, spawn } = require('child_process');
const { ProxyAgent } = require('undici');

// Profile root cho Chrome. Mỗi proxy có 1 profile dir ổn định (không random)
// → cf_clearance + fingerprint seeds persist giữa các lần launch → skip CF challenge
// cho account thứ 2+ trên cùng proxy.
const PROFILE_ROOT = path.join(os.tmpdir(), 'cgrok-profiles');
try { fs.mkdirSync(PROFILE_ROOT, { recursive: true }); } catch {}

// Profile dir cố định theo proxy — hash(proxyStr) để tên dir ngắn, không có ký tự đặc biệt.
// no-proxy → 'proxy_no-proxy' (dir riêng không lẫn với proxy nào).
function proxyProfileDir(proxy) {
  const key = proxy ? proxyStr(proxy) : 'no-proxy';
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  return path.join(PROFILE_ROOT, 'proxy_' + hash);
}

// Per-proxy mutex: Chrome không cho 2 instance dùng cùng userDataDir đồng thời.
// withProxyLock serialize các lần launch browser cho cùng 1 proxy key — các proxy
// khác nhau vẫn chạy song song.
const _proxyLocks = new Map();
function withProxyLock(key, fn) {
  const prev = _proxyLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  _proxyLocks.set(key, prev.then(() => next));
  return prev.then(() => fn().finally(() => release()));
}

// Cookie domains cần clean trước mỗi account login (tránh dùng session acc cũ).
// Giữ nguyên cookie CF (cf_clearance, __cf_bm, _cfuvid) — đây là thứ ta cần cache.
const CF_COOKIE_KEEP = new Set(['cf_clearance', '__cf_bm', '_cfuvid', '__cflb']);

async function clearAuthCookies(page) {
  try {
    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');
    const toDel = cookies.filter(c =>
      /\.x\.ai$|\.grok\.com$|^x\.ai$|^grok\.com$/.test(c.domain) &&
      !CF_COOKIE_KEEP.has(c.name)
    );
    for (const c of toDel) {
      await client.send('Network.deleteCookies', {
        name: c.name, domain: c.domain, path: c.path || '/',
      }).catch(() => {});
    }
    await client.detach().catch(() => {});
  } catch {}
}

puppeteer.use(StealthPlugin());

// ── Custom Errors ──────────────────────────────────────────────────────────
class BlockedError       extends Error { constructor(m) { super(m); this.name = 'BlockedError';       } }
class TwoFAError         extends Error { constructor(m) { super(m); this.name = 'TwoFAError';         } }
class ProxyDeadError     extends Error { constructor(m) { super(m); this.name = 'ProxyDeadError';     } }
class WrongPasswordError extends Error { constructor(m) { super(m); this.name = 'WrongPasswordError'; } }
// URL vẫn ở trang đăng nhập sau khi submit — chưa xác định được lý do (đổi pass, rate-limit, CF, v.v.)
// → KHÔNG tự coi là sai pass, cần check tay
class LoginStuckError    extends Error { constructor(m) { super(m); this.name = 'LoginStuckError';    } }

// ── Proxy error detection ──────────────────────────────────────────────────
const PROXY_DEFINITE_ERRORS = [
  'err_proxy_connection_failed', 'err_tunnel_connection_failed',
  'err_proxy_certificate_invalid', 'err_proxy_auth_unsupported',
  'net::err_proxy', 'net::err_tunnel',
  'unable to connect to proxy', 'proxy connection failed', 'proxy server error',
];
const CONNECTION_ERRORS = [
  'err_connection_refused', 'err_connection_timed_out', 'err_empty_response',
  'err_connection_reset', 'err_connection_closed', 'err_socket_not_connected',
  'net::err_connection', 'err_name_not_resolved', 'err_internet_disconnected',
];

function isProxyError(str, hasProxy = false) {
  const low = str.toLowerCase();
  if (PROXY_DEFINITE_ERRORS.some(s => low.includes(s))) return true;
  if (hasProxy && CONNECTION_ERRORS.some(s => low.includes(s))) return true;
  return false;
}

async function checkPageProxyError(page, proxy = null) {
  try {
    const text = (await page.evaluate(() => document.body?.innerText || '')).toLowerCase();
    if (PROXY_DEFINITE_ERRORS.some(s => text.includes(s))) return true;
    if (proxy && CONNECTION_ERRORS.some(s => text.includes(s))) return true;
    return false;
  } catch { return false; }
}

// ── Constants ──────────────────────────────────────────────────────────────
const SUPERGROK       = new Set(['SuperGrok']);
const SUPERGROK_HEAVY = new Set(['SuperGrok Heavy']);
const TIER_MAP = {
  SUBSCRIPTION_TIER_GROK_PRO:       'SuperGrok',
  SUBSCRIPTION_TIER_GROK_HEAVY:     'SuperGrok Heavy',
  SUBSCRIPTION_TIER_FREE:           'Free',
  SUBSCRIPTION_TIER_X_PREMIUM:      'X Premium',
  SUBSCRIPTION_TIER_X_PREMIUM_PLUS: 'X Premium+',
  SUBSCRIPTION_TIER_BASIC:          'Basic',
};
const STATUS_MAP = {
  SUBSCRIPTION_STATUS_ACTIVE:    'Active',
  SUBSCRIPTION_STATUS_CANCELLED: 'Cancelled',
  SUBSCRIPTION_STATUS_CANCELED:  'Cancelled',
  SUBSCRIPTION_STATUS_EXPIRED:   'Expired',
  SUBSCRIPTION_STATUS_PENDING:   'Pending',
  SUBSCRIPTION_STATUS_TRIAL:     'Trial',
  SUBSCRIPTION_STATUS_PAUSED:    'Paused',
};
const TZ_OFFSET_HOURS = 7; // UTC+7

// ── Helpers ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function tprint(msg, prefix = '') {
  console.log(prefix ? `[${prefix}] ${msg}` : msg);
}

// ── Fast mode + timing multiplier ──────────────────────────────────────────
// `--fast`: scale các sleep/timeout xuống 0.6x. Floor 50ms để giữ tối thiểu
// cho race condition. T_MULT cũng dùng cho typing delay (gõ user/pass).
const FAST_MODE = process.argv.includes('--fast');
const T_MULT = FAST_MODE ? 0.6 : 1;
const tscale = (ms, floor = 50) => Math.max(floor, Math.round(ms * T_MULT));

// ── Hide Chrome window from taskbar (Windows only) ─────────────────────────
// Strategy: compile the Win32 P/Invoke DLL ONCE and cache it to disk.
// Subsequent runs load the pre-compiled DLL (~50ms) instead of recompiling (~1-2s).
// This closes the race window where Chrome appears in the taskbar before the hider is ready.
// Call BEFORE puppeteer.launch — fire-and-forget. Dedup: no-op on 2nd call.
const HIDE_WIN_CACHE = path.join(os.tmpdir(), 'cgrok_hidewin_v2.dll');
let _windowHiderStarted = false;
function startWindowHider() {
  if (process.platform !== 'win32') return;
  if (_windowHiderStarted) return;
  _windowHiderStarted = true;
  const nodePid = process.pid;
  const cachePath = HIDE_WIN_CACHE.replace(/\\/g, '\\\\');
  const memberDef = `[DllImport("user32.dll")] public static extern int GetWindowLong(System.IntPtr h, int n);
[DllImport("user32.dll")] public static extern int SetWindowLong(System.IntPtr h, int n, int v);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);`;
  const script = `
$cache = '${cachePath}'
$member = @'
${memberDef}
'@
# Load pre-compiled DLL (fast ~50ms). Recompile only when cache is missing or broken.
$loaded = $false
if (Test-Path $cache) {
  try { Add-Type -Path $cache -ErrorAction Stop; $loaded = $true } catch { Remove-Item $cache -Force -ErrorAction SilentlyContinue }
}
if (-not $loaded) {
  try {
    Add-Type -Name H -Namespace W -MemberDefinition $member -OutputAssembly $cache -ErrorAction Stop
    Add-Type -Path $cache -ErrorAction SilentlyContinue
  } catch {
    Add-Type -Name H -Namespace W -MemberDefinition $member -ErrorAction SilentlyContinue
  }
}
$nodePid = ${nodePid}
$done = @{}
for ($i = 0; $i -lt 400; $i++) {
  try {
    Get-CimInstance Win32_Process -Filter "name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { -not $done.ContainsKey($_.ProcessId) } |
    ForEach-Object {
      $ppid = $_.ParentProcessId
      $isOurs = ($ppid -eq $nodePid)
      if (-not $isOurs) {
        $gp = (Get-CimInstance Win32_Process -Filter "ProcessId=$ppid" -ErrorAction SilentlyContinue)
        if ($gp -and $gp.ParentProcessId -eq $nodePid) { $isOurs = $true }
      }
      if ($isOurs) {
        $proc = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainWindowHandle -ne 0) {
          $h = $proc.MainWindowHandle
          $s = ([W.H]::GetWindowLong($h, -20) -bor 0x80) -band (-bnot 0x40000)
          [W.H]::ShowWindow($h, 0) | Out-Null
          [W.H]::SetWindowLong($h, -20, $s) | Out-Null
          [W.H]::SetWindowPos($h, [System.IntPtr]::Zero, 0, 0, 0, 0, 0x37) | Out-Null
          [W.H]::ShowWindow($h, 4) | Out-Null
          $done[$_.ProcessId] = 1
        }
      }
    }
  } catch {}
  Start-Sleep -Milliseconds 50
}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { timeout: 25000 }, () => {});
}

// ── Chrome path ────────────────────────────────────────────────────────────
function findChrome() {
  const candidates = process.platform === 'win32'
    ? [
        process.env.CHROME_PATH,
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]
    : [
        process.env.CHROME_PATH,
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
      ];
  for (const p of candidates.filter(Boolean)) {
    if (fs.existsSync(p)) return p;
  }
  const hint = process.platform === 'win32'
    ? 'Cài Chrome hoặc set CHROME_PATH=<đường dẫn>'
    : 'Cài Chrome: apt-get install -y chromium-browser, hoặc set CHROME_PATH=<đường dẫn>';
  throw new Error(`Không tìm thấy Chrome/Edge. ${hint}`);
}
const CHROME_EXE = findChrome();

// ── Virtual display (Linux VPS — headless: false cần Xvfb để tránh CF detect) ──
let _xvfbProc = null;
async function ensureDisplay() {
  if (process.platform !== 'linux') return;
  if (process.env.DISPLAY) return;
  await new Promise((resolve, reject) => {
    // Tìm display number chưa dùng: thử từ :20
    const num = 20 + (process.pid % 200);
    _xvfbProc = spawn('Xvfb', [`:${num}`, '-screen', '0', '1280x900x24', '-ac'], {
      detached: true, stdio: 'ignore',
    });
    _xvfbProc.unref();
    _xvfbProc.on('error', (e) => reject(new Error(`Xvfb không khởi động được: ${e.message}. Cài với: apt-get install -y xvfb`)));
    setTimeout(() => { process.env.DISPLAY = `:${num}`; resolve(); }, 600);
  });
}

// ── Proxy ──────────────────────────────────────────────────────────────────
function parseProxy(s) {
  if (!s) return null;
  s = s.trim();
  if (!s || s.startsWith('#')) return null;

  let scheme = 'http', user = null, password = null, rest = s;

  if (s.includes('://')) {
    const i = s.indexOf('://');
    scheme = s.slice(0, i).toLowerCase();
    rest = s.slice(i + 3);
    if (rest.includes('@')) {
      const at = rest.lastIndexOf('@');
      const creds = rest.slice(0, at);
      rest = rest.slice(at + 1);
      const ci = creds.indexOf(':');
      if (ci !== -1) { user = creds.slice(0, ci); password = creds.slice(ci + 1); }
      else { user = creds; }
    }
  } else {
    const parts = s.split(':');
    if (parts.length === 4)      { rest = `${parts[0]}:${parts[1]}`; user = parts[2]; password = parts[3]; }
    else if (parts.length === 3) { rest = `${parts[0]}:${parts[1]}`; user = parts[2]; }
  }

  const lc = rest.lastIndexOf(':');
  const host = rest.slice(0, lc);
  const defaultPort = scheme.startsWith('socks') ? 1080 : 8080;
  const port = parseInt(rest.slice(lc + 1)) || defaultPort;
  return { scheme, host, port, user, password };
}

function proxyStr(p) {
  if (!p) return 'không có';
  const a = p.user ? `${p.user}:***@` : '';
  return `${p.scheme}://${a}${p.host}:${p.port}`;
}

// proxyStr che password → không parse ngược được. proxyToRaw giữ full creds để
// rebuild ProxyAgent từ session file. File session nằm local (như proxy.txt).
function proxyToRaw(p) {
  if (!p) return null;
  const a = p.user ? `${p.user}:${p.password || ''}@` : '';
  return `${p.scheme}://${a}${p.host}:${p.port}`;
}

// ── Account session cache (fast API path) ───────────────────────────────────
// Sau login đầu của 1 account: lưu cookie auth (sso...) + UA + proxy. Lần check
// sau (recheck bảo hành) bỏ HẲN browser → ghép cookie auth + cf_clearance nóng
// (warmer refresh mỗi ~10') → gọi thẳng /rest/subscriptions qua undici (~2-3s).
//
// cf_clearance bound theo (IP, UA) nên fast-path PHẢI dùng đúng proxy đã đúc
// session + UA của lần warm gần nhất. cf_clearance TTL ~25' → chỉ nhận CF cache
// còn ≤ CF_FRESH_MS. sso (auth) sống nhiều ngày → SESSION_TTL_MS dài.
//
// AN TOÀN: fast-path chỉ short-circuit khi ĐỌC TIER THÀNH CÔNG. Mọi lỗi
// (session lost / CF block / blocked) → trả null → caller login đầy đủ lại để
// xác nhận → độ chính xác y hệt login thường, chỉ nhanh hơn ở happy path.
const SESSION_DIR     = path.join(__dirname, 'sessions');
try { fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch {}
const SESSION_TTL_MS  = parseInt(process.env.GROK_SESSION_TTL_DAYS || '14') * 86400000;
const CF_FRESH_MS     = parseInt(process.env.GROK_CF_FRESH_MIN     || '20') * 60000;
const SESSION_CACHE_ON = process.env.GROK_NO_SESSION_CACHE !== '1';
const CF_NAMES = new Set(['cf_clearance', '__cf_bm', '_cfuvid', '__cflb']);

function _shash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16); }
function accSessionFile(email) { return path.join(SESSION_DIR, 'acc_' + _shash(String(email).toLowerCase()) + '.json'); }
function cfSessionFile(proxy)  { return path.join(SESSION_DIR, 'cf_'  + _shash(proxy ? proxyStr(proxy) : 'no-proxy') + '.json'); }

function saveAccountSession(email, cookies, userAgent, proxy) {
  if (!SESSION_CACHE_ON || !cookies?.length) return;
  try {
    fs.writeFileSync(accSessionFile(email), JSON.stringify({
      email: String(email).toLowerCase(),
      cookies, userAgent, proxyRaw: proxyToRaw(proxy), savedAt: Date.now(),
    }));
  } catch {}
}
function loadAccountSession(email) {
  try {
    const f = accSessionFile(email);
    if (!fs.existsSync(f)) return null;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!d?.cookies?.length || Date.now() - d.savedAt > SESSION_TTL_MS) return null;
    return d;
  } catch { return null; }
}
function saveCfSession(proxy, cookies, userAgent) {
  if (!SESSION_CACHE_ON) return;
  try {
    const cf = (cookies || []).filter(c => CF_NAMES.has(c.name));
    if (!cf.length) return;
    fs.writeFileSync(cfSessionFile(proxy), JSON.stringify({ cookies: cf, userAgent, savedAt: Date.now() }));
  } catch {}
}
function loadCfSession(proxy) {
  try {
    const f = cfSessionFile(proxy);
    if (!fs.existsSync(f)) return null;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!d?.cookies?.length || Date.now() - d.savedAt > CF_FRESH_MS) return null;
    return d;
  } catch { return null; }
}

// #11 disk-leak fix: session files are written one-per-account (acc_*) and one-per-proxy (cf_*),
// and are only ever READ with a freshness check — never deleted. So acc_* grows unbounded as the
// reseller checks more distinct accounts (disk + inode leak). Sweep hourly and unlink files past
// their usable TTL. mtime-based, so a corrupt JSON file still gets cleaned up.
function pruneSessions() {
  let removed = 0;
  try {
    const now = Date.now();
    const ACC_MAX = SESSION_TTL_MS;                    // acc_* useless past the session TTL
    const CF_MAX  = Math.max(CF_FRESH_MS, 86400000);   // cf_* tiny + per-proxy; clear after a day
    for (const name of fs.readdirSync(SESSION_DIR)) {
      const isAcc = name.startsWith('acc_');
      const isCf  = name.startsWith('cf_');
      if (!isAcc && !isCf) continue;
      const f = path.join(SESSION_DIR, name);
      try {
        const age = now - fs.statSync(f).mtimeMs;
        if (age > (isAcc ? ACC_MAX : CF_MAX)) { fs.unlinkSync(f); removed++; }
      } catch {}
    }
  } catch {}
  if (removed) console.log(`[session] pruned ${removed} stale session file(s)`);
}
if (SESSION_CACHE_ON) {
  try { pruneSessions(); } catch {}                    // sweep once at startup
  const _pruneTimer = setInterval(pruneSessions, 3600_000);
  if (_pruneTimer.unref) _pruneTimer.unref();          // don't keep a CLI invocation alive
}

// Trả result nếu đọc tier thành công qua session cache (không browser); null nếu
// không có session / cần login lại. KHÔNG kết luận "die" ở đây — để login xác nhận.
async function tryFastApiCheck(user, prefix) {
  if (!SESSION_CACHE_ON) return null;
  const acc = loadAccountSession(user);
  if (!acc) return null;
  // cf_clearance bound IP → dùng đúng proxy đã đúc session.
  const apiProxy = acc.proxyRaw ? parseProxy(acc.proxyRaw) : null;
  const cf = loadCfSession(apiProxy);
  let cookies, userAgent;
  if (cf) {
    // Ghép: cookie auth account (bỏ CF cũ) + CF nóng từ warmer. UA = UA của lần
    // warm (cf_clearance bound theo UA đó).
    cookies   = acc.cookies.filter(c => !CF_NAMES.has(c.name)).concat(cf.cookies);
    userAgent = cf.userAgent || acc.userAgent;
  } else {
    // Không có CF nóng → thử cf_clearance lưu kèm session (có thể stale → fallback).
    cookies = acc.cookies; userAgent = acc.userAgent;
  }
  try {
    const r = await fetchSubViaApi(cookies, userAgent, apiProxy, prefix);
    r.proxy  = proxyStr(apiProxy);
    r._fast  = true;
    return r;
  } catch {
    return null; // session lost / CF block / blocked → login đầy đủ để xác nhận
  }
}

// ── CF session cache per proxy ─────────────────────────────────────────────
// Account đầu trên proxy P: pass CF challenge bằng browser (~10-15s) →
// extract cf_clearance + UA → cache theo proxyStr.
// Account 2..N cùng proxy: inject cookies + UA vào browser mới → CF không
// cf_clearance giờ được lưu trực tiếp trong profile dir của Chrome (persistent
// per-proxy) → không cần SESSION_CACHE in-memory nữa.
// sessionEvents giữ lại (empty) để không break import của server.js cũ trong
// thời gian chuyển đổi — server.js sẽ được cập nhật loại bỏ listener này.
const { EventEmitter } = require('events');
const sessionEvents = new EventEmitter();

function loadProxies(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').map(l => parseProxy(l.trim())).filter(Boolean);
}

function removeDeadProxies(file, deadSet) {
  if (!deadSet.size || !fs.existsSync(file)) return;
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const kept = lines.filter(l => {
      const p = parseProxy(l.trim());
      return !p || !deadSet.has(proxyStr(p));
    });
    const removed = lines.length - kept.length;
    if (removed > 0) {
      fs.writeFileSync(file, kept.join('\n'), 'utf8');
      console.log(`🗑️  Đã xoá ${removed} proxy die khỏi ${file}`);
    }
  } catch (e) {
    console.log(`⚠️ Không xoá được proxy: ${e.message}`);
  }
}

// ── Account file ───────────────────────────────────────────────────────────
// Bóc quote bao quanh (CSV export từ Sheets/Excel hay add "..." vào value)
function stripQuotes(s) { return s.replace(/^["'](.*)["']$/, '$1').trim(); }

function splitAccountLine(line) {
  for (const sep of ['|', ';', '\t', ',']) {
    if (line.includes(sep)) {
      const parts = line.split(sep).map(s => stripQuotes(s.trim())).filter(Boolean);
      if (parts.length >= 2 && parts[0].includes('@')) return parts;
    }
  }
  if (line.includes(' ')) {
    const idx = line.indexOf(' ');
    const user = line.slice(0, idx).trim();
    const pwd  = line.slice(idx).trim();
    if (user.includes('@') && pwd) return [user, pwd];
  }
  if (line.includes(':')) {
    const at = line.indexOf('@');
    const ci = at !== -1 ? line.indexOf(':', at + 1) : line.indexOf(':');
    if (ci !== -1) {
      const user = line.slice(0, ci).trim();
      const rest = line.slice(ci + 1).trim();
      if (user.includes('@') && rest) return [user, rest];
    }
  }
  return null;
}

function loadAccounts(file) {
  let content = fs.readFileSync(file, 'utf8');
  // Strip UTF-8 BOM nếu có (Notepad/Excel hay add)
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  // Split trên cả \r\n lẫn \n để khỏi sót \r ở Windows
  return content.split(/\r?\n/)
    .map((raw, i) => ({
      // Trim chuẩn + xử lý whitespace Unicode (NBSP  , zero-width ​, BOM ﻿ lẻ)
      raw: raw.replace(/^[\s ​﻿]+|[\s ​﻿]+$/g, ''),
      i
    }))
    // Bỏ qua dòng rỗng / dòng chỉ chứa whitespace / comment (#)
    .filter(({ raw }) => raw && !raw.startsWith('#'))
    .map(({ raw, i }) => {
      const parts = splitAccountLine(raw);
      if (!parts || parts.length < 2) {
        // Dòng không có @ (header CSV / junk) → skip silently. Chỉ warn nếu thấy @ mà parse fail.
        if (raw.includes('@')) console.log(`⚠️ Dòng ${i + 1} sai format: ${raw}`);
        return null;
      }
      const user = parts[0];
      // Format hỗ trợ:
      //   email|pass              → pwd = parts[1]
      //   email|pass|extra        → pwd = parts[1], extra bỏ qua (vd hotmail pass, email lặp)
      //   email|pass|extra|extra2 → pwd = parts[1], phần còn lại bỏ qua
      const pwd   = parts[1];
      const label = parts.slice(2).join('|');
      return { user, pwd, label };
    })
    .filter(Boolean);
}

// ── Subscription parsing ───────────────────────────────────────────────────
function formatPlan(tier) {
  if (!tier) return 'Free';
  const k = String(tier).trim();
  if (TIER_MAP[k]) return TIER_MAP[k];
  const stripped = k.startsWith('SUBSCRIPTION_TIER_') ? k.slice(18) : k;
  return stripped.split('_').map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function formatStatus(status) {
  if (!status) return 'Unknown';
  const k = String(status).trim();
  if (STATUS_MAP[k]) return STATUS_MAP[k];
  const stripped = k.startsWith('SUBSCRIPTION_STATUS_') ? k.slice(20) : k;
  return stripped[0].toUpperCase() + stripped.slice(1).toLowerCase();
}

const SUB_FIELDS = new Set([
  'tier', 'expiryTime', 'expiry_time', 'currentPeriodEnd', 'current_period_end',
  'plan', 'subscriptionTier', 'subscription_tier', 'status', 'subscriptionStatus',
  'expiresAt', 'expires_at', 'validUntil', 'valid_until',
  'endDate', 'end_date', 'periodEnd', 'period_end',
]);

function findAllSubscriptionDicts(data) {
  const results = [];
  function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (Object.keys(o).filter(k => SUB_FIELDS.has(k)).length >= 2) { results.push(o); return; }
    Object.values(o).forEach(walk);
  }
  walk(data);
  return results;
}

function getExpiryTs(sub) {
  for (const key of ['expiryTime', 'expiry_time', 'currentPeriodEnd', 'expiresAt', 'endDate', 'endTime', 'validUntil', 'periodEnd']) {
    const v = sub[key];
    if (!v) continue;
    try {
      if (typeof v === 'number') return v > 1e12 ? v / 1000 : v;
      return new Date(String(v)).getTime() / 1000;
    } catch {}
  }
  return 0;
}

function pickBestSubscription(subs) {
  if (!subs.length) return null;
  if (subs.length === 1) return subs[0];
  const nowTs = Date.now() / 1000;
  return subs.slice().sort((a, b) => {
    const tsA = getExpiryTs(a), tsB = getExpiryTs(b);
    const sA = String(a.status || a.subscriptionStatus || '').toUpperCase();
    const sB = String(b.status || b.subscriptionStatus || '').toUpperCase();
    const futureA = tsA > nowTs ? 1 : 0, futureB = tsB > nowTs ? 1 : 0;
    const tierA   = (a.tier || a.plan || a.subscriptionTier) ? 1 : 0;
    const tierB   = (b.tier || b.plan || b.subscriptionTier) ? 1 : 0;
    const activeA = sA.includes('ACTIVE') && !sA.includes('INACTIVE') ? 1 : 0;
    const activeB = sB.includes('ACTIVE') && !sB.includes('INACTIVE') ? 1 : 0;
    return (futureB - futureA) || (tierB - tierA) || (activeB - activeA) || (tsB - tsA);
  })[0];
}

const ISO_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

function scanForFutureExpiry(obj) {
  const timestamps = [], isoDates = [];
  const nowTs = Date.now() / 1000;
  function walk(o) {
    if (o === null || o === undefined || typeof o === 'boolean') return;
    if (typeof o === 'number') {
      if (o >= 1.6e9  && o < 1e10)  timestamps.push(o);
      else if (o >= 1.6e12 && o < 1e13) timestamps.push(o / 1000);
    } else if (typeof o === 'string' && ISO_RE.test(o)) {
      isoDates.push(o);
    } else if (Array.isArray(o)) {
      o.forEach(walk);
    } else if (typeof o === 'object') {
      Object.values(o).forEach(walk);
    }
  }
  walk(obj);
  const future = timestamps.filter(t => t > nowTs);
  if (future.length) return Math.max(...future);
  if (isoDates.length) { isoDates.sort(); return isoDates[isoDates.length - 1]; }
  return null;
}

function formatDateLocal(ts) {
  const d = new Date((ts + TZ_OFFSET_HOURS * 3600) * 1000);
  const h = d.getUTCHours() % 12 || 12;
  const ampm = d.getUTCHours() < 12 ? 'AM' : 'PM';
  return `${d.getUTCMonth()+1}/${d.getUTCDate()}/${d.getUTCFullYear()}, ${h}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')} ${ampm}`;
}

const EXPIRY_KEYS = [
  'expiryTime', 'expiry_time', 'currentPeriodEnd', 'current_period_end',
  'billingPeriodEnd', 'expiresAt', 'expires_at', 'endDate', 'end_date', 'endTime',
  'expiry', 'expires', 'expiration', 'validUntil', 'valid_until',
  'nextBillingDate', 'subscriptionEnd', 'periodEnd', 'period_end',
];

function parseSub(data) {
  if (!data || typeof data !== 'object') return null;

  if (data.code === 16 || String(data.message || '').toLowerCase().includes('unauthenticated'))
    return null;

  if (Array.isArray(data?.subscriptions) && data.subscriptions.length === 0)
    return { plan: 'Free', status: 'Unknown', expires: null, daysRemaining: null };

  const allSubs = findAllSubscriptionDicts(data);
  const sub = pickBestSubscription(allSubs);

  if (!sub) {
    // Data CÓ nhưng KHÔNG nhận dạng được subscription (x.ai đổi schema / response lạ).
    // KHÔNG đoán Free — Free giả dạng này từng làm API auto-hoàn acc còn sống (mất tiền).
    // Trả null → caller coi là 'không đọc được' → seller review. Free THẬT đã bắt ở nhánh
    // subscriptions:[] phía trên (mảng rỗng tường minh = chắc chắn Free).
    return null;
  }

  const plan = formatPlan(
    sub.tier || sub.plan || sub.subscriptionTier || sub.subscriptionType ||
    sub.productTier || sub.product || sub.productName || sub.name
  );
  const status     = formatStatus(sub.status || sub.subscriptionStatus || sub.state);
  const cancelAtEnd = sub.cancelAtPeriodEnd ?? sub.cancel_at_period_end ?? null;

  let expiresRaw = null;
  for (const k of EXPIRY_KEYS) { if (sub[k]) { expiresRaw = sub[k]; break; } }
  if (expiresRaw === null) {
    for (const [k, v] of Object.entries(sub)) {
      if (v && /expir|end|until|valid/i.test(k)) { expiresRaw = v; break; }
    }
  }
  if (expiresRaw === null) expiresRaw = scanForFutureExpiry(data);

  let expires = null, daysRemaining = null;
  if (expiresRaw !== null) {
    try {
      let ts;
      if (typeof expiresRaw === 'number') ts = expiresRaw > 1e12 ? expiresRaw / 1000 : expiresRaw;
      else ts = new Date(String(expiresRaw)).getTime() / 1000;
      if (!isNaN(ts)) {
        expires = formatDateLocal(ts);
        daysRemaining = Math.floor((ts - Date.now() / 1000) / 86400);
      }
    } catch {}
  }

  return { plan, status, expires, daysRemaining, cancelAtEnd };
}

// ── Browser helpers ────────────────────────────────────────────────────────
async function getBody(page) {
  try { return await page.evaluate(() => document.body?.innerText || ''); }
  catch { return ''; }
}

async function waitPageReady(page, timeout = 20000) {
  try { await page.waitForFunction(() => document.readyState === 'complete', { timeout }); }
  catch {}
}

async function waitCF(page, timeout = 60000, prefix = '') {
  timeout = tscale(timeout, 5000);
  const sigs = ['Performing security verification', 'Verify you are human', 'Just a moment', 'Checking your browser', 'Cloudflare'];
  const MAX_WAIT_LOGS = 2; // bail sau ~40s chờ CF (2 lần × 20s). CF thường pass trong 5-15s,
                            // 40s là buffer an toàn — ngắn hơn sẽ giảm rủi ro subprocess timeout.
  const t0 = Date.now(); let noted = false, lastLog = t0, waitLogs = 0;
  while (Date.now() - t0 < timeout) {
    if (page.url().toLowerCase().includes('auth-error')) throw new BlockedError('auth-error trong waitCF');
    const text = await getBody(page);
    if (text.trim().length < 80) { await sleep(500); continue; }
    if (!sigs.some(s => text.includes(s)) || text.length >= 500) {
      if (noted) tprint('✅ Đã pass Cloudflare', prefix);
      return true;
    }
    if (!noted) { tprint('🛡️ Cloudflare, đang đợi...', prefix); noted = true; await sleep(3000); continue; }
    if (Date.now() - lastLog > 20000) {
      waitLogs++;
      tprint('⏸️ Vẫn chờ CF...', prefix);
      lastLog = Date.now();
      if (waitLogs >= MAX_WAIT_LOGS) {
        tprint(`❌ CF không pass sau ~${Math.round((Date.now() - t0) / 1000)}s (bail sớm)`, prefix);
        return false;
      }
    }
    await sleep(1000);
  }
  tprint(`❌ CF không pass sau ${timeout / 1000}s`, prefix);
  return false;
}

async function safeClick(page, el) {
  try { await el.evaluate(e => e.scrollIntoView({ block: 'center' })); } catch {}
  try { await el.click(); } catch { await el.evaluate(e => e.click()); }
}

async function findEl(page, sels, timeout = 10000) {
  // GỘP tất cả selector thành 1 (comma) → waitForSelector khớp NGAY khi BẤT KỲ field nào
  // hiện, không phải chờ 3s/selector-sai tuần tự (trước đây phí ~3s mỗi selector không khớp
  // → email + pass tốn ~6s oan). Trả element đầu khớp (đúng field email/pass vì selector đặc
  // trưng, không lẫn nhau). Fallback: nếu combined fail (vài Chrome cũ kén :is), thử tuần tự.
  const combined = sels.join(', ');
  try {
    await page.waitForSelector(combined, { visible: true, timeout });
    const el = await page.$(combined);
    if (el) return el;
  } catch {}
  // Fallback tuần tự (hiếm khi cần) — selector đầu vẫn còn thời gian thì thử nhanh.
  for (const sel of sels) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch {}
  }
  throw new Error(`Not found: ${sels[0]}`);
}

async function clickText(page, text, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const h = await page.evaluateHandle(
      t => [...document.querySelectorAll('button,a,[role="button"]')]
            .find(e => e.offsetParent !== null && e.innerText?.toLowerCase().includes(t)),
      text.toLowerCase()
    );
    const el = h.asElement();
    if (el) return el;
    await sleep(300);
  }
  throw new Error(`Button not found: ${text}`);
}

// Click nút submit/primary của form bằng SELECTOR thay vì text. Text nhãn đổi theo
// release & ngôn ngữ ("Log in"/"Login"/"Sign in"/"Continue"...) → text-match dễ trượt
// và tốn timeout. Selector button[type=submit] ổn định. Trả true nếu click được.
async function clickSubmitButton(page, timeout = 5000) {
  const sels = [
    'button[type="submit"]:not([disabled])',
    'button[data-testid="login-button"]',
    'button[data-testid*="submit" i]',
    'button[data-testid*="login" i]',
    'form button:not([disabled])',
  ];
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (const sel of sels) {
      try {
        const el = await page.$(sel);
        if (el && await el.evaluate(e => e.offsetParent !== null)) {
          await safeClick(page, el);
          return true;
        }
      } catch {}
    }
    await sleep(200);
  }
  return false;
}

// Form gộp của x.ai (&email=true) có Cloudflare turnstile NHÚNG (khác full-page CF
// challenge của waitCF). Bấm Login trước khi turnstile solve xong → submit câm.
// Turnstile khi xong sẽ ghi token vào input[name=cf-turnstile-response]. Poll token
// đó → submit NGAY khi sẵn sàng (vừa đúng vừa nhanh, không cần sleep cứng). Trả true
// nếu thấy token; false nếu hết timeout (vẫn submit — có thể trang không có turnstile).
async function waitTurnstile(page, timeout = 10000, prefix = '') {
  const t0 = Date.now();
  let logged = false;
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(() => {
      const i = document.querySelector('input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]');
      return !!(i && i.value && i.value.length > 20);
    }).catch(() => false);
    if (ok) { if (logged) tprint('✅ turnstile solved', prefix); return true; }
    if (!logged) { logged = true; }
    await sleep(250);
  }
  return false;
}

// goto grok.com chịu được ERR_ABORTED: ngay sau login x.ai TỰ redirect về grok →
// nếu ta goto đúng lúc đó, navigation bị ngắt (ERR_ABORTED). Đã ở grok rồi thì khỏi
// goto; gặp abort thì đợi redirect tự nhiên settle rồi thử lại.
async function gotoGrokSafe(page, prefix = '') {
  for (let i = 0; i < 3; i++) {
    const u = (page.url() || '').toLowerCase();
    if (u.includes('grok.com') && !u.includes('/sign-in')) return;
    try {
      await page.goto('https://grok.com', { waitUntil: 'domcontentloaded', timeout: tscale(30000, 10000) });
      return;
    } catch (e) {
      if (/err_aborted|aborted|navigation/i.test(e.message || '')) {
        await sleep(tscale(900, 500));
        continue; // trang đang tự điều hướng — đợi rồi thử lại
      }
      throw e;
    }
  }
}

// Tìm + click banner cookie trong MỘT round-trip DOM, không poll. Trước đây hàm
// này poll 6 nhãn × 2s = chờ chết tới ~12s/lần (×2 lần gọi = ~24s) khi KHÔNG có
// banner — đó là phần chậm nhất của cold path. Banner đến trễ vẫn an toàn vì
// submit có fallback Enter-key (bỏ qua overlay).
async function dismissCookieBanner(page) {
  try {
    const clicked = await page.evaluate(() => {
      const labels = ['accept all cookies', 'accept all', 'reject all', 'accept', 'agree'];
      for (const el of document.querySelectorAll('button,a,[role="button"]')) {
        if (el.offsetParent === null) continue;
        const t = (el.innerText || '').toLowerCase().trim();
        if (t && labels.some(l => t === l || t.startsWith(l))) { el.click(); return true; }
      }
      return false;
    });
    if (clicked) await sleep(tscale(500));
    return clicked;
  } catch { return false; }
}

// Debug screenshot helper. Saves PNG into the toolgrok cwd with a tagged filename so we
// can later see exactly what the page looked like when a step failed. Disabled with env
// CGROK_DEBUG_SCREENSHOT=0. Best-effort — never throws.
async function debugShot(page, prefix, tag) {
  if (process.env.CGROK_DEBUG_SCREENSHOT === '0') return;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = String(prefix || 'anon').replace(/[^a-z0-9-]/gi, '_').slice(0, 24);
    const fname = `debug_${tag}_${safe}_${ts}.png`;
    await page.screenshot({ path: fname, fullPage: false });
    tprint(`📸 ${tag}: ${fname}`, prefix);
  } catch {}
}

// ── Login ──────────────────────────────────────────────────────────────────
async function doLogin(page, user, pwd, proxy, prefix) {
  const _t0 = Date.now();
  const _el = () => '+' + ((Date.now() - _t0) / 1000).toFixed(1) + 's';
  tprint('Mở sign-in (email mode trực tiếp)...', prefix);
  // &email=true → x.ai render THẲNG form email/password, bỏ bước click "Login with email".
  // return_to giữ query grok-com để redirect sau login về đúng app state.
  await page.goto('https://accounts.x.ai/sign-in?redirect=grok-com&return_to=/?q=%26reasoningMode=none%26voice=false&email=true', { waitUntil: 'domcontentloaded', timeout: tscale(30000, 10000) });
  await waitPageReady(page);
  if (await checkPageProxyError(page, proxy)) throw new ProxyDeadError(proxyStr(proxy));
  // VISIBILITY: cho thấy cookie CF nóng có thật sự được dùng để vượt Cloudflare hay không.
  // cf_clearance đến từ profile/pool đã warm (warmProxy ghi vào CHÍNH profile/browser này).
  try {
    const _cf = (await page.cookies('https://accounts.x.ai')).find(c => c.name === 'cf_clearance');
    tprint(_cf ? '🔥 cf_clearance nóng CÓ SẴN → vượt Cloudflare bằng cookie (không giải lại)'
               : '❄️ KHÔNG có cf_clearance (proxy chưa warm) → phải giải CF từ đầu', prefix);
  } catch {}
  await waitCF(page, 90000, prefix);
  tprint(`🌐 trang + CF xong ${_el()}`, prefix);
  await dismissCookieBanner(page);

  // &email=true thường hiện form luôn. Fallback NHẸ: nếu chưa thấy ô email thì click
  // 1 nút email-mode (text/aria) rồi đợi — KHÔNG lặp 9 nhãn × timeout như cũ (~tốn 6-10s).
  const emailReady = await page.$('input[name="text"], input[type="email"], input[name="email"], input[autocomplete="username"]');
  if (!emailReady) {
    try {
      const h = await page.evaluateHandle(() => {
        for (const el of document.querySelectorAll('button,a,[role="button"]')) {
          if (el.offsetParent === null) continue;
          const t = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
          if (t.includes('email')) return el;
        }
        return null;
      });
      const el = h.asElement();
      if (el) {
        await safeClick(page, el);
        await sleep(tscale(600));
        await waitPageReady(page);
        tprint('📧 email-mode (fallback)', prefix);
      }
    } catch {}
  }

  let emailEl;
  try {
    emailEl = await findEl(page, [
      'input[name="text"]', 'input[type="email"]',
      'input[autocomplete="username"]', 'input[autocomplete="email"]',
      // Newer X.AI variants observed in the wild:
      'input[name="email"]', 'input[name="username"]',
      'input[data-testid="username"]', 'input[data-testid="email"]',
      'input[placeholder*="email" i]', 'input[placeholder*="Email" i]',
    ], 15000);
  } catch (e) {
    await debugShot(page, prefix, 'no_email_input');
    throw e;
  }
  tprint(`📝 thấy ô email ${_el()}`, prefix);
  await emailEl.click({ clickCount: 3 });
  await emailEl.type(user, { delay: tscale(25, 5) });

  // &email=true → form GỘP: ô password đã hiện sẵn cùng trang → KHÔNG bấm Next
  // (bấm Login non khi pass trống = câm submit). Chỉ form 2 bước (pass chưa hiện)
  // mới cần bấm Next để lộ ô password.
  const passShown = await page.$('input[type="password"], input[name="password"]');
  tprint(`✉️ email nhập xong ${_el()} (passShown=${!!passShown})`, prefix);
  if (!passShown) {
    const _okBtn = await clickSubmitButton(page, 6000);
    if (!_okBtn) {
      try { await safeClick(page, await clickText(page, 'Next', 2500)); } catch {}
    }
    tprint(`➡️ bấm Next xong ${_el()} (btn=${_okBtn})`, prefix);
  }

  // Bước xác minh username (ocf) chỉ xuất hiện ở form 2 bước. Form gộp đã có sẵn ô
  // password (passShown) → bỏ qua chờ này (1.5-2.5s thừa mỗi lần).
  if (!passShown) {
    try {
      await page.waitForSelector('input[data-testid="ocfEnterTextTextInput"]', { timeout: 2500 });
      tprint('⚠️ X yêu cầu xác minh username...', prefix);
      await sleep(tscale(3000, 1000));
    } catch {}
  }

  let passEl;
  try {
    passEl = await findEl(page, [
      'input[name="password"]', 'input[type="password"]',
      'input[autocomplete="current-password"]',
    ], 12000);
  } catch (e) {
    await debugShot(page, prefix, 'no_password_input');
    throw e;
  }
  tprint(`🔑 thấy ô pass ${_el()}`, prefix);
  await passEl.click({ clickCount: 3 });
  await passEl.type(pwd, { delay: tscale(25, 5) });
  tprint(`⌨️ CF qua + nhập tk/mk xong ${_el()} → đợi turnstile`, prefix);

  // Đợi turnstile nhúng solve xong (token) → submit ngay. Thay sleep cứng 1.2s.
  await waitTurnstile(page, tscale(10000, 8000), prefix);
  tprint(`🔓 turnstile xong ${_el()} (phần chênh với mốc trên = thời gian turnstile)`, prefix);

  // Dismiss cookie consent banner if it appeared after entering email mode. The banner is
  // injected on a delay (some seconds after navigation) so the early dismiss at the top of
  // doLogin sometimes misses it. When the banner is visible at submit time, its overlay
  // intercepts the click on the Login button → form never submits → URL stuck → falsely
  // surfaced as LoginStuckError. (Discovered via debug_login_stuck screenshots showing a
  // visible "Accept All Cookies" dialog overlapping the bottom of the form.)
  await dismissCookieBanner(page);

  // Submit the password form. Triple-fallback: text-match → semantic selector → Enter key.
  // X.AI rotates the submit button label across releases; a silent no-submit causes the
  // form to stall, RPC never fires, URL stays at /sign-in → 30s poll timeout → falsely
  // surfaces as LoginStuckError. The fallbacks below guarantee the form actually submits.
  // Ưu tiên SELECTOR nút submit → text fallback → Enter key. (Selector ổn định hơn text.)
  let submitted = await clickSubmitButton(page, 4000);
  if (submitted) tprint('▶️  submit via button selector', prefix);
  if (!submitted) {
    for (const label of ['Log in', 'Login', 'Sign in', 'Continue', 'Submit']) {
      try {
        await safeClick(page, await clickText(page, label, 1500));
        submitted = true;
        tprint(`▶️  submit via text="${label}"`, prefix);
        break;
      } catch {}
    }
  }
  if (!submitted) {
    try {
      await passEl.press('Enter');
      submitted = true;
      tprint('▶️  submit via Enter key', prefix);
    } catch {}
  }
  if (!submitted) {
    await debugShot(page, prefix, 'no_submit_button');
    tprint('⚠️  Could not find submit button — login likely to stall', prefix);
  }

  // Đợi NHẸ: chỉ poll tới khi URL RỜI /sign-in (login RPC xong → sso đã set) hoặc gặp
  // auth-error. KHÔNG chờ x.ai bounce hết các bước — rời sign-in là đủ tín hiệu để ép grok.
  {
    const t0 = Date.now();
    const SETTLE_TIMEOUT = tscale(20000, 12000);
    while (Date.now() - t0 < SETTLE_TIMEOUT) {
      // ⚡ Verdict từ JSON RPC của x.ai (sai pass / 2fa / blocked) → break NGAY, khỏi chờ settle.
      if (page.__loginError) break;
      const u = page.url().toLowerCase();
      if (u.includes('auth-error') || !u.includes('/sign-in')) break;
      await sleep(tscale(250, 120));
    }
  }

  // Verdict chính xác từ JSON RPC (ưu tiên trước heuristic URL/text bên dưới).
  if (page.__loginError === 'wrong_password')
    throw new WrongPasswordError('Sai mật khẩu (x.ai RPC: invalid-credentials)');
  if (page.__loginError === '2fa')
    throw new TwoFAError('Tài khoản yêu cầu 2FA (x.ai RPC)');
  if (page.__loginError === 'blocked')
    throw new BlockedError('Tài khoản bị blocked (x.ai RPC)');

  // Block CHỈ khi URL chứa auth-error. Vào được account = bình thường,
  // không tin text trong body (dễ false positive vì page có thể chứa
  // chữ "blocked" ở chỗ khác).
  async function checkLoginState(where) {
    const u = page.url().toLowerCase();
    if (u.includes('auth-error'))
      throw new BlockedError(`Tài khoản bị blocked (${where})`);
    const b = (await getBody(page)).toLowerCase();
    if (b.includes('second factor') || b.includes('verify your account'))
      throw new TwoFAError('Tài khoản yêu cầu 2FA');
    // Sai mật khẩu — dùng full phrase để tránh false positive (chữ "password" + "incorrect" có thể xuất hiện chỗ khác)
    const wrongPassSignals = [
      'password you entered was incorrect',
      'password you entered is incorrect',
      'incorrect password. please try again',
      'wrong password. please try again',
      'the password you entered is incorrect',
      "didn't recognize the password",
    ];
    if (wrongPassSignals.some(s => b.includes(s)))
      throw new WrongPasswordError('Sai mật khẩu');
    // "Email không tồn tại" — X.AI dùng phrase chuyên biệt cho non-existent email.
    // KHÔNG fire RPC invalid-credentials, chỉ hiện text trên page → grep body là cách
    // duy nhất bắt. Customer side thấy "sai mật khẩu" cũng OK vì hành động giống nhau.
    const accountNotFoundSignals = [
      "couldn't find your account",
      "couldn't find an account",
      "we couldn't find your account",
      "account doesn't exist",
      "no account found",
      "unable to find account",
      "this email isn't connected to an account",
      "this email is not connected to an account",
    ];
    if (accountNotFoundSignals.some(s => b.includes(s)))
      throw new WrongPasswordError('Email không tồn tại hoặc sai mật khẩu');
    return u;
  }

  const urlNow = await checkLoginState('sau login');

  // Vẫn kẹt ở sign-in → sai pass / rate-limit / CF / lỗi tạm. KHÔNG kết luận die →
  // LoginStuckError để warranty chuyển PENDING_REVIEW (seller check tay).
  if (urlNow.includes('/sign-in')) {
    await debugShot(page, prefix, 'login_stuck');
    throw new LoginStuckError(`URL vẫn ở sign-in sau login — cần check tay: ${urlNow}`);
  }

  tprint(`🚪 rời sign-in (login OK) ${_el()}`, prefix);

  // ÉP THẲNG về grok.com — bỏ bước "Return to Grok" + chờ x.ai bounce qua account page.
  // CF đã warm trong profile → grok.com load nhanh → đọc session/JSON ngay. gotoGrokSafe
  // chịu ERR_ABORTED do x.ai đang tự redirect về grok.
  await gotoGrokSafe(page, prefix);
  tprint(`🛬 tới grok.com ${_el()}`, prefix);
  // CAP NGẮN: grok.com là SPA nặng, chờ 'complete' tốn ~5s mà KHÔNG cần (fetchSubInPage có
  // retry tự đợi session sẵn). Chỉ cap ~1.5s cho body có mặt để checkLoginState/waitCF đọc.
  await waitPageReady(page, tscale(1500, 1000));
  await checkLoginState('sau goto grok.com'); // grok.com có thể bounce auth-error
  if (await checkPageProxyError(page, proxy)) throw new ProxyDeadError(proxyStr(proxy));
  if (!await waitCF(page, 45000, prefix)) throw new Error('CF chưa pass sau login');
  tprint(`✅ Login xong ${_el()}`, prefix);
}

// ── Cookie + API fetch ─────────────────────────────────────────────────────
// Sau login: bắt cookie + UA từ Chrome → đóng Chrome ngay → gọi /rest/subscriptions
// bằng fetch (undici). Tiết kiệm ~250MB RAM cho mỗi giây của API call và đơn giản
// hoá flow. cf_clearance bound theo (IP, UA) nên phải tái sử dụng cùng proxy + UA.

const GROK_COOKIE_DOMAINS = /(^|\.)grok\.com$|(^|\.)x\.ai$|(^|\.)x\.com$/i;

async function ensureGrokSession(page, proxy, prefix) {
  const cur = (page.url() || '').toLowerCase();
  if (!cur.includes('grok.com') || cur.includes('/rest/') || cur.includes('/sign-in')) {
    await page.goto('https://grok.com', { waitUntil: 'domcontentloaded', timeout: tscale(30000, 10000) });
    await waitPageReady(page);
    if (await checkPageProxyError(page, proxy)) throw new ProxyDeadError(proxyStr(proxy));
    await waitCF(page, 45000, prefix);
  }
  // Đợi nhẹ cho cookie/session grok.com ổn định. in-page fetch đã robust + có undici
  // fallback nên không cần chờ lâu — trim 700→500ms (250ms floor ở fast).
  await sleep(tscale(500, 250));
}

async function extractGrokCookies(page) {
  // CDP Network.getAllCookies trả về MỌI cookie (kể cả HttpOnly) browser đang giữ.
  // Fallback page.cookies(url) nếu CDP fail.
  try {
    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');
    await client.detach().catch(() => {});
    return cookies.filter(c => GROK_COOKIE_DOMAINS.test(c.domain));
  } catch {
    const urls = ['https://grok.com', 'https://accounts.x.ai', 'https://x.com'];
    const out = [];
    for (const u of urls) {
      try { out.push(...(await page.cookies(u))); } catch {}
    }
    return out;
  }
}

function buildProxyDispatcher(proxy) {
  if (!proxy) return null;
  const scheme = (proxy.scheme || 'http').toLowerCase();
  // undici không support SOCKS — fallback no-proxy (sẽ lộ IP server, log để user biết)
  if (scheme.startsWith('socks')) return null;
  const auth = proxy.user
    ? `${encodeURIComponent(proxy.user)}:${encodeURIComponent(proxy.password || '')}@`
    : '';
  return new ProxyAgent(`${scheme}://${auth}${proxy.host}:${proxy.port}`);
}

async function fetchSubViaApi(cookies, userAgent, proxy, prefix) {
  if (!cookies.length) throw new Error('Không có cookie nào sau login');
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const dispatcher  = buildProxyDispatcher(proxy);

  const headers = {
    'Cookie':           cookieHeader,
    'User-Agent':       userAgent,
    'Accept':           'application/json, text/plain, */*',
    'Accept-Language':  'en-US,en;q=0.9',
    'Referer':          'https://grok.com/',
    'Origin':           'https://grok.com',
    'Sec-Fetch-Site':   'same-origin',
    'Sec-Fetch-Mode':   'cors',
    'Sec-Fetch-Dest':   'empty',
  };

  try {
    let data = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      let text = '';
      try {
        const res = await fetch('https://grok.com/rest/subscriptions', {
          method: 'GET',
          headers,
          dispatcher: dispatcher || undefined,
          signal: AbortSignal.timeout(30000),
          redirect: 'manual', // /auth-error redirect → đừng follow, bắt ngay
        });

        // Redirect → có thể bị bounce sang sign-in / auth-error
        if (res.status >= 300 && res.status < 400) {
          const loc = (res.headers.get('location') || '').toLowerCase();
          if (loc.includes('auth-error')) throw new BlockedError('Blocked (redirect auth-error)');
          if (loc.includes('sign-in')) throw new Error(`Session lost (redirect ${loc})`);
          throw new Error(`Unexpected redirect → ${loc}`);
        }

        text = (await res.text()).trim();

        // CF challenge page (HTML thay vì JSON)
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('json') && /<html|cloudflare|just a moment/i.test(text.slice(0, 800))) {
          if (attempt === 1) {
            tprint(`⚠️ CF chặn API (status ${res.status}) → retry sau 3s`, prefix);
            await sleep(3000); continue;
          }
          // Transient CF block — NOT a true account block. Let single-check retry the whole run.
          throw new Error(`CF block API (status ${res.status})`);
        }

        if (res.status === 401 || res.status === 403) {
          if (attempt === 1) {
            tprint(`⚠️ API ${res.status} → retry sau 2s`, prefix);
            await sleep(2000); continue;
          }
          // Session/cookie issue, not necessarily a blocked account. Let single-check retry.
          throw new Error(`API status ${res.status} — session cookie may have expired`);
        }
      } catch (e) {
        lastErr = e;
        if (e.name === 'BlockedError') throw e;
        const msg = (e.message || '').toLowerCase();
        if (proxy && isProxyError(msg, true)) throw new ProxyDeadError(proxyStr(proxy));
        if (attempt === 1) { await sleep(2000); continue; }
        throw e;
      }

      // Parse JSON 1 lần duy nhất, dùng lại cho cả probe + parseSub
      if (text) {
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        const unauth = parsed?.code === 16 ||
          String(parsed?.message || '').toLowerCase().includes('unauthenticated');
        if (parsed && !unauth) { data = parsed; break; }
        if (attempt === 1) {
          tprint(`⚠️ Subscription ${unauth ? 'unauth' : 'parse-fail'} → retry sau 3s`, prefix);
          await sleep(3000);
        }
      } else if (attempt === 1) {
        tprint('⚠️ Subscription rỗng → retry sau 3s', prefix);
        await sleep(3000);
      }
    }

    // KHÔNG đoán Free khi không đọc được — chống auto-hoàn acc còn sống. Báo lỗi → seller review.
    const PARSE_FAIL = { plan: null, status: 'Unknown', expires: null, daysRemaining: null, error: 'subscription_unreadable', error_type: 'parse_fail' };
    if (!data) {
      if (lastErr) throw lastErr;
      return PARSE_FAIL;
    }

    return parseSub(data) || PARSE_FAIL;
  } finally {
    // Giải phóng connection pool của ProxyAgent — tránh leak khi chạy nhiều account
    if (dispatcher) await dispatcher.close().catch(() => {});
  }
}

// ── Resource block (tăng tốc load + nhẹ RAM/băng thông) ─────────────────────
// Chặn image/media/font/stylesheet + tracker. KHÔNG đụng Cloudflare/turnstile/
// accounts.x.ai (cần đủ asset để giải challenge login). Handler page.on('request')
// nhanh & đồng bộ → không deadlock pipeline (KHÁC việc đọc response body trong
// handler — đó mới gây miss). Grok đọc tier qua API JSON nên không phụ thuộc
// DOM/CSS → chặn stylesheet an toàn. Tắt: CGROK_NO_RESOURCE_BLOCK=1.
const RESOURCE_BLOCK_ON = process.env.CGROK_NO_RESOURCE_BLOCK !== '1';
const BLOCK_TYPES   = new Set(['image', 'media', 'font', 'stylesheet']);
const KEEP_DOMAINS  = /challenges\.cloudflare\.com|cloudflare\.com|turnstile|accounts\.x\.ai/i;
const TRACKER_RE    = /google-analytics|googletagmanager|doubleclick|segment\.(io|com)|sentry\.io|datadoghq|mixpanel|hotjar|fullstory|amplitude|clarity\.ms/i;
async function installResourceBlock(page) {
  if (!RESOURCE_BLOCK_ON) return;
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      try {
        const url = req.url();
        if (KEEP_DOMAINS.test(url)) return req.continue();
        if (BLOCK_TYPES.has(req.resourceType())) return req.abort();
        if (TRACKER_RE.test(url)) return req.abort();
        return req.continue();
      } catch { try { req.continue(); } catch {} }
    });
  } catch {}
}

// Bắt verdict login từ JSON RPC của x.ai (giống veo bắt batchexecute của Google). Khi sai pass
// x.ai trả {"error":"[permission_denied] Email or password details are incorrect.
// [WKE=account:invalid-credentials]"} → set page.__loginError='wrong_password' → doLogin trả
// WrongPasswordError CHÍNH XÁC (thay vì login_stuck mơ hồ) và NHANH (break settle-poll ngay).
// Passive listener (không chặn pipeline). Chỉ đọc body XHR/fetch nhỏ trên *.x.ai.
function installLoginErrorWatch(page) {
  page.__loginError = null;
  page.on('response', async (res) => {
    try {
      if (page.__loginError) return;
      const url = res.url();
      if (!/(^|\.)x\.ai/i.test(new URL(url).hostname)) return;
      const rt = res.request().resourceType();
      if (rt !== 'xhr' && rt !== 'fetch') return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json') && !ct.includes('text')) return;
      const text = (await res.text().catch(() => '')).slice(0, 2000);
      if (!text) return;
      if (/invalid-credentials|email or password details are incorrect|incorrect[_ -]?password/i.test(text)) {
        page.__loginError = 'wrong_password';
      } else if (/second[_ -]?factor|two[_ -]?factor|\bmfa\b|\btotp\b|requires?[_ -]?2fa/i.test(text)) {
        page.__loginError = '2fa';
      } else if (/account[:_-]?(suspended|disabled|banned|deactivated)|suspended/i.test(text)) {
        page.__loginError = 'blocked';
      }
    } catch {}
  });
}

// Lấy JSON subscription bằng fetch NGAY TRONG trang đã login (cùng cookie + cf_clearance
// + JA3 thật của Chrome) → nhanh & ít rủi ro hơn undici (khỏi dựng lại cf/JA3). CHỈ trả
// kết quả khi đọc tier SẠCH; mọi nghi ngờ (redirect/401/non-json/unauth) → null để undici
// fallback giữ nguyên phân loại blocked/session-lost ở MỘT chỗ. Passive — không intercept.
// RETRY: gọi API tới khi grok session SẴN SÀNG (trả data hợp lệ) → return NGAY khi có (nhanh
// nếu session sẵn sớm), KHÔNG đọc sớm sai. Nhờ vậy KHÔNG cần chờ grok.com load full
// (waitPageReady 'complete' ~5s) — retry tự đợi đúng lúc session lên. Mọi nghi ngờ (401/
// unauth/chưa sẵn) → thử lại; auth-error (blocked) → null ngay để undici phân loại; hết lượt
// → null → undici fallback → seller review (an toàn tiền, không bao giờ verdict sai).
async function fetchSubInPage(page, prefix, attempts = 6, gapMs = 700) {
  let freeResult = null; // Free verdict — confirm thêm 1 lần (chống blip subscriptions:[] tạm thời).
  for (let i = 0; i < attempts; i++) {
    let r = null;
    try {
      r = await page.evaluate(async () => {
        try {
          const res = await fetch('https://grok.com/rest/subscriptions', {
            credentials: 'include', headers: { 'Accept': 'application/json' },
          });
          return { ok: res.ok, status: res.status, url: res.url, text: await res.text() };
        } catch (e) { return { error: String((e && e.message) || e) }; }
      });
    } catch {}
    if (r && /auth-error/i.test(r.url || '')) return null; // blocked → để undici phân loại
    if (r && !r.error && r.ok && !/sign-in/i.test(r.url || '')) {
      let data; try { data = JSON.parse(r.text); } catch { data = null; }
      const unauth = data?.code === 16 || String(data?.message || '').toLowerCase().includes('unauthenticated');
      if (data && !unauth) {
        const parsed = parseSub(data);
        if (parsed) {
          const isFree = /^free$/i.test(String(parsed.plan || '')) || /^free$/i.test(String(parsed.tier || ''));
          if (!isFree) { tprint(`⚡ JSON in-page (thử ${i + 1}/${attempts})`, prefix); return parsed; } // paid → tin ngay
          // Free → cần thấy 2 lần (chống blip backend grok trả subscriptions:[] nhất thời cho acc paid).
          if (freeResult) { tprint(`⚡ JSON in-page Free x2 (thử ${i + 1})`, prefix); return parsed; }
          freeResult = parsed;
        }
        // parsed===null = parse-fail (không nhận dạng được) → retry; hết vòng → null → undici fallback.
      }
    }
    if (i < attempts - 1) await sleep(gapMs); // session chưa sẵn / Free chờ confirm → đợi rồi thử lại
  }
  if (freeResult) { tprint('⚡ JSON in-page Free (confirm 1 lần)', prefix); return freeResult; }
  return null;
}

// ── Browser launch helper ──────────────────────────────────────────────────
// Tách args + launch ra để cả runAccount và warmProxy dùng chung.
function buildChromeArgs({ hidden, proxy, isLinux }) {
  const disabledFeatures = [
    'PasswordManagerOnboarding', 'TranslateUI', 'OptimizationHints',
    ...(hidden && !isLinux ? ['CalculateNativeWinOcclusion'] : []),
  ].join(',');
  const args = [
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-translate',
    '--metrics-recording-only',
    '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-default-apps', '--disable-hang-monitor',
    '--disable-prompt-on-repost', '--safebrowsing-disable-auto-update',
    '--disable-save-password-bubble',
    `--disable-features=${disabledFeatures}`,
    '--disk-cache-size=1', '--media-cache-size=1',
    '--js-flags=--max-old-space-size=128',
  ];
  if (isLinux) {
    // Linux VPS: Chrome cần no-sandbox; Xvfb cung cấp display ảo thay off-screen trick
    args.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu');
  }
  if (hidden && !isLinux) {
    // Windows: Không dùng headless: 'new' — bị detect bởi Cloudflare/Turnstile.
    // Không dùng --start-minimized — minimize làm visibilityState='hidden' → CF reject.
    // Cách hiện tại: off-screen position + tool-window style (xem startWindowHider).
    args.push(
      '--window-size=1280,900',
      '--window-position=-32000,-32000',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    );
  } else if (!isLinux) {
    args.push('--start-maximized');
  }
  if (proxy) args.push(`--proxy-server=${proxy.scheme}://${proxy.host}:${proxy.port}`);
  return args;
}

async function launchBrowser({ hidden, proxy, profileDir }) {
  await ensureDisplay();
  if (hidden) startWindowHider();
  const isLinux = process.platform === 'linux';
  const args = buildChromeArgs({ hidden, proxy, isLinux });
  const browser = await puppeteer.launch({
    executablePath: CHROME_EXE,
    headless: false, // luôn false — tránh CF/Turnstile detect headless
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: { width: 1280, height: 900 },
    userDataDir: profileDir,
  });
  const [page] = await browser.pages();
  page.setDefaultNavigationTimeout(tscale(30000, 10000));
  if (proxy?.user) await page.authenticate({ username: proxy.user, password: proxy.password });
  await installResourceBlock(page);
  installLoginErrorWatch(page);
  return { browser, page };
}

// ── Browser pool (GROK_POOL=1) ──────────────────────────────────────────────
// Giữ Chrome SỐNG theo proxy → bỏ ~3s launch/check + RAM ổn định lúc cao điểm
// (không spawn/kill storm → ít Chrome zombie). Mirror pool của check_veo.
// withProxyLock đã serialize cùng-proxy → mỗi slot chỉ 1 op tại 1 thời điểm; pool
// lo: giữ sống, cap tổng browser (POOL_MAX), evict LRU, reap idle, relaunch khi crash.
// cf_clearance nằm trong userDataDir per-proxy nên TÁI DÙNG default page (clearAuthCookies
// giữ CF) — KHÔNG dùng incognito (incognito mất cf_clearance của profile).
function poolEnabled() { return process.env.GROK_POOL === '1'; }
const POOL_MAX      = parseInt(process.env.GROK_POOL_MAX || '6');
const POOL_IDLE_TTL = parseInt(process.env.GROK_POOL_IDLE_MIN || '5') * 60000;
const _pool = new Map(); // proxyKey → { browser, page, proxy, inUse, lastUsed }
let _poolReaper = null;

function poolKey(proxy) { return proxy ? proxyStr(proxy) : 'no-proxy'; }
function slotAlive(s) {
  try { return s && s.browser && s.browser.isConnected() && s.page && !s.page.isClosed(); }
  catch { return false; }
}

async function acquireSlot(proxy, hidden) {
  ensurePoolReaper();
  const key = poolKey(proxy);
  const existing = _pool.get(key);
  if (existing) {
    if (slotAlive(existing)) { existing.inUse = true; existing.lastUsed = Date.now(); return existing; }
    try { await existing.browser?.close(); } catch {}
    _pool.delete(key);
  }
  // Cap → evict slot idle cũ nhất (proxy khác) để nhường chỗ.
  if (_pool.size >= POOL_MAX) {
    let oldest = null;
    for (const s of _pool.values()) if (!s.inUse && (!oldest || s.lastUsed < oldest.lastUsed)) oldest = s;
    if (oldest) {
      try { await oldest.browser.close(); } catch {}
      _pool.delete(poolKey(oldest.proxy));
      console.log(`[pool] evict idle ${poolKey(oldest.proxy)} → nhường ${key}`);
    }
  }
  const launched = await launchBrowser({ hidden, proxy, profileDir: proxyProfileDir(proxy) });
  const slot = { browser: launched.browser, page: launched.page, proxy, inUse: true, lastUsed: Date.now() };
  _pool.set(key, slot);
  console.log(`[pool] launch slot ${_pool.size}/${POOL_MAX} cho ${key}`);
  return slot;
}

async function releaseSlot(slot, drop = false) {
  if (!slot) return;
  if (drop || !slotAlive(slot)) {
    try { await slot.browser?.close(); } catch {}
    _pool.delete(poolKey(slot.proxy));
    return;
  }
  slot.inUse = false;
  slot.lastUsed = Date.now();
  // Dọn page nặng (grok.com app) → giảm RAM khi idle. CF cookie nằm ở profile, không mất.
  try { await slot.page.goto('about:blank', { timeout: 3000 }); } catch {}
}

function ensurePoolReaper() {
  if (_poolReaper) return;
  _poolReaper = setInterval(() => {
    const now = Date.now();
    for (const [key, s] of _pool) {
      if (!s.inUse && now - s.lastUsed > POOL_IDLE_TTL) {
        s.browser?.close().catch(() => {});
        _pool.delete(key);
        console.log(`[pool] reap idle ${key}`);
      }
    }
  }, 60000);
  _poolReaper.unref?.();
}

// Diệt Chrome trong pool khi tiến trình thoát (chống zombie). Windows: taskkill /T (tree)
// để giết cả renderer con — kill('SIGKILL') chỉ giết process chính, con sẽ mồ côi.
function killAllPoolSync() {
  for (const s of _pool.values()) {
    try {
      const proc = s.browser?.process();
      if (proc?.pid) {
        if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
        else proc.kill('SIGKILL');
      }
    } catch {}
  }
  _pool.clear();
}
process.once('exit', killAllPoolSync);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { killAllPoolSync(); process.exit(0); });
}

// ── Run one account ────────────────────────────────────────────────────────
async function runAccount(user, pwd, hidden, proxy, delay = 0) {
  if (delay) await sleep(delay);
  const prefix  = user.split('@')[0].slice(0, 12);

  // ⚡ FAST PATH: session cache → gọi API trực tiếp, không browser (~2-3s).
  // Chỉ nhận khi đọc tier OK; lỗi nào cũng rơi xuống login đầy đủ bên dưới.
  const fast = await tryFastApiCheck(user, prefix);
  if (fast && !fast.error) {
    tprint('⚡ fast-path (session cache) — không mở Chrome', prefix);
    return fast;
  }

  const lockKey = proxy ? proxyStr(proxy) : 'no-proxy';
  // Serialize trong cùng proxy — Chrome không cho 2 instance share userDataDir.
  return withProxyLock(lockKey, async () => {
    const profileDir = proxyProfileDir(proxy);
    const usePool = poolEnabled();
    let browser, page, slot = null, crashed = false;
    try {
      if (usePool) {
        slot = await acquireSlot(proxy, hidden); // tái dùng Chrome sống — bỏ ~3s launch
        browser = slot.browser; page = slot.page;
      } else {
        const launched = await launchBrowser({ hidden, proxy, profileDir });
        browser = launched.browser; page = launched.page;
      }

      // Xóa cookie auth cũ của x.ai/grok.com trước khi login account mới.
      // Giữ nguyên cf_clearance/__cf_bm/_cfuvid → CF bypass nhờ profile persist.
      await clearAuthCookies(page);

      await doLogin(page, user, pwd, proxy, prefix);
      const _tp = Date.now();  // đo khúc sau Login-xong: ensureGrokSession + extract + đọc API

      // Đảm bảo đã ở grok.com + CF clear → cookie đầy đủ
      await ensureGrokSession(page, proxy, prefix);

      const userAgent = await page.evaluate(() => navigator.userAgent);
      const cookies   = await extractGrokCookies(page);

      // Lưu session để lần check sau (recheck bảo hành) đi fast-path không browser.
      saveAccountSession(user, cookies, userAgent, proxy);
      saveCfSession(proxy, cookies, userAgent);

      // ⚡ Lấy JSON SỚM bằng in-page fetch (trong Chrome đã login) trước khi đóng.
      let result = await fetchSubInPage(page, prefix);
      tprint(`📦 ${cookies.length} cookie${usePool ? ' (pool)' : ', đóng Chrome'}${result ? ' · JSON in-page' : ' → undici'} | sau-login +${((Date.now() - _tp) / 1000).toFixed(1)}s`, prefix);

      // Non-pool: đóng SỚM free ~250MB. Pool: giữ browser sống cho account sau.
      if (!usePool) { await browser.close().catch(() => {}); browser = null; }

      // Fallback undici nếu in-page miss/redirect/nghi ngờ → giữ phân loại blocked/session-lost.
      if (!result) result = await fetchSubViaApi(cookies, userAgent, proxy, prefix);
      result.proxy = proxyStr(proxy);
      return result;
    } catch (e) {
      if (/target closed|session closed|connection closed|detached|protocol error|disconnected/i.test(String(e?.message || '').toLowerCase())) crashed = true;
      const types = { BlockedError: 'blocked', TwoFAError: '2fa', ProxyDeadError: 'proxy_die', WrongPasswordError: 'wrong_password', LoginStuckError: 'login_stuck' };
      const errType = types[e.name] || (proxy && isProxyError(e.message, true) ? 'proxy_die' : 'die');
      return { error: e.message, error_type: errType, proxy: proxyStr(proxy) };
    } finally {
      // Pool: release (giữ sống) hoặc drop nếu crash. Non-pool: đóng hẳn.
      // KHÔNG xóa profileDir — cần giữ cf_clearance + fingerprint cho account sau.
      if (usePool) await releaseSlot(slot, crashed);
      else await browser?.close().catch(() => {});
    }
  });
}

// ── Warm proxy (CF cache prefill) ──────────────────────────────────────────
// Mở Chrome với proxy, qua CF challenge cho accounts.x.ai + grok.com, lấy
// cf_clearance, lưu vào SESSION_CACHE — KHÔNG login account. Dùng cho
// background warmer chạy 24/7 để khách lúc nào cũng có cache nóng.
async function warmProxy(proxy, hidden = true) {
  const prefix  = `warm-${(proxy?.host || 'no-proxy').slice(0, 10)}`;
  const lockKey = proxy ? proxyStr(proxy) : 'no-proxy';
  // Dùng cùng profile dir với runAccount → warmProxy ghi cf_clearance vào đúng
  // profile mà account sau sẽ dùng → fingerprint match → CF bypass thật sự.
  return withProxyLock(lockKey, async () => {
    const profileDir = proxyProfileDir(proxy);
    const usePool = poolEnabled();
    let browser, page, slot = null, crashed = false;
    try {
      // Pool: warm TRÊN CHÍNH browser sống của proxy đó (tránh 2 Chrome đụng userDataDir
      // + cf_clearance warm nằm sẵn trong browser khách sẽ dùng). Non-pool: launch riêng.
      if (usePool) {
        slot = await acquireSlot(proxy, hidden); browser = slot.browser; page = slot.page;
      } else {
        const launched = await launchBrowser({ hidden, proxy, profileDir });
        browser = launched.browser; page = launched.page;
      }

      // 1. accounts.x.ai/sign-in → CF cấp cf_clearance cho .x.ai
      await page.goto('https://accounts.x.ai/sign-in?redirect=grok-com', {
        waitUntil: 'domcontentloaded', timeout: tscale(30000, 10000),
      });
      await waitPageReady(page);
      if (await checkPageProxyError(page, proxy)) throw new ProxyDeadError(proxyStr(proxy));
      if (!await waitCF(page, 60000, prefix)) throw new Error('CF chưa pass cho accounts.x.ai');

      // 2. grok.com → CF cấp cf_clearance cho .grok.com (domain riêng)
      await page.goto('https://grok.com', {
        waitUntil: 'domcontentloaded', timeout: tscale(30000, 10000),
      });
      await waitPageReady(page);
      if (await checkPageProxyError(page, proxy)) throw new ProxyDeadError(proxyStr(proxy));
      if (!await waitCF(page, 45000, prefix)) throw new Error('CF chưa pass cho grok.com');
      await sleep(tscale(800));

      const cookies   = await extractGrokCookies(page);
      const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);
      // Lưu cf_clearance nóng theo proxy → fast-path ghép vào cookie auth account.
      saveCfSession(proxy, cookies, userAgent);
      if (!usePool) { await browser.close().catch(() => {}); browser = null; }
      // cf_clearance đã được Chrome lưu trong profileDir → không cần saveSession()
      return { ok: true, cookies: cookies.length, proxy: proxyStr(proxy) };
    } catch (e) {
      if (/target closed|session closed|connection closed|detached|protocol error|disconnected/i.test(String(e?.message || '').toLowerCase())) crashed = true;
      const isProxy = e.name === 'ProxyDeadError' || (proxy && isProxyError(e.message, true));
      return {
        ok: false,
        error: e.message,
        error_type: isProxy ? 'proxy_die' : 'die',
        proxy: proxyStr(proxy),
      };
    } finally {
      if (usePool) await releaseSlot(slot, crashed);
      else await browser?.close().catch(() => {});
      // KHÔNG xóa profileDir — cần giữ cf_clearance
    }
  });
}

// ── Cleanup ────────────────────────────────────────────────────────────────
function postRunCleanup() {
  try { execSync('taskkill /F /IM chromedriver.exe', { stdio: 'ignore' }); } catch {}
  // Xóa các dir ngẫu nhiên còn sót (vd Chrome crash trước khi chạy code fix này).
  // Các dir proxy_ là profile ổn định → KHÔNG xóa (chứa cf_clearance cho lần sau).
  try {
    for (const entry of fs.readdirSync(PROFILE_ROOT)) {
      if (!entry.startsWith('proxy_')) {
        fs.rmSync(path.join(PROFILE_ROOT, entry), { recursive: true, force: true, maxRetries: 3 });
      }
    }
  } catch {}
}

// ── Output ─────────────────────────────────────────────────────────────────
// Bucket phân loại:
//   block     = X.AI báo blocked (auth-error URL) → account CHẾT chắc chắn
//   wrongpass = sai mật khẩu (có signal text rõ ràng)
//   proxydie  = proxy không kết nối được → account chưa kết luận được
//   unknown   = login_stuck / 2fa / CF fail / network / Chrome crash
//               → KHÔNG kết luận account chết. Cần check tay hoặc retry IP khác.
//               (vd: X rate-limit IP local → bounce sign-in im lặng — account
//               có thể vẫn còn SuperGrok!)
function getTag(result) {
  if (!result || result.error) {
    const et = result?.error_type;
    if (et === 'blocked')        return 'block';
    if (et === 'wrong_password') return 'wrongpass';
    if (et === 'proxy_die')      return 'proxydie';
    return 'unknown';
  }
  const p = result.plan || '';
  if (SUPERGROK_HEAVY.has(p)) return 'heavy';
  if (SUPERGROK.has(p))       return 'supergrok';
  return 'free';
}

const ERROR_TAG_DISPLAY = {
  block:     'BLOCK',
  wrongpass: 'WRONGPASS',
  proxydie:  'PROXYDIE',
  unknown:   'UNKNOWN',
};

function printResult(idx, total, user, pwd, label, result) {
  const acc = label ? `${user}|${pwd}|${label}` : `${user} ${pwd}`;
  if (!result || result.error) {
    const tag = ERROR_TAG_DISPLAY[getTag(result)] || 'UNKNOWN';
    const reason = result?.error ? ` (${result.error_type || 'unknown'}: ${result.error})` : '';
    console.log(`[${idx}/${total}] ${tag} | ${acc}${reason}`);
    return;
  }
  const p = result.plan || '';
  const tag = SUPERGROK_HEAVY.has(p) ? 'HEAVY' : SUPERGROK.has(p) ? 'SUPERGROK' : 'FREE';
  const extra = result.expires ? ` | Hết hạn: ${result.expires}` : '';
  console.log(`[${idx}/${total}] ${tag} | ${acc}${extra}`);
}

// Mã trạng thái cho cột status_code trong CSV — dễ filter/sort trong Google Sheets
// 1=Heavy | 2=SuperGrok | 3=Free | 4=WrongPass | 5=Block | 6=Unknown | 7=ProxyDie
const STATUS_CODE = {
  heavy: 1, supergrok: 2, free: 3,
  wrongpass: 4, block: 5, unknown: 6, proxydie: 7,
};

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function saveResults(results, outFile) {
  const g = { heavy: [], supergrok: [], free: [], wrongpass: [], block: [], proxydie: [], unknown: [] };
  const csvRows = [['status_code','status','email','password','label','plan','expires','days_remaining','proxy','error_type','error']];
  for (const { user, pwd, label, result } of results) {
    const acc = label ? `${user}|${pwd}|${label}` : `${user} ${pwd}`;
    const tag = getTag(result);
    (g[tag] || g.unknown).push(acc);
    const r = result || {};
    csvRows.push([
      STATUS_CODE[tag] || 6,
      tag.toUpperCase(),
      user, pwd, label || '',
      r.plan || '',
      r.expires || '',
      r.daysRemaining ?? '',
      r.proxy || '',
      r.error_type || '',
      r.error || '',
    ]);
  }
  // File riêng từng loại (chỉ tạo nếu có dữ liệu)
  const base = outFile.replace(/\.txt$/, '');
  const saved = [];
  for (const k of ['heavy', 'supergrok', 'free', 'wrongpass', 'block', 'proxydie', 'unknown']) {
    if (g[k].length > 0) {
      const f = `${base}_${k}.txt`;
      fs.writeFileSync(f, g[k].join('\n'), 'utf8');
      saved.push(`  📄 ${k.toUpperCase()} (${g[k].length}): ${f}`);
    }
  }
  // CSV để import Google Sheets (UTF-8 BOM để Excel/Sheets đọc đúng tiếng Việt)
  const csvFile = `${base}.csv`;
  const csvContent = '﻿' + csvRows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  fs.writeFileSync(csvFile, csvContent, 'utf8');
  saved.push(`  📊 CSV (${csvRows.length - 1} dòng): ${csvFile}`);
  if (saved.length) console.log('\n' + saved.join('\n'));

  return g;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const get  = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };
  const has  = flag => argv.includes(flag);

  const accountFile = get('-f', 'accounts.txt');
  const outFile     = get('-o', `grok_results_${new Date().toISOString().slice(0,19).replace(/[T:]/g,'').replace(/-/g,'')}.txt`);
  const showBrowser = has('--show-browser');
  let threads       = parseInt(get('-t', '0')) || 0;

  if (!threads) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    threads = await new Promise(r => rl.question('Nhập số luồng (Enter = 1): ', a => { rl.close(); r(parseInt(a) || 1); }));
  }

  let proxies = [];
  const proxyArg  = get('-p', null) || get('--proxy', null);
  const proxyFile = get('--proxy-file', null);
  let proxyFileSrc = null;

  if (proxyFile) {
    proxyFileSrc = proxyFile;
    proxies = loadProxies(proxyFile);
    if (proxies.length) console.log(`✅ Đọc được ${proxies.length} proxy từ: ${proxyFile}`);
    else console.log(`⚠️ Không đọc được proxy nào từ: ${proxyFile}`);
  } else if (proxyArg) {
    const p = parseProxy(proxyArg);
    if (p) proxies = [p]; else console.log(`❌ Proxy không hợp lệ: ${proxyArg}`);
  } else if (fs.existsSync('proxy.txt')) {
    proxyFileSrc = 'proxy.txt';
    proxies = loadProxies('proxy.txt');
    if (proxies.length) console.log(`✅ Đọc được ${proxies.length} proxy từ: proxy.txt`);
  }

  let accounts;
  try { accounts = loadAccounts(accountFile); }
  catch { console.log(`❌ Không tìm thấy: ${accountFile}`); process.exit(1); }

  if (!accounts.length) { console.log('⚠️ Không có account hợp lệ.'); process.exit(1); }

  console.log(`\n=== GROK CHECKER ===`);
  console.log(`   Accounts: ${accounts.length}  |  Luồng: ${threads}  |  Chrome: ${showBrowser ? 'hiện' : 'ẩn'}${FAST_MODE ? '  |  ⚡ FAST' : ''}`);
  if (proxies.length) console.log(`   Proxy:    ${proxies.length} proxy (${proxyStr(proxies[0])}${proxies.length > 1 ? ' ...' : ''})`);
  else                console.log(`   Proxy:    không dùng`);
  if (FAST_MODE) console.log(`   ⚡ Fast mode: timeout x${T_MULT}, retry ${2}, stagger 800ms, CF session cache per proxy`);
  console.log();

  const deadProxies = new Set();

  function markProxyDead(pStr) {
    if (!pStr || pStr === 'không có' || deadProxies.has(pStr)) return;
    deadProxies.add(pStr);
    const idx = proxies.findIndex(p => proxyStr(p) === pStr);
    if (idx !== -1) proxies.splice(idx, 1);
    if (proxyFileSrc) removeDeadProxies(proxyFileSrc, deadProxies);
  }

  // Offset cho retry — mỗi lần retry shift proxy index để account dùng IP khác
  // (quan trọng cho login_stuck — X rate-limit IP cũ).
  let proxyOffset = 0;
  function getProxy(idx) {
    return proxies.length ? proxies[(idx + proxyOffset) % proxies.length] : null;
  }

  const limit = pLimit(threads);
  // Chỉ những lỗi DEFINITIVE mới NO_RETRY:
  //   - blocked       : X.AI báo chết rõ ràng
  //   - wrong_password: có signal text "incorrect password"
  //   - 2fa           : cần manual setup, retry không help
  // login_stuck KHÔNG NO_RETRY nữa — nếu có proxy thì retry với IP khác có thể
  // unstick. Nếu KHÔNG có proxy thì cũng retry để loại trừ CF/rate-limit blip
  // (chấp nhận tốn thời gian nhưng đỡ false-classify SuperGrok thành UNKNOWN).
  // proxy_die cũng KHÔNG NO_RETRY — proxy chết được markProxyDead, retry sẽ
  // tự sang proxy còn sống (nếu có).
  const NO_RETRY = new Set(['blocked', 'wrong_password', '2fa']);

  async function runBatch(batch, pfx = '') {
    const out = new Array(batch.length);
    // Stagger CHỈ wave đầu (i < threads) để khỏi burst launch Chrome đồng loạt.
    // Account sau đó: slot trống → start ngay → giữ đủ N luồng liên tục.
    const STAGGER_MS = FAST_MODE ? 800 : 1500;
    await Promise.all(batch.map(({ user, pwd, label }, i) => limit(async () => {
      console.log(`\n${pfx}[${i + 1}/${batch.length}] ${user}`);
      const proxy  = getProxy(i);
      const delay  = (threads > 1 && i < threads) ? i * STAGGER_MS : 0;
      const result = await runAccount(user, pwd, !showBrowser, proxy, delay);
      if (result?.error_type === 'proxy_die') markProxyDead(result.proxy);
      out[i] = { user, pwd, label, result };
      printResult(i + 1, batch.length, user, pwd, label, result);
    })));
    return out;
  }

  let results = await runBatch(accounts);

  // Retry các account chưa kết luận được — gồm UNKNOWN (login_stuck/CF/network)
  // và PROXYDIE. Mỗi vòng shift proxyOffset → account dùng IP khác → tăng
  // khả năng unstick X rate-limit.
  // FAST_MODE giảm xuống 2 retry; bình thường 4 retry vì batch lớn cần buffer.
  const MAX_RETRIES = 1;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const failed = results.filter(r => r.result?.error && !NO_RETRY.has(r.result?.error_type));
    if (!failed.length) break;
    proxyOffset++;  // shift IP cho retry này
    const why = failed.some(r => r.result?.error_type === 'login_stuck')
      ? ' (gồm login_stuck — thử IP khác)' : '';
    console.log(`\n${'='.repeat(50)}\n🔄 Retry ${attempt}/${MAX_RETRIES}: ${failed.length} account${why}\n`);
    const retried = await runBatch(failed, `[RETRY ${attempt}] `);
    const map = Object.fromEntries(retried.map(r => [r.user, r]));
    results = results.map(r =>
      (r.result?.error && !NO_RETRY.has(r.result?.error_type)) ? (map[r.user] || r) : r
    );
  }

  const g = saveResults(results, outFile);
  console.log(`\nHeavy: ${g.heavy.length}  |  SuperGrok: ${g.supergrok.length}  |  Free: ${g.free.length}  |  WrongPass: ${g.wrongpass.length}  |  Block: ${g.block.length}  |  ProxyDie: ${g.proxydie.length}  |  Unknown: ${g.unknown.length}`);
  if (g.unknown.length) {
    console.log(`⚠️  UNKNOWN (${g.unknown.length}): login_stuck/2fa/CF-fail — KHÔNG kết luận chết. Check ${outFile.replace(/\.txt$/, '')}_unknown.txt`);
    console.log(`    Lý do thường gặp: X.AI rate-limit IP (dùng proxy/đợi vài tiếng), CF blip, 2FA bật. Thử lại proxy khác trước khi coi là chết.`);
  }
  console.log('\n🧹 Đang dọn dẹp...');
  postRunCleanup();
  console.log('✅ Xong.');
}

module.exports = {
  runAccount, warmProxy, parseProxy, proxyStr, loadProxies,
  proxyProfileDir, sessionEvents,
  postRunCleanup, startWindowHider,
};

if (require.main === module) {
  main().catch(console.error);
}
