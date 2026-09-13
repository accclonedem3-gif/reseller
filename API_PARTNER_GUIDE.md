# Huong Dan API Partner V2

Tai lieu nay duoc viet theo dung code hien tai trong project.
Tat ca vi du ben duoi deu ap dung cho cac endpoint dang co trong bot.

## 1. Muc tieu cua API

API nay cho doi tac:

- Kiem tra API key va so du vi API
- Lay danh sach san pham dang ban
- Tao don hang mua san pham
- Tra cuu don theo `order_code`
- Tra cuu don theo `partner_ref`
- Lay lich su don da tao bang chinh API key do

## 2. Base URL va Header bat buoc

Base URL co dinh:

```text
https://api.dinos-tore.com
```

Day la domain co dinh, su dung Cloudflare Named Tunnel. Link nay khong thay doi.

Header bat buoc:

```http
x-api-key: API_KEY_CUA_BAN
```

Header khuyen nghi:

```http
x-idempotency-key: MA_DON_DUY_NHAT_CUA_DOI_TAC
```

## 3. Quy trinh tich hop dung

Quy trinh de doi tac khong bi nham:

1. Goi `GET /api/v2/me` de kiem tra key va so du dung chung.
2. San pham thuong: `GET /api/v2/catalog`, sau do `POST /api/v2/orders`.
3. Dich vu social: `GET /api/social/catalog`, sau do `POST /api/social/orders`.
4. Don thuong poll bang `/api/v2/orders/{order_code}` hoac `/api/v2/orders/by-ref/{partner_ref}`.
5. Don social poll bang `/api/social/orders/{order_code}` hoac `/api/social/orders/by-ref/{partner_ref}`.

## 4. Cac endpoint chinh

### 4.1. Kiem tra key va so du

```http
GET /api/v2/me
```

Vi du:

```bash
curl -X GET "https://api.dinos-tore.com/api/v2/me" \
  -H "x-api-key: API_KEY_CUA_BAN"
```

Vi du response:

```json
{
  "ok": true,
  "data": {
    "version": "2.0",
    "partner_name": "ShopA",
    "is_admin": false,
    "balance": 850000,
    "maintenance_mode": false
  }
}
```

Y nghia:

- `balance`: so du vi API hien tai, don vi `VND`
- `maintenance_mode=true`: he thong dang bao tri, khong nen tao don

### 4.2. Kiem tra trang thai he thong

```http
GET /api/v2/status
```

Vi du:

```bash
curl -X GET "https://api.dinos-tore.com/api/v2/status" \
  -H "x-api-key: API_KEY_CUA_BAN"
```

Vi du response:

```json
{
  "ok": true,
  "data": {
    "version": "2.0",
    "status": "online",
    "maintenance_mode": false,
    "stock_count": 124,
    "product_count": 18,
    "pending_orders": 3,
    "your_balance": 850000,
    "partner_name": "ShopA",
    "is_admin": false
  }
}
```

### 4.3. Lay danh sach san pham thuong

```http
GET /api/v2/catalog
```

Endpoint nay khong tra dich vu social. Dich vu social dung:

```http
GET /api/social/catalog
```

Vi du:

```bash
curl -X GET "https://api.dinos-tore.com/api/v2/catalog" \
  -H "x-api-key: API_KEY_CUA_BAN"
```

Vi du response:

