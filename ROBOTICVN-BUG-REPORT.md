# Bug report — roboticvn Customer API v2

**Endpoint lỗi:** `POST /api/v2/orders` (tạo đơn sản phẩm) trả **HTTP 500** với đơn HỢP LỆ.
**API key:** `apk_7766f346-...-01405291bf9e` (account `TG_6629088195`)
**Thời điểm capture:** Wed, 24 Jun 2026 11:25:05 GMT
**CF-RAY (để trace origin log):** `a10b5eae2a3985a3-HKG`

---

## 1. Request bị lỗi

```http
POST https://api.roboticvn.com/api/v2/orders
x-api-key: apk_7766f346-...-01405291bf9e
Content-Type: application/json

{"items":[{"variant_id":"variant_01KV4G6K7N2GDCFJQY5MRD7V28","quantity":1}],"currency_code":"vnd"}
```
> variant = "Canva slot edu (like pro 99%) 3 years (NW)", giá 5.000₫

## 2. Response

```
HTTP 500
CF-RAY: a10b5eae2a3985a3-HKG
Date: Wed, 24 Jun 2026 11:25:05 GMT

{"error":{"code":"internal_error","message":"Đã xảy ra lỗi. Vui lòng thử lại sau."}}
```
> Body trả về JSON error format của app (`internal_error`), KHÔNG phải trang lỗi Cloudflare → origin app crash khi xử lý tạo đơn.

---

## 3. Bằng chứng đây là lỗi SERVER, không phải request sai

### 3.1 Ví đủ tiền (đơn 5.000₫, ví 10.000₫)
`GET /api/v2/wallet/balance`
```
{"data":{"vnd":10000,"usd":0}}
```

### 3.2 Variant còn hàng (`in_stock: true`)
`GET /api/v2/products/prod_01KM5D7R2WT8KCHM81MNH322QG` → variant:
```
   "id":"variant_01KV4G6K7N2GDCFJQY5MRD7V28","title":"Canva slot edu (like pro 99%) 3 years (NW)","prices":
```

### 3.3 Tầng validation HOẠT ĐỘNG (input sai → 400, không 500)
`POST /api/v2/orders` với variant không tồn tại:
```
{"error":{"code":"validation_error","message":"Một hoặc nhiều phiên bản sản phẩm không khả dụng."}}
```
`POST /api/v2/orders` với items rỗng:
```
{"error":{"code":"validation_error","message":"Dữ liệu gửi lên không hợp lệ."}}
```
> => Validate trả 400 đúng. Đơn HỢP LỆ qua được validate rồi mới 500 => **crash ở bước xử lý/fulfillment tạo đơn (SAU validate)**, không phải do parse request.

### 3.4 Cùng API key tạo đơn topup BÌNH THƯỜNG (auth/key OK)
`POST /api/v2/wallet/topup`
```
{"data":{"checkout_id":"cart_01KVWP0X3NBC8EP4EFVH6K5A79","status":"pending","payment":{"method":"bank_transfer","amount":10000,"currency_code":"vnd","bank_code":"ACB","account_number":"6318388","account_name":"TRAN TAI","reference":"DPMPBTDX8JY3PBG","qr_url":"https://payment.pay2s.vn/quicklink/ACB/6318388/TRAN%20TAI?amount=10000&memo=DPMPBTDX8JY3PBG&is_mask=0&bg=5","expires_at":"2026-06-24T11:30:0
```
> Chỉ riêng endpoint tạo đơn sản phẩm crash; topup (cũng là tạo order) chạy tốt.

---

## 4. Phạm vi: chỉ 1 endpoint lỗi

Đã quét toàn bộ 11 endpoint + nhánh lỗi (id sai, input sai, phân trang, locale, auth):
tất cả **GET đều 200**, id sai trả **404 sạch**, input sai trả **400 sạch**, no-key/key sai trả **401**.
**Chỉ `POST /api/v2/orders` cho sản phẩm thật bị 500**, lặp lại 100% (đã thử nhiều lần; trước đó endpoint còn dính 502).

## 5. Đề nghị

Check origin log quanh **CF-RAY `a10b5eae2a3985a3-HKG`** / **Wed, 24 Jun 2026 11:25:05 GMT**, ở bước xử lý đơn sau khi validate variant pass
(reserve stock / trừ ví / dispatch fulfillment). Ví test vẫn còn nguyên 10.000₫ — các lần 500 không trừ tiền.

---

## 6. CẬP NHẬT (24/06 ~12:20–12:35) — endpoint KHÔNG ỔN ĐỊNH (flapping)

Cùng MỘT request hợp lệ (`{"items":[{"variant_id":"variant_01KV4G6K7N2GDCFJQY5MRD7V28","quantity":1}],"currency_code":"vnd"}`),
biến `POST /orders` trả về 3 kết quả khác nhau tuỳ thời điểm:

- ~11:25: **HTTP 500** `internal_error` (lặp lại nhiều lần)
- ~12:19: **HTTP 201 thành công** → trả checkout (xem dưới)
- ~12:30 trở đi: **HTTP 400** `validation_error "Dữ liệu gửi lên không hợp lệ."` — **8/8 lần liên tiếp**, dù variant vẫn `in_stock:true`

Một request không đổi mà lúc 500 / lúc 200 / lúc 400 ⇒ backend order đang bất ổn (deploy dở hoặc race/state bug). Cần ổn định lại.

### Mẫu response lúc THÀNH CÔNG (quan trọng):
```json
{"checkout_id":"cart_01KVWTHQMGSVRWWY0P3R90GW2C","status":"pending",
 "payment":{"method":"bank_transfer","amount":5000,"currency_code":"vnd",
   "bank_code":"ACB","account_number":"6318388","account_name":"TRAN TAI",
   "reference":"DPM89GDM2SF3SZN","qr_url":"https://payment.pay2s.vn/...","expires_at":"..."}}
```

## 7. CÂU HỎI QUAN TRỌNG — đơn qua API có trừ ví trả trước được không?

Lúc đặt đơn thành công, ví đang có **10.000₫** (đủ trả đơn 5.000₫), nhưng:
- đơn KHÔNG trừ ví, ví vẫn 10.000₫;
- thay vào đó trả về **QR chuyển khoản bank 5.000₫ riêng cho từng đơn** (phải CK tay từng cái).

`CreateOrderRequest` trong OpenAPI chỉ có `items` + `currency_code`, **không có field chọn phương thức trả từ ví**.
(Thử thêm `payment_method:"wallet"` → HTTP 500.)

**Hỏi roboticvn:** API đặt đơn có hỗ trợ **thanh toán từ số dư ví** không? Nếu mỗi đơn đều phải CK bank riêng thì không dùng để bán tự động được — cần cơ chế đơn tự trừ ví (giống `reason: "purchase"` đã có trong `/wallet/transactions`).
