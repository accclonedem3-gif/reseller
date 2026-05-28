# AltivoxAI Backup System

Auto backup Postgres + uploads + .env lên Telegram mỗi 30 phút, retention 3 ngày, encrypted GPG AES-256.

## 🚀 Setup lần đầu (VPS lên rồi mới làm)

### 1. Tạo bot backup mới qua @BotFather

```
/newbot
Tên: AltivoxAI Backup
Username: altivox_backup_bot
```

→ Lấy bot token (dạng `123456789:AAEh...`)

### 2. Lấy chat ID

- Mở chat với bot mới tạo, gửi `/start`
- Forward 1 tin nhắn từ chính mình cho `@userinfobot` → bot trả về `Your user ID: 123456789`

### 3. Copy script lên VPS

```bash
# Từ local Windows
scp scripts/backup-to-telegram.sh root@vps:/opt/reseller-platform/scripts/
scp scripts/restore-from-telegram.sh root@vps:/opt/reseller-platform/scripts/
scp scripts/altivox-backup.conf.example root@vps:/etc/altivox-backup.conf
```

### 4. Cấu hình `/etc/altivox-backup.conf`

```bash
ssh root@vps
nano /etc/altivox-backup.conf
```

Điền:
- `BOT_TOKEN` từ BotFather
- `CHAT_ID` từ @userinfobot
- `ENCRYPTION_PASSPHRASE` — **TỐI THIỂU 32 KÝ TỰ, LƯU 2 BẢN, KHÔNG ĐƯỢC MẤT**

Lưu password ở 1Password / Bitwarden / giấy. **Mất passphrase = mất toàn bộ backup vĩnh viễn.**

### 5. Permissions + cron

```bash
chmod 600 /etc/altivox-backup.conf
chmod +x /opt/reseller-platform/scripts/backup-to-telegram.sh
chmod +x /opt/reseller-platform/scripts/restore-from-telegram.sh

# Cài gpg nếu chưa có
apt-get install -y gnupg

# Test 1 lần manual
/opt/reseller-platform/scripts/backup-to-telegram.sh

# Nếu thấy file backup hiện trong chat Telegram → cron mỗi 30 phút
( crontab -l 2>/dev/null; echo "*/30 * * * * /opt/reseller-platform/scripts/backup-to-telegram.sh" ) | crontab -

# Verify
crontab -l
```

## 📥 Restore khi cần

### Bước 1 — Download backup từ Telegram về VPS

Mở chat backup → tìm file ngày/giờ cần → bấm Save → copy URL Telegram CDN (right-click file → Copy Download Link), rồi:

```bash
# Hoặc download về local rồi scp lên VPS:
scp Downloads/db_20260525_140000.sql.gpg.gz root@vps:/tmp/
```

Nếu file bị split (chunks `.part_aa`, `.part_ab`...):
```bash
# Download tất cả chunks về cùng folder, ghép lại:
cat db_20260525_140000.sql.gpg.gz.part_* > db_20260525_140000.sql.gpg.gz
```

### Bước 2 — Restore DB

```bash
/opt/reseller-platform/scripts/restore-from-telegram.sh db /tmp/db_20260525_140000.sql.gpg.gz
```

Script sẽ tự:
- Stop pm2 reseller-api / reseller-worker
- Drop + recreate DB
- Decrypt + restore
- Chạy `npm run db:deploy` để sync Prisma schema
- Restart pm2

### Bước 3 — Restore files (uploads + .env)

```bash
/opt/reseller-platform/scripts/restore-from-telegram.sh files /tmp/files_20260525_140000.tar.gpg.gz
```

**⚠️ Cẩn thận:** `.env` sẽ bị overwrite. Nếu có config production khác, backup ra trước:
```bash
cp /opt/reseller-platform/.env /opt/reseller-platform/.env.before-restore
```

## 🔍 Monitoring

### Check log

```bash
tail -f /var/log/altivox-backup.log         # log chính
tail -f /var/log/altivox-backup-messages.log # message ID tracking (để delete old)
```

### Verify cron đang chạy

```bash
grep CRON /var/log/syslog | grep altivox    # xem cron có trigger không
crontab -l                                    # confirm cron đã thêm
```

## 🔧 Troubleshooting

| Vấn đề | Nguyên nhân | Fix |
|---|---|---|
| `413 Request Entity Too Large` | File > 50MB không split | Script tự split — check log |
| `gpg: decryption failed` | Sai passphrase | Verify `ENCRYPTION_PASSPHRASE` trong conf |
| Cron không chạy | Service `cron` chưa start | `systemctl start cron` + `systemctl enable cron` |
| Backup empty (0KB) | Postgres container không up | `docker ps` check container |
| `curl: command not found` | Thiếu curl | `apt install curl` |

## 📊 Storage size estimate

| DB rows | Raw | Compressed | Per backup |
|---|---|---|---|
| 1k sellers / 10k orders | ~50MB | ~10MB | ~10MB |
| 10k sellers / 100k orders | ~200MB | ~30MB | ~30MB |
| 100k sellers / 1M orders | ~2GB | ~300MB | cần self-host bot API |

30 phút × 48/ngày × 3 ngày retention = ~144 backups giữ
- Với 10MB/file → 1.4GB tổng → Telegram OK (unlimited)
- Với 30MB/file → 4.3GB tổng → OK

## 🔐 Security checklist

- [ ] Bot backup là **bot riêng** (không dùng bot bán hàng)
- [ ] Chat ID là **chat riêng** với mình hoặc private channel (không group)
- [ ] `ENCRYPTION_PASSPHRASE` ≥ 32 ký tự, lưu 2 chỗ
- [ ] `chmod 600 /etc/altivox-backup.conf` (chỉ root đọc)
- [ ] Bot token KHÔNG share, KHÔNG commit git
- [ ] Test restore lần đầu để biết flow OK