```json
{
  "ok": true,
  "data": {
    "version": "2.0",
    "products": [
      {
        "product_id": "p_1768439915",
        "name": "Youtube Premium Chinh Chu",
        "price": 51700,
        "currency": "VND",
        "description": "Tai khoan chinh chu",
        "duration": "1 thang",
        "warranty": "Bao hanh theo goi",
        "delivery_mode": "manual_fulfillment",
        "stock_status": "manual",
        "stock_count": null,
        "requires_gmail": true,
        "is_datammo_resell": false
      },
      {
        "product_id": "p_1772672574",
        "name": "Chat GPT Plus Rieng Tu 5.4",
        "price": 120000,
        "currency": "VND",
        "description": "Tai khoan giao ngay",
        "duration": "30 ngay",
        "warranty": "Co",
        "delivery_mode": "instant_items",
        "stock_status": "in_stock",
        "stock_count": 7,
        "requires_gmail": false,
        "is_datammo_resell": false
      },
      {
        "product_id": "ctt_4946",
        "name": "TikTok Likes + Views",
        "price": 49,
        "currency": "VND",
        "description": "Dich vu social",
        "duration": "Goi 100 don vi",
        "warranty": "Khong bao hanh",
        "warranty_supported": false,
        "warranty_time": "",
        "delivery_mode": "social_service",
        "stock_status": "manual",
        "stock_count": null,
        "requires_gmail": false,
        "is_datammo_resell": false,
        "is_cheotuongtac_service": true
      }
    ],
    "total_products": 2,
    "maintenance_mode": false,
    "partner_name": "ShopA"
  }
}
```

## 5. Giai thich `delivery_mode`, `stock_status`, `stock_count`

### 5.1. `delivery_mode` trong catalog

Gia tri co the co:

- `instant_items`
  - San pham co san trong kho noi bo
  - Mua xong co the nhan ngay `items`
- `manual_fulfillment`
  - San pham can xu ly thu cong
  - Thuong la can Gmail hoac admin add tay
- `resell_source_api`
  - San pham lay tu nguon resell ben ngoai
  - Co the giao ngay hoac phai cho nguon
- `social_service`
  - Dich vu social lay tu nguon CheoTuongTac
  - Khi tao don can gui cac field theo `social_input_fields`
  - Thuong can `target_link`, mot so dich vu co the can `comments`

### 5.2. `stock_status`

Gia tri co the co:

- `in_stock`
- `out_of_stock`
- `manual`
- `unknown`

Y nghia:

- `manual`: san pham xu ly thu cong, khong dung kho item ngay
- `unknown`: he thong nguon resell khong bao stock ro rang

### 5.3. `stock_count`

- San pham kho noi bo: la so item con lai
- San pham manual: thuong `null`
- San pham resell: co the `null` neu nguon khong bao chinh xac

## 6. `quantity` la gi

`quantity` la so luong muon mua trong 1 don.

Vi du:

- `quantity = 1`: mua 1 tai khoan / 1 item
- `quantity = 3`: mua 3 tai khoan / 3 item

Tren san pham kho noi bo:

- Neu du kho, bot se lay ra dung `quantity` item
- `data.items` thuong se co do dai bang `quantity`

Tren san pham manual:

- Don duoc tao voi `quantity` da chon
- Chua chac co `items` ngay lap tuc

Tren san pham resell:

- He thong se dat mua theo `quantity`
- Co the nhan du item ngay, hoac phai cho nguon giao

Tren san pham social:

- `quantity` la so luong tuong tac/follow/view/comment muon mua
- Phai nam trong `minimum_order_quantity..maximum_order_quantity` neu catalog co gioi han
- Can gui `target_link` neu `social_input_fields` co `link`
- Can gui `comments` neu `social_input_fields` co `comments`

Gioi han hien tai:

- San pham thuong: `quantity` la so nguyen trong `1..200`.
- Social: `quantity` theo `minimum_order_quantity..maximum_order_quantity` cua tung dich vu.

## 7. Tao don hang

```http
POST /api/v2/orders
```

### 7.1. Body request

Body dung:

```json
{
  "partner_ref": "ORDER_20260325_0001",
  "product_id": "p_1772672574",
  "quantity": 2,
  "customer_email": "khach@example.com",
  "customer_id": "telegram_9988",
  "note": "don tu bot doi tac",
  "send_email": false
}
```

Field:

- `partner_ref`
  - Ma don ben doi tac
  - Dung de chong tao trung khi retry
  - Toi da 64 ky tu
  - Chi nen dung chu, so, `.`, `_`, `:`, `-`
- `product_id`
  - Lay tu `GET /api/v2/catalog`
- `quantity`
  - So luong mua
- `customer_email`
  - Email cua khach
  - Co the dung field `email`, nhung nen uu tien `customer_email`
- `customer_id`
  - ID khach ben he thong doi tac
- `note`
  - Ghi chu noi bo, toi da 200 ky tu
