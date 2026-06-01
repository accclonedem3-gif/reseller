# Production Deployment — Cách 2 (Tool Pool Isolation)

End-to-end guide for deploying the reseller platform with auto-check tools as
isolated services. Verified against [docker-compose.production.yml](docker-compose.production.yml).

## Architecture recap

```
Internet ─→ Cloudflare/ALB ─→ [web] (Nginx static)
                              [api ] (NestJS, 2+ replicas)
                              [worker] (BullMQ + Telegram polling)
                                  │
                                  ├─ HTTP ─→ [grok-pool] (Chromium pool, scale 1-N)
                                  └─ HTTP ─→ [veo-pool]  (Chromium pool, scale 1-N)
                              [postgres] [redis] (managed in cloud)
```

Tool pools talk to the API only via the **internal docker network** — never exposed
to the internet. The reseller folder, `CheckGrokJS/`, and `check_veo/` must sit as
siblings on the deploy host:

```
/srv/
├── reseller/        ← this repo
├── CheckGrokJS/     ← grok tool (Puppeteer)
└── check_veo/       ← veo tool (Playwright)
```

## Quick start — single VPS, 16GB RAM

```bash
# 1. Clone repos side by side
cd /srv
git clone <reseller-repo> reseller
git clone <CheckGrokJS-repo> CheckGrokJS
git clone <check_veo-repo> check_veo

# 2. Configure secrets
cd reseller
cp .env.production.example .env.production
# Edit .env.production — fill every REQUIRED secret. Generate with:
openssl rand -hex 32   # for JWT/encryption/internal token secrets
openssl rand -hex 16   # for POSTGRES_PASSWORD, GROK_API_KEY, VEO_API_KEY

# 3. Drop your real proxy lists into the tool folders
echo "host:port:user:pass" > ../CheckGrokJS/proxy.txt
echo "host:port:user:pass" > ../check_veo/proxies.txt

# 4. Build & launch
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build

# 5. Watch boot
docker compose -f docker-compose.production.yml logs -f
# Wait for these lines:
#   api-1       | API is running on http://localhost:3000/api/v1
#   worker-1    | Worker started. ... grokHttp=http://grok-pool.internal:3000 ...
#   grok-pool-1 | 🚀 Grok API on :3000  |  concurrency=6
#   veo-pool-1  | 🚀 Veo Check API on :3000  |  pool=2

# 6. Smoke test
curl -s http://localhost:3000/api/v1/health    # API (404 ok — no health endpoint, but means it's serving)
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<seed pwd>"}'
```

## Scale knobs

Edit `.env.production` and re-up. Compose will spin/kill replicas without downtime
(except DB migrations on api boot — minor blip).

```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d
```

| Var | Effect | Recommended |
|---|---|---|
| `API_REPLICAS` | Number of NestJS instances behind LB | 2 minimum (HA), scale by CPU |
| `WORKER_REPLICAS` | BullMQ workers | 1 = OK for ≤200 claims/day; scale by queue depth |
| `WEB_REPLICAS` | Static Nginx serving | 2 = HA |
| `GROK_MAX_CONCURRENCY` | Concurrent Chrome in 1 grok-pool replica | 6 (4GB RAM/replica) |
| `VEO_POOL_MAX` | Persistent browser contexts in 1 veo-pool replica | 2 (4GB RAM/replica) |

To horizontally scale tool pools beyond a single replica:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production \
  up -d --scale grok-pool=3 --scale veo-pool=2
