# Hướng dẫn cài đặt phương thức thanh toán cho Shop Bot

Tài liệu này dành cho chủ shop sử dụng bot Telegram trên hệ thống AltivoxAI.

Shop có thể sử dụng đồng thời:

- Thanh toán VNĐ qua PayOS, Pay2s hoặc Web2m.
- Binance UID.
- OKX.
- USDT TRC20.
- USDT Solana.
- USDT TON.
- PayPal.

Mỗi phương thức có công tắc **BẬT/TẮT** riêng. Tắt một phương thức chỉ làm ẩn phương thức đó trên bot, không xóa thông tin đã cấu hình.

## 1. Mở trang cấu hình

1. Đăng nhập trang quản trị AltivoxAI.
2. Mở mục **Cấu hình Bot**.
3. Kiểm tra bot Telegram đã được kết nối thành công.
4. Sử dụng:
   - Tab **Thanh toán** để cấu hình cổng thanh toán VNĐ.
   - Tab **USDT** để cấu hình Binance, OKX, các mạng USDT và PayPal.

Sau mỗi lần chỉnh sửa, bấm **Lưu thay đổi**.

## 2. Cấu hình thanh toán VNĐ

Trong tab **Thanh toán**, chọn một cổng thanh toán chính:

- **PayOS**
- **Pay2s**
- **Web2m**

Chỉ chọn một cổng VNĐ chính. Việc bật PayPal hoặc USDT không làm tắt cổng VNĐ.

### PayOS

Điền đúng ba thông tin lấy từ trang quản trị PayOS:

- Client ID
- API Key
- Checksum Key

Sau khi lưu, khách mua hàng sẽ thanh toán bằng mã QR hoặc chuyển khoản VNĐ. Bot tự xác nhận khi PayOS gửi thông báo thanh toán thành công.

### Pay2s

Điền các thông tin được Pay2s cung cấp:

- Partner Code
- Access Key
- Secret Key
- Tài khoản ngân hàng
- Bank ID
- Webhook Token nếu tài khoản có sử dụng

### Web2m

Điền:

- Số tài khoản nhận tiền
- Ngân hàng
- Access Token của webhook

Webhook Web2m phải được cấu hình theo URL hướng dẫn hiển thị trên trang quản trị.

## 3. Cấu hình các phương thức trong tab USDT

Tab **USDT** hiển thị danh sách phương thức nhận tiền dưới dạng thu gọn.

Cách cấu hình:

1. Bấm vào tên phương thức muốn sử dụng.
2. Nhập UID, địa chỉ ví hoặc API key được yêu cầu.
3. Bật công tắc của phương thức thành **BẬT**.
4. Bấm **Lưu thay đổi**.
5. Mở bot và tạo một đơn thử để kiểm tra.

Hệ thống không cho bật phương thức nếu chưa nhập thông tin nhận tiền bắt buộc.

### Binance UID

Điền **Binance UID** dùng để nhận tiền.

Nếu muốn bot hỗ trợ tự kiểm tra lịch sử giao dịch, có thể nhập thêm:

- Personal API Key
- Personal Secret Key

API Binance chỉ nên cấp quyền đọc lịch sử cần thiết. Không cấp quyền rút tiền.

### OKX

Điền:

- OKX UID

Để bot tự đối soát giao dịch OKX, bật **Auto-detect OKX** và nhập:

- OKX API Key
- OKX Secret Key
- OKX Passphrase

API OKX chỉ được cấp quyền đọc. Không cấp quyền giao dịch hoặc rút tiền.

### USDT TRC20

Điền địa chỉ ví nhận **USDT mạng TRON/TRC20**.

Ví dụ địa chỉ thường bắt đầu bằng chữ **T**.

Khách phải chuyển đúng:

- Token USDT.
- Mạng TRC20.
- Địa chỉ ví hiển thị trên bot.
- Số tiền bot yêu cầu.

Không dùng địa chỉ BEP20, ERC20, Solana hoặc TON cho mục này.

### USDT Solana

Điền địa chỉ ví Solana nhận USDT SPL.

Bot sẽ hiển thị địa chỉ và số USDT cần thanh toán. Khách phải chuyển đúng USDT trên mạng Solana.

### USDT TON

Điền địa chỉ ví TON nhận USDT Jetton, dạng **EQ...**, **UQ...** hoặc địa chỉ raw hợp lệ.

Bot tự đối chiếu:

- Đúng ví nhận.
- Đúng token USDT chính thức.
- Đúng số tiền của đơn.
- Giao dịch đã được xác nhận trên mạng TON.

Thời gian xác nhận thông thường khoảng 30–60 giây, tùy trạng thái mạng.

## 4. Cấu hình PayPal

PayPal là phương thức bổ sung. Shop có thể bật PayPal cùng lúc với PayOS, Pay2s, Web2m và USDT.

Tiền PayPal được chuyển vào tài khoản PayPal Business sở hữu ứng dụng API mà shop cấu hình.

### Bước 1: Tạo ứng dụng PayPal Sandbox