- `send_email`
  - Hien tai co y nghia chu yeu voi luong mua link cu
- `target_link`
  - Link muc tieu cho dich vu social
  - Bat buoc neu catalog tra `social_input_fields` co `link`
- `comments`
  - Noi dung comment/danh sach comment cho dich vu social neu catalog yeu cau

### 7.3. Vi du tao don social

Lay product social tu `GET /api/social/catalog`, sau do tao don:

```bash
curl -X POST "https://api.dinos-tore.com/api/social/orders" \
  -H "Content-Type: application/json" \
  -H "x-api-key: API_KEY_CUA_BAN" \
  -H "x-idempotency-key: SOCIAL_20260426_0001" \
  -d '{
    "partner_ref": "SOCIAL_20260426_0001",
    "product_id": "ctt_8786",
    "quantity": 100,
    "target_link": "https://www.facebook.com/share/1KcKrwGX24/",
    "customer_id": "telegram_7193749511",
    "note": "facebook followers"
  }'
```

Response social thuong co them:

```json
{
  "ok": true,
  "data": {
    "order_code": "4840349",
    "partner_ref": "SOCIAL_20260426_0001",
    "status": "🔵 Đang chạy (Social Service)",
    "price": 420,
    "currency": "VND",
    "delivery_mode": "social_service",
    "product_id": "ctt_8786",
    "product_name": "Facebook Followers",
    "quantity": 100,
    "is_cheotuongtac_service": true,
    "target_link": "https://www.facebook.com/share/1KcKrwGX24/",
    "supplier_order_id": "4840349",
    "supplier_status": "In progress",
    "supplier_quantity": 100,
    "supplier_start_count": "1000",
    "supplier_remains": "100",
    "supplier_initial_count": 1000,
    "supplier_increased_quantity": 0,
    "supplier_remaining_quantity": 100,
    "supplier_progress": {
      "initial_count": 1000,
      "ordered_quantity": 100,
      "remaining_quantity": 100,
      "increased_quantity": 0
    },
    "supplier_charge": "0.01501504",
    "supplier_status_refreshed_at": 1777187518,
    "remaining_balance": 221284
  }
}
```

### 7.2. Vi du curl

```bash
curl -X POST "https://api.dinos-tore.com/api/v2/orders" \
  -H "Content-Type: application/json" \
  -H "x-api-key: API_KEY_CUA_BAN" \
  -H "x-idempotency-key: ORDER_20260325_0001" \
  -d '{
    "partner_ref": "ORDER_20260325_0001",
    "product_id": "p_1772672574",
    "quantity": 2,
    "customer_email": "khach@example.com",
    "customer_id": "telegram_9988",
    "note": "don tu shop doi tac",
    "send_email": false
  }'
```

## 8. Cach nhan san pham sau khi tao don

Day la phan quan trong nhat.

### 8.1. Khong phai luc nao cung lay san pham tu `link`

Trong API V2:

- Neu mua san pham binh thuong, tai khoan/item nhan duoc nam trong:
  - `data.items`
- Field `data.link` khong phai luc nao cung la tai khoan that

Thuong:

- `data.items` moi la noi dung san pham
- `data.link` chi la mo ta delivery nhu:
  - `Store Product`
  - `Resell Product`
  - `Manual - Ten San Pham`

### 8.2. Khi nao dung `data.items`

Neu response tao don tra ve:

```json
{
  "ok": true,
  "message": "Order created successfully.",
  "data": {
    "order_code": "API-ORDER_20260325_0001-AB12CD34",
    "partner_ref": "ORDER_20260325_0001",
    "status": "✅ Hoan thanh (API Product)",
    "price": 240000,
    "currency": "VND",
    "delivery_mode": "stock_items",
    "link": "Store Product",
    "product_id": "p_1772672574",
    "product_name": "Chat GPT Plus Rieng Tu 5.4",
    "quantity": 2,
    "email": "khach@example.com",
    "created_at": 1775000000,
    "delivered_count": 2,
    "idempotent_replay": false,
    "items": [
      "acc1@example.com|password1",
      "acc2@example.com|password2"
    ],
    "remaining_balance": 610000
  }
}
```

