# PROMPT / PRODUCT SPECIFICATION: TÍNH NĂNG "TELE CAMPAIGN" (USERBOT GROUP SEEDING & BROADCAST)

> **Mục tiêu:** Thêm mô-đun **Tele Campaign** (Marketing & Seeding nhóm Telegram bằng Tài khoản cá nhân / Userbot) vào dự án Monorepo `reseller-platform` hiện tại (`apps/api`, `apps/worker`, `apps/web`, `prisma`).

---

## 1. MỤC ĐÍCH TÍNH NĂNG
Hệ thống hiện tại đã có tính năng **Shop Bot Broadcast** (gửi thông báo từ Bot bán hàng tới khách hàng từng chat với Bot).
Tính năng mới này **"Tele Campaign (Userbot Seeding)"** giúp Seller:
1. Kết nối tài khoản Telegram cá nhân (Userbot) qua SĐT và OTP/2FA.
2. Tự động quét và đồng bộ tất cả nhóm Telegram mà tài khoản cá nhân đó tham gia.
3. Soạn nội dung (hỗ trợ Spintax xoay từ, hình ảnh, link Shop Bot).
4. Thiết lập chiến dịch tự động gửi tin/rải link (Broadcast/Seeding) vào các nhóm Telegram mục tiêu để kéo khách hàng mới về Shop Bot.

---

## 2. BỐ CỤC KIẾN TRÚC & CÁC THÀNH PHẦN CẦN PHÁT TRIỂN

### 📱 A. Database Schema (`prisma/schema.prisma`)
Cần thêm các Data Models và Enums:

```prisma
enum TelegramSessionStatus {
  ACTIVE
  REAUTH_REQUIRED
  FLOOD_WAIT
  DISABLED
}

enum UserbotCampaignStatus {
  DRAFT
  RUNNING
  PAUSED
  COMPLETED
  FAILED
}

enum UserbotLogStatus {
  SUCCESS
  FAILED
  SKIPPED
}

model TelegramUserSession {
  id                     String                @id @default(cuid())
  sellerId               String                @map("seller_id")
  phoneNumber            String                @map("phone_number")
  sessionStringEncrypted String                @map("session_string_encrypted")
  telegramUserId         String?               @map("telegram_user_id")
  telegramUsername       String?               @map("telegram_username")
  status                 TelegramSessionStatus @default(ACTIVE)
  lastSyncAt             DateTime?             @map("last_sync_at")
  createdAt              DateTime              @default(now()) @map("created_at")
  updatedAt              DateTime              @updatedAt @map("updated_at")
  
  seller                 Seller                @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  groups                 TelegramUserGroup[]
  campaigns              TelegramUserCampaign[]

  @@map("telegram_user_sessions")
}

model TelegramUserGroup {
  id               String              @id @default(cuid())
  sessionId        String              @map("session_id")
  telegramChatId   BigInt              @map("telegram_chat_id")
  title            String
  username         String?
  memberCount      Int?                @map("member_count")
  canSendMessages  Boolean             @default(true) @map("can_send_messages")
  isSupergroup     Boolean             @default(true) @map("is_supergroup")
  syncedAt         DateTime            @default(now()) @map("synced_at")

  session          TelegramUserSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, telegramChatId])
  @@map("telegram_user_groups")
}

enum TelegramUserTemplateType {
  SPINTAX_TEXT
  FORWARD_SAVED_MESSAGE
}

model TelegramUserTemplate {
  id               String                   @id @default(cuid())
  sellerId         String                   @map("seller_id")
  name             String
  type             TelegramUserTemplateType @default(SPINTAX_TEXT)
  content          String?                  @db.Text
  mediaUrl         String?                  @map("media_url")
  savedMessageId   BigInt?                  @map("saved_message_id")
  savedMessageText String?                  @map("saved_message_text") @db.Text
  createdAt        DateTime                 @default(now()) @map("created_at")
  updatedAt        DateTime                 @updatedAt @map("updated_at")

  seller           Seller                   @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  campaigns        TelegramUserCampaign[]

  @@map("telegram_user_templates")
}

model TelegramUserCampaign {
  id               String                @id @default(cuid())
  sellerId         String                @map("seller_id")
  sessionId        String                @map("session_id")
  templateId       String                @map("template_id")
  name             String
  targetGroupIds   Json                  @map("target_group_ids")
  delaySeconds     Int                   @default(60) @map("delay_seconds")
  scheduleTime     DateTime?             @map("schedule_time")
  status           UserbotCampaignStatus @default(DRAFT)
  totalTarget      Int                   @default(0) @map("total_target")
  sentCount        Int                   @default(0) @map("sent_count")
  failedCount      Int                   @default(0) @map("failed_count")
  createdAt        DateTime              @default(now()) @map("created_at")
  updatedAt        DateTime              @updatedAt @map("updated_at")

  seller           Seller                @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  session          TelegramUserSession   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  template         TelegramUserTemplate  @relation(fields: [templateId], references: [id], onDelete: Cascade)
  logs             TelegramUserCampaignLog[]

  @@map("telegram_user_campaigns")
}

model TelegramUserCampaignLog {
  id           String            @id @default(cuid())
  campaignId   String            @map("campaign_id")
  groupTitle   String            @map("group_title")
  groupChatId  BigInt            @map("group_chat_id")
  status       UserbotLogStatus
  errorDetail  String?           @map("error_detail")
  sentAt       DateTime          @default(now()) @map("sent_at")

  campaign     TelegramUserCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@map("telegram_user_campaign_logs")
}
```

