// @ts-nocheck
"use strict";
// rev: sticky-proxy

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker, Job } from "bullmq";
import type Redis from "ioredis";
import axios from "axios";
import { QUEUES, JOBS, SYSTEM_CONFIG_KEYS, WARRANTY_AUTO_CHECK_STATUS } from "@reseller/shared";
import { buildInternalRequestHeaders } from "@reseller/shared/server";

function firstExistingPath(candidates: string[]): string {
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function siblingToolPath(folder: string, file = "single-check.js"): string {
  const cwd = process.cwd();
  return firstExistingPath([
    path.resolve(cwd, "..", folder, file),             // reseller/ -> ../tool
    path.resolve(cwd, "..", "..", "..", folder, file), // apps/worker/ -> ../../../tool
    path.resolve(cwd, "..", "..", folder, file),       // apps/*/ -> ../../tool
    path.resolve(cwd, folder, file),                   // D:/DuAn/ -> ./tool
  ]);
}

const DEFAULT_TOOL_PATHS = {
  veo: siblingToolPath("check_veo"),
  grok: siblingToolPath("CheckGrokJS"),
  gpt: siblingToolPath("check_gpt"),
};

function resolveToolPath(tool: "veo" | "grok" | "gpt"): string {
  const envKey =
    tool === "veo" ? "CHECK_VEO_PATH" : tool === "grok" ? "CHECK_GROK_PATH" : "CHECK_GPT_PATH";
  return process.env[envKey] || DEFAULT_TOOL_PATHS[tool];
}

const JOB_TIMEOUT_MS = Number(process.env.ACCOUNT_CHECK_JOB_TIMEOUT_MS || 90000);
// Grok HTTP API: nếu set, worker gọi long-running server.js của CheckGrokJS
// (CF warmer 24/7, cookie share giữa các check → ~3s/acc thay vì ~20s cold-start).
// Fallback subprocess nếu HTTP request fail (server down / timeout).
const CHECK_GROK_URL = (process.env.CHECK_GROK_URL || "http://127.0.0.1:4001").replace(/\/+$/, "");
const CHECK_GROK_API_KEY = process.env.CHECK_GROK_API_KEY || "";
const GROK_HTTP_TIMEOUT_MS = Math.max(30_000, Number(process.env.CHECK_GROK_HTTP_TIMEOUT_MS || 180_000));
// Veo HTTP API: same pattern as grok above. Long-running check_veo/server.js holds a
// browser pool so each check skips the ~3-5s Chromium cold launch. Empty = subprocess-only.
const CHECK_VEO_URL = (process.env.CHECK_VEO_URL || "http://127.0.0.1:4002").replace(/\/+$/, "");
const CHECK_VEO_API_KEY = process.env.CHECK_VEO_API_KEY || "";
const VEO_HTTP_TIMEOUT_MS = Math.max(30_000, Number(process.env.CHECK_VEO_HTTP_TIMEOUT_MS || 180_000));
// GPT HTTP API: gpt mặc định subprocess-only. Nếu set CHECK_GPT_URL (vd tool ở VPS riêng),
// worker POST /check (đồng bộ, 1 acc/req) → fallback subprocess nếu fail. Trống = subprocess-only (giữ hành vi cũ).
const CHECK_GPT_URL = (process.env.CHECK_GPT_URL || "").replace(/\/+$/, "");
const CHECK_GPT_API_KEY = process.env.CHECK_GPT_API_KEY || "";
const GPT_HTTP_TIMEOUT_MS = Math.max(30_000, Number(process.env.CHECK_GPT_HTTP_TIMEOUT_MS || 120_000));
const CONCURRENCY = Math.max(1, Number(process.env.ACCOUNT_CHECK_CONCURRENCY || 3));
// Per-claim parallelism: keep up to 3 Chrome slots filled continuously. parallelLimit's
// drain loop already does the right thing for N accounts: N=1 spawns 1, N=2 spawns 2,
// N=3 spawns 3, N>3 keeps 3 in flight, refilling as each finishes (so 4 accounts =
// 3-then-1 in flight). Sequential (limit=1) was too slow for big multi-account claims
// (15 accs × 90s ≈ 22 min). Trades a bit of peak-Chrome headroom for much better
// per-claim latency. Stagger below still smooths the initial burst.
const ACCOUNT_PARALLEL_LIMIT = Math.max(1, Number(process.env.ACCOUNT_PARALLEL_LIMIT || 3));
// Stagger between sequential spawns inside a job (matches toolgrok.js STAGGER_MS=1500).
// Smooths Chrome launches when the previous one's CF challenge is still warming caches.
const SPAWN_STAGGER_MS = Math.max(0, Number(process.env.ACCOUNT_CHECK_STAGGER_MS || 1500));
// Per-account retry count for "Lỗi kiểm tra" cases — covers both subprocess timeouts AND
// parse errors (tool exited but produced no valid JSON_RESULT). Default 2 → each account gets
// up to 3 total attempts. The VEO/GROK/GPT tools have internal proxy rotation, so each retry
// usually hits a different proxy and recovers from slow/dead-proxy / partial-render failures.
const ACCOUNT_RETRY_COUNT = Math.max(0, Number(process.env.ACCOUNT_CHECK_RETRY_COUNT || 1));

async function parallelLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
  staggerMs = 0,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  async function drain() {
    while (cursor < tasks.length) {
      const i = cursor++;
      if (staggerMs > 0 && i > 0) await new Promise((r) => setTimeout(r, staggerMs));
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, drain));
  return results;
}

// Tracks every live single-check child so graceful shutdown can clean them up. The key is the
// child's PID; the value is a kill function that handles the platform-specific process-tree kill.
const liveChildren = new Map<number, () => void>();

/**
 * Kill the entire process tree rooted at the child PID.
 *
 * Why this is needed: `child.kill('SIGKILL')` only targets the Node wrapper. On Linux/macOS, when
 * spawned with `detached: true`, the wrapper becomes the leader of its own process group and we
 * can SIGKILL the whole group via `process.kill(-pid, 'SIGKILL')` — that takes Chromium with it.
 * On Windows there are no process groups; `taskkill /T /F /PID <pid>` walks the tree instead.
 * Without this, Chromium subprocesses get orphaned and accumulate (300MB each) → eventual OOM.
 */
function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      // taskkill is synchronous-enough for our purposes; we don't await it.
      require("child_process").exec(`taskkill /T /F /PID ${pid}`, () => undefined);
    } catch {}
  } else {
    try {
      // Negative PID = signal the entire process group (only works if child was detached).
      process.kill(-pid, "SIGKILL");
    } catch {
      // Fallback: kill just the leader. Better than nothing if the group setup failed.
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }
}

/** Called from graceful shutdown — best-effort kill every live single-check child. */
export function killAllChildren(): void {
  for (const [, kill] of liveChildren) {
    try { kill(); } catch {}
  }
  liveChildren.clear();
}

