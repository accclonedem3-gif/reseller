# Warranty check tools

3 công cụ kiểm tra tài khoản tự động dùng cho luồng **bảo hành auto-check** (worker gọi qua HTTP):

| Thư mục | Sản phẩm | Endpoint chính |
|---------|----------|----------------|
| `check_veo/` | Veo / Google | `server.js` (POST batch + single-check) |
| `check_gpt/` | ChatGPT | `check_gpt.js` / `single-check.js` |
| `CheckGrokJS/` | Grok | `server.js` / `toolgrok.js` |

## Chạy
```bash
cd tools/<tool> && npm install && node server.js
```
API server đọc cấu hình qua **env** (vd `API_KEY`, `PORT`). Worker reseller trỏ tới qua `CHECK_VEO_URL` / `CHECK_GPT_URL` / `CHECK_GROK_URL`.

## ⚠️ Không commit
`node_modules/`, `accounts.txt`, `proxies.txt`/`proxy.txt`, `sessions/`, `cookies/`, `*.log`, `*.csv`, ảnh debug — đã liệt kê trong `.gitignore`. Đây là dữ liệu chạy/credential, **không đẩy lên git**.
