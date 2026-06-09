# Warranty check tools — deploy VPS riêng

3 công cụ kiểm tra tài khoản tự động cho luồng **bảo hành auto-check**. Tách ra VPS riêng để
cách ly RAM + rủi ro ban (Chromium + proxy) khỏi app chính.

| Thư mục | SP | Cơ chế | Port (host) | Health |
|---------|----|--------|-------------|--------|
| `CheckGrokJS/` | Grok | Puppeteer + CF warmer, HTTP server | **4001** | `GET /health` |
| `check_veo/` | Veo/Google | Playwright + browser pool, HTTP server | **4002** | `GET /stats` |
| `check_gpt/` | ChatGPT | Playwright, HTTP server (browser/request) | **4003** | `GET /health` |

App chính gọi sang qua HTTP, **fallback subprocess** nếu server down (veo/grok; gpt fallback khi có tool local).

## Deploy trên VPS-2 (Docker)

```bash
# 1. Lấy code (chỉ cần thư mục tools/)
git clone <repo> && cd reseller/tools

# 2. Cấu hình khoá bảo vệ
cp .env.example .env
nano .env            # đặt API_KEY = chuỗi ngẫu nhiên mạnh (openssl rand -hex 24)

# 3. Tạo file proxy (mỗi dòng 1 proxy: host:port hoặc host:port:user:pass)
touch CheckGrokJS/proxy.txt check_veo/proxies.txt check_gpt/proxies.txt
nano CheckGrokJS/proxy.txt   # dán proxy vào (3 tool có thể dùng chung danh sách)

# 4. Build + chạy
docker compose up -d --build
docker compose ps
curl -s http://localhost:4001/health   # grok
curl -s http://localhost:4002/stats    # veo
curl -s http://localhost:4003/health   # gpt
```

RAM: mỗi service `mem_limit 1500m` → ~4.5GB cho cả 3 khi chạy đồng thời. VPS-2 nên ≥ 6–8GB.

## Trỏ app chính sang VPS-2

Trong `.env` của **worker** (VPS chính), set (thay `VPS2_IP`):

```bash
CHECK_GROK_URL=http://VPS2_IP:4001
CHECK_VEO_URL=http://VPS2_IP:4002
CHECK_GPT_URL=http://VPS2_IP:4003      # mới — bỏ trống = gpt chạy subprocess local như cũ
CHECK_GROK_API_KEY=<API_KEY ở .env VPS-2>
CHECK_VEO_API_KEY=<API_KEY>
CHECK_GPT_API_KEY=<API_KEY>
```

> ⚠️ Mở port 4001-4003 **chỉ cho IP VPS chính** (firewall/security group), đừng phơi ra Internet.
> Luôn đặt `API_KEY` — không có thì ai chạm port cũng dùng được checker.

## Quản lý proxy
- Sửa trực tiếp file proxy trên VPS-2 rồi gọi reload (veo/grok có `POST /admin/reload-proxies`),
  hoặc `docker compose restart`.
- File proxy được bind-mount nên đổi không cần build lại.

## ⚠️ Không commit (đã có trong `.gitignore`)
`node_modules/`, `accounts.txt`, `proxies.txt`/`proxy.txt`, `sessions/`, `cookies/`, `*.log`,
`*.csv`, ảnh debug, `.env`. Đây là dữ liệu chạy/credential.

## Chạy thủ công (không Docker)
```bash
cd tools/<tool> && npm install && PORT=4001 API_KEY=xxx node server.js
# check_gpt cần: npx playwright install chromium  (lần đầu)
```
