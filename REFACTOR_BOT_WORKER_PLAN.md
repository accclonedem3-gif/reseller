# Refactor Plan — Tách `telegram-bot.service.v2.ts` (7688 dòng) + `worker/main.ts` (3823 dòng)

> Trạng thái: **PLAN — chưa đụng code.** Duyệt xong mới thực thi.
> Mục tiêu: tách 2 god-file thành module có type-check, **không đổi hành vi**, làm **từng bước build được**.

---

## 0. Nguyên tắc bắt buộc (đọc trước mỗi bước)

1. **Mỗi increment = 1 commit độc lập.** Sau mỗi bước: `npm run typecheck` (cả 4 workspace) phải xanh.
2. **Không xóa logic.** Chỉ *di chuyển* code sang file mới + wiring lại. Diff phải đọc được là "cut & paste", không phải "rewrite". (Bài học `gemini-refactor-failure`: AI trước xóa 95% logic rồi giả vờ giữ.)
3. **Worker giữ `@ts-nocheck` cho tới bước cuối.** Mỗi module *tách ra* thì viết typed (bỏ nocheck ở file mới); file `main.ts` gốc vẫn nocheck đến khi rỗng.
4. **Tham chiếu bằng TÊN METHOD, không bằng số dòng** — số dòng trong plan này là gợi ý (chụp tại HEAD hiện tại), sẽ trôi sau mỗi lần cắt.
5. **Không gộp 2 việc trong 1 bước.** Một bước chỉ tách 1 module HOẶC 1 pre-work.
6. Build chạy được local (`npm run dev:api` / `dev:worker` lên không lỗi runtime) trước khi sang bước rủi ro kế tiếp.

---

## 1. PRE-WORK (làm TRƯỚC khi tách — bắt buộc)

### P0.1 — Gom CTV-pricing trùng 4 lần
Bốn block gần như giống hệt (chỉ khác hậu tố biến `/Grp/Ft/Q`), tính `isCtv` + `getEffectivePrice`:
- `_renderCatalogInner` — dòng ~1296–1302
- `renderCustomCatalogGroup` — dòng ~1545–1550
- `renderCatalogGroup` — dòng ~1644–1649
- `promptQuantitySelection` — dòng ~1982–1988

Logic chung:
```
ctvBlocked = customerRecord?.isCtv === false
isCtv = !ctvBlocked && (customerRecord?.isCtv ?? false || ctvApiKey != null || downstreamConn != null)
effectivePrice = isCtv
  ? (internalSourceEnabled && internalSourcePrice != null ? internalSourcePrice : salePrice)
  : salePrice
```
→ Tách thành 1 helper duy nhất, ví dụ `resolveCtvContext(shopId, chatId)` trả `{ isCtv, getEffectivePrice }`. Thay cả 4 chỗ.
**Vì sao trước:** nếu tách `catalog.handler` và `checkout.handler` ra trước khi gom, sẽ nhân đôi bug-surface ở 2 file.

### P0.2 — Xử lý `gramJsService` dead injection
Inject ở dòng 33 + 297–298 nhưng **KHÔNG có call site nào** trong file (đã grep). Quyết định:
- Nếu thật sự không dùng ở đâu → gỡ khỏi constructor + import (1 commit nhỏ riêng).
- Nếu có dùng qua đường khác (reflection/test) → giữ, nhưng **không carry vào sub-module** nào.

### P0.3 — Baseline
- Ghi lại `git rev-parse HEAD` làm mốc rollback.
- Chụp 1 lần `npm run typecheck` xanh để biết điểm xuất phát sạch.

---

## 2. BOT SERVICE — 12 module

Kiến trúc đích: 1 **dispatcher mỏng** giữ Redis session store + Telegram transport, **delegate** sang các handler. Mỗi handler nhận `shop`, `token`, `actions`, `language` đã resolve sẵn (không tự resolve lại) để tách khỏi entry logic.

### Thứ tự tách (leaf → dispatcher)

