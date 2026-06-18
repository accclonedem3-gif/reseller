# Anti-DDoS / anti-abuse — what's in place & what you must do on the VPS

DDoS defense is layered. Code can only do application-level rate limiting (L7).
True volumetric floods (L3/L4) are stopped at the edge — **Cloudflare / nginx**.

## 1. App layer (already in the codebase — deployed automatically)

| Protection | Where | Limit |
|---|---|---|
| Bot flood control | `telegram-bot.service.v2.ts` `enforceFloodControl` | 20 msg / 10s per (shop, user) → silently dropped |
| Bot auto-ban | same | 120 msg / 60s sustained → `customer.blacklisted = true` (every later update dropped) |
| Global API rate limit | `app.module.ts` `APP_GUARD: ThrottlerGuard` | 100 req / min per real client IP |
| Login / auth throttle | `auth.controller.ts` `@Throttle` | 5–10 req / min |
| Warranty public throttle | `warranty-public.controller.ts` | 20–30 req / min |
| Internal-source API | `internal-source-auth.middleware.ts` | 60 req / min per API key |
| `helmet` security headers + CORS allowlist | `main.ts` | — |
| `trust proxy = 1` | `main.ts` | so per-IP limits key on the real client IP behind nginx |

**Exempt from the global limit** (would otherwise self-throttle): `/api/v1/internal/*`
(worker bot-polling callbacks) and `/api/v1/webhooks/*` (payment IPNs) — both are
signature/token verified, which is the real gate.

Unbanning a user: clear the `blacklisted` flag from the bot-users / customers screen.

Tuning the bot thresholds: the `FLOOD_*` constants at the top of `TelegramBotService`.

## 2. nginx layer (you apply this on the VPS — NOT automatic)

See `scripts/nginx-anti-ddos.conf.example`. It adds:
- `limit_req` (req/s per IP) + `limit_conn` (concurrent conns per IP),
- a tight bucket for `/auth/`, a general bucket for the rest,
- **no** limit on `/webhooks/` and `/internal/`,
- request-size / timeout caps (slow-loris).

```bash
sudo cp scripts/nginx-anti-ddos.conf.example /etc/nginx/conf.d/anti-ddos.conf
# paste the location{} snippets into your API server block, then:
sudo nginx -t && sudo systemctl reload nginx
```

## 3. Cloudflare (the actual volumetric-DDoS defense — strongly recommended)

1. Put the API + dashboard domains behind Cloudflare (orange-cloud / proxied).
2. **SSL/TLS** → Full (strict).
3. **Security → WAF → Rate limiting rules**: e.g. "more than 100 requests/min from one
   IP to `/api/*` → Block 1 min". Add a stricter rule for `/api/v1/auth/*`.
4. **Security → Bots** → enable Bot Fight Mode.
5. Under attack: **Security → Settings → Security Level = "I'm Under Attack"** (JS challenge).
6. Lock the origin: firewall the VPS so the API port only accepts Cloudflare IP ranges
   (https://www.cloudflare.com/ips/) — otherwise attackers bypass Cloudflare by hitting the
   origin IP directly.
7. If proxied through Cloudflare, enable the `real_ip` block in the nginx example so nginx
   and the app see the visitor IP (`CF-Connecting-IP`), not Cloudflare's.

## What this does and does not stop

- ✅ A single user/script spamming the bot or an endpoint → throttled / auto-banned.
- ✅ Credential brute-force on login → throttled (app + nginx + Cloudflare).
- ✅ Moderate L7 floods → absorbed by nginx + Cloudflare rate limits.
- ❌ Large volumetric L3/L4 floods → **only** Cloudflare (or a scrubbing provider) absorbs
  these; the VPS uplink would saturate before Node ever sees the traffic.
