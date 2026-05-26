/**
 * PM2 ecosystem for prod. Four processes, all `fork` mode (no cluster):
 *   - reseller-api      : NestJS HTTP, talks to Postgres + Redis, exposes warranty endpoints
 *   - reseller-worker   : BullMQ consumer, spawns single-check.js subprocesses as fallback
 *   - reseller-grok-srv : CheckGrokJS HTTP server, CF cookie warmer for grok fast-path
 *   - reseller-veo-srv  : check_veo HTTP server, Chromium browser pool for veo fast-path
 *
 * Tuning notes (4GB VPS, the documented target):
 *   - max_memory_restart caps RAM per process — if it leaks (rare but Chromium-adjacent stuff
 *     can), PM2 restarts before the OS OOM-kills.
 *   - NODE_OPTIONS heap caps shrink the V8 max heap so a single process can't gobble 1.5GB
 *     by default. Worker gets more headroom (it tracks Chromium child PIDs).
 *   - Tool server paths are siblings of the reseller repo; override with
 *     CHECK_GROK_SERVER_PATH / CHECK_VEO_SERVER_PATH if elsewhere.
 *   - Set CHECK_VEO_DISABLED=1 in env to skip the veo server (4GB VPS without enough RAM).
 *   - Always pulls env from the OS (PM2 inherits env from shell or `pm2 start --env`).
 *
 * Total RAM budget (4GB VPS): api 0.5G + worker 1G + grok 1.5G + veo 1G = 4G peak.
 * Tight but workable with 4GB swap. If swap-thrashing, drop veo-srv pool to 1 or disable it.
 */
const path = require("node:path");

const CHECK_GROK_SERVER_PATH =
  process.env.CHECK_GROK_SERVER_PATH ||
  path.resolve(__dirname, "..", "CheckGrokJS", "server.js");

const CHECK_VEO_SERVER_PATH =
  process.env.CHECK_VEO_SERVER_PATH ||
  path.resolve(__dirname, "..", "check_veo", "server.js");

const VEO_DISABLED = process.env.CHECK_VEO_DISABLED === "1";

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
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=512",
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
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=768",
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
      // Grok server holds N persistent Chromium contexts for CF cookie warming → highest RAM.
      // Default warmer=2 parallel + 5 proxies = 5 long-lived browsers. Cap at 1.5G for 4GB VPS.
      max_memory_restart: "1500M",
      env: {
        NODE_ENV: "production",
        PORT: "4001",
        WARMER: "1",
      },
    },
    // Veo server is OPTIONAL (set CHECK_VEO_DISABLED=1 to skip on tight 4GB VPS where the
    // total of api+worker+grok+veo would exceed RAM budget). When disabled, veo checks fall
    // back to spawning single-check.js subprocess per account — slower (~45s vs ~30s) but
    // works without the persistent browser pool.
    ...(VEO_DISABLED ? [] : [{
      name: "reseller-veo-srv",
      script: CHECK_VEO_SERVER_PATH,
      cwd: path.dirname(CHECK_VEO_SERVER_PATH),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      // POOL_MAX=2 default → ~600-800MB idle. Cap at 1G to leave room for swap on 4GB VPS.
      // Bump to 1500M on 8GB+ VPS where pool can grow to 3-4 browsers.
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: "4002",
        POOL_MAX: process.env.CHECK_VEO_POOL_MAX || "2",
      },
    }]),
  ],
};