---

### ⚙️ B. Backend API (`apps/api`)
Cần sử dụng thư viện **`telegram` (GramJS)** để tương tác với Telegram MTProto API:

1. **`UserbotAuthModule`**:
   - `POST /api/v1/userbot/auth/send-code`: Nhập SĐT -> Gửi mã OTP từ Telegram.
   - `POST /api/v1/userbot/auth/verify-code`: Nhập mã OTP + Password 2FA (nếu có) -> Nhận `sessionString` -> Mã hóa bằng `AES-256` (`APP_ENCRYPTION_KEY`) -> Lưu `TelegramUserSession`.
2. **`UserbotGroupModule`**:
   - `POST /api/v1/userbot/groups/sync`: Kết nối Telegram qua Session, lấy danh sách `dialogs` (groups/channels) -> Upsert vào `TelegramUserGroup`.
   - `GET /api/v1/userbot/groups`: Lấy danh sách nhóm đã quét của Seller.
3. **`UserbotCampaignModule`**:
   - CRUD cho Templates & Campaigns.
   - `POST /api/v1/userbot/campaigns/:id/start`: Đổi status thành `RUNNING` và thêm Job vào BullMQ Queue (`userbot-campaign-queue`).
   - `POST /api/v1/userbot/campaigns/:id/pause`: Tạm dừng chiến dịch.

---

### 🔄 C. Background Worker (`apps/worker`)

1. **Processor `UserbotCampaignProcessor`**:
   - Nhận `campaignId` từ BullMQ Queue.
   - Khởi tạo GramJS client từ `sessionStringEncrypted`.
   - Lặp qua danh sách nhóm mục tiêu trong `targetGroupIds`.
   - **Xoay nội dung (Spintax):** Xử lý cú pháp `{Chào|Xin chào|Hi}` để random từ ngữ.
   - **Delay Control:** Thực hiện `await sleep(delaySeconds * 1000)` giữa mỗi tin nhắn.
   - **Xử lý Exception:**
     - Nếu gặp `FLOOD_WAIT_X`: Tạm hoãn chiến dịch, cập nhật session status, đặt lịch chạy lại sau X giây.
     - Nếu gặp `CHAT_WRITE_FORBIDDEN` / `USER_BANNED`: Ghi log `FAILED` và bỏ qua nhóm đó.
   - Ghi thông tin chi tiết từng lần phát tin vào `TelegramUserCampaignLog`.

---

### 💻 D. Frontend Dashboard (`apps/web` - React + Vite)

Thêm mục **"Chiến dịch Userbot" (Tele Campaign)** vào Menu Sidebar với các Sub-pages:

1. **Quản lý Tài khoản (`/dashboard/userbot/accounts`):**
   - Nút "Thêm tài khoản Telegram" -> Dialog nhập SĐT -> Dialog nhập mã OTP / 2FA.
   - Bảng danh sách tài khoản đã kết nối + Nút "Quét nhóm".
2. **Danh sách Nhóm & Mẫu tin (`/dashboard/userbot/templates`):**
   - Xem danh sách nhóm đã đồng bộ.
   - Tạo / Sửa / Xóa mẫu tin nhắn (Rich Text + Upload hình ảnh).
3. **Tạo & Quản lý Chiến dịch (`/dashboard/userbot/campaigns`):**
   - Form chọn Tài khoản gửi -> Chọn Mẫu tin nhắn -> Tích chọn các nhóm nhận -> Đặt độ trễ delay (giây) -> Nút "Bắt đầu chạy".
   - Bảng theo dõi tiến độ (Progress bar % tin đã gửi/tổng số nhóm).
4. **Nhật ký Chi tiết (`/dashboard/userbot/campaigns/:id/logs`):**
   - Hiển thị bảng Log thời gian thực (Thời gian, Tên nhóm, Trạng thái thành công/thất bại, Chi tiết lỗi).

---

## 3. YÊU CẦU BẢO MẬT & QUYỀN HẠN (TIER GATE)
* **Mã hóa:** Toàn bộ `sessionString` của Telegram cá nhân PHẢI được mã hóa AES-256 trước khi lưu vào DB (dùng `encryptSecret` / `decryptSecret` trong `packages/shared`).
* **Phân quyền Tier (`SellerTier`):**
  * Gói **FREE**: Không có quyền sử dụng.
  * Gói **PRO**: Tối đa kết nối 2 tài khoản Telegram, delay tối thiểu 30s.
  * Gói **ULTRA**: Không giới hạn tài khoản Telegram, hỗ trợ chạy nhiều chiến dịch song song.