Luc nay:

- Nhan san pham bang `data.items`
- Moi phan tu trong `items` la 1 tai khoan / 1 item
- `delivered_count = 2` nghia la da giao du 2 item

### 8.3. Khi nao phai poll tiep

Neu response khong co `items`, hoac `delivered_count = 0`, thi don chua giao xong.

Luc nay phai goi:

- `GET /api/v2/orders/{order_code}`
- hoac `GET /api/v2/orders/by-ref/{partner_ref}`

de kiem tra lai.

### 8.4. Vi du don manual

```json
{
  "ok": true,
  "data": {
    "order_code": "API-ORDER_20260325_0002-EF56GH78",
    "partner_ref": "ORDER_20260325_0002",
    "status": "⏳ Cho xu ly manual (API)",
    "price": 51700,
    "currency": "VND",
    "delivery_mode": "manual_pending",
    "link": "Manual - Youtube Premium Chinh Chu",
    "product_id": "p_1768439915",
    "product_name": "Youtube Premium Chinh Chu",
    "quantity": 1,
    "email": "khach@example.com",
    "created_at": 1775000001,
    "delivered_count": 0,
    "idempotent_replay": false,
    "remaining_balance": 558300
  }
}
```

Y nghia:

- Don da tao thanh cong
- Da tru tien
- Chua co `items`
- Can poll lai den khi admin xu ly xong

### 8.5. Vi du don resell chua giao ngay

```json
{
  "ok": true,
  "data": {
    "order_code": "API-ORDER_20260325_0003-ZX98CV76",
    "partner_ref": "ORDER_20260325_0003",
    "status": "⚠️ Cho giao tu nguon (API Resell)",
    "price": 100000,
    "currency": "VND",
    "delivery_mode": "pending_source",
    "link": "Resell Product (Pending Source)",
    "product_id": "p_1778888888",
    "product_name": "San pham Resell",
    "quantity": 1,
    "email": "khach@example.com",
    "created_at": 1775000002,
    "delivered_count": 0,
    "idempotent_replay": false,
    "remaining_balance": 458300
  }
}
```

Y nghia:

- Da tao don
- Da tru tien
- Dang cho nguon resell giao
- Chua co `items` ngay

### 8.6. Vi du don resell giao ngay

```json
{
  "ok": true,
  "data": {
    "order_code": "API-ORDER_20260325_0004-QW12ER34",
    "partner_ref": "ORDER_20260325_0004",
    "status": "✅ Hoan thanh (API Product)",
    "price": 100000,
    "currency": "VND",
    "delivery_mode": "resell_items",
    "link": "Resell Product",
    "product_id": "p_1778888888",
    "product_name": "San pham Resell",
    "quantity": 1,
    "email": "khach@example.com",
    "created_at": 1775000003,
    "delivered_count": 1,
    "idempotent_replay": false,
    "items": [
      "account@example.com|password123"
    ],
    "remaining_balance": 358300
  }
}
```

Luc nay:

- Lay san pham trong `items`
- Khong can dung `link` de giao cho khach

## 9. Tra cuu don theo `order_code`

```http
GET /api/v2/orders/{order_code}
```

Vi du:

```bash
curl -X GET "https://api.dinos-tore.com/api/v2/orders/API-ORDER_20260325_0001-AB12CD34" \
  -H "x-api-key: API_KEY_CUA_BAN"
```

Ban cung co the gui lowercase/mixed-case; server se tu normalize ma don.

Dung endpoint nay khi:

- Ban vua tao don xong va muon poll
- Ban muon kiem tra don da giao du `items` chua
- Ban muon doc lai `status`, `delivered_count`, `remaining_balance`
- Ban muon refresh live trang thai don social tu nguon

Voi don social, dung `GET /api/social/orders/{order_code}` de refresh cac field nguon:

- `supplier_status`
- `supplier_remains`
- `supplier_charge`
- `supplier_start_count`
- `supplier_quantity`
- `supplier_initial_count`
- `supplier_increased_quantity`
- `supplier_remaining_quantity`
- `supplier_progress`
- `supplier_status_refreshed_at`
- `supplier_status_refresh_error` neu lan refresh vua loi