| # | Module mới | Method di chuyển (line hint) | Phụ thuộc |
|---|---|---|---|
| 1 | `telegram-api.client.ts` | `editOrSend` (7552), `sendText` (7568, +fallback `stripInlineEmojiIds`), `hasInlineEmojiIds` (7598), `sendPhoto` (7622), `editText` (7655), `answerCallback` (7680), `createSimulationToken`/`isSimulationToken` (6695/6699), `formatDateTime` (6685) | none |
| 2 | `bot-session.store.ts` | `setPendingSession`/`get`/`del` (151–170) + TTL const (172–175) + mọi getter/clearer key (4739–4896, 5977–5992, 6074–6092) + `cleanupExpiredPendingSelections` | redis |
| 3 | `bot-render.helpers.ts` | i18n + format + keyboard: `buildReplyKeyboard` (229), `buttonLabel` (6820), `buildSupportText`/`buildGuideText` (6870/2984), money fmt (7210–7445), product-name i18n (7072–7205), `localizeBotErrorMessage` (7287), emoji/resolveCustomization (305–340, 7022–7071), `escapeHtml`, `BIN_TO_BANK` (36–65) | none |
| — | **(P0.1 đã gom CTV helper ở đây hoặc `ctv-pricing.ts`)** | | |
| 4 | `payment-verify.handler.ts` | TRC20/Solana submit (3023–3258, 3591–3828), PayOS/Binance instant verify (5799–5976), Binance personal (5977–6646), OKX personal | shared verify services |
| 5 | `warranty.handler.ts` | `promptWarrantyClaimOrderCode`→`sendWarrantyClaimResult` (3259–3590) | WarrantyService |
| 6 | `affiliate.handler.ts` | `applyAffiliateRef` (5190), referral code (5167–5189), `renderAffiliatePanel` (5240–5318) | AffiliateService |
| 7 | `internal-source.handler.ts` | `handleProKeyMenu` (5320), `handleProKeyReissue` (4898), topup connection (4948–5072), `handleProAdminPanel` (5089), `sendConnectionTopupPaidMessage` (4217) | apiKeyService, connectionTopupService |
| 8 | `wallet.handler.ts` | `renderWalletPanel` (1778), topup prompts + `handlePendingWalletTopupMessage` (3946–4216), wallet text (5476–5771), paid/expired notifiers | CustomerWalletService |
| 9 | `payment.handler.ts` | provider discovery (2465–2529), `renderPaymentMethodPrompt`/`handlePaymentMethodSelection` (2294–2463), `buildOrderPaymentLines` (2571–2893), QR builders (4696–4738) | PaymentService |
| 10 | `catalog.handler.ts` | `renderHome` (1124), `renderCatalog`/inner (1236–1505), group renderers (1507–1702), `sendQuantityReplyPrompt` (4364), `sendCatalogStockUpdateMessages` (4256) | ShopsService, CTV helper |
| 11 | `checkout.handler.ts` | `promptQuantitySelection` (1931), `handleBuy`/`handleBuyWithWallet` (2022–2209), `handlePendingQuantityMessage` (3830), `sendDeliveredMessage` (1055), order history (1704–1776, 5390) | OrdersService, CTV helper |
| 12 | `telegram-bot.dispatcher.ts` | còn lại: `handleIncomingUpdate` (342–1053), router command/callback, `ensureTelegramCustomerSeen`, language helpers (6647–6809), ULTRA auto-key | tất cả handler trên |

**Lưu ý kỹ thuật khi cắt:**
- Các method dùng `this.prisma`, `this.config`, `this.redis`, `this.<service>` → handler mới nhận chúng qua constructor (NestJS `@Injectable`) hoặc qua tham số. Ưu tiên `@Injectable` + inject lại để giữ DI sạch.
- `actions[]` (mock/simulation accumulator) phải truyền xuyên suốt — đừng để handler tự tạo mảng mới.
- Public entry points worker gọi vào (`sendDeliveredMessage`, `sendWalletTopupPaidMessage`, `sendWalletTopupExpiredMessage`, `sendConnectionTopupPaidMessage`, `sendCatalogStockUpdateMessages`) **phải giữ nguyên signature** trên facade — chỉ delegate nội bộ. **Không đổi public API** kẻo gãy worker.

---

## 3. WORKER — module hóa (giữ `@ts-nocheck` đến cuối)

Thứ tự: pure → side-effect → bootstrap.

