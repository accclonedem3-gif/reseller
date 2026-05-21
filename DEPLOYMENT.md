# Deploy reseller-platform

## 1. DNS

Tạo 2 bản ghi DNS trỏ về IP VPS:

- `app.yourdomain.com` cho web dashboard
- `api.yourdomain.com` cho API

## 2. Cài phần mềm trên VPS

Khuyến nghị Ubuntu 22.04/24.04.

```bash
sudo apt update
sudo apt install -y git nginx docker.io docker-compose-plugin
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

## 3. Upload code

Ví dụ đặt source tại:

```bash
sudo mkdir -p /opt/reseller-platform
sudo chown -R $USER:$USER /opt/reseller-platform
cd /opt/reseller-platform
git clone <repo-url> .
```

Nếu không dùng git, upload toàn bộ thư mục repo lên `/opt/reseller-platform`.

## 4. Tạo file `.env`

```bash
cp deploy/production.env.example .env
nano .env
```

Bắt buộc đổi:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `APP_ENCRYPTION_KEY`
- `INTERNAL_API_TOKEN`
- `APP_PUBLIC_URL=https://api.yourdomain.com`
- `WEB_PUBLIC_URL=https://app.yourdomain.com`
- `CORS_ORIGIN=https://app.yourdomain.com`
- PayOS keys

Không đổi `APP_ENCRYPTION_KEY` sau khi đã có dữ liệu thật.

## 5. Bật Postgres và Redis

```bash
docker compose up -d
```

Nếu dùng password khác trong Postgres, sửa lại `docker-compose.yml` và `DATABASE_URL` cho khớp.
Mặc định compose chỉ bind Postgres/Redis vào `127.0.0.1`, không mở DB/Redis ra internet.

## 6. Build, migrate, chạy app

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

Kiểm tra:

```bash
pm2 status
pm2 logs reseller-api
pm2 logs reseller-worker
```

Lưu ý: `reseller-worker` chỉ nên chạy 1 instance để tránh Telegram polling conflict.

## 7. Nginx

```bash
sudo cp deploy/nginx.reseller-platform.conf /etc/nginx/sites-available/reseller-platform
sudo nano /etc/nginx/sites-available/reseller-platform
sudo ln -s /etc/nginx/sites-available/reseller-platform /etc/nginx/sites-enabled/reseller-platform
sudo nginx -t
sudo systemctl reload nginx
```

Nhớ đổi:

- `app.example.com` thành domain web thật
- `api.example.com` thành domain API thật

## 8. SSL

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.yourdomain.com -d api.yourdomain.com
```

## 9. Test production

- Mở `https://app.yourdomain.com`
- Đăng nhập admin
- Tạo CTV
- CTV nhập `BOT_TOKEN`, buyer key và PayOS
- Verify Telegram
- Verify nguồn
- Sync sản phẩm
- Test bot Telegram tạo đơn
- Test PayOS callback
- Kiểm tra worker giao tài khoản

## Update sau này

```bash
cd /opt/reseller-platform
git pull
./deploy/deploy.sh
sudo systemctl reload nginx
```

Nếu chỉ đổi frontend, vẫn có thể chạy script trên cho an toàn.