`GET /api/social/orders` list nhieu don se khong refresh nguon hang loat.

## 10. Tra cuu don theo `partner_ref`

```http
GET /api/v2/orders/by-ref/{partner_ref}
```

Vi du:

```bash
curl -X GET "https://api.dinos-tore.com/api/v2/orders/by-ref/ORDER_20260325_0001" \
  -H "x-api-key: API_KEY_CUA_BAN"
```

Nen dung endpoint nay neu:

- Ben doi tac luu `partner_ref` la ma chinh
- Muon truy van don theo ma noi bo cua minh
- Muon retry ma khong phai luu `order_code`

## 11. Lay lich su don

```http
GET /api/v2/orders
```

Query co the dung:

- `limit`
- `offset`
- `status`
- `search`

Vi du:

```bash
curl -X GET "https://api.dinos-tore.com/api/v2/orders?limit=20&offset=0&status=hoan%20thanh&search=gmail" \
  -H "x-api-key: API_KEY_CUA_BAN"
```

Vi du response:

```json
{
  "ok": true,
  "data": {
    "orders": [
      {
        "order_code": "API-ORDER_20260325_0001-AB12CD34",
        "partner_ref": "ORDER_20260325_0001",
        "status": "✅ Hoan thanh (API Product)",
        "price": 240000,
        "currency": "VND",
        "delivery_mode": "stock_items",
        "link": "Store Product",
        "product_id": "p_1772672574",
        "product_name": "Chat GPT Plus Rieng Tu 5.4",
        "quantity": 2,
        "email": "khach@example.com",
        "created_at": 1775000000,
        "delivered_count": 2,
        "items": [
          "acc1@example.com|password1",
          "acc2@example.com|password2"
        ]
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "returned": 1,
      "total": 1,
      "has_more": false
    },
    "filters": {
      "status": "hoan thanh",
      "search": "gmail"
    },
    "partner_name": "ShopA",
    "remaining_balance": 610000
  }
}
```

## 12. Idempotency: tranh tao trung don

Ban nen luon dung:

- `partner_ref`
- va header `x-idempotency-key`

Hai gia tri nay nen giong nhau.

Vi du:

```http
x-idempotency-key: ORDER_20260325_0001
```

```json
{
  "partner_ref": "ORDER_20260325_0001"
}
```

Neu ban retry lai cung `partner_ref`, server se tra ve don cu thay vi tao don moi.

Luc do:

- `message` se la `Existing order returned (idempotent replay).`
- `data.idempotent_replay` se la `true`

## 13. Don legacy lay link cu

Ngoai API V2, he thong van con API cu:

```http
POST /api/buy
```

Body:

```json
{
  "partner_ref": "ORDER_LINK_0001",
  "email": "khach@example.com"
}
```

Response:

```json
{
  "status": "success",
  "order_code": "API-ORDER_LINK_0001-ABCD1234",
  "link": "https://....",
  "price": 50000,
  "remaining_balance": 450000,
  "idempotent_replay": false
}
```

Lu y rat quan trong:

- Chi voi luong legacy nay thi `link` moi la link that de giao cho khach
- Con voi `POST /api/v2/orders` mua san pham binh thuong, phan lon truong hop phai doc `items`

## 14. Cach biet chinh xac nhan gi de giao cho khach

Dung quy tac nay:

### Truong hop A: response co `items`

Thi giao cho khach bang:

```json
data.items
```

Vi du:

```json
[
  "mail1@example.com|pass1",
  "mail2@example.com|pass2"
]
```

### Truong hop B: response khong co `items`, nhung `delivery_mode` la `manual_pending` hoac `pending_source`

Thi:

- Chua giao ngay
- Phai poll lai bang `GET /api/v2/orders/{order_code}`
- Hoac `GET /api/v2/orders/by-ref/{partner_ref}`

### Truong hop C: ban dang dung API cu `/api/buy`

Thi giao cho khach bang:

```json
link
```

## 15. Error code thuong gap

### 400

Vi du:

