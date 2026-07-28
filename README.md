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

## USDT tu dong qua TON cho shop bot

1. Chay migration `20260717000000_add_usdt_ton` bang `npm run db:deploy`.
2. Co the dat `TONCENTER_API_KEY` mot lan trong `.env` cua server de tang rate limit. Key nay dung chung cho worker, seller khong phai tu nhap.
3. Moi seller vao cau hinh bot/shop va nhap **USDT TON Address** cua chinh ho. Bot cua shop do se tu hien them phuong thuc `USDT (TON)`. He thong chap nhan dia chi friendly `EQ...` / `UQ...` co checksum hoac raw `workchain:hex`.
4. Khoi dong lai API va worker. Worker quet moi 30 giay, chi chap nhan Jetton transfer den dung vi, dung so tien hoa don va dung official USDT master.

`PLATFORM_DEPOSIT_SHOP_ID` khong can cho don hang shop bot. Bien nay chi tuy chon neu he thong con muon nhan USDT cho nap vi seller hoac mua tier bang mot vi platform chung.

Khong dat dia chi vi nhan vao `TON_USDT_MASTER_ADDRESS`. Bien nay phai giu dia chi Jetton master chinh thuc; dia chi vi nhan duoc cau hinh rieng cho tung shop.

## PayPal Checkout cho shop bot

1. Chay cac migration moi bang `npm run db:deploy`, gom PayPal Checkout va toggle hien thi tung phuong thuc.
2. Moi seller tao REST app trong PayPal Developer, sau do mo tab **USDT**, bam muc PayPal va nhap Client ID, Client Secret, Webhook ID. Credential duoc ma hoa trong database va tien di thang vao PayPal Business cua shop.
3. Dang ky Webhook URL hien tren trang cau hinh voi hai event `CHECKOUT.ORDER.APPROVED` va `PAYMENT.CAPTURE.COMPLETED`.
4. Bat Sandbox de test. Khi dung Live credentials, tat Sandbox truoc khi nhan tien that.
5. PayPal Orders API thanh toan bang USD. He thong uu tien gia USD cua san pham; neu chua co se quy doi VND theo ty gia cua shop hoac `PAYPAL_VND_RATE`.

PayPal la phuong thuc bo sung va co the bat song song voi cong VND PayOS/Pay2s/Web2m. Bot chi giao hang sau khi PayPal capture trang thai `COMPLETED`, dung ma don, dung currency USD va du so tien. Khong dat Client Secret cua seller trong `.env` va khong gui key qua Telegram/chat.

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