1. Truy cập [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Đăng nhập tài khoản PayPal.
3. Mở **Apps & Credentials**.
4. Chọn môi trường **Sandbox**.
5. Chọn ứng dụng mặc định hoặc bấm **Create App**.
6. Sao chép:
   - Client ID
   - Client Secret

### Bước 2: Nhập thông tin PayPal vào shop

Trong **Cấu hình Bot → USDT → PayPal**, điền:

- Client ID
- Client Secret
- Webhook ID
- Tỷ giá VND cho 1 USD

Bật **Sandbox** trong lúc thử nghiệm.

PayPal thanh toán bằng USD. Hệ thống ưu tiên giá USD đã cấu hình cho sản phẩm. Nếu sản phẩm chưa có giá USD, hệ thống quy đổi từ VNĐ theo tỷ giá PayPal của shop.

Ví dụ:

> Giá sản phẩm: 260.000 VNĐ  
> Tỷ giá: 26.000 VNĐ/USD  
> Số tiền PayPal: 10,00 USD

### Bước 3: Tạo PayPal Webhook

1. Mở ứng dụng PayPal vừa tạo.
2. Tìm phần **Webhooks** và chọn **Add Webhook**.
3. Sao chép **Webhook URL của shop** đang hiển thị trong trang cấu hình AltivoxAI.
4. Đăng ký hai sự kiện:
   - **CHECKOUT.ORDER.APPROVED**
   - **PAYMENT.CAPTURE.COMPLETED**
5. Tạo webhook.
6. Sao chép **Webhook ID** và dán vào cấu hình PayPal của shop.
7. Bật công tắc PayPal và lưu thay đổi.

### Bước 4: Thanh toán thử

1. Trong PayPal Developer Dashboard, mở **Testing Tools → Sandbox Accounts**.
2. Chọn tài khoản loại **Personal**.
3. Bấm dấu ba chấm → **View/Edit Account** để xem email và mật khẩu thử nghiệm.
4. Trên bot, tạo một đơn hàng và chọn PayPal.
5. Đăng nhập bằng tài khoản Personal Sandbox và xác nhận thanh toán.

Khi PayPal xác nhận thành công:

- Đơn được tự động cập nhật.
- Bot tự giao sản phẩm.
- Trình duyệt tự quay lại bot Telegram của shop.
- Khách không cần gửi mã giao dịch hoặc bấm xác nhận thủ công.

### Bước 5: Chuyển PayPal sang tiền thật

Sau khi Sandbox hoạt động ổn định:

1. Chuyển PayPal Developer sang **Live**.
2. Lấy Live Client ID và Live Client Secret.
3. Tạo webhook mới trong môi trường Live.
4. Thay Client ID, Client Secret và Webhook ID trong cấu hình shop.
5. Tắt chế độ **Sandbox**.
6. Lưu và thử một đơn có giá trị nhỏ.

Không dùng Client Secret hoặc Webhook ID của Sandbox cho môi trường Live.

## 5. Bật hoặc tắt phương thức trên bot

Trong tab **USDT**, mỗi phương thức có một công tắc:

- **BẬT**: phương thức được phép hiển thị cho khách nếu thông tin nhận tiền đã đầy đủ.
- **TẮT**: phương thức không hiển thị trên bot nhưng thông tin cấu hình vẫn được lưu.

Ví dụ shop có thể bật đồng thời: **PayOS + Binance + USDT TON + PayPal**.

Khi khách đặt hàng, bot sẽ cho khách chọn giữa các phương thức đang bật.

## 6. Kiểm tra sau khi cấu hình

Thực hiện lần lượt:

1. Lưu cấu hình.
2. Mở bot bằng một tài khoản Telegram khách hàng.
3. Chọn một sản phẩm còn hàng.
4. Nhập số lượng.
5. Kiểm tra bot có hiển thị đúng các phương thức đã bật.
6. Tạo một giao dịch thử cho từng phương thức.
7. Kiểm tra:
   - Số tiền và loại tiền chính xác.
   - Địa chỉ ví hoặc UID chính xác.
   - Đơn chuyển sang trạng thái đã thanh toán.
   - Bot giao đúng sản phẩm.

Không nên chuyển sang nhận tiền thật khi chưa hoàn thành giao dịch thử.

## 7. Quy tắc bảo mật

- Không gửi Client Secret, Secret Key hoặc Passphrase qua Telegram, Zalo hay nhóm chat.
- Chỉ nhập khóa bí mật trong trang quản trị chính thức của hệ thống.
- API Binance và OKX chỉ cấp quyền đọc; tuyệt đối không cấp quyền rút tiền.
- Không chụp ảnh màn hình có hiển thị đầy đủ khóa bí mật.
- Kiểm tra kỹ mạng USDT trước khi gửi tiền.
- Không sử dụng cùng một địa chỉ cho một mạng khác nếu ví không hỗ trợ.
- Nếu nghi ngờ khóa bị lộ, hãy thu hồi khóa trên nhà cung cấp và tạo khóa mới.

## 8. Lỗi thường gặp

### Đã bật nhưng bot không hiển thị phương thức

Kiểm tra:

- Đã nhập đầy đủ UID, địa chỉ ví hoặc credential chưa.
- Đã bấm **Lưu thay đổi** chưa.
- Bot Telegram đã kết nối thành công chưa.
- Sản phẩm còn hàng và có giá bán hợp lệ không.

### PayPal thanh toán xong nhưng đơn chưa hoàn tất

Kiểm tra:

- Webhook ID có đúng môi trường Sandbox/Live không.
- Webhook đã đăng ký đủ hai sự kiện chưa.
- Client ID và Client Secret có cùng một ứng dụng không.
- Chế độ Sandbox có khớp với credential đang sử dụng không.

### USDT chuyển lâu nhưng bot chưa xác nhận

Kiểm tra:

- Khách chuyển đúng mạng chưa.
- Đúng token USDT chưa.
- Đúng địa chỉ nhận chưa.
- Số tiền có đúng chính xác số bot yêu cầu không.
- Giao dịch đã được blockchain xác nhận chưa.

Nếu đã kiểm tra đầy đủ nhưng vẫn có lỗi, gửi cho bộ phận hỗ trợ:

- Mã đơn hàng.
- Tên phương thức thanh toán.
- Thời gian thanh toán.
- TX hash hoặc PayPal Order ID.

Không gửi API Secret hoặc Client Secret cho bộ phận hỗ trợ.
