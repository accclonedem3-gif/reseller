import { randomBytes, createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, SourceProductFamily } from "@prisma/client";

import {
  PRODUCT_FAMILY_TO_TOOL,
  SYSTEM_CONFIG_KEYS,
  WARRANTY_AUTO_CHECK_STATUS,
} from "@reseller/shared";

import { PrismaService } from "../db/prisma.service";
import { CacheService } from "../lib/cache.service";
import { QueueService } from "../lib/queue.service";
import { countResolvedWarrantyAccounts } from "../lib/utils";

export type AutoCheckTool = "veo" | "grok" | "gpt";

type DeliveredCredentials = {
  email: string;
  password: string;
  extra: string | null;
};

@Injectable()
export class WarrantyAutoCheckService {
  private readonly logger = new Logger(WarrantyAutoCheckService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  /** Invalidate the cached status snapshot for a claim. Call on every state mutation. */
  invalidateStatus(claimId: string): void {
    void this.cache.del(`wac:status:${claimId}`);
  }

  async getConfig(): Promise<{ overloadThreshold: number; cooldownDays: number }> {
    const cached = this.cache.memoGet<{ overloadThreshold: number; cooldownDays: number }>(
      "wac:config",
    );
    if (cached) return cached;
    const rows = await this.prisma.systemConfig.findMany({
      where: {
        key: {
          in: [
            SYSTEM_CONFIG_KEYS.warrantyCheckConcurrency,
            SYSTEM_CONFIG_KEYS.warrantyCooldownDays,
          ],
        },
      },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const concurrencyRaw = Number(map.get(SYSTEM_CONFIG_KEYS.warrantyCheckConcurrency) ?? 3);
    const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.floor(concurrencyRaw) : 3;
    const cooldownRaw = Number(map.get(SYSTEM_CONFIG_KEYS.warrantyCooldownDays) ?? 7);
    const cooldownDays = Number.isFinite(cooldownRaw) && cooldownRaw >= 0 ? Math.floor(cooldownRaw) : 7;
    const result = { overloadThreshold: concurrency * 4, cooldownDays };
    this.cache.memoSet("wac:config", result, 30);
    return result;
  }

  /**
   * Returns the most recent resolved warranty claim for an order, or null.
   * Only AUTO_RESOLVED and RESOLVED_MANUAL count — rejected claims are ignored.
   *
   * Scope: per-orderId only. Customers can technically reset the cooldown by buying a new
   * order for the same product — that's intentional (a brand-new purchase is a fresh
   * commercial transaction, not an abuse pattern). Anti-abuse pressure is on the same
   * physical account (which gets replaced post-warranty); a brand-new buy gets a brand-new
   * account anyway. Don't widen this to per-customer/per-product without product approval.
   */
  async findCooldownBlocker(
    orderId: string,
    cooldownDays: number,
    targetEmail?: string | null,
  ): Promise<{ blockedUntil: Date; lastResolvedAt: Date } | null> {
    if (cooldownDays <= 0) return null;
    const resolved = await this.prisma.warrantyClaim.findMany({
      where: {
        orderId,
        status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
        resolvedAt: { not: null },
      },
      orderBy: { resolvedAt: "desc" },
      take: targetEmail ? 20 : 2,
      select: { resolvedAt: true, metadataJson: true },
    });

    let relevant = resolved;
    if (targetEmail) {
      // Per-account cooldown: only count resolutions that replaced THIS specific account.
      // Prevents account B cooldown being blocked because account A was already replaced.
      const want = targetEmail.toLowerCase().trim();
      relevant = resolved.filter((c) => {
        const meta = c.metadataJson as Record<string, unknown> | null;
        const replacedEmails = meta?.replacedAccountEmails as string[] | undefined;
        if (Array.isArray(replacedEmails) && replacedEmails.length > 0) {
          return replacedEmails.some((e) => {
            const s = String(e).toLowerCase().trim();
            return s === want || s.split("@")[0] === want;
          });
        }
        // Fallback for old claims: targetUsernames
        const targets = meta?.targetUsernames as string[] | undefined;
        if (Array.isArray(targets) && targets.length > 0) {
          return targets.some((t) => {
            const s = String(t).toLowerCase().trim();
            return s === want || s.split("@")[0] === want || s.startsWith(want);
          });
        }
        return false;
      });
    }

    if (relevant.length < 2) return null;
    const recent = relevant[0]!;
    if (!recent.resolvedAt) return null;
    const blockedUntil = new Date(recent.resolvedAt.getTime() + cooldownDays * 86400_000);
    if (blockedUntil.getTime() <= Date.now()) return null;
    return { blockedUntil, lastResolvedAt: recent.resolvedAt };
  }

  /**
   * Returns the account text that is currently "active" for this order — the most
   * recent replacement from a resolved warranty claim, falling back to the original
   * delivered account if no claim has resolved yet.
   *
   * This is what the auto-check should validate against. The original account that
   * was already replaced via warranty is no longer eligible for warranty.
   */
  async getCurrentActiveAccountText(orderId: string): Promise<string | null> {
    const latestResolved = await this.prisma.warrantyClaim.findFirst({
      where: {
        orderId,
        status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
        deliveredAccountText: { not: null },
      },
      orderBy: { resolvedAt: "desc" },
      select: { deliveredAccountText: true },
    });
    if (latestResolved?.deliveredAccountText) {
      return latestResolved.deliveredAccountText;
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { deliveredAccountText: true },
    });
    return order?.deliveredAccountText || null;
  }

  resolveToolForFamily(family: SourceProductFamily | string | null | undefined): AutoCheckTool | null {
    if (!family) return null;
    const key = String(family).toUpperCase();
    const tool = (PRODUCT_FAMILY_TO_TOOL[key] as AutoCheckTool | undefined) ?? null;
    if (!tool) return null;
    // Operator-controlled kill switch. Comma-separated list of tools to disable, e.g.
    // `WARRANTY_DISABLED_TOOLS=gpt` to take the ChatGPT auto-check offline until its
    // underlying single-check.js is stable. Disabled tools cause the warranty flow to fall
    // through to `UNSUPPORTED` → customer sees "hệ thống chưa cập nhật, liên hệ admin" and
    // the seller handles the claim manually. No code change needed to re-enable.
    const disabled = String(process.env.WARRANTY_DISABLED_TOOLS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    // Safety FLOOR: gpt's single-check.js defaults transient failures (timeout/error) AND
    // wrong-password to DIE → wrongful auto-refund. Until that tool is hardened, keep gpt disabled
    // regardless of the env value so an unrelated WARRANTY_DISABLED_TOOLS edit can't silently expose it.
    if (!disabled.includes("gpt")) disabled.push("gpt");
    if (disabled.includes(tool)) return null;
    return tool;
  }

  parseAllCredentials(deliveredText: string | null | undefined): DeliveredCredentials[] {
    if (!deliveredText) return [];
    const lines = String(deliveredText)
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const out: DeliveredCredentials[] = [];
    for (const line of lines) {
      // Mirror standalone toolgrok.js splitAccountLine: try explicit separators first,
      // then fall back to whitespace. Otherwise lines using plain spaces between
      // email and password (common when sellers paste from formatted text) get skipped.
      let parts: string[] | null = null;
      for (const sep of ["|", ";", "\t", ","]) {
        if (line.includes(sep)) {
          const candidate = line.split(sep).map((s) => s.trim()).filter(Boolean);
          if (candidate.length >= 2 && candidate[0]!.includes("@")) {
            parts = candidate;
            break;
          }
        }
      }
      if (!parts) {
        // Whitespace fallback: split on first run of whitespace. Don't use `:` blindly —
        // a password can legitimately contain `:` and we'd shred it.
        const m = line.match(/^(\S+)\s+(.+)$/);
        if (m && m[1]!.includes("@")) {
          parts = [m[1]!, m[2]!.trim()];
        } else if (line.includes(":")) {
          // Last resort: split on the colon AFTER the @ so `user@domain.com:pwd` works
          // but a password containing a single `:` is preserved on the password side.
          const at = line.indexOf("@");
          const ci = at !== -1 ? line.indexOf(":", at + 1) : line.indexOf(":");
          if (ci !== -1) {
            const user = line.slice(0, ci).trim();
            const rest = line.slice(ci + 1).trim();
            if (user.includes("@") && rest) parts = [user, rest];
          }
        }
      }
      if (!parts) continue;
      const email = parts[0]?.trim();
      const password = parts[1]?.trim();
      const extra = parts[2]?.trim() || null;
      if (email && email.includes("@") && password) {
        out.push({ email, password, extra: extra || null });
      }
    }
    return out;
  }

  /**
   * Áp pwd override per-account. Key trong map có thể là email full ("a@x.com") hoặc local-part ("a").
   * Không match → giữ credential gốc. Value rỗng/whitespace → skip.
   *
   * Dùng cho warranty form khi customer điền pwd mới cho từng acc trong grid (đã đổi mật khẩu).
   */
  applyPasswordOverrides(
    creds: DeliveredCredentials[],
    overrides: Record<string, string> | null | undefined,
  ): DeliveredCredentials[] {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return creds;
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof k !== "string" || typeof v !== "string") continue;
      const pwd = v.trim();
      if (!pwd) continue;
      map.set(k.toLowerCase().trim(), pwd);
    }
    if (map.size === 0) return creds;
    return creds.map((c) => {
      const email = c.email.toLowerCase();
      const prefix = email.split("@")[0] || email;
      const pwd = map.get(email) || map.get(prefix) || null;
      return pwd ? { ...c, password: pwd } : c;
    });
  }

  /**
   * Pick the credential that matches `targetUsername` (case-insensitive prefix-before-@).
   * Rules:
   * - 0 credentials parsed → null.
   * - targetUsername given + match found → that match.
   * - targetUsername given + no match + multiple credentials parsed → null (caller routes
   *   to manual review; silently falling back to creds[0] could check the WRONG acc on a
   *   multi-quantity order where only some accs were replaced).
   * - targetUsername given + no match + exactly one credential → that single credential
   *   (single-account orders where the target username doesn't exactly match the parsed
   *   email's prefix should still proceed).
   * - No targetUsername → first credential.
   */
  /**
   * EXACT membership test: is `email` one of the ORIGINAL delivered accounts of this text?
   * Unlike parseFirstCredential, there is NO single-credential `creds[0]` fallback — an email that
   * isn't actually present returns false. Used to detect a warranty-ISSUED replacement account
   * (which is never in the original delivery) so re-warranty of a replacement routes to manual
   * review instead of auto-issuing yet another replacement (the unbounded replacement-chain abuse).
   */
  isOriginalDeliveredEmail(deliveredText: string | null | undefined, email: string | null | undefined): boolean {
    if (!email) return false;
    const want = String(email).toLowerCase().trim();
    if (!want) return false;
    const wantPrefix = want.split("@")[0];
    return this.parseAllCredentials(deliveredText).some((c) => {
      const e = c.email.toLowerCase().trim();
      return e === want || (!!wantPrefix && e.split("@")[0] === wantPrefix);
    });
  }

  parseFirstCredential(
    deliveredText: string | null | undefined,
    targetUsername?: string | null,
  ): DeliveredCredentials | null {
    const creds = this.parseAllCredentials(deliveredText);
    if (creds.length === 0) return null;
    if (targetUsername) {
      const want = String(targetUsername).toLowerCase().trim();
      const match = creds.find((c) => {
        const e = c.email.toLowerCase();
        return e === want || e.split("@")[0] === want || e.startsWith(want);
      });
      if (match) return match;
      if (creds.length > 1) {
        // Ambiguous: customer named an account that doesn't appear in the parsed credentials,
        // but we have multiple credentials to choose from. Refuse to guess.
        return null;
      }
    }
    return creds[0] ?? null;
  }

  /**
   * Try to start an auto-check for a freshly opened claim. Caller must already have
   * created the claim row (status = PENDING). Returns the queue state so the caller
   * can craft a user-visible message.
   */
  async tryEnqueueForClaim(
    claimId: string,
    tool: AutoCheckTool,
    creds: DeliveredCredentials,
    shopId: string,
    allCreds?: DeliveredCredentials[],
  ) {
    const config = await this.getConfig();

    const load = await this.queue.getAccountCheckLoad().catch(() => ({ waiting: 0, active: 0, delayed: 0 }));
    const totalQueued = load.waiting + load.active + load.delayed;
    if (totalQueued >= config.overloadThreshold) {
      await this.prisma.warrantyClaim.update({
        where: { id: claimId },
        data: {
          autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.OVERLOADED,
          autoCheckTool: tool,
          autoCheckErrorMessage: `Queue saturated (${totalQueued} pending).`,
        },
      });
      return { enqueued: false, reason: "overloaded", queuePosition: null, queueLoad: totalQueued };
    }

    // Include all accounts in the job so the worker can check them all in parallel.
    const accountsPayload =
      allCreds && allCreds.length > 1
        ? allCreds.map((c) => ({ email: c.email, password: c.password, extra: c.extra ?? undefined }))
        : undefined;

    let job;
    try {
      job = await this.queue.addAccountCheckJob({
        claimId,
        shopId,
        tool,
        email: creds.email,
        password: creds.password,
        extra: creds.extra ?? undefined,
        ...(accountsPayload ? { accounts: accountsPayload } : {}),
      });
    } catch (error: any) {
      this.logger.error(`Failed to enqueue auto-check for claim ${claimId}: ${error?.message || error}`);
      await this.prisma.warrantyClaim.update({
        where: { id: claimId },
        data: {
          autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.FAILED,
          autoCheckTool: tool,
          autoCheckErrorMessage: `Queue error: ${error?.message || error}`,
        },
      });
      return { enqueued: false, reason: "queue_error", queuePosition: null, queueLoad: totalQueued };
    }

    // Hard cap defends against burst races: the soft check above (`totalQueued >= overloadThreshold`)
    // is non-atomic — N concurrent enqueuers can all observe queue size below threshold and all
    // add, spiking depth to threshold + N. After our own add, we re-read load; if it's blown
    // past the hard cap (2× threshold), we remove the job we just added and tell the customer
    // it's overloaded. Customer experience matches what they'd see if the soft check had won.
    const postLoad = await this.queue.getAccountCheckLoad().catch(() => null);
    const hardCap = config.overloadThreshold * 2;
    // Only enforce the hard cap on a job WE actually added. If addAccountCheckJob handed back a
    // pre-existing in-flight job (a concurrent duplicate enqueue for the same claim), removing it
    // would cancel another caller's legitimate check — skip the hard-cap removal/overload marking.
    const _jobPreExisting = (job as unknown as { __preExisting?: boolean }).__preExisting === true;
    if (!_jobPreExisting && postLoad && postLoad.waiting + postLoad.active + postLoad.delayed > hardCap) {
      try {
        await this.queue.removeAccountCheckJob(String(job.id ?? ""));
      } catch (e: any) {
        this.logger.warn(`Hard-cap removal failed for job ${job.id}: ${e?.message || e}`);
      }
      await this.prisma.warrantyClaim.update({
        where: { id: claimId },
        data: {
          autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.OVERLOADED,
          autoCheckTool: tool,
          autoCheckErrorMessage: `Queue saturated past hard cap (${postLoad.waiting + postLoad.active + postLoad.delayed}/${hardCap}).`,
        },
      });
      return {
        enqueued: false,
        reason: "overloaded",
        queuePosition: null,
        queueLoad: postLoad.waiting + postLoad.active + postLoad.delayed,
      };
    }

    await this.prisma.warrantyClaim.update({
      where: { id: claimId },
      data: {
        autoCheckStatus: WARRANTY_AUTO_CHECK_STATUS.QUEUED,
        autoCheckTool: tool,
        autoCheckJobId: String(job.id ?? ""),
        autoCheckErrorMessage: null,
      },
    });

    const pos = await this.queue
      .getAccountCheckQueuePosition(String(job.id ?? ""))
      .catch(() => ({ position: null, total: totalQueued + 1 }));

    return {
      enqueued: true,
      jobId: String(job.id ?? ""),
      queuePosition: pos.position,
      queueLoad: pos.total,
    };
  }

  /**
   * Returns true only if a previous resolved claim CONFIRMED this specific account was dead
   * and issued a replacement for it.
   *
   * Preferred check: `metadataJson.replacedAccountEmails` — set by applyAutoCheckResult and
   * contains ONLY accounts confirmed dead (isDead/Free). Falls back to `targetUsernames` for
   * old claims (pre-replacedAccountEmails) or RESOLVED_MANUAL without auto-check data.
   *
   * This prevents login_stuck / unverified accounts from being blocked — an account that
   * couldn't be checked is NOT the same as one that was confirmed dead and replaced.
   */
  /**
   * Build a Set of account identifiers (lowercased email + local-part) that have already been
   * replaced via a prior resolved warranty claim. Use to filter accounts out of the auto-check
   * candidate list — re-checking a dead-and-already-swapped account would issue a duplicate
   * replacement.
   *
   * Sources (same precedence as wasAccountSpecificallyReplaced):
   *  - metadataJson.replacedAccountEmails (preferred — only confirmed-dead accounts)
   *  - metadataJson.targetUsernames (fallback for old claims, only if delivered_account_text set)
   */
  async getReplacedEmailSet(orderId: string): Promise<Set<string>> {
    const resolved = await this.prisma.warrantyClaim.findMany({
      where: {
        orderId,
        status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
      },
      select: { metadataJson: true, deliveredAccountText: true },
    });
    const out = new Set<string>();
    const add = (s: string) => {
      const v = String(s).toLowerCase().trim();
      if (!v) return;
      out.add(v);
      const local = v.split("@")[0];
      if (local && local !== v) out.add(local);
    };
    for (const c of resolved) {
      const meta = c.metadataJson as Record<string, unknown> | null;
      const replacedEmails = meta?.replacedAccountEmails as string[] | undefined;
      if (Array.isArray(replacedEmails) && replacedEmails.length > 0) {
        replacedEmails.forEach(add);
        continue;
      }
      // Fallback for old claims pre-replacedAccountEmails: trust targetUsernames only when the
      // claim actually delivered a replacement. A claim closed without delivery should not
      // suppress future warranty submissions.
      if (!c.deliveredAccountText) continue;
      const targets = meta?.targetUsernames as string[] | undefined;
      if (Array.isArray(targets) && targets.length > 0) targets.forEach(add);
    }
    return out;
  }

  /** Filter parsed creds against a replaced-set (built via getReplacedEmailSet). */
  filterOutReplaced(
    creds: DeliveredCredentials[],
    replacedSet: Set<string>,
  ): DeliveredCredentials[] {
    if (replacedSet.size === 0) return creds;
    return creds.filter((c) => {
      const e = c.email.toLowerCase();
      const local = e.split("@")[0];
      return !replacedSet.has(e) && !(local && replacedSet.has(local));
    });
  }

  async wasAccountSpecificallyReplaced(orderId: string, targetUsername: string): Promise<boolean> {
    const resolved = await this.prisma.warrantyClaim.findMany({
      where: {
        orderId,
        status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any },
      },
      select: { metadataJson: true, deliveredAccountText: true },
    });
    const want = targetUsername.toLowerCase().trim();
    return resolved.some((c) => {
      const meta = c.metadataJson as Record<string, unknown> | null;

      // Preferred: replacedAccountEmails = only confirmed-dead accounts.
      const replacedEmails = meta?.replacedAccountEmails as string[] | undefined;
      if (Array.isArray(replacedEmails) && replacedEmails.length > 0) {
        return replacedEmails.some((e) => {
          const s = String(e).toLowerCase().trim();
          return s === want || s.split("@")[0] === want;
        });
      }

      // Fallback for old claims: targetUsernames — only trust when the claim actually
      // delivered an account. A claim closed without delivery (e.g. RESOLVED_MANUAL with
      // no replacement) should NOT block future warranty submissions.
      if (!c.deliveredAccountText) return false;
      const targets = meta?.targetUsernames as string[] | undefined;
      if (!Array.isArray(targets) || targets.length === 0) return false;
      return targets.some((t) => {
        const s = String(t).toLowerCase().trim();
        return s === want || s.split("@")[0] === want || s.startsWith(want);
      });
    });
  }

