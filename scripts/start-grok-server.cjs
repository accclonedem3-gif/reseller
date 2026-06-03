#!/usr/bin/env node
/**
 * Cross-platform launcher for CheckGrokJS/server.js — the CF cookie warmer that the worker's
 * grok HTTP fast-path depends on. Sets PORT + WARMER env vars without needing cross-env,
 * and resolves the server path relative to the reseller monorepo so the script keeps working
 * if either repo moves (override with CHECK_GROK_SERVER_PATH env).
 *
 * Wired into `npm run dev` so the warmer auto-starts alongside api/worker/web. Without this,
 * the worker fails over to subprocess (cold Chromium ~20-25s) on every grok check.
 */

const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const DEFAULT_PORT = "4001";
const port = process.env.CHECK_GROK_PORT || DEFAULT_PORT;
const serverPath = process.env.CHECK_GROK_SERVER_PATH ||
  path.resolve(__dirname, "..", "..", "CheckGrokJS", "server.js");

if (!fs.existsSync(serverPath)) {
  console.warn(`[grok] CheckGrokJS/server.js NOT FOUND at ${serverPath} — skipping. Set CHECK_GROK_SERVER_PATH to override or clone CheckGrokJS next to reseller/. Worker will fallback to subprocess on every grok check.`);
  // Exit 0 so the concurrently parent doesn't tear down api/worker/web.
  process.exit(0);
}

// Count proxies just for logging context — the server reads proxy.txt itself.
// toolgrok browser pool (GROK_POOL=1) keeps one Chrome alive per proxy across checks
// (saves ~3s launch/check + stable RAM at peak). GROK_POOL_MAX caps concurrent browsers.
const proxyCount = (() => {
  try {
    const proxyFile = path.resolve(path.dirname(serverPath), "proxy.txt");
    if (!fs.existsSync(proxyFile)) return 0;
    return fs.readFileSync(proxyFile, "utf8")
      .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).length;
  } catch { return 0; }
})();

console.log(`[grok] starting CheckGrokJS server.js on :${port} (warmer enabled, proxies=${proxyCount})`);
const child = spawn(process.execPath, [serverPath], {
  cwd: path.dirname(serverPath),
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    WARMER: "1",
    GROK_POOL: process.env.GROK_POOL || "1",
    // DEV/DEMO caps: keep peak Chromium small so a dev laptop isn't slammed (each Chrome ≈ 350MB +
    // CPU). Was POOL_MAX up to 8 + MAX_CONCURRENCY 6 (~2GB+ of browsers) — heavy enough to spike a
    // weak machine. Cap pool at 3, concurrent checks at 2, warm 1 proxy at a time. Prod sizing is
    // separate (ecosystem.config.cjs per DEPLOY_TIER). Override via env if needed.
    GROK_POOL_MAX: process.env.GROK_POOL_MAX || String(Math.max(1, Math.min(3, proxyCount || 2))),
    MAX_CONCURRENCY: process.env.GROK_MAX_CONCURRENCY || process.env.MAX_CONCURRENCY || "2",
    WARMER_PARALLEL: process.env.WARMER_PARALLEL || "1",
  },
});

child.on("exit", (code, signal) => {
  console.log(`[grok] server exited code=${code} signal=${signal}`);
  process.exit(code ?? 0);
});

// Forward signals so concurrently can graceful-shutdown the warmer.
const forward = (sig) => () => {
  try { child.kill(sig); } catch {}
};
process.on("SIGTERM", forward("SIGTERM"));
process.on("SIGINT", forward("SIGINT"));