| # | Module mới | Nội dung (line hint) | Ghi chú |
|---|---|---|---|
| 1 | `format/text.ts` | helpers thuần (61–458): `sleep`, `formatError`, `parse*ManualDelivery*`, `escapeTelegramHtml`, money/date fmt, `buildDelivered*Message` | dễ nhất, type ngay |
| 2 | `config/env.ts` | interval const + `validateProductionConfig` (14–60) | export `WorkerConfig` typed |
| 3 | `infra/{redis,prisma}.ts` | `createRedisConnection`, `waitForInfrastructure`, `prisma` (686–799) | bỏ mutable globals → accessor |
| 4 | `money.ts` | `decimalToNumber`/`toDecimal`/`normalizeSourceEnum` (800–833) + dùng `DEFAULT_USDT_VND_RATE` (đã có) | — |
| 5 | `stock.ts` | `popManualStockEntries`, `countAvailableManualEntries` (519–604) | nhận `tx` |
| 6 | `warranty.ts` | `snapshotWarrantyForDeliveredOrder` (834–889) | wrapper shared |
| 7 | `wallet.ts` ⚠️ | `recordInternalSourceOrder` (1254), `debitConnectionBalance` (1310), `creditAffiliateCommission` (1371) | **RỦI RO NHẤT — tiền/ledger.** Bước riêng, test kỹ. |
| 8 | `fulfillment/catalog-sync.ts` | `syncCatalogForShop` (890–1146) + scheduler/lock (695–1247) + `notifyCatalogStockUpdates` | — |
| 9 | `fulfillment/purchase.ts` | `processPurchase` (1418–2138) + `reconcilePendingInternalSourceOrders` (2139–2298) | to nhất, tách sau khi 4–7 xong |
| 10 | `payments/{payos,okx,trc20,solana}.ts` | scanners (2514–2746, 3105–3612) | **XÓA luôn `pollWeb2mShops` (2985) dead** thay vì port |
| 11 | `schedulers/*.ts` | tier/expiry/cleanup/broadcast-sweep (2747–3104, 3616–3668) | — |
| 12 | `broadcast.ts` + `telegram-poll.ts` | (2299–2462, 2463–2513) | — |
| 13 | `bootstrap.ts` | wiring queue/worker/interval còn lại → **bỏ `@ts-nocheck`** | bước cuối |

**Bug tiện tay fix khi đụng tới (đã ghi CLAUDE.md):**
- Bước 10: xóa `pollWeb2mShops` (dùng sai `ENCRYPTION_KEY`, ref `JOBS.processPurchase` không tồn tại).
- `expireAwaitingPaymentOrders` xử lý provider `"BINANCE"` nhưng worker không có scanner Binance → xác nhận luồng confirm Binance đi qua webhook API (không phải lỗi, chỉ ghi chú).

---

## 4. Checklist mỗi increment (copy cho từng bước)

```
[ ] Đọc các method sẽ cắt + grep mọi call site (trong file + ngoài file)
[ ] Tạo file module mới, paste nguyên văn logic (không sửa hành vi)
[ ] Wiring: import/inject lại ở file gốc, gọi delegate
[ ] Giữ nguyên signature các public method worker/controller gọi vào
[ ] npm run typecheck (shared, api, worker, web) — XANH
[ ] (bot) dev:api lên được, gửi 1 update test không lỗi
[ ] (worker) dev:worker lên được, không crash bootstrap
[ ] git commit "refactor(bot|worker): extract <module> (no behavior change)"
[ ] Cập nhật số dòng tham chiếu trong plan này nếu lệch nhiều
```

---

## 5. Rủi ro & cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| Đổi nhầm hành vi tiền (`wallet.ts` worker, CTV pricing) | Bước riêng, diff phải là cut&paste; so giá trị tính ra trước/sau trên 1 case mẫu |
| Gãy public API worker↔bot | Giữ facade method nguyên signature, chỉ delegate |
| Số dòng trôi | Tham chiếu theo tên method; cập nhật plan sau mỗi bước |
| Vòng phụ thuộc giữa handler | Dispatcher sở hữu session+transport; handler không gọi chéo nhau, chỉ gọi service |
| `@ts-nocheck` worker che lỗi | File tách ra viết typed ngay; chỉ `main.ts` gốc còn nocheck đến cuối |

---

## 6. Ước lượng

- Bot: 12 bước. Bước 1–3 (leaf) + P0 nhanh & an toàn. Bước 9–11 (payment/catalog/checkout) nặng. Bước 12 (dispatcher) gom cuối.
- Worker: 13 bước. Bước 7 (wallet) và 9 (purchase) là 2 bước cần cẩn thận nhất.
- Khuyến nghị: làm **bot trước** (có type-check bảo vệ), worker sau (vì đang nocheck, rủi ro hơn).
