# Deploy lên Railway (test, không có warranty auto-check)

Mục tiêu: chạy 3 service (api, worker, web) + Postgres + Redis trên Railway, có thể truy cập qua URL `*.up.railway.app`. Phần warranty auto-check tài khoản (Grok/Veo/GPT) bị **tắt** trên deploy này vì worker không bundle Chrome — claim sẽ fall-back về `PENDING_REVIEW` (seller xử lý tay).

---

## 0. Generate secrets

Chạy file `scripts/gen-railway-secrets.ps1` để in ra các secret cần dùng. Copy giá trị, dán vào bước 4.

## 1. Login Railway CLI

```powershell
railway login
```

Browser sẽ mở. Login bằng tài khoản Railway. Free tier $5/tháng đủ cho test.

## 2. Init project

```powershell
railway init
# Nhập tên project, ví dụ: reseller-test
```

Lệnh này tạo Railway project và LINK thư mục hiện tại với project đó. File `.railway/project.json` được tạo (gitignored an toàn).

## 3. Thêm Postgres + Redis

```powershell
railway add --database postgres
railway add --database redis
```

Railway tự tạo 2 service `Postgres` và `Redis`, expose biến `DATABASE_URL` và `REDIS_URL` qua biến **shared** (mỗi app service tự reference được).

## 4. Tạo 3 app service (API, Worker, Web)

Mở dashboard Railway (link in trong output của `railway init`) → **New Service** → **Empty Service** → đặt tên lần lượt: `api`, `worker`, `web`.

Sau đó với mỗi service, vào tab **Variables**, thêm các biến (tùy service) — xem section 5 phía dưới.

Hoặc dùng CLI:

```powershell
# (Optional) tạo nhanh từ CLI nếu Railway hỗ trợ — fallback dùng dashboard.
# Mỗi version CLI có thể khác, an toàn nhất là tạo qua dashboard ở bước này.
```

## 5. Set environment variables

Trong dashboard, mở từng service → **Variables**:

### Service `api`

| Key | Value |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.api` |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` (reference) |
| `JWT_ACCESS_SECRET` | *(từ gen-secrets)* |
| `JWT_REFRESH_SECRET` | *(từ gen-secrets)* |
| `JWT_ACCESS_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `30d` |
| `APP_ENCRYPTION_KEY` | *(từ gen-secrets)* |
| `INTERNAL_API_TOKEN` | *(từ gen-secrets)* |
| `APP_PUBLIC_URL` | (lát điền sau khi api có URL) |
| `CORS_ORIGIN` | (lát điền sau khi web có URL) |
| `PAYMENT_MODE` | `payos` |
| `PAYOS_CLIENT_ID` | (để trống nếu không test payment) |
| `PAYOS_API_KEY` | (để trống) |
| `PAYOS_CHECKSUM_KEY` | (để trống) |
| `SEED_SUPER_ADMIN_EMAIL` | `thaidem57` |
| `SEED_SUPER_ADMIN_PASSWORD` | *(chọn password admin)* |
| `SEED_DEMO_DATA` | `true` *(để có sẵn data test)* |
| `MOCK_PROVIDER_ENABLED` | `true` |

### Service `worker`

| Key | Value |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.worker` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `APP_ENCRYPTION_KEY` | *(giống api)* |
| `INTERNAL_API_TOKEN` | *(giống api)* |
| `APP_PUBLIC_URL` | (giống api) |

### Service `web`

| Key | Value |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.web` |
| `VITE_API_URL` | (api URL + `/api/v1`, điền sau) |

## 6. Deploy API trước

```powershell
railway link --service api
railway up --detach
```

Đợi build xong (~3-5 phút lần đầu). Vào dashboard tab **Settings → Networking** → bật **Generate Domain**. Sẽ có URL kiểu `reseller-api-xxxx.up.railway.app`.

Quay lại tab **Variables**, fill:
- `APP_PUBLIC_URL` = `https://reseller-api-xxxx.up.railway.app`

Railway tự re-deploy.

## 7. Deploy worker

```powershell
railway link --service worker
railway up --detach
```

Worker chạy headless, không cần domain.

Fill biến `APP_PUBLIC_URL` cho worker = giống api.

## 8. Deploy web

```powershell
railway link --service web
railway up --detach
```

Lúc này phải set `VITE_API_URL` TRƯỚC khi build vì Vite bake at build time. Nên trình tự đúng là:

1. Vào Variables của service `web`, set `VITE_API_URL=https://reseller-api-xxxx.up.railway.app/api/v1`
2. Bật **Generate Domain** trong Settings → có URL kiểu `reseller-web-xxxx.up.railway.app`
3. Quay về service `api`, vào Variables, set `CORS_ORIGIN=https://reseller-web-xxxx.up.railway.app`
4. Trigger redeploy api (push hoặc click Redeploy trong dashboard)
5. Trigger redeploy web (sau khi VITE_API_URL có)

## 9. Test

Mở `https://reseller-web-xxxx.up.railway.app`. Login bằng admin `thaidem57` + password đã set. Nếu `SEED_DEMO_DATA=true`, sẽ có sẵn shop + đơn demo.

Test warranty form ở `https://reseller-web-xxxx.up.railway.app/bao-hanh?shop=ultra-source-shop` — bot/UI ổn nhưng auto-check sẽ skip (worker log warning `Tool 'grok' single-check.js NOT FOUND`, claim chuyển PENDING_REVIEW).

## Troubleshooting

- **Build fail "out of memory"**: Railway free tier có hạn RAM. Vào Settings → Resources, tăng nếu cần.
- **`Can't reach database server`**: kiểm tra biến reference `${{Postgres.DATABASE_URL}}` có đúng tên service không (case-sensitive). Service postgres tên gì thì sửa lại.
- **Migration không chạy**: kiểm tra log API service, dòng đầu phải là `prisma migrate deploy`. Nếu skipped do biến `DATABASE_URL` rỗng.
- **CORS error**: trong Variables service api, sửa `CORS_ORIGIN` đúng URL web (https://, không có trailing slash).
- **Worker spam "Telegram polling failed: Conflict"**: bot token đang được bot khác (vd local dev) cũng poll. Dừng worker local nếu test trên Railway.

## Cleanup

```powershell
railway down  # Stop current service
# Hoặc xoá toàn project từ dashboard
```