- `partner_ref is required`
- `partner_ref and x-idempotency-key must match`
- `partner_ref contains no valid characters`
- `Invalid email format`
- `quantity must be an integer`
- `quantity must be in range 1..200`
- `invalid_product_price`

### 401

- `Missing API Key`
- `Invalid API Key`

### 402

- Khong du so du vi API

Vi du:

```json
{
  "detail": "Insufficient balance. Your balance: 35,000"
}
```

### 403

- API key bi disable

### 404

Vi du:

- `product_not_found`
- `Order not found`
- `dino_out_of_stock`

### 409

Vi du:

```text
Insufficient stock. available=1, required=3
```

### 502

- Loi tu nguon resell ben ngoai

Vi du:

```text
datammo_error: ...
```

### 503

- He thong dang bao tri
- Hoac API secret chua cau hinh

## 15.1. Refund voi don API

Neu admin refund don API:

- Tien duoc cong lai vao vi chung cua partner
- Response chi tiet don se co `refunded_at`, `refund_amount`, `refund_reason`, `refund_target`
- `refund_target` thuong la `Vi chung`
- Bot khong chuyen tien truc tiep ve khach cuoi cua partner

Partner can tu xu ly refund/doi soat voi khach cuoi tren he thong cua minh.

## 16. Mau tich hop toi thieu de doi tac nhan san pham dung

Pseudo-flow:

```text
1. GET /api/v2/catalog
2. Chon product_id
3. POST /api/v2/orders voi quantity can mua
4. Neu data.items ton tai:
     => giao ngay cho khach
5. Neu data.items khong ton tai:
     => luu order_code
     => poll GET /api/v2/orders/{order_code} moi 5-15 giay
6. Khi response xuat hien data.items:
     => giao cho khach
```

## 17. Demo tich hop bang code

Tat ca demo ben duoi dung chung nguyen tac:

- Tao `partner_ref` duy nhat cho moi don
- Gui header `x-api-key`
- Gui header `x-idempotency-key` bang dung `partner_ref`
- Neu response co `items` thi giao ngay
- Neu chua co `items` thi poll chi tiet don

### 17.1. Node.js

Dung Node.js 18+ vi da co san `fetch`.

```js
const BASE_URL = "https://api.dinos-tore.com";
const API_KEY = "API_KEY_CUA_BAN";

async function apiRequest(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      ...(options.headers || {})
    }
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(JSON.stringify(json));
  }
  return json;
}

async function createOrderAndReceiveItems() {
  const partnerRef = "ORDER_20260325_0001";

  const created = await apiRequest("/api/v2/orders", {
    method: "POST",
    headers: {
      "x-idempotency-key": partnerRef
    },
    body: JSON.stringify({
      partner_ref: partnerRef,
      product_id: "p_1772672574",
      quantity: 2,
      customer_email: "khach@example.com",
      customer_id: "telegram_9988",
      note: "don tu website doi tac",
      send_email: false
    })
  });

  const order = created.data;

  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items;
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollJson = await apiRequest(`/api/v2/orders/${encodeURIComponent(order.order_code)}`);
    const latest = pollJson.data;
    if (Array.isArray(latest.items) && latest.items.length > 0) {
      return latest.items;
    }
  }

  return [];
}

createOrderAndReceiveItems()
  .then((items) => console.log("Delivered items:", items))
  .catch(console.error);
```

### 17.2. Python

Cai thu vien:

```bash
pip install requests
```

Code:

