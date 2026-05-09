# Reseller Platform

Monorepo reseller bot ban hang Telegram theo stack:

- `apps/api`: NestJS + Prisma + PostgreSQL + BullMQ producer
- `apps/worker`: BullMQ workers + Telegram polling
- `apps/web`: React + Vite + TypeScript + Tailwind dashboard
- `packages/shared`: constants + server/client shared utils

## Quick Start

1. Install dependencies:

```powershell
cmd /c npm.cmd install
```

2. Copy env:

```powershell
Copy-Item .env.example .env
```

3. Start infra:

```powershell
docker compose up -d
```

4. Generate Prisma client + apply migrations + seed:

```powershell
cmd /c npx prisma generate --schema prisma/schema.prisma
cmd /c npx prisma migrate deploy --schema prisma/schema.prisma
cmd /c npm.cmd run db:seed
```

5. Build apps:

```powershell
cmd /c npm.cmd run build
```

6. Run runtime services:

Dev mode nhanh nhat:

```powershell
cmd /c npm.cmd run dev
```

Hoac dung script local all-in-one:

```powershell
.\start-local.cmd
```

Script nay se:

- cho Docker Desktop san sang
- `docker compose up -d` cho Postgres + Redis
- `db:deploy`
- chan mo trung local stack de tranh `Telegram 409 Conflict`
- cuoi cung moi chay `npm run dev`

Flag huu ich:

```powershell
.\start-local.cmd -SkipDev
.\start-local.cmd -Seed
.\start-local.cmd -ForceRestart
```

Hoac chay build output tach rieng:

Terminal 1:

```powershell
cmd /c npm.cmd run start:api
```

Terminal 2:

```powershell
cmd /c npm.cmd run start:worker
```

Terminal 3:

```powershell
cmd /c npm.cmd run serve:web:dist
```

Open:

- API: `http://localhost:3000/api/v1`
- Web: `http://localhost:5173`

## Useful Commands

```powershell
cmd /c npm.cmd run typecheck
cmd /c npm.cmd run db:deploy
cmd /c npm.cmd run db:seed
docker compose ps
docker compose down
```

## Demo Accounts

- Super admin: `admin@example.com / Admin123!`
- Seller: `seller@example.com / Seller123!`

## Local Notes

- `.env` chi dung cho secret he thong.
- `APP_ENCRYPTION_KEY` co the la mot chuoi manh bat ky, hoac khoa hex 64 ky tu. Seller secret van duoc ma hoa trong DB.
- Secret cua seller (`BOT_TOKEN`, provider buyer key, PayOS keys) duoc luu encrypted trong DB.
- Local default dang chay `mock` cho payment/provider/telegram de full flow co the smoke test ngay.
- Khi gan `BOT_TOKEN` va `providerBuyerKey` that, he thong van support verify + sync + Telegram polling/webhook.
- Neu muon dung PayOS that, doi `PAYMENT_MODE=payos` va set du `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`.

## Smoke Flow Da Test

- Seller login
- Verify Telegram mock
- Verify provider mock
- Sync products
- Simulate Telegram buy
- Mock payment confirm
- Upstream purchase success -> `delivered`
- Upstream out of stock -> `paid_waiting_stock` + wallet refund
- Broadcast queue -> `COMPLETED`
