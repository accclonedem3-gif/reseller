/**
 * PM2 ecosystem for prod. Three processes, all `fork` mode (we're not running cluster):
 *   - reseller-api      : NestJS HTTP, talks to Postgres + Redis, exposes warranty endpoints
 *   - reseller-worker   : BullMQ consumer, spawns single-check.js subprocesses for veo/gpt
 *   - reseller-grok-srv : CheckGrokJS HTTP server, CF cookie warmer for grok HTTP fast-path
 *
 * Tuning notes (4GB VPS, the documented target):
 *   - max_memory_restart caps RAM per process — if it leaks (rare but Chromium-adjacent stuff
 *     can), PM2 restarts before the OS OOM-kills.
 *   - NODE_OPTIONS heap caps shrink the V8 max heap so a single process can't gobble 1.5GB
 *     by default. Worker gets more headroom (it tracks Chromium child PIDs).
 *   - grok-server path is sibling of the reseller repo; override with CHECK_GROK_SERVER_PATH.
 *   - Always pulls env from the OS (PM2 inherits env from shell or `pm2 start --env`).
 */
const path = require("node:path");

const CHECK_GROK_SERVER_PATH =
  process.env.CHECK_GROK_SERVER_PATH ||
  path.resolve(__dirname, "..", "CheckGrokJS", "server.js");

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
  ],
};