function spawnSingleCheck(
  tool: "veo" | "grok" | "gpt",
  args: { email: string; password: string; extra?: string | null; proxy?: string | null },
): Promise<{ raw: string; parsed: any | null; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const scriptPath = resolveToolPath(tool);
    // RES-2: credentials are passed via env vars instead of CLI args so they don't appear in
    // `ps`/process list. The single-check.js wrappers fall back to --flags if env vars are absent
    // (so the tool is still usable directly from a shell).
    const childEnv = {
      ...process.env,
      NO_COLOR: "1",
      CHECK_EMAIL: args.email,
      CHECK_PASSWORD: args.password,
      ...(args.extra ? { CHECK_EXTRA: args.extra } : {}),
      ...(args.proxy ? { CHECK_PROXY: args.proxy } : {}),
    };

    // detached: true on POSIX makes the child a process-group leader so we can kill the whole
    // tree (Node wrapper + Chromium) with `process.kill(-pid, 'SIGKILL')`. On Windows this flag
    // has no harmful effect; killProcessTree falls back to `taskkill /T /F`.
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.dirname(scriptPath),
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;
    const pid = child.pid;
    if (pid) {
      liveChildren.set(pid, () => killProcessTree(pid));
    }

    const cleanup = () => {
      if (pid) liveChildren.delete(pid);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (pid) killProcessTree(pid);
      cleanup();
      resolve({ raw: stdoutBuf + "\n--STDERR--\n" + stderrBuf, parsed: null, exitCode: null, timedOut: true });
    }, JOB_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve({ raw: String(err?.message || err), parsed: null, exitCode: null, timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      const match = stdoutBuf.match(/JSON_RESULT:(\{.*\})\s*$/m);
      let parsed: any | null = null;
      if (match) {
        try {
          parsed = JSON.parse(match[1]);
        } catch {
          parsed = null;
        }
      }
      resolve({ raw: stdoutBuf + (stderrBuf ? "\n--STDERR--\n" + stderrBuf : ""), parsed, exitCode: code, timedOut: false });
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// GPT HTTP API client (single-account, sync) — for tool on a separate VPS.
// Returns the SAME {raw, parsed, exitCode, timedOut} shape as spawnSingleCheck so the
// downstream parser is identical. Throws on transport error → caller falls back to subprocess.
// ──────────────────────────────────────────────────────────────────────────
async function gptCheckViaHttp(
  args: { email: string; password: string; extra?: string | null; proxy?: string | null },
): Promise<{ raw: string; parsed: any | null; exitCode: number | null; timedOut: boolean }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (CHECK_GPT_API_KEY) headers["X-API-Key"] = CHECK_GPT_API_KEY;
  const resp = await axios.post(
    `${CHECK_GPT_URL}/check`,
    {
      email: args.email,
      password: args.password,
      ...(args.extra ? { extra: args.extra } : {}),
      ...(args.proxy ? { proxy: args.proxy } : {}),
    },
    { headers, timeout: GPT_HTTP_TIMEOUT_MS },
  );
  const parsed = resp.data && typeof resp.data === "object" ? resp.data : null;
  return { raw: `HTTP gpt status=${parsed?.status || "?"}`, parsed, exitCode: 0, timedOut: false };
}

// Per-account dispatcher: prefer HTTP for gpt when CHECK_GPT_URL is set (tool on a separate
// VPS), else subprocess. veo/grok keep their batch HTTP fast-path upstream — this wrapper only
// adds gpt's HTTP path while preserving subprocess fallback for every tool.
async function runSingleCheck(
  tool: "veo" | "grok" | "gpt",
  args: { email: string; password: string; extra?: string | null; proxy?: string | null },
): Promise<{ raw: string; parsed: any | null; exitCode: number | null; timedOut: boolean }> {
  if (tool === "gpt" && CHECK_GPT_URL) {
    try {
      const r = await gptCheckViaHttp(args);
      if (r.parsed && r.parsed.status) return r;
      console.warn(`[account-check] gpt HTTP returned no usable result → fallback subprocess`);
    } catch (err: any) {
      console.warn(`[account-check] gpt HTTP failed (${err?.message || err}) → fallback subprocess`);
    }
  }
  return spawnSingleCheck(tool, args);
}

// ──────────────────────────────────────────────────────────────────────────
// Grok HTTP API client
// ──────────────────────────────────────────────────────────────────────────
// Replicates the derivation logic from CheckGrokJS/single-check.js so the
// result shape returned via HTTP matches the JSON_RESULT shape that
// warranty.service.ts/applyAutoCheckResult reads (isDead, stillPaid, tier).
function deriveGrokResultShape(input: {
  plan?: string | null;
  status?: string | null;
  expires?: string | null;
  daysRemaining?: number | null;
  cancelAtEnd?: boolean | null;
  error?: string | null;
  errorType?: string | null;
}) {
  const errorType = input.errorType || null;
  const plan = input.error ? null : String(input.plan || "Free");
  const status = String(input.status || "Unknown");
  const tier = (() => {
    if (!plan) return "UNKNOWN";
    const p = plan.toLowerCase();
    if (p.includes("heavy")) return "HEAVY";
    if (p.includes("supergrok") || p.includes("super")) return "SUPERGROK";
    return "FREE";
  })();
  const daysRem = typeof input.daysRemaining === "number" ? input.daysRemaining : null;
  // SuperGrok/Heavy mà KHÔNG active (Inactive/Canceled/Expired/PastDue/...) HOẶC đã hết hạn
  // (daysRem<=0) = mất gói trả phí → coi như CHẾT (shop bán SuperGrok đang ACTIVE) → kích bảo
  // hành. status "Unknown" KHÔNG tính (mơ hồ/lỗi tạm → để seller review, tránh false dead).
  // CHỈ dead khi status KHÔNG active (tránh hoàn nhầm acc còn Active dù date qua). Khớp đúng
  // logic warranty.service paidTierWithExpiredWindow (status!=active) + regex inactive.
  const expiredPaid =
    (tier === "SUPERGROK" || tier === "HEAVY") &&
    !input.error &&
    !/^active$/i.test(status) &&
    (/inactive|cancel|expired|past.?due|unpaid|incomplete|suspend/i.test(status) ||
      (typeof daysRem === "number" && daysRem <= 0));
  const isDead = errorType === "blocked" || expiredPaid;
  const stillPaid =
    !isDead &&
    !input.error &&
    (tier === "SUPERGROK" || tier === "HEAVY") &&
    /^active$/i.test(status) &&
    (daysRem === null || daysRem > 0);
  // UI: SuperGrok/Heavy đã hết hạn/Inactive → hiển thị "Free" cho khách khỏi hiểu nhầm còn gói.
  // Giữ tier/plan gốc trong originalTier/originalPlan + expires/status để seller audit.
  const outTier = expiredPaid ? "FREE" : tier;
  const outPlan = expiredPaid ? "Free" : plan;
  return {
    ok: !input.error,
    tool: "grok" as const,
    tier: outTier,
    plan: outPlan,
    ...(expiredPaid ? { originalTier: tier, originalPlan: plan } : {}),
    status,
    expires: input.expires || null,
    daysRemaining: daysRem,
    cancelAtEnd: input.cancelAtEnd ?? null,
    errorType,
    error: input.error || null,
    isDead,
    stillPaid,
  };
}

/**
 * Submit a batch of grok accounts to the CheckGrokJS HTTP server and stream
 * results in real-time via SSE (GET /check/:id/stream). Returns one entry per
 * account in the same shape as spawnSingleCheck().
 *
 * SSE: each account's result arrives the instant the server finishes it — no
 * polling lag. For a single-account claim this means the worker gets the verdict
 * ~3s after submission (warm proxy) vs ~20s subprocess cold-start.
 *
 * Fallback: if SSE connect fails, caller catches and falls back to subprocess.
 * Timeout: if deadline fires before all results arrive, partial results pass
 * through (retry pass handles missing ones); if 0 results received, all
 * timedOut=true → caller triggers full subprocess fallback.
 */
async function runGrokBatchViaHttp(
  accounts: Array<{ email: string; password: string; extra?: string | null }>,
  proxies: Array<string | null>,
  onProgress?: (done: number) => Promise<void>,
): Promise<Array<{ raw: string; parsed: any | null; exitCode: number | null; timedOut: boolean }>> {
  if (!CHECK_GROK_URL) throw new Error("CHECK_GROK_URL not set");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (CHECK_GROK_API_KEY) headers["X-API-Key"] = CHECK_GROK_API_KEY;

  const submitResp = await axios.post(
    `${CHECK_GROK_URL}/check`,
    {
      accounts: accounts.map((a, i) => ({
        user: a.email,
        pwd: a.password,
        ...(proxies[i] ? { proxy: proxies[i] } : {}),
      })),
    },
    { headers, timeout: 10_000 },
  );
  const jobId: string = submitResp.data?.job_id;
  if (!jobId) throw new Error("grok server did not return job_id");

  const byIdx = new Map<number, any>();

  function buildEntry(i: number, timedOut: boolean) {
    const entry = byIdx.get(i);
    if (!entry?.result) {
      return {
        raw: `HTTP grok job=${jobId} idx=${i} ${timedOut ? "timed out" : "no result"}`,
        parsed: null, exitCode: null, timedOut,
      };
    }
    const r = entry.result;
    return {
      raw: `HTTP grok job=${jobId} idx=${i} elapsed=${entry.elapsed_ms || 0}ms warm=${entry.proxy_warm ? 1 : 0}`,
      parsed: deriveGrokResultShape({
        plan: r.plan, status: r.status, expires: r.expires,
        daysRemaining: r.days_remaining, cancelAtEnd: r.cancel_at_end,
        error: r.error, errorType: r.error_type,
      }),
      exitCode: 0, timedOut: false,
    };
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    // #17: hoist the stream handle so the deadline/finish paths can tear down the underlying
    // socket. Otherwise a timeout resolves the promise but leaves the SSE connection open —
    // leaking a socket and making the server stream to a listener nobody reads.
    let streamResp: any = null;
    const cleanupStream = () => { try { streamResp?.data?.destroy(); } catch {} };

    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanupStream();
      // Tell the server to stop dispatching not-yet-started accounts: we're about to fall back to
      // subprocess, and checking the same account twice (server + subprocess) = double login = ban risk.
      void axios.post(`${CHECK_GROK_URL}/check/${jobId}/cancel`, {}, { headers, timeout: 3000 }).catch(() => undefined);
      // Missing entries marked timedOut=true → retry pass / allTimed fallback
      resolve(accounts.map((_, i) => buildEntry(i, true)));
    }, GROK_HTTP_TIMEOUT_MS);

    function finish(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      cleanupStream();
      if (err) { reject(err); return; }
      resolve(accounts.map((_, i) => buildEntry(i, false)));
    }

    axios
      .get(`${CHECK_GROK_URL}/check/${jobId}/stream`, {
        headers: { ...headers, Accept: "text/event-stream", "Cache-Control": "no-cache" },
        responseType: "stream",
        timeout: 0, // SSE connection is long-lived — no axios timeout
      })
      .then((resp) => {
        streamResp = resp;
        let buf = "";
        resp.data.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let eventName = "message";
            let dataLine = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataLine = line.slice(6);
            }
            if (!dataLine) continue; // keepalive ':'
            let payload: any;
            try { payload = JSON.parse(dataLine); } catch { continue; }
            if (eventName === "result") {
              byIdx.set(payload.idx, payload);
              if (onProgress) onProgress(byIdx.size).catch(() => undefined);
            } else if (eventName === "done" || eventName === "error") {
              try { resp.data.destroy(); } catch {}
              finish();
            }
          }
        });
        resp.data.on("end", () => finish());
        resp.data.on("error", (e: Error) => finish(e));
      })
      .catch((e) => finish(e));
  });
}