  /** Generate a one-shot 16-byte hex access token and return both raw token and SHA-256 hash. */
  generateAccessToken(): { token: string; hash: string } {
    const token = randomBytes(16).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    return { token, hash };
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Fetch claim status for the customer-facing polling endpoint.
   * Sensitive fields (deliveredAccountText) are only returned when accessToken matches.
   */
  async getStatus(claimId: string, accessToken?: string) {
    // Cache the heavy DB reads (claim row + invoice) for 2s. Polling clients hit every 2.5s,
    // so this collapses ≥1 hit/claim/sec down to ~1 hit/claim/2s. Sensitive fields are kept in
    // the cached snapshot and stripped post-fetch based on token, so the cache is token-agnostic.
    const snapshot = await this.cache.getOrLoad<{
      claim: any;
      invoice: any;
    } | null>(`wac:status:${claimId}`, 2, async () => {
      const claim = await this.prisma.warrantyClaim.findUnique({
        where: { id: claimId },
        select: {
          id: true,
          orderId: true,
          status: true,
          autoCheckStatus: true,
          autoCheckTool: true,
          autoCheckJobId: true,
          autoCheckResult: true,
          autoCheckStartedAt: true,
          autoCheckCompletedAt: true,
          autoCheckErrorMessage: true,
          autoCheckAttempts: true,
          resolutionNote: true,
          deliveredAccountText: true,
          customerMessage: true,
          metadataJson: true,
        },
      });
      if (!claim) return null;
      const invoice = await this.buildInvoiceForOrder(claim.orderId);
      return { claim, invoice };
    });
    if (!snapshot) return null;
    const claim: any = { ...snapshot.claim };
    const invoice = snapshot.invoice;
    const result: any = claim.autoCheckResult;

    // Extract progress BEFORE stripping autoCheckResult — progress (just counts + tool name)
    // is non-sensitive and the customer needs it while polling, with or without access token.
    const rawProgress = result && typeof result === "object" ? result.progress : null;
    const autoCheckProgress =
      rawProgress && typeof rawProgress === "object"
        ? {
            completed: Number(rawProgress.completed) || 0,
            total: Number(rawProgress.total) || 0,
            tool: typeof rawProgress.tool === "string" ? rawProgress.tool : null,
            phase: typeof rawProgress.phase === "string" ? rawProgress.phase : null,
          }
        : null;

    // Extract non-sensitive soft-fail markers BEFORE any token-gated stripping so the UI
    // can detect the soft-fail state and show the right message regardless of token.
    // autoCheckResult.errorType / .ok don't contain credentials — only isDead/errorType booleans.
    const rawResultForPublic: any = result;
    const softFailed =
      rawResultForPublic &&
      typeof rawResultForPublic === "object" &&
      rawResultForPublic.ok === false &&
      claim.status === "PENDING";
    const publicErrorType =
      softFailed && typeof rawResultForPublic.errorType === "string"
        ? rawResultForPublic.errorType
        : null;

    // Verify access token before exposing deliveredAccountText (which contains credentials).
    const metaJson = claim.metadataJson as Record<string, unknown> | null;
    const storedHash = typeof metaJson?.accessTokenHash === "string" ? metaJson.accessTokenHash : null;
    const tokenOk = !!accessToken && !!storedHash && this.hashToken(accessToken) === storedHash;
    let invoiceOut = invoice;
    if (!tokenOk) {
      // Strip sensitive fields when no valid token is provided.
      // deliveredAccountText contains credentials; autoCheckResult contains account health data.
      (claim as any).deliveredAccountText = null;
      (claim as any).autoCheckResult = null;
      // autoCheckErrorMessage carries raw tool stdout/stderr (may include proxy/login internals).
      // The sanitized `publicErrorType` below is what the UI shows; never leak the raw message to an
      // unauthenticated poller.
      (claim as any).autoCheckErrorMessage = null;
      // #6: the invoice is returned UNCONDITIONALLY and also carries deliveredAccountText
      // (credentials) + buyer PII (telegram username / name / chat id). Without sanitizing it,
      // the token gate above is trivially bypassed by reading invoice.deliveredAccountText.
      // Clone (don't mutate the cached snapshot) and null the sensitive fields.
      if (invoice) {
        invoiceOut = {
          ...invoice,
          deliveredAccountText: null,
          buyerUsername: null,
          buyerName: null,
          buyerTelegramId: null,
        };
      }
    }
    // Always strip metadataJson from the response since it contains the hash.
    (claim as any).metadataJson = undefined;

    // Compute queue state for QUEUED and RUNNING claims. Running ones return state=active so UI
    // can stop showing stale "queue position #1" and switch to "đang đăng nhập...".
    let queuePosition: number | null = null;
    let queueState: "active" | "waiting" | null = null;
    let queueAheadCount = 0;
    if (
      claim.autoCheckJobId &&
      (claim.autoCheckStatus === WARRANTY_AUTO_CHECK_STATUS.QUEUED ||
        claim.autoCheckStatus === WARRANTY_AUTO_CHECK_STATUS.RUNNING)
    ) {
      const pos = await this.queue
        .getAccountCheckQueuePosition(claim.autoCheckJobId)
        .catch(() => null);
      if (pos) {
        queuePosition = pos.position;
        queueState = pos.state;
        queueAheadCount = pos.aheadCount;
      }
    }

    (claim as any).orderId = undefined;
    return { ...claim, queuePosition, queueState, queueAheadCount, autoCheckProgress, invoice: invoiceOut, softFailed, publicErrorType };
  }

  // Mirror of WarrantyService.buildPublicInvoice — kept here to avoid a cross-service
  // dependency for the auto-check status polling endpoint. Shape must stay in sync.
  private async buildInvoiceForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderCode: true,
        productNameSnapshot: true,
        quantity: true,
        totalSaleAmount: true,
        status: true,
        createdAt: true,
        deliveredAt: true,
        deliveredAccountText: true,
        warrantyPolicySnapshot: true,
        warrantyStartedAt: true,
        warrantyExpiresAt: true,
        customer: { select: { telegramUsername: true, firstName: true, telegramChatId: true } },
        shop: { select: { supportTelegram: true, name: true } },
        warrantyClaims: {
          where: { status: { in: ["AUTO_RESOLVED", "RESOLVED_MANUAL"] as any } },
          select: { id: true, metadataJson: true },
        },
      },
    });
    if (!order) return null;
    return {
      orderCode:            order.orderCode,
      productName:          order.productNameSnapshot,
      sellerContact:        order.shop.supportTelegram || null,
      sellerShopName:       order.shop.name,
      buyerUsername:        order.customer?.telegramUsername || null,
      buyerName:            order.customer?.firstName || null,
      buyerTelegramId:      order.customer?.telegramChatId || null,
      deliveredAccountText: order.deliveredAccountText,
      quantity:             order.quantity,
      totalSaleAmount:      Number(order.totalSaleAmount),
      warrantyPolicy:       order.warrantyPolicySnapshot,
      warrantyStartedAt:    order.warrantyStartedAt?.toISOString() || null,
      warrantyExpiresAt:    order.warrantyExpiresAt?.toISOString() || null,
      createdAt:            order.createdAt.toISOString(),
      deliveredAt:          order.deliveredAt?.toISOString() || null,
      orderStatus:          order.status,
      resolvedClaimCount:   order.warrantyClaims.length,
      // Accounts resolved (refunded/replaced), not claims — matches the UI "/quantity" denominator.
      resolvedAccountCount: countResolvedWarrantyAccounts(order.warrantyClaims, order.quantity),
    };
  }

  /**
   * Build a localized message that summarizes the auto-check result, for showing the customer.
   */
  buildResultMessage(result: any, lang: "vi" | "en" | "th" = "vi"): string {
    if (!result || !result.ok) {
      return lang === "en"
        ? "We could not auto-check this account. The seller will review your claim manually."
        : lang === "th"
          ? "ระบบไม่สามารถตรวจสอบบัญชีอัตโนมัติได้ ผู้ขายจะตรวจสอบคำขอด้วยตนเอง"
          : "Hệ thống chưa kiểm tra được tài khoản. Shop sẽ xem xét yêu cầu của bạn thủ công.";
    }
    const plan = result.plan || result.tier || "Unknown";
    const expires = result.expires ? ` (đến ${result.expires})` : "";
    const planLower = String(plan).toLowerCase().trim();
    const statusLower = String(result.status || "").toLowerCase();
    // Mirror applyAutoCheckResult: credit=0 alone is NOT free (quota exhausted ≠ dead),
    // and session_expired is NOT dead. Trust explicit flags from the tool.
    const looksFree = planLower === "free" || /^free$/i.test(String(result.tier || ""));
    const isDeadResult =
      result.isDead === true || looksFree ||
      /\b(die|dead|wrong_pass|cancelled|canceled|blocked|suspended|disabled|banned|deactivated)\b/i.test(statusLower) ||
      /(^|[^_])\bexpired\b/i.test(statusLower);
    if (isDeadResult) {
      return lang === "en"
        ? `Account check: ${plan}. The account is no longer on a paid plan — warranty is being processed.`
        : `Kết quả kiểm tra: gói hiện tại là ${plan}${expires}. Tài khoản đã rớt khỏi gói trả phí — bảo hành đang được xử lý.`;
    }
    if (result.stillPaid === true) {
      return lang === "en"
        ? `Account check: ${plan}${expires}. The account is still valid — warranty cannot be applied right now.`
        : `Kết quả kiểm tra: ${plan}${expires}. Tài khoản vẫn còn hạn — chưa thể bảo hành lúc này. Vui lòng liên hệ shop nếu vẫn gặp vấn đề.`;
    }
    return lang === "en"
      ? `Account check completed. Plan: ${plan}${expires}.`
      : `Đã kiểm tra tài khoản. Gói: ${plan}${expires}.`;
  }
}
