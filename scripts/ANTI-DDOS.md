# Anti-DDoS and abuse protection

DDoS protection is layered. NestJS and nginx reduce HTTP (L7) abuse; a proxied edge provider is
still required to absorb a large bandwidth (L3/L4) flood before it reaches the VPS.

## Implemented in the repository

| Layer | Protection | Default |
|---|---|---|
| NestJS | Distributed global limiter backed by Redis | 100 requests / 60 seconds / route / IP |
| NestJS | Redis outage fallback | Process-local limiter, retry Redis after 5 seconds |
| Auth | Login/register/refresh/password-reset decorators | 3-10 requests per configured window |
| Warranty | Public route throttles + Redis abuse lockout | 20-30 requests/minute; escalating misses |
| Bot | Per-shop/per-customer flood control | Existing bot thresholds |
| nginx | General API bucket | 15 requests/second, burst 40, 25 concurrent connections/IP |
| nginx | Auth bucket | 1 request/second, burst 10, 10 concurrent connections/IP |
| nginx | Upload bucket | 2 requests/second, burst 5, route-specific 6/21 MB media caps |
| nginx | Signed webhooks | 30 requests/second, burst 100, finite connection/body/time limits |
| nginx | Internal worker callbacks | 100 requests/second, burst 200, finite connection/body/time limits |
| Origin | Node production bind | `127.0.0.1`; nginx is the public entry point |

Tune the distributed application limiter with:

```dotenv
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=100
API_RATE_LIMIT_BLOCK_MS=60000
```

The `/internal/*` and `/webhooks/*` controllers remain exempt from Nest's small per-route bucket
because all shops/providers share worker/provider source IPs. They are signature/token protected
and now receive separate, high-capacity but finite nginx buckets.

## Install or update nginx on the VPS

The installer backs up the live site, validates with `nginx -t`, restores automatically if
validation fails, and reloads only after a successful check:

```bash
bash /opt/reseller-platform/scripts/apply-nginx-security.sh
```

The production template is `deploy/nginx.reseller-platform.conf`. It also adds request/header/body
timeouts, hides the nginx version, adds browser security headers, and sandboxes `/uploads/*`.

## Cloudflare and origin firewall (still an infrastructure step)

1. Add the domain to Cloudflare and proxy `@`, `www`, and `api` (orange cloud).
2. Set SSL/TLS mode to **Full (strict)**.
3. Enable managed WAF rules and Bot Fight Mode.
4. Add rate rules for `/api/v1/auth/*` and a broader `/api/*` rule.
5. Confirm all three DNS records return Cloudflare addresses, not the VPS address.
6. Add nginx `set_real_ip_from` entries for every current Cloudflare IPv4/IPv6 range and use
   `real_ip_header CF-Connecting-IP`.
7. Validate nginx, then change UFW so ports 80/443 accept only Cloudflare ranges. Keep SSH access
   restricted to a known administrator IP before removing broad HTTP(S) rules.

Do not perform steps 6-7 before Cloudflare proxying is confirmed. Otherwise the site becomes
unreachable or a spoofable client-IP header defeats all per-IP limits.

## Verification

```bash
npm run test:rate-limit
sudo nginx -t
curl -I https://altivoxai.com
curl -I https://api.altivoxai.com/api/v1/public/warranty/shop/security-check
```

These controls mitigate brute force, abusive clients, slow requests and moderate HTTP floods.
Only Cloudflare or another upstream scrubbing provider can absorb a flood that saturates the VPS
network link.
