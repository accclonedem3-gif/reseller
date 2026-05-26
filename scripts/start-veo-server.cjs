#!/usr/bin/env node
/**
 * Cross-platform launcher for check_veo/server.js — the browser pool fast-path that the
 * worker's veo HTTP path depends on. Mirrors scripts/start-grok-server.cjs.
 *
 * Wired into `npm run dev` so the veo server auto-starts alongside api/worker/web/grok.
 * Without this, the worker falls back to spawning single-check.js subprocess per account
 * (cold Chromium ~45s vs warm pool ~30s).
 */

const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const DEFAULT_PORT = "4002";
const port = process.env.CHECK_VEO_PORT || DEFAULT_PORT;
const serverPath = process.env.CHECK_VEO_SERVER_PATH ||
  path.resolve(__dirname, "..", "..", "check_veo", "server.js");

if (!fs.existsSync(serverPath)) {
  console.warn(`[veo] check_veo/server.js NOT FOUND at ${serverPath} — skipping. Set CHECK_VEO_SERVER_PATH to override or clone check_veo next to reseller/. Worker will fallback to subprocess on every veo check.`);
  process.exit(0);
}

console.log(`[veo] starting check_veo server.js on :${port} (browser pool)`);
const child = spawn(process.execPath, [serverPath], {
  cwd: path.dirname(serverPath),
  stdio: "inherit",
  env: { ...process.env, PORT: port },
});

child.on("exit", (code, signal) => {
  console.log(`[veo] server exited code=${code} signal=${signal}`);
  process.exit(code ?? 0);
});

const forward = (sig) => () => {
  try { child.kill(sig); } catch {}
};
process.on("SIGTERM", forward("SIGTERM"));
process.on("SIGINT", forward("SIGINT"));