```python
import time
import requests

BASE_URL = "https://api.dinos-tore.com"
API_KEY = "API_KEY_CUA_BAN"


def api_request(method, path, **kwargs):
    headers = kwargs.pop("headers", {})
    headers["x-api-key"] = API_KEY
    if method.upper() in {"POST", "PUT", "PATCH"}:
        headers.setdefault("Content-Type", "application/json")

    response = requests.request(
        method,
        f"{BASE_URL}{path}",
        headers=headers,
        timeout=30,
        **kwargs,
    )
    try:
        data = response.json()
    except ValueError:
        data = {"raw": response.text}

    if not response.ok:
        raise RuntimeError(data)
    return data


def create_order_and_receive_items():
    partner_ref = "ORDER_20260325_0001"

    created = api_request(
        "POST",
        "/api/v2/orders",
        headers={"x-idempotency-key": partner_ref},
        json={
            "partner_ref": partner_ref,
            "product_id": "p_1772672574",
            "quantity": 2,
            "customer_email": "khach@example.com",
            "customer_id": "telegram_9988",
            "note": "don tu website doi tac",
            "send_email": False,
        },
    )

    order = created["data"]
    if order.get("items"):
        return order["items"]

    for _ in range(20):
        time.sleep(5)
        latest = api_request("GET", f"/api/v2/orders/{order['order_code']}")["data"]
        if latest.get("items"):
            return latest["items"]

    return []


if __name__ == "__main__":
    print(create_order_and_receive_items())
```

### 17.3. PHP

PHP curl extension can duoc bat san tren server.

```php
<?php

$baseUrl = "https://api.dinos-tore.com";
$apiKey = "API_KEY_CUA_BAN";

function apiRequest($method, $path, $payload = null, $extraHeaders = []) {
    global $baseUrl, $apiKey;

    $headers = array_merge([
        "x-api-key: " . $apiKey,
        "Content-Type: application/json",
    ], $extraHeaders);

    $ch = curl_init($baseUrl . $path);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
    }

    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new Exception("Curl error: " . $curlError);
    }

    $json = json_decode($body, true);
    if ($httpCode < 200 || $httpCode >= 300) {
        throw new Exception("API error HTTP " . $httpCode . ": " . $body);
    }

    return $json;
}

function createOrderAndReceiveItems() {
    $partnerRef = "ORDER_20260325_0001";

    $created = apiRequest(
        "POST",
        "/api/v2/orders",
        [
            "partner_ref" => $partnerRef,
            "product_id" => "p_1772672574",
            "quantity" => 2,
            "customer_email" => "khach@example.com",
            "customer_id" => "telegram_9988",
            "note" => "don tu website doi tac",
            "send_email" => false,
        ],
        ["x-idempotency-key: " . $partnerRef]
    );

    $order = $created["data"];
    if (!empty($order["items"])) {
        return $order["items"];
    }

    for ($i = 0; $i < 20; $i++) {
        sleep(5);
        $latest = apiRequest("GET", "/api/v2/orders/" . rawurlencode($order["order_code"]));
        if (!empty($latest["data"]["items"])) {
            return $latest["data"]["items"];
        }
    }

    return [];
}

try {
    print_r(createOrderAndReceiveItems());
} catch (Exception $e) {
    echo $e->getMessage() . PHP_EOL;
}
```

### 17.4. Vi du rieng cho don social

Voi san pham co `delivery_mode = social_service`, partner can gui `target_link`.

```js
const socialPartnerRef = "SOCIAL_20260426_0001";

const created = await apiRequest("/api/v2/orders", {
  method: "POST",
  headers: {
    "x-idempotency-key": socialPartnerRef
  },
  body: JSON.stringify({
    partner_ref: socialPartnerRef,
    product_id: "ctt_8786",
    quantity: 100,
    target_link: "https://www.facebook.com/share/1KcKrwGX24/",
    customer_id: "telegram_7193749511",
    send_email: false
  })
});

console.log("Supplier order:", created.data.supplier_order_id);

// Poll endpoint chi tiet de refresh live trang thai nguon social.
const latest = await apiRequest(`/api/v2/orders/${created.data.order_code}`);
console.log({
  status: latest.data.status,
  supplier_status: latest.data.supplier_status,
  supplier_remains: latest.data.supplier_remains,
  supplier_charge: latest.data.supplier_charge,
  refreshed_at: latest.data.supplier_status_refreshed_at
});
```

## 18. Tong ket rat ngan

Neu ban chi can nho 4 y:

1. Lay san pham bang `GET /api/v2/catalog`
2. Tao don bang `POST /api/v2/orders`
3. Nhan tai khoan bang `data.items`, khong phai luc nao cung la `data.link`
4. Neu chua co `items`, poll bang `GET /api/v2/orders/{order_code}` hoac `GET /api/v2/orders/by-ref/{partner_ref}`
