/**
 * PM2 ecosystem for prod. Four processes, all `fork` mode (no cluster):
 *   - reseller-api      : NestJS HTTP, talks to Postgres + Redis, exposes warranty endpoints
 *   - reseller-worker   : BullMQ consumer, spawns single-check.js subprocesses as fallback
 *   - reseller-grok-srv : CheckGrokJS HTTP server, CF cookie warmer for grok fast-path
 *   - reseller-veo-srv  : check_veo HTTP server, Chromium browser pool for veo fast-path
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE KNOB — `DEPLOY_TIER` (4gb | 6gb | 8gb, default 4gb)
 * ─────────────────────────────────────────────────────────────────────────────
 * Sizes every pool / concurrency / RAM-cap for the VPS you deploy on. Set it once:
 *     DEPLOY_TIER=6gb pm2 start ecosystem.config.cjs
 * Any individual env var below STILL overrides the tier (fine-tune as needed).
 *
 * Tier table (chosen for SPEED without hurting verdict ACCURACY):
 *   4gb  → veo pool=1 (serial), grok pool=2, 1 job/lúc, 2 acc/job. Conservative; veo multi-acc
 *          orders run serially. Bumping veo→2 on 4GB risks OOM → mid-check crash → WORSE accuracy.
 *   6gb  → veo pool=2 (parallel), grok pool=2. A multi-account veo order ~halves wall-clock.
 *   8gb+ → veo pool=2, grok pool=3, 2 jobs/lúc, 3 acc/job. Fastest. Still verdict-safe.
 *
 * WHY NO `--fast` ON GROK: the grok server's --fast (T_MULT=0.6) shrinks EVERY timeout/turnstile/
 * CF wait by 0.6×. On a flaky VN proxy a slow-but-valid CF/turnstile would be cut early → a false
 * timeout/parse-fail → WRONG verdict (and "logic sai là chết tiền"). We buy speed only from pool
 * reuse + the CF warmer + parallelism — NEVER by shortening the windows a verdict depends on.
 *
 * Other tuning notes:
 *   - max_memory_restart caps RAM per process (PM2 restarts before OS OOM-kill). Scales with tier.
 *   - NODE_OPTIONS heap caps shrink V8 max heap (separate from Chromium RSS).
 *   - Keep GROK_POOL_MAX ≈ số proxy sống (tránh warmer evict/relaunch-thrash). Có ~4 proxy → 2-3 ok.
 *   - veo MAX_CONCURRENCY phải ≤ POOL_MAX (server tự clamp, nhưng tier giữ chúng khớp).
 *   - Tool server paths are siblings of the reseller repo; override with
 *     CHECK_GROK_SERVER_PATH / CHECK_VEO_SERVER_PATH if elsewhere.
 *   - Set CHECK_VEO_DISABLED=1 to skip the veo server (very tight RAM) → veo falls back to a
 *     per-check single-check.js subprocess (slower, but no idle browser RAM).
 *   - Always pulls env from the OS (PM2 inherits env from shell or `pm2 start --env`).
 */
const path = require("node:path");

const CHECK_GROK_SERVER_PATH =
  process.env.CHECK_GROK_SERVER_PATH ||
  path.resolve(__dirname, "..", "CheckGrokJS", "server.js");

const CHECK_VEO_SERVER_PATH =
  process.env.CHECK_VEO_SERVER_PATH ||
  path.resolve(__dirname, "..", "check_veo", "server.js");

const VEO_DISABLED = process.env.CHECK_VEO_DISABLED === "1";

// ── Deploy-tier profiles. One knob sizes everything; per-var env still overrides. ──
const TIERS = {
  "4gb": {
    apiMem: "500M", apiHeap: "512", workerMem: "1G", workerHeap: "768",
    workerConc: "1", perJob: "2",
    grokPool: "1", grokPoolMax: "2", grokConc: "2", grokWarmerPar: "1", grokMem: "1G",
    veoPoolMax: "1", veoConc: "1", veoMem: "700M",
  },
  "6gb": {
    apiMem: "600M", apiHeap: "512", workerMem: "1G", workerHeap: "768",
    workerConc: "1", perJob: "2",
    grokPool: "1", grokPoolMax: "2", grokConc: "2", grokWarmerPar: "1", grokMem: "1G",
    veoPoolMax: "2", veoConc: "2", veoMem: "1100M",
  },
  "8gb": {
    apiMem: "768M", apiHeap: "640", workerMem: "1536M", workerHeap: "1024",
    workerConc: "2", perJob: "3",
    grokPool: "1", grokPoolMax: "3", grokConc: "3", grokWarmerPar: "2", grokMem: "1536M",
    veoPoolMax: "2", veoConc: "2", veoMem: "1200M",
  },
};
const TIER = String(process.env.DEPLOY_TIER || "4gb").toLowerCase();
const T = TIERS[TIER] || TIERS["4gb"];