// ──────────────────────────────────────────────────────────────────────────
// VEO HTTP fast-path (check_veo/server.js)
// ──────────────────────────────────────────────────────────────────────────
// Same idea as the grok HTTP path above but adapted for veo's result shape. check_veo's
// server.js returns the raw `checkAccount()` output ({email, status, credit, plan, detail,
// reason}); we derive the isDead/stillPaid/errorType shape on this side, mirroring the
// logic in check_veo/single-check.js so downstream applyAutoCheckResult sees identical
// fields regardless of whether the verdict came from HTTP or subprocess.
function deriveVeoResultShape(input: {
  status?: string | null;
  credit?: number | string | null;
  plan?: string | null;
  detail?: string | null;
  reason?: string | null;
}) {
  const status = String(input.status || "TIMEOUT").toUpperCase();
  const credit = typeof input.credit === "number" ? input.credit : (parseInt(String(input.credit || "")) || null);
  const planName = input.plan ? String(input.plan).trim() : null;
  const planLower = planName ? planName.toLowerCase() : "";
  const isUltraPlan = planLower === "ultra";
  const isFreePlan = planLower === "free";

  let errorType: string | null = null;
  if (status === "DIE") errorType = input.reason || "account_disabled";
  else if (status === "WRONG_PASS") errorType = "wrong_password";
  else if (status === "TWO_FA") errorType = "2fa";
  else if (status === "TIMEOUT") errorType = "timeout";
  else if (isFreePlan) errorType = "plan_lost";

  // Same dead-set as single-check.js: shop sells Ultra so plan_lost (Free) counts as dead.
  // Pro/Premium and unknown plans fall through to seller review.
  const isDead = ["flow_blocked", "plan_lost", "account_disabled"].includes(String(errorType || ""));
  // #13 INVARIANT: stillPaid requires a POSITIVELY-read Ultra plan. A LIVE account whose plan
  // scrape returned null (popup didn't render) is NEITHER dead NOR confirmed-paid → it stays
  // stillPaid=false + isDead=false → seller review. Do NOT relax this to `status === "LIVE"`
  // alone: that would wrongly REJECT a warranty on an account we never confirmed is still Ultra.
  const stillPaid = status === "LIVE" && isUltraPlan;

  return {
    ok: !errorType,
    tool: "veo" as const,
    status,
    credit,
    plan: planName || (credit !== null ? `${credit} credit` : null),
    tier: planName,
    stillPaid,
    detail: input.detail || null,
    reason: input.reason || null,
    errorType,
    isDead,
  };
}

/**
 * Submit a batch of veo accounts to check_veo/server.js and stream results via SSE.
 * Same shape contract as runGrokBatchViaHttp — caller decides between this and subprocess.
 * Saves the ~3-5s Chromium cold launch per account (the server's browser pool keeps them
 * hot). Login itself is per-account, can't share — but with no cold launch tax veo drops
 * from ~45s to ~30-35s per check, and bursts scale linearly with pool size instead of
 * spawning a fresh browser process per check.
 */
async function runVeoBatchViaHttp(
  accounts: Array<{ email: string; password: string; extra?: string | null }>,
  proxies: Array<string | null>,
  onProgress?: (done: number) => Promise<void>,
): Promise<Array<{ raw: string; parsed: any | null; exitCode: number | null; timedOut: boolean }>> {
  if (!CHECK_VEO_URL) throw new Error("CHECK_VEO_URL not set");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (CHECK_VEO_API_KEY) headers["X-API-Key"] = CHECK_VEO_API_KEY;

  const submitResp = await axios.post(
    `${CHECK_VEO_URL}/check`,
    {
      accounts: accounts.map((a, i) => ({
        user: a.email,
        pwd: a.password,
        ...(proxies[i] ? { proxy: proxies[i] } : {}),
      })),
    },
    { headers, timeout: 10_000 },
  );
  const jobId: string = submitResp.data?.job_id;
  if (!jobId) throw new Error("veo server did not return job_id");

  const byIdx = new Map<number, any>();

  function buildEntry(i: number, timedOut: boolean) {
    const entry = byIdx.get(i);
    if (!entry?.result) {
      return {
        raw: `HTTP veo job=${jobId} idx=${i} ${timedOut ? "timed out" : "no result"}`,
        parsed: null, exitCode: null, timedOut,
      };
    }
    const r = entry.result;
    return {
      raw: `HTTP veo job=${jobId} idx=${i} elapsed=${entry.elapsed_ms || 0}ms`,
      parsed: deriveVeoResultShape({
        status: r.status, credit: r.credit, plan: r.plan,
        detail: r.detail, reason: r.reason,
      }),
      exitCode: 0, timedOut: false,
    };
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    // #17: same SSE socket-leak guard as runGrokBatchViaHttp.
    let streamResp: any = null;
    const cleanupStream = () => { try { streamResp?.data?.destroy(); } catch {} };

    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanupStream();
      // Stop the server dispatching not-yet-started accounts before we subprocess-fallback (else the
      // same account logs in twice = ban risk).
      void axios.post(`${CHECK_VEO_URL}/check/${jobId}/cancel`, {}, { headers, timeout: 3000 }).catch(() => undefined);
      resolve(accounts.map((_, i) => buildEntry(i, true)));
    }, VEO_HTTP_TIMEOUT_MS);

    function finish(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      cleanupStream();
      if (err) { reject(err); return; }
      resolve(accounts.map((_, i) => buildEntry(i, false)));
    }

    axios
      .get(`${CHECK_VEO_URL}/check/${jobId}/stream`, {
        headers: { ...headers, Accept: "text/event-stream", "Cache-Control": "no-cache" },
        responseType: "stream",
        timeout: 0,
      })
      .then((resp) => {
        streamResp = resp;
        let buf = "";
        resp.data.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let eventName = "message";
            let dataLine = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataLine = line.slice(6);
            }
            if (!dataLine) continue;
            let payload: any;
            try { payload = JSON.parse(dataLine); } catch { continue; }
            if (eventName === "result") {
              byIdx.set(payload.idx, payload);
              if (onProgress) onProgress(byIdx.size).catch(() => undefined);
            } else if (eventName === "done" || eventName === "error") {
              try { resp.data.destroy(); } catch {}
              finish();
            }
          }
        });
        resp.data.on("end", () => finish());
        resp.data.on("error", (e: Error) => finish(e));
      })
      .catch((e) => finish(e));
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Sticky proxy per account: hash(email) → pool idx.
// Lý do: X.AI/CF fingerprint theo IP. Account quen login từ proxy_X → ít trigger
// 2FA/email-verify. Nếu mỗi lần check pick proxy ngẫu nhiên → X.AI luôn thấy
// "IP lạ" → login_stuck. Sticky giúp account "ổn định 1 nhà".
//
// Tắt bằng env STICKY_PROXY=0 (rotate round-robin theo idx như cũ).
const STICKY_PROXY_ENABLED = (process.env.STICKY_PROXY ?? "1") !== "0";

function stickyProxyIdx(email: string, poolLength: number): number {
  if (poolLength <= 0) return 0;
  // SHA1 đủ để phân tán đều giữa các email; lấy 4 byte đầu = uint32.
  const h = createHash("sha1").update((email || "").toLowerCase()).digest();
  const n = h.readUInt32BE(0);
  return n % poolLength;
}

// ──────────────────────────────────────────────────────────────────────────
// Shared dead-proxy cache (Redis, cross-tool)
// ──────────────────────────────────────────────────────────────────────────
// Khi bất kỳ tool nào (veo / grok / gpt) phát hiện proxy_die, ghi vào key
// dùng chung này (TTL 10 phút). Các tool khác đọc trước khi gửi job → skip
// proxy đã chết. Key chỉ chứa host:port (bỏ creds) để cùng proxy với
// credentials khác nhau vẫn share trạng thái.
const PROXY_DEAD_TTL_SEC = Math.max(60, Number(process.env.PROXY_DEAD_TTL_SEC || 600));

function makeProxyHostPort(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.includes("://")) {
    const i = s.indexOf("://");
    s = s.slice(i + 3);
    if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  }
  // host:port[:user:pass] — first two segments are host:port
  const parts = s.split(":");
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function deadKey(hostPort: string): string {
  return `account-check:proxy-dead:${hostPort}`;
}

async function isProxyDead(redis: Redis, raw: string | null): Promise<boolean> {
  if (!raw) return false;
  const hp = makeProxyHostPort(raw);
  if (!hp) return false;
  try {
    const v = await redis.get(deadKey(hp));
    return !!v;
  } catch {
    return false;
  }
}

