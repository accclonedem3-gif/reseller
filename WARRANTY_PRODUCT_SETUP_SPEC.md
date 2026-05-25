# Spec: Trường bắt buộc trên form sản phẩm để bảo hành hoạt động đúng

## Bối cảnh
Hệ thống bảo hành tự động cần biết thời hạn gói sản phẩm để:
1. Tính hoàn tiền theo tỷ lệ ngày còn lại (tránh hoàn full khi khách đã dùng nhiều)
2. Phát hiện tài khoản bán nhầm gói (bán 1 năm nhưng giao 1 tháng) — *sẽ implement sau*

---

## Trường cần bắt buộc khi `warrantyPolicy ≠ KBH`

### 1. `durationType` — Thời hạn gói (BẮT BUỘC nếu có bảo hành)

| Giá trị hiện có | Ý nghĩa |
|---|---|
| `DAY_1` | 1 ngày |
| `DAY_7` | 7 ngày |
| `MONTH_1` | 1 tháng (30 ngày) |
| `MONTH_3` | 3 tháng (90 ngày) |
| `MONTH_6` | 6 tháng (180 ngày) |
| `MONTH_12` | 12 tháng (365 ngày) |
| `LIFETIME` | Vĩnh viễn (không tính prorate) |
| `OTHER` | Khác (không tính prorate, cần nhập tay) |

**Validation rule**: Nếu `warrantyPolicy != "KBH"`, trường `durationType` phải được chọn (không được để trống).

**Ảnh hưởng nếu thiếu**: Hệ thống hoàn full 100% giá trị thay vì prorate theo số ngày đã dùng.

---

### 2. `warrantyPolicy` — Chính sách bảo hành (đã có, không đổi)

| Giá trị | Ý nghĩa |
|---|---|
| `KBH` | Không bảo hành |
| `BH24H` | Bảo hành 24 giờ |
| `BH1M` | Bảo hành 1 tháng |
| `BH3M` | Bảo hành 3 tháng |
| `BH6M` | Bảo hành 6 tháng |
| `BH12M` | Bảo hành 12 tháng |
| `BHF` | Bảo hành Full (trong toàn bộ thời hạn gói) |

---

### 3. `sourceDeliveryMode` — Chế độ giao hàng (đã có, không đổi)

| Giá trị | Ý nghĩa |
|---|---|
| `AUTO_STOCK` | Tự động từ kho nội bộ |
| `AUTO_API` | Tự động qua API nguồn |
| `MANUAL` | Giao thủ công |

**Lưu ý**: Chỉ `AUTO_STOCK` và `AUTO_API` mới hỗ trợ bảo hành tự động.

---

## Validation logic đề xuất cho form

```
if (warrantyPolicy !== "KBH") {
  durationType: required  // không được để trống hoặc chọn "OTHER" nếu muốn prorate
}
```

### UI suggestion
Khi seller chọn `warrantyPolicy != KBH`, hiện warning dưới trường `durationType`:
> "⚠️ Cần chọn thời hạn gói để hệ thống tính hoàn tiền tự động đúng."

---

## Ví dụ hoàn tiền prorated

| Sản phẩm | Giá | Ngày đã dùng | Còn lại | Hoàn |
|---|---|---|---|---|
| Grok 1 tháng | 50.000đ | 10 ngày | 20/30 ngày | 33.333đ |
| ChatGPT 1 năm | 500.000đ | 30 ngày | 335/365 ngày | 458.904đ |
| Veo Lifetime | 1.000.000đ | bất kỳ | N/A | 1.000.000đ (full) |
| OTHER duration | 200.000đ | bất kỳ | N/A | 200.000đ (full) |

---

## Không cần thêm trường mới

Hệ thống dùng `durationType` đã có sẵn trên `SourceProduct` để tính số ngày.
Không cần thêm cột mới vào database.