```

Docker round-robins HTTP requests across replicas via the `grok-pool.internal`
network alias.

## Cloud-managed alternative (recommended for scale > 500 claims/day)

Replace `postgres` and `redis` services in compose with managed equivalents:

| Service | Compose | Cloud equivalent |
|---|---|---|
| `postgres` | postgres:16-alpine | AWS RDS Aurora Postgres / GCP Cloud SQL |
| `redis` | redis:7-alpine | AWS ElastiCache / GCP Memorystore |
| `api`, `worker`, `web` | Docker container | AWS Fargate / GCP Cloud Run / k8s |
| `grok-pool`, `veo-pool` | Docker container | Fargate with KEDA autoscaler, OR dedicated VPS |

Set env vars to point at managed services:

```bash
DATABASE_URL=postgresql://USER:PASS@aurora-host:5432/reseller?schema=public&sslmode=require
REDIS_URL=rediss://default:PASS@elasticache-host:6379
```

## Observability

Add these alerts to your monitoring stack:

| Metric | Where to grab it | Alert |
|---|---|---|
| `check_success_rate` | API logs `applyAutoCheckResult` outcomes | < 80% over 15min |
| `check_duration_p95` | Worker logs `elapsed_ms` per check | > 30s |
| `proxy_dead_count` | `GET grok-pool:3000/stats` JSON | > 30% pool dead |
| `bullmq_queue_depth` | `redis-cli LLEN bull:account-check:wait` | > 100 sustained |
| `cf_challenge_rate` | Grep grok-pool logs for "CF chưa pass" | > 50% means proxy flagged |
| `pool_memory` | `docker stats` or cgroup metrics | > 90% sustained = leak |

A Grafana dashboard scraping these from the docker daemon + Postgres + Redis covers most ops.

## Tool resilience patterns (already coded)

| Pattern | What it does | How to tune |
|---|---|---|
| Browser pool warmer | Pre-passes CF every 10 min so first customer hit is warm | `WARMER_INTERVAL_MIN`, `WARMER_PARALLEL` |
| Dead-proxy cache | Cross-tool 10-min cooldown on proxy_die | `PROXY_DEAD_TTL_SEC` |
| Veo domain mass-die | Skip check entirely when 20+ accs on same domain confirmed dead | `VEO_DOMAIN_DEAD_THRESHOLD` |
| Stuck claim sweep | API marks claims FAILED if stuck >10 min, fires callback | `ACCOUNT_CHECK_SWEEP_INTERVAL_MS` |
| Callback retry | Worker→API callback retries 4× with exp backoff | `CALLBACK_MAX_ATTEMPTS` |
| Redis circuit breaker | API skips cache after 5 consecutive Redis fails | (no tunable; hardcoded 30s open) |
| Hard queue cap | Reject claims at 2× overload threshold | `warranty.check.concurrency` × 8 (SystemConfig) |
| Batch lifetime bypass | Synthetic isDead when `accLifetimeDays` exceeded — zero tool spawn | Per-product UI |

## Disaster recovery checklist

1. **Postgres backup**: managed RDS auto-snapshot daily, retain 7 days. Self-hosted: `pg_dump | gzip` to S3 nightly via cron.
2. **Redis loss**: acceptable (jobs requeue from DB state on worker restart; cache cold for 30s).
3. **Tool pool restart**: profiles persist in volume, so CF cookies survive container restarts within ~25min TTL. Beyond that, warmer cycle re-passes CF (~30s lag).
4. **Proxy provider outage**: tool errors flow to `PENDING_REVIEW`, seller manual resolve. Set `WARRANTY_DISABLED_TOOLS=veo,grok,gpt` env temporarily to fast-path all claims to manual without ~90s tool timeout.

## Common issues

**Worker spams `Tool 'grok' single-check.js NOT FOUND`**
→ `CHECK_GROK_URL` env is missing or pointing wrong. Worker falls back to subprocess
which fails because the tool isn't bundled in the worker image. Fix env, redeploy.

**Tool pool returns 401**
→ `GROK_API_KEY` mismatch between tool and worker env. Same value must be in
`grok-pool` and `worker` services. Compose template above passes the same var to both.

**Postgres health-check fails on first boot**
→ Volume initialization takes 10-30s. Wait it out — `depends_on: condition: service_healthy`
already gates dependent services.

**Tool pool memory grows over time**
→ Chromium has known leaks. Compose's `mem_limit` triggers an OOM-kill + restart. Acceptable.
For long-term ops, schedule `docker compose restart grok-pool` nightly via cron.

## CI/CD outline

Pseudo-pipeline:

```yaml
build:
  - docker build -t registry/reseller-api:$SHA  -f Dockerfile.api .
  - docker build -t registry/reseller-worker:$SHA -f Dockerfile.worker .
  - docker build -t registry/reseller-web:$SHA  -f Dockerfile.web .
  - docker build -t registry/grok-pool:$SHA     ../CheckGrokJS
  - docker build -t registry/veo-pool:$SHA      ../check_veo
  - docker push registry/<all-above>:$SHA

deploy:
  - ssh deploy-host "cd /srv/reseller && \
      docker pull registry/<all>:$SHA && \
      docker compose -f docker-compose.production.yml --env-file .env.production up -d"
```

For cloud: replace `ssh` with `aws ecs update-service` / `kubectl set image` / `gcloud run deploy`.