module.exports = {
  apps: [
    {
      name: "reseller-api",
      script: "apps/api/dist/main.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: T.apiMem,
      env: {
        NODE_ENV: "production",
        // Pin app TZ to GMT+7 so all server-side date formatting (warranty expiry/cooldown lines,
        // batch-bypass delivered date) matches Vietnam even on a UTC VPS — avoids off-by-one days.
        TZ: "Asia/Ho_Chi_Minh",
        NODE_OPTIONS: `--max-old-space-size=${T.apiHeap}`,
        // Reach the local tool servers WITH their API key (servers bind 127.0.0.1 + require X-API-Key).
        CHECK_GROK_URL: process.env.CHECK_GROK_URL || "http://127.0.0.1:4001",
        CHECK_VEO_URL: process.env.CHECK_VEO_URL || "http://127.0.0.1:4002",
        CHECK_GROK_API_KEY: process.env.GROK_API_KEY || process.env.CHECK_GROK_API_KEY || "",
        CHECK_VEO_API_KEY: process.env.VEO_API_KEY || process.env.CHECK_VEO_API_KEY || "",
      },
    },
    {
      name: "reseller-worker",
      script: "apps/worker/dist/main.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      // Worker spawns Chromium children — RAM ceiling higher than API. PM2 only sees the
      // Node parent here; Chromium children are killed by the worker's own SIGTERM handler
      // (process-group kill in account-check.ts) when PM2 restarts the parent.
      max_memory_restart: T.workerMem,
      env: {
        NODE_ENV: "production",
        // Pin app TZ to GMT+7 so all server-side date formatting (warranty expiry/cooldown lines,
        // batch-bypass delivered date) matches Vietnam even on a UTC VPS — avoids off-by-one days.
        TZ: "Asia/Ho_Chi_Minh",
        NODE_OPTIONS: `--max-old-space-size=${T.workerHeap}`,
        // Tier sizes these; admin can ALSO chỉnh hot qua /admin (DB warranty.check.concurrency /
        // warranty.check.perJobParallel ghi đè env). 1 đơn 10 acc → đi `perJob` con/đợt, KHÔNG bung 10.
        ACCOUNT_CHECK_CONCURRENCY: process.env.ACCOUNT_CHECK_CONCURRENCY || T.workerConc,
        ACCOUNT_PARALLEL_LIMIT: process.env.ACCOUNT_PARALLEL_LIMIT || T.perJob,
        // Reach the local tool servers WITH their API key (same values the api uses).
        CHECK_GROK_URL: process.env.CHECK_GROK_URL || "http://127.0.0.1:4001",
        CHECK_VEO_URL: process.env.CHECK_VEO_URL || "http://127.0.0.1:4002",
        CHECK_GROK_API_KEY: process.env.GROK_API_KEY || process.env.CHECK_GROK_API_KEY || "",
        CHECK_VEO_API_KEY: process.env.VEO_API_KEY || process.env.CHECK_VEO_API_KEY || "",
        // Safe default: keep the fragile gpt subprocess path OFF unless explicitly enabled (mirrors
        // docker-compose). Without this the .env's value is the only guard.
        WARRANTY_DISABLED_TOOLS: process.env.WARRANTY_DISABLED_TOOLS || "gpt",
      },
    },
    {
      name: "reseller-grok-srv",
      script: CHECK_GROK_SERVER_PATH,
      cwd: path.dirname(CHECK_GROK_SERVER_PATH),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      // Grok server holds persistent Chromium per proxy (pool) for CF warming + reuse.
      // GROK_POOL_MAX nên ≈ số proxy (tránh warmer evict/thrash). NO --fast (verdict accuracy).
      max_memory_restart: T.grokMem,
      env: {
        NODE_ENV: "production",
        // Pin app TZ to GMT+7 so all server-side date formatting (warranty expiry/cooldown lines,
        // batch-bypass delivered date) matches Vietnam even on a UTC VPS — avoids off-by-one days.
        TZ: "Asia/Ho_Chi_Minh",
        PORT: "4001",
        // SECURITY: bind loopback only (api/worker are co-located) + require an API key. Without
        // these the server listened on 0.0.0.0:4001 with NO auth → open account-check + credential
        // exposure on a public VPS. Set GROK_API_KEY in the deploy env.
        BIND_HOST: process.env.GROK_BIND_HOST || "127.0.0.1",
        API_KEY: process.env.GROK_API_KEY || process.env.CHECK_GROK_API_KEY || "",
        WARMER: "1",
        GROK_POOL: process.env.GROK_POOL || T.grokPool,            // 1 = pool reuse on (0 = launch-per-check, ít RAM, chậm)
        GROK_POOL_MAX: process.env.GROK_POOL_MAX || T.grokPoolMax,  // ≈ số proxy
        MAX_CONCURRENCY: process.env.GROK_MAX_CONCURRENCY || T.grokConc,
        WARMER_PARALLEL: process.env.WARMER_PARALLEL || T.grokWarmerPar,
      },
    },
    // Veo server is OPTIONAL (set CHECK_VEO_DISABLED=1 to skip on a tight VPS). When disabled, veo
    // checks fall back to spawning single-check.js per account — slower but no idle browser RAM.
    ...(VEO_DISABLED ? [] : [{
      name: "reseller-veo-srv",
      script: CHECK_VEO_SERVER_PATH,
      cwd: path.dirname(CHECK_VEO_SERVER_PATH),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      // 4gb: POOL_MAX=1 (serial). 6gb+: POOL_MAX=2 → veo đơn nhiều acc chạy song song (~½ thời gian).
      // MAX_CONCURRENCY giữ = POOL_MAX (server tự clamp xuống nếu vượt). RAM cap scales với tier.
      max_memory_restart: T.veoMem,
      env: {
        NODE_ENV: "production",
        // Pin app TZ to GMT+7 so all server-side date formatting (warranty expiry/cooldown lines,
        // batch-bypass delivered date) matches Vietnam even on a UTC VPS — avoids off-by-one days.
        TZ: "Asia/Ho_Chi_Minh",
        PORT: "4002",
        // SECURITY: loopback bind + API key (see grok-srv above).
        BIND_HOST: process.env.VEO_BIND_HOST || "127.0.0.1",
        API_KEY: process.env.VEO_API_KEY || process.env.CHECK_VEO_API_KEY || "",
        POOL_MAX: process.env.CHECK_VEO_POOL_MAX || T.veoPoolMax,
        MAX_CONCURRENCY: process.env.CHECK_VEO_MAX_CONCURRENCY || T.veoConc,
      },
    }]),
  ],
};