async function markProxyDead(
  redis: Redis,
  raw: string | null,
  tool: string,
  reason: string,
): Promise<void> {
  if (!raw) return;
  const hp = makeProxyHostPort(raw);
  if (!hp) return;
  try {
    await redis.set(
      deadKey(hp),
      JSON.stringify({ markedAt: Date.now(), markedBy: tool, reason }),
      "EX",
      PROXY_DEAD_TTL_SEC,
    );
    console.warn(`[account-check] proxy ${hp} marked dead by ${tool} (${reason}), TTL ${PROXY_DEAD_TTL_SEC}s`);
  } catch (err: any) {
    console.error("[account-check] markProxyDead failed:", err?.message || err);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Veo domain-level mass-die tracking
// ──────────────────────────────────────────────────────────────────────────
// Veo accounts are typically created in bulk on disposable-email domains (e.g.
// `*@1margaretstephensa.asia`). When the upstream provider catches the batch (Google
// flags the IPs, the domain provider gets banned, etc.), EVERY account on that domain
// dies simultaneously — but we'd otherwise burn 10-20s of Chromium per account to confirm.
//
// This module counts confirmed-dead checks per email domain in Redis. Once a domain
// crosses VEO_DOMAIN_DEAD_THRESHOLD (default 20), subsequent checks for that domain
// short-circuit with a synthetic `isDead=true` result instead of spawning the browser.
// TTL refresh on each increment so a steadily-failing batch keeps the marker alive;
// a domain that hasn't been seen in a week resets (cheap to re-confirm if it's re-used).
const VEO_DOMAIN_DEAD_PREFIX = "account-check:veo-domain-dead:";
const VEO_DOMAIN_DEAD_THRESHOLD = Math.max(1, Number(process.env.VEO_DOMAIN_DEAD_THRESHOLD || 20));
const VEO_DOMAIN_DEAD_TTL_SEC = Math.max(60, Number(process.env.VEO_DOMAIN_DEAD_TTL_SEC || 7 * 24 * 3600));

function extractEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d || null;
}

async function getVeoDomainDeadCount(redis: Redis, domain: string): Promise<number> {
  try {
    const raw = await redis.get(VEO_DOMAIN_DEAD_PREFIX + domain);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

async function incrVeoDomainDeadCount(redis: Redis, domain: string, reason: string): Promise<number> {
  const key = VEO_DOMAIN_DEAD_PREFIX + domain;
  try {
    const newVal = await redis.incr(key);
    // Refresh TTL on every confirmed-dead hit so an actively-dying batch doesn't
    // expire mid-roll. A domain that's been quiet for VEO_DOMAIN_DEAD_TTL_SEC resets.
    await redis.expire(key, VEO_DOMAIN_DEAD_TTL_SEC).catch(() => undefined);
    if (newVal === VEO_DOMAIN_DEAD_THRESHOLD) {
      console.warn(
        `[account-check] veo domain '${domain}' crossed mass-die threshold (${newVal}/${VEO_DOMAIN_DEAD_THRESHOLD}) — subsequent veo checks on this domain will auto-mark dead for ${VEO_DOMAIN_DEAD_TTL_SEC}s. Trigger: ${reason}`,
      );
    }
    return newVal;
  } catch (err: any) {
    console.error("[account-check] incrVeoDomainDeadCount failed:", err?.message || err);
    return 0;
  }
}

async function isVeoDomainMassDie(redis: Redis, domain: string): Promise<boolean> {
  return (await getVeoDomainDeadCount(redis, domain)) >= VEO_DOMAIN_DEAD_THRESHOLD;
}

/**
 * Synthetic result for a veo account skipped because its domain crossed the mass-die
 * threshold. Matches the shape spawnSingleCheck returns + the JSON_RESULT shape that
 * single-check.js / applyAutoCheckResult expects. Marked `errorType: "domain_mass_die"`
 * so post-processing can avoid double-counting (we don't want a synthetic dead to
 * itself bump the counter — that would be self-amplifying noise).
 */
function syntheticVeoDomainMassDieResult(
  email: string,
  domain: string,
  deadCount: number,
): { raw: string; parsed: any; exitCode: number | null; timedOut: boolean } {
  return {
    raw: `[domain-mass-die] domain=${domain} deadCount=${deadCount} threshold=${VEO_DOMAIN_DEAD_THRESHOLD} — subprocess skipped for ${email}`,
    parsed: {
      ok: true,
      tool: "veo",
      status: "die",
      plan: "Free",
      tier: "FREE",
      isDead: true,
      stillPaid: false,
      errorType: "domain_mass_die",
      error: null,
      // Surface why this verdict came without a real subprocess — visible in autoCheckResult.
      note: `Auto-marked dead: ${deadCount} accounts on domain ${domain} have died (≥ ${VEO_DOMAIN_DEAD_THRESHOLD} threshold).`,
    },
    exitCode: 0,
    timedOut: false,
  };
}

/**
 * Notify the API that the worker has written its auto-check result and the claim is ready to
 * be applied (auto-decide / replacement / etc.).
 *
 * Retries: API blips would otherwise drop the result silently — the worker DB row stays in
 * COMPLETED but the claim never transitions out of PENDING from the API's view. We retry with
 * exponential backoff (1s, 2s, 4s) for transient 5xx / network errors. 4xx are NOT retried — they
 * indicate a permanent rejection (e.g. signature mismatch) and retrying won't help.
 *
 * Last-resort safety net: if all retries fail, the API-side stuck-claim sweep (worker side runs
 * separately) will pick up the row once the API is back up. So we never silently lose data; the
 * retry is just to minimize the customer-visible "stuck spinner" window.
 */
export async function notifyApiCallback(claimId: string): Promise<void> {
  const apiUrl = (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, "");
  const token = process.env.INTERNAL_API_TOKEN || "";
  if (!token) return;
  const path = `/api/v1/internal/warranty/${claimId}/auto-check-applied`;
  const body = "{}";
  const maxAttempts = Math.max(1, Number(process.env.CALLBACK_MAX_ATTEMPTS || 4));
  const baseDelayMs = Math.max(100, Number(process.env.CALLBACK_BASE_DELAY_MS || 1000));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Re-sign each attempt: HMAC includes a timestamp, so an old header would fail anti-replay.
    const headers = buildInternalRequestHeaders({
      secret: token,
      method: "POST",
      path,
      body,
    });
    try {
      await axios.post(`${apiUrl}${path}`, {}, { headers, timeout: 5000 });
      if (attempt > 1) {
        console.log(`[account-check] callback succeeded on attempt ${attempt} for claim ${claimId}`);
      }
      return;
    } catch (err: any) {
      const status = err?.response?.status;
      const isPermanent = typeof status === "number" && status >= 400 && status < 500;
      const msg = err?.message || String(err);
      if (isPermanent) {
        console.error(`[account-check] callback rejected (${status}) for claim ${claimId}: ${msg} — not retrying.`);
        return;
      }
      if (attempt >= maxAttempts) {
        console.error(`[account-check] callback failed permanently after ${attempt} attempts for claim ${claimId}: ${msg}. The API-side sweep will recover this row when the API is back.`);
        return;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`[account-check] callback attempt ${attempt}/${maxAttempts} failed for claim ${claimId} (${msg}); retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function getCheckConcurrency(prisma: PrismaClient): Promise<number> {
  const row = await prisma.systemConfig
    .findUnique({ where: { key: SYSTEM_CONFIG_KEYS.warrantyCheckConcurrency } })
    .catch(() => null);
  const parsed = row?.value ? Number(row.value) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return CONCURRENCY;
}

// Số account check song song trong 1 job. Đọc hot từ DB (admin chỉnh không cần restart),
// fallback env ACCOUNT_PARALLEL_LIMIT. Clamp 1..10 — chặn nhập số to gây OOM/sập.
// Short in-process memo for the hot SystemConfig reads. The API caches these; the worker did not,
// so every job did 2-3 extra findUnique round-trips on tiny rows. 15s keeps the admin knobs
// effectively "hot" (changes apply within ~15s, no restart) while removing per-job DB chatter.
const _cfgMemo = new Map<string, { v: unknown; at: number }>();
const CFG_MEMO_MS = 15000;
async function memoConfig<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = _cfgMemo.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CFG_MEMO_MS) return hit.v as T;
  const v = await loader();
  _cfgMemo.set(key, { v, at: now });
  return v;
}

async function getPerJobParallel(prisma: PrismaClient): Promise<number> {
  return memoConfig("perJobParallel", async () => {
    const row = await prisma.systemConfig
      .findUnique({ where: { key: SYSTEM_CONFIG_KEYS.warrantyCheckPerJobParallel } })
      .catch(() => null);
    const parsed = row?.value ? Number(row.value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(10, Math.floor(parsed));
    return ACCOUNT_PARALLEL_LIMIT;
  });
}

/**
 * Pull the admin-configured proxy list and split into trimmed lines. Empty values or comment
 * lines (#...) are dropped. Returned as-is — single-check.js wrappers parse the format
 * (scheme://[user:pass@]host:port OR host:port[:user:pass]).
 */
async function getCheckProxies(prisma: PrismaClient): Promise<string[]> {
  return memoConfig("checkProxies", async () => {
    const row = await prisma.systemConfig
      .findUnique({ where: { key: SYSTEM_CONFIG_KEYS.warrantyCheckProxies } })
      .catch(() => null);
    if (!row?.value) return [];
    return String(row.value)
      .split(/\r?\n+/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
  });
}

export async function isAutoCheckEnabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.systemConfig
    .findUnique({ where: { key: SYSTEM_CONFIG_KEYS.warrantyAutoCheckEnabled } })
    .catch(() => null);
  if (!row) return true;
  return String(row.value).toLowerCase() !== "false";
}

async function processJob(prisma: PrismaClient, redis: Redis, job: Job): Promise<any> {
  const data = job.data || {};
  const { claimId, tool, email, password, extra, proxy, accounts } = data;
  if (!claimId || !tool || !email || !password) {
    return { ok: false, error: "invalid_job" };
  }

  // Worker-side honor of WARRANTY_DISABLED_TOOLS. The API already refuses to enqueue disabled
  // tools (resolveToolForFamily returns null → UNSUPPORTED), but a job queued BEFORE the env
  // flag was flipped can still arrive here. Mark it FAILED with a clear reason so the seller
  // takes it manually instead of letting it sit RUNNING until the sweep times it out.
  const disabledTools = String(process.env.WARRANTY_DISABLED_TOOLS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // Safety floor (mirror resolveToolForFamily): gpt stays disabled regardless of env until its
  // single-check.js stops defaulting transient failures / wrong-password to DIE.
  if (!disabledTools.includes("gpt")) disabledTools.push("gpt");
  if (disabledTools.includes(String(tool).toLowerCase())) {
    console.warn(`[account-check] claim=${claimId} tool '${tool}' is disabled (WARRANTY_DISABLED_TOOLS) — marking FAILED for manual review.`);
    await prisma.warrantyClaim
      .update({
        where: { id: claimId },
        data: {
          autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.FAILED,
          autoCheckTool: tool,
          autoCheckErrorMessage: `Auto-check tool '${tool}' is currently disabled by operator. Seller will handle manually.`,
          autoCheckCompletedAt: new Date(),
        },
      })
      .catch(() => undefined);
    await notifyApiCallback(claimId).catch(() => undefined);
    return { ok: false, error: "tool_disabled" };
  }

  await prisma.warrantyClaim
    .update({
      where: { id: claimId },
      data: {
        autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.RUNNING,
        autoCheckTool: tool,
        autoCheckStartedAt: new Date(),
        autoCheckJobId: String(job.id || ""),
        autoCheckAttempts: { increment: 1 },
      },
    })
    .catch(() => undefined);

  // Wrap everything below in a try/catch so any unexpected throw still marks the claim FAILED
  // instead of leaving it stuck in RUNNING forever.
  let finalState: { ok: boolean; timedOut: boolean; parsed: any } = { ok: false, timedOut: false, parsed: null };
  // Whether THIS job's terminal write actually landed (it still owns the row). Guards against the
  // sweep/recheck having already taken the row over (M2): we only fire the callback when we wrote.
  let _ownedTerminal = false;
  const _jobId = String(job.id || "");
  try {
    // Multi-account: run all accounts in parallel; primary (email/password) drives the verdict.
    const allAccounts: Array<{ email: string; password: string; extra?: string | null }> =
      Array.isArray(accounts) && accounts.length > 0 ? accounts : [{ email, password, extra }];

    // Pull the admin-configured proxy list and rotate round-robin by account index. If empty,
    // fall back to the proxy passed on the job (legacy) — or null = raw outbound IP.
    const adminProxies = await getCheckProxies(prisma);
    // pickHealthyProxy: rotate round-robin starting at idx, skip any proxy
    // marked dead in Redis (cross-tool). Walks the entire pool worst-case;
    // if all dead, falls back to null (raw IP) so the job can still attempt.
    // Proxies that returned a proxy-level failure (proxy_die) earlier IN THIS job. The Redis
    // dead-mark only lands at end-of-job, so without this an account whose sticky proxy is dead
    // would re-hit the same dead proxy on retry. Skipping these steers retries to a LIVE proxy.
    const jobFailedProxies = new Set<string>();
    // Snapshot the cross-tool dead-proxy set ONCE per job (single MGET) instead of a Redis GET per
    // proxy per account per retry (was O(accounts × proxies) sequential round-trips). Proxies that
    // die MID-job are tracked separately in jobFailedProxies, so retries still avoid them.
    const _deadSnapshot = new Set<string>();
    if (adminProxies.length > 0) {
      try {
        const _hps = adminProxies.map((p) => makeProxyHostPort(p)).filter((x): x is string => !!x);
        if (_hps.length > 0) {
          const _vals = await redis.mget(..._hps.map((hp) => deadKey(hp)));
          _hps.forEach((hp, i) => { if (_vals[i]) _deadSnapshot.add(hp); });
        }
      } catch { /* fail open — treat all as live rather than block the job */ }
    }
    const isDeadSnapshot = (cand: string | null): boolean => {
      if (!cand) return false;
      const hp = makeProxyHostPort(cand);
      return hp ? _deadSnapshot.has(hp) : false;
    };
    // Fail-closed switch (P1): when ON (default), NEVER log in from the worker's raw IP — if no
    // live proxy is available the whole job is aborted as an infra failure (caught below → claim
    // stays PENDING, slot NOT consumed, no refund, no raw login = no ban). Set
    // WARRANTY_REQUIRE_PROXY=0 to restore the old raw-IP fallback.
    const requireProxy = !/^(0|false|off|no)$/i.test(String(process.env.WARRANTY_REQUIRE_PROXY ?? "").trim());
    const pickHealthyProxy = async (idx: number): Promise<string | null> => {
      if (adminProxies.length === 0) {
        if (requireProxy && !proxy) {
          throw new Error("no_proxy_available: no proxy configured and WARRANTY_REQUIRE_PROXY is on — refusing raw IP");
        }
        return proxy || null;
      }
      for (let attempt = 0; attempt < adminProxies.length; attempt++) {
        const cand = adminProxies[(idx + attempt) % adminProxies.length];
        if (!cand) continue;
        if (jobFailedProxies.has(cand)) continue;
        if (!isDeadSnapshot(cand)) return cand;
      }
      if (requireProxy) {
        throw new Error("no_proxy_available: all configured proxies are dead and WARRANTY_REQUIRE_PROXY is on — refusing raw IP");
      }
      console.warn(
        `[account-check] claim=${claimId} all ${adminProxies.length} admin proxies dead — falling back to raw IP`,
      );
      return null;
    };
    if (adminProxies.length === 0) {
      console.warn(
        `[account-check] claim=${claimId} WARNING: no proxies configured (admin "warranty.check.proxies"). ` +
          `Auto-check will run from the worker's raw IP — high risk of Google/X flagging on repeated use.`,
      );
    }

    // P1/P2: count LIVE (non-Redis-dead) proxies once. Reused to (P1) fail-closed when none exist
    // and requireProxy is on, and (P2) clamp concurrent logins ≤ live-proxy count below.
    let liveProxyCount = 0;
    for (const cand of adminProxies) {
      if (cand && !isDeadSnapshot(cand)) liveProxyCount++;
    }
    if (requireProxy && liveProxyCount === 0 && !proxy) {
      throw new Error(
        "no_proxy_available: WARRANTY_REQUIRE_PROXY is on but no live proxy is available — refusing to run auto-check on the worker's raw IP (ban-safe). Add/repair proxies in Admin → warranty.check.proxies.",
      );
    }

    // Progress tracking: surface live "checked X/Y" to the customer's polling UI. Each account
    // bumps `completed` when its subprocess settles; retry passes also call this so the UI sees
    // "đang kiểm tra lại …". We write a tiny JSON to autoCheckResult — the final aggregated
    // result at end-of-job overrides this.
    const total = allAccounts.length;
    let completed = 0;
    let progressPhase: "initial" | "retry" = "initial";
    const writeProgress = () =>
      prisma.warrantyClaim
        .update({
          where: { id: claimId },
          data: { autoCheckResult: { progress: { completed, total, tool, phase: progressPhase } } as any },
        })
        .catch(() => undefined);

    // Seed an initial progress row so the UI immediately swaps from "đang kiểm tra" to "0/N".
    await writeProgress();

    // Track proxy used per account index so we can mark dead ones at end-of-job.
    // Keyed by allAccounts idx; updated on each (initial / retry) attempt.
    const lastProxyByIdx = new Map<number, string | null>();

    // proxyStartIdx(i, attemptOffset): tính idx khởi đầu cho pickHealthyProxy.
    // - STICKY mode (default): hash(email) + attemptOffset → cùng account luôn
    //   start từ cùng proxy. Lần retry +1 → bước tiếp khi proxy gốc fail.
    // - LEGACY mode (STICKY_PROXY=0): dùng account index + offset như cũ.
    const proxyStartIdx = (i: number, attemptOffset: number): number => {
      if (adminProxies.length === 0) return 0;
      const base = STICKY_PROXY_ENABLED
        ? stickyProxyIdx(allAccounts[i].email, adminProxies.length)
        : i;
      return base + attemptOffset;
    };

    const wrapTask = (i: number, attemptOffset: number) => async () => {
      // VEO domain mass-die short-circuit: if ≥ threshold accounts on this email's domain
      // have already been confirmed dead in the current TTL window, skip the subprocess and
      // return a synthetic dead result. Saves 10-20s per account when a bulk-created lot has
      // been banned (see incrVeoDomainDeadCount for details). Only on first attempt — retries
      // already check the same flag implicitly because the counter doesn't decrement.
      if (tool === "veo") {
        const domain = extractEmailDomain(allAccounts[i].email);
        if (domain) {
          const deadCount = await getVeoDomainDeadCount(redis, domain);
          if (deadCount >= VEO_DOMAIN_DEAD_THRESHOLD) {
            console.log(
              `[account-check] claim=${claimId} veo domain '${domain}' over threshold (${deadCount}/${VEO_DOMAIN_DEAD_THRESHOLD}) — auto-dead for ${allAccounts[i].email}`,
            );
            completed++;
            await writeProgress();
            return syntheticVeoDomainMassDieResult(allAccounts[i].email, domain, deadCount);
          }
        }
      }
      const p = await pickHealthyProxy(proxyStartIdx(i, attemptOffset));
      lastProxyByIdx.set(i, p);
      const r = await runSingleCheck(tool, {
        email: allAccounts[i].email,
        password: allAccounts[i].password,
        extra: allAccounts[i].extra,
        proxy: p,
      });
      completed++;
      await writeProgress();
      return r;
    };

    // Grok HTTP fast-path: gửi cả batch lên server.js (CF warmer + cookie share).
    // Fail → fallback sang subprocess. Chỉ áp dụng khi tool='grok' và URL set.
    let allResults: Array<{ raw: string; parsed: any | null; exitCode: number | null; timedOut: boolean }> | null = null;
    if (tool === "grok" && CHECK_GROK_URL) {
      try {
        const proxiesForBatch: Array<string | null> = [];
        for (let i = 0; i < allAccounts.length; i++) {
          const p = await pickHealthyProxy(proxyStartIdx(i, 0));
          proxiesForBatch.push(p);
          lastProxyByIdx.set(i, p);
        }
        allResults = await runGrokBatchViaHttp(
          allAccounts.map((a) => ({ email: a.email, password: a.password, extra: a.extra })),
          proxiesForBatch,
          async (done) => {
            // Server polls report cumulative done count → mirror it on our side
            completed = Math.min(total, done);
            await writeProgress();
          },
        );
        // If all entries are timeouts (server unreachable / hung), fall back.
        const allTimed = allResults.every((r) => r.timedOut);
        if (allTimed) {
          console.warn(`[account-check] claim=${claimId} grok HTTP all timed out → fallback subprocess`);
          allResults = null;
        }
      } catch (err: any) {
        console.warn(
          `[account-check] claim=${claimId} grok HTTP failed (${err?.message || err}) → fallback subprocess`,
        );
        allResults = null;
      }
    }

    // VEO HTTP fast-path: mirror grok pattern. Saves ~3-5s/account by reusing the server's
    // persistent Chromium pool (no cold launch tax). The veo domain mass-die short-circuit
    // in wrapTask still runs first via the subprocess path; HTTP path bypasses it because
    // the server has no awareness of Redis dead-domain markers — so we filter mass-dead
    // domains BEFORE submitting to keep the short-circuit semantics intact.
    if (!allResults && tool === "veo" && CHECK_VEO_URL) {
      // Filter accounts whose domain is over the mass-die threshold — those get the synthetic
      // dead result without involving the veo server. Track them by original idx so we can
      // splice results back in the right order.
      const veoBatch: Array<{ email: string; password: string; extra?: string | null }> = [];
      const veoIdxMap: number[] = [];
      const proxiesForBatch: Array<string | null> = [];
      const localResults: Array<{ raw: string; parsed: any | null; exitCode: number | null; timedOut: boolean } | null> =
        new Array(allAccounts.length).fill(null);

      for (let i = 0; i < allAccounts.length; i++) {
        const domain = extractEmailDomain(allAccounts[i].email);
        if (domain) {
          const deadCount = await getVeoDomainDeadCount(redis, domain);
          if (deadCount >= VEO_DOMAIN_DEAD_THRESHOLD) {
            localResults[i] = syntheticVeoDomainMassDieResult(allAccounts[i].email, domain, deadCount);
            completed++;
            continue;
          }
        }
        veoBatch.push({ email: allAccounts[i].email, password: allAccounts[i].password, extra: allAccounts[i].extra });
        veoIdxMap.push(i);
        const p = await pickHealthyProxy(proxyStartIdx(i, 0));
        proxiesForBatch.push(p);
        lastProxyByIdx.set(i, p);
      }
      await writeProgress();

      if (veoBatch.length > 0) {
        try {
          const httpResults = await runVeoBatchViaHttp(
            veoBatch,
            proxiesForBatch,
            async (done) => {
              completed = Math.min(total, (allAccounts.length - veoBatch.length) + done);
              await writeProgress();
            },
          );
          // Splice HTTP results back into the original positions.
          for (let k = 0; k < veoIdxMap.length; k++) {
            localResults[veoIdxMap[k]] = httpResults[k];
          }
          const allTimed = httpResults.every((r) => r.timedOut);
          if (allTimed) {
            console.warn(`[account-check] claim=${claimId} veo HTTP all timed out → fallback subprocess`);
            // Leave allResults=null so the subprocess fallback below picks up.
          } else {
            allResults = localResults as any;
          }
        } catch (err: any) {
          console.warn(
            `[account-check] claim=${claimId} veo HTTP failed (${err?.message || err}) → fallback subprocess`,
          );
        }
      } else {
        // Every account short-circuited via mass-die — no HTTP call needed, use the locals.
        allResults = localResults as any;
      }
    }

    // Đọc hot từ DB (admin chỉnh /admin không cần restart). Quyết định bao nhiêu acc/job chạy
    // cùng lúc — đây là throttle chống bung 10 Chrome 1 lúc trên VPS RAM thấp.
    let perJobParallel = await getPerJobParallel(prisma);
    // P2: never run more concurrent logins than there are LIVE proxies. With sticky-proxy on,
    // extra concurrency would pile multiple logins onto the same IP → higher per-proxy rate →
    // turnstile/ban. Raw-IP fallback (liveProxyCount=0, requireProxy off) collapses to 1.
    if (adminProxies.length > 0) {
      const cap = Math.max(1, liveProxyCount);
      if (perJobParallel > cap) {
        console.log(
          `[account-check] claim=${claimId} P2: clamp perJobParallel ${perJobParallel}→${cap} (live proxies=${liveProxyCount})`,
        );
        perJobParallel = cap;
      }
    }

    if (!allResults) {
      allResults = await parallelLimit(
        allAccounts.map((_, idx) => wrapTask(idx, 0)),
        perJobParallel,
        SPAWN_STAGGER_MS,
      );
    }

    // Record proxies that hit a proxy-level failure so the retry passes below skip them and pick a
    // LIVE proxy (e.g. an account whose sticky proxy died still gets verified via a working one).
    const _recordFailedProxies = () => {
      for (let i = 0; i < allResults.length; i++) {
        const et = String((allResults[i]?.parsed as any)?.errorType || "").toLowerCase();
        if (et === "proxy_die") {
          const p = lastProxyByIdx.get(i);
          if (p) jobFailedProxies.add(p);
        }
      }
    };
    _recordFailedProxies();

    // Retry pass: re-run any account where the worker couldn't produce a valid result —
    // covers both subprocess timeouts (slow proxy, captcha) AND parse errors (tool crashed
    // mid-output, partial JSON, etc). Both surface as "Lỗi kiểm tra" in the customer UI,
    // and both are usually transient — retry with a fresh subprocess (next proxy in rotation)
    // frequently succeeds. Offset the proxy index by allAccounts.length + pass so each retry
    // attempts a DIFFERENT proxy than the one that failed.
    for (let pass = 0; pass < ACCOUNT_RETRY_COUNT; pass++) {
      const retryIdx: number[] = [];
      for (let i = 0; i < allResults.length; i++) {
        if (!allResults[i].parsed) retryIdx.push(i);
      }
      if (retryIdx.length === 0) break;
      console.log(
        `[account-check] claim=${claimId} retry ${pass + 1}/${ACCOUNT_RETRY_COUNT}: ${retryIdx.length}/${allResults.length} account(s) need retry (timeout/parse_error)`,
      );
      progressPhase = "retry";
      // Decrement completed by the count we're retrying so the UI shows "đang kiểm tra lại".
      completed = Math.max(0, completed - retryIdx.length);
      await writeProgress();
      // attemptOffset = pass + 1 → mỗi lần retry walk 1 bước trong rotation
      // (sticky mode: rời proxy gốc nếu nó lỗi; legacy: như cũ).
      const retried = await parallelLimit(
        retryIdx.map((i) => wrapTask(i, pass + 1)),
        perJobParallel,
      );
      for (let j = 0; j < retryIdx.length; j++) {
        allResults[retryIdx[j]] = retried[j];
      }
    }

    // Ambiguous-verdict retry pass (all tools, not just grok). When the tool returns a parsed
    // JSON but the verdict is unclear — status=Unknown / login_stuck / cf_timeout /
    // generic errors / Pro-Premium plan detection / etc. — give it 2 more attempts with
    // fresh proxies before kicking the claim to PENDING_REVIEW. Customer complaints: a single
    // ambiguous reading was routing too many claims to "manual review" when a retry on a
    // different proxy would often resolve cleanly.
    //
    // NO_RETRY list = states where retrying is either useless (definitive verdict) or actively
    // harmful (wrong_password might lockout the acc, proxy_die means the proxy is already
    // marked dead in Redis so retry would just pick another and waste a slot).
    const AMBIGUOUS_NO_RETRY = new Set([
      "wrong_password",   // Same creds will keep failing; risks Google/x.ai lockout escalation
      "2fa",              // Requires customer's OTP device — tool can never get past this
      "blocked",          // Hard ban, definitive
      // proxy_die is RETRYABLE: the failed proxy is recorded in jobFailedProxies so pickHealthyProxy
      // skips it and the retry lands on a LIVE proxy. Only when ALL proxies are dead does it
      // fall back to raw IP / stay unverified → seller review (money-safe).
      "domain_mass_die",  // Synthetic veo result from mass-die threshold — already a verdict
      "flow_blocked",     // Verified Flow service block by Workspace admin (won't change)
      "account_disabled", // Google account suspended — won't recover by retry
      "plan_lost",        // Verified plan drop to Free — won't change
    ]);
    const isAmbiguousResult = (r: any) => {
      const p = r?.parsed;
      if (!p) return false;            // null parse → Pass 1 territory
      if (p.isDead === true) return false;   // confirmed dead → AUTO_RESOLVE incoming
      if (p.stillPaid === true) return false;// confirmed paid → AUTO_REJECT incoming
      const et = String(p.errorType || "").toLowerCase();
      if (AMBIGUOUS_NO_RETRY.has(et)) return false;
      return true;
    };
    const AMBIGUOUS_RETRY = Math.max(0, Number(process.env.ACCOUNT_CHECK_AMBIGUOUS_RETRY || 2));
    for (let pass = 0; pass < AMBIGUOUS_RETRY; pass++) {
      const retryIdx: number[] = [];
      for (let i = 0; i < allResults.length; i++) {
        if (isAmbiguousResult(allResults[i])) retryIdx.push(i);
      }
      if (retryIdx.length === 0) break;
      console.log(
        `[account-check] claim=${claimId} ambiguous-retry ${pass + 1}/${AMBIGUOUS_RETRY}: ${retryIdx.length}/${allResults.length} account(s) — verdict unclear, retrying with fresh proxy (tool=${tool})`,
      );
      progressPhase = "retry";
      completed = Math.max(0, completed - retryIdx.length);
      await writeProgress();
      // attemptOffset = ACCOUNT_RETRY_COUNT + pass + 1 → unique per pass + steps past the
      // proxies used by Pass 1's no-parse retries, so we always try a fresh slot.
      // Use the P2-clamped perJobParallel (≤ live proxies), NOT the raw env constant, so the
      // ambiguous-retry pass doesn't spawn more concurrent logins than live proxies (ban-safe).
      const retried = await parallelLimit(
        retryIdx.map((i) => wrapTask(i, ACCOUNT_RETRY_COUNT + pass + 1)),
        perJobParallel,
      );
      for (let j = 0; j < retryIdx.length; j++) {
        allResults[retryIdx[j]] = retried[j];
      }
      _recordFailedProxies(); // a retry that hit another dead proxy → skip it on the next pass
    }

    // Mark proxies dead in shared cache. Triggers when:
    //   (a) parsed.errorType === 'proxy_die' (tool kết luận proxy chết)
    //   (b) result has no parsed (subprocess timeout) — DEFENSIVE: chỉ mark
    //       nếu cùng proxy đã fail TIMEOUT cho >= 2 account → tránh false positive
    //       khi 1 acc đơn lẻ timeout vì lý do khác (CF chậm, acc lỗi)
    const proxyTimeoutCount = new Map<string, number>();
    for (let i = 0; i < allResults.length; i++) {
      const r = allResults[i];
      const proxyUsed = lastProxyByIdx.get(i) || null;
      if (!proxyUsed) continue;
      const et = String(r.parsed?.errorType || "").toLowerCase();
      if (et === "proxy_die") {
        await markProxyDead(redis, proxyUsed, tool, "proxy_die");
      } else if (!r.parsed && r.timedOut) {
        const key = makeProxyHostPort(proxyUsed);
        if (key) proxyTimeoutCount.set(key, (proxyTimeoutCount.get(key) || 0) + 1);
      }
    }
    for (const [hp, count] of proxyTimeoutCount.entries()) {
      if (count >= 2) {
        await markProxyDead(redis, hp, tool, `subprocess_timeout x${count}`);
      }
    }

    // Veo domain death counter: increment per confirmed-dead account, grouped by email domain.
    // Excludes synthetic results (errorType=domain_mass_die) — those were already short-circuited
    // and re-incrementing would self-amplify the counter without new evidence.
    if (tool === "veo") {
      const byDomain = new Map<string, number>();
      for (let i = 0; i < allResults.length; i++) {
        const r = allResults[i];
        const p = r?.parsed;
        if (!p || p.isDead !== true) continue;
        if (String(p.errorType || "").toLowerCase() === "domain_mass_die") continue;
        const domain = extractEmailDomain(allAccounts[i].email);
        if (!domain) continue;
        byDomain.set(domain, (byDomain.get(domain) || 0) + 1);
      }
      // INCR sequentially per domain (not per account) — matches the natural "this batch killed
      // N more on domain X" framing in logs, and means the threshold-crossing log fires once
      // per batch rather than spuriously per account.
      for (const [domain, kills] of byDomain.entries()) {
        for (let k = 0; k < kills; k++) {
          await incrVeoDomainDeadCount(redis, domain, `claim=${claimId} batch +${kills}`);
        }
      }
    }

    // Primary = first account matching the job's top-level email.
    const primaryIdx = allAccounts.findIndex((a) => a.email === email);
    const idx = primaryIdx !== -1 ? primaryIdx : 0;
    const { raw, parsed, exitCode, timedOut } = allResults[idx];

    // Build per-account entries for the result (include all, even partial failures).
    const accountEntries = allAccounts.map((acc, i) => {
      const r = allResults[i];
      return r.parsed
        ? { email: acc.email, ...r.parsed }
        : { email: acc.email, ok: false, error: r.timedOut ? "timeout" : "parse_error" };
    });

    // Aggregated result: primary account's top-level verdict + accounts array for display.
    const aggregatedParsed = parsed ? { ...parsed, accounts: accountEntries } : null;

    const completedAt = new Date();
    // GUARDED terminal write (M2): only write if this row is still ours (RUNNING + our jobId).
    // A flat-cutoff sweep or a recheck may have flipped/reset the row and (re)started a new job;
    // an unconditional update would clobber that fresh state with our stale verdict.
    if (timedOut || !aggregatedParsed) {
      const res = await prisma.warrantyClaim
        .updateMany({
          where: { id: claimId, autoCheckJobId: _jobId, autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.RUNNING },
          data: {
            autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.FAILED,
            autoCheckCompletedAt: completedAt,
            autoCheckErrorMessage: timedOut
              ? "Tool subprocess timed out"
              : `Could not parse JSON_RESULT from tool (exit ${exitCode}). Raw: ${raw.slice(-500)}`,
          },
        })
        .catch(() => ({ count: 0 }));
      _ownedTerminal = res.count === 1;
    } else {
      const res = await prisma.warrantyClaim
        .updateMany({
          where: { id: claimId, autoCheckJobId: _jobId, autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.RUNNING },
          data: {
            autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.COMPLETED,
            autoCheckCompletedAt: completedAt,
            autoCheckResult: aggregatedParsed,
            autoCheckErrorMessage: null,
          },
        })
        .catch(() => ({ count: 0 }));
      _ownedTerminal = res.count === 1;
    }
    finalState = { ok: !!aggregatedParsed, timedOut, parsed: aggregatedParsed };
  } catch (err: any) {
    console.error("[account-check] processJob threw:", err?.message || err);
    const res = await prisma.warrantyClaim
      .updateMany({
        where: { id: claimId, autoCheckJobId: _jobId, autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.RUNNING },
        data: {
          autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.FAILED,
          autoCheckCompletedAt: new Date(),
          autoCheckErrorMessage: `Worker exception: ${err?.message || String(err)}`,
        },
      })
      .catch(() => ({ count: 0 }));
    _ownedTerminal = res.count === 1;
  }

  // Only fire the callback when our terminal write actually landed. If the sweep/recheck already
  // took the row (count===0), the entity that took it owns the follow-up — we must not drive an
  // apply on our now-stale verdict.
  if (_ownedTerminal) await notifyApiCallback(claimId);
  return finalState;
}

/**
 * Sweep claims that have been stuck in QUEUED or RUNNING for too long
 * (e.g. worker died mid-job). Mark them FAILED and trigger the callback so
 * `applyAutoCheckResult` can route them to PENDING_REVIEW for the seller.
 */
async function sweepStuckAutoChecks(prisma: PrismaClient, queue?: Queue) {
  // Dynamic cutoff (M1): a big multi-account claim legitimately runs far longer than a flat 10 min
  // — many accounts × JOB_TIMEOUT_MS, in waves of ACCOUNT_PARALLEL_LIMIT, across the initial + retry
  // passes. A flat cutoff would mark a still-RUNNING job FAILED and lose its real verdict. Size the
  // cutoff to that worst case, floored at 10 min for small jobs. The BullMQ job-state gate below is
  // the primary "is it really dead" signal; this cutoff is the backstop for evicted job records.
  const ambiguousRetry = Math.max(0, Number(process.env.ACCOUNT_CHECK_AMBIGUOUS_RETRY || 2));
  const passes = 1 + ACCOUNT_RETRY_COUNT + ambiguousRetry;
  const maxAccts = Math.max(1, Number(process.env.ACCOUNT_CHECK_SWEEP_MAX_ACCOUNTS || 20));
  const dynMs = JOB_TIMEOUT_MS * Math.ceil(maxAccts / ACCOUNT_PARALLEL_LIMIT) * passes * 1.5;
  const cutoffMs = Math.max(10 * 60 * 1000, dynMs);
  const cutoff = new Date(Date.now() - cutoffMs);
  const cutoffMin = Math.round(cutoffMs / 60000);
  const stuck = await prisma.warrantyClaim.findMany({
    where: {
      autoCheckStatus: { in: [WARRANTY_AUTO_CHECK_STATUS.QUEUED, WARRANTY_AUTO_CHECK_STATUS.RUNNING] },
      OR: [
        { autoCheckStartedAt: { lt: cutoff } },
        { AND: [{ autoCheckStartedAt: null }, { createdAt: { lt: cutoff } }] },
      ],
    },
    select: { id: true, autoCheckJobId: true },
    take: 50,
  });
  for (const claim of stuck) {
    // Never sweep a job that's STILL ALIVE in BullMQ — only sweep when the worker truly died
    // (job gone, or already in a finished/failed state). This prevents the false-FAILED race
    // where a slow-but-running multi-account job gets marked dead and its verdict is lost.
    if (queue && claim.autoCheckJobId) {
      const job = await queue.getJob(claim.autoCheckJobId).catch(() => null);
      if (job) {
        const st = await job.getState().catch(() => null);
        if (st === "active" || st === "waiting" || st === "delayed" || st === "waiting-children") continue;
      }
    }
    // Status guard: no-op if processJob wrote a terminal status between our read and this write,
    // so the sweep can never clobber a verdict the live job just committed.
    const res = await prisma.warrantyClaim
      .updateMany({
        where: { id: claim.id, autoCheckStatus: { in: [WARRANTY_AUTO_CHECK_STATUS.QUEUED, WARRANTY_AUTO_CHECK_STATUS.RUNNING] } },
        data: {
          autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.FAILED,
          autoCheckCompletedAt: new Date(),
          autoCheckErrorMessage: `Auto-check job did not complete within ${cutoffMin} minutes — worker likely restarted.`,
        },
      })
      .catch(() => ({ count: 0 }));
    if (res.count === 1) await notifyApiCallback(claim.id);
  }
  return stuck.length;
}

export async function setupAccountCheckWorker(prisma: PrismaClient, redis: Redis) {
  const queue = new Queue(QUEUES.accountCheck, { connection: redis });

  const concurrency = await getCheckConcurrency(prisma).catch(() => CONCURRENCY);

  // #5: a multi-account check legitimately runs minutes; on a busy box BullMQ's default lock
  // (30s) expires mid-job → it considers the job "stalled" and RE-RUNS it, causing DUPLICATE
  // real provider logins (ban risk) + a second verdict-apply. Size the lock to comfortably exceed
  // one job's worst case, and set maxStalledCount:0 so a genuinely-stalled long job is FAILED
  // (our worker.on("failed") + sweep recover it) instead of silently re-executed.
  const _maxAccts = Math.max(1, Number(process.env.ACCOUNT_CHECK_SWEEP_MAX_ACCOUNTS || 20));
  const _passes = 1 + ACCOUNT_RETRY_COUNT + Math.max(0, Number(process.env.ACCOUNT_CHECK_AMBIGUOUS_RETRY || 2));
  const _lockMs = Math.max(180_000, JOB_TIMEOUT_MS * Math.ceil(_maxAccts / ACCOUNT_PARALLEL_LIMIT) * _passes);
  const worker = new Worker(
    QUEUES.accountCheck,
    async (job) => {
      if (job.name !== JOBS.accountCheck) return null;
      return processJob(prisma, redis, job);
    },
    {
      connection: redis,
      concurrency,
      lockDuration: _lockMs,
      stalledInterval: Math.min(_lockMs, 60_000),
      maxStalledCount: 0,
    },
  );

  worker.on("failed", async (job, error) => {
    console.error("[account-check] job failed:", job?.id, error?.message || error);
    // M1 fast-recovery: BullMQ marks a job failed when the worker crashed/stalled (or an error
    // escaped processJob's own try/catch). processJob normally catches everything and returns, so
    // this fires for genuinely-dead jobs — the claim is wedged in RUNNING. Escalate it NOW instead
    // of waiting for the time-gated sweep (tens of minutes). Guarded on QUEUED/RUNNING so it can
    // never clobber a terminal row a healthy job/sweep/recheck already wrote; callback only if owned.
    const claimId = (job?.data as any)?.claimId;
    if (!claimId) return;
    try {
      const res = await prisma.warrantyClaim.updateMany({
        where: { id: String(claimId), autoCheckStatus: { in: [WARRANTY_AUTO_CHECK_STATUS.QUEUED, WARRANTY_AUTO_CHECK_STATUS.RUNNING] } },
        data: {
          autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.FAILED,
          autoCheckCompletedAt: new Date(),
          autoCheckErrorMessage: `Job failed (worker crash/stall): ${error?.message || "unknown"}`,
        },
      });
      if (res.count === 1) await notifyApiCallback(String(claimId));
    } catch (e: any) {
      console.error("[account-check] failed-handler escalation error:", e?.message || e);
    }
  });
  worker.on("error", (error) => {
    console.error("[account-check] worker error:", error?.message || error);
  });

  // Startup validation: check that each tool's single-check.js exists. Log loudly if not —
  // warranties for missing tools will fail but the worker keeps running.
  const toolPaths = {
    veo: resolveToolPath("veo"),
    grok: resolveToolPath("grok"),
    gpt: resolveToolPath("gpt"),
  };
  for (const [tool, p] of Object.entries(toolPaths)) {
    if (!existsSync(p)) {
      console.warn(
        `[account-check] ⚠ Tool '${tool}' single-check.js NOT FOUND at ${p}. ` +
          `Set CHECK_${tool.toUpperCase()}_PATH env var to the correct path. ` +
          `Auto-checks for that family will fail until fixed.`,
      );
    }
  }
  if (process.env.NODE_ENV === "production") {
    const missing = Object.entries(toolPaths).filter(([_, p]) => !existsSync(p));
    if (missing.length === Object.keys(toolPaths).length) {
      console.error(
        "[account-check] ❌ ALL tool wrappers are missing in production. Set CHECK_*_PATH env vars.",
      );
    }
  }

  // Periodic sweep for stuck claims (worker restarts, network blips, etc.)
  const SWEEP_INTERVAL_MS = Number(process.env.ACCOUNT_CHECK_SWEEP_INTERVAL_MS || 60_000);
  const sweepTimer = setInterval(() => {
    sweepStuckAutoChecks(prisma, queue).catch((err) => {
      console.error("[account-check] sweep failed:", err?.message || err);
    });
  }, SWEEP_INTERVAL_MS);
  // Run once on startup so a crash recovery cleans up immediately.
  sweepStuckAutoChecks(prisma, queue).catch(() => undefined);

  const proxyCount = (await getCheckProxies(prisma).catch(() => [])).length;
  const grokHttp = CHECK_GROK_URL
    ? `grokHttp=${CHECK_GROK_URL} (CF warmer fast-path; subprocess fallback if down)`
    : "grokHttp=off (subprocess only)";
  const veoHttp = CHECK_VEO_URL
    ? `veoHttp=${CHECK_VEO_URL} (browser pool fast-path; subprocess fallback if down)`
    : "veoHttp=off (subprocess only)";
  const stickyProxy = STICKY_PROXY_ENABLED ? "stickyProxy=on (hash email→same proxy)" : "stickyProxy=off (round-robin)";
  const requireProxyOn = !/^(0|false|off|no)$/i.test(String(process.env.WARRANTY_REQUIRE_PROXY ?? "").trim());
  const requireProxy = requireProxyOn
    ? "requireProxy=on (no live proxy → fail to review, never raw IP)"
    : "requireProxy=off (raw-IP fallback allowed)";
  const ambiguousRetryCount = Math.max(0, Number(process.env.ACCOUNT_CHECK_AMBIGUOUS_RETRY || 2));
  console.log(
    `[account-check] Worker started. bullmqConcurrency=${concurrency} jobs/parallel, perJobParallel=${ACCOUNT_PARALLEL_LIMIT} chromes (clamped ≤ live proxies), peakChrome=${concurrency * ACCOUNT_PARALLEL_LIMIT}, spawnStagger=${SPAWN_STAGGER_MS}ms, proxies=${proxyCount}${proxyCount === 0 ? " (warning: no proxies configured)" : ""}, jobTimeout=${JOB_TIMEOUT_MS}ms, sweepInterval=${SWEEP_INTERVAL_MS}ms, retries=${ACCOUNT_RETRY_COUNT}+${ambiguousRetryCount}(ambiguous), veoDomainMassDie=${VEO_DOMAIN_DEAD_THRESHOLD}/${VEO_DOMAIN_DEAD_TTL_SEC}s, ${grokHttp}, ${veoHttp}, ${stickyProxy}, ${requireProxy}`,
  );
  return { queue, worker, sweepTimer };
}
